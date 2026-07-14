// The live Mission Forge console served at /eclipse. Self-contained (inline CSS/JS); talks to
// /api/eclipse/* on the same origin, so EventSource (SSE) and fetch work with no CORS/build step.
function renderConsole() {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Eclipse · Mission Forge</title><style>
:root{--bg:#0a0c12;--panel:#11141d;--line:#232838;--ink:#e7ecf5;--dim:#8a93a8;--accent:#5ed6ff;--accent2:#a78bfa;--good:#4ade80;--warn:#fbbf24;--bad:#f87171;--mono:ui-monospace,Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans)}
.wrap{max-width:1180px;margin:0 auto;padding:22px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}.dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
h1{font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.launch{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:16px}
textarea{flex:1;min-width:280px;min-height:56px;background:#0d1017;border:1px solid var(--line);border-radius:10px;color:var(--ink);font-family:var(--sans);font-size:14px;padding:10px;resize:vertical}
select,button{font-family:var(--mono);font-size:13px;border-radius:9px;border:1px solid var(--line);padding:9px 12px;background:#0d1017;color:var(--ink)}
button{background:var(--accent);color:#04121a;border:none;font-weight:700;cursor:pointer}button:disabled{opacity:.5;cursor:default}
.grid{display:grid;grid-template-columns:1fr 1.2fr;gap:16px}@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.card h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0;padding:12px 14px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.body{padding:12px 14px;max-height:520px;overflow:auto}
.ev{display:flex;gap:9px;padding:4px 0;font-size:12.5px;font-family:var(--mono)}.ev .s{color:var(--dim);min-width:24px;text-align:right}
.ev.node .t{color:var(--accent)}.ev.tool .t{color:var(--accent2)}.ev.claim .t{color:var(--good)}.ev.mission .t{color:var(--warn)}.ev .m{color:var(--dim)}
.answer{white-space:pre-wrap;line-height:1.6;font-size:14px}
.pill{font-family:var(--mono);font-size:11px;padding:4px 9px;border:1px solid var(--line);border-radius:999px;color:var(--dim)}.pill b{color:var(--ink)}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px}
.src{font-family:var(--mono);font-size:11px;color:var(--accent);word-break:break-all;padding:3px 0}
.note{color:var(--dim);font-size:11px;margin-top:12px;font-family:var(--mono)}
</style></head><body><div class="wrap">
<div class="brand"><span class="dot"></span><h1>Eclipse · Mission Forge</h1></div>
<div class="launch">
  <textarea id="prompt" placeholder="Ask Eclipse a research/analysis question… (it will decompose, gather real sources, verify citations, and synthesize)"></textarea>
  <select id="effort"><option value="deep">deep (2 workers)</option><option value="totality" selected>totality (3 workers)</option><option value="pulse">pulse (1)</option></select>
  <button id="go">Launch mission</button>
</div>
<div class="grid">
  <div class="card"><h2>Live timeline <span id="status" class="pill">idle</span></h2><div class="body" id="timeline"></div></div>
  <div class="card"><h2>Answer</h2><div class="body"><div class="stats" id="stats"></div><div class="answer" id="answer">Launch a mission to begin.</div><div id="sources"></div></div></div>
</div>
<div class="note" id="note">Real Gemini + real web search/fetch + citation verification · each mission is cost-capped · reconstructed from persisted events only.</div>
</div><script>
const $=s=>document.querySelector(s), el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e};
const kind=t=>t.startsWith("mission.")?"mission":t.startsWith("node.")?"node":t.startsWith("claim.")?"claim":(t.startsWith("tool.")||t.startsWith("evidence.")||t.startsWith("plan")||t.startsWith("persona")||t.startsWith("verify")||t.startsWith("workers")||t.startsWith("critic"))?"tool":"node";
let es=null;
$("#go").onclick=async()=>{
  const prompt=$("#prompt").value.trim(); if(!prompt)return;
  $("#go").disabled=true; $("#timeline").innerHTML=""; $("#answer").textContent="Running…"; $("#sources").innerHTML=""; $("#stats").innerHTML=""; $("#status").textContent="launching";
  let missionId;
  try{ const r=await fetch("/api/eclipse/missions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({prompt,effort:$("#effort").value})}); const j=await r.json(); if(!r.ok)throw new Error(j.error||"launch failed"); missionId=j.missionId; }
  catch(e){ $("#answer").textContent="Launch failed: "+e.message; $("#go").disabled=false; $("#status").textContent="error"; return; }
  $("#status").textContent="running";
  if(es)es.close();
  es=new EventSource("/api/eclipse/missions/"+missionId+"/stream");
  es.onmessage=ev=>{ try{const d=JSON.parse(ev.data); addEvent(d); if(d.type==="mission.complete"||d.type==="mission.failed") finish(missionId); }catch{} };
  es.onerror=()=>{};
};
function addEvent(d){ const row=el("div","ev "+kind(d.type)); row.append(el("span","s",d.sequence), el("span","t",d.type)); const meta=d.payload&&(d.payload.node||d.payload.tool||d.payload.persona||d.payload.uri||d.payload.claimId||d.payload.subtasks||""); if(meta)row.append(el("span","m",String(meta).slice(0,60))); const tl=$("#timeline"); tl.append(row); tl.scrollTop=tl.scrollHeight; }
async function finish(missionId){ $("#status").textContent="done"; $("#go").disabled=false; if(es)es.close();
  try{ const r=await fetch("/api/eclipse/missions/"+missionId); const j=await r.json(); const res=j.result||{};
    $("#answer").textContent=res.answer||"(no synthesis)";
    $("#stats").innerHTML=""; [["status",j.status],["validated",res.validated],["packets",res.packets],["tokens",(res.tokens||0)],["cost","$"+(res.costUsd||0)]].forEach(([k,v])=>{const p=el("span","pill");p.innerHTML=k+" <b>"+v+"</b>";$("#stats").append(p);});
    $("#sources").innerHTML="<h2 style='font-size:11px;color:var(--dim);letter-spacing:.14em;text-transform:uppercase;margin:14px 0 4px'>Verified sources</h2>"; (res.evidence||[]).forEach(u=>$("#sources").append(el("div","src",u)));
  }catch(e){ $("#answer").textContent+="\\n(could not load result: "+e.message+")"; }
}
</script></body></html>`;
}
module.exports = { renderConsole };
