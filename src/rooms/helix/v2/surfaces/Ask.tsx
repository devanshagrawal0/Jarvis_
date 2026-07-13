// Ask surface (H5 + wired to H10 pipeline). Type a question → Run → hits the live
// /api/helix/pipeline/run, shows real pipeline phases + real results (sub-questions,
// evidence cards, cited answer). No sample data on the action path.
import React, { useState } from "react";
import { Ico } from "../hxIcons";
import { useUI } from "../HxUI";

const MODELS = ["Helix-Research v2", "Helix-Fast", "Helix-Deep"];
const FOCI = ["Accuracy", "Speed", "Coverage"];

const INTENTS = ["Research", "Compare", "Evaluate", "Design", "Monitor", "Decide", "Explain"];
const PHASES = ["Planning", "Gathering", "Checking", "Synthesizing"] as const;

interface PipelineResult {
  runId?: string; subquestions?: string[];
  cards?: { title: string; excerpt: string; matchedBy?: string }[];
  assertions?: { text: string; confidence?: string }[];
  answer?: string; cost?: number; error?: string;
}

export function Ask({ projectId, onDone }: { projectId?: string; onDone?: () => void }) {
  const { toast, prompt } = useUI();
  const [intent, setIntent] = useState("Research");
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(-1);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [err, setErr] = useState("");
  const [sources, setSources] = useState(["kalshi_docs.pdf", "deribit_fees.csv", "sec_reg_nms.pdf"]);
  const [model, setModel] = useState(MODELS[0]);
  const [focus, setFocus] = useState(FOCI[0]);
  const [deepScan, setDeepScan] = useState(true);

  const addSource = async () => {
    const name = await prompt({ title: "Scope a source", label: "File name or URL to include in this run", placeholder: "e.g. cme_rulebook.pdf", confirmText: "Add" });
    if (!name) return;
    setSources(s => s.includes(name) ? s : [...s, name]);
    toast(`Added "${name}" to source scope`, "good");
  };
  const cycleModel = () => { const n = MODELS[(MODELS.indexOf(model) + 1) % MODELS.length]; setModel(n); toast(`Model · ${n}`); };
  const cycleFocus = () => { const n = FOCI[(FOCI.indexOf(focus) + 1) % FOCI.length]; setFocus(n); toast(`Focus · ${n}`); };
  const toggleDeep = () => { setDeepScan(v => !v); toast(`Deep scan ${!deepScan ? "on" : "off"}`); };

  const run = async () => {
    if (!q.trim() || running) return;
    if (!projectId) { setErr("No active project — pick one from the sidebar first."); return; }
    setErr(""); setResult(null); setRunning(true); setPhase(0);
    // advance the phase indicator while the (synchronous) pipeline runs
    const ticker = setInterval(() => setPhase(p => Math.min(PHASES.length - 1, p + 1)), 900);
    try {
      const r = await fetch("/api/helix/pipeline/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, question: q.trim(), intent }),
      });
      const data: PipelineResult = await r.json();
      clearInterval(ticker); setPhase(PHASES.length);
      if (!r.ok || data.error) setErr(data.error || "Pipeline failed.");
      else setResult(data);
    } catch (e: any) {
      clearInterval(ticker); setErr(e?.message || "Network error");
    } finally { setRunning(false); }
  };

  return (
    <div className="hxv-surface">
      <div className="hxv-surface-head">
        <div className="hxv-h1">Ask HELIX</div>
        <button className="hxv-btn ghost" onClick={() => { setQ(""); setResult(null); setErr(""); setPhase(-1); }}><Ico.x /> Clear</button>
      </div>

      <div className="hxv-ask-wrap">
        <div className="hxv-ask-inputwrap hxv-sec">
          <textarea className="hxv-ask-input" value={q} onChange={e => setQ(e.target.value)} rows={2}
            placeholder="Ask a research question — HELIX will plan it, gather evidence, and answer with citations…"
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(); }} />
          <button className="hxv-ask-send" onClick={run} disabled={running || !q.trim()}
            style={{ opacity: running || !q.trim() ? 0.5 : 1 }}>{running ? "…" : <Ico.arrow />}</button>
        </div>

        <div className="hxv-sec">
          <div className="hxv-u hxv-sec-lbl">Intent</div>
          <div className="hxv-chips">
            {INTENTS.map(i => <div key={i} className={"hxv-chip" + (i === intent ? " on" : "")} onClick={() => setIntent(i)}>{i}</div>)}
          </div>
        </div>

        {err && <div className="hxv-integrity block" style={{ marginBottom: 14 }}><span>⛔</span><span>{err}</span></div>}

        {/* Scaffold shown before a run — Sources · Plan Preview · Pipeline · controls (ref_01 §2) */}
        {!running && !result && (
          <>
            <div className="hxv-sec">
              <div className="hxv-u hxv-sec-lbl">Sources <span style={{ color: "var(--v-text3)", letterSpacing: 0, textTransform: "none" }}>· optional scope</span></div>
              <div className="hxv-chips">
                {sources.map(s => (
                  <div key={s} className="hxv-src" onClick={() => { setSources(list => list.filter(x => x !== s)); toast(`Removed "${s}" from scope`); }} title="Click to remove from scope" style={{ cursor: "pointer" }}><span>{s}</span><span className="hxv-src-ext">{s.split(".").pop()?.toUpperCase().slice(0, 4)}</span></div>
                ))}
                <div className="hxv-src add" onClick={addSource}><Ico.plus /> Add source</div>
              </div>
            </div>
            <div className="hxv-cols hxv-sec">
              <div className="hxv-panel">
                <div className="hxv-panel-h"><span className="hxv-u">Plan preview</span><span className="hxv-run-meta">generated after you ask</span></div>
                <div style={{ padding: "4px 14px 10px" }}>
                  {["Define objective & scope", "Gather & normalize evidence", "Identify discrepancies", "Evaluate feasibility", "Recommend approach"].map((p, i) => (
                    <div className="hxv-planline" key={i}><span className="hxv-plannum" style={{ opacity: 0.5 }}>{i + 1}</span><div className="hxv-plantxt"><div className="hxv-plan-t" style={{ color: "var(--v-text3)" }}>{p}</div></div></div>
                  ))}
                </div>
              </div>
              <div className="hxv-panel">
                <div className="hxv-panel-h"><span className="hxv-u">Pipeline · idle</span></div>
                <div style={{ padding: "4px 6px 8px" }}>
                  {PHASES.map(p => (
                    <div className="hxv-pipe" key={p}><div className="hxv-pipe-l"><span className="hxv-pipe-ico queue">·</span><span className="hxv-pipe-k" style={{ color: "var(--v-text3)" }}>{p}</span></div><span className="hxv-stat queue">Queued</span></div>
                  ))}
                </div>
              </div>
            </div>
            <div className="hxv-toolbar">
              <div className="hxv-select" onClick={cycleModel} style={{ cursor: "pointer" }} title="Click to switch model"><span className="hxv-u" style={{ letterSpacing: ".08em" }}>Model</span> <b>{model}</b> <Ico.chevron /></div>
              <div className="hxv-select" onClick={cycleFocus} style={{ cursor: "pointer" }} title="Click to switch focus"><span className="hxv-u" style={{ letterSpacing: ".08em" }}>Focus</span> <b>{focus}</b> <Ico.chevron /></div>
              <div className="hxv-toggle" onClick={toggleDeep} style={{ cursor: "pointer" }}>Deep scan <span className={"hxv-switch" + (deepScan ? " on" : "")} /></div>
            </div>
          </>
        )}

        {/* Live pipeline (real) */}
        {(running || result) && (
          <div className="hxv-panel hxv-sec">
            <div className="hxv-panel-h"><span className="hxv-u">Pipeline {running ? "· running" : "· complete"}</span>
              {result?.cost != null && <span className="hxv-run-meta">cost ${result.cost.toFixed(5)}</span>}</div>
            <div style={{ padding: "4px 6px 8px" }}>
              {PHASES.map((p, i) => {
                const state = phase > i ? "done" : phase === i && running ? "run" : phase > i ? "done" : "queue";
                const label = phase > i ? "Complete" : (phase === i && running) ? "Running" : "Queued";
                return (
                  <div className="hxv-pipe" key={p}>
                    <div className="hxv-pipe-l"><span className={"hxv-pipe-ico " + state}>{state === "done" ? "✓" : state === "run" ? "•" : "·"}</span><span className="hxv-pipe-k">{p}</span></div>
                    <span className={"hxv-stat " + state}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Real results */}
        {result && (
          <>
            {!!result.subquestions?.length && (
              <div className="hxv-panel hxv-sec">
                <div className="hxv-panel-h"><span className="hxv-u">Plan · {result.subquestions.length} sub-questions</span></div>
                <div style={{ padding: "4px 14px 10px" }}>
                  {result.subquestions.map((s, i) => (
                    <div className="hxv-planline" key={i}><span className="hxv-plannum">{i + 1}</span><div className="hxv-plantxt"><div className="hxv-plan-t">{s}</div></div></div>
                  ))}
                </div>
              </div>
            )}
            <div className="hxv-cols hxv-sec">
              <div className="hxv-panel">
                <div className="hxv-panel-h"><span className="hxv-u">Answer</span></div>
                <div className="hxv-ans-p" style={{ borderBottom: "none" }}>{result.answer || "Insufficient evidence to answer confidently."}</div>
              </div>
              <div className="hxv-panel">
                <div className="hxv-panel-h"><span className="hxv-u">Evidence · {result.cards?.length || 0} cards</span><span className="hxv-link" onClick={onDone}>Open Evidence →</span></div>
                <div style={{ padding: "4px 8px 8px", maxHeight: 260, overflowY: "auto" }}>
                  {(result.cards || []).length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--v-text3)" }}>No qualifying evidence retrieved for this question.</div>}
                  {(result.cards || []).map((c, i) => (
                    <div className="hxv-row" key={i}><span className="hxv-dot" /><div className="hxv-row-main"><div className="hxv-row-t">{c.title}</div><div className="hxv-row-s">{(c.excerpt || "").slice(0, 90)}</div></div><span className="hxv-tag">{c.matchedBy || "match"}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
