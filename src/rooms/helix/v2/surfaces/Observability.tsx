// Observability (H9). Pixel target: ref_07 §4-6. Run log + citation trace +
// reproducibility. Reads live runs via the shared data layer (SWR + abort); honest
// empty/loading/error states. NOTE: the per-run tab internals (Retrievals/Cost/Citation/
// Reproduce) still show sample content — flagged for the W6 honesty sweep (#16).
import React, { useState } from "react";
import { Ico } from "../hxIcons";
import { useHelixResource } from "../useHelixResource";
import { SurfaceState } from "../SurfaceState";

interface Run { id: string; status: string; stage?: string; trigger?: string; total_cost?: number; created_at?: string; }
const STAGES = ["Ingest", "Retrieve", "Analyze", "Synthesize", "Decide"];
const TABS = ["Overview", "Retrievals", "Cost", "Citation trace", "Reproduce"] as const;

export function Observability({ projectId }: { projectId?: string }) {
  const { data, loading, error, refetch } = useHelixResource<{ runs: any[] }>(
    projectId ? `obs:${projectId}` : null,
    projectId ? `/api/helix/runs?projectId=${projectId}` : null,
  );
  const runs: Run[] = (data?.runs || []).map((r: any) => ({
    id: (r.id || "").slice(0, 8).toUpperCase(), status: r.status, stage: r.stage,
    trigger: r.trigger, total_cost: r.total_cost, created_at: (r.created_at || "").slice(11, 16),
  }));
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<typeof TABS[number]>("Overview");

  // Fallback keeps the (non-rendered) children JSX from throwing on undefined when there are
  // no runs — SurfaceState shows the empty state instead, but React still evaluates children.
  const run: Run = runs[Math.min(sel, Math.max(0, runs.length - 1))] || { id: "", status: "" };
  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div><div className="hxv-h1">Observability</div><div className="hxv-h1-sub">Every run, retrieval, citation, and cost — reproducible.</div></div>
      </div>
      <SurfaceState
        loading={loading} error={error} onRetry={refetch}
        empty={!loading && !error && runs.length === 0}
        emptyTitle="No runs yet"
        emptyMsg="Ask a question and HELIX records every pipeline run here — retrievals, citations, cost, and reproducibility.">
      <div className="hxv-obs">
        <div className="hxv-panel" style={{ padding: 8, alignSelf: "start" }}>
          <div className="hxv-u" style={{ padding: "6px 8px 8px" }}>Runs</div>
          {runs.map((r, i) => (
            <div key={r.id + i} className={"hxv-runrow" + (sel === i ? " on" : "")} onClick={() => setSel(i)}>
              <div style={{ flex: 1 }}><div className="hxv-run-id">{r.id}</div><div className="hxv-run-meta">{r.trigger} · {r.created_at}{r.total_cost != null ? ` · $${Number(r.total_cost).toFixed(3)}` : ""}</div></div>
              <span className={"hxv-run-st " + r.status}>{r.status}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="hxv-panel" style={{ marginBottom: 14 }}>
            <div className="hxv-panel-h">
              <span className="hxv-run-id">{run.id}</span>
              <span className={"hxv-run-st " + run.status}>{run.status}</span>
              <span style={{ flex: 1 }} />
              <span className="hxv-demo-badge" title="Per-run detail metrics (retrievals, cost breakdown, citations) are sample — not yet wired to this run.">sample detail</span>
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
      </SurfaceState>
    </div>
  );
}

