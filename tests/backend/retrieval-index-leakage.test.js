"use strict";

// A-13 — the retrieval index stored a deterministic HMAC of every character TRIGRAM of every word
// in a plain table beside the ciphertext. Character trigrams live in a space of a few thousand
// values with famously stable English frequencies, and consecutive trigrams of a word overlap by
// two characters — so an attacker with the DB file but not the DPAPI-wrapped master key could map
// hash→trigram by frequency and CHAIN the overlaps back into words and sentences, without
// touching AES-GCM.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const { openCoreStore, createRetrievalOracle } = require("../../server/memory-vnext");

const stores = [];
const dirs = [];
test.afterEach(() => {
  while (stores.length) { try { stores.pop().close(); } catch { /* closed */ } }
  while (dirs.length) { try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* locked */ } }
});
async function oracle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-fts-"));
  dirs.push(dir);
  const store = await openCoreStore({ runtimeDir: dir, allowUnsafeTestPath: true, keyProtector: { protect: (b) => Buffer.from(b), unprotect: (b) => Buffer.from(b) } });
  stores.push(store);
  return { store, oracle: createRetrievalOracle({ store }) };
}

test("A-13 — no character-trigram tokens are emitted at all", async () => {
  const { oracle: ret } = await oracle();
  const tokens = ret.tokenStream("the quick brown foxes jumped").split(" ").filter(Boolean);
  assert.ok(tokens.length > 0, "precondition: the stream must produce tokens");
  assert.equal(tokens.filter((token) => token.startsWith("g")).length, 0,
    "a sliding trigram window is what let an attacker chain hashes back into words");
});

test("A-13 — tokens per word collapse from (length - 2) to at most 2", async () => {
  const { oracle: ret } = await oracle();
  // "encyclopedia" is 12 chars: the old scheme emitted 1 word token + 10 overlapping trigrams.
  const tokens = ret.tokenStream("encyclopedia").split(" ").filter(Boolean);
  assert.equal(tokens.length, 2, `expected a word token plus one stem token, got ${tokens.length}`);
  assert.equal(tokens.filter((t) => t.startsWith("w")).length, 1);
  assert.equal(tokens.filter((t) => t.startsWith("s")).length, 1);
});

test("A-13 — the replacement keeps inflected forms matching, which is why it is a stem and not nothing", async () => {
  // Removing trigrams outright broke this, and a capability regression hidden behind a security
  // fix is still a regression. The stem token is what makes the trade acceptable.
  const { oracle: ret } = await oracle();
  const shared = (left, right) => {
    const a = new Set(ret.tokenStream(left).split(" ").filter(Boolean));
    return ret.tokenStream(right).split(" ").filter(Boolean).some((token) => a.has(token));
  };
  assert.equal(shared("project", "projects"), true, "inflections must still meet in the index");
  assert.equal(shared("preference", "preferences"), true);
  assert.equal(shared("weight", "elephant"), false, "unrelated words must not collide");
});

test("A-13 — short words get no stem token, so no prefix is leaked for them", async () => {
  const { oracle: ret } = await oracle();
  for (const word of ["run", "cat", "goal", "kalshi"]) {
    const tokens = ret.tokenStream(word).split(" ").filter(Boolean);
    assert.ok(tokens.length <= 2, `${word} should not fan out`);
  }
  assert.equal(ret.tokenStream("goal").split(" ").filter(Boolean).length, 1, "a 4-char word emits only its word token");
});

test("A-13 — the purge removes trigram tokens already sitting in the stored index", async () => {
  // Removing the emitter is only half the fix: the leak lives in the stored rows, not in the
  // code that wrote them.
  const { store, oracle: ret } = await oracle();
  const created = ret.createProjection({ version: "leak-test:v1" });
  ret.indexDocument({
    id: "doc-1", projectionId: created.id, scopeId: "owner:local", recordType: "assertion",
    recordId: "a-1", recordVersion: "v1", sensitivity: "private",
    content: { text: "encyclopedia" }, searchableText: "encyclopedia",
    sourceType: "assertion", sourceId: "a-1",
  });

  // Simulate a row written by the old scheme.
  store.attachRepository(({ db }) => db.prepare("UPDATE retrieval_fts SET token_stream=? WHERE document_id=?")
    .run("wAAA gBBB gCCC gDDD sEEE", "doc-1"));

  const result = ret.stripLegacyTrigramTokens();
  assert.equal(result.rewritten, 1);
  assert.equal(result.tokensRemoved, 3);

  const after = store.attachRepository(({ db }) => db.prepare("SELECT token_stream FROM retrieval_fts WHERE document_id=?").get("doc-1"));
  assert.equal(after.token_stream, "wAAA sEEE", "word and stem tokens survive; trigrams do not");
  // Idempotent — a second run must find nothing left to do.
  assert.equal(ret.stripLegacyTrigramTokens().rewritten, 0);
});

test("A-13 — retrieval still returns the document after the purge", async () => {
  const { oracle: ret } = await oracle();
  const created = ret.createProjection({ version: "recall-test:v1" });
  ret.indexDocument({
    id: "doc-2", projectionId: created.id, scopeId: "owner:local", recordType: "assertion",
    recordId: "a-2", recordVersion: "v1", sensitivity: "private",
    content: { text: "owner prefers measurable project plans" },
    searchableText: "owner prefers measurable project plans",
    sourceType: "assertion", sourceId: "a-2",
  });
  ret.activateProjection({ projectionId: created.id });
  ret.stripLegacyTrigramTokens();

  const hits = ret.retrieve({ projectionId: created.id, scopeIds: ["owner:local"], allowedScopeIds: ["owner:local"], text: "measurable projects", limit: 5 });
  assert.ok((hits.hits || hits || []).length > 0, "a security fix that empties retrieval is not a fix");
});
