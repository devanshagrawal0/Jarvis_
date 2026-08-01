"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

function createTaskRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 7) throw new Error("Task runtime requires schema version 7.");

  function decrypt(id) {
    if (!id) return null;
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) throw new Error("Encrypted task object is unavailable.");
    const bytes = keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json));
    return JSON.parse(bytes.toString("utf8"));
  }

  function context(taskId) {
    const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(String(taskId));
    if (!row) throw new Error("Task is unavailable.");
    return row;
  }

  function event(task, eventType, payload = {}, stepId = null) {
    const allowed = new Set(["task.created", "task.started", "task.blocked", "task.resumed", "task.completed", "task.failed", "step.started", "step.completed", "step.failed", "approval.requested", "approval.decided", "tool.completed", "agent.leased", "agent.completed", "checkpoint.created"]);
    if (!allowed.has(eventType)) throw new Error("Only significant task events may enter the cognitive task stream.");
    const encrypted = insertEncrypted(db, keyring, clock, { objectType: "task-significant-event", scopeId: task.scope_id, sensitivity: "private", payload });
    db.prepare("INSERT INTO task_significant_events(id,task_id,step_id,event_type,payload_encrypted_id,created_at) VALUES(?,?,?,?,?,?)")
      .run(crypto.randomUUID(), task.id, stepId, eventType, encrypted.id, clock().toISOString());
  }

  function validateDag(steps) {
    const keys = new Set(steps.map((step) => String(step.key)));
    if (keys.size !== steps.length || keys.has("")) throw new Error("Task step keys must be non-empty and unique.");
    const edges = new Map(steps.map((step) => [String(step.key), (step.dependsOn || []).map(String)]));
    for (const [key, dependencies] of edges) {
      for (const dependency of dependencies) if (!keys.has(dependency) || dependency === key) throw new Error("Task step dependency is invalid.");
    }
    const visiting = new Set(); const visited = new Set();
    function visit(key) {
      if (visiting.has(key)) throw Object.assign(new Error("Task step graph contains a cycle."), { code: "TASK_DAG_CYCLE" });
      if (visited.has(key)) return;
      visiting.add(key); edges.get(key).forEach(visit); visiting.delete(key); visited.add(key);
    }
    keys.forEach(visit);
  }

  function createTask(input = {}) {
    const steps = Array.isArray(input.steps) ? input.steps : [];
    if (!input.scopeId || !input.objective || !steps.length) throw new Error("Task scope, objective, and at least one step are required.");
    validateDag(steps);
    const id = String(input.id || crypto.randomUUID());
    const existing = db.prepare("SELECT id FROM tasks WHERE id=?").get(id);
    if (existing) return { ...readTask(id), replayed: true };
    const run = db.transaction(() => {
      const now = clock().toISOString();
      const objective = insertEncrypted(db, keyring, clock, { objectType: "task-objective", scopeId: String(input.scopeId), sensitivity: String(input.sensitivity || "private"), payload: { objective: String(input.objective) } });
      db.prepare(`INSERT INTO tasks(id,scope_id,conversation_id,branch_id,parent_task_id,objective_encrypted_id,status,current_step_id,version,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'planned',NULL,1,?,?,?)`).run(id, String(input.scopeId), input.conversationId ? String(input.conversationId) : null,
        input.branchId ? String(input.branchId) : null, input.parentTaskId ? String(input.parentTaskId) : null, objective.id,
        String(input.createdBy || "local-owner"), now, now);
      const stepIds = new Map();
      for (const [stepOrder, step] of steps.entries()) {
        const stepId = String(step.id || crypto.randomUUID()); stepIds.set(String(step.key), stepId);
        const title = insertEncrypted(db, keyring, clock, { objectType: "task-step-title", scopeId: String(input.scopeId), sensitivity: String(input.sensitivity || "private"), payload: { title: String(step.title || step.key) } });
        db.prepare(`INSERT INTO task_steps(id,task_id,stable_key,step_order,title_encrypted_id,status,attempt,max_attempts,requires_approval,result_encrypted_id,created_at,updated_at)
          VALUES(?,?,?,?,?,'pending',0,?,?,NULL,?,?)`).run(stepId, id, String(step.key), stepOrder, title.id, Math.max(1, Number(step.maxAttempts || 1)), step.requiresApproval ? 1 : 0, now, now);
      }
      for (const step of steps) for (const dependency of step.dependsOn || []) {
        db.prepare("INSERT INTO task_step_dependencies(task_id,step_id,depends_on_step_id,created_at) VALUES(?,?,?,?)")
          .run(id, stepIds.get(String(step.key)), stepIds.get(String(dependency)), now);
      }
      db.prepare(`UPDATE task_steps SET status='ready' WHERE task_id=? AND NOT EXISTS
        (SELECT 1 FROM task_step_dependencies d WHERE d.step_id=task_steps.id)`).run(id);
      const task = context(id); event(task, "task.created", { objectiveDeclared: true, stepCount: steps.length });
      faultInjector("task.create.before_commit");
      return { ...readTask(id), replayed: false };
    });
    return run.immediate();
  }

  function refreshReady(taskId, now = clock().toISOString()) {
    db.prepare(`UPDATE task_steps SET status='ready',updated_at=? WHERE task_id=? AND status='pending' AND NOT EXISTS (
      SELECT 1 FROM task_step_dependencies d JOIN task_steps dependency ON dependency.id=d.depends_on_step_id
      WHERE d.step_id=task_steps.id AND dependency.status NOT IN ('completed','skipped'))`).run(now, taskId);
  }

  function readTask(taskId) {
    const task = context(taskId);
    const steps = db.prepare("SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order").all(task.id).map((step) => ({
      id: step.id, key: step.stable_key, title: decrypt(step.title_encrypted_id).title, status: step.status, attempt: step.attempt,
      maxAttempts: step.max_attempts, requiresApproval: Boolean(step.requires_approval), result: decrypt(step.result_encrypted_id),
      dependsOn: db.prepare("SELECT depends_on_step_id AS id FROM task_step_dependencies WHERE step_id=? ORDER BY depends_on_step_id").all(step.id).map((row) => row.id),
    }));
    return { id: task.id, scopeId: task.scope_id, conversationId: task.conversation_id, branchId: task.branch_id, parentTaskId: task.parent_task_id,
      objective: decrypt(task.objective_encrypted_id).objective, status: task.status, currentStepId: task.current_step_id, version: task.version, steps, createdAt: task.created_at, updatedAt: task.updated_at };
  }

  function readySteps(taskId) { refreshReady(String(taskId)); return readTask(taskId).steps.filter((step) => step.status === "ready"); }

  function startStep(taskId, stepId) {
    const run = db.transaction(() => {
      const task = context(taskId); const step = db.prepare("SELECT * FROM task_steps WHERE id=? AND task_id=?").get(String(stepId), task.id);
      if (!step || step.status !== "ready") throw new Error("Task step is not ready.");
      const now = clock().toISOString();
      if (step.requires_approval) {
        const approval = db.prepare("SELECT state FROM task_approvals WHERE task_id=? AND step_id=? ORDER BY created_at DESC LIMIT 1").get(task.id, step.id);
        if (!approval || approval.state !== "approved") throw Object.assign(new Error("Task step requires an approved decision."), { code: "TASK_APPROVAL_REQUIRED" });
      }
      db.prepare("UPDATE task_steps SET status='running',attempt=attempt+1,updated_at=? WHERE id=?").run(now, step.id);
      db.prepare("UPDATE tasks SET status='running',current_step_id=?,version=version+1,updated_at=? WHERE id=?").run(step.id, now, task.id);
      event(task, task.status === "planned" ? "task.started" : "task.resumed", { stepId: step.id }, step.id);
      event(task, "step.started", { attempt: step.attempt + 1 }, step.id);
      faultInjector("task.step.start.before_commit");
      return readTask(task.id);
    });
    return run.immediate();
  }

  function completeStep(taskId, stepId, result = {}) {
    const run = db.transaction(() => {
      const task = context(taskId); const step = db.prepare("SELECT * FROM task_steps WHERE id=? AND task_id=?").get(String(stepId), task.id);
      if (!step || step.status !== "running") throw new Error("Task step is not running.");
      const now = clock().toISOString();
      const encrypted = insertEncrypted(db, keyring, clock, { objectType: "task-step-result", scopeId: task.scope_id, sensitivity: "private", payload: result });
      db.prepare("UPDATE task_steps SET status='completed',result_encrypted_id=?,updated_at=? WHERE id=?").run(encrypted.id, now, step.id);
      event(task, "step.completed", { resultRecorded: true }, step.id);
      refreshReady(task.id, now);
      const remaining = Number(db.prepare("SELECT COUNT(*) AS count FROM task_steps WHERE task_id=? AND status NOT IN ('completed','skipped','cancelled')").get(task.id).count);
      if (remaining === 0) {
        db.prepare("UPDATE tasks SET status='completed',current_step_id=NULL,version=version+1,updated_at=? WHERE id=?").run(now, task.id);
        event(task, "task.completed", { completedSteps: Number(db.prepare("SELECT COUNT(*) AS count FROM task_steps WHERE task_id=? AND status='completed'").get(task.id).count) });
      } else db.prepare("UPDATE tasks SET current_step_id=NULL,version=version+1,updated_at=? WHERE id=?").run(now, task.id);
      faultInjector("task.step.complete.before_commit");
      return readTask(task.id);
    });
    return run.immediate();
  }

  function requestApproval(input = {}) {
    const task = context(input.taskId); const stepId = String(input.stepId); const key = String(input.idempotencyKey || "");
    if (!key) throw new Error("Approval idempotency key is required.");
    const prior = db.prepare("SELECT id,state FROM task_approvals WHERE task_id=? AND idempotency_key=?").get(task.id, key);
    if (prior) return { approvalId: prior.id, state: prior.state, replayed: true };
    const run = db.transaction(() => {
      const now = clock().toISOString(); const id = String(input.id || crypto.randomUUID());
      const request = insertEncrypted(db, keyring, clock, { objectType: "task-approval-request", scopeId: task.scope_id, sensitivity: "private", payload: input.request || {} });
      db.prepare(`INSERT INTO task_approvals(id,task_id,step_id,request_encrypted_id,state,requested_by,decided_by,decision_turn_id,idempotency_key,expires_at,created_at,decided_at)
        VALUES(?,?,?,?,'pending',?,NULL,NULL,?,?,?,NULL)`).run(id, task.id, stepId, request.id, String(input.requestedBy || "local-owner"), key, input.expiresAt ? String(input.expiresAt) : null, now);
      db.prepare("UPDATE task_steps SET status='awaiting_approval',updated_at=? WHERE id=? AND task_id=? AND status IN ('pending','ready')").run(now, stepId, task.id);
      db.prepare("UPDATE tasks SET status='awaiting_approval',version=version+1,updated_at=? WHERE id=?").run(now, task.id);
      event(task, "approval.requested", { approvalId: id }, stepId);
      return { approvalId: id, state: "pending", replayed: false };
    });
    return run.immediate();
  }

  function decideApproval(input = {}) {
    const id = String(input.approvalId); const decision = String(input.decision);
    if (!['approved','denied'].includes(decision)) throw new Error("Approval decision must be approved or denied.");
    const run = db.transaction(() => {
      const row = db.prepare("SELECT a.*,t.scope_id FROM task_approvals a JOIN tasks t ON t.id=a.task_id WHERE a.id=?").get(id);
      if (!row) throw new Error("Approval is unavailable.");
      if (row.state !== "pending") return { approvalId: id, state: row.state, replayed: true };
      const now = clock().toISOString();
      if (row.expires_at && row.expires_at <= now) {
        db.prepare("UPDATE task_approvals SET state='expired',decided_at=? WHERE id=?").run(now, id);
        return { approvalId: id, state: "expired", replayed: false };
      }
      db.prepare("UPDATE task_approvals SET state=?,decided_by=?,decision_turn_id=?,decided_at=? WHERE id=?")
        .run(decision, String(input.decidedBy || "local-owner"), input.decisionTurnId ? String(input.decisionTurnId) : null, now, id);
      db.prepare("UPDATE task_steps SET status=?,updated_at=? WHERE id=? AND status='awaiting_approval'").run(decision === "approved" ? "ready" : "cancelled", now, row.step_id);
      db.prepare("UPDATE tasks SET status=?,version=version+1,updated_at=? WHERE id=?").run(decision === "approved" ? "planned" : "blocked", now, row.task_id);
      event({ id: row.task_id, scope_id: row.scope_id }, "approval.decided", { approvalId: id, decision }, row.step_id);
      return { approvalId: id, state: decision, replayed: false };
    });
    return run.immediate();
  }

  function planTool(input = {}) {
    const task = context(input.taskId); const stepId = String(input.stepId); const idempotencyKey = String(input.idempotencyKey || "");
    if (!idempotencyKey || !input.toolName) throw new Error("Tool name and idempotency key are required.");
    const argumentsHash = keyring.sign(JSON.stringify(input.arguments || {}), "tool-arguments-v1");
    const prior = db.prepare("SELECT * FROM tool_invocations WHERE idempotency_key=?").get(idempotencyKey);
    if (prior) {
      if (prior.arguments_hash !== argumentsHash || prior.task_id !== task.id) throw Object.assign(new Error("Tool idempotency key conflicts with another invocation."), { code: "TOOL_IDEMPOTENCY_CONFLICT" });
      return toolReceipt(prior, true);
    }
    const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    db.prepare(`INSERT INTO tool_invocations(id,task_id,step_id,tool_name,tool_version,arguments_hash,status,approval_id,side_effect_class,idempotency_key,receipt_encrypted_id,result_hash,cost_usd,started_at,ended_at,created_at)
      VALUES(?,?,?,?,?,?,'planned',?,?,?,NULL,NULL,0,NULL,NULL,?)`).run(id, task.id, stepId, String(input.toolName), String(input.toolVersion || "1"), argumentsHash,
      input.approvalId ? String(input.approvalId) : null, String(input.sideEffectClass || "none"), idempotencyKey, now);
    return toolReceipt(db.prepare("SELECT * FROM tool_invocations WHERE id=?").get(id), false);
  }

  function toolReceipt(row, replayed) {
    return { id: row.id, taskId: row.task_id, stepId: row.step_id, toolName: row.tool_name, status: row.status, sideEffectClass: row.side_effect_class,
      receipt: decrypt(row.receipt_encrypted_id), resultHash: row.result_hash, costUsd: row.cost_usd, replayed };
  }

  function startTool(invocationId) {
    const run = db.transaction(() => {
      const row = db.prepare("SELECT * FROM tool_invocations WHERE id=?").get(String(invocationId));
      if (!row) throw new Error("Tool invocation is unavailable.");
      if (row.status === "succeeded") return toolReceipt(row, true);
      if (row.status !== "planned") throw new Error("Tool invocation is not planned.");
      if (['external','irreversible'].includes(row.side_effect_class)) {
        const approval = row.approval_id ? db.prepare("SELECT state,expires_at,task_id,step_id FROM task_approvals WHERE id=?").get(row.approval_id) : null;
        if (approval && (approval.task_id !== row.task_id || approval.step_id !== row.step_id)) throw Object.assign(new Error("Approval belongs to another task operation."), { code: "TOOL_APPROVAL_SCOPE_MISMATCH" });
        if (!approval || approval.state !== "approved" || (approval.expires_at && approval.expires_at <= clock().toISOString())) throw Object.assign(new Error("External side effect requires a live approval."), { code: "TOOL_APPROVAL_REQUIRED" });
      }
      db.prepare("UPDATE tool_invocations SET status='running',started_at=? WHERE id=?").run(clock().toISOString(), row.id);
      return toolReceipt(db.prepare("SELECT * FROM tool_invocations WHERE id=?").get(row.id), false);
    });
    return run.immediate();
  }

  function completeTool(invocationId, receipt = {}, { costUsd = 0 } = {}) {
    const run = db.transaction(() => {
      const row = db.prepare("SELECT ti.*,t.scope_id FROM tool_invocations ti JOIN tasks t ON t.id=ti.task_id WHERE ti.id=?").get(String(invocationId));
      if (!row) throw new Error("Tool invocation is unavailable.");
      if (row.status === "succeeded") return toolReceipt(row, true);
      if (row.status !== "running") throw new Error("Tool invocation is not running.");
      const encrypted = insertEncrypted(db, keyring, clock, { objectType: "tool-side-effect-receipt", scopeId: row.scope_id, sensitivity: "private", payload: receipt });
      const resultHash = keyring.sign(JSON.stringify(receipt), "tool-result-v1"); const now = clock().toISOString();
      db.prepare("UPDATE tool_invocations SET status='succeeded',receipt_encrypted_id=?,result_hash=?,cost_usd=?,ended_at=? WHERE id=?")
        .run(encrypted.id, resultHash, Math.max(0, Number(costUsd)), now, row.id);
      event({ id: row.task_id, scope_id: row.scope_id }, "tool.completed", { invocationId: row.id, sideEffectClass: row.side_effect_class, resultHash }, row.step_id);
      faultInjector("task.tool.complete.before_commit");
      return toolReceipt(db.prepare("SELECT * FROM tool_invocations WHERE id=?").get(row.id), false);
    });
    return run.immediate();
  }

  function addArtifact(input = {}) {
    context(input.taskId);
    db.prepare("INSERT OR IGNORE INTO task_artifacts(task_id,step_id,artifact_ref,role,artifact_version,created_at) VALUES(?,?,?,?,?,?)")
      .run(String(input.taskId), input.stepId ? String(input.stepId) : null, String(input.artifactRef), String(input.role || "active"), String(input.version || "1"), clock().toISOString());
    return { taskId: String(input.taskId), artifactRef: String(input.artifactRef) };
  }

  function leaseAgent(input = {}) {
    const task = context(input.taskId); const actorId = String(input.actorId || "");
    const actor = db.prepare("SELECT status,actor_type FROM actors WHERE id=?").get(actorId);
    if (!actor || actor.status !== "active") throw new Error("Agent actor is unavailable.");
    if (actor.actor_type === "agent" && !input.capabilityGrantId) throw new Error("Agent actors require an explicit capability grant.");
    if (input.capabilityGrantId) {
      const grant = db.prepare("SELECT effect,expires_at,revoked_at,actor_id FROM grants WHERE id=?").get(String(input.capabilityGrantId));
      if (!grant || grant.actor_id !== actorId || grant.effect !== "allow" || grant.revoked_at || grant.expires_at <= clock().toISOString()) throw new Error("Agent capability grant is unavailable.");
    }
    const id = String(input.id || crypto.randomUUID()); const now = clock(); const expires = new Date(now.getTime() + Math.max(1_000, Number(input.leaseMs || 30_000))).toISOString();
    db.prepare(`INSERT INTO agent_sessions(id,task_id,step_id,blueprint,blueprint_version,actor_id,scope_id,capability_grant_id,status,lease_expires_at,checkpoint_encrypted_id,outcome_encrypted_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'leased',?,NULL,NULL,?,?)`).run(id, task.id, input.stepId ? String(input.stepId) : null, String(input.blueprint), String(input.blueprintVersion || "1"), actorId, task.scope_id,
      input.capabilityGrantId ? String(input.capabilityGrantId) : null, expires, now.toISOString(), now.toISOString());
    event(task, "agent.leased", { agentSessionId: id, blueprint: String(input.blueprint), leaseExpiresAt: expires }, input.stepId ? String(input.stepId) : null);
    return { id, status: "leased", leaseExpiresAt: expires };
  }

  function reapExpiredAgents() {
    const now = clock().toISOString();
    const rows = db.prepare("SELECT id FROM agent_sessions WHERE status IN ('leased','running','checkpointed') AND lease_expires_at<=?").all(now);
    for (const row of rows) db.prepare("UPDATE agent_sessions SET status='expired',updated_at=? WHERE id=?").run(now, row.id);
    return rows.map((row) => row.id);
  }

  function checkpoint(taskId) {
    const run = db.transaction(() => {
      const task = context(taskId); const snapshot = readTask(task.id);
      snapshot.tools = db.prepare("SELECT id,status,idempotency_key,result_hash FROM tool_invocations WHERE task_id=? ORDER BY created_at,id").all(task.id);
      snapshot.artifacts = db.prepare("SELECT artifact_ref,artifact_version,role,step_id FROM task_artifacts WHERE task_id=? ORDER BY created_at").all(task.id);
      snapshot.agents = db.prepare("SELECT id,status,step_id,blueprint,lease_expires_at FROM agent_sessions WHERE task_id=? ORDER BY created_at").all(task.id);
      snapshot.approvals = db.prepare("SELECT id,step_id,state,expires_at FROM task_approvals WHERE task_id=? ORDER BY created_at").all(task.id);
      const sequence = Number(db.prepare("SELECT COALESCE(MAX(checkpoint_sequence),0)+1 AS next FROM task_checkpoints WHERE task_id=?").get(task.id).next);
      const token = crypto.randomBytes(32).toString("base64url"); const tokenHash = keyring.sign(`${task.id}:${token}`, "task-resume-token-v1");
      const encrypted = insertEncrypted(db, keyring, clock, { objectType: "task-checkpoint", scopeId: task.scope_id, sensitivity: "private", payload: snapshot }); const now = clock().toISOString();
      db.prepare("UPDATE task_checkpoints SET state='superseded' WHERE task_id=? AND state='active'").run(task.id);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO task_checkpoints(id,task_id,task_version,checkpoint_sequence,snapshot_encrypted_id,resume_token_hash,state,created_at) VALUES(?,?,?,?,?,?,'active',?)")
        .run(id, task.id, task.version, sequence, encrypted.id, tokenHash, now);
      event(task, "checkpoint.created", { checkpointId: id, sequence });
      faultInjector("task.checkpoint.before_commit");
      return { checkpointId: id, taskId: task.id, sequence, resumeToken: token, snapshot };
    });
    return run.immediate();
  }

  function resume(taskId, resumeToken) {
    const task = context(taskId); const hash = keyring.sign(`${task.id}:${String(resumeToken)}`, "task-resume-token-v1");
    const row = db.prepare("SELECT * FROM task_checkpoints WHERE task_id=? AND resume_token_hash=? AND state='active'").get(task.id, hash);
    if (!row) throw Object.assign(new Error("Resume token is invalid or superseded."), { code: "TASK_RESUME_TOKEN_INVALID" });
    const snapshot = decrypt(row.snapshot_encrypted_id);
    const completedSideEffects = db.prepare("SELECT id,idempotency_key,result_hash FROM tool_invocations WHERE task_id=? AND status='succeeded' ORDER BY created_at,id").all(task.id);
    return { checkpointId: row.id, task: readTask(task.id), snapshot, completedSideEffects, incompleteSteps: readTask(task.id).steps.filter((step) => !['completed','skipped','cancelled'].includes(step.status)) };
  }

  return Object.freeze({ addArtifact, checkpoint, completeStep, completeTool, createTask, decideApproval, leaseAgent, planTool, readTask, readySteps, reapExpiredAgents, requestApproval, resume, startStep, startTool });
}

module.exports = { createTaskRepository };
