"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");
const { adaptLegacyRecord, canonical, sha256 } = require("../import-adapters");
const { adviseImportCandidate } = require("../import-review-advisor");

function createImportStagingRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 28) throw new Error("Legacy import requires schema version 28.");
  const now = () => clock().toISOString();
  const encrypt = (scopeId, type, payload, sensitivity = "private") => insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id;
  const decrypt = (id) => { const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(String(id)); if (!row) return null; return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8")); };
  const sign = (value, purpose) => keyring.sign(JSON.stringify(canonical(value)), purpose);
  const requireOwner = (actorId, zone) => { const actor = db.prepare("SELECT actor_type,status FROM actors WHERE id=?").get(String(actorId)); if (!actor || actor.actor_type !== "owner" || actor.status !== "active" || zone !== "owner") throw Object.assign(new Error("Direct owner authority is required."), { code: "OWNER_AUTHORITY_REQUIRED" }); };

  function createRun(input = {}) {
    const sources = Array.isArray(input.sources) ? input.sources : [];
    if (!sources.length) throw new Error("At least one closed snapshot source is required.");
    const id = String(input.id || crypto.randomUUID());
    const expectedRows = sources.reduce((sum, source) => sum + Math.max(0, Number(source.expectedRows) || 0), 0);
    const manifest = { inventoryHash: String(input.inventoryHash || ""), snapshotSetHash: String(input.snapshotSetHash || ""), adapterVersion: String(input.adapterVersion || "wave30-v1"), sources: sources.map(({ snapshotPath, ...source }) => ({ ...source, snapshotPathHash: sha256(String(snapshotPath || "")) })) };
    if (!manifest.inventoryHash || !manifest.snapshotSetHash) throw new Error("Inventory and snapshot-set hashes are required.");
    const run = db.transaction(() => {
      const manifestId = encrypt("owner:local", "legacy-import-manifest", manifest, "restricted");
      db.prepare("INSERT INTO import_runs(id,inventory_hash,snapshot_set_hash,adapter_version,manifest_encrypted_id,expected_rows,status,created_at) VALUES(?,?,?,?,?,?,'staging',?)").run(id, manifest.inventoryHash, manifest.snapshotSetHash, manifest.adapterVersion, manifestId, expectedRows, now());
      for (const source of sources) {
        const sourceId = String(source.id || crypto.randomUUID());
        const pathId = encrypt("owner:local", "legacy-snapshot-path", { path: String(source.snapshotPath || ""), sourceKey: String(source.sourceKey || "") }, "restricted");
        db.prepare(`INSERT INTO import_sources(id,run_id,source_key,source_kind,snapshot_sha256,snapshot_path_encrypted_id,table_name,expected_rows,status,policy_version,created_at)
          VALUES(?,?,?,?,?,?,?,?, 'pending',?,?)`).run(sourceId, id, String(source.sourceKey), String(source.sourceKind || "sqlite"), String(source.snapshotSha256), pathId, String(source.table), Math.max(0, Number(source.expectedRows) || 0), String(source.policyVersion || "wave30-v1"), now());
      }
      faultInjector("import.run.before_commit");
      // A-09 — this returned the sources sorted by source_key,table_name while inserting them in
      // input order, so any caller that indexes positionally (`run.sources[0]`) got a different
      // source than it passed. Production looks sources up by key+table and was safe; the
      // shipped tests did not, and staged their fixture rows into the wrong source. The return
      // value now preserves input order, which is the only order a caller can predict.
      const inserted = db.prepare("SELECT id,source_key,table_name,expected_rows FROM import_sources WHERE run_id=?").all(id);
      const bySourceKey = new Map(inserted.map((row) => [[row.source_key, row.table_name].join("\u0000"), row]));
      const ordered = sources
        .map((source) => bySourceKey.get([String(source.sourceKey), String(source.table)].join("\u0000")))
        .filter(Boolean);
      return { id, expectedRows, sources: ordered.length === inserted.length ? ordered : inserted };
    });
    return run.immediate();
  }

  function tokenSet(candidate) {
    const payload = decrypt(candidate.payload_encrypted_id) || {};
    return new Set(JSON.stringify(payload).toLocaleLowerCase().match(/[a-z0-9]{3,}/g) || []);
  }
  function jaccard(left, right) { const union = new Set([...left, ...right]); if (!union.size) return 0; let overlap = 0; for (const item of left) if (right.has(item)) overlap += 1; return overlap / union.size; }
  function pair(a, b) { return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)]; }

  function analyzeCandidate(runId, candidate) {
    if (candidate.decision === "rejected") return;
    const matches = [];
    const stable = db.prepare("SELECT * FROM import_candidates WHERE run_id=? AND id<>? AND legacy_table=? AND legacy_id=? AND decision<>'rejected' ORDER BY created_at,id LIMIT 1").get(runId, candidate.id, candidate.legacy_table, candidate.legacy_id); if (stable) matches.push({ other: stable, type: "stable_id", confidence: 1, decision: "confirmed" });
    const exact = candidate.normalized_hash ? db.prepare("SELECT * FROM import_candidates WHERE run_id=? AND id<>? AND normalized_hash=? AND decision<>'rejected' ORDER BY created_at,id LIMIT 1").get(runId, candidate.id, candidate.normalized_hash) : null; if (exact && exact.id !== stable?.id) matches.push({ other: exact, type: "exact_hash", confidence: 1, decision: "confirmed" });
    const typed = candidate.typed_key_hash ? db.prepare("SELECT * FROM import_candidates WHERE run_id=? AND id<>? AND typed_key_hash=? AND decision<>'rejected' ORDER BY created_at,id LIMIT 1").get(runId, candidate.id, candidate.typed_key_hash) : null;
    if (typed) {
      if (candidate.normalized_hash && candidate.normalized_hash === typed.normalized_hash) matches.push({ other: typed, type: "typed_key", confidence: 0.99, decision: "confirmed" });
      else { const conflictKey = sha256(`${runId}:${candidate.typed_key_hash}`); const existing = db.prepare("SELECT candidate_ids_json FROM import_conflicts WHERE run_id=? AND conflict_key=?").get(runId, conflictKey); const ids = [...new Set([...(existing ? JSON.parse(existing.candidate_ids_json) : []), candidate.id, typed.id])].sort(); db.prepare(`INSERT INTO import_conflicts(id,run_id,conflict_key,candidate_ids_json,conflict_type,severity,status,created_at) VALUES(?,?,?,?, 'typed_value','high','open',?) ON CONFLICT(run_id,conflict_key) DO UPDATE SET candidate_ids_json=excluded.candidate_ids_json`).run(crypto.randomUUID(), runId, conflictKey, JSON.stringify(ids), now()); db.prepare(`UPDATE import_candidates SET decision='conflict',requires_owner_review=1,updated_at=? WHERE id IN (${ids.map(() => "?").join(",")})`).run(now(), ...ids); }
    }
    if (["memory_candidate", "protected_personal_candidate", "procedure_candidate"].includes(candidate.record_type) && candidate.normalized_hash) {
      const nearby = db.prepare("SELECT * FROM import_candidates WHERE run_id=? AND id<>? AND record_type=? AND decision<>'rejected' AND normalized_hash<>? ORDER BY created_at DESC,id DESC LIMIT 200").all(runId, candidate.id, candidate.record_type, candidate.normalized_hash); const ownTokens = tokenSet(candidate); let best = null; for (const other of nearby) { const similarity = jaccard(ownTokens, tokenSet(other)); if (similarity >= 0.85 && (!best || similarity > best.confidence)) best = { other, type: "near_text", confidence: similarity, decision: "proposed" }; } if (best) matches.push(best);
    }
    for (const match of matches) { const [a, b] = pair(candidate.id, match.other.id); db.prepare(`INSERT OR IGNORE INTO import_equivalences(id,run_id,candidate_a_id,candidate_b_id,match_type,confidence,decision,reversible,created_at) VALUES(?,?,?,?,?,?,?,1,?)`).run(crypto.randomUUID(), runId, a, b, match.type, match.confidence, match.decision, now()); }
  }

  function stageRecords(input = {}) {
    const source = db.prepare("SELECT * FROM import_sources WHERE id=?").get(String(input.sourceId));
    if (!source) throw new Error("Import source is unavailable.");
    const runState = db.prepare("SELECT status FROM import_runs WHERE id=?").get(source.run_id)?.status;
    if (runState !== "staging") throw new Error("Import run is not accepting staged records.");
    const rows = Array.isArray(input.rows) ? input.rows : [];
    const run = db.transaction(() => {
      let accepted = 0; let excluded = 0;
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]; const stableLegacyId = row?.id ?? row?.memory_id ?? `${source.table_name}:row:${Math.max(0, Number(input.offset) || 0) + rowIndex}`;
        const adapted = adaptLegacyRecord({ sourceKey: source.source_key, sourceKind: source.source_kind, table: source.table_name, row, legacyId: stableLegacyId });
        const id = crypto.randomUUID();
        const provenanceId = encrypt("owner:local", "legacy-import-provenance", adapted.provenance || { sourceKey: source.source_key, table: source.table_name, legacyId: adapted.legacyId, sourceRecordHash: adapted.sourceRecordHash }, "restricted");
        const payloadId = adapted.decision === "rejected" ? null : encrypt(adapted.scope.scope, `legacy-${adapted.recordType}`, adapted.payload, adapted.sensitivity);
        db.prepare(`INSERT INTO import_candidates(id,run_id,source_id,legacy_table,legacy_id,source_record_hash,record_type,proposed_scope,scope_confidence,scope_reason,sensitivity,payload_encrypted_id,provenance_encrypted_id,normalized_hash,typed_key_hash,decision,exclusion_reason,requires_owner_review,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, source.run_id, source.id, source.table_name, adapted.legacyId, adapted.sourceRecordHash, adapted.recordType, adapted.scope.scope, adapted.scope.confidence, adapted.scope.reason, adapted.sensitivity || "private", payloadId, provenanceId, adapted.normalizedHash, adapted.typedKeyHash, adapted.decision === "pending" && !adapted.requiresOwnerReview ? "accepted" : adapted.decision, adapted.exclusionReason, adapted.requiresOwnerReview ? 1 : 0, now(), now());
        const candidate = db.prepare("SELECT * FROM import_candidates WHERE id=?").get(id);
        analyzeCandidate(source.run_id, candidate);
        if (adapted.decision === "rejected") excluded += 1; else accepted += 1;
      }
      const totals = db.prepare("SELECT COUNT(*) AS observed,SUM(CASE WHEN decision='rejected' THEN 1 ELSE 0 END) AS excluded,SUM(CASE WHEN decision<>'rejected' THEN 1 ELSE 0 END) AS accepted FROM import_candidates WHERE source_id=?").get(source.id);
      const status = Number(totals.observed) === source.expected_rows ? (Number(totals.accepted) ? "staged" : "excluded") : "pending";
      db.prepare("UPDATE import_sources SET observed_rows=?,accepted_rows=?,excluded_rows=?,status=? WHERE id=?").run(totals.observed, totals.accepted || 0, totals.excluded || 0, status, source.id);
      faultInjector("import.stage.before_commit");
      return { sourceId: source.id, observedRows: Number(totals.observed), acceptedRows: Number(totals.accepted || 0), excludedRows: Number(totals.excluded || 0), added: accepted + excluded, status };
    });
    return run.immediate();
  }

  function excludeSource(input = {}) {
    const source = db.prepare("SELECT * FROM import_sources WHERE id=?").get(String(input.sourceId)); if (!source) throw new Error("Import source is unavailable."); const runState = db.prepare("SELECT status FROM import_runs WHERE id=?").get(source.run_id)?.status; if (runState !== "staging") throw new Error("Import run is not accepting exclusions."); const reason = String(input.reason || "ARCHIVE_ONLY"); if (!/^[A-Z][A-Z0-9_.-]{2,99}$/.test(reason)) throw new Error("Source exclusion reason must be a structural code."); const existing = Number(db.prepare("SELECT COUNT(*) AS count FROM import_candidates WHERE source_id=?").get(source.id).count); if (existing) throw new Error("A source with staged candidates cannot be bulk-excluded."); db.prepare("UPDATE import_sources SET observed_rows=expected_rows,accepted_rows=0,excluded_rows=expected_rows,exclusion_reason=?,status='excluded' WHERE id=?").run(reason, source.id); return { sourceId: source.id, observedRows: Number(source.expected_rows), acceptedRows: 0, excludedRows: Number(source.expected_rows), status: "excluded", reason };
  }

  function createReviewBatch(input = {}) {
    const id = String(input.id || crypto.randomUUID()); const runId = String(input.runId); const type = String(input.batchType || "sample");
    const clauses = { protected: "record_type='protected_personal_candidate'", scope: "proposed_scope='unscoped-review'", conflict: "decision='conflict'", procedure: "record_type='procedure_candidate'", domain_manifest: "record_type='domain_manifest_candidate'", sample: "requires_owner_review=1" };
    if (!clauses[type]) throw new Error("Review batch type is unsupported.");
    const candidates = db.prepare(`SELECT candidate.id FROM import_candidates candidate WHERE candidate.run_id=? AND candidate.decision<>'rejected' AND ${clauses[type]} AND NOT EXISTS (SELECT 1 FROM import_review_items item WHERE item.candidate_id=candidate.id) ORDER BY candidate.created_at,candidate.id LIMIT ?`).all(runId, Math.max(1, Math.min(1000, Number(input.limit) || 100)));
    const run = db.transaction(() => { db.prepare("INSERT INTO import_review_batches(id,run_id,batch_type,risk,status,created_by,created_at) VALUES(?,?,?,?, 'pending',?,?)").run(id, runId, type, String(input.risk || (type === "protected" || type === "conflict" ? "high" : "medium")), String(input.actorId || "local-owner"), now()); for (const item of candidates) db.prepare("INSERT INTO import_review_items(batch_id,candidate_id,decision) VALUES(?,?,'pending')").run(id, item.id); return { id, candidateIds: candidates.map((item) => item.id), status: "pending" }; });
    return run.immediate();
  }

  function decideReviewBatch(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const batch = db.prepare("SELECT * FROM import_review_batches WHERE id=? AND status IN ('pending','partial','approved')").get(String(input.batchId)); if (!batch) throw new Error("Open review batch is unavailable.");
    const decisions = new Map((input.decisions || []).map((item) => [String(item.candidateId), item]));
    const run = db.transaction(() => {
      const items = db.prepare("SELECT candidate_id,decision FROM import_review_items WHERE batch_id=?").all(batch.id); let accepted = 0; let rejected = 0; let quarantined = 0;
      for (const { candidate_id: candidateId, decision: currentDecision } of items) { const selected = decisions.get(candidateId); if (!selected || !["accept", "reject", "quarantine"].includes(selected.decision)) continue; if (batch.status === "approved" && currentDecision !== "quarantine") throw new Error("Completed review decisions are immutable; only quarantined items may be resolved."); const scopeId = selected.scopeId ? String(selected.scopeId) : null; if (scopeId && !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(scopeId)) throw new Error("Owner-selected scope is invalid."); db.prepare("UPDATE import_review_items SET decision=?,reason_code=? WHERE batch_id=? AND candidate_id=?").run(selected.decision, String(selected.reasonCode || "OWNER_REVIEW"), batch.id, candidateId); const next = selected.decision === "accept" ? "accepted" : selected.decision === "reject" ? "rejected" : "quarantined"; db.prepare("UPDATE import_candidates SET decision=?,requires_owner_review=0,proposed_scope=COALESCE(?,proposed_scope),scope_confidence=CASE WHEN ? IS NULL THEN scope_confidence ELSE 1 END,scope_reason=CASE WHEN ? IS NULL THEN scope_reason ELSE 'owner_assigned' END,exclusion_reason=CASE WHEN ?='rejected' THEN ? ELSE exclusion_reason END,updated_at=? WHERE id=?").run(next, scopeId, scopeId, scopeId, next, String(selected.reasonCode || "OWNER_REVIEW"), now(), candidateId); if (next === "accepted") accepted += 1; else if (next === "rejected") rejected += 1; else quarantined += 1; }
      const distribution = Object.fromEntries(db.prepare("SELECT decision,COUNT(*) AS count FROM import_review_items WHERE batch_id=? GROUP BY decision").all(batch.id).map((row) => [row.decision, Number(row.count)])); const remaining = Number(distribution.pending || 0) + Number(distribution.quarantine || 0); const status = remaining ? "partial" : Number(distribution.reject || 0) === items.length ? "rejected" : "approved"; const receipt = { batchId: batch.id, runId: batch.run_id, accepted, rejected, quarantined, remaining, status, distribution }; const receiptMac = sign(receipt, "legacy-import-owner-review:v1"); db.prepare("UPDATE import_review_batches SET status=?,decided_by=?,receipt_mac=?,decided_at=? WHERE id=?").run(status, String(input.actorId), receiptMac, now(), batch.id); faultInjector("import.review.before_commit"); return { ...receipt, receiptMac };
    }); return run.immediate();
  }

  function reconcile(input = {}) {
    const runRow = db.prepare("SELECT * FROM import_runs WHERE id=?").get(String(input.runId)); if (!runRow) throw new Error("Import run is unavailable.");
    for (const source of db.prepare("SELECT id,expected_rows FROM import_sources WHERE run_id=? AND exclusion_reason IS NULL").all(runRow.id)) { const counts = db.prepare("SELECT COUNT(*) AS observed,SUM(CASE WHEN decision='rejected' THEN 1 ELSE 0 END) AS excluded,SUM(CASE WHEN decision<>'rejected' THEN 1 ELSE 0 END) AS accepted FROM import_candidates WHERE source_id=?").get(source.id); const observedRows = Number(counts.observed || 0); const acceptedRows = Number(counts.accepted || 0); const excludedRows = Number(counts.excluded || 0); const status = observedRows === Number(source.expected_rows) ? (acceptedRows ? "staged" : "excluded") : "pending"; db.prepare("UPDATE import_sources SET observed_rows=?,accepted_rows=?,excluded_rows=?,status=? WHERE id=?").run(observedRows, acceptedRows, excludedRows, status, source.id); }
    const sources = db.prepare("SELECT source_key,table_name,snapshot_sha256,expected_rows,observed_rows,accepted_rows,excluded_rows,exclusion_reason,status FROM import_sources WHERE run_id=? ORDER BY source_key,table_name").all(runRow.id);
    const totals = db.prepare(`SELECT SUM(CASE WHEN decision<>'rejected' THEN 1 ELSE 0 END) AS staged,SUM(CASE WHEN decision='conflict' THEN 1 ELSE 0 END) AS conflicts,SUM(CASE WHEN requires_owner_review=1 OR decision IN ('pending','conflict','quarantined') THEN 1 ELSE 0 END) AS pending FROM import_candidates WHERE run_id=?`).get(runRow.id);
    const conflicts = Number(db.prepare("SELECT COUNT(*) AS count FROM import_conflicts WHERE run_id=? AND status='open'").get(runRow.id).count);
    const expected = Number(runRow.expected_rows); const observed = sources.reduce((sum, source) => sum + Number(source.observed_rows), 0); const staged = Number(totals.staged || 0); const excluded = sources.reduce((sum, source) => sum + Number(source.excluded_rows), 0); const pending = Number(totals.pending || 0); const passed = expected === observed && observed === staged + excluded && pending === 0 && conflicts === 0 && sources.every((source) => Number(source.expected_rows) === Number(source.observed_rows));
    const rowExclusions = db.prepare("SELECT exclusion_reason,COUNT(*) AS count FROM import_candidates WHERE run_id=? AND decision='rejected' GROUP BY exclusion_reason ORDER BY exclusion_reason").all(runRow.id); const sourceExclusions = sources.filter((source) => source.exclusion_reason).map((source) => ({ exclusion_reason: source.exclusion_reason, count: Number(source.excluded_rows), source_key: source.source_key, table_name: source.table_name }));
    const receipt = { id: String(input.id || crypto.randomUUID()), runId: runRow.id, expectedRows: expected, observedRows: observed, stagedRows: staged, excludedRows: excluded, conflictRows: conflicts, pendingReviewRows: pending, sourceHashes: sources.map((source) => ({ sourceKey: source.source_key, table: source.table_name, sha256: source.snapshot_sha256 })), exclusions: [...rowExclusions, ...sourceExclusions], sensitivePolicy: { plaintextPayloads: false, protectedOwnerReview: true, semanticAutoMerge: false }, passed };
    const existingReceipt = db.prepare("SELECT id FROM import_reconciliation_receipts WHERE run_id=?").get(runRow.id); if (existingReceipt) receipt.id = existingReceipt.id; const apply = db.transaction(() => { const receiptMac = sign(receipt, "legacy-import-reconciliation:v1"); db.prepare(`INSERT INTO import_reconciliation_receipts(id,run_id,expected_rows,observed_rows,staged_rows,excluded_rows,conflict_rows,pending_review_rows,source_hashes_json,exclusions_json,sensitive_policy_json,passed,receipt_mac,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET expected_rows=excluded.expected_rows,observed_rows=excluded.observed_rows,staged_rows=excluded.staged_rows,excluded_rows=excluded.excluded_rows,conflict_rows=excluded.conflict_rows,pending_review_rows=excluded.pending_review_rows,source_hashes_json=excluded.source_hashes_json,exclusions_json=excluded.exclusions_json,sensitive_policy_json=excluded.sensitive_policy_json,passed=excluded.passed,receipt_mac=excluded.receipt_mac,created_at=excluded.created_at`).run(receipt.id, receipt.runId, expected, observed, staged, excluded, conflicts, pending, JSON.stringify(receipt.sourceHashes), JSON.stringify(receipt.exclusions), JSON.stringify(receipt.sensitivePolicy), passed ? 1 : 0, receiptMac, now()); db.prepare("UPDATE import_runs SET observed_rows=?,staged_rows=?,excluded_rows=?,conflict_rows=?,pending_review_rows=?,status=?,completed_at=? WHERE id=?").run(observed, staged, excluded, conflicts, pending, passed ? "reconciled" : "review_ready", now(), runRow.id); faultInjector("import.reconcile.before_commit"); return { ...receipt, receiptMac }; }); return apply.immediate();
  }

  function resolveConflict(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const conflict = db.prepare("SELECT * FROM import_conflicts WHERE id=? AND status='open'").get(String(input.conflictId)); if (!conflict) throw new Error("Open import conflict is unavailable."); const candidateIds = JSON.parse(conflict.candidate_ids_json); const rejectAll = input.rejectAll === true; const winner = rejectAll ? null : String(input.winningCandidateId || ""); if (!rejectAll && !candidateIds.includes(winner)) throw new Error("Conflict winner must be one of the conflicting candidates.");
    const apply = db.transaction(() => { for (const candidateId of candidateIds) { const accepted = !rejectAll && candidateId === winner; db.prepare("UPDATE import_candidates SET decision=?,requires_owner_review=0,exclusion_reason=?,updated_at=? WHERE id=?").run(accepted ? "accepted" : "rejected", accepted ? null : rejectAll ? "OWNER_REJECTED_ALL_CONFLICT_VALUES" : "OWNER_CONFLICT_RESOLUTION", now(), candidateId); } const receipt = { conflictId: conflict.id, winner, rejected: candidateIds.filter((id) => id !== winner), rejectedAll: rejectAll, actorId: String(input.actorId), reasonCode: String(input.reasonCode || (rejectAll ? "OWNER_REJECTED_ALL" : "OWNER_SELECTED_CURRENT")) }; const receiptMac = sign(receipt, "legacy-import-conflict-resolution:v1"); const resolutionId = encrypt("owner:local", "legacy-import-conflict-resolution", { ...receipt, receiptMac }, "restricted"); db.prepare("UPDATE import_conflicts SET status='resolved',resolution_encrypted_id=?,resolved_at=? WHERE id=?").run(resolutionId, now(), conflict.id); faultInjector("import.conflict.before_commit"); return { ...receipt, receiptMac }; }); return apply.immediate();
  }

  function listReviewBatches(input = {}) {
    requireOwner(input.actorId, input.authorityZone); return db.prepare(`SELECT batch.id,batch.run_id,batch.batch_type,batch.risk,batch.status,batch.created_at,batch.decided_at,COUNT(item.candidate_id) AS total,SUM(CASE WHEN item.decision='pending' THEN 1 ELSE 0 END) AS pending FROM import_review_batches batch LEFT JOIN import_review_items item ON item.batch_id=batch.id WHERE batch.run_id=? GROUP BY batch.id ORDER BY CASE batch.batch_type WHEN 'protected' THEN 1 WHEN 'procedure' THEN 2 WHEN 'domain_manifest' THEN 3 WHEN 'scope' THEN 4 ELSE 5 END`).all(String(input.runId));
  }

  function readReviewBatch(input = {}) {
    requireOwner(input.actorId, input.authorityZone); const batch = db.prepare("SELECT id,run_id,batch_type,risk,status,created_at,decided_at FROM import_review_batches WHERE id=?").get(String(input.batchId)); if (!batch) throw new Error("Review batch is unavailable."); const limit = Math.max(1, Math.min(100, Number(input.limit) || 25)); const offset = Math.max(0, Number(input.offset) || 0); const rows = db.prepare(`SELECT item.decision AS review_decision,item.reason_code,candidate.* FROM import_review_items item JOIN import_candidates candidate ON candidate.id=item.candidate_id WHERE item.batch_id=? ORDER BY candidate.created_at,candidate.id LIMIT ? OFFSET ?`).all(batch.id, limit, offset); return { batch, offset, limit, total: Number(db.prepare("SELECT COUNT(*) AS count FROM import_review_items WHERE batch_id=?").get(batch.id).count), items: rows.map((row) => { const item = { id: row.id, reviewDecision: row.review_decision, reasonCode: row.reason_code, recordType: row.record_type, legacyTable: row.legacy_table, legacyId: row.legacy_id, proposedScope: row.proposed_scope, scopeConfidence: row.scope_confidence, scopeReason: row.scope_reason, sensitivity: row.sensitivity, decision: row.decision, payload: row.payload_encrypted_id ? decrypt(row.payload_encrypted_id) : null }; return { ...item, recommendation: adviseImportCandidate(item) }; }) };
  }

  function listConflicts(input = {}) {
    requireOwner(input.actorId, input.authorityZone); return db.prepare("SELECT * FROM import_conflicts WHERE run_id=? ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,created_at,id").all(String(input.runId)).map((conflict) => ({ id: conflict.id, conflictType: conflict.conflict_type, severity: conflict.severity, status: conflict.status, candidates: JSON.parse(conflict.candidate_ids_json).map((id) => { const candidate = db.prepare("SELECT id,record_type,legacy_table,legacy_id,proposed_scope,payload_encrypted_id FROM import_candidates WHERE id=?").get(id); return { id: candidate.id, recordType: candidate.record_type, legacyTable: candidate.legacy_table, legacyId: candidate.legacy_id, proposedScope: candidate.proposed_scope, payload: candidate.payload_encrypted_id ? decrypt(candidate.payload_encrypted_id) : null }; }) }));
  }

  function inspectRun(runId) { const run = db.prepare("SELECT id,inventory_hash,snapshot_set_hash,adapter_version,expected_rows,observed_rows,staged_rows,excluded_rows,conflict_rows,pending_review_rows,status,created_at,completed_at FROM import_runs WHERE id=?").get(String(runId)); if (!run) return null; return { ...run, sources: db.prepare("SELECT id,source_key,source_kind,snapshot_sha256,table_name,expected_rows,observed_rows,accepted_rows,excluded_rows,exclusion_reason,status FROM import_sources WHERE run_id=? ORDER BY source_key,table_name").all(run.id), candidates: db.prepare("SELECT id,source_id,legacy_table,legacy_id,record_type,proposed_scope,scope_confidence,scope_reason,sensitivity,normalized_hash,typed_key_hash,decision,exclusion_reason,requires_owner_review FROM import_candidates WHERE run_id=? ORDER BY created_at,id").all(run.id), equivalences: db.prepare("SELECT candidate_a_id,candidate_b_id,match_type,confidence,decision,reversible FROM import_equivalences WHERE run_id=? ORDER BY match_type,candidate_a_id").all(run.id), conflicts: db.prepare("SELECT id,conflict_type,severity,status,candidate_ids_json FROM import_conflicts WHERE run_id=? ORDER BY severity,id").all(run.id) }; }

  return Object.freeze({ createReviewBatch, createRun, decideReviewBatch, excludeSource, inspectRun, listConflicts, listReviewBatches, readReviewBatch, reconcile, resolveConflict, stageRecords, readCandidatePayload: (id) => { const row = db.prepare("SELECT payload_encrypted_id FROM import_candidates WHERE id=?").get(String(id)); return row?.payload_encrypted_id ? decrypt(row.payload_encrypted_id) : null; } });
}

module.exports = { createImportStagingRepository };
