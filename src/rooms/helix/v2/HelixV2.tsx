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
import { SurfaceSwitch } from "./SurfaceSwitch";
import { HelixProjectsProvider, useProjects } from "./HelixProjects";
import { prefetchHelix } from "./useHelixResource";
import { CheatSheet, DENSITIES, Density, DENSITY_LABEL } from "./HxCommand";
import { SelectionProvider, HxInspector, CompareTray } from "./HxInspector";
import { StatusStrip } from "./HxWidgets";
import { ContextMenuProvider } from "./HxContextMenu";

type Surface = "home" | "ask" | "evidence" | "analyze" | "build" | "artifacts" | "projects" | "command" | "observability" | "explore" | "team";
type SpineStage = "question" | "evidence" | "analysis" | "decision" | "artifact";

interface Props { onExit?: () => void; jarvisContext?: { speaker: string; text: string }[]; }

// Deep-link helpers (docs/ux/02 §6): the active surface lives in the URL hash so refresh/
// return restores it and browser back/forward walk surface history.
const VALID_SURFACES = new Set<Surface>(["home", "projects", "ask", "evidence", "analyze", "build", "artifacts", "command", "observability", "explore", "team"]);
function surfaceFromHash(): Surface | null {
  try {
    const s = new URLSearchParams(location.hash.replace(/^#/, "")).get("s");
    return s && VALID_SURFACES.has(s as Surface) ? (s as Surface) : null;
  } catch { return null; }
}

const NAV: { key: Surface; label: string; ico: keyof typeof Ico; count?: number }[] = [
  { key: "home", label: "Home", ico: "home" },
  { key: "projects", label: "Projects", ico: "projects" },
  { key: "ask", label: "Ask HELIX", ico: "ask" },
  { key: "evidence", label: "Evidence", ico: "evidence" },
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
  return <UIProvider><SelectionProvider><ContextMenuProvider><HelixProjectsProvider><HelixInner {...props} /></HelixProjectsProvider></ContextMenuProvider></SelectionProvider></UIProvider>;
}

function HelixInner({ onExit }: Props) {
  const { toast, prompt } = useUI();
  const [booting, setBooting] = useState(true);
  // Safety net: the boot splash is a full-screen click-catching overlay. If it ever fails
  // to signal completion, the whole room becomes unclickable on every tab (this is exactly
  // the bug where the parent's 1s clock re-render kept resetting HxBoot's timer so it never
  // finished). Force-clear booting after a hard ceiling so the room can never be trapped.
  useEffect(() => {
    const t = window.setTimeout(() => setBooting(false), 3200);
    return () => clearTimeout(t);
  }, []);
  const [surface, setSurface] = useState<Surface>(() => surfaceFromHash() ?? "home");
  // Single source of truth for projects (shell switcher + Projects surface share this).
  const { projects, active: activeProject, select, create: createProjectApi, remove: removeProjectApi } = useProjects();
  const [projOpen, setProjOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Sample notifications (badged in the UI). Held in state so "Mark all read" can really clear them.
  const [notifs, setNotifs] = useState<string[][]>([
    ["bad", "3 contradictions need review", "High impact on 2 decisions"],
    ["warn", "2 sources are stale", "Refresh before next build"],
    ["good", "Pilot decision confidence rose to 78%", "After new sources added"],
  ]);
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
  const projectName = activeProject?.name ?? "No project";

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
  // The spine is the navigational backbone (docs/ux/02 §6): it reflects where you are AND
  // lets you jump. Every surface maps to a stage (not just 4), and clicking a node navigates.
  const SURFACE_STAGE: Partial<Record<Surface, SpineStage>> = {
    home: "question", projects: "question", ask: "question",
    evidence: "evidence", explore: "evidence",
    analyze: "analysis", build: "artifact", artifacts: "artifact",
    command: "question", observability: "question", team: "question",
  };
  const spineStage: SpineStage = SURFACE_STAGE[surface] ?? "question";
  const STAGE_SURFACE: Record<SpineStage, Surface> = {
    question: "ask", evidence: "evidence", analysis: "analyze", decision: "analyze", artifact: "build",
  };
  const SURFACE_LABEL: Record<Surface, string> = {
    home: "Home", projects: "Projects", ask: "Ask HELIX", evidence: "Evidence", analyze: "Analyze",
    build: "Build", artifacts: "Artifacts", command: "Command Center", observability: "Observability",
    explore: "Explore", team: "Team",
  };
  // Spine-forward "next step" per surface (goal-gradient). Aux surfaces have none.
  const NEXT_STEP: Partial<Record<Surface, { label: string; to: Surface; sub: string }>> = {
    home: { label: "Ask a question", to: "ask", sub: "Start the research pipeline" },
    ask: { label: "Review evidence", to: "evidence", sub: "See what HELIX gathered" },
    evidence: { label: "Analyze & resolve contradictions", to: "analyze", sub: "Synthesize the evidence" },
    analyze: { label: "Build an artifact", to: "build", sub: "Turn findings into an output" },
    build: { label: "View artifacts", to: "artifacts", sub: "Your generated outputs" },
  };
  const nextStep = NEXT_STEP[surface];

  // Deep-link: reflect {surface, project} in the URL hash (push → back/forward works);
  // restore on load happens via the useState initializer above; popstate handles back/fwd.
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("s", surface);
    if (activeProject?.id) q.set("p", activeProject.id);
    const next = "#" + q.toString();
    if (location.hash !== next) history.pushState(null, "", next);
  }, [surface, activeProject?.id]);
  useEffect(() => {
    const onPop = () => { const s = surfaceFromHash(); if (s) setSurface(s); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // #25: ambient depth — subtle pointer parallax on the shell's ambient layers. CSS vars
  // (no React re-render), rAF-throttled, reduced-motion opts out. Ambient layers are
  // pointer-events:none so this never blocks interaction.
  const hxvRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hxvRef.current; if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let lastX = 0, lastY = 0, raf = 0;
    const apply = () => { raf = 0; el.style.setProperty("--px", ((lastX / window.innerWidth - 0.5) * 2).toFixed(3)); el.style.setProperty("--py", ((lastY / window.innerHeight - 0.5) * 2).toFixed(3)); };
    const onMove = (e: PointerEvent) => { lastX = e.clientX; lastY = e.clientY; if (!raf) raf = requestAnimationFrame(apply); };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // #18: dev latency HUD — measure surface transition time (state change → painted).
  const [lastNavMs, setLastNavMs] = useState<number | null>(null);
  useEffect(() => {
    const t0 = performance.now();
    let done = false;
    const set = () => { if (!done) { done = true; setLastNavMs(performance.now() - t0); } };
    const r = requestAnimationFrame(() => requestAnimationFrame(set));   // accurate: after paint
    const fb = window.setTimeout(set, 150);                              // fallback if RAF is paused (hidden tab)
    return () => { cancelAnimationFrame(r); clearTimeout(fb); };
  }, [surface]);

  // Loading + active-project reconciliation live in the provider now (single source).
  const chooseProject = (p: { id: string; name: string }) => { select(p); setProjOpen(false); };

  const createNewProject = async () => {
    const name = await prompt({ title: "New project", label: "Give your research project a name.", placeholder: "e.g. Kalshi Arbitrage Study", confirmText: "Create project" });
    if (!name) return;
    const p = await createProjectApi(name);   // provider creates + selects, single source
    if (p) { setProjOpen(false); setSurface("ask"); toast(`Project "${p.name}" created`, "good"); }
    else toast("Could not create project", "bad");
  };

  // ── W4: palette actions + recent/pinned ──
  // Navigate to a surface then fire a command it can act on (focus its input, open its dialog).
  // Small delay lets the surface mount + attach its `helix:cmd` listener first.
  const fireCmd = (to: Surface, type: string) => { setSurface(to); window.setTimeout(() => window.dispatchEvent(new CustomEvent("helix:cmd", { detail: { type } })), 90); };
  const deleteCurrentProject = async () => {
    if (!activeProject) { toast("No active project", "warn"); return; }
    const typed = await prompt({ title: `Delete "${activeProject.name}"?`, label: "Permanently removes the project and all its data. Type DELETE to confirm.", placeholder: "DELETE", confirmText: "Delete project" });
    if (typed == null) return;
    if (typed.toUpperCase() !== "DELETE") { toast("Type DELETE to confirm", "warn"); return; }
    await removeProjectApi(activeProject.id);   // provider: optimistic delete + Undo toast
  };
  // Recent surfaces (⌘K "Recent" group).
  const [recentSurfaces, setRecentSurfaces] = useState<Surface[]>(() => { try { return JSON.parse(localStorage.getItem("helix-recent-surfaces") || "[]"); } catch { return []; } });
  useEffect(() => {
    setRecentSurfaces(prev => { const next = [surface, ...prev.filter(s => s !== surface)].slice(0, 6); localStorage.setItem("helix-recent-surfaces", JSON.stringify(next)); return next; });
  }, [surface]);
  // Pinned projects (pinned sort to top of switcher + palette).
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("helix-pinned-projects") || "[]"); } catch { return []; } });
  const togglePin = (id: string) => setPinnedIds(prev => { const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]; localStorage.setItem("helix-pinned-projects", JSON.stringify(next)); return next; });
  const sortedProjects = [...projects].sort((a, b) => (pinnedIds.includes(b.id) ? 1 : 0) - (pinnedIds.includes(a.id) ? 1 : 0));

  // Prefetch-on-intent (docs/ux/04 §2): warm a surface's data on hover/focus so the click
  // paints instantly. Only the single-endpoint surfaces (their cache keys are known here).
  const prefetchSurface = (s: Surface) => {
    const pid = activeProject?.id; if (!pid) return;
    if (s === "evidence") prefetchHelix(`ev:${pid}`, `/api/helix/entries?projectId=${pid}`);
    else if (s === "observability") prefetchHelix(`obs:${pid}`, `/api/helix/runs?projectId=${pid}`);
  };

  // W12 #12: global search that JUMPS — pull the project's real evidence / decisions /
  // artifacts into the ⌘K palette so typing a claim or artifact name finds the actual object
  // and navigates to its surface (information scent, docs/ux/02 §6). Uses the W2 cache.
  const [searchables, setSearchables] = useState<{ group: string; label: string; to: Surface }[]>([]);
  useEffect(() => {
    const pid = activeProject?.id;
    if (!pid) { setSearchables([]); return; }
    const ctrl = new AbortController();
    const j = (u: string) => fetch(u, { signal: ctrl.signal }).then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([
      j(`/api/helix/entries?projectId=${pid}`),
      j(`/api/helix/decisions?projectId=${pid}`),
      j(`/api/helix/artifacts?projectId=${pid}`),
    ]).then(([en, de, ar]) => {
      const items: { group: string; label: string; to: Surface }[] = [];
      for (const e of (en?.entries || []).filter((x: any) => !x.voided).slice(0, 40))
        items.push({ group: "Evidence", label: String(e.query || e.text || "").slice(0, 70), to: "evidence" });
      for (const d of (de?.decisions || []).slice(0, 20))
        items.push({ group: "Decisions", label: String(d.title || d.statement || "Decision").slice(0, 70), to: "analyze" });
      for (const a of (ar?.artifacts || []).slice(0, 20))
        items.push({ group: "Artifacts", label: String(a.title || "Artifact").slice(0, 70), to: "artifacts" });
      setSearchables(items.filter(i => i.label));
    });
    return () => ctrl.abort();
  }, [activeProject?.id]);

  const curIdx = SPINE.findIndex(s => s.key === spineStage);

  const NAVHINT: Partial<Record<Surface, string>> = { home: "G H", projects: "G P", ask: "G A", evidence: "G E", analyze: "G N", build: "G B", command: "G C" };
  const commands: Cmd[] = [
    ...NAV.map((n): Cmd => ({ group: "Go to", label: n.label, ico: n.ico, hint: NAVHINT[n.key], keywords: "navigate open surface", run: () => setSurface(n.key) })),
    { group: "Go to", label: "Explore", ico: "search", hint: "G X", keywords: "search lineage graph", run: () => setSurface("explore") },
    { group: "Go to", label: "Observability", ico: "clock", hint: "G O", keywords: "runs monitoring logs", run: () => setSurface("observability") },
    { group: "Actions", label: "Ask a new question", ico: "ask", keywords: "research pipeline query run", run: () => fireCmd("ask", "focus") },
    { group: "Actions", label: "Add an evidence source", ico: "evidence", keywords: "ingest document url source", run: () => fireCmd("evidence", "ingest") },
    { group: "Actions", label: "Review contradictions", ico: "analyze", keywords: "conflict evidence decide", run: () => setSurface("analyze") },
    { group: "Actions", label: "Build an artifact", ico: "build", keywords: "brief report export deck", run: () => setSurface("build") },
    { group: "Actions", label: "Open 3D knowledge graph", ico: "layers", keywords: "graph nodes force holographic explore", run: () => setSurface("explore") },
    { group: "Actions", label: "New project", ico: "plus", keywords: "create start", run: () => createNewProject() },
    { group: "Actions", label: "Delete current project", ico: "trash", keywords: "remove destroy delete", run: () => deleteCurrentProject() },
    { group: "Actions", label: "Team & reviews", ico: "projects", keywords: "members collaborate", run: () => setSurface("team") },
    { group: "View", label: `Cycle density (now: ${DENSITY_LABEL[density]})`, ico: "layers", hint: "D", keywords: "compact ultra comfortable spacing", run: () => cycleDensity() },
    { group: "View", label: "Keyboard shortcuts", ico: "command", hint: "?", keywords: "help hotkeys cheat sheet", run: () => setCheatOpen(true) },
    ...recentSurfaces.filter(s => s !== surface).slice(0, 5).map((s): Cmd => ({ group: "Recent", label: SURFACE_LABEL[s], ico: "clock", keywords: "recent history back", run: () => setSurface(s) })),
    ...sortedProjects.map(p => ({ group: "Switch project", label: (pinnedIds.includes(p.id) ? "📌 " : "") + p.name, ico: "projects" as const, keywords: "open project", run: () => chooseProject(p) })),
    // #12: real project objects — searching a claim/decision/artifact jumps to its surface.
    ...searchables.map((s): Cmd => ({
      group: s.group, label: s.label,
      ico: s.group === "Evidence" ? "evidence" : s.group === "Decisions" ? "decide" : "layers",
      keywords: "search jump open " + s.group.toLowerCase(),
      run: () => setSurface(s.to),
    })),
  ];

  return (
    <DrawerProvider closeKey={surface}>
    <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    <CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />
    <div className="hxv" ref={hxvRef} data-density={density} data-rail={inspOpen ? "1" : "0"}>
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
              {sortedProjects.length ? sortedProjects.map(p => (
                <div key={p.id} className={"hxv-proj-opt" + (p.id === activeProject?.id ? " on" : "")} onClick={() => chooseProject(p)}>
                  <span className="hxv-proj-dot" style={{ background: p.id === activeProject?.id ? "var(--v-good)" : "var(--v-text3)", boxShadow: "none" }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span className="hxv-proj-pin" title={pinnedIds.includes(p.id) ? "Unpin" : "Pin to top"}
                    onClick={(e) => { e.stopPropagation(); togglePin(p.id); }}
                    style={{ opacity: pinnedIds.includes(p.id) ? 1 : 0.35, fontSize: 12, padding: "0 2px" }}>📌</span>
                </div>
              )) : <div className="hxv-proj-opt">No projects yet</div>}
              <div className="hxv-proj-opt new" onClick={() => { setProjOpen(false); createNewProject(); }}><Ico.plus /> New project</div>
            </div>
          )}
        </div>

        <nav className="hxv-nav">
          {NAV.map((n, i) => {
            const IconC = Ico[n.ico];
            return (
              <React.Fragment key={n.key}>
                {i === 2 && <div className="hxv-nav-sep" />}
                <div className={"hxv-nav-item" + (surface === n.key ? " on" : "")} onClick={() => setSurface(n.key)}
                  onMouseEnter={() => prefetchSurface(n.key)} onFocus={() => prefetchSurface(n.key)}>
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
          <div className="hxv-topicon" title="Notifications" onClick={() => setNotifOpen(o => !o)}><Ico.bell /></div>
          <div className="hxv-topicon" title="Observability" onClick={() => setSurface("observability")}><Ico.clock /></div>
          <div className="hxv-topdiv" />
          <div className="hxv-topicon exit" title="Exit HELIX" onClick={onExit}><Ico.x /></div>
          {notifOpen && (
            <div className="hxv-notif" onMouseLeave={() => setNotifOpen(false)}>
              <div className="hxv-panel-h" style={{ border: "none", borderBottom: "1px solid var(--v-line)" }}><span className="hxv-u">Notifications</span><span className="hxv-demo-badge" title="Notifications aren't wired to live events yet — these are examples.">sample</span><span style={{ flex: 1 }} />
                {/* Actually clears the list — the label used to just close the panel (dead button). */}
                {notifs.length > 0 && <span className="hxv-link" onClick={() => { setNotifs([]); toast("All notifications marked read"); }}>Mark all read</span>}
              </div>
              {notifs.length === 0
                ? <div style={{ padding: 18, fontSize: 12, color: "var(--v-text3)", textAlign: "center" }}>Nothing new.</div>
                : notifs.map(([tone, t, s], i) => (
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
              <div
                className={"hxv-spine-node" + (i < curIdx ? " done" : i === curIdx ? " cur" : "")}
                role="button" tabIndex={0} title={`Go to ${s.label}`}
                onClick={() => setSurface(STAGE_SURFACE[s.key])}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSurface(STAGE_SURFACE[s.key]); } }}
              >
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

        {/* Context breadcrumb — the through-line: project › where you are (docs/ux/02 §6) */}
        <div className="hxv-breadcrumb">
          <span className="hxv-crumb">{projectName}</span>
          <span className="hxv-crumb-sep">›</span>
          <span className="hxv-crumb cur">{SURFACE_LABEL[surface]}</span>
        </div>

        {/* Surface — SurfaceSwitch gives directional, scroll-preserving transitions; shell stays static */}
        <SurfaceSwitch surfaceKey={surface}>
        {surface === "home" ? <Home project={activeProject} onAsk={() => setSurface("ask")} onNewProject={createNewProject} onNav={(s) => setSurface(s as Surface)} />
          : surface === "ask" ? <Ask projectId={activeProject?.id} onDone={() => setSurface("evidence")} />
          : surface === "evidence" ? <Evidence projectId={activeProject?.id} />
          : surface === "analyze" ? <Analyze projectId={activeProject?.id} />
          : surface === "build" ? <Build projectId={activeProject?.id} />
          : surface === "command" ? <CommandCenter onNav={(s) => setSurface(s as Surface)} />
          : surface === "projects" ? <Projects onOpen={chooseProject} />
          : surface === "artifacts" ? <Artifacts projectId={activeProject?.id} onNav={(s) => setSurface(s as Surface)} />
          : surface === "observability" ? <Observability projectId={activeProject?.id} />
          : surface === "explore" ? <Explore projectId={activeProject?.id} />
          : surface === "team" ? <Team projectId={activeProject?.id} />
          : <Placeholder surface={surface} />}
        </SurfaceSwitch>
        {/* Next-step bar — spine-forward action (goal-gradient, docs/ux/02 §6). Disabled with a
            reason when no project is active (Norman constraint, not a silent dead button). */}
        {nextStep && (
          <div className="hxv-nextbar">
            <span className="hxv-nextbar-lbl">Next</span>
            <span className="hxv-nextbar-sub">{nextStep.sub}</span>
            <button className="hxv-btn solid" disabled={!activeProject}
              title={!activeProject ? "Select a project first" : nextStep.label}
              onClick={() => { if (activeProject) setSurface(nextStep.to); }}>
              {nextStep.label} <Ico.arrow />
            </button>
          </div>
        )}
        <StatusStrip />
        {lastNavMs != null && (
          <div className="hxv-lat-hud" title="Dev: surface transition time (state change → paint)">
            <span>⚡</span><b>{SURFACE_LABEL[surface]}</b>
            <span className={lastNavMs < 100 ? "ok" : lastNavMs < 400 ? "slow" : "bad"}>{Math.round(lastNavMs)}ms</span>
          </div>
        )}
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


