"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function normalizedText(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(); }
function lexicalUnits(value) { return normalizedText(value).match(/[\p{L}\p{N}_./:@-]+/gu) || []; }

function createRetrievalOracleRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 13) throw new Error("Retrieval oracle requires schema version 13.");
  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function decrypt(id) { if (!id) return null; const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id); if (!row) return null;
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8")); }
  function digest(value, domain) { return keyring.sign(normalizedText(value), domain); }
  // A-13 — the index stored a deterministic HMAC of every character TRIGRAM of every word, in a
  // plain table sitting next to the ciphertext. That is the textbook searchable-encryption break:
  // character trigrams live in a space of only a few thousand values with famously stable English
  // frequencies, so an attacker with read access to the DB file — but NOT the DPAPI-wrapped master
  // key — can map hash→trigram by frequency and co-occurrence and reassemble a large fraction of
  // the indexed text without touching AES-GCM at all. Word-level tokens leak far less: the space
  // is the vocabulary rather than ~17k trigrams, and a single token reveals nothing about the
  // word's internal structure or its neighbours' overlap with it.
  //
  // The cost is real and worth stating: dropping trigrams removes substring and morphological
  // matching ("running" no longer partially matches "run"), so recall on inflected forms drops.
  // Exact word hits, the exact-key channel and the graph channel are unaffected. Retaining a
  // whole-plaintext reconstruction oracle to improve fuzzy matching is not a trade worth making.
  // What replaces the trigrams matters: removing them outright broke recall on inflected forms
  // ("projects" stopped matching "project"), which is a real capability loss, not a rounding
  // error. A single STEM token per word restores that without restoring the attack.
  //
  // The trigram scheme's danger was not the hashing, it was the sliding window: consecutive
  // 3-grams of a word overlap by two characters, so recovered trigrams chain together into words
  // and words into sentences. One stem token per word has no overlap structure to chain — it
  // gives an attacker at most "these two words share a prefix", over a space of 26^5 rather than
  // ~17k, and it cannot be walked. Tokens per word drop from (length - 2) to 2, which collapses
  // the co-occurrence graph the frequency attack feeds on.
  const STEM_LENGTH = 5;
  function tokenStream(text) {
    const tokens = [];
    for (const unit of lexicalUnits(text)) {
      tokens.push(`w${digest(unit, "retrieval-word-v1")}`);
      if (unit.length > STEM_LENGTH) tokens.push(`s${digest(unit.slice(0, STEM_LENGTH), "retrieval-stem-v1")}`);
    }
    return tokens.join(" ");
  }

  // Existing rows still carry the trigram tokens, and the leak lives in the stored index, not in
  // the code that wrote it — so removing the emitter is only half the fix. This rewrites them in
  // place. `retrieval_fts` is derived from `retrieval_documents`, so nothing is lost.
  function stripLegacyTrigramTokens() {
    const rows = db.prepare("SELECT document_id,token_stream FROM retrieval_fts").all();
    let rewritten = 0;
    let tokensRemoved = 0;
    const update = db.prepare("UPDATE retrieval_fts SET token_stream=? WHERE document_id=?");
    const run = db.transaction(() => {
      for (const row of rows) {
        const tokens = String(row.token_stream || "").split(" ").filter(Boolean);
        const kept = tokens.filter((token) => !token.startsWith("g"));   // g = legacy trigram
        if (kept.length === tokens.length) continue;
        tokensRemoved += tokens.length - kept.length;
        update.run(kept.join(" "), row.document_id);
        rewritten += 1;
      }
    });
    run.immediate();
    return { scanned: rows.length, rewritten, tokensRemoved };
  }
  function activeProjection() { return db.prepare("SELECT * FROM retrieval_projections WHERE state='active'").get(); }
  function projection(id) { const row = db.prepare("SELECT * FROM retrieval_projections WHERE id=?").get(String(id)); if (!row) throw new Error("Retrieval projection is unavailable."); return row; }
  function authorizeScopes(requested, allowed) {
    const requestedIds = [...new Set((requested || []).map(String))]; const allowedIds = new Set((allowed || []).map(String));
    if (!requestedIds.length || requestedIds.some((id) => !allowedIds.has(id))) throw Object.assign(new Error("Retrieval scope is not authorized."), { code: "RETRIEVAL_SCOPE_DENIED" });
    return requestedIds;
  }

  function createProjection(input = {}) {
    const id = String(input.id || crypto.randomUUID()); const prior = db.prepare("SELECT * FROM retrieval_projections WHERE projection_version=?").get(String(input.version));
    if (prior) return { id: prior.id, version: prior.projection_version, state: prior.state, replayed: true };
    db.prepare("INSERT INTO retrieval_projections(id,projection_version,state,source_sequence,policy_version,created_at,activated_at,retired_at) VALUES(?,?,'building',?,?,?,NULL,NULL)")
      .run(id, String(input.version), Math.max(0, Number(input.sourceSequence || 0)), String(input.policyVersion || "retrieval:v1"), clock().toISOString());
    return { id, version: String(input.version), state: "building", replayed: false };
  }

  function activateProjection(input = {}) {
    const run = db.transaction(() => {
      const target = projection(input.projectionId); if (target.state !== "building") throw new Error("Only a building retrieval projection can activate.");
      const indexed = Number(db.prepare("SELECT COUNT(*) AS count FROM retrieval_documents WHERE projection_id=? AND status='active'").get(target.id).count);
      const expected = Math.max(0, Number(input.expectedSelectedRecords ?? indexed)); if (indexed < expected) throw Object.assign(new Error("Retrieval projection coverage is incomplete."), { code: "RETRIEVAL_COVERAGE_INCOMPLETE", indexed, expected });
      const now = clock().toISOString(); db.prepare("UPDATE retrieval_projections SET state='retiring',retired_at=? WHERE state='active'").run(now);
      db.prepare("UPDATE retrieval_projections SET state='active',activated_at=? WHERE id=?").run(now, target.id); faultInjector("retrieval.projection.activate.before_commit");
      return { id: target.id, state: "active", indexed, expected };
    }); return run.immediate();
  }

  function indexDocument(input = {}) {
    const target = projection(input.projectionId); if (!['building','active'].includes(target.state)) throw new Error("Retrieval projection cannot accept documents.");
    if (!input.scopeId || !input.recordType || !input.recordId || !input.recordVersion || input.content == null) throw new Error("Retrieval document identity, scope, version, and content are required.");
    const contentHash = digest(JSON.stringify(input.content), "retrieval-content-v1");
    const prior = db.prepare("SELECT * FROM retrieval_documents WHERE projection_id=? AND record_type=? AND record_id=? AND record_version=?")
      .get(target.id, String(input.recordType), String(input.recordId), String(input.recordVersion));
    if (prior?.content_hash === contentHash && prior.status === "active") return { id: prior.id, replayed: true };
    const run = db.transaction(() => {
      const now = clock().toISOString(); const id = prior?.id || String(input.id || crypto.randomUUID());
      const encryptedId = encrypt(String(input.scopeId), "retrieval-document", { content: input.content, locator: input.locator || null }, String(input.sensitivity || "private"));
      if (prior) {
        db.prepare("DELETE FROM retrieval_fts WHERE document_id=?").run(id); db.prepare("DELETE FROM retrieval_exact_keys WHERE document_id=?").run(id);
        db.prepare(`UPDATE retrieval_documents SET scope_id=?,sensitivity=?,status='active',valid_from=?,valid_to=?,content_encrypted_id=?,content_hash=?,updated_at=? WHERE id=?`)
          .run(String(input.scopeId), String(input.sensitivity || "private"), input.validFrom ? String(input.validFrom) : null, input.validTo ? String(input.validTo) : null, encryptedId, contentHash, now, id);
        if (prior.content_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(prior.content_encrypted_id);
      } else db.prepare(`INSERT INTO retrieval_documents(id,projection_id,scope_id,record_type,record_id,record_version,sensitivity,status,valid_from,valid_to,content_encrypted_id,content_hash,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'active',?,?,?,?,?,?)`).run(id, target.id, String(input.scopeId), String(input.recordType), String(input.recordId), String(input.recordVersion), String(input.sensitivity || "private"),
        input.validFrom ? String(input.validFrom) : null, input.validTo ? String(input.validTo) : null, encryptedId, contentHash, now, now);
      const searchable = typeof input.searchableText === "string" ? input.searchableText : JSON.stringify(input.content);
      db.prepare("INSERT INTO retrieval_fts(document_id,token_stream) VALUES(?,?)").run(id, tokenStream(searchable));
      for (const key of input.exactKeys || []) db.prepare("INSERT OR IGNORE INTO retrieval_exact_keys(document_id,key_type,key_hash,created_at) VALUES(?,?,?,?)")
        .run(id, String(key.type), digest(key.value, `retrieval-exact:${String(key.type)}:v1`), now);
      db.prepare("INSERT OR IGNORE INTO dependency_edges(id,scope_id,source_type,source_id,dependent_type,dependent_id,relation,status,created_at,invalidated_at) VALUES(?,?,?,?,?,?,'indexes','active',?,NULL)")
        .run(crypto.randomUUID(), String(input.scopeId), String(input.sourceType || input.recordType), String(input.sourceId || input.recordId), "retrieval_document", id, now);
      faultInjector("retrieval.document.index.before_commit"); return { id, replayed: false, contentHash };
    }); return run.immediate();
  }

  function removeDocument(documentId) {
    const run = db.transaction(() => { const row = db.prepare("SELECT * FROM retrieval_documents WHERE id=?").get(String(documentId)); if (!row) return { id: String(documentId), removed: false };
      db.prepare("DELETE FROM retrieval_fts WHERE document_id=?").run(row.id); db.prepare("DELETE FROM retrieval_exact_keys WHERE document_id=?").run(row.id);
      db.prepare("UPDATE retrieval_documents SET status='deleted',content_encrypted_id=NULL,updated_at=? WHERE id=?").run(clock().toISOString(), row.id);
      if (row.content_encrypted_id) db.prepare("DELETE FROM encrypted_objects WHERE id=?").run(row.content_encrypted_id);
      return { id: row.id, removed: true }; }); return run.immediate();
  }

  function filterSql(projectionId, scopeIds, validAt) {
    const placeholders = scopeIds.map(() => "?").join(",");
    return { sql: `d.projection_id=? AND d.scope_id IN (${placeholders}) AND d.status='active' AND (d.valid_from IS NULL OR d.valid_from<=?) AND (d.valid_to IS NULL OR d.valid_to>?)`, args: [projectionId, ...scopeIds, validAt, validAt] };
  }
  function exactHits({ projectionId, scopeIds, exactKeys, validAt, limit }) {
    const filter = filterSql(projectionId, scopeIds, validAt); const results = new Map();
    for (const key of exactKeys || []) {
      const rows = db.prepare(`SELECT d.*,k.key_type FROM retrieval_exact_keys k JOIN retrieval_documents d ON d.id=k.document_id WHERE k.key_type=? AND k.key_hash=? AND ${filter.sql} LIMIT ?`)
        .all(String(key.type), digest(key.value, `retrieval-exact:${String(key.type)}:v1`), ...filter.args, Math.max(1, Number(limit || 20)));
      rows.forEach((row) => results.set(row.id, { row, channel: "exact", score: 100, features: { keyType: row.key_type } }));
    }
    return [...results.values()].slice(0, limit);
  }
  function lexicalHits({ projectionId, scopeIds, text, validAt, limit }) {
    const stream = tokenStream(text); if (!stream) return [];
    const query = [...new Set(stream.split(" "))].map((item) => `"${item}"`).join(" OR "); const filter = filterSql(projectionId, scopeIds, validAt);
    return db.prepare(`SELECT d.*,bm25(retrieval_fts) AS rank FROM retrieval_fts JOIN retrieval_documents d ON d.id=retrieval_fts.document_id WHERE retrieval_fts MATCH ? AND ${filter.sql} ORDER BY rank,d.id LIMIT ?`)
      .all(query, ...filter.args, Math.max(1, Number(limit || 20))).map((row) => ({ row, channel: "lexical", score: -Number(row.rank), features: { hashedTermCount: query.split(" OR ").length } }));
  }
  function formatHit(hit) { const content = decrypt(hit.row.content_encrypted_id); return { documentId: hit.row.id, recordType: hit.row.record_type, recordId: hit.row.record_id, recordVersion: hit.row.record_version,
    scopeId: hit.row.scope_id, sensitivity: hit.row.sensitivity, channel: hit.channel, score: hit.score, content: content?.content, locator: content?.locator || null, features: hit.features }; }

  function retrieve(input = {}) {
    const started = Date.now(); const active = input.projectionId ? projection(input.projectionId) : activeProjection(); if (!active || active.state !== "active") throw Object.assign(new Error("No active retrieval projection."), { code: "RETRIEVAL_PROJECTION_UNAVAILABLE" });
    const scopeIds = authorizeScopes(input.scopeIds, input.allowedScopeIds); const validAt = String(input.validAt || clock().toISOString()); const limit = Math.max(1, Math.min(100, Number(input.limit || 20)));
    const exact = exactHits({ projectionId: active.id, scopeIds, exactKeys: input.exactKeys || [], validAt, limit }); const lexical = input.text ? lexicalHits({ projectionId: active.id, scopeIds, text: input.text, validAt, limit }) : [];
    const combined = new Map(); [...exact, ...lexical].forEach((hit) => { const prior = combined.get(hit.row.id); if (!prior || hit.score > prior.score) combined.set(hit.row.id, hit); });
    const ranked = [...combined.values()].sort((a, b) => (a.channel === b.channel ? b.score - a.score : a.channel === "exact" ? -1 : 1) || a.row.id.localeCompare(b.row.id)).slice(0, limit);
    const run = db.transaction(() => { const runId = String(input.runId || crypto.randomUUID()); const now = clock().toISOString(); const queryId = encrypt(scopeIds[0], "retrieval-query", { text: input.text || null, exactKeys: input.exactKeys || [] });
      db.prepare(`INSERT INTO retrieval_runs(id,query_encrypted_id,intent,need_gate,expected_value,scope_ids_json,valid_at,canonical_sequence,projection_id,policy_version,latency_ms,cost_usd,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,0,'complete',?)`).run(runId, queryId, String(input.intent || "recall"), exact.length && lexical.length ? "exact_lexical" : exact.length ? "exact" : "lexical",
        Math.max(0, Math.min(1, Number(input.expectedValue ?? 0.5))), JSON.stringify(scopeIds), validAt, Math.max(0, Number(input.canonicalSequence || 0)), active.id, active.policy_version, Math.max(0, Date.now() - started), now);
      ranked.forEach((hit, index) => db.prepare("INSERT INTO retrieval_candidates(run_id,document_id,channel,raw_rank,raw_score,features_json,decision,reason_code) VALUES(?,?,?,?,?,?,'selected','TOP_K')")
        .run(runId, hit.row.id, hit.channel, index + 1, hit.score, JSON.stringify(hit.features)));
      return runId; });
    const runId = run.immediate(); return { runId, projectionId: active.id, hits: ranked.map(formatHit), costUsd: 0, channels: { exact: exact.length, lexical: lexical.length } };
  }
  function trace(runId) { const run = db.prepare("SELECT id,intent,need_gate,expected_value,scope_ids_json,valid_at,canonical_sequence,projection_id,policy_version,latency_ms,cost_usd,status,created_at FROM retrieval_runs WHERE id=?").get(String(runId)); if (!run) return null;
    return { ...run, scopeIds: JSON.parse(run.scope_ids_json), candidates: db.prepare("SELECT document_id,channel,raw_rank,raw_score,features_json,decision,reason_code FROM retrieval_candidates WHERE run_id=? ORDER BY raw_rank").all(run.id).map((row) => ({ ...row, features: JSON.parse(row.features_json) })) }; }

  return Object.freeze({ activateProjection, createProjection, indexDocument, removeDocument, retrieve, stripLegacyTrigramTokens, tokenStream, trace });
}

module.exports = { createRetrievalOracleRepository, lexicalUnits, normalizedText };
