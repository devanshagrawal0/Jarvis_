"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

const EPISTEMIC_STATES = new Set(["observed", "owner_asserted", "source_asserted", "inferred", "hypothetical", "disputed", "superseded", "retracted"]);

function clamp(value) { return Math.max(0, Math.min(1, Number(value))); }
function requireStructuralRef(value, label, pattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/) {
  const text = String(value || ""); if (!pattern.test(text)) throw new Error(`${label} must be a bounded structural identifier.`); return text;
}
function confidenceVector(input = {}) {
  const vector = {
    extraction: clamp(input.extraction ?? 1), sourceReliability: clamp(input.sourceReliability ?? 0.5),
    corroboration: clamp(input.corroboration ?? 0), freshness: clamp(input.freshness ?? 1),
    userConfirmation: clamp(input.userConfirmation ?? 0), contradictionPenalty: clamp(input.contradictionPenalty ?? 0),
    policyVersion: String(input.policyVersion || "confidence:v1"),
  };
  vector.computed = clamp(0.20 * vector.extraction + 0.20 * vector.sourceReliability + 0.18 * vector.corroboration
    + 0.14 * vector.freshness + 0.28 * vector.userConfirmation - 0.25 * vector.contradictionPenalty);
  return vector;
}

function createAssertionRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 10) throw new Error("Assertion truth requires schema version 10.");

  function decrypt(id) {
    if (!id) return null;
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }
  function hashObject(value) { return keyring.sign(JSON.stringify(value), "assertion-object-semantics-v1"); }
  function actor(id) {
    const row = db.prepare("SELECT * FROM actors WHERE id=?").get(String(id));
    if (!row || row.status !== "active") throw new Error("Assertion actor is unavailable.");
    return row;
  }
  function assertion(id) {
    const row = db.prepare("SELECT * FROM assertions WHERE id=?").get(String(id));
    if (!row) throw new Error("Assertion is unavailable.");
    return row;
  }
  function currentVersion(assertionId) { return db.prepare("SELECT * FROM assertion_versions WHERE assertion_id=? AND recorded_to IS NULL").get(String(assertionId)); }

  function validateEpistemic(state, actorRow, evidence) {
    if (!EPISTEMIC_STATES.has(state)) throw new Error("Unsupported epistemic state.");
    if (state === "owner_asserted" && actorRow.actor_type !== "owner") throw Object.assign(new Error("Only the owner can create owner-asserted truth."), { code: "OWNER_AUTHORITY_REQUIRED" });
    if (state === "source_asserted" && !evidence.some((item) => String(item.stance || "supports") === "supports")) throw new Error("Source-asserted truth requires supporting evidence.");
  }

  function insertVersion(parent, input, versionNumber, now) {
    const state = String(input.epistemicState || "inferred"); const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    const actorRow = actor(input.createdBy || parent.created_by); validateEpistemic(state, actorRow, evidence);
    const vector = confidenceVector(input.confidence);
    const validFrom = String(input.validFrom || now); const validTo = input.validTo ? String(input.validTo) : null;
    if (validTo && validTo <= validFrom) throw new Error("Assertion valid-time interval is invalid.");
    const objectId = state === "retracted" && input.object == null ? null : insertEncrypted(db, keyring, clock, {
      objectType: "assertion-object", scopeId: parent.scope_id, sensitivity: String(input.sensitivity || "private"), payload: input.object,
    }).id;
    const provenanceId = input.provenance == null ? null : insertEncrypted(db, keyring, clock, {
      objectType: "assertion-provenance", scopeId: parent.scope_id, sensitivity: String(input.sensitivity || "private"), payload: input.provenance,
    }).id;
    const versionId = String(input.versionId || crypto.randomUUID());
    db.prepare(`INSERT INTO assertion_versions
      (id,assertion_id,version,object_type,object_encrypted_id,polarity,epistemic_state,valid_from,valid_to,recorded_from,recorded_to,provenance_encrypted_id,
       confidence_extraction,confidence_source_reliability,confidence_corroboration,confidence_freshness,confidence_user_confirmation,confidence_contradiction_penalty,
       confidence_computed,confidence_policy_version,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?)`).run(versionId, parent.id, versionNumber, String(input.objectType || "literal"), objectId,
      input.polarity === false ? 0 : 1, state, validFrom, validTo, now, provenanceId, vector.extraction, vector.sourceReliability, vector.corroboration,
      vector.freshness, vector.userConfirmation, vector.contradictionPenalty, vector.computed, vector.policyVersion, actorRow.id, now);
    for (const item of evidence) {
      if (!db.prepare("SELECT id FROM evidence_units WHERE id=?").get(String(item.evidenceId))) throw new Error("Assertion evidence is unavailable.");
      db.prepare(`INSERT INTO assertion_version_evidence(assertion_version_id,evidence_id,stance,entailment,independent_group,created_at)
        VALUES(?,?,?,?,?,?)`).run(versionId, String(item.evidenceId), String(item.stance || "supports"), clamp(item.entailment ?? 1), String(item.independentGroup || item.evidenceId), now);
    }
    return versionId;
  }

  function createAssertion(input = {}) {
    const scopeId = String(input.scopeId || ""); const subjectType = String(input.subjectType || "literal"); const subjectRef = requireStructuralRef(input.subjectRef, "Assertion subject");
    const predicate = requireStructuralRef(input.predicate, "Assertion predicate", /^[a-z][a-z0-9_.-]{0,127}$/); const createdBy = String(input.createdBy || "local-owner");
    if (!scopeId || !subjectRef || !predicate || input.object === undefined) throw new Error("Assertion scope, subject, predicate, and object are required.");
    const semanticsHash = hashObject(input.object); const prior = db.prepare(`SELECT id FROM assertions WHERE scope_id=? AND subject_type=? AND subject_ref=? AND predicate=? AND object_semantics_hash=?`)
      .get(scopeId, subjectType, subjectRef, predicate, semanticsHash);
    if (prior) return { ...readAssertion(prior.id), replayed: true };
    const run = db.transaction(() => {
      actor(createdBy); const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
      db.prepare(`INSERT INTO assertions(id,scope_id,subject_type,subject_ref,predicate,object_semantics_hash,status,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'active',?,?,?)`).run(id, scopeId, subjectType, subjectRef, predicate, semanticsHash, createdBy, now, now);
      const parent = assertion(id); const versionId = insertVersion(parent, { ...input, createdBy }, 1, now);
      faultInjector("assertion.create.before_commit");
      return { ...readAssertion(id), versionId, replayed: false };
    });
    return run.immediate();
  }

  function reviseAssertion(assertionId, input = {}) {
    const run = db.transaction(() => {
      const parent = assertion(assertionId); const current = currentVersion(parent.id);
      if (!current) throw new Error("Assertion has no current recorded version.");
      const now = clock().toISOString();
      const priorObject = decrypt(current.object_encrypted_id);
      const priorEvidence = db.prepare("SELECT evidence_id AS evidenceId,stance,entailment,independent_group AS independentGroup FROM assertion_version_evidence WHERE assertion_version_id=? ORDER BY evidence_id").all(current.id);
      db.prepare("UPDATE assertion_versions SET recorded_to=? WHERE id=? AND recorded_to IS NULL").run(now, current.id);
      const versionId = insertVersion(parent, {
        object: input.object === undefined ? priorObject : input.object, objectType: input.objectType || current.object_type,
        polarity: input.polarity === undefined ? Boolean(current.polarity) : input.polarity,
        epistemicState: input.epistemicState || current.epistemic_state, validFrom: input.validFrom || current.valid_from,
        validTo: input.validTo === undefined ? current.valid_to : input.validTo, provenance: input.provenance,
        confidence: input.confidence || { extraction: current.confidence_extraction, sourceReliability: current.confidence_source_reliability,
          corroboration: current.confidence_corroboration, freshness: current.confidence_freshness, userConfirmation: current.confidence_user_confirmation,
          contradictionPenalty: current.confidence_contradiction_penalty, policyVersion: current.confidence_policy_version },
        evidence: input.evidence === undefined ? priorEvidence : input.evidence, createdBy: input.createdBy || parent.created_by, sensitivity: input.sensitivity,
      }, current.version + 1, now);
      const state = String(input.epistemicState || current.epistemic_state);
      const assertionStatus = state === "retracted" ? "retracted" : state === "disputed" ? "contested" : state === "superseded" ? "superseded" : "active";
      db.prepare("UPDATE assertions SET status=?,updated_at=? WHERE id=?").run(assertionStatus, now, parent.id);
      faultInjector("assertion.revise.before_commit");
      return { ...readAssertion(parent.id), versionId };
    });
    return run.immediate();
  }

  function formatVersion(row) {
    if (!row) return null;
    return { id: row.id, assertionId: row.assertion_id, version: row.version, objectType: row.object_type, object: decrypt(row.object_encrypted_id), polarity: Boolean(row.polarity),
      epistemicState: row.epistemic_state, validFrom: row.valid_from, validTo: row.valid_to, recordedFrom: row.recorded_from, recordedTo: row.recorded_to,
      provenance: decrypt(row.provenance_encrypted_id), confidence: { extraction: row.confidence_extraction, sourceReliability: row.confidence_source_reliability,
        corroboration: row.confidence_corroboration, freshness: row.confidence_freshness, userConfirmation: row.confidence_user_confirmation,
        contradictionPenalty: row.confidence_contradiction_penalty, computed: row.confidence_computed, policyVersion: row.confidence_policy_version },
      evidence: db.prepare("SELECT evidence_id AS evidenceId,stance,entailment,independent_group AS independentGroup FROM assertion_version_evidence WHERE assertion_version_id=? ORDER BY evidence_id").all(row.id) };
  }
  function readAssertion(id) {
    const row = assertion(id); const versions = db.prepare("SELECT * FROM assertion_versions WHERE assertion_id=? ORDER BY version").all(row.id).map(formatVersion);
    return { id: row.id, scopeId: row.scope_id, subjectType: row.subject_type, subjectRef: row.subject_ref, predicate: row.predicate, status: row.status, versions, currentVersion: versions.find((item) => item.recordedTo == null) || null };
  }

  function query(input = {}) {
    const validAt = String(input.validAt || clock().toISOString()); const recordedAt = String(input.recordedAt || clock().toISOString());
    const clauses = ["a.scope_id=?", "v.valid_from<=?", "(v.valid_to IS NULL OR v.valid_to>?)", "v.recorded_from<=?", "(v.recorded_to IS NULL OR v.recorded_to>?)"];
    const args = [String(input.scopeId), validAt, validAt, recordedAt, recordedAt];
    for (const [field, column] of [["subjectType","a.subject_type"],["subjectRef","a.subject_ref"],["predicate","a.predicate"],["epistemicState","v.epistemic_state"]]) if (input[field]) { clauses.push(`${column}=?`); args.push(String(input[field])); }
    if (!input.includeRetracted) clauses.push("v.epistemic_state NOT IN ('retracted','superseded')");
    return db.prepare(`SELECT v.* FROM assertion_versions v JOIN assertions a ON a.id=v.assertion_id WHERE ${clauses.join(" AND ")} ORDER BY a.predicate,v.valid_from,v.version`).all(...args).map(formatVersion);
  }

  function createConflict(input = {}) {
    const versionIds = [...new Set((input.versionIds || []).map(String))];
    if (versionIds.length < 2) throw new Error("A conflict requires at least two assertion versions.");
    const placeholders = versionIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT v.*,a.scope_id,a.subject_type,a.subject_ref,a.predicate FROM assertion_versions v JOIN assertions a ON a.id=v.assertion_id WHERE v.id IN (${placeholders})`).all(...versionIds);
    if (rows.length !== versionIds.length || rows.some((row) => row.scope_id !== rows[0].scope_id || row.subject_type !== rows[0].subject_type || row.subject_ref !== rows[0].subject_ref || row.predicate !== rows[0].predicate)) throw new Error("Conflict members must share scope, subject, and predicate.");
    const run = db.transaction(() => {
      const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
      db.prepare("INSERT INTO conflict_sets(id,scope_id,subject_type,subject_ref,predicate,status,rationale_encrypted_id,winning_version_id,created_at,resolved_at) VALUES(?,?,?,?,?,'open',NULL,NULL,?,NULL)")
        .run(id, rows[0].scope_id, rows[0].subject_type, rows[0].subject_ref, rows[0].predicate, now);
      rows.forEach((row, index) => {
        db.prepare("INSERT INTO conflict_members(conflict_id,assertion_version_id,role,independent_group,created_at) VALUES(?,?,'competing',?,?)")
          .run(id, row.id, String(input.independentGroups?.[index] || `claim:${row.id}`), now);
        db.prepare("UPDATE assertions SET status='contested',updated_at=? WHERE id=?").run(now, row.assertion_id);
      });
      return { id, status: "open", versionIds };
    });
    return run.immediate();
  }

  function resolveConflict(input = {}) {
    const run = db.transaction(() => {
      const conflict = db.prepare("SELECT * FROM conflict_sets WHERE id=? AND status='open'").get(String(input.conflictId));
      if (!conflict) throw new Error("Open conflict is unavailable.");
      const winner = db.prepare("SELECT v.*,a.id AS assertion_id FROM conflict_members cm JOIN assertion_versions v ON v.id=cm.assertion_version_id JOIN assertions a ON a.id=v.assertion_id WHERE cm.conflict_id=? AND v.id=?")
        .get(conflict.id, String(input.winningVersionId));
      if (!winner) throw new Error("Conflict winner must be a member.");
      const decidingActor = actor(input.decidedBy || "local-owner"); if (decidingActor.actor_type !== "owner") throw Object.assign(new Error("Conflict resolution requires owner authority."), { code: "OWNER_AUTHORITY_REQUIRED" });
      const now = clock().toISOString(); const rationaleId = insertEncrypted(db, keyring, clock, { objectType: "conflict-resolution", scopeId: conflict.scope_id, sensitivity: "private", payload: input.rationale || {} }).id;
      db.prepare("UPDATE conflict_sets SET status='resolved',rationale_encrypted_id=?,winning_version_id=?,resolved_at=? WHERE id=?").run(rationaleId, winner.id, now, conflict.id);
      db.prepare("UPDATE conflict_members SET role=CASE WHEN assertion_version_id=? THEN 'supporting' ELSE 'refuted' END WHERE conflict_id=?").run(winner.id, conflict.id);
      const members = db.prepare("SELECT v.assertion_id,v.epistemic_state FROM conflict_members cm JOIN assertion_versions v ON v.id=cm.assertion_version_id WHERE cm.conflict_id=?").all(conflict.id);
      members.forEach((member) => {
        reviseAssertion(member.assertion_id, { epistemicState: member.assertion_id === winner.assertion_id ? member.epistemic_state : "superseded",
          createdBy: decidingActor.id, provenance: { conflictId: conflict.id, resolution: member.assertion_id === winner.assertion_id ? "winner" : "loser" } });
        db.prepare("UPDATE assertions SET status=?,updated_at=? WHERE id=?").run(member.assertion_id === winner.assertion_id ? "active" : "superseded", now, member.assertion_id);
      });
      faultInjector("assertion.conflict.resolve.before_commit");
      return { id: conflict.id, status: "resolved", winningVersionId: winner.id };
    });
    return run.immediate();
  }

  return Object.freeze({ confidenceVector, createAssertion, createConflict, query, readAssertion, resolveConflict, reviseAssertion });
}

module.exports = { EPISTEMIC_STATES, confidenceVector, createAssertionRepository, requireStructuralRef };
