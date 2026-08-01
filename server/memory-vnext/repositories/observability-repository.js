"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const STATUS_VALUES = new Set(["ok", "degraded", "failed", "denied"]);

function safeLabel(value, fallback) {
  const label = String(value || fallback);
  if (!/^[a-zA-Z0-9_.:/-]{1,160}$/.test(label)) throw new Error("Observability labels must be bounded identifiers, not content.");
  return label;
}

function createObservabilityRepository({ db, clock }) {
  if (Number(db.pragma("user_version", { simple: true })) < 4) throw new Error("Observability requires schema version 4.");

  function recordMetric(input = {}) {
    const status = STATUS_VALUES.has(input.status) ? input.status : "ok";
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error("Metric value must be finite.");
    const row = {
      id: crypto.randomUUID(), correlationId: input.correlationId ? String(input.correlationId) : null,
      component: safeLabel(input.component, "memory"), metricName: safeLabel(input.metricName, "unknown"),
      value, unit: safeLabel(input.unit, "count"), scopeClass: input.scopeClass ? safeLabel(input.scopeClass) : null,
      status, recordedAt: clock().toISOString(),
    };
    db.prepare(`INSERT INTO operation_metrics
      (id,correlation_id,component,metric_name,metric_value,unit,scope_class,status,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.correlationId, row.component, row.metricName, row.value, row.unit, row.scopeClass, row.status, row.recordedAt);
    return row;
  }

  function recordCost(input = {}) {
    const row = {
      id: crypto.randomUUID(), correlationId: input.correlationId ? String(input.correlationId) : null,
      provider: safeLabel(input.provider, "local"), model: input.model ? safeLabel(input.model) : null,
      operation: safeLabel(input.operation, "memory"), callCount: Math.max(0, Number(input.callCount) || 0),
      inputUnits: Math.max(0, Number(input.inputUnits) || 0), outputUnits: Math.max(0, Number(input.outputUnits) || 0),
      costUsd: Math.max(0, Number(input.costUsd) || 0), recordedAt: clock().toISOString(),
    };
    db.prepare(`INSERT INTO cost_observations
      (id,correlation_id,provider,model,operation,call_count,input_units,output_units,cost_usd,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.correlationId, row.provider, row.model, row.operation, row.callCount, row.inputUnits, row.outputUnits, row.costUsd, row.recordedAt);
    return row;
  }

  function grouped(table, field) {
    return Object.fromEntries(db.prepare(`SELECT ${field} AS key,COUNT(*) AS count FROM ${table} GROUP BY ${field}`).all().map((row) => [row.key, row.count]));
  }

  function readModel({ dbPath }) {
    const schemaVersion = Number(db.pragma("user_version", { simple: true }));
    const quickCheck = String(db.pragma("quick_check", { simple: true }));
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    const migrations = db.prepare("SELECT version,wave,name,applied_at,checksum FROM schema_migrations ORDER BY version").all();
    const cost = db.prepare(`SELECT COALESCE(SUM(call_count),0) AS calls,COALESCE(SUM(input_units),0) AS input_units,
      COALESCE(SUM(output_units),0) AS output_units,COALESCE(SUM(cost_usd),0) AS cost_usd FROM cost_observations`).get();
    const latestBackup = db.prepare("SELECT source_version,target_version,sha256,quick_check,created_at FROM backup_history ORDER BY created_at DESC LIMIT 1").get() || null;
    const snapshot = {
      generatedAt: clock().toISOString(),
      status: quickCheck === "ok" ? "healthy" : "unhealthy",
      storage: {
        schemaVersion, quickCheck, foreignKeys: Number(db.pragma("foreign_keys", { simple: true })) === 1,
        journalMode: String(db.pragma("journal_mode", { simple: true })), synchronous: Number(db.pragma("synchronous", { simple: true })),
        databaseBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
        walBytes: fs.existsSync(walPath) ? fs.statSync(walPath).size : 0,
        shmBytes: fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0,
      },
      canonicalSequence: Number(db.prepare("SELECT value FROM sequence_state WHERE name='canonical'").get()?.value || 0),
      migrations,
      supervisor: db.prepare("SELECT mode,updated_at FROM supervisor_state WHERE id=1").get() || { mode: "not_initialized" },
      jobs: grouped("memory_jobs", "status"),
      outbox: grouped("outbox_events", "status"),
      workerLeases: Number(db.prepare("SELECT COUNT(*) AS count FROM worker_leases WHERE lease_expires_at>?").get(clock().toISOString()).count),
      policyDenials: Number(db.prepare("SELECT COUNT(*) AS count FROM policy_denials").get().count),
      deadLetters: {
        jobs: Number(db.prepare("SELECT COUNT(*) AS count FROM memory_jobs WHERE status='dead_letter'").get().count),
        outbox: Number(db.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE status='dead_letter'").get().count),
      },
      cost: { calls: Number(cost.calls), inputUnits: Number(cost.input_units), outputUnits: Number(cost.output_units), costUsd: Number(cost.cost_usd) },
      backups: { count: Number(db.prepare("SELECT COUNT(*) AS count FROM backup_history").get().count), latest: latestBackup },
      projectionCursors: db.prepare("SELECT projector,canonical_sequence,version,status,last_error_code,updated_at FROM projection_cursors ORDER BY projector").all(),
    };
    if (snapshot.deadLetters.jobs || snapshot.deadLetters.outbox || snapshot.policyDenials > 100) snapshot.status = "degraded";
    return snapshot;
  }

  function saveSnapshot(snapshot) {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO health_snapshots(id,status,canonical_sequence,snapshot_json,created_at) VALUES(?,?,?,?,?)")
      .run(id, snapshot.status, snapshot.canonicalSequence, JSON.stringify(snapshot), clock().toISOString());
    return { id, status: snapshot.status, canonicalSequence: snapshot.canonicalSequence };
  }

  function trace(correlationId) {
    const id = String(correlationId || "");
    if (!id || id.length > 200) throw new Error("A bounded correlation id is required.");
    return {
      correlationId: id,
      commands: db.prepare("SELECT id,command_type,actor_id,scope_id,purpose,status,created_at FROM memory_commands WHERE correlation_id=? ORDER BY created_at").all(id),
      events: db.prepare("SELECT event_id,canonical_sequence,stream_type,stream_id,stream_sequence,event_type,recorded_at FROM ledger_events WHERE correlation_id=? ORDER BY canonical_sequence").all(id),
      outbox: db.prepare(`SELECT o.id,o.target,o.partition_key,o.status,o.attempts,o.last_error_code,o.updated_at FROM outbox_events o
        JOIN ledger_events e ON e.event_id=o.ledger_event_id WHERE e.correlation_id=? ORDER BY o.rowid`).all(id),
      jobs: db.prepare("SELECT job_id,job_type,partition_key,status,attempt,max_attempts,last_error_code,updated_at FROM memory_jobs WHERE correlation_id=? ORDER BY rowid").all(id),
      metrics: db.prepare("SELECT component,metric_name,metric_value,unit,status,recorded_at FROM operation_metrics WHERE correlation_id=? ORDER BY recorded_at").all(id),
      costs: db.prepare("SELECT provider,model,operation,call_count,input_units,output_units,cost_usd,recorded_at FROM cost_observations WHERE correlation_id=? ORDER BY recorded_at").all(id),
    };
  }

  function auditOperatorAction(input = {}) {
    const row = { id: crypto.randomUUID(), actorId: String(input.actorId || "local-owner"), action: String(input.action), targetType: input.targetType ? String(input.targetType) : null, targetId: input.targetId ? String(input.targetId) : null, resultCode: String(input.resultCode || "OK"), correlationId: input.correlationId ? String(input.correlationId) : null, createdAt: clock().toISOString() };
    db.prepare("INSERT INTO operator_audit(id,actor_id,action,target_type,target_id,result_code,correlation_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(row.id, row.actorId, row.action, row.targetType, row.targetId, row.resultCode, row.correlationId, row.createdAt);
    return row;
  }

  return Object.freeze({ auditOperatorAction, readModel, recordCost, recordMetric, saveSnapshot, trace });
}

module.exports = { createObservabilityRepository };
