// Build surface (H8). Pixel target: ref_06. Folders → Segments → Operations
// (Combine/Convert/Compare/Extract/Package) → Artifact library. Every artifact
// carries a manifest; segment membership freezes on use (§14 Q5).
import React, { useEffect, useState } from "react";
import { Ico } from "../hxIcons";
import { Donut } from "../hxCharts";

const FOLDERS = [["All Artifacts", 24], ["Research Briefs", 24], ["Kalshi_Arbitrage_Brief", 11], ["Market Studies", 18], ["Data Exports", 36], ["Presentations", 12], ["Archive", 27]];
const SEGMENTS = [["Primary Sources Only", 18], ["Post-2024 Only", 134], ["Contradicted Only", 23], ["High-Quality Sources", 67], ["US Market Only", 41]];
const OPS: { k: string; ico: keyof typeof Ico; s: string }[] = [
  { k: "Combine", ico: "layers", s: "Merge multiple sources into one artifact" },
  { k: "Convert", ico: "spark", s: "Transform file types or structures" },
  { k: "Compare", ico: "analyze", s: "Compare sources or datasets side by side" },
  { k: "Extract", ico: "evidence", s: "Pull structured data or insights" },
  { k: "Package", ico: "build", s: "Bundle artifacts and data for export" },
];
const ARTIFACTS: { n: string; type: string; status: "ready" | "draft" | "review"; updated: string }[] = [
  { n: "Kalshi_Arbitrage_Brief.pdf", type: "Brief", status: "review", updated: "2h" },
  { n: "Kalshi_Arbitrage_Deck.pptx", type: "Deck", status: "draft", updated: "3h" },
  { n: "Exchange_Fees_Comparison.xlsx", type: "Table", status: "ready", updated: "4h" },
  { n: "Arbitrage_Backtest_v1.parquet", type: "Dataset", status: "ready", updated: "4h" },
  { n: "Market_Microstructure_Notes.docx", type: "Brief", status: "draft", updated: "1d" },
  { n: "Liquidity_Model_v1.ipynb", type: "Model", status: "ready", updated: "1d" },
  { n: "Reg_Mapping_CheatSheet.pdf", type: "Brief", status: "ready", updated: "2d" },
];

const TYPE_ICON: Record<string, keyof typeof Ico> = { Brief: "evidence", Deck: "layers", Table: "analyze", Dataset: "projects", Model: "build" };

export function Build({ projectId }: { projectId?: string }) {
  const [folder, setFolder] = useState("Kalshi_Arbitrage_Brief");
  const [seg, setSeg] = useState("");
  const [op, setOp] = useState("Combine");
  const [artifacts, setArtifacts] = useState(ARTIFACTS);
  const [busy, setBusy] = useState("");
  const [flash, setFlash] = useState("");

  const [ids, setIds] = useState<string[]>([]);
  const loadArtifacts = () => {
    if (!projectId) return;
    fetch(`/api/helix/artifacts?projectId=${projectId}`).then(r => r.json()).then(d => {
      if (Array.isArray(d?.artifacts) && d.artifacts.length) {
        setIds(d.artifacts.map((a: any) => a.id));
        setArtifacts(d.artifacts.map((a: any) => ({
          n: (a.title || "artifact") + "." + ({ combine: "pdf", convert: "docx", compare: "xlsx", extract: "csv", package: "zip" }[a.artifact_type as string] || "pdf"),
          type: (a.artifact_type || "brief").replace(/^\w/, (c: string) => c.toUpperCase()),
          status: (a.status === "needs_review" ? "review" : a.status === "published" ? "ready" : "draft") as "ready" | "draft" | "review",
          updated: "just now",
        })));
      }
    }).catch(() => {});
  };
  // H11: export an artifact's real rendered content (markdown, cited) and download it.
  const exportArtifact = async (artifactId: string, name: string) => {
    if (!projectId || !artifactId) return;
    try {
      const r = await fetch(`/api/helix/artifact/${artifactId}/export?projectId=${projectId}`);
      const d = await r.json();
      if (d.markdown) {
        const blob = new Blob([d.markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = (name || "artifact").replace(/\.\w+$/, "") + ".md"; a.click();
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore */ }
  };
  useEffect(loadArtifacts, [projectId]);

  const runOp = async (operationType: string) => {
    if (!projectId) { setFlash("Pick a project first."); return; }
    setBusy(operationType);
    try {
      const r = await fetch("/api/helix/operation/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, operationType: operationType.toLowerCase(), title: `${folder} · ${operationType}`, folderId: null }),
      });
      const d = await r.json();
      if (r.ok && d.artifactId) { setFlash(`${operationType} complete — artifact created (${d.artifactId.slice(0, 8)})`); loadArtifacts(); }
      else setFlash(d.error || "Operation failed");
    } catch (e: any) { setFlash(e?.message || "Network error"); }
    finally { setBusy(""); setTimeout(() => setFlash(""), 4000); }
  };

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div>
          <div className="hxv-h1">Build</div>
          <div className="hxv-h1-sub">Turn evidence and decisions into reproducible deliverables.</div>
        </div>
        <button className="hxv-btn solid" onClick={() => runOp("Combine")} disabled={!!busy}><Ico.plus /> New artifact</button>
      </div>
      {flash && <div className="hxv-integrity pass" style={{ marginBottom: 12 }}><span>✓</span><span>{flash}</span></div>}

      <div className="hxv-build">
        {/* Folders + Segments */}
        <div className="hxv-panel" style={{ padding: 8, alignSelf: "start" }}>
          <div className="hxv-u" style={{ padding: "6px 8px 8px" }}>Folders</div>
          {FOLDERS.map(([n, c]) => (
            <div key={n as string} className={"hxv-list-t" + (folder === n ? " on" : "")} onClick={() => setFolder(n as string)}>
              <span className="hxv-nav-ico" style={{ fontSize: 13 }}><Ico.projects /></span>{n}<span className="hxv-list-n">{c}</span>
            </div>
          ))}
        </div>
        <div className="hxv-panel" style={{ padding: 8, alignSelf: "start" }}>
          <div className="hxv-u" style={{ padding: "6px 8px 8px" }}>Segments</div>
          {SEGMENTS.map(([n, c]) => (
            <div key={n as string} className={"hxv-list-t" + (seg === n ? " on" : "")}
              onClick={() => { const next = seg === n ? "" : (n as string); setSeg(next); setFlash(next ? `Segment scope: ${next} (${c} sources)` : "Segment scope cleared"); setTimeout(() => setFlash(""), 3000); }}>
              <span className="hxv-nav-ico" style={{ fontSize: 13 }}><Ico.evidence /></span>{n}<span className="hxv-list-n">{c}</span>
            </div>
          ))}
        </div>

        {/* Operations + artifact library */}
        <div>
          <div className="hxv-u" style={{ marginBottom: 8 }}>Operations</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 16 }}>
            {OPS.map(o => {
              const IconC = Ico[o.ico];
              return (
                <div key={o.k} className={"hxv-op" + (op === o.k ? " on" : "") + (busy === o.k ? " busy" : "")}
                  onClick={() => { setOp(o.k); runOp(o.k); }} style={{ flexDirection: "column", alignItems: "flex-start", marginBottom: 0, opacity: busy && busy !== o.k ? 0.5 : 1 }}>
                  <span className="hxv-op-ico">{busy === o.k ? "…" : <IconC />}</span>
                  <div><div className="hxv-op-t">{o.k}</div><div className="hxv-op-s">{o.s}</div></div>
                </div>
              );
            })}
          </div>

          <div className="hxv-cols" style={{ gridTemplateColumns: "1fr 260px", alignItems: "start" }}>
            <div className="hxv-etable">
              <div className="hxv-art head"><span>Artifact</span><span>Type</span><span>Status</span><span style={{ textAlign: "right" }}>Updated</span></div>
              {artifacts.map((a, i) => (
                <div className="hxv-art" key={a.n + i} onClick={() => ids[i] && exportArtifact(ids[i], a.n)} title={ids[i] ? "Click to export (.md)" : ""} style={{ cursor: ids[i] ? "pointer" : "default" }}>
                  <span className="hxv-art-n"><span className="hxv-nav-ico" style={{ color: "var(--v-accent2)", fontSize: 13 }}><Ico.evidence /></span>{a.n}</span>
                  <span style={{ fontSize: 11.5, color: "var(--v-text2)" }}>{a.type}</span>
                  <span className={"hxv-art-status " + a.status}>{a.status}</span>
                  <span className="hxv-etime">{ids[i] ? "export ↓" : a.updated}</span>
                </div>
              ))}
            </div>

            {/* Artifact preview + citation check (ref_06 §5) */}
            <div className="hxv-panel" style={{ overflow: "hidden" }}>
              <div className="hxv-panel-h"><span className="hxv-u">Preview</span><span className="hxv-link" style={{ cursor: "pointer" }} onClick={() => ids[0] ? exportArtifact(ids[0], artifacts[0]?.n) : setFlash("Generate an artifact first — nothing to open yet.")}>Open</span></div>
              <div style={{ padding: 12 }}>
                <div style={{ background: "#0f1626", border: "1px solid var(--v-line)", borderRadius: 6, padding: "16px 14px", minHeight: 150 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, textAlign: "center" }}>Kalshi Cross-Exchange<br />Arbitrage Strategy</div>
                  <div style={{ fontSize: 9, color: "var(--v-text3)", textAlign: "center", marginTop: 4, textTransform: "uppercase", letterSpacing: ".1em" }}>Research Brief · May 2026</div>
                  <div style={{ marginTop: 12 }}>
                    {["1 Opportunity Overview", "2 Market & Data", "3 Strategy Design", "4 Backtest Results", "5 Risk & Mitigations"].map(s => (
                      <div key={s} style={{ fontSize: 10, color: "var(--v-text2)", padding: "3px 0", borderBottom: "1px solid var(--v-line)" }}>{s}</div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
                  <Donut value={0.92} size={72} color="var(--v-good)" sub="Cited" />
                  <div style={{ fontSize: 11, color: "var(--v-text2)" }}>
                    <div style={{ color: "var(--v-good)", fontWeight: 600 }}>Citations complete</div>
                    <div style={{ color: "var(--v-text3)", marginTop: 3 }}>142 sources · 0 broken links</div>
                    <div style={{ color: "var(--v-warn)", marginTop: 3 }}>2 weak citations</div>
                  </div>
                </div>
                <button className="hxv-btn solid" style={{ width: "100%", justifyContent: "center", marginTop: 12 }} onClick={() => runOp("Package")} disabled={!!busy}>{busy === "Package" ? "Packaging…" : "Package & export"}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
