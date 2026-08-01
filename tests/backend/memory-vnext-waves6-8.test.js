"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  createConversationJournal,
  createConversationStateKernel,
  createMemoryObservability,
  createMemorySupervisor,
  openCoreStore,
} = require("../../server/memory-vnext");

const roots = [];
const stores = [];

function protector() {
  const mask = 0x5a;
  return Object.freeze({
    id: "waves6-8-test-protector",
    protect(bytes) { return Buffer.concat([Buffer.from("W68"), Buffer.from(bytes).map((value) => value ^ mask)]); },
    unprotect(bytes) {
      const value = Buffer.from(bytes);
      if (value.subarray(0, 3).toString() !== "W68") throw new Error("bad wrapper");
      return value.subarray(3).map((item) => item ^ mask);
    },
  });
}

async function core(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w68-"));
  roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: options.targetVersion || 6, clock: options.clock, faultInjector: options.faultInjector });
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length) stores.pop().close();
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function openJournal(journal, id = "conversation-1") {
  return journal.openConversation({ id, scopeId: "owner:local", roomType: "jarvis", createdBy: "local-owner", retentionPolicyId: "retain:test" });
}

test("Waves 6-8 upgrade a Wave 5 core through a verified backup with all new tables STRICT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w68-upgrade-"));
  roots.push(root);
  const v3 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 3 });
  stores.push(v3);
  v3.putEncryptedObject({ id: "pre-wave6", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { survives: true } });
  stores.pop(); v3.close();
  const v6 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 6 });
  stores.push(v6);
  assert.equal(v6.health().schemaVersion, 6);
  assert.deepEqual(v6.getEncryptedObject("pre-wave6").payload, { survives: true });
  const audit = v6.attachRepository(({ db }) => ({
    backups: db.prepare("SELECT COUNT(*) AS count FROM backup_history").get().count,
    strict: db.prepare("PRAGMA table_list").all().filter((row) => !String(row.name).startsWith("sqlite_")).every((row) => row.strict === 1),
    migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version),
  }));
  assert.equal(audit.backups, 1);
  assert.equal(audit.strict, true);
  assert.deepEqual(audit.migrations, [1, 2, 3, 4, 5, 6]);
});

test("Wave 8 migration crash leaves the Wave 7 schema intact and recoverable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w8-migration-fault-"));
  roots.push(root);
  const v5 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 5 });
  v5.close();
  await assert.rejects(openCoreStore({
    runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 6,
    faultInjector(point) { if (point === "migration.6.before_commit") throw new Error("wave8 migration crash"); },
  }), /wave8 migration crash/);
  const db = new (require("better-sqlite3"))(path.join(root, "memory-vnext.sqlite"));
  assert.equal(Number(db.pragma("user_version", { simple: true })), 5);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='conversation_state_heads'").get().count, 0);
  db.close();
  const recovered = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 6 });
  stores.push(recovered);
  assert.equal(recovered.health().schemaVersion, 6);
});

test("Wave 6 exposes real health, cost, correlation, and Command Center read models", async () => {
  const store = await core({ targetVersion: 6 });
  const supervisor = createMemorySupervisor({ store });
  const observability = createMemoryObservability({ store });
  let streamed = null;
  observability.subscribe(() => { throw new Error("observer failure must be isolated"); });
  const unsubscribe = observability.subscribe((snapshot) => { streamed = snapshot; });
  supervisor.submitCommand({
    commandType: "memory.observe.v1", actorId: "local-owner", scopeId: "owner:local", purpose: "observability_test",
    idempotencyKey: "obs-command", streamId: "owner:local", correlationId: "corr-wave6", payload: { protected: "not-in-trace" }, outboxTargets: ["fts"],
  });
  supervisor.enqueueJob({ actorId: "local-owner", scopeId: "owner:local", purpose: "observability_test", jobType: "projection.fts", partitionKey: "owner:local", inputRef: "event:obs", idempotencyKey: "obs-job", correlationId: "corr-wave6" });
  observability.recordMetric({ correlationId: "corr-wave6", component: "retrieval", metricName: "latency", value: 12, unit: "ms" });
  observability.recordCost({ correlationId: "corr-wave6", provider: "fixture", model: "none", operation: "test", callCount: 0, inputUnits: 0, outputUnits: 0, costUsd: 0 });
  const health = observability.health({ persist: true });
  unsubscribe();
  assert.equal(health.status, "healthy");
  assert.equal(health.storage.schemaVersion, 6);
  assert.equal(health.canonicalSequence, 1);
  assert.equal(health.cost.costUsd, 0);
  assert.equal(streamed.canonicalSequence, 1);
  const trace = observability.trace("corr-wave6");
  assert.equal(trace.commands.length, 1);
  assert.equal(trace.events.length, 1);
  assert.equal(trace.jobs.length, 1);
  assert.equal(trace.metrics.length, 1);
  assert.equal(JSON.stringify(trace).includes("not-in-trace"), false);
  const commandCenter = observability.commandCenterModel();
  assert.equal(commandCenter.title, "Memory Command Center");
  assert.ok(commandCenter.cards.length >= 7);
  const persisted = store.attachRepository(({ db }) => db.prepare("SELECT COUNT(*) AS count FROM health_snapshots").get().count);
  assert.equal(persisted, 1);
});

test("Wave 6 surfaces dead letters and audits operator actions without content", async () => {
  const store = await core({ targetVersion: 6 });
  const supervisor = createMemorySupervisor({ store });
  const observability = createMemoryObservability({ store });
  const job = supervisor.enqueueJob({ actorId: "local-owner", scopeId: "owner:local", purpose: "dead_letter_test", jobType: "fixture.fail", partitionKey: "p", inputRef: "event:1", idempotencyKey: "dead-job", maxAttempts: 1 });
  supervisor.jobs.leaseNext({ workerId: "worker" });
  supervisor.jobs.fail({ jobId: job.job_id, workerId: "worker", errorCode: "CONTROLLED_FAILURE" });
  const health = observability.health();
  assert.equal(health.status, "degraded");
  assert.equal(health.deadLetters.jobs, 1);
  const audit = observability.repository.auditOperatorAction({ actorId: "local-owner", action: "inspect_dead_letters", targetType: "job", targetId: job.job_id, resultCode: "OK", correlationId: "corr-audit" });
  assert.equal(audit.action, "inspect_dead_letters");
  assert.equal("payload" in audit, false);
});

test("Wave 7 journals encrypted turns, attachments, focus deltas, and reconciles retries", async () => {
  const store = await core({ targetVersion: 6 });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal);
  const input = {
    conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "client-event-1", clientSequence: 1,
    role: "user", content: "private ingress fixture text", sensitivity: "private",
    attachments: [{ artifactRef: "artifact:1", contentHash: "hash-1", mediaType: "text/plain", locator: { pathRef: "safe-ref" } }],
    focusDeltas: [{ focusType: "file", focusRef: "artifact:1", operation: "focus" }],
  };
  const first = journal.ingestTurn(input);
  const replay = journal.ingestTurn(input);
  const offlineReplay = journal.ingestTurn({ ...input, clientEventId: "client-event-offline-retry" });
  assert.equal(first.replayed, false);
  assert.equal(replay.turnId, first.turnId);
  assert.equal(offlineReplay.turnId, first.turnId);
  assert.throws(() => journal.ingestTurn({ ...input, content: "different", clientEventId: "different-event-same-sequence" }), (error) => error.code === "INGRESS_SEQUENCE_CONFLICT");
  assert.throws(() => journal.ingestTurn({ ...input, content: "different" }), (error) => error.code === "INGRESS_IDEMPOTENCY_CONFLICT");
  assert.equal(journal.readTurn(first.turnId).content, input.content);
  const counts = store.attachRepository(({ db }) => ({
    turns: db.prepare("SELECT COUNT(*) AS count FROM turns").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM turn_events").get().count,
    attachments: db.prepare("SELECT COUNT(*) AS count FROM turn_attachments").get().count,
    focus: db.prepare("SELECT COUNT(*) AS count FROM turn_focus_deltas").get().count,
  }));
  assert.deepEqual(counts, { turns: 1, events: 1, attachments: 1, focus: 1 });
  store.checkpoint();
  assert.equal(fs.readFileSync(store.paths.dbPath).includes(Buffer.from(input.content)), false);
});

test("Wave 7 resumes interrupted assistant streaming with contiguous idempotent chunks", async () => {
  const store = await core({ targetVersion: 6 });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-stream");
  const started = journal.beginAssistantTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "stream-start", clientSequence: 1, modelProvider: "fixture", modelId: "none" });
  assert.equal(journal.beginAssistantTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "stream-start-retry", clientSequence: 1, modelProvider: "fixture", modelId: "none" }).turnId, started.turnId);
  journal.appendChunk({ turnId: started.turnId, sequence: 0, content: "Hello " });
  assert.equal(journal.appendChunk({ turnId: started.turnId, sequence: 0, content: "Hello " }).replayed, true);
  assert.throws(() => journal.appendChunk({ turnId: started.turnId, sequence: 2, content: "gap" }), (error) => error.code === "STREAM_CHUNK_GAP");
  const interrupted = journal.interruptTurn(started.turnId);
  assert.equal(interrupted.resumeAtSequence, 1);
  journal.appendChunk({ turnId: started.turnId, sequence: 1, content: "world." });
  const finalized = journal.finalizeAssistantTurn({ turnId: started.turnId, clientEventId: "stream-final" });
  const replay = journal.finalizeAssistantTurn({ turnId: started.turnId, clientEventId: "stream-final" });
  assert.equal(finalized.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(journal.readTurn(started.turnId).content, "Hello world.");
  assert.equal(journal.readTurn(started.turnId).status, "finalized");
  const eventTypes = store.attachRepository(({ db }) => db.prepare("SELECT event_type FROM turn_events WHERE turn_id=? ORDER BY created_at,rowid").all(started.turnId).map((row) => row.event_type));
  assert.deepEqual(eventTypes, ["turn.stream_started", "turn.chunk", "turn.interrupted", "turn.chunk", "turn.finalized"]);
});

test("Wave 7 chunk journal is atomic under an injected crash", async () => {
  const store = await core({ targetVersion: 6, faultInjector(point) { if (point === "conversation.chunk.before_commit") throw new Error("chunk crash"); } });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-chunk-fault");
  const started = journal.beginAssistantTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "start", clientSequence: 1 });
  const before = store.attachRepository(({ db }) => db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count);
  assert.throws(() => journal.appendChunk({ turnId: started.turnId, sequence: 0, content: "rollback chunk" }), /chunk crash/);
  const after = store.attachRepository(({ db }) => ({
    chunks: db.prepare("SELECT COUNT(*) AS count FROM turn_stream_chunks").get().count,
    chunkEvents: db.prepare("SELECT COUNT(*) AS count FROM turn_events WHERE event_type='turn.chunk'").get().count,
    encrypted: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count,
  }));
  assert.deepEqual(after, { chunks: 0, chunkEvents: 0, encrypted: before });
});

test("Wave 7 ingress transaction rolls back all turn effects on crash", async () => {
  const store = await core({ targetVersion: 6, faultInjector(point) { if (point === "conversation.ingress.before_commit") throw new Error("ingress crash"); } });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-fault");
  assert.throws(() => journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "fault-event", clientSequence: 1, role: "user", content: "must rollback" }), /ingress crash/);
  const counts = store.attachRepository(({ db }) => ({
    turns: db.prepare("SELECT COUNT(*) AS count FROM turns").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM turn_events").get().count,
    encrypted: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count,
  }));
  assert.deepEqual(counts, { turns: 0, events: 0, encrypted: 0 });
});

test("Wave 8 builds branch-local deterministic state and dependency-selected verbatim context", async () => {
  let nowMs = Date.parse("2026-07-24T00:00:00.000Z");
  const clock = () => new Date(nowMs);
  const store = await core({ targetVersion: 6, clock });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-state");
  const turns = ["The Atlas decision must remain visible.", "middle turn", "latest turn"].map((content, index) => journal.ingestTurn({
    conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: `state-turn-${index}`, clientSequence: index + 1, role: "user", content,
  }));
  const kernel = createConversationStateKernel({ store });
  kernel.initialize(opened.conversationId, opened.branchId);
  const delta = kernel.applyDelta({
    conversationId: opened.conversationId, branchId: opened.branchId, sourceTurnId: turns[0].turnId, expectedSequence: 0,
    operations: [
      { type: "set_topic", topicKey: "project-atlas", capsule: { summary: "Atlas work" } },
      { type: "put_slot", namespace: "task", key: "active-file", value: { artifactRef: "artifact:atlas" }, ttlMs: 1_000 },
      { type: "set_referent", mention: "it", candidates: ["artifact:atlas", "project:atlas"], confidence: 0.45 },
      { type: "open_loop", id: "loop-atlas", loopType: "decision", payload: { question: "Approve Atlas?" } },
      { type: "put_state_item", itemType: "constraint", itemKey: "no-cloud", payload: { rule: "local only" } },
      { type: "set_focus", focusType: "artifact", focusRef: "artifact:atlas", leaseMs: 1_000 },
      { type: "bind_context", blockType: "artifact", blockRef: "artifact:atlas", sourceVersion: "v1", leaseMs: 1_000 },
    ],
  });
  assert.equal(delta.stateSequence, 1);
  const snapshot = kernel.buildSnapshot({ conversationId: opened.conversationId, tailLimit: 1, persist: true });
  const encryptedAfterFirstSnapshot = store.attachRepository(({ db }) => db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count);
  const persistedReplay = kernel.buildSnapshot({ conversationId: opened.conversationId, tailLimit: 1, persist: true });
  const encryptedAfterReplay = store.attachRepository(({ db }) => db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count);
  assert.equal(snapshot.checksum, persistedReplay.checksum);
  assert.equal(encryptedAfterReplay, encryptedAfterFirstSnapshot);
  assert.deepEqual(snapshot.verbatimTail.map((turn) => turn.id), [turns[0].turnId, turns[2].turnId]);
  assert.equal(snapshot.verbatimTail[0].dependencySelected, true);
  assert.equal(snapshot.referents[0].state, "unresolved");
  assert.equal(snapshot.openLoops.length, 1);
  assert.equal(snapshot.stateItems[0].type, "constraint");
  assert.equal(snapshot.workingSlots.length, 1);
  assert.equal(snapshot.contextBlocks.length, 1);
  assert.throws(() => kernel.applyDelta({ conversationId: opened.conversationId, branchId: opened.branchId, sourceTurnId: turns[2].turnId, expectedSequence: 0, operations: [{ type: "put_slot", key: "x", value: 1 }] }), (error) => error.code === "STATE_SEQUENCE_CONFLICT");
  nowMs += 1_001;
  const expired = kernel.buildSnapshot({ conversationId: opened.conversationId, tailLimit: 1 });
  assert.equal(expired.workingSlots.length, 0);
  assert.equal(expired.focus.length, 0);
  assert.equal(expired.contextBlocks.length, 0);
  const storedSnapshots = store.attachRepository(({ db }) => db.prepare("SELECT COUNT(*) AS count FROM working_set_snapshots").get().count);
  assert.equal(storedSnapshots, 1);
});

test("Wave 8 state delta is atomic under an injected crash", async () => {
  const store = await core({ targetVersion: 6, faultInjector(point) { if (point === "conversation.state.before_commit") throw new Error("state crash"); } });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-state-fault");
  const turn = journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "turn", clientSequence: 1, role: "user", content: "source" });
  const kernel = createConversationStateKernel({ store });
  kernel.initialize(opened.conversationId, opened.branchId);
  assert.throws(() => kernel.applyDelta({ conversationId: opened.conversationId, branchId: opened.branchId, sourceTurnId: turn.turnId, expectedSequence: 0, operations: [{ type: "open_loop", loopType: "question", payload: { q: "rollback" } }] }), /state crash/);
  const state = store.attachRepository(({ db }) => ({
    sequence: db.prepare("SELECT state_sequence FROM conversation_state_heads WHERE conversation_id=?").get(opened.conversationId).state_sequence,
    loops: db.prepare("SELECT COUNT(*) AS count FROM open_loops").get().count,
  }));
  assert.deepEqual(state, { sequence: 0, loops: 0 });
});

test("Wave 8 suspends and resumes branches without leaking branch-local topics", async () => {
  const store = await core({ targetVersion: 6 });
  const journal = createConversationJournal({ store });
  const opened = openJournal(journal, "conversation-branches");
  const mainTurn = journal.ingestTurn({ conversationId: opened.conversationId, branchId: opened.branchId, clientEventId: "main-turn", clientSequence: 1, role: "user", content: "main subject" });
  const kernel = createConversationStateKernel({ store });
  kernel.initialize(opened.conversationId, opened.branchId);
  kernel.applyDelta({ conversationId: opened.conversationId, branchId: opened.branchId, sourceTurnId: mainTurn.turnId, expectedSequence: 0, operations: [
    { type: "set_topic", topicKey: "main-topic" },
    { type: "set_referent", id: "referent:main", mention: "it", candidates: ["main-subject"], confidence: 0.4 },
  ] });
  const fork = kernel.forkBranch({ conversationId: opened.conversationId, parentBranchId: opened.branchId, parentTurnId: mainTurn.turnId, branchId: "branch:alternate" });
  const branchTurn = journal.ingestTurn({ conversationId: opened.conversationId, branchId: fork.branchId, clientEventId: "branch-turn", clientSequence: 2, role: "user", content: "alternate subject" });
  assert.throws(() => kernel.applyDelta({ conversationId: opened.conversationId, branchId: fork.branchId, sourceTurnId: branchTurn.turnId, expectedSequence: 2, operations: [{ type: "set_referent", id: "referent:main", mention: "attack", candidates: [], confidence: 0 }] }), /another conversation branch/);
  kernel.applyDelta({ conversationId: opened.conversationId, branchId: fork.branchId, sourceTurnId: branchTurn.turnId, expectedSequence: 2, operations: [{ type: "set_topic", topicKey: "alternate-topic" }] });
  const alternate = kernel.buildSnapshot({ conversationId: opened.conversationId });
  assert.deepEqual(alternate.topics.filter((topic) => topic.state === "active").map((topic) => topic.topicKey), ["alternate-topic"]);
  assert.equal(alternate.topics.some((topic) => topic.topicKey === "main-topic" && topic.state === "suspended"), true);
  assert.equal(alternate.suspendedBranches.some((branch) => branch.id === opened.branchId), true);
  kernel.switchBranch(opened.conversationId, opened.branchId);
  const main = kernel.buildSnapshot({ conversationId: opened.conversationId });
  assert.deepEqual(main.topics.map((topic) => topic.topicKey), ["main-topic"]);
  assert.equal(main.verbatimTail.some((turn) => turn.text === "alternate subject"), false);
});
