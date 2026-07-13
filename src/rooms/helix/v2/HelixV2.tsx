// HELIX v2 — honest rebuild shell. Pixel target: Desktop/helix_refs/ref_01, ref_02.
// Persistent sidebar + 5-node spine + surface router + shared detail drawer.
// This wave (H4): shell + Home surface. Ask/Evidence/Analyze/Build land next.
import React, { useEffect, useRef, useState } from "react";
import "../../helix-tokens.css";
import "./helix-v2.css";
import { Ico } from "./hxIcons";
import { DrawerProvider } from "./Drawer";
import { HxBoot } from "./HxBoot";
import { UIProvider, useUI } from "./HxUI";
import { Ask } from "./surfaces/Ask";
import { Evidence } from "./surfaces/Evidence";
import { Analyze } from "./surfaces/Analyze";
import { Build } from "./surfaces/Build";
import { CommandCenter } from "./surfaces/CommandCenter";
import { Projects } from "./surfaces/Projects";
import { Artifacts } from "./surfaces/Artifacts";
import { Observability } from "./surfaces/Observability";
import { Explore } from "./surfaces/Explore";
import { Team } from "./surfaces/Team";
import { Home } from "./surfaces/Home";
import { CommandPalette, Cmd } from "./CommandPalette";
import { CheatSheet, DENSITIES, Density, DENSITY_LABEL } from "./HxCommand";
import { SelectionProvider, HxInspector, CompareTray } from "./HxInspector";
import { StatusStrip } from "./HxWidgets";
import { ContextMenuProvider } from "./HxContextMenu";

type Surface = "home" | "ask" | "evidence" | "analyze" | "build" | "artifacts" | "projects" | "command" | "observability" | "explore" | "team";
type SpineStage = "question" | "evidence" | "analysis" | "decision" | "artifact";

interface Props { onExit?: () => void; jarvisContext?: { speaker: string; text: string }[]; }

const NAV: { key: Surface; label: string; ico: keyof typeof Ico; count?: number }[] = [
  { key: "home", label: "Home", ico: "home" },
  { key: "projects", label: "Projects", ico: "projects" },
  { key: "ask", label: "Ask HELIX", ico: "ask" },
  { key: "evidence", label: "Evidence", ico: "evidence", count: 8 },
  { key: "analyze", label: "Analyze", ico: "analyze" },
  { key: "build", label: "Build", ico: "build" },
  { key: "artifacts", label: "Artifacts", ico: "layers" },
  { key: "command", label: "Command Center", ico: "command" },
];

const SPINE: { key: SpineStage; label: string; sub: string }[] = [
  { key: "question", label: "Question", sub: "Ask" },
  { key: "evidence", label: "Evidence", sub: "Gather" },
  { key: "analysis", label: "Analysis", sub: "Synthesize" },
  { key: "decision", label: "Decision", sub: "Commit" },
  { key: "artifact", label: "Artifact", sub: "Build" },
];


export function HelixV2(props: Props) {
  return <UIProvider><SelectionProvider><ContextMenuProvider><HelixInner {...props} /></ContextMenuProvider></SelectionProvider></UIProvider>;
}

function HelixInner({ onExit }: Props) {
  const { toast, prompt } = useUI();
  const [booting, setBooting] = useState(true);
  const [surface, setSurface] = useState<Surface>("home");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [activeProject, setActiveProject] = useState<{ id: string; name: string } | null>(null);
  const [projOpen, setProjOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState<boolean>(() => localStorage.getItem("helix-insp") !== "0");
  const toggleInsp = () => setInspOpen(o => { localStorage.setItem("helix-insp", o ? "0" : "1"); return !o; });
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem("helix-density") as Density) || "comfortable");
  const cycleDensity = () => setDensity(d => DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length]);
  const densFirst = useRef(true);
  useEffect(() => {
    if (densFirst.current) { densFirst.current = false; return; }
    localStorage.setItem("helix-density", density);
    toast(`Density · ${DENSITY_LABEL[density]}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);
  const projectName = activeProject?.name ?? "Kalshi Trading Analysis";

  // Global keyboard spine: ⌘K palette, ? cheat-sheet, D density, G-then-key navigation.
  const gPending = useRef(false);
  useEffect(() => {
    const NAVKEY: Record<string, Surface> = { h: "home", p: "projects", a: "ask", e: "evidence", n: "analyze", b: "build", c: "command", x: "explore", o: "observability" };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (e.key === "Escape") { setPaletteOpen(false); setCheatOpen(false); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { e.preventDefault(); setCheatOpen(o => !o); return; }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); cycleDensity(); return; }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); toggleInsp(); return; }
      if (e.key === "g" || e.key === "G") { gPending.current = true; setTimeout(() => { gPending.current = false; }, 1200); return; }
      if (gPending.current) { const s = NAVKEY[e.key.toLowerCase()]; if (s) { gPending.current = false; setSurface(s); toast(`→ ${s === "command" ? "Command Center" : s[0].toUpperCase() + s.slice(1)}`); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Spine reflects which surface you're on (Home shows the whole spine idle at Question).
  const SURFACE_STAGE: Partial<Record<Surface, SpineStage>> = {
    ask: "question", evidence: "evidence", analyze: "analysis", build: "artifact",
  };
  const spineStage: SpineStage = SURFACE_STAGE[surface] ?? "question";

  useEffect(() => {
    // H3: load real projects. Restore the LAST explicitly-chosen project rather than
    // silently grabbing projects[0] (the old auto-select bug). Fall back to first only
    // when there's no remembered choice, and always keep it visible/switchable.
    fetch("/api/helix/projects").then(r => r.json()).then(d => {
      const list: { id: string; name: string }[] = (d?.projects || []).map((p: any) => ({ id: p.id, name: p.name || "Untitled Project" }));
      setProjects(list);
      if (list.length) {
        const remembered = localStorage.getItem("helix-active-project");
        const chosen = list.find(p => p.id === remembered) || list[0];
        setActiveProject(chosen);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseProject = (p: { id: string; name: string }) => {
    setActiveProject(p); localStorage.setItem("helix-active-project", p.id); setProjOpen(false);
  };

  const createNewProject = async () => {
    const name = await prompt({ title: "New project", label: "Give your research project a name.", placeholder: "e.g. Kalshi Arbitrage Study", confirmText: "Create project" });
    if (!name) return;
    try {
      const r = await fetch("/api/helix/project/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const d = await r.json();
      if (r.ok && d.project) { const p = { id: d.project.id, name: d.project.name }; setProjects(ps => [p, ...ps]); chooseProject(p); setSurface("ask"); toast(`Project "${p.name}" created`, "good"); }
      else toast("Could not create project", "bad");
    } catch { toast("Network error creating project", "bad"); }
  };

  const curIdx = SPINE.findIndex(s => s.key === spineStage);

  const NAVHINT: Partial<Record<Surface, string>> = { home: "G H", projects: "G P", ask: "G A", evidence: "G E", analyze: "G N", build: "G B", command: "G C" };
  const commands: Cmd[] = [
    ...NAV.map((n): Cmd => ({ group: "Go to", label: n.label, ico: n.ico, hint: NAVHINT[n.key], keywords: "navigate open surface", run: () => setSurface(n.key) })),
    { group: "Go to", label: "Explore", ico: "search", hint: "G X", keywords: "search lineage graph", run: () => setSurface("explore") },
    { group: "Go to", label: "Observability", ico: "clock", hint: "G O", keywords: "runs monitoring logs", run: () => setSurface("observability") },
    { group: "Actions", label: "Ask a new question", ico: "ask", keywords: "research pipeline query", run: () => setSurface("ask") },
    { group: "Actions", label: "Review contradictions", ico: "analyze", keywords: "conflict evidence", run: () => setSurface("analyze") },
    { group: "Actions", label: "Build an artifact", ico: "build", keywords: "brief report export deck", run: () => setSurface("build") },
    { group: "Actions", label: "Open 3D knowledge graph", ico: "layers", keywords: "graph nodes force holographic explore", run: () => setSurface("explore") },
    { group: "Actions", label: "New project", ico: "plus", keywords: "create start", run: () => createNewProject() },
    { group: "Actions", label: "Team & reviews", ico: "projects", keywords: "members collaborate", run: () => setSurface("team") },
    { group: "View", label: `Cycle density (now: ${DENSITY_LABEL[density]})`, ico: "layers", hint: "D", keywords: "compact ultra comfortable spacing", run: () => cycleDensity() },
    { group: "View", label: "Keyboard shortcuts", ico: "command", hint: "?", keywords: "help hotkeys cheat sheet", run: () => setCheatOpen(true) },
    ...projects.map(p => ({ group: "Switch project", label: p.name, ico: "projects" as const, keywords: "open project", run: () => chooseProject(p) })),
  ];

  return (
    <DrawerProvider closeKey={surface}>
    <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />
    <div className="hxv" data-density={density} data-rail={inspOpen ? "1" : "0"}>
      {booting && <HxBoot onDone={() => setBooting(false)} />}
      {/* Sidebar */}
      <aside className="hxv-side">
        <div className="hxv-brand">
          <div className="hxv-brand-mark" />
          <div className="hxv-brand-name">HELIX</div>
        </div>

        {/* Project switcher — active project always explicit + switchable */}
        <div className="hxv-proj">
          <button className="hxv-proj-btn" onClick={() => setProjOpen(o => !o)}>
            <span className="hxv-proj-dot" />
            <span className="hxv-proj-meta">
              <span className="hxv-proj-lbl">Project</span>
              <span className="hxv-proj-name">{projectName}</span>
            </span>
            <span className="hxv-nav-ico" style={{ color: "var(--v-text3)", transform: projOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Ico.chevron /></span>
          </button>
          {projOpen && (
            <div className="hxv-proj-menu">
              {projects.length ? projects.map(p => (
                <div key={p.id} className={"hxv-proj-opt" + (p.id === activeProject?.id ? " on" : "")} onClick={() => chooseProject(p)}>
                  <span className="hxv-proj-dot" style={{ background: p.id === activeProject?.id ? "var(--v-good)" : "var(--v-text3)", boxShadow: "none" }} />{p.name}
                </div>
              )) : <div className="hxv-proj-opt">No projects yet</div>}
              <div className="hxv-proj-opt new" onClick={() => setProjOpen(false)}><Ico.plus /> New project</div>
            </div>
          )}
        </div>

        <nav className="hxv-nav">
          {NAV.map((n, i) => {
            const IconC = Ico[n.ico];
            return (
              <React.Fragment key={n.key}>
                {i === 2 && <div className="hxv-nav-sep" />}
                <div className={"hxv-nav-item" + (surface === n.key ? " on" : "")} onClick={() => setSurface(n.key)}>
                  <span className="hxv-nav-ico"><IconC /></span>
                  <span className="hxv-nav-label">{n.label}</span>
                  {n.count != null && <span className="hxv-nav-count">{n.count}</span>}
                </div>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="hxv-side-foot">
          <div className="hxv-user" onClick={() => setSurface("team")} title="Team & reviews">
            <div className="hxv-ava">D</div>
            <div className="hxv-user-meta">
              <div className="hxv-user-name">Dev Analyst</div>
              <div className="hxv-user-mail">dev@helix.ai</div>
            </div>
            <span className="hxv-nav-ico" style={{ color: "var(--v-text3)" }}><Ico.chevron /></span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="hxv-main">
        {/* Top utility bar (#5) */}
        <div className="hxv-topbar">
          <div className="hxv-topsearch" onClick={() => setPaletteOpen(true)}>
            <Ico.search /> Search commands, surfaces, evidence…
            <kbd>⌘K</kbd>
          </div>
          <div style={{ flex: 1 }} />
          <div className={"hxv-topicon" + (inspOpen ? " on" : "")} title="Toggle inspector (I)" onClick={toggleInsp}><span className="hxv-insp-glyph" /></div>
          <div className="hxv-topicon dens" title={`Density: ${DENSITY_LABEL[density]} — click to cycle (D)`} onClick={cycleDensity}>
            <span className="hxv-dens-glyph" data-d={density} />
          </div>
          <div className="hxv-topicon" title="Keyboard shortcuts (?)" onClick={() => setCheatOpen(true)}><span style={{ fontWeight: 700, fontSize: 13 }}>?</span></div>
          <div className="hxv-topicon" title="Notifications" onClick={() => setNotifOpen(o => !o)}><Ico.bell /><span className="hxv-topbadge">3</span></div>
          <div className="hxv-topicon" title="Observability" onClick={() => setSurface("observability")}><Ico.clock /></div>
          <div className="hxv-topdiv" />
          <div className="hxv-topicon exit" title="Exit HELIX" onClick={onExit}><Ico.x /></div>
          {notifOpen && (
            <div className="hxv-notif" onMouseLeave={() => setNotifOpen(false)}>
              <div className="hxv-panel-h" style={{ border: "none", borderBottom: "1px solid var(--v-line)" }}><span className="hxv-u">Notifications</span><span className="hxv-link" onClick={() => setNotifOpen(false)}>Mark all read</span></div>
              {[["bad", "3 contradictions need review", "High impact on 2 decisions"], ["warn", "2 sources are stale", "Refresh before next build"], ["good", "Pilot decision confidence rose to 78%", "After new sources added"]].map(([tone, t, s], i) => (
                <div className="hxv-notif-row" key={i} onClick={() => { setNotifOpen(false); setSurface(i === 0 ? "analyze" : "evidence"); }} style={{ cursor: "pointer" }}>
                  <span className="hxv-notif-dot" style={{ background: tone === "bad" ? "var(--v-bad)" : tone === "warn" ? "var(--v-warn)" : "var(--v-good)" }} />
                  <div><div style={{ fontSize: 12.5 }}>{t}</div><div style={{ fontSize: 10.5, color: "var(--v-text3)" }}>{s}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Spine */}
        <div className="hxv-spine">
          {SPINE.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className={"hxv-spine-node" + (i < curIdx ? " done" : i === curIdx ? " cur" : "")}>
                <div className="hxv-spine-dot">{i < curIdx ? "✓" : i + 1}</div>
                <div className="hxv-spine-txt">
                  <span className="hxv-spine-k">{s.label}</span>
                  <span className="hxv-spine-sub">{s.sub}</span>
                </div>
              </div>
              {i < SPINE.length - 1 && <div className="hxv-spine-link" />}
            </React.Fragment>
          ))}
        </div>

        {/* Surface */}
        {surface === "home" ? <Home project={activeProject} onAsk={() => setSurface("ask")} onNewProject={createNewProject} onNav={(s) => setSurface(s as Surface)} />
          : surface === "ask" ? <Ask projectId={activeProject?.id} onDone={() => setSurface("evidence")} />
          : surface === "evidence" ? <Evidence projectId={activeProject?.id} />
          : surface === "analyze" ? <Analyze projectId={activeProject?.id} />
          : surface === "build" ? <Build projectId={activeProject?.id} />
          : surface === "command" ? <CommandCenter onNav={setSurface} />
          : surface === "projects" ? <Projects onOpen={chooseProject} />
          : surface === "artifacts" ? <Artifacts projectId={activeProject?.id} onNav={(s) => setSurface(s as Surface)} />
          : surface === "observability" ? <Observability projectId={activeProject?.id} />
          : surface === "explore" ? <Explore projectId={activeProject?.id} />
          : surface === "team" ? <Team projectId={activeProject?.id} />
          : <Placeholder surface={surface} />}
        <StatusStrip />
      </div>
      <HxInspector open={inspOpen} onToggle={toggleInsp} surface={surface} onNav={(s) => setSurface(s as Surface)} />
      <CompareTray />
    </div>
    </DrawerProvider>
  );
}


function Placeholder({ surface }: { surface: Surface }) {
  return (
    <div className="hxv-surface">
      <div className="hxv-empty">
        <span className="hxv-empty-ico"><Ico.layers /></span>
        <div style={{ fontSize: 15, color: "var(--v-text2)", textTransform: "capitalize" }}>{surface} surface</div>
        <div>This surface is being built in the next wave.</div>
      </div>
    </div>
  );
}
