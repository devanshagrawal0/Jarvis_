"use strict";

const crypto = require("node:crypto");

function createKeyHierarchy({ store, clock = () => new Date() } = {}) {
  const repository = store.attachRepository(({ db, keyring, faultInjector }) => {
    if (Number(db.pragma("user_version", { simple: true })) < 3) throw new Error("Key hierarchy requires schema version 3.");

    function insertKey({ keyId, scopeId, keyVersion, actorId, eventType }) {
      const dataKey = crypto.randomBytes(32);
      const context = { keyId, scopeId, keyVersion };
      const wrapped = keyring.wrapDataKey(dataKey, context);
      const fingerprint = crypto.createHash("sha256").update(dataKey).digest("hex").slice(0, 24);
      dataKey.fill(0);
      const now = clock().toISOString();
      db.prepare(`INSERT INTO data_keys
        (id,scope_id,key_version,state,wrapping_key_id,wrapping_key_version,wrapped_key,nonce,auth_tag,aad_json,fingerprint,created_at)
        VALUES(?,?,?,'active',?,?,?,?,?,?,?,?)`)
        .run(keyId, scopeId, keyVersion, wrapped.keyId, wrapped.keyVersion, wrapped.ciphertext, wrapped.nonce,
          wrapped.authTag, wrapped.aadJson, fingerprint, now);
      db.prepare(`INSERT INTO key_events(id,key_id,key_version,scope_id,event_type,actor_id,created_at,metadata_json)
        VALUES(?,?,?,?,?,?,?,'{}')`).run(crypto.randomUUID(), keyId, keyVersion, scopeId, eventType, actorId, now);
      return metadata(keyId, keyVersion);
    }

    function metadata(keyId, keyVersion) {
      const row = db.prepare(`SELECT id,scope_id,key_version,state,wrapping_key_id,wrapping_key_version,fingerprint,
        created_at,retired_at,destroyed_at FROM data_keys WHERE id=? AND key_version=?`).get(keyId, keyVersion);
      return row ? {
        keyId: row.id, scopeId: row.scope_id, keyVersion: row.key_version, state: row.state,
        wrappingKeyId: row.wrapping_key_id, wrappingKeyVersion: row.wrapping_key_version,
        fingerprint: row.fingerprint, createdAt: row.created_at, retiredAt: row.retired_at, destroyedAt: row.destroyed_at,
      } : null;
    }

    function activeForScope(scopeId) {
      return db.prepare("SELECT * FROM data_keys WHERE scope_id=? AND state='active' ORDER BY key_version DESC LIMIT 1").get(scopeId) || null;
    }

    function create(scopeId, actorId = "local-owner") {
      const run = db.transaction(() => {
        if (!db.prepare("SELECT 1 FROM scopes WHERE id=? AND status='active'").get(scopeId)) throw new Error("Data-key scope is unavailable.");
        if (activeForScope(scopeId)) throw new Error("Scope already has an active data key.");
        return insertKey({ keyId: crypto.randomUUID(), scopeId, keyVersion: 1, actorId, eventType: "created" });
      });
      return run.immediate();
    }

    function rotate(scopeId, actorId = "local-owner") {
      const run = db.transaction(() => {
        const current = activeForScope(scopeId);
        if (!current) return insertKey({ keyId: crypto.randomUUID(), scopeId, keyVersion: 1, actorId, eventType: "created" });
        const now = clock().toISOString();
        db.prepare("UPDATE data_keys SET state='retiring',retired_at=? WHERE id=? AND key_version=? AND state='active'")
          .run(now, current.id, current.key_version);
        faultInjector("key.rotate.after_retire");
        db.prepare(`INSERT INTO key_events(id,key_id,key_version,scope_id,event_type,actor_id,created_at,metadata_json)
          VALUES(?,?,?,?, 'retired',?,?, '{}')`).run(crypto.randomUUID(), current.id, current.key_version, scopeId, actorId, now);
        return insertKey({ keyId: current.id, scopeId, keyVersion: current.key_version + 1, actorId, eventType: "rotated" });
      });
      return run.immediate();
    }

    function withActiveKey(scopeId, callback) {
      const row = activeForScope(scopeId);
      if (!row) throw new Error("Scope has no active data key.");
      const context = { keyId: row.id, scopeId: row.scope_id, keyVersion: row.key_version };
      const key = keyring.unwrapDataKey({
        keyId: row.wrapping_key_id,
        keyVersion: row.wrapping_key_version,
        nonce: row.nonce,
        ciphertext: row.wrapped_key,
        authTag: row.auth_tag,
        aadJson: row.aad_json,
      }, context);
      try {
        if (crypto.createHash("sha256").update(key).digest("hex").slice(0, 24) !== row.fingerprint) throw new Error("Data-key fingerprint mismatch.");
        return callback(key, metadata(row.id, row.key_version));
      } finally { key.fill(0); }
    }

    function recoveryTest(scopeId, actorId = "local-owner") {
      const run = db.transaction(() => {
        const result = withActiveKey(scopeId, (_key, info) => info);
        db.prepare(`INSERT INTO key_events(id,key_id,key_version,scope_id,event_type,actor_id,created_at,metadata_json)
          VALUES(?,?,?,?, 'recovery_tested',?,?, '{}')`)
          .run(crypto.randomUUID(), result.keyId, result.keyVersion, scopeId, actorId, clock().toISOString());
        return { ok: true, ...result };
      });
      return run.immediate();
    }

    function destroyRetired(keyId, keyVersion, actorId = "local-owner") {
      const run = db.transaction(() => {
        const row = db.prepare("SELECT * FROM data_keys WHERE id=? AND key_version=?").get(keyId, Number(keyVersion));
        if (!row) throw new Error("Data key not found.");
        if (row.state !== "retiring") throw new Error("Only a retired data-key version can be destroyed.");
        const now = clock().toISOString();
        db.prepare(`UPDATE data_keys SET state='destroyed',wrapped_key=NULL,nonce=NULL,auth_tag=NULL,aad_json=NULL,destroyed_at=?
          WHERE id=? AND key_version=? AND state='retiring'`).run(now, keyId, Number(keyVersion));
        db.prepare(`INSERT INTO key_events(id,key_id,key_version,scope_id,event_type,actor_id,created_at,metadata_json)
          VALUES(?,?,?,?, 'destroyed',?,?, '{"cryptoShred":true}')`)
          .run(crypto.randomUUID(), keyId, Number(keyVersion), row.scope_id, actorId, now);
        return metadata(keyId, Number(keyVersion));
      });
      return run.immediate();
    }

    function list(scopeId) {
      return db.prepare("SELECT id,key_version FROM data_keys WHERE scope_id=? ORDER BY key_version").all(scopeId)
        .map((row) => metadata(row.id, row.key_version));
    }

    return Object.freeze({ create, destroyRetired, list, recoveryTest, rotate, withActiveKey });
  });
  return repository;
}

module.exports = { createKeyHierarchy };
