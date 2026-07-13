// ECLIPSE Memory Resonance v1 (deep-design §7) — adopt the cheap 80%, defer graph builds.
//   • Hybrid retrieval via Reciprocal Rank Fusion (RRF) of a lexical rank + a deterministic
//     bag-of-words "vector" rank (real embeddings/ANN are a scale-gated future ADR).
//   • Reflexion: failure notes keyed by task-signature (episodic memory).
//   • Self-RAG: a self-check that a claim is grounded before it's presented.
// Pure + deterministic (no model, no live memory-vectors.sqlite touched → isolation preserved).

function tokens(s) { return String(s || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2); }

// Lexical score = overlap-weighted (idf-free BM25-lite). Returns ranked ids.
function lexicalRank(query, corpus) {
  const qt = tokens(query);
  return corpus.map((d) => {
    const dt = tokens(d.text);
    const set = new Set(dt);
    const overlap = qt.reduce((a, t) => a + (set.has(t) ? 1 : 0), 0);
    const score = overlap / (1 + Math.log(1 + dt.length)); // length-normalized
    return { id: d.id, score };
  }).sort((a, b) => b.score - a.score);
}

// Deterministic "vector": hashed bag-of-words → cosine. Stands in for an embedding index.
function vec(text) {
  const v = new Float64Array(64);
  for (const t of tokens(text)) { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; v[h % 64] += 1; }
  return v;
}
function cosine(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return na && nb ? d / Math.sqrt(na * nb) : 0; }
function vectorRank(query, corpus) {
  const qv = vec(query);
  return corpus.map((d) => ({ id: d.id, score: cosine(qv, d._v || (d._v = vec(d.text))) })).sort((a, b) => b.score - a.score);
}

// Reciprocal Rank Fusion — explainable, no score-scale calibration needed. K=60 is standard.
function rankRRF(query, corpus, k = 5, { rrfK = 60 } = {}) {
  if (!corpus.length) return [];
  const lex = lexicalRank(query, corpus), vecR = vectorRank(query, corpus);
  const rankOf = (arr) => { const m = new Map(); arr.forEach((r, i) => m.set(r.id, i + 1)); return m; };
  const lr = rankOf(lex), vr = rankOf(vecR);
  const fused = corpus.map((d) => {
    const fuse = 1 / (rrfK + (lr.get(d.id) || corpus.length)) + 1 / (rrfK + (vr.get(d.id) || corpus.length));
    return { id: d.id, text: d.text, score: fuse, reason: `lexical#${lr.get(d.id)} + vector#${vr.get(d.id)}` };
  }).sort((a, b) => b.score - a.score);
  return fused.slice(0, k);
}

// Reflexion — a failure note keyed by task signature, so a repeat attempt recalls the lesson.
function reflexionNote({ taskSignature, failure, lesson }) {
  return { kind: "reflexion", taskSignature: String(taskSignature || "").slice(0, 120), failure: String(failure || "").slice(0, 400), lesson: String(lesson || "").slice(0, 400), at: null };
}

// Self-RAG — before presenting a claim, check it is grounded in ≥1 supporting evidence ref with
// adequate entailment. Returns {grounded, needsMore, reason}.
function selfRAGCheck(claim, evidence = [], { minEntail = 0.5 } = {}) {
  if (!evidence.length) return { grounded: false, needsMore: true, reason: "no evidence" };
  const best = Math.max(...evidence.map((e) => e.entailment ?? 0.6));
  return best >= minEntail ? { grounded: true, needsMore: false, reason: `supported (entail ${best.toFixed(2)})` } : { grounded: false, needsMore: true, reason: `weak support (${best.toFixed(2)} < ${minEntail})` };
}

module.exports = { rankRRF, lexicalRank, vectorRank, reflexionNote, selfRAGCheck, tokens };
