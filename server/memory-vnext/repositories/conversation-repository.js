"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function createConversationRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 5) throw new Error("Conversation journal requires schema version 5.");

  function checksum(value) { return keyring.sign(JSON.stringify(value), "conversation-ingress-v1"); }

  function decryptObject(id) {
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) throw new Error("Encrypted conversation object is unavailable.");
    const payload = keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json));
    return JSON.parse(payload.toString("utf8"));
  }

  function openConversation(input = {}) {
    const id = String(input.id || crypto.randomUUID());
    const existing = db.prepare("SELECT * FROM conversations WHERE id=?").get(id);
    if (existing) return { conversationId: id, branchId: db.prepare("SELECT id FROM conversation_branches WHERE conversation_id=? ORDER BY created_at LIMIT 1").get(id)?.id, replayed: true };
    const branchId = String(input.branchId || `${id}:main`);
    const now = clock().toISOString();
    const run = db.transaction(() => {
      let titleId = null;
      if (input.title) titleId = insertEncrypted(db, keyring, clock, { objectType: "conversation-title", scopeId: String(input.scopeId), sensitivity: String(input.sensitivity || "private"), payload: { title: String(input.title) } }).id;
      db.prepare(`INSERT INTO conversations
        (id,scope_id,room_type,project_ref,thread_ref,title_encrypted_id,state,retention_policy_id,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?, 'active',?,?,?,?)`)
        .run(id, String(input.scopeId), String(input.roomType || "jarvis"), input.projectRef ? String(input.projectRef) : null,
          input.threadRef ? String(input.threadRef) : null, titleId, String(input.retentionPolicyId || "retain:conversation-default"),
          String(input.createdBy || "local-owner"), now, now);
      db.prepare(`INSERT INTO conversation_branches
        (id,conversation_id,parent_branch_id,parent_turn_id,state,resume_turn_id,merged_into_branch_id,created_at,updated_at)
        VALUES(?,?,NULL,NULL,'active',NULL,NULL,?,?)`).run(branchId, id, now, now);
      faultInjector("conversation.open.before_commit");
      return { conversationId: id, branchId, replayed: false };
    });
    return run.immediate();
  }

  function assertConversation(conversationId, branchId) {
    const row = db.prepare(`SELECT c.scope_id,c.state,b.state AS branch_state FROM conversations c
      JOIN conversation_branches b ON b.conversation_id=c.id WHERE c.id=? AND b.id=?`).get(conversationId, branchId);
    if (!row || row.state !== "active" || !["active", "suspended"].includes(row.branch_state)) throw new Error("Conversation or branch is unavailable.");
    return row;
  }

  function priorEvent(conversationId, clientEventId, expectedChecksum) {
    const row = db.prepare("SELECT turn_id,checksum,event_type FROM turn_events WHERE conversation_id=? AND client_event_id=?").get(conversationId, clientEventId);
    if (!row) return null;
    if (row.checksum !== expectedChecksum) throw Object.assign(new Error("Client event id was reused with different content."), { code: "INGRESS_IDEMPOTENCY_CONFLICT" });
    return { turnId: row.turn_id, eventType: row.event_type, replayed: true };
  }

  function priorSequence(conversationId, clientSequence, expectedChecksum) {
    if (clientSequence == null) return null;
    const row = db.prepare("SELECT id,content_checksum,status FROM turns WHERE conversation_id=? AND client_sequence=?")
      .get(conversationId, Number(clientSequence));
    if (!row) return null;
    if (row.content_checksum !== expectedChecksum) {
      throw Object.assign(new Error("Client sequence was reused with different content."), { code: "INGRESS_SEQUENCE_CONFLICT" });
    }
    return { turnId: row.id, eventType: row.status === "finalized" ? "turn.accepted" : "turn.stream_started", replayed: true };
  }

  function ingestTurn(input = {}) {
    const conversationId = String(input.conversationId || "");
    const branchId = String(input.branchId || "");
    const clientEventId = String(input.clientEventId || "");
    const content = String(input.content || "");
    if (!conversationId || !branchId || !clientEventId || !content) throw new Error("Conversation, branch, client event id, and content are required.");
    if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("Conversation turn exceeds the ingress limit.");
    const normalized = {
      role: String(input.role || "user"), content,
      clientSequence: input.clientSequence == null ? null : Number(input.clientSequence),
      attachments: (input.attachments || []).map((item) => ({ artifactRef: item.artifactRef || null, contentHash: String(item.contentHash), mediaType: String(item.mediaType || "application/octet-stream") })),
      focusDeltas: (input.focusDeltas || []).map((item) => ({ focusType: String(item.focusType), focusRef: String(item.focusRef), operation: String(item.operation) })),
    };
    const eventChecksum = checksum(normalized);
    const prior = priorEvent(conversationId, clientEventId, eventChecksum);
    if (prior) return prior;
    const sequenceReplay = priorSequence(conversationId, normalized.clientSequence, eventChecksum);
    if (sequenceReplay) return sequenceReplay;
    const context = assertConversation(conversationId, branchId);
    const run = db.transaction(() => {
      const replay = priorEvent(conversationId, clientEventId, eventChecksum);
      if (replay) return replay;
      const turnId = String(input.turnId || crypto.randomUUID());
      const now = clock().toISOString();
      const contentObject = insertEncrypted(db, keyring, clock, { objectType: "conversation-turn", schemaVersion: 1, scopeId: context.scope_id, sensitivity: String(input.sensitivity || "private"), payload: { text: content } });
      db.prepare(`INSERT INTO turns
        (id,conversation_id,branch_id,role,content_encrypted_id,content_checksum,status,admission_status,sensitivity,model_provider,model_id,
         occurred_at,recorded_at,client_sequence,finalized_at) VALUES(?,?,?,?,?,?,'finalized',?,?,?,?,?,?,?,?)`)
        .run(turnId, conversationId, branchId, normalized.role, contentObject.id, eventChecksum,
          String(input.admissionStatus || "pending"), String(input.sensitivity || "private"), input.modelProvider ? String(input.modelProvider) : null,
          input.modelId ? String(input.modelId) : null, String(input.occurredAt || now), now, normalized.clientSequence, now);
      const eventPayload = insertEncrypted(db, keyring, clock, { objectType: "turn-event-metadata", scopeId: context.scope_id, sensitivity: String(input.sensitivity || "private"), payload: { attachmentCount: normalized.attachments.length, focusDeltaCount: normalized.focusDeltas.length, actorId: String(input.actorId || "local-owner") } });
      db.prepare(`INSERT INTO turn_events
        (id,conversation_id,turn_id,branch_id,event_type,client_event_id,client_sequence,payload_encrypted_id,checksum,created_at)
        VALUES(?,?,?,?, 'turn.accepted',?,?,?,?,?)`)
        .run(crypto.randomUUID(), conversationId, turnId, branchId, clientEventId, normalized.clientSequence, eventPayload.id, eventChecksum, now);
      for (const attachment of input.attachments || []) {
        const locatorId = attachment.locator == null ? null : insertEncrypted(db, keyring, clock, { objectType: "attachment-locator", scopeId: context.scope_id, sensitivity: String(input.sensitivity || "private"), payload: attachment.locator }).id;
        db.prepare(`INSERT INTO turn_attachments(id,turn_id,artifact_ref,content_hash,media_type,locator_encrypted_id,created_at)
          VALUES(?,?,?,?,?,?,?)`).run(crypto.randomUUID(), turnId, attachment.artifactRef ? String(attachment.artifactRef) : null,
          String(attachment.contentHash), String(attachment.mediaType || "application/octet-stream"), locatorId, now);
      }
      for (const delta of normalized.focusDeltas) {
        db.prepare("INSERT INTO turn_focus_deltas(id,turn_id,focus_type,focus_ref,operation,created_at) VALUES(?,?,?,?,?,?)")
          .run(crypto.randomUUID(), turnId, delta.focusType, delta.focusRef, delta.operation, now);
      }
      db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now, conversationId);
      faultInjector("conversation.ingress.before_commit");
      return { turnId, eventType: "turn.accepted", checksum: eventChecksum, replayed: false };
    });
    return run.immediate();
  }

  function beginAssistantTurn(input = {}) {
    const conversationId = String(input.conversationId || "");
    const branchId = String(input.branchId || "");
    const clientEventId = String(input.clientEventId || "");
    const startChecksum = checksum({ role: "assistant", state: "streaming", modelProvider: input.modelProvider || null, modelId: input.modelId || null });
    const prior = priorEvent(conversationId, clientEventId, startChecksum);
    if (prior) return prior;
    const sequenceReplay = priorSequence(conversationId, input.clientSequence == null ? null : Number(input.clientSequence), startChecksum);
    if (sequenceReplay) return sequenceReplay;
    const context = assertConversation(conversationId, branchId);
    const run = db.transaction(() => {
      const turnId = String(input.turnId || crypto.randomUUID());
      const now = clock().toISOString();
      db.prepare(`INSERT INTO turns
        (id,conversation_id,branch_id,role,content_encrypted_id,content_checksum,status,admission_status,sensitivity,model_provider,model_id,
         occurred_at,recorded_at,client_sequence,finalized_at) VALUES(?,?,?,'assistant',NULL,?,'streaming','pending',?,?,?,?,?,?,NULL)`)
        .run(turnId, conversationId, branchId, startChecksum, String(input.sensitivity || "private"), input.modelProvider ? String(input.modelProvider) : null,
          input.modelId ? String(input.modelId) : null, String(input.occurredAt || now), now, input.clientSequence == null ? null : Number(input.clientSequence));
      const metadata = insertEncrypted(db, keyring, clock, { objectType: "turn-stream-start", scopeId: context.scope_id, sensitivity: String(input.sensitivity || "private"), payload: { modelProvider: input.modelProvider || null, modelId: input.modelId || null } });
      db.prepare(`INSERT INTO turn_events
        (id,conversation_id,turn_id,branch_id,event_type,client_event_id,client_sequence,payload_encrypted_id,checksum,created_at)
        VALUES(?,?,?,?, 'turn.stream_started',?,?,?,?,?)`)
        .run(crypto.randomUUID(), conversationId, turnId, branchId, clientEventId, input.clientSequence == null ? null : Number(input.clientSequence), metadata.id, startChecksum, now);
      return { turnId, eventType: "turn.stream_started", checksum: startChecksum, replayed: false };
    });
    return run.immediate();
  }

  function appendChunk(input = {}) {
    const turnId = String(input.turnId || "");
    const sequence = Number(input.sequence);
    const content = String(input.content || "");
    if (!turnId || !Number.isInteger(sequence) || sequence < 0 || !content) throw new Error("Turn, non-negative chunk sequence, and content are required.");
    const turn = db.prepare(`SELECT t.*,c.scope_id FROM turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=?`).get(turnId);
    if (!turn || !["streaming", "interrupted"].includes(turn.status)) throw new Error("Assistant turn is not streamable.");
    const chunkChecksum = checksum({ turnId, sequence, content });
    const existing = db.prepare("SELECT checksum FROM turn_stream_chunks WHERE turn_id=? AND chunk_sequence=?").get(turnId, sequence);
    if (existing) {
      if (existing.checksum !== chunkChecksum) throw Object.assign(new Error("Chunk sequence was reused with different content."), { code: "STREAM_CHUNK_CONFLICT" });
      return { turnId, sequence, replayed: true };
    }
    const expected = Number(db.prepare("SELECT COALESCE(MAX(chunk_sequence),-1)+1 AS next FROM turn_stream_chunks WHERE turn_id=?").get(turnId).next);
    if (sequence !== expected) throw Object.assign(new Error(`Expected stream chunk ${expected}.`), { code: "STREAM_CHUNK_GAP" });
    const run = db.transaction(() => {
      const replay = db.prepare("SELECT checksum FROM turn_stream_chunks WHERE turn_id=? AND chunk_sequence=?").get(turnId, sequence);
      if (replay) {
        if (replay.checksum !== chunkChecksum) throw Object.assign(new Error("Chunk sequence was reused with different content."), { code: "STREAM_CHUNK_CONFLICT" });
        return { turnId, sequence, replayed: true };
      }
      const encrypted = insertEncrypted(db, keyring, clock, { objectType: "turn-stream-chunk", scopeId: turn.scope_id, sensitivity: turn.sensitivity, payload: { text: content } });
      const now = clock().toISOString();
      db.prepare("INSERT INTO turn_stream_chunks(turn_id,chunk_sequence,content_encrypted_id,checksum,created_at) VALUES(?,?,?,?,?)")
        .run(turnId, sequence, encrypted.id, chunkChecksum, now);
      db.prepare(`INSERT INTO turn_events
        (id,conversation_id,turn_id,branch_id,event_type,client_event_id,client_sequence,payload_encrypted_id,checksum,created_at)
        VALUES(?,?,?,?, 'turn.chunk',?,NULL,?,?,?)`)
        .run(crypto.randomUUID(), turn.conversation_id, turnId, turn.branch_id, `chunk:${turnId}:${sequence}`, encrypted.id, chunkChecksum, now);
      if (turn.status === "interrupted") db.prepare("UPDATE turns SET status='streaming' WHERE id=?").run(turnId);
      faultInjector("conversation.chunk.before_commit");
      return { turnId, sequence, checksum: chunkChecksum, replayed: false };
    });
    return run.immediate();
  }

  function finalizeAssistantTurn(input = {}) {
    const turnId = String(input.turnId || "");
    const clientEventId = String(input.clientEventId || "");
    const turn = db.prepare(`SELECT t.*,c.scope_id FROM turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=?`).get(turnId);
    if (!turn) throw new Error("Assistant turn is unavailable.");
    const chunks = db.prepare("SELECT * FROM turn_stream_chunks WHERE turn_id=? ORDER BY chunk_sequence").all(turnId);
    const content = chunks.map((row) => decryptObject(row.content_encrypted_id).text).join("");
    const finalChecksum = checksum({ turnId, content, chunkChecksums: chunks.map((row) => row.checksum) });
    const prior = priorEvent(turn.conversation_id, clientEventId, finalChecksum);
    if (prior) return prior;
    if (!content) throw new Error("Cannot finalize an empty assistant stream.");
    const run = db.transaction(() => {
      const now = clock().toISOString();
      const encrypted = insertEncrypted(db, keyring, clock, { objectType: "conversation-turn", scopeId: turn.scope_id, sensitivity: turn.sensitivity, payload: { text: content } });
      const changed = db.prepare(`UPDATE turns SET content_encrypted_id=?,content_checksum=?,status='finalized',finalized_at=?
        WHERE id=? AND status IN ('streaming','interrupted')`).run(encrypted.id, finalChecksum, now, turnId);
      if (changed.changes !== 1) throw new Error("Assistant turn was already finalized or rejected.");
      db.prepare(`INSERT INTO turn_events
        (id,conversation_id,turn_id,branch_id,event_type,client_event_id,client_sequence,payload_encrypted_id,checksum,created_at)
        VALUES(?,?,?,?, 'turn.finalized',?,NULL,NULL,?,?)`)
        .run(crypto.randomUUID(), turn.conversation_id, turnId, turn.branch_id, clientEventId, finalChecksum, now);
      return { turnId, eventType: "turn.finalized", checksum: finalChecksum, replayed: false };
    });
    return run.immediate();
  }

  function interruptTurn(input) {
    const turnId = String(typeof input === "object" ? input.turnId : input);
    const turn = db.prepare("SELECT conversation_id,branch_id,status FROM turns WHERE id=?").get(turnId);
    if (!turn) return { turnId, interrupted: false, resumeAtSequence: 0 };
    const run = db.transaction(() => {
      const now = clock().toISOString();
      const changed = db.prepare("UPDATE turns SET status='interrupted' WHERE id=? AND status='streaming'").run(turnId);
      if (changed.changes === 1) {
        const eventChecksum = checksum({ turnId, state: "interrupted", resumeAtSequence: Number(db.prepare("SELECT COALESCE(MAX(chunk_sequence),-1)+1 AS next FROM turn_stream_chunks WHERE turn_id=?").get(turnId).next) });
        db.prepare(`INSERT INTO turn_events
          (id,conversation_id,turn_id,branch_id,event_type,client_event_id,client_sequence,payload_encrypted_id,checksum,created_at)
          VALUES(?,?,?,?, 'turn.interrupted',?,NULL,NULL,?,?)`)
          .run(crypto.randomUUID(), turn.conversation_id, turnId, turn.branch_id,
            typeof input === "object" && input.clientEventId ? String(input.clientEventId) : `interrupt:${turnId}:${crypto.randomUUID()}`,
            eventChecksum, now);
      }
      return { turnId, interrupted: changed.changes === 1, resumeAtSequence: Number(db.prepare("SELECT COALESCE(MAX(chunk_sequence),-1)+1 AS next FROM turn_stream_chunks WHERE turn_id=?").get(turnId).next) };
    });
    return run.immediate();
  }

  function readTurn(turnId) {
    const row = db.prepare("SELECT * FROM turns WHERE id=?").get(String(turnId));
    if (!row) return null;
    return { id: row.id, conversationId: row.conversation_id, branchId: row.branch_id, role: row.role, status: row.status, admissionStatus: row.admission_status, sensitivity: row.sensitivity, occurredAt: row.occurred_at, recordedAt: row.recorded_at, content: row.content_encrypted_id ? decryptObject(row.content_encrypted_id).text : null };
  }

  function listTurns(conversationId, branchId) {
    return db.prepare("SELECT id FROM turns WHERE conversation_id=? AND branch_id=? ORDER BY COALESCE(client_sequence,9223372036854775807),recorded_at,id")
      .all(conversationId, branchId).map((row) => readTurn(row.id));
  }

  return Object.freeze({ appendChunk, beginAssistantTurn, decryptObject, finalizeAssistantTurn, ingestTurn, interruptTurn, listTurns, openConversation, readTurn });
}

module.exports = { createConversationRepository };
