"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  createConversationJournal,
  createKnowledgeService,
  createSemanticSegmenter,
  createTaskRuntime,
  openCoreStore,
} = require("../../server/memory-vnext");

const roots = []; const stores = [];
function protector() {
  const mask = 0x39;
  return Object.freeze({ id: "waves9-11-test-protector", protect(bytes) { return Buffer.concat([Buffer.from("W911"), Buffer.from(bytes).map((value) => value ^ mask)]); },
    unprotect(bytes) { const value = Buffer.from(bytes); if (value.subarray(0, 4).toString() !== "W911") throw new Error("bad wrapper"); return value.subarray(4).map((item) => item ^ mask); } });
}
async function core(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w911-")); roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: options.targetVersion || 9, clock: options.clock, faultInjector: options.faultInjector });
  stores.push(store); return store;
}
function conversation(store, id = "conversation-w911") {
  const journal = createConversationJournal({ store });
  const opened = journal.openConversation({ id, scopeId: "owner:local", roomType: "jarvis", createdBy: "local-owner", retentionPolicyId: "retain:test" });
  return { journal, ...opened };
}
afterEach(() => { while (stores.length) stores.pop().close(); while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

test("Waves 9-11 upgrade Wave 8 through one verified backup and keep every application table STRICT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w911-upgrade-")); roots.push(root);
  const v6 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 6 });
  v6.putEncryptedObject({ id: "before-wave9", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { survives: true } }); v6.close();
  const v9 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 9 }); stores.push(v9);
  assert.deepEqual(v9.getEncryptedObject("before-wave9").payload, { survives: true });
  const audit = v9.attachRepository(({ db }) => ({ version: Number(db.pragma("user_version", { simple: true })), backups: db.prepare("SELECT COUNT(*) AS count FROM backup_history").get().count,
    strict: db.prepare("PRAGMA table_list").all().filter((row) => !String(row.name).startsWith("sqlite_")).every((row) => row.strict === 1),
    migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version) }));
  assert.equal(audit.version, 9); assert.equal(audit.backups, 1); assert.equal(audit.strict, true); assert.deepEqual(audit.migrations, [1,2,3,4,5,6,7,8,9]);
});

test("Wave 11 migration crash rolls fully back to Wave 10 and then recovers", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w11-fault-")); roots.push(root);
  const v8 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 8 }); v8.close();
  await assert.rejects(openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 9,
    faultInjector(point) { if (point === "migration.9.before_commit") throw new Error("wave11 migration crash"); } }), /wave11 migration crash/);
  const Database = require("better-sqlite3"); const db = new Database(path.join(root, "memory-vnext.sqlite"));
  assert.equal(Number(db.pragma("user_version", { simple: true })), 8); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='sources'").get().count, 0); db.close();
  const recovered = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 9 }); stores.push(recovered); assert.equal(recovered.health().schemaVersion, 9);
});

test("Wave 9 runs a dependency graph with approval truth and projects active work into conversation state", async () => {
  const store = await core(); const opened = conversation(store, "task-conversation");
  const source = opened.journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "task-source", clientSequence: 1, role: "user", content: "Run the protected task" });
  const runtime = createTaskRuntime({ store });
  const task = runtime.createTask({ id: "task:protected", scopeId: "owner:local", conversationId: opened.conversationId, branchId: opened.branchId, sourceTurnId: source.turnId,
    objective: "Analyze and publish safely", steps: [{ key: "analyze", title: "Analyze" }, { key: "publish", title: "Publish", dependsOn: ["analyze"], requiresApproval: true }] });
  assert.deepEqual(runtime.readySteps(task.id).map((step) => step.key), ["analyze"]);
  runtime.startStep({ taskId: task.id, stepId: task.steps[0].id, sourceTurnId: source.turnId });
  const afterAnalysis = runtime.completeStep({ taskId: task.id, stepId: task.steps[0].id, sourceTurnId: source.turnId, result: { finding: "ready" } });
  const publish = afterAnalysis.steps.find((step) => step.key === "publish");
  assert.throws(() => runtime.startStep({ taskId: task.id, stepId: publish.id, sourceTurnId: source.turnId }), (error) => error.code === "TASK_APPROVAL_REQUIRED");
  const approval = runtime.requestApproval({ taskId: task.id, stepId: publish.id, idempotencyKey: "approve-publish", request: { effect: "external publish" } });
  assert.equal(runtime.requestApproval({ taskId: task.id, stepId: publish.id, idempotencyKey: "approve-publish", request: { effect: "external publish" } }).replayed, true);
  runtime.decideApproval({ approvalId: approval.approvalId, decision: "approved" });
  runtime.startStep({ taskId: task.id, stepId: publish.id, sourceTurnId: source.turnId });
  const snapshot = require("../../server/memory-vnext").createConversationStateKernel({ store }).buildSnapshot({ conversationId: opened.conversationId });
  assert.equal(snapshot.workingSlots.find((slot) => slot.key === "active-task").value.currentStepId, publish.id);
  assert.throws(() => runtime.createTask({ scopeId: "owner:local", objective: "cycle", steps: [{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }] }), (error) => error.code === "TASK_DAG_CYCLE");
});

test("Wave 9 checkpoint resume and tool receipts never repeat completed side effects", async () => {
  const store = await core(); const runtime = createTaskRuntime({ store });
  const task = runtime.createTask({ id: "task:resume", scopeId: "owner:local", objective: "Resume exactly", steps: [{ key: "write" }] });
  const step = task.steps[0]; runtime.startStep({ taskId: task.id, stepId: step.id });
  const approval = runtime.requestApproval({ taskId: task.id, stepId: step.id, idempotencyKey: "external-approval", request: { effect: "external" } });
  runtime.decideApproval({ approvalId: approval.approvalId, decision: "approved" });
  const planned = runtime.planTool({ taskId: task.id, stepId: step.id, toolName: "filesystem.write", sideEffectClass: "external", approvalId: approval.approvalId, idempotencyKey: "write-once", arguments: { artifactRef: "artifact:one" } });
  runtime.startTool(planned.id); const first = runtime.completeTool(planned.id, { artifactRef: "artifact:one", version: "sha256:one" }, { costUsd: 0 });
  const replay = runtime.completeTool(planned.id, { ignored: true }, { costUsd: 9 });
  assert.equal(first.replayed, false); assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, { artifactRef: "artifact:one", version: "sha256:one" }); assert.equal(replay.costUsd, 0);
  runtime.addArtifact({ taskId: task.id, stepId: step.id, artifactRef: "artifact:one", version: "sha256:one", role: "output" });
  const checkpoint = runtime.checkpoint(task.id); const resumed = runtime.resume(task.id, checkpoint.resumeToken);
  assert.equal(resumed.snapshot.tools[0].status, "succeeded"); assert.equal(resumed.completedSideEffects.length, 1); assert.equal(resumed.incompleteSteps.length, 1);
  assert.throws(() => runtime.resume(task.id, "wrong-token"), (error) => error.code === "TASK_RESUME_TOKEN_INVALID");
  assert.throws(() => runtime.planTool({ taskId: task.id, stepId: step.id, toolName: "filesystem.write", idempotencyKey: "write-once", arguments: { artifactRef: "different" } }), (error) => error.code === "TOOL_IDEMPOTENCY_CONFLICT");
  const other = runtime.createTask({ id: "task:other-approval", scopeId: "owner:local", objective: "Other", steps: [{ key: "other" }] });
  const otherApproval = runtime.requestApproval({ taskId: other.id, stepId: other.steps[0].id, idempotencyKey: "other-approval", request: { effect: "other" } }); runtime.decideApproval({ approvalId: otherApproval.approvalId, decision: "approved" });
  const mismatched = runtime.planTool({ taskId: task.id, stepId: step.id, toolName: "filesystem.write", sideEffectClass: "external", approvalId: otherApproval.approvalId, idempotencyKey: "mismatched-approval", arguments: {} });
  assert.throws(() => runtime.startTool(mismatched.id), (error) => error.code === "TOOL_APPROVAL_SCOPE_MISMATCH");
});

test("Wave 9 rolls back checkpoint crashes, expires agent leases, and rejects debug telemetry in cognitive events", async () => {
  let nowMs = Date.parse("2026-07-24T00:00:00.000Z"); const clock = () => new Date(nowMs);
  const store = await core({ clock, faultInjector(point) { if (point === "task.checkpoint.before_commit") throw new Error("checkpoint crash"); } });
  const runtime = createTaskRuntime({ store }); const task = runtime.createTask({ scopeId: "owner:local", objective: "fault", steps: [{ key: "one" }] });
  assert.throws(() => runtime.checkpoint(task.id), /checkpoint crash/);
  const lease = runtime.leaseAgent({ taskId: task.id, actorId: "local-owner", blueprint: "researcher", leaseMs: 1_000 }); nowMs += 1_001;
  assert.deepEqual(runtime.reapExpiredAgents(), [lease.id]);
  const audit = store.attachRepository(({ db }) => ({ checkpoints: db.prepare("SELECT COUNT(*) AS count FROM task_checkpoints").get().count,
    debugRejected() { assert.throws(() => db.prepare("INSERT INTO task_significant_events(id,task_id,event_type,payload_encrypted_id,created_at) VALUES('debug',?,'debug.trace','missing',?)").run(task.id, clock().toISOString())); } }));
  assert.equal(audit.checkpoints, 0); audit.debugRejected();
});

test("Wave 10 preserves long topics, calls local classification only for ambiguity, links returns, and closes episodes semantically", async () => {
  const store = await core(); const opened = conversation(store, "semantic-conversation"); let classifierCalls = 0;
  const segmenter = createSemanticSegmenter({ store, classifierName: "fixture-local", classifierVersion: "1", ambiguousClassifier() { classifierCalls += 1; return 1; } });
  const contents = ["atlas market strategy evidence", "atlas strategy market evidence update", "quantum neutron decay physics", "switching to atlas market strategy again"];
  const turns = contents.map((content, index) => opened.journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: `semantic-${index}`, clientSequence: index + 1, role: "user", content }));
  segmenter.processTurn({ turnId: turns[0].turnId, topicKey: "atlas" });
  segmenter.processTurn({ turnId: turns[1].turnId, topicKey: "atlas" });
  const split = segmenter.processTurn({ turnId: turns[2].turnId, topicKey: "quantum" });
  const returned = segmenter.processTurn({ turnId: turns[3].turnId, topicKey: "atlas" });
  assert.equal(classifierCalls, 1); assert.equal(split.reason, "local_ambiguous_classifier"); assert.ok(split.episodeId); assert.equal(returned.decision, "split");
  const segments = segmenter.listSegments(opened.conversationId); assert.equal(segments.length, 3); assert.deepEqual(segments[0].turnIds, [turns[0].turnId, turns[1].turnId]); assert.equal(segments[2].linkedSegmentId, segments[0].id);
  const capsule = segmenter.createBranchCapsule({ conversationId: opened.conversationId, branchId: opened.branchId, summary: "Atlas branch" }); assert.deepEqual(capsule.coveredTurnIds, turns.map((turn) => turn.turnId));
  const closing = opened.journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "semantic-close", clientSequence: 5, role: "user", content: "Atlas is finished" });
  const closed = segmenter.processTurn({ turnId: closing.turnId, topicKey: "atlas", explicitClosure: true }); assert.equal(closed.reason, "current_semantic_closure"); assert.ok(closed.episodeId);
  assert.equal(segmenter.markBenchmark("passed").status, "passed");
});

test("Wave 11 keeps captures and evidence immutable with precise multimodal drill-down and explicit profile coverage", async () => {
  const store = await core(); const knowledge = createKnowledgeService({ store });
  const source = knowledge.createSource({ id: "source:paper", scopeId: "owner:local", type: "pdf", locator: { artifactRef: "artifact:paper" }, title: "private source title", trustZone: "owner", reliability: 0.95 });
  const capture1 = knowledge.addCapture({ sourceId: source.id, contentHash: "sha256:v1", blobRef: "blob:v1" });
  const capture2 = knowledge.addCapture({ sourceId: source.id, contentHash: "sha256:v2", blobRef: "blob:v2" }); assert.equal(capture2.version, 2);
  assert.throws(() => knowledge.addEvidence({ captureId: capture1.id, modality: "pdf", locator: { page: 2 }, excerpt: "weak" }), (error) => error.code === "EVIDENCE_LOCATOR_INCOMPLETE");
  const evidence = knowledge.addEvidence({ captureId: capture1.id, modality: "pdf", locator: { page: 2, bbox: [10,20,30,40] }, excerpt: "secret evidence excerpt" });
  const candidate = knowledge.createCandidate({ scopeId: "owner:local", subject: { entity: "Atlas" }, predicate: "has_market", object: { value: true } });
  assert.throws(() => knowledge.linkEvidence({ evidenceId: evidence.id, targetType: "candidate", targetId: "missing" }), /unavailable/);
  assert.throws(() => knowledge.createProfile({ scopeId: "owner:local", level: "topic", subjectRef: "atlas", candidateIds: [candidate.id], payload: { summary: "uncovered" } }), (error) => error.code === "PROFILE_COVERAGE_INCOMPLETE");
  knowledge.linkEvidence({ evidenceId: evidence.id, targetType: "candidate", targetId: candidate.id, stance: "supports", entailment: 0.98, independentGroup: "paper-one" });
  const profile = knowledge.createProfile({ scopeId: "owner:local", level: "topic", subjectRef: "atlas", candidateIds: [candidate.id], payload: { summary: "covered" } });
  const graph = knowledge.traverseProfile(profile.id); assert.equal(graph.candidates[0].evidence[0].evidence.locator.page, 2); assert.equal(graph.coverage.sources[0], source.id); assert.deepEqual(graph.uncoveredFailures, []);
  const immutability = store.attachRepository(({ db }) => () => db.prepare("UPDATE source_captures SET content_hash='changed' WHERE id=?").run(capture1.id)); assert.throws(immutability, /immutable/);
  store.checkpoint(); const bytes = fs.readFileSync(store.paths.dbPath); assert.equal(bytes.includes(Buffer.from("private source title")), false); assert.equal(bytes.includes(Buffer.from("secret evidence excerpt")), false);
});

test("Wave 11 entity aliases stay scope-local and merges are transactionally reversible", async () => {
  const store = await core(); const knowledge = createKnowledgeService({ store });
  const atlas = knowledge.createEntity({ id: "entity:atlas", scopeId: "owner:local", type: "project", name: "Atlas Prime" });
  knowledge.addAlias({ entityId: atlas.id, alias: "Atlas" });
  const duplicate = knowledge.createEntity({ id: "entity:atlas-duplicate", scopeId: "owner:local", type: "project", name: "Project Atlas" });
  const otherScope = store.attachRepository(({ db }) => { const now = new Date().toISOString(); db.prepare("INSERT INTO scopes(id,scope_type,name,owner_actor_id,status,created_at,updated_at) VALUES('project:other','project','Other','local-owner','active',?,?)").run(now, now); return true; }); assert.equal(otherScope, true);
  const scoped = knowledge.createEntity({ scopeId: "project:other", type: "project", name: "Other Atlas" }); knowledge.addAlias({ entityId: scoped.id, alias: "Atlas" });
  assert.equal(knowledge.resolveEntity("owner:local", "atlas").id, atlas.id); assert.equal(knowledge.resolveEntity("project:other", "atlas").id, scoped.id);
  const merge = knowledge.mergeEntities({ primaryEntityId: atlas.id, duplicateEntityId: duplicate.id, rationale: { reason: "same project" } }); assert.equal(knowledge.readEntity(duplicate.id).state, "merged");
  assert.equal(knowledge.resolveEntity("owner:local", "Project Atlas").id, atlas.id);
  const reversed = knowledge.reverseMerge(merge.mergeId); assert.equal(reversed.state, "reversed"); assert.equal(knowledge.readEntity(duplicate.id).state, "active");
});

test("Waves 9-11 transaction fault points leave no partial tool receipt, segment, capture, or entity merge", async () => {
  let crashPoint = null;
  const store = await core({ faultInjector(point) { if (point === crashPoint) throw new Error(`controlled ${point}`); } });
  const runtime = createTaskRuntime({ store }); const task = runtime.createTask({ scopeId: "owner:local", objective: "atomic batch", steps: [{ key: "run" }] });
  runtime.startStep({ taskId: task.id, stepId: task.steps[0].id });
  const tool = runtime.planTool({ taskId: task.id, stepId: task.steps[0].id, toolName: "read.only", idempotencyKey: "atomic-tool", arguments: {}, sideEffectClass: "none" }); runtime.startTool(tool.id);
  crashPoint = "task.tool.complete.before_commit"; assert.throws(() => runtime.completeTool(tool.id, { should: "rollback" }), /controlled/); crashPoint = null;

  const opened = conversation(store, "atomic-semantic"); const turn = opened.journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "atomic-turn", clientSequence: 1, role: "user", content: "atomic semantic input" });
  const segmenter = createSemanticSegmenter({ store }); crashPoint = "semantic.segment.before_commit"; assert.throws(() => segmenter.processTurn({ turnId: turn.turnId }), /controlled/); crashPoint = null;

  const knowledge = createKnowledgeService({ store }); const source = knowledge.createSource({ scopeId: "owner:local", type: "document", locator: { artifactRef: "atomic" } });
  crashPoint = "knowledge.capture.before_commit"; assert.throws(() => knowledge.addCapture({ sourceId: source.id, contentHash: "atomic-hash" }), /controlled/); crashPoint = null;
  const left = knowledge.createEntity({ scopeId: "owner:local", type: "project", name: "Atomic Left" }); const right = knowledge.createEntity({ scopeId: "owner:local", type: "project", name: "Atomic Right" });
  crashPoint = "knowledge.entity.merge.before_commit"; assert.throws(() => knowledge.mergeEntities({ primaryEntityId: left.id, duplicateEntityId: right.id, rationale: { controlled: true } }), /controlled/); crashPoint = null;

  const state = store.attachRepository(({ db }) => ({
    tool: db.prepare("SELECT status,receipt_encrypted_id FROM tool_invocations WHERE id=?").get(tool.id),
    segments: db.prepare("SELECT COUNT(*) AS count FROM semantic_segments").get().count,
    observations: db.prepare("SELECT COUNT(*) AS count FROM topic_boundary_observations").get().count,
    captures: db.prepare("SELECT COUNT(*) AS count FROM source_captures WHERE source_id=?").get(source.id).count,
    merges: db.prepare("SELECT COUNT(*) AS count FROM entity_merge_events").get().count,
  }));
  assert.deepEqual(state.tool, { status: "running", receipt_encrypted_id: null }); assert.equal(state.segments, 0); assert.equal(state.observations, 0); assert.equal(state.captures, 0); assert.equal(state.merges, 0); assert.equal(knowledge.readEntity(right.id).state, "active");
});
