import { useEffect, useMemo, useState } from "react";
import type { BacktestRun, BtConfig } from "./bt-types";
import type { BotSpec } from "../forge/forge-spec";
import { buildArtifact, runResult } from "./bt-engine";
import { runMetaScores, type MetaScores } from "../forge/improver/meta";
import { buildAutopsy, autopsyTradeAI, autopsyStrategyAI, type AutopsyResult, type AutopsyNode, type AutopsyTrade, type Verdict } from "./bt-autopsy";
import { MEASURES, computeMeasures, improvePlanAI, type MeasureResult, type MeasureGroup } from "./bt-measures";

const VC: Record<Verdict, string> = { good: "var(--ax-pos)", warn: "var(--ax-warn)", bad: "var(--ax-neg)", info: "var(--ax-mut)" };
const money = (v: number) => `$${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/* ── 🧠 AI TRADE AUTOPSY ── */
function NodeView({ node, depth }: { node: AutopsyNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const has = !!node.children?.length;
  return (
    <div className="bta-node" style={{ marginLeft: depth * 14 }}>
      <div className={`bta-nrow${has ? " has" : ""}`} onClick={() => has && setOpen((o) => !o)}>
        <span className="bta-dot" style={{ background: VC[node.verdict] }} />
        {has && <span className="bta-caret">{open ? "▾" : "▸"}</span>}
        <span className="bta-nlabel" style={{ color: node.verdict === "info" ? "var(--ax-tx)" : VC[node.verdict] }}>{node.label}</span>
        {node.detail && <span className="bta-ndetail">{node.detail}</span>}
      </div>
      {has && open && node.children!.map((c) => <NodeView key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}

export function AutopsyTab({ run, spec, config }: { run: BacktestRun; spec: BotSpec | null; config: BtConfig }) {
  const [res, setRes] = useState<AutopsyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number>(-1);
  const [ai, setAi] = useState<Record<number, string>>({});
  const [aiLoad, setAiLoad] = useState<number | null>(null);
  const [strat, setStrat] = useState(""); const [stratLoad, setStratLoad] = useState(false);

  useEffect(() => {
    if (!spec) return; let dead = false; setLoading(true); setRes(null); setAi({}); setStrat("");
    buildArtifact(spec, config).then((art) => { if (dead) return; if (art) { const r = buildAutopsy(art); setRes(r); setSel(r.summary.worstIdx); } setLoading(false); }).catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, spec]);

  const worstFirst = useMemo(() => (res ? [...res.trades].sort((a, b) => b.severity - a.severity) : []), [res]);
  const cur: AutopsyTrade | undefined = res?.trades.find((t) => t.idx === sel);

  async function askTrade(t: AutopsyTrade) { setAiLoad(t.idx); const txt = await autopsyTradeAI(t, config.strategyName, config.symbol); setAi((m) => ({ ...m, [t.idx]: txt || "(AI unavailable — check the engine/model.)" })); setAiLoad(null); }
  async function askStrat() { if (!res) return; setStratLoad(true); const txt = await autopsyStrategyAI(res, config.strategyName, config.symbol); setStrat(txt || "(AI unavailable.)"); setStratLoad(false); }

  if (loading) return <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">AI TRADE AUTOPSY</span></div><div className="bte-empty"><div className="bte-spin" />Building the per-trade ledger (MAE/MFE, regime, failure flags)…</div></div>;
  if (!res || !res.trades.length) return <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">AI TRADE AUTOPSY</span></div><div className="bte-stage-body">Need a run with trades to autopsy.</div></div>;

  return (
    <div className="bta-grid">
      <div className="bta-left">
        <div className="bte-pnl">
          <div className="bte-ph"><span className="bte-pt">SYSTEMIC MISTAKES</span></div>
          <div className="bte-perfrow"><span>Wins / Losses</span><b>{res.summary.nWin} / {res.summary.nLoss}</b></div>
          <div className="bte-perfrow"><span>Avg entry efficiency</span><b style={{ color: res.summary.avgEntryEff < 0.4 ? "var(--ax-neg)" : "var(--ax-tx)" }}>{(res.summary.avgEntryEff * 100).toFixed(0)}%</b></div>
          <div className="bte-perfrow"><span>Avg exit efficiency</span><b style={{ color: res.summary.avgExitEff < 0.4 ? "var(--ax-neg)" : "var(--ax-tx)" }}>{(res.summary.avgExitEff * 100).toFixed(0)}%</b></div>
          <div className="bte-perfrow"><span>Avg wasted profit</span><b>{res.summary.avgWasted > 1 ? ">100" : (res.summary.avgWasted * 100).toFixed(0)}%</b></div>
          <div className="bta-flags">{res.flagCounts.length ? res.flagCounts.map((f) => <div key={f.flag} className="bta-flag"><span className="bta-dot" style={{ background: "var(--ax-neg)" }} />{f.flag.replace(/-/g, " ")}<b>×{f.count}</b></div>) : <div className="bte-stage-body">No recurring failure flags — clean execution.</div>}</div>
          <button className="bte-b live" style={{ width: "100%", marginTop: 10 }} onClick={askStrat} disabled={stratLoad}>{stratLoad ? "Analyzing…" : "🧠 Diagnose whole strategy"}</button>
          {strat && <div className="bta-ai">{strat}</div>}
        </div>
        <div className="bte-pnl">
          <div className="bte-ph"><span className="bte-pt">TRADES · worst first</span></div>
          <div className="bta-list">
            {worstFirst.map((t) => (
              <button key={t.idx} className={`bta-trow${sel === t.idx ? " on" : ""}`} onClick={() => setSel(t.idx)}>
                <span className="bta-tno">#{t.idx + 1}</span>
                <span className={`bta-tout ${t.rec.outcome}`}>{t.rec.outcome}</span>
                <b style={{ color: t.rec.pnl >= 0 ? "var(--ax-pos)" : "var(--ax-neg)", marginLeft: "auto" }}>{money(t.rec.pnl)}</b>
                <span className="bta-sev" title="severity">{"▰".repeat(Math.min(5, Math.round(t.severity)))}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="bte-pnl bta-detail">
        <div className="bte-ph"><span className="bte-pt">{cur ? `TRADE #${cur.idx + 1} — ROOT-CAUSE TREE` : "SELECT A TRADE"}</span>{cur && <button className="bte-b sm" style={{ flex: "none" }} onClick={() => cur && askTrade(cur)} disabled={aiLoad === cur.idx}>{aiLoad === cur.idx ? "…" : "🧠 Ask AI"}</button>}</div>
        {cur ? (
          <>
            <div className="bta-tree">{cur.tree.map((n) => <NodeView key={n.id} node={n} depth={0} />)}</div>
            {cur.rec.narrative && <div className="bta-narr"><b>Ledger note:</b> {cur.rec.narrative}</div>}
            {ai[cur.idx] && <div className="bta-ai"><b>🧠 AI verdict &amp; fix:</b> {ai[cur.idx]}</div>}
          </>
        ) : <div className="bte-stage-body">Pick a trade on the left to see its recursive autopsy.</div>}
      </div>
    </div>
  );
}

/* ── 🎯 MULTI-MEASURE ANALYZE & IMPROVE ── */
const DEFAULT_SEL = ["auc", "brier", "sharpe", "calmar", "pf", "psr"];
export function ImproveTab({ run, spec, config }: { run: BacktestRun; spec: BotSpec | null; config: BtConfig }) {
  const [selIds, setSelIds] = useState<Set<string>>(new Set(DEFAULT_SEL));
  const [results, setResults] = useState<MeasureResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(""); const [planLoad, setPlanLoad] = useState(false);
  const groups = useMemo(() => { const g: Record<MeasureGroup, typeof MEASURES> = { Probabilistic: [], "Risk-Adjusted": [], Profitability: [] }; for (const m of MEASURES) g[m.group].push(m); return g; }, []);
  const toggle = (id: string) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function run_() {
    if (!spec) return; setLoading(true); setPlan("");
    const ids = [...selIds]; const needsMeta = MEASURES.some((m) => ids.includes(m.id) && m.needsMeta);
    let meta: MetaScores | null = null;
    if (needsMeta) { const rr = await runResult(spec, config); if (rr) meta = await runMetaScores(spec, rr); }
    setResults(computeMeasures(run, meta, ids)); setLoading(false);
  }
  async function makePlan() { if (!results) return; setPlanLoad(true); setPlan(await improvePlanAI(results, config.strategyName, config.symbol) || "(AI unavailable.)"); setPlanLoad(false); }

  return (
    <div className="bta-grid">
      <div className="bte-pnl bta-picker">
        <div className="bte-ph"><span className="bte-pt">TARGET MEASURES</span><span className="bte-count">{selIds.size}</span></div>
        {(Object.keys(groups) as MeasureGroup[]).map((g) => (
          <div key={g} className="bti-group">
            <div className="bti-gh">{g}</div>
            {groups[g].map((m) => (
              <label key={m.id} className={`bti-opt${selIds.has(m.id) ? " on" : ""}`}><input type="checkbox" checked={selIds.has(m.id)} onChange={() => toggle(m.id)} />{m.name}{m.needsMeta && <em>meta</em>}</label>
            ))}
          </div>
        ))}
        <button className="bte-run" style={{ width: "100%", marginTop: 10, marginLeft: 0 }} onClick={run_} disabled={loading || !selIds.size}>{loading ? "Analyzing…" : `▶ Analyze ${selIds.size} measures`}</button>
        <div className="bte-mc-note">Probabilistic measures grade the meta-labeler's out-of-sample P(win) calibration (needs ≥12 trades).</div>
      </div>
      <div className="bta-detail" style={{ background: "none", border: 0, padding: 0 }}>
        {!results ? <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">HOW TO IMPROVE</span></div><div className="bte-stage-body">Pick your target measures and hit <b>Analyze</b>. Each gets a real score + concrete steps to improve it.</div></div> : (
          <>
            <div className="bti-cards">
              {results.map((r) => (
                <div key={r.id} className="bte-pnl bti-card">
                  <div className="bti-ctop"><span className="bti-cname">{r.name}</span><span className="bti-cval">{r.display}</span></div>
                  <div className="bti-cint">{r.interpret}</div>
                  {r.improve.length > 0 && <ul className="bti-steps">{r.improve.map((s, i) => <li key={i}>{s}</li>)}</ul>}
                </div>
              ))}
            </div>
            <div className="bte-pnl" style={{ marginTop: 11 }}>
              <div className="bte-ph"><span className="bte-pt">🧠 AI IMPROVEMENT PLAN</span><button className="bte-b sm" style={{ flex: "none" }} onClick={makePlan} disabled={planLoad}>{planLoad ? "…" : "Generate"}</button></div>
              {plan ? <div className="bta-ai">{plan}</div> : <div className="bte-stage-body">Synthesize a prioritized plan across the weakest measures.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
