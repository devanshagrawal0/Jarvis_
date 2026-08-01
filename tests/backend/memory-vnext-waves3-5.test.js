"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const Database = require("better-sqlite3");
const { createJobRepository } = require("../../server/memory-vnext/repositories/job-repository");
const {
  createKeyHierarchy,
  createMemorySupervisor,
  createPolicyEngine,
  createWindowsDpapiProtector,
  openCoreStore,
} = require("../../server/memory-vnext");

const roots = [];
const stores = [];

function tempRoot(label = "core") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `jarvis-memory-vnext-${label}-`));
  roots.push(root);
  return root;
}

function testProtector() {
  const mask = Buffer.from("7f8a51b26d19c0ee", "hex");
  return Object.freeze({
    id: "test-protector-v1",
    protect(bytes) {
      const value = Buffer.from(bytes);
      const out = Buffer.alloc(value.length + 4);
      out.write("TST1", 0, "ascii");
      for (let index = 0; index < value.length; index += 1) out[index + 4] = value[index] ^ mask[index % mask.length];
      return out;
    },
    unprotect(bytes) {
      const value = Buffer.from(bytes);
      if (value.subarray(0, 4).toString("ascii") !== "TST1") throw new Error("bad test wrapper");
      const out = Buffer.alloc(value.length - 4);
      for (let index = 4; index < value.length; index += 1) out[index - 4] = value[index] ^ mask[(index - 4) % mask.length];
      return out;
    },
  });
}

async function core(options = {}) {
  const store = await openCoreStore({
    runtimeDir: options.runtimeDir || tempRoot(),
    allowUnsafeTestPath: true,
    keyProtector: testProtector(),
    targetVersion: options.targetVersion ?? 3,
    clock: options.clock,
    faultInjector: options.faultInjector,
  });
  stores.push(store);
  return store;
}

function closeStore(store) {
  const index = stores.indexOf(store);
  if (index >= 0) stores.splice(index, 1);
  store.close();
}

afterEach(() => {
  while (stores.length) stores.pop().close();
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test("Wave 3 rejects repository and OneDrive runtime paths", async () => {
  await assert.rejects(openCoreStore({
    runtimeDir: path.join(__dirname, "unsafe-core"),
    keyProtector: testProtector(),
    targetVersion: 1,
  }), /must not live inside the repository/);
  const fakeOneDrive = path.join(os.tmpdir(), "OneDrive", "unsafe-core");
  await assert.rejects(openCoreStore({ runtimeDir: fakeOneDrive, keyProtector: testProtector(), targetVersion: 1 }), /must not live inside OneDrive/);
});

test("Wave 3 creates STRICT protected storage and keeps plaintext out of SQLite", async () => {
  const store = await core({ targetVersion: 1 });
  const health = store.health();
  assert.equal(health.ok, true);
  assert.equal(health.schemaVersion, 1);
  assert.equal(health.journalMode.toLowerCase(), "wal");
  assert.equal(health.foreignKeys, true);
  assert.equal(health.synchronous, 2);
  const payload = { note: "ultra-private-wave3-fixture", nested: { value: 42 } };
  const written = store.putEncryptedObject({ id: "fixture-1", objectType: "test.fixture", scopeId: "owner:local", sensitivity: "restricted", payload });
  assert.equal(written.replayed, false);
  assert.deepEqual(store.getEncryptedObject("fixture-1").payload, payload);
  const strictTables = store.attachRepository(({ db }) => db.prepare("PRAGMA table_list").all()
    .filter((row) => !String(row.name).startsWith("sqlite_")).map((row) => ({ name: row.name, strict: row.strict })));
  assert.ok(strictTables.length >= 7);
  assert.ok(strictTables.every((row) => row.strict === 1), JSON.stringify(strictTables));
  store.checkpoint();
  const raw = fs.readFileSync(store.paths.dbPath);
  assert.equal(raw.includes(Buffer.from("ultra-private-wave3-fixture")), false);
  const keyDocument = JSON.parse(fs.readFileSync(path.join(store.paths.rootDir, "master-key.dpapi.json"), "utf8"));
  assert.equal(keyDocument.protector, "test-protector-v1");
  assert.equal("plaintextKey" in keyDocument, false);
});

test("Wave 3 detects encrypted metadata tampering and wrapped-key loss", async () => {
  const root = tempRoot("tamper");
  const store = await core({ runtimeDir: root, targetVersion: 1 });
  store.putEncryptedObject({ id: "tamper-object", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { intact: true } });
  store.attachRepository(({ db }) => db.prepare("UPDATE encrypted_objects SET content_mac=? WHERE id=?").run("00".repeat(32), "tamper-object"));
  assert.throws(() => store.getEncryptedObject("tamper-object"), /content MAC mismatch/);
  closeStore(store);
  const keyPath = path.join(root, "master-key.dpapi.json");
  const keyDocument = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  keyDocument.wrappedKey = Buffer.from("lost-key-material").toString("base64");
  fs.writeFileSync(keyPath, JSON.stringify(keyDocument));
  await assert.rejects(openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: testProtector(), targetVersion: 1 }), /bad test wrapper|invalid length|fingerprint/);
});

test("Wave 3 enforces one writer owner and releases it cleanly", async () => {
  const root = tempRoot("ownership");
  const first = await core({ runtimeDir: root, targetVersion: 1 });
  await assert.rejects(openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: testProtector(), targetVersion: 1 }), /active writer owner/);
  closeStore(first);
  const reopened = await core({ runtimeDir: root, targetVersion: 1 });
  assert.equal(reopened.health().writerOwned, true);
});

test("Wave 3 rolls a faulted migration back and removes its writer lock", async () => {
  const root = tempRoot("fault-migration");
  await assert.rejects(openCoreStore({
    runtimeDir: root,
    allowUnsafeTestPath: true,
    keyProtector: testProtector(),
    targetVersion: 1,
    faultInjector(point) { if (point === "migration.1.before_commit") throw new Error("injected migration crash"); },
  }), /injected migration crash/);
  assert.equal(fs.existsSync(path.join(root, "core-writer.lock.json")), false);
  const db = new Database(path.join(root, "memory-vnext.sqlite"));
  assert.equal(Number(db.pragma("user_version", { simple: true })), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='encrypted_objects'").get().count, 0);
  db.close();
  const recovered = await core({ runtimeDir: root, targetVersion: 1 });
  assert.equal(recovered.health().schemaVersion, 1);
});

test("Waves 3-5 take and verify a pre-migration backup", async () => {
  const root = tempRoot("backup");
  const v1 = await core({ runtimeDir: root, targetVersion: 1 });
  v1.putEncryptedObject({ id: "before-upgrade", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { survives: true } });
  closeStore(v1);
  const v3 = await core({ runtimeDir: root, targetVersion: 3 });
  assert.equal(v3.health().schemaVersion, 3);
  assert.deepEqual(v3.getEncryptedObject("before-upgrade").payload, { survives: true });
  const backups = v3.attachRepository(({ db }) => db.prepare("SELECT * FROM backup_history").all());
  assert.equal(backups.length, 1);
  assert.equal(backups[0].quick_check, "ok");
  assert.equal(fs.existsSync(backups[0].path), true);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(backups[0].path)).digest("hex"), backups[0].sha256);
});

test("Wave 4 atomically commits canonical state, ledger, outbox, and idempotency receipt", async () => {
  const store = await core({ targetVersion: 2 });
  const supervisor = createMemorySupervisor({ store });
  const command = {
    commandType: "memory.fixture.v1", actorId: "local-owner", scopeId: "owner:local", purpose: "wave4_test",
    idempotencyKey: "wave4-command-1", streamType: "owner-memory", streamId: "owner:local", eventType: "fixture.created",
    sensitivity: "private", payload: { event: "created" }, outboxTargets: ["fts", "graph"],
    canonical: { id: "canonical-1", objectType: "fixture", expectedVersion: 0, payload: { truth: "first" }, cloudPolicy: "deny" },
  };
  const first = supervisor.submitCommand(command);
  const replay = supervisor.submitCommand(command);
  assert.equal(first.canonicalSequence, 1);
  assert.equal(first.canonical.version, 1);
  assert.equal(replay.replayed, true);
  assert.equal(replay.eventId, first.eventId);
  const counts = store.attachRepository(({ db }) => ({
    commands: db.prepare("SELECT COUNT(*) AS count FROM memory_commands").get().count,
    events: db.prepare("SELECT COUNT(*) AS count FROM ledger_events").get().count,
    state: db.prepare("SELECT COUNT(*) AS count FROM canonical_objects").get().count,
    outbox: db.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count,
  }));
  assert.deepEqual(counts, { commands: 1, events: 1, state: 1, outbox: 2 });
  assert.deepEqual(supervisor.ledger.verifyStream("owner-memory", "owner:local").ok, true);
});

test("Wave 4 rolls back every canonical effect at injected transaction boundaries", async () => {
  for (const faultPoint of ["command.after_payload", "command.after_canonical", "command.after_event", "command.after_outbox", "command.before_commit"]) {
    const store = await core({ targetVersion: 2, faultInjector(point) { if (point === faultPoint) throw new Error(`injected crash at ${faultPoint}`); } });
    const supervisor = createMemorySupervisor({ store });
    assert.throws(() => supervisor.submitCommand({
      commandType: "memory.fixture.v1", actorId: "local-owner", scopeId: "owner:local", purpose: "fault_test",
      idempotencyKey: `faulted-${faultPoint}`, streamId: "owner:local", payload: { should: "rollback" }, outboxTargets: ["fts"],
      canonical: { id: "rolled-back", objectType: "fixture", expectedVersion: 0, payload: { should: "rollback" } },
    }), /injected crash/);
    const counts = store.attachRepository(({ db }) => ({
      encrypted: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects").get().count,
      commands: db.prepare("SELECT COUNT(*) AS count FROM memory_commands").get().count,
      events: db.prepare("SELECT COUNT(*) AS count FROM ledger_events").get().count,
      state: db.prepare("SELECT COUNT(*) AS count FROM canonical_objects").get().count,
      outbox: db.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count,
      sequence: db.prepare("SELECT value FROM sequence_state WHERE name='canonical'").get().value,
    }));
    assert.deepEqual(counts, { encrypted: 0, commands: 0, events: 0, state: 0, outbox: 0, sequence: 0 }, faultPoint);
  }
});

test("Wave 4 detects ledger tampering", async () => {
  const store = await core({ targetVersion: 2 });
  const supervisor = createMemorySupervisor({ store });
  supervisor.submitCommand({ commandType: "memory.fixture.v1", actorId: "local-owner", scopeId: "owner:local", purpose: "integrity_test", idempotencyKey: "integrity-1", streamId: "s1", payload: { x: 1 } });
  assert.equal(supervisor.ledger.verifyStream("memory", "s1").ok, true);
  store.attachRepository(({ db }) => db.prepare("UPDATE ledger_events SET correlation_id='tampered-correlation' WHERE stream_id='s1'").run());
  assert.equal(supervisor.ledger.verifyStream("memory", "s1").ok, false);
});

test("Wave 4 reaps expired outbox leases into bounded retry", async () => {
  let nowMs = Date.parse("2026-07-23T00:00:00.000Z");
  const clock = () => new Date(nowMs);
  const store = await core({ targetVersion: 2, clock });
  const supervisor = createMemorySupervisor({ store, clock });
  supervisor.submitCommand({ commandType: "memory.fixture.v1", actorId: "local-owner", scopeId: "owner:local", purpose: "outbox_test", idempotencyKey: "outbox-expiry", streamId: "outbox-stream", payload: {}, outboxTargets: ["fts"] });
  const leased = supervisor.ledger.leaseOutbox({ workerId: "projector-1", leaseMs: 1_000 });
  assert.equal(leased.status, "leased");
  nowMs += 1_001;
  const reaped = supervisor.ledger.reapExpiredOutbox();
  assert.equal(reaped.length, 1);
  assert.equal(reaped[0].status, "retry");
});

test("Wave 4 jobs preserve partition order, retry safely, and make completion idempotent", async () => {
  let nowMs = Date.parse("2026-07-23T00:00:00.000Z");
  const clock = () => new Date(nowMs);
  const store = await core({ targetVersion: 2, clock });
  const supervisor = createMemorySupervisor({ store, clock });
  const base = { actorId: "local-owner", scopeId: "owner:local", purpose: "worker_test", jobType: "projection.fts", partitionKey: "owner:local", inputRef: "event:1", maxAttempts: 3 };
  const first = supervisor.enqueueJob({ ...base, idempotencyKey: "job-1" });
  const second = supervisor.enqueueJob({ ...base, inputRef: "event:2", idempotencyKey: "job-2" });
  const lease1 = supervisor.jobs.leaseNext({ workerId: "worker-1" });
  assert.equal(lease1.job_id, first.job_id);
  assert.equal(supervisor.jobs.leaseNext({ workerId: "worker-2" }), null);
  const retry = supervisor.jobs.fail({ jobId: first.job_id, workerId: "worker-1", errorCode: "TEMP_FAIL secret text discarded" });
  assert.equal(retry.status, "retry");
  assert.equal(supervisor.jobs.leaseNext({ workerId: "worker-1" }), null);
  nowMs += 2_000;
  const retryLease = supervisor.jobs.leaseNext({ workerId: "worker-1" });
  assert.equal(retryLease.job_id, first.job_id);
  const receipt = supervisor.jobs.complete({ jobId: first.job_id, workerId: "worker-1", outputIds: ["projection:1"], sideEffects: ["fts:upsert"], costUsd: 0 });
  const receiptReplay = supervisor.jobs.complete({ jobId: first.job_id, workerId: "worker-1" });
  assert.equal(receipt.outcome, "succeeded");
  assert.equal(receiptReplay.replayed, true);
  const lease2 = supervisor.jobs.leaseNext({ workerId: "worker-2" });
  assert.equal(lease2.job_id, second.job_id);
  const errorRow = store.attachRepository(({ db }) => db.prepare("SELECT last_error_code FROM memory_jobs WHERE job_id=?").get(first.job_id));
  assert.equal(errorRow.last_error_code, "WORKER_FAILURE");
});

test("Wave 4 job receipt commit is atomic and queue backpressure fails closed", async () => {
  const faultedStore = await core({ targetVersion: 2, faultInjector(point) { if (point === "job.complete.after_receipt") throw new Error("receipt crash"); } });
  const faultedSupervisor = createMemorySupervisor({ store: faultedStore });
  const job = faultedSupervisor.enqueueJob({ actorId: "local-owner", scopeId: "owner:local", purpose: "receipt_fault", jobType: "projection.test", partitionKey: "p", inputRef: "event:1", idempotencyKey: "receipt-fault", maxAttempts: 2 });
  faultedSupervisor.jobs.leaseNext({ workerId: "w" });
  assert.throws(() => faultedSupervisor.jobs.complete({ jobId: job.job_id, workerId: "w" }), /receipt crash/);
  const afterFault = faultedStore.attachRepository(({ db }) => ({
    status: db.prepare("SELECT status FROM memory_jobs WHERE job_id=?").get(job.job_id).status,
    receipts: db.prepare("SELECT COUNT(*) AS count FROM job_receipts WHERE job_id=?").get(job.job_id).count,
  }));
  assert.deepEqual(afterFault, { status: "leased", receipts: 0 });

  const pressureStore = await core({ targetVersion: 2 });
  const jobs = pressureStore.attachRepository((context) => createJobRepository({ ...context, maxQueuedPerScope: 1 }));
  jobs.enqueue({ scopeId: "owner:local", jobType: "projection.test", partitionKey: "p", inputRef: "event:1", idempotencyKey: "pressure-1" });
  assert.throws(() => jobs.enqueue({ scopeId: "owner:local", jobType: "projection.test", partitionKey: "p", inputRef: "event:2", idempotencyKey: "pressure-2" }), (error) => error.code === "JOB_BACKPRESSURE");
});

test("Wave 4 supervisor pause and drain stop new work without losing state", async () => {
  const store = await core({ targetVersion: 2 });
  const supervisor = createMemorySupervisor({ store });
  assert.equal(supervisor.pause().mode, "paused");
  assert.throws(() => supervisor.enqueueJob({ actorId: "local-owner" }), /paused/);
  assert.equal(supervisor.resume().mode, "running");
  const drain = supervisor.drain();
  assert.equal(drain.drained, true);
  assert.throws(() => supervisor.submitCommand({ actorId: "local-owner" }), /draining/);
});

test("Wave 5 enforces scope, purpose, sensitivity, cloud, and expiring capability leases", async () => {
  let nowMs = Date.parse("2026-07-23T00:00:00.000Z");
  const clock = () => new Date(nowMs);
  const store = await core({ targetVersion: 3, clock });
  const policy = createPolicyEngine({ store, clock, maxAgentLeaseMs: 60_000 });
  policy.repository.createScope({ id: "workspace:jarvis", scopeType: "workspace", name: "JARVIS", parentScopeId: "owner:local" });
  policy.repository.createScope({ id: "project:memory", scopeType: "project", name: "Memory", parentScopeId: "workspace:jarvis" });
  policy.repository.upsertActor({ id: "agent:builder", actorType: "agent", ownerId: "local-owner" });
  const lease = policy.issueCapabilityLease({
    actorId: "agent:builder", capability: "memory.command", resourcePattern: "project:memory", purposePattern: "build_memory",
    maxSensitivity: "private", cloudAllowed: false, shareAllowed: false, issuedBy: "local-owner",
    expiresAt: new Date(nowMs + 30_000).toISOString(),
  });
  assert.equal(policy.evaluate({ actorId: "agent:builder", capability: "memory.command", scopeId: "project:memory", purpose: "build_memory", sensitivity: "private" }).allowed, true);
  assert.equal(policy.evaluate({ actorId: "agent:builder", capability: "memory.command", scopeId: "project:memory", purpose: "unrelated", sensitivity: "private" }).allowed, false);
  assert.equal(policy.evaluate({ actorId: "agent:builder", capability: "memory.command", scopeId: "project:memory", purpose: "build_memory", sensitivity: "private", channel: "cloud" }).allowed, false);
  assert.equal(policy.evaluate({ actorId: "local-owner", capability: "memory.read", scopeId: "project:memory", purpose: "owner_query", sensitivity: "private", channel: "cloud" }).reasonCode, "PRIVATE_CLOUD_DENIED");
  assert.equal(policy.evaluate({ actorId: "local-owner", capability: "memory.read", scopeId: "project:memory", purpose: "owner_query", sensitivity: "internal", channel: "cloud" }).effect, "ask");
  nowMs += 31_000;
  assert.equal(policy.evaluate({ actorId: "agent:builder", capability: "memory.command", scopeId: "project:memory", purpose: "build_memory", sensitivity: "private" }).reasonCode, "CAPABILITY_LEASE_MISSING");
  assert.equal(policy.repository.revokeGrant(lease.id).revoked, true);
  assert.ok(policy.repository.health().denials >= 4);
});

test("Wave 5 rejects scope cycles and expires co-op authority", async () => {
  let nowMs = Date.parse("2026-07-23T00:00:00.000Z");
  const clock = () => new Date(nowMs);
  const store = await core({ targetVersion: 3, clock });
  const policy = createPolicyEngine({ store, clock, maxAgentLeaseMs: 60_000 });
  policy.repository.createScope({ id: "workspace:w", scopeType: "workspace", name: "W", parentScopeId: "owner:local" });
  policy.repository.createScope({ id: "coop:c1", scopeType: "coop_session", name: "Co-op", parentScopeId: "workspace:w" });
  assert.throws(() => policy.repository.addScopeEdge({ parentScopeId: "coop:c1", childScopeId: "owner:local", relation: "contains" }), /cycle/);
  policy.repository.upsertActor({ id: "collab:c1", actorType: "collaborator", ownerId: "local-owner" });
  policy.issueCoopGrant({ actorId: "collab:c1", capability: "memory.read", scopeId: "coop:c1", purposePattern: "coop_review", maxSensitivity: "internal", shareAllowed: true, issuedBy: "local-owner", expiresAt: new Date(nowMs + 10_000).toISOString() });
  assert.equal(policy.evaluate({ actorId: "collab:c1", capability: "memory.read", scopeId: "coop:c1", purpose: "coop_review", sensitivity: "internal", share: true }).allowed, true);
  nowMs += 11_000;
  assert.equal(policy.evaluate({ actorId: "collab:c1", capability: "memory.read", scopeId: "coop:c1", purpose: "coop_review", sensitivity: "internal", share: true }).allowed, false);
});

test("Wave 5 rotates, recovery-tests, and crypto-shreds retired scope keys", async () => {
  const store = await core({ targetVersion: 3 });
  const keys = createKeyHierarchy({ store });
  const first = keys.create("owner:local");
  const recovery = keys.recoveryTest("owner:local");
  assert.equal(recovery.ok, true);
  let firstKeyFingerprint;
  keys.withActiveKey("owner:local", (key, metadata) => { firstKeyFingerprint = crypto.createHash("sha256").update(key).digest("hex"); assert.equal(metadata.keyVersion, 1); });
  const second = keys.rotate("owner:local");
  let secondKeyFingerprint;
  keys.withActiveKey("owner:local", (key) => { secondKeyFingerprint = crypto.createHash("sha256").update(key).digest("hex"); });
  assert.notEqual(firstKeyFingerprint, secondKeyFingerprint);
  assert.equal(second.keyVersion, 2);
  const destroyed = keys.destroyRetired(first.keyId, 1);
  assert.equal(destroyed.state, "destroyed");
  const all = keys.list("owner:local");
  assert.equal(all.length, 2);
  assert.equal(JSON.stringify(all).includes("wrapped_key"), false);
  const raw = store.attachRepository(({ db }) => db.prepare("SELECT wrapped_key,nonce,auth_tag,aad_json FROM data_keys WHERE id=? AND key_version=1").get(first.keyId));
  assert.deepEqual(raw, { wrapped_key: null, nonce: null, auth_tag: null, aad_json: null });
});

test("Wave 5 key rotation rolls back if interrupted after retirement", async () => {
  const store = await core({ targetVersion: 3, faultInjector(point) { if (point === "key.rotate.after_retire") throw new Error("rotation crash"); } });
  const keys = createKeyHierarchy({ store });
  const first = keys.create("owner:local");
  assert.throws(() => keys.rotate("owner:local"), /rotation crash/);
  const all = keys.list("owner:local");
  assert.equal(all.length, 1);
  assert.equal(all[0].keyId, first.keyId);
  assert.equal(all[0].state, "active");
  assert.equal(keys.recoveryTest("owner:local").ok, true);
});

test("Wave 5 policy attaches to the supervisor before a canonical command can commit", async () => {
  const now = Date.parse("2026-07-23T00:00:00.000Z");
  const clock = () => new Date(now);
  const store = await core({ targetVersion: 3, clock });
  const policy = createPolicyEngine({ store, clock });
  policy.repository.createScope({ id: "project:p", scopeType: "project", name: "P", parentScopeId: "owner:local" });
  policy.repository.upsertActor({ id: "agent:a", actorType: "agent", ownerId: "local-owner" });
  policy.issueCapabilityLease({ actorId: "agent:a", capability: "memory.command", resourcePattern: "project:p", purposePattern: "admit_candidate", maxSensitivity: "private", issuedBy: "local-owner", expiresAt: new Date(now + 60_000).toISOString() });
  const supervisor = createMemorySupervisor({ store, policyEngine: policy, clock });
  const accepted = supervisor.submitCommand({ commandType: "candidate.admit.v1", actorId: "agent:a", capability: "memory.command", scopeId: "project:p", purpose: "admit_candidate", idempotencyKey: "agent-command-1", streamId: "project:p", sensitivity: "private", payload: { candidateRef: "capture:1" } });
  assert.equal(accepted.accepted, true);
  assert.throws(() => supervisor.submitCommand({ commandType: "candidate.admit.v1", actorId: "agent:a", capability: "memory.command", scopeId: "project:p", purpose: "different_purpose", idempotencyKey: "agent-command-denied", streamId: "project:p", payload: {} }), /denied by policy/);
  const counts = store.attachRepository(({ db }) => ({ events: db.prepare("SELECT COUNT(*) AS count FROM ledger_events").get().count, denials: db.prepare("SELECT COUNT(*) AS count FROM policy_denials").get().count }));
  assert.deepEqual(counts, { events: 1, denials: 1 });
});

test("Windows DPAPI wrapper round-trips random non-production material", { skip: process.platform !== "win32" }, () => {
  const protector = createWindowsDpapiProtector();
  const sample = crypto.randomBytes(32);
  const wrapped = protector.protect(sample);
  assert.notDeepEqual(wrapped, sample);
  assert.deepEqual(protector.unprotect(wrapped), sample);
});
