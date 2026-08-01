"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");
const { normalizedText } = require("./retrieval-oracle-repository");

function norm(vector) { return Math.sqrt(vector.reduce((sum, value) => sum + Number(value) ** 2, 0)); }
function cosine(left, right) { const leftNorm = norm(left); const rightNorm = norm(right); if (!leftNorm || !rightNorm) return 0; return left.reduce((sum, value, index) => sum + Number(value) * Number(right[index]), 0) / (leftNorm * rightNorm); }
function embeddingText(value) { return normalizedText(typeof value === "string" ? value : JSON.stringify(value)); }

function createEmbeddingRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 15) throw new Error("Embedding gateway requires schema version 15.");
  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function decrypt(id) { if (!id) return null; const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id); if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8")); }
  function digest(value, domain) { return keyring.sign(typeof value === "string" ? value : JSON.stringify(value), domain); }
  function profile(id) { const row = db.prepare("SELECT * FROM embedding_profiles WHERE id=?").get(String(id)); if (!row) throw new Error("Embedding profile is unavailable."); return row; }
  function request(id) { const row = db.prepare("SELECT * FROM embedding_requests WHERE id=?").get(String(id)); if (!row) throw new Error("Embedding request is unavailable."); return row; }
  function gatewayState() { return db.prepare("SELECT * FROM embedding_gateway_state WHERE id=1").get(); }

  function registerProfile(input = {}) { const prior = db.prepare(`SELECT * FROM embedding_profiles WHERE provider=? AND model=? AND model_version=? AND dimensions=? AND modality=? AND preprocessing_version=? AND task_instruction=?`)
    .get(String(input.provider), String(input.model), String(input.modelVersion || "1"), Math.max(1, Number(input.dimensions || 768)), String(input.modality || "text"), String(input.preprocessingVersion || "1"), String(input.taskInstruction || "retrieval_document"));
    if (prior) return { id: prior.id, replayed: true }; const id = String(input.id || crypto.randomUUID());
    db.prepare(`INSERT INTO embedding_profiles(id,provider,model,model_version,dimensions,modality,preprocessing_version,task_instruction,metric,normalized,lane,state,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?)`).run(id, String(input.provider), String(input.model), String(input.modelVersion || "1"), Math.max(1, Number(input.dimensions || 768)), String(input.modality || "text"),
      String(input.preprocessingVersion || "1"), String(input.taskInstruction || "retrieval_document"), String(input.metric || "cosine"), input.normalized === false ? 0 : 1, String(input.lane || "local"), clock().toISOString()); return { id, replayed: false }; }

  function requestEmbedding(input = {}) {
    const target = profile(input.profileId); if (target.state !== "active") throw new Error("Embedding profile is retired.");
    if (!input.scopeId || !input.recordType || !input.recordId || !input.recordVersion) throw new Error("Embedding record identity and scope are required.");
    const now = clock().toISOString(); const policy = String(input.projectionPolicy || "embed"); const contentHash = digest({ normalized: embeddingText(input.content), modality: target.modality, preprocessing: target.preprocessing_version, task: target.task_instruction }, "embedding-content-v1");
    if (policy === "exact_only") {
      const idempotencyKey = String(input.idempotencyKey || `embed:exact-only:${target.id}:${String(input.scopeId)}:${contentHash}`);
      const prior = db.prepare("SELECT * FROM embedding_requests WHERE idempotency_key=?").get(idempotencyKey);
      if (prior) return { id: prior.id, status: prior.status, reason: prior.error_code, replayed: true, providerCallRequired: false };
      const id = String(input.id || crypto.randomUUID()); db.prepare(`INSERT INTO embedding_requests(id,scope_id,record_type,record_id,record_version,part_ref,profile_id,content_hash,sensitivity,cloud_eligible,batch_eligible,status,idempotency_key,error_code,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'skipped',?,'EXACT_ONLY_POLICY',?,?)`).run(id, String(input.scopeId), String(input.recordType), String(input.recordId), String(input.recordVersion), input.partRef ? String(input.partRef) : null,
        target.id, contentHash, String(input.sensitivity || "private"), 0, 0, idempotencyKey, now, now); return { id, status: "skipped", reason: "EXACT_ONLY_POLICY", providerCallRequired: false };
    }
    if (target.lane === "cloud" && (!input.cloudEligible || ['private','restricted'].includes(String(input.sensitivity || "private")))) throw Object.assign(new Error("Embedding cloud route is denied for this sensitivity."), { code: "EMBEDDING_CLOUD_DENIED" });
    const cached = db.prepare(`SELECT er.* FROM embedding_records er JOIN embedding_requests req ON req.id=er.request_id WHERE er.scope_id=? AND er.profile_id=? AND er.content_hash=? AND er.status='active' LIMIT 1`)
      .get(String(input.scopeId), target.id, contentHash); if (cached) return { id: cached.request_id, status: "succeeded", recordId: cached.id, cached: true, providerCallRequired: false };
    const idempotencyKey = String(input.idempotencyKey || `embed:${target.id}:${String(input.scopeId)}:${contentHash}`); const prior = db.prepare("SELECT * FROM embedding_requests WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) return { id: prior.id, status: prior.status, cached: false, replayed: true, providerCallRequired: !['succeeded','skipped'].includes(prior.status) };
    const state = gatewayState(); if (target.lane === "cloud" && (state.mode === "offline" || (state.circuit_open_until && state.circuit_open_until > now))) return { status: "degraded", reason: "CIRCUIT_OPEN", providerCallRequired: false };
    if (target.lane === "cloud" && state.daily_cost_usd + Math.max(0, Number(input.estimatedCostUsd || 0)) > state.daily_budget_usd) throw Object.assign(new Error("Embedding daily budget would be exceeded."), { code: "EMBEDDING_BUDGET_EXCEEDED" });
    const id = String(input.id || crypto.randomUUID()); db.prepare(`INSERT INTO embedding_requests(id,scope_id,record_type,record_id,record_version,part_ref,profile_id,content_hash,sensitivity,cloud_eligible,batch_eligible,status,idempotency_key,error_code,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,NULL,?,?)`).run(id, String(input.scopeId), String(input.recordType), String(input.recordId), String(input.recordVersion), input.partRef ? String(input.partRef) : null,
      target.id, contentHash, String(input.sensitivity || "private"), input.cloudEligible ? 1 : 0, input.batchEligible ? 1 : 0, idempotencyKey, now, now);
    return { id, status: "queued", profile: formatProfile(target), contentHash, cached: false, providerCallRequired: true };
  }

  function formatProfile(row) { return { id: row.id, provider: row.provider, model: row.model, modelVersion: row.model_version, dimensions: row.dimensions, modality: row.modality,
    preprocessingVersion: row.preprocessing_version, taskInstruction: row.task_instruction, metric: row.metric, normalized: Boolean(row.normalized), lane: row.lane, state: row.state }; }
  function validateVector(target, vector) { if (!Array.isArray(vector) || vector.length !== target.dimensions || vector.some((value) => !Number.isFinite(Number(value)))) throw Object.assign(new Error("Embedding vector does not match profile dimensions or numeric requirements."), { code: "EMBEDDING_VECTOR_INVALID" });
    const values = vector.map(Number); const vectorNorm = norm(values); if (!vectorNorm) throw new Error("Embedding vector norm must be non-zero."); return { values: target.normalized ? values.map((value) => value / vectorNorm) : values, norm: target.normalized ? 1 : vectorNorm }; }
  function completeEmbedding(input = {}) { const run = db.transaction(() => { const req = request(input.requestId); if (req.status === "succeeded") { const record = db.prepare("SELECT id FROM embedding_records WHERE request_id=?").get(req.id); return { requestId: req.id, recordId: record.id, replayed: true }; }
    if (!['queued','leased'].includes(req.status)) throw new Error("Embedding request cannot complete."); const target = profile(req.profile_id); const checked = validateVector(target, input.vector); const now = clock().toISOString();
    const vectorId = encrypt(req.scope_id, "embedding-vector", { values: checked.values }, req.sensitivity); const recordId = String(input.recordId || crypto.randomUUID());
    db.prepare(`INSERT INTO embedding_records(id,request_id,scope_id,record_type,record_id,record_version,part_ref,profile_id,content_hash,vector_encrypted_id,vector_norm,status,created_at,replaced_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'active',?,NULL)`).run(recordId, req.id, req.scope_id, req.record_type, req.record_id, req.record_version, req.part_ref, req.profile_id, req.content_hash, vectorId, checked.norm, now);
    const receipt = { provider: String(input.provider || target.provider), model: String(input.model || target.model), lane: String(input.lane || target.lane), batchId: input.batchId ? String(input.batchId) : null,
      inputUnits: Math.max(0, Number(input.inputUnits || 0)), costUsd: Math.max(0, Number(input.costUsd || 0)), durationMs: Math.max(0, Number(input.durationMs || 0)) };
    db.prepare("INSERT INTO embedding_receipts(id,request_id,provider,model,lane,batch_id,input_units,cost_usd,duration_ms,output_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(crypto.randomUUID(), req.id, receipt.provider, receipt.model, receipt.lane, receipt.batchId, receipt.inputUnits, receipt.costUsd, receipt.durationMs, digest(checked.values, "embedding-output-v1"), now);
    db.prepare("UPDATE embedding_requests SET status='succeeded',updated_at=? WHERE id=?").run(now, req.id); db.prepare("UPDATE embedding_gateway_state SET mode='healthy',circuit_failures=0,circuit_open_until=NULL,daily_cost_usd=daily_cost_usd+?,updated_at=? WHERE id=1").run(receipt.costUsd, now);
    db.prepare("INSERT OR IGNORE INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,'indexes','active',?,NULL)")
      .run(crypto.randomUUID(), req.scope_id, req.record_type, req.record_id, "embedding_record", recordId, now); faultInjector("embedding.complete.before_commit"); return { requestId: req.id, recordId, replayed: false, costUsd: receipt.costUsd }; }); return run.immediate(); }

  function failEmbedding(input = {}) { const req = request(input.requestId); if (!['queued','leased'].includes(req.status)) return { id: req.id, status: req.status }; const now = clock().toISOString(); const failures = gatewayState().circuit_failures + 1;
    db.prepare("UPDATE embedding_requests SET status='failed',error_code=?,updated_at=? WHERE id=?").run(String(input.errorCode || "PROVIDER_FAILURE"), now, req.id); const openUntil = failures >= 3 ? new Date(clock().getTime() + 60_000).toISOString() : null;
    db.prepare("UPDATE embedding_gateway_state SET mode=?,circuit_failures=?,circuit_open_until=?,updated_at=? WHERE id=1").run(failures >= 3 ? "degraded" : "healthy", failures, openUntil, now); return { id: req.id, status: "failed", circuitFailures: failures, circuitOpenUntil: openUntil }; }

  function createIndex(input = {}) { const id = String(input.id || crypto.randomUUID()); db.prepare("INSERT INTO vector_indexes(id,profile_id,index_version,state,source_sequence,selected_record_count,embedded_record_count,created_at,activated_at) VALUES(?,?,?,'building',?,?,0,?,NULL)")
    .run(id, String(input.profileId), String(input.version), Math.max(0, Number(input.sourceSequence || 0)), Math.max(0, Number(input.selectedRecordCount || 0)), clock().toISOString()); return { id, state: "building" }; }
  function addToIndex(indexId, embeddingRecordIds) { const index = db.prepare("SELECT * FROM vector_indexes WHERE id=? AND state='building'").get(String(indexId)); if (!index) throw new Error("Building vector index is unavailable."); const target = profile(index.profile_id); const run = db.transaction(() => {
    for (const id of [...new Set(embeddingRecordIds.map(String))]) { const record = db.prepare("SELECT * FROM embedding_records WHERE id=? AND status='active'").get(id); if (!record || record.profile_id !== target.id) throw Object.assign(new Error("Vector index cannot mix embedding spaces."), { code: "EMBEDDING_SPACE_MISMATCH" });
      db.prepare("INSERT OR IGNORE INTO vector_index_members(index_id,embedding_record_id,created_at) VALUES(?,?,?)").run(index.id, id, clock().toISOString()); }
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM vector_index_members WHERE index_id=?").get(index.id).count); db.prepare("UPDATE vector_indexes SET embedded_record_count=? WHERE id=?").run(count, index.id); return { id: index.id, embeddedRecordCount: count }; }); return run.immediate(); }
  function activateIndex(indexId) { const run = db.transaction(() => { const index = db.prepare("SELECT * FROM vector_indexes WHERE id=? AND state='building'").get(String(indexId)); if (!index) throw new Error("Building vector index is unavailable.");
    if (index.embedded_record_count !== index.selected_record_count) throw Object.assign(new Error("Selected-record embedding coverage is incomplete."), { code: "VECTOR_COVERAGE_INCOMPLETE", selected: index.selected_record_count, embedded: index.embedded_record_count });
    const now = clock().toISOString(); db.prepare("UPDATE vector_indexes SET state='retiring' WHERE profile_id=? AND state='active'").run(index.profile_id); db.prepare("UPDATE vector_indexes SET state='active',activated_at=? WHERE id=?").run(now, index.id); faultInjector("embedding.index.activate.before_commit"); return { id: index.id, state: "active", coverage: 1 }; }); return run.immediate(); }

  function search(input = {}) { const index = input.indexId ? db.prepare("SELECT * FROM vector_indexes WHERE id=?").get(String(input.indexId)) : db.prepare("SELECT * FROM vector_indexes WHERE profile_id=? AND state='active'").get(String(input.profileId));
    if (!index || index.state !== "active") return { available: false, reason: "VECTOR_INDEX_UNAVAILABLE", hits: [], fallbackLanes: ["exact","lexical","graph","task"] };
    if (String(input.profileId) !== index.profile_id) throw Object.assign(new Error("Query profile and vector index use different spaces."), { code: "EMBEDDING_SPACE_MISMATCH" }); const target = profile(index.profile_id); const checked = validateVector(target, input.vector);
    const allowed = new Set((input.allowedScopeIds || []).map(String)); const scopes = [...new Set((input.scopeIds || []).map(String))]; if (!scopes.length || scopes.some((scope) => !allowed.has(scope))) throw Object.assign(new Error("Vector search scope is denied."), { code: "RETRIEVAL_SCOPE_DENIED" });
    const placeholders = scopes.map(() => "?").join(","); const rows = db.prepare(`SELECT er.* FROM vector_index_members vm JOIN embedding_records er ON er.id=vm.embedding_record_id WHERE vm.index_id=? AND er.scope_id IN (${placeholders}) AND er.status='active'`).all(index.id, ...scopes);
    const hits = rows.map((row) => ({ record: row, vector: decrypt(row.vector_encrypted_id)?.values })).filter((item) => item.vector).map((item) => ({ embeddingRecordId: item.record.id, recordType: item.record.record_type, recordId: item.record.record_id,
      recordVersion: item.record.record_version, partRef: item.record.part_ref, scopeId: item.record.scope_id, score: target.metric === "cosine" ? cosine(checked.values, item.vector) : checked.values.reduce((sum, value, indexValue) => sum + value * item.vector[indexValue], 0) }))
      .sort((a, b) => b.score - a.score || a.embeddingRecordId.localeCompare(b.embeddingRecordId)).slice(0, Math.max(1, Math.min(100, Number(input.limit || 20)))); return { available: true, indexId: index.id, profileId: target.id, hits, fallbackLanes: [] }; }

  function deleteRecord(input = {}) { const rows = db.prepare("SELECT * FROM embedding_records WHERE scope_id=? AND record_type=? AND record_id=? AND status='active'").all(String(input.scopeId), String(input.recordType), String(input.recordId)); const run = db.transaction(() => { for (const row of rows) {
    db.prepare("DELETE FROM vector_index_members WHERE embedding_record_id=?").run(row.id); db.prepare("UPDATE embedding_records SET status='deleted',vector_encrypted_id=NULL WHERE id=?").run(row.id); if (row.vector_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.vector_encrypted_id); }
    db.prepare("UPDATE dependency_edges SET status='deleted',invalidated_at=? WHERE source_type=? AND source_id=? AND dependent_type='embedding_record' AND status='active'").run(clock().toISOString(), String(input.recordType), String(input.recordId)); return { deleted: rows.map((row) => row.id) }; }); return run.immediate(); }
  function health() { const state = gatewayState(); return { mode: state.mode, circuitFailures: state.circuit_failures, circuitOpenUntil: state.circuit_open_until, dailyCostUsd: state.daily_cost_usd, dailyBudgetUsd: state.daily_budget_usd,
    queue: Object.fromEntries(db.prepare("SELECT status,COUNT(*) AS count FROM embedding_requests GROUP BY status").all().map((row) => [row.status, row.count])), exactFallbackAvailable: true }; }

  return Object.freeze({ activateIndex, addToIndex, completeEmbedding, createIndex, deleteRecord, failEmbedding, health, registerProfile, requestEmbedding, search, validateVector });
}

module.exports = { cosine, createEmbeddingRepository, norm };
