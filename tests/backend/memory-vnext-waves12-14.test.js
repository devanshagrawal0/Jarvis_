"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  createAssertionService,
  createKnowledgeService,
  createPersonalMemoryService,
  createTruthMaintenance,
  openCoreStore,
} = require("../../server/memory-vnext");

const roots = []; const stores = [];
function protector() { const mask = 0x27; return Object.freeze({ id: "waves12-14-test-protector",
  protect(bytes) { return Buffer.concat([Buffer.from("W1214"), Buffer.from(bytes).map((value) => value ^ mask)]); },
  unprotect(bytes) { const value = Buffer.from(bytes); if (value.subarray(0, 5).toString() !== "W1214") throw new Error("bad wrapper"); return value.subarray(5).map((item) => item ^ mask); } }); }
async function core(options = {}) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w1214-")); roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: options.targetVersion || 12, clock: options.clock, faultInjector: options.faultInjector }); stores.push(store); return store; }
afterEach(() => { while (stores.length) stores.pop().close(); while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

test("Waves 12-14 upgrade Wave 11 through a verified backup with all tables STRICT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w1214-upgrade-")); roots.push(root);
  const v9 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 9 });
  v9.putEncryptedObject({ id: "before-wave12", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { survives: true } }); v9.close();
  const v12 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 12 }); stores.push(v12);
  assert.deepEqual(v12.getEncryptedObject("before-wave12").payload, { survives: true });
  const audit = v12.attachRepository(({ db }) => ({ version: Number(db.pragma("user_version", { simple: true })), backups: db.prepare("SELECT COUNT(*) AS count FROM backup_history").get().count,
    strict: db.prepare("PRAGMA table_list").all().filter((row) => !String(row.name).startsWith("sqlite_")).every((row) => row.strict === 1),
    migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version) }));
  assert.equal(audit.version, 12); assert.equal(audit.backups, 1); assert.equal(audit.strict, true); assert.deepEqual(audit.migrations, [1,2,3,4,5,6,7,8,9,10,11,12]);
});

test("Wave 14 migration crash rolls back to Wave 13 and recovers without partial tables", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w14-fault-")); roots.push(root);
  const v11 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 11 }); v11.close();
  await assert.rejects(openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 12,
    faultInjector(point) { if (point === "migration.12.before_commit") throw new Error("wave14 migration crash"); } }), /wave14 migration crash/);
  const Database = require("better-sqlite3"); const db = new Database(path.join(root, "memory-vnext.sqlite"));
  assert.equal(Number(db.pragma("user_version", { simple: true })), 11); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='forget_jobs'").get().count, 0); db.close();
  const recovered = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 12 }); stores.push(recovered); assert.equal(recovered.health().schemaVersion, 12);
});

test("Wave 12 answers valid-time and recorded-time separately while preserving epistemic state and confidence components", async () => {
  let nowMs = Date.parse("2026-01-01T00:00:00.000Z"); const clock = () => new Date(nowMs); const store = await core({ clock }); const truth = createAssertionService({ store });
  const created = truth.createAssertion({ id: "assertion:plan", scopeId: "owner:local", subjectType: "project", subjectRef: "atlas", predicate: "release_state", object: { state: "draft" },
    epistemicState: "owner_asserted", validFrom: "2025-01-01T00:00:00.000Z", createdBy: "local-owner", confidence: { extraction: 1, sourceReliability: 1, corroboration: 0.7, freshness: 0.9, userConfirmation: 1, contradictionPenalty: 0.1, policyVersion: "test:v1" } });
  const recordedBeforeRevision = clock().toISOString(); nowMs += 86_400_000;
  truth.reviseAssertion(created.id, { epistemicState: "disputed", createdBy: "local-owner", provenance: { reason: "new disagreement" }, confidence: { extraction: 1, sourceReliability: 0.8, corroboration: 0.2, freshness: 1, userConfirmation: 0.4, contradictionPenalty: 0.8, policyVersion: "test:v2" } });
  const historicalBelief = truth.query({ scopeId: "owner:local", subjectType: "project", subjectRef: "atlas", predicate: "release_state", validAt: "2025-06-01T00:00:00.000Z", recordedAt: recordedBeforeRevision });
  const currentBelief = truth.query({ scopeId: "owner:local", subjectType: "project", subjectRef: "atlas", predicate: "release_state", validAt: "2025-06-01T00:00:00.000Z" });
  assert.equal(historicalBelief[0].epistemicState, "owner_asserted"); assert.equal(currentBelief[0].epistemicState, "disputed");
  assert.equal(historicalBelief[0].confidence.policyVersion, "test:v1"); assert.ok(currentBelief[0].confidence.computed < historicalBelief[0].confidence.computed);
  assert.equal(truth.readAssertion(created.id).versions.length, 2);
});

test("Wave 12 keeps independent conflicting source claims separate until owner resolution", async () => {
  let nowMs = Date.parse("2026-02-01T00:00:00.000Z"); const clock = () => new Date(nowMs); const store = await core({ clock }); const knowledge = createKnowledgeService({ store }); const truth = createAssertionService({ store });
  const sourceA = knowledge.createSource({ scopeId: "owner:local", type: "web", locator: { url: "https://a.invalid" } }); const captureA = knowledge.addCapture({ sourceId: sourceA.id, contentHash: "a" });
  const evidenceA = knowledge.addEvidence({ captureId: captureA.id, modality: "text", locator: { section: "forecast", lineStart: 1 }, excerpt: "A says up" });
  const sourceB = knowledge.createSource({ scopeId: "owner:local", type: "web", locator: { url: "https://b.invalid" } }); const captureB = knowledge.addCapture({ sourceId: sourceB.id, contentHash: "b" });
  const evidenceB = knowledge.addEvidence({ captureId: captureB.id, modality: "text", locator: { section: "forecast", lineStart: 1 }, excerpt: "B says down" });
  const up = truth.createAssertion({ scopeId: "owner:local", subjectType: "topic", subjectRef: "market:x", predicate: "direction", object: "up", epistemicState: "source_asserted", createdBy: "local-owner",
    evidence: [{ evidenceId: evidenceA.id, independentGroup: "publisher:a" }], confidence: { sourceReliability: 0.8, corroboration: 0.3 } });
  const down = truth.createAssertion({ scopeId: "owner:local", subjectType: "topic", subjectRef: "market:x", predicate: "direction", object: "down", epistemicState: "source_asserted", createdBy: "local-owner",
    evidence: [{ evidenceId: evidenceB.id, independentGroup: "publisher:b" }], confidence: { sourceReliability: 0.8, corroboration: 0.3 } });
  const beforeResolution = clock().toISOString(); const conflict = truth.createConflict({ versionIds: [up.versionId, down.versionId], independentGroups: ["publisher:a", "publisher:b"] });
  assert.equal(truth.query({ scopeId: "owner:local", subjectRef: "market:x", predicate: "direction" }).length, 2); nowMs += 1_000;
  truth.resolveConflict({ conflictId: conflict.id, winningVersionId: up.versionId, decidedBy: "local-owner", rationale: { reason: "owner selected stronger source" } });
  assert.deepEqual(truth.query({ scopeId: "owner:local", subjectRef: "market:x", predicate: "direction" }).map((item) => item.object), ["up"]);
  assert.equal(truth.query({ scopeId: "owner:local", subjectRef: "market:x", predicate: "direction", recordedAt: beforeResolution }).length, 2);
});

test("Wave 13 protects identity and directives from agents and keeps inferred preferences as sourceable candidates", async () => {
  const store = await core(); const truth = createAssertionService({ store }); const personal = createPersonalMemoryService({ store });
  store.attachRepository(({ db }) => { const now = new Date().toISOString(); db.prepare("INSERT INTO actors(id,actor_type,owner_id,status,metadata_json,created_at,updated_at) VALUES('model-agent','agent','local-owner','active','{}',?,?)").run(now, now); });
  const identityTruth = truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "display_name", object: "Devan", epistemicState: "owner_asserted", createdBy: "local-owner" });
  const identity = personal.setIdentity({ scopeId: "owner:local", predicate: "display_name", value: "Devan", assertionId: identityTruth.id, actorId: "local-owner", authorityZone: "owner" }); assert.equal(identity.value, "Devan");
  assert.throws(() => personal.setIdentity({ scopeId: "owner:local", predicate: "display_name", value: "Impostor", assertionId: identityTruth.id, actorId: "model-agent", authorityZone: "owner" }), (error) => error.code === "OWNER_AUTHORITY_REQUIRED");
  assert.throws(() => personal.setDirective({ scopeId: "owner:local", key: "always-send", content: "send without asking", actorId: "model-agent", authorityZone: "owner" }), (error) => error.code === "OWNER_AUTHORITY_REQUIRED");
  const directive = personal.setDirective({ scopeId: "owner:local", key: "confirm-external-send", content: "Ask before external sends", actorId: "local-owner", authorityZone: "owner" }); assert.equal(directive.protected, true);
  assert.throws(() => personal.createPreference({ scopeId: "owner:local", subjectRef: "local-owner", domain: "ui", value: "dense", origin: "inferred", createdBy: "model-agent" }), /sourceable evidence/);
  const inferred = personal.createPreference({ scopeId: "owner:local", subjectRef: "local-owner", domain: "ui", condition: { project: "atlas" }, value: "dense", origin: "inferred", status: "active", createdBy: "model-agent", assertionVersionId: identityTruth.versionId });
  assert.equal(inferred.status, "candidate"); personal.promotePreference({ preferenceId: inferred.id, actorId: "local-owner", authorityZone: "owner" });
  assert.equal(personal.effectivePreferences({ scopeId: "owner:local", subjectRef: "local-owner", domain: "ui", context: { project: "atlas" } }).length, 1);
  assert.equal(personal.effectivePreferences({ scopeId: "owner:local", subjectRef: "local-owner", domain: "ui", context: { project: "other" } }).length, 0);
});

test("Wave 13 enforces goal DAGs and typed goal and commitment transitions", async () => {
  let nowMs = Date.parse("2026-03-01T00:00:00.000Z"); const clock = () => new Date(nowMs); const store = await core({ clock }); const personal = createPersonalMemoryService({ store });
  const foundation = personal.createGoal({ id: "goal:foundation", scopeId: "owner:local", objective: "Build foundation", state: "active", priority: 90 });
  const launch = personal.createGoal({ id: "goal:launch", scopeId: "owner:local", objective: "Launch", priority: 80 }); personal.addGoalDependency(launch.id, foundation.id);
  assert.throws(() => personal.addGoalDependency(foundation.id, launch.id), (error) => error.code === "GOAL_DAG_CYCLE");
  personal.transitionGoal({ goalId: launch.id, toState: "active" }); personal.transitionGoal({ goalId: launch.id, toState: "completed" });
  assert.throws(() => personal.transitionGoal({ goalId: launch.id, toState: "active" }), (error) => error.code === "GOAL_TRANSITION_INVALID");
  const commitment = personal.createCommitment({ scopeId: "owner:local", promise: "Prepare evidence", dueAt: new Date(nowMs + 1_000).toISOString() }); nowMs += 1_001;
  assert.deepEqual(personal.markOverdue(), [commitment.id]); assert.equal(personal.readCommitment(commitment.id).status, "overdue");
  personal.transitionCommitment({ commitmentId: commitment.id, toStatus: "completed" }); assert.equal(personal.readCommitment(commitment.id).status, "completed");
});

test("Wave 14 distinguishes a real-world change from recorded history and invalidates every dependent copy", async () => {
  let nowMs = Date.parse("2026-07-24T00:00:00.000Z"); const clock = () => new Date(nowMs); const store = await core({ clock }); const truth = createAssertionService({ store }); const maintenance = createTruthMaintenance({ store });
  const boston = truth.createAssertion({ id: "assertion:residence:boston", scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "residence", object: "Boston",
    epistemicState: "owner_asserted", validFrom: "2020-01-01T00:00:00.000Z", createdBy: "local-owner" });
  const recordedBefore = clock().toISOString(); const summary = maintenance.registerDerivedCopy({ id: "copy:residence-summary", scopeId: "owner:local", copyType: "summary", sourceType: "assertion", sourceId: boston.id, payload: { text: "Lives in Boston" } });
  const cache = maintenance.registerDerivedCopy({ id: "copy:residence-cache", scopeId: "owner:local", copyType: "cache", sourceType: "derived_copy", sourceId: summary.id, payload: { answer: "Boston" } });
  nowMs += 1_000; const movedAt = clock().toISOString();
  const preview = maintenance.previewCorrection({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "residence", oldObject: "Boston", newObject: "Philadelphia", mode: "real_world_change", validAt: movedAt });
  const result = maintenance.applyCorrection({ commandId: preview.id, actorId: "local-owner", authorityZone: "owner" }); assert.equal(result.status, "committed");
  assert.deepEqual(truth.query({ scopeId: "owner:local", subjectRef: "local-owner", predicate: "residence", validAt: "2025-01-01T00:00:00.000Z" }).map((item) => item.object), ["Boston"]);
  assert.deepEqual(truth.query({ scopeId: "owner:local", subjectRef: "local-owner", predicate: "residence", validAt: movedAt }).map((item) => item.object), ["Philadelphia"]);
  assert.deepEqual(truth.query({ scopeId: "owner:local", subjectRef: "local-owner", predicate: "residence", validAt: movedAt, recordedAt: recordedBefore }).map((item) => item.object), ["Boston"]);
  assert.equal(maintenance.readDerivedCopy(summary.id).status, "stale"); assert.equal(maintenance.readDerivedCopy(cache.id).status, "deleted"); assert.equal(maintenance.readDerivedCopy(cache.id).payload, null);
});

test("Wave 14 refuses ambiguous corrections and never guesses a high-impact target", async () => {
  const store = await core(); const truth = createAssertionService({ store }); const maintenance = createTruthMaintenance({ store });
  truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "contact_address", object: "one@example.invalid", epistemicState: "owner_asserted", createdBy: "local-owner" });
  truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "contact_address", object: "two@example.invalid", epistemicState: "owner_asserted", createdBy: "local-owner" });
  const preview = maintenance.previewCorrection({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "contact_address", newObject: "new@example.invalid", mode: "never_true" });
  assert.equal(preview.status, "needs_clarification"); assert.equal(preview.targetCount, 2); assert.throws(() => maintenance.applyCorrection({ commandId: preview.id, actorId: "local-owner", authorityZone: "owner" }), (error) => error.code === "CORRECTION_CLARIFICATION_REQUIRED");
});

test("Wave 14 forgets an exact target through transitive copies and emits a content-free signed receipt", async () => {
  const store = await core(); const personal = createPersonalMemoryService({ store }); const maintenance = createTruthMaintenance({ store });
  const secret = "ultra-private-preference-fixture";
  const preference = personal.createPreference({ id: "preference:forget", scopeId: "owner:local", subjectRef: "local-owner", domain: "writing", value: secret, origin: "explicit_owner", createdBy: "local-owner", authorityZone: "owner" });
  const direct = maintenance.registerDerivedCopy({ id: "copy:preference-cache", scopeId: "owner:local", copyType: "cache", sourceType: "preference", sourceId: preference.id, payload: { value: secret } });
  const transitive = maintenance.registerDerivedCopy({ id: "copy:preference-export", scopeId: "owner:local", copyType: "export", sourceType: "derived_copy", sourceId: direct.id, payload: { exported: secret }, mixedContent: true });
  const preview = maintenance.previewForget({ scopeId: "owner:local", targetType: "preference", targetId: preference.id, requestedBy: "local-owner" });
  maintenance.authorizeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" }); const result = maintenance.executeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  assert.equal(result.verified, true); assert.equal(result.invalidatedCopyCount, 2); assert.equal(personal.readPreference(preference.id).status, "retracted"); assert.equal(personal.readPreference(preference.id).value, undefined);
  assert.equal(maintenance.readDerivedCopy(direct.id).status, "deleted"); assert.equal(maintenance.readDerivedCopy(transitive.id).status, "redacted"); assert.equal(maintenance.readDerivedCopy(transitive.id).payload, null);
  const receipt = maintenance.readDeletionReceipt(preview.id); assert.equal(receipt.verification.verified, true); assert.equal(JSON.stringify(receipt).includes(secret), false); assert.equal(receipt.shredMode, "encrypted_payload_delete");
  const databaseText = fs.readFileSync(store.paths.dbPath); assert.equal(databaseText.includes(Buffer.from(secret)), false);
});

test("Wave 14 expands protected identity forgetting to its linked assertion instead of allowing reconstruction", async () => {
  const store = await core(); const truth = createAssertionService({ store }); const personal = createPersonalMemoryService({ store }); const maintenance = createTruthMaintenance({ store });
  const assertion = truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "home_city", object: "Private City", epistemicState: "owner_asserted", createdBy: "local-owner" });
  const identity = personal.setIdentity({ scopeId: "owner:local", predicate: "home_city", value: "Private City", assertionId: assertion.id, actorId: "local-owner", authorityZone: "owner" });
  const preview = maintenance.previewForget({ scopeId: "owner:local", targetType: "identity", targetId: identity.id });
  assert.equal(preview.expandedTargets.some((target) => target.type === "assertion" && target.id === assertion.id), true);
  maintenance.authorizeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" }); maintenance.executeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  assert.equal(personal.activeIdentity("owner:local").length, 0); assert.equal(truth.query({ scopeId: "owner:local", subjectRef: "local-owner", predicate: "home_city" }).length, 0);
  assert.equal(maintenance.readDeletionReceipt(preview.id).targetIds.some((id) => id === `assertion:${assertion.id}`), true);
});

test("Wave 14 scrubs goal transition payloads while retaining content-free structural event history", async () => {
  const store = await core(); const personal = createPersonalMemoryService({ store }); const maintenance = createTruthMaintenance({ store });
  const goal = personal.createGoal({ scopeId: "owner:local", objective: "Confidential launch objective", state: "active" });
  personal.transitionGoal({ goalId: goal.id, toState: "paused", payload: { privateReason: "Confidential launch blocker" } });
  const preview = maintenance.previewForget({ scopeId: "owner:local", targetType: "goal", targetId: goal.id }); maintenance.authorizeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  maintenance.executeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  const eventState = store.attachRepository(({ db }) => ({ events: db.prepare("SELECT COUNT(*) AS count FROM goal_events WHERE goal_id=?").get(goal.id).count,
    payloads: db.prepare("SELECT COUNT(*) AS count FROM goal_events WHERE goal_id=? AND payload_encrypted_id IS NOT NULL").get(goal.id).count }));
  assert.deepEqual(eventState, { events: 2, payloads: 0 }); assert.equal(personal.readGoal(goal.id).objective, undefined); assert.equal(personal.readGoal(goal.id).state, "retracted");
});

test("Waves 12-14 fault points roll back assertion, correction, protected identity, and forget operations atomically", async () => {
  let crashPoint = null; let nowMs = Date.parse("2026-08-01T00:00:00.000Z"); const clock = () => new Date(nowMs);
  const store = await core({ clock, faultInjector(point) { if (point === crashPoint) throw new Error(`controlled ${point}`); } }); const truth = createAssertionService({ store }); const personal = createPersonalMemoryService({ store }); const maintenance = createTruthMaintenance({ store });
  crashPoint = "assertion.create.before_commit"; assert.throws(() => truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "faulted", object: "rollback", epistemicState: "owner_asserted", createdBy: "local-owner" }), /controlled/); crashPoint = null;
  const identityTruth = truth.createAssertion({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "timezone", object: "Asia/Calcutta", epistemicState: "owner_asserted", createdBy: "local-owner" });
  crashPoint = "personal.identity.before_commit"; assert.throws(() => personal.setIdentity({ scopeId: "owner:local", predicate: "timezone", value: "Asia/Calcutta", assertionId: identityTruth.id, actorId: "local-owner", authorityZone: "owner" }), /controlled/); crashPoint = null;
  const preference = personal.createPreference({ scopeId: "owner:local", subjectRef: "local-owner", domain: "fault", value: "must survive rollback", origin: "explicit_owner", createdBy: "local-owner", authorityZone: "owner" });
  maintenance.registerDerivedCopy({ id: "copy:fault", scopeId: "owner:local", copyType: "cache", sourceType: "preference", sourceId: preference.id, payload: { value: "must survive rollback" } });
  const forget = maintenance.previewForget({ scopeId: "owner:local", targetType: "preference", targetId: preference.id }); maintenance.authorizeForget({ jobId: forget.id, actorId: "local-owner", authorityZone: "owner" });
  crashPoint = "truth.forget.before_commit"; assert.throws(() => maintenance.executeForget({ jobId: forget.id, actorId: "local-owner", authorityZone: "owner" }), /controlled/); crashPoint = null;
  const state = store.attachRepository(({ db }) => ({ faultedAssertions: db.prepare("SELECT COUNT(*) AS count FROM assertions WHERE predicate='faulted'").get().count, identities: db.prepare("SELECT COUNT(*) AS count FROM identity_attributes").get().count,
    forgetStatus: db.prepare("SELECT status FROM forget_jobs WHERE id=?").get(forget.id).status, receipts: db.prepare("SELECT COUNT(*) AS count FROM deletion_receipts").get().count }));
  assert.deepEqual(state, { faultedAssertions: 0, identities: 0, forgetStatus: "authorized", receipts: 0 }); assert.equal(personal.readPreference(preference.id).value, "must survive rollback"); assert.equal(maintenance.readDerivedCopy("copy:fault").status, "active");
});
