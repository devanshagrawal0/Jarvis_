// Artifacts library (distinct from Build). Build is the WORKSPACE (folders → segments →
// operations that PRODUCE artifacts). Artifacts is the LIBRARY — a browsable gallery of the
// finished deliverables with type/status filters, metadata, preview, and export. Binds to
// live /api/helix/artifacts; falls back to a representative set, honestly badged.
import React, { useEffect, useMemo, useState } from "react";
import { Ico } from "../hxIcons";
import { useUI } from "../HxUI";
import { useSelection } from "../HxInspector";
import { Treemap } from "../HxWidgets";

interface Art { id?: string; n: string; type: string; status: "ready" | "draft" | "review"; updated: string; cites?: number; size?: string }
const SAMPLE: Art[] = [
  { n: "Kalshi_Arbitrage_Brief.pdf", type: "Brief", status: "review", updated: "2h", cites: 142, size: "1.2 MB" },
  { n: "Kalshi_Arbitrage_Deck.pptx", type: "Deck", status: "draft", updated: "3h", cites: 38, size: "4.8 MB" },
  { n: "Exchange_Fees_Comparison.xlsx", type: "Table", status: "ready", updated: "4h", cites: 24, size: "88 KB" },
  { n: "Arbitrage_Backtest_v1.parquet", type: "Dataset", status: "ready", updated: "4h", cites: 0, size: "22 MB" },
  { n: "Market_Microstructure_Notes.docx", type: "Brief", status: "draft", updated: "1d", cites: 51, size: "320 KB" },
  { n: "Liquidity_Model_v1.ipynb", type: "Model", status: "ready", updated: "1d", cites: 12, size: "1.9 MB" },
  { n: "Reg_Mapping_CheatSheet.pdf", type: "Brief", status: "ready", updated: "2d", cites: 33, size: "460 KB" },
  { n: "Q1_Structure_Report.pdf", type: "Brief", status: "review", updated: "3d", cites: 78, size: "2.1 MB" },
];
const TYPE_ICON: Record<string, keyof typeof Ico> = { Brief: "evidence", Deck: "layers", Table: "analyze", Dataset: "projects", Model: "build", Export: "build" };
const TYPES = ["All", "Brief", "Deck", "Table", "Dataset", "Model"];
const STATUSES = ["All", "ready", "review", "draft"];

export function Artifacts({ projectId, onNav }: { projectId?: string; onNav?: (s: string) => void }) {
  const { toast } = useUI();
  const { select } = useSelection();
  const [arts, setArts] = useState<Art[]>(SAMPLE);
  const [live, setLive] = useState(false);
  const [type, setType] = useState("All");
  const [status, setStatus] = useState("All");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/helix/artifacts?projectId=${projectId}`).then(r => r.json()).then(d => {
      const list = d?.artifacts || [];
      if (list.length) {
        setArts(list.map((a: any) => ({
          id: a.id,
          n: (a.title || "artifact") + "." + ({ combine: "pdf", convert: "docx", compare: "xlsx", extract: "csv", package: "zip", brief: "pdf" }[(a.artifact_type || "brief") as string] || "pdf"),
          type: ({ combine: "Brief", convert: "Brief", compare: "Table", extract: "Dataset", package: "Export" }[(a.artifact_type || "") as string] || "Brief"),
          status: (a.status === "needs_review" ? "review" : a.status === "published" ? "ready" : "draft") as Art["status"],
          updated: "recent", cites: a.citation_count ?? undefined,
        })));
        setLive(true);
      }
    }).catch(() => {});
  }, [projectId]);

  const exportArt = async (a: Art) => {
    if (a.id && projectId) {
      try {
        const r = await fetch(`/api/helix/artifact/${a.id}/export?projectId=${projectId}`); const d = await r.json();
        if (d.markdown) { const blob = new Blob([d.markdown], { type: "text/markdown" }); const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = a.n.replace(/\.\w+$/, "") + ".md"; el.click(); URL.revokeObjectURL(url); toast(`Exported ${a.n}`, "good"); return; }
      } catch { /* fall through */ }
    }
    toast(`"${a.n}" — generate it in Build to export the real file.`, "warn");
  };

  const shown = useMemo(() => arts.filter(a =>
    (type === "All" || a.type === type) && (status === "All" || a.status === status) && a.n.toLowerCase().includes(q.toLowerCase())
  ), [arts, type, status, q]);

  const counts = useMemo(() => ({
    total: arts.length, ready: arts.filter(a => a.status === "ready").length,
    review: arts.filter(a => a.status === "review").length, draft: arts.filter(a => a.status === "draft").length,
  }), [arts]);

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div>
          <div className="hxv-h1">Artifacts {live ? <span className="hxv-pill active" style={{ verticalAlign: "middle" }}>Live</span> : null}</div>
          <div className="hxv-h1-sub">Your finished deliverables — briefs, decks, tables, datasets and models.</div>
        </div>
        <button className="hxv-btn solid" onClick={() => { toast("Opening Build to generate a new artifact"); onNav?.("build"); }}><Ico.plus /> New artifact</button>
      </div>

      {/* Status summary strip */}
      <div className="hxv-astat">
        {([["Total", counts.total, ""], ["Ready", counts.ready, "good"], ["In review", counts.review, "warn"], ["Draft", counts.draft, ""]] as const).map(([k, v, tone]) => (
          <div className="hxv-astat-c" key={k}><span className={"hxv-astat-v " + (tone ? "hxv-val-" + tone : "")}>{v}</span><span className="hxv-astat-k">{k}</span></div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="hxv-afilters">
        <div className="hxv-evsearch" style={{ maxWidth: 300, margin: 0 }}><Ico.search /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search artifacts…" style={{ background: "transparent", border: "none", outline: "none", color: "var(--v-text)", flex: 1, fontFamily: "var(--v-font)", fontSize: 12.5 }} /></div>
        <div className="hxv-aseg">{TYPES.map(t => <button key={t} className={"hxv-achip" + (type === t ? " on" : "")} onClick={() => setType(t)}>{t}</button>)}</div>
        <div className="hxv-aseg">{STATUSES.map(s => <button key={s} className={"hxv-achip" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>{s === "All" ? "Any status" : s}</button>)}</div>
      </div>

      {/* Gallery */}
      {shown.length === 0 ? (
        <div className="hxv-bento-empty" style={{ textAlign: "center", padding: 40 }}>No artifacts match these filters.</div>
      ) : (
        <div className="hxv-agal">
          {shown.map((a, i) => { const IconC = Ico[TYPE_ICON[a.type] || "evidence"]; const ext = a.n.split(".").pop()?.toUpperCase(); return (
            <div className="hxv-acard" key={a.id || a.n + i}
              onClick={() => select({ id: "art-" + (a.id || i), kind: "artifact", title: a.n, subtitle: `${a.type} · ${a.status}`,
                meta: [["Type", a.type], ["Status", a.status], ["Updated", a.updated], ...(a.cites != null ? [["Citations", String(a.cites)] as [string, string]] : []), ...(a.size ? [["Size", a.size] as [string, string]] : [])],
                actions: [{ label: "Export", run: () => exportArt(a) }] })}>
              <div className="hxv-acard-top">
                <span className="hxv-acard-ic" style={{ color: kcol(a.type) }}><IconC /></span>
                <span className={"hxv-art-status " + a.status}>{a.status}</span>
              </div>
              <div className="hxv-acard-name">{a.n}</div>
              <div className="hxv-acard-meta">
                <span className="hxv-acard-ext" style={{ color: kcol(a.type) }}>{ext}</span>
                <span>{a.type}</span>
                {a.size && <span>· {a.size}</span>}
              </div>
              <div className="hxv-acard-foot">
                <span className="hxv-acard-cites">{a.cites != null ? `${a.cites} citations` : "—"}</span>
                <span className="hxv-acard-time">{a.updated}</span>
                <button className="hxv-acard-exp" onClick={e => { e.stopPropagation(); exportArt(a); }} title="Export"><Ico.arrow /></button>
              </div>
            </div>
          ); })}
        </div>
      )}

      {shown.length > 1 && (
        <div className="hxv-panel" style={{ marginTop: 14 }}>
          <div className="hxv-panel-h"><span className="hxv-u">Library map · sized by citations</span><span className="hxv-run-meta">Treemap</span></div>
          <div style={{ padding: "8px 14px 14px" }}>
            <Treemap width={680} height={210} data={shown.map(a => ({ name: a.n.replace(/\.\w+$/, ""), value: (a.cites || 0) + 4, color: kcol(a.type) }))}
              onClick={(name) => { const a = shown.find(x => x.n.replace(/\.\w+$/, "") === name); if (a) select({ id: "art-tm-" + name, kind: "artifact", title: a.n, subtitle: `${a.type} · ${a.status}`, meta: [["Type", a.type], ["Status", a.status], ["Citations", String(a.cites ?? 0)]] }); }} />
          </div>
        </div>
      )}
    </div>
  );
}

const KIND: Record<string, string> = { Brief: "#3f8cff", Deck: "#9b6cff", Table: "#34cfe0", Dataset: "#33d69a", Model: "#f2b03d", Export: "#8aa2c8" };
const kcol = (t: string) => KIND[t] || "#33c2d1";
