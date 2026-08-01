"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function createKnowledgeRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 9) throw new Error("Knowledge repository requires schema version 9.");

  function encrypt(scopeId, objectType, payload, sensitivity = "private") {
    return insertEncrypted(db, keyring, clock, { objectType, scopeId, sensitivity, payload }).id;
  }
  function decrypt(id) {
    if (!id) return null;
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) throw new Error("Encrypted knowledge object is unavailable.");
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }
  function hash(value, domain) { return keyring.sign(JSON.stringify(value), domain); }
  function source(id) {
    const row = db.prepare("SELECT * FROM sources WHERE id=?").get(String(id));
    if (!row) throw new Error("Source is unavailable.");
    return row;
  }

  function createSource(input = {}) {
    if (!input.scopeId || !input.type || input.locator == null) throw new Error("Source scope, type, and canonical locator are required.");
    const id = String(input.id || crypto.randomUUID());
    const prior = db.prepare("SELECT id FROM sources WHERE id=?").get(id);
    if (prior) return { ...readSource(id), replayed: true };
    const now = clock().toISOString();
    const locatorId = encrypt(String(input.scopeId), "source-canonical-locator", input.locator, String(input.sensitivity || "private"));
    const titleId = input.title == null ? null : encrypt(String(input.scopeId), "source-title", { title: String(input.title) }, String(input.sensitivity || "private"));
    db.prepare(`INSERT INTO sources(id,scope_id,source_type,canonical_locator_encrypted_id,title_encrypted_id,trust_zone,reliability,access_policy,state,supersedes_source_id,created_at)
      VALUES(?,?,?,?,?,?,?,?, 'active',?,?)`).run(id, String(input.scopeId), String(input.type), locatorId, titleId, String(input.trustZone || "untrusted_external"),
      Math.max(0, Math.min(1, Number(input.reliability ?? 0.5))), String(input.accessPolicy || "local_only"), input.supersedesSourceId ? String(input.supersedesSourceId) : null, now);
    return { ...readSource(id), replayed: false };
  }

  function readSource(id) {
    const row = source(id);
    return { id: row.id, scopeId: row.scope_id, type: row.source_type, locator: decrypt(row.canonical_locator_encrypted_id), title: decrypt(row.title_encrypted_id)?.title || null,
      trustZone: row.trust_zone, reliability: row.reliability, accessPolicy: row.access_policy, state: row.state, supersedesSourceId: row.supersedes_source_id, createdAt: row.created_at };
  }

  function addCapture(input = {}) {
    const parent = source(input.sourceId); const contentHash = String(input.contentHash || "");
    if (!contentHash) throw new Error("Capture content hash is required.");
    const prior = db.prepare("SELECT * FROM source_captures WHERE source_id=? AND content_hash=?").get(parent.id, contentHash);
    if (prior) return { id: prior.id, sourceId: parent.id, version: prior.capture_version, replayed: true };
    const run = db.transaction(() => {
      const version = Number(db.prepare("SELECT COALESCE(MAX(capture_version),0)+1 AS next FROM source_captures WHERE source_id=?").get(parent.id).next);
      const metadataId = input.metadata == null ? null : encrypt(parent.scope_id, "source-capture-metadata", input.metadata);
      const id = String(input.id || crypto.randomUUID());
      db.prepare(`INSERT INTO source_captures(id,source_id,capture_version,content_hash,blob_ref,metadata_encrypted_id,extractor_status,captured_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(id, parent.id, version, contentHash, input.blobRef ? String(input.blobRef) : null, metadataId, String(input.extractorStatus || "complete"), String(input.capturedAt || clock().toISOString()));
      faultInjector("knowledge.capture.before_commit");
      return { id, sourceId: parent.id, version, replayed: false };
    });
    return run.immediate();
  }

  function validateLocator(modality, locator) {
    if (!locator || typeof locator !== "object" || Array.isArray(locator)) throw new Error("Evidence locator must be an object.");
    const requires = {
      text: [["section", "lineStart"], ["jsonPointer"], ["paragraph"]],
      pdf: [["page", "bbox"], ["page", "lineStart"]],
      image: [["bbox"]], audio: [["timeStartMs", "timeEndMs"]], video: [["timeStartMs", "timeEndMs"]],
      table: [["sheet", "range"], ["table", "cell"]], code: [["commit", "path", "lineStart"], ["commit", "path", "symbol"]],
      tool_result: [["receiptId", "jsonPointer"]],
    };
    const variants = requires[String(modality)];
    if (!variants || !variants.some((fields) => fields.every((field) => locator[field] !== undefined && locator[field] !== null))) {
      throw Object.assign(new Error(`Evidence locator is not precise enough for ${modality}.`), { code: "EVIDENCE_LOCATOR_INCOMPLETE" });
    }
    if (locator.bbox && (!Array.isArray(locator.bbox) || locator.bbox.length !== 4 || locator.bbox.some((number) => !Number.isFinite(Number(number))))) throw new Error("Evidence bounding box must contain four numbers.");
    if (locator.timeStartMs != null && Number(locator.timeEndMs) < Number(locator.timeStartMs)) throw new Error("Evidence time range is reversed.");
    return { ...locator };
  }

  function addEvidence(input = {}) {
    const capture = db.prepare("SELECT c.*,s.scope_id FROM source_captures c JOIN sources s ON s.id=c.source_id WHERE c.id=?").get(String(input.captureId));
    if (!capture) throw new Error("Source capture is unavailable.");
    const modality = String(input.modality); const locator = validateLocator(modality, input.locator);
    const excerpt = input.excerpt == null ? null : String(input.excerpt); const excerptHash = hash(excerpt || input.contentHash || locator, "evidence-excerpt-v1");
    const locatorId = encrypt(capture.scope_id, "evidence-locator", locator);
    const excerptId = excerpt == null ? null : encrypt(capture.scope_id, "evidence-excerpt", { text: excerpt }, String(input.sensitivity || "private"));
    const id = String(input.id || crypto.randomUUID());
    db.prepare("INSERT INTO evidence_units(id,capture_id,modality,locator_encrypted_id,excerpt_encrypted_id,excerpt_hash,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, capture.id, modality, locatorId, excerptId, excerptHash, clock().toISOString());
    return { id, captureId: capture.id, modality, locator, excerptHash };
  }

  function linkEvidence(input = {}) {
    const evidence = db.prepare("SELECT id FROM evidence_units WHERE id=?").get(String(input.evidenceId));
    if (!evidence) throw new Error("Evidence is unavailable.");
    const targetChecks = {
      candidate: ["assertion_candidates", "id"], profile: ["hierarchical_profiles", "id"], entity: ["entities", "id"],
      task: ["tasks", "id"], segment: ["semantic_segments", "id"],
    };
    const targetType = String(input.targetType); const targetId = String(input.targetId); const target = targetChecks[targetType];
    if (!target || !db.prepare(`SELECT ${target[1]} FROM ${target[0]} WHERE ${target[1]}=?`).get(targetId)) throw new Error("Evidence target is unavailable.");
    const id = String(input.id || crypto.randomUUID());
    db.prepare(`INSERT INTO evidence_links(id,evidence_id,target_type,target_id,stance,entailment,independent_group,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, evidence.id, targetType, targetId, String(input.stance || "supports"),
      Math.max(0, Math.min(1, Number(input.entailment ?? 1))), String(input.independentGroup || evidence.id), clock().toISOString());
    return { id, evidenceId: evidence.id, targetType: String(input.targetType), targetId: String(input.targetId) };
  }

  function normalizeName(value) { return String(value).normalize("NFKC").trim().toLocaleLowerCase(); }

  function createEntity(input = {}) {
    const scopeId = String(input.scopeId); const type = String(input.type); const name = String(input.name || "");
    if (!scopeId || !type || !name) throw new Error("Entity scope, type, and name are required.");
    const nameHash = hash({ scopeId, type, name: normalizeName(name) }, "entity-name-v1");
    const prior = db.prepare("SELECT id FROM entities WHERE scope_id=? AND entity_type=? AND canonical_name_hash=?").get(scopeId, type, nameHash);
    if (prior) return { ...readEntity(prior.id), replayed: true };
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    db.prepare(`INSERT INTO entities(id,scope_id,entity_type,canonical_name_encrypted_id,canonical_name_hash,sensitivity,state,merged_into_entity_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'active',NULL,?,?)`).run(id, scopeId, type, encrypt(scopeId, "entity-canonical-name", { name }, String(input.sensitivity || "private")), nameHash, String(input.sensitivity || "private"), now, now);
    return { ...readEntity(id), replayed: false };
  }

  function readEntity(id) {
    const row = db.prepare("SELECT * FROM entities WHERE id=?").get(String(id));
    if (!row) throw new Error("Entity is unavailable.");
    return { id: row.id, scopeId: row.scope_id, type: row.entity_type, name: decrypt(row.canonical_name_encrypted_id).name, sensitivity: row.sensitivity, state: row.state,
      mergedIntoEntityId: row.merged_into_entity_id, aliases: db.prepare("SELECT * FROM entity_aliases WHERE entity_id=? ORDER BY created_at").all(row.id).map((alias) => ({ id: alias.id, value: decrypt(alias.alias_encrypted_id).alias, evidenceId: alias.evidence_id })) };
  }

  function addAlias(input = {}) {
    const entity = db.prepare("SELECT * FROM entities WHERE id=?").get(String(input.entityId));
    if (!entity || entity.state !== "active") throw new Error("Active entity is unavailable.");
    const alias = String(input.alias || ""); const aliasHash = hash({ scopeId: entity.scope_id, alias: normalizeName(alias) }, "entity-alias-v1");
    const prior = db.prepare("SELECT id FROM entity_aliases WHERE entity_id=? AND alias_hash=?").get(entity.id, aliasHash);
    if (prior) return { id: prior.id, entityId: entity.id, replayed: true };
    const id = String(input.id || crypto.randomUUID());
    db.prepare("INSERT INTO entity_aliases(id,entity_id,alias_encrypted_id,alias_hash,evidence_id,valid_from,valid_to,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, entity.id, encrypt(entity.scope_id, "entity-alias", { alias }, entity.sensitivity), aliasHash, input.evidenceId ? String(input.evidenceId) : null,
        input.validFrom ? String(input.validFrom) : null, input.validTo ? String(input.validTo) : null, clock().toISOString());
    return { id, entityId: entity.id, replayed: false };
  }

  function resolveEntity(scopeId, name) {
    const normalized = normalizeName(name); const rows = db.prepare("SELECT * FROM entities WHERE scope_id=? AND state IN ('active','merged')").all(String(scopeId));
    const direct = rows.find((row) => row.canonical_name_hash === hash({ scopeId: String(scopeId), type: row.entity_type, name: normalized }, "entity-name-v1"));
    if (direct) return readEntity(direct.merged_into_entity_id || direct.id);
    const aliasHash = hash({ scopeId: String(scopeId), alias: normalized }, "entity-alias-v1");
    const alias = db.prepare(`SELECT a.entity_id,e.merged_into_entity_id FROM entity_aliases a JOIN entities e ON e.id=a.entity_id
      WHERE e.scope_id=? AND e.state IN ('active','merged') AND a.alias_hash=? AND (a.valid_to IS NULL OR a.valid_to>?) ORDER BY a.created_at DESC LIMIT 1`).get(String(scopeId), aliasHash, clock().toISOString());
    return alias ? readEntity(alias.merged_into_entity_id || alias.entity_id) : null;
  }

  function mergeEntities(input = {}) {
    const run = db.transaction(() => {
      const primary = db.prepare("SELECT * FROM entities WHERE id=?").get(String(input.primaryEntityId));
      const duplicate = db.prepare("SELECT * FROM entities WHERE id=?").get(String(input.duplicateEntityId));
      if (!primary || !duplicate || primary.state !== "active" || duplicate.state !== "active" || primary.scope_id !== duplicate.scope_id) throw new Error("Entities must be active in the same scope.");
      const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
      const rationale = encrypt(primary.scope_id, "entity-merge-rationale", input.rationale || {});
      db.prepare("INSERT INTO entity_merge_events(id,primary_entity_id,duplicate_entity_id,rationale_encrypted_id,evidence_id,state,created_at,reversed_at) VALUES(?,?,?,?,?,'active',?,NULL)")
        .run(id, primary.id, duplicate.id, rationale, input.evidenceId ? String(input.evidenceId) : null, now);
      db.prepare("UPDATE entities SET state='merged',merged_into_entity_id=?,updated_at=? WHERE id=?").run(primary.id, now, duplicate.id);
      faultInjector("knowledge.entity.merge.before_commit");
      return { mergeId: id, primaryEntityId: primary.id, duplicateEntityId: duplicate.id, state: "active" };
    });
    return run.immediate();
  }

  function reverseMerge(mergeId) {
    const run = db.transaction(() => {
      const merge = db.prepare("SELECT * FROM entity_merge_events WHERE id=?").get(String(mergeId));
      if (!merge || merge.state !== "active") throw new Error("Active entity merge is unavailable.");
      const now = clock().toISOString();
      db.prepare("UPDATE entity_merge_events SET state='reversed',reversed_at=? WHERE id=?").run(now, merge.id);
      db.prepare("UPDATE entities SET state='active',merged_into_entity_id=NULL,updated_at=? WHERE id=? AND merged_into_entity_id=?").run(now, merge.duplicate_entity_id, merge.primary_entity_id);
      return { mergeId: merge.id, state: "reversed", restoredEntityId: merge.duplicate_entity_id };
    });
    return run.immediate();
  }

  function createCandidate(input = {}) {
    if (!input.scopeId || input.subject == null || !input.predicate || input.object == null) throw new Error("Candidate scope, subject, predicate, and object are required.");
    if (input.rawSegmentId && !db.prepare("SELECT id FROM semantic_segments WHERE id=?").get(String(input.rawSegmentId))) throw new Error("Raw semantic segment is unavailable.");
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString(); const sensitivity = String(input.sensitivity || "private");
    db.prepare(`INSERT INTO assertion_candidates(id,scope_id,raw_segment_id,subject_encrypted_id,predicate,object_encrypted_id,status,sensitivity,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'candidate',?,?,?)`).run(id, String(input.scopeId), input.rawSegmentId ? String(input.rawSegmentId) : null,
      encrypt(String(input.scopeId), "candidate-subject", input.subject, sensitivity), String(input.predicate), encrypt(String(input.scopeId), "candidate-object", input.object, sensitivity), sensitivity, now, now);
    return { id, status: "candidate" };
  }

  function createProfile(input = {}) {
    const candidateIds = [...new Set((input.candidateIds || []).map(String))]; const uncovered = Array.isArray(input.uncoveredFailures) ? input.uncoveredFailures : [];
    if (!input.scopeId || !input.subjectRef || !candidateIds.length) throw new Error("Profile scope, subject, and candidates are required.");
    const placeholders = candidateIds.map(() => "?").join(",");
    const candidates = db.prepare(`SELECT id,scope_id FROM assertion_candidates WHERE id IN (${placeholders})`).all(...candidateIds);
    if (candidates.length !== candidateIds.length || candidates.some((row) => row.scope_id !== String(input.scopeId))) throw new Error("Profile candidates must exist in the profile scope.");
    const coverageRows = db.prepare(`SELECT el.target_id AS candidate_id,s.id AS source_id,sc.id AS capture_id,eu.id AS evidence_id
      FROM evidence_links el JOIN evidence_units eu ON eu.id=el.evidence_id JOIN source_captures sc ON sc.id=eu.capture_id JOIN sources s ON s.id=sc.source_id
      WHERE el.target_type='candidate' AND el.target_id IN (${placeholders}) ORDER BY el.target_id,s.id,sc.capture_version,eu.id`).all(...candidateIds);
    const covered = new Set(coverageRows.map((row) => row.candidate_id)); const missing = candidateIds.filter((id) => !covered.has(id));
    if (missing.length && !uncovered.length) throw Object.assign(new Error("Profile has uncovered candidates and must declare failures."), { code: "PROFILE_COVERAGE_INCOMPLETE", missingCandidateIds: missing });
    const version = Number(db.prepare("SELECT COALESCE(MAX(profile_version),0)+1 AS next FROM hierarchical_profiles WHERE scope_id=? AND level=? AND subject_ref=?")
      .get(String(input.scopeId), String(input.level), String(input.subjectRef)).next);
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    const coverage = { candidates: candidateIds, sources: [...new Set(coverageRows.map((row) => row.source_id))], links: coverageRows };
    const payloadId = encrypt(String(input.scopeId), "hierarchical-profile", input.payload || {}, String(input.sensitivity || "private"));
    db.prepare(`INSERT INTO hierarchical_profiles(id,scope_id,level,subject_ref,profile_version,payload_encrypted_id,source_coverage_json,uncovered_failures_json,state,parent_profile_id,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, String(input.scopeId), String(input.level), String(input.subjectRef), version, payloadId, JSON.stringify(coverage), JSON.stringify(uncovered),
      String(input.state || "candidate"), input.parentProfileId ? String(input.parentProfileId) : null, now);
    candidateIds.forEach((candidateId, ordinal) => db.prepare("INSERT INTO profile_candidates(profile_id,candidate_id,ordinal) VALUES(?,?,?)").run(id, candidateId, ordinal));
    return { id, version, coverage, uncoveredFailures: uncovered };
  }

  function drillDown(targetType, targetId) {
    const links = db.prepare(`SELECT el.*,eu.capture_id,eu.modality,eu.locator_encrypted_id,eu.excerpt_encrypted_id,eu.excerpt_hash,
      sc.source_id,sc.capture_version,sc.content_hash,s.scope_id,s.source_type,s.canonical_locator_encrypted_id,s.title_encrypted_id,s.trust_zone,s.reliability
      FROM evidence_links el JOIN evidence_units eu ON eu.id=el.evidence_id JOIN source_captures sc ON sc.id=eu.capture_id JOIN sources s ON s.id=sc.source_id
      WHERE el.target_type=? AND el.target_id=? ORDER BY s.id,sc.capture_version,eu.id`).all(String(targetType), String(targetId));
    return links.map((row) => ({ evidenceId: row.evidence_id, stance: row.stance, entailment: row.entailment, independentGroup: row.independent_group,
      evidence: { modality: row.modality, locator: decrypt(row.locator_encrypted_id), excerpt: decrypt(row.excerpt_encrypted_id)?.text || null, excerptHash: row.excerpt_hash },
      capture: { id: row.capture_id, version: row.capture_version, contentHash: row.content_hash },
      source: { id: row.source_id, type: row.source_type, locator: decrypt(row.canonical_locator_encrypted_id), title: decrypt(row.title_encrypted_id)?.title || null, trustZone: row.trust_zone, reliability: row.reliability } }));
  }

  function traverseProfile(profileId) {
    const profile = db.prepare("SELECT * FROM hierarchical_profiles WHERE id=?").get(String(profileId));
    if (!profile) throw new Error("Profile is unavailable.");
    const candidates = db.prepare(`SELECT ac.* FROM profile_candidates pc JOIN assertion_candidates ac ON ac.id=pc.candidate_id WHERE pc.profile_id=? ORDER BY pc.ordinal`).all(profile.id)
      .map((row) => ({ id: row.id, rawSegmentId: row.raw_segment_id, subject: decrypt(row.subject_encrypted_id), predicate: row.predicate, object: decrypt(row.object_encrypted_id), evidence: drillDown("candidate", row.id) }));
    const lineage = []; let cursor = profile;
    while (cursor) { lineage.push({ id: cursor.id, level: cursor.level, subjectRef: cursor.subject_ref, version: cursor.profile_version }); cursor = cursor.parent_profile_id ? db.prepare("SELECT * FROM hierarchical_profiles WHERE id=?").get(cursor.parent_profile_id) : null; }
    return { id: profile.id, level: profile.level, subjectRef: profile.subject_ref, version: profile.profile_version, payload: decrypt(profile.payload_encrypted_id),
      coverage: JSON.parse(profile.source_coverage_json), uncoveredFailures: JSON.parse(profile.uncovered_failures_json), lineage, candidates };
  }

  return Object.freeze({ addAlias, addCapture, addEvidence, createCandidate, createEntity, createProfile, createSource, drillDown, linkEvidence, mergeEntities, readEntity, readSource, resolveEntity, reverseMerge, traverseProfile, validateLocator });
}

module.exports = { createKnowledgeRepository };
