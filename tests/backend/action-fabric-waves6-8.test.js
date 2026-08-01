"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createActionFabric}=require("../../server/action-fabric");

function setup(t,extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-af-c-"));fs.mkdirSync(path.join(dir,"workspace"),{recursive:true});const fabric=createActionFabric({runtimeDir:path.join(dir,"runtime"),workspaceRoot:path.join(dir,"workspace"),...extra});t.after(()=>{fabric.close();fs.rmSync(dir,{recursive:true,force:true});});return {fabric,dir,workspace:path.join(dir,"workspace")};}

test("Wave 6: executor distinguishes acting from independently verified completion",async(t)=>{
  const {fabric}=setup(t);fabric.arbiter.register({name:"unverified",priority:1,capabilities:["unsafe-test"],act:async()=>({ok:true})});
  const task=fabric.createTask({requestId:"unverified",prompt:"Run unverified fixture"});
  const receipt=await fabric.execute(task.id,{id:"one",driver:"unverified",action:"fixture"});
  assert.equal(receipt.status,"failed");assert.match(receipt.error.message,/without an independent verifier/i);assert.equal(fabric.kernel.get(task.id).state,"failed");
});

test("Wave 6: lost response is reconciled without repeating the effect",async(t)=>{
  const {fabric}=setup(t);const task=fabric.createTask({requestId:"lost-response",prompt:"Set sample provider state"});
  const step={id:"stable-step",driver:"mock",action:"set",params:{key:"order-1",value:"committed",commitThenThrow:true}};
  const first=await fabric.execute(task.id,step);assert.equal(first.status,"failed");
  fabric.kernel.retry(task.id);const recovered=await fabric.execute(task.id,step);
  assert.equal(recovered.status,"verified");assert.equal(recovered.proof.reconciled,true);assert.equal(fabric.kernel.get(task.id).state,"delivered");
});

test("Wave 6: stale surface blocks action before the driver is called",async(t)=>{
  const {fabric}=setup(t);const surface=fabric.registry.register({id:"surface:x",kind:"window",label:"X"});fabric.registry.navigate(surface.id);
  const task=fabric.createTask({requestId:"stale-action",prompt:"Use stale target"});
  await assert.rejects(()=>fabric.execute(task.id,{driver:"mock",action:"set",target:{surfaceId:surface.id,epoch:surface.epoch},params:{key:"x",value:1}}),/stale/i);
});

test("Wave 7: native filesystem adapter writes then proves exact bytes and blocks traversal",async(t)=>{
  const {fabric,workspace}=setup(t);const task=fabric.createTask({requestId:"file-write",prompt:"Write safe fixture"});
  const receipt=await fabric.execute(task.id,{id:"write-one",driver:"filesystem",action:"write",capability:"file.write",consequence:"reversible",params:{path:"reports/result.txt",content:"verified content"}});
  assert.equal(receipt.status,"verified");assert.equal(fs.readFileSync(path.join(workspace,"reports/result.txt"),"utf8"),"verified content");
  const task2=fabric.createTask({requestId:"escape",prompt:"Test path scope"});const denied=await fabric.execute(task2.id,{id:"escape",driver:"filesystem",action:"read",params:{path:"../../outside.txt"}});assert.equal(denied.status,"failed");assert.match(denied.error.message,/approved workspace/i);
});

test("Wave 7: Gmail draft adapter requires provider read-after-write proof and remains unsent",async(t)=>{
  const drafts=new Map();const google={status:()=>({connected:true}),createDraft:async(input)=>{const item={draftId:"draft-1",providerMessageId:"msg-1",recipient:input.recipient,subject:input.subject,bodyHash:"x",sent:false};drafts.set(item.draftId,{...item,rawBody:input.body});return item;},getDraft:async(id)=>drafts.get(id)};
  const {fabric}=setup(t,{googleProvider:google});const task=fabric.createTask({requestId:"draft",prompt:"Create sample Gmail draft"});
  const receipt=await fabric.execute(task.id,{id:"draft-step",capability:"gmail.draft",action:"create_draft",consequence:"reversible",params:{recipient:"test@example.test",subject:"Fixture",body:"Never sent"}});
  assert.equal(receipt.status,"verified");assert.equal(receipt.proof.sent,false);assert.equal(receipt.proof.providerObjectId,"draft-1");
});

test("Wave 8: routing distinguishes instant, normal, and deep without time or cost caps",(t)=>{
  const {fabric}=setup(t);const instant=fabric.router.classify({prompt:"What window is open?"});const normal=fabric.router.classify({prompt:"Schedule and submit this form",consequence:"external",tools:["calendar","browser"]});const deep=fabric.router.classify({prompt:"Research deeply across multiple sources and plan and execute",tools:["web","files","browser","analysis"]});
  assert.deepEqual([instant.lane,normal.lane,deep.lane],["instant","normal","deep"]);assert.equal(deep.hardTimeLimit,false);assert.equal(deep.costCap,false);
  fabric.router.record(deep,{durationMs:321,providerCalls:2,model:"fixture-model",inputTokens:100,outputTokens:25,pricing:"unknown"});assert.ok(fabric.store.metrics(null,10).length>=2);
});
