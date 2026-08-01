"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");
const { requireStructuralRef } = require("./assertion-repository");

function createPersonalMemoryRepository({ db, keyring, clock, faultInjector }) {
  const schemaVersion = Number(db.pragma("user_version", { simple: true }));
  if (schemaVersion < 11) throw new Error("Personal memory domains require schema version 11.");

  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function decrypt(id) {
    if (!id) return null;
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id); if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }
  function requireOwner(actorId, authorityZone) {
    const row = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(actorId));
    if (!row || row.status !== "active" || row.actor_type !== "owner" || String(authorityZone) !== "owner") throw Object.assign(new Error("Protected personal memory requires direct owner authority on a trusted owner surface."), { code: "OWNER_AUTHORITY_REQUIRED" });
    return String(actorId);
  }
  function activeActor(actorId) { const row = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(actorId)); if (!row || row.status !== "active") throw new Error("Personal-memory actor is unavailable."); return row; }
  function verifyOwnerAssertion(assertionId, scopeId, predicate, value) {
    const row = db.prepare(`SELECT a.id,a.scope_id,a.subject_type,a.predicate,v.epistemic_state,v.object_encrypted_id FROM assertions a JOIN assertion_versions v ON v.assertion_id=a.id
      WHERE a.id=? AND v.recorded_to IS NULL`).get(String(assertionId));
    if (!row || row.scope_id !== scopeId || row.subject_type !== "owner" || row.predicate !== predicate || row.epistemic_state !== "owner_asserted") throw new Error("Identity requires a matching current owner-asserted assertion.");
    if (JSON.stringify(decrypt(row.object_encrypted_id)) !== JSON.stringify(value)) throw new Error("Identity value must exactly match its owner-asserted evidence.");
  }

  function setIdentity(input = {}) {
    const scopeId = String(input.scopeId || ""); const predicate = requireStructuralRef(input.predicate, "Identity predicate", /^[a-z][a-z0-9_.-]{0,127}$/); const actorId = requireOwner(input.actorId || "local-owner", input.authorityZone);
    if (!scopeId || !predicate || input.value === undefined || !input.assertionId) throw new Error("Identity scope, predicate, value, and assertion are required.");
    verifyOwnerAssertion(input.assertionId, scopeId, predicate, input.value);
    const run = db.transaction(() => {
      const now = clock().toISOString();
      db.prepare("UPDATE identity_attributes SET status='superseded',updated_at=? WHERE scope_id=? AND owner_actor_id=? AND predicate=? AND status='active'").run(now, scopeId, actorId, predicate);
      const id = String(input.id || crypto.randomUUID()); const valueId = encrypt(scopeId, "identity-attribute", { value: input.value }, String(input.sensitivity || "private"));
      db.prepare(`INSERT INTO identity_attributes(id,scope_id,owner_actor_id,predicate,value_encrypted_id,assertion_id,protected,status,created_by,authority_zone,created_at,updated_at)
        VALUES(?,?,?,?,?,?,1,'active',?,'owner',?,?)`).run(id, scopeId, actorId, predicate, valueId, String(input.assertionId), actorId, now, now);
      if (schemaVersion >= 12) db.prepare("INSERT OR IGNORE INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,'derived_from','active',?,NULL)")
        .run(crypto.randomUUID(), scopeId, "assertion", String(input.assertionId), "identity", id, now);
      faultInjector("personal.identity.before_commit");
      return readIdentity(id);
    });
    return run.immediate();
  }
  function readIdentity(id) {
    const row = db.prepare("SELECT * FROM identity_attributes WHERE id=?").get(String(id)); if (!row) throw new Error("Identity attribute is unavailable.");
    return { id: row.id, scopeId: row.scope_id, ownerActorId: row.owner_actor_id, predicate: row.predicate, value: decrypt(row.value_encrypted_id)?.value, assertionId: row.assertion_id, protected: Boolean(row.protected), status: row.status };
  }
  function activeIdentity(scopeId) { return db.prepare("SELECT id FROM identity_attributes WHERE scope_id=? AND status='active' ORDER BY predicate").all(String(scopeId)).map((row) => readIdentity(row.id)); }

  function setDirective(input = {}) {
    const scopeId = String(input.scopeId || ""); const key = requireStructuralRef(input.key, "Directive key", /^[a-z][a-z0-9_.-]{0,127}$/); const actorId = requireOwner(input.actorId || "local-owner", input.authorityZone);
    if (!scopeId || !key || !input.content) throw new Error("Directive scope, key, and content are required.");
    const run = db.transaction(() => {
      const now = clock().toISOString(); const prior = db.prepare("SELECT MAX(version) AS version FROM directives WHERE scope_id=? AND directive_key=?").get(scopeId, key);
      db.prepare("UPDATE directives SET status='superseded',closed_at=? WHERE scope_id=? AND directive_key=? AND status='active'").run(now, scopeId, key);
      const version = Number(prior.version || 0) + 1; const id = String(input.id || crypto.randomUUID());
      const contentId = encrypt(scopeId, "owner-directive", { content: String(input.content) }, String(input.sensitivity || "private"));
      db.prepare(`INSERT INTO directives(id,scope_id,directive_key,content_encrypted_id,version,protected,status,created_by,authority_zone,source_turn_id,created_at,closed_at)
        VALUES(?,?,?,?,?,1,'active',?,'owner',?,?,NULL)`).run(id, scopeId, key, contentId, version, actorId, input.sourceTurnId ? String(input.sourceTurnId) : null, now);
      faultInjector("personal.directive.before_commit");
      return readDirective(id);
    });
    return run.immediate();
  }
  function revokeDirective(input = {}) {
    const actorId = requireOwner(input.actorId || "local-owner", input.authorityZone); const now = clock().toISOString();
    const changed = db.prepare("UPDATE directives SET status='revoked',closed_at=? WHERE id=? AND status='active'").run(now, String(input.directiveId));
    if (changed.changes !== 1) throw new Error("Active directive is unavailable.");
    return { id: String(input.directiveId), status: "revoked", actorId };
  }
  function readDirective(id) {
    const row = db.prepare("SELECT * FROM directives WHERE id=?").get(String(id)); if (!row) throw new Error("Directive is unavailable.");
    return { id: row.id, scopeId: row.scope_id, key: row.directive_key, content: decrypt(row.content_encrypted_id)?.content, version: row.version, protected: Boolean(row.protected), status: row.status, createdBy: row.created_by };
  }
  function activeDirectives(scopeId) { return db.prepare("SELECT id FROM directives WHERE scope_id=? AND status='active' ORDER BY directive_key").all(String(scopeId)).map((row) => readDirective(row.id)); }

  function createPreference(input = {}) {
    const scopeId = String(input.scopeId || ""); const origin = String(input.origin || "inferred"); const createdBy = String(input.createdBy || "local-owner");
    if (!scopeId || !input.subjectRef || !input.domain || input.value === undefined) throw new Error("Preference scope, subject, domain, and value are required.");
    requireStructuralRef(input.subjectRef, "Preference subject"); requireStructuralRef(input.domain, "Preference domain", /^[a-z][a-z0-9_.-]{0,127}$/);
    activeActor(createdBy); let status = String(input.status || (origin === "explicit_owner" ? "active" : "candidate"));
    if (origin === "explicit_owner") requireOwner(createdBy, input.authorityZone);
    if (origin === "inferred") {
      status = "candidate";
      if (!input.evidenceId && !input.assertionVersionId) throw new Error("Inferred preference candidates require sourceable evidence.");
    }
    if (origin !== "explicit_owner") status = "candidate";
    const run = db.transaction(() => {
      const now = clock().toISOString(); const id = String(input.id || crypto.randomUUID());
      const conditionId = input.condition == null ? null : encrypt(scopeId, "preference-condition", input.condition);
      const valueId = encrypt(scopeId, "preference-value", { value: input.value }, String(input.sensitivity || "private"));
      const reviewAfter = input.reviewAfter ? String(input.reviewAfter) : origin === "inferred" ? new Date(clock().getTime() + 120 * 86400_000).toISOString() : null;
      db.prepare(`INSERT INTO preferences(id,scope_id,subject_ref,domain,condition_encrypted_id,value_encrypted_id,strength,origin,status,decay_half_life_days,last_reinforced_at,review_after,assertion_id,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, scopeId, String(input.subjectRef), String(input.domain), conditionId, valueId,
        Math.max(0, Math.min(1, Number(input.strength ?? (origin === "explicit_owner" ? 1 : 0.5)))), origin, status,
        input.decayHalfLifeDays == null ? (origin === "inferred" ? 120 : null) : Number(input.decayHalfLifeDays), now, reviewAfter,
        input.assertionId ? String(input.assertionId) : null, createdBy, now, now);
      if (input.evidenceId || input.assertionVersionId) addPreferenceEvidenceInternal(id, input, now);
      if (schemaVersion >= 12 && input.assertionId) db.prepare("INSERT OR IGNORE INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,'derived_from','active',?,NULL)")
        .run(crypto.randomUUID(), scopeId, "assertion", String(input.assertionId), "preference", id, now);
      faultInjector("personal.preference.before_commit");
      return readPreference(id);
    });
    return run.immediate();
  }
  function addPreferenceEvidenceInternal(preferenceId, input, now) {
    if (input.evidenceId && !db.prepare("SELECT id FROM evidence_units WHERE id=?").get(String(input.evidenceId))) throw new Error("Preference evidence is unavailable.");
    if (input.assertionVersionId && !db.prepare("SELECT id FROM assertion_versions WHERE id=?").get(String(input.assertionVersionId))) throw new Error("Preference assertion evidence is unavailable.");
    db.prepare("INSERT INTO preference_evidence(id,preference_id,evidence_id,assertion_version_id,effect,weight,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), preferenceId, input.evidenceId ? String(input.evidenceId) : null, input.assertionVersionId ? String(input.assertionVersionId) : null,
        String(input.effect || "reinforce"), Math.max(0.01, Math.min(1, Number(input.weight ?? 0.5))), now);
  }
  function reinforcePreference(input = {}) {
    const run = db.transaction(() => {
      const row = db.prepare("SELECT * FROM preferences WHERE id=? AND status IN ('candidate','active','review')").get(String(input.preferenceId)); if (!row) throw new Error("Preference is unavailable.");
      const now = clock().toISOString(); addPreferenceEvidenceInternal(row.id, input, now);
      const direction = ["weaken","correct"].includes(String(input.effect)) ? -1 : 1; const weight = Math.max(0.01, Math.min(1, Number(input.weight ?? 0.5)));
      const strength = Math.max(0, Math.min(1, row.strength + direction * weight * (direction > 0 ? 1 - row.strength : row.strength)));
      db.prepare("UPDATE preferences SET strength=?,last_reinforced_at=?,updated_at=? WHERE id=?").run(strength, now, now, row.id);
      return readPreference(row.id);
    });
    return run.immediate();
  }
  function promotePreference(input = {}) {
    requireOwner(input.actorId || "local-owner", input.authorityZone);
    const changed = db.prepare("UPDATE preferences SET status='active',updated_at=? WHERE id=? AND status IN ('candidate','review')").run(clock().toISOString(), String(input.preferenceId));
    if (changed.changes !== 1) throw new Error("Preference candidate is unavailable."); return readPreference(input.preferenceId);
  }
  function readPreference(id) {
    const row = db.prepare("SELECT * FROM preferences WHERE id=?").get(String(id)); if (!row) throw new Error("Preference is unavailable.");
    return { id: row.id, scopeId: row.scope_id, subjectRef: row.subject_ref, domain: row.domain, condition: decrypt(row.condition_encrypted_id), value: decrypt(row.value_encrypted_id)?.value,
      strength: row.strength, origin: row.origin, status: row.status, decayHalfLifeDays: row.decay_half_life_days, lastReinforcedAt: row.last_reinforced_at, reviewAfter: row.review_after };
  }
  function conditionMatches(condition, context) { return !condition || Object.entries(condition).every(([key, value]) => JSON.stringify(context?.[key]) === JSON.stringify(value)); }
  function effectivePreferences(input = {}) {
    const now = input.at ? new Date(input.at) : clock();
    return db.prepare("SELECT id FROM preferences WHERE scope_id=? AND subject_ref=? AND domain=? AND status='active'").all(String(input.scopeId), String(input.subjectRef), String(input.domain))
      .map((row) => readPreference(row.id)).filter((preference) => conditionMatches(preference.condition, input.context || {})).map((preference) => {
        const elapsedDays = Math.max(0, (now.getTime() - Date.parse(preference.lastReinforcedAt)) / 86400_000);
        const effectiveStrength = preference.decayHalfLifeDays ? preference.strength * (0.5 ** (elapsedDays / preference.decayHalfLifeDays)) : preference.strength;
        return { ...preference, effectiveStrength };
      }).sort((a, b) => b.effectiveStrength - a.effectiveStrength || a.id.localeCompare(b.id));
  }

  function addGoalEvent(goal, fromState, toState, actorId, payload, version, now) {
    const payloadId = encrypt(goal.scope_id, "goal-transition", payload || {});
    db.prepare("INSERT INTO goal_events(id,goal_id,from_state,to_state,state_version,payload_encrypted_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), goal.id, fromState, toState, version, payloadId, actorId, now);
  }
  function createGoal(input = {}) {
    const scopeId = String(input.scopeId || ""); const actorId = String(input.actorId || "local-owner"); if (!scopeId || !input.objective) throw new Error("Goal scope and objective are required.");
    const actorRow = activeActor(actorId); const requestedState = actorRow.actor_type === "owner" ? String(input.state || "proposed") : "proposed";
    const run = db.transaction(() => { const now = clock().toISOString(); const id = String(input.id || crypto.randomUUID());
      const objectiveId = encrypt(scopeId, "goal-objective", { objective: String(input.objective) });
      db.prepare(`INSERT INTO goals(id,scope_id,owner_actor_id,objective_encrypted_id,state,priority,target_start,target_end,project_ref,task_id,state_version,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(id, scopeId, String(input.ownerActorId || "local-owner"), objectiveId, requestedState, Math.max(0, Math.min(100, Number(input.priority ?? 50))),
        input.targetStart ? String(input.targetStart) : null, input.targetEnd ? String(input.targetEnd) : null, input.projectRef ? String(input.projectRef) : null, input.taskId ? String(input.taskId) : null, actorId, now, now);
      const goal = db.prepare("SELECT * FROM goals WHERE id=?").get(id); addGoalEvent(goal, null, goal.state, actorId, { created: true }, 1, now); return readGoal(id); });
    return run.immediate();
  }
  const GOAL_TRANSITIONS = Object.freeze({ proposed: ["active","cancelled"], active: ["paused","blocked","completed","cancelled"], paused: ["active","cancelled"], blocked: ["active","cancelled"], completed: [], cancelled: [] });
  function transitionGoal(input = {}) {
    const run = db.transaction(() => { const row = db.prepare("SELECT * FROM goals WHERE id=?").get(String(input.goalId)); if (!row) throw new Error("Goal is unavailable."); const to = String(input.toState);
      const transitionActor = String(input.actorId || "local-owner"); if (activeActor(transitionActor).actor_type !== "owner") throw Object.assign(new Error("Goal truth transitions require owner authority."), { code: "OWNER_AUTHORITY_REQUIRED" });
      if (!(GOAL_TRANSITIONS[row.state] || []).includes(to)) throw Object.assign(new Error("Invalid goal transition."), { code: "GOAL_TRANSITION_INVALID" });
      const now = clock().toISOString(); const version = row.state_version + 1; db.prepare("UPDATE goals SET state=?,state_version=?,updated_at=? WHERE id=? AND state_version=?").run(to, version, now, row.id, row.state_version);
      addGoalEvent(row, row.state, to, transitionActor, input.payload, version, now); faultInjector("personal.goal.transition.before_commit"); return readGoal(row.id); });
    return run.immediate();
  }
  function addGoalDependency(goalId, dependsOnGoalId) {
    const now = clock().toISOString(); db.prepare("INSERT INTO goal_dependencies(goal_id,depends_on_goal_id,created_at) VALUES(?,?,?)").run(String(goalId), String(dependsOnGoalId), now);
    const cycle = db.prepare(`WITH RECURSIVE chain(id) AS (SELECT depends_on_goal_id FROM goal_dependencies WHERE goal_id=? UNION ALL SELECT gd.depends_on_goal_id FROM goal_dependencies gd JOIN chain c ON gd.goal_id=c.id) SELECT 1 AS found FROM chain WHERE id=? LIMIT 1`).get(String(goalId), String(goalId));
    if (cycle) { db.prepare("DELETE FROM goal_dependencies WHERE goal_id=? AND depends_on_goal_id=?").run(String(goalId), String(dependsOnGoalId)); throw Object.assign(new Error("Goal dependency graph contains a cycle."), { code: "GOAL_DAG_CYCLE" }); }
    return { goalId: String(goalId), dependsOnGoalId: String(dependsOnGoalId) };
  }
  function readGoal(id) { const row = db.prepare("SELECT * FROM goals WHERE id=?").get(String(id)); if (!row) throw new Error("Goal is unavailable."); return { id: row.id, scopeId: row.scope_id, objective: decrypt(row.objective_encrypted_id)?.objective, state: row.state, priority: row.priority, targetStart: row.target_start, targetEnd: row.target_end, stateVersion: row.state_version,
    dependsOn: db.prepare("SELECT depends_on_goal_id AS id FROM goal_dependencies WHERE goal_id=? ORDER BY depends_on_goal_id").all(row.id).map((item) => item.id) }; }

  function addCommitmentEvent(item, fromState, toState, actorId, payload, version, now) { const payloadId = encrypt(item.scope_id, "commitment-transition", payload || {});
    db.prepare("INSERT INTO commitment_events(id,commitment_id,from_state,to_state,state_version,payload_encrypted_id,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), item.id, fromState, toState, version, payloadId, actorId, now); }
  function createCommitment(input = {}) { const scopeId = String(input.scopeId || ""); if (!scopeId || !input.promise) throw new Error("Commitment scope and promise are required."); const run = db.transaction(() => {
    const now = clock().toISOString(); const id = String(input.id || crypto.randomUUID()); const actorId = String(input.actorId || "local-owner"); activeActor(actorId); const promiseId = encrypt(scopeId, "commitment-promise", { promise: String(input.promise) });
    db.prepare(`INSERT INTO commitments(id,scope_id,actor_id,promise_encrypted_id,due_at,status,state_version,source_turn_id,completion_evidence_id,created_at,updated_at)
      VALUES(?,?,?,?,?,'active',1,?,NULL,?,?)`).run(id, scopeId, actorId, promiseId, input.dueAt ? String(input.dueAt) : null, input.sourceTurnId ? String(input.sourceTurnId) : null, now, now);
    const row = db.prepare("SELECT * FROM commitments WHERE id=?").get(id); addCommitmentEvent(row, null, "active", actorId, { created: true }, 1, now); return readCommitment(id); }); return run.immediate(); }
  const COMMITMENT_TRANSITIONS = Object.freeze({ proposed: ["active","cancelled"], active: ["completed","cancelled","overdue"], overdue: ["completed","cancelled"], completed: [], cancelled: [] });
  function transitionCommitment(input = {}) { const run = db.transaction(() => { const row = db.prepare("SELECT * FROM commitments WHERE id=?").get(String(input.commitmentId)); if (!row) throw new Error("Commitment is unavailable."); const to = String(input.toStatus);
    const transitionActor = String(input.actorId || row.actor_id); const transitionActorRow = activeActor(transitionActor); if (transitionActor !== row.actor_id && transitionActorRow.actor_type !== "owner") throw Object.assign(new Error("Commitment transition actor is unauthorized."), { code: "COMMITMENT_ACTOR_MISMATCH" });
    if (!(COMMITMENT_TRANSITIONS[row.status] || []).includes(to)) throw Object.assign(new Error("Invalid commitment transition."), { code: "COMMITMENT_TRANSITION_INVALID" });
    if (to === "completed" && input.evidenceId && !db.prepare("SELECT id FROM evidence_units WHERE id=?").get(String(input.evidenceId))) throw new Error("Commitment completion evidence is unavailable.");
    const now = clock().toISOString(); const version = row.state_version + 1; db.prepare("UPDATE commitments SET status=?,state_version=?,completion_evidence_id=?,updated_at=? WHERE id=? AND state_version=?")
      .run(to, version, input.evidenceId ? String(input.evidenceId) : row.completion_evidence_id, now, row.id, row.state_version); addCommitmentEvent(row, row.status, to, transitionActor, input.payload, version, now); return readCommitment(row.id); }); return run.immediate(); }
  function markOverdue() { const now = clock().toISOString(); const rows = db.prepare("SELECT id FROM commitments WHERE status='active' AND due_at IS NOT NULL AND due_at<?").all(now); rows.forEach((row) => transitionCommitment({ commitmentId: row.id, toStatus: "overdue", payload: { reason: "due_time_elapsed" } })); return rows.map((row) => row.id); }
  function readCommitment(id) { const row = db.prepare("SELECT * FROM commitments WHERE id=?").get(String(id)); if (!row) throw new Error("Commitment is unavailable."); return { id: row.id, scopeId: row.scope_id, actorId: row.actor_id, promise: decrypt(row.promise_encrypted_id)?.promise, dueAt: row.due_at, status: row.status, stateVersion: row.state_version, completionEvidenceId: row.completion_evidence_id }; }

  return Object.freeze({ activeDirectives, activeIdentity, addGoalDependency, createCommitment, createGoal, createPreference, effectivePreferences, markOverdue, promotePreference, readCommitment, readDirective, readGoal, readIdentity, readPreference, reinforcePreference, revokeDirective, setDirective, setIdentity, transitionCommitment, transitionGoal });
}

module.exports = { createPersonalMemoryRepository };
