"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createWindowsDpapiProtector } = require("./dpapi-protector");

function atomicJsonWrite(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { fs.chmodSync(temp, 0o600); } catch {}
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function aadBuffer(aad) {
  return Buffer.from(JSON.stringify(aad), "utf8");
}

function createKeyring({ rootDir, protector = createWindowsDpapiProtector(), clock = () => new Date() } = {}) {
  if (!rootDir) throw new Error("Keyring rootDir is required.");
  const filePath = path.join(rootDir, "master-key.dpapi.json");
  let document;
  let masterKey;
  if (fs.existsSync(filePath)) {
    document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (document.protector !== protector.id || document.formatVersion !== 1) throw new Error("Unsupported or mismatched key wrapper.");
    masterKey = protector.unprotect(Buffer.from(document.wrappedKey, "base64"));
    if (masterKey.length !== 32) throw new Error("Unwrapped master key has an invalid length.");
    const fingerprint = crypto.createHash("sha256").update(masterKey).digest("hex").slice(0, 24);
    if (fingerprint !== document.fingerprint) throw new Error("Master key fingerprint verification failed.");
  } else {
    masterKey = crypto.randomBytes(32);
    document = {
      formatVersion: 1,
      protector: protector.id,
      keyId: crypto.randomUUID(),
      keyVersion: 1,
      fingerprint: crypto.createHash("sha256").update(masterKey).digest("hex").slice(0, 24),
      wrappedKey: protector.protect(masterKey).toString("base64"),
      createdAt: clock().toISOString(),
    };
    atomicJsonWrite(filePath, document);
  }

  // A-18 — the same 32 bytes were the AES-256-GCM key, the direct HMAC key for `contentMac`, and
  // the IKM for `hkdfSync` in `sign()`. `sign()` already derived a per-purpose key; `encrypt()`
  // and the content MAC did not, so one key was doing three cryptographic jobs at once. Domain
  // separation now applies to all three.
  //
  // Deliberately no migration and no re-encryption: new writes use the derived keys, and
  // `decrypt` falls back to the raw master key for objects written before this change. The
  // fallback is unambiguous rather than a guess — AES-GCM authenticates, so a wrong key fails
  // its tag check outright. `legacyEnvelopesRead` counts how often the old path is still needed,
  // so "has everything been rewritten yet?" is an observable number, not an assumption.
  const derive = (purpose) => Buffer.from(crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), Buffer.from(`jarvis-memory-vnext:${purpose}`), 32));
  const contentKey = derive("content-encryption:v2");
  const macKey = derive("content-mac:v2");
  let legacyEnvelopesRead = 0;

  function encrypt(payload, aad) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, nonce);
    const encodedAad = aadBuffer(aad);
    cipher.setAAD(encodedAad);
    const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      keyId: document.keyId,
      keyVersion: document.keyVersion,
      nonce,
      ciphertext,
      authTag: cipher.getAuthTag(),
      aadJson: encodedAad.toString("utf8"),
      contentMac: crypto.createHmac("sha256", macKey).update(plaintext).digest("hex"),
    };
  }

  function decrypt(envelope, aad) {
    if (envelope.keyId !== document.keyId || Number(envelope.keyVersion) !== document.keyVersion) {
      throw new Error("Encrypted object references an unavailable key version.");
    }
    const encodedAad = aadBuffer(aad);
    if (encodedAad.toString("utf8") !== envelope.aadJson) throw new Error("Encrypted object AAD mismatch.");
    // Try the derived key, then the pre-A-18 raw master key. GCM authenticates, so a wrong key
    // throws here rather than returning garbage — there is no ambiguity to resolve.
    const open = (key) => {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, envelope.nonce);
      decipher.setAAD(encodedAad);
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    };
    let plaintext;
    let legacy = false;
    try {
      plaintext = open(contentKey);
    } catch (derivedError) {
      try { plaintext = open(masterKey); legacy = true; legacyEnvelopesRead += 1; }
      catch { throw derivedError; }   // report the current scheme's failure, not the fallback's
    }
    if (envelope.contentMac) {
      // An envelope written under the old scheme carries an old-scheme MAC; matching them by
      // provenance keeps the integrity check real rather than relaxing it to "either will do".
      const actual = crypto.createHmac("sha256", legacy ? masterKey : macKey).update(plaintext).digest("hex");
      const expectedBytes = Buffer.from(String(envelope.contentMac), "hex");
      const actualBytes = Buffer.from(actual, "hex");
      if (expectedBytes.length !== actualBytes.length || !crypto.timingSafeEqual(expectedBytes, actualBytes)) {
        plaintext.fill(0);
        throw new Error("Encrypted object content MAC mismatch.");
      }
    }
    return plaintext;
  }

  function sign(value, purpose = "ledger") {
    const signingKey = crypto.hkdfSync("sha256", masterKey, Buffer.alloc(0), Buffer.from(`jarvis-memory-vnext:${purpose}`), 32);
    return crypto.createHmac("sha256", signingKey).update(String(value)).digest("hex");
  }

  function wrapDataKey(dataKey, context) {
    return encrypt(Buffer.from(dataKey), { type: "wrapped-data-key", ...context });
  }

  function unwrapDataKey(envelope, context) {
    return decrypt(envelope, { type: "wrapped-data-key", ...context });
  }

  function close() { masterKey.fill(0); contentKey.fill(0); macKey.fill(0); }

  return Object.freeze({
    // A-18 — `keySeparation` states which scheme new writes use, and `legacyEnvelopesRead`
    // counts pre-separation objects still being opened, so progress toward retiring the old
    // path is a number that can be read rather than a claim.
    metadata: () => ({ keyId: document.keyId, keyVersion: document.keyVersion, fingerprint: document.fingerprint, protector: document.protector, keySeparation: "hkdf:v2", legacyEnvelopesRead }),
    encrypt,
    decrypt,
    sign,
    wrapDataKey,
    unwrapDataKey,
    close,
  });
}

module.exports = { atomicJsonWrite, createKeyring };
