/* THE FORGE — DEEP ANALYSIS ENGINE (JS core).
   Turns a backtest + Monte-Carlo into a full metric sheet + a grounded,
   rule-based narrative, saved as a keyed report so Jarvis can answer
   "what's my Sortino?" by lookup. The plan's Python microservice (quantstats /
   empyrical, 31 metrics) is a later enhancement; this computes the core ~20
   deterministically from the equity/return series — no Python needed. */

import type { BacktestResult, MonteCarlo } from "./forge-engine";

export interface DeepMetrics {
  totalReturnPct: number; cagrPct: number; sharpe: number; sortino: number; calmar: number;
  maxDrawdownPct: number; ulcerIndex: number; recoveryFactor: number;
  var95Pct: number; cvar95Pct: number; tailRatio: number; skew: number; kurtosis: number;
  winRatePct: number; profitFactor: number; payoffRatio: number; expectancyPct: number;
  gainToPain: number; kellyPct: number; avgWinPct: number; avgLossPct: number;
  bestTradePct: number; worstTradePct: number; trades: number; exposurePct: number;
  // Monte-Carlo (probability cone)
  mcReturnP5?: number; mcReturnP50?: number; mcReturnP95?: number; mcDrawdownP95?: number; mcWinProb?: number;
  // $100 capital path
  finalEquityFrom100: number;
}

export interface DeepReport {
  name: string;
  metrics: DeepMetrics;
  grade: string;         // A+…F overall
  narrative: { summary: string; strengths: string[]; weaknesses: string[]; improve: string[] };
  generatedAtLabel: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

/* Per-bar returns from the equity curve. */
function barReturns(equity: { equity: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) { const p = equity[i - 1].equity, c = equity[i].equity; if (p > 0) out.push(c / p - 1); }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function deepAnalyze(result: BacktestResult, mc: MonteCarlo | null, nowLabel: string): DeepReport {
  const m = result.metrics;
  const rets = barReturns(result.equity);
  const sorted = [...rets].sort((a, b) => a - b);
  const mu = mean(rets);
  const sd = Math.sqrt(mean(rets.map(x => (x - mu) ** 2))) || 1e-9;

  // higher moments
  const skew = mean(rets.map(x => ((x - mu) / sd) ** 3));
  const kurtosis = mean(rets.map(x => ((x - mu) / sd) ** 4)) - 3;

  // tail risk (daily, %)
  const var95 = percentile(sorted, 5) * 100;
  const tail = sorted.filter(x => x <= percentile(sorted, 5));
  const cvar95 = (tail.length ? mean(tail) : var95 / 100) * 100;
  const gains = sorted.filter(x => x > 0), losses = sorted.filter(x => x < 0);
  const tailRatio = losses.length && gains.length ? Math.abs(percentile([...gains].sort((a, b) => a - b), 95) / (percentile(sorted, 5) || -1e-9)) : 0;

  // ulcer index (RMS of drawdowns) + recovery factor
  let peak = result.equity[0]?.equity || 1, sumSqDD = 0;
  for (const e of result.equity) { peak = Math.max(peak, e.equity); const dd = (e.equity - peak) / peak * 100; sumSqDD += dd * dd; }
  const ulcer = Math.sqrt(sumSqDD / (result.equity.length || 1));
  const recovery = m.maxDrawdownPct !== 0 ? Math.abs(m.totalReturnPct / m.maxDrawdownPct) : 0;

  // trade stats
  const trades = result.trades || [];
  const pnls = trades.map(t => (t as { retPct?: number }).retPct ?? 0);
  const wins = pnls.filter(p => p > 0), losesT = pnls.filter(p => p < 0);
  const avgWin = wins.length ? mean(wins) : 0, avgLoss = losesT.length ? mean(losesT) : 0;
  const payoff = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const winRate = m.winRatePct / 100;
  const kelly = payoff > 0 ? (winRate - (1 - winRate) / payoff) * 100 : 0;
  const grossWin = wins.reduce((s, x) => s + x, 0), grossLoss = Math.abs(losesT.reduce((s, x) => s + x, 0));
  const gainToPain = grossLoss > 0 ? grossWin / grossLoss : grossWin;

  const metrics: DeepMetrics = {
    totalReturnPct: m.totalReturnPct, cagrPct: m.cagrPct, sharpe: m.sharpe, sortino: m.sortino, calmar: m.calmar,
    maxDrawdownPct: m.maxDrawdownPct, ulcerIndex: r2(ulcer), recoveryFactor: r2(recovery),
    var95Pct: r2(var95), cvar95Pct: r2(cvar95), tailRatio: r2(tailRatio), skew: r2(skew), kurtosis: r2(kurtosis),
    winRatePct: m.winRatePct, profitFactor: m.profitFactor, payoffRatio: r2(payoff), expectancyPct: m.expectancy,
    gainToPain: r2(gainToPain), kellyPct: r2(kelly), avgWinPct: r2(avgWin), avgLossPct: r2(avgLoss),
    bestTradePct: r2(Math.max(0, ...pnls)), worstTradePct: r2(Math.min(0, ...pnls)), trades: m.trades, exposurePct: m.exposurePct,
    mcReturnP5: mc?.retP5, mcReturnP50: mc?.retP50, mcReturnP95: mc?.retP95, mcDrawdownP95: mc?.ddP95, mcWinProb: mc?.winProb,
    finalEquityFrom100: r2(100 * (1 + m.totalReturnPct / 100)),
  };

  // ── rule-based findings (facts) → narrative (prose) ──
  const strengths: string[] = [], weaknesses: string[] = [], improve: string[] = [];
  if (metrics.sharpe >= 1) strengths.push(`Strong risk-adjusted return (Sharpe ${metrics.sharpe}).`);
  else if (metrics.sharpe < 0.4) weaknesses.push(`Weak risk-adjusted return (Sharpe ${metrics.sharpe}) — returns barely compensate for volatility.`);
  if (metrics.sortino >= 1.5) strengths.push(`Downside-adjusted return is healthy (Sortino ${metrics.sortino}).`);
  if (metrics.calmar >= 0.5) strengths.push(`Return justifies the drawdown (Calmar ${metrics.calmar}).`);
  else weaknesses.push(`Return is small relative to the worst drawdown (Calmar ${metrics.calmar}).`);
  if (metrics.maxDrawdownPct <= -25) weaknesses.push(`Deep max drawdown of ${metrics.maxDrawdownPct}% — hard to sit through.`);
  if (metrics.profitFactor >= 1.5) strengths.push(`Profit factor ${metrics.profitFactor} — winners outweigh losers comfortably.`);
  else if (metrics.profitFactor < 1.1) weaknesses.push(`Thin profit factor ${metrics.profitFactor} — edge is fragile.`);
  if (metrics.trades < 20) weaknesses.push(`Only ${metrics.trades} trades — not enough for statistical confidence.`);
  if (metrics.winRatePct < 40 && metrics.payoffRatio < 1.5) weaknesses.push(`Low win rate (${metrics.winRatePct}%) without a big payoff ratio to compensate.`);
  if (metrics.skew < -0.5) weaknesses.push(`Negative skew (${metrics.skew}) — prone to occasional large losses.`);
  if (metrics.kellyPct > 0) improve.push(`Kelly suggests sizing near ${Math.min(100, Math.max(0, metrics.kellyPct)).toFixed(0)}% of the full-Kelly bet; consider half-Kelly for safety.`);
  if (metrics.exposurePct < 40) improve.push(`Capital is idle much of the time (${metrics.exposurePct}% exposure) — a complementary strategy could fill the gaps.`);
  if (metrics.trades < 30) improve.push(`Run on more history / more symbols to raise the trade count before trusting these numbers.`);
  if (mc && (mc.winProb ?? 0) < 55) weaknesses.push(`Monte-Carlo says only ${mc.winProb}% of reshuffled runs stay profitable — result may be luck.`);
  if (!strengths.length) strengths.push("No standout strengths yet — iterate on the entry logic.");
  if (!improve.length) improve.push("Solid baseline — test robustness across regimes next.");

  // overall grade — weighted score, then SHRUNK toward neutral (50) when the
  // sample is too small to trust. A 2-trade backtest can't earn an A.
  const raw = 50 + metrics.sharpe * 12 + metrics.calmar * 8 + (metrics.profitFactor - 1) * 10 + metrics.maxDrawdownPct * 0.4 + (mc ? ((mc.winProb ?? 50) - 50) * 0.4 : 0);
  const confidence = Math.min(1, metrics.trades / 40); // full trust at ~40 trades
  const score = Math.max(0, Math.min(100, 50 + (raw - 50) * confidence));
  const grade = score >= 88 ? "A+" : score >= 80 ? "A" : score >= 72 ? "B+" : score >= 64 ? "B" : score >= 56 ? "C+" : score >= 48 ? "C" : score >= 40 ? "D" : "F";

  const summary = `On this backtest, $100 became $${metrics.finalEquityFrom100} (${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct}%). ` +
    `Risk-adjusted return sits at Sharpe ${metrics.sharpe} / Sortino ${metrics.sortino}, with a worst drawdown of ${metrics.maxDrawdownPct}% (Calmar ${metrics.calmar}). ` +
    (mc ? `Across ${mc.runs} reshuffled futures, ${mc.winProb}% stay profitable and the unlucky 5% draw down ${Math.abs(mc.ddP95)}%. ` : `Too few trades for a Monte-Carlo cone. `) +
    `Overall grade: ${grade}.`;

  return { name: result.symbol, metrics, grade, narrative: { summary, strengths, weaknesses, improve }, generatedAtLabel: nowLabel };
}
