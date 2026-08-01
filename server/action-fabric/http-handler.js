"use strict";

const fs = require("fs");
const path = require("path");
const { serializeError } = require("./contracts");

function mediaType(filePath){return ({".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".bmp":"image/bmp",".json":"application/json",".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8",".pdf":"application/pdf"})[path.extname(filePath).toLowerCase()]||"application/octet-stream";}

function routeMatch(pathname, pattern) {
  const keys=[];const source=pattern.replace(/:[A-Za-z][A-Za-z0-9_]*/g,(token)=>{keys.push(token.slice(1));return "([^/]+)";});
  const match=pathname.match(new RegExp(`^${source}$`));if(!match)return null;return Object.fromEntries(keys.map((key,index)=>[key,decodeURIComponent(match[index+1])]));
}

async function handleActionFabricRequest(ctx) {
  const {req,res,pathname,url,service,capabilityEngine,parseBody,sendJson,isDirectOwnerRequest}=ctx;
  if(!pathname.startsWith("/api/action"))return false;
  if(!service){sendJson(res,503,{error:"Action Fabric is unavailable."});return true;}
  const mutation=req.method!=="GET"&&req.method!=="HEAD";
  if(mutation&&!isDirectOwnerRequest(req)){sendJson(res,403,{error:"Direct owner access is required for Action Fabric mutations."});return true;}
  const body=mutation?await parseBody(req).catch(()=>({})):{};
  const reply=(status,payload)=>sendJson(res,status,payload);
  try {
    if(req.method==="GET"&&pathname==="/api/action/status"){reply(200,service.status());return true;}
    if(req.method==="POST"&&pathname==="/api/action/stop"){reply(200,service.stop.engage(body.reason));return true;}
    if(req.method==="POST"&&pathname==="/api/action/stop/release"){reply(200,service.stop.release(body.reason));return true;}
    if(req.method==="GET"&&pathname==="/api/action/tasks"){
      const states=(url.searchParams.get("states")||"").split(",").filter(Boolean);reply(200,{tasks:service.kernel.list({states,limit:url.searchParams.get("limit")})});return true;
    }
    if(req.method==="POST"&&pathname==="/api/action/tasks"){reply(201,{task:service.createTask(body)});return true;}
    let params=routeMatch(pathname,"/api/action/tasks/:taskId");
    if(params&&req.method==="GET"){reply(200,{task:service.kernel.get(params.taskId),receipts:service.store.receipts(params.taskId),artifacts:service.store.artifacts(params.taskId),approvals:service.store.pendingApprovals(params.taskId)});return true;}
    const taskActions={amend:(id)=>service.kernel.amend(id,body),pause:(id)=>service.kernel.pause(id,body.reason),resume:(id)=>service.kernel.resume(id),cancel:(id)=>{const task=service.kernel.cancel(id,body.reason);service.executor?.abort?.(id,body.reason||"Owner cancelled task");capabilityEngine?.cancelConfirmationsForTask?.(id);void capabilityEngine?.cancelAutomationTask?.(id);return task;},retry:(id)=>service.kernel.retry(id),takeover:(id)=>service.kernel.takeover(id),"give-back":(id)=>service.kernel.giveBack(id),deliver:(id)=>service.kernel.deliver(id,body)};
    for(const [action,fn] of Object.entries(taskActions)){params=routeMatch(pathname,`/api/action/tasks/:taskId/${action}`);if(params&&req.method==="POST"){reply(200,{task:fn(params.taskId)});return true;}}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/execute");
    if(params&&req.method==="POST"){reply(200,{receipt:await service.execute(params.taskId,body.step||body)});return true;}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/receipts");if(params&&req.method==="GET"){reply(200,{receipts:service.store.receipts(params.taskId)});return true;}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/artifacts");if(params&&req.method==="GET"){reply(200,{artifacts:service.store.artifacts(params.taskId)});return true;}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/artifacts");if(params&&req.method==="POST"){reply(201,{artifact:service.store.addArtifact({taskId:params.taskId,kind:body.kind||"file",label:body.label||"Artifact",uri:body.uri,metadata:body.metadata||{}})});return true;}
    params=routeMatch(pathname,"/api/action/artifacts/:artifactId/content");if(params&&req.method==="GET"){const content=service.resolveArtifactContent(params.artifactId);const stat=fs.statSync(content.filePath);res.writeHead(200,{"content-type":mediaType(content.filePath),"content-length":stat.size,"cache-control":"private, no-store","x-content-type-options":"nosniff"});fs.createReadStream(content.filePath).pipe(res);return true;}
    params=routeMatch(pathname,"/api/action/approvals/:approvalId/:decision");
    if(params&&req.method==="POST"&&["approve","reject"].includes(params.decision)){reply(200,{approval:service.kernel.decideApproval(params.approvalId,params.decision==="approve"?"approved":"rejected",body.token)});return true;}
    if(req.method==="GET"&&pathname==="/api/action/events"){
      const after=Number(url.searchParams.get("after"))||0;const events=service.store.events(after,Number(url.searchParams.get("limit"))||250,url.searchParams.get("taskId")||null);
      if((req.headers.accept||"").includes("text/event-stream")){
        res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive"});
        events.forEach(event=>res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));res.write(`event: cursor\ndata: ${JSON.stringify({cursor:events.at(-1)?.seq||after})}\n\n`);res.end();
      } else reply(200,{events,cursor:events.at(-1)?.seq||after});return true;
    }
    if(req.method==="GET"&&pathname==="/api/action/surfaces"){reply(200,{surfaces:service.registry.list()});return true;}
    if(req.method==="POST"&&pathname==="/api/action/surfaces"){reply(201,{surface:service.registry.register(body)});return true;}
    params=routeMatch(pathname,"/api/action/surfaces/:surfaceId/connect");if(params&&req.method==="POST"){reply(200,{surface:service.registry.connect(params.surfaceId)});return true;}
    params=routeMatch(pathname,"/api/action/surfaces/:surfaceId/disconnect");if(params&&req.method==="POST"){reply(200,{surface:service.registry.disconnect(params.surfaceId,body.reason)});return true;}
    params=routeMatch(pathname,"/api/action/surfaces/:surfaceId/observe");if(params&&req.method==="POST"){reply(201,{observation:service.registry.observe(params.surfaceId,body)});return true;}
    params=routeMatch(pathname,"/api/action/surfaces/:surfaceId/observations");if(params&&req.method==="GET"){reply(200,{observations:service.registry.current(params.surfaceId)});return true;}
    if(req.method==="GET"&&pathname==="/api/action/browser/planes"){reply(200,service.browser.capabilities());return true;}
    if(req.method==="POST"&&pathname==="/api/action/browser/managed/sync"){reply(200,await service.browser.syncManaged(body.plane||"managed"));return true;}
    if(req.method==="POST"&&pathname==="/api/action/browser/live/connect"){reply(201,service.browser.connectLive(body));return true;}
    params=routeMatch(pathname,"/api/action/browser/live/:bridgeId/disconnect");if(params&&req.method==="POST"){reply(200,{disconnected:service.browser.disconnectLive(params.bridgeId)});return true;}
    params=routeMatch(pathname,"/api/action/browser/:surfaceId/navigate");if(params&&req.method==="POST"){reply(200,await service.browser.navigate({surfaceId:params.surfaceId,...body}));return true;}
    params=routeMatch(pathname,"/api/action/browser/:surfaceId/snapshot");if(params&&req.method==="POST"){reply(200,await service.browser.snapshot({surfaceId:params.surfaceId,...body}));return true;}
    if(req.method==="POST"&&pathname==="/api/action/browser/login-handoff"){reply(200,await service.browser.loginHandoff(body));return true;}
    if(req.method==="POST"&&pathname==="/api/action/targets/resolve"){reply(200,service.resolver.resolve(body));return true;}
    if(req.method==="POST"&&pathname==="/api/action/route"){reply(200,service.router.classify(body));return true;}
    if(req.method==="POST"&&pathname==="/api/action/route/metrics"){const route=service.router.classify(body);reply(201,{route,...service.router.record(route,body.metrics||{})});return true;}
    if(req.method==="GET"&&pathname==="/api/action/automations"){reply(200,{automations:service.scheduler.list()});return true;}
    if(req.method==="POST"&&pathname==="/api/action/automations"){reply(201,{automation:service.scheduler.create(body)});return true;}
    params=routeMatch(pathname,"/api/action/automations/:automationId");if(params&&req.method==="PATCH"){reply(200,{automation:service.scheduler.update(params.automationId,body)});return true;}
    params=routeMatch(pathname,"/api/action/automations/:automationId/run");if(params&&req.method==="POST"){reply(200,service.scheduler.run(params.automationId,body.scheduledFor));return true;}
    if(req.method==="GET"&&pathname==="/api/action/procedures"){reply(200,{procedures:service.procedures.list()});return true;}
    if(req.method==="POST"&&pathname==="/api/action/procedures"){reply(201,{procedure:service.procedures.compile(body)});return true;}
    params=routeMatch(pathname,"/api/action/procedures/:procedureId/qualify");if(params&&req.method==="POST"){reply(200,{procedure:service.procedures.qualify(params.procedureId,body)});return true;}
    if(req.method==="GET"&&pathname==="/api/action/frontier/capabilities"){reply(200,service.frontier.capabilities());return true;}
    if(req.method==="POST"&&pathname==="/api/action/frontier/browser-shadow/start"){reply(200,await service.frontier.startBrowserShadow());return true;}
    if(req.method==="POST"&&pathname==="/api/action/frontier/ghost-run"){reply(200,service.frontier.ghostRun(body));return true;}
    if(req.method==="POST"&&pathname==="/api/action/frontier/counterfactual"){reply(200,service.frontier.counterfactual(body));return true;}
    if(req.method==="POST"&&pathname==="/api/action/frontier/dag/validate"){reply(200,service.frontier.validateDag(body));return true;}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/time-machine");if(params&&req.method==="GET"){reply(200,service.frontier.timeMachine(params.taskId,Number(url.searchParams.get("cursor"))||Number.MAX_SAFE_INTEGER));return true;}
    params=routeMatch(pathname,"/api/action/tasks/:taskId/time-machine/fork");if(params&&req.method==="POST"){reply(201,{task:service.frontier.fork(params.taskId,Number(body.cursor)||Number.MAX_SAFE_INTEGER,body)});return true;}
    if(req.method==="POST"&&pathname==="/api/action/frontier/ambient"){reply(200,service.frontier.setAmbient(body));return true;}
    if(req.method==="GET"&&pathname==="/api/action/release"){reply(200,service.release.status());return true;}
    if(req.method==="POST"&&pathname==="/api/action/release/benchmark"){reply(200,await service.release.benchmark());return true;}
    if(req.method==="POST"&&pathname==="/api/action/release/canary"){reply(200,service.release.setCanary(body.level));return true;}
    if(req.method==="POST"&&pathname==="/api/action/release/cutover"){reply(200,service.release.cutover());return true;}
    if(req.method==="GET"&&pathname==="/api/action/metrics"){reply(200,{metrics:service.store.metrics(url.searchParams.get("name"),Number(url.searchParams.get("limit"))||100)});return true;}
    reply(404,{error:"Unknown Action Fabric route."});return true;
  } catch(error) {
    const status=error?.code==="NOT_FOUND"?404:error?.code==="REVISION_CONFLICT"?409:400;
    reply(status,{error:error?.message||String(error),detail:serializeError(error)});return true;
  }
}

module.exports={handleActionFabricRequest};
