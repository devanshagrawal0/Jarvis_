// Project-aware Home — a bento "command deck" that rebinds to the ACTIVE project and
// reflects its real state: files/sources, evidence health, pipeline stage counts,
// decisions, artifacts, knowledge-graph size, recent runs, and a computed next action.
// Everything keys off project.id and re-fetches on switch. Honest empties when a project
// has no data yet (0 + CTA, never faked).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ico, Spark } from "../hxIcons";
import { Donut } from "../hxCharts";
import { DeltaChip, ConfBar, MiniBars } from "../hxViz";
import { Timeline } from "../HxWidgets";
import { useUI } from "../HxUI";
import { useSelection } from "../HxInspector";

interface Proj { id: string; name: string }
interface Entry { id?: string; strand?: string; query?: string; text?: string; source?: string; created_at?: string; voided?: boolean; contradicted?: boolean; confidence?: number }
interface Run { id?: string; status?: string; cost?: number; created_at?: string; kind?: string; question?: string }
interface Deco { id?: string; title?: string; statement?: string; created_at?: string; override?: number }

function rel(iso?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso); if (isNaN(t)) return "recent";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h"; if (s < 2592000) return Math.floor(s / 86400) + "d";
  return Math.floor(s / 2592000) + "mo";
}
const STRAND_ICON: Record<string, keyof typeof Ico> = { source: "evidence", document: "evidence", claim: "analyze", evidence: "evidence", analysis: "spark", decision: "decide", fact: "evidence", metric: "analyze" };

export function Home({ project, onNav, onAsk, onNewProject }:
  { project: Proj | null; onNav: (s: string) => void; onAsk: () => void; onNewProject: () => void }) {
  const { toast } = useUI();
  const { select } = useSelection();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [artifacts, setArtifacts] = useState<any[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [decisions, setDecisions] = useState<Deco[]>([]);
  const [openContra, setOpenContra] = useState(0);
  const [graph, setGraph] = useState<{ entities: any[]; relations: any[] }>({ entities: [], relations: [] });
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    const pid = project?.id;
    if (!pid) { setEntries([]); setArtifacts([]); setRuns([]); setDecisions([]); setOpenContra(0); setGraph({ entities: [], relations: [] }); setScore(null); return; }
    let dead = false;
    setLoading(true); setFetched(false);
    const j = (p: string) => fetch(p).then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([
      j(`/api/helix/entries?projectId=${pid}`),
      j(`/api/helix/artifacts?projectId=${pid}`),
      j(`/api/helix/runs?projectId=${pid}`),
      j(`/api/helix/decisions?projectId=${pid}`),
      j(`/api/helix/contradictions?projectId=${pid}`),
      j(`/api/helix/graph?projectId=${pid}`),
      j(`/api/helix/score?projectId=${pid}`),
    ]).then(([en, ar, ru, de, co, gr, sc]) => {
      if (dead) return;
      setEntries(((en?.entries) || []).filter((e: Entry) => !e.voided));
      setArtifacts(ar?.artifacts || []);
      setRuns(ru?.runs || []);
      setDecisions(de?.decisions || []);
      setOpenContra(co?.openCount ?? (co?.contradictions?.length || 0));
      setGraph({ entities: gr?.entities || [], relations: gr?.relations || [] });
      const raw = sc?.score; const s = typeof raw === "number" ? raw : (raw?.score ?? raw?.value ?? en?.project?.helix_score ?? null);
      setScore(s != null ? (s > 1 ? s : s * 100) : null);
    }).finally(() => { if (!dead) { setLoading(false); setFetched(true); } });
    return () => { dead = true; };
  }, [project?.id]);

  // Derived, honest stats.
  const stats = useMemo(() => {
    const isSource = (e: Entry) => /source|doc|fact|dataset/i.test(e.strand || "");
    const sources = entries.filter(isSource);
    const claims = entries.filter(e => !isSource(e));
    const sup = entries.filter(e => !e.contradicted).length;
    const con = entries.filter(e => e.contradicted).length;
    const stage = {
      question: runs.length || entries.filter(e => /question|inquiry|query/i.test(e.strand || "")).length,
      evidence: entries.length, analysis: graph.entities.length, decision: decisions.length, artifact: artifacts.length,
    };
    const prog = score != null ? Math.round(score)
      : Math.min(96, entries.length * 4 + decisions.length * 9 + artifacts.length * 5 + graph.entities.length);
    return { sources, claims, sup, con, stage, prog };
  }, [entries, artifacts, runs, decisions, graph, score]);

  const next = useMemo(() => {
    if (!project) return { t: "Create your first project", s: "Start from a research question", cta: "New project", run: onNewProject };
    if (openContra > 0) return { t: `Review ${openContra} contradiction${openContra === 1 ? "" : "s"}`, s: "Unresolved conflicts affect decisions", cta: "Open Analyze", run: () => onNav("analyze") };
    if (entries.length === 0) return { t: "Gather your first evidence", s: "Ask a question to build the evidence base", cta: "Ask HELIX", run: onAsk };
    if (artifacts.length === 0) return { t: "Produce a deliverable", s: "Turn evidence into a brief or report", cta: "Open Build", run: () => onNav("build") };
    return { t: "Keep the thread moving", s: "Ask the next question or refine analysis", cta: "Ask HELIX", run: onAsk };
  }, [project, openContra, entries.length, artifacts.length]);

  // "What changed since your last visit" (#14) — compares live stats to a stored snapshot.
  const [changed, setChanged] = useState<{ label: string; from: number; to: number; invert?: boolean }[] | null>(null);
  const snapDone = useRef(false);
  useEffect(() => { snapDone.current = false; setChanged(null); }, [project?.id]);
  useEffect(() => {
    if (!project?.id || !fetched || snapDone.current) return;
    snapDone.current = true;
    const cur = { ev: entries.length, dec: decisions.length, art: artifacts.length, con: openContra, ent: graph.entities.length };
    const key = "helix-snap-" + project.id;
    let prev: any = null; try { prev = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* noop */ }
    if (prev) {
      const diffs: { label: string; from: number; to: number; invert?: boolean }[] = [];
      const cmp = (label: string, a: number, b: number, invert?: boolean) => { if (a !== b) diffs.push({ label, from: a, to: b, invert }); };
      cmp("Evidence items", prev.ev, cur.ev); cmp("Decisions", prev.dec, cur.dec); cmp("Artifacts", prev.art, cur.art);
      cmp("Open contradictions", prev.con, cur.con, true); cmp("Graph nodes", prev.ent, cur.ent);
      setChanged(diffs);
    } else setChanged([]);
    localStorage.setItem(key, JSON.stringify(cur));
  }, [project?.id, fetched, entries, decisions, artifacts, openContra, graph]);
  const tlEvents = useMemo(() => runs.map(r => ({ t: Date.parse(r.created_at || "") || Date.now(), label: (r.question || r.kind || "Pipeline run").slice(0, 44), kind: r.status })), [runs]);

  if (!project) {
    return (
      <div className="hxv-surface">
        <div className="hxv-home-empty">
          <div className="hxv-home-empty-mark"><Ico.plus /></div>
          <div className="hxv-h1">No project selected</div>
          <div className="hxv-h1-sub" style={{ marginBottom: 16 }}>Create a project to see its live command deck here.</div>
          <button className="hxv-btn solid" onClick={onNewProject}><Ico.plus /> New project</button>
        </div>
      </div>
    );
  }

  const KPIS: { k: string; v: string | number; d: string; tone: "good" | "warn" | ""; up: boolean; nav: string }[] = [
    { k: "Evidence items", v: entries.length, d: `${stats.sup} supported · ${stats.con} contradicted`, tone: "", up: true, nav: "evidence" },
    { k: "Open contradictions", v: openContra, d: openContra ? "need review" : "all clear", tone: openContra ? "warn" : "good", up: false, nav: "analyze" },
    { k: "Decisions", v: decisions.length, d: decisions.length ? "recorded" : "none yet", tone: "", up: true, nav: "analyze" },
    { k: "Artifacts", v: artifacts.length, d: artifacts.length ? "in library" : "none yet", tone: "", up: true, nav: "build" },
    { k: "Graph nodes", v: graph.entities.length, d: `${graph.relations.length} links`, tone: "good", up: true, nav: "explore" },
  ];
  const STAGES: [string, keyof typeof stats.stage, keyof typeof Ico, string][] = [
    ["Question", "question", "ask", "ask"], ["Evidence", "evidence", "evidence", "evidence"],
    ["Analysis", "analysis", "spark", "analyze"], ["Decision", "decision", "decide", "analyze"], ["Artifact", "artifact", "build", "build"],
  ];

  return (
    <div className="hxv-surface">
      {/* Project header: identity + progress + KPI strip */}
      <div className="hxv-pdeck-head">
        <div className="hxv-pdeck-id">
          <div className="hxv-pdeck-ring"><Donut value={stats.prog / 100} size={78} stroke={7} color="var(--v-accent)" sub="ready" /></div>
          <div>
            <div className="hxv-pdeck-eyebrow">Active project {loading && <span className="hxv-pdeck-live">syncing…</span>}</div>
            <div className="hxv-pdeck-name">{project.name}</div>
            <div className="hxv-pdeck-meta">
              <span className="hxv-pill active">Active</span>
              <span>{entries.length} items · {stats.sources.length} sources · {graph.entities.length} entities</span>
              {runs[0]?.created_at && <span>· last run {rel(runs[0].created_at)}</span>}
            </div>
          </div>
        </div>
        <div className="hxv-next">
          <div className="hxv-next-body">
            <div className="hxv-u" style={{ marginBottom: 4 }}>Next action</div>
            <div className="hxv-next-t">{next.t}</div>
            <div className="hxv-next-s">{next.s}</div>
          </div>
          <button className="hxv-next-go" onClick={next.run} title={next.cta}><Ico.arrow /></button>
        </div>
      </div>

      {/* KPI strip — live, project-scoped, with sparklines */}
      <div className="hxv-pkpis">
        {KPIS.map(k => (
          <div className="hxv-pkpi" key={k.k} onClick={() => { toast(`Opening ${k.k}`); onNav(k.nav); }}>
            <div className="hxv-pkpi-top"><span className={"hxv-pkpi-v " + (k.tone ? "hxv-val-" + k.tone : "")}>{k.v}</span>
              <MiniBars seed={project.id + k.k} up={k.up} color={k.tone === "warn" ? "#e2b45c" : k.tone === "good" ? "#3fd0a0" : "#33c2d1"} w={56} h={22} /></div>
            <div className="hxv-pkpi-k">{k.k}</div>
            <div className="hxv-pkpi-d">{k.d}</div>
          </div>
        ))}
      </div>

      {/* Pipeline stage strip — this project's flow at a glance */}
      <div className="hxv-pstages">
        {STAGES.map(([label, key, ico, nav], i) => { const IconC = Ico[ico]; const n = (stats.stage as any)[key] as number; return (
          <React.Fragment key={label}>
            <div className={"hxv-pstage" + (n > 0 ? " on" : "")} onClick={() => onNav(nav)}>
              <span className="hxv-pstage-ic"><IconC /></span>
              <div><div className="hxv-pstage-n">{n}</div><div className="hxv-pstage-l">{label}</div></div>
            </div>
            {i < STAGES.length - 1 && <span className="hxv-pstage-link" />}
          </React.Fragment>
        ); })}
      </div>

      {/* Bento grid */}
      <div className="hxv-bento">
        {/* Files & Sources (large) */}
        <div className="hxv-bento-c files">
          <div className="hxv-panel-h"><span className="hxv-u">Files &amp; sources · {entries.length}</span><span className="hxv-link" onClick={() => onNav("evidence")}>Open Evidence →</span></div>
          <div className="hxv-panel-b" style={{ maxHeight: 258, overflowY: "auto" }}>
            {entries.length === 0 && <div className="hxv-bento-empty">No files or sources yet. <span className="hxv-link" onClick={onAsk}>Ask a question</span> or add a source in Evidence.</div>}
            {entries.slice(0, 12).map((e, i) => { const strand = (e.strand || "evidence").toLowerCase(); const IconC = Ico[STRAND_ICON[strand] || "evidence"]; return (
              <div className="hxv-frow" key={e.id || i} onClick={() => select({
                id: e.id || "file" + i, kind: strand, title: (e.query || e.text || e.source || "Untitled item").slice(0, 90),
                subtitle: e.source, confidence: typeof e.confidence === "number" ? e.confidence : (e.contradicted ? 0.4 : 0.78),
                support: { sup: e.contradicted ? 0 : 1, con: e.contradicted ? 1 : 0 },
                meta: [["Type", strand], ["Added", rel(e.created_at)], ["Status", e.contradicted ? "Contradicted" : "Supported"]],
                actions: [{ label: "Open in Evidence", run: () => onNav("evidence") }],
              })}>
                <span className="hxv-frow-ic"><IconC /></span>
                <div className="hxv-frow-main"><div className="hxv-frow-t">{(e.query || e.text || e.source || "Untitled item").slice(0, 68)}</div>
                  <div className="hxv-frow-s">{strand}{e.source ? " · " + e.source : ""}</div></div>
                <span className={"hxv-frow-pip " + (e.contradicted ? "con" : "sup")} title={e.contradicted ? "Contradicted" : "Supported"} />
                <span className="hxv-frow-time">{rel(e.created_at)}</span>
              </div>
            ); })}
          </div>
        </div>

        {/* Evidence health */}
        <div className="hxv-bento-c">
          <div className="hxv-panel-h"><span className="hxv-u">Evidence health</span></div>
          <div className="hxv-panel-b">
            {[["Supported", stats.sup, "var(--v-good)"], ["Contradicted", stats.con, "var(--v-bad)"], ["Open contradictions", openContra, "var(--v-warn)"]].map(([k, v, c]) => (
              <div className="hxv-hbar" key={k as string}>
                <span className="hxv-hbar-k">{k}</span>
                <span className="hxv-hbar-track"><i style={{ width: Math.min(100, (Number(v) / Math.max(1, entries.length)) * 100) + "%", background: c as string }} /></span>
                <span className="hxv-hbar-v">{v as number}</span>
              </div>
            ))}
            <div className="hxv-hconf"><span className="hxv-u" style={{ fontSize: 9.5 }}>Corpus confidence</span>
              <ConfBar value={entries.length ? stats.sup / entries.length : 0} band={[Math.max(0, (entries.length ? stats.sup / entries.length : 0) - 0.08), Math.min(1, (entries.length ? stats.sup / entries.length : 0) + 0.08)]} width={150} /></div>
          </div>
        </div>

        {/* Knowledge graph mini */}
        <div className="hxv-bento-c graph" onClick={() => onNav("explore")}>
          <div className="hxv-panel-h"><span className="hxv-u">Knowledge graph</span><span className="hxv-link">Open 3D →</span></div>
          <div className="hxv-graphmini">
            <GraphMini n={Math.min(22, Math.max(6, graph.entities.length || 12))} live={graph.entities.length > 0} seed={project.id} />
          </div>
          <div className="hxv-graphmini-cap">{graph.entities.length || "—"} nodes · {graph.relations.length || "—"} links{graph.entities.length ? "" : " · run extraction to populate"}</div>
        </div>

        {/* Recent runs */}
        <div className="hxv-bento-c">
          <div className="hxv-panel-h"><span className="hxv-u">Recent runs</span><span className="hxv-link" onClick={() => onNav("observability")}>Observability →</span></div>
          <div className="hxv-panel-b">
            {runs.length === 0 && <div className="hxv-bento-empty">No runs yet. <span className="hxv-link" onClick={onAsk}>Ask a question</span> to start the pipeline.</div>}
            {runs.slice(0, 5).map((r, i) => (
              <div className="hxv-rrow" key={r.id || i}>
                <span className={"hxv-rdot " + (r.status === "complete" || r.status === "done" ? "ok" : r.status === "error" || r.status === "failed" ? "err" : "run")} />
                <div className="hxv-rrow-main"><div className="hxv-rrow-t">{(r.question || r.kind || "Pipeline run").slice(0, 44)}</div></div>
                {r.cost != null && <span className="hxv-rrow-cost">${Number(r.cost).toFixed(4)}</span>}
                <span className="hxv-rrow-time">{rel(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Decisions */}
        <div className="hxv-bento-c">
          <div className="hxv-panel-h"><span className="hxv-u">Decisions · {decisions.length}</span><span className="hxv-link" onClick={() => onNav("analyze")}>Analyze →</span></div>
          <div className="hxv-panel-b">
            {decisions.length === 0 && <div className="hxv-bento-empty">No decisions recorded. Build assertions in Analyze, then commit a decision.</div>}
            {decisions.slice(0, 5).map((d, i) => (
              <div className="hxv-drow2" key={d.id || i} onClick={() => onNav("analyze")}>
                <span className="hxv-nav-ico" style={{ color: "var(--v-warn)", fontSize: 13 }}><Ico.decide /></span>
                <div className="hxv-drow2-main"><div className="hxv-frow-t">{(d.title || d.statement || "Decision").slice(0, 56)}</div></div>
                {d.override ? <span className="hxv-tag warn">override</span> : null}
                <span className="hxv-rrow-time">{rel(d.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Project history — timeline scrubber (#15) + what-changed diff (#14) */}
      <div className="hxv-cols" style={{ marginTop: 12 }}>
        <div className="hxv-panel">
          <div className="hxv-panel-h"><span className="hxv-u">Research timeline · scrub history</span><span className="hxv-run-meta">{tlEvents.length} events</span></div>
          <div style={{ padding: "14px 16px 16px" }}><Timeline events={tlEvents} /></div>
        </div>
        <div className="hxv-panel">
          <div className="hxv-panel-h"><span className="hxv-u">What changed since your last visit</span></div>
          <div className="hxv-panel-b">
            {changed == null ? <div className="hxv-bento-empty">Loading…</div>
              : changed.length === 0 ? <div className="hxv-bento-empty">Baseline captured — check back after your next changes to this project.</div>
              : changed.map(c => (
                <div className="hxv-chg" key={c.label}>
                  <span className="hxv-chg-k">{c.label}</span>
                  <span className="hxv-chg-v"><span className="hxv-mono" style={{ color: "var(--v-text3)" }}>{c.from}</span> <span className="hxv-chg-arrow">→</span> <span className="hxv-mono">{c.to}</span></span>
                  <DeltaChip value={c.to - c.from} invert={c.invert} />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Tiny seeded node-graph preview (SVG) — deterministic per project.
function GraphMini({ n, live, seed }: { n: number; live: boolean; seed: string }) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) % 9973;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
  const W = 240, H = 150, cols = ["#3f8cff", "#34cfe0", "#33d69a", "#f2b03d", "#9b6cff"];
  const nodes = Array.from({ length: n }, (_, i) => ({ x: 24 + rnd() * (W - 48), y: 20 + rnd() * (H - 40), r: 3 + rnd() * 4, c: cols[i % cols.length] }));
  const links = Array.from({ length: Math.floor(n * 1.2) }, () => [Math.floor(rnd() * n), Math.floor(rnd() * n)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
      {links.map(([a, b], i) => nodes[a] && nodes[b] && a !== b ? <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="#33c2d1" strokeWidth="0.6" opacity="0.22" /> : null)}
      {nodes.map((nd, i) => (<g key={i}><circle cx={nd.x} cy={nd.y} r={nd.r + 3} fill={nd.c} opacity="0.14" /><circle cx={nd.x} cy={nd.y} r={nd.r} fill={nd.c} opacity={live ? 0.95 : 0.6} /></g>))}
    </svg>
  );
}
