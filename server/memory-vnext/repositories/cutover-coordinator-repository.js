"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");
const { canonical } = require("../import-adapters");
const { CUTOVER_DOMAINS } = require("./shadow-evaluation-repository");

const ACCEPTANCE_CASES = Object.freeze(["remember_correct_forget", "cross_session_recall", "branch_isolation", "scope_isolation", "temporal_correction", "protected_memory_consent", "task_resume", "artifact_retrieval", "helix_manifest", "apex_forge_manifest", "eclipse_capability_recall", "mesh_revocation", "offline_restart_restore", "rollback_no_loss"]);

function createCutoverCoordinatorRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 30) throw new Error("Progressive cutover requires schema version 30.");
  const now = () => clock().toISOString();
  const encrypt = (scopeId, type, payload, sensitivity = "restricted") => insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id;
  const sign = (value, purpose) => keyring.sign(JSON.stringify(canonical(value)), purpose);
  const requireOwner = (actorId, zone) => { const actor = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(actorId)); if (!actor || actor.actor_type !== "owner" || actor.status !== "active" || zone !== "owner") throw Object.assign(new Error("Direct owner authority is required."), { code: "OWNER_AUTHORITY_REQUIRED" }); };

  // ── Store-backed cutover gates (A-06) ────────────────────────────────────────
  // Every one of these answers its question with a SELECT. None of them can be satisfied by
  // anything in the request body.

  // The plan's own shadow gate must still be passing, and its failure counters must still be
  // zero. `createPlan` checks `passed` once at planning time; a domain can be activated days
  // later, and the row it is activated against is the one that must be clean.
  function verifyGateWindow(plan) {
    const gate = db.prepare("SELECT passed,unresolved_critical,scope_leaks,deletion_failures,restore_passed,rollback_passed FROM shadow_gate_windows WHERE session_id=?").get(plan.shadow_session_id);
    if (!gate) throw Object.assign(new Error("No shadow gate window exists for this plan's session."), { code: "CUTOVER_DOMAIN_GATE_REQUIRED" });
    const faults = [];
    if (gate.passed !== 1) faults.push("gate not passed");
    if (gate.unresolved_critical > 0) faults.push(`${gate.unresolved_critical} unresolved critical`);
    if (gate.scope_leaks > 0) faults.push(`${gate.scope_leaks} scope leaks`);
    if (gate.deletion_failures > 0) faults.push(`${gate.deletion_failures} deletion failures`);
    if (gate.restore_passed !== 1) faults.push("restore not proven");
    if (gate.rollback_passed !== 1) faults.push("rollback not proven");
    if (faults.length) throw Object.assign(new Error(`Shadow gate does not support activation: ${faults.join(", ")}.`), { code: "CUTOVER_DOMAIN_GATE_REQUIRED" });
  }

  // "Cache purged" means no live cache entry can still serve a pre-cutover answer. A surviving
  // active entry is exactly the stale read the gate exists to prevent.
  function verifyCachePurged() {
    const live = Number(db.prepare("SELECT COUNT(*) AS count FROM cache_entries WHERE status='active'").get().count);
    if (live > 0) throw Object.assign(new Error(`Retrieval cutover requires a purged cache; ${live} active cache entries remain.`), { code: "CUTOVER_RETRIEVAL_INVALIDATION_REQUIRED" });
  }

  // "Projection verified" means there is an active projection to retrieve from, and — when the
  // caller names a version — that the active one is the version being activated. Without this,
  // retrieval could cut over to a projection that is still building or has failed.
  function verifyProjection(requestedVersion) {
    const active = db.prepare("SELECT projection_version FROM retrieval_projections WHERE state='active'").get();
    if (!active) throw Object.assign(new Error("Retrieval cutover requires an active projection; none is active."), { code: "CUTOVER_RETRIEVAL_INVALIDATION_REQUIRED" });
    if (requestedVersion && String(requestedVersion) !== active.projection_version) throw Object.assign(new Error(`Requested projection ${requestedVersion} is not the active projection (${active.projection_version}).`), { code: "CUTOVER_RETRIEVAL_INVALIDATION_REQUIRED" });
  }

  // "Manifests verified" means the rooms actually have current manifests to read. Activating this
  // domain against an empty manifest table points every room at nothing.
  function verifyRoomManifests() {
    const current = Number(db.prepare("SELECT COUNT(*) AS count FROM room_manifests WHERE state='current'").get().count);
    if (current < 1) throw Object.assign(new Error("Room integration cutover requires at least one current room manifest; none exist."), { code: "CUTOVER_ROOM_MANIFESTS_REQUIRED" });
  }

  // An acceptance case is only "passed" if its evidence resolves to something stored. Without
  // this, `passed` was the caller's own word and `evidenceRef` was a string nobody ever read.
  function evidenceResolves(ref) {
    if (!ref) return false;
    const id = String(ref);
    return Boolean(
      db.prepare("SELECT 1 FROM encrypted_objects WHERE id=? LIMIT 1").get(id)
      || db.prepare("SELECT 1 FROM ledger_events WHERE event_id=? LIMIT 1").get(id),
    );
  }

  function createPlan(input = {}) {
    const session = db.prepare("SELECT status FROM shadow_sessions WHERE id=?").get(String(input.shadowSessionId)); const gate = db.prepare("SELECT passed FROM shadow_gate_windows WHERE session_id=?").get(String(input.shadowSessionId)); if (session?.status !== "passed" || gate?.passed !== 1) throw Object.assign(new Error("A passed shadow gate is required before cutover planning."), { code: "CUTOVER_GATE_REQUIRED" });
    const createdAt = clock(); const rollbackEnd = new Date(input.rollbackWindowEndsAt || createdAt.getTime() + 30 * 86400000); const retentionUntil = new Date(input.retentionUntil || createdAt.getTime() + 90 * 86400000); if (rollbackEnd <= createdAt) throw new Error("Rollback window must be in the future."); if (retentionUntil.getTime() - createdAt.getTime() < 90 * 86400000) throw Object.assign(new Error("Legacy snapshot retention must be at least 90 days."), { code: "LEGACY_RETENTION_TOO_SHORT" }); const id = String(input.id || crypto.randomUUID()); const run = db.transaction(() => { db.prepare("INSERT INTO cutover_plans(id,shadow_session_id,plan_version,domain_order_json,rollback_window_ends_at,retention_until,status,created_at) VALUES(?,?,?,?,?,?,'draft',?)").run(id, String(input.shadowSessionId), String(input.planVersion || "wave32-v1"), JSON.stringify(CUTOVER_DOMAINS), rollbackEnd.toISOString(), retentionUntil.toISOString(), createdAt.toISOString()); for (const domain of CUTOVER_DOMAINS) db.prepare("INSERT INTO cutover_domain_states(plan_id,domain,authority,state,fallback_enabled,updated_at) VALUES(?,?,'legacy','pending',1,?)").run(id, domain, createdAt.toISOString()); return { id, status: "draft", domainOrder: [...CUTOVER_DOMAINS], rollbackWindowEndsAt: rollbackEnd.toISOString(), retentionUntil: retentionUntil.toISOString() }; }); return run.immediate();
  }

  function approvePlan(input = {}) { requireOwner(input.actorId, input.authorityZone); const plan = db.prepare("SELECT * FROM cutover_plans WHERE id=? AND status='draft'").get(String(input.planId)); if (!plan) throw new Error("Draft cutover plan is unavailable."); const receipt = { planId: plan.id, actorId: String(input.actorId), planVersion: plan.plan_version, approvedAt: now() }; const receiptMac = sign(receipt, "cutover-plan-approval:v1"); db.prepare("UPDATE cutover_plans SET status='approved',approved_by=?,approval_receipt_mac=?,approved_at=? WHERE id=?").run(receipt.actorId, receiptMac, receipt.approvedAt, plan.id); return { ...receipt, receiptMac, status: "approved" }; }

  function activateDomain(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const plan = db.prepare("SELECT * FROM cutover_plans WHERE id=?").get(String(input.planId)); if (!plan || !["approved", "active"].includes(plan.status)) throw new Error("Approved active cutover plan is required."); const domain = String(input.domain); const index = CUTOVER_DOMAINS.indexOf(domain); if (index < 0) throw new Error("Cutover domain is unsupported."); const state = db.prepare("SELECT * FROM cutover_domain_states WHERE plan_id=? AND domain=?").get(plan.id, domain);
    // A-15 — unguarded `.authority` on a `.get()` that returns undefined when a plan predates a
    // CUTOVER_DOMAINS addition or its rows were partially written; the very next block already
    // uses `predecessor?.authority`. A raw TypeError surfaced as a 500 from the activate route.
    if (!state) throw Object.assign(new Error(`Cutover plan has no state row for domain ${domain}.`), { code: "CUTOVER_DOMAIN_STATE_MISSING" });
    if (state.authority === "vnext") return { planId: plan.id, domain, authority: "vnext", replayed: true };
    for (const earlier of CUTOVER_DOMAINS.slice(0, index)) { const predecessor = db.prepare("SELECT authority,state FROM cutover_domain_states WHERE plan_id=? AND domain=?").get(plan.id, earlier); if (predecessor?.authority !== "vnext" || predecessor?.state !== "primary") throw Object.assign(new Error(`Cutover predecessor ${earlier} is not primary.`), { code: "CUTOVER_ORDER_VIOLATION" }); }
    // Each of these gates used to be a boolean the HTTP caller supplied about itself, on a route
    // spread as `activateDomain({ ...owner, ...body })` — so a POST body of
    // `{"gatePassed":true,"cachePurged":true,"projectionVerified":true,"roomManifestsVerified":true}`
    // satisfied all of them and handed vNext authority over a domain that had verified nothing.
    // The caller's assertion is still required — an operator must intend the activation — but it
    // is now the weaker of two conditions: the store has to agree.
    if (input.gatePassed !== true) throw Object.assign(new Error("A fresh domain gate snapshot is required."), { code: "CUTOVER_DOMAIN_GATE_REQUIRED" });
    verifyGateWindow(plan);
    if (domain === "retrieval_context") {
      if (input.cachePurged !== true || input.projectionVerified !== true) throw Object.assign(new Error("Retrieval cutover requires cache purge and projection verification."), { code: "CUTOVER_RETRIEVAL_INVALIDATION_REQUIRED" });
      verifyCachePurged();
      verifyProjection(input.projectionVersion);
    }
    if (domain === "room_integrations") {
      if (input.roomManifestsVerified !== true) throw Object.assign(new Error("Room integration cutover requires verified manifests."), { code: "CUTOVER_ROOM_MANIFESTS_REQUIRED" });
      verifyRoomManifests();
    }
    const transitionId = String(input.id || crypto.randomUUID()); const sequence = Number(db.prepare("SELECT COALESCE(MAX(activation_sequence),0)+1 AS value FROM cutover_domain_states WHERE plan_id=?").get(plan.id).value); const receipt = { transitionId, planId: plan.id, domain, fromAuthority: "legacy", toAuthority: "vnext", sequence, fallbackEnabled: true, gateHash: crypto.createHash("sha256").update(JSON.stringify(canonical(input.gateSnapshot || {}))).digest("hex") };
    const run = db.transaction(() => { const gateId = encrypt("owner:local", "cutover-domain-gate-snapshot", { ...input.gateSnapshot, cachePurged: input.cachePurged === true, projectionVerified: input.projectionVerified === true, roomManifestsVerified: input.roomManifestsVerified === true }); const receiptMac = sign(receipt, "cutover-transition:v1"); db.prepare("INSERT INTO cutover_transitions(id,plan_id,domain,from_authority,to_authority,gate_snapshot_encrypted_id,actor_id,receipt_mac,created_at) VALUES(?,?,?,'legacy','vnext',?,?,?,?)").run(transitionId, plan.id, domain, gateId, String(input.actorId), receiptMac, now()); db.prepare("UPDATE cutover_domain_states SET authority='vnext',state='primary',fallback_enabled=1,activation_sequence=?,projection_version=?,updated_at=? WHERE plan_id=? AND domain=?").run(sequence, input.projectionVersion ? String(input.projectionVersion) : null, now(), plan.id, domain); db.prepare("UPDATE cutover_plans SET status='active' WHERE id=?").run(plan.id); faultInjector("cutover.activate.before_commit"); return { ...receipt, receiptMac, authority: "vnext", state: "primary", replayed: false }; }); return run.immediate();
  }

  function registerArchive(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const plan = db.prepare("SELECT * FROM cutover_plans WHERE id=?").get(String(input.planId)); if (!plan) throw new Error("Cutover plan is unavailable."); if (input.closedSnapshotVerified !== true || input.readOnlyVerified !== true) throw Object.assign(new Error("Only a verified closed read-only snapshot may be archived."), { code: "LEGACY_ARCHIVE_NOT_VERIFIED" }); const declared = db.prepare(`SELECT 1 FROM import_sources source JOIN shadow_sessions session ON session.import_run_id=source.run_id WHERE session.id=? AND source.source_key=? AND source.snapshot_sha256=? LIMIT 1`).get(plan.shadow_session_id, String(input.sourceKey), String(input.snapshotSha256)); if (!declared) throw Object.assign(new Error("Archive snapshot was not part of the reconciled import set."), { code: "LEGACY_ARCHIVE_NOT_DECLARED" }); const retention = new Date(input.retentionUntil || plan.retention_until); if (retention < new Date(plan.retention_until) || retention.getTime() - clock().getTime() < 90 * 86400000) throw Object.assign(new Error("Archive retention is shorter than the cutover retention floor."), { code: "LEGACY_RETENTION_TOO_SHORT" }); const id = String(input.id || crypto.randomUUID()); const receipt = { id, planId: plan.id, sourceKey: String(input.sourceKey), snapshotSha256: String(input.snapshotSha256), retentionUntil: retention.toISOString(), readOnlyVerified: true, state: "sealed" }; const run = db.transaction(() => { const pathId = encrypt("owner:local", "legacy-archive-path", { path: String(input.snapshotPath) }); const receiptMac = sign(receipt, "legacy-archive:v1"); db.prepare("INSERT INTO legacy_archive_registry(id,plan_id,source_key,snapshot_sha256,snapshot_path_encrypted_id,read_only_verified,retention_until,state,receipt_mac,created_at) VALUES(?,?,?,?,?,1,?,'sealed',?,?)").run(id, plan.id, receipt.sourceKey, receipt.snapshotSha256, pathId, receipt.retentionUntil, receiptMac, now()); faultInjector("cutover.archive.before_commit"); return { ...receipt, receiptMac }; }); return run.immediate();
  }

  function rollbackDomain(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const plan = db.prepare("SELECT * FROM cutover_plans WHERE id=?").get(String(input.planId)); if (!plan || clock().getTime() > new Date(plan.rollback_window_ends_at).getTime()) throw Object.assign(new Error("Cutover rollback window is closed."), { code: "CUTOVER_ROLLBACK_WINDOW_CLOSED" }); const domain = String(input.domain); const state = db.prepare("SELECT * FROM cutover_domain_states WHERE plan_id=? AND domain=?").get(plan.id, domain); if (state?.authority !== "vnext") throw new Error("Domain is not currently using vNext authority."); const transition = db.prepare("SELECT id FROM cutover_transitions WHERE plan_id=? AND domain=? AND to_authority='vnext' ORDER BY created_at DESC,id DESC LIMIT 1").get(plan.id, domain); const id = String(input.id || crypto.randomUUID()); const postCutoverRefs = Array.isArray(input.postCutoverEventRefs) ? input.postCutoverEventRefs.map(String) : []; const receipt = { id, planId: plan.id, domain, transitionId: transition.id, reasonCode: String(input.reasonCode || "OWNER_ROLLBACK"), exportedEventCount: postCutoverRefs.length, legacyMutationCount: 0 };
    const rollbackDomains = CUTOVER_DOMAINS.slice(CUTOVER_DOMAINS.indexOf(domain)).filter((candidate) => db.prepare("SELECT authority FROM cutover_domain_states WHERE plan_id=? AND domain=?").get(plan.id, candidate)?.authority === "vnext"); const run = db.transaction(() => { const exportId = encrypt("owner:local", "cutover-post-vnext-replay-export", { domain, rollbackDomains, eventRefs: postCutoverRefs }, "restricted"); const receiptMac = sign({ ...receipt, rollbackDomains }, "cutover-rollback:v1"); db.prepare("INSERT INTO cutover_rollbacks(id,plan_id,domain,transition_id,replay_export_encrypted_id,actor_id,reason_code,receipt_mac,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id, plan.id, domain, transition.id, exportId, String(input.actorId), receipt.reasonCode, receiptMac, now()); for (const rollbackDomain of rollbackDomains) db.prepare("UPDATE cutover_domain_states SET authority='legacy',state='rolled_back',fallback_enabled=1,updated_at=? WHERE plan_id=? AND domain=?").run(now(), plan.id, rollbackDomain); // A-11 — this ran unconditionally, so rolling back the LAST domain marked the whole plan
      // `rolled_back` while earlier domains were still vnext/primary. After that,
      // `activateDomain` and `completeAndHandoff` both refuse (they require approved/active)
      // and `authority-repository`'s LIVE_PLAN_STATUSES stops recognising the plan — so the
      // still-primary domains silently read as legacy at runtime while their
      // `cutover_domain_states` rows still say vnext/primary, and the only recovery is a whole
      // new plan. The plan is only rolled back when nothing is left on vNext.
      const stillPrimary = Number(db.prepare("SELECT COUNT(*) AS count FROM cutover_domain_states WHERE plan_id=? AND authority='vnext' AND state='primary'").get(plan.id).count);
      db.prepare("UPDATE cutover_plans SET status=? WHERE id=?").run(stillPrimary > 0 ? 'active' : 'rolled_back', plan.id); faultInjector("cutover.rollback.before_commit"); return { ...receipt, rollbackDomains, receiptMac, authority: "legacy" }; }); return run.immediate();
  }

  function recordOwnerAcceptance(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const results = Array.isArray(input.results) ? input.results : []; const byCase = new Map(results.map((result) => [String(result.case), result])); // `passed` was the caller's own word and `evidenceRef` was a string nobody ever read, so a
    // POST of fourteen `{passed:true}` objects produced the passing acceptance run that
    // `completeAndHandoff` gates on. A case now counts as passed only if its evidence resolves
    // to a stored object; unresolvable evidence is reported rather than silently dropped.
    const normalized = ACCEPTANCE_CASES.map((name) => { const entry = byCase.get(name); const claimed = entry?.passed === true; const evidenceRef = entry?.evidenceRef || null; const proven = claimed && evidenceResolves(evidenceRef); return { case: name, passed: proven, evidenceRef, ...(claimed && !proven ? { rejected: evidenceRef ? "evidence_ref_not_found" : "evidence_ref_missing" } : {}) }; }); const passedCount = normalized.filter((result) => result.passed).length; const passed = passedCount === ACCEPTANCE_CASES.length; const id = String(input.id || crypto.randomUUID()); const receipt = { id, planId: String(input.planId), suiteVersion: String(input.suiteVersion || "wave32-v1"), requiredCount: ACCEPTANCE_CASES.length, passedCount, failedCount: ACCEPTANCE_CASES.length - passedCount, passed, actorId: String(input.actorId) }; const run = db.transaction(() => { const resultsId = encrypt("owner:local", "owner-acceptance-results", normalized); const receiptMac = sign(receipt, "owner-acceptance:v1"); db.prepare("INSERT INTO owner_acceptance_runs(id,plan_id,suite_version,results_encrypted_id,required_count,passed_count,failed_count,passed,accepted_by,receipt_mac,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, receipt.planId, receipt.suiteVersion, resultsId, receipt.requiredCount, passedCount, receipt.failedCount, passed ? 1 : 0, receipt.actorId, receiptMac, now()); return { ...receipt, receiptMac, results: normalized }; }); return run.immediate();
  }

  function completeAndHandoff(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const plan = db.prepare("SELECT * FROM cutover_plans WHERE id=? AND status='active'").get(String(input.planId)); if (!plan) throw new Error("Active cutover plan is required."); const primary = Number(db.prepare("SELECT COUNT(*) AS count FROM cutover_domain_states WHERE plan_id=? AND authority='vnext' AND state='primary'").get(plan.id).count); const acceptance = db.prepare("SELECT id FROM owner_acceptance_runs WHERE plan_id=? AND passed=1 ORDER BY created_at DESC LIMIT 1").get(plan.id); const archives = Number(db.prepare("SELECT COUNT(*) AS count FROM legacy_archive_registry WHERE plan_id=? AND state='sealed' AND read_only_verified=1").get(plan.id).count); const expectedArchives = Number(db.prepare(`SELECT COUNT(*) AS count FROM (SELECT DISTINCT source.source_key,source.snapshot_sha256 FROM import_sources source JOIN shadow_sessions session ON session.import_run_id=source.run_id WHERE session.id=?)`).get(plan.shadow_session_id).count); const rehearsals = Number(db.prepare("SELECT COUNT(DISTINCT domain) AS count FROM shadow_rollback_rehearsals WHERE session_id=? AND passed=1").get(plan.shadow_session_id).count); if (primary !== CUTOVER_DOMAINS.length || !acceptance || archives !== expectedArchives || expectedArchives < 1 || rehearsals !== CUTOVER_DOMAINS.length) throw Object.assign(new Error("Cutover completion gates are incomplete."), { code: "CUTOVER_COMPLETION_GATES_INCOMPLETE" }); if (!input.memoryContractVersion || !input.frozenPlanHash) throw new Error("Memory contract version and frozen model-plan hash are required."); const id = String(input.id || crypto.randomUUID()); const receipt = { id, planId: plan.id, memoryContractVersion: String(input.memoryContractVersion), frozenPlanHash: String(input.frozenPlanHash), acceptanceRunId: acceptance.id, archiveCount: archives, domains: CUTOVER_DOMAINS };
    const run = db.transaction(() => { const handoffId = encrypt("owner:local", "model-plan-memory-handoff", { ...input.handoff, receipt }, "restricted"); const receiptMac = sign(receipt, "model-plan-handoff:v1"); db.prepare("INSERT INTO model_plan_handoffs(id,plan_id,memory_contract_version,frozen_plan_hash,handoff_encrypted_id,receipt_mac,created_at) VALUES(?,?,?,?,?,?,?)").run(id, plan.id, receipt.memoryContractVersion, receipt.frozenPlanHash, handoffId, receiptMac, now()); db.prepare("UPDATE cutover_plans SET status='complete',completed_at=? WHERE id=?").run(now(), plan.id); faultInjector("cutover.complete.before_commit"); return { ...receipt, receiptMac, status: "complete" }; }); return run.immediate();
  }

  function authorityState(planId) { const plan = db.prepare("SELECT id,status,rollback_window_ends_at,retention_until,created_at,approved_at,completed_at FROM cutover_plans WHERE id=?").get(String(planId)); if (!plan) return null; return { plan, domains: db.prepare("SELECT domain,authority,state,fallback_enabled,activation_sequence,projection_version,updated_at FROM cutover_domain_states WHERE plan_id=? ORDER BY CASE domain WHEN 'explicit_commands' THEN 1 WHEN 'conversation_runtime' THEN 2 WHEN 'retrieval_context' THEN 3 ELSE 4 END").all(plan.id), archives: db.prepare("SELECT id,source_key,snapshot_sha256,read_only_verified,retention_until,state,created_at FROM legacy_archive_registry WHERE plan_id=? ORDER BY source_key").all(plan.id), rollbacks: db.prepare("SELECT id,domain,transition_id,reason_code,created_at FROM cutover_rollbacks WHERE plan_id=? ORDER BY created_at,id").all(plan.id), acceptance: db.prepare("SELECT id,suite_version,required_count,passed_count,failed_count,passed,created_at FROM owner_acceptance_runs WHERE plan_id=? ORDER BY created_at DESC LIMIT 1").get(plan.id) || null, handoff: db.prepare("SELECT id,memory_contract_version,frozen_plan_hash,created_at FROM model_plan_handoffs WHERE plan_id=?").get(plan.id) || null }; }
  return Object.freeze({ ACCEPTANCE_CASES, activateDomain, approvePlan, authorityState, completeAndHandoff, createPlan, recordOwnerAcceptance, registerArchive, rollbackDomain });
}

module.exports = { ACCEPTANCE_CASES, createCutoverCoordinatorRepository };
