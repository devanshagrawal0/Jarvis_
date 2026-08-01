"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const {
  createAssertionService,
  createCacheFabric,
  createEmbeddingGateway,
  createPersonalMemoryService,
  createRetrievalOracle,
  createTruthMaintenance,
  openCoreStore,
} = require("../../server/memory-vnext");

const roots = [];
const stores = [];
function protector() {
  const mask = 0x51;
  return Object.freeze({
    id: "waves15-17-test-protector",
    protect(bytes) { return Buffer.concat([Buffer.from("W1517"), Buffer.from(bytes).map((value) => value ^ mask)]); },
    unprotect(bytes) { const value = Buffer.from(bytes); if (value.subarray(0, 5).toString() !== "W1517") throw new Error("bad test wrapper"); return value.subarray(5).map((item) => item ^ mask); },
  });
}
async function core(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w1517-")); roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: options.targetVersion || 15, clock: options.clock, faultInjector: options.faultInjector });
  stores.push(store); return store;
}
function addScope(store, id = "project:atlas") {
  store.attachRepository(({ db, clock }) => {
    const now = clock().toISOString();
    db.prepare("INSERT OR IGNORE INTO scopes(id,scope_type,name,owner_actor_id,status,created_at,updated_at) VALUES(?,?,?,?, 'active',?,?)")
      .run(id, "project", id, "local-owner", now, now);
  });
}
function buildOracle(store, version = "lexical:test:v1") {
  const oracle = createRetrievalOracle({ store }); const projection = oracle.createProjection({ version, sourceSequence: 10, policyVersion: "policy:v1" });
  return { oracle, projection };
}
function localProfile(gateway, dimensions = 4, suffix = "a") {
  return gateway.registerProfile({ provider: "local-fixture", model: `fixture-${suffix}`, modelVersion: "1", dimensions, modality: "text", preprocessingVersion: "nfkc-v1", taskInstruction: "retrieval_document", metric: "cosine", normalized: true, lane: "local" });
}
afterEach(() => {
  while (stores.length) stores.pop().close();
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

test("Waves 15-17 upgrade Wave 14 through a verified backup and keep application tables STRICT", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w1517-upgrade-")); roots.push(root);
  const v12 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 12 });
  v12.putEncryptedObject({ id: "before-wave15", objectType: "fixture", scopeId: "owner:local", sensitivity: "private", payload: { survives: true } }); v12.close();
  const v15 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 15 }); stores.push(v15);
  assert.deepEqual(v15.getEncryptedObject("before-wave15").payload, { survives: true });
  const audit = v15.attachRepository(({ db }) => {
    const tables = db.prepare("PRAGMA table_list").all().filter((row) => row.type === "table" && !String(row.name).startsWith("sqlite_"));
    return { version: Number(db.pragma("user_version", { simple: true })), backups: db.prepare("SELECT COUNT(*) AS count FROM backup_history").get().count,
      nonStrict: tables.filter((row) => row.strict !== 1).map((row) => row.name), migrations: db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((row) => row.version) };
  });
  assert.equal(audit.version, 15); assert.equal(audit.backups, 1); assert.deepEqual(audit.nonStrict, []); assert.deepEqual(audit.migrations, Array.from({ length: 15 }, (_, index) => index + 1));
});

test("Wave 17 migration crash rolls back to Wave 16 and recovers without partial vector tables", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-w17-fault-")); roots.push(root);
  const v14 = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 14 }); v14.close();
  await assert.rejects(openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 15,
    faultInjector(point) { if (point === "migration.15.before_commit") throw new Error("wave17 migration crash"); } }), /wave17 migration crash/);
  const Database = require("better-sqlite3"); const db = new Database(path.join(root, "memory-vnext.sqlite"));
  assert.equal(Number(db.pragma("user_version", { simple: true })), 14); assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name='embedding_profiles'").get().count, 0); db.close();
  const recovered = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector(), targetVersion: 15 }); stores.push(recovered); assert.equal(recovered.health().schemaVersion, 15);
});

test("Wave 15 gives exact identifiers precedence, filters scope and valid time, and leaves no plaintext lexical index", async () => {
  const store = await core(); addScope(store); const { oracle, projection } = buildOracle(store); const secret = "alpha-private-orchid-8842";
  oracle.indexDocument({ projectionId: projection.id, id: "doc:owner", scopeId: "owner:local", recordType: "assertion", recordId: "assertion:owner", recordVersion: "1", content: { text: `${secret} market strategy` }, searchableText: `${secret} market strategy`, exactKeys: [{ type: "ticker", value: "KXORCHID" }, { type: "path", value: "C:/private/alpha.md" }], validFrom: "2025-01-01T00:00:00.000Z" });
  oracle.indexDocument({ projectionId: projection.id, id: "doc:project", scopeId: "project:atlas", recordType: "artifact", recordId: "artifact:atlas", recordVersion: "1", content: { text: "market strategy in other scope" }, searchableText: "market strategy in other scope", exactKeys: [{ type: "ticker", value: "KXOTHER" }] });
  oracle.indexDocument({ projectionId: projection.id, id: "doc:expired", scopeId: "owner:local", recordType: "artifact", recordId: "artifact:expired", recordVersion: "1", content: { text: "historic orchid" }, searchableText: "historic orchid", validFrom: "2020-01-01T00:00:00.000Z", validTo: "2021-01-01T00:00:00.000Z" });
  oracle.activateProjection({ projectionId: projection.id, expectedSelectedRecords: 3 });
  const exact = oracle.retrieve({ scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"], exactKeys: [{ type: "ticker", value: "KXORCHID" }], text: "market strategy", validAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(exact.hits[0].documentId, "doc:owner"); assert.equal(exact.hits[0].channel, "exact"); assert.equal(exact.hits.some((hit) => hit.documentId === "doc:project"), false); assert.equal(exact.hits.some((hit) => hit.documentId === "doc:expired"), false);
  const lexical = oracle.retrieve({ scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"], text: secret, validAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(lexical.hits[0].documentId, "doc:owner"); assert.equal(JSON.stringify(oracle.trace(lexical.runId)).includes(secret), false);
  assert.throws(() => oracle.retrieve({ scopeIds: ["project:atlas"], allowedScopeIds: ["owner:local"], text: "market" }), (error) => error.code === "RETRIEVAL_SCOPE_DENIED");
  store.checkpoint(); assert.equal(fs.readFileSync(store.paths.dbPath).includes(Buffer.from(secret)), false);
});

test("Wave 15 blue-green activation requires coverage and indexing faults roll back encrypted payloads and FTS rows", async () => {
  let crashPoint = null; const store = await core({ faultInjector(point) { if (point === crashPoint) throw new Error(`controlled ${point}`); } }); const { oracle, projection } = buildOracle(store, "lexical:blue:v1");
  oracle.indexDocument({ projectionId: projection.id, id: "doc:blue:1", scopeId: "owner:local", recordType: "artifact", recordId: "a1", recordVersion: "1", content: "one", searchableText: "one" });
  assert.throws(() => oracle.activateProjection({ projectionId: projection.id, expectedSelectedRecords: 2 }), (error) => error.code === "RETRIEVAL_COVERAGE_INCOMPLETE");
  oracle.activateProjection({ projectionId: projection.id, expectedSelectedRecords: 1 }); const green = oracle.createProjection({ version: "lexical:green:v2" });
  crashPoint = "retrieval.document.index.before_commit"; assert.throws(() => oracle.indexDocument({ projectionId: green.id, id: "doc:rolled-back", scopeId: "owner:local", recordType: "artifact", recordId: "rollback", recordVersion: "1", content: "rollback secret", searchableText: "rollback secret" }), /controlled/); crashPoint = null;
  const residue = store.attachRepository(({ db }) => ({ documents: db.prepare("SELECT COUNT(*) AS count FROM retrieval_documents WHERE id='doc:rolled-back'").get().count,
    encrypted: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects WHERE object_type='retrieval-document'").get().count, fts: db.prepare("SELECT COUNT(*) AS count FROM retrieval_fts WHERE document_id='doc:rolled-back'").get().count }));
  assert.deepEqual(residue, { documents: 0, encrypted: 1, fts: 0 });
  oracle.indexDocument({ projectionId: green.id, id: "doc:green:1", scopeId: "owner:local", recordType: "artifact", recordId: "g1", recordVersion: "1", content: "green", searchableText: "green" }); oracle.activateProjection({ projectionId: green.id, expectedSelectedRecords: 1 });
  assert.equal(oracle.retrieve({ scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"], text: "green" }).projectionId, green.id);
});

test("Wave 16 enforces strict watermarks, bounded staleness, live-domain bypass, scope separation, and negative TTL", async () => {
  let nowMs = Date.parse("2026-07-25T00:00:00.000Z"); const clock = () => new Date(nowMs); const store = await core({ clock }); addScope(store); const cache = createCacheFabric({ store });
  const epoch = cache.createProjectionEpoch({ projector: "lexical", shardKey: "owner", version: "1", sourceSequence: 7 }); cache.activateProjectionEpoch(epoch.id);
  const watermark = cache.captureWatermark({ scopeId: "owner:local", canonicalSequence: 12, workingSetSequence: 4, policyVersion: "policy:v1" });
  const ns = cache.createNamespace({ kind: "record", scopeId: "owner:local", policyVersion: "policy:v1", maxEntries: 10, maxBytes: 4096 });
  cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: { record: 1 }, value: { answer: 42 }, watermark, ttlMs: 60_000 });
  assert.deepEqual(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: { record: 1 }, requiredWatermark: watermark, consistencyMode: "strict" }).value, { answer: 42 });
  assert.equal(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: { record: 1 }, requiredWatermark: { ...watermark, canonicalSequence: 13 }, consistencyMode: "strict" }).reason, "STALE_WATERMARK");
  assert.equal(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: { record: 1 }, consistencyMode: "live_domain" }).reason, "LIVE_DOMAIN_BYPASS");
  nowMs += 500; assert.equal(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: { record: 1 }, requiredWatermark: watermark, consistencyMode: "bounded_stale", maxStaleMs: 1000 }).hit, true);
  assert.throws(() => cache.get({ namespaceId: ns.id, scopeId: "project:atlas", policyVersion: "policy:v1", key: { record: 1 }, requiredWatermark: watermark }), (error) => error.code === "CACHE_SCOPE_DENIED");
  const negative = cache.createNamespace({ kind: "negative", scopeId: "owner:local", policyVersion: "policy:v1" }); cache.put({ namespaceId: negative.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "missing", value: null, watermark, ttlMs: 600_000 });
  nowMs += 30_001; assert.equal(cache.get({ namespaceId: negative.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "missing", requiredWatermark: watermark }).reason, "EXPIRED");
});

test("Wave 16 invalidates exact dependencies, supports generation purge and stampede leases, and shreds provider handles", async () => {
  const store = await core(); const cache = createCacheFabric({ store }); const watermark = cache.captureWatermark({ scopeId: "owner:local", canonicalSequence: 3, policyVersion: "policy:v1" });
  const ns = cache.createNamespace({ kind: "context", scopeId: "owner:local", policyVersion: "policy:v1" }); const cached = cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "ctx", value: "cached", watermark,
    dependencies: [{ type: "assertion", id: "assertion:1", version: "1" }] }); assert.deepEqual(cache.invalidateDependency("assertion", "assertion:1"), [cached.id]);
  assert.equal(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "ctx", requiredWatermark: watermark }).hit, false);
  cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "new", value: "value", watermark }); assert.equal(cache.advanceGeneration(ns.id).generation, 2);
  assert.equal(cache.get({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "new", requiredWatermark: watermark }).hit, false);
  const first = cache.acquire({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "stampede", leaseOwner: "worker:a" }); const second = cache.acquire({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "stampede", leaseOwner: "worker:b" });
  assert.equal(first.acquired, true); assert.equal(second.acquired, false); assert.equal(cache.release({ namespaceId: ns.id, key: "stampede", leaseOwner: "worker:a" }).released, true);
  const provider = cache.createNamespace({ kind: "provider", scopeId: "owner:local", policyVersion: "policy:v1" }); const ref = cache.putProviderRef({ namespaceId: provider.id, scopeId: "owner:local", policyVersion: "policy:v1", provider: "fixture", model: "fixture", handle: "provider-secret-handle", prefix: "safe prefix", expiresAt: "2030-01-01T00:00:00.000Z" });
  assert.equal(cache.deleteProviderRef(ref.id).deleted, true); const providerState = store.attachRepository(({ db }) => db.prepare("SELECT status,handle_encrypted_id FROM provider_cache_refs WHERE id=?").get(ref.id)); assert.deepEqual(providerState, { status: "deleted", handle_encrypted_id: null });
});

test("Wave 17 routes selected records, skips exact-only content, caches by content hash, and degrades without adapters", async () => {
  const store = await core(); let calls = 0; const gateway = createEmbeddingGateway({ store, adapters: { local: { async embed() { calls += 1; return { vector: [1, 0, 0, 0], inputUnits: 4, costUsd: 0 }; } } } }); const profile = localProfile(gateway);
  const skipped = await gateway.embed({ scopeId: "owner:local", recordType: "artifact", recordId: "exact", recordVersion: "1", profileId: profile.id, content: "KXEXACT", projectionPolicy: "exact_only" });
  assert.equal(skipped.status, "skipped"); assert.equal((await gateway.embed({ scopeId: "owner:local", recordType: "artifact", recordId: "exact", recordVersion: "1", profileId: profile.id, content: "KXEXACT", projectionPolicy: "exact_only" })).replayed, true);
  const first = await gateway.embed({ scopeId: "owner:local", recordType: "artifact", recordId: "one", recordVersion: "1", profileId: profile.id, content: "semantic content", sensitivity: "private" });
  const second = await gateway.embed({ scopeId: "owner:local", recordType: "artifact", recordId: "two", recordVersion: "1", profileId: profile.id, content: "semantic content", sensitivity: "private" });
  assert.equal(first.replayed, false); assert.equal(second.cached, true); assert.equal(calls, 1); assert.equal(gateway.health().dailyCostUsd, 0);
  const noAdapter = createEmbeddingGateway({ store }); const other = localProfile(noAdapter, 3, "offline"); const degraded = await noAdapter.embed({ scopeId: "owner:local", recordType: "artifact", recordId: "offline", recordVersion: "1", profileId: other.id, content: "offline semantic" });
  assert.equal(degraded.degraded, true); assert.deepEqual(degraded.fallbackLanes, ["exact", "lexical", "graph", "task"]);
});

test("Wave 17 denies private cloud routes, rejects invalid and mixed vectors, and activates only complete blue-green indexes", async () => {
  const store = await core(); const gateway = createEmbeddingGateway({ store }); const p4 = localProfile(gateway, 4, "four"); const p3 = localProfile(gateway, 3, "three");
  const cloud = gateway.registerProfile({ provider: "cloud-fixture", model: "cloud", dimensions: 4, lane: "cloud" });
  assert.throws(() => gateway.requestEmbedding({ scopeId: "owner:local", recordType: "artifact", recordId: "private", recordVersion: "1", profileId: cloud.id, content: "private", sensitivity: "private", cloudEligible: true }), (error) => error.code === "EMBEDDING_CLOUD_DENIED");
  const q1 = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "artifact", recordId: "one", recordVersion: "1", profileId: p4.id, content: "one" }); assert.throws(() => gateway.completeEmbedding({ requestId: q1.id, vector: [1, 0] }), (error) => error.code === "EMBEDDING_VECTOR_INVALID");
  const r1 = gateway.completeEmbedding({ requestId: q1.id, vector: [1, 0, 0, 0] }); const q2 = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "artifact", recordId: "two", recordVersion: "1", profileId: p4.id, content: "two" }); const r2 = gateway.completeEmbedding({ requestId: q2.id, vector: [0, 1, 0, 0] });
  const q3 = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "artifact", recordId: "three", recordVersion: "1", profileId: p3.id, content: "three" }); const r3 = gateway.completeEmbedding({ requestId: q3.id, vector: [1, 0, 0] });
  const index = gateway.createIndex({ profileId: p4.id, version: "blue:v1", selectedRecordCount: 2 }); gateway.addToIndex(index.id, [r1.recordId]); assert.throws(() => gateway.activateIndex(index.id), (error) => error.code === "VECTOR_COVERAGE_INCOMPLETE");
  assert.throws(() => gateway.addToIndex(index.id, [r3.recordId]), (error) => error.code === "EMBEDDING_SPACE_MISMATCH"); gateway.addToIndex(index.id, [r2.recordId]); gateway.activateIndex(index.id);
  const result = gateway.search({ profileId: p4.id, vector: [1, 0, 0, 0], scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"] }); assert.equal(result.hits[0].recordId, "one");
  assert.throws(() => gateway.search({ indexId: index.id, profileId: p3.id, vector: [1, 0, 0], scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"] }), (error) => error.code === "EMBEDDING_SPACE_MISMATCH");
});

test("Waves 15-17 correction propagation purges lexical, cache, vector, and encrypted copies atomically", async () => {
  const store = await core(); const assertions = createAssertionService({ store }); const maintenance = createTruthMaintenance({ store }); const assertion = assertions.createAssertion({ id: "assertion:propagate", scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "favorite_market", object: "old-market", epistemicState: "owner_asserted", createdBy: "local-owner" });
  const { oracle, projection } = buildOracle(store, "propagation:v1"); const document = oracle.indexDocument({ projectionId: projection.id, scopeId: "owner:local", recordType: "assertion", recordId: assertion.id, recordVersion: "1", sourceType: "assertion", sourceId: assertion.id, content: "old-market", searchableText: "old-market" }); oracle.activateProjection({ projectionId: projection.id, expectedSelectedRecords: 1 });
  const cache = createCacheFabric({ store }); const watermark = cache.captureWatermark({ scopeId: "owner:local", canonicalSequence: 1 }); const ns = cache.createNamespace({ kind: "record", scopeId: "owner:local", policyVersion: "policy:v1" }); const cached = cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: assertion.id, value: "old-market", watermark, dependencies: [{ type: "assertion", id: assertion.id, version: "1" }] });
  const gateway = createEmbeddingGateway({ store }); const profile = localProfile(gateway); const req = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "assertion", recordId: assertion.id, recordVersion: "1", profileId: profile.id, content: "old-market" }); const embedded = gateway.completeEmbedding({ requestId: req.id, vector: [1, 0, 0, 0] }); const index = gateway.createIndex({ profileId: profile.id, version: "propagation:v1", selectedRecordCount: 1 }); gateway.addToIndex(index.id, [embedded.recordId]); gateway.activateIndex(index.id);
  const preview = maintenance.previewCorrection({ scopeId: "owner:local", subjectType: "owner", subjectRef: "local-owner", predicate: "favorite_market", oldObject: "old-market", newObject: "new-market", mode: "never_true" }); const corrected = maintenance.applyCorrection({ commandId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  assert.equal(corrected.invalidated.some((item) => item.type === "retrieval_document" && item.id === document.id), true); assert.equal(corrected.invalidated.some((item) => item.type === "cache_entry" && item.id === cached.id), true); assert.equal(corrected.invalidated.some((item) => item.type === "embedding_record" && item.id === embedded.recordId), true);
  const state = store.attachRepository(({ db }) => ({ document: db.prepare("SELECT status,content_encrypted_id FROM retrieval_documents WHERE id=?").get(document.id), cache: db.prepare("SELECT status,payload_encrypted_id FROM cache_entries WHERE id=?").get(cached.id), vector: db.prepare("SELECT status,vector_encrypted_id FROM embedding_records WHERE id=?").get(embedded.recordId), members: db.prepare("SELECT COUNT(*) AS count FROM vector_index_members WHERE embedding_record_id=?").get(embedded.recordId).count }));
  assert.deepEqual(state, { document: { status: "deleted", content_encrypted_id: null }, cache: { status: "invalidated", payload_encrypted_id: null }, vector: { status: "deleted", vector_encrypted_id: null }, members: 0 });
});

test("Waves 15-17 owner-forget verifies deletion closure across lexical, cache, and vector projections", async () => {
  const store = await core(); const personal = createPersonalMemoryService({ store }); const maintenance = createTruthMaintenance({ store });
  const preference = personal.createPreference({ id: "preference:projection-forget", scopeId: "owner:local", subjectRef: "local-owner", domain: "research", value: "private-research-preference", origin: "explicit_owner", createdBy: "local-owner", authorityZone: "owner" });
  const { oracle, projection } = buildOracle(store, "forget:v1"); const document = oracle.indexDocument({ projectionId: projection.id, scopeId: "owner:local", recordType: "preference", recordId: preference.id, recordVersion: "1", sourceType: "preference", sourceId: preference.id, content: "private-research-preference", searchableText: "private-research-preference" }); oracle.activateProjection({ projectionId: projection.id, expectedSelectedRecords: 1 });
  const cache = createCacheFabric({ store }); const watermark = cache.captureWatermark({ scopeId: "owner:local" }); const ns = cache.createNamespace({ kind: "record", scopeId: "owner:local", policyVersion: "policy:v1" }); const cached = cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: preference.id, value: "private-research-preference", watermark, dependencies: [{ type: "preference", id: preference.id, version: "1" }] });
  const gateway = createEmbeddingGateway({ store }); const profile = localProfile(gateway); const request = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "preference", recordId: preference.id, recordVersion: "1", profileId: profile.id, content: "private-research-preference" }); const embedded = gateway.completeEmbedding({ requestId: request.id, vector: [1, 0, 0, 0] });
  const preview = maintenance.previewForget({ scopeId: "owner:local", targetType: "preference", targetId: preference.id }); maintenance.authorizeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" }); const result = maintenance.executeForget({ jobId: preview.id, actorId: "local-owner", authorityZone: "owner" });
  assert.equal(result.verified, true); assert.equal(result.invalidatedCopyCount, 3); const receipt = maintenance.readDeletionReceipt(preview.id); assert.equal(receipt.dependencyIds.includes(`retrieval_document:${document.id}`), true); assert.equal(receipt.dependencyIds.includes(`cache_entry:${cached.id}`), true); assert.equal(receipt.dependencyIds.includes(`embedding_record:${embedded.recordId}`), true);
  const residues = store.attachRepository(({ db }) => ({ activeDocuments: db.prepare("SELECT COUNT(*) AS count FROM retrieval_documents WHERE id=? AND status='active'").get(document.id).count, activeCache: db.prepare("SELECT COUNT(*) AS count FROM cache_entries WHERE id=? AND status='active'").get(cached.id).count, activeVectors: db.prepare("SELECT COUNT(*) AS count FROM embedding_records WHERE id=? AND status='active'").get(embedded.recordId).count })); assert.deepEqual(residues, { activeDocuments: 0, activeCache: 0, activeVectors: 0 });
});

test("Waves 15-17 controlled faults leave no partial cache payload, embedding vector, receipt, or vector activation", async () => {
  let crashPoint = null; const store = await core({ faultInjector(point) { if (point === crashPoint) throw new Error(`controlled ${point}`); } }); const cache = createCacheFabric({ store }); const watermark = cache.captureWatermark({ scopeId: "owner:local" }); const ns = cache.createNamespace({ kind: "record", scopeId: "owner:local", policyVersion: "policy:v1" });
  crashPoint = "cache.put.before_commit"; assert.throws(() => cache.put({ namespaceId: ns.id, scopeId: "owner:local", policyVersion: "policy:v1", key: "fault", value: "must rollback", watermark }), /controlled/); crashPoint = null;
  const gateway = createEmbeddingGateway({ store }); const profile = localProfile(gateway); const req = gateway.requestEmbedding({ scopeId: "owner:local", recordType: "artifact", recordId: "fault", recordVersion: "1", profileId: profile.id, content: "fault vector" });
  crashPoint = "embedding.complete.before_commit"; assert.throws(() => gateway.completeEmbedding({ requestId: req.id, vector: [1, 0, 0, 0] }), /controlled/); crashPoint = null;
  const state = store.attachRepository(({ db }) => ({ cacheEntries: db.prepare("SELECT COUNT(*) AS count FROM cache_entries").get().count, cachePayloads: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects WHERE object_type='cache-entry'").get().count,
    requestStatus: db.prepare("SELECT status FROM embedding_requests WHERE id=?").get(req.id).status, records: db.prepare("SELECT COUNT(*) AS count FROM embedding_records").get().count, receipts: db.prepare("SELECT COUNT(*) AS count FROM embedding_receipts").get().count, vectors: db.prepare("SELECT COUNT(*) AS count FROM encrypted_objects WHERE object_type='embedding-vector'").get().count }));
  assert.deepEqual(state, { cacheEntries: 0, cachePayloads: 0, requestStatus: "queued", records: 0, receipts: 0, vectors: 0 });
});
