// Scout support tools (S1.B3): the no-overlap registry (db-backed, first-writer-wins) and
// knowledge.search (FTS5 over the curator-gated semantic memory; every hit carries provenance).
const { nowIso } = require("../contracts/validate");

function createRegistryTools(db) {
  const ins = db.prepare(`INSERT OR IGNORE INTO eclipse_scout_registry(mission_id,scout_id,kind,value,content_hash,created_at)
    VALUES(@mission_id,@scout_id,@kind,@value,@content_hash,@at)`);
  const get = db.prepare(`SELECT scout_id FROM eclipse_scout_registry WHERE mission_id=? AND kind=? AND value=?`);
  return {
    claim({ missionId, scoutId, kind, value, contentHash = null }) {
      const r = ins.run({ mission_id: missionId, scout_id: scoutId, kind, value, content_hash: contentHash, at: nowIso() });
      if (r.changes === 1) return { ok: true };
      const owner = get.get(missionId, kind, value);
      return { ok: owner && owner.scout_id === scoutId, ownedBy: owner ? owner.scout_id : null };
    },
    check({ missionId, kind, value, scoutId }) {
      const owner = get.get(missionId, kind, value);
      return { free: !owner || owner.scout_id === scoutId, ownedBy: owner ? owner.scout_id : null };
    },
  };
}

function createKnowledgeSearch(db) {
  // bm25 (lower = better) × confidence × log(1+support): rank settled, well-supported facts first.
  const q = db.prepare(`
    SELECT m.mem_id, m.text, m.kind, m.confidence, m.support_count, m.provenance_json, m.agent_scope,
           bm25(fts_semantic) AS rank
    FROM fts_semantic f JOIN eclipse_semantic_memory m ON m.rowid = f.rowid
    WHERE fts_semantic MATCH ? AND (m.agent_scope IS NULL OR m.agent_scope = ?)
    ORDER BY rank LIMIT 30`);
  return function knowledgeSearch({ query, scope = null, limit = 8 } = {}) {
    // FTS5 syntax chokes on raw punctuation — quote each term.
    const terms = String(query || "").match(/[a-zA-Z0-9]{3,}/g) || [];
    if (!terms.length) return [];
    const match = terms.slice(0, 12).map((t) => `"${t}"`).join(" OR ");
    let rows = [];
    try { rows = q.all(match, scope); } catch { return []; }
    return rows
      .map((r) => ({ ...r, score: (1 / (1 + Math.max(0, r.rank))) * r.confidence * Math.log(1 + r.support_count) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ memId: r.mem_id, text: r.text, kind: r.kind, confidence: r.confidence, support_count: r.support_count, provenance: JSON.parse(r.provenance_json || "null") }));
  };
}

module.exports = { createRegistryTools, createKnowledgeSearch };
