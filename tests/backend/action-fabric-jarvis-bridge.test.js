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
