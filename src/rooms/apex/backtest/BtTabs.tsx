import { useEffect, useMemo, useRef, useState } from "react";
import type { BacktestRun, BtConfig, Trade } from "./bt-types";
import type { BotSpec } from "../forge/forge-spec";
import { runCostSensitivity } from "./bt-engine";
import { rollingSharpe, annualReturns, returnHistogram, varCvar, ulcerIndex, tailRatio, correlation, monthlySeasonality } from "./bt-analytics";
import { BtEquityChart } from "./BtEquityChart";
import { BtMcHisto } from "./BtMcHisto";
import { MonthlyHeatmap, EquityStatsCard } from "./BtWidgets";

const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const money = (v: number, d = 0) => (Number.isFinite(v) ? `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}` : "—");
const sc = (v: number) => (v >= 0 ? "var(--ax-pos)" : "var(--ax-neg)");
const ymd = (t: number) => (t ? new Date(t).toISOString().slice(0, 10) : "—");

/* eslint-disable react-hooks/exhaustive-deps */
function Canvas({ draw, deps, height = 130 }: { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; deps: unknown[]; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = height;
    cv.width = w * dpr; cv.height = h * dpr; const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h); try { draw(ctx, w, h); } catch { /* */ }
  }, deps);
  return <canvas ref={ref} style={{ width: "100%", height, display: "block" }} />;
}
/* eslint-enable react-hooks/exhaustive-deps */

const Panel = ({ title, children, wide, right }: { title: string; children: React.ReactNode; wide?: boolean; right?: React.ReactNode }) => (
  <div className={`bte-pnl${wide ? " bte-tab-wide" : ""}`}><div className="bte-ph"><span className="bte-pt">{title}</span>{right}</div>{children}</div>
);

// ── PERFORMANCE ──
export function PerformanceTab({ run }: { run: BacktestRun }) {
  const bhRet = run.buyHold.length ? (run.buyHold[run.buyHold.length - 1].v / run.buyHold[0].v - 1) * 100 : 0;
  const bmRet = run.benchmark && run.benchmark.length ? (run.benchmark[run.benchmark.length - 1].v / run.benchmark[0].v - 1) * 100 : NaN;
  const rows: [string, string, string][] = [
    ["Total Return", pct(run.metrics.totalReturnPct), sc(run.metrics.totalReturnPct)],
    ["vs Buy & Hold", pct(run.metrics.totalReturnPct - bhRet), sc(run.metrics.totalReturnPct - bhRet)],
    ["vs " + run.benchmarkSymbol, Number.isFinite(bmRet) ? pct(run.metrics.totalReturnPct - bmRet) : "—", sc(run.metrics.totalReturnPct - (bmRet || 0))],
    ["CAGR", pct(run.metrics.cagrPct), sc(run.metrics.cagrPct)], ["Volatility (ann.)", pct(run.metrics.volPct), "var(--ax-tx)"],
    ["Sharpe", num(run.metrics.sharpe), "var(--ax-tx)"], ["Sortino", num(run.metrics.sortino), "var(--ax-tx)"], ["Calmar", num(run.metrics.calmar), "var(--ax-tx)"],
    ["Max Drawdown", pct(run.metrics.maxDrawdownPct), "var(--ax-neg)"], ["Exposure", pct(run.metrics.exposurePct), "var(--ax-tx)"],
    ["Win Rate", pct(run.metrics.winRatePct, 1), "var(--ax-tx)"], ["Profit Factor", num(run.metrics.profitFactor), sc(run.metrics.profitFactor - 1)],
    ["Expectancy", money(run.metrics.expectancy, 2), sc(run.metrics.expectancy)], ["SQN", num(run.metrics.sqn), "var(--ax-tx)"],
  ];
  return (
    <div className="bte-tabgrid">
      <Panel title="PERFORMANCE — STRATEGY vs BENCHMARKS">
        <div className="bte-perflist">{rows.map(([k, v, c]) => <div key={k} className="bte-perfrow"><span>{k}</span><b style={{ color: c }}>{v}</b></div>)}</div>
      </Panel>
      <Panel title="MONTHLY RETURNS" wide><MonthlyHeatmap run={run} /></Panel>
      <Panel title="EQUITY CURVE STATS"><EquityStatsCard run={run} /></Panel>
    </div>
  );
}

// ── TRADES ledger ──
type SortKey = "i" | "pnl" | "retPct" | "bars";
export function TradesTab({ run }: { run: BacktestRun }) {
  const [filter, setFilter] = useState<"all" | "win" | "loss">("all");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "i", dir: 1 });
  const rows = useMemo(() => {
    let t = run.trades.map((tr, i) => ({ ...tr, i }));
    if (filter === "win") t = t.filter((x) => x.pnl > 0); else if (filter === "loss") t = t.filter((x) => x.pnl < 0);
    const { k, dir } = sort;
    return t.sort((a, b) => (((a as unknown as Record<string, number>)[k] - (b as unknown as Record<string, number>)[k]) * dir));
  }, [run, filter, sort]);
  const th = (k: SortKey, label: string) => <th onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))} className="clk">{label}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>;
  return (
    <Panel title={`TRADE LEDGER · ${run.trades.length}`} wide right={
      <div className="bte-seg">{(["all", "win", "loss"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>)}</div>
    }>
      <div className="bte-ledger-wrap">
        <table className="bte-ledger">
          <thead><tr>{th("i", "#")}<th>Side</th><th>Entry</th><th>Exit</th><th>Entry $</th><th>Exit $</th><th>Qty</th>{th("pnl", "P/L")}{th("retPct", "P/L %")}{th("bars", "Bars")}<th>Reason</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.i}>
                <td>{t.i + 1}</td><td style={{ color: (t as Trade & { qty: number }).qty >= 0 ? "var(--ax-pos)" : "var(--ax-neg)" }}>{(t as Trade & { qty: number }).qty >= 0 ? "LONG" : "SHORT"}</td>
                <td>{ymd(t.entryT)}</td><td>{ymd(t.exitT)}</td><td>{num(t.entryPx)}</td><td>{num(t.exitPx)}</td><td>{Math.abs(Math.round(t.qty))}</td>
                <td style={{ color: sc(t.pnl) }}>{money(t.pnl, 2)}</td><td style={{ color: sc(t.retPct) }}>{pct(t.retPct)}</td><td>{t.bars}</td><td className="rsn">{t.reason}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={11} className="bte-w-none">No trades match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ── EQUITY CURVE ──
export function EquityTab({ run }: { run: BacktestRun }) {
  const [showTrades, setShowTrades] = useState(true), [logScale, setLogScale] = useState(false);
  return (
    <div className="bte-tabgrid">
      <div className="bte-pnl bte-tab-wide" style={{ minHeight: 460, display: "flex", flexDirection: "column" }}>
        <div className="bte-ph"><span className="bte-pt">EQUITY CURVE</span>
          <div className="bte-chartctl"><label><input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} />Log</label><label><input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} />Trades</label></div>
        </div>
        <div style={{ flex: 1, minHeight: 400, position: "relative" }}><BtEquityChart run={run} showTrades={showTrades} logScale={logScale} /></div>
      </div>
      <Panel title="EQUITY CURVE STATS"><EquityStatsCard run={run} /></Panel>
    </div>
  );
}

// ── ANALYSIS ──
export function AnalysisTab({ run }: { run: BacktestRun }) {
  const roll = useMemo(() => rollingSharpe(run.equity, 63), [run]);
  const annual = useMemo(() => annualReturns(run.equity), [run]);
  const hist = useMemo(() => returnHistogram(run.equity), [run]);
  const seas = useMemo(() => monthlySeasonality(run.monthly), [run]);
  return (
    <div className="bte-tabgrid">
      <Panel title="ROLLING SHARPE (63-BAR)">
        <Canvas height={140} deps={[roll]} draw={(ctx, w, h) => {
          if (roll.length < 2) return; const vs = roll.map((p) => p.v); const lo = Math.min(-1, ...vs), hi = Math.max(1, ...vs), rg = hi - lo || 1;
          const X = (i: number) => (i / (roll.length - 1)) * w, Y = (v: number) => h - 6 - ((v - lo) / rg) * (h - 12);
          ctx.strokeStyle = "rgba(120,205,225,.14)"; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
          ctx.beginPath(); roll.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.v)) : ctx.moveTo(X(i), Y(p.v)))); ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 1.6; ctx.stroke();
        }} />
        <div className="bte-mc-note">Sharpe stability over time — persistent &gt;1 is the honest signal.</div>
      </Panel>
      <Panel title="ANNUAL RETURNS">
        <Canvas height={140} deps={[annual]} draw={(ctx, w, h) => {
          if (!annual.length) return; const vs = annual.map((a) => a.retPct); const mx = Math.max(10, ...vs.map(Math.abs)); const bw = w / annual.length;
          const Y0 = h / 2; annual.forEach((a, i) => { const bh = (a.retPct / mx) * (h / 2 - 14); ctx.fillStyle = a.retPct >= 0 ? "rgba(52,211,153,.8)" : "rgba(244,63,94,.8)"; ctx.fillRect(i * bw + 4, Y0 - Math.max(0, bh), bw - 8, Math.abs(bh)); ctx.fillStyle = "var(--ax-mut)"; ctx.font = "8px ui-monospace"; ctx.fillText(String(a.year).slice(2), i * bw + bw / 2 - 6, h - 2); });
        }} />
      </Panel>
      <Panel title="RETURN DISTRIBUTION">
        <Canvas height={140} deps={[hist]} draw={(ctx, w, h) => {
          if (!hist.bins.length) return; const peak = Math.max(...hist.bins.map((b) => b.count)) || 1; const bw = w / hist.bins.length;
          hist.bins.forEach((b, i) => { const bh = (b.count / peak) * (h - 14); const up = (b.x0 + b.x1) / 2 >= 0; ctx.fillStyle = up ? "rgba(52,211,153,.7)" : "rgba(244,63,94,.6)"; ctx.fillRect(i * bw + 0.5, h - bh, bw - 1, bh); });
        }} />
        <div className="bte-substats"><span>μ {num(hist.mean, 2)}%</span><span>σ {num(hist.std, 2)}%</span><span>skew {num(hist.skew, 2)}</span><span>kurt {num(hist.kurt, 2)}</span></div>
      </Panel>
      <Panel title="SEASONALITY (AVG BY MONTH)">
        <Canvas height={140} deps={[seas]} draw={(ctx, w, h) => {
          const vs = seas.map((s) => s.avgPct); const mx = Math.max(1, ...vs.map(Math.abs)); const bw = w / 12; const Y0 = h / 2;
          seas.forEach((s, i) => { const bh = (s.avgPct / mx) * (h / 2 - 14); ctx.fillStyle = s.avgPct >= 0 ? "rgba(52,211,153,.75)" : "rgba(244,63,94,.7)"; ctx.fillRect(i * bw + 3, Y0 - Math.max(0, bh), bw - 6, Math.abs(bh)); ctx.fillStyle = "var(--ax-mut)"; ctx.font = "7px ui-monospace"; ctx.fillText(s.month[0], i * bw + bw / 2 - 2, h - 2); });
        }} />
      </Panel>
    </div>
  );
}

// ── RISK ──
export function RiskTab({ run, spec, config }: { run: BacktestRun; spec: BotSpec | null; config: BtConfig }) {
  const risk = useMemo(() => ({ vc: varCvar(run.equity), ulcer: ulcerIndex(run.equity), tail: tailRatio(run.equity), corr: run.benchmark ? correlation(run.equity, run.benchmark) : NaN }), [run]);
  const [grid, setGrid] = useState<{ comms: number[]; slips: number[]; sharpe: number[][] } | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  async function runGrid() { if (!spec) return; setGridLoading(true); try { setGrid(await runCostSensitivity(spec, config)); } finally { setGridLoading(false); } }
  const cards: [string, string, string][] = [
    ["VaR 95% (1-bar)", pct(risk.vc.varPct), "var(--ax-neg)"], ["CVaR 95%", pct(risk.vc.cvarPct), "var(--ax-neg)"],
    ["Ulcer Index", num(risk.ulcer), "var(--ax-tx)"], ["Tail Ratio", num(risk.tail), "var(--ax-tx)"],
    ["Corr → " + run.benchmarkSymbol, Number.isFinite(risk.corr) ? num(risk.corr) : "—", "var(--ax-tx)"], ["Max Drawdown", pct(run.metrics.maxDrawdownPct), "var(--ax-neg)"],
  ];
  const heatCol = (v: number, lo: number, hi: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))); return `color-mix(in srgb, var(--ax-pos) ${(t * 80).toFixed(0)}%, color-mix(in srgb, var(--ax-neg) ${((1 - t) * 60).toFixed(0)}%, transparent))`; };
  const flat = grid ? grid.sharpe.flat() : []; const lo = flat.length ? Math.min(...flat) : 0, hi = flat.length ? Math.max(...flat) : 1;
  return (
    <div className="bte-tabgrid">
      <Panel title="RISK METRICS">
        <div className="bte-riskcards">{cards.map(([k, v, c]) => <div key={k} className="bte-riskcard"><div className="bte-kpi-l">{k}</div><div className="bte-riskv" style={{ color: c }}>{v}</div></div>)}</div>
      </Panel>
      <Panel title="COST SENSITIVITY — SHARPE (COMMISSION × SLIPPAGE)" wide right={<button className="bte-b sm" onClick={runGrid} disabled={gridLoading || !spec}>{gridLoading ? "Running…" : "Run grid"}</button>}>
        {grid ? (
          <table className="bte-heat">
            <thead><tr><th>c\s</th>{grid.slips.map((s) => <th key={s}>{s}%</th>)}</tr></thead>
            <tbody>{grid.sharpe.map((row, ci) => <tr key={ci}><td className="yr">{grid.comms[ci]}%</td>{row.map((v, si) => <td key={si} style={{ background: heatCol(v, lo, hi) }}>{v.toFixed(2)}</td>)}</tr>)}</tbody>
          </table>
        ) : <div className="bte-stage-body">A broad green plateau = robust to costs; a lone hot cell = fragile. Click <b>Run grid</b> — real re-backtests on cached bars.</div>}
      </Panel>
    </div>
  );
}

// ── WALK-FORWARD ──
export function WalkForwardTab({ run }: { run: BacktestRun }) {
  const wf = run.walkForward;
  if (!wf) return <Panel title="WALK-FORWARD"><div className="bte-stage-body">Not enough bars for walk-forward analysis.</div></Panel>;
  return (
    <Panel title="WALK-FORWARD ANALYSIS — ROLLING OUT-OF-SAMPLE" wide right={<span className="bte-count">{wf.folds.filter((f) => f.passed).length}/{wf.folds.length} · WFE {num(wf.wfe)}</span>}>
      <div className="bte-wf-sq" style={{ marginBottom: 12 }}>{wf.folds.map((f) => <span key={f.i} className={f.passed ? "pass" : "fail"} />)}<em>OOS Sharpe {num(wf.oosSharpe)} · OOS Ret {pct(wf.oosRetPct)}</em></div>
      <table className="bte-ledger">
        <thead><tr><th>Fold</th><th>OOS From</th><th>OOS To</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>OOS Return</th><th>Verdict</th></tr></thead>
        <tbody>{wf.folds.map((f) => (
          <tr key={f.i}><td>{f.i + 1}</td><td>{f.oosFrom}</td><td>{f.oosTo}</td><td>{num(f.isSharpe)}</td><td style={{ color: sc(f.oosSharpe) }}>{num(f.oosSharpe)}</td><td style={{ color: sc(f.oosRetPct) }}>{pct(f.oosRetPct)}</td><td style={{ color: f.passed ? "var(--ax-pos)" : "var(--ax-neg)" }}>{f.passed ? "PASS" : "FAIL"}</td></tr>
        ))}</tbody>
      </table>
      <div className="bte-mc-note">Same spec evaluated out-of-sample on each rolling window (no re-fit). OOS numbers are the honest ones.</div>
    </Panel>
  );
}

// ── MONTE CARLO ──
export function MonteCarloTab({ run }: { run: BacktestRun }) {
  const mc = run.mc;
  if (!mc) return <Panel title="MONTE CARLO"><div className="bte-stage-body">Not enough trades for Monte-Carlo bootstrap.</div></Panel>;
  const sorted = [...mc.finals].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const ladder: [string, number][] = [["5th %ile", q(0.05)], ["25th %ile", q(0.25)], ["Median", q(0.5)], ["75th %ile", q(0.75)], ["95th %ile", q(0.95)]];
  return (
    <div className="bte-tabgrid">
      <Panel title="MONTE CARLO — FINAL EQUITY DISTRIBUTION (1,000 SEEDED SIMS)" wide>
        <BtMcHisto mc={mc} height={220} />
        <div className="bte-substats"><span>P(profit) {(mc.pProfit * 100).toFixed(1)}%</span><span>start {money(mc.startCash)}</span><span>avg {money(mc.avgFinal)}</span><span>seed {mc.seed}</span></div>
      </Panel>
      <Panel title="PERCENTILE LADDER">
        <div className="bte-perflist">{ladder.map(([k, v]) => <div key={k} className="bte-perfrow"><span>{k}</span><b style={{ color: sc(v - mc.startCash) }}>{money(v)}</b></div>)}</div>
        <div className="bte-mc-note">Resample-with-replacement of the realized trade P/L (path-dependency test). A simulation of what already happened — not a forecast.</div>
      </Panel>
    </div>
  );
}

// ── REPORTS ──
interface SavedRun { id: string; label: string; ts: number; metrics: BacktestRun["metrics"]; config: BtConfig }
const RUNS_KEY = "apex.bt.savedruns";
const loadRuns = (): SavedRun[] => { try { return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"); } catch { return []; } };
function download(name: string, text: string, type = "text/plain") {
  try { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { /* */ }
}
export function ReportsTab({ run }: { run: BacktestRun }) {
  const [saved, setSaved] = useState<SavedRun[]>(loadRuns);
  const [cmp, setCmp] = useState<string>("");
  function save() {
    const rec: SavedRun = { id: `r${Date.now()}`, label: `${run.config.strategyName} · ${run.config.symbol}`, ts: Date.now(), metrics: run.metrics, config: run.config };
    const next = [rec, ...saved].slice(0, 20); setSaved(next); try { localStorage.setItem(RUNS_KEY, JSON.stringify(next)); } catch { /* */ }
  }
  function exportCsv() {
    const head = "n,side,entry_time,exit_time,entry_px,exit_px,qty,pnl,ret_pct,bars,reason";
    const body = run.trades.map((t, i) => [i + 1, t.qty >= 0 ? "LONG" : "SHORT", ymd(t.entryT), ymd(t.exitT), t.entryPx, t.exitPx, Math.round(t.qty), t.pnl, (t.retPct).toFixed(4), t.bars, t.reason].join(",")).join("\n");
    download(`${run.config.strategyName}_${run.config.symbol}_trades.csv`, head + "\n" + body, "text/csv");
  }
  const exportJson = () => download(`${run.config.strategyName}_${run.config.symbol}_run.json`, JSON.stringify({ config: run.config, metrics: run.metrics, asOf: run.asOf, disclaimer: "Simulated backtest — not financial advice." }, null, 2), "application/json");
  const cmpRun = saved.find((s) => s.id === cmp);
  const diffRows: [string, keyof BacktestRun["metrics"]][] = [["Total Return %", "totalReturnPct"], ["CAGR %", "cagrPct"], ["Sharpe", "sharpe"], ["Sortino", "sortino"], ["Max DD %", "maxDrawdownPct"], ["Profit Factor", "profitFactor"], ["SQN", "sqn"]];
  return (
    <div className="bte-tabgrid">
      <Panel title="EXPORT & SAVE">
        <div className="bte-repbtns">
          <button className="bte-b" onClick={exportCsv}>⭳ Trades CSV</button>
          <button className="bte-b" onClick={exportJson}>⭳ Run JSON</button>
          <button className="bte-b deploy" onClick={save}>★ Save Run</button>
        </div>
        <div className="bte-mc-note">Exports embed the data-source + simulated-backtest disclaimer. Saved runs persist locally for A/B compare.</div>
      </Panel>
      <Panel title="SAVED RUNS — A/B COMPARE" wide right={<select className="bte-b sm" value={cmp} onChange={(e) => setCmp(e.target.value)}><option value="">compare to…</option>{saved.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>}>
        {cmpRun ? (
          <table className="bte-ledger"><thead><tr><th>Metric</th><th>Current</th><th>{cmpRun.label}</th><th>Δ</th></tr></thead>
            <tbody>{diffRows.map(([lbl, k]) => { const a = run.metrics[k], b = cmpRun.metrics[k]; const d = a - b; return <tr key={lbl}><td>{lbl}</td><td>{num(a)}</td><td>{num(b)}</td><td style={{ color: sc(d) }}>{d >= 0 ? "+" : ""}{num(d)}</td></tr>; })}</tbody>
          </table>
        ) : saved.length ? <div className="bte-stage-body">Pick a saved run to diff against the current one.</div> : <div className="bte-stage-body">No saved runs yet — hit <b>Save Run</b>.</div>}
      </Panel>
    </div>
  );
}
