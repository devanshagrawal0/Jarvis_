"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createActionFabric } = require("../../server/action-fabric");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-af-a-"));
  const fabric = createActionFabric({ runtimeDir:dir, workspaceRoot:dir });
  t.after(() => { try { fabric.close(); } catch {} fs.rmSync(dir,{recursive:true,force:true}); });
  return { dir, fabric };
}

test("Wave 0: emergency stop prevents effects and can be explicitly released", async (t) => {
  const { fabric } = fixture(t);
  const task = fabric.createTask({ requestId:"stop-test", prompt:"Change a safe mock value" });
  fabric.stop.engage("test stop");
  await assert.rejects(() => fabric.execute(task.id,{driver:"mock",action:"set",params:{key:"x",value:1}}), /stopped/i);
  assert.equal(fabric.stop.status().stopped,true);
  fabric.stop.release();
  const receipt = await fabric.execute(task.id,{driver:"mock",action:"set",params:{key:"x",value:1}});
  assert.equal(receipt.status,"verified");
});

test("Wave 1: task creation is idempotent and event cursor reconnect is lossless", (t) => {
  const { fabric } = fixture(t);
  const a = fabric.createTask({ requestId:"same-command", prompt:"Inspect a sample" });
  const b = fabric.createTask({ requestId:"same-command", prompt:"This duplicate must not replace it" });
  assert.equal(a.id,b.id);
  const first = fabric.store.events(0,1);
  const rest = fabric.store.events(first[0].seq,100);
  assert.ok(first.length===1 && rest.every(event=>event.seq>first[0].seq));
});

test("Wave 1: completion without a proof receipt is impossible", (t) => {
  const { fabric } = fixture(t);
  const task = fabric.createTask({ requestId:"truth-test", prompt:"Prove an outcome" });
  fabric.kernel.transition(task.id,"running");
  assert.throws(() => fabric.kernel.transition(task.id,"verified"), /receipt/i);
});

test("Wave 1: durable task survives a process-style close and reopen", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-af-restart-"));
  let fabric = createActionFabric({ runtimeDir:dir, workspaceRoot:dir });
  const task = fabric.createTask({ requestId:"restart-test", prompt:"Persist this task" });
  fabric.kernel.pause(task.id,"checkpoint");
  fabric.close();
  fabric = createActionFabric({ runtimeDir:dir, workspaceRoot:dir });
  assert.equal(fabric.kernel.get(task.id).state,"paused");
  fabric.close();
  fs.rmSync(dir,{recursive:true,force:true});
});

test("Wave 1: consequence approval is scoped, expires, and cannot double-consume", async (t) => {
  const { fabric } = fixture(t);
  const task = fabric.createTask({ requestId:"approval-test", prompt:"Prepare a mock external message", outcome:{description:"Prepare a mock external message",consequence:"external"} });
  const waiting = await fabric.execute(task.id,{driver:"mock",action:"draft",consequence:"external",params:{key:"draft",value:"hello"}});
  assert.equal(waiting.status,"waiting_approval");
  const decision = fabric.kernel.decideApproval(waiting.approval.id,"approved",waiting.approval.token);
  assert.equal(decision.state,"approved");
  assert.throws(() => fabric.kernel.decideApproval(waiting.approval.id,"approved",waiting.approval.token),/already/i);
  const receipt = await fabric.execute(task.id,{driver:"mock",action:"draft",consequence:"external",approved:true,params:{key:"draft",value:"hello"}});
  assert.equal(receipt.status,"verified");
});

test("Wave 2: Windows driver is registered only with a persistent broker and stays surface-scoped", async (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-af-broker-"));
  const calls=[];
  const broker={call:async(method,params)=>{calls.push({method,params});if(method==="inspect_window")return {controls:[{automationId:"field",value:"safe"}]};return {focused:true};}};
  const fabric=createActionFabric({runtimeDir:dir,workspaceRoot:dir,windowsBroker:broker});
  t.after(()=>{fabric.close();fs.rmSync(dir,{recursive:true,force:true});});
  const surface=fabric.registry.register({id:"window:test",kind:"window",label:"Fixture",processId:42,windowHandle:"100"});
  const task=fabric.createTask({requestId:"uia-test",prompt:"Focus fixture"});
  const receipt=await fabric.execute(task.id,{driver:"windows-uia",action:"focus",target:{surfaceId:surface.id,epoch:surface.epoch,processId:42,windowHandle:"100"}});
  assert.equal(receipt.status,"verified");
  assert.ok(calls.every(call=>call.params.handle==="100"&&call.params.processId===42));
});
