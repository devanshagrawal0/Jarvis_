"use strict";

const { createJobRepository } = require("./repositories/job-repository");
const { createLedgerRepository } = require("./repositories/ledger-repository");

function createMemorySupervisor({ store, policyEngine = null, clock = () => new Date() } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const control = store.attachRepository(({ db }) => {
    if (Number(db.pragma("user_version", { simple: true })) < 2) throw new Error("Memory Supervisor requires schema version 2.");
    const now = clock().toISOString();
    db.prepare("INSERT OR IGNORE INTO supervisor_state(id,mode,updated_at) VALUES(1,'running',?)").run(now);
    return {
      mode: () => db.prepare("SELECT mode FROM supervisor_state WHERE id=1").get().mode,
      setMode: (mode) => db.prepare("UPDATE supervisor_state SET mode=?,updated_at=? WHERE id=1").run(mode, clock().toISOString()),
      pending: () => Number(db.prepare("SELECT COUNT(*) AS count FROM memory_jobs WHERE status IN ('queued','retry','leased')").get().count),
      recordDenial(decision, command) {
        if (Number(db.pragma("user_version", { simple: true })) < 3) return;
        db.prepare(`INSERT INTO policy_denials(id,actor_id,capability,scope_id,purpose,sensitivity,reason_code,policy_id,correlation_id,created_at)
          VALUES(lower(hex(randomblob(16))),?,?,?,?,?,?,?,?,?)`)
          .run(command.actorId, command.capability || "memory.command", command.scopeId, command.purpose,
            command.sensitivity || "private", decision.reasonCode || "POLICY_DENIED", decision.policyId || null,
            command.correlationId || null, clock().toISOString());
      },
    };
  });
  const ledger = store.attachRepository(createLedgerRepository);
  const jobs = store.attachRepository(createJobRepository);

  function ensureRunning() {
    const mode = control.mode();
    if (mode !== "running") throw Object.assign(new Error(`Memory Supervisor is ${mode}.`), { code: "SUPERVISOR_NOT_RUNNING" });
  }

  function authorize(command) {
    if (policyEngine) {
      const decision = policyEngine.evaluate({
        actorId: command.actorId,
        capability: command.capability || "memory.command",
        scopeId: command.scopeId,
        purpose: command.purpose,
        sensitivity: command.sensitivity || "private",
        channel: command.cloudRequired ? "cloud" : "local",
        share: command.share === true,
        correlationId: command.correlationId,
      }, { record: false });
      if (!decision.allowed) {
        control.recordDenial(decision, command);
        throw Object.assign(new Error("Memory command denied by policy."), { code: decision.reasonCode || "POLICY_DENIED" });
      }
      return decision;
    }
    const allowed = command.actorId === "local-owner" && command.scopeId === "owner:local";
    if (!allowed) throw Object.assign(new Error("Wave 4 accepts only the local owner until Wave 5 policy is attached."), { code: "POLICY_DENIED" });
    return { allowed: true, reasonCode: "LOCAL_OWNER_BASELINE" };
  }

  function submitCommand(command) {
    ensureRunning();
    const decision = authorize(command);
    return { ...ledger.commitCommand(command), policy: { reasonCode: decision.reasonCode, policyId: decision.policyId || null } };
  }

  function enqueueJob(job) {
    ensureRunning();
    authorize({ ...job, actorId: job.actorId || "local-owner", purpose: job.purpose || "memory_background_work", capability: job.capability || "memory.job.enqueue" });
    return jobs.enqueue(job);
  }

  function pause() { control.setMode("paused"); return { mode: "paused" }; }
  function resume() { control.setMode("running"); return { mode: "running" }; }
  function drain() {
    control.setMode("draining");
    return { mode: "draining", pending: control.pending(), drained: control.pending() === 0 };
  }
  function drainStatus() { return { mode: control.mode(), pending: control.pending(), drained: control.mode() === "draining" && control.pending() === 0 }; }

  function health() {
    return { mode: control.mode(), pending: control.pending(), ledger: ledger.health(), workers: jobs.health() };
  }

  return Object.freeze({ drain, drainStatus, enqueueJob, health, jobs, ledger, pause, resume, submitCommand });
}

module.exports = { createMemorySupervisor };
