/* 🎯 MULTI-MEASURE ANALYZE & IMPROVE — pick any set of target measures; the engine
   scores each on the REAL run and returns a concrete, grounded plan to improve it.
   Probabilistic measures (Brier / ROC-AUC / PR-AUC / log-loss) grade the meta-labeler's
   out-of-sample P(win) calibration; risk measures come from the real return series.
   "How to improve" is rule-derived from the diagnosis + the meta-labeler feature importance. */
import type { BacktestRun } from "./bt-types";
import type { MetaScores } from "../forge/improver/meta";
import { dailyReturns } from "./bt-analytics";

export type MeasureGroup = "Probabilistic" | "Risk-Adjusted" | "Profitability";
export interface Measure {
  id: string; name: string; group: MeasureGroup; needsMeta: boolean; better: "high" | "low";
  value: (run: BacktestRun, meta: MetaScores | null) => number | null;
  fmt: (v: number) => string;
  interpret: (v: number) => string;
  improve: (run: BacktestRun, meta: MetaScores | null) => string[];
}
export interface MeasureResult { id: string; name: string; group: MeasureGroup; value: number | null; display: string; interpret: string; improve: string[]; better: "high" | "low" }

// ── math ──
const erf = (x: number) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const ncdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const clamp = (v: number, lo = 1e-6, hi = 1 - 1e-6) => Math.max(lo, Math.min(hi, v));

function brier(m: MetaScores) { return mean(m.scores.map((p, i) => (p - m.y[i]) ** 2)); }
function logloss(m: MetaScores) { return -mean(m.scores.map((p, i) => { const q = clamp(p); return m.y[i] * Math.log(q) + (1 - m.y[i]) * Math.log(1 - q); })); }
function prAuc(m: MetaScores) {
  const pos = m.y.filter((v) => v === 1).length; if (!pos) return 0;
  const order = m.scores.map((_, i) => i).sort((a, b) => m.scores[b] - m.scores[a]);
  let tp = 0, fp = 0, sum = 0;
  for (const i of order) { if (m.y[i] === 1) { tp++; sum += tp / (tp + fp); } else fp++; }
  return sum / pos;
}
function psr(run: BacktestRun) {
  const r = dailyReturns(run.equity).map((x) => x.r); if (r.length < 20) return 0;
  const m = mean(r), sd = Math.sqrt(mean(r.map((x) => (x - m) ** 2))) || 1e-9; const sr = m / sd;
  const z = r.map((x) => (x - m) / sd); const skew = mean(z.map((x) => x ** 3)), kurt = mean(z.map((x) => x ** 4));
  const denom = Math.sqrt(Math.max(1e-9, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  return ncdf((sr * Math.sqrt(r.length - 1)) / denom);
}

export const MEASURES: Measure[] = [
  { id: "brier", name: "Brier Score", group: "Probabilistic", needsMeta: true, better: "low", value: (_r, m) => (m ? brier(m) : null), fmt: (v) => v.toFixed(3), interpret: (v) => v < 0.2 ? "Well-calibrated P(win)." : v < 0.25 ? "Roughly calibrated." : "Poorly calibrated — probabilities don't match outcomes.", improve: (_r, m) => ["Calibrate the P(win) output (Platt / isotonic) so scores match realized win rates.", m && m.features[0] ? `The most predictive feature is "${m.features[0].name}" — gate entries on it.` : "Add an orthogonal feature (regime, volatility) so the classifier can separate winners.", "More trades tighten calibration — widen the universe or lengthen the test."] },
  { id: "auc", name: "ROC-AUC", group: "Probabilistic", needsMeta: true, better: "high", value: (_r, m) => (m ? m.auc : null), fmt: (v) => v.toFixed(3), interpret: (v) => v < 0.55 ? "Signals barely separate winners from losers — no learnable filter." : v < 0.62 ? "Weak but real ranking of trades." : "The classifier ranks trades well — a P(win) filter should help.", improve: (_r, m) => m && m.auc >= 0.6 ? ["Deploy the meta-labeler: skip the lowest-confidence half of trades.", `Lean into "${m.features[0]?.name}" — it carries the ranking.`] : ["The edge is in the RULES, not a filter — refine entries/exits directly (see Autopsy).", "Add a regime or trend filter so the classifier has separable structure.", "Engineer a feature orthogonal to the existing signals."] },
  { id: "prauc", name: "PR-AUC", group: "Probabilistic", needsMeta: true, better: "high", value: (_r, m) => (m ? prAuc(m) : null), fmt: (v) => v.toFixed(3), interpret: (v) => v < 0.5 ? "Precision on the winner class is weak under imbalance." : "Reasonable precision at identifying winners.", improve: () => ["Optimize the P(win) threshold for precision, not just AUC — keep only high-confidence entries.", "If winners are rare (low base rate), a small precision gain still lifts expectancy — filter aggressively."] },
  { id: "logloss", name: "Log Loss", group: "Probabilistic", needsMeta: true, better: "low", value: (_r, m) => (m ? logloss(m) : null), fmt: (v) => v.toFixed(3), interpret: (v) => v < 0.6 ? "Confident and correct probabilities." : "Over/under-confident probabilities.", improve: () => ["Regularize the classifier (more L2) to stop over-confident scores.", "Recalibrate probabilities so extreme scores are earned, not assumed."] },
  { id: "sharpe", name: "Sharpe", group: "Risk-Adjusted", needsMeta: false, better: "high", value: (r) => r.metrics.sharpe, fmt: (v) => v.toFixed(2), interpret: (v) => v < 0.5 ? "Return doesn't justify the volatility." : v < 1 ? "Modest risk-adjusted return." : "Healthy risk-adjusted return.", improve: () => ["Cut volatility drag: tighten exits or add volatility-target sizing.", "Drop the worst-performing regime — the Autopsy shows where the return leaks.", "Skip low-confidence trades (meta-labeler) to raise the mean/vol ratio."] },
  { id: "sortino", name: "Sortino", group: "Risk-Adjusted", needsMeta: false, better: "high", value: (r) => r.metrics.sortino, fmt: (v) => v.toFixed(2), interpret: (v) => v < 1 ? "Downside volatility is heavy." : "Downside is well-contained.", improve: () => ["Add a hard stop / crisis-regime filter to clip the left tail.", "Size down into high-volatility regimes where the downside clusters."] },
  { id: "calmar", name: "Calmar", group: "Risk-Adjusted", needsMeta: false, better: "high", value: (r) => r.metrics.calmar, fmt: (v) => v.toFixed(2), interpret: (v) => v < 0.5 ? "Drawdown is deep for the return earned." : "Return is worth the drawdown.", improve: (r) => [`Max drawdown is ${r.metrics.maxDrawdownPct.toFixed(1)}% — add a max-DD kill-switch that flattens on breach.`, "De-risk (halve size) after N consecutive losers to shorten drawdowns."] },
  { id: "psr", name: "Prob. Sharpe (PSR)", group: "Risk-Adjusted", needsMeta: false, better: "high", value: (r) => psr(r), fmt: (v) => `${(v * 100).toFixed(0)}%`, interpret: (v) => v < 0.9 ? "Sharpe is NOT statistically distinguishable from 0 at this sample size." : "Sharpe is statistically credible.", improve: () => ["Get more trades (longer window / more symbols) — PSR rewards sample size.", "Reduce return skew/kurtosis (fat tails inflate the Sharpe error bar)."] },
  { id: "pf", name: "Profit Factor", group: "Profitability", needsMeta: false, better: "high", value: (r) => r.metrics.profitFactor, fmt: (v) => v.toFixed(2), interpret: (v) => v < 1.1 ? "Gross wins barely exceed gross losses." : v < 1.5 ? "Modest positive edge." : "Strong gross edge.", improve: () => ["Cut the fat left tail — stop losers faster (tighter stop / time stop).", "Let winners run — loosen the take-profit or add a trailing stop to lift the numerator."] },
  { id: "expectancy", name: "Expectancy", group: "Profitability", needsMeta: false, better: "high", value: (r) => r.metrics.expectancy, fmt: (v) => `$${v.toFixed(2)}`, interpret: (v) => v <= 0 ? "Negative edge per trade after costs." : "Positive edge per trade.", improve: () => ["Costs matter at this size — model & minimize commission/slippage (see Risk tab grid).", "Widen the per-trade edge (better entries) or trade a higher-volatility instrument."] },
  { id: "winrate", name: "Win Rate", group: "Profitability", needsMeta: false, better: "high", value: (r) => r.metrics.winRatePct, fmt: (v) => `${v.toFixed(1)}%`, interpret: (v) => v < 40 ? "Low hit rate — only viable if payoff is large." : "Balanced hit rate.", improve: (r) => [`A ${r.metrics.winRatePct.toFixed(0)}% win rate needs payoff ≥ ${(1 / Math.max(0.01, r.metrics.winRatePct / 100) - 1).toFixed(1)}:1 — check Profit Factor.`, "Improve entry timing — the Autopsy flags low entry-efficiency trades."] },
  { id: "sqn", name: "SQN", group: "Profitability", needsMeta: false, better: "high", value: (r) => r.metrics.sqn, fmt: (v) => v.toFixed(2), interpret: (v) => v < 1.6 ? "Below-average system quality." : v < 2.5 ? "Average / good system." : "Excellent system quality.", improve: () => ["SQN scales with √(#trades) × edge/consistency — add trades or tighten the edge's consistency.", "Reduce per-trade variance (consistent sizing) to lift SQN without changing the mean."] },
];

export function computeMeasures(run: BacktestRun, meta: MetaScores | null, ids: string[]): MeasureResult[] {
  return MEASURES.filter((m) => ids.includes(m.id)).map((m) => {
    const v = m.value(run, meta);
    return { id: m.id, name: m.name, group: m.group, value: v, display: v == null ? "n/a" : m.fmt(v), interpret: v == null ? (m.needsMeta ? "Needs ≥12 trades for the meta-labeler." : "—") : m.interpret(v), improve: v == null ? [] : m.improve(run, meta), better: m.better };
  });
}

export async function improvePlanAI(results: MeasureResult[], strategyName: string, symbol: string): Promise<string> {
  try {
    const res = await fetch("/api/apex/forge-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      question: `You are a quant. Given these target measures and their current values + diagnoses, write a prioritized 4-step plan to improve the WEAKEST ones with concrete rule changes. Be specific and terse. No preamble.`,
      context: { strategy: strategyName, symbol, measures: results.map((r) => ({ name: r.name, value: r.display, note: r.interpret })) },
    }) });
    if (!res.ok) return "";
    const j = await res.json();
    return String(j.answer || j.response || j.suggestions || j.text || "").trim();
  } catch { return ""; }
}
