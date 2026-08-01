"use strict";

const OWNER_SCOPE = "owner:local";
const OWNER_REF = "local-owner";
function unique(items) { return [...new Set((items || []).filter(Boolean))]; }

function createPersonalContextRegistryRepository({ db, clock }) {
  return Object.freeze({
    activeProjection: () => db.prepare("SELECT id,projection_version AS version FROM retrieval_projections WHERE state='active' ORDER BY activated_at DESC LIMIT 1").get(),
    currentAssertion: (predicate) => db.prepare("SELECT id FROM assertions WHERE scope_id=? AND subject_type='owner' AND subject_ref=? AND predicate=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(OWNER_SCOPE, OWNER_REF, String(predicate)),
    latestAssertion: (predicate) => db.prepare("SELECT id,status FROM assertions WHERE scope_id=? AND subject_type='owner' AND subject_ref=? AND predicate=? ORDER BY updated_at DESC LIMIT 1").get(OWNER_SCOPE, OWNER_REF, String(predicate)),
    retrievalDocuments: (recordType, recordId) => db.prepare("SELECT id FROM retrieval_documents WHERE record_type=? AND record_id=? AND status='active'").all(String(recordType), String(recordId)),
    topicNodeIds: (topics) => (topics || []).map((topic) => db.prepare("SELECT id FROM graph_nodes WHERE scope_id=? AND node_type='topic' AND node_key=? AND status='active'").get(OWNER_SCOPE, `topic:${topic}`)?.id).filter(Boolean),
    topicGraphRefs: (topics, limit = 30) => {
      const keys = unique(topics).map((topic) => `topic:${topic}`); if (!keys.length) return [];
      const placeholders = keys.map(() => "?").join(",");
      return db.prepare(`SELECT DISTINCT target.canonical_ref_type AS type,target.canonical_ref_id AS id
        FROM graph_nodes topic JOIN graph_edges edge ON edge.from_node_id=topic.id AND edge.status='active'
        JOIN graph_nodes target ON target.id=edge.to_node_id AND target.status='active'
        WHERE topic.scope_id=? AND topic.node_type='topic' AND topic.status='active' AND topic.node_key IN (${placeholders})
          AND target.canonical_ref_type IS NOT NULL AND target.canonical_ref_id IS NOT NULL
        ORDER BY CASE edge.origin_kind WHEN 'canonical' THEN 0 ELSE 1 END,edge.weight DESC,edge.confidence DESC,target.id LIMIT ?`).all(OWNER_SCOPE, ...keys, Math.max(1, Math.min(100, Number(limit) || 30)));
    },
    graphRefs: (nodeIds) => (nodeIds || []).map((id) => db.prepare("SELECT canonical_ref_type AS type,canonical_ref_id AS id FROM graph_nodes WHERE id=? AND status='active'").get(String(id))).filter((item) => item?.type && item?.id),
    retireFactEdges: (recordId) => db.prepare("UPDATE graph_edges SET status='superseded',recorded_to=? WHERE status='active' AND (from_node_id IN (SELECT id FROM graph_nodes WHERE canonical_ref_type='assertion' AND canonical_ref_id=?) OR to_node_id IN (SELECT id FROM graph_nodes WHERE canonical_ref_type='assertion' AND canonical_ref_id=?))").run(clock().toISOString(), String(recordId), String(recordId)).changes,
  });
}

module.exports = { createPersonalContextRegistryRepository };
