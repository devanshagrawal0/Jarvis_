"use strict";

const crypto = require("node:crypto");

function safeCode(value, fallback = "UNKNOWN_FAILURE") {
  const candidate = String(value || "").trim();
  return /^[A-Z][A-Z0-9_.-]{0,99}$/.test(candidate) ? candidate : fallback;
}

function insertEncrypted(db, keyring, clock, { id = crypto.randomUUID(), objectType, schemaVersion = 1, scopeId, sensitivity, payload }) {
  const aad = { id, objectType, schemaVersion, scopeId, sensitivity };
  const envelope = keyring.encrypt(payload, aad);
  db.prepare(`INSERT INTO encrypted_objects
    (id,object_type,schema_version,scope_id,sensitivity,key_id,key_version,nonce,ciphertext,auth_tag,aad_json,content_mac,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, objectType, schemaVersion, scopeId, sensitivity, envelope.keyId, envelope.keyVersion,
      envelope.nonce, envelope.ciphertext, envelope.authTag, envelope.aadJson, envelope.contentMac, clock().toISOString());
  return { id, contentMac: envelope.contentMac };
}

function createLedgerRepository({ db, keyring, clock, faultInjector }) {
  const schemaVersion = Number(db.pragma("user_version", { simple: true }));
  if (schemaVersion < 2) throw new Error("Ledger repository requires schema version 2.");

  function assertReference(command) {
    const actor = db.prepare("SELECT status FROM actors WHERE id=?").get(command.actorId);
    const scope = db.prepare("SELECT status FROM scopes WHERE id=?").get(command.scopeId);
    if (!actor || actor.status !== "active") throw new Error("Command actor is unavailable.");
    if (!scope || scope.status !== "active") throw new Error("Command scope is unavailable.");
  }

  function priorReceipt(actorId, idempotencyKey) {
    const row = db.prepare("SELECT result_json,status FROM memory_commands WHERE actor_id=? AND idempotency_key=?").get(actorId, idempotencyKey);
    return row ? { ...JSON.parse(row.result_json), replayed: true, commandStatus: row.status } : null;
  }

  function commitCommand(input = {}) {
    const command = {
      commandType: String(input.commandType || ""),
      schemaVersion: Number(input.schemaVersion || 1),
      actorId: String(input.actorId || ""),
      scopeId: String(input.scopeId || ""),
      purpose: String(input.purpose || ""),
      idempotencyKey: String(input.idempotencyKey || ""),
      streamType: String(input.streamType || "memory"),
      streamId: String(input.streamId || input.scopeId || ""),
      eventType: String(input.eventType || input.commandType || "memory.changed"),
      sensitivity: String(input.sensitivity || "private"),
      payload: input.payload ?? {},
      occurredAt: String(input.occurredAt || clock().toISOString()),
      correlationId: input.correlationId ? String(input.correlationId) : null,
      causationId: input.causationId ? String(input.causationId) : null,
      deviceHlc: input.deviceHlc ? String(input.deviceHlc) : null,
      outboxTargets: Array.isArray(input.outboxTargets) ? [...new Set(input.outboxTargets.map(String).filter(Boolean))] : [],
      canonical: input.canonical || null,
    };
    if (!command.commandType || !command.actorId || !command.scopeId || !command.purpose || !command.idempotencyKey || !command.streamId) {
      throw new Error("Command type, actor, scope, purpose, stream, and idempotency key are required.");
    }
    const prior = priorReceipt(command.actorId, command.idempotencyKey);
    if (prior) return prior;
    assertReference(command);
    const run = db.transaction(() => {
      const replay = priorReceipt(command.actorId, command.idempotencyKey);
      if (replay) return replay;
      const now = clock().toISOString();
      const commandId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const eventPayload = insertEncrypted(db, keyring, clock, {
        objectType: "ledger-event-payload",
        schemaVersion: command.schemaVersion,
        scopeId: command.scopeId,
        sensitivity: command.sensitivity,
        payload: command.payload,
      });
      faultInjector("command.after_payload");
      let canonicalResult = null;
      if (command.canonical) {
        const canonical = command.canonical;
        const current = db.prepare("SELECT version FROM canonical_objects WHERE id=?").get(String(canonical.id));
        const expectedVersion = canonical.expectedVersion == null ? (current ? current.version : 0) : Number(canonical.expectedVersion);
        if (Number(current?.version || 0) !== expectedVersion) throw new Error("Canonical compare-and-swap version conflict.");
        const nextVersion = expectedVersion + 1;
        const encrypted = insertEncrypted(db, keyring, clock, {
          objectType: String(canonical.objectType),
          schemaVersion: Number(canonical.schemaVersion || 1),
          scopeId: command.scopeId,
          sensitivity: command.sensitivity,
          payload: canonical.payload,
        });
        if (!current) {
          db.prepare(`INSERT INTO canonical_objects
            (id,object_type,schema_version,scope_id,owner_subject_id,sensitivity,cloud_policy,status,retention_policy_id,encrypted_object_id,version,content_mac,created_by,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(String(canonical.id), String(canonical.objectType), Number(canonical.schemaVersion || 1), command.scopeId,
              String(canonical.ownerSubjectId || command.actorId), command.sensitivity, String(canonical.cloudPolicy || "deny"),
              String(canonical.status || "active"), String(canonical.retentionPolicyId || "retain:default"), encrypted.id,
              nextVersion, encrypted.contentMac, command.actorId, now, now);
        } else {
          const changed = db.prepare(`UPDATE canonical_objects SET object_type=?,schema_version=?,sensitivity=?,cloud_policy=?,status=?,
            retention_policy_id=?,encrypted_object_id=?,version=?,content_mac=?,updated_at=? WHERE id=? AND version=?`)
            .run(String(canonical.objectType), Number(canonical.schemaVersion || 1), command.sensitivity, String(canonical.cloudPolicy || "deny"),
              String(canonical.status || "active"), String(canonical.retentionPolicyId || "retain:default"), encrypted.id,
              nextVersion, encrypted.contentMac, now, String(canonical.id), expectedVersion);
          if (changed.changes !== 1) throw new Error("Canonical compare-and-swap update failed.");
        }
        canonicalResult = { id: String(canonical.id), version: nextVersion, contentMac: encrypted.contentMac };
      }
      faultInjector("command.after_canonical");
      const canonicalSequence = Number(db.prepare("UPDATE sequence_state SET value=value+1 WHERE name='canonical' RETURNING value").get().value);
      const head = db.prepare("SELECT last_sequence,last_mac FROM stream_heads WHERE stream_type=? AND stream_id=?")
        .get(command.streamType, command.streamId) || { last_sequence: 0, last_mac: "GENESIS" };
      const streamSequence = Number(head.last_sequence) + 1;
      const macInput = JSON.stringify({
        eventId,
        canonicalSequence,
        streamType: command.streamType,
        streamId: command.streamId,
        streamSequence,
        eventType: command.eventType,
        schemaVersion: command.schemaVersion,
        actorId: command.actorId,
        scopeId: command.scopeId,
        occurredAt: command.occurredAt,
        recordedAt: now,
        deviceHlc: command.deviceHlc,
        causationId: command.causationId,
        correlationId: command.correlationId,
        idempotencyKey: command.idempotencyKey,
        payloadContentMac: eventPayload.contentMac,
        previousMac: head.last_mac,
      });
      const mac = keyring.sign(macInput, "ledger-integrity-v1");
      db.prepare(`INSERT INTO ledger_events
        (event_id,canonical_sequence,stream_type,stream_id,stream_sequence,event_type,schema_version,actor_id,scope_id,
         occurred_at,recorded_at,device_hlc,causation_id,correlation_id,idempotency_key,payload_encrypted_id,previous_mac,mac)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(eventId, canonicalSequence, command.streamType, command.streamId, streamSequence, command.eventType, command.schemaVersion,
          command.actorId, command.scopeId, command.occurredAt, now, command.deviceHlc, command.causationId, command.correlationId,
          command.idempotencyKey, eventPayload.id, head.last_mac, mac);
      db.prepare(`INSERT INTO stream_heads(stream_type,stream_id,last_sequence,last_mac) VALUES(?,?,?,?)
        ON CONFLICT(stream_type,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_mac=excluded.last_mac`)
        .run(command.streamType, command.streamId, streamSequence, mac);
      faultInjector("command.after_event");
      for (const target of command.outboxTargets) {
        db.prepare(`INSERT INTO outbox_events
          (id,ledger_event_id,target,partition_key,status,attempts,max_attempts,available_at,created_at,updated_at)
          VALUES(?,?,?,?, 'pending',0,8,?,?,?)`)
          .run(crypto.randomUUID(), eventId, target, command.streamId, now, now, now);
      }
      faultInjector("command.after_outbox");
      const receipt = {
        ok: true,
        accepted: true,
        replayed: false,
        commandId,
        eventId,
        canonicalSequence,
        streamSequence,
        canonical: canonicalResult,
        outboxTargets: command.outboxTargets,
        committedAt: now,
      };
      db.prepare(`INSERT INTO memory_commands
        (id,command_type,schema_version,actor_id,scope_id,purpose,idempotency_key,status,result_json,correlation_id,created_at)
        VALUES(?,?,?,?,?,?,?,'accepted',?,?,?)`)
        .run(commandId, command.commandType, command.schemaVersion, command.actorId, command.scopeId, command.purpose,
          command.idempotencyKey, JSON.stringify(receipt), command.correlationId, now);
      faultInjector("command.before_commit");
      return receipt;
    });
    return run.immediate();
  }

  function verifyStream(streamType, streamId) {
    const rows = db.prepare(`SELECT e.*,o.content_mac AS payload_content_mac FROM ledger_events e
      JOIN encrypted_objects o ON o.id=e.payload_encrypted_id
      WHERE e.stream_type=? AND e.stream_id=? ORDER BY e.stream_sequence`).all(streamType, streamId);
    let previousMac = "GENESIS";
    let expectedSequence = 1;
    for (const row of rows) {
      const macInput = JSON.stringify({
        eventId: row.event_id,
        canonicalSequence: row.canonical_sequence,
        streamType: row.stream_type,
        streamId: row.stream_id,
        streamSequence: row.stream_sequence,
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        actorId: row.actor_id,
        scopeId: row.scope_id,
        occurredAt: row.occurred_at,
        recordedAt: row.recorded_at,
        deviceHlc: row.device_hlc,
        causationId: row.causation_id,
        correlationId: row.correlation_id,
        idempotencyKey: row.idempotency_key,
        payloadContentMac: row.payload_content_mac,
        previousMac,
      });
      if (row.stream_sequence !== expectedSequence || row.previous_mac !== previousMac || row.mac !== keyring.sign(macInput, "ledger-integrity-v1")) {
        return { ok: false, checked: expectedSequence - 1, failedEventId: row.event_id };
      }
      previousMac = row.mac;
      expectedSequence += 1;
    }
    return { ok: true, checked: rows.length, lastMac: previousMac };
  }

  function leaseOutbox({ workerId, targets = [], leaseMs = 30_000 } = {}) {
    const now = clock();
    const expiresAt = new Date(now.getTime() + Math.max(1_000, leaseMs)).toISOString();
    const targetClause = targets.length ? `AND target IN (${targets.map(() => "?").join(",")})` : "";
    const args = targets.map(String);
    const run = db.transaction(() => {
      const row = db.prepare(`SELECT * FROM outbox_events WHERE status IN ('pending','retry') AND available_at<=? ${targetClause}
        AND NOT EXISTS (SELECT 1 FROM outbox_events earlier WHERE earlier.partition_key=outbox_events.partition_key
          AND earlier.rowid<outbox_events.rowid AND earlier.status IN ('pending','retry','leased'))
        ORDER BY rowid LIMIT 1`).get(now.toISOString(), ...args);
      if (!row) return null;
      const changed = db.prepare(`UPDATE outbox_events SET status='leased',attempts=attempts+1,lease_owner=?,lease_expires_at=?,updated_at=?
        WHERE id=? AND status IN ('pending','retry')`).run(workerId, expiresAt, now.toISOString(), row.id);
      return changed.changes === 1 ? db.prepare("SELECT * FROM outbox_events WHERE id=?").get(row.id) : null;
    });
    return run.immediate();
  }

  function completeOutbox(id, workerId) {
    const changed = db.prepare(`UPDATE outbox_events SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE id=? AND status='leased' AND lease_owner=?`).run(clock().toISOString(), id, workerId);
    if (changed.changes !== 1) throw new Error("Outbox lease ownership mismatch.");
    return { ok: true, id };
  }

  function failOutbox(id, workerId, errorCode) {
    const row = db.prepare("SELECT attempts,max_attempts FROM outbox_events WHERE id=? AND status='leased' AND lease_owner=?").get(id, workerId);
    if (!row) throw new Error("Outbox lease ownership mismatch.");
    const dead = row.attempts >= row.max_attempts;
    const delayMs = Math.min(300_000, 500 * (2 ** Math.max(0, row.attempts - 1)));
    const available = new Date(clock().getTime() + delayMs).toISOString();
    db.prepare(`UPDATE outbox_events SET status=?,available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? WHERE id=?`)
      .run(dead ? "dead_letter" : "retry", available, safeCode(errorCode), clock().toISOString(), id);
    return { id, status: dead ? "dead_letter" : "retry", availableAt: available };
  }

  function reapExpiredOutbox() {
    const now = clock().toISOString();
    const expired = db.prepare("SELECT id,lease_owner FROM outbox_events WHERE status='leased' AND lease_expires_at<=?").all(now);
    return expired.map((row) => failOutbox(row.id, row.lease_owner, "LEASE_EXPIRED"));
  }

  function health() {
    const counts = Object.fromEntries(db.prepare("SELECT status,COUNT(*) AS count FROM outbox_events GROUP BY status").all().map((row) => [row.status, row.count]));
    return {
      canonicalSequence: Number(db.prepare("SELECT value FROM sequence_state WHERE name='canonical'").get()?.value || 0),
      ledgerEvents: Number(db.prepare("SELECT COUNT(*) AS count FROM ledger_events").get().count),
      outbox: counts,
      deadLetters: Number(counts.dead_letter || 0),
    };
  }

  return Object.freeze({ commitCommand, completeOutbox, failOutbox, health, leaseOutbox, priorReceipt, reapExpiredOutbox, verifyStream });
}

module.exports = { createLedgerRepository, insertEncrypted, safeCode };
