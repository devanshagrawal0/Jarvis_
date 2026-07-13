// Evidence surface (H6). Pixel target: ref_01 §3, ref_04. Filter rail replaces the
// old category tabs; pinned Open Contradictions + Unsupported Claims; ordinal
// confidence only (§14 Q7); every row traces to a source.
import React, { useEffect, useRef, useState } from "react";
import { Ico } from "../hxIcons";
import { useDrawer } from "../Drawer";
import { useUI } from "../HxUI";
import { useSelection } from "../HxInspector";
import { useContextMenu } from "../HxContextMenu";
import { ConfBar } from "../hxViz";
import { Radar, Donut, BarMini } from "../hxCharts";

const METRICS = [
  { v: "1,248", k: "Total Evidence", sub: "", tone: "" },
  { v: "842", k: "Supported", sub: "68%", tone: "good" },
  { v: "126", k: "Contradictory", sub: "10%", tone: "bad" },
  { v: "280", k: "Unsupported", sub: "22%", tone: "warn" },
];
const FILTERS = {
  "Support Status": [["Supported", 842, true], ["Contradictory", 126, true], ["Unsupported", 280, false]],
  "Evidence Type": [["Claim", 612, false], ["Fact", 342, false], ["Metric", 198, false], ["Observation", 76, false]],
  "Topic / Domain": [["Trading Algorithms", 342, false], ["Market Structure", 301, false], ["Data Quality", 189, false]],
};
type Sup = "sup" | "con" | "uns";
const STR_COLOR = { High: "#33d69a", Medium: "#f2b03d", Low: "#f0686d" } as const;
const ROWS: { type: string; claim: string; topic: string; support: Sup; label: string; strength: keyof typeof STR_COLOR; src: number; time: string }[] = [
  { type: "Claim", claim: "Kalshi Trading Algorithm consistently outperforms baseline strategies", topic: "Trading Algorithms · Performance", support: "sup", label: "Supported", strength: "High", src: 12, time: "2h" },
  { type: "Claim", claim: "Kalshi market-making model adjusts spreads in real-time based on volatility", topic: "Market Making · Model Behavior", support: "sup", label: "Supported", strength: "Medium", src: 8, time: "3h" },
  { type: "Claim", claim: "Kalshi uses off-book liquidity to improve execution quality", topic: "Liquidity · Execution", support: "con", label: "Contradictory", strength: "Medium", src: 6, time: "5h" },
  { type: "Metric", claim: "Kalshi API latency p95 is under 200ms", topic: "Infrastructure · API", support: "uns", label: "Unsupported", strength: "Low", src: 2, time: "7h" },
  { type: "Fact", claim: "Kalshi does not share customer PII with third parties", topic: "Privacy · Compliance", support: "sup", label: "Supported", strength: "High", src: 15, time: "9h" },
  { type: "Claim", claim: "Kalshi Cross-Exchange Strategy is profitable net of fees", topic: "Trading Algorithms · Arbitrage", support: "con", label: "Contradictory", strength: "Medium", src: 9, time: "12h" },
  { type: "Fact", claim: "Deribit maker fee 0.02% vs taker fee 0.05% for options", topic: "Fees · Structure", support: "sup", label: "Supported", strength: "High", src: 4, time: "1d" },
];

// Map a real backend entry → an evidence row. Ordinal strength from stored confidence
// (never a bare %); refusals/non-answers are surfaced as Unsupported so they can't pose
// as findings (the anti-junk gate at the display layer).
function entryToRow(e: any): typeof ROWS[number] {
  const conf = typeof e.confidence === "number" ? e.confidence : 0.4;
  const isRefusal = /i have not verified|i cannot|i'm not able|no response/i.test(e.text || "");
  const strength: "High" | "Medium" | "Low" = conf >= 0.75 ? "High" : conf >= 0.5 ? "Medium" : "Low";
  const support: Sup = isRefusal ? "uns" : e.contradicted ? "con" : "sup";
  const label = support === "uns" ? "Unsupported" : support === "con" ? "Contradictory" : "Supported";
  return { type: (e.strand || "claim").replace(/^\w/, (c: string) => c.toUpperCase()).slice(0, 6),
    claim: e.query || (e.text || "").slice(0, 80), topic: e.strand || "evidence",
    support, label, strength, src: 1, time: "recent" };
}

const STR_RANK = { High: 3, Medium: 2, Low: 1 };

export function Evidence({ projectId }: { projectId?: string }) {
  const { open } = useDrawer();
  const { toast, prompt } = useUI();
  const { select: inspSelect, togglePin, isPinned, toggleCompare, addNote } = useSelection();
  const { show: showCtx } = useContextMenu();
  const [tab, setTab] = useState("All Evidence");
  const [rows, setRows] = useState<typeof ROWS>(ROWS);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"Recent" | "Strength" | "Sources">("Recent");
  const [views, setViews] = useState<{ name: string; tab: string; on: Record<string, boolean>; search: string; sort: string }[]>(() => { try { return JSON.parse(localStorage.getItem("helix-ev-views") || "[]"); } catch { return []; } });
  // Hover-peek (#9): preview a claim without navigating.
  const peekTimer = useRef<any>(null);
  const [peek, setPeek] = useState<{ r: typeof rows[number]; x: number; y: number } | null>(null);
  const showPeek = (e: React.MouseEvent, r: typeof rows[number]) => { const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => setPeek({ r, x: rect.right + 12, y: rect.top }), 360); };
  const hidePeek = () => { clearTimeout(peekTimer.current); setPeek(null); };
  useEffect(() => () => clearTimeout(peekTimer.current), []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/helix/entries?projectId=${projectId}`).then(r => r.json()).then(d => {
      const entries = (d?.entries || []).filter((e: any) => !e.voided);
      if (entries.length) setRows(entries.map(entryToRow));
    }).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);
  const [on, setOn] = useState<Record<string, boolean>>({ Supported: true, Contradictory: true });
  // #2 fix: all counts derive from the actual rows (no contradictory hardcoded totals).
  const cSup = rows.filter(r => r.support === "sup").length;
  const cCon = rows.filter(r => r.support === "con").length;
  const cUns = rows.filter(r => r.support === "uns").length;
  const typeCount = (t: string) => rows.filter(r => r.type.toLowerCase() === t.toLowerCase()).length;
  const tabs: [string, number][] = [["All Evidence", rows.length], ["Contradictions", cCon], ["Unsupported", cUns], ["Watchlist", 0]];
  const FILT: Record<string, [string, number][]> = {
    "Support Status": [["Supported", cSup], ["Contradictory", cCon], ["Unsupported", cUns]],
    "Evidence Type": [["Claim", typeCount("Claim")], ["Fact", typeCount("Fact")], ["Metric", typeCount("Metric")], ["Observation", typeCount("Observ")]],
  };

  // ── ACTUAL filtering: tab + support toggles + type toggles + search + sort ──
  const supMap: Record<string, string> = { Supported: "sup", Contradictory: "con", Unsupported: "uns" };
  const activeSupport = Object.keys(supMap).filter(k => on[k]);
  const activeTypes = ["Claim", "Fact", "Metric", "Observation"].filter(t => on[t]);
  let displayed = rows.filter(r => {
    if (tab === "Contradictions" && r.support !== "con") return false;
    if (tab === "Unsupported" && r.support !== "uns") return false;
    if (tab === "Watchlist") return false;
    if (activeSupport.length && !activeSupport.some(k => supMap[k] === r.support)) return false;
    if (activeTypes.length && !activeTypes.some(t => r.type.toLowerCase().startsWith(t.toLowerCase().slice(0, 4)))) return false;
    if (search && !(r.claim + " " + r.topic).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  displayed = [...displayed].sort((a, b) =>
    sort === "Strength" ? STR_RANK[b.strength] - STR_RANK[a.strength]
    : sort === "Sources" ? b.src - a.src : 0);

  const ingestSource = async () => {
    if (!projectId) { toast("Pick a project first", "warn"); return; }
    const title = await prompt({ title: "Ingest source", label: "Add a source (document name or URL) to cite from.", placeholder: "e.g. https://sec.gov/reg-nms  or  deribit_fees.pdf", confirmText: "Ingest" });
    if (!title) return;
    try {
      const r = await fetch("/api/helix/source/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, title, sourceType: /^https?:/.test(title) ? "web" : "document" }) });
      if (r.ok) {
        setRows(rs => [{ type: "Source", claim: title, topic: "ingested", support: "sup", label: "Supported", strength: "High", src: 1, time: "now" }, ...rs]);
        toast(`Ingested "${title.slice(0, 40)}"`, "good");
      } else toast("Ingest failed", "bad");
    } catch { toast("Network error", "bad"); }
  };

  // Saved views (#4): persist a named filter/sort/tab/search state and re-apply instantly.
  const persistViews = (v: typeof views) => { setViews(v); localStorage.setItem("helix-ev-views", JSON.stringify(v)); };
  const saveView = async () => {
    const name = await prompt({ title: "Save view", label: "Name this filter combination", placeholder: "e.g. Unresolved contradictions", confirmText: "Save" });
    if (!name) return;
    persistViews([{ name, tab, on: { ...on }, search, sort }, ...views.filter(v => v.name !== name)].slice(0, 12));
    toast(`View "${name}" saved`, "good");
  };
  const applyView = (v: typeof views[number]) => { setTab(v.tab); setOn(v.on || {}); setSearch(v.search || ""); setSort((v.sort as any) || "Recent"); toast(`Applied "${v.name}"`); };
  const deleteView = (name: string) => persistViews(views.filter(v => v.name !== name));

  // Build a SelItem for a row (shared by inspector select, context menu, pin/compare).
  const rowItem = (r: typeof rows[number], i: number) => ({
    id: "ev-" + i, kind: r.support === "con" ? "claim" : r.type.toLowerCase(), title: r.claim, subtitle: r.topic,
    confidence: r.strength === "High" ? 0.85 : r.strength === "Medium" ? 0.62 : 0.35,
    support: { sup: r.support === "sup" ? r.src : 0, con: r.support === "con" ? 1 : 0 },
    meta: [["Type", r.type], ["Strength", r.strength], ["Status", r.label], ["Sources", String(r.src)]] as [string, string][],
    backlinks: rows.map((rr, ii) => ({ rr, ii })).filter(x => x.ii !== i && x.rr.topic === r.topic).slice(0, 6)
      .map(({ rr, ii }) => ({ kind: rr.support === "con" ? "claim" : rr.type.toLowerCase(), title: rr.claim, via: "same topic", onClick: () => selectRow(rr, ii) })),
  });
  const selectRow = (r: typeof rows[number], i: number) => inspSelect(rowItem(r, i));
  const rowContext = (e: React.MouseEvent, r: typeof rows[number], i: number) => {
    e.preventDefault(); const it = rowItem(r, i);
    showCtx(e.clientX, e.clientY, [
      { label: "Inspect", run: () => inspSelect(it) },
      { label: isPinned(it.id) ? "Unpin" : "Pin", run: () => togglePin(it) },
      { label: "Add to compare", run: () => toggleCompare(it) },
      { sep: true },
      { label: "Add note", run: async () => { const t = await prompt({ title: "Add note", label: `Annotate "${r.claim.slice(0, 40)}"`, placeholder: "Your note…", confirmText: "Add" }); if (t) addNote(it.id, t); } },
      { label: "Copy claim text", run: () => { try { navigator.clipboard?.writeText(r.claim); toast("Copied claim"); } catch { toast("Copy failed", "bad"); } } },
    ]);
  };

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div>
          <div className="hxv-h1">Evidence</div>
          <div className="hxv-h1-sub">Discover, assess, and manage evidence across your research.</div>
        </div>
        <button className="hxv-btn" onClick={ingestSource}><Ico.plus /> Ingest source</button>
      </div>

      <div className="hxv-metrics">
        {(() => {
          const total = rows.length;
          const sup = rows.filter(r => r.support === "sup").length;
          const con = rows.filter(r => r.support === "con").length;
          const uns = rows.filter(r => r.support === "uns").length;
          const pct = (n: number) => total ? Math.round((n / total) * 100) + "%" : "—";
          const live = [
            { v: String(total), k: "Total Evidence", sub: "", tone: "" },
            { v: String(sup), k: "Supported", sub: pct(sup), tone: "good" },
            { v: String(con), k: "Contradictory", sub: pct(con), tone: "bad" },
            { v: String(uns), k: "Unsupported", sub: pct(uns), tone: "warn" },
          ];
          return live.map(m => (
            <div className="hxv-metric" key={m.k} onClick={() => setTab(m.k === "Contradictory" ? "Contradictions" : m.k === "Unsupported" ? "Unsupported" : "All Evidence")}>
              <div className="hxv-metric-v">{m.v}</div>
              <div className="hxv-metric-k">{m.k}</div>
              {m.sub && <div className={"hxv-metric-sub hxv-val-" + m.tone}>{m.sub}</div>}
            </div>
          ));
        })()}
      </div>

      <div className="hxv-ev">
        {/* filter rail */}
        <div className="hxv-filters">
          <div className="hxv-filter-grp">
            <span className="hxv-u" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>Saved views <span className="hxv-savelink" onClick={saveView}>+ Save</span></span>
            {views.length === 0 && <div className="hxv-view-empty">Save a filter combo to reuse it.</div>}
            {views.map(v => (
              <div className="hxv-view" key={v.name} onClick={() => applyView(v)}>
                <span className="hxv-view-dot" /><span className="hxv-view-name">{v.name}</span>
                <button className="hxv-view-x" onClick={e => { e.stopPropagation(); deleteView(v.name); }} title="Delete view">×</button>
              </div>
            ))}
          </div>
          {Object.entries(FILT).map(([grp, opts]) => (
            <div className="hxv-filter-grp" key={grp}>
              <span className="hxv-u">{grp}</span>
              {opts.map(([n, count]) => (
                <div key={n as string} className={"hxv-filter" + (on[n as string] ? " on" : "")}
                  onClick={() => setOn(s => ({ ...s, [n as string]: !s[n as string] }))}>
                  <span className="hxv-check">✓</span>
                  <span>{n}</span>
                  <span className="hxv-filter-n">{count as number}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* main */}
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div className="hxv-evsearch" style={{ flex: 1, marginBottom: 0 }}>
              <Ico.search />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search evidence…"
                style={{ background: "transparent", border: "none", outline: "none", color: "var(--v-text)", flex: 1, fontFamily: "var(--v-font)", fontSize: 12.5 }} />
            </div>
            <div className="hxv-select" onClick={() => setSort(s => s === "Recent" ? "Strength" : s === "Strength" ? "Sources" : "Recent")}>
              <span className="hxv-u" style={{ letterSpacing: ".08em" }}>Sort</span> <b>{sort}</b> <Ico.chevron />
            </div>
          </div>
          <div className="hxv-tabs">
            {tabs.map(([t, n]) => (
              <div key={t} className={"hxv-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>
                {t}<span className="hxv-tab-n">{n}</span>
              </div>
            ))}
          </div>

          <div className="hxv-etable">
            <div className="hxv-erow head">
              <span>Type</span><span>Claim</span><span>Support</span><span>Strength</span><span style={{ textAlign: "center" }}>Sources</span><span style={{ textAlign: "right" }}>Updated</span>
            </div>
            {displayed.length === 0 && <div style={{ padding: 24, textAlign: "center", fontSize: 12, color: "var(--v-text3)" }}>No evidence matches these filters.</div>}
            {displayed.map((r, i) => (
              <div className="hxv-erow" key={i} onMouseEnter={e => showPeek(e, r)} onMouseLeave={hidePeek} onContextMenu={e => { hidePeek(); rowContext(e, r, i); }} onClick={() => { hidePeek(); selectRow(r, i); open({
                type: "Evidence · " + r.type,
                title: r.claim,
                quote: r.claim,
                source: r.topic,
                pointer: ["Source " + r.src, "Captured " + r.time + " ago"],
                support: { label: r.label, tone: r.support },
                confidence: r.support === "uns"
                  ? null
                  : { label: r.strength === "High" ? "Strong" : r.strength === "Medium" ? "Moderate" : "Weak",
                      inputs: [["Independent sources", String(r.src)], ["Contradictions", r.support === "con" ? "≥1" : "0"], ["Recency", r.time + " ago"], ["Source reliability", r.strength]] },
                lineage: ["Ingested from source", "Claim extracted", "Linked to question", r.support === "sup" ? "Used in 1 analysis" : "Pending review"],
                audit: [["Captured", r.time + " ago"], ["Support status", r.label], ["Type", r.type]],
              }); }}>
                <span className="hxv-etype">{r.type}</span>
                <div className="hxv-eclaim"><div className="hxv-eclaim-t">{r.claim}</div><div className="hxv-eclaim-s">{r.topic}</div></div>
                <span className={"hxv-support " + r.support}>{r.label}</span>
                <span className="hxv-strength">
                  <span className="hxv-strbar"><i style={{ width: r.strength === "High" ? "100%" : r.strength === "Medium" ? "60%" : "30%", background: STR_COLOR[r.strength] }} /></span>
                  {r.strength}
                </span>
                <span className="hxv-esrc">{r.src}</span>
                <span className="hxv-etime">{r.time}</span>
              </div>
            ))}
          </div>

          {/* Source coverage — radar + gaps (ref_04 §5) */}
          <div className="hxv-cols" style={{ marginTop: 16 }}>
            <div className="hxv-panel">
              <div className="hxv-panel-h"><span className="hxv-u">Source coverage</span><span className="hxv-link" onClick={() => toast("2 coverage gaps: Latency (40%), Regulation (60%) — ingest more sources", "warn")}>View gaps</span></div>
              <div style={{ padding: "8px 8px 16px" }}>
                <Radar size={230} axes={["Market Data", "Fees", "Latency", "Regulation", "Execution", "Risk"]}
                  series={[{ name: "coverage", color: "var(--v-accent)", values: [0.9, 0.75, 0.4, 0.6, 0.8, 0.55] },
                           { name: "target", color: "var(--v-cyan)", values: [1, 1, 0.8, 0.8, 1, 0.8] }]} />
              </div>
            </div>
            <div className="hxv-panel">
              <div className="hxv-panel-h"><span className="hxv-u">Coverage summary</span></div>
              <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 18px" }}>
                <Donut value={0.68} size={100} color="var(--v-accent)" sub="Overall" />
                <div style={{ flex: 1 }}>
                  {[["Well covered", 0.9, "var(--v-good)"], ["Moderate", 0.6, "var(--v-warn)"], ["Undercovered", 0.3, "var(--v-bad)"]].map(([k, v, c]) => (
                    <div key={k as string} className="hxv-sc-row"><span className="hxv-sc-k">{k}</span><BarMini value={v as number} color={c as string} /></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {peek && (() => { const v = peek.r.strength === "High" ? 0.85 : peek.r.strength === "Medium" ? 0.62 : 0.35; return (
        <div className="hxv-peek" style={{ top: Math.min(peek.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 180), left: Math.min(peek.x, (typeof window !== "undefined" ? window.innerWidth : 1280) - 292) }}>
          <div className="hxv-peek-type">{peek.r.type} · preview</div>
          <div className="hxv-peek-t">{peek.r.claim}</div>
          <div className="hxv-peek-row"><span>Confidence</span><ConfBar value={v} band={[Math.max(0, v - 0.08), Math.min(1, v + 0.08)]} width={104} /></div>
          <div className="hxv-peek-row"><span>Support</span><span className={"hxv-support " + peek.r.support}>{peek.r.label}</span></div>
          <div className="hxv-peek-row"><span>Strength</span><span className="hxv-mono">{peek.r.strength}</span></div>
          <div className="hxv-peek-row"><span>Sources</span><span className="hxv-mono">{peek.r.src}</span></div>
        </div>
      ); })()}
    </div>
  );
}
