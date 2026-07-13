// ECLIPSE orchestration store — the domain DAL over runtime/eclipse.sqlite (separate from the
// LangGraph checkpoint DB). Owns graph-run lifecycle, the monotonic EclipseEvent log, node-run
// records, mission ledger snapshots, and the idempotency onceGuard that makes crash/replay
// side-effect-safe. All writes are synchronous (better-sqlite3). Task OS remains canonical for
// mission STATUS; this mirrors execution detail.
const path = require("path");
const { openEclipseDb, migrate } = require("../db/migrations");
const { nowIso } = require("../contracts/validate");

// openStore({ dir }) opens <dir>/eclipse.sqlite; openStore({ db }) wraps an existing db (tests).
function openStore({ dir, db } = {}) {
  const database = db || openEclipseDb(dir || ".");
  try { database.pragma("busy_timeout = 5000"); } catch { /* :memory: */ }
  migrate(database);

  const stmt = {
    upsertRun: database.prepare(`INSERT INTO eclipse_graph_runs(graph_run_id, mission_id, graph_version, status, phase, thread_id, started_at)
      VALUES(@graph_run_id,@mission_id,@graph_version,@status,@phase,@thread_id,@started_at)
      ON CONFLICT(graph_run_id) DO UPDATE SET status=excluded.status, phase=excluded.phase`),
    setStatus: database.prepare(`UPDATE eclipse_graph_runs SET status=?, phase=?, completed_at=? WHERE graph_run_id=?`),
    mirror: database.prepare(`UPDATE eclipse_graph_runs SET checkpoint_id=?, state_revision=?, phase=?, tokens=?, cost_usd=? WHERE graph_run_id=?`),
    reqCancel: database.prepare(`UPDATE eclipse_graph_runs SET cancel_requested=1 WHERE graph_run_id=?`),
    getRun: database.prepare(`SELECT * FROM eclipse_graph_runs WHERE graph_run_id=?`),
    nodeRun: database.prepare(`INSERT OR IGNORE INTO eclipse_node_runs(node_run_id, graph_run_id, node_id, attempt, status, model_id, tokens, cost_usd, started_at, completed_at)
      VALUES(@node_run_id,@graph_run_id,@node_id,@attempt,@status,@model_id,@tokens,@cost_usd,@started_at,@completed_at)`),
    nextSeq: database.prepare(`SELECT COALESCE(MAX(sequence),-1)+1 AS n FROM eclipse_events WHERE mission_id=?`),
    insEvent: database.prepare(`INSERT INTO eclipse_events(event_id, mission_id, sequence, event_type, payload_json, occurred_at) VALUES(?,?,?,?,?,?)`),
    getEvents: database.prepare(`SELECT * FROM eclipse_events WHERE mission_id=? AND sequence>? ORDER BY sequence`),
    getReceipt: database.prepare(`SELECT result_json FROM eclipse_receipts WHERE key=?`),
    putReceipt: database.prepare(`INSERT OR IGNORE INTO eclipse_receipts(key, mission_id, node_id, result_json, created_at) VALUES(?,?,?,?,?)`),
  };

  const listeners = new Map(); // missionId → Set<fn(event)>  (in-process live tail for SSE)
  function subscribe(missionId, fn) {
    if (!listeners.has(missionId)) listeners.set(missionId, new Set());
    listeners.get(missionId).add(fn);
    return () => { const s = listeners.get(missionId); if (s) { s.delete(fn); if (!s.size) listeners.delete(missionId); } };
  }

  let evSeq = 0; // monotonic id counter for event_id uniqueness within a process
  function appendEvent(missionId, type, payload = {}) {
    const seq = stmt.nextSeq.get(missionId).n;
    const eventId = `ev_${missionId}_${seq}_${evSeq++}`;
    const occurredAt = nowIso();
    stmt.insEvent.run(eventId, missionId, seq, type, JSON.stringify(payload || {}), occurredAt);
    const evt = { eventId, missionId, sequence: seq, type, event_type: type, payload, occurredAt };
    const subs = listeners.get(missionId);
    if (subs) for (const fn of subs) { try { fn(evt); } catch { /* subscriber error must not break the run */ } }
    return evt;
  }

  // Idempotency guard: run fn() only if `key` has not been recorded; persist a receipt so a
  // crash/replay re-execution skips the side effect and returns the cached result. The receipt
  // is written BEFORE fn so an effect that partially completes then crashes is not repeated.
  function onceGuard(key, meta, fn) {
    const existing = stmt.getReceipt.get(key);
    if (existing) return { skipped: true, result: existing.result_json ? JSON.parse(existing.result_json) : null };
    stmt.putReceipt.run(key, meta.missionId, meta.node || null, null, nowIso());
    const result = fn ? fn() : null;
    if (result !== undefined && result !== null) {
      database.prepare(`UPDATE eclipse_receipts SET result_json=? WHERE key=?`).run(JSON.stringify(result), key);
    }
    return { skipped: false, result };
  }
  function seen(key) { return !!stmt.getReceipt.get(key); }

  return {
    db: database,
    upsertRun: (row) => stmt.upsertRun.run({ graph_version: "v1", status: "running", phase: "intake", thread_id: row.graph_run_id, started_at: nowIso(), ...row }),
    setStatus: (id, status, phase = null) => stmt.setStatus.run(status, phase, /complete|failed|cancelled/.test(status) ? nowIso() : null, id),
    mirrorCheckpoint: (id, { checkpointId = null, revision = 0, phase = null, tokens = 0, costUsd = 0 }) => stmt.mirror.run(checkpointId, revision, phase, tokens, costUsd, id),
    requestCancel: (id) => stmt.reqCancel.run(id),
    isCancelRequested: (id) => { const r = stmt.getRun.get(id); return !!(r && r.cancel_requested); },
    getRun: (id) => stmt.getRun.get(id),
    recordNodeRun: (row) => stmt.nodeRun.run({ node_run_id: `${row.graph_run_id}:${row.node_id}:${row.attempt || 0}`, attempt: 0, status: "complete", model_id: null, tokens: 0, cost_usd: 0, started_at: nowIso(), completed_at: nowIso(), ...row }),
    appendEvent, subscribe,
    getEvents: (missionId, sinceSeq = -1) => stmt.getEvents.all(missionId, sinceSeq).map((e) => ({ ...e, payload: JSON.parse(e.payload_json) })),
    onceGuard, seen,
    close: () => { try { database.close(); } catch { /* already closed */ } },
  };
}

module.exports = { openStore };
