"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");
const { createAssertionRepository, requireStructuralRef } = require("./assertion-repository");

const PROJECTION_DEPENDENTS = new Set(["derived_copy", "retrieval_document", "cache_entry", "embedding_record", "context_pack", "graph_edge", "artifact_version", "artifact_part"]);

function createTruthMaintenanceRepository(dependencies) {
  const { db, keyring, clock, faultInjector } = dependencies;
  if (Number(db.pragma("user_version", { simple: true })) < 12) throw new Error("Truth maintenance requires schema version 12.");
  const assertions = createAssertionRepository(dependencies);

  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function decrypt(id) {
    if (!id) return null; const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id); if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }
  function requireOwner(actorId, authorityZone) {
    const row = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(actorId));
    if (!row || row.status !== "active" || row.actor_type !== "owner" || String(authorityZone) !== "owner") throw Object.assign(new Error("Truth maintenance requires direct owner authority."), { code: "OWNER_AUTHORITY_REQUIRED" });
    return String(actorId);
  }
  function objectHash(value) { return keyring.sign(JSON.stringify(value), "assertion-object-semantics-v1"); }

  function currentAssertionCandidates(input = {}) {
    const clauses = ["a.scope_id=?", "a.subject_type=?", "a.subject_ref=?", "a.predicate=?", "v.recorded_to IS NULL", "v.epistemic_state<>'retracted'"];
    const args = [String(input.scopeId), String(input.subjectType), String(input.subjectRef), String(input.predicate)];
    if (input.oldObject !== undefined) { clauses.push("a.object_semantics_hash=?"); args.push(objectHash(input.oldObject)); }
    return db.prepare(`SELECT a.id AS assertion_id,a.object_semantics_hash,v.id AS version_id FROM assertions a JOIN assertion_versions v ON v.assertion_id=a.id WHERE ${clauses.join(" AND ")} ORDER BY a.id`).all(...args);
  }

  function previewCorrection(input = {}) {
    if (!input.scopeId || !input.subjectRef || !input.predicate) throw new Error("Correction scope, subject, and predicate are required.");
    requireStructuralRef(input.subjectRef, "Correction subject"); requireStructuralRef(input.predicate, "Correction predicate", /^[a-z][a-z0-9_.-]{0,127}$/);
    const candidates = currentAssertionCandidates(input); const status = candidates.length === 1 ? "preview" : candidates.length > 1 ? "needs_clarification" : "rejected";
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString(); const scopeId = String(input.scopeId);
    const newObjectId = input.newObject === undefined ? null : encrypt(scopeId, "correction-new-object", input.newObject, String(input.sensitivity || "private"));
    const rationaleId = input.rationale == null ? null : encrypt(scopeId, "correction-rationale", input.rationale, String(input.sensitivity || "private"));
    db.prepare(`INSERT INTO correction_commands(id,scope_id,subject_type,subject_ref,predicate,old_object_hash,new_object_encrypted_id,mode,status,target_count,requested_by,rationale_encrypted_id,valid_at,created_at,committed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(id, scopeId, String(input.subjectType || "owner"), String(input.subjectRef), String(input.predicate),
      input.oldObject === undefined ? null : objectHash(input.oldObject), newObjectId, String(input.mode || "real_world_change"), status, candidates.length,
      String(input.requestedBy || "local-owner"), rationaleId, String(input.validAt || now), now);
    return { id, status, targetCount: candidates.length, candidateAssertionIds: candidates.map((row) => row.assertion_id), requiresClarification: candidates.length !== 1 };
  }

  function dependencyClosure(sourceType, sourceId) {
    return db.prepare(`WITH RECURSIVE closure(dependent_type,dependent_id) AS (
      SELECT dependent_type,dependent_id FROM dependency_edges WHERE source_type=? AND source_id=? AND status='active'
      UNION
      SELECT d.dependent_type,d.dependent_id FROM dependency_edges d JOIN closure c ON d.source_type=c.dependent_type AND d.source_id=c.dependent_id WHERE d.status='active'
    ) SELECT dependent_type AS type,dependent_id AS id FROM closure ORDER BY dependent_type,dependent_id`).all(String(sourceType), String(sourceId));
  }

  function deleteEncrypted(ids) { for (const id of [...new Set(ids.filter(Boolean))]) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(id); }

  function invalidateArtifactPart(partId, now, destructive) {
    const row = db.prepare("SELECT * FROM artifact_parts WHERE id=?").get(partId); if (!row) return destructive ? "purge" : "stale";
    db.prepare("DELETE FROM artifact_part_fts WHERE part_id=?").run(partId); db.prepare("DELETE FROM artifact_part_exact_keys WHERE part_id=?").run(partId); db.prepare("DELETE FROM artifact_part_relations WHERE from_part_id=? OR to_part_id=?").run(partId, partId);
    if (destructive) { db.prepare("UPDATE artifact_parts SET status='deleted',locator_encrypted_id=NULL,content_encrypted_id=NULL,features_encrypted_id=NULL WHERE id=?").run(partId); deleteEncrypted([row.locator_encrypted_id, row.content_encrypted_id, row.features_encrypted_id]); return "purge"; }
    db.prepare("UPDATE artifact_parts SET status='stale' WHERE id=?").run(partId); return "stale";
  }

  function invalidateArtifactVersion(versionId, now, destructive) {
    const row = db.prepare("SELECT av.*,a.id AS artifact_id FROM artifact_versions av JOIN artifacts a ON a.id=av.artifact_id WHERE av.id=?").get(versionId); if (!row) return destructive ? "purge" : "stale";
    const hasParts = Number(db.pragma("user_version", { simple: true })) >= 21; const partIds = hasParts ? db.prepare("SELECT id FROM artifact_parts WHERE artifact_version_id=?").all(versionId).map((item) => item.id) : []; partIds.forEach((id) => invalidateArtifactPart(id, now, destructive));
    if (!destructive) { if (hasParts) db.prepare("UPDATE normalized_document_graphs SET status='stale' WHERE artifact_version_id=? AND status='active'").run(versionId); db.prepare("UPDATE artifact_versions SET status='stale' WHERE id=?").run(versionId); db.prepare("UPDATE artifacts SET status='stale',updated_at=? WHERE id=?").run(now, row.artifact_id); return "stale"; }
    const payloadIds = [row.manifest_encrypted_id, ...db.prepare("SELECT details_encrypted_id AS id FROM artifact_operations WHERE artifact_version_id=? UNION SELECT details_encrypted_id AS id FROM artifact_checks WHERE artifact_version_id=? UNION SELECT locator_encrypted_id AS id FROM artifact_locators WHERE artifact_version_id=?").all(versionId, versionId, versionId).map((item) => item.id), ...(hasParts ? db.prepare("SELECT payload_encrypted_id AS id FROM normalized_document_graphs WHERE artifact_version_id=?").all(versionId).map((item) => item.id) : [])];
    db.prepare("UPDATE artifact_operations SET details_encrypted_id=NULL WHERE artifact_version_id=?").run(versionId); db.prepare("UPDATE artifact_checks SET details_encrypted_id=NULL WHERE artifact_version_id=?").run(versionId); if (hasParts) db.prepare("UPDATE normalized_document_graphs SET status='deleted',payload_encrypted_id=NULL WHERE artifact_version_id=?").run(versionId); db.prepare("UPDATE artifact_locators SET state='deleted',locator_encrypted_id=NULL,last_seen_at=? WHERE artifact_version_id=?").run(now, versionId); db.prepare("UPDATE artifact_versions SET status='deleted',blob_id=NULL,manifest_encrypted_id=NULL WHERE id=?").run(versionId);
    if (row.blob_id) { db.prepare("UPDATE artifact_blobs SET ref_count=MAX(0,ref_count-1) WHERE id=?").run(row.blob_id); const blob = db.prepare("SELECT ref_count FROM artifact_blobs WHERE id=?").get(row.blob_id); if (blob?.ref_count === 0) db.prepare("UPDATE artifact_blobs SET status='deleted',nonce=NULL,ciphertext=NULL,auth_tag=NULL,aad_json=NULL,content_mac=NULL,deleted_at=? WHERE id=?").run(now, row.blob_id); }
    db.prepare("UPDATE artifacts SET status='stale',updated_at=? WHERE id=? AND status='active'").run(now, row.artifact_id); deleteEncrypted(payloadIds); return "purge";
  }

  function invalidateProjection(target, now, destructive = false) {
    if (target.type === "retrieval_document") {
      const row = db.prepare("SELECT content_encrypted_id FROM retrieval_documents WHERE id=?").get(target.id);
      if (!row) return "purge";
      db.prepare("DELETE FROM retrieval_fts WHERE document_id=?").run(target.id);
      db.prepare("DELETE FROM retrieval_exact_keys WHERE document_id=?").run(target.id);
      db.prepare("UPDATE retrieval_documents SET status='deleted',content_encrypted_id=NULL,updated_at=? WHERE id=?").run(now, target.id);
      if (row.content_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.content_encrypted_id);
      return "purge";
    }
    if (target.type === "cache_entry") {
      const row = db.prepare("SELECT payload_encrypted_id FROM cache_entries WHERE id=?").get(target.id);
      if (!row) return "invalidate";
      db.prepare("UPDATE cache_entries SET status='invalidated',payload_encrypted_id=NULL,last_accessed_at=? WHERE id=?").run(now, target.id);
      if (row.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.payload_encrypted_id);
      return "invalidate";
    }
    if (target.type === "embedding_record") {
      const row = db.prepare("SELECT vector_encrypted_id FROM embedding_records WHERE id=?").get(target.id);
      if (!row) return "purge";
      db.prepare("DELETE FROM vector_index_members WHERE embedding_record_id=?").run(target.id);
      db.prepare("UPDATE embedding_records SET status='deleted',vector_encrypted_id=NULL,replaced_at=? WHERE id=?").run(now, target.id);
      if (row.vector_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.vector_encrypted_id);
      return "purge";
    }
    if (target.type === "context_pack") {
      const pack = db.prepare("SELECT manifest_encrypted_id FROM context_packs WHERE id=?").get(target.id); if (!pack) return "purge";
      const payloadIds = db.prepare("SELECT content_encrypted_id AS id FROM context_pack_items WHERE pack_id=? UNION SELECT ii.claim_encrypted_id AS id FROM influence_items ii JOIN influence_receipts ir ON ir.id=ii.receipt_id WHERE ir.pack_id=?").all(target.id, target.id).map((row) => row.id).filter(Boolean);
      db.prepare("DELETE FROM influence_items WHERE receipt_id IN (SELECT id FROM influence_receipts WHERE pack_id=?)").run(target.id);
      db.prepare("DELETE FROM context_pack_items WHERE pack_id=?").run(target.id);
      db.prepare("UPDATE context_packs SET status='invalidated',manifest_encrypted_id=NULL WHERE id=?").run(target.id);
      for (const id of [...new Set([...payloadIds, pack.manifest_encrypted_id].filter(Boolean))]) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(id);
      return "purge";
    }
    if (target.type === "graph_edge") {
      const row = db.prepare("SELECT attributes_encrypted_id FROM graph_edges WHERE id=?").get(target.id); if (!row) return "purge";
      db.prepare("UPDATE graph_edges SET status='deleted',attributes_encrypted_id=NULL WHERE id=?").run(target.id);
      if (row.attributes_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.attributes_encrypted_id);
      return "purge";
    }
    if (target.type === "artifact_part" && Number(db.pragma("user_version", { simple: true })) >= 21) return invalidateArtifactPart(target.id, now, destructive);
    if (target.type === "artifact_version" && Number(db.pragma("user_version", { simple: true })) >= 20) return invalidateArtifactVersion(target.id, now, destructive);
    return null;
  }

  function projectionResidue(target) {
    if (target.type === "derived_copy") return db.prepare("SELECT status,payload_encrypted_id FROM derived_copies WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "retrieval_document") return db.prepare("SELECT status,content_encrypted_id FROM retrieval_documents WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "cache_entry") return db.prepare("SELECT status,payload_encrypted_id FROM cache_entries WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "embedding_record") return db.prepare("SELECT status,vector_encrypted_id FROM embedding_records WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "context_pack") return db.prepare("SELECT status,manifest_encrypted_id FROM context_packs WHERE id=?").get(target.id)?.status !== "invalidated";
    if (target.type === "graph_edge") return db.prepare("SELECT status,attributes_encrypted_id FROM graph_edges WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "artifact_part" && Number(db.pragma("user_version", { simple: true })) >= 21) return db.prepare("SELECT status FROM artifact_parts WHERE id=?").get(target.id)?.status === "active";
    if (target.type === "artifact_version" && Number(db.pragma("user_version", { simple: true })) >= 21) return db.prepare("SELECT status FROM artifact_versions WHERE id=?").get(target.id)?.status === "active";
    return false;
  }

  function invalidateClosure(triggerType, triggerId, reasonCode, { destructive = false } = {}) {
    const closure = dependencyClosure(triggerType, triggerId); const now = clock().toISOString();
    for (const target of closure) {
      let action = destructive ? "delete" : "stale";
      if (target.type === "derived_copy") {
        const copy = db.prepare("SELECT * FROM derived_copies WHERE id=?").get(target.id);
        if (copy) {
          if (destructive || ["cache","fts","vector"].includes(copy.copy_type)) {
            if (copy.payload_encrypted_id) db.prepare("UPDATE derived_copies SET payload_encrypted_id=NULL,status=?,updated_at=? WHERE id=?").run(copy.mixed_content ? "redacted" : "deleted", now, copy.id);
            else db.prepare("UPDATE derived_copies SET status=?,updated_at=? WHERE id=?").run(copy.mixed_content ? "redacted" : "deleted", now, copy.id);
            if (copy.payload_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(copy.payload_encrypted_id);
            action = copy.mixed_content ? "redact" : "purge";
          } else db.prepare("UPDATE derived_copies SET status='stale',updated_at=? WHERE id=?").run(now, copy.id);
        }
      } else action = invalidateProjection(target, now, destructive) || action;
      db.prepare(`INSERT OR IGNORE INTO invalidation_records(id,trigger_type,trigger_id,target_type,target_id,action,status,reason_code,created_at,applied_at)
        VALUES(?,?,?,?,?,?,'applied',?,?,?)`).run(crypto.randomUUID(), String(triggerType), String(triggerId), target.type, target.id, action, String(reasonCode), now, now);
    }
    db.prepare("UPDATE dependency_edges SET status=?,invalidated_at=? WHERE status='active' AND source_type=? AND source_id=?")
      .run(destructive ? "deleted" : "invalidated", now, String(triggerType), String(triggerId));
    for (const target of closure) db.prepare("UPDATE dependency_edges SET status=?,invalidated_at=? WHERE status='active' AND ((source_type=? AND source_id=?) OR (dependent_type=? AND dependent_id=?))")
      .run(destructive ? "deleted" : "invalidated", now, target.type, target.id, target.type, target.id);
    return closure;
  }

  function invalidateSource(input = {}) { const run = db.transaction(() => { const invalidated = invalidateClosure(String(input.sourceType), String(input.sourceId), String(input.reasonCode || "SOURCE_CHANGED"), { destructive: Boolean(input.destructive) }); faultInjector("truth.invalidation.before_commit"); return invalidated; }); return run.immediate(); }

  function applyCorrection(input = {}) {
    const actorId = requireOwner(input.actorId || "local-owner", input.authorityZone);
    const run = db.transaction(() => {
      const command = db.prepare("SELECT * FROM correction_commands WHERE id=?").get(String(input.commandId));
      if (!command || command.status !== "preview" || command.target_count !== 1) throw Object.assign(new Error("Correction is not uniquely actionable."), { code: "CORRECTION_CLARIFICATION_REQUIRED" });
      const selector = { scopeId: command.scope_id, subjectType: command.subject_type, subjectRef: command.subject_ref, predicate: command.predicate };
      const candidates = db.prepare(`SELECT a.id AS assertion_id,v.id AS version_id FROM assertions a JOIN assertion_versions v ON v.assertion_id=a.id
        WHERE a.scope_id=? AND a.subject_type=? AND a.subject_ref=? AND a.predicate=? AND v.recorded_to IS NULL AND v.epistemic_state<>'retracted' ${command.old_object_hash ? "AND a.object_semantics_hash=?" : ""}`)
        .all(...[selector.scopeId, selector.subjectType, selector.subjectRef, selector.predicate, ...(command.old_object_hash ? [command.old_object_hash] : [])]);
      if (candidates.length !== 1) throw Object.assign(new Error("Correction target changed after preview."), { code: "CORRECTION_TARGET_DRIFT" });
      const target = assertions.readAssertion(candidates[0].assertion_id); const current = target.currentVersion; const newObject = decrypt(command.new_object_encrypted_id);
      let oldRevision; let replacement = null;
      if (command.mode === "real_world_change" || command.mode === "close") {
        oldRevision = assertions.reviseAssertion(target.id, { validTo: command.valid_at, createdBy: actorId, provenance: { correctionCommandId: command.id, mode: command.mode } });
      } else {
        oldRevision = assertions.reviseAssertion(target.id, { epistemicState: "retracted", createdBy: actorId, provenance: { correctionCommandId: command.id, mode: command.mode } });
      }
      if (command.new_object_encrypted_id && command.mode !== "close" && command.mode !== "retract") {
        replacement = assertions.createAssertion({ scopeId: command.scope_id, subjectType: command.subject_type, subjectRef: command.subject_ref, predicate: command.predicate,
          object: newObject, objectType: current.objectType, epistemicState: "owner_asserted", validFrom: command.valid_at, createdBy: actorId,
          confidence: { extraction: 1, sourceReliability: 1, corroboration: 1, freshness: 1, userConfirmation: 1, contradictionPenalty: 0, policyVersion: "owner-correction:v1" },
          provenance: { correctionCommandId: command.id, replacesAssertionId: target.id } });
        if (replacement.replayed && (replacement.currentVersion?.epistemicState === "retracted" || replacement.currentVersion?.epistemicState === "superseded"
          || (replacement.currentVersion?.validTo && replacement.currentVersion.validTo <= command.valid_at))) {
          const reactivated = assertions.reviseAssertion(replacement.id, { object: newObject, objectType: current.objectType, epistemicState: "owner_asserted",
            validFrom: command.valid_at, validTo: null, createdBy: actorId, confidence: { extraction: 1, sourceReliability: 1, corroboration: 1, freshness: 1,
              userConfirmation: 1, contradictionPenalty: 0, policyVersion: "owner-correction:v1" }, provenance: { correctionCommandId: command.id, reactivatesAssertionId: replacement.id } });
          replacement = { id: replacement.id, ...reactivated };
        }
      }
      const relation = command.mode === "real_world_change" ? "real_world_change" : command.mode === "never_true" ? "corrects" : command.mode === "retract" ? "retracts" : "supersedes";
      db.prepare("INSERT INTO assertion_causal_links(id,from_version_id,to_version_id,relation,command_id,created_at) VALUES(?,?,?,?,?,?)")
        .run(crypto.randomUUID(), oldRevision.versionId, replacement?.versionId || null, relation, command.id, clock().toISOString());
      db.prepare("UPDATE conflict_sets SET status='dismissed',resolved_at=? WHERE scope_id=? AND subject_type=? AND subject_ref=? AND predicate=? AND status='open'")
        .run(clock().toISOString(), command.scope_id, command.subject_type, command.subject_ref, command.predicate);
      const invalidated = invalidateClosure("assertion", target.id, "ASSERTION_CORRECTED");
      db.prepare("UPDATE correction_commands SET status='committed',committed_at=? WHERE id=?").run(clock().toISOString(), command.id);
      faultInjector("truth.correction.before_commit");
      return { commandId: command.id, status: "committed", mode: command.mode, correctedAssertionId: target.id, replacementAssertionId: replacement?.id || null, invalidated };
    });
    return run.immediate();
  }

  function addDependency(input = {}) {
    const id = String(input.id || crypto.randomUUID()); const sourceType = String(input.sourceType); const sourceId = String(input.sourceId); const dependentType = String(input.dependentType); const dependentId = String(input.dependentId);
    if (sourceType === dependentType && sourceId === dependentId) throw new Error("A dependency cannot reference itself.");
    const run = db.transaction(() => {
      db.prepare("INSERT INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,?,'active',?,NULL)")
        .run(id, String(input.scopeId), sourceType, sourceId, dependentType, dependentId, String(input.relation || "derived_from"), clock().toISOString());
      const cycle = db.prepare(`WITH RECURSIVE closure(type,id) AS (SELECT dependent_type,dependent_id FROM dependency_edges WHERE source_type=? AND source_id=? AND status='active' UNION SELECT d.dependent_type,d.dependent_id FROM dependency_edges d JOIN closure c ON d.source_type=c.type AND d.source_id=c.id WHERE d.status='active') SELECT 1 AS found FROM closure WHERE type=? AND id=? LIMIT 1`)
        .get(dependentType, dependentId, sourceType, sourceId);
      if (cycle) throw Object.assign(new Error("Dependency graph contains a cycle."), { code: "DEPENDENCY_CYCLE" });
      return { id, sourceType, sourceId, dependentType, dependentId };
    });
    return run.immediate();
  }

  function registerDerivedCopy(input = {}) {
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    const run = db.transaction(() => {
      const payloadId = encrypt(String(input.scopeId), "derived-memory-copy", input.payload, String(input.sensitivity || "private"));
      db.prepare("INSERT INTO derived_copies(id,scope_id,copy_type,payload_encrypted_id,status,mixed_content,created_at,updated_at) VALUES(?,?,?,?,'active',?,?,?)")
        .run(id, String(input.scopeId), String(input.copyType), payloadId, input.mixedContent ? 1 : 0, now, now);
      addDependency({ scopeId: input.scopeId, sourceType: input.sourceType, sourceId: input.sourceId, dependentType: "derived_copy", dependentId: id, relation: input.relation || "derived_from" });
      return { id, status: "active", copyType: String(input.copyType) };
    });
    return run.immediate();
  }

  const TARGETS = Object.freeze({
    assertion: { table: "assertions", payloadQuery: "SELECT object_encrypted_id AS id FROM assertion_versions WHERE assertion_id=? UNION SELECT provenance_encrypted_id AS id FROM assertion_versions WHERE assertion_id=?", scrub(dbx, id) { dbx.prepare("UPDATE assertion_versions SET epistemic_state='retracted',object_encrypted_id=NULL,provenance_encrypted_id=NULL WHERE assertion_id=?").run(id); dbx.prepare("UPDATE assertions SET status='retracted',updated_at=? WHERE id=?").run(clock().toISOString(), id); } },
    identity: { table: "identity_attributes", payloadQuery: "SELECT value_encrypted_id AS id FROM identity_attributes WHERE id=?", scrub(dbx, id) { dbx.prepare("UPDATE identity_attributes SET value_encrypted_id=NULL,status='retracted',updated_at=? WHERE id=?").run(clock().toISOString(), id); } },
    directive: { table: "directives", payloadQuery: "SELECT content_encrypted_id AS id FROM directives WHERE id=?", scrub(dbx, id) { dbx.prepare("UPDATE directives SET content_encrypted_id=NULL,status='retracted',closed_at=? WHERE id=?").run(clock().toISOString(), id); } },
    preference: { table: "preferences", payloadQuery: "SELECT condition_encrypted_id AS id FROM preferences WHERE id=? UNION SELECT value_encrypted_id AS id FROM preferences WHERE id=?", scrub(dbx, id) { dbx.prepare("UPDATE preferences SET condition_encrypted_id=NULL,value_encrypted_id=NULL,status='retracted',updated_at=? WHERE id=?").run(clock().toISOString(), id); } },
    goal: { table: "goals", payloadQuery: "SELECT objective_encrypted_id AS id FROM goals WHERE id=? UNION SELECT payload_encrypted_id AS id FROM goal_events WHERE goal_id=?", scrub(dbx, id) { dbx.prepare("UPDATE goals SET objective_encrypted_id=NULL,state='retracted',updated_at=? WHERE id=?").run(clock().toISOString(), id); dbx.prepare("UPDATE goal_events SET payload_encrypted_id=NULL WHERE goal_id=?").run(id); } },
    commitment: { table: "commitments", payloadQuery: "SELECT promise_encrypted_id AS id FROM commitments WHERE id=? UNION SELECT payload_encrypted_id AS id FROM commitment_events WHERE commitment_id=?", scrub(dbx, id) { dbx.prepare("UPDATE commitments SET promise_encrypted_id=NULL,status='retracted',updated_at=? WHERE id=?").run(clock().toISOString(), id); dbx.prepare("UPDATE commitment_events SET payload_encrypted_id=NULL WHERE commitment_id=?").run(id); } },
  });

  function resolveForgetTargets(input = {}) {
    const config = TARGETS[String(input.targetType)]; if (!config) throw new Error("Forget target type is not safely supported yet.");
    if (input.targetId) return db.prepare(`SELECT id FROM ${config.table} WHERE id=? AND scope_id=?`).all(String(input.targetId), String(input.scopeId));
    if (input.targetType === "assertion" && input.subjectRef && input.predicate) return db.prepare("SELECT id FROM assertions WHERE scope_id=? AND subject_ref=? AND predicate=? AND status<>'retracted' ORDER BY id").all(String(input.scopeId), String(input.subjectRef), String(input.predicate));
    return [];
  }
  function previewForget(input = {}) {
    const targets = resolveForgetTargets(input); const status = targets.length === 1 ? "preview" : "needs_clarification"; const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    const selectorHash = keyring.sign(JSON.stringify({ targetType: input.targetType, targetId: input.targetId || null, subjectRef: input.subjectRef || null, predicate: input.predicate || null }), "forget-selector-v1");
    const run = db.transaction(() => {
      db.prepare(`INSERT INTO forget_jobs(id,scope_id,target_type,target_id,selector_hash,status,target_count,requested_by,sensitivity,closure_encrypted_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)`).run(id, String(input.scopeId), String(input.targetType), targets.length === 1 ? targets[0].id : null, selectorHash, status, targets.length,
        String(input.requestedBy || "local-owner"), String(input.sensitivity || "private"), now, now);
      for (const target of targets) db.prepare("INSERT INTO forget_job_targets(forget_job_id,target_type,target_id,role) VALUES(?,?,?,'primary')").run(id, String(input.targetType), target.id);
      if (targets.length === 1) {
        if (input.targetType === "identity") {
          const row = db.prepare("SELECT scope_id,owner_actor_id,predicate,assertion_id FROM identity_attributes WHERE id=?").get(targets[0].id);
          for (const sibling of db.prepare("SELECT id FROM identity_attributes WHERE scope_id=? AND owner_actor_id=? AND predicate=?").all(row.scope_id, row.owner_actor_id, row.predicate))
            db.prepare("INSERT OR IGNORE INTO forget_job_targets(forget_job_id,target_type,target_id,role) VALUES(?,?,?,'linked')").run(id, "identity", sibling.id);
          if (row.assertion_id) db.prepare("INSERT OR IGNORE INTO forget_job_targets(forget_job_id,target_type,target_id,role) VALUES(?,?,?,'linked')").run(id, "assertion", row.assertion_id);
        } else if (input.targetType === "directive") {
          const row = db.prepare("SELECT scope_id,directive_key FROM directives WHERE id=?").get(targets[0].id);
          for (const sibling of db.prepare("SELECT id FROM directives WHERE scope_id=? AND directive_key=?").all(row.scope_id, row.directive_key))
            db.prepare("INSERT OR IGNORE INTO forget_job_targets(forget_job_id,target_type,target_id,role) VALUES(?,?,?,'linked')").run(id, "directive", sibling.id);
        } else if (input.targetType === "preference") {
          const row = db.prepare("SELECT assertion_id FROM preferences WHERE id=?").get(targets[0].id);
          if (row.assertion_id) db.prepare("INSERT OR IGNORE INTO forget_job_targets(forget_job_id,target_type,target_id,role) VALUES(?,?,?,'linked')").run(id, "assertion", row.assertion_id);
        }
      }
      return db.prepare("SELECT target_type AS type,target_id AS id,role FROM forget_job_targets WHERE forget_job_id=? ORDER BY target_type,target_id").all(id);
    });
    const expanded = run.immediate();
    return { id, status, targetCount: targets.length, targetIds: targets.map((row) => row.id), expandedTargets: expanded, requiresClarification: targets.length !== 1 };
  }
  function authorizeForget(input = {}) {
    requireOwner(input.actorId || "local-owner", input.authorityZone); const now = clock().toISOString();
    const changed = db.prepare("UPDATE forget_jobs SET status='authorized',updated_at=? WHERE id=? AND status='preview' AND target_count=1").run(now, String(input.jobId));
    if (changed.changes !== 1) throw Object.assign(new Error("Forget request requires an exact target or clarification."), { code: "FORGET_CLARIFICATION_REQUIRED" });
    return { id: String(input.jobId), status: "authorized" };
  }

  function executeForget(input = {}) {
    const actorId = requireOwner(input.actorId || "local-owner", input.authorityZone);
    const run = db.transaction(() => {
      const job = db.prepare("SELECT * FROM forget_jobs WHERE id=? AND status='authorized'").get(String(input.jobId)); if (!job) throw new Error("Authorized forget job is unavailable.");
      const now = clock().toISOString(); db.prepare("UPDATE forget_jobs SET status='running',updated_at=? WHERE id=?").run(now, job.id);
      const seededTargets = db.prepare("SELECT target_type AS type,target_id AS id FROM forget_job_targets WHERE forget_job_id=? ORDER BY target_type,target_id").all(job.id);
      const targetMap = new Map(seededTargets.map((target) => [`${target.type}:${target.id}`, target]));
      let closure = [];
      for (const target of seededTargets) for (const dependent of dependencyClosure(target.type, target.id)) { closure.push(dependent); if (TARGETS[dependent.type]) targetMap.set(`${dependent.type}:${dependent.id}`, dependent); }
      closure = [...new Map(closure.map((item) => [`${item.type}:${item.id}`, item])).values()];
      const unsupported = closure.filter((item) => !PROJECTION_DEPENDENTS.has(item.type) && !TARGETS[item.type]);
      if (unsupported.length) throw Object.assign(new Error("Forget closure contains unsupported canonical dependents."), { code: "FORGET_UNSUPPORTED_DEPENDENT", dependents: unsupported });
      const canonicalTargets = [...targetMap.values()];
      for (const target of canonicalTargets) db.prepare("INSERT OR IGNORE INTO projection_freezes(target_type,target_id,forget_job_id,state,created_at,released_at) VALUES(?,?,?,'frozen',?,NULL)").run(target.type, target.id, job.id, now);
      const payloadIds = [];
      for (const target of canonicalTargets) {
        const config = TARGETS[target.type]; const count = (config.payloadQuery.match(/\?/g) || []).length; const args = Array.from({ length: count }, () => target.id);
        payloadIds.push(...db.prepare(config.payloadQuery).all(...args).map((row) => row.id).filter(Boolean)); config.scrub(db, target.id);
      }
      const uniquePayloadIds = [...new Set(payloadIds)];
      uniquePayloadIds.forEach((id) => db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(id));
      let invalidated = [];
      for (const target of canonicalTargets) invalidated.push(...invalidateClosure(target.type, target.id, "OWNER_FORGET", { destructive: true }));
      invalidated = [...new Map(invalidated.map((item) => [`${item.type}:${item.id}`, item])).values()];
      db.prepare("UPDATE forget_jobs SET status='verifying',updated_at=? WHERE id=?").run(clock().toISOString(), job.id);
      faultInjector("truth.forget.before_verify");
      const activeEdges = canonicalTargets.reduce((count, target) => count + Number(db.prepare("SELECT COUNT(*) AS count FROM dependency_edges WHERE source_type=? AND source_id=? AND status='active'").get(target.type, target.id).count), 0);
      const activeCopies = invalidated.filter((item) => PROJECTION_DEPENDENTS.has(item.type)).filter(projectionResidue);
      const remainingPayloads = uniquePayloadIds.filter((id) => db.prepare("SELECT id FROM encrypted_objects WHERE id=?").get(id));
      if (activeEdges || activeCopies.length || remainingPayloads.length) throw new Error("Forget verification found active residues.");
      const structural = { jobId: job.id, targetType: job.target_type, targetIds: canonicalTargets.map((target) => `${target.type}:${target.id}`), dependencyIds: invalidated.map((item) => `${item.type}:${item.id}`),
        deletedEncryptedObjectCount: uniquePayloadIds.length, invalidatedCopyCount: invalidated.filter((item) => PROJECTION_DEPENDENTS.has(item.type)).length, verified: true, actorId };
      const receiptMac = keyring.sign(JSON.stringify(structural), "deletion-receipt-v1"); const receiptId = crypto.randomUUID();
      db.prepare(`INSERT INTO deletion_receipts(id,forget_job_id,target_type,target_ids_json,dependency_ids_json,deleted_encrypted_object_count,invalidated_copy_count,shred_mode,verification_json,receipt_mac,created_at)
        VALUES(?,?,?,?,?,?,?,'encrypted_payload_delete',?,?,?)`).run(receiptId, job.id, job.target_type, JSON.stringify(structural.targetIds), JSON.stringify(structural.dependencyIds), uniquePayloadIds.length,
        structural.invalidatedCopyCount, JSON.stringify({ activeEdges, activeCopies: activeCopies.length, remainingPayloads: remainingPayloads.length, verified: true }), receiptMac, clock().toISOString());
      const closureId = encrypt(job.scope_id, "forget-closure-report", { receiptId, ...structural, actorId: undefined });
      db.prepare("UPDATE projection_freezes SET state='released',released_at=? WHERE forget_job_id=?").run(clock().toISOString(), job.id);
      db.prepare("UPDATE forget_jobs SET status='succeeded',closure_encrypted_id=?,updated_at=? WHERE id=?").run(closureId, clock().toISOString(), job.id);
      faultInjector("truth.forget.before_commit");
      return { id: job.id, status: "succeeded", receiptId, receiptMac, deletedEncryptedObjectCount: uniquePayloadIds.length, invalidatedCopyCount: structural.invalidatedCopyCount, verified: true };
    });
    return run.immediate();
  }

  function readDerivedCopy(id) { const row = db.prepare("SELECT * FROM derived_copies WHERE id=?").get(String(id)); if (!row) return null; return { id: row.id, type: row.copy_type, status: row.status, mixedContent: Boolean(row.mixed_content), payload: decrypt(row.payload_encrypted_id) }; }
  function readDeletionReceipt(jobId) { const row = db.prepare("SELECT * FROM deletion_receipts WHERE forget_job_id=?").get(String(jobId)); return row ? { id: row.id, jobId: row.forget_job_id, targetType: row.target_type, targetIds: JSON.parse(row.target_ids_json), dependencyIds: JSON.parse(row.dependency_ids_json), deletedEncryptedObjectCount: row.deleted_encrypted_object_count, invalidatedCopyCount: row.invalidated_copy_count, shredMode: row.shred_mode, verification: JSON.parse(row.verification_json), receiptMac: row.receipt_mac } : null; }

  return Object.freeze({ addDependency, applyCorrection, authorizeForget, dependencyClosure, executeForget, invalidateSource, previewCorrection, previewForget, readDeletionReceipt, readDerivedCopy, registerDerivedCopy });
}

module.exports = { createTruthMaintenanceRepository };
