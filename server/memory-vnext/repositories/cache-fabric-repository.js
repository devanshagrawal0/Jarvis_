"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }

function createCacheFabricRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 14) throw new Error("Coherent cache fabric requires schema version 14.");
  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function decrypt(id) { if (!id) return null; const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id); if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8")); }
  function digest(value, domain) { return keyring.sign(JSON.stringify(canonical(value)), domain); }
  function namespace(id) { const row = db.prepare("SELECT * FROM cache_namespaces WHERE id=?").get(String(id)); if (!row) throw new Error("Cache namespace is unavailable."); return row; }
  function metric(namespaceId, type, bytes = 0, latency = 0) { db.prepare("INSERT INTO cache_metrics(id,namespace_id,metric_type,byte_size,latency_ms,created_at) VALUES(?,?,?,?,?,?)")
    .run(crypto.randomUUID(), namespaceId, type, Math.max(0, Number(bytes)), Math.max(0, Number(latency)), clock().toISOString()); }

  function createProjectionEpoch(input = {}) {
    const next = Number(input.epoch || db.prepare("SELECT COALESCE(MAX(epoch),0)+1 AS next FROM projection_epochs WHERE projector=? AND shard_key=?").get(String(input.projector), String(input.shardKey || "default")).next);
    const id = String(input.id || crypto.randomUUID()); db.prepare("INSERT INTO projection_epochs(id,projector,shard_key,projection_version,source_sequence,epoch,state,created_at,activated_at) VALUES(?,?,?,?,?,?,'building',?,NULL)")
      .run(id, String(input.projector), String(input.shardKey || "default"), String(input.version), Math.max(0, Number(input.sourceSequence || 0)), next, clock().toISOString()); return { id, epoch: next, state: "building" };
  }
  function activateProjectionEpoch(id) { const run = db.transaction(() => { const row = db.prepare("SELECT * FROM projection_epochs WHERE id=? AND state='building'").get(String(id)); if (!row) throw new Error("Building projection epoch is unavailable."); const now = clock().toISOString();
    db.prepare("UPDATE projection_epochs SET state='retiring' WHERE projector=? AND shard_key=? AND state='active'").run(row.projector, row.shard_key); db.prepare("UPDATE projection_epochs SET state='active',activated_at=? WHERE id=?").run(now, row.id); return { id: row.id, epoch: row.epoch, state: "active" }; }); return run.immediate(); }
  function activeEpochs() { return Object.fromEntries(db.prepare("SELECT projector,shard_key,epoch FROM projection_epochs WHERE state='active' ORDER BY projector,shard_key").all().map((row) => [`${row.projector}:${row.shard_key}`, row.epoch])); }
  function captureWatermark(input = {}) { const id = String(input.id || crypto.randomUUID()); const canonicalSequence = Number(input.canonicalSequence ?? db.prepare("SELECT value FROM sequence_state WHERE name='canonical'").get()?.value ?? 0);
    const epochs = input.projectionEpochs || activeEpochs(); db.prepare("INSERT INTO consistency_watermarks(id,scope_id,canonical_sequence,working_set_sequence,projection_epochs_json,policy_version,captured_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, String(input.scopeId), Math.max(0, canonicalSequence), Math.max(0, Number(input.workingSetSequence || 0)), JSON.stringify(epochs), String(input.policyVersion || "policy:v1"), clock().toISOString());
    return { id, scopeId: String(input.scopeId), canonicalSequence, workingSetSequence: Math.max(0, Number(input.workingSetSequence || 0)), projectionEpochs: epochs, policyVersion: String(input.policyVersion || "policy:v1") }; }

  function createNamespace(input = {}) { const prior = db.prepare("SELECT * FROM cache_namespaces WHERE cache_kind=? AND scope_id=? AND policy_version=?").get(String(input.kind), String(input.scopeId), String(input.policyVersion || "policy:v1"));
    if (prior) return { id: prior.id, generation: prior.generation, replayed: true }; const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    db.prepare(`INSERT INTO cache_namespaces(id,cache_kind,scope_id,policy_version,generation,max_entries,max_bytes,encryption_class,status,created_at,updated_at)
      VALUES(?,?,?,?,1,?,?,?,'active',?,?)`).run(id, String(input.kind), String(input.scopeId), String(input.policyVersion || "policy:v1"), Math.max(1, Number(input.maxEntries || 500)),
      Math.max(1024, Number(input.maxBytes || 16 * 1024 * 1024)), String(input.encryptionClass || "private"), now, now); return { id, generation: 1, replayed: false }; }
  function authorize(ns, scopeId, policyVersion) { if (ns.status !== "active" || ns.scope_id !== String(scopeId) || ns.policy_version !== String(policyVersion || ns.policy_version)) throw Object.assign(new Error("Cache namespace scope or policy mismatch."), { code: "CACHE_SCOPE_DENIED" }); }
  function keyHash(ns, key) { return digest({ namespaceId: ns.id, scopeId: ns.scope_id, policyVersion: ns.policy_version, generation: ns.generation, key }, "cache-key-v1"); }

  function evictToLimits(ns) {
    let totals = db.prepare("SELECT COUNT(*) AS entries,COALESCE(SUM(byte_size),0) AS bytes FROM cache_entries WHERE namespace_id=? AND generation=? AND status='active'").get(ns.id, ns.generation); const evicted = [];
    while (totals.entries > ns.max_entries || totals.bytes > ns.max_bytes) {
      const row = db.prepare("SELECT * FROM cache_entries WHERE namespace_id=? AND generation=? AND status='active' ORDER BY (recompute_cost/(byte_size+1)) ASC,last_accessed_at ASC,access_count ASC LIMIT 1").get(ns.id, ns.generation); if (!row) break;
      db.prepare("UPDATE cache_entries SET status='evicted',payload_encrypted_id=NULL WHERE id=?").run(row.id); if (row.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.payload_encrypted_id); metric(ns.id, "evict", row.byte_size); evicted.push(row.id);
      totals = db.prepare("SELECT COUNT(*) AS entries,COALESCE(SUM(byte_size),0) AS bytes FROM cache_entries WHERE namespace_id=? AND generation=? AND status='active'").get(ns.id, ns.generation);
    }
    return evicted;
  }

  function put(input = {}) {
    const ns = namespace(input.namespaceId); authorize(ns, input.scopeId, input.policyVersion); const payloadBytes = Buffer.byteLength(JSON.stringify(input.value), "utf8");
    let ttlMs = Math.max(1, Number(input.ttlMs || 60_000)); if (ns.cache_kind === "negative") ttlMs = Math.min(ttlMs, 30_000);
    if (payloadBytes > ns.max_bytes) throw Object.assign(new Error("Cache entry exceeds namespace capacity."), { code: "CACHE_ENTRY_TOO_LARGE" });
    const hash = keyHash(ns, input.key); const prior = db.prepare("SELECT * FROM cache_entries WHERE namespace_id=? AND generation=? AND key_hash=?").get(ns.id, ns.generation, hash);
    const run = db.transaction(() => { const now = clock().toISOString(); const payloadId = encrypt(ns.scope_id, "cache-entry", { value: input.value }, ns.encryption_class); const id = prior?.id || String(input.id || crypto.randomUUID());
      if (prior) { db.prepare("DELETE FROM cache_dependencies WHERE cache_entry_id=?").run(id); db.prepare(`UPDATE cache_entries SET payload_encrypted_id=?,content_hash=?,byte_size=?,recompute_cost=?,canonical_sequence=?,working_set_sequence=?,projection_epochs_json=?,policy_version=?,status='active',expires_at=?,last_accessed_at=?,access_count=0 WHERE id=?`)
        .run(payloadId, digest(input.value, "cache-content-v1"), payloadBytes, Math.max(0, Number(input.recomputeCost || 0)), Math.max(0, Number(input.watermark?.canonicalSequence || 0)), Math.max(0, Number(input.watermark?.workingSetSequence || 0)),
          JSON.stringify(input.watermark?.projectionEpochs || {}), ns.policy_version, new Date(clock().getTime() + ttlMs).toISOString(), now, id); if (prior.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(prior.payload_encrypted_id);
      } else db.prepare(`INSERT INTO cache_entries(id,namespace_id,generation,key_hash,payload_encrypted_id,content_hash,byte_size,recompute_cost,canonical_sequence,working_set_sequence,projection_epochs_json,policy_version,status,expires_at,created_at,last_accessed_at,access_count)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'active',?,?,?,0)`).run(id, ns.id, ns.generation, hash, payloadId, digest(input.value, "cache-content-v1"), payloadBytes, Math.max(0, Number(input.recomputeCost || 0)),
        Math.max(0, Number(input.watermark?.canonicalSequence || 0)), Math.max(0, Number(input.watermark?.workingSetSequence || 0)), JSON.stringify(input.watermark?.projectionEpochs || {}), ns.policy_version,
        new Date(clock().getTime() + ttlMs).toISOString(), now, now);
      for (const dependency of input.dependencies || []) { db.prepare("INSERT INTO cache_dependencies(cache_entry_id,dependency_type,dependency_id,dependency_version,created_at) VALUES(?,?,?,?,?)")
        .run(id, String(dependency.type), String(dependency.id), String(dependency.version), now); db.prepare("INSERT OR IGNORE INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,'caches','active',?,NULL)")
        .run(crypto.randomUUID(), ns.scope_id, String(dependency.type), String(dependency.id), "cache_entry", id, now); }
      faultInjector("cache.put.before_commit"); metric(ns.id, input.prewarm ? "prewarm" : "put", payloadBytes); const evicted = evictToLimits(ns); return { id, keyHash: hash, evicted }; }); return run.immediate();
  }

  function watermarkSatisfies(row, required) { if (!required) return true; if (row.canonical_sequence < Number(required.canonicalSequence || 0) || row.working_set_sequence < Number(required.workingSetSequence || 0) || row.policy_version !== String(required.policyVersion || row.policy_version)) return false;
    const stored = JSON.parse(row.projection_epochs_json); return Object.entries(required.projectionEpochs || {}).every(([key, epoch]) => Number(stored[key] || 0) >= Number(epoch)); }
  function get(input = {}) { const started = Date.now(); const ns = namespace(input.namespaceId); authorize(ns, input.scopeId, input.policyVersion);
    if (String(input.consistencyMode || "strict") === "live_domain") { metric(ns.id, "miss", 0, Date.now() - started); return { hit: false, reason: "LIVE_DOMAIN_BYPASS" }; }
    const hash = keyHash(ns, input.key); const row = db.prepare("SELECT * FROM cache_entries WHERE namespace_id=? AND generation=? AND key_hash=?").get(ns.id, ns.generation, hash);
    if (!row || row.status !== "active") { metric(ns.id, "miss", 0, Date.now() - started); return { hit: false, reason: "MISS" }; }
    const now = clock(); if (row.expires_at <= now.toISOString()) { db.prepare("UPDATE cache_entries SET status='expired',payload_encrypted_id=NULL WHERE id=?").run(row.id); if (row.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.payload_encrypted_id); metric(ns.id, "miss", row.byte_size, Date.now() - started); return { hit: false, reason: "EXPIRED" }; }
    const mode = String(input.consistencyMode || "strict"); const coherent = mode === "strict" ? watermarkSatisfies(row, input.requiredWatermark) : mode === "bounded_stale" ? (now.getTime() - Date.parse(row.created_at) <= Math.max(0, Number(input.maxStaleMs || 0)) && row.policy_version === String(input.requiredWatermark?.policyVersion || row.policy_version)) : false;
    if (!coherent) { metric(ns.id, "stale_reject", row.byte_size, Date.now() - started); return { hit: false, reason: "STALE_WATERMARK" }; }
    db.prepare("UPDATE cache_entries SET last_accessed_at=?,access_count=access_count+1 WHERE id=?").run(now.toISOString(), row.id); metric(ns.id, "hit", row.byte_size, Date.now() - started);
    return { hit: true, id: row.id, value: decrypt(row.payload_encrypted_id)?.value, watermark: { canonicalSequence: row.canonical_sequence, workingSetSequence: row.working_set_sequence, projectionEpochs: JSON.parse(row.projection_epochs_json), policyVersion: row.policy_version } };
  }

  function invalidateDependency(type, id, reason = "DEPENDENCY_CHANGED") { const entries = db.prepare(`SELECT DISTINCT e.* FROM cache_dependencies d JOIN cache_entries e ON e.id=d.cache_entry_id WHERE d.dependency_type=? AND d.dependency_id=? AND e.status='active'`).all(String(type), String(id));
    const run = db.transaction(() => { for (const row of entries) { db.prepare("UPDATE cache_entries SET status='invalidated',payload_encrypted_id=NULL WHERE id=?").run(row.id); if (row.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.payload_encrypted_id); metric(row.namespace_id, "invalidate", row.byte_size);
      db.prepare("INSERT OR IGNORE INTO invalidation_records(id,trigger_type,trigger_id,target_type,target_id,action,status,reason_code,created_at,applied_at) VALUES(?,?,?,?,?,'purge','applied',?,?,?)")
        .run(crypto.randomUUID(), String(type), String(id), "cache_entry", row.id, String(reason), clock().toISOString(), clock().toISOString()); }
      db.prepare("UPDATE dependency_edges SET status='invalidated',invalidated_at=? WHERE source_type=? AND source_id=? AND dependent_type='cache_entry' AND status='active'").run(clock().toISOString(), String(type), String(id)); return entries.map((row) => row.id); }); return run.immediate(); }

  function advanceGeneration(namespaceId) { const ns = namespace(namespaceId); const run = db.transaction(() => { const rows = db.prepare("SELECT id,payload_encrypted_id,byte_size FROM cache_entries WHERE namespace_id=? AND generation=? AND status='active'").all(ns.id, ns.generation);
    rows.forEach((row) => { db.prepare("UPDATE cache_entries SET status='invalidated',payload_encrypted_id=NULL WHERE id=?").run(row.id); if (row.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.payload_encrypted_id); });
    const now = clock().toISOString(); db.prepare("UPDATE cache_namespaces SET generation=generation+1,status='active',updated_at=? WHERE id=?").run(now, ns.id); metric(ns.id, "purge", rows.reduce((sum, row) => sum + row.byte_size, 0)); return { id: ns.id, generation: ns.generation + 1, purgedEntries: rows.length }; }); return run.immediate(); }

  function acquire(input = {}) { const ns = namespace(input.namespaceId); authorize(ns, input.scopeId, input.policyVersion); const hash = keyHash(ns, input.key); const now = clock(); const existing = db.prepare("SELECT * FROM cache_inflight WHERE namespace_id=? AND generation=? AND key_hash=?").get(ns.id, ns.generation, hash);
    if (existing && existing.lease_expires_at > now.toISOString()) { metric(ns.id, "lease_wait"); return { acquired: false, leaseOwner: existing.lease_owner, leaseExpiresAt: existing.lease_expires_at }; }
    const owner = String(input.leaseOwner || crypto.randomUUID()); const expires = new Date(now.getTime() + Math.max(100, Number(input.leaseMs || 5_000))).toISOString(); db.prepare(`INSERT INTO cache_inflight(namespace_id,generation,key_hash,lease_owner,lease_expires_at,watermark_id,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(namespace_id,generation,key_hash) DO UPDATE SET lease_owner=excluded.lease_owner,lease_expires_at=excluded.lease_expires_at,watermark_id=excluded.watermark_id,created_at=excluded.created_at`)
      .run(ns.id, ns.generation, hash, owner, expires, input.watermarkId ? String(input.watermarkId) : null, now.toISOString()); return { acquired: true, leaseOwner: owner, leaseExpiresAt: expires, keyHash: hash }; }
  function release(input = {}) { const ns = namespace(input.namespaceId); const changed = db.prepare("DELETE FROM cache_inflight WHERE namespace_id=? AND generation=? AND key_hash=? AND lease_owner=?")
    .run(ns.id, ns.generation, keyHash(ns, input.key), String(input.leaseOwner)); return { released: changed.changes === 1 }; }

  function putProviderRef(input = {}) { const ns = namespace(input.namespaceId); authorize(ns, input.scopeId, input.policyVersion); if (ns.cache_kind !== "provider") throw new Error("Provider handles require a provider cache namespace.");
    const id = String(input.id || crypto.randomUUID()); const handleId = encrypt(ns.scope_id, "provider-cache-handle", { handle: String(input.handle) }, String(input.sensitivity || "private")); db.prepare(`INSERT INTO provider_cache_refs(id,namespace_id,provider,model,handle_encrypted_id,prefix_hash,sensitivity,expires_at,cached_units,hit_count,cost_usd,status,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,0,?,'active',?)`).run(id, ns.id, String(input.provider), String(input.model), handleId, digest(input.prefix, "provider-prefix-v1"), String(input.sensitivity || "private"), String(input.expiresAt), Math.max(0, Number(input.cachedUnits || 0)), Math.max(0, Number(input.costUsd || 0)), clock().toISOString()); return { id, status: "active" }; }
  function deleteProviderRef(id) { const row = db.prepare("SELECT * FROM provider_cache_refs WHERE id=?").get(String(id)); if (!row) return { id: String(id), deleted: false }; db.prepare("UPDATE provider_cache_refs SET status='deleted',handle_encrypted_id=NULL WHERE id=?").run(row.id); if (row.handle_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.handle_encrypted_id); return { id: row.id, deleted: true }; }

  function stats(namespaceId) { const ns = namespace(namespaceId); return { namespaceId: ns.id, generation: ns.generation,
    entries: Object.fromEntries(db.prepare("SELECT status,COUNT(*) AS count FROM cache_entries WHERE namespace_id=? GROUP BY status").all(ns.id).map((row) => [row.status, row.count])),
    metrics: Object.fromEntries(db.prepare("SELECT metric_type,COUNT(*) AS count FROM cache_metrics WHERE namespace_id=? GROUP BY metric_type").all(ns.id).map((row) => [row.metric_type, row.count])) }; }

  return Object.freeze({ acquire, activateProjectionEpoch, activeEpochs, advanceGeneration, captureWatermark, createNamespace, createProjectionEpoch, deleteProviderRef, get, invalidateDependency, put, putProviderRef, release, stats });
}

module.exports = { canonical, createCacheFabricRepository };
