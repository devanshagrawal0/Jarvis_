"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function createConversationStateRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 6) throw new Error("Conversation State Kernel requires schema version 6.");

  function encryptedPayload(id) {
    if (!id) return null;
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) throw new Error("State payload is unavailable.");
    const bytes = keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json));
    return JSON.parse(bytes.toString("utf8"));
  }

  function conversationContext(conversationId) {
    const row = db.prepare("SELECT id,scope_id,state FROM conversations WHERE id=?").get(conversationId);
    if (!row || row.state === "archived") throw new Error("Conversation is unavailable.");
    return row;
  }

  function initialize(conversationId, branchId) {
    const context = conversationContext(conversationId);
    const branch = db.prepare("SELECT state FROM conversation_branches WHERE id=? AND conversation_id=?").get(branchId, conversationId);
    if (!branch) throw new Error("Conversation branch is unavailable.");
    db.prepare(`INSERT OR IGNORE INTO conversation_state_heads(conversation_id,state_sequence,active_branch_id,updated_at)
      VALUES(?,0,?,?)`).run(conversationId, branchId, clock().toISOString());
    return { conversationId, branchId, scopeId: context.scope_id, stateSequence: Number(db.prepare("SELECT state_sequence FROM conversation_state_heads WHERE conversation_id=?").get(conversationId).state_sequence) };
  }

  function validateSourceTurn(conversationId, sourceTurnId) {
    const turn = db.prepare("SELECT id,branch_id,status FROM turns WHERE id=? AND conversation_id=?").get(sourceTurnId, conversationId);
    if (!turn || turn.status !== "finalized") throw new Error("State delta source must be a finalized turn in this conversation.");
    return turn;
  }

  function applyDelta(input = {}) {
    const conversationId = String(input.conversationId || "");
    const branchId = String(input.branchId || "");
    const sourceTurnId = String(input.sourceTurnId || "");
    const operations = Array.isArray(input.operations) ? input.operations : [];
    if (!conversationId || !branchId || !sourceTurnId || !operations.length || operations.length > 100) throw new Error("Conversation, branch, source turn, and 1-100 operations are required.");
    const context = conversationContext(conversationId);
    const sourceTurn = validateSourceTurn(conversationId, sourceTurnId);
    if (sourceTurn.branch_id !== branchId) throw new Error("State delta source turn must belong to the active branch.");
    initialize(conversationId, branchId);
    const run = db.transaction(() => {
      const head = db.prepare("SELECT * FROM conversation_state_heads WHERE conversation_id=?").get(conversationId);
      const expectedSequence = input.expectedSequence == null ? Number(head.state_sequence) : Number(input.expectedSequence);
      if (Number(head.state_sequence) !== expectedSequence) throw Object.assign(new Error("Conversation state compare-and-swap conflict."), { code: "STATE_SEQUENCE_CONFLICT" });
      if (head.active_branch_id !== branchId) throw new Error("State deltas may update only the active branch.");
      const now = clock().toISOString();
      const results = [];
      for (const operation of operations) {
        const type = String(operation.type || "");
        if (type === "set_topic") {
          if (operation.replaceActive !== false) db.prepare("UPDATE topic_segments SET state='suspended',updated_at=? WHERE conversation_id=? AND branch_id=? AND state='active'").run(now, conversationId, branchId);
          const id = String(operation.id || crypto.randomUUID());
          const capsule = operation.capsule == null ? null : insertEncrypted(db, keyring, clock, { objectType: "topic-capsule", scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: operation.capsule }).id;
          db.prepare(`INSERT INTO topic_segments(id,conversation_id,branch_id,topic_key,state,start_turn_id,end_turn_id,capsule_encrypted_id,created_at,updated_at)
            VALUES(?,?,?,?,'active',?,NULL,?,?,?)`).run(id, conversationId, branchId, String(operation.topicKey), sourceTurnId, capsule, now, now);
          results.push({ type, id });
        } else if (type === "suspend_topic") {
          db.prepare("UPDATE topic_segments SET state='suspended',end_turn_id=?,updated_at=? WHERE id=? AND conversation_id=? AND branch_id=? AND state='active'")
            .run(sourceTurnId, now, String(operation.id), conversationId, branchId);
          results.push({ type, id: String(operation.id) });
        } else if (type === "put_slot") {
          const encrypted = insertEncrypted(db, keyring, clock, { objectType: "working-slot", scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: operation.value });
          const expiresAt = operation.ttlMs == null ? null : new Date(clock().getTime() + Math.max(1, Number(operation.ttlMs))).toISOString();
          db.prepare(`INSERT INTO working_slots
            (conversation_id,branch_id,namespace,slot_key,slot_type,value_encrypted_id,source_turn_id,expires_at,promotion_status,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id,branch_id,namespace,slot_key) DO UPDATE SET
            slot_type=excluded.slot_type,value_encrypted_id=excluded.value_encrypted_id,source_turn_id=excluded.source_turn_id,
            expires_at=excluded.expires_at,promotion_status=excluded.promotion_status,updated_at=excluded.updated_at`)
            .run(conversationId, branchId, String(operation.namespace || "conversation"), String(operation.key), String(operation.slotType || "working"),
              encrypted.id, sourceTurnId, expiresAt, String(operation.promotionStatus || "none"), now);
          results.push({ type, key: String(operation.key), expiresAt });
        } else if (type === "set_referent") {
          const id = String(operation.id || crypto.randomUUID());
          const existingOwner = db.prepare("SELECT conversation_id,branch_id FROM referent_state WHERE id=?").get(id);
          if (existingOwner && (existingOwner.conversation_id !== conversationId || existingOwner.branch_id !== branchId)) throw new Error("Referent id belongs to another conversation branch.");
          const candidates = insertEncrypted(db, keyring, clock, { objectType: "referent-candidates", scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: { candidates: operation.candidates || [] } });
          const selected = operation.selectedRef ? String(operation.selectedRef) : null;
          const state = selected ? "resolved" : "unresolved";
          db.prepare(`INSERT INTO referent_state
            (id,conversation_id,branch_id,mention,candidates_encrypted_id,selected_ref,confidence,state,source_turn_id,valid_until_turn_id,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET candidates_encrypted_id=excluded.candidates_encrypted_id,
            selected_ref=excluded.selected_ref,confidence=excluded.confidence,state=excluded.state,source_turn_id=excluded.source_turn_id,updated_at=excluded.updated_at`)
            .run(id, conversationId, branchId, String(operation.mention), candidates.id, selected,
              Math.max(0, Math.min(1, Number(operation.confidence) || 0)), state, sourceTurnId, now);
          results.push({ type, id, state });
        } else if (type === "open_loop") {
          const id = String(operation.id || crypto.randomUUID());
          const payload = insertEncrypted(db, keyring, clock, { objectType: "open-loop", scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: operation.payload });
          db.prepare(`INSERT INTO open_loops
            (id,conversation_id,branch_id,loop_type,payload_encrypted_id,owner_actor_id,state,source_turn_id,resolved_turn_id,created_at,updated_at)
            VALUES(?,?,?,?,?,?,'open',?,NULL,?,?)`).run(id, conversationId, branchId, String(operation.loopType || "question"), payload.id,
              String(operation.ownerActorId || "local-owner"), sourceTurnId, now, now);
          results.push({ type, id });
        } else if (type === "resolve_loop") {
          const changed = db.prepare("UPDATE open_loops SET state=?,resolved_turn_id=?,updated_at=? WHERE id=? AND conversation_id=? AND branch_id=? AND state='open'")
            .run(String(operation.state || "resolved"), sourceTurnId, now, String(operation.id), conversationId, branchId);
          if (changed.changes !== 1) throw new Error("Open loop target is unavailable or already closed.");
          results.push({ type, id: String(operation.id) });
        } else if (type === "set_focus") {
          const detail = operation.detail == null ? null : insertEncrypted(db, keyring, clock, { objectType: "focus-detail", scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: operation.detail }).id;
          const lease = operation.leaseMs == null ? null : new Date(clock().getTime() + Math.max(1, Number(operation.leaseMs))).toISOString();
          db.prepare(`INSERT INTO focus_state
            (conversation_id,branch_id,focus_type,focus_ref,detail_encrypted_id,source_turn_id,lease_expires_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(conversation_id,branch_id,focus_type) DO UPDATE SET focus_ref=excluded.focus_ref,
            detail_encrypted_id=excluded.detail_encrypted_id,source_turn_id=excluded.source_turn_id,lease_expires_at=excluded.lease_expires_at,updated_at=excluded.updated_at`)
            .run(conversationId, branchId, String(operation.focusType), String(operation.focusRef), detail, sourceTurnId, lease, now);
          results.push({ type, focusType: String(operation.focusType), leaseExpiresAt: lease });
        } else if (type === "put_state_item") {
          const id = String(operation.id || crypto.randomUUID());
          const existingOwner = db.prepare("SELECT conversation_id,branch_id FROM conversation_state_items WHERE id=?").get(id);
          if (existingOwner && (existingOwner.conversation_id !== conversationId || existingOwner.branch_id !== branchId)) throw new Error("State-item id belongs to another conversation branch.");
          const payload = insertEncrypted(db, keyring, clock, { objectType: `state-${String(operation.itemType)}`, scopeId: context.scope_id, sensitivity: String(operation.sensitivity || "private"), payload: operation.payload });
          db.prepare(`INSERT INTO conversation_state_items
            (id,conversation_id,branch_id,item_type,item_key,payload_encrypted_id,state,source_turn_id,resolved_turn_id,updated_at)
            VALUES(?,?,?,?,?,?,'active',?,NULL,?) ON CONFLICT(conversation_id,branch_id,item_type,item_key) DO UPDATE SET
            payload_encrypted_id=excluded.payload_encrypted_id,state='active',source_turn_id=excluded.source_turn_id,resolved_turn_id=NULL,updated_at=excluded.updated_at`)
            .run(id, conversationId, branchId, String(operation.itemType), String(operation.itemKey), payload.id, sourceTurnId, now);
          results.push({ type, id });
        } else if (type === "resolve_state_item") {
          const changed = db.prepare(`UPDATE conversation_state_items SET state=?,resolved_turn_id=?,updated_at=?
            WHERE conversation_id=? AND branch_id=? AND item_type=? AND item_key=? AND state='active'`)
            .run(String(operation.state || "resolved"), sourceTurnId, now, conversationId, branchId, String(operation.itemType), String(operation.itemKey));
          if (changed.changes !== 1) throw new Error("State item target is unavailable or inactive.");
          results.push({ type, itemKey: String(operation.itemKey) });
        } else if (type === "bind_context") {
          const id = String(operation.id || crypto.randomUUID());
          const existingOwner = db.prepare("SELECT conversation_id,branch_id FROM context_block_bindings WHERE id=?").get(id);
          if (existingOwner && (existingOwner.conversation_id !== conversationId || existingOwner.branch_id !== branchId)) throw new Error("Context-binding id belongs to another conversation branch.");
          const lease = operation.leaseMs == null ? null : new Date(clock().getTime() + Math.max(1, Number(operation.leaseMs))).toISOString();
          db.prepare(`INSERT INTO context_block_bindings
            (id,conversation_id,branch_id,block_type,block_ref,scope_id,source_version,attach_at,detach_at,lease_expires_at)
            VALUES(?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(conversation_id,branch_id,block_type,block_ref) DO UPDATE SET
            source_version=excluded.source_version,attach_at=excluded.attach_at,detach_at=NULL,lease_expires_at=excluded.lease_expires_at`)
            .run(id, conversationId, branchId, String(operation.blockType), String(operation.blockRef), context.scope_id,
              String(operation.sourceVersion), now, lease);
          results.push({ type, id, leaseExpiresAt: lease });
        } else if (type === "detach_context") {
          db.prepare("UPDATE context_block_bindings SET detach_at=? WHERE conversation_id=? AND branch_id=? AND block_type=? AND block_ref=? AND detach_at IS NULL")
            .run(now, conversationId, branchId, String(operation.blockType), String(operation.blockRef));
          results.push({ type, blockRef: String(operation.blockRef) });
        } else {
          throw new Error(`Unsupported conversation state operation: ${type}`);
        }
      }
      const nextSequence = expectedSequence + 1;
      const changed = db.prepare("UPDATE conversation_state_heads SET state_sequence=?,updated_at=? WHERE conversation_id=? AND state_sequence=?")
        .run(nextSequence, now, conversationId, expectedSequence);
      if (changed.changes !== 1) throw Object.assign(new Error("Conversation state compare-and-swap failed."), { code: "STATE_SEQUENCE_CONFLICT" });
      faultInjector("conversation.state.before_commit");
      return { conversationId, branchId, previousSequence: expectedSequence, stateSequence: nextSequence, operations: results };
    });
    return run.immediate();
  }

  function forkBranch(input = {}) {
    const conversationId = String(input.conversationId);
    const parentBranchId = String(input.parentBranchId);
    const parentTurnId = String(input.parentTurnId);
    validateSourceTurn(conversationId, parentTurnId);
    const newBranchId = String(input.branchId || crypto.randomUUID());
    initialize(conversationId, parentBranchId);
    const run = db.transaction(() => {
      const now = clock().toISOString();
      db.prepare("UPDATE conversation_branches SET state='suspended',resume_turn_id=?,updated_at=? WHERE id=? AND conversation_id=? AND state='active'")
        .run(parentTurnId, now, parentBranchId, conversationId);
      db.prepare(`INSERT INTO conversation_branches
        (id,conversation_id,parent_branch_id,parent_turn_id,state,resume_turn_id,merged_into_branch_id,created_at,updated_at)
        VALUES(?,?,?,?, 'active',?,NULL,?,?)`).run(newBranchId, conversationId, parentBranchId, parentTurnId, parentTurnId, now, now);
      db.prepare(`INSERT INTO topic_segments(id,conversation_id,branch_id,topic_key,state,start_turn_id,end_turn_id,capsule_encrypted_id,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),conversation_id,?,topic_key,state,start_turn_id,end_turn_id,capsule_encrypted_id,?,?
        FROM topic_segments WHERE conversation_id=? AND branch_id=? AND state IN ('active','suspended')`)
        .run(newBranchId, now, now, conversationId, parentBranchId);
      db.prepare(`INSERT INTO working_slots(conversation_id,branch_id,namespace,slot_key,slot_type,value_encrypted_id,source_turn_id,expires_at,promotion_status,updated_at)
        SELECT conversation_id,?,namespace,slot_key,slot_type,value_encrypted_id,source_turn_id,expires_at,promotion_status,?
        FROM working_slots WHERE conversation_id=? AND branch_id=? AND (expires_at IS NULL OR expires_at>?)`)
        .run(newBranchId, now, conversationId, parentBranchId, now);
      db.prepare(`INSERT INTO referent_state(id,conversation_id,branch_id,mention,candidates_encrypted_id,selected_ref,confidence,state,source_turn_id,valid_until_turn_id,updated_at)
        SELECT lower(hex(randomblob(16))),conversation_id,?,mention,candidates_encrypted_id,selected_ref,confidence,state,source_turn_id,valid_until_turn_id,?
        FROM referent_state WHERE conversation_id=? AND branch_id=? AND state IN ('unresolved','resolved')`)
        .run(newBranchId, now, conversationId, parentBranchId);
      db.prepare(`INSERT INTO open_loops(id,conversation_id,branch_id,loop_type,payload_encrypted_id,owner_actor_id,state,source_turn_id,resolved_turn_id,created_at,updated_at)
        SELECT lower(hex(randomblob(16))),conversation_id,?,loop_type,payload_encrypted_id,owner_actor_id,state,source_turn_id,resolved_turn_id,?,?
        FROM open_loops WHERE conversation_id=? AND branch_id=? AND state='open'`)
        .run(newBranchId, now, now, conversationId, parentBranchId);
      db.prepare(`INSERT INTO focus_state(conversation_id,branch_id,focus_type,focus_ref,detail_encrypted_id,source_turn_id,lease_expires_at,updated_at)
        SELECT conversation_id,?,focus_type,focus_ref,detail_encrypted_id,source_turn_id,lease_expires_at,?
        FROM focus_state WHERE conversation_id=? AND branch_id=? AND (lease_expires_at IS NULL OR lease_expires_at>?)`)
        .run(newBranchId, now, conversationId, parentBranchId, now);
      db.prepare(`INSERT INTO conversation_state_items(id,conversation_id,branch_id,item_type,item_key,payload_encrypted_id,state,source_turn_id,resolved_turn_id,updated_at)
        SELECT lower(hex(randomblob(16))),conversation_id,?,item_type,item_key,payload_encrypted_id,state,source_turn_id,resolved_turn_id,?
        FROM conversation_state_items WHERE conversation_id=? AND branch_id=? AND state='active'`)
        .run(newBranchId, now, conversationId, parentBranchId);
      db.prepare(`INSERT INTO context_block_bindings(id,conversation_id,branch_id,block_type,block_ref,scope_id,source_version,attach_at,detach_at,lease_expires_at)
        SELECT lower(hex(randomblob(16))),conversation_id,?,block_type,block_ref,scope_id,source_version,?,NULL,lease_expires_at
        FROM context_block_bindings WHERE conversation_id=? AND branch_id=? AND detach_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at>?)`)
        .run(newBranchId, now, conversationId, parentBranchId, now);
      db.prepare("UPDATE conversation_state_heads SET active_branch_id=?,state_sequence=state_sequence+1,updated_at=? WHERE conversation_id=?")
        .run(newBranchId, now, conversationId);
      return { conversationId, parentBranchId, branchId: newBranchId };
    });
    return run.immediate();
  }

  function switchBranch(conversationId, branchId) {
    initialize(conversationId, branchId);
    const run = db.transaction(() => {
      const head = db.prepare("SELECT active_branch_id FROM conversation_state_heads WHERE conversation_id=?").get(conversationId);
      const target = db.prepare("SELECT state FROM conversation_branches WHERE id=? AND conversation_id=?").get(branchId, conversationId);
      if (!target || !["active", "suspended"].includes(target.state)) throw new Error("Target branch cannot be resumed.");
      const now = clock().toISOString();
      if (head.active_branch_id !== branchId) db.prepare("UPDATE conversation_branches SET state='suspended',updated_at=? WHERE id=? AND state='active'").run(now, head.active_branch_id);
      db.prepare("UPDATE conversation_branches SET state='active',updated_at=? WHERE id=?").run(now, branchId);
      db.prepare("UPDATE conversation_state_heads SET active_branch_id=?,state_sequence=state_sequence+1,updated_at=? WHERE conversation_id=?").run(branchId, now, conversationId);
      return { conversationId, branchId };
    });
    return run.immediate();
  }

  function mergeBranch(conversationId, sourceBranchId, targetBranchId, mergeTurnId) {
    validateSourceTurn(conversationId, mergeTurnId);
    if (sourceBranchId === targetBranchId) throw new Error("A branch cannot merge into itself.");
    const run = db.transaction(() => {
      const now = clock().toISOString();
      const target = db.prepare("SELECT state FROM conversation_branches WHERE id=? AND conversation_id=?").get(targetBranchId, conversationId);
      if (!target || !["active", "suspended"].includes(target.state)) throw new Error("Target branch cannot receive a merge.");
      const changed = db.prepare("UPDATE conversation_branches SET state='merged',merged_into_branch_id=?,resume_turn_id=?,updated_at=? WHERE id=? AND conversation_id=? AND state IN ('active','suspended')")
        .run(targetBranchId, mergeTurnId, now, sourceBranchId, conversationId);
      if (changed.changes !== 1) throw new Error("Source branch cannot be merged.");
      db.prepare("UPDATE conversation_branches SET state='active',updated_at=? WHERE id=? AND conversation_id=? AND state='suspended'").run(now, targetBranchId, conversationId);
      db.prepare("UPDATE conversation_state_heads SET active_branch_id=?,state_sequence=state_sequence+1,updated_at=? WHERE conversation_id=?")
        .run(targetBranchId, now, conversationId);
      return { conversationId, sourceBranchId, targetBranchId, mergeTurnId };
    });
    return run.immediate();
  }

  function buildSnapshot({ conversationId, tailLimit = 8, persist = false } = {}) {
    const context = conversationContext(conversationId);
    const head = db.prepare("SELECT * FROM conversation_state_heads WHERE conversation_id=?").get(conversationId);
    if (!head) throw new Error("Conversation state is not initialized.");
    const branchId = head.active_branch_id;
    const now = persist ? head.updated_at : clock().toISOString();
    const topics = db.prepare("SELECT id,topic_key,state,start_turn_id,end_turn_id,capsule_encrypted_id,updated_at FROM topic_segments WHERE conversation_id=? AND branch_id=? AND state IN ('active','suspended') ORDER BY created_at,id").all(conversationId, branchId)
      .map((row) => ({ id: row.id, topicKey: row.topic_key, state: row.state, startTurnId: row.start_turn_id, endTurnId: row.end_turn_id, capsule: encryptedPayload(row.capsule_encrypted_id), updatedAt: row.updated_at }));
    const slots = db.prepare(`SELECT * FROM working_slots WHERE conversation_id=? AND branch_id=? AND (expires_at IS NULL OR expires_at>?)
      ORDER BY namespace,slot_key`).all(conversationId, branchId, now)
      .map((row) => ({ namespace: row.namespace, key: row.slot_key, type: row.slot_type, value: encryptedPayload(row.value_encrypted_id), sourceTurnId: row.source_turn_id, expiresAt: row.expires_at, promotionStatus: row.promotion_status }));
    const referents = db.prepare("SELECT * FROM referent_state WHERE conversation_id=? AND branch_id=? AND state IN ('unresolved','resolved') ORDER BY updated_at,id").all(conversationId, branchId)
      .map((row) => ({ id: row.id, mention: row.mention, candidates: encryptedPayload(row.candidates_encrypted_id).candidates, selectedRef: row.selected_ref, confidence: row.confidence, state: row.state, sourceTurnId: row.source_turn_id }));
    const loops = db.prepare("SELECT * FROM open_loops WHERE conversation_id=? AND branch_id=? AND state='open' ORDER BY created_at,id").all(conversationId, branchId)
      .map((row) => ({ id: row.id, type: row.loop_type, payload: encryptedPayload(row.payload_encrypted_id), ownerActorId: row.owner_actor_id, sourceTurnId: row.source_turn_id }));
    const items = db.prepare("SELECT * FROM conversation_state_items WHERE conversation_id=? AND branch_id=? AND state='active' ORDER BY item_type,item_key").all(conversationId, branchId)
      .map((row) => ({ id: row.id, type: row.item_type, key: row.item_key, payload: encryptedPayload(row.payload_encrypted_id), sourceTurnId: row.source_turn_id }));
    const focus = db.prepare(`SELECT * FROM focus_state WHERE conversation_id=? AND branch_id=? AND (lease_expires_at IS NULL OR lease_expires_at>?)
      ORDER BY focus_type`).all(conversationId, branchId, now)
      .map((row) => ({ type: row.focus_type, ref: row.focus_ref, detail: encryptedPayload(row.detail_encrypted_id), sourceTurnId: row.source_turn_id, leaseExpiresAt: row.lease_expires_at }));
    const contextBlocks = db.prepare(`SELECT block_type,block_ref,scope_id,source_version,attach_at,lease_expires_at FROM context_block_bindings
      WHERE conversation_id=? AND branch_id=? AND detach_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at>?) ORDER BY block_type,block_ref`)
      .all(conversationId, branchId, now).map((row) => ({ blockType: row.block_type, blockRef: row.block_ref, scopeId: row.scope_id, sourceVersion: row.source_version, attachAt: row.attach_at, leaseExpiresAt: row.lease_expires_at }));
    const allowedBranchIds = new Set(db.prepare(`WITH RECURSIVE lineage(id,parent_id) AS (
      SELECT id,parent_branch_id FROM conversation_branches WHERE id=? AND conversation_id=?
      UNION ALL SELECT b.id,b.parent_branch_id FROM conversation_branches b JOIN lineage l ON b.id=l.parent_id
    ) SELECT id FROM lineage`).all(branchId, conversationId).map((row) => row.id));
    const dependencyIds = new Set([
      ...topics.flatMap((item) => [item.startTurnId, item.endTurnId]),
      ...slots.map((item) => item.sourceTurnId), ...referents.map((item) => item.sourceTurnId),
      ...loops.map((item) => item.sourceTurnId), ...items.map((item) => item.sourceTurnId), ...focus.map((item) => item.sourceTurnId),
    ].filter(Boolean));
    const recent = db.prepare(`SELECT id FROM turns WHERE conversation_id=? AND branch_id=? AND status='finalized'
      ORDER BY COALESCE(client_sequence,-1) DESC,recorded_at DESC,id DESC LIMIT ?`).all(conversationId, branchId, Math.max(1, Math.min(30, Number(tailLimit) || 8))).map((row) => row.id);
    recent.forEach((id) => dependencyIds.add(id));
    const verbatimTail = [...dependencyIds].map((id) => db.prepare("SELECT * FROM turns WHERE id=? AND conversation_id=? AND status='finalized'").get(id, conversationId))
      .filter((row) => row && allowedBranchIds.has(row.branch_id)).sort((a, b) => Number(a.client_sequence ?? Number.MAX_SAFE_INTEGER) - Number(b.client_sequence ?? Number.MAX_SAFE_INTEGER) || a.recorded_at.localeCompare(b.recorded_at) || a.id.localeCompare(b.id))
      .map((row) => ({ id: row.id, branchId: row.branch_id, role: row.role, text: encryptedPayload(row.content_encrypted_id).text, recordedAt: row.recorded_at, dependencySelected: !recent.includes(row.id) }));
    const suspendedBranches = db.prepare("SELECT id,parent_branch_id,parent_turn_id,resume_turn_id,updated_at FROM conversation_branches WHERE conversation_id=? AND state='suspended' ORDER BY updated_at,id").all(conversationId)
      .map((row) => ({ id: row.id, parentBranchId: row.parent_branch_id, parentTurnId: row.parent_turn_id, resumeTurnId: row.resume_turn_id, updatedAt: row.updated_at }));
    const snapshot = { conversationId, scopeId: context.scope_id, stateSequence: head.state_sequence, activeBranchId: branchId, verbatimTail, topics, referents, openLoops: loops, stateItems: items, focus, workingSlots: slots, contextBlocks, suspendedBranches, effectiveAt: now };
    const checksum = keyring.sign(JSON.stringify(snapshot), "conversation-state-snapshot-v1");
    if (persist) {
      const save = db.transaction(() => {
        const existing = db.prepare("SELECT checksum FROM working_set_snapshots WHERE conversation_id=? AND state_sequence=?")
          .get(conversationId, head.state_sequence);
        if (existing && existing.checksum !== checksum) throw new Error("Persisted state sequence has a conflicting snapshot checksum.");
        if (!existing) {
          const encrypted = insertEncrypted(db, keyring, clock, { objectType: "working-set-snapshot", scopeId: context.scope_id, sensitivity: "private", payload: snapshot });
          db.prepare(`INSERT INTO working_set_snapshots
            (id,conversation_id,branch_id,state_sequence,covered_turn_ids_json,snapshot_encrypted_id,checksum,created_at)
            VALUES(?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), conversationId, branchId, head.state_sequence,
              JSON.stringify(verbatimTail.map((turn) => turn.id)), encrypted.id, checksum, now);
        }
      });
      save.immediate();
    }
    return { ...snapshot, checksum };
  }

  return Object.freeze({ applyDelta, buildSnapshot, forkBranch, initialize, mergeBranch, switchBranch });
}

module.exports = { createConversationStateRepository };
