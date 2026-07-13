// helix-retrieval.js — HELIX rebuild H2: the retrieval contract.
// parse → FTS + vector (+ graph) in parallel → fuse/rerank → return cited cards → log.
// Replaces the Oracle's 50-entry/150-char dump and gives every answer real
// project-scoped retrieval instead of a recent-entry slice.
//
// CommonJS. Vector search is optional: it activates once embeddings exist; FTS works
// immediately. Cosine is computed in JS over the substrate's stored Float32 vectors.

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function recencyBoost(createdAt) {
  if (!createdAt) return 0;
  const days = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  return Math.max(0, 0.15 * Math.exp(-days / 45)); // small, decays over ~45d
}

/**
 * Run the retrieval contract for a project-scoped query.
 * @param substrate  helixDb.substrate (fts, vectors, runs, ...)
 * @param opts.embed optional async (text)=>number[]; enables the vector leg
 * @param opts.hydrate optional (kind, refId)=>{title,text,createdAt,source} for card bodies
 * @returns { cards, ftsCount, vecCount, retrievalEventId }
 */
async function retrieve(substrate, projectId, query, opts = {}) {
  const { embed = null, hydrate = null, runId = null, subquestionId = null, limit = 12 } = opts;
  const q = String(query || "").trim();
  if (!substrate || !q) return { cards: [], ftsCount: 0, vecCount: 0, retrievalEventId: null };

  // ── FTS leg ──
  const ftsHits = substrate.fts.search(projectId, ftsQuery(q), 30);
  // ── Vector leg (optional) ──
  let vecHits = [];
  if (embed) {
    try {
      const qv = await embed(q);
      if (Array.isArray(qv) && qv.length) {
        const rows = substrate.vectors.listByProject(projectId);
        vecHits = rows
          .map(r => ({ refId: r.ref_id, refKind: r.ref_kind, score: cosine(qv, r.vector), preview: r.text_preview }))
          .filter(h => h.score > 0.15)
          .sort((a, b) => b.score - a.score)
          .slice(0, 30);
      }
    } catch { /* embedding unavailable → FTS-only, still honest */ }
  }

  // ── Fuse & rerank ──
  // Normalize each leg's scores to 0..1, sum with weights, add small recency boost.
  const fused = new Map(); // refId -> card
  const ftsMax = Math.max(1, ...ftsHits.map(h => -h.score)); // bm25 lower = better; flip sign
  for (const h of ftsHits) {
    const norm = (-h.score) / ftsMax;
    upsertCard(fused, h.ref_id, h.ref_kind, { fts: norm, snippet: h.snippet });
  }
  const vecMax = Math.max(1e-6, ...vecHits.map(h => h.score));
  for (const h of vecHits) {
    upsertCard(fused, h.refId, h.refKind, { vec: h.score / vecMax, preview: h.preview });
  }

  let cards = [...fused.values()].map(c => {
    const body = hydrate ? hydrate(c.refKind, c.refId) : null;
    const rec = recencyBoost(body?.createdAt);
    const score = 0.55 * (c.fts || 0) + 0.45 * (c.vec || 0) + rec;
    const why = [c.fts ? "keyword" : null, c.vec ? "semantic" : null].filter(Boolean).join(" + ") || "keyword";
    return {
      refId: c.refId, refKind: c.refKind, score: +score.toFixed(4),
      title: body?.title || c.snippet || c.preview || "(evidence)",
      excerpt: (body?.text || c.snippet || c.preview || "").slice(0, 240),
      source: body?.source || null, matchedBy: why,
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  // ── Log the retrieval set for reproducibility ──
  let retrievalEventId = null;
  try {
    retrievalEventId = substrate.runs.logRetrieval({
      runId, projectId, query: q, providers: ["fts", ...(embed ? ["vector"] : [])],
      resultsReturned: ftsHits.length + vecHits.length, resultsIngested: cards.length,
      fusedResultIds: cards.map(c => c.refId), subquestionId, tool: "helix-retrieve",
    });
  } catch { /* logging best-effort */ }

  return { cards, ftsCount: ftsHits.length, vecCount: vecHits.length, retrievalEventId };
}

function upsertCard(map, refId, refKind, patch) {
  const cur = map.get(refId) || { refId, refKind };
  map.set(refId, { ...cur, ...patch });
}

// FTS5 MATCH-safe query: OR the significant terms, quote to avoid syntax errors.
function ftsQuery(q) {
  const terms = q.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w)).slice(0, 8);
  if (!terms.length) return `"${q.replace(/"/g, "")}"`;
  return terms.map(t => `"${t}"`).join(" OR ");
}
const STOP = new Set("the a an and or of to in on for is are was were be been what which how why does do did with from this that these those our your".split(" "));

module.exports = { retrieve, cosine, ftsQuery };
