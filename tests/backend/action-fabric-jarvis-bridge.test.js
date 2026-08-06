"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createActionFabric, createJarvisActionSession } = require("../../server/action-fabric");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-action-bridge-"));
  const frame = path.join(root, "frame.png");
  fs.writeFileSync(frame, Buffer.from("89504e470d0a1a0a", "hex"));
  const calls = [];
  const capabilityEngine = {
    definitions: [
      { name: "screen_capture", risk: "observe" },
      { name: "browser_click", risk: "execute" },
      { name: "browser_screenshot", risk: "observe" },
      { name: "computer_use", risk: "execute" },
      { name: "broken_tool", risk: "execute" },
    ],
    async execute(tool, args, context) {
      calls.push({ tool, args, context });
      if (tool === "broken_tool") return { ok:false, status:"failed", error:"fixture failure", receipt:{id:"legacy-failed",status:"failed"} };
      if (tool === "computer_use") {
        await context.onRuntimeActionStep?.({step:1,phase:"planned",mode:"screen",action:"click",x:10,y:20,reasoning:"fixture target"});
        await context.onRuntimeActionStep?.({step:1,phase:"executed",mode:"screen",action:"click",x:10,y:20,reasoning:"fixture clicked"});
        return {ok:true,status:"completed",result:{success:true,stepsCompleted:1},receipt:{id:"legacy-computer-use",status:"verified"}};
      }
      if (tool === "screen_capture" || tool === "browser_screenshot") return { ok:true, status:"completed", result:{path:frame,mimeType:"image/png"}, receipt:{id:`legacy-${tool}`,status:"verified"} };
      return { ok:true, status:"completed", result:{clicked:true,selector:args.selector}, receipt:{id:`legacy-${tool}`,status:"verified"} };
    },
  };
  const fabric = createActionFabric({ runtimeDir:path.join(root,"fabric"), artifactRoot:root, rootDir:root, workspaceRoot:root });
  return { root, frame, calls, capabilityEngine, fabric };
}

test("normal JARVIS capability turn becomes a delivered Action Fabric task with task-bound frame", async (t) => {
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"look at my screen", requestId:"turn-1", sessionId:"owner", deviceId:"owner", source:"chat", strength:"balanced", route:{intent:"computer-control"} });
  const result = await session.execute("screen_capture", {reason:"owner request"}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  assert.equal(result.ok,true);
  const task = session.finalize({response:"Captured the screen."});
  assert.equal(task.state,"delivered");
  assert.equal(task.metadata.origin,"jarvis-chat");
  const frames = f.fabric.store.events(0,100,task.id).filter(event=>event.type==="surface.frame");
  assert.equal(frames.length,1);
  assert.match(frames[0].payload.frameUrl,/^\/api\/action\/artifacts\//);
  const content = f.fabric.resolveArtifactContent(frames[0].payload.artifactId);
  assert.equal(content.filePath,f.frame);
  assert.equal(f.fabric.store.receipts(task.id)[0].status,"verified");
});

test("browser action records the real action and an automatic post-action screenshot under one task", async (t) => {
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"click the safe test button", requestId:"turn-2", sessionId:"owner", deviceId:"owner", source:"chat", route:{intent:"browser-action"} });
  await session.execute("browser_click", {selector:"#safe-fixture"}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task = session.finalize({response:"Clicked it."});
  assert.equal(task.state,"delivered");
  assert.deepEqual(f.calls.map(call=>call.tool),["browser_click","browser_screenshot"]);
  assert.ok(f.fabric.store.events(0,100,task.id).some(event=>event.type==="surface.frame"&&event.payload.phase==="after"));
});

test("failed capability cannot be presented as delivered", async (t) => {
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"run broken fixture", requestId:"turn-3", sessionId:"owner", deviceId:"owner", source:"chat", route:{intent:"action"} });
  await session.execute("broken_tool", {}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task = session.finalize({response:"It failed.",error:"fixture failure"});
  assert.equal(task.state,"failed");
  assert.equal(f.fabric.store.receipts(task.id)[0].status,"failed");
});

test("autonomous computer-use records every plan but captures only post-action frames", async (t) => {
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"click a safe fixture control", requestId:"turn-4", sessionId:"owner", deviceId:"owner", source:"chat", route:{intent:"computer-control"} });
  await session.execute("computer_use", {task:"click a safe fixture control"}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task=session.finalize({response:"Fixture clicked."});
  const events=f.fabric.store.events(0,200,task.id);
  assert.equal(task.state,"delivered");
  assert.equal(events.filter(event=>event.type==="agent.action").length,2);
  assert.equal(events.some(event=>event.type==="surface.frame"&&event.payload.phase==="planned-1"),false);
  assert.ok(events.some(event=>event.type==="surface.frame"&&event.payload.phase==="executed-1"));
});

test("background computer-use stays in Runtime instead of claiming visible delivery", async (t) => {
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"In the background, open Instagram and inspect Direct without showing a window", requestId:"turn-5", sessionId:"owner", deviceId:"owner", source:"chat", route:{intent:"browser-action"} });
  await session.execute("computer_use", {task:"open Instagram Direct"}, {sessionId:"owner",deviceId:"owner",source:"chat",placement:"runtime",surface:"managed-browser"});
  const task=session.finalize({response:"Inspected in the background."});
  assert.equal(task.state,"delivered");
  assert.equal(task.placement,"runtime");
  assert.equal(task.outcome.delivery,"runtime");
});

test("a failed task says WHY it failed, on the task itself", async (t) => {
  // 26 of 67 real tasks were in state "failed" and every single one reported the same three words,
  // "Execution failed", because that string was hard-coded at the task level. The actual reason was
  // recorded twice — in a step.failed event and on the receipt — and then dropped. Events are
  // capped and age out, so after the fact a run could be seen to have failed and never explained.
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"do the broken thing", requestId:"turn-fail", sessionId:"owner", deviceId:"owner", source:"chat" });
  await session.execute("broken_tool", {}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task = session.finalize({});

  assert.equal(task.state,"failed");
  assert.notEqual(task.currentStep,"Execution failed","the generic constant must not be all a failure reports");
  assert.match(task.currentStep,/fixture failure/,`currentStep should carry the capability's own reason, got: ${task.currentStep}`);
  assert.match(task.currentStep,/broken tool/,"and name the capability that failed");

  // Durable, structured, and independent of the event log.
  assert.equal(task.metadata.failure.failedSteps,1);
  assert.equal(task.metadata.failure.verifiedSteps,0);
  assert.equal(task.metadata.failure.reasons[0].tool,"broken_tool");
  assert.match(task.metadata.failure.reasons[0].reason,/fixture failure/);
});

test("a partial run explains itself too, and keeps every distinct reason", async (t) => {
  // A run that fails four different ways is a different defect from one that fails the same way
  // four times, and a count alone cannot tell them apart.
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"mixed run", requestId:"turn-partial", sessionId:"owner", deviceId:"owner", source:"chat" });
  await session.execute("screen_capture", {reason:"ok"}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  await session.execute("broken_tool", {}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task = session.finalize({});

  assert.equal(task.state,"partial");
  assert.match(task.currentStep,/fixture failure/,"a partial run must also say what went wrong");
  assert.equal(task.metadata.failure.verifiedSteps,1);
  assert.equal(task.metadata.failure.failedSteps,1);
});

test("the reason survives on the receipt even when events are gone", async (t) => {
  // The UI claimed "No detailed failure events were retained" while the receipt held the message.
  const f = fixture(); t.after(()=>{f.fabric.close();fs.rmSync(f.root,{recursive:true,force:true});});
  const session = createJarvisActionSession({ fabric:f.fabric, capabilityEngine:f.capabilityEngine, runtimeDir:f.root, prompt:"broken", requestId:"turn-receipt", sessionId:"owner", deviceId:"owner", source:"chat" });
  await session.execute("broken_tool", {}, {sessionId:"owner",deviceId:"owner",source:"chat"});
  const task = session.finalize({});
  const failedReceipt = f.fabric.store.receipts(task.id).find((item)=>item.status==="failed");
  assert.ok(failedReceipt,"a failed step must leave a receipt");
  assert.match(failedReceipt.error.message,/fixture failure/,"and that receipt must carry the reason");
});
