"use strict";

function createCandidateProjectionRepository({ db, keyring }) {
  function decrypt(id) {
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }

  function run(runId) { return db.prepare("SELECT id,status,pending_review_rows,conflict_rows FROM import_runs WHERE id=?").get(String(runId)); }
  function page(runId, after = "", limit = 200) {
    return db.prepare("SELECT id,legacy_table,legacy_id,record_type,proposed_scope,sensitivity,normalized_hash,payload_encrypted_id FROM import_candidates WHERE run_id=? AND decision='accepted' AND id>? ORDER BY id LIMIT ?")
      .all(String(runId), String(after), Math.max(1, Math.min(500, Number(limit) || 200))).map((row) => ({
        id: row.id, legacyTable: row.legacy_table, legacyId: row.legacy_id, recordType: row.record_type, scopeId: row.proposed_scope === "unscoped-review" ? "owner:local" : row.proposed_scope,
        sensitivity: row.sensitivity, normalizedHash: row.normalized_hash, payload: decrypt(row.payload_encrypted_id),
      }));
  }
  function projection(version) { return db.prepare("SELECT id,state FROM retrieval_projections WHERE projection_version=?").get(String(version)); }

  return Object.freeze({ page, projection, run });
}

module.exports = { createCandidateProjectionRepository };
