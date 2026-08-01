"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { id, now, asJson } = require("./contracts");

class ActionStore {
  constructor(options = {}) {
    const runtimeDir = path.resolve(options.runtimeDir || path.join(process.cwd(), "runtime"));
    fs.mkdirSync(runtimeDir, { recursive: true });
    this.file = options.file === ":memory:" ? ":memory:" : path.resolve(options.file || path.join(runtimeDir, "action-fabric.sqlite"));
    this.db = new Database(this.file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS action_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS action_tasks(
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, parent_task_id TEXT, title TEXT NOT NULL,
        prompt TEXT NOT NULL, outcome_json TEXT NOT NULL, placement TEXT NOT NULL, effort TEXT NOT NULL,
        state TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, current_step TEXT, metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS action_events(
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, task_id TEXT, type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_action_events_task_seq ON action_events(task_id, seq);
      CREATE TABLE IF NOT EXISTS effect_receipts(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_id TEXT, status TEXT NOT NULL, driver TEXT,
        target_json TEXT NOT NULL, proof_json TEXT NOT NULL, error_json TEXT, idempotency_key TEXT,
        created_at TEXT NOT NULL, UNIQUE(idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS action_approvals(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, consequence INTEGER NOT NULL, summary TEXT NOT NULL,
        state TEXT NOT NULL, token TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, decided_at TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_artifact_refs(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, uri TEXT NOT NULL,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_surfaces(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, process_id INTEGER, window_handle TEXT,
        account_hint TEXT, state TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 1, capabilities_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_observations(
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, surface_id TEXT NOT NULL, epoch INTEGER NOT NULL,
        source TEXT NOT NULL, confidence REAL NOT NULL, sensitivity TEXT NOT NULL, payload_json TEXT NOT NULL,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_observation_surface_seq ON action_observations(surface_id, seq);
      CREATE TABLE IF NOT EXISTS action_automations(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, task_template_json TEXT NOT NULL, schedule_json TEXT NOT NULL,
        enabled INTEGER NOT NULL, next_run_at TEXT, last_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_occurrences(
        id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, occurrence_key TEXT NOT NULL UNIQUE, task_id TEXT,
        state TEXT NOT NULL, scheduled_for TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_procedures(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL, fingerprint TEXT NOT NULL,
        graph_json TEXT NOT NULL, qualification_json TEXT NOT NULL, state TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(name, version)
      );
      CREATE TABLE IF NOT EXISTS action_metrics(
        seq INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, value REAL NOT NULL, dimensions_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_commands(
        request_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_effect_intents(
        idempotency_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, step_id TEXT NOT NULL, driver TEXT NOT NULL,
        state TEXT NOT NULL, effect_json TEXT, error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO action_schema_migrations(version, applied_at) VALUES(1, datetime('now'));
    `);
  }

  transaction(fn) { return this.db.transaction(fn)(); }

  command(requestId, create) {
    const existing = this.db.prepare("SELECT result_json FROM action_commands WHERE request_id=?").get(requestId);
    if (existing) return { ...asJson(existing.result_json), replayed: true };
    return this.transaction(() => {
      const result = create();
      this.db.prepare("INSERT INTO action_commands(request_id,result_json,created_at) VALUES(?,?,?)")
        .run(requestId, JSON.stringify(result), now());
      return result;
    });
  }

  createTask(task) {
    const stamp = now();
    this.db.prepare(`INSERT INTO action_tasks
      (id,request_id,parent_task_id,title,prompt,outcome_json,placement,effort,state,revision,current_step,metadata_json,created_at,updated_at)
      VALUES(@id,@requestId,@parentTaskId,@title,@prompt,@outcome,@placement,@effort,'queued',1,NULL,@metadata,@createdAt,@updatedAt)`)
      .run({ ...task, outcome: JSON.stringify(task.outcome), metadata: JSON.stringify(task.metadata || {}), createdAt: stamp, updatedAt: stamp });
    return this.getTask(task.id);
  }

  rowTask(row) {
    if (!row) return null;
    return { id: row.id, requestId: row.request_id, parentTaskId: row.parent_task_id, title: row.title, prompt: row.prompt,
      outcome: asJson(row.outcome_json), placement: row.placement, effort: row.effort, state: row.state,
      revision: row.revision, currentStep: row.current_step, metadata: asJson(row.metadata_json),
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at };
  }

  getTask(taskId) { return this.rowTask(this.db.prepare("SELECT * FROM action_tasks WHERE id=?").get(taskId)); }
  getTaskByRequest(requestId) { return this.rowTask(this.db.prepare("SELECT * FROM action_tasks WHERE request_id=?").get(requestId)); }
  listTasks(options = {}) {
    const limit = Math.min(250, Math.max(1, Number(options.limit) || 50));
    const states = Array.isArray(options.states) ? options.states.filter(Boolean) : [];
    if (!states.length) return this.db.prepare("SELECT * FROM action_tasks ORDER BY updated_at DESC LIMIT ?").all(limit).map((r) => this.rowTask(r));
    const marks = states.map(() => "?").join(",");
    return this.db.prepare(`SELECT * FROM action_tasks WHERE state IN (${marks}) ORDER BY updated_at DESC LIMIT ?`).all(...states, limit).map((r) => this.rowTask(r));
  }

  updateTask(taskId, patch, expectedRevision) {
    const current = this.getTask(taskId);
    if (!current) throw new Error("Task not found.");
    if (expectedRevision != null && current.revision !== Number(expectedRevision)) throw Object.assign(new Error("Task revision conflict."), { code: "REVISION_CONFLICT" });
    const next = { ...current, ...patch, outcome: patch.outcome || current.outcome, metadata: patch.metadata || current.metadata };
    const terminal = ["delivered", "partial", "blocked", "failed", "cancelled"].includes(next.state);
    this.db.prepare(`UPDATE action_tasks SET title=?,prompt=?,outcome_json=?,placement=?,effort=?,state=?,revision=revision+1,
      current_step=?,metadata_json=?,updated_at=?,completed_at=? WHERE id=?`).run(
      next.title, next.prompt, JSON.stringify(next.outcome), next.placement, next.effort, next.state,
      next.currentStep || null, JSON.stringify(next.metadata || {}), now(), terminal ? now() : null, taskId);
    return this.getTask(taskId);
  }

  appendEvent(type, payload = {}, taskId = null) {
    const event = { id: id("evt"), taskId, type, payload, createdAt: now() };
    const result = this.db.prepare("INSERT INTO action_events(id,task_id,type,payload_json,created_at) VALUES(?,?,?,?,?)")
      .run(event.id, taskId, type, JSON.stringify(payload), event.createdAt);
    return { ...event, seq: Number(result.lastInsertRowid) };
  }
  events(after = 0, limit = 250, taskId = null) {
    const rows = taskId
      ? this.db.prepare("SELECT * FROM action_events WHERE seq>? AND task_id=? ORDER BY seq LIMIT ?").all(Number(after)||0, taskId, Math.min(1000, Number(limit)||250))
      : this.db.prepare("SELECT * FROM action_events WHERE seq>? ORDER BY seq LIMIT ?").all(Number(after)||0, Math.min(1000, Number(limit)||250));
    return rows.map((r) => ({ seq:r.seq,id:r.id,taskId:r.task_id,type:r.type,payload:asJson(r.payload_json),createdAt:r.created_at }));
  }

  addReceipt(input) {
    if (input.idempotencyKey) {
      const existing = this.db.prepare("SELECT * FROM effect_receipts WHERE idempotency_key=?").get(input.idempotencyKey);
      if (existing) {
        if (input.status === "verified" && existing.status !== "verified") {
          this.db.prepare("UPDATE effect_receipts SET status='verified',driver=?,target_json=?,proof_json=?,error_json=NULL WHERE id=?")
            .run(input.driver||existing.driver,JSON.stringify(input.target||{}),JSON.stringify(input.proof||{}),existing.id);
          return this.rowReceipt(this.db.prepare("SELECT * FROM effect_receipts WHERE id=?").get(existing.id));
        }
        return this.rowReceipt(existing);
      }
    }
    const receipt = { id: input.id || id("receipt"), createdAt: now(), ...input };
    this.db.prepare(`INSERT INTO effect_receipts(id,task_id,step_id,status,driver,target_json,proof_json,error_json,idempotency_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(receipt.id,receipt.taskId,receipt.stepId||null,receipt.status,receipt.driver||null,
      JSON.stringify(receipt.target||{}),JSON.stringify(receipt.proof||{}),receipt.error?JSON.stringify(receipt.error):null,receipt.idempotencyKey||null,receipt.createdAt);
    return receipt;
  }
  rowReceipt(r) { return r && { id:r.id,taskId:r.task_id,stepId:r.step_id,status:r.status,driver:r.driver,target:asJson(r.target_json),proof:asJson(r.proof_json),error:r.error_json?asJson(r.error_json):null,idempotencyKey:r.idempotency_key,createdAt:r.created_at }; }
  receipts(taskId) { return this.db.prepare("SELECT * FROM effect_receipts WHERE task_id=? ORDER BY created_at").all(taskId).map((r)=>this.rowReceipt(r)); }

  addApproval(input) {
    const approval = { id:id("approval"),token:id("approve"),state:"pending",createdAt:now(),...input };
    this.db.prepare(`INSERT INTO action_approvals(id,task_id,consequence,summary,state,token,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .run(approval.id,approval.taskId,approval.consequence,approval.summary,approval.state,approval.token,approval.expiresAt,approval.createdAt);
    return approval;
  }
  decideApproval(idValue, decision, token) {
    const row = this.db.prepare("SELECT * FROM action_approvals WHERE id=?").get(idValue);
    if (!row) throw new Error("Approval not found.");
    if (row.token !== token) throw new Error("Approval token mismatch.");
    if (row.state !== "pending") throw new Error("Approval already decided.");
    if (Date.parse(row.expires_at) <= Date.now()) { this.db.prepare("UPDATE action_approvals SET state='expired',decided_at=? WHERE id=?").run(now(),idValue); throw new Error("Approval expired."); }
    const state = decision === "approved" ? "approved" : "rejected";
    this.db.prepare("UPDATE action_approvals SET state=?,decided_at=? WHERE id=?").run(state,now(),idValue);
    return { id:row.id,taskId:row.task_id,state,consequence:row.consequence,summary:row.summary,decidedAt:now() };
  }
  pendingApprovals(taskId) { return this.db.prepare("SELECT id,task_id AS taskId,consequence,summary,state,token,expires_at AS expiresAt,created_at AS createdAt FROM action_approvals WHERE task_id=? AND state='pending'").all(taskId); }

  addArtifact(input) {
    const item={id:id("artifact"),createdAt:now(),metadata:{},...input};
    this.db.prepare("INSERT INTO action_artifact_refs(id,task_id,kind,label,uri,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(item.id,item.taskId,item.kind,item.label,item.uri,JSON.stringify(item.metadata),item.createdAt); return item;
  }
  getArtifact(idValue){const r=this.db.prepare("SELECT * FROM action_artifact_refs WHERE id=?").get(idValue);return r&&{id:r.id,taskId:r.task_id,kind:r.kind,label:r.label,uri:r.uri,metadata:asJson(r.metadata_json),createdAt:r.created_at};}
  artifacts(taskId){return this.db.prepare("SELECT * FROM action_artifact_refs WHERE task_id=? ORDER BY created_at").all(taskId).map(r=>({id:r.id,taskId:r.task_id,kind:r.kind,label:r.label,uri:r.uri,metadata:asJson(r.metadata_json),createdAt:r.created_at}));}

  beginEffect(input){const stamp=now();this.db.prepare("INSERT OR IGNORE INTO action_effect_intents(idempotency_key,task_id,step_id,driver,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(input.idempotencyKey,input.taskId,input.stepId,input.driver,"prepared",stamp,stamp);return this.effectIntent(input.idempotencyKey);}
  effectIntent(key){const r=this.db.prepare("SELECT * FROM action_effect_intents WHERE idempotency_key=?").get(key);return r&&{idempotencyKey:r.idempotency_key,taskId:r.task_id,stepId:r.step_id,driver:r.driver,state:r.state,effect:r.effect_json?asJson(r.effect_json):null,error:r.error_json?asJson(r.error_json):null,createdAt:r.created_at,updatedAt:r.updated_at};}
  updateEffect(key,state,effect=null,error=null){this.db.prepare("UPDATE action_effect_intents SET state=?,effect_json=?,error_json=?,updated_at=? WHERE idempotency_key=?").run(state,effect?JSON.stringify(effect):null,error?JSON.stringify(error):null,now(),key);return this.effectIntent(key);}

  upsertSurface(surface) {
    const stamp=now(); const old=this.db.prepare("SELECT * FROM action_surfaces WHERE id=?").get(surface.id);
    const epoch=surface.epoch || old?.epoch || 1;
    this.db.prepare(`INSERT INTO action_surfaces(id,kind,label,process_id,window_handle,account_hint,state,epoch,capabilities_json,metadata_json,last_seen_at,created_at)
      VALUES(@id,@kind,@label,@processId,@windowHandle,@accountHint,@state,@epoch,@capabilities,@metadata,@lastSeenAt,@createdAt)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,label=excluded.label,process_id=excluded.process_id,window_handle=excluded.window_handle,
      account_hint=excluded.account_hint,state=excluded.state,epoch=excluded.epoch,capabilities_json=excluded.capabilities_json,metadata_json=excluded.metadata_json,last_seen_at=excluded.last_seen_at`)
      .run({id:surface.id,kind:surface.kind,label:surface.label,processId:surface.processId||null,windowHandle:surface.windowHandle||null,accountHint:surface.accountHint||null,state:surface.state||"connected",epoch,capabilities:JSON.stringify(surface.capabilities||[]),metadata:JSON.stringify(surface.metadata||{}),lastSeenAt:stamp,createdAt:old?.created_at||stamp});
    return this.getSurface(surface.id);
  }
  rowSurface(r){return r&&{id:r.id,kind:r.kind,label:r.label,processId:r.process_id,windowHandle:r.window_handle,accountHint:r.account_hint,state:r.state,epoch:r.epoch,capabilities:asJson(r.capabilities_json,[]),metadata:asJson(r.metadata_json),lastSeenAt:r.last_seen_at,createdAt:r.created_at};}
  getSurface(surfaceId){return this.rowSurface(this.db.prepare("SELECT * FROM action_surfaces WHERE id=?").get(surfaceId));}
  surfaces(){return this.db.prepare("SELECT * FROM action_surfaces ORDER BY last_seen_at DESC").all().map(r=>this.rowSurface(r));}
  addObservation(input){const item={id:id("obs"),createdAt:now(),...input}; const out=this.db.prepare("INSERT INTO action_observations(id,surface_id,epoch,source,confidence,sensitivity,payload_json,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(item.id,item.surfaceId,item.epoch,item.source,item.confidence,item.sensitivity||"normal",JSON.stringify(item.payload||{}),item.expiresAt,item.createdAt); return {...item,seq:Number(out.lastInsertRowid)};}
  observations(surfaceId,after=0){return this.db.prepare("SELECT * FROM action_observations WHERE surface_id=? AND seq>? ORDER BY seq DESC LIMIT 100").all(surfaceId,Number(after)||0).map(r=>({seq:r.seq,id:r.id,surfaceId:r.surface_id,epoch:r.epoch,source:r.source,confidence:r.confidence,sensitivity:r.sensitivity,payload:asJson(r.payload_json),expiresAt:r.expires_at,createdAt:r.created_at}));}

  createAutomation(input){const item={id:id("auto"),enabled:true,createdAt:now(),updatedAt:now(),...input};this.db.prepare("INSERT INTO action_automations(id,name,task_template_json,schedule_json,enabled,next_run_at,last_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(item.id,item.name,JSON.stringify(item.taskTemplate),JSON.stringify(item.schedule),item.enabled?1:0,item.nextRunAt||null,null,item.createdAt,item.updatedAt);return item;}
  automations(){return this.db.prepare("SELECT * FROM action_automations ORDER BY created_at DESC").all().map(r=>({id:r.id,name:r.name,taskTemplate:asJson(r.task_template_json),schedule:asJson(r.schedule_json),enabled:Boolean(r.enabled),nextRunAt:r.next_run_at,lastRunAt:r.last_run_at,createdAt:r.created_at,updatedAt:r.updated_at}));}
  updateAutomation(idValue,patch){const current=this.automations().find(x=>x.id===idValue);if(!current)throw new Error("Automation not found.");const next={...current,...patch};this.db.prepare("UPDATE action_automations SET name=?,task_template_json=?,schedule_json=?,enabled=?,next_run_at=?,last_run_at=?,updated_at=? WHERE id=?").run(next.name,JSON.stringify(next.taskTemplate),JSON.stringify(next.schedule),next.enabled?1:0,next.nextRunAt||null,next.lastRunAt||null,now(),idValue);return this.automations().find(x=>x.id===idValue);}
  claimOccurrence(automationId,scheduledFor){const key=`${automationId}:${scheduledFor}`;try{const item={id:id("occurrence"),automationId,occurrenceKey:key,state:"claimed",scheduledFor,createdAt:now()};this.db.prepare("INSERT INTO action_occurrences(id,automation_id,occurrence_key,state,scheduled_for,created_at) VALUES(?,?,?,?,?,?)").run(item.id,automationId,key,item.state,scheduledFor,item.createdAt);return item;}catch(e){if(String(e.code).includes("CONSTRAINT"))return null;throw e;}}
  completeOccurrence(idValue,taskId,state="created"){this.db.prepare("UPDATE action_occurrences SET task_id=?,state=? WHERE id=?").run(taskId,state,idValue);}

  saveProcedure(input){const stamp=now();const item={id:id("procedure"),version:1,state:"draft",qualification:{},...input,createdAt:stamp,updatedAt:stamp};this.db.prepare("INSERT INTO action_procedures(id,name,version,fingerprint,graph_json,qualification_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(item.id,item.name,item.version,item.fingerprint,JSON.stringify(item.graph),JSON.stringify(item.qualification),item.state,item.createdAt,item.updatedAt);return item;}
  procedures(){return this.db.prepare("SELECT * FROM action_procedures ORDER BY updated_at DESC").all().map(r=>({id:r.id,name:r.name,version:r.version,fingerprint:r.fingerprint,graph:asJson(r.graph_json),qualification:asJson(r.qualification_json),state:r.state,createdAt:r.created_at,updatedAt:r.updated_at}));}
  qualifyProcedure(idValue,qualification){this.db.prepare("UPDATE action_procedures SET qualification_json=?,state=?,updated_at=? WHERE id=?").run(JSON.stringify(qualification),qualification.passed?"qualified":"rejected",now(),idValue);return this.procedures().find(p=>p.id===idValue);}
  metric(name,value,dimensions={}){this.db.prepare("INSERT INTO action_metrics(name,value,dimensions_json,created_at) VALUES(?,?,?,?)").run(name,Number(value)||0,JSON.stringify(dimensions),now());}
  metrics(name,limit=100){return this.db.prepare("SELECT * FROM action_metrics WHERE (? IS NULL OR name=?) ORDER BY seq DESC LIMIT ?").all(name||null,name||null,limit).map(r=>({seq:r.seq,name:r.name,value:r.value,dimensions:asJson(r.dimensions_json),createdAt:r.created_at}));}
  close(){this.db.close();}
}

module.exports = { ActionStore };
