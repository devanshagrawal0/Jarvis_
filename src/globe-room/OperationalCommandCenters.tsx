import { useMemo, useState } from "react";
import { api, post } from "../api";
import "./OperationalCommandCenters.css";

function ago(value?: string) {
  if (!value) return "never";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 2) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function command(text: string) {
  document.dispatchEvent(new CustomEvent("jarvis:command", { detail: { text, files: [] } }));
}

function openWidget(id: string) {
  document.dispatchEvent(new CustomEvent("jarvis:open-widget", { detail: { id } }));
}

function cleanTitle(value: unknown, fallback: string) {
  const first = String(value || fallback).split(/\r?\n/).find(Boolean) || fallback;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

function Metric({ label, value, sub, tone = "cyan" }: { label: string; value: string | number; sub: string; tone?: string }) {
  return <article className={`op-metric op-tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>;
}

export function ProjectsCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const projects: any[] = Array.isArray(data?.projects) ? data.projects : [];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "healthy" | "attention">("all");
  const [selectedPath, setSelectedPath] = useState("");
  const [notice, setNotice] = useState("");
  const sorted = useMemo(() => [...projects].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()), [projects]);
  const filtered = sorted.filter((project) => {
    const matches = `${project.name} ${project.folder} ${project.path}`.toLowerCase().includes(query.toLowerCase());
    const healthy = Boolean(project.hasGit && project.hasReadme && project.fileCount > 0);
    return matches && (filter === "all" || (filter === "healthy" ? healthy : !healthy));
  });
  const selected = projects.find((project) => project.path === selectedPath) || filtered[0];
  const files = projects.reduce((sum, project) => sum + Number(project.fileCount || 0), 0);
  const git = projects.filter((project) => project.hasGit).length;
  const packages = projects.filter((project) => project.package).length;
  const attention = projects.filter((project) => !project.hasGit || !project.hasReadme || !project.fileCount).length;

  async function openFolder(project: any) {
    setNotice("Opening…");
    try { await post("/api/projects/open", { path: project.path }); setNotice(`Opened ${project.name}.`); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="op-center">
    <section className="op-hero"><div><span>WORKSPACE INTELLIGENCE</span><h2>Project Operations</h2><p>Real workspace inventory, repository health, scripts, dependencies and direct project context for Jarvis.</p></div><div className="op-hero-mark">P<span>{projects.length}</span></div></section>
    <div className="op-metrics"><Metric label="Projects" value={projects.length} sub={data?.workspaceRoot || "workspace"} /><Metric label="Indexed files" value={files.toLocaleString()} sub="current scan" tone="green" /><Metric label="Git repos" value={git} sub={`${packages} packages`} tone="violet" /><Metric label="Attention" value={attention} sub="health gaps" tone={attention ? "amber" : "green"} /></div>
    <div className="op-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, folders, paths…" />{(["all", "healthy", "attention"] as const).map((item) => <button key={item} data-active={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="op-split">
      <section className="op-panel"><header><div><span>Workspace index</span><strong>{filtered.length} projects</strong></div><small>updated</small></header><div className="op-project-list">{loading ? <div className="op-empty">Scanning workspace…</div> : filtered.map((project) => {
        const healthy = project.hasGit && project.hasReadme && project.fileCount > 0;
        return <button key={project.path} data-selected={selected?.path === project.path} onClick={() => setSelectedPath(project.path)}><i data-health={healthy ? "good" : "warn"} /><div><strong>{project.name || project.folder}</strong><span>{project.folder} · {project.fileCount || 0} files</span></div><small>{ago(project.updatedAt)}</small></button>;
      })}{!loading && !filtered.length ? <div className="op-empty">No projects match this view.</div> : null}</div></section>
      <section className="op-panel op-inspector"><header><div><span>Project inspector</span><strong>{selected?.name || "No project selected"}</strong></div>{selected ? <small>{ago(selected.updatedAt)} ago</small> : null}</header>{selected ? <div className="op-inspector-body">
        <div className="op-path">{selected.path}</div>
        <div className="op-health-grid"><div data-ok={selected.hasGit}><span>Git</span><strong>{selected.hasGit ? "ready" : "missing"}</strong></div><div data-ok={selected.hasReadme}><span>README</span><strong>{selected.hasReadme ? "ready" : "missing"}</strong></div><div data-ok={selected.fileCount > 0}><span>Files</span><strong>{selected.fileCount || 0}</strong></div><div data-ok={Boolean(selected.package)}><span>Package</span><strong>{selected.package ? "detected" : "none"}</strong></div></div>
        <div className="op-section"><span>Runtime package</span><strong>{selected.package?.name || "No package manifest"}</strong><p>{selected.package ? `${selected.package.dependencies || 0} dependencies` : "This folder has no package metadata in the current scan."}</p></div>
        <div className="op-section"><span>Available scripts</span><div className="op-chips">{Object.entries(selected.package?.scripts || {}).map(([name, script]) => <code key={name} title={String(script)}>{name}</code>)}{!Object.keys(selected.package?.scripts || {}).length ? <small>No package scripts indexed.</small> : null}</div></div>
        <div className="op-actions"><button onClick={() => void openFolder(selected)}>Open folder</button><button onClick={() => command(`Inspect the project at ${selected.path}. Summarize its current health, recent work, important files, risks, and best next actions.`)}>Ask Jarvis</button><button onClick={() => command(`Use ${selected.path} as the active project context for my next task.`)}>Set context</button></div>{notice ? <p className="op-notice">{notice}</p> : null}
      </div> : <div className="op-empty">Select a project to inspect it.</div>}</section>
    </div>
  </div>;
}

export function AgentsCommandCenter({ data, loading, onRefresh }: { data: any; loading: boolean; onRefresh: () => void }) {
  const specialists: any[] = Array.isArray(data?.agents) ? data.agents : [];
  const missions: any[] = [...(data?.durableMissions || []), ...(data?.deployableMissions || [])];
  const [view, setView] = useState<"missions" | "specialists">("missions");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = missions.filter((mission) => {
    const state = String(mission.status || "unknown").toLowerCase();
    return (status === "all" || state === status) && `${mission.title} ${mission.objective} ${mission.role}`.toLowerCase().includes(query.toLowerCase());
  });
  const selected = missions.find((mission) => `${mission._source}:${mission.id}` === selectedId) || filtered[0];
  const running = missions.filter((mission) => ["running", "executing"].includes(String(mission.status).toLowerCase())).length;
  const queued = missions.filter((mission) => ["queued", "pending", "paused"].includes(String(mission.status).toLowerCase())).length;
  const failed = missions.filter((mission) => String(mission.status).toLowerCase() === "failed").length;

  async function control(action: "pause" | "resume" | "cancel") {
    if (!selected || selected._source !== "durable") return;
    if (action === "cancel" && !window.confirm(`Cancel mission “${cleanTitle(selected.title, "mission")}”?`)) return;
    setNotice(`${action}…`);
    try { await post(`/api/missions/${encodeURIComponent(selected.id)}/${action}`, {}); setNotice(`Mission ${action} applied.`); onRefresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  const plan: string[] = selected?.checkpoint?.plan || [];
  const events: any[] = selected?.events || [];
  return <div className="op-center agents-center">
    <section className="op-hero"><div><span>AGENT OPERATIONS</span><h2>Mission Control</h2><p>Durable missions, specialist capabilities, checkpoints, evidence and failures—without pretending idle definitions are running agents.</p></div><div className="op-hero-mark">A<span>{missions.length}</span></div></section>
    <div className="op-metrics"><Metric label="Missions" value={missions.length} sub="two substrates" /><Metric label="Running" value={running} sub="executing now" tone="green" /><Metric label="Queued" value={queued} sub="pending work" tone="amber" /><Metric label="Failed" value={failed} sub={`${specialists.length} specialists`} tone={failed ? "red" : "green"} /></div>
    <div className="op-tools"><button data-active={view === "missions"} onClick={() => setView("missions")}>Missions</button><button data-active={view === "specialists"} onClick={() => setView("specialists")}>Specialists</button><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${view}…`} />{view === "missions" ? <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All states</option><option value="running">Running</option><option value="queued">Queued</option><option value="paused">Paused</option><option value="complete">Complete</option><option value="done">Done</option><option value="failed">Failed</option></select> : null}</div>
    {view === "specialists" ? <div className="op-specialists">{specialists.filter((agent) => `${agent.name} ${agent.kind} ${agent.description}`.toLowerCase().includes(query.toLowerCase())).map((agent) => <article key={agent.id}><div className="op-agent-orb">{String(agent.kind || "A").slice(0, 1).toUpperCase()}</div><div><span>{agent.kind}</span><strong>{agent.name}</strong><p>{agent.description}</p><div className="op-chips">{(agent.tools || []).map((tool: string) => <code key={tool}>{tool}</code>)}</div></div><button onClick={() => command(`Deploy the ${agent.name} for this objective: `)}>Deploy via Jarvis</button></article>)}</div> : <div className="op-split">
      <section className="op-panel"><header><div><span>Mission ledger</span><strong>{filtered.length} visible</strong></div><small>state</small></header><div className="op-mission-list">{loading ? <div className="op-empty">Loading missions…</div> : filtered.slice(0, 100).map((mission) => { const key = `${mission._source}:${mission.id}`; const state = String(mission.status || "unknown").toLowerCase(); return <button key={key} data-selected={selected?.id === mission.id && selected?._source === mission._source} onClick={() => setSelectedId(key)}><i data-state={state} /><div><strong>{cleanTitle(mission.title || mission.objective, "Untitled mission")}</strong><span>{mission.role || specialists.find((agent) => agent.id === mission.agentId)?.name || mission._source} · {mission.progress ?? 0}%</span></div><small>{state}</small></button>; })}</div></section>
      <section className="op-panel op-inspector"><header><div><span>Mission inspector</span><strong>{selected ? cleanTitle(selected.title || selected.objective, "Mission") : "No mission"}</strong></div>{selected ? <small>{selected._source}</small> : null}</header>{selected ? <div className="op-inspector-body mission-detail"><div className="op-progress"><i><b style={{ width: `${Math.max(2, Math.min(100, Number(selected.progress || (['complete','done'].includes(selected.status) ? 100 : 0))))}%` }} /></i><strong>{selected.progress ?? (['complete','done'].includes(selected.status) ? 100 : 0)}%</strong></div><div className="op-section"><span>Objective</span><p>{cleanTitle(selected.objective, "No objective recorded.")}</p></div><div className="op-section"><span>Execution plan</span><ol>{plan.slice(0, 8).map((step, index) => <li key={index}>{step}</li>)}{!plan.length ? <li>No durable plan recorded.</li> : null}</ol></div>{selected.error ? <div className="op-error"><span>Failure</span><p>{cleanTitle(selected.error, "Unknown failure")}</p></div> : null}<div className="op-section"><span>Recent events</span><div className="op-event-list">{events.slice(0, 6).map((event) => <div key={event.id || event.at}><i data-state={event.type} /><p><strong>{event.type}</strong>{cleanTitle(event.message, "event")}</p><small>{ago(event.at)}</small></div>)}{!events.length ? <small>No events recorded.</small> : null}</div></div><div className="op-actions"><button onClick={() => command(`Inspect mission ${selected.id}. Explain its current state, evidence, failures, and safest next action.`)}>Ask Jarvis</button>{selected._source === "durable" ? <>{selected.status === "paused" ? <button onClick={() => void control("resume")}>Resume</button> : <button onClick={() => void control("pause")}>Pause</button>}<button className="danger" onClick={() => void control("cancel")}>Cancel</button></> : null}</div>{notice ? <p className="op-notice">{notice}</p> : null}</div> : <div className="op-empty">Select a mission to inspect it.</div>}</section>
    </div>}
  </div>;
}

const VIEW_WIDGET: Record<string, string> = { modules: "modules", projects: "projects", agents: "agents", markets: "kalshi", vision: "vision", camera: "vision", memory: "memory", devices: "devices", coop: "devices", receipts: "receipts", trust: "trust", "provider-health": "connections", system: "vitals", settings: "connections" };

export function ModulesCommandCenter({ data, loading }: { data: any; loading: boolean }) {
  const modules: any[] = Array.isArray(data?.modules) ? data.modules : [];
  const providers = data?.providers || {};
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState<"all" | "ready" | "blocked">("all");
  const [selectedId, setSelectedId] = useState("");
  const categories = [...new Set(modules.map((module) => module.category))].sort();
  const filtered = modules.filter((module) => (category === "all" || module.category === category) && (state === "all" || (state === "ready" ? module.ready : !module.ready)) && `${module.title} ${module.summary} ${module.keywords?.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const selected = modules.find((module) => module.id === selectedId) || filtered[0];
  const connected = Object.values(providers).filter((provider: any) => provider?.connected).length;
  const blocked = modules.filter((module) => !module.ready).length;

  function launch(module: any) {
    const widget = VIEW_WIDGET[module.view];
    if (widget && widget !== "modules") openWidget(widget);
    else command(`Open or run the ${module.title} module. If it is blocked, explain exactly what is missing and how to configure it.`);
  }

  return <div className="op-center modules-center">
    <section className="op-hero"><div><span>CAPABILITY FABRIC</span><h2>Module Console</h2><p>Truthful inventory of what JARVIS can run now, what is registered but incomplete, and which provider unlocks each capability.</p></div><div className="op-hero-mark">M<span>{modules.length}</span></div></section>
    <div className="op-metrics"><Metric label="Capabilities" value={data?.counts?.total ?? modules.length} sub={`${categories.length} domains`} /><Metric label="Ready" value={data?.counts?.ready ?? modules.filter((module) => module.ready).length} sub="launchable now" tone="green" /><Metric label="Blocked" value={blocked} sub="provider or adapter" tone={blocked ? "amber" : "green"} /><Metric label="Providers" value={`${connected}/${Object.keys(providers).length}`} sub="connected" tone="violet" /></div>
    <div className="op-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search capabilities, keywords, providers…" /><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All domains</option>{categories.map((item) => <option key={item}>{item}</option>)}</select>{(["all", "ready", "blocked"] as const).map((item) => <button key={item} data-active={state === item} onClick={() => setState(item)}>{item}</button>)}</div>
    <div className="op-split">
      <section className="op-panel"><header><div><span>Capability registry</span><strong>{filtered.length} modules</strong></div><small>truth</small></header><div className="op-module-grid">{loading ? <div className="op-empty">Loading capability registry…</div> : filtered.map((module) => <button key={module.id} data-selected={selected?.id === module.id} onClick={() => setSelectedId(module.id)}><i data-ready={module.ready} /><span>{module.category}</span><strong>{module.title}</strong><p>{module.summary}</p><small>{module.ready ? "READY" : "BLOCKED"}</small></button>)}</div></section>
      <section className="op-panel op-inspector"><header><div><span>Capability inspector</span><strong>{selected?.title || "No module"}</strong></div>{selected ? <small>{selected.id}</small> : null}</header>{selected ? <div className="op-inspector-body"><div className={`op-readiness ${selected.ready ? "ready" : "blocked"}`}><i /><div><span>{selected.ready ? "Operational" : "Unavailable"}</span><strong>{selected.ready ? "Ready to launch" : selected.blockedReason || "Implementation pending"}</strong></div></div><div className="op-section"><span>Purpose</span><p>{selected.summary}</p></div><div className="op-health-grid"><div data-ok={selected.status === "installed"}><span>Status</span><strong>{selected.status}</strong></div><div data-ok={selected.ready}><span>Readiness</span><strong>{selected.ready ? "ready" : "blocked"}</strong></div><div data-ok={Boolean(selected.view)}><span>Surface</span><strong>{selected.view}</strong></div><div data-ok={!selected.missingProviders?.length}><span>Providers</span><strong>{selected.missingProviders?.join(", ") || "satisfied"}</strong></div></div><div className="op-section"><span>Permissions and requirements</span><div className="op-chips">{[...(selected.permissions || []), ...(selected.requires || [])].map((item: string) => <code key={item}>{item}</code>)}{!selected.permissions?.length && !selected.requires?.length ? <small>No special requirements.</small> : null}</div></div>{selected.missingProviders?.length ? <div className="op-provider-block">{selected.missingProviders.map((name: string) => <div key={name}><i data-connected={providers[name]?.connected} /><span>{providers[name]?.label || name}</span><strong>{providers[name]?.validationState || "missing"}</strong></div>)}</div> : null}<div className="op-actions"><button disabled={!selected.ready} onClick={() => launch(selected)}>{selected.ready ? "Launch module" : "Unavailable"}</button><button onClick={() => command(`Explain the ${selected.title} module: what it does, whether it works now, its requirements, and how to use or finish it.`)}>Ask Jarvis</button></div></div> : <div className="op-empty">Select a capability.</div>}</section>
    </div>
  </div>;
}
