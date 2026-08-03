"use strict";

// A-18 — the same 32 bytes were the AES-256-GCM key, the direct HMAC key for `contentMac`, and
// the IKM for `hkdfSync` in `sign()`. `sign()` derived a per-purpose key; `encrypt()` and the
// content MAC did not, so one key was doing three cryptographic jobs at once.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createKeyring } = require("../../server/memory-vnext/storage/keyring");

const dirs = [];
test.afterEach(() => {
  while (dirs.length) { try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* locked */ } }
});
function keyring() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-keyring-"));
  dirs.push(dir);
  const protector = { id: "test-plain", protect: (b) => Buffer.from(b), unprotect: (b) => Buffer.from(b) };
  return { ring: createKeyring({ rootDir: dir, protector }), dir, protector };
}
function masterKeyOf(dir, protector) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, "master-key.dpapi.json"), "utf8"));
  return { doc, master: protector.unprotect(Buffer.from(doc.wrappedKey, "base64")) };
}

const AAD = { type: "test-object", scopeId: "owner:local" };

test("A-18 — round-trip still works and reports the separated scheme", () => {
  const { ring } = keyring();
  const envelope = ring.encrypt({ secret: "hello" }, AAD);
  assert.deepEqual(JSON.parse(ring.decrypt(envelope, AAD).toString("utf8")), { secret: "hello" });
  assert.equal(ring.metadata().keySeparation, "hkdf:v2");
  assert.equal(ring.metadata().legacyEnvelopesRead, 0, "a fresh store has nothing on the old path");
});

test("A-18 — the encryption key is no longer the master key", () => {
  const { ring, dir, protector } = keyring();
  const { master } = masterKeyOf(dir, protector);
  const envelope = ring.encrypt({ secret: "hello" }, AAD);
  // Reproducing the pre-fix decrypt must now FAIL — that is the separation, demonstrated rather
  // than asserted about the source.
  assert.throws(() => {
    const decipher = crypto.createDecipheriv("aes-256-gcm", master, envelope.nonce);
    decipher.setAAD(Buffer.from(envelope.aadJson, "utf8"));
    decipher.setAuthTag(envelope.authTag);
    Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  }, /unable to authenticate|bad decrypt/i);
});

test("A-18 — the content MAC key is no longer the master key either", () => {
  const { ring, dir, protector } = keyring();
  const { master } = masterKeyOf(dir, protector);
  const plaintext = Buffer.from(JSON.stringify({ secret: "hello" }), "utf8");
  const envelope = ring.encrypt({ secret: "hello" }, AAD);
  const oldMac = crypto.createHmac("sha256", master).update(plaintext).digest("hex");
  assert.notEqual(envelope.contentMac, oldMac, "the MAC must not be keyed on the master key");
});

test("A-18 — encryption, MAC and signing keys are three different keys", () => {
  const { ring, dir, protector } = keyring();
  const { master } = masterKeyOf(dir, protector);
  const derive = (purpose) => Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), Buffer.from(`jarvis-memory-vnext:${purpose}`), 32)).toString("hex");
  const keys = new Set([
    master.toString("hex"),
    derive("content-encryption:v2"),
    derive("content-mac:v2"),
    derive("ledger"),
  ]);
  assert.equal(keys.size, 4, "each purpose must have its own key material");
  // And the signing path is genuinely purpose-separated, as it already was.
  assert.notEqual(ring.sign("x", "ledger"), ring.sign("x", "cutover-transition:v1"));
});

test("A-18 — objects written before the change still decrypt, and are counted", () => {
  // This is the compatibility guarantee. If it breaks, the owner's existing memory is unreadable.
  const { ring, dir, protector } = keyring();
  const { doc, master } = masterKeyOf(dir, protector);
  const plaintext = Buffer.from(JSON.stringify({ legacy: true }), "utf8");
  const nonce = crypto.randomBytes(12);
  const encodedAad = Buffer.from(JSON.stringify(AAD), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", master, nonce);
  cipher.setAAD(encodedAad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const legacyEnvelope = {
    keyId: doc.keyId, keyVersion: doc.keyVersion, nonce, ciphertext,
    authTag: cipher.getAuthTag(), aadJson: encodedAad.toString("utf8"),
    contentMac: crypto.createHmac("sha256", master).update(plaintext).digest("hex"),
  };

  assert.deepEqual(JSON.parse(ring.decrypt(legacyEnvelope, AAD).toString("utf8")), { legacy: true });
  assert.equal(ring.metadata().legacyEnvelopesRead, 1, "old-path reads must be observable, not silent");
});

test("A-18 — the integrity checks still bite on both paths", () => {
  const { ring, dir, protector } = keyring();
  const { doc, master } = masterKeyOf(dir, protector);

  // New scheme: tampered ciphertext.
  const envelope = ring.encrypt({ secret: "hello" }, AAD);
  const tampered = { ...envelope, ciphertext: Buffer.concat([envelope.ciphertext.subarray(0, envelope.ciphertext.length - 1), Buffer.from([envelope.ciphertext[envelope.ciphertext.length - 1] ^ 0xff])]) };
  assert.throws(() => ring.decrypt(tampered, AAD));

  // New scheme: a MAC that decrypts fine but does not match must still be rejected, or the
  // legacy fallback would have quietly turned the MAC check into "either key will do".
  assert.throws(() => ring.decrypt({ ...envelope, contentMac: "00".repeat(32) }, AAD), /content MAC mismatch/);

  // Legacy scheme with a wrong-scheme MAC must also be rejected.
  const plaintext = Buffer.from(JSON.stringify({ legacy: true }), "utf8");
  const nonce = crypto.randomBytes(12);
  const encodedAad = Buffer.from(JSON.stringify(AAD), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", master, nonce);
  cipher.setAAD(encodedAad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  assert.throws(() => ring.decrypt({
    keyId: doc.keyId, keyVersion: doc.keyVersion, nonce, ciphertext,
    authTag: cipher.getAuthTag(), aadJson: encodedAad.toString("utf8"),
    contentMac: "11".repeat(32),
  }, AAD), /content MAC mismatch/);

  // AAD is still bound.
  assert.throws(() => ring.decrypt(envelope, { ...AAD, scopeId: "someone:else" }), /AAD mismatch/);
});
