"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCandidateProjector, createMemoryMigration, createMemoryVNextShadowRuntime, openCoreStore } = require("../../server/memory-vnext");
const { renderFactValue } = require("../../server/memory-vnext/shadow-runtime");

const roots = [];
function protector() { return { protect: (bytes) => Buffer.from(bytes), unprotect: (bytes) => Buffer.from(bytes) }; }
async function candidate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-shadow-runtime-")); roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector() });
  const migration = createMemoryMigration({ store });
  const run = migration.createRun({ id: "shadow-import", inventoryHash: "shadow", snapshotSetHash: "shadow", sources: [{ sourceKey: "profile", snapshotPath: "closed", snapshotSha256: "fixture", table: "personal_profile_items", expectedRows: 1 }] });
  migration.stageRecords({ sourceId: run.sources[0].id, rows: [{ id: "style", category: "answer_style", key: "detail", value: "Clear answers", confidence: 1, privacy_level: "private", source: "user", status: "active" }] });
  const batch = migration.createReviewBatch({ runId: run.id, batchType: "protected", actorId: "local-owner", limit: 10 });
  migration.decideReviewBatch({ batchId: batch.id, actorId: "local-owner", authorityZone: "owner", decisions: batch.candidateIds.map((candidateId) => ({ candidateId, decision: "accept", scopeId: "owner:local", reasonCode: "OWNER_TEST_ACCEPTED" })) });
  assert.equal(migration.reconcile({ runId: run.id }).passed, true);
  createCandidateProjector({ store }).project({ runId: run.id, version: "shadow-projection:v1" });
  store.close(); return { root, runId: run.id };
}

test.afterEach(() => { while (roots.length) { try { fs.rmSync(roots.pop(), { recursive: true, force: true }); } catch {} } });

test("shadow runtime observes real turns without answer influence or provider calls", async () => {
  const fixture = await candidate(); const logs = [];
  const runtime = createMemoryVNextShadowRuntime({ runtimeDir: fixture.root, importRunId: fixture.runId, storeOptions: { allowUnsafeTestPath: true, keyProtector: protector() }, logger: { info: (value) => logs.push(value), error: (value) => logs.push(value) } });
  await runtime.start();
  const queued = runtime.observeTurn({ prompt: "I weigh 82 kg.", assistantMessage: "Noted.", source: "chat", sessionId: "owner-session", turnId: "turn-one", legacyRefs: ["legacy:one"], legacyLatencyMs: 4 });
  assert.equal(queued.queued, true); const status = await runtime.flush();
  assert.equal(status.mode, "shadow_only"); assert.equal(status.legacyAnswersAuthoritative, true); assert.equal(status.answerInfluence, false); assert.equal(status.providerCalls, 0); assert.equal(status.incrementalCostUsd, 0);
  assert.equal(status.state, "shadowing", JSON.stringify(status));
  assert.ok(status.persisted, JSON.stringify(status));
  assert.equal(status.runtime.processed, 1); assert.equal(status.persisted.counts.ownerTurns, 1); assert.equal(status.persisted.counts.assistantTurns, 1); assert.equal(status.persisted.counts.intents, 1); assert.equal(status.persisted.counts.replayed, 1); assert.equal(status.persisted.counts.comparisons, 1); assert.equal(status.persisted.session.legacy_answers_authoritative, 1); assert.equal(status.persisted.session.duplicate_provider_calls, 0);
  await runtime.close(); assert.equal(runtime.status().state, "closed"); assert.ok(logs.some((line) => /legacy answers remain authoritative/.test(line)));
});

test("shadow runtime isolates HELIX turns and disabled mode fails open", async () => {
  const fixture = await candidate(); const runtime = createMemoryVNextShadowRuntime({ runtimeDir: fixture.root, importRunId: fixture.runId, storeOptions: { allowUnsafeTestPath: true, keyProtector: protector() }, logger: { info() {}, error() {} } });
  await runtime.start(); runtime.observeTurn({ prompt: "HELIX private research", assistantMessage: "room output", source: "helix", turnId: "helix-turn" }); const isolated = await runtime.flush(); assert.equal(isolated.state, "shadowing", JSON.stringify(isolated)); assert.ok(isolated.persisted, JSON.stringify(isolated)); assert.equal(isolated.runtime.processed, 0); assert.equal(isolated.persisted.counts.intents, 0); await runtime.close();
  const disabled = createMemoryVNextShadowRuntime({ runtimeDir: fixture.root, importRunId: fixture.runId, enabled: false, logger: { info() {}, error() {} } }); assert.equal(disabled.observeTurn({ prompt: "hello" }).queued, false); assert.equal(disabled.status().state, "disabled"); assert.equal(disabled.status().legacyAnswersAuthoritative, true);
});

test("guarded canary supplies only eligible low-risk context and keeps rooms isolated", async () => {
  const fixture = await candidate();
  const runtime = createMemoryVNextShadowRuntime({ runtimeDir: fixture.root, importRunId: fixture.runId, canaryEnabled: true, storeOptions: { allowUnsafeTestPath: true, keyProtector: protector() }, logger: { info() {}, error() {} } });
  await runtime.start();
  runtime.observeTurn({ prompt: "My fitness goal is to build strength.", assistantMessage: "Noted.", source: "chat", sessionId: "owner-session", turnId: "canary-goal-seed" });
  runtime.observeTurn({ prompt: "I weigh 82 kg.", assistantMessage: "Noted.", source: "chat", sessionId: "owner-session", turnId: "canary-health-seed" });
  await runtime.flush();

  const prepared = await runtime.prepareCanaryContext({ prompt: "What should I do for my fitness goal?", source: "chat", sessionId: "owner-session", turnId: "canary-query" });
  assert.equal(prepared.delivered, true, JSON.stringify(prepared));
  assert.match(prepared.contextText, /goal\.fitness/);
  assert.doesNotMatch(prepared.contextText, /health\.weight_kg/);
  assert.equal(prepared.providerCalls, 0);

  const isolated = await runtime.prepareCanaryContext({ prompt: "Use my fitness goal", source: "helix", sessionId: "owner-session", turnId: "canary-helix" });
  assert.equal(isolated.delivered, false);
  assert.equal(isolated.reason, "room_isolated");

  runtime.observeTurn({ prompt: "What should I do for my fitness goal?", assistantMessage: "Try a mobility session.", source: "chat", sessionId: "owner-session", turnId: "canary-query", answerInfluence: true });
  const status = await runtime.flush();
  assert.equal(status.mode, "guarded_context_canary");
  assert.equal(status.answerInfluence, true);
  assert.equal(status.legacyAnswersAuthoritative, true);
  assert.equal(status.runtime.canary.delivered, 1);
  assert.equal(status.providerCalls, 0);
  assert.equal(status.runtime.failures, 0);

  runtime.observeTurn({ prompt: "Forget my fitness goal.", assistantMessage: "Removed.", source: "chat", sessionId: "owner-session", turnId: "canary-forget" });
  await runtime.flush();
  runtime.observeTurn({ prompt: "My fitness goal is to improve strength.", assistantMessage: "Noted again.", source: "chat", sessionId: "owner-session", turnId: "canary-reseed" });
  const reseeded = await runtime.flush();
  assert.equal(reseeded.runtime.failures, 0, reseeded.runtime.lastError);
  await runtime.close();
});

// Covers a bug that shipped and survived the whole suite, because the suite only ever checked
// what was EXCLUDED. It hid precisely because this fixture's predicates matched the allowlist
// while the real import's did not — so this asserts the filter ADMITS, which nothing else did.
test("guarded canary delivers fact text, never serialized rows, and admits something", async () => {
  const fixture = await candidate();
  const runtime = createMemoryVNextShadowRuntime({ runtimeDir: fixture.root, importRunId: fixture.runId, canaryEnabled: true, storeOptions: { allowUnsafeTestPath: true, keyProtector: protector() }, logger: { info() {}, error() {} } });
  await runtime.start();
  runtime.observeTurn({ prompt: "My fitness goal is to build strength.", assistantMessage: "Noted.", source: "chat", sessionId: "owner-session", turnId: "render-seed" });
  await runtime.flush();

  const prepared = await runtime.prepareCanaryContext({ prompt: "What should I do for my fitness goal?", source: "chat", sessionId: "owner-session", turnId: "render-query" });

  // The filter must ADMIT, not merely exclude. A guard that rejects everything passes every
  // privacy check ever written — that is exactly how the canary delivered nothing for two days
  // while its counters and leak checks stayed green.
  assert.equal(prepared.delivered, true, `retrieval admitted nothing: ${JSON.stringify(prepared)}`);
  assert.ok(prepared.predicates.length > 0, "at least one candidate fact must survive the allowlist");
  assert.ok(prepared.candidateFactCount >= prepared.predicates.length, "candidate count must be reported for diagnosis");

  // Raw chat transcript is the bulk of the candidate set and is what the guarded phase exists
  // to keep out of the prompt.
  assert.doesNotMatch(prepared.contextText, /^- memory\.conversation:/m, "raw conversation transcript was admitted");

  await runtime.close();
});

// Tested as a pure function on purpose. Asserting "no JSON in the delivered text" against the
// integration fixture is vacuous — that fixture's values are already strings, so the assertion
// passes just as happily with the bug reinstated (verified by mutation). The real import's
// values are whole legacy rows, and only a direct test reaches that shape.
test("fact values render as their text, never as the whole legacy row", () => {
  const row = {
    id: "b5f2c357", kind: "semantic", category: "personal", text: "User's name is Dev",
    source: "extractor:session", confidence: 1, importance: 0.9,
    created_at: "2026-07-16T23:43:33.383Z", updated_at: "2026-07-16T23:43:33.383Z",
    expires_at: null, supersedes_id: null, deleted_at: null, last_accessed_at: null,
  };
  assert.equal(renderFactValue(row), "User's name is Dev");
  assert.doesNotMatch(renderFactValue(row), /created_at|confidence|supersedes_id/);

  // Field precedence: the narrowest human-readable field wins.
  assert.equal(renderFactValue({ title: "T", content: "C", summary: "S", text: "X" }), "X");
  assert.equal(renderFactValue({ title: "T", content: "C", summary: "S" }), "C");
  assert.equal(renderFactValue({ title: "T", summary: "S" }), "S");
  assert.equal(renderFactValue({ title: "T" }), "T");

  // Strings pass through untouched; blank fields do not win over later ones.
  assert.equal(renderFactValue("already text"), "already text");
  assert.equal(renderFactValue({ text: "   ", content: "real" }), "real");

  // A row with no readable field must still be legible rather than silently dropped — the
  // fallback keeps it visible so the junk is diagnosable instead of invisible.
  assert.equal(renderFactValue({ id: "x", created_at: "2026" }), '{"id":"x","created_at":"2026"}');
  assert.equal(renderFactValue(null), "");
  assert.equal(renderFactValue(42), "42");
});
