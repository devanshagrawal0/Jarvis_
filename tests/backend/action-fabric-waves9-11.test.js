"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createActionFabric}=require("../../server/action-fabric");

function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-af-d-"));const workspace=path.join(dir,"workspace");fs.mkdirSync(workspace);const fabric=createActionFabric({runtimeDir:path.join(dir,"runtime"),workspaceRoot:workspace});t.after(()=>{try{fabric.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});return {fabric,dir,workspace};}

test("Wave 9: Runtime task lifecycle supports pause, correction, takeover, return, and cancel",(t)=>{
  const {fabric}=setup(t);const task=fabric.createTask({requestId:"runtime-flow",prompt:"Open safe fixture",placement:"runtime"});
  fabric.kernel.pause(task.id,"Runtime pause");assert.equal(fabric.kernel.get(task.id).state,"paused");
  fabric.kernel.amend(task.id,{prompt:"Open corrected safe fixture",metadata:{ownerCorrection:true}});fabric.kernel.resume(task.id);fabric.kernel.takeover(task.id);assert.equal(fabric.kernel.get(task.id).state,"waiting_owner");
  fabric.kernel.giveBack(task.id);assert.equal(fabric.kernel.get(task.id).state,"ready");fabric.kernel.cancel(task.id);assert.equal(fabric.kernel.get(task.id).state,"cancelled");
});

test("Wave 9: Runtime is the only added widget and has exactly the three spatial states",()=>{
  // This used to require exactly one `id: "runtime"` in BOTH WidgetStrip and WidgetLauncher, which
  // enforced the intent ("registered once") by encoding the accident that the list was written out
  // twice. The two copies were already drifting. There is now one registry, so the check is that
  // runtime is declared once there and that neither consumer has grown its own copy back.
  const registry=fs.readFileSync(path.join(__dirname,"../../src/globe-room/widget-registry.ts"),"utf8");const strip=fs.readFileSync(path.join(__dirname,"../../src/globe-room/WidgetStrip.tsx"),"utf8");const launcher=fs.readFileSync(path.join(__dirname,"../../src/globe-room/WidgetLauncher.tsx"),"utf8");const frame=fs.readFileSync(path.join(__dirname,"../../src/globe-room/SpatialWidgetFrame.tsx"),"utf8");
  assert.equal((registry.match(/id: "runtime"/g)||[]).length,1,"runtime must be declared exactly once, in the registry");
  for(const [name,source] of [["WidgetStrip",strip],["WidgetLauncher",launcher]]){
    assert.equal((source.match(/id: "runtime"/g)||[]).length,0,`${name} must not re-declare widgets — it imports the registry`);
    assert.match(source,/from "\.\/widget-registry"/,`${name} must import the shared registry`);
  }
  assert.match(frame,/"minimized" \| "normal" \| "expanded"/);assert.doesNotMatch(frame,/"detached"|"docked"|"monitor"/);
});

test("Wave 10: scheduler claims each occurrence exactly once",(t)=>{
  const {fabric}=setup(t);const when="2030-01-01T00:00:00.000Z";const auto=fabric.scheduler.create({name:"Fixture briefing",schedule:{at:when},taskTemplate:{prompt:"Prepare safe local briefing"},nextRunAt:when});
  const first=fabric.scheduler.run(auto.id,when);const second=fabric.scheduler.run(auto.id,when);
  assert.ok(first.task?.id);assert.equal(second.duplicate,true);assert.equal(fabric.kernel.list({limit:10}).filter(task=>task.metadata.automationId===auto.id).length,1);
});

test("Wave 10: scheduler state and next occurrence survive restart",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-af-schedule-"));const workspace=path.join(dir,"workspace");fs.mkdirSync(workspace);let fabric=createActionFabric({runtimeDir:path.join(dir,"runtime"),workspaceRoot:workspace});const auto=fabric.scheduler.create({name:"Recurring",schedule:{everyMs:60000},taskTemplate:{prompt:"Safe recurrence"},nextRunAt:"2031-01-01T00:00:00.000Z"});fabric.close();fabric=createActionFabric({runtimeDir:path.join(dir,"runtime"),workspaceRoot:workspace});assert.equal(fabric.scheduler.list().find(a=>a.id===auto.id)?.nextRunAt,"2031-01-01T00:00:00.000Z");fabric.close();fs.rmSync(dir,{recursive:true,force:true});
});

test("Wave 11: procedures remain drafts until multi-fixture outcome qualification",(t)=>{
  const {fabric}=setup(t);const procedure=fabric.procedures.compile({name:"Open project file",steps:[{action:"locate",capability:"file.read"},{action:"open",capability:"desktop.uia",postconditions:["file visible"]}]});
  const rejected=fabric.procedures.qualify(procedure.id,{cases:[{fixture:"a",verified:true},{fixture:"a",verified:true}]});assert.equal(rejected.state,"rejected");
  const qualified=fabric.procedures.qualify(procedure.id,{cases:[{fixture:"a",verified:true},{fixture:"b",verified:true},{fixture:"c",verified:true}]});assert.equal(qualified.state,"qualified");
  assert.equal(fabric.procedures.detectDrift(procedure.id,"different").drifted,true);
});
