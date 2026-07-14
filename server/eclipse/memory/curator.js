// ECLIPSE Memory Curator (P2·W6) — the "nightly" deterministic consolidation job (deep-design
// §3 deferred the live curator agent to this cheaper, testable form). It reads the episodic
// claim record and:
//   • PROMOTES validated (supported) claims into curated semantic memory, deduped by normalized
//     content hash, with a corroboration count (support_count) across missions;
//   • distills refuted/unsupported claims into REFLEXION notes (keyed by task signature) so a
//     future mission recalls the lesson;
//   • PRUNES stale, low-value single-support facts.
// Pure over local SQLite; no model call.
const { id, nowIso, hashOf } = require("../contracts/validate");

function normalize(text) { return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim(); }
function signatureOf(text) { return normalize(text).split(" ").slice(0, 6).join(" "); }

function runCurator(db, { pruneConfidence = 0.35 } = {}) {
  const claims = db.prepare(`SELECT claim_id, mission_id, text, class, confidence, status FROM claims`).all();
  const getByHash = db.prepare(`SELECT mem_id, support_count, confidence FROM eclipse_semantic_memory WHERE content_hash=?`);
  const insMem = db.prepare(`INSERT OR IGNORE INTO eclipse_semantic_memory(mem_id,text,kind,confidence,support_count,content_hash,first_mission,last_mission,created_at,updated_at)
    VALUES(@mem_id,@text,@kind,@confidence,1,@content_hash,@mission,@mission,@at,@at)`);
  const bump = db.prepare(`UPDATE eclipse_semantic_memory SET support_count=support_count+1, confidence=MAX(confidence,@confidence), last_mission=@mission, updated_at=@at WHERE content_hash=@content_hash`);

  let promoted = 0, corroborated = 0, reflexions = 0;
  const seenReflexion = new Set();

  for (const c of claims) {
    const at = nowIso();
    if (c.status === "supported") {
      const hash = hashOf("fact:" + normalize(c.text));
      const existing = getByHash.get(hash);
      if (existing) { bump.run({ confidence: c.confidence, mission: c.mission_id, at, content_hash: hash }); corroborated++; }
      else { insMem.run({ mem_id: id("sem"), text: c.text, kind: "fact", confidence: c.confidence, content_hash: hash, mission: c.mission_id, at }); promoted++; }
    } else if (c.status === "unsupported" || c.status === "mixed" || c.status === "stale") {
      // Distil a reflexion note keyed by task signature (dedup within this run).
      const sig = signatureOf(c.text);
      const hash = hashOf("reflexion:" + sig);
      if (seenReflexion.has(hash)) continue; seenReflexion.add(hash);
      if (!getByHash.get(hash)) {
        insMem.run({ mem_id: id("rfx"), text: `Unverified/weak: "${sig}…" — verify sources before asserting.`, kind: "reflexion", confidence: 0.3, content_hash: hash, mission: c.mission_id, at });
        reflexions++;
      }
    }
  }

  // Prune stale, low-value single-support facts.
  const pruned = db.prepare(`DELETE FROM eclipse_semantic_memory WHERE kind='fact' AND support_count=1 AND confidence < ?`).run(pruneConfidence).changes;
  const semanticTotal = db.prepare(`SELECT COUNT(*) AS n FROM eclipse_semantic_memory WHERE kind='fact'`).get().n;

  return { promoted, corroborated, reflexions, pruned, semanticTotal, claimsSeen: claims.length };
}

// Retrieve curated semantic memory (for a future mission's context capsule).
function getSemantic(db, { kind = "fact", limit = 50 } = {}) {
  return db.prepare(`SELECT mem_id, text, kind, confidence, support_count FROM eclipse_semantic_memory WHERE kind=? ORDER BY support_count DESC, confidence DESC LIMIT ?`).all(kind, limit);
}

module.exports = { runCurator, getSemantic, normalize, signatureOf };
