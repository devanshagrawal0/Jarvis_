"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {createActionFabric}=require("../../server/action-fabric");

function setup(t,extra={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-af-b-"));const fabric=createActionFabric({runtimeDir:dir,workspaceRoot:dir,...extra});t.after(()=>{fabric.close();fs.rmSync(dir,{recursive:true,force:true});});return fabric;}

test("Wave 3: surface epochs invalidate stale targets and observations",(t)=>{
  const fabric=setup(t);const surface=fabric.registry.register({id:"tab:1",kind:"browser-tab",label:"Inbox",accountHint:"owner@example.test"});
  const observation=fabric.registry.observe(surface.id,{source:"dom",confidence:0.99,payload:{title:"Inbox"},ttlMs:10_000});
  assert.equal(fabric.registry.current(surface.id).length,1);
  const navigated=fabric.registry.navigate(surface.id,{url:"https://example.test/next"});
  assert.equal(navigated.epoch,surface.epoch+1);
  assert.equal(fabric.registry.current(surface.id).length,0);
  assert.throws(()=>fabric.registry.assertTarget({surfaceId:surface.id,epoch:observation.epoch}),/stale/i);
});

test("Wave 3: registry handles 500 stable surfaces and reconnect cursor data",(t)=>{
  const fabric=setup(t);for(let i=0;i<500;i++)fabric.registry.register({id:`tab:${i}`,kind:"browser-tab",label:`Tab ${i}`});
  assert.equal(fabric.registry.list().length,500);
  const first=fabric.registry.observe("tab:499",{source:"dom",confidence:1,payload:{n:1},ttlMs:10000});
  const second=fabric.registry.observe("tab:499",{source:"accessibility",confidence:.9,payload:{n:2},ttlMs:10000});
  assert.deepEqual(fabric.store.observations("tab:499",first.seq).map(x=>x.seq),[second.seq]);
});

test("Wave 4: managed/background planes share semantic browser service without launching during status",async(t)=>{
  const calls=[];const browser={status:async()=>({url:"https://example.test",title:"Fixture",pageId:"p1",authenticated:true}),snapshot:async()=>({url:"https://example.test",title:"Fixture",pageId:"p1",elements:[{role:"button",name:"Go"}]}),pageBrief:async()=>({url:"https://example.test",title:"Fixture"}),navigate:async({url})=>({url,title:"Next"}),inspect:async()=>({found:true}),click:async(p)=>{calls.push(["click",p]);return {clicked:true};},type:async()=>({typed:true}),commit:async()=>({committed:true}),verify:async()=>({verified:true}),loginHandoff:async()=>({waitingForOwner:true})};
  const fabric=setup(t,{browserService:browser});
  assert.equal(fabric.status().browserPlanes.managed.available,true);
  const {surface}=await fabric.browser.syncManaged("background");assert.equal(surface.metadata.plane,"background");
  await fabric.browser.snapshot({surfaceId:surface.id});assert.equal(fabric.registry.current(surface.id)[0].source,"dom");
});

test("Wave 4: live bridge enrollment is explicit and secret is never persisted",(t)=>{
  const fabric=setup(t);assert.throws(()=>fabric.browser.connectLive({browser:"chrome"}),/owner approval/i);
  const connected=fabric.browser.connectLive({browser:"chrome",profileLabel:"Daily",ownerApproved:true,accountHint:"owner@example.test"});
  assert.ok(connected.enrollmentSecret.length>20);assert.equal(connected.surface.metadata.ownerApproved,true);
  const persisted=fabric.registry.get(connected.surface.id);assert.equal(JSON.stringify(persisted).includes(connected.enrollmentSecret),false);
  assert.equal(fabric.browser.capabilities().live.approvedConnections,1);
});

test("Wave 5: resolver exposes near ties instead of guessing and binds proven target to epoch",(t)=>{
  const fabric=setup(t);const surface=fabric.registry.register({id:"chat:fixture",kind:"browser-tab",label:"Instagram",accountHint:"me"});
  const ambiguous=fabric.resolver.resolve({surfaceId:surface.id,query:{name:"AJ",role:"link"},consequence:"external",candidates:[{name:"AJ",role:"link",sources:["dom","ocr"]},{name:"AJ",role:"link",sources:["dom","uia"]}]});
  assert.equal(ambiguous.status,"ambiguous");assert.equal(ambiguous.candidates.length,2);
  const resolved=fabric.resolver.resolve({surfaceId:surface.id,query:{name:"AJ",role:"link",accountHint:"me"},consequence:"read",candidates:[{name:"AJ",role:"link",accountHint:"me",sources:["dom","accessibility"]},{name:"AJ fan",role:"text",actionable:false,visible:false,fresh:false,sources:["ocr"]}]});
  assert.equal(resolved.status,"resolved");assert.equal(resolved.target.epoch,surface.epoch);
});

test("Wave 5: driver arbiter chooses native/semantic driver before mock fallback",(t)=>{
  const browser={status:async()=>({}),pageBrief:async()=>({url:"x"}),navigate:async()=>({}),inspect:async()=>({}),click:async()=>({}),type:async()=>({}),commit:async()=>({}),verify:async()=>({verified:true})};
  const fabric=setup(t,{browserService:browser});
  assert.equal(fabric.arbiter.choose({capability:"browser.semantic"}).name,"browser-dom");
  assert.equal(fabric.arbiter.choose({capability:"file.read"}).name,"filesystem");
  assert.equal(fabric.arbiter.choose({driver:"mock"}).name,"mock");
});
