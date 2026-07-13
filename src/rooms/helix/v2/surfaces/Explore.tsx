// Explore (H13, rebuilt). Search = facets + saved searches + result rows (ref_10 §1).
// Lineage = columnar Sources→Claims→Analyses→Decisions→Artifacts with typed edges + legend (ref_10 §2).
import React, { useEffect, useState, Suspense } from "react";
import { Ico } from "../hxIcons";
import { Sankey, ChordContra, ConfHeatmap } from "../HxWidgets";

const KnowledgeGraph3D = React.lazy(() => import("./KnowledgeGraph"));
type ExploreTab = "Search" | "Lineage" | "Graph" | "Flows";

export function Explore({ projectId, initialTab = "Search" }: { projectId?: string; initialTab?: ExploreTab }) {
  const [tab, setTab] = useState<ExploreTab>(initialTab);
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">Explore</div><div className="hxv-h1-sub">Search everything, and see how it connects — in 2D lineage or a 3D knowledge graph.</div></div>
      </div>
      <div className="hxv-tabs">
        {(["Search", "Lineage", "Graph", "Flows"] as const).map(t => <div key={t} className={"hxv-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t === "Graph" ? "3D Graph" : t}</div>)}
      </div>
      {tab === "Search" ? <SearchView projectId={projectId} />
        : tab === "Lineage" ? <LineageView projectId={projectId} />
        : tab === "Flows" ? <FlowsView />
        : <Suspense fallback={<div className="hxv-kg"><div className="hxv-kg-loading">Spinning up the knowledge graph…</div></div>}><KnowledgeGraph3D projectId={projectId} /></Suspense>}
    </div>
  );
}

const FACETS = [["All Objects", 216, "layers"], ["Sources", 123, "evidence"], ["Claims", 42, "analyze"], ["Analyses", 18, "spark"], ["Decisions", 7, "decide"], ["Artifacts", 26, "build"]] as const;
const SAVED = ["Kalshi fees", "cross-exchange arbitrage", "unsupported contradictions", "post-2024 regulation"];

function SearchView({ projectId }: { projectId?: string }) {
  const [q, setQ] = useState("");
  const [facet, setFacet] = useState("All Objects");
  const [results, setResults] = useState<{ title: string; excerpt: string; refKind: string; matchedBy?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async (query = q) => {
    if (!query.trim() || !projectId) return;
    setBusy(true);
    try { const r = await fetch(`/api/helix/search?projectId=${projectId}&q=${encodeURIComponent(query.trim())}`); const d = await r.json(); setResults(d.results || []); }
    catch { setResults([]); } finally { setBusy(false); }
  };
  return (
    <div className="hxv-ev" style={{ gridTemplateColumns: "210px 1fr" }}>
      {/* facets + saved */}
      <div className="hxv-filters">
        <div className="hxv-filter-grp">
          <span className="hxv-u">Browse by type</span>
          {FACETS.map(([n, c, ico]) => { const IconC = Ico[ico as keyof typeof Ico]; return (
            <div key={n} className={"hxv-filter" + (facet === n ? " on" : "")} onClick={() => setFacet(n as string)}>
              <span className="hxv-nav-ico" style={{ fontSize: 13 }}><IconC /></span><span>{n}</span><span className="hxv-filter-n">{c}</span>
            </div>
          ); })}
        </div>
        <div className="hxv-filter-grp">
          <span className="hxv-u">Saved searches</span>
          {SAVED.map(s => <div key={s} className="hxv-filter" onClick={() => { setQ(s); run(s); }}><span className="hxv-nav-ico" style={{ fontSize: 12 }}><Ico.search /></span><span style={{ fontSize: 11.5 }}>{s}</span></div>)}
        </div>
      </div>
      {/* results */}
      <div>
        <div className="hxv-evsearch" style={{ marginBottom: 12 }}>
          <Ico.search />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && run()}
            placeholder="Search evidence, claims, sources, decisions, artifacts…"
            style={{ background: "transparent", border: "none", outline: "none", color: "var(--v-text)", flex: 1, fontFamily: "var(--v-font)", fontSize: 13 }} />
          <span className="hxv-run-meta">{facet}</span>
        </div>
        <div className="hxv-panel">
          <div className="hxv-panel-h"><span className="hxv-u">{busy ? "Searching…" : results.length + " results"}</span></div>
          <div className="hxv-panel-b">
            {results.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "var(--v-text3)" }}>Type a query or pick a saved search.</div>}
            {results.map((r, i) => (
              <div className="hxv-row" key={i}>
                <span className="hxv-etype" style={{ minWidth: 58 }}>{r.refKind}</span>
                <div className="hxv-row-main"><div className="hxv-row-t">{r.title}</div><div className="hxv-row-s">{(r.excerpt || "").slice(0, 120)}</div></div>
                <span className="hxv-tag good">{r.matchedBy || "match"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Lineage: columnar swim-lanes with typed, directional, colored edges ──
const COLS: { key: string; label: string; color: string; nodes: { id: string; t: string }[] }[] = [
  { key: "source", label: "Sources", color: "#3f8cff", nodes: [{ id: "s1", t: "Deribit Fees Doc" }, { id: "s2", t: "SEC Reg NMS" }, { id: "s3", t: "Kaiko Market Data" }] },
  { key: "claim", label: "Claims", color: "#34cfe0", nodes: [{ id: "c1", t: "Fees are 0.02% maker" }, { id: "c2", t: "Latency < 200ms" }, { id: "c3", t: "Arb profitable net" }] },
  { key: "analysis", label: "Analyses", color: "#33d69a", nodes: [{ id: "a1", t: "Fee-edge model" }, { id: "a2", t: "Latency sensitivity" }] },
  { key: "decision", label: "Decisions", color: "#f2b03d", nodes: [{ id: "d1", t: "Proceed to pilot" }] },
  { key: "artifact", label: "Artifacts", color: "#9b6cff", nodes: [{ id: "ar1", t: "Arbitrage Brief" }, { id: "ar2", t: "Risk Memo" }] },
];
const EDGES: { a: string; b: string; type: "Supports" | "Derived" | "Uses" | "Refutes" }[] = [
  { a: "s1", b: "c1", type: "Supports" }, { a: "s2", b: "c3", type: "Supports" }, { a: "s3", b: "c2", type: "Supports" },
  { a: "c1", b: "a1", type: "Derived" }, { a: "c2", b: "a2", type: "Derived" }, { a: "c3", b: "a1", type: "Refutes" },
  { a: "a1", b: "d1", type: "Derived" }, { a: "a2", b: "d1", type: "Uses" }, { a: "d1", b: "ar1", type: "Derived" }, { a: "d1", b: "ar2", type: "Uses" },
];
const EDGE_COLOR = { Supports: "#33d69a", Derived: "#3f8cff", Uses: "#8aa2c8", Refutes: "#f0686d" };

function LineageView({ projectId }: { projectId?: string }) {
  const [live, setLive] = useState<{ entities: any[] } | null>(null);
  useEffect(() => { if (projectId) fetch(`/api/helix/graph?projectId=${projectId}`).then(r => r.json()).then(d => setLive({ entities: d.entities || [] })).catch(() => {}); }, [projectId]);
  const W = 980, H = 440, colW = W / COLS.length, cardH = 42, gap = 20;
  const pos: Record<string, { x: number; y: number }> = {};
  COLS.forEach((col, ci) => { const x = ci * colW + 20; const totalH = col.nodes.length * (cardH + gap); const startY = (H - totalH) / 2 + 30;
    col.nodes.forEach((n, ni) => { pos[n.id] = { x, y: startY + ni * (cardH + gap) }; }); });
  const cardW = colW - 40;

  return (
    <div className="hxv-panel">
      <div className="hxv-panel-h">
        <span className="hxv-u">Relationship &amp; lineage</span>
        <span style={{ display: "flex", gap: 12 }}>
          {(Object.keys(EDGE_COLOR) as (keyof typeof EDGE_COLOR)[]).map(k => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--v-text2)" }}>
              <span style={{ width: 12, height: 2, background: EDGE_COLOR[k], display: "inline-block" }} />{k}
            </span>
          ))}
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ minWidth: 760 }}>
          {/* column headers */}
          {COLS.map((c, i) => (
            <text key={c.key} x={i * colW + 20 + cardW / 2} y={22} fontSize="10.5" fill={c.color} textAnchor="middle" style={{ textTransform: "uppercase", letterSpacing: "1.5px" }}>{c.label}</text>
          ))}
          {/* edges */}
          {EDGES.map((e, i) => { const a = pos[e.a], b = pos[e.b]; if (!a || !b) return null;
            const x1 = a.x + cardW, y1 = a.y + cardH / 2, x2 = b.x, y2 = b.y + cardH / 2, mx = (x1 + x2) / 2;
            return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={EDGE_COLOR[e.type]} strokeWidth="1.4" opacity="0.6" markerEnd="url(#arrow)" />; })}
          <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 z" fill="#8aa2c8" /></marker></defs>
          {/* node cards */}
          {COLS.map(col => col.nodes.map(n => { const p = pos[n.id]; return (
            <g key={n.id}>
              <rect x={p.x} y={p.y} width={cardW} height={cardH} rx="7" fill="rgba(14,21,36,0.95)" stroke={col.color} strokeWidth="1.2" />
              <circle cx={p.x + 12} cy={p.y + cardH / 2} r="3.5" fill={col.color} />
              <text x={p.x + 22} y={p.y + cardH / 2 + 3.5} fontSize="10.5" fill="var(--v-text)">{n.t.length > 20 ? n.t.slice(0, 19) + "…" : n.t}</text>
            </g>
          ); }))}
        </svg>
      </div>
      <div style={{ padding: "0 16px 14px", fontSize: 11, color: "var(--v-text3)" }}>
        {live && live.entities.length ? `${live.entities.length} entities extracted from this project.` : "Showing the lineage schema — run entity extraction to populate live nodes."}
      </div>
    </div>
  );
}

// ── Flows: advanced viz — Sankey + contradiction chord + confidence heatmap ──
const SK_NODES = [
  { id: "s1", label: "Deribit Fees", layer: 0, color: "#3f8cff" }, { id: "s2", label: "SEC Reg NMS", layer: 0, color: "#3f8cff" },
  { id: "s3", label: "Kaiko Data", layer: 0, color: "#3f8cff" }, { id: "s4", label: "CME Rulebook", layer: 0, color: "#3f8cff" },
  { id: "c1", label: "Fees 0.02% maker", layer: 1, color: "#34cfe0" }, { id: "c2", label: "Latency < 200ms", layer: 1, color: "#34cfe0" },
  { id: "c3", label: "Arb profitable", layer: 1, color: "#34cfe0" }, { id: "c4", label: "Liquidity ok", layer: 1, color: "#34cfe0" },
  { id: "d1", label: "Proceed to pilot", layer: 2, color: "#f2b03d" }, { id: "d2", label: "Cap position", layer: 2, color: "#f2b03d" },
  { id: "a1", label: "Arbitrage Brief", layer: 3, color: "#9b6cff" }, { id: "a2", label: "Risk Memo", layer: 3, color: "#9b6cff" },
];
const SK_LINKS = [
  { source: "s1", target: "c1", value: 6 }, { source: "s2", target: "c3", value: 4 }, { source: "s3", target: "c2", value: 5 },
  { source: "s4", target: "c4", value: 3 }, { source: "s3", target: "c4", value: 2 },
  { source: "c1", target: "d1", value: 5 }, { source: "c2", target: "d1", value: 4 }, { source: "c3", target: "d1", value: 3 },
  { source: "c4", target: "d2", value: 4 }, { source: "c3", target: "d2", value: 2 },
  { source: "d1", target: "a1", value: 7 }, { source: "d1", target: "a2", value: 3 }, { source: "d2", target: "a2", value: 5 },
];
const CHORD_GROUPS = [
  { name: "Fees", color: "#3f8cff" }, { name: "Latency", color: "#34cfe0" }, { name: "Capacity", color: "#33d69a" },
  { name: "Risk", color: "#f2b03d" }, { name: "Regulation", color: "#9b6cff" },
];
const CHORD_MATRIX = [
  [0, 2, 1, 0, 3], [2, 0, 4, 1, 0], [1, 4, 0, 2, 1], [0, 1, 2, 0, 2], [3, 0, 1, 2, 0],
];
const HEAT_ROWS = ["K-shifts outperforms", "Impact manageable", "Data sufficient", "Risk limits cap downside", "Infra handles load", "Returns justify cost"];
const HEAT_COLS = ["Sources", "Recency", "Consistency", "Independence", "Coverage"];
const HEAT_DATA = [
  [0.9, 0.8, 0.85, 0.7, 0.75], [0.75, 0.6, 0.7, 0.65, 0.8], [0.55, 0.9, 0.5, 0.45, 0.6],
  [0.85, 0.7, 0.8, 0.75, 0.7], [0.4, 0.65, 0.35, 0.5, 0.45], [0.6, 0.55, 0.65, 0.6, 0.5],
];

function FlowsView() {
  return (
    <div className="hxv-flows">
      <div className="hxv-panel" style={{ gridColumn: "1 / -1" }}>
        <div className="hxv-panel-h"><span className="hxv-u">Evidence flow · sources → claims → decisions → artifacts</span><span className="hxv-run-meta">Sankey</span></div>
        <div style={{ padding: "6px 14px 14px" }}><Sankey nodes={SK_NODES} links={SK_LINKS} height={320} /></div>
      </div>
      <div className="hxv-panel">
        <div className="hxv-panel-h"><span className="hxv-u">Contradiction chord · where topics conflict</span></div>
        <div style={{ padding: 12, display: "grid", placeItems: "center" }}><ChordContra groups={CHORD_GROUPS} matrix={CHORD_MATRIX} size={300} /></div>
      </div>
      <div className="hxv-panel">
        <div className="hxv-panel-h"><span className="hxv-u">Confidence heatmap · assertion × dimension</span></div>
        <div style={{ padding: 12, overflowX: "auto" }}><ConfHeatmap rows={HEAT_ROWS} cols={HEAT_COLS} data={HEAT_DATA} /></div>
      </div>
    </div>
  );
}
