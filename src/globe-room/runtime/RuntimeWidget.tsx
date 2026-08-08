import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { JarvisMarkdown } from "../../JarvisMarkdown";
import type { SpatialWidgetMode } from "../SpatialWidgetFrame";
import "./RuntimeWidget.css";
import "./RuntimeApprovals.css";
import "./RuntimeControlPlane.css";
import "./RuntimeSimple.css";

type Task = { id:string; title:string; prompt:string; state:string; placement:string; effort:string; currentStep?:string; updatedAt:string; createdAt:string; revision:number; outcome?:{description?:string; successCriteria?:string[]; consequence?:number}; metadata?:Record<string,unknown> };
type EventItem = { seq:number; id:string; taskId?:string; type:string; payload?:Record<string,any>; createdAt:string };
type Detail = { task:Task; receipts:any[]; artifacts:any[]; approvals:any[] };
type RuntimeData = { status?:any; tasks?:Task[]; surfaces?:any[]; automations?:any[]; procedures?:any[]; events?:EventItem[]; metrics?:any[]; confirmations?:any[]; privateBrowser?:any; takeover?:any; __error?:string };
type Tab = "NOW"|"SCREEN"|"RESULTS"|"BROWSER"|"ADVANCED";

const TABS: {id:Tab; label:string; hint:string}[] = [
  {id:"NOW",label:"Current task",hint:"what is happening"},
  {id:"SCREEN",label:"Live screen",hint:"watch JARVIS"},
  {id:"RESULTS",label:"Results",hint:"proof and files"},
  {id:"BROWSER",label:"Account logins",hint:"connect websites"},
  {id:"ADVANCED",label:"Advanced",hint:"logs and diagnostics"},
];
const ACTIVE = new Set(["queued","planning","ready","running","waiting_approval","waiting_owner","paused","recovering","verified"]);
const TERMINAL = new Set(["delivered","partial","blocked","failed","cancelled"]);

function stateTone(value=""){if(["delivered","verified","connected","qualified","ready","completed"].includes(value))return"green";if(["failed","cancelled","disconnected","rejected","denied"].includes(value))return"red";if(["waiting_approval","waiting_owner","paused","partial","blocked","recovering"].includes(value))return"amber";return"cyan";}
function clip(value:any,max=120){const text=String(value??"").replace(/\s+/g," ");return text.length>max?`${text.slice(0,max-1)}…`:text;}
function time(value?:string){if(!value)return"—";try{return new Date(value).toLocaleTimeString([],{hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"});}catch{return"—";}}
function age(value?:string){if(!value)return"—";const seconds=Math.max(0,Math.floor((Date.now()-Date.parse(value))/1000));if(seconds<60)return`${seconds}s`;if(seconds<3600)return`${Math.floor(seconds/60)}m`;return`${Math.floor(seconds/3600)}h`;}
async function post(path:string,body:unknown={}){return api<any>(path,{method:"POST",body:JSON.stringify(body)});}

function State({value}:{value:string}){return <span className={`rt-state rt-${stateTone(value)}`}><i/>{value.replaceAll("_"," ")}</span>;}
function Empty({children}:{children:React.ReactNode}){return <div className="rt-empty"><b>NO VERIFIED DATA</b><span>{children}</span></div>;}

export function RuntimeMinimized({data,onRestore,onStop}:{data?:RuntimeData;onRestore:()=>void;onStop:()=>void}){
  const active=(data?.tasks||[]).filter(task=>ACTIVE.has(task.state));
  const stopped=Boolean(data?.status?.emergencyStop?.stopped);
  return <aside className="rt-pill"><button className="rt-pill-main" onClick={onRestore}><span className={`rt-beacon rt-${stopped?"red":"green"}`}/><strong>RUNTIME</strong><span>{stopped?"STOPPED":`${active.length} ACTIVE`}</span></button><button className="rt-pill-stop" onClick={onStop}>STOP</button></aside>;
}

export function RuntimeWidget({mode,initialData,onRefresh}:{mode:SpatialWidgetMode;initialData?:RuntimeData;onRefresh:()=>void}){
  const [data,setData]=useState<RuntimeData>(initialData||{});
  const [selectedId,setSelectedId]=useState("");
  const [detail,setDetail]=useState<Detail|null>(null);
  const [tab,setTab]=useState<Tab>("NOW");
  const [prompt,setPrompt]=useState("");
  const [busy,setBusy]=useState("");
  const [answer,setAnswer]=useState("");
  const [error,setError]=useState("");
  const [followLatest,setFollowLatest]=useState(true);
  const followLatestRef=useRef(true);

  const load = useCallback(async()=>{
    try{
      const [status,tasks,surfaces,automations,procedures,events,metrics,confirmations,privateBrowser,takeover]=await Promise.all([
        api<any>("/api/action/status"),api<any>("/api/action/tasks?limit=100"),api<any>("/api/action/surfaces"),api<any>("/api/action/automations"),api<any>("/api/action/procedures"),api<any>("/api/action/events?limit=600"),api<any>("/api/action/metrics?limit=100"),api<any>("/api/confirmations/pending").catch(()=>({confirmations:[]})),
        api<any>("/api/private-browser/status").catch((error:any)=>({ok:false,error:error?.message||"Private browser unavailable"})),
        api<any>("/api/desktop-takeover/status").catch((error:any)=>({ok:false,error:error?.message||"Desktop takeover unavailable",takeover:{phase:"offline",active:false}})),
      ]);
      const next={status,tasks:tasks.tasks||[],surfaces:surfaces.surfaces||[],automations:automations.automations||[],procedures:procedures.procedures||[],events:events.events||[],metrics:metrics.metrics||[],confirmations:confirmations.confirmations||[],privateBrowser,takeover};
      setData(next);setError("");
      if(next.tasks.length)setSelectedId(current=>(followLatestRef.current||!current)?next.tasks[0].id:current);
    }catch(e:any){setError(e?.message||"Runtime backend unavailable");}
  },[]);

  useEffect(()=>{void load();const active=(data.tasks||[]).some(task=>ACTIVE.has(task.state));const timer=window.setInterval(()=>void load(),active?1000:3000);return()=>window.clearInterval(timer);},[load,data.tasks]);
  useEffect(()=>{
    if(!selectedId){setDetail(null);return;}
    let current=true;
    setDetail(null);
    void api<Detail>(`/api/action/tasks/${encodeURIComponent(selectedId)}`)
      .then(next=>{if(current&&next?.task?.id===selectedId)setDetail(next);})
      .catch(()=>{if(current)setDetail(null);});
    return()=>{current=false;};
  },[selectedId,data.events]);

  const tasks=data.tasks||[];
  const taskGroups=useMemo(()=>{
    const groups=new Map<string,{task:Task;count:number}>();
    for(const task of tasks){
      const key=String(task.prompt||task.title).toLowerCase().replace(/\s+/g," ").trim();
      const current=groups.get(key);
      if(current)current.count+=1;
      else groups.set(key,{task,count:1});
    }
    return [...groups.values()].sort((a,b)=>Number(ACTIVE.has(b.task.state))-Number(ACTIVE.has(a.task.state))||Date.parse(b.task.updatedAt)-Date.parse(a.task.updatedAt)).slice(0,10);
  },[tasks]);
  const selected=detail?.task?.id===selectedId?detail.task:tasks.find(task=>task.id===selectedId);
  const selectedEvents=(data.events||[]).filter(event=>event.taskId===selectedId).slice().reverse();
  const frameEvents=selectedEvents.filter(event=>event.type==="surface.frame"&&event.payload?.frameUrl);
  const latestFrame=frameEvents[0];
  const running=tasks.filter(task=>ACTIVE.has(task.state)).length;
  const taskConfirmations=(data.confirmations||[]).filter(item=>item.actionTaskId===selectedId);
  const taskDuration=selected?Math.max(0,Date.parse(selected.updatedAt)-Date.parse(selected.createdAt)):0;
  const connectedSessions=(data.privateBrowser?.sessions||[]).filter((session:any)=>/^https?:\/\//i.test(String(session.origin||""))&&!/required|expired|failed/i.test(String(session.status||"")));
  const selectedFailed=selected?.state==="failed"||selected?.state==="blocked";
  const selectedDone=Boolean(selected&&["delivered","verified","completed"].includes(selected.state));
  const selectedWaiting=Boolean(selected&&(selected.state.startsWith("waiting")||selected.state==="paused"));
  const selectedHeadline=!selected?"Runtime ready":selectedFailed?"Task failed":selectedDone?"Task completed":selectedWaiting?"Action required":"Task in progress";
  const selectedTone=selectedFailed?"red":selectedWaiting?"amber":selectedDone?"green":"cyan";
  // This bar used to repeat the selected task's state and title — the third place on screen saying
  // it, after the widget frame's own header and the hero directly below. It now reports the fleet,
  // which nothing else does: how many are running, how many are stuck waiting on the owner, and how
  // many failed. Those counts are the reason to look at Runtime at all.
  const awaiting=tasks.filter(task=>task.state.startsWith("waiting")||task.state==="paused").length;
  const brokenCount=tasks.filter(task=>task.state==="failed"||task.state==="blocked").length;
  const fleetLine=[running?`${running} running`:"",awaiting?`${awaiting} awaiting you`:"",brokenCount?`${brokenCount} failed`:""].filter(Boolean).join(" · ")||"Nothing queued";
  const fleetTone=awaiting?"amber":brokenCount?"red":running?"cyan":"green";

  const runJarvis = async()=>{
    const instruction=prompt.trim();if(!instruction||busy)return;
    setBusy("jarvis");setError("");setAnswer("");
    try{
      const result=await post("/api/chat",{prompt:instruction,mode:"chat",strength:"balanced"});
      setAnswer(result.response||result.error||"JARVIS returned no response.");setPrompt("");
      if(result.actionTaskId){followLatestRef.current=true;setFollowLatest(true);setSelectedId(result.actionTaskId);setTab("NOW");}
      await load();onRefresh();
    }catch(e:any){setError(e?.message||"JARVIS command failed");}
    finally{setBusy("");}
  };
  const act = async(key:string,path:string,body:unknown={})=>{setBusy(key);setError("");try{await post(path,body);await load();onRefresh();}catch(e:any){setError(e?.message||"Runtime action failed");}finally{setBusy("");}};

  return <div className={`rt-console rt-v2 rt-${mode}`}>
    <header className="rt-v2-head">
      <div className="rt-v2-brand"><span className={`rt-v2-activity-dot rt-${fleetTone}`}/><div><strong>{fleetLine}</strong><small>{tasks.length?`${tasks.length} tasks tracked`:"No tasks yet"}</small></div></div>
      <div className="rt-v2-head-actions">
        <button className="rt-v2-account" onClick={()=>setTab("BROWSER")}><i className={connectedSessions.length?"online":""}/>{connectedSessions.length?`${connectedSessions.length} connected`:"Connect accounts"}</button>
        {data.status?.emergencyStop?.stopped?<button className="rt-v2-release" onClick={()=>void act("release","/api/action/stop/release",{reason:"Owner resumed Runtime"})}>Resume Runtime</button>:running>0?<button className="rt-v2-stop" onClick={()=>void act("stop","/api/action/stop",{reason:"Owner stopped all Runtime work"})}>Stop all</button>:null}
      </div>
    </header>

    <nav className="rt-v2-tabs">{TABS.map(item=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}><strong>{item.label}</strong><small>{item.hint}</small></button>)}</nav>
    {(error||data.__error)&&<div className="rt-v2-error"><strong>Runtime needs attention</strong><span>{error||data.__error}</span></div>}

    <main className="rt-v2-workspace">
      <aside className="rt-v2-tasks">
        <header><div><strong>Tasks</strong><span>{taskGroups.length} recent conversations</span></div><button onClick={()=>{followLatestRef.current=true;setFollowLatest(true);setDetail(null);if(tasks[0])setSelectedId(tasks[0].id);}}>Latest</button></header>
        <div className="rt-v2-task-list">{taskGroups.map(({task,count})=><button key={task.id} className={task.id===selectedId?"selected":""} onClick={()=>{followLatestRef.current=false;setFollowLatest(false);setDetail(null);setSelectedId(task.id);setTab("NOW");}}><i className={`rt-dot rt-${stateTone(task.state)}`}/><div><strong>{clip(task.title||task.prompt,72)}</strong><span>{task.currentStep||task.outcome?.description||"No current step"}</span><small>{task.state.replaceAll("_"," ")} · {age(task.updatedAt)} ago</small></div>{count>1&&<b>{count} attempts</b>}</button>)}{!taskGroups.length&&<Empty>Your JARVIS tasks will appear here.</Empty>}</div>
      </aside>

      <section className="rt-v2-main">
        {tab==="NOW"&&<div className="rt-v2-now">{taskConfirmations.map(item=><section className="rt-approval" key={item.id}><div><span>APPROVAL NEEDED</span><strong>{String(item.tool||"action").replaceAll("_"," ")}</strong><p>{Object.entries(item.summary||{}).map(([key,value])=>`${key}: ${String(value)}`).join(" · ")||"Review the prepared action before JARVIS continues."}</p></div><div><button className="approve" disabled={Boolean(busy)} onClick={()=>void act(`approve-${item.id}`,`/api/confirmations/${item.id}/approve`,{ownerChallenge:item.ownerChallenge})}>Approve and continue</button><button className="danger" disabled={Boolean(busy)} onClick={()=>void act(`deny-${item.id}`,`/api/confirmations/${item.id}/deny`,{ownerChallenge:item.ownerChallenge})}>Deny</button></div></section>)}<CurrentTask selected={selected} events={selectedEvents} detail={detail} duration={taskDuration} busy={busy} onAct={act} onOpenLive={()=>setTab("SCREEN")} onOpenResults={()=>setTab("RESULTS")} onOpenAccounts={()=>setTab("BROWSER")}/></div>}
        {tab==="SCREEN"&&<Live selected={selected} frame={latestFrame} frames={frameEvents} events={selectedEvents} takeover={data.takeover?.takeover} privateBrowser={data.privateBrowser} busy={busy} onAct={act}/>} 
        {tab==="RESULTS"&&<Evidence detail={detail}/>} 
        {tab==="BROWSER"&&<BrowserSetup browser={data.privateBrowser||{}} busy={busy} onAct={act}/>} 
        {tab==="ADVANCED"&&<div className="rt-v2-advanced"><details open><summary>Task details</summary><Mission selected={selected} events={selectedEvents} detail={detail} busy={busy} onAct={act}/></details><details><summary>Technical timeline</summary><Timeline events={selectedEvents}/></details><details><summary>System diagnostics</summary><System data={data} busy={busy} onAct={act}/></details></div>}
      </section>
    </main>

    {answer&&<div className="rt-answer"><b>JARVIS</b><JarvisMarkdown text={answer}/><button onClick={()=>setAnswer("")}>×</button></div>}
    <footer className="rt-v2-command"><input value={prompt} onChange={event=>setPrompt(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")void runJarvis();}} placeholder="Tell JARVIS what to do next…"/><button disabled={!prompt.trim()||Boolean(busy)} onClick={()=>void runJarvis()}>{busy==="jarvis"?"Working…":"Run"}</button></footer>
  </div>;

}

function eventCopy(event?:EventItem){
  if(!event)return"No activity has been recorded yet.";
  const payload=event.payload||{};
  const error=typeof payload.error==="string"?payload.error:payload.error?.message;
  if(error)return String(error);
  return String(payload.detail||payload.reason||payload.currentStep||payload.tool||event.type.replaceAll("."," "));
}

function CurrentTask({selected,events,detail,duration,busy,onAct,onOpenLive,onOpenResults,onOpenAccounts}:{selected?:Task;events:EventItem[];detail:Detail|null;duration:number;busy:string;onAct:(key:string,path:string,body?:unknown)=>Promise<void>;onOpenLive:()=>void;onOpenResults:()=>void;onOpenAccounts:()=>void}){
  if(!selected)return <div className="rt-v2-welcome"><span>R</span><h2>Runtime is ready</h2><p>Ask JARVIS to complete a task. You will see its progress, live screen, approvals, and finished files here.</p></div>;
  const failed=selected.state==="failed"||selected.state==="blocked";
  const done=["delivered","verified","completed"].includes(selected.state);
  const waiting=selected.state.startsWith("waiting");
  const latestFailure=events.find(event=>event.type.includes("fail")||event.payload?.error);
  const headline=failed?"Couldn’t finish this task":done?"Task completed":waiting?"JARVIS needs you":selected.state==="paused"?"Task paused":"JARVIS is working";
  const explanation=failed?eventCopy(latestFailure)||selected.currentStep||"The task stopped before completion.":selected.currentStep||eventCopy(events[0]);
  const receipts=detail?.receipts||[];
  const artifacts=detail?.artifacts||[];
  const verifiedCount=receipts.filter((item:any)=>item.status==="verified").length;
  // What the task IS goes in the headline; what happened to it is the subline.
  //
  // It used to be the other way round: the largest text on the panel read "Couldn't finish this
  // task", which the FAILED badge beside it and the widget's own header above it had already said —
  // the same fact three times — while the only line identifying which task this was sat in a
  // separate "Your request" panel underneath. And that panel is redundant whenever the title is
  // just the prompt, which is the normal case.
  const asked=(selected.prompt||"").trim();
  const title=(selected.title||"").trim();
  // `title` arrives already truncated with an ellipsis, so no amount of CSS clamping can reveal the
  // rest of it — the missing words are not in the DOM. `prompt` is the full text; the headline uses
  // it and lets the two-line clamp do the shortening, which at least breaks on a word boundary.
  const headlineText=asked||title||headline;
  // "No detailed failure events were retained" was not true. Events are capped and age out, but the
  // reason is also written to the failing step's RECEIPT, which is durable, and (now) onto the task
  // itself. Read those before claiming nothing was kept — a UI that says the evidence is gone while
  // holding it is worse than one that says nothing.
  const failureNotes=(()=>{
    const stored=(selected.metadata as any)?.failure?.reasons;
    if(Array.isArray(stored)&&stored.length)return stored.map((item:any)=>({reason:String(item?.reason||"Unexplained failure"),tool:String(item?.tool||"capability").replaceAll("_"," ")})).slice(0,5);
    return receipts
      .filter((item:any)=>item?.status!=="verified"&&item?.error?.message)
      .map((item:any)=>({reason:String(item.error.message),tool:String(item.driver||"capability").replace(/^capability:/,"").replaceAll("_"," ")}))
      .slice(0,5);
  })();
  return <div className={`rt-v2-current rt-v2-current--${stateTone(selected.state)}`}>
    <section className="rt-v2-hero"><div className="rt-v2-status-icon"><i/></div><div className="rt-v2-hero-copy"><div><State value={selected.state}/><span className="rt-v2-elapsed">{duration?`${Math.max(1,Math.round(duration/1000))}s elapsed`:age(selected.createdAt)}</span></div><h2>{headlineText}</h2><p>{explanation===headline?explanation:`${headline} — ${explanation}`}</p></div></section>
        <div className="rt-v2-current-grid">
      <section className="rt-v2-progress"><header><div><span>Latest activity</span><strong>{events.length?`${events.length} updates`:done?"Run completed":failed?"No action log":"Waiting to start"}</strong></div>{events.length>0&&<button onClick={onOpenLive}>Open live view</button>}</header><div>{events.slice(0,5).map(event=><article key={event.id}><i className={`rt-dot rt-${stateTone(event.type.split(".").at(-1))}`}/><div><strong>{eventCopy(event)}</strong><small>{time(event.createdAt)}</small></div></article>)}{!events.length&&failureNotes.map((note,index)=><article key={`fail-${index}`}><i className="rt-dot rt-red"/><div><strong>{note.reason}</strong><small>{note.tool}</small></div></article>)}{!events.length&&!failureNotes.length&&<p className="rt-v2-muted">{done?"This completed run did not retain a detailed action log.":failed?"No capability reported a reason for this failure.":"No execution activity yet."}</p>}</div></section>
      <aside className="rt-v2-proof"><span>Output</span><div><strong data-zero={verifiedCount===0}>{verifiedCount}</strong><small>verified actions</small></div><div><strong data-zero={artifacts.length===0}>{artifacts.length}</strong><small>files and captures</small></div>{(receipts.length>0||artifacts.length>0)&&<button onClick={onOpenResults}>View results</button>}</aside>
    </div>
    <footer className="rt-v2-task-actions">{!TERMINAL.has(selected.state)&&selected.state!=="paused"&&<button onClick={()=>void onAct("pause",`/api/action/tasks/${selected.id}/pause`,{reason:"Owner paused in Runtime"})}>Pause</button>}{selected.state==="paused"&&<button className="primary" onClick={()=>void onAct("resume",`/api/action/tasks/${selected.id}/resume`)}>Resume</button>}{failed&&<button className="primary" onClick={onOpenAccounts}>Check account login</button>}{!TERMINAL.has(selected.state)&&<button className="danger" disabled={Boolean(busy)} onClick={()=>void onAct("cancel",`/api/action/tasks/${selected.id}/cancel`,{reason:"Owner cancelled in Runtime"})}>Cancel task</button>}</footer>
  </div>;
}

function BrowserSetup({browser,busy,onAct}:{browser:any;busy:string;onAct:(key:string,path:string,body?:unknown)=>Promise<void>}){
  const targets=[
    {name:"Instagram",host:"instagram.com",url:"https://www.instagram.com/",description:"Messages, profiles, posts and research"},
    {name:"Gmail",host:"mail.google.com",url:"https://mail.google.com/",description:"Email and attachments"},
    {name:"WhatsApp",host:"web.whatsapp.com",url:"https://web.whatsapp.com/",description:"Chats and file sharing"},
    {name:"GitHub",host:"github.com",url:"https://github.com/",description:"Repositories, issues and code"},
    {name:"Canvas",host:"instructure.com",url:"https://northeastern.instructure.com/",description:"Courses and assignments"},
    {name:"LinkedIn",host:"linkedin.com",url:"https://www.linkedin.com/",description:"Profiles and professional tasks"},
  ];
  const sessions=(browser.sessions||[]).filter((session:any)=>/^https?:\/\//i.test(String(session.origin||"")));
  const loginOpen=browser.visibleReason==="login"||browser.loginHandoffActive;
  return <div className="rt-v2-browser">
    <header className="rt-v2-browser-head"><div><span className="rt-v2-eyebrow">Private browser</span><h2>{loginOpen?"Finish signing in":"Connect your accounts"}</h2><p>Sign in once inside JARVIS’s separate browser. Later tasks can run quietly in the background without using your personal Chrome.</p></div><span className={`rt-v2-browser-state ${browser.ok===false?"error":browser.running?"running":"ready"}`}>{browser.ok===false?"Unavailable":loginOpen?"Login window open":browser.running?"Browser running":"Ready"}</span></header>
    {loginOpen&&<section className="rt-v2-login-callout"><div><strong>Complete the login in the browser window</strong><span>When the website is fully open, return here and confirm.</span></div><button className="primary" disabled={Boolean(busy)} onClick={()=>void onAct("login-complete","/api/private-browser/login/complete",{})}>I’m signed in</button><button disabled={Boolean(busy)} onClick={()=>void onAct("browser-background","/api/private-browser/background",{})}>Hide window</button></section>}
    <section className="rt-v2-services">{targets.map(target=>{const session=sessions.find((item:any)=>String(item.origin||"").includes(target.host));const connected=Boolean(session&&!/required|expired|failed/i.test(session.status||""));return <article key={target.name}><span className="rt-v2-service-icon">{target.name.slice(0,1)}</span><div><strong>{target.name}</strong><p>{target.description}</p><small className={connected?"connected":""}>{connected?`Connected · checked ${age(session.checkedAt)} ago`:"Not connected"}</small></div><button disabled={Boolean(busy)||loginOpen} onClick={()=>void onAct(`login-${target.name}`,"/api/private-browser/login/start",{url:target.url})}>{connected?"Reconnect":"Sign in"}</button></article>})}</section>
    <details className="rt-v2-browser-details"><summary>Browser details</summary><dl><dt>Mode</dt><dd>{browser.headless?"Background":"Visible"}</dd><dt>Background tabs</dt><dd>{browser.tabs?.length||0}</dd><dt>Learned routes</dt><dd>{browser.learning?.entries||0}</dd><dt>Personal Chrome</dt><dd>Never accessed</dd><dt>Profile</dt><dd>{browser.profileDir||"Ready on first launch"}</dd></dl><button className="danger" disabled={Boolean(busy)} onClick={()=>void onAct("browser-stop","/api/private-browser/stop",{})}>Stop private browser</button></details>
  </div>;
}

function Mission({selected,events,detail,busy,onAct}:{selected?:Task;events:EventItem[];detail:Detail|null;busy:string;onAct:(key:string,path:string,body?:unknown)=>Promise<void>}){
  if(!selected)return <Empty>No task selected.</Empty>;
  return <div className="rt-mission"><header className="rt-panel-head"><div><span>MISSION CONTROL</span><strong>{selected.title}</strong></div><State value={selected.state}/></header><div className="rt-mission-grid"><article><span>OWNER INTENT</span><p>{selected.prompt}</p></article><article><span>CURRENT CHECKPOINT</span><p>{selected.currentStep||"No executor checkpoint recorded."}</p></article><article><span>DELIVERY CONTRACT</span><p>{selected.placement.toUpperCase()} · consequence L{selected.outcome?.consequence||0} · {selected.effort.toUpperCase()}</p></article><article><span>CAUSAL PROOF</span><p>{detail?.receipts?.filter(r=>r.status==="verified").length||0} verified of {detail?.receipts?.length||0} receipts · {detail?.artifacts?.length||0} artifacts</p></article></div><section className="rt-criteria"><header><span>SUCCESS CRITERIA</span></header>{(selected.outcome?.successCriteria||[]).map((item,index)=><div key={index}><i/>{item}</div>)}{!selected.outcome?.successCriteria?.length&&<Empty>No explicit success criteria were recorded.</Empty>}</section><section className="rt-recent"><header><span>LATEST EXECUTION SIGNALS</span><b>{events.length}</b></header>{events.slice(0,10).map(event=><div key={event.id}><time>{time(event.createdAt)}</time><i className={`rt-dot rt-${stateTone(event.type.split(".").at(-1))}`}/><strong>{event.type}</strong><span>{clip(event.payload?.detail||event.payload?.tool||event.payload?.reason||event.payload?.state||"",90)}</span></div>)}</section><div className="rt-task-actions">{!TERMINAL.has(selected.state)&&selected.state!=="paused"&&<button onClick={()=>void onAct("pause",`/api/action/tasks/${selected.id}/pause`,{reason:"Owner paused in Runtime"})}>PAUSE</button>}{selected.state==="paused"&&<button onClick={()=>void onAct("resume",`/api/action/tasks/${selected.id}/resume`)}>RESUME</button>}{!TERMINAL.has(selected.state)&&<button className="danger" disabled={Boolean(busy)} onClick={()=>void onAct("cancel",`/api/action/tasks/${selected.id}/cancel`,{reason:"Owner cancelled in Runtime"})}>CANCEL</button>}</div></div>;
}

function Live({selected,frame,frames,events,takeover,privateBrowser,busy,onAct}:{selected?:Task;frame?:EventItem;frames:EventItem[];events:EventItem[];takeover?:any;privateBrowser?:any;busy:string;onAct:(key:string,path:string,body?:unknown)=>Promise<void>}){
  const liveSteps=events.filter(event=>event.type.startsWith("step.")||event.type.startsWith("surface.")||event.type==="agent.action"||event.type.startsWith("approval.")).slice(0,24);
  const takeoverActive=Boolean(takeover?.active);
  const takeoverPaused=takeover?.phase==="paused";
  return <div className="rt-live">
    <header className="rt-panel-head"><div><span>TASK-BOUND VISUAL CHANNEL</span><strong>{selected?.title||"NO TASK SELECTED"}</strong></div><State value={takeoverActive?takeover.phase:(selected?.state||"idle")}/></header>
    <section className={`rt-takeover-control ${takeoverActive?"active":""}`}>
      <div className="rt-takeover-ident"><span>{takeoverActive?"DESKTOP TAKEOVER LIVE":"SHADOW EXECUTION PLANE"}</span><strong>{takeoverActive?(takeover.action||takeover.phase):privateBrowser?.running?"PRIVATE BROWSER RUNNING HEADLESS":"PRIVATE BROWSER READY"}</strong><small>{takeoverActive?(takeover.detail||takeover.objective):"Authenticated web work runs away from your personal Chrome and does not steal focus."}</small></div>
      <div className="rt-takeover-metrics"><div><span>MODE</span><b>{takeoverActive?String(takeover.mode||"takeover").toUpperCase():"SHADOW"}</b></div><div><span>STEP</span><b>{takeoverActive?takeover.step||0:privateBrowser?.tabs?.length||0}</b></div><div><span>PROFILE</span><b>{privateBrowser?.personalChromeAccess===false?"ISOLATED":"PRIVATE"}</b></div></div>
      {takeoverActive&&<div className="rt-takeover-actions"><button disabled={Boolean(busy)} onClick={()=>void onAct("takeover-pause",`/api/desktop-takeover/${takeoverPaused?"resume":"pause"}`,{reason:`Owner ${takeoverPaused?"resumed":"paused"} desktop control in Runtime`})}>{takeoverPaused?"RESUME":"PAUSE"}</button><button disabled={Boolean(busy)} onClick={()=>void onAct("takeover-handback","/api/desktop-takeover/hand-back",{reason:"Owner requested immediate control hand-back"})}>HAND BACK</button><button className="danger" disabled={Boolean(busy)} onClick={()=>void onAct("takeover-cancel","/api/desktop-takeover/cancel",{reason:"Owner emergency-stopped desktop takeover"})}>STOP TAKEOVER</button></div>}
    </section>
    <div className="rt-live-layout"><section className="rt-frame-stage"><div className="rt-frame-head"><span>{frame?`FRAME #${frame.seq} · ${frame.payload?.tool||"visual"} · ${frame.payload?.phase||"observation"}`:"NO TASK FRAME"}</span><b>{frame?time(frame.createdAt):"—"}</b></div><div className="rt-frame">{frame?.payload?.frameUrl?<img key={frame.seq} src={`${frame.payload.frameUrl}?v=${frame.seq}`} alt={`Live evidence for ${selected?.title||"selected task"}`}/>:<Empty>This selected task has not emitted a real screenshot. Runtime never substitutes an unrelated desktop preview.</Empty>}<div className="rt-reticle"><i/><i/></div>{frame&&<span className="rt-frame-proof">TASK {selected?.id} · ACTION-BOUND FRAME</span>}</div><div className="rt-frame-strip">{frames.slice(0,8).map(item=><div key={item.id} className={item.id===frame?.id?"active":""}><span>#{item.seq}</span><strong>{item.payload?.phase||"frame"}</strong><small>{time(item.createdAt)}</small></div>)}</div></section><aside className="rt-action-feed"><header><span>LIVE ACTION FEED</span><b>{liveSteps.length}</b></header>{liveSteps.map(event=><article key={event.id}><div><i className={`rt-dot rt-${stateTone(event.type.split(".").at(-1))}`}/><time>{time(event.createdAt)}</time></div><strong>{event.type}</strong><span>{event.payload?.tool||event.payload?.detail||"runtime observation"}</span><small>{event.payload?.plannerLatencyMs?`${event.payload.plannerModel||"planner"} · ${event.payload.plannerLatencyMs}ms`:(event.payload?.stepId||`event #${event.seq}`)}</small></article>)}{!liveSteps.length&&<Empty>No real tool action has started for this task.</Empty>}</aside></div>
  </div>;
}

function Timeline({events}:{events:EventItem[]}){return <div className="rt-timeline"><header className="rt-panel-head"><div><span>IMMUTABLE TASK LEDGER</span><strong>{events.length} EVENTS</strong></div></header><div className="rt-table"><div className="rt-table-head"><span>SEQ / TIME</span><span>EVENT</span><span>ACTION / TARGET</span><span>DETAIL</span></div>{events.map(event=><div key={event.id}><span><b>#{event.seq}</b><small>{time(event.createdAt)}</small></span><span><i className={`rt-dot rt-${stateTone(event.type.split(".").at(-1))}`}/><strong>{event.type}</strong></span><code>{event.payload?.tool||event.payload?.stepId||"task"}</code><span>{clip(event.payload?.detail||event.payload?.reason||event.payload?.error?.message||JSON.stringify(event.payload||{}),180)}</span></div>)}{!events.length&&<Empty>No events exist for the selected task.</Empty>}</div></div>}

function Evidence({detail}:{detail:Detail|null}){const receipts=detail?.receipts||[];const artifacts=detail?.artifacts||[];return <div className="rt-evidence"><section><header className="rt-panel-head"><div><span>CAUSAL RECEIPTS</span><strong>{receipts.filter((r:any)=>r.status==="verified").length}/{receipts.length} VERIFIED</strong></div></header><div className="rt-card-grid">{receipts.slice().reverse().map((receipt:any)=><article key={receipt.id}><div><State value={receipt.status}/><time>{time(receipt.createdAt)}</time></div><strong>{receipt.proof?.method||receipt.error?.message||"Outcome not proven"}</strong><p>{receipt.target?.capability||receipt.target?.targetId||"Unknown target"}</p><dl><dt>DRIVER</dt><dd>{receipt.driver||"—"}</dd><dt>STEP</dt><dd>{clip(receipt.stepId,34)}</dd><dt>PROVIDER RECEIPT</dt><dd>{receipt.proof?.providerObjectId||"—"}</dd></dl></article>)}{!receipts.length&&<Empty>No receipt exists, so this task cannot truthfully claim completion.</Empty>}</div></section><aside><header className="rt-panel-head"><div><span>ARTIFACT LINEAGE</span><strong>{artifacts.length} OUTPUTS</strong></div></header>{artifacts.slice().reverse().map((artifact:any)=><a key={artifact.id} href={artifact.kind==="frame"?`/api/action/artifacts/${artifact.id}/content`:artifact.uri} target="_blank" rel="noreferrer"><span>{artifact.kind.toUpperCase()}</span><strong>{artifact.label}</strong><small>{artifact.metadata?.tool||"task output"} · {artifact.metadata?.bytes||0} bytes</small><code>{artifact.id}</code></a>)}{!artifacts.length&&<Empty>No screenshots or files are attached to this task.</Empty>}</aside></div>}

function System({data,busy,onAct}:{data:RuntimeData;busy:string;onAct:(key:string,path:string,body?:unknown)=>Promise<void>}){
  const drivers=data.status?.drivers||[];
  const surfaces=data.surfaces||[];
  const browser=data.privateBrowser||{};
  const takeover=data.takeover?.takeover||{};
  const loginTargets=[["INSTAGRAM","https://www.instagram.com/"],["GMAIL","https://mail.google.com/"],["WHATSAPP","https://web.whatsapp.com/"],["GITHUB","https://github.com/"],["CANVAS","https://northeastern.instructure.com/"],["LINKEDIN","https://www.linkedin.com/"]];
  return <div className="rt-system">
    <section><header className="rt-panel-head"><div><span>REAL DRIVER MATRIX</span><strong>{drivers.filter((d:any)=>d.available).length}/{drivers.length} AVAILABLE</strong></div></header>{drivers.map((driver:any)=><article key={driver.name}><State value={driver.available?"connected":"disconnected"}/><div><strong>{driver.name}</strong><span>{driver.kind} · priority {driver.priority}</span><small>{(driver.capabilities||[]).join(" · ")||"no declared capabilities"}</small></div></article>)}</section>
    <section><header className="rt-panel-head"><div><span>SURFACE REGISTRY</span><strong>{surfaces.length} BOUND SURFACES</strong></div></header>{surfaces.map((surface:any)=><article key={surface.id}><State value={surface.state}/><div><strong>{surface.label}</strong><span>{surface.kind} · epoch {surface.epoch}</span><small>{surface.metadata?.url||surface.accountHint||surface.id}</small></div></article>)}{!surfaces.length&&<Empty>No managed browser, physical window, or device surface is registered.</Empty>}</section>
    <section className="rt-private-browser"><header className="rt-panel-head"><div><span>JARVIS PRIVATE BROWSER</span><strong>{browser.ok===false?"OFFLINE":browser.visibleReason==="login"?"LOGIN WINDOW OPEN":browser.visibleReason==="delivery"?"RESULT PRESENTED":browser.state==="error"?"START FAILED":browser.headless?"SHADOW MODE READY":"VISIBLE MODE"}</strong></div><State value={browser.ok===false||browser.state==="error"?"disconnected":browser.loginHandoffActive?"waiting_owner":"connected"}/></header><p>This profile belongs only to JARVIS. Sign in once when needed; the same browser profile is reused headlessly for later tasks. It never attaches to your personal Chrome.</p><div className="rt-login-targets">{loginTargets.map(([label,url])=><button key={label} disabled={Boolean(busy)||Boolean(browser.loginHandoffActive)} onClick={()=>void onAct(`login-${label}`,"/api/private-browser/login/start",{url})}>LOGIN {label}</button>)}<button className="complete" disabled={Boolean(busy)||browser.visibleReason!=="login"} onClick={()=>void onAct("login-complete","/api/private-browser/login/complete",{})}>COMPLETE LOGIN</button>{browser.loginHandoffActive&&<button disabled={Boolean(busy)} onClick={()=>void onAct("browser-background","/api/private-browser/background",{})}>RETURN TO BACKGROUND</button>}<button className="danger" disabled={Boolean(busy)} onClick={()=>void onAct("browser-stop","/api/private-browser/stop",{})}>STOP BROWSER</button></div><dl><dt>PROFILE</dt><dd>{browser.profileDir||"not started"}</dd><dt>BROWSER STATE</dt><dd>{String(browser.state||"stopped").replaceAll("_"," ").toUpperCase()}</dd><dt>VISIBLE WINDOW</dt><dd>{browser.loginHandoffActive?`YES — ${browser.visibleReason||"owner handoff"}`:"NO"}</dd><dt>BACKGROUND TABS</dt><dd>{browser.tabs?.length||0} · {browser.tasks?.length||0} task-owned</dd><dt>SESSION RECORDS</dt><dd>{browser.sessions?.length||0} checked origins</dd><dt>LEARNED ROUTES</dt><dd>{browser.learning?.entries||0} · {browser.learning?.successes||0} effective · {browser.learning?.failures||0} avoided</dd><dt>LAST START</dt><dd>{browser.launchedAt?`${time(browser.launchedAt)} · ${age(browser.launchedAt)} ago`:"not started"}</dd><dt>RESTARTS</dt><dd>{browser.restartCount||0}</dd><dt>PERSONAL CHROME</dt><dd>NEVER ATTACHED</dd>{browser.lastLaunchError&&<><dt>LAST ERROR</dt><dd>{clip(browser.lastLaunchError,180)}</dd></>}</dl>{Boolean(browser.sessions?.length)&&<div className="rt-browser-sessions">{browser.sessions.slice(0,8).map((session:any)=><article key={session.origin}><State value={session.status}/><div><strong>{session.origin}</strong><span>{session.reason||"Session checked"}</span><small>{age(session.checkedAt)} ago</small></div></article>)}</div>}</section>
    <section className="rt-control-modes"><header className="rt-panel-head"><div><span>DESKTOP CONTROL MODES</span><strong>{String(takeover.phase||"idle").toUpperCase()}</strong></div><State value={takeover.active?takeover.phase:"ready"}/></header><article><b>01</b><div><strong>SHADOW BROWSER</strong><span>Invisible web automation in the JARVIS profile</span></div></article><article><b>02</b><div><strong>ASSIST OVERLAY</strong><span>Shows targets and guidance without controlling input</span></div></article><article><b>03</b><div><strong>DESKTOP TAKEOVER</strong><span>Attended keyboard and pointer control with pause, cancel, and hand-back</span></div></article><article className="future"><b>04</b><div><strong>ISOLATED DESKTOP</strong><span>Future VM/session lane for invisible native-app automation</span></div></article></section>
    <section className="rt-plane-grid"><article><span>PRIVATE BROWSER</span><strong>{browser.ok===false?"OFFLINE":browser.headless?"HEADLESS":"VISIBLE"}</strong><small>isolated persistent profile</small></article><article><span>DESKTOP TAKEOVER</span><strong>{String(takeover.phase||"IDLE").toUpperCase()}</strong><small>Ctrl+Alt+Space pause · Ctrl+Alt+Esc stop</small></article><article><span>ACTION AUTHORITY</span><strong>{String(data.status?.flags?.actionAuthority||"canary").toUpperCase()}</strong><small>release gate</small></article><article><span>EMERGENCY STOP</span><strong>{data.status?.emergencyStop?.stopped?"ENGAGED":"ARMED"}</strong><small>owner-controlled kill switch</small></article></section>
  </div>;
}
