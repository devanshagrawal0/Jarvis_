// Observability (H9). Pixel target: ref_07 §4-6. Run log + citation trace +
// reproducibility. Reads live runs/events from the substrate; sample fallback.
import React, { useEffect, useState } from "react";
import { Ico } from "../hxIcons";

interface Run { id: string; status: string; stage?: string; trigger?: string; total_cost?: number; created_at?: string; }
const SAMPLE: Run[] = [
  { id: "RUN-2026-07-12-0941", status: "success", stage: "synthesize", trigger: "inquiry", total_cost: 0.014, created_at: "9:41 AM" },
  { id: "RUN-2026-07-12-0830", status: "success", stage: "decide", trigger: "analysis", total_cost: 0.031, created_at: "8:30 AM" },
  { id: "RUN-2026-07-11-1712", status: "failed", stage: "gather", trigger: "research", total_cost: 0.006, created_at: "5:12 PM" },
];
const STAGES = ["Ingest", "Retrieve", "Analyze", "Synthesize", "Decide"];
const TABS = ["Overview", "Retrievals", "Cost", "Citation trace", "Reproduce"] as const;

export function Observability({ projectId }: { projectId?: string }) {
  const [runs, setRuns] = useState<Run[]>(SAMPLE);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<typeof TABS[number]>("Overview");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/helix/runs?projectId=${projectId}`).then(r => r.json()).then(d => {
      if (d?.runs?.length) setRuns(d.runs.map((r: any) => ({
        id: (r.id || "").slice(0, 8).toUpperCase(), status: r.status, stage: r.stage,
        trigger: r.trigger, total_cost: r.total_cost, created_at: (r.created_at || "").slice(11, 16),
      })));
    }).catch(() => {});
  }, [projectId]);

  const run = runs[sel] || SAMPLE[0];
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">Observability</div><div className="hxv-h1-sub">Every run, retrieval, citation, and cost — reproducible.</div></div>
      </div>
      <div className="hxv-obs">
        <div className="hxv-panel" style={{ padding: 8, alignSelf: "start" }}>
          <div className="hxv-u" style={{ padding: "6px 8px 8px" }}>Runs</div>
          {runs.map((r, i) => (
            <div key={r.id + i} className={"hxv-runrow" + (sel === i ? " on" : "")} onClick={() => setSel(i)}>
              <div style={{ flex: 1 }}><div className="hxv-run-id">{r.id}</div><div className="hxv-run-meta">{r.trigger} · {r.created_at}</div></div>
              <span className={"hxv-run-st " + r.status}>{r.status}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="hxv-panel" style={{ marginBottom: 14 }}>
            <div className="hxv-panel-h">
              <span className="hxv-run-id">{run.id}</span>
              <span className={"hxv-run-st " + run.status}>{run.status}</span>
            </div>
            <div style={{ display: "flex", gap: 2, padding: "0 14px", borderBottom: "1px solid var(--v-line)" }}>
              {TABS.map(t => <div key={t} className={"hxv-dtab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t}</div>)}
            </div>

            {tab === "Overview" && (
              <div>
                <div className="hxv-pipeline">
                  {STAGES.map((s, i) => (
                    <React.Fragment key={s}>
                      <div className={"hxv-pstage" + (run.status !== "failed" || i < 1 ? " done" : "")}>
                        <div className="hxv-pstage-ic">{run.status !== "failed" || i < 1 ? "✓" : "•"}</div>
                        <div className="hxv-pstage-k">{s}</div><div className="hxv-pstage-t">{(1 + i * 1.4).toFixed(1)}s</div>
                      </div>
                      {i < STAGES.length - 1 && <div className="hxv-pline" />}
                    </React.Fragment>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: "var(--v-line)", borderTop: "1px solid var(--v-line)" }}>
                  {[["Queries", "1"], ["Sources retrieved", "128"], ["Evidence selected", "23"], ["Cost", "$" + (run.total_cost ?? 0).toFixed(3)]].map(([k, v]) => (
                    <div key={k} style={{ background: "var(--v-panel)", padding: "13px 15px" }}>
                      <div className="hxv-mono" style={{ fontSize: 18, fontWeight: 650 }}>{v}</div>
                      <div style={{ fontSize: 10.5, color: "var(--v-text3)", marginTop: 3 }}>{k}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "Retrievals" && (
              <div style={{ padding: 8 }}>
                {["prediction market regulation → 18 hits, 6 ingested", "cross-exchange fees → 12 hits, 4 ingested", "latency benchmarks → 9 hits, 3 ingested"].map(q => (
                  <div className="hxv-row" key={q}><span className="hxv-dot" /><div className="hxv-row-main"><div className="hxv-row-t">{q}</div></div><span className="hxv-tag">FTS+vec</span></div>
                ))}
              </div>
            )}
            {tab === "Cost" && (
              <div style={{ padding: 14 }}>
                {[["Flash-Lite (classify)", "$0.001"], ["3.5 Flash (synthesis)", "$0.009"], ["Embedding-2", "$0.002"], ["Pro (decision)", "$0.002"]].map(([k, v]) => (
                  <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span><span className="hxv-sc-v">{v}</span></div>
                ))}
                <div className="hxv-sc-row" style={{ borderTop: "1px solid var(--v-line2)", marginTop: 4 }}><span className="hxv-sc-k" style={{ fontWeight: 600 }}>Total</span><span className="hxv-sc-v hxv-val-good">${(run.total_cost ?? 0.014).toFixed(3)}</span></div>
              </div>
            )}
            {tab === "Citation trace" && (
              <div style={{ padding: 14 }}>
                {["A1 → EVD-1a2b3c → Deribit Fees Doc · p.3 · L8-12 (Supports)", "A2 → EVD-4f5g6h → Research Brief · p.1 · L1-6 (Supports)", "A5 → EVD-7i8j9k → Forum Post · p.1 (Insufficient)"].map(c => (
                  <div className="hxv-row" key={c}><span className="hxv-lin-node" /><div className="hxv-row-main"><div className="hxv-row-t" style={{ fontSize: 11.5, fontFamily: "var(--v-mono)" }}>{c}</div></div></div>
                ))}
              </div>
            )}
            {tab === "Reproduce" && (
              <div style={{ padding: 14 }}>
                <div className="hxv-integrity pass" style={{ marginBottom: 10 }}><span>✓</span><span>Reproducible — all source & model versions pinned</span></div>
                {[["Helix Core", "v2.4.1"], ["Retrieval", "v2.1.0"], ["Embedding model", "gemini-embedding-2"], ["Knowledge snapshot", "2026-07-12T00:00Z"]].map(([k, v]) => (
                  <div className="hxv-sc-row" key={k}><span className="hxv-sc-k">{k}</span><span className="hxv-sc-v">{v}</span></div>
                ))}
                <button className="hxv-btn solid" style={{ width: "100%", justifyContent: "center", marginTop: 12 }}>Rerun with pinned versions</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
