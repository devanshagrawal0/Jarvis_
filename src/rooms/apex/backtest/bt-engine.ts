/* APEX Backtest Engine — adapter + honest derivations.

   Drives Forge "Engine B" (`forge-engine.backtest`): event-driven, NO look-ahead
   (signal on bar i close, fill at bar i+1 open), real commission/slippage/sizing,
   real share counts + exit reasons — the honest engine. On top of the raw result we
   derive, purely from the real equity curve + trade list, everything the dashboard
   needs: monthly-return heatmap, top-5 drawdown episodes, equity stats, a seeded
   Monte-Carlo trade bootstrap, and a rolling walk-forward OOS evaluation. Benchmark
   (SPY) + buy&hold come from real free-feed bars. Nothing here is fabricated. */

import { backtest, hrpAllocate, type BacktestResult, type EngineOpts, type EquityPoint, type Trade, type Metrics } from "../forge/forge-engine";
import type { Bar } from "../forge/forge-blocks";
import type { BotSpec } from "../forge/forge-spec";
import { buildRun, type RunArtifact } from "../forge/improver/artifact";
import { fetchBars, fetchBarsRange } from "../apex-data";
import type {
  BtConfig, BacktestRun, SeriesPoint, MonthlyCell, DrawdownEpisode, EquityStats, McResult, WalkForward, WfFold,
} from "./bt-types";

const RANGE_FOR: Record<string, string> = { "1d": "5y", "1h": "3mo", "15m": "1mo" };
const DAY = 86_400_000;
const EMPTY_METRICS: Metrics = { totalReturnPct: 0, cagrPct: 0, sharpe: 0, sortino: 0, calmar: 0, maxDrawdownPct: 0, maxDDbars: 0, volPct: 0, exposurePct: 0, trades: 0, winRatePct: 0, profitFactor: 0, expectancy: 0, sqn: 0, avgWinPct: 0, avgLossPct: 0, bestPct: 0, worstPct: 0 };

// Convert provider bars → engine bars, using DIVIDEND-ADJUSTED close when available (splits are
// already baked into Yahoo's `c`; `adjc` adds dividends → total-return-correct series for long tests).
// OHLC is scaled by the same factor so candle bodies stay consistent. Nominal-price charts (Live
// Markets) read `c` directly and are unaffected.
function toEngineBars(raw: { t: string | number; o: number; h: number; l: number; c: number; v: number; adjc?: number }[]): Bar[] {
  return (raw || []).filter((b) => b && b.c != null).map((b) => {
    const t = typeof b.t === "number" ? b.t : Date.parse(b.t as string);
    const adj = b.adjc != null && b.c ? b.adjc / b.c : 1;
    return { t, o: (b.o ?? b.c) * adj, h: (b.h ?? b.c) * adj, l: (b.l ?? b.c) * adj, c: b.adjc ?? b.c, v: b.v ?? 0 };
  });
}
const ymd = (t: number): string => { const d = new Date(t); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Monthly returns: chain month-end equity marks (fraction per calendar month) ──
export function monthlyReturns(equity: EquityPoint[], startCash: number): MonthlyCell[] {
  if (!equity.length) return [];
  const ends = new Map<string, { year: number; month: number; eq: number }>();
  for (const p of equity) { const d = new Date(p.t); ends.set(`${d.getUTCFullYear()}-${d.getUTCMonth()}`, { year: d.getUTCFullYear(), month: d.getUTCMonth(), eq: p.equity }); }
  const cells: MonthlyCell[] = []; let prev = startCash || equity[0].equity;
  for (const { year, month, eq } of ends.values()) { cells.push({ year, month, ret: prev ? eq / prev - 1 : 0 }); prev = eq; }
  return cells;
}

// ── Top-N drawdown episodes (peak → trough → recovery), walking the real equity ──
export function topDrawdowns(equity: EquityPoint[], n = 5): DrawdownEpisode[] {
  if (equity.length < 2) return [];
  const eps: DrawdownEpisode[] = [];
  let peak = equity[0].equity, peakT = equity[0].t;
  let cur: { startT: number; peakEq: number; trough: number; troughT: number } | null = null;
  for (const p of equity) {
    if (p.equity >= peak) {
      if (cur) { eps.push(finalizeDD(cur, p.t)); cur = null; }
      peak = p.equity; peakT = p.t;
    } else {
      if (!cur) cur = { startT: peakT, peakEq: peak, trough: p.equity, troughT: p.t };
      else if (p.equity < cur.trough) { cur.trough = p.equity; cur.troughT = p.t; }
    }
  }
  if (cur) eps.push(finalizeDD(cur, null));
  return eps.sort((a, b) => a.depthPct - b.depthPct).slice(0, n);
}
function finalizeDD(c: { startT: number; peakEq: number; trough: number; troughT: number }, recoverT: number | null): DrawdownEpisode {
  return {
    depthPct: c.peakEq ? (c.trough / c.peakEq - 1) * 100 : 0,
    startT: c.startT, troughT: c.troughT, recoverT,
    days: Math.max(0, Math.round((c.troughT - c.startT) / DAY)),
    recoveryDays: recoverT ? Math.max(0, Math.round((recoverT - c.troughT) / DAY)) : null,
  };
}

// ── Equity stats: best/worst day (per-bar return) + best/worst month + winning-month rate ──
export function computeEquityStats(equity: EquityPoint[], monthly: MonthlyCell[]): EquityStats {
  let bestDayPct = 0, worstDayPct = 0, bestDayT = 0, worstDayT = 0;
  for (let i = 1; i < equity.length; i++) {
    const r = equity[i - 1].equity ? equity[i].equity / equity[i - 1].equity - 1 : 0;
    if (r > bestDayPct) { bestDayPct = r; bestDayT = equity[i].t; }
    if (r < worstDayPct) { worstDayPct = r; worstDayT = equity[i].t; }
  }
  let bm = { ret: -Infinity, year: 0, month: 0 }, wm = { ret: Infinity, year: 0, month: 0 };
  let wins = 0;
  for (const c of monthly) { if (c.ret > bm.ret) bm = c; if (c.ret < wm.ret) wm = c; if (c.ret > 0) wins++; }
  const lbl = (m: { year: number; month: number }) => `${MONTHS[m.month] || ""} ${m.year || ""}`.trim();
  return {
    bestDayPct: bestDayPct * 100, bestDayT, worstDayPct: worstDayPct * 100, worstDayT,
    bestMonthPct: (monthly.length ? bm.ret : 0) * 100, bestMonthLabel: monthly.length ? lbl(bm) : "—",
    worstMonthPct: (monthly.length ? wm.ret : 0) * 100, worstMonthLabel: monthly.length ? lbl(wm) : "—",
    winningMonthsPct: monthly.length ? (wins / monthly.length) * 100 : 0,
    avgMonthlyPct: monthly.length ? (monthly.reduce((s, c) => s + c.ret, 0) / monthly.length) * 100 : 0,
  };
}

// ── Monte-Carlo: seeded resample-with-replacement of the REAL realized trade P/L.
// Tests path dependency (order/luck of the actual trades) — a simulation of what already
// happened, NOT a forecast. Deterministic (fixed seed → reproducible numbers). ──
export function mcBootstrap(trades: Trade[], startCash: number, runs = 1000, seed = 0x5eed): McResult | null {
  const pnls = trades.map((t) => t.pnl).filter((x) => Number.isFinite(x));
  if (pnls.length < 5) return null;
  let s = seed >>> 0; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const finals: number[] = [];
  for (let r = 0; r < runs; r++) {
    let eq = startCash;
    for (let k = 0; k < pnls.length; k++) eq += pnls[(rnd() * pnls.length) | 0];
    finals.push(eq);
  }
  const sorted = [...finals].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
  return {
    runs, seed, startCash, finals,
    pProfit: finals.filter((f) => f > startCash).length / runs,
    p5: q(0.05), p50: q(0.5), p95: q(0.95),
    avgFinal: finals.reduce((a, b) => a + b, 0) / runs,
  };
}

// ── Walk-forward: split into K sequential OOS windows; re-evaluate the SAME spec
// out-of-sample on each (no re-fit — an honest stability test, labeled as such). ──
export function walkForwardEval(spec: BotSpec, symbol: string, bars: Bar[], opts: EngineOpts, K = 6): WalkForward | null {
  const N = bars.length; const WARM = 40;
  if (N < WARM + K * 30) return null;
  const oosLen = Math.floor((N - WARM) / K);
  const folds: WfFold[] = [];
  for (let k = 0; k < K; k++) {
    const oosStart = WARM + k * oosLen;
    const oosEnd = k === K - 1 ? N : oosStart + oosLen;
    const isRes = backtest(spec, symbol, bars.slice(0, oosStart), opts);
    const oosRes = backtest(spec, symbol, bars.slice(Math.max(0, oosStart - WARM), oosEnd), opts);
    folds.push({
      i: k, oosFrom: ymd(bars[oosStart]?.t ?? 0), oosTo: ymd(bars[oosEnd - 1]?.t ?? 0),
      isSharpe: round(isRes.metrics.sharpe, 2), oosSharpe: round(oosRes.metrics.sharpe, 2),
      oosRetPct: round(oosRes.metrics.totalReturnPct, 2), passed: oosRes.metrics.sharpe > 0,
    });
  }
  const meanOos = folds.reduce((s, f) => s + f.oosSharpe, 0) / folds.length;
  const meanIs = folds.reduce((s, f) => s + f.isSharpe, 0) / folds.length || 1;
  const oosRet = folds.reduce((p, f) => p * (1 + f.oosRetPct / 100), 1) - 1;
  return { folds, oosSharpe: round(meanOos, 2), oosRetPct: round(oosRet * 100, 2), wfe: round(meanIs ? meanOos / meanIs : 0, 2) };
}

const buyHoldSeries = (bars: Bar[], startCash: number): SeriesPoint[] => {
  if (!bars.length) return []; const base = bars[0].c || 1;
  return bars.map((b) => ({ t: b.t, v: startCash * (b.c / base) }));
};
const round = (x: number, d: number) => { const p = 10 ** d; return Number.isFinite(x) ? Math.round(x * p) / p : 0; };

// ── Benchmark bars cache (one Yahoo hit per symbol|tf|range, shared across runs) ──
const benchCache = new Map<string, Bar[]>();
async function getBars(symbol: string, tf: string, range: string): Promise<Bar[]> {
  const key = `${symbol}|${tf}|${range}`;
  const hit = benchCache.get(key); if (hit) return hit;
  const bars = toEngineBars(await fetchBars(symbol, tf, range));
  if (bars.length) benchCache.set(key, bars);
  return bars;
}
// True DAILY history back to 2007 (period1/period2 → Yahoo daily; range=max would coerce to monthly).
async function getDailyHistory(symbol: string): Promise<Bar[]> {
  const key = `${symbol}|dailyhist`;
  const hit = benchCache.get(key); if (hit) return hit;
  const to = new Date().toISOString().slice(0, 10);
  const bars = toEngineBars(await fetchBarsRange(symbol, "1d", "2007-01-01", to));
  if (bars.length) benchCache.set(key, bars);
  return bars;
}

/** Cost-sensitivity surface: re-run the strategy over a commission × slippage grid
   (bars are cached, so this is fast) → a Sharpe matrix. Real re-backtests, not a model. */
export async function runCostSensitivity(spec: BotSpec, config: BtConfig, comms = [0, 0.05, 0.1, 0.2, 0.5], slips = [0, 0.05, 0.1, 0.2, 0.5]): Promise<{ comms: number[]; slips: number[]; sharpe: number[][]; ret: number[][] }> {
  const tf = config.timeframe; const range = RANGE_FOR[tf] || "5y";
  const bars = await getBars(config.symbol, tf, range);
  const sharpe: number[][] = [], ret: number[][] = [];
  for (const c of comms) {
    const sRow: number[] = [], rRow: number[] = [];
    for (const s of slips) { const r = backtest(spec, config.symbol, bars, { startCash: config.startCash, commissionPct: c, slippagePct: s }); sRow.push(round(r.metrics.sharpe, 2)); rRow.push(round(r.metrics.totalReturnPct, 1)); }
    sharpe.push(sRow); ret.push(rRow);
  }
  return { comms, slips, sharpe, ret };
}

/** Re-run (cached bars) and return the raw engine BacktestResult — for the meta-labeler. */
export async function runResult(spec: BotSpec, config: BtConfig): Promise<BacktestResult | null> {
  const bars = await getBars(config.symbol, config.timeframe, RANGE_FOR[config.timeframe] || "5y");
  if (bars.length < 40) return null;
  const r = backtest(spec, config.symbol, bars, { startCash: config.startCash, commissionPct: config.commissionPct, slippagePct: config.slippagePct });
  return r.error ? null : r;
}

/** Build the improver RunArtifact (per-trade ledger w/ MAE/MFE/flags/regime) — grounds the AI Autopsy. */
export async function buildArtifact(spec: BotSpec, config: BtConfig): Promise<RunArtifact | null> {
  const bars = await getBars(config.symbol, config.timeframe, RANGE_FOR[config.timeframe] || "5y");
  if (bars.length < 40) return null;
  const result = backtest(spec, config.symbol, bars, { startCash: config.startCash, commissionPct: config.commissionPct, slippagePct: config.slippagePct });
  if (result.error || !result.trades.length) return null;
  try { return buildRun(spec, result, bars); } catch { return null; }
}

// ── 🛡️ Adversarial Stress Lab — replay the strategy through real historical crash windows ──
export interface StressWindow { id: string; label: string; from: string; to: string }
export interface StressResult { id: string; label: string; from: string; to: string; available: boolean; marketRetPct: number; stratRetPct: number; ddPct: number; trades: number; exposurePct: number }
export const STRESS_WINDOWS: StressWindow[] = [
  { id: "gfc", label: "2008 Global Financial Crisis", from: "2008-09-01", to: "2009-04-30" },
  { id: "vol2015", label: "2015 Aug Flash Crash", from: "2015-08-01", to: "2015-10-15" },
  { id: "q4-2018", label: "2018 Q4 Selloff", from: "2018-10-01", to: "2018-12-31" },
  { id: "covid", label: "2020 COVID Crash", from: "2020-02-15", to: "2020-06-15" },
  { id: "bear-2022", label: "2022 Bear Market", from: "2022-01-01", to: "2022-10-31" },
];
export async function runStressReplays(spec: BotSpec, config: BtConfig): Promise<StressResult[]> {
  const bars = await getDailyHistory(config.symbol); // true daily history so every crash window has bars
  const opts: EngineOpts = { startCash: config.startCash, commissionPct: config.commissionPct, slippagePct: config.slippagePct };
  const ms = (d: string) => Date.parse(d + "T00:00:00Z");
  // Run ONCE over full history, then measure each crash window as a SUB-PERIOD of the warmed run.
  // "available" is keyed on RAW-BAR coverage (the market context), so a flat strategy still shows
  // the crash magnitude ("market -34%, strategy sat out") instead of a misleading 0%.
  const r = backtest(spec, config.symbol, bars, opts);
  const eq = r.equity;
  return STRESS_WINDOWS.map((w) => {
    const f = ms(w.from), t = ms(w.to);
    const barSeg = bars.filter((b) => b.t >= f && b.t <= t);
    if (barSeg.length < 5) return { ...w, available: false, marketRetPct: 0, stratRetPct: 0, ddPct: 0, trades: 0, exposurePct: 0 };
    const marketRetPct = (barSeg[barSeg.length - 1].c / barSeg[0].c - 1) * 100;
    const seg = eq.filter((p) => p.t >= f && p.t <= t);
    let stratRetPct = 0, maxDD = 0;
    if (seg.length >= 2) {
      stratRetPct = (seg[seg.length - 1].equity / seg[0].equity - 1) * 100;
      let peak = -Infinity; for (const p of seg) { peak = Math.max(peak, p.equity); const dd = peak ? p.equity / peak - 1 : 0; if (dd < maxDD) maxDD = dd; }
    }
    const wtrades = r.trades.filter((tr) => tr.entryT <= t && tr.exitT >= f);
    const trades = r.trades.filter((tr) => tr.entryT >= f && tr.entryT <= t).length;
    const inPos = barSeg.filter((b) => wtrades.some((tr) => tr.entryT <= b.t && tr.exitT >= b.t)).length;
    return { ...w, available: true, marketRetPct: round(marketRetPct, 1), stratRetPct: round(stratRetPct, 1), ddPct: round(maxDD * 100, 1), trades, exposurePct: round((inPos / barSeg.length) * 100, 0) };
  });
}

// ── 🌀 Ensemble / Portfolio Forge — HRP-weighted blend of several strategies on one symbol ──
export interface EnsembleLeg { name: string; weight: number; sharpe: number; retPct: number }
export interface EnsembleResult { legs: EnsembleLeg[]; blendedSharpe: number; blendedRetPct: number; blendedMaxDDPct: number; avgIndivSharpe: number; diversification: number }
export async function runEnsembleHRP(specs: BotSpec[], config: BtConfig): Promise<EnsembleResult | null> {
  const bars = await getBars(config.symbol, config.timeframe, RANGE_FOR[config.timeframe] || "5y");
  if (bars.length < 40) return null;
  const opts: EngineOpts = { startCash: config.startCash, commissionPct: config.commissionPct, slippagePct: config.slippagePct };
  const cfgSpecs = specs.map((s) => ({ ...s, universe: { ...s.universe, symbols: [config.symbol], bar: config.timeframe } }));
  const results = cfgSpecs.map((s) => backtest(s, config.symbol, bars, opts));
  const ok = results.map((r, i) => ({ r, i })).filter((x) => !x.r.error && x.r.equity.length);
  if (ok.length < 2) return null;
  const valid = ok.map((x) => x.r);
  const weights = hrpAllocate(valid);                       // real Hierarchical Risk Parity
  const n = Math.min(...valid.map((r) => r.equity.length));
  const start = config.startCash;
  const blended: number[] = new Array(n).fill(0);
  valid.forEach((r, k) => { const w = weights[k] || 0; for (let i = 0; i < n; i++) blended[i] += w * r.equity[i].equity; });
  // blended metrics
  const rets: number[] = []; for (let i = 1; i < n; i++) rets.push(blended[i - 1] ? blended[i] / blended[i - 1] - 1 : 0);
  const mean = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1 || 1)) || 1e-9;
  const bpy = config.timeframe === "1d" ? 252 : config.timeframe === "1h" ? 252 * 7 : 252 * 26;
  let peak = -Infinity, maxDD = 0; for (const e of blended) { peak = Math.max(peak, e); const dd = peak ? (e - peak) / peak : 0; if (dd < maxDD) maxDD = dd; }
  const legs: EnsembleLeg[] = valid.map((r, k) => ({ name: cfgSpecs[ok[k].i].meta.name, weight: round((weights[k] || 0) * 100, 1), sharpe: round(r.metrics.sharpe, 2), retPct: round(r.metrics.totalReturnPct, 1) }));
  const avgIndiv = valid.reduce((s, r) => s + r.metrics.sharpe, 0) / valid.length;
  const blendedSharpe = round((mean / sd) * Math.sqrt(bpy), 2);
  return { legs, blendedSharpe, blendedRetPct: round((blended[n - 1] / start - 1) * 100, 1), blendedMaxDDPct: round(maxDD * 100, 1), avgIndivSharpe: round(avgIndiv, 2), diversification: round(blendedSharpe - avgIndiv, 2) };
}

/** Run the full backtest for a config, returning the typed BacktestRun the tab consumes. */
export async function runBacktestFull(spec: BotSpec, config: BtConfig): Promise<BacktestRun> {
  const tf = config.timeframe; const range = RANGE_FOR[tf] || "5y";
  const opts: EngineOpts = { startCash: config.startCash, commissionPct: config.commissionPct, slippagePct: config.slippagePct };
  const bars = await getBars(config.symbol, tf, range);
  const base: Omit<BacktestRun, "metrics" | "equity" | "trades"> & Partial<BacktestRun> = {
    config, synthetic: false, delayed: true, asOf: bars.length ? ymd(bars[bars.length - 1].t) : "—",
    benchmarkSymbol: config.benchmark, benchmark: null, buyHold: [], strategyEquity: [],
    monthly: [], drawdowns: [], mc: null, walkForward: null, barsUsed: bars.length,
    equityStats: computeEquityStats([], []),
  };
  if (bars.length < 30) {
    return { ...base, metrics: EMPTY_METRICS, equity: [], trades: [], error: "Not enough bars for this symbol / timeframe." } as BacktestRun;
  }
  const result: BacktestResult = backtest(spec, config.symbol, bars, opts);
  if (result.error) return { ...base, metrics: result.metrics, equity: [], trades: [], error: result.error } as BacktestRun;

  const monthly = monthlyReturns(result.equity, config.startCash);
  let benchmark: SeriesPoint[] | null = null;
  if (config.benchmark && config.benchmark.toUpperCase() !== config.symbol.toUpperCase()) {
    try { const bb = await getBars(config.benchmark, tf, range); if (bb.length) benchmark = buyHoldSeries(bb, config.startCash); } catch { /* benchmark optional */ }
  }
  return {
    ...base,
    metrics: result.metrics,
    equity: result.equity,
    trades: result.trades,
    strategyEquity: result.equity.map((p) => ({ t: p.t, v: p.equity })),
    buyHold: buyHoldSeries(bars, config.startCash),
    benchmark,
    monthly,
    drawdowns: topDrawdowns(result.equity, 5),
    equityStats: computeEquityStats(result.equity, monthly),
    mc: mcBootstrap(result.trades, config.startCash, 1000, 0x5eed),
    walkForward: walkForwardEval(spec, config.symbol, bars, opts, 6),
    barsUsed: result.barsUsed,
  } as BacktestRun;
}
