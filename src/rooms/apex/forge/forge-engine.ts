/* THE FORGE — Strategy Evaluator. One deterministic engine that runs a BotSpec
   over bars → trades + equity curve + report-card metrics. Powers Backtest,
   and (later) Paper/Live with the same code. Honesty rules:
   - NO LOOK-AHEAD: signals computed on bar i's close; fills at bar i+1 OPEN.
   - modeled commission + slippage so results aren't fantasy. */

import type { Bar } from "./forge-blocks";
import { computeSignals } from "./forge-blocks";
import type { BotSpec, EntryNode, SignalCond, ExitRules } from "./forge-spec";
import { isLogic } from "./forge-spec";

export interface Trade { entryT: number; exitT: number; entryPx: number; exitPx: number; qty: number; pnl: number; retPct: number; bars: number; reason: string; symbol?: string }
export interface EquityPoint { t: number; equity: number; drawdown: number }
export interface Metrics {
  totalReturnPct: number; cagrPct: number; sharpe: number; sortino: number; calmar: number;
  maxDrawdownPct: number; maxDDbars: number; volPct: number; exposurePct: number;
  trades: number; winRatePct: number; profitFactor: number; expectancy: number; sqn: number;
  avgWinPct: number; avgLossPct: number; bestPct: number; worstPct: number;
}
export interface BacktestResult { symbol: string; trades: Trade[]; equity: EquityPoint[]; metrics: Metrics; barsUsed: number; error?: string }

export interface EngineOpts { startCash?: number; commissionPct?: number; slippagePct?: number; barsPerYear?: number }

function condTrue(c: SignalCond, sig: Record<string, number[]>, i: number): boolean {
  const a = sig[c.signal]; if (!a) return false;
  const cur = a[i], prev = i > 0 ? a[i - 1] : NaN;
  if (c.cmp === "true") return cur > 0;
  if (c.cmp === "false") return !(cur > 0);
  const rhsCur = c.vsSignal ? sig[c.vsSignal]?.[i] : (c.value ?? 0);
  const rhsPrev = c.vsSignal ? sig[c.vsSignal]?.[i - 1] : (c.value ?? 0);
  if (Number.isNaN(cur) || rhsCur == null || Number.isNaN(rhsCur)) return false;
  switch (c.cmp) {
    case "gt": return cur > rhsCur;
    case "lt": return cur < rhsCur;
    case "gte": return cur >= rhsCur;
    case "lte": return cur <= rhsCur;
    case "cross_up": return !Number.isNaN(prev) && rhsPrev != null && !Number.isNaN(rhsPrev) && prev <= rhsPrev && cur > rhsCur;
    case "cross_dn": return !Number.isNaN(prev) && rhsPrev != null && !Number.isNaN(rhsPrev) && prev >= rhsPrev && cur < rhsCur;
    default: return false;
  }
}
function evalNode(n: EntryNode, sig: Record<string, number[]>, i: number): boolean {
  if (isLogic(n)) {
    if (n.op === "NOT") return !evalNode(n.operands[0], sig, i);
    if (n.op === "AND") return n.operands.every(o => evalNode(o, sig, i));
    return n.operands.some(o => evalNode(o, sig, i));
  }
  return condTrue(n as SignalCond, sig, i);
}

export function backtest(spec: BotSpec, symbol: string, bars: Bar[], opts: EngineOpts = {}): BacktestResult {
  const startCash = opts.startCash ?? 100_000;
  const comm = (opts.commissionPct ?? 0.05) / 100;   // 5 bps
  const slip = (opts.slippagePct ?? 0.05) / 100;      // 5 bps
  // C5: annualization must match the trading calendar. Crypto is 24/7; equities ~6.5h/day.
  const crypto = spec.universe.assetClass === "crypto";
  const barsPerYear = opts.barsPerYear ?? (crypto
    ? (spec.universe.bar === "1d" ? 365 : spec.universe.bar === "1h" ? 365 * 24 : 365 * 24 * 4)
    : (spec.universe.bar === "1d" ? 252 : spec.universe.bar === "1h" ? Math.round(252 * 6.5) : 252 * 26));
  const empty: Metrics = { totalReturnPct: 0, cagrPct: 0, sharpe: 0, sortino: 0, calmar: 0, maxDrawdownPct: 0, maxDDbars: 0, volPct: 0, exposurePct: 0, trades: 0, winRatePct: 0, profitFactor: 0, expectancy: 0, sqn: 0, avgWinPct: 0, avgLossPct: 0, bestPct: 0, worstPct: 0 };
  if (bars.length < 30) return { symbol, trades: [], equity: [], metrics: empty, barsUsed: bars.length, error: "not enough bars" };

  const sig = computeSignals(spec.signals, bars);
  const ex = spec.exit;

  let cash = startCash, shares = 0, inPos = false;
  let entryPx = 0, entryT = 0, entryBar = 0, peakInTrade = 0, stopAtr = 0;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  let peakEq = startCash, maxDD = 0, ddStart = 0, maxDDbars = 0, barsInMarket = 0;
  const rets: number[] = [];

  const atrSeries = sig["__atr_exit"] || null; // reserved
  const closeAt = (i: number, px: number, reason: string) => {
    const fill = px * (1 - slip);
    const gross = shares * fill; const cost = gross * comm;
    cash += gross - cost;
    const pnl = shares * (fill - entryPx) - cost - shares * entryPx * comm;
    trades.push({ entryT, exitT: bars[i].t, entryPx, exitPx: fill, qty: shares, pnl, retPct: (fill / entryPx - 1) * 100, bars: i - entryBar, reason });
    shares = 0; inPos = false;
  };

  for (let i = 1; i < bars.length; i++) {
    const openPx = bars[i].o, closePx = bars[i].c;
    // ── exits (evaluated at this bar, using entry rules from prior bar signals) ──
    if (inPos) {
      peakInTrade = Math.max(peakInTrade, bars[i].h);
      let exitReason = "";
      if (ex.stopLossPct && bars[i].l <= entryPx * (1 - ex.stopLossPct / 100)) exitReason = "stop";
      else if (ex.takeProfitPct && bars[i].h >= entryPx * (1 + ex.takeProfitPct / 100)) exitReason = "target";
      else if (ex.trailingPct && bars[i].l <= peakInTrade * (1 - ex.trailingPct / 100)) exitReason = "trail";
      else if (ex.atrStopMult && stopAtr && bars[i].l <= entryPx - ex.atrStopMult * stopAtr) exitReason = "atr-stop";
      else if (ex.timeBars && i - entryBar >= ex.timeBars) exitReason = "time";
      else if (ex.signalExit && evalNode(ex.signalExit, sig, i - 1)) exitReason = "signal";
      if (exitReason) {
        const px = exitReason === "target" ? entryPx * (1 + (ex.takeProfitPct || 0) / 100) : exitReason === "stop" ? entryPx * (1 - (ex.stopLossPct || 0) / 100) : openPx;
        closeAt(i, px, exitReason);
      }
    }
    // ── entry (signal from bar i-1 close → fill at bar i open) ──
    if (!inPos && evalNode(spec.entry, sig, i - 1)) {
      const eq = cash;
      let dollars = eq;
      if (spec.sizing.method === "fixed_cash") dollars = Math.min(eq, spec.sizing.value);
      else if (spec.sizing.method === "pct_equity") dollars = eq * (spec.sizing.value / 100);
      else if (spec.sizing.method === "vol_target") { const a = sig["atr"] ? sig["atr"][i - 1] : NaN; dollars = eq * 0.5; if (!Number.isNaN(a) && a > 0) dollars = Math.min(eq, eq * (spec.sizing.value / 100) / (a / bars[i - 1].c * 100)); }
      else if (spec.sizing.method === "kelly_frac") dollars = eq * Math.min(1, Math.max(0, spec.sizing.value));
      if (spec.risk.maxExposurePct) dollars = Math.min(dollars, eq * spec.risk.maxExposurePct / 100);
      const fill = openPx * (1 + slip);
      shares = Math.floor(dollars / fill);
      if (shares > 0) {
        cash -= shares * fill + shares * fill * comm;
        inPos = true; entryPx = fill; entryT = bars[i].t; entryBar = i; peakInTrade = bars[i].h;
        stopAtr = sig["atr"] ? sig["atr"][i - 1] : (atrSeries ? atrSeries[i - 1] : 0);
      }
    }
    // ── mark-to-market equity + drawdown ──
    const eq = cash + shares * closePx;
    if (inPos) barsInMarket++;
    // C1 fix: per-bar strategy return is equity[i]/equity[i-1] - 1 (prior bar's
    // stored mark-to-market equity), NOT the post-transaction cash/shares mix.
    if (equity.length) { const prevEq = equity[equity.length - 1].equity; rets.push(prevEq ? eq / prevEq - 1 : 0); }
    if (eq > peakEq) { peakEq = eq; ddStart = i; }
    const dd = (eq - peakEq) / peakEq;
    if (dd < maxDD) { maxDD = dd; maxDDbars = Math.max(maxDDbars, i - ddStart); }
    // risk kill-switch — flatten, then record the POST-flatten equity for this bar
    if (spec.risk.maxDrawdownPct && dd <= -spec.risk.maxDrawdownPct / 100 && inPos) closeAt(i, closePx, "kill-switch");
    equity.push({ t: bars[i].t, equity: +(cash + shares * closePx).toFixed(2), drawdown: +(dd * 100).toFixed(2) });
  }
  if (inPos) closeAt(bars.length - 1, bars[bars.length - 1].c, "eod");

  // ── metrics ──
  const finalEq = equity.length ? equity[equity.length - 1].equity : startCash;
  const totalReturnPct = (finalEq / startCash - 1) * 100;
  const years = (bars[bars.length - 1].t - bars[0].t) / (365.25 * 86400000) || 1;
  const cagrPct = (Math.pow(finalEq / startCash, 1 / Math.max(0.05, years)) - 1) * 100;
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  // H3: population std (÷n) to agree with the improver's metric registry (was ÷n-1, causing two disagreeing Sharpes).
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0;
  // H1: Sortino downside deviation over ALL observations (target 0), the conventional definition (was ÷ downside-count).
  const dsd = rets.length ? Math.sqrt(rets.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / rets.length) : 0;
  const ann = Math.sqrt(barsPerYear);
  const sharpe = sd ? +(mean / sd * ann).toFixed(2) : 0;
  const sortino = dsd ? +(mean / dsd * ann).toFixed(2) : 0;
  const maxDrawdownPct = +(maxDD * 100).toFixed(2);
  const calmar = maxDrawdownPct ? +(cagrPct / Math.abs(maxDrawdownPct)).toFixed(2) : 0;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);   // H8: breakeven trades aren't losses
  const gp = wins.reduce((a, b) => a + b.pnl, 0), gl = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const rmults = trades.map(t => t.retPct);
  const rMean = rmults.length ? rmults.reduce((a, b) => a + b, 0) / rmults.length : 0;
  const rSd = rmults.length > 1 ? Math.sqrt(rmults.reduce((a, b) => a + (b - rMean) ** 2, 0) / (rmults.length - 1)) : 0;
  const metrics: Metrics = {
    totalReturnPct: +totalReturnPct.toFixed(2), cagrPct: +cagrPct.toFixed(2), sharpe, sortino, calmar,
    maxDrawdownPct, maxDDbars, volPct: +(sd * ann * 100).toFixed(1), exposurePct: +(barsInMarket / (bars.length - 1) * 100).toFixed(1),
    trades: trades.length, winRatePct: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0,
    profitFactor: gl ? +(gp / gl).toFixed(2) : (gp > 0 ? 99 : 0), expectancy: +rMean.toFixed(2),
    sqn: rSd ? +(rMean / rSd * Math.sqrt(trades.length)).toFixed(2) : 0,
    avgWinPct: wins.length ? +(wins.reduce((a, b) => a + b.retPct, 0) / wins.length).toFixed(2) : 0,
    avgLossPct: losses.length ? +(losses.reduce((a, b) => a + b.retPct, 0) / losses.length).toFixed(2) : 0,
    bestPct: rmults.length ? +Math.max(...rmults).toFixed(2) : 0, worstPct: rmults.length ? +Math.min(...rmults).toFixed(2) : 0,
  };
  return { symbol, trades, equity, metrics, barsUsed: bars.length };
}

/* Portfolio composition: blend several backtested strategies by weight. Aligns
   equity curves on common timestamps, blends daily returns, and reports combined
   metrics + average pairwise correlation (the diversification tell). */
export interface PortfolioResult { equity: EquityPoint[]; totalReturnPct: number; sharpe: number; maxDrawdownPct: number; avgCorrelation: number; legs: { name: string; weight: number }[] }
export function composePortfolio(legs: { name: string; weight: number; result: BacktestResult }[], barsPerYear = 252): PortfolioResult | null {
  const active = legs.filter(l => l.result.equity.length > 2);
  if (active.length < 1) return null;
  const wsum = active.reduce((a, b) => a + b.weight, 0) || 1;
  // per-leg returns keyed by timestamp
  const retMaps = active.map(l => { const m = new Map<number, number>(); const e = l.result.equity; for (let i = 1; i < e.length; i++) { const r = e[i - 1].equity ? e[i].equity / e[i - 1].equity - 1 : 0; m.set(e[i].t, r); } return m; });
  // common timestamps (present in all legs)
  let common = [...retMaps[0].keys()];
  for (let i = 1; i < retMaps.length; i++) common = common.filter(t => retMaps[i].has(t));
  common.sort((a, b) => a - b);
  if (common.length < 3) return null;
  const legReturns = retMaps.map(m => common.map(t => m.get(t) || 0));
  // blended equity
  let eq = 1, peak = 1, maxdd = 0; const equity: EquityPoint[] = [];
  common.forEach((t, idx) => {
    let r = 0; active.forEach((l, li) => { r += (l.weight / wsum) * legReturns[li][idx]; });
    eq *= (1 + r); if (eq > peak) peak = eq; const dd = (eq - peak) / peak; if (dd < maxdd) maxdd = dd;
    equity.push({ t, equity: +(eq * 100000).toFixed(2), drawdown: +(dd * 100).toFixed(2) });
  });
  // blended sharpe
  const blended = common.map((t, idx) => { let r = 0; active.forEach((l, li) => { r += (l.weight / wsum) * legReturns[li][idx]; }); return r; });
  const mean = blended.reduce((a, b) => a + b, 0) / blended.length;
  const sd = Math.sqrt(blended.reduce((a, b) => a + (b - mean) ** 2, 0) / (blended.length - 1)) || 0;
  const sharpe = sd ? +(mean / sd * Math.sqrt(barsPerYear)).toFixed(2) : 0;
  // avg pairwise correlation
  const corr = (a: number[], b: number[]) => { const n = a.length; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; } const d = Math.sqrt(da * db); return d ? num / d : 0; };
  let cs = 0, cn = 0; for (let i = 0; i < legReturns.length; i++) for (let k = i + 1; k < legReturns.length; k++) { cs += corr(legReturns[i], legReturns[k]); cn++; }
  return { equity, totalReturnPct: +((eq - 1) * 100).toFixed(2), sharpe, maxDrawdownPct: +(maxdd * 100).toFixed(2), avgCorrelation: cn ? +(cs / cn).toFixed(2) : 0, legs: active.map(l => ({ name: l.name, weight: +(l.weight / wsum * 100).toFixed(0) })) };
}

/* F7 — Hierarchical Risk Parity (López de Prado 2016): allocate across strategy
   legs using clustering + recursive bisection (no matrix inversion, robust to
   noisy covariance). Returns weights[] aligned to `results`. Falls back to
   inverse-variance if legs don't share enough history. */
export function hrpAllocate(results: BacktestResult[]): number[] {
  const n = results.length; if (n <= 1) return new Array(n).fill(1);
  // align per-leg returns on common timestamps
  const maps = results.map(r => { const m = new Map<number, number>(); const e = r.equity; for (let i = 1; i < e.length; i++) m.set(e[i].t, e[i - 1].equity ? e[i].equity / e[i - 1].equity - 1 : 0); return m; });
  let common = [...maps[0].keys()]; for (let i = 1; i < maps.length; i++) common = common.filter(t => maps[i].has(t));
  const X = maps.map(m => common.map(t => m.get(t) || 0));
  if (common.length < 5) { const iv = X.map(a => 1 / (variance(a) || 1e-9)); const s = iv.reduce((p, q) => p + q, 0); return iv.map(v => v / s); }
  // covariance + correlation
  const mus = X.map(mean1);
  const cov = (i: number, j: number) => { let s = 0; for (let k = 0; k < common.length; k++) s += (X[i][k] - mus[i]) * (X[j][k] - mus[j]); return s / (common.length - 1); };
  const C: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => cov(i, j)));
  const sd = (i: number) => Math.sqrt(Math.max(C[i][i], 1e-12));
  const dist = (i: number, j: number) => Math.sqrt(Math.max(0, 0.5 * (1 - C[i][j] / (sd(i) * sd(j)))));
  // single-linkage agglomerative clustering → leaf order (quasi-diagonalization)
  let clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);
  while (clusters.length > 1) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      let d = Infinity; for (const a of clusters[i]) for (const b of clusters[j]) d = Math.min(d, dist(a, b));
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    clusters[bi] = [...clusters[bi], ...clusters[bj]]; clusters.splice(bj, 1);
  }
  const order = clusters[0];
  // recursive bisection with inverse-variance cluster weights
  const w = new Array(n).fill(1);
  const clusterVar = (idx: number[]) => { const ivw = idx.map(i => 1 / Math.max(C[i][i], 1e-12)); const s = ivw.reduce((p, q) => p + q, 0); const nw = ivw.map(v => v / s); let v = 0; for (let a = 0; a < idx.length; a++) for (let b = 0; b < idx.length; b++) v += nw[a] * nw[b] * C[idx[a]][idx[b]]; return v; };
  let stack: number[][] = [order];
  while (stack.length) {
    const c = stack.pop()!; if (c.length <= 1) continue;
    const mid = Math.floor(c.length / 2); const L = c.slice(0, mid), Rr = c.slice(mid);
    const vL = clusterVar(L), vR = clusterVar(Rr); const alpha = 1 - vL / (vL + vR || 1e-12);
    for (const i of L) w[i] *= alpha; for (const i of Rr) w[i] *= (1 - alpha);
    stack.push(L, Rr);
  }
  const s = w.reduce((p, q) => p + q, 0) || 1; return w.map(v => v / s);
}
function mean1(a: number[]) { return a.reduce((s, x) => s + x, 0) / (a.length || 1); }
function variance(a: number[]) { const m = mean1(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1 || 1); }

/* Monte Carlo robustness via CIRCULAR BLOCK BOOTSTRAP: resample consecutive
   blocks of trades WITH replacement `runs` times and compound → distribution of
   final return + max drawdown. Unlike a pure permutation (which keeps the exact
   multiset, so final return barely changes and drawdown is biased low by breaking
   up losing streaks), block resampling preserves serial dependence and gives an
   honest tail. Deterministic RNG (seeded) so results are reproducible. */
export interface MonteCarlo { runs: number; retP5: number; retP50: number; retP95: number; ddP50: number; ddP95: number; winProb: number }
export function monteCarlo(result: BacktestResult, runs = 500): MonteCarlo | null {
  const rets = result.trades.map(t => t.retPct / 100);
  if (rets.length < 3) return null;
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const finals: number[] = [], dds: number[] = []; let wins = 0;
  const blockLen = Math.max(2, Math.round(Math.sqrt(rets.length)));   // ~√n block preserves streaks
  for (let r = 0; r < runs; r++) {
    const path: number[] = [];
    while (path.length < rets.length) { const start = Math.floor(rnd() * rets.length); for (let j = 0; j < blockLen && path.length < rets.length; j++) path.push(rets[(start + j) % rets.length]); }
    let eq = 1, peak = 1, maxdd = 0;
    for (const rr of path) { eq *= (1 + rr); if (eq > peak) peak = eq; const dd = (eq - peak) / peak; if (dd < maxdd) maxdd = dd; }
    finals.push((eq - 1) * 100); dds.push(maxdd * 100); if (eq > 1) wins++;
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return { runs, retP5: +pct(finals, 0.05).toFixed(1), retP50: +pct(finals, 0.5).toFixed(1), retP95: +pct(finals, 0.95).toFixed(1), ddP50: +pct(dds, 0.5).toFixed(1), ddP95: +pct(dds, 0.05).toFixed(1), winProb: +(wins / runs * 100).toFixed(0) };
}

/* ── MULTI-SYMBOL PORTFOLIO BACKTEST (Tier 1 · Option A) ──
   Runs one BotSpec across a whole universe on a shared cash account, holding up
   to maxPositions concurrent positions (equal-weight slots), rolled up into one
   portfolio equity curve + metrics + per-symbol contribution. Same no-look-ahead
   rules (signal on bar i-1 close, fill at bar i open) and corrected formulas. */
export interface SymbolContribution { symbol: string; trades: number; pnl: number; retPct: number }
export interface UniverseResult extends BacktestResult { bySymbol: SymbolContribution[]; symbolsUsed: number }

function metricsFromCurve(equity: EquityPoint[], trades: Trade[], rets: number[], barsPerYear: number, startCash: number, nBars: number, barsInMarket: number, maxDD: number, maxDDbars: number): Metrics {
  const finalEq = equity.length ? equity[equity.length - 1].equity : startCash;
  const totalReturnPct = (finalEq / startCash - 1) * 100;
  const years = equity.length >= 2 ? ((equity[equity.length - 1].t - equity[0].t) / (365.25 * 86400000) || 1) : 1;
  const cagrPct = (Math.pow(finalEq / startCash, 1 / Math.max(0.05, years)) - 1) * 100;
  const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) : 0;
  const dsd = rets.length ? Math.sqrt(rets.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / rets.length) : 0;
  const ann = Math.sqrt(barsPerYear);
  const sharpe = sd ? +(mean / sd * ann).toFixed(2) : 0;
  const sortino = dsd ? +(mean / dsd * ann).toFixed(2) : 0;
  const maxDrawdownPct = +(maxDD * 100).toFixed(2);
  const calmar = maxDrawdownPct ? +(cagrPct / Math.abs(maxDrawdownPct)).toFixed(2) : 0;
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const gp = wins.reduce((a, b) => a + b.pnl, 0), gl = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  const rmults = trades.map(t => t.retPct);
  const rMean = rmults.length ? rmults.reduce((a, b) => a + b, 0) / rmults.length : 0;
  const rSd = rmults.length > 1 ? Math.sqrt(rmults.reduce((a, b) => a + (b - rMean) ** 2, 0) / (rmults.length - 1)) : 0;
  return {
    totalReturnPct: +totalReturnPct.toFixed(2), cagrPct: +cagrPct.toFixed(2), sharpe, sortino, calmar,
    maxDrawdownPct, maxDDbars, volPct: +(sd * ann * 100).toFixed(1), exposurePct: +(barsInMarket / Math.max(1, nBars - 1) * 100).toFixed(1),
    trades: trades.length, winRatePct: trades.length ? +(wins.length / trades.length * 100).toFixed(1) : 0,
    profitFactor: gl ? +(gp / gl).toFixed(2) : (gp > 0 ? 99 : 0), expectancy: +rMean.toFixed(2),
    sqn: rSd ? +(rMean / rSd * Math.sqrt(trades.length)).toFixed(2) : 0,
    avgWinPct: wins.length ? +(wins.reduce((a, b) => a + b.retPct, 0) / wins.length).toFixed(2) : 0,
    avgLossPct: losses.length ? +(losses.reduce((a, b) => a + b.retPct, 0) / losses.length).toFixed(2) : 0,
    bestPct: rmults.length ? +Math.max(...rmults).toFixed(2) : 0, worstPct: rmults.length ? +Math.min(...rmults).toFixed(2) : 0,
  };
}

export function backtestUniverse(spec: BotSpec, barsBySymbol: Record<string, Bar[]>, opts: EngineOpts = {}): UniverseResult {
  const startCash = opts.startCash ?? 100_000;
  const comm = (opts.commissionPct ?? 0.05) / 100;
  const slip = (opts.slippagePct ?? 0.05) / 100;
  const crypto = spec.universe.assetClass === "crypto";
  const barsPerYear = opts.barsPerYear ?? (crypto
    ? (spec.universe.bar === "1d" ? 365 : spec.universe.bar === "1h" ? 365 * 24 : 365 * 24 * 4)
    : (spec.universe.bar === "1d" ? 252 : spec.universe.bar === "1h" ? Math.round(252 * 6.5) : 252 * 26));
  const empty: Metrics = { totalReturnPct: 0, cagrPct: 0, sharpe: 0, sortino: 0, calmar: 0, maxDrawdownPct: 0, maxDDbars: 0, volPct: 0, exposurePct: 0, trades: 0, winRatePct: 0, profitFactor: 0, expectancy: 0, sqn: 0, avgWinPct: 0, avgLossPct: 0, bestPct: 0, worstPct: 0 };
  const syms = Object.keys(barsBySymbol).filter(s => (barsBySymbol[s]?.length || 0) >= 30);
  if (!syms.length) return { symbol: "-", trades: [], equity: [], metrics: empty, barsUsed: 0, error: "not enough data", bySymbol: [], symbolsUsed: 0 };
  const maxConcurrent = Math.max(1, Math.min(syms.length, spec.risk.maxPositions ?? Math.min(syms.length, 8)));
  const ex = spec.exit;

  const sigBy: Record<string, Record<string, number[]>> = {};
  const idxBy: Record<string, Map<number, number>> = {};
  for (const s of syms) { sigBy[s] = computeSignals(spec.signals, barsBySymbol[s]); idxBy[s] = new Map(barsBySymbol[s].map((b, i) => [b.t, i])); }

  const tset = new Set<number>(); for (const s of syms) for (const b of barsBySymbol[s]) tset.add(b.t);
  const timeline = [...tset].sort((a, b) => a - b);

  interface Pos { sym: string; shares: number; entryPx: number; entryT: number; entryBar: number; peak: number }
  const positions: Record<string, Pos> = {};
  let cash = startCash;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  const rets: number[] = [];
  let peakEq = startCash, ddStart = 0, maxDD = 0, maxDDbars = 0, slotBars = 0;
  const contrib: Record<string, { trades: number; pnl: number }> = {};

  const closePos = (sym: string, px: number, reason: string, tstamp: number, bi: number) => {
    const p = positions[sym]; if (!p) return;
    const fill = px * (1 - slip); const gross = p.shares * fill; const cost = gross * comm;
    cash += gross - cost;
    const pnl = p.shares * (fill - p.entryPx) - cost - p.shares * p.entryPx * comm;
    trades.push({ entryT: p.entryT, exitT: tstamp, entryPx: p.entryPx, exitPx: fill, qty: p.shares, pnl, retPct: (fill / p.entryPx - 1) * 100, bars: bi - p.entryBar, reason, symbol: sym });
    const c = contrib[sym] || (contrib[sym] = { trades: 0, pnl: 0 }); c.trades++; c.pnl += pnl;
    delete positions[sym];
  };

  for (let ti = 0; ti < timeline.length; ti++) {
    const t = timeline[ti];
    for (const sym of Object.keys(positions)) {
      const bi = idxBy[sym].get(t); if (bi == null) continue;
      const bar = barsBySymbol[sym][bi]; const p = positions[sym];
      p.peak = Math.max(p.peak, bar.h);
      let reason = "";
      if (ex.stopLossPct && bar.l <= p.entryPx * (1 - ex.stopLossPct / 100)) reason = "stop";
      else if (ex.takeProfitPct && bar.h >= p.entryPx * (1 + ex.takeProfitPct / 100)) reason = "target";
      else if (ex.trailingPct && bar.l <= p.peak * (1 - ex.trailingPct / 100)) reason = "trail";
      else if (ex.timeBars && bi - p.entryBar >= ex.timeBars) reason = "time";
      else if (ex.signalExit && evalNode(ex.signalExit, sigBy[sym], bi - 1)) reason = "signal";
      if (reason) { const px = reason === "target" ? p.entryPx * (1 + (ex.takeProfitPct || 0) / 100) : reason === "stop" ? p.entryPx * (1 - (ex.stopLossPct || 0) / 100) : bar.o; closePos(sym, px, reason, t, bi); }
    }
    if (Object.keys(positions).length < maxConcurrent) {
      let posVal0 = 0; for (const p of Object.values(positions)) { const bi = idxBy[p.sym].get(t); posVal0 += p.shares * (bi != null ? barsBySymbol[p.sym][bi].c : p.entryPx); }
      let equityNow = cash + posVal0;
      for (const sym of syms) {
        if (positions[sym]) continue;
        if (Object.keys(positions).length >= maxConcurrent) break;
        const bi = idxBy[sym].get(t); if (bi == null || bi < 1) continue;
        if (!evalNode(spec.entry, sigBy[sym], bi - 1)) continue;
        const bar = barsBySymbol[sym][bi];
        const fill = bar.o * (1 + slip);
        let dollars = equityNow / maxConcurrent;
        if (spec.sizing.method === "fixed_cash") dollars = Math.min(dollars, spec.sizing.value);
        else if (spec.sizing.method === "pct_equity") dollars = Math.min(dollars, equityNow * spec.sizing.value / 100);
        if (spec.risk.maxExposurePct) dollars = Math.min(dollars, equityNow * spec.risk.maxExposurePct / 100);
        dollars = Math.min(dollars, cash);
        const shares = Math.floor(dollars / fill);
        if (shares > 0) { cash -= shares * fill + shares * fill * comm; positions[sym] = { sym, shares, entryPx: fill, entryT: t, entryBar: bi, peak: bar.h }; equityNow -= shares * fill; }
      }
    }
    let posVal = 0; for (const p of Object.values(positions)) { const bi = idxBy[p.sym].get(t); posVal += p.shares * (bi != null ? barsBySymbol[p.sym][bi].c : p.entryPx); }
    const eq = cash + posVal;
    if (equity.length) { const prevEq = equity[equity.length - 1].equity; rets.push(prevEq ? eq / prevEq - 1 : 0); }
    if (eq > peakEq) { peakEq = eq; ddStart = ti; }
    const dd = (eq - peakEq) / peakEq;
    if (dd < maxDD) { maxDD = dd; maxDDbars = Math.max(maxDDbars, ti - ddStart); }
    if (Object.keys(positions).length) slotBars++;
    equity.push({ t, equity: +eq.toFixed(2), drawdown: +(dd * 100).toFixed(2) });
  }
  for (const sym of Object.keys(positions)) { const arr = barsBySymbol[sym]; closePos(sym, arr[arr.length - 1].c, "eod", arr[arr.length - 1].t, arr.length - 1); }

  const metrics = metricsFromCurve(equity, trades, rets, barsPerYear, startCash, timeline.length, slotBars, maxDD, maxDDbars);
  const bySymbol: SymbolContribution[] = syms.map(s => ({ symbol: s, trades: contrib[s]?.trades || 0, pnl: +(contrib[s]?.pnl || 0).toFixed(2), retPct: +((contrib[s]?.pnl || 0) / startCash * 100).toFixed(2) })).filter(x => x.trades > 0).sort((a, b) => b.pnl - a.pnl);
  return { symbol: `${syms.length} tickers`, trades, equity, metrics, barsUsed: timeline.length, bySymbol, symbolsUsed: syms.length };
}
