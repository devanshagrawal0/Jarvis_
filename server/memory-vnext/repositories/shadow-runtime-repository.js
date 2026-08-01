"use strict";

function createShadowRuntimeRepository({ db }) {
  function activeSession(importRunId) {
    return db.prepare(`SELECT id,import_run_id,started_at,required_until,status,legacy_answers_authoritative,duplicate_provider_calls
      FROM shadow_sessions WHERE import_run_id=? AND status IN ('capturing','evaluating') ORDER BY started_at DESC,id DESC LIMIT 1`).get(String(importRunId));
  }

  function prerequisites(importRunId) {
    return {
      importRun: db.prepare("SELECT id,status,pending_review_rows,conflict_rows FROM import_runs WHERE id=?").get(String(importRunId)) || null,
      projection: db.prepare("SELECT id,projection_version,state,activated_at FROM retrieval_projections WHERE state='active' ORDER BY activated_at DESC LIMIT 1").get() || null,
    };
  }

  function status(sessionId) {
    if (!sessionId) return null;
    const session = db.prepare(`SELECT id,import_run_id,policy_version,started_at,required_until,status,legacy_answers_authoritative,duplicate_provider_calls,completed_at
      FROM shadow_sessions WHERE id=?`).get(String(sessionId));
    if (!session) return null;
    const counts = {
      intents: Number(db.prepare("SELECT COUNT(*) AS count FROM shadow_intents WHERE session_id=?").get(session.id).count),
      replayed: Number(db.prepare("SELECT COUNT(*) AS count FROM shadow_intents WHERE session_id=? AND replay_status='replayed'").get(session.id).count),
      comparisons: Number(db.prepare("SELECT COUNT(*) AS count FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=?").get(session.id).count),
      unresolvedCritical: Number(db.prepare("SELECT COUNT(*) AS count FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=? AND c.status='open' AND c.severity='critical'").get(session.id).count),
      unresolvedHigh: Number(db.prepare("SELECT COUNT(*) AS count FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=? AND c.status='open' AND c.severity='high'").get(session.id).count),
      ownerTurns: Number(db.prepare("SELECT COUNT(*) AS count FROM turns WHERE role='user'").get().count),
      assistantTurns: Number(db.prepare("SELECT COUNT(*) AS count FROM turns WHERE role='assistant'").get().count),
      contextPacks: Number(db.prepare("SELECT COUNT(*) AS count FROM context_packs").get().count),
    };
    const lastComparison = db.prepare(`SELECT c.classification,c.severity,c.status,c.created_at
      FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).get(session.id) || null;
    return { session, counts, lastComparison };
  }

  return Object.freeze({ activeSession, prerequisites, status });
}

module.exports = { createShadowRuntimeRepository };
