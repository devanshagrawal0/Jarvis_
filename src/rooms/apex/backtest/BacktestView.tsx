import { useEffect, useMemo, useRef, useState } from "react";
import { templateSpecs, type BotSpec } from "../forge/forge-spec";
import { useStrategies, fetchStrategy } from "../forge/forge-data";
import { runBacktestFull } from "./bt-engine";
import type { BacktestRun, BtConfig, Timeframe } from "./bt-types";
import { BT_CSS } from "./bt-css";
import { BtEquityChart } from "./BtEquityChart";
import { BtGauge } from "./BtGauge";
import { BtMcHisto } from "./BtMcHisto";
import { TradeDistribution, TradeDuration, MonthlyHeatmap, DrawdownTable, EquityStatsCard } from "./BtWidgets";
import { PerformanceTab, TradesTab, EquityTab, AnalysisTab, RiskTab, WalkForwardTab, MonteCarloTab, ReportsTab } from "./BtTabs";
import { BtLiveRun } from "./BtLiveRun";
import { AutopsyTab, ImproveTab } from "./BtLabs";
import { NewsTab, RegimeTab, StressTab } from "./BtLabs2";

/* APEX · BACKTEST ENGINE — institutional strategy research lab.
   Drives Forge "Engine B" (event-driven, no look-ahead, real commission/slippage/sizing)
   via bt-engine.runBacktestFull. Every number traces to a real computation on free-feed bars;
   modeled assumptions (costs, MC, walk-forward) are labeled. W3+W4: real charts + analytics. */

const SUBTABS = ["Overview", "Performance", "Trades", "Equity Curve", "Analysis", "Risk", "Walk-Forward", "Monte Carlo", "Autopsy", "Improve", "News", "Regime", "Stress", "Reports"] as const;
type SubTab = typeof SUBTABS[number];

const TF_OPTS: { k: Timeframe; label: string }[] = [{ k: "1d", label: "1D" }, { k: "1h", label: "1H" }, { k: "15m", label: "15m" }];
const POPULAR = ["NVDA", "AAPL", "MSFT", "TSLA", "SPY", "QQQ", "AMZN", "META", "GOOGL", "BTCUSDT"];

const fmtPct = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const fmtNum = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const fmtMoney = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const sign = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "var(--ax-mut)" : v >= 0 ? "var(--ax-pos)" : "var(--ax-neg)");

const DEFAULT_CONFIG: BtConfig = {
  strategyId: null, strategyName: "EMA Trend", symbol: "NVDA", assetClass: "stocks",
  timeframe: "1d", benchmark: "SPY", startCash: 100_000, commissionPct: 0.05, slippagePct: 0.05, mode: "long",
};

function specForConfig(base: BotSpec, cfg: BtConfig): BotSpec {
  return { ...base, universe: { ...base.universe, symbols: [cfg.symbol], bar: cfg.timeframe, assetClass: (cfg.assetClass as BotSpec["universe"]["assetClass"]) || base.universe.assetClass } };
}

const KPIS: { key: string; label: string; get: (r: BacktestRun) => string; col: (r: BacktestRun) => string }[] = [
  { key: "tr", label: "TOTAL RETURN", get: (r) => fmtPct(r.metrics.totalReturnPct), col: (r) => sign(r.metrics.totalReturnPct) },
  { key: "cagr", label: "CAGR", get: (r) => fmtPct(r.metrics.cagrPct), col: (r) => sign(r.metrics.cagrPct) },
  { key: "sharpe", label: "SHARPE", get: (r) => fmtNum(r.metrics.sharpe), col: () => "var(--ax-tx)" },
  { key: "sortino", label: "SORTINO", get: (r) => fmtNum(r.metrics.sortino), col: () => "var(--ax-tx)" },
  { key: "mdd", label: "MAX DRAWDOWN", get: (r) => fmtPct(r.metrics.maxDrawdownPct), col: () => "var(--ax-neg)" },
  { key: "win", label: "WIN RATE", get: (r) => fmtPct(r.metrics.winRatePct, 1), col: () => "var(--ax-tx)" },
  { key: "pf", label: "PROFIT FACTOR", get: (r) => fmtNum(r.metrics.profitFactor), col: (r) => sign(r.metrics.profitFactor - 1) },
  { key: "exp", label: "EXPECTANCY", get: (r) => fmtMoney(r.metrics.expectancy, 2), col: (r) => sign(r.metrics.expectancy) },
  { key: "sqn", label: "SQN", get: (r) => fmtNum(r.metrics.sqn), col: () => "var(--ax-tx)" },
];

const PERF_ROWS: { label: string; get: (r: BacktestRun) => string; col: (r: BacktestRun) => string }[] = [
  { label: "Total Return", get: (r) => fmtPct(r.metrics.totalReturnPct), col: (r) => sign(r.metrics.totalReturnPct) },
  { label: "CAGR", get: (r) => fmtPct(r.metrics.cagrPct), col: (r) => sign(r.metrics.cagrPct) },
  { label: "Sharpe", get: (r) => fmtNum(r.metrics.sharpe), col: () => "var(--ax-tx)" },
  { label: "Sortino", get: (r) => fmtNum(r.metrics.sortino), col: () => "var(--ax-tx)" },
  { label: "Calmar", get: (r) => fmtNum(r.metrics.calmar), col: () => "var(--ax-tx)" },
  { label: "Max Drawdown", get: (r) => fmtPct(r.metrics.maxDrawdownPct), col: () => "var(--ax-neg)" },
  { label: "Win Rate", get: (r) => fmtPct(r.metrics.winRatePct, 1), col: () => "var(--ax-tx)" },
  { label: "Expectancy", get: (r) => fmtMoney(r.metrics.expectancy, 2), col: (r) => sign(r.metrics.expectancy) },
  { label: "Total Trades", get: (r) => String(r.metrics.trades), col: () => "var(--ax-tx)" },
  { label: "Avg Win", get: (r) => fmtPct(r.metrics.avgWinPct), col: () => "var(--ax-pos)" },
  { label: "Avg Loss", get: (r) => fmtPct(r.metrics.avgLossPct), col: () => "var(--ax-neg)" },
  { label: "Best / Worst", get: (r) => `${fmtPct(r.metrics.bestPct)} / ${fmtPct(r.metrics.worstPct)}`, col: () => "var(--ax-mut)" },
];

export function BacktestView() {
  const { list: dbStrategies } = useStrategies();
  const builtIns = useMemo(() => templateSpecs(1), []);
  const [cfg, setCfg] = useState<BtConfig>(DEFAULT_CONFIG);
  const [selId, setSelId] = useState<string>(() => builtIns[0]?.meta.id || "");
  const [tab, setTab] = useState<SubTab>("Overview");
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showTrades, setShowTrades] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [lastSpec, setLastSpec] = useState<BotSpec | null>(null);
  const [showLive, setShowLive] = useState(false);
  const [newBest, setNewBest] = useState(false);
  const specCache = useRef<Record<string, BotSpec>>({});

  const library = useMemo(() => {
    const cards = builtIns.map((s) => ({ id: s.meta.id, name: s.meta.name, tags: s.meta.tags || [], desc: s.meta.description || "", builtin: true }));
    for (const s of dbStrategies) if (!cards.some((c) => c.id === s.id)) cards.push({ id: s.id, name: s.name, tags: s.tags || [], desc: s.description || "", builtin: false });
    const q = search.trim().toLowerCase();
    return q ? cards.filter((c) => c.name.toLowerCase().includes(q) || c.tags.some((t) => t.toLowerCase().includes(q))) : cards;
  }, [builtIns, dbStrategies, search]);

  useEffect(() => { for (const s of builtIns) specCache.current[s.meta.id] = s; }, [builtIns]);

  async function resolveSpec(id: string): Promise<BotSpec | null> {
    if (specCache.current[id]) return specCache.current[id];
    const full = await fetchStrategy(id);
    if (full?.spec) { specCache.current[id] = full.spec; return full.spec; }
    return null;
  }
  function pickStrategy(id: string, name: string) { setSelId(id); setCfg((c) => ({ ...c, strategyId: id, strategyName: name })); }

  async function doRun() {
    if (running) return;
    setRunning(true); setErr("");
    try {
      const base = await resolveSpec(selId);
      if (!base) { setErr("Could not load that strategy spec."); setRunning(false); return; }
      const spec = specForConfig(base, cfg); setLastSpec(spec);
      const r = await runBacktestFull(spec, cfg);
      if (r.error) setErr(r.error);
      setRun(r);
      // 🎉 new all-time-best Sharpe → cinematic shockwave (only on a genuine improvement, real trades)
      if (!r.error && r.metrics.trades >= 5) {
        try {
          const best = parseFloat(localStorage.getItem("apex.bt.bestsharpe") || "-999");
          if (r.metrics.sharpe > best) { localStorage.setItem("apex.bt.bestsharpe", String(r.metrics.sharpe)); setNewBest(true); window.setTimeout(() => setNewBest(false), 2800); }
        } catch { /* */ }
      }
    } catch (e) { setErr((e as Error).message || "Backtest failed."); }
    finally { setRunning(false); }
  }

  const cfgRows: [string, string][] = [
    ["Symbol", cfg.symbol], ["Asset Class", cfg.assetClass], ["Data Source", "Yahoo Finance (Free)"],
    ["Timeframe", cfg.timeframe.toUpperCase()], ["Benchmark", cfg.benchmark],
    ["Initial Capital", fmtMoney(cfg.startCash)], ["Commission", `${cfg.commissionPct}%`],
    ["Slippage", `${cfg.slippagePct}%`], ["Mode", cfg.mode], ["Bars Used", run ? String(run.barsUsed) : "—"], ["As Of", run?.asOf || "—"],
  ];
  const hasRun = !!run && !err && !!run.strategyEquity.length;
  const stratFinal = run ? run.config.startCash * (1 + run.metrics.totalReturnPct / 100) : 0;

  return (
    <div className="ax-bte">
      <style>{BT_CSS}</style>

      {/* HEADER */}
      <div className="bte-head">
        <div className="bte-titleblock">
          <div className="bte-title">BACKTEST ENGINE</div>
          <div className="bte-sub">▸ STRATEGY RESEARCH &amp; PERFORMANCE LAB</div>
        </div>
        <div className="bte-subtabs">
          {SUBTABS.map((t) => <button key={t} className={`bte-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}{t === "Trades" && run ? <span className="bte-tc">{run.metrics.trades}</span> : null}</button>)}
        </div>
        <div className="bte-actions">
          <button className="bte-b live" disabled={!hasRun} onClick={() => setShowLive(true)} title="Cinematic live replay of this run">🎬 Live Run</button>
          <button className="bte-b" disabled={!run} onClick={() => setTab("Reports")}>Save</button>
          <button className="bte-b" disabled={!run} onClick={() => setTab("Reports")}>Export</button>
          <button className="bte-b" disabled={!run} onClick={() => setTab("Reports")}>Share</button>
          <button className="bte-b deploy" onClick={() => { setRun(null); setErr(""); }}>+ New Backtest</button>
        </div>
      </div>

      <div className="bte-scroll">
        <div className="bte-grid">
          {/* LEFT */}
          <div className="bte-left">
            <div className="bte-pnl bte-lib">
              <div className="bte-ph"><span className="bte-pt">STRATEGIES</span><span className="bte-count">{library.length}</span></div>
              <div className="bte-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search strategies…" /></div>
              <div className="bte-liblist">
                {library.map((c) => (
                  <button key={c.id} className={`bte-strat${selId === c.id ? " on" : ""}`} onClick={() => pickStrategy(c.id, c.name)}>
                    <div className="bte-strat-top"><span className="bte-strat-ic">◈</span><span className="bte-strat-n">{c.name}</span>{c.builtin && <span className="bte-strat-star">★</span>}</div>
                    <div className="bte-strat-tags">{c.tags.slice(0, 3).map((t) => <span key={t} className="bte-tag">{t}</span>)}</div>
                  </button>
                ))}
              </div>
              <div className="bte-lib-foot"><button className="bte-b sm">New Strategy</button><button className="bte-b sm">Import</button></div>
            </div>
            <div className="bte-pnl bte-cfgcard">
              <div className="bte-ph"><span className="bte-pt">CURRENT CONFIGURATION</span></div>
              <div className="bte-cfgrows">{cfgRows.map(([k, v]) => <div key={k} className="bte-cfgrow"><span className="bte-cfgk">{k}</span><span className="bte-cfgv">{v}</span></div>)}</div>
            </div>
          </div>

          {/* CENTER */}
          <div className="bte-center">
            <div className="bte-configbar">
              <Field label="Strategy"><select value={selId} onChange={(e) => { const c = library.find((x) => x.id === e.target.value); pickStrategy(e.target.value, c?.name || ""); }}>{library.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Symbol"><select value={cfg.symbol} onChange={(e) => setCfg((c) => ({ ...c, symbol: e.target.value }))}>{POPULAR.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
              <Field label="Timeframe"><select value={cfg.timeframe} onChange={(e) => setCfg((c) => ({ ...c, timeframe: e.target.value as Timeframe }))}>{TF_OPTS.map((t) => <option key={t.k} value={t.k}>{t.label}</option>)}</select></Field>
              <Field label="Capital"><input type="number" value={cfg.startCash} onChange={(e) => setCfg((c) => ({ ...c, startCash: Math.max(1000, +e.target.value || 0) }))} /></Field>
              <Field label="Commission %"><input type="number" step="0.01" value={cfg.commissionPct} onChange={(e) => setCfg((c) => ({ ...c, commissionPct: Math.max(0, +e.target.value || 0) }))} /></Field>
              <Field label="Benchmark"><select value={cfg.benchmark} onChange={(e) => setCfg((c) => ({ ...c, benchmark: e.target.value }))}>{["SPY", "QQQ", "BTCUSDT", "NONE"].map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
              <Field label="Mode"><select value={cfg.mode} onChange={(e) => setCfg((c) => ({ ...c, mode: e.target.value as BtConfig["mode"] }))}>{["long", "short", "both"].map((m) => <option key={m} value={m}>{m}</option>)}</select></Field>
              <button className="bte-run" onClick={doRun} disabled={running}>{running ? "Running…" : "▶ Run Backtest"}</button>
            </div>

            {tab === "Overview" ? (
              <div className="bte-pnl bte-hero">
                <div className="bte-ph">
                  <span className="bte-pt">EQUITY CURVE</span>
                  {hasRun && <div className="bte-legend">
                    <span><i style={{ background: "#34d399" }} />Strategy <b>{fmtMoney(stratFinal)}</b></span>
                    <span><i style={{ background: "#a98bff" }} />Buy&amp;Hold <b>{fmtMoney(run!.buyHold[run!.buyHold.length - 1]?.v)}</b></span>
                    {run!.benchmark && <span><i style={{ background: "#5ec8ff" }} />{run!.benchmarkSymbol} <b>{fmtMoney(run!.benchmark[run!.benchmark.length - 1]?.v)}</b></span>}
                  </div>}
                  {hasRun && <div className="bte-chartctl">
                    <label><input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />Log</label>
                    <label><input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} />Trades</label>
                  </div>}
                </div>
                <div className="bte-herobody">
                  {running ? <div className="bte-empty"><div className="bte-spin" />Running the strategy over real bars…</div>
                    : err ? <div className="bte-empty bte-err">⚠ {err}</div>
                    : hasRun ? <BtEquityChart run={run!} showTrades={showTrades} logScale={logScale} />
                    : <div className="bte-empty">Pick a strategy + symbol and hit <b>Run Backtest</b>. The engine runs it over real free-feed bars — no look-ahead, modeled costs.</div>}
                </div>
              </div>
            ) : !hasRun ? (
              <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">{tab.toUpperCase()}</span></div><div className="bte-stage-body">Run a backtest to populate the {tab} view.</div></div>
            ) : (
              <div className="bte-tabhost">
                {tab === "Performance" && <PerformanceTab run={run!} />}
                {tab === "Trades" && <TradesTab run={run!} />}
                {tab === "Equity Curve" && <EquityTab run={run!} />}
                {tab === "Analysis" && <AnalysisTab run={run!} />}
                {tab === "Risk" && <RiskTab run={run!} spec={lastSpec} config={cfg} />}
                {tab === "Walk-Forward" && <WalkForwardTab run={run!} />}
                {tab === "Monte Carlo" && <MonteCarloTab run={run!} />}
                {tab === "Autopsy" && <AutopsyTab run={run!} spec={lastSpec} config={cfg} />}
                {tab === "Improve" && <ImproveTab run={run!} spec={lastSpec} config={cfg} />}
                {tab === "News" && <NewsTab run={run!} config={cfg} />}
                {tab === "Regime" && <RegimeTab run={run!} spec={lastSpec} config={cfg} />}
                {tab === "Stress" && <StressTab run={run!} spec={lastSpec} config={cfg} />}
                {tab === "Reports" && <ReportsTab run={run!} />}
              </div>
            )}
          </div>

          {/* RIGHT */}
          <div className="bte-right">
            <div className="bte-pnl">
              <div className="bte-ph"><span className="bte-pt">PERFORMANCE SUMMARY</span></div>
              {hasRun ? (
                <>
                  <BtGauge value={run!.metrics.profitFactor} max={4} label="PROFIT FACTOR" />
                  <div className="bte-perflist">{PERF_ROWS.map((r) => <div key={r.label} className="bte-perfrow"><span>{r.label}</span><b style={{ color: r.col(run!) }}>{r.get(run!)}</b></div>)}</div>
                </>
              ) : <div className="bte-stage-body">Run a backtest to see the report.</div>}
            </div>
            <div className="bte-pnl">
              <div className="bte-ph"><span className="bte-pt">WALK-FORWARD ANALYSIS</span></div>
              {run?.walkForward ? (
                <>
                  <div className="bte-wf-sq">{run.walkForward.folds.map((f) => <span key={f.i} className={f.passed ? "pass" : "fail"} title={`OOS ${f.oosFrom}→${f.oosTo} · Sharpe ${f.oosSharpe}`} />)}<em>{run.walkForward.folds.filter((f) => f.passed).length}/{run.walkForward.folds.length}</em></div>
                  <div className="bte-perfrow"><span>OOS Sharpe</span><b style={{ color: sign(run.walkForward.oosSharpe) }}>{fmtNum(run.walkForward.oosSharpe)}</b></div>
                  <div className="bte-perfrow"><span>OOS Return</span><b style={{ color: sign(run.walkForward.oosRetPct) }}>{fmtPct(run.walkForward.oosRetPct)}</b></div>
                  <div className="bte-mc-note">Rolling OOS re-evaluation of the same spec (no re-fit)</div>
                </>
              ) : <div className="bte-stage-body">{run ? "Not enough bars for walk-forward." : "—"}</div>}
            </div>
            <div className="bte-pnl">
              <div className="bte-ph"><span className="bte-pt">MONTE CARLO SIMULATION</span></div>
              {run?.mc ? (
                <>
                  <BtMcHisto mc={run.mc} />
                  <div className="bte-perfrow"><span>Simulations</span><b>{run.mc.runs.toLocaleString()}</b></div>
                  <div className="bte-perfrow"><span>Prob. of Profit</span><b style={{ color: sign(run.mc.pProfit - 0.5) }}>{(run.mc.pProfit * 100).toFixed(1)}%</b></div>
                  <div className="bte-perfrow"><span>5th / 95th Pctile</span><b>{fmtMoney(run.mc.p5)} / {fmtMoney(run.mc.p95)}</b></div>
                  <div className="bte-perfrow"><span>Avg Final Equity</span><b>{fmtMoney(run.mc.avgFinal)}</b></div>
                  <div className="bte-mc-note">Seeded bootstrap of realized trades · reproducible</div>
                </>
              ) : <div className="bte-stage-body">{run ? "Not enough trades for MC." : "—"}</div>}
            </div>
          </div>
        </div>

        {/* FULL-WIDTH KPI STRIP + WIDGET ROW (Overview) */}
        {tab === "Overview" && hasRun && (
          <>
            <div className="bte-kpis">{KPIS.map((k) => <div key={k.key} className="bte-kpi"><div className="bte-kpi-l">{k.label}</div><div className="bte-kpi-v" style={{ color: k.col(run!) }}>{k.get(run!)}</div></div>)}</div>
            {run!.metrics.trades < 20 && <div className="bte-caveat">⚠ Only {run!.metrics.trades} trades — Sharpe / profit-factor / win-rate are statistically noisy at this sample size; treat them as indicative (see PSR under the Improve tab).</div>}
            <div className="bte-widgets">
              <div className="bte-pnl bte-w"><div className="bte-ph"><span className="bte-pt">TRADE DISTRIBUTION</span></div><TradeDistribution run={run!} /></div>
              <div className="bte-pnl bte-w bte-w-wide"><div className="bte-ph"><span className="bte-pt">MONTHLY RETURNS</span></div><MonthlyHeatmap run={run!} /></div>
              <div className="bte-pnl bte-w"><div className="bte-ph"><span className="bte-pt">DRAWDOWN ANALYSIS</span></div><DrawdownTable run={run!} /></div>
              <div className="bte-pnl bte-w"><div className="bte-ph"><span className="bte-pt">TRADE DURATION</span></div><TradeDuration run={run!} /></div>
              <div className="bte-pnl bte-w"><div className="bte-ph"><span className="bte-pt">EQUITY CURVE STATS</span></div><EquityStatsCard run={run!} /></div>
            </div>
          </>
        )}
      </div>

      {/* FOOTER */}
      <div className="bte-foot">
        <span className={`bte-dot${run ? " on" : ""}`} /> {run ? "READY" : "IDLE"}
        <span className="bte-fsep" /> DATA: <b>Yahoo Finance (Free)</b>
        <span className="bte-fsep" /> ENGINE: <b>Forge · no look-ahead · modeled costs</b>
        {run?.synthetic && <><span className="bte-fsep" /><span className="bte-badge warn">SYNTHETIC DATA</span></>}
        {run?.delayed && <><span className="bte-fsep" /><span className="bte-badge">PRICES DELAYED</span></>}
        <span className="bte-fright">Simulated backtest — past performance is not indicative of future results. Not financial advice.</span>
      </div>

      {showLive && run && !err && <BtLiveRun run={run} onClose={() => setShowLive(false)} />}
      {newBest && run && <div className="bte-shock"><span className="bte-shock-ring" /><span className="bte-shock-ring r2" /><div className="bte-shock-toast">★ NEW BEST · Sharpe {run.metrics.sharpe.toFixed(2)}</div></div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="bte-field"><label>{label}</label>{children}</div>;
}
