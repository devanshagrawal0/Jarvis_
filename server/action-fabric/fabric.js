"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { ActionStore } = require("./store");
const {
  CONSEQUENCE, TERMINAL_STATES, id, now, cleanText, consequence,
  normalizeTaskInput, assertTransition, serializeError,
} = require("./contracts");

function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

class EmergencyStop extends EventEmitter {
  constructor(store) { super(); this.store = store; this.stopped = false; this.reason = null; this.at = null; }
  engage(reason = "Owner emergency stop") {
    this.stopped = true; this.reason = cleanText(reason, 500); this.at = now();
    const event = this.store.appendEvent("fabric.stop.engaged", { reason:this.reason, at:this.at });
    this.emit("stop", event); return this.status();
  }
  release(reason = "Owner resumed Action Fabric") {
    this.stopped = false; const previous = this.reason; this.reason = null; this.at = null;
    this.store.appendEvent("fabric.stop.released", { reason:cleanText(reason,500), previous });
    this.emit("release"); return this.status();
  }
  assertOpen() { if (this.stopped) throw Object.assign(new Error(`Action Fabric stopped: ${this.reason}`), { code:"EMERGENCY_STOP" }); }
  status() { return { stopped:this.stopped, reason:this.reason, at:this.at }; }
}

class TaskKernel extends EventEmitter {
  constructor(store, stop, options = {}) { super(); this.store=store; this.stop=stop; this.memoryPublisher=options.memoryPublisher || null; }
  event(type,payload,taskId=null){const event=this.store.appendEvent(type,payload,taskId);this.emit("event",event);return event;}
  create(input={}) {
    const normalized=normalizeTaskInput(input);
    const existing=this.store.getTaskByRequest(normalized.requestId); if(existing)return {...existing,replayed:true};
    const task=this.store.command(normalized.requestId,()=>this.store.createTask(normalized));
    this.event("task.created",{title:task.title,outcome:task.outcome,placement:task.placement,effort:task.effort},task.id);
    return task;
  }
  get(idValue){const task=this.store.getTask(idValue);if(!task)throw Object.assign(new Error("Task not found."),{code:"NOT_FOUND"});return task;}
  list(options){return this.store.listTasks(options);}
  transition(taskId,state,payload={},expectedRevision){const current=this.get(taskId);assertTransition(current.state,state);if(state==="verified"&&!this.store.receipts(taskId).some(r=>r.status==="verified"))throw new Error("A task cannot become verified without a verified effect receipt.");const task=this.store.updateTask(taskId,{state,currentStep:payload.currentStep??current.currentStep,metadata:{...current.metadata,...(payload.metadata||{})}},expectedRevision);this.event(`task.${state}`,payload,taskId);if(["verified","delivered","partial","blocked","failed"].includes(state))void this.publishMemory(task,state);return task;}
  amend(taskId,patch={}){const current=this.get(taskId);const outcome=patch.outcome?{...current.outcome,...patch.outcome}:current.outcome;const updated=this.store.updateTask(taskId,{title:cleanText(patch.title,240)||current.title,prompt:cleanText(patch.prompt,20000)||current.prompt,outcome,placement:patch.placement||current.placement,effort:patch.effort||current.effort,metadata:{...current.metadata,...(patch.metadata||{})}},patch.expectedRevision);this.event("task.amended",{patch:Object.keys(patch)},taskId);return updated;}
  pause(taskId,reason="Owner paused task"){const t=this.get(taskId);if(TERMINAL_STATES.has(t.state))throw new Error("Terminal task cannot be paused.");return this.transition(taskId,"paused",{reason});}
  resume(taskId){const t=this.get(taskId);if(!["paused","waiting_owner","waiting_approval","blocked"].includes(t.state))throw new Error("Task is not resumable.");return this.transition(taskId,"ready",{reason:"Resume requested"});}
  cancel(taskId,reason="Owner cancelled task"){const t=this.get(taskId);if(TERMINAL_STATES.has(t.state))return t;return this.transition(taskId,"cancelled",{reason});}
  retry(taskId){const t=this.get(taskId);if(!["failed","blocked","partial"].includes(t.state))throw new Error("Only failed, blocked, or partial tasks can retry.");return this.transition(taskId,"recovering",{reason:"Retry requested"});}
  takeover(taskId){const t=this.get(taskId);if(TERMINAL_STATES.has(t.state))throw new Error("Terminal task cannot be taken over.");return this.transition(taskId,"waiting_owner",{control:"owner",freshObservationRequired:true});}
  giveBack(taskId){const t=this.get(taskId);if(t.state!=="waiting_owner")throw new Error("Task is not under owner control.");return this.transition(taskId,"ready",{control:"jarvis",freshObservationRequired:true});}
  deliver(taskId,details={}){const t=this.get(taskId);if(t.state!=="verified")throw new Error("Only a verified task can be delivered.");return this.transition(taskId,"delivered",{placement:details.placement||t.placement,proof:details.proof||null});}
  requestApproval(taskId,input={}){const approval=this.store.addApproval({taskId,consequence:consequence(input.consequence),summary:cleanText(input.summary,2000)||"Approve consequential action",expiresAt:input.expiresAt||new Date(Date.now()+10*60_000).toISOString()});const task=this.get(taskId);if(task.state!=="waiting_approval")this.transition(taskId,"waiting_approval",{approvalId:approval.id});this.event("approval.requested",{approvalId:approval.id,summary:approval.summary,expiresAt:approval.expiresAt},taskId);return approval;}
  decideApproval(idValue,decision,token){const result=this.store.decideApproval(idValue,decision,token);this.event(`approval.${result.state}`,{approvalId:idValue},result.taskId);const t=this.get(result.taskId);if(result.state==="approved"&&t.state==="waiting_approval")this.transition(t.id,"ready",{approvalId:idValue});if(result.state==="rejected"&&!TERMINAL_STATES.has(t.state))this.transition(t.id,"blocked",{reason:"Owner rejected approval",approvalId:idValue});return result;}
  async publishMemory(task,state){if(!this.memoryPublisher)return;try{await this.memoryPublisher({type:"action.task.outcome",taskId:task.id,state,title:task.title,outcome:task.outcome,at:now()});this.event("memory.outbox.published",{state},task.id);}catch(error){this.event("memory.outbox.deferred",{state,error:serializeError(error)},task.id);}}
}

class SurfaceRegistry extends EventEmitter {
  constructor(store, options={}){super();this.store=store;this.windowsBroker=options.windowsBroker||null;this.ttlMs=options.ttlMs||15_000;}
  register(input={}){if(!input.kind)throw new Error("Surface kind is required.");const surface=this.store.upsertSurface({id:cleanText(input.id,200)||id("surface"),kind:cleanText(input.kind,50),label:cleanText(input.label,300)||input.kind,processId:Number(input.processId)||null,windowHandle:cleanText(input.windowHandle,100)||null,accountHint:cleanText(input.accountHint,300)||null,state:input.state||"connected",epoch:Number(input.epoch)||1,capabilities:input.capabilities||[],metadata:input.metadata||{}});this.emit("surface",surface);return surface;}
  get(surfaceId){const s=this.store.getSurface(surfaceId);if(!s)throw new Error("Surface not found.");return s;}
  list(){return this.store.surfaces();}
  disconnect(surfaceId,reason="Disconnected"){const s=this.get(surfaceId);return this.store.upsertSurface({...s,state:"disconnected",epoch:s.epoch+1,metadata:{...s.metadata,reason}});}
  connect(surfaceId){const s=this.get(surfaceId);return this.store.upsertSurface({...s,state:"connected",epoch:s.epoch+1});}
  navigate(surfaceId,metadata={}){const s=this.get(surfaceId);return this.store.upsertSurface({...s,epoch:s.epoch+1,metadata:{...s.metadata,...metadata}});}
  observe(surfaceId,input={}){const surface=this.get(surfaceId);if(surface.state!=="connected")throw new Error("Cannot observe disconnected surface.");const ttl=Math.max(100,Number(input.ttlMs)||this.ttlMs);const source=cleanText(input.source,40)||"unknown";const untrusted=["dom","ocr","vision","accessibility","email","web","pdf","clipboard"].includes(source);const serialized=JSON.stringify(input.payload||{}).slice(0,100000);const suspicious=untrusted&&/ignore (?:all |the )?(?:previous|prior|system)|reveal (?:the )?(?:secret|token|password)|you are now|execute (?:this )?command/i.test(serialized);const payload={...(input.payload||{}),_security:{trust:untrusted?"untrusted-observation":"local-system",suspiciousInstructions:suspicious,authorityExpansionAllowed:false}};const observation=this.store.addObservation({surfaceId,epoch:surface.epoch,source,confidence:Math.max(0,Math.min(1,Number(input.confidence) || 0)),sensitivity:input.sensitivity||"normal",payload,expiresAt:new Date(Date.now()+ttl).toISOString()});this.emit("observation",observation);return observation;}
  current(surfaceId){const surface=this.get(surfaceId);return this.store.observations(surfaceId).filter(o=>o.epoch===surface.epoch&&Date.parse(o.expiresAt)>Date.now());}
  assertTarget(target){if(!target?.surfaceId)throw new Error("Target must be bound to a surface.");const surface=this.get(target.surfaceId);if(surface.state!=="connected")throw new Error("Target surface is disconnected.");if(Number(target.epoch)!==surface.epoch)throw Object.assign(new Error("Target is stale after a surface epoch change."),{code:"STALE_TARGET"});return surface;}
  async reconcileWindows(){if(!this.windowsBroker)return[];const result=await this.windowsBroker.call("list_windows",{});const windows=Array.isArray(result)?result:(result?.windows||[]);return windows.map(w=>this.register({id:`win:${w.processId||w.pid}:${w.handle||w.hwnd}`,kind:"window",label:w.title||w.name||"Window",processId:w.processId||w.pid,windowHandle:String(w.handle||w.hwnd||""),capabilities:["uia","focus"],metadata:{raw:w}}));}
}

class TargetResolver {
  constructor(registry){this.registry=registry;}
  score(candidate,query={}){let value=0;const reasons=[];const q=String(query.name||query.text||"").toLowerCase();const name=String(candidate.name||candidate.label||"").toLowerCase();if(q&&name===q){value+=0.42;reasons.push("exact-name");}else if(q&&name.includes(q)){value+=0.28;reasons.push("partial-name");}if(query.role&&candidate.role===query.role){value+=0.18;reasons.push("role");}if(query.accountHint&&candidate.accountHint===query.accountHint){value+=0.18;reasons.push("account");}if(candidate.actionable!==false){value+=0.08;reasons.push("actionable");}if(candidate.visible!==false){value+=0.05;reasons.push("visible");}if(candidate.fresh!==false){value+=0.05;reasons.push("fresh");}if((candidate.sources||[]).length>1){value+=0.04;reasons.push("source-agreement");}return {candidate,confidence:Math.min(1,value),reasons};}
  resolve(input={}){const surface=this.registry.get(input.surfaceId);const scored=(input.candidates||[]).map(c=>this.score({...c,accountHint:c.accountHint||surface.accountHint},input.query)).sort((a,b)=>b.confidence-a.confidence);if(!scored.length)return {status:"not_found",confidence:0,candidates:[],reason:"No candidates"};const threshold=consequence(input.consequence)>=CONSEQUENCE.EXTERNAL?0.86:consequence(input.consequence)>=CONSEQUENCE.REVERSIBLE?0.72:0.55;const nearTie=scored[1]&&scored[0].confidence-scored[1].confidence<0.08;if(scored[0].confidence<threshold||nearTie)return {status:"ambiguous",confidence:scored[0].confidence,threshold,candidates:scored.slice(0,5),reason:nearTie?"Near-tied candidates":"Confidence below threshold"};const target={...scored[0].candidate,surfaceId:surface.id,epoch:surface.epoch,targetId:scored[0].candidate.targetId||id("target"),resolvedAt:now(),confidence:scored[0].confidence};return {status:"resolved",target,confidence:scored[0].confidence,threshold,candidates:scored.slice(0,3)};}
}

class BrowserPlaneManager {
  constructor(registry, browserService = null) { this.registry=registry; this.browserService=browserService; this.liveBridges=new Map(); }
  capabilities(){return {managed:{available:Boolean(this.browserService),persistentProfile:true,authenticatedHandoff:true},background:{available:Boolean(this.browserService),nonInterference:true,semanticOnly:true},live:{available:this.liveBridges.size>0,explicitOwnerApproval:true,approvedConnections:this.liveBridges.size}};}
  async syncManaged(plane="managed"){if(!this.browserService)throw new Error("Managed browser service is unavailable.");const status=await this.browserService.status();const surface=this.registry.register({id:`browser:${plane}:primary`,kind:"browser-tab",label:status.title||`${plane} browser`,state:"connected",accountHint:status.accountHint||null,capabilities:["dom","accessibility","screenshot","tabs","download"],metadata:{plane,url:status.url||null,pageId:status.pageId||null,authenticated:Boolean(status.authenticated)}});return {surface,status};}
  connectLive(input={}){if(input.ownerApproved!==true)throw new Error("A live daily-driver bridge requires explicit owner approval.");const bridgeId=cleanText(input.bridgeId,128)||id("bridge");const secret=crypto.randomBytes(24).toString("base64url");const bridge={id:bridgeId,browser:cleanText(input.browser,50)||"chrome",profileLabel:cleanText(input.profileLabel,200)||"Owner profile",state:"connected",secretHash:hash(secret),connectedAt:now(),lastSeenAt:now()};this.liveBridges.set(bridgeId,bridge);const surface=this.registry.register({id:`browser:live:${bridgeId}`,kind:"browser-live",label:`${bridge.browser} · ${bridge.profileLabel}`,state:"connected",accountHint:input.accountHint||null,capabilities:["owner-tab","dom","accessibility","physical-reveal"],metadata:{plane:"live",bridgeId,ownerApproved:true}});return {bridge:{...bridge,secretHash:undefined},surface,enrollmentSecret:secret};}
  disconnectLive(bridgeId){const bridge=this.liveBridges.get(bridgeId);if(!bridge)return false;this.liveBridges.delete(bridgeId);const surface=this.registry.list().find(s=>s.metadata?.bridgeId===bridgeId);if(surface)this.registry.disconnect(surface.id,"Live bridge disconnected");return true;}
  async navigate(input={}){if(!this.browserService)throw new Error("Browser service unavailable.");const result=await this.browserService.navigate({url:input.url});const current=this.registry.get(input.surfaceId);this.registry.navigate(current.id,{url:result.url||input.url,title:result.title||null});return result;}
  async snapshot(input={}){if(!this.browserService)throw new Error("Browser service unavailable.");const result=await this.browserService.snapshot(input.options||{});const surface=this.registry.get(input.surfaceId);this.registry.observe(surface.id,{source:"dom",confidence:1,payload:{pageId:result.pageId,url:result.url,title:result.title,elements:result.elements||[]},ttlMs:10_000,sensitivity:input.sensitivity||"private"});return result;}
  async loginHandoff(input={}){if(!this.browserService)throw new Error("Browser service unavailable.");return this.browserService.loginHandoff(input);}
}

class DriverArbiter {
  constructor(){this.drivers=new Map();}
  register(driver){if(!driver?.name||typeof driver.act!=="function")throw new Error("Driver requires name and act().");this.drivers.set(driver.name,driver);return driver;}
  available(driver){return typeof driver.available==="function"?driver.available():driver.available!==false;}
  list(){return [...this.drivers.values()].map(d=>({name:d.name,kind:d.kind||d.name,capabilities:d.capabilities||[],priority:d.priority??50,available:this.available(d)}));}
  choose(step={}){const requested=step.driver;const candidates=[...this.drivers.values()].filter(d=>this.available(d)&&(!requested||d.name===requested)&&(!step.capability||(d.capabilities||[]).includes(step.capability))).sort((a,b)=>(a.priority??50)-(b.priority??50));if(!candidates.length)throw Object.assign(new Error(`No qualified driver for ${step.capability||requested||"step"}.`),{code:"NO_DRIVER"});return candidates[0];}
}

class ExecutionRouter {
  constructor(store){this.store=store;}
  classify(input={}){const text=String(input.prompt||input.description||"").toLowerCase();const tools=Array.isArray(input.tools)?input.tools:[];const consequenceLevel=consequence(input.consequence);let lane="instant",reason="deterministic or read-only request";if(consequenceLevel>=CONSEQUENCE.EXTERNAL||tools.length>1||/\b(send|delete|move|post|schedule|purchase|submit)\b/.test(text)){lane="normal";reason="multi-step or consequential action";}if(tools.length>=4||/\b(research deeply|comprehensive|across (?:all|multiple)|investigate and|plan and execute|ambiguous)\b/.test(text)){lane="deep";reason="long-horizon synthesis or ambiguity";}const policy=lane==="instant"?{plannerCalls:0,replanOn:["ambiguity","drift"],maxRecentScreens:1}:lane==="normal"?{plannerCalls:1,replanOn:["ambiguity","drift","verification_failure"],maxRecentScreens:2}:{plannerCalls:"checkpointed",replanOn:["semantic_checkpoint","ambiguity","drift","verification_failure"],maxRecentScreens:3};return {lane,reason,policy,hardTimeLimit:false,costCap:false};}
  record(route,metrics={}){this.store.metric("route.duration_ms",Number(metrics.durationMs)||0,{lane:route.lane,model:metrics.model||"none",providerCalls:Number(metrics.providerCalls)||0});if(metrics.inputTokens||metrics.outputTokens)this.store.metric("route.tokens",Number(metrics.inputTokens||0)+Number(metrics.outputTokens||0),{lane:route.lane,model:metrics.model||"unknown",inputTokens:Number(metrics.inputTokens)||0,outputTokens:Number(metrics.outputTokens)||0,pricing:metrics.pricing||"unknown"});return {recorded:true};}
}

class TransactionalExecutor {
  constructor(options){Object.assign(this,options);this.active=new Map();}
  async execute(taskId,step={}){
    this.stop.assertOpen();const task=this.kernel.get(taskId);if(TERMINAL_STATES.has(task.state))throw new Error("Cannot execute a terminal task.");
    const stepId=cleanText(step.id,128)||id("step");const idempotencyKey=cleanText(step.idempotencyKey,300)||`${taskId}:${stepId}`;
    const replay=this.store.receipts(taskId).find(r=>r.idempotencyKey===idempotencyKey&&r.status==="verified");if(replay)return {...replay,replayed:true};
    const level=consequence(step.consequence??task.outcome.consequence);
    if(level>=CONSEQUENCE.EXTERNAL&&!step.approved){const approval=this.kernel.requestApproval(taskId,{consequence:level,summary:step.approvalSummary||`Approve ${step.action||"external action"}`});return {status:"waiting_approval",approval};}
    const driver=this.arbiter.choose(step);const started=Date.now();const controller=new AbortController();this.active.set(taskId,controller);
    const target=step.target||{};if(target.surfaceId)this.registry.assertTarget(target);
    const priorIntent=this.store.effectIntent(idempotencyKey);
    if(priorIntent&&["applied","unknown"].includes(priorIntent.state)){
      if(typeof driver.reconcile!=="function")return {status:"blocked",reason:"An earlier external effect has unknown state and this driver cannot reconcile it safely.",idempotencyKey};
      const recovered=await driver.reconcile({task,step,target,intent:priorIntent,signal:controller.signal});
      if(recovered?.verified){const receipt=this.store.addReceipt({taskId,stepId,status:"verified",driver:driver.name,target,proof:{...recovered,reconciled:true},idempotencyKey});this.store.updateEffect(idempotencyKey,"verified",recovered);const latest=this.kernel.get(taskId);if(latest.state!=="recovering"&&latest.state!=="running")this.kernel.transition(taskId,"recovering",{reason:"Reconciling unknown effect"});this.kernel.transition(taskId,"verified",{receiptId:receipt.id,reconciled:true});if(step.deliver!==false)this.kernel.deliver(taskId,{placement:step.placement||task.placement,proof:receipt.id});return receipt;}
      return {status:"blocked",reason:"Unknown effect could not be proven; no duplicate action was attempted.",idempotencyKey,reconciliation:recovered};
    }
    this.store.beginEffect({idempotencyKey,taskId,stepId,driver:driver.name});
    try{
      const current=this.kernel.get(taskId);if(current.state!=="running")this.kernel.transition(taskId,"running",{currentStep:stepId,driver:driver.name});
      const before=driver.observe?await driver.observe({task,step,target,phase:"before",signal:controller.signal}):null;
      if(step.precondition&&!(await step.precondition(before)))throw Object.assign(new Error("Transaction precondition failed."),{code:"PRECONDITION_FAILED"});
      this.stop.assertOpen();const effect=await driver.act({task,step,target,before,signal:controller.signal,dryRun:Boolean(step.dryRun)});this.store.updateEffect(idempotencyKey,"applied",effect);
      if(effect?.ok===true&&!driver.verify&&!step.verify)throw new Error("Driver returned ok=true without an independent verifier.");
      const proof=step.verify?await step.verify({task,step,target,before,effect}):driver.verify?await driver.verify({task,step,target,before,effect,signal:controller.signal}):null;
      const proven=Boolean(proof?.verified===true || proof?.status==="verified");
      const status=proven?"verified":proof?.partial?"partial":"failed";
      const receipt=this.store.addReceipt({taskId,stepId,status,driver:driver.name,target,proof:proof||{verified:false,reason:"No proof"},error:proven?null:{message:proof?.reason||"Postcondition was not proven"},idempotencyKey});
      this.store.updateEffect(idempotencyKey,proven?"verified":"failed",effect,proven?null:receipt.error);
      this.kernel.event(`step.${status}`,{stepId,driver:driver.name,receiptId:receipt.id,durationMs:Date.now()-started},taskId);
      this.store.metric("step.duration_ms",Date.now()-started,{driver:driver.name,status});
      if(proven){this.kernel.transition(taskId,"verified",{currentStep:stepId,receiptId:receipt.id});if(step.deliver!==false)this.kernel.deliver(taskId,{placement:step.placement||task.placement,proof:receipt.id});}
      else this.kernel.transition(taskId,status==="partial"?"partial":"failed",{currentStep:stepId,receiptId:receipt.id,reason:receipt.error?.message});
      return receipt;
    }catch(error){
      this.store.updateEffect(idempotencyKey,"unknown",null,serializeError(error));
      let compensation=null;try{if(typeof step.compensate==="function")compensation=await step.compensate({task,step,target,error});}catch(compensationError){compensation={failed:true,error:serializeError(compensationError)};}
      const receipt=this.store.addReceipt({taskId,stepId,status:"failed",driver:driver.name,target,proof:{verified:false,compensation},error:serializeError(error),idempotencyKey});
      const latest=this.kernel.get(taskId);if(!TERMINAL_STATES.has(latest.state))this.kernel.transition(taskId,"failed",{currentStep:stepId,error:serializeError(error),receiptId:receipt.id});return receipt;
    }finally{this.active.delete(taskId);}
  }
  abort(taskId,reason="Cancelled"){const ctl=this.active.get(taskId);if(ctl)ctl.abort(reason);return Boolean(ctl);}
}

class Scheduler {
  constructor(store,kernel){this.store=store;this.kernel=kernel;this.timer=null;}
  create(input={}){if(!input.name||!input.taskTemplate)throw new Error("Automation name and taskTemplate are required.");const schedule=input.schedule||{};const nextRunAt=input.nextRunAt||schedule.at||new Date(Date.now()+(Number(schedule.everyMs)||60_000)).toISOString();return this.store.createAutomation({name:cleanText(input.name,200),taskTemplate:input.taskTemplate,schedule,enabled:input.enabled!==false,nextRunAt});}
  list(){return this.store.automations();}
  update(idValue,patch){return this.store.updateAutomation(idValue,patch);}
  nextFor(auto,from=Date.now()){const every=Number(auto.schedule?.everyMs);return every>0?new Date(from+every).toISOString():null;}
  run(idValue,scheduledFor=now()){const auto=this.list().find(a=>a.id===idValue);if(!auto)throw new Error("Automation not found.");const occurrence=this.store.claimOccurrence(auto.id,scheduledFor);if(!occurrence)return {duplicate:true,automationId:auto.id,scheduledFor};const task=this.kernel.create({...auto.taskTemplate,requestId:`schedule:${occurrence.occurrenceKey}`,metadata:{...(auto.taskTemplate.metadata||{}),automationId:auto.id,occurrenceId:occurrence.id}});this.store.completeOccurrence(occurrence.id,task.id);this.store.updateAutomation(auto.id,{lastRunAt:scheduledFor,nextRunAt:this.nextFor(auto,Date.parse(scheduledFor)||Date.now())});return {occurrence,task};}
  tick(at=Date.now()){const due=this.list().filter(a=>a.enabled&&a.nextRunAt&&Date.parse(a.nextRunAt)<=at);return due.map(a=>this.run(a.id,a.nextRunAt));}
  start(intervalMs=1000){if(this.timer)return;this.timer=setInterval(()=>{try{this.tick();}catch(error){this.kernel.event("scheduler.error",{error:serializeError(error)});}},Math.max(250,intervalMs));this.timer.unref?.();}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

class ProcedureFoundry {
  constructor(store){this.store=store;}
  compile(input={}){const steps=(input.steps||[]).map((step,index)=>({id:step.id||`step-${index+1}`,action:step.action,capability:step.capability||null,targetFingerprint:step.targetFingerprint||null,preconditions:step.preconditions||[],postconditions:step.postconditions||[]}));if(!input.name||!steps.length)throw new Error("Procedure name and steps are required.");const graph={version:1,steps,edges:steps.slice(1).map((s,i)=>({from:steps[i].id,to:s.id}))};return this.store.saveProcedure({name:cleanText(input.name,200),fingerprint:hash(graph),graph,qualification:{passed:false,cases:[]},state:"draft"});}
  list(){return this.store.procedures();}
  qualify(idValue,input={}){const cases=Array.isArray(input.cases)?input.cases:[];const passed=cases.length>=3&&cases.every(c=>c.verified===true)&&new Set(cases.map(c=>c.surfaceEpoch||c.fixture||c.id)).size>=2;return this.store.qualifyProcedure(idValue,{passed,cases:cases.slice(0,100),qualifiedAt:now(),reason:passed?"Multi-case verification passed":"Needs 3 verified cases across at least 2 fixtures/epochs"});}
  detectDrift(idValue,currentFingerprint){const p=this.list().find(x=>x.id===idValue);if(!p)throw new Error("Procedure not found.");return {procedureId:idValue,drifted:p.fingerprint!==currentFingerprint,expected:p.fingerprint,current:currentFingerprint};}
}

class FrontierLab {
  constructor(service,options={}){this.service=service;this.shadowBrowserService=options.shadowBrowserService||null;this.ambient={ownerPresent:true,screenLocked:false,meeting:false,onBattery:false,network:"online",updatedAt:now()};}
  capabilities(){const windows=process.platform==="win32";const sandbox=windows&&Boolean(process.env.WINDIR)&&fs.existsSync(path.join(process.env.WINDIR,"System32","WindowsSandbox.exe"));const hyperV=windows&&Boolean(process.env.WINDIR)&&fs.existsSync(path.join(process.env.WINDIR,"System32","vmcompute.exe"));return {browserShadow:{available:Boolean(this.shadowBrowserService),isolatedProfile:true},desktopShadow:{available:sandbox||hyperV,providers:{windowsSandbox:sandbox,hyperV},sharedVirtualDesktopRejected:true},ghostRun:true,counterfactualVerifier:true,timeMachine:true,crossSurfaceDag:true,ambientInterruption:true,realShadowDesktop:sandbox||hyperV,realShadowReason:sandbox||hyperV?null:"No supported isolated Windows Sandbox or Hyper-V provider was detected; a hidden physical desktop is never reported as Shadow."};}
  async startBrowserShadow(){if(!this.shadowBrowserService)return {state:"unsupported",reason:"Isolated browser service is not configured."};const status=await this.shadowBrowserService.status();const surface=this.service.registry.register({id:"browser:shadow:primary",kind:"browser-shadow",label:"Browser Shadow",state:"connected",capabilities:["isolated-profile","dom","screenshot","artifact-export"],metadata:{plane:"shadow",profileDir:this.shadowBrowserService.profileDir,physicalInput:false}});return {state:"ready",surface,status,isolation:"separate persistent browser profile"};}
  ghostRun(input={}){const plan=input.plan||[];const effects=plan.map((step,index)=>({index,action:step.action||"unknown",target:step.target||null,wouldMutate:consequence(step.consequence)>CONSEQUENCE.READ,blocked:consequence(step.consequence)>=CONSEQUENCE.EXTERNAL&&!step.approved}));return {id:id("ghost"),status:effects.some(e=>e.blocked)?"blocked":"simulated",effects,proof:{simulationOnly:true,physicalEffect:false},createdAt:now()};}
  counterfactual(input={}){const hypotheses=(input.hypotheses||[]).map(h=>({id:h.id||id("hypothesis"),label:h.label||"hypothesis",score:Number(h.evidenceScore)||0,contradictions:h.contradictions||[]})).sort((a,b)=>b.score-a.score);return {winner:hypotheses[0]||null,alternatives:hypotheses.slice(1),decisive:Boolean(hypotheses[0]&&(!hypotheses[1]||hypotheses[0].score-hypotheses[1].score>=0.15))};}
  timeMachine(taskId,cursor=Number.MAX_SAFE_INTEGER){const task=this.service.kernel.get(taskId);const events=this.service.store.events(0,1000,taskId).filter(e=>e.seq<=cursor);return {taskId,taskSnapshot:task,eventCursor:events.at(-1)?.seq||0,events,receiptCount:this.service.store.receipts(taskId).length};}
  fork(taskId,cursor,input={}){const snapshot=this.timeMachine(taskId,cursor);const task=snapshot.taskSnapshot;return this.service.createTask({parentTaskId:task.id,requestId:input.requestId||`fork:${task.id}:${cursor}:${Date.now()}`,title:input.title||`${task.title} · fork`,prompt:input.prompt||task.prompt,outcome:{...task.outcome,...(input.outcome||{})},placement:input.placement||task.placement,effort:input.effort||task.effort,metadata:{...task.metadata,timeMachineFork:{sourceTaskId:task.id,cursor:snapshot.eventCursor,immutableExternalEffects:true}}});}
  validateDag(input={}){const nodes=input.nodes||[];const edges=input.edges||[];const ids=new Set(nodes.map(n=>n.id));const invalid=edges.filter(e=>!ids.has(e.from)||!ids.has(e.to));const visiting=new Set(),visited=new Set(),adj=new Map(nodes.map(n=>[n.id,[]]));edges.forEach(e=>adj.get(e.from)?.push(e.to));let cycle=false;const dfs=n=>{if(visiting.has(n)){cycle=true;return;}if(visited.has(n))return;visiting.add(n);for(const x of adj.get(n)||[])dfs(x);visiting.delete(n);visited.add(n);};nodes.forEach(n=>dfs(n.id));return {valid:!invalid.length&&!cycle,cycle,invalidEdges:invalid,nodeCount:nodes.length,edgeCount:edges.length};}
  setAmbient(input={}){this.ambient={...this.ambient,...input,updatedAt:now()};const interrupt=this.ambient.screenLocked||this.ambient.meeting||this.ambient.ownerPresent===false;if(interrupt){for(const task of this.service.kernel.list({states:["running","ready","recovering"]}))this.service.kernel.pause(task.id,"Ambient interruption policy yielded control");}this.service.kernel.event("ambient.changed",{...this.ambient,interrupted:interrupt});return {...this.ambient,interrupted:interrupt};}
}

class ReleaseManager {
  constructor(service,options={}){this.service=service;this.rootDir=path.resolve(options.rootDir||process.cwd());this.report=null;this.canary={level:"fixtures",updatedAt:now()};this.inventoryCache=null;}
  inventory(options={}){if(!options.fresh&&this.inventoryCache&&Date.now()-this.inventoryCache.at<30_000)return this.inventoryCache.value;const files=[];const roots=[path.join(this.rootDir,"server.js"),path.join(this.rootDir,"server")];const patterns=[/capabilityEngine\.execute/g,/desktop_control/g,/screen_act/g,/browser_act/g,/windowsBroker\.call/g];const walk=(entry)=>{if(!fs.existsSync(entry))return;const stat=fs.statSync(entry);if(stat.isDirectory()){for(const name of fs.readdirSync(entry))if(!["node_modules","action-fabric","dist","runtime"].includes(name))walk(path.join(entry,name));return;}if(!/\.(?:js|cjs|mjs|ts|tsx)$/.test(entry))return;const text=fs.readFileSync(entry,"utf8");const hits=patterns.reduce((sum,p)=>sum+(text.match(p)||[]).length,0);if(hits)files.push({file:path.relative(this.rootDir,entry),hits});};roots.forEach(walk);const value={legacyCallerFiles:files.length,legacyCalls:files.reduce((n,f)=>n+f.hits,0),files,generatedAt:now()};this.inventoryCache={at:Date.now(),value};return value;}
  async benchmark(){const started=Date.now();const checks=[];const run=(name,fn)=>{try{const detail=fn();checks.push({name,passed:true,detail});}catch(error){checks.push({name,passed:false,error:serializeError(error)});}};run("ghost blocks unapproved external effect",()=>{const r=this.service.frontier.ghostRun({plan:[{action:"send",consequence:"external"}]});if(r.status!=="blocked")throw new Error("not blocked");return r.status;});run("cyclic mission rejected",()=>{const r=this.service.frontier.validateDag({nodes:[{id:"a"},{id:"b"}],edges:[{from:"a",to:"b"},{from:"b",to:"a"}]});if(r.valid)throw new Error("cycle accepted");return r;});run("false completion impossible",()=>{const t=this.service.createTask({requestId:`bench:${Date.now()}`,prompt:"Benchmark proof gate"});this.service.kernel.transition(t.id,"running");let denied=false;try{this.service.kernel.transition(t.id,"verified");}catch{denied=true;}if(!denied)throw new Error("verification bypassed");this.service.kernel.cancel(t.id);return "denied";});const inventory=this.inventory({fresh:true});this.report={version:"action-fabric-v1",passed:checks.every(c=>c.passed),checks,inventory,durationMs:Date.now()-started,generatedAt:now(),releaseReady:checks.every(c=>c.passed)&&inventory.legacyCalls===0};return this.report;}
  setCanary(level){const levels=["fixtures","safe_reads","reversible_writes","drafts","approved_external"];if(!levels.includes(level))throw new Error("Unknown canary level.");this.canary={level,updatedAt:now()};this.service.kernel.event("release.canary.changed",this.canary);return this.canary;}
  cutover(){if(!this.report?.passed)throw new Error("A passing benchmark report is required before cutover.");const inventory=this.inventory();if(inventory.legacyCalls>0)throw Object.assign(new Error(`Cutover blocked: ${inventory.legacyCalls} legacy action calls remain.`),{code:"LEGACY_CALLERS_REMAIN"});this.service.flags.actionAuthority="fabric";this.service.kernel.event("release.cutover",{inventory,reportAt:this.report.generatedAt});return {authority:"fabric",cutoverAt:now()};}
  status(){const inventory=this.inventory();return {authority:this.service.flags.actionAuthority||"canary",canary:this.canary,inventory,lastBenchmark:this.report,cutoverEligible:Boolean(this.report?.passed&&inventory.legacyCalls===0)};}
}

function createFilesystemDriver(rootDir){
  const root=path.resolve(rootDir);const realRoot=fs.realpathSync.native(root);
  const scoped=(candidate)=>{const resolved=path.resolve(root,String(candidate||"."));if(resolved!==root&&!resolved.startsWith(root+path.sep))throw Object.assign(new Error("Path escapes the approved workspace."),{code:"PATH_SCOPE"});let cursor=resolved;while(!fs.existsSync(cursor)){const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}const realParent=fs.realpathSync.native(cursor);if(realParent!==realRoot&&!realParent.startsWith(realRoot+path.sep))throw Object.assign(new Error("Path resolves through a link outside the approved workspace."),{code:"PATH_SCOPE"});if(fs.existsSync(resolved)){const actual=fs.realpathSync.native(resolved);if(actual!==realRoot&&!actual.startsWith(realRoot+path.sep))throw Object.assign(new Error("Path resolves outside the approved workspace."),{code:"PATH_SCOPE"});return actual;}return resolved;};
  return {name:"filesystem",kind:"native",priority:10,capabilities:["file.read","file.list","file.write","file.stat"],
    async observe({step}){const p=scoped(step.params?.path);try{const s=fs.statSync(p);return {exists:true,path:p,size:s.size,mtimeMs:s.mtimeMs,isDirectory:s.isDirectory(),hash:s.isFile()?hash(fs.readFileSync(p)):null};}catch{return {exists:false,path:p};}},
    async act({step,before,dryRun}){const action=step.action;const p=scoped(step.params?.path);if(action==="read")return {content:fs.readFileSync(p,"utf8"),path:p};if(action==="list")return {entries:fs.readdirSync(p,{withFileTypes:true}).map(e=>({name:e.name,isDirectory:e.isDirectory()})),path:p};if(action==="stat")return before;if(action==="write"){const content=String(step.params?.content??"");if(!dryRun){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content,"utf8");}return {path:p,contentHash:hash(content),bytes:Buffer.byteLength(content),dryRun};}throw new Error(`Unsupported filesystem action: ${action}`);},
    async verify({step,effect}){if(step.action==="read"||step.action==="list"||step.action==="stat")return {verified:true,method:"native-result",summary:step.action};if(step.action==="write"){if(effect.dryRun)return {verified:true,method:"ghost",simulationOnly:true};const p=scoped(step.params?.path);const actual=fs.readFileSync(p,"utf8");return {verified:hash(actual)===effect.contentHash,method:"read-after-write",hash:hash(actual),bytes:Buffer.byteLength(actual)};}return {verified:false,reason:"No verifier"};}}
}

function createMockDriver(){const state=new Map();return {name:"mock",kind:"test",priority:1000,capabilities:["mock","provider.read","provider.draft","browser.semantic","desktop.uia"],state,
  async observe({step}){return {value:state.get(step.params?.key),revision:state.size};},
  async act({step,dryRun}){if(step.params?.delayMs)await sleep(Math.min(2000,step.params.delayMs));if(step.params?.throw)throw new Error(step.params.throw);const key=step.params?.key||"default";const value=step.params?.value??true;if(!dryRun)state.set(key,value);if(step.params?.commitThenThrow)throw new Error("Simulated response loss after commit");return {key,value,dryRun,providerObjectId:`mock:${key}`};},
  async verify({effect}){return {verified:effect.dryRun||state.get(effect.key)===effect.value,method:effect.dryRun?"simulation":"read-after-write",providerObjectId:effect.providerObjectId};},
  async reconcile({step}){const key=step.params?.key||"default";const value=step.params?.value??true;return {verified:state.get(key)===value,method:"mock-provider-reconciliation",providerObjectId:`mock:${key}`};}};}

function createBrowserDriver(browserService){return {name:"browser-dom",kind:"browser",priority:20,available:Boolean(browserService),capabilities:["browser.semantic","browser.navigate","browser.inspect","browser.type","browser.click"],
  async observe(){return browserService.pageBrief();},
  async act({step}){const action=step.action;const p=step.params||{};if(action==="navigate")return browserService.navigate({url:p.url});if(action==="inspect")return browserService.inspect(p);if(action==="click")return browserService.click(p);if(action==="type")return browserService.type(p);if(action==="commit")return browserService.commit(p);throw new Error(`Unsupported browser action: ${action}`);},
  async verify({step,effect}){if(step.action==="inspect")return {verified:Boolean(effect),method:"semantic-inspection"};const expected=step.postcondition||{};if(Object.keys(expected).length)return browserService.verify(expected);const current=await browserService.pageBrief();return {verified:Boolean(current?.url),method:"page-readback",url:current?.url,title:current?.title};}};}

function createGoogleWorkspaceDriver(provider){return {name:"google-workspace",kind:"provider",priority:5,available:()=>Boolean(provider?.createDraft&&provider?.getDraft&&provider.status?.().connected),capabilities:["gmail.draft"],
  async observe(){return {provider:"gmail",connected:provider.status?.().connected===true};},
  async act({step}){if(step.action!=="create_draft")throw new Error(`Unsupported Google action: ${step.action}`);return provider.createDraft({recipient:step.params?.recipient,subject:step.params?.subject,body:step.params?.body});},
  async verify({step,effect}){if(!effect?.draftId)return {verified:false,reason:"Provider returned no draft ID"};const draft=await provider.getDraft(effect.draftId);const expected={recipient:String(step.params?.recipient||"").trim().toLowerCase(),subject:String(step.params?.subject||"").trim(),body:String(step.params?.body||"")};const actualBodyHash=hash(draft.rawBody||"");return {verified:Boolean(draft.draftId===effect.draftId&&draft.sent===false&&String(draft.recipient||"").trim().toLowerCase()===expected.recipient&&draft.subject===expected.subject&&actualBodyHash===hash(expected.body)),method:"gmail-read-after-write",providerObjectId:draft.draftId,sent:false,fields:{recipient:draft.recipient,subject:draft.subject,bodyHash:actualBodyHash}};}};}

function createWindowsDriver(windowsBroker){return {name:"windows-uia",kind:"desktop",priority:30,available:Boolean(windowsBroker),capabilities:["desktop.uia","desktop.focus","desktop.type"],
  async observe({target}){if(!target.surfaceId||!target.windowHandle)throw new Error("Windows action needs a scoped surface and window handle.");return windowsBroker.call("inspect_window",{handle:target.windowHandle,processId:target.processId});},
  async act({step,target}){if(step.action==="focus")return windowsBroker.call("focus_window",{handle:target.windowHandle,processId:target.processId});if(step.action==="invoke")return windowsBroker.call("invoke_control",{handle:target.windowHandle,processId:target.processId,automationId:target.automationId,name:target.name});if(step.action==="type")return windowsBroker.call("set_control_value",{handle:target.windowHandle,processId:target.processId,automationId:target.automationId,name:target.name,value:String(step.params?.value??"")});throw new Error(`Unsupported Windows action: ${step.action}`);},
  async verify({step,target}){const after=await windowsBroker.call("inspect_window",{handle:target.windowHandle,processId:target.processId});if(step.action==="type"){const controls=after?.controls||[];const found=controls.find(c=>c.automationId===target.automationId||c.name===target.name);return {verified:Boolean(found&&String(found.value)===String(step.params?.value??"")),method:"uia-readback"};}return {verified:Boolean(after),method:"uia-inspection"};}};}

class ActionFabric {
  constructor(options={}){
    this.artifactRoot=path.resolve(options.artifactRoot||options.runtimeDir||process.cwd());
    this.store=new ActionStore({runtimeDir:options.runtimeDir,file:options.file});this.stop=new EmergencyStop(this.store);
    this.kernel=new TaskKernel(this.store,this.stop,{memoryPublisher:options.memoryPublisher});this.registry=new SurfaceRegistry(this.store,{windowsBroker:options.windowsBroker});this.browser=new BrowserPlaneManager(this.registry,options.browserService||null);
    this.resolver=new TargetResolver(this.registry);this.router=new ExecutionRouter(this.store);this.arbiter=new DriverArbiter();this.arbiter.register(createMockDriver());this.arbiter.register(createFilesystemDriver(options.workspaceRoot||options.rootDir||process.cwd()));if(options.googleProvider)this.arbiter.register(createGoogleWorkspaceDriver(options.googleProvider));if(options.browserService)this.arbiter.register(createBrowserDriver(options.browserService));if(options.windowsBroker)this.arbiter.register(createWindowsDriver(options.windowsBroker));
    this.executor=new TransactionalExecutor({store:this.store,kernel:this.kernel,registry:this.registry,arbiter:this.arbiter,stop:this.stop});
    this.scheduler=new Scheduler(this.store,this.kernel);this.procedures=new ProcedureFoundry(this.store);this.frontier=new FrontierLab(this,{shadowBrowserService:options.shadowBrowserService});this.release=new ReleaseManager(this,{rootDir:options.rootDir});this.startedAt=now();this.flags={admitTasks:options.admitTasks!==false,actionAuthority:"canary"};
    this.stop.on("stop",()=>{for(const task of this.kernel.list({states:["running","recovering"]}))this.executor.abort(task.id,"Emergency stop");});
  }
  status(){return {state:"ready",version:1,startedAt:this.startedAt,emergencyStop:this.stop.status(),flags:this.flags,counts:{tasks:this.kernel.list({limit:250}).length,surfaces:this.registry.list().length,automations:this.scheduler.list().length,procedures:this.procedures.list().length},drivers:this.arbiter.list(),browserPlanes:this.browser.capabilities(),frontier:this.frontier.capabilities(),release:this.release.status()};}
  createTask(input){if(!this.flags.admitTasks)throw new Error("Action Fabric task admission is disabled.");return this.kernel.create(input);}
  async execute(taskId,step){return this.executor.execute(taskId,step);}
  resolveArtifactContent(artifactId){const artifact=this.store.getArtifact(artifactId);if(!artifact)throw Object.assign(new Error("Artifact not found."),{code:"NOT_FOUND"});const filePath=path.resolve(String(artifact.uri||""));const relative=path.relative(this.artifactRoot,filePath);if(!filePath||relative.startsWith("..")||path.isAbsolute(relative)||!fs.existsSync(filePath)||!fs.statSync(filePath).isFile())throw Object.assign(new Error("Artifact content is unavailable."),{code:"NOT_FOUND"});return {artifact,filePath};}
  close(){this.scheduler.stop();void this.frontier.shadowBrowserService?.close?.();this.store.close();}
}

function createActionFabric(options){return new ActionFabric(options);}

module.exports={ActionFabric,createActionFabric,EmergencyStop,TaskKernel,SurfaceRegistry,BrowserPlaneManager,TargetResolver,DriverArbiter,ExecutionRouter,TransactionalExecutor,Scheduler,ProcedureFoundry,FrontierLab,ReleaseManager,createMockDriver,createFilesystemDriver,createBrowserDriver,createGoogleWorkspaceDriver};
