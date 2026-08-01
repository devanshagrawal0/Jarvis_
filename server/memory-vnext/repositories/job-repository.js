"use strict";

const crypto = require("node:crypto");
const { safeCode } = require("./ledger-repository");

function receiptArray(value, max = 40) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => String(item).slice(0, 300));
}

function createJobRepository({ db, clock, faultInjector, maxQueuedPerScope = 2_000 }) {
  if (Number(db.pragma("user_version", { simple: true })) < 2) throw new Error("Job repository requires schema version 2.");

  function enqueue(input = {}) {
    const idempotencyKey = String(input.idempotencyKey || "");
    if (!idempotencyKey) throw new Error("Job idempotency key is required.");
    const existing = db.prepare("SELECT * FROM memory_jobs WHERE idempotency_key=?").get(idempotencyKey);
    if (existing) return { ...existing, replayed: true };
    const scopeId = String(input.scopeId || "");
    const queued = Number(db.prepare("SELECT COUNT(*) AS count FROM memory_jobs WHERE scope_id=? AND status IN ('queued','retry','leased')").get(scopeId)?.count || 0);
    if (queued >= maxQueuedPerScope) throw Object.assign(new Error("Memory job backpressure limit reached."), { code: "JOB_BACKPRESSURE" });
    const now = clock().toISOString();
    const job = {
      jobId: String(input.jobId || crypto.randomUUID()),
      jobType: String(input.jobType || ""),
      jobVersion: Number(input.jobVersion || 1),
      partitionKey: String(input.partitionKey || scopeId),
      prerequisiteSequence: input.prerequisiteSequence == null ? null : Number(input.prerequisiteSequence),
      inputRef: String(input.inputRef || ""),
      scopeId,
      sensitivity: String(input.sensitivity || "private"),
      cloudEligibility: input.cloudEligibility === true ? 1 : 0,
      idempotencyKey,
      maxAttempts: Math.max(1, Math.min(20, Number(input.maxAttempts) || 5)),
      latencyClass: String(input.latencyClass || "background"),
      maxCostUsd: Math.max(0, Math.min(1_000, Number(input.maxCostUsd) || 0)),
      availableAt: String(input.availableAt || now),
    };
    if (!job.jobType || !job.partitionKey || !job.inputRef || !job.scopeId) throw new Error("Job type, partition, immutable input reference, and scope are required.");
    db.prepare(`INSERT INTO memory_jobs
      (job_id,job_type,job_version,partition_key,prerequisite_sequence,input_ref,scope_id,sensitivity,cloud_eligibility,
       idempotency_key,attempt,max_attempts,latency_class,max_cost_usd,status,available_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,'queued',?,?,?)`)
      .run(job.jobId, job.jobType, job.jobVersion, job.partitionKey, job.prerequisiteSequence, job.inputRef, job.scopeId,
        job.sensitivity, job.cloudEligibility, job.idempotencyKey, job.maxAttempts, job.latencyClass, job.maxCostUsd,
        job.availableAt, now, now);
    if (Number(db.pragma("user_version", { simple: true })) >= 4 && input.correlationId) {
      db.prepare("UPDATE memory_jobs SET correlation_id=? WHERE job_id=?").run(String(input.correlationId), job.jobId);
    }
    return { ...db.prepare("SELECT * FROM memory_jobs WHERE job_id=?").get(job.jobId), replayed: false };
  }

  function leaseNext({ workerId, partitions = [], leaseMs = 30_000, capability = "memory.worker", scopeId = "owner:local" } = {}) {
    if (!workerId) throw new Error("Worker id is required.");
    const now = clock();
    const partitionClause = partitions.length ? `AND j.partition_key IN (${partitions.map(() => "?").join(",")})` : "";
    const args = partitions.map(String);
    const run = db.transaction(() => {
      const row = db.prepare(`SELECT j.* FROM memory_jobs j
        WHERE j.status IN ('queued','retry') AND j.available_at<=?
          AND (j.prerequisite_sequence IS NULL OR j.prerequisite_sequence <= (SELECT value FROM sequence_state WHERE name='canonical'))
          ${partitionClause}
          AND NOT EXISTS (SELECT 1 FROM memory_jobs earlier WHERE earlier.partition_key=j.partition_key
            AND earlier.rowid<j.rowid AND earlier.status IN ('queued','retry','leased'))
        ORDER BY CASE j.latency_class WHEN 'instant' THEN 0 WHEN 'normal' THEN 1 WHEN 'background' THEN 2 ELSE 3 END,j.rowid
        LIMIT 1`).get(now.toISOString(), ...args);
      if (!row) return null;
      const expires = new Date(now.getTime() + Math.max(1_000, Math.min(300_000, leaseMs))).toISOString();
      const changed = db.prepare(`UPDATE memory_jobs SET status='leased',attempt=attempt+1,lease_owner=?,lease_expires_at=?,updated_at=?
        WHERE job_id=? AND status IN ('queued','retry')`).run(workerId, expires, now.toISOString(), row.job_id);
      if (changed.changes !== 1) return null;
      db.prepare(`INSERT INTO worker_leases(worker_id,partition_key,heartbeat_at,lease_expires_at,capability,scope_id,drain_state)
        VALUES(?,?,?,?,?,?, 'running') ON CONFLICT(worker_id,partition_key) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,
        lease_expires_at=excluded.lease_expires_at,capability=excluded.capability,scope_id=excluded.scope_id,drain_state='running'`)
        .run(workerId, row.partition_key, now.toISOString(), expires, capability, row.scope_id);
      return db.prepare("SELECT * FROM memory_jobs WHERE job_id=?").get(row.job_id);
    });
    return run.immediate();
  }

  function heartbeat({ workerId, partitionKey, extendMs = 30_000 }) {
    const now = clock();
    const expires = new Date(now.getTime() + Math.max(1_000, Math.min(300_000, extendMs))).toISOString();
    const changed = db.prepare(`UPDATE worker_leases SET heartbeat_at=?,lease_expires_at=?
      WHERE worker_id=? AND partition_key=? AND drain_state='running'`).run(now.toISOString(), expires, workerId, partitionKey);
    db.prepare(`UPDATE memory_jobs SET lease_expires_at=?,updated_at=? WHERE lease_owner=? AND partition_key=? AND status='leased'`)
      .run(expires, now.toISOString(), workerId, partitionKey);
    return { ok: changed.changes === 1, leaseExpiresAt: expires };
  }

  function complete({ jobId, workerId, outputIds = [], outputHash = null, costUsd = 0, sideEffects = [] } = {}) {
    const prior = db.prepare("SELECT * FROM job_receipts WHERE job_id=?").get(jobId);
    if (prior) return { ...prior, replayed: true };
    const run = db.transaction(() => {
      const job = db.prepare("SELECT * FROM memory_jobs WHERE job_id=?").get(jobId);
      if (!job || job.status !== "leased" || job.lease_owner !== workerId) throw new Error("Job lease ownership mismatch.");
      const actualCost = Math.max(0, Number(costUsd) || 0);
      if (actualCost > Number(job.max_cost_usd) + 1e-9) throw Object.assign(new Error("Job cost budget exceeded."), { code: "JOB_COST_EXCEEDED" });
      const now = clock().toISOString();
      const receipt = {
        id: crypto.randomUUID(),
        jobId,
        idempotencyKey: job.idempotency_key,
        outputIds: receiptArray(outputIds),
        outputHash: outputHash == null ? null : String(outputHash).slice(0, 200),
        costUsd: actualCost,
        sideEffects: receiptArray(sideEffects),
        outcome: "succeeded",
        createdAt: now,
      };
      db.prepare(`INSERT INTO job_receipts
        (id,job_id,idempotency_key,output_ids_json,output_hash,cost_usd,side_effects_json,outcome,error_code,created_at)
        VALUES(?,?,?,?,?,?,?,'succeeded',NULL,?)`)
        .run(receipt.id, jobId, receipt.idempotencyKey, JSON.stringify(receipt.outputIds), receipt.outputHash,
          receipt.costUsd, JSON.stringify(receipt.sideEffects), now);
      faultInjector("job.complete.after_receipt");
      db.prepare("UPDATE memory_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=?")
        .run(now, jobId);
      return { ...receipt, replayed: false };
    });
    return run.immediate();
  }

  function fail({ jobId, workerId, errorCode = "WORKER_FAILURE" } = {}) {
    const run = db.transaction(() => {
      const job = db.prepare("SELECT * FROM memory_jobs WHERE job_id=?").get(jobId);
      if (!job || job.status !== "leased" || job.lease_owner !== workerId) throw new Error("Job lease ownership mismatch.");
      const dead = job.attempt >= job.max_attempts;
      const code = safeCode(errorCode, "WORKER_FAILURE");
      const now = clock();
      if (dead) {
        const receiptId = crypto.randomUUID();
        db.prepare(`INSERT OR IGNORE INTO job_receipts
          (id,job_id,idempotency_key,output_ids_json,output_hash,cost_usd,side_effects_json,outcome,error_code,created_at)
          VALUES(?,?,?,'[]',NULL,0,'[]','dead_letter',?,?)`)
          .run(receiptId, jobId, job.idempotency_key, code, now.toISOString());
        db.prepare(`UPDATE memory_jobs SET status='dead_letter',lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? WHERE job_id=?`)
          .run(code, now.toISOString(), jobId);
        return { jobId, status: "dead_letter", errorCode: code };
      }
      const delayMs = Math.min(300_000, 1_000 * (2 ** Math.max(0, job.attempt - 1)));
      const availableAt = new Date(now.getTime() + delayMs).toISOString();
      db.prepare(`UPDATE memory_jobs SET status='retry',available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,updated_at=? WHERE job_id=?`)
        .run(availableAt, code, now.toISOString(), jobId);
      return { jobId, status: "retry", errorCode: code, availableAt };
    });
    return run.immediate();
  }

  function cancel(jobId, reasonCode = "OWNER_CANCELLED") {
    const now = clock().toISOString();
    const run = db.transaction(() => {
      const job = db.prepare("SELECT * FROM memory_jobs WHERE job_id=?").get(jobId);
      if (!job) return { ok: false, status: "not_found" };
      if (["succeeded", "dead_letter", "cancelled"].includes(job.status)) return { ok: true, status: job.status, replayed: true };
      if (job.status === "leased") throw new Error("Leased job requires cooperative worker cancellation.");
      const code = safeCode(reasonCode, "OWNER_CANCELLED");
      db.prepare("UPDATE memory_jobs SET status='cancelled',last_error_code=?,updated_at=? WHERE job_id=?").run(code, now, jobId);
      db.prepare(`INSERT OR IGNORE INTO job_receipts
        (id,job_id,idempotency_key,output_ids_json,output_hash,cost_usd,side_effects_json,outcome,error_code,created_at)
        VALUES(?,?,?,'[]',NULL,0,'[]','cancelled',?,?)`)
        .run(crypto.randomUUID(), jobId, job.idempotency_key, code, now);
      return { ok: true, status: "cancelled" };
    });
    return run.immediate();
  }

  function reapExpiredLeases() {
    const now = clock().toISOString();
    const expired = db.prepare("SELECT job_id,lease_owner FROM memory_jobs WHERE status='leased' AND lease_expires_at<=?").all(now);
    const results = [];
    for (const job of expired) results.push(fail({ jobId: job.job_id, workerId: job.lease_owner, errorCode: "LEASE_EXPIRED" }));
    db.prepare("DELETE FROM worker_leases WHERE lease_expires_at<=?").run(now);
    return results;
  }

  function setWorkerDrain(workerId, state = "draining") {
    if (!['running', 'draining', 'stopped'].includes(state)) throw new Error("Invalid worker drain state.");
    const changed = db.prepare("UPDATE worker_leases SET drain_state=? WHERE worker_id=?").run(state, workerId);
    return { workerId, state, partitions: changed.changes };
  }

  function health() {
    const jobs = Object.fromEntries(db.prepare("SELECT status,COUNT(*) AS count FROM memory_jobs GROUP BY status").all().map((row) => [row.status, row.count]));
    return {
      jobs,
      deadLetters: Number(jobs.dead_letter || 0),
      activeLeases: Number(db.prepare("SELECT COUNT(*) AS count FROM memory_jobs WHERE status='leased'").get().count),
      workers: Number(db.prepare("SELECT COUNT(DISTINCT worker_id) AS count FROM worker_leases").get().count),
    };
  }

  return Object.freeze({ cancel, complete, enqueue, fail, health, heartbeat, leaseNext, reapExpiredLeases, setWorkerDrain });
}

module.exports = { createJobRepository };
