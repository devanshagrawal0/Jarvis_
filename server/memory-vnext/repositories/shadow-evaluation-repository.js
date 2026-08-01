"use strict";

const crypto = require("node:crypto");
const { insertEncrypted, createLedgerRepository } = require("./ledger-repository");
const { canonical, sha256 } = require("../import-adapters");

const CUTOVER_DOMAINS = Object.freeze(["explicit_commands", "conversation_runtime", "retrieval_context", "room_integrations"]);
function quantile(values, p) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] || 0; }
function ids(result) { return new Set((result?.refs || result?.items || []).map((item) => String(item.id || item.ref || item))); }
function overlap(a, b) { const union = new Set([...a, ...b]); if (!union.size) return 1; let shared = 0; for (const value of a) if (b.has(value)) shared += 1; return shared / union.size; }

function createShadowEvaluationRepository(dependencies) {
  const { db, keyring, clock, faultInjector } = dependencies;
  if (Number(db.pragma("user_version", { simple: true })) < 29) throw new Error("Shadow evaluation requires schema version 29.");
  const ledger = createLedgerRepository(dependencies);
  const now = () => clock().toISOString();
  const encrypt = (scopeId, type, payload, sensitivity = "private") => insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id;
  const sign = (value, purpose) => keyring.sign(JSON.stringify(canonical(value)), purpose);

  function createSession(input = {}) {
    const imported = db.prepare("SELECT status FROM import_runs WHERE id=?").get(String(input.importRunId));
    if (imported?.status !== "reconciled") throw Object.assign(new Error("A reconciled import run is required."), { code: "SHADOW_IMPORT_NOT_RECONCILED" });
    const started = new Date(input.startedAt || clock()); const requiredUntil = new Date(input.requiredUntil || started.getTime() + 7 * 86400000);
    if (!Number.isFinite(requiredUntil.getTime()) || requiredUntil <= started) throw new Error("Shadow soak window must end after it starts.");
    const id = String(input.id || crypto.randomUUID()); db.prepare("INSERT INTO shadow_sessions(id,import_run_id,policy_version,started_at,required_until,status,legacy_answers_authoritative,duplicate_provider_calls) VALUES(?,?,?,?,?,'capturing',1,0)").run(id, String(input.importRunId), String(input.policyVersion || "wave31-v1"), started.toISOString(), requiredUntil.toISOString()); return { id, status: "capturing", startedAt: started.toISOString(), requiredUntil: requiredUntil.toISOString(), legacyAnswersAuthoritative: true, duplicateProviderCalls: 0 };
  }

  function captureIntent(input = {}) {
    const session = db.prepare("SELECT status FROM shadow_sessions WHERE id=?").get(String(input.sessionId)); if (!session || !["capturing", "evaluating"].includes(session.status)) throw new Error("Active shadow session is required.");
    const idempotencyKey = String(input.idempotencyKey || ""); if (!idempotencyKey) throw new Error("Shadow intent idempotency key is required.");
    const receipt = ledger.commitCommand({ commandType: `shadow.${String(input.commandType || "intent")}`, actorId: String(input.actorId || "local-owner"), scopeId: String(input.scopeId || "owner:local"), purpose: "shadow_intent_capture", idempotencyKey: `shadow:${input.sessionId}:${idempotencyKey}`, streamType: "shadow-session", streamId: String(input.sessionId), eventType: "memory.shadow.intent.captured", sensitivity: String(input.sensitivity || "private"), payload: { commandType: String(input.commandType || "intent"), intent: input.intent || {}, legacyReceiptRef: input.legacyReceiptRef || null, sharedEnrichmentRef: input.sharedEnrichmentRef || null }, outboxTargets: ["memory-vnext.shadow-replay"] });
    const prior = db.prepare("SELECT id,ledger_event_id,replay_status FROM shadow_intents WHERE ledger_event_id=?").get(receipt.eventId); if (prior) return { ...prior, replayed: true, providerCalls: 0 };
    const run = db.transaction(() => { const intentId = encrypt(String(input.scopeId || "owner:local"), "shadow-typed-intent", { commandType: String(input.commandType || "intent"), intent: input.intent || {}, sharedEnrichmentRef: input.sharedEnrichmentRef || null }, String(input.sensitivity || "private")); const id = String(input.id || crypto.randomUUID()); db.prepare(`INSERT INTO shadow_intents(id,session_id,ledger_event_id,idempotency_key,command_type,scope_id,intent_encrypted_id,intent_hash,legacy_receipt_ref,vnext_replay_ref,replay_status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,'captured',?)`).run(id, String(input.sessionId), receipt.eventId, idempotencyKey, String(input.commandType || "intent"), String(input.scopeId || "owner:local"), intentId, sha256(JSON.stringify(canonical(input.intent || {}))), input.legacyReceiptRef ? String(input.legacyReceiptRef) : null, now()); faultInjector("shadow.intent.before_commit"); return { id, ledgerEventId: receipt.eventId, outboxTargets: receipt.outboxTargets, replayStatus: "captured", replayed: false, providerCalls: 0 }; }); return run.immediate();
  }

  function markIntentReplayed(input = {}) { const status = ["replayed", "diverged", "failed", "skipped"].includes(input.status) ? input.status : "replayed"; const changed = db.prepare("UPDATE shadow_intents SET replay_status=?,vnext_replay_ref=? WHERE id=? AND replay_status='captured'").run(status, input.vnextReplayRef ? String(input.vnextReplayRef) : null, String(input.intentId)); if (changed.changes !== 1) throw new Error("Captured shadow intent is unavailable."); return { id: String(input.intentId), status }; }

  function compare(input = {}) {
    const session = db.prepare("SELECT status FROM shadow_sessions WHERE id=?").get(String(input.sessionId)); if (!session) throw new Error("Shadow session is unavailable.");
    const scopeId = String(input.scopeId || "owner:local"); const legacy = input.legacyResult || {}; const vnext = input.vnextResult || {}; const legacyIds = ids(legacy); const vnextIds = ids(vnext); const allowed = new Set((input.allowedScopeIds || [scopeId]).map(String)); const leaked = (vnext.scopeIds || []).map(String).filter((scope) => !allowed.has(scope));
    const metrics = { refOverlap: overlap(legacyIds, vnextIds), legacyRefCount: legacyIds.size, vnextRefCount: vnextIds.size, scopeLeaks: leaked.length, temporalCorrect: vnext.temporalCorrect !== false, deletionCorrect: vnext.deletionCorrect !== false, privacySafe: vnext.privacySafe !== false, duplicateProviderCalls: 0, sharedEnrichment: Boolean(input.sharedEnrichmentRef), legacyLatencyMs: Math.max(0, Number(input.legacyLatencyMs) || 0), vnextLatencyMs: Math.max(0, Number(input.vnextLatencyMs) || 0) };
    let classification = "expected_difference"; let severity = "low";
    if (!metrics.privacySafe) { classification = "privacy_error"; severity = "critical"; }
    else if (metrics.scopeLeaks) { classification = "scope_leak"; severity = "critical"; }
    else if (!metrics.deletionCorrect) { classification = "deletion_error"; severity = "critical"; }
    else if (!metrics.temporalCorrect) { classification = "temporal_error"; severity = "high"; }
    else if (vnext.skippedByPlanner === true && !vnextIds.size) { classification = legacyIds.size ? "vnext_better" : "equivalent"; severity = "none"; }
    else if (!vnextIds.size && legacyIds.size) { classification = "missing"; severity = "high"; }
    else if (metrics.refOverlap === 1) { classification = "equivalent"; severity = "none"; }
    else if (Number(vnext.quality || 0) > Number(legacy.quality || 0)) { classification = "vnext_better"; severity = "none"; }
    else if (Number(vnext.quality || 0) < Number(legacy.quality || 0)) { classification = "legacy_better"; severity = "medium"; }
    const id = String(input.id || crypto.randomUUID()); const comparisonId = String(input.comparisonId || crypto.randomUUID());
    const apply = db.transaction(() => { const queryId = encrypt(scopeId, "shadow-query", input.query || {}, "private"); const legacyId = encrypt(scopeId, "shadow-legacy-result", legacy, "private"); const vnextId = encrypt(scopeId, "shadow-vnext-result", vnext, "private"); db.prepare(`INSERT INTO shadow_query_runs(id,session_id,scope_id,query_hash,query_encrypted_id,legacy_result_encrypted_id,vnext_result_encrypted_id,shared_enrichment_ref,legacy_latency_ms,vnext_latency_ms,duplicate_provider_calls,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`).run(id, String(input.sessionId), scopeId, sha256(JSON.stringify(canonical(input.query || {}))), queryId, legacyId, vnextId, input.sharedEnrichmentRef ? String(input.sharedEnrichmentRef) : null, metrics.legacyLatencyMs, metrics.vnextLatencyMs, now()); const explanationId = encrypt(scopeId, "shadow-comparison-explanation", { classification, leakedScopes: leaked, note: input.note || null }, "restricted"); db.prepare("INSERT INTO shadow_comparisons(id,query_run_id,metrics_json,classification,severity,status,explanation_encrypted_id,created_at) VALUES(?,?,?,?,?,'open',?,?)").run(comparisonId, id, JSON.stringify(metrics), classification, severity, explanationId, now()); faultInjector("shadow.compare.before_commit"); return { id, comparisonId, classification, severity, metrics }; }); return apply.immediate();
  }

  function resolveComparison(input = {}) {
    const actor = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(input.actorId));
    if (!actor || actor.actor_type !== "owner" || actor.status !== "active" || String(input.authorityZone) !== "owner") throw Object.assign(new Error("Direct owner authority is required."), { code: "OWNER_AUTHORITY_REQUIRED" });
    const row = db.prepare("SELECT id,query_run_id,explanation_encrypted_id,status FROM shadow_comparisons WHERE id=?").get(String(input.comparisonId));
    if (!row || row.status !== "open") throw new Error("Open shadow comparison is unavailable.");
    const reasonCode = String(input.reasonCode || "OWNER_REVIEWED"); const note = String(input.note || "Reviewed and resolved.").slice(0, 2000); const nowAt = now();
    const apply = db.transaction(() => { const explanationId = encrypt("owner:local", "shadow-comparison-resolution", { reasonCode, note, resolvedBy: String(input.actorId), resolvedAt: nowAt }, "restricted"); db.prepare("UPDATE shadow_comparisons SET status='resolved',explanation_encrypted_id=? WHERE id=? AND status='open'").run(explanationId, row.id); if (row.explanation_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.explanation_encrypted_id); return { id: row.id, status: "resolved", reasonCode, resolvedAt: nowAt }; });
    return apply.immediate();
  }

  function recordBenchmark(input = {}) {
    const cases = Array.isArray(input.cases) ? input.cases : []; const passed = cases.filter((item) => item.passed === true).length; const scopeLeaks = cases.filter((item) => Number(item.scopeLeaks || 0) > 0).length; const privacyFailures = cases.filter((item) => item.privacySafe === false).length; const deletionFailures = cases.filter((item) => item.deletionCorrect === false).length; const p95 = quantile(cases.map((item) => Math.max(0, Number(item.latencyMs) || 0)), 0.95); const ok = passed === cases.length && scopeLeaks === 0 && privacyFailures === 0 && deletionFailures === 0 && p95 <= Number(input.maxP95Ms || 250); const id = String(input.id || crypto.randomUUID()); const apply = db.transaction(() => { const resultId = encrypt("owner:local", "shadow-benchmark-result", { cases, maxP95Ms: Number(input.maxP95Ms || 250) }, "restricted"); db.prepare("INSERT INTO shadow_benchmark_runs(id,session_id,suite,corpus_version,case_count,passed_count,scope_leaks,privacy_failures,deletion_failures,p95_latency_ms,result_encrypted_id,passed,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, String(input.sessionId), String(input.suite || "memory-vnext"), String(input.corpusVersion || "v1"), cases.length, passed, scopeLeaks, privacyFailures, deletionFailures, p95, resultId, ok ? 1 : 0, now()); return { id, passed: ok, caseCount: cases.length, passedCount: passed, scopeLeaks, privacyFailures, deletionFailures, p95LatencyMs: p95 }; }); return apply.immediate();
  }

  function recordRollbackRehearsal(input = {}) { if (!CUTOVER_DOMAINS.includes(String(input.domain))) throw new Error("Rollback rehearsal domain is unsupported."); const receipt = { id: String(input.id || crypto.randomUUID()), sessionId: String(input.sessionId), domain: String(input.domain), forwardState: String(input.forwardState || "vnext"), rollbackState: String(input.rollbackState || "legacy"), passed: input.passed === true }; const apply = db.transaction(() => { const replayId = encrypt("owner:local", "shadow-rollback-replay-export", input.replayExport || {}, "restricted"); const receiptMac = sign(receipt, "shadow-rollback-rehearsal:v1"); db.prepare("INSERT INTO shadow_rollback_rehearsals(id,session_id,domain,forward_state,rollback_state,replay_export_encrypted_id,passed,receipt_mac,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,domain) DO UPDATE SET forward_state=excluded.forward_state,rollback_state=excluded.rollback_state,replay_export_encrypted_id=excluded.replay_export_encrypted_id,passed=excluded.passed,receipt_mac=excluded.receipt_mac,created_at=excluded.created_at").run(receipt.id, receipt.sessionId, receipt.domain, receipt.forwardState, receipt.rollbackState, replayId, receipt.passed ? 1 : 0, receiptMac, now()); return { ...receipt, receiptMac }; }); return apply.immediate(); }

  function evaluateGate(input = {}) {
    const session = db.prepare("SELECT * FROM shadow_sessions WHERE id=?").get(String(input.sessionId)); if (!session) throw new Error("Shadow session is unavailable."); const importPassed = db.prepare("SELECT passed FROM import_reconciliation_receipts WHERE run_id=?").get(session.import_run_id)?.passed === 1; const severe = db.prepare("SELECT severity,COUNT(*) AS count FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=? AND c.status='open' AND c.severity IN ('critical','high') GROUP BY severity").all(session.id); const severeMap = Object.fromEntries(severe.map((row) => [row.severity, Number(row.count)])); const failures = db.prepare("SELECT COALESCE(SUM(scope_leaks),0) AS scope_leaks,COALESCE(SUM(deletion_failures),0) AS deletion_failures,COALESCE(SUM(privacy_failures),0) AS privacy_failures,COALESCE(MAX(p95_latency_ms),0) AS p95 FROM shadow_benchmark_runs WHERE session_id=?").get(session.id); const rehearsed = new Set(db.prepare("SELECT domain FROM shadow_rollback_rehearsals WHERE session_id=? AND passed=1").all(session.id).map((row) => row.domain)); const soakComplete = clock().getTime() >= new Date(session.required_until).getTime(); const projectionCoverage = Math.max(0, Math.min(1, Number(input.projectionCoverage) || 0)); const restorePassed = input.restorePassed === true; const rollbackPassed = CUTOVER_DOMAINS.every((domain) => rehearsed.has(domain)); const p95 = Number(failures.p95 || 0); const threshold = Number(input.maxP95Ms || 250); const passed = importPassed && soakComplete && Number(severeMap.critical || 0) === 0 && Number(severeMap.high || 0) === 0 && Number(failures.scope_leaks || 0) === 0 && Number(failures.deletion_failures || 0) === 0 && Number(failures.privacy_failures || 0) === 0 && projectionCoverage === 1 && restorePassed && rollbackPassed && p95 <= threshold && db.prepare("SELECT COUNT(*) AS count FROM shadow_benchmark_runs WHERE session_id=? AND passed=1").get(session.id).count > 0;
    const id = String(input.id || crypto.randomUUID()); const metrics = { importPassed, soakComplete, privacyFailures: Number(failures.privacy_failures || 0), p95LatencyMs: p95, maxP95Ms: threshold, rehearsedDomains: [...rehearsed].sort(), duplicateProviderCalls: 0 }; const receipt = { id, sessionId: session.id, passed, ...metrics };
    const apply = db.transaction(() => { const metricsId = encrypt("owner:local", "shadow-gate-metrics", metrics, "restricted"); const receiptMac = sign(receipt, "shadow-gate:v1"); db.prepare(`INSERT INTO shadow_gate_windows(id,session_id,window_start,window_end,metrics_encrypted_id,unresolved_critical,unresolved_high,scope_leaks,deletion_failures,projection_coverage,restore_passed,rollback_passed,p95_latency_ms,passed,receipt_mac,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET id=excluded.id,window_start=excluded.window_start,window_end=excluded.window_end,metrics_encrypted_id=excluded.metrics_encrypted_id,unresolved_critical=excluded.unresolved_critical,unresolved_high=excluded.unresolved_high,scope_leaks=excluded.scope_leaks,deletion_failures=excluded.deletion_failures,projection_coverage=excluded.projection_coverage,restore_passed=excluded.restore_passed,rollback_passed=excluded.rollback_passed,p95_latency_ms=excluded.p95_latency_ms,passed=excluded.passed,receipt_mac=excluded.receipt_mac,created_at=excluded.created_at`).run(id, session.id, session.started_at, session.required_until, metricsId, Number(severeMap.critical || 0), Number(severeMap.high || 0), Number(failures.scope_leaks || 0), Number(failures.deletion_failures || 0), projectionCoverage, restorePassed ? 1 : 0, rollbackPassed ? 1 : 0, p95, passed ? 1 : 0, receiptMac, now()); db.prepare("UPDATE shadow_sessions SET status=?,completed_at=? WHERE id=?").run(passed ? "passed" : "evaluating", passed ? now() : null, session.id); faultInjector("shadow.gate.before_commit"); return { ...receipt, receiptMac }; }); return apply.immediate();
  }

  function inspectSession(sessionId) { const session = db.prepare("SELECT * FROM shadow_sessions WHERE id=?").get(String(sessionId)); if (!session) return null; return { session, intents: db.prepare("SELECT id,ledger_event_id,idempotency_key,command_type,scope_id,legacy_receipt_ref,vnext_replay_ref,replay_status,created_at FROM shadow_intents WHERE session_id=? ORDER BY created_at,id").all(session.id), comparisons: db.prepare("SELECT c.id,c.query_run_id,c.metrics_json,c.classification,c.severity,c.status,c.created_at FROM shadow_comparisons c JOIN shadow_query_runs q ON q.id=c.query_run_id WHERE q.session_id=? ORDER BY c.created_at,c.id").all(session.id), benchmarks: db.prepare("SELECT id,suite,corpus_version,case_count,passed_count,scope_leaks,privacy_failures,deletion_failures,p95_latency_ms,passed,created_at FROM shadow_benchmark_runs WHERE session_id=? ORDER BY created_at,id").all(session.id), rehearsals: db.prepare("SELECT id,domain,forward_state,rollback_state,passed,created_at FROM shadow_rollback_rehearsals WHERE session_id=? ORDER BY domain").all(session.id), gate: db.prepare("SELECT id,window_start,window_end,unresolved_critical,unresolved_high,scope_leaks,deletion_failures,projection_coverage,restore_passed,rollback_passed,p95_latency_ms,passed,created_at FROM shadow_gate_windows WHERE session_id=?").get(session.id) || null }; }

  // An operator abandoning a soak window and starting a fresh one. 'cancelled' is already a
  // terminal status the active-session lookup ignores, so the runtime opens a new session on
  // next start. Evidence rows stay attached to the cancelled session and are never rewritten —
  // a soak is superseded, not erased.
  function cancelSession(input = {}) {
    const session = db.prepare("SELECT id,status FROM shadow_sessions WHERE id=?").get(String(input.sessionId));
    if (!session) throw new Error("Shadow session is unavailable.");
    if (!["capturing", "evaluating"].includes(session.status)) throw new Error("Only a live shadow session can be cancelled.");
    const reasonCode = String(input.reasonCode || "").trim();
    if (!reasonCode) throw new Error("Cancelling a soak requires a reason code.");
    const apply = db.transaction(() => {
      db.prepare("UPDATE shadow_sessions SET status='cancelled',completed_at=? WHERE id=?").run(now(), session.id);
      return { id: session.id, status: "cancelled", reasonCode };
    });
    return apply.immediate();
  }

  return Object.freeze({ captureIntent, compare, cancelSession, createSession, evaluateGate, inspectSession, markIntentReplayed, recordBenchmark, recordRollbackRehearsal, resolveComparison });
}

module.exports = { CUTOVER_DOMAINS, createShadowEvaluationRepository };
