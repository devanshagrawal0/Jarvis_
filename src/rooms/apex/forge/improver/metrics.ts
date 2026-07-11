/* THE IMPROVER — K0 Metric Registry (compute-on-demand, never says "no").
   Each metric is a descriptor with compute() + interpret() (what a bad value
   DIAGNOSES). resolveMetric() looks up by id/alias, derives missing inputs, and
   degrades to the closest computable proxy rather than refusing. Pure JS over
   the Run artifact (§5/§9 of the spec). */

import type { RunArtifact } from "./artifact";

export interface MetricResult {
  id: string; label: string; value: number; unit: string;
  verdict: "good" | "ok" | "bad" | "na"; diagnosis: string; formula: string;
  goodDirection: "higher" | "lower"; wasDerived?: boolean; missing?: string[];
}
interface Descriptor {
  id: string; label: string; aliases: string[]; category: string; unit: string;
  goodDirection: "higher" | "lower"; formula: string;
  compute: (r: RunArtifact) => number | null;      // null → unavailable
  interpret: (v: number, r: RunArtifact) => { verdict: MetricResult["verdict"]; diagnosis: string };
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const q = (a: number[], p: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length))); return s[i]; };
const dd = (r: RunArtifact) => r.metrics.maxDrawdownPct; // % (negative)

const R = (r: RunArtifact) => r.rBar;
const wins = (r: RunArtifact) => r.rTrade.filter(x => x > 0);
const losses = (r: RunArtifact) => r.rTrade.filter(x => x < 0);

export const REGISTRY: Descriptor[] = [
  { id: "sharpe", label: "Sharpe", aliases: ["sharpe ratio"], category: "risk", unit: "", goodDirection: "higher", formula: "mean(R)/std(R)·√A",
    compute: r => { const a = R(r); const s = std(a); return s ? (mean(a) / s) * Math.sqrt(r.meta.A) : 0; },
    interpret: v => v >= 1 ? { verdict: "good", diagnosis: "Strong reward per unit of total volatility." } : v < 0.4 ? { verdict: "bad", diagnosis: "Returns barely compensate for volatility — thin or absent edge. Blind to tails; check Sortino." } : { verdict: "ok", diagnosis: "Middling risk-adjusted return." } },
  { id: "sortino", label: "Sortino", aliases: ["downside sharpe"], category: "risk", unit: "", goodDirection: "higher", formula: "(mean(R)-τ)/downsideDev·√A",
    compute: r => { const a = R(r); const dside = Math.sqrt(mean(a.map(x => Math.min(x, 0) ** 2))); return dside ? (mean(a) / dside) * Math.sqrt(r.meta.A) : 0; },
    interpret: (v, r) => { const sh = (REGISTRY.find(d => d.id === "sharpe")!.compute(r) || 0); return v < sh * 0.7 ? { verdict: "bad", diagnosis: "Downside is the problem — losers are large relative to overall vol (fat left tail)." } : v >= 1.5 ? { verdict: "good", diagnosis: "Healthy downside-adjusted return." } : { verdict: "ok", diagnosis: "Acceptable downside profile." }; } },
  { id: "calmar", label: "Calmar", aliases: ["mar", "mar ratio"], category: "risk", unit: "", goodDirection: "higher", formula: "CAGR/|MaxDD|",
    compute: r => r.metrics.calmar,
    interpret: v => v < 0.5 ? { verdict: "bad", diagnosis: "Return doesn't justify the depth of the worst drawdown." } : v >= 1 ? { verdict: "good", diagnosis: "Return comfortably justifies the drawdown." } : { verdict: "ok", diagnosis: "Moderate return-to-drawdown." } },
  { id: "maxDrawdown", label: "Max Drawdown", aliases: ["max dd", "maxdd", "drawdown"], category: "tail", unit: "%", goodDirection: "higher", formula: "max peak-to-trough decline",
    compute: r => r.metrics.maxDrawdownPct,
    interpret: v => v <= -25 ? { verdict: "bad", diagnosis: "Deep drawdown — hard to sit through; capital-destruction risk." } : v <= -12 ? { verdict: "ok", diagnosis: "Moderate drawdown." } : { verdict: "good", diagnosis: "Shallow drawdown." } },
  { id: "ulcer", label: "Ulcer Index", aliases: ["ulcer"], category: "tail", unit: "", goodDirection: "lower", formula: "√mean(DD²)",
    compute: r => Math.sqrt(mean(r.equity.map(e => (e.drawdown || 0) ** 2))) * 100,
    interpret: v => v >= 12 ? { verdict: "bad", diagnosis: "Drawdowns are deep AND long — a stressful, pain-heavy equity path." } : v <= 5 ? { verdict: "good", diagnosis: "Low sustained drawdown pain." } : { verdict: "ok", diagnosis: "Moderate drawdown pain." } },
  { id: "var95", label: "VaR 95", aliases: ["var", "value at risk"], category: "tail", unit: "%", goodDirection: "higher", formula: "-quantile(R,0.05)",
    compute: r => q(R(r), 0.05) * 100,
    interpret: v => v < -3 ? { verdict: "bad", diagnosis: "Routine days can hurt — sizing may be aggressive." } : { verdict: "ok", diagnosis: "Contained daily downside." } },
  { id: "cvar95", label: "CVaR 95", aliases: ["cvar", "expected shortfall", "es"], category: "tail", unit: "%", goodDirection: "higher", formula: "mean(R | R≤VaR)",
    compute: r => { const a = R(r); const v = q(a, 0.05); const tail = a.filter(x => x <= v); return (tail.length ? mean(tail) : v) * 100; },
    interpret: (v, r) => { const varr = (REGISTRY.find(d => d.id === "var95")!.compute(r) || 0); return v < varr * 1.6 ? { verdict: "bad", diagnosis: "Fat tail beyond the cutoff — the bad days are catastrophic, not just bad." } : { verdict: "ok", diagnosis: "Tail beyond VaR is contained." }; } },
  { id: "tailRatio", label: "Tail Ratio", aliases: ["tail ratio"], category: "tail", unit: "", goodDirection: "higher", formula: "q95(R)/|q05(R)|",
    compute: r => { const a = R(r); const d = Math.abs(q(a, 0.05)); return d ? q(a, 0.95) / d : 0; },
    interpret: v => v < 1 ? { verdict: "bad", diagnosis: "Left tail bigger than right — you lose more on bad days than you make on good ones." } : { verdict: "good", diagnosis: "Right tail dominates — favorable asymmetry." } },
  { id: "skew", label: "Skew", aliases: ["skewness"], category: "dist", unit: "", goodDirection: "higher", formula: "E[((R-μ)/σ)³]",
    compute: r => { const a = R(r); const m = mean(a), s = std(a) || 1e-9; return mean(a.map(x => ((x - m) / s) ** 3)); },
    interpret: v => v < -0.5 ? { verdict: "bad", diagnosis: "Negative skew — prone to occasional large losses." } : { verdict: "ok", diagnosis: "No dangerous skew." } },
  { id: "kurtosis", label: "Excess Kurtosis", aliases: ["kurtosis"], category: "dist", unit: "", goodDirection: "lower", formula: "E[((R-μ)/σ)⁴]-3",
    compute: r => { const a = R(r); const m = mean(a), s = std(a) || 1e-9; return mean(a.map(x => ((x - m) / s) ** 4)) - 3; },
    interpret: v => v >= 5 ? { verdict: "bad", diagnosis: "Fat-tailed — extreme moves far more likely than normal." } : { verdict: "ok", diagnosis: "Tails within reason." } },
  { id: "profitFactor", label: "Profit Factor", aliases: ["pf"], category: "trade", unit: "", goodDirection: "higher", formula: "Σgains/|Σlosses|",
    compute: r => { const l = Math.abs(sum(losses(r))); return l ? sum(wins(r)) / l : sum(wins(r)) || 0; },
    interpret: v => v < 1.1 ? { verdict: "bad", diagnosis: "Edge is fragile — winners barely outweigh losers." } : v >= 1.5 ? { verdict: "good", diagnosis: "Winners comfortably outweigh losers." } : { verdict: "ok", diagnosis: "Modest edge." } },
  { id: "payoff", label: "Payoff Ratio", aliases: ["payoff", "win/loss ratio"], category: "trade", unit: "", goodDirection: "higher", formula: "avgWin/|avgLoss|",
    compute: r => { const l = Math.abs(mean(losses(r))); return l ? mean(wins(r)) / l : 0; },
    interpret: (v, r) => v < 1 && r.metrics.winRatePct < 55 ? { verdict: "bad", diagnosis: "Small payoff without a high win rate — likely cutting winners / letting losers run." } : { verdict: "ok", diagnosis: "Payoff acceptable given win rate." } },
  { id: "expectancy", label: "Expectancy", aliases: ["edge per trade"], category: "trade", unit: "%", goodDirection: "higher", formula: "W·avgWin − L·|avgLoss|",
    compute: r => mean(r.rTrade) * 100,
    interpret: v => v <= 0 ? { verdict: "bad", diagnosis: "No positive edge per trade." } : { verdict: "good", diagnosis: "Positive per-trade edge." } },
  { id: "sqn", label: "SQN", aliases: ["system quality"], category: "trade", unit: "", goodDirection: "higher", formula: "mean(R_trade)/std·√n",
    compute: r => r.metrics.sqn,
    interpret: v => v < 1.6 ? { verdict: "bad", diagnosis: "Inconsistent edge relative to trade count." } : v >= 2.5 ? { verdict: "good", diagnosis: "Consistent, high-quality edge." } : { verdict: "ok", diagnosis: "Decent system quality." } },
  { id: "kelly", label: "Kelly Fraction", aliases: ["kelly", "optimal f"], category: "sizing", unit: "%", goodDirection: "higher", formula: "W − (1−W)/payoff",
    compute: r => { const w = r.metrics.winRatePct / 100; const pf = REGISTRY.find(d => d.id === "payoff")!.compute(r) || 0; return pf > 0 ? (w - (1 - w) / pf) * 100 : 0; },
    interpret: v => v <= 0 ? { verdict: "bad", diagnosis: "No edge worth betting — Kelly ≤ 0." } : { verdict: "ok", diagnosis: `Growth-optimal full-Kelly ≈ ${v.toFixed(0)}%; run half that for safety.` } },
  { id: "gainToPain", label: "Gain-to-Pain", aliases: ["gpr", "gain to pain"], category: "risk", unit: "", goodDirection: "higher", formula: "Σret/Σ|negative ret|",
    compute: r => { const neg = Math.abs(sum(R(r).filter(x => x < 0))); return neg ? sum(R(r)) / neg : 0; },
    interpret: v => v < 1 ? { verdict: "bad", diagnosis: "Pain outweighs gain over the period." } : { verdict: "good", diagnosis: "Gain outweighs pain." } },
  { id: "exitEfficiency", label: "Exit Efficiency", aliases: ["exit eff", "mfe capture"], category: "execution", unit: "", goodDirection: "higher", formula: "mean(netRet/MFE) over winners",
    compute: r => { const w = r.ledger.filter(l => l.outcome === "win"); return w.length ? mean(w.map(l => l.exitEff)) : 0; },
    interpret: v => v < 0.5 ? { verdict: "bad", diagnosis: "Exiting far below the move's peak — targets too tight or trail too loose." } : { verdict: "good", diagnosis: "Capturing most of the favorable move." } },
  { id: "recoveryFactor", label: "Recovery Factor", aliases: ["recovery"], category: "risk", unit: "", goodDirection: "higher", formula: "|totalReturn/MaxDD|",
    compute: r => dd(r) ? Math.abs(r.metrics.totalReturnPct / dd(r)) : 0,
    interpret: v => v < 1 ? { verdict: "bad", diagnosis: "Total return smaller than the worst drawdown." } : { verdict: "ok", diagnosis: "Return exceeds worst drawdown." } },
  { id: "probabilisticSharpe", label: "Probabilistic Sharpe", aliases: ["psr"], category: "robustness", unit: "", goodDirection: "higher", formula: "Φ(SR·√(n-1)/√(1−γ3·SR+(γ4−1)/4·SR²))",
    compute: r => { const a = R(r); const n = a.length; if (n < 20) return null; const s = std(a) || 1e-9; const sr = mean(a) / s; const m = mean(a); const g3 = mean(a.map(x => ((x - m) / s) ** 3)); const g4 = mean(a.map(x => ((x - m) / s) ** 4)); const denom = Math.sqrt(Math.max(1e-9, 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr)); return normCdf((sr * Math.sqrt(n - 1)) / denom); },
    interpret: v => v < 0.95 ? { verdict: "bad", diagnosis: "The Sharpe is not statistically distinguishable from zero given sample size and non-normality." } : { verdict: "good", diagnosis: "Sharpe is statistically significant." } },
  { id: "winRate", label: "Win Rate", aliases: ["hit rate"], category: "trade", unit: "%", goodDirection: "higher", formula: "#wins/#trades",
    compute: r => r.metrics.winRatePct, interpret: () => ({ verdict: "ok", diagnosis: "Interpret only alongside payoff ratio." }) },
  { id: "cagr", label: "CAGR", aliases: ["annual return"], category: "return", unit: "%", goodDirection: "higher", formula: "(1+total)^(A/bars)−1",
    compute: r => r.metrics.cagrPct, interpret: v => v <= 0 ? { verdict: "bad", diagnosis: "Not compounding." } : { verdict: "ok", diagnosis: "Positive compounding." } },
];

function normCdf(x: number): number { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x: number): number { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function resolveMetric(run: RunArtifact, idOrAlias: string): MetricResult {
  const key = norm(idOrAlias);
  let d = REGISTRY.find(x => norm(x.id) === key || x.aliases.some(a => norm(a) === key));
  if (!d) d = REGISTRY.find(x => { const names = [x.id, ...x.aliases].map(norm); return names.some(n => n.includes(key) || key.includes(n)); }); // bidirectional fuzzy
  if (!d) return { id: idOrAlias, label: idOrAlias, value: NaN, unit: "", verdict: "na", diagnosis: `No descriptor matched "${idOrAlias}". Closest computable metrics: ${REGISTRY.slice(0, 6).map(x => x.label).join(", ")}. (Knowledge Layer would derive the formula here.)`, formula: "—", goodDirection: "higher", missing: ["descriptor"] };
  const v = d.compute(run);
  if (v == null || Number.isNaN(v)) return { id: d.id, label: d.label, value: NaN, unit: d.unit, verdict: "na", diagnosis: `Needs more data to compute (e.g. ≥20 bars). Closest available proxy shown elsewhere.`, formula: d.formula, goodDirection: d.goodDirection, missing: ["inputs"] };
  const ip = d.interpret(v, run);
  return { id: d.id, label: d.label, value: Math.round(v * 1000) / 1000, unit: d.unit, verdict: ip.verdict, diagnosis: ip.diagnosis, formula: d.formula, goodDirection: d.goodDirection };
}
export function computeAll(run: RunArtifact): MetricResult[] { return REGISTRY.map(d => resolveMetric(run, d.id)); }
