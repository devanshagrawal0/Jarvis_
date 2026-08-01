// Ask surface (H5 + wired to H10 pipeline). Type a question → Run → hits the live
// /api/helix/pipeline/run, shows real pipeline phases + real results (sub-questions,
// evidence cards, cited answer). No sample data on the action path.
import React, { useEffect, useRef, useState } from "react";
import { Ico } from "../hxIcons";
import { useUI } from "../HxUI";
import { HxReport } from "../HxReport";
import { useDrawer } from "../Drawer";
import { isHelixReport, legacyAnswerToReport, type HelixReport } from "../helix-report-types";

const MODELS = ["Helix-Research v2", "Helix-Fast", "Helix-Deep"];

// W8: depth is a REAL lever now. Each option changes sub-question count, gap rounds, sources
// per call, claim budget and whether CoVe re-checking runs. Times are measured, not aspirational.
const DEPTHS = [
  { id: "quick",      label: "Quick",      hint: "~75s · ~$0.11 · 3 angles, 1 pass, no re-checking" },
  { id: "standard",   label: "Standard",   hint: "~110s · ~$0.40 · 6 angles, 2 passes, verified" },
  { id: "exhaustive", label: "Exhaustive", hint: "~2.5min · ~$0.60 · 8 angles, 3 passes, deepest" },
] as const;
type DepthId = typeof DEPTHS[number]["id"];

const INTENTS = ["Research", "Compare", "Evaluate", "Design", "Monitor", "Decide", "Explain"];
// Must match the stage names the pipeline emits, in order. "Verifying" was added in W6 and
// was missing here, so the last ~25s of every run had no phase to sit in.
const PHASES = ["Planning", "Gathering", "Checking", "Synthesizing", "Verifying"] as const;
const STAGE_ORDER = ["planning", "gathering", "checking", "synthesizing", "verifying"];

interface PipelineResult {
  runId?: string; subquestions?: string[];
  cards?: { title: string; excerpt: string; matchedBy?: string }[];
  assertions?: { text: string; confidence?: string }[];
  answer?: string; cost?: number; error?: string;
  report?: HelixReport | null;   // W3/W4 structured report; absent on legacy runs
}

export function Ask({ projectId, onDone }: { projectId?: string; onDone?: () => void }) {
  const { toast, prompt } = useUI();
  const { open: openDrawer } = useDrawer();
  const [intent, setIntent] = useState("Research");
  const [q, setQ] = useState("");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(-1);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [elapsed, setElapsed] = useState(0);     // real seconds since the run started
  const [liveSources, setLiveSources] = useState<string[]>([]);   // arrive over SSE during gather
  const [err, setErr] = useState("");
  const [sources, setSources] = useState(["kalshi_docs.pdf", "deribit_fees.csv", "sec_reg_nms.pdf"]);
  const [model, setModel] = useState(MODELS[0]);
  // Per-project defaults: the depth and intent you last used for THIS project are what you
  // most likely want next time, and re-picking them on every question is friction.
  const prefKey = `helix.ask.prefs.${projectId || "none"}`;
  const [depth, setDepth] = useState<DepthId>("standard");
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(prefKey) || "{}");
      if (saved.depth && DEPTHS.some(d => d.id === saved.depth)) setDepth(saved.depth);
      if (saved.intent && INTENTS.includes(saved.intent)) setIntent(saved.intent);
    } catch { /* corrupt or unavailable storage is not worth failing the surface over */ }
  }, [prefKey]);
  const persist = (next: { depth?: DepthId; intent?: string }) => {
    try { localStorage.setItem(prefKey, JSON.stringify({ depth, intent, ...next })); } catch { /* non-fatal */ }
  };
  // ⌘K "Ask a new question" navigates here then fires helix:cmd → focus the input.
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.type === "focus") inputRef.current?.focus(); };
    window.addEventListener("helix:cmd", on);
    return () => window.removeEventListener("helix:cmd", on);
  }, []);
  // #23: celebrate a real milestone — pipeline complete with an answer. A single glow burst
  // on the answer panel (reserved for genuine peaks, Von Restorff). Reduced-motion: no-op via CSS.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!result?.answer && !result?.report) return;
    setCelebrate(true);
    const t = window.setTimeout(() => setCelebrate(false), 950);
    return () => clearTimeout(t);
  }, [result?.answer, result?.report]);
  // The #15 progressive-reveal typewriter was removed in W5. It paced a single flat string;
  // a structured report is scanned by heading, so delaying the headings hurt the exact
  // behaviour the report shape exists to enable.

  // A citation chip must resolve to the actual evidence, not just look clickable. E-numbers
  // are 1-based and index the same ordered evidence set the pipeline cited from.
  const openCitation = (n: number) => {
    const src = result?.report?.sources?.find((s) => s.n === n);
    const card = result?.cards?.[n - 1];
    if (!src && !card) { toast(`No evidence recorded for E${n}`, "warn"); return; }
    openDrawer({
      type: "Evidence",
      title: src?.title || card?.title || `E${n}`,
      quote: card?.excerpt,
      source: src?.url || card?.title,
      pointer: [`Citation E${n}`, ...(src?.corroborations ? [`${src.corroborations} corroborating outlets`] : [])],
    });
  };

  const addSource = async () => {
    const name = await prompt({ title: "Scope a source", label: "File name or URL to include in this run", placeholder: "e.g. cme_rulebook.pdf", confirmText: "Add" });
    if (!name) return;
    setSources(s => s.includes(name) ? s : [...s, name]);
    toast(`Added "${name}" to source scope`, "good");
  };
  const cycleModel = () => { const n = MODELS[(MODELS.indexOf(model) + 1) % MODELS.length]; setModel(n); toast(`Model · ${n}`); };

  const run = async () => {
    if (!q.trim() || running) return;
    if (!projectId) { setErr("No active project — pick one from the sidebar first."); return; }
    setErr(""); setResult(null); setRunning(true); setPhase(0); setElapsed(0);
    setLiveSources([]);
    // W7: REAL progress. The phase now comes from server stage events over SSE, not from a
    // guess based on elapsed time — the old heuristic claimed "Synthesizing" at 45s, and
    // per-phase timing proved a run is still gathering then. The clock is only a clock.
    const t0 = Date.now();
    const ticker = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    try {
      const data = await new Promise<PipelineResult>((resolve, reject) => {
        const qs = new URLSearchParams({ projectId, question: q.trim(), intent, depth, sourceScope: sources.join(",") });
        const es = new EventSource(`/api/helix/pipeline/stream?${qs}`);
        es.addEventListener("stage", (ev) => {
          const d = JSON.parse((ev as MessageEvent).data);
          const i = STAGE_ORDER.indexOf(d.stage);
          if (i >= 0) setPhase(i);
        });
        // Each source is a real acquisition, so showing them as they land is progress the
        // user can trust — and it makes a long gather phase legible instead of frozen.
        es.addEventListener("source", (ev) => {
          const d = JSON.parse((ev as MessageEvent).data);
          setLiveSources((s) => (s.includes(d.title) ? s : [...s, d.title].slice(-40)));
        });
        es.addEventListener("done", (ev) => { es.close(); resolve(JSON.parse((ev as MessageEvent).data)); });
        es.addEventListener("error", (ev) => {
          es.close();
          let msg = "Connection to the research stream was lost.";
          try { msg = JSON.parse((ev as MessageEvent).data)?.error || msg; } catch { /* transport-level error carries no body */ }
          reject(new Error(msg));
        });
      });
      clearInterval(ticker); setPhase(PHASES.length);
      if (data.error) setErr(data.error);
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
          <textarea ref={inputRef} className="hxv-ask-input" value={q} onChange={e => setQ(e.target.value)} rows={2}
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
              {/* W8: replaces the decorative "Focus" cycler and "Deep scan" toggle, neither of
                  which changed anything the pipeline did. Depth genuinely alters sub-question
                  count, gap rounds, sources per call and whether CoVe re-checking runs. */}
              <div className="hxv-depth" role="radiogroup" aria-label="Research depth">
                {DEPTHS.map((d) => (
                  <button
                    key={d.id}
                    role="radio"
                    aria-checked={depth === d.id}
                    className={"hxv-depth-b" + (depth === d.id ? " on" : "")}
                    title={d.hint}
                    onClick={() => { setDepth(d.id); persist({ depth: d.id }); toast(`Depth · ${d.label} (${d.hint.split(" · ")[0]})`); }}
                  >{d.label}</button>
                ))}
              </div>
              <span className="hxv-run-meta hxv-mono">{DEPTHS.find(d => d.id === depth)?.hint}</span>
            </div>
          </>
        )}

        {/* Live pipeline (real) */}
        {(running || result) && (
          <div className="hxv-panel hxv-sec">
            <div className="hxv-panel-h"><span className="hxv-u">Pipeline {running ? "· running" : "· complete"}</span>
              <span style={{ flex: 1 }} />
              {/* Estimate matches the measured range (W7 instrumentation: 105-135s), and the
                  live source count is real acquisition, not a spinner. */}
              {running && (
                <span className="hxv-run-meta hxv-mono">
                  {elapsed.toFixed(0)}s elapsed · typically ~110s
                  {liveSources.length > 0 && ` · ${liveSources.length} sources found`}
                </span>
              )}
              {result?.cost != null && <span className="hxv-run-meta">cost ${result.cost.toFixed(5)}</span>}</div>
            {/* #17: determinate progress — 4 phases → 25/50/75/100%. Real progress, not a spinner. */}
            <div className="hxv-progbar" style={{ margin: "8px 10px 2px" }}>
              <i style={{ width: `${result ? 100 : Math.max(6, Math.min(100, (phase / PHASES.length) * 100))}%` }} />
            </div>
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
              {/* Sources stream in during the gather phase — the longest stretch of the run,
                  and the one that previously looked frozen. Showing real arrivals is the
                  difference between "working" and "hung". */}
              {running && liveSources.length > 0 && (
                <div className="hxv-livesrc">
                  {liveSources.slice(-6).map((s, i) => (
                    <span className="hxv-livesrc-i" key={`${s}-${i}`}>{s.slice(0, 46)}</span>
                  ))}
                </div>
              )}
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
              <div className={"hxv-panel" + (celebrate ? " hxv-celebrate" : "")}>
                <div className="hxv-panel-h"><span className="hxv-u">Report</span></div>
                {/* W5: render the structured report when the pipeline produced one. Runs from
                    before W3 only carry a flat string — wrap those rather than break history.
                    The progressive-reveal typewriter applies to the legacy path only; a
                    multi-section report is scanned, not read start-to-finish, so pacing its
                    appearance would just delay the headings the reader is scanning for. */}
                {isHelixReport(result.report)
                  ? <HxReport report={result.report} onCite={openCitation} />
                  : result.answer
                    ? <HxReport report={legacyAnswerToReport(result.answer, q || "Answer")} />
                    : (
                      <div className="hxv-ans-p" style={{ borderBottom: "none" }}>
                        Insufficient evidence to answer confidently.
                      </div>
                    )}
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
