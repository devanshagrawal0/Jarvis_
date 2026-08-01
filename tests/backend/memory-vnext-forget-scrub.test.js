"use strict";

// A-01 regression: conversational "forget" must actually delete.
//
// The shipped behaviour revised the assertion to `retracted`, dropped the retrieval documents,
// and returned `changed: true` — while `identity_attributes` stayed `status='active'` with its
// encrypted value intact and the superseded assertion version still decrypted to the old number.
// The owner was told a value was forgotten while it remained fully readable in two places.
//
// These assertions are written to fail against that behaviour. Reverting the fix in
// `personal-context-router.js` must turn them red — verified by mutation, not assumed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openCoreStore, createMemoryMigration, createCandidateProjector, createPersonalContextRouter } = require("../../server/memory-vnext");

const stores = []; const roots = [];
function protector() { return { protect: (bytes) => Buffer.from(bytes), unprotect: (bytes) => Buffer.from(bytes) }; }

test.afterEach(() => {
  while (stores.length) { try { stores.pop().close(); } catch {} }
  while (roots.length) { try { fs.rmSync(roots.pop(), { recursive: true, force: true }); } catch {} }
});

async function projectedStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-forget-scrub-")); roots.push(root);
  const store = await openCoreStore({ runtimeDir: root, allowUnsafeTestPath: true, keyProtector: protector() }); stores.push(store);
  const migration = createMemoryMigration({ store });
  const run = migration.createRun({
    id: "forget-import", inventoryHash: "forget", snapshotSetHash: "forget",
    sources: [{ sourceKey: "profile", snapshotPath: "closed", snapshotSha256: "p", table: "personal_profile_items", expectedRows: 1 }],
  });
  migration.stageRecords({ sourceId: run.sources[0].id, rows: [{ id: "style", category: "answer_style", key: "detail", value: "Explain clearly", confidence: 1, privacy_level: "private", source: "user", status: "active" }] });
  for (const batchType of ["protected", "procedure", "domain_manifest", "scope", "sample"]) {
    const batch = migration.createReviewBatch({ runId: run.id, batchType, actorId: "local-owner", limit: 1000 });
    if (batch.candidateIds.length) migration.decideReviewBatch({ batchId: batch.id, actorId: "local-owner", authorityZone: "owner", decisions: batch.candidateIds.map((candidateId) => ({ candidateId, decision: "accept", scopeId: "owner:local", reasonCode: "OWNER_TEST_ACCEPTED" })) });
  }
  assert.equal(migration.reconcile({ runId: run.id }).passed, true);
  createCandidateProjector({ store }).project({ runId: run.id, version: "forget-projection:v1" });
  return store;
}

// Reads straight past every service abstraction. The point is that NOTHING on disk still holds
// the value — a service-level "is it gone?" could be satisfied by a filter that merely hides it.
// Presence of the ciphertext row IS readability: the keyring that wrote it is still open, so a
// surviving `encrypted_objects` row means the value can be recovered. Testing for the row rather
// than decrypting avoids depending on a decrypt helper the repository context does not expose,
// and it is the stricter question — "is it still on disk", not "does this API still show it".
function rawResidue(store, predicate) {
  return store.attachRepository(({ db }) => {
    const identity = db.prepare("SELECT id,status,value_encrypted_id FROM identity_attributes WHERE predicate=?").all(predicate);
    const payloadExists = (id) => Boolean(id) && Boolean(db.prepare("SELECT 1 FROM encrypted_objects WHERE id=?").get(id));
    const readableIdentity = identity
      .filter((row) => payloadExists(row.value_encrypted_id))
      .map((row) => ({ id: row.id, status: row.status }));
    const versions = db.prepare(`
      SELECT v.id, v.object_encrypted_id FROM assertion_versions v
      JOIN assertions a ON a.id = v.assertion_id WHERE a.predicate = ?`).all(predicate);
    const versionValues = versions.filter((row) => payloadExists(row.object_encrypted_id)).map((row) => row.id);
    return {
      identityRows: identity.length,
      activeIdentityRows: identity.filter((row) => row.status === "active").length,
      readableIdentity,
      versionValues,
    };
  });
}

test("A-01 — conversational forget scrubs the value instead of only retracting the assertion", async () => {
  const store = await projectedStore();
  const router = createPersonalContextRouter({ store });

  router.ingestOwnerTurn({ conversationId: "c", branchId: "c:main", clientEventId: "t1", content: "I weigh 82 kg." });

  const before = rawResidue(store, "health.weight_kg");
  assert.ok(before.activeIdentityRows >= 1, "precondition: the fact should be stored as an active identity attribute");
  assert.ok(before.readableIdentity.length >= 1, "precondition: the stored value should be readable before forgetting");

  const turn = router.ingestOwnerTurn({ conversationId: "c", branchId: "c:main", clientEventId: "t2", content: "Forget my weight." });
  const forget = (turn.mutations || []).find((item) => item.action === "forget");
  assert.ok(forget, "the forget intent should be recognised");

  const after = rawResidue(store, "health.weight_kg");

  // The core of A-01: these three failed before the fix.
  assert.equal(after.activeIdentityRows, 0, `identity_attributes still has ${after.activeIdentityRows} active row(s) after forget`);
  assert.deepEqual(after.readableIdentity, [], `the forgotten value is still decryptable: ${JSON.stringify(after.readableIdentity)}`);
  assert.deepEqual(after.versionValues, [], `a prior assertion version still decrypts to the forgotten value: ${JSON.stringify(after.versionValues)}`);

  // And the report to the owner must match reality.
  assert.equal(forget.changed, true, "forget reported no change despite having work to do");
});

test("A-01 — forget never reports success while the value is still readable", async () => {
  const store = await projectedStore();
  const router = createPersonalContextRouter({ store });
  router.ingestOwnerTurn({ conversationId: "c", branchId: "c:main", clientEventId: "t1", content: "I weigh 82 kg." });
  const turn = router.ingestOwnerTurn({ conversationId: "c", branchId: "c:main", clientEventId: "t2", content: "Forget my weight." });
  const forget = (turn.mutations || []).find((item) => item.action === "forget");

  const residue = rawResidue(store, "health.weight_kg");
  const stillReadable = residue.readableIdentity.length > 0 || residue.versionValues.length > 0;

  // The invariant that matters more than the deletion itself: the claim must track the truth.
  // `changed: true` while anything is still readable is the false confirmation A-01 describes.
  assert.equal(
    forget.changed && stillReadable, false,
    `forget claimed changed:true while data remained readable — ${JSON.stringify({ identity: residue.readableIdentity, versions: residue.versionValues })}`,
  );
  if (!forget.changed) assert.ok(forget.reason, "a refused forget must carry a reason the caller can surface");
});

test("A-01 — forgetting something never stored is reported honestly, not as a deletion", async () => {
  const store = await projectedStore();
  const router = createPersonalContextRouter({ store });
  const turn = router.ingestOwnerTurn({ conversationId: "c", branchId: "c:main", clientEventId: "t1", content: "Forget my weight." });
  const forget = (turn.mutations || []).find((item) => item.action === "forget");
  assert.ok(forget, "the forget intent should still be recognised");
  assert.equal(forget.changed, false, "nothing was stored, so nothing can have been deleted");
});
