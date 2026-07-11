/* THE IMPROVER — K1 testers. Each attacks ONE weakpoint and returns a typed
   TesterResult {finding, evidence, weakness, metricsHurt, fixHint, severity}.
   These operate purely on the Ledger + run artifact (no re-backtest); the
   counterfactual/walk-forward testers that need the oracle live in the engine
   (K2). Pure JS, spec §7. */

import type { RunArtifact, RegimeId, TradeRecord, SpecPatch } from "./artifact";
import { REGIME_LABEL } from "./artifact";

export interface TesterResult {
  id: string; title: string; finding: string; weakness: boolean;
  evidence: { stat: string; value: number | string; n?: number }[];
  metricsHurt: string[]; fixHint?: string; severity: "info" | "low" | "med" | "high";
  patch?: SpecPatch;   // a mechanically-applicable BotSpec mutation, when the fix is a param tweak
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/* T4 — Regime-conditional performance. Exposes regime dependence. */
export function testerRegime(run: RunArtifact): TesterResult {
  const byReg: Record<string, TradeRecord[]> = {};
  for (const t of run.ledger) (byReg[t.regimeAtEntry] ||= []).push(t);
  const rows = (Object.keys(byReg) as RegimeId[]).map(r => {
    const ts = byReg[r]; const rets = ts.map(t => t.netRet);
    return { r, n: ts.length, exp: mean(rets), win: ts.filter(t => t.outcome === "win").length / ts.length };
  }).sort((a, b) => b.exp - a.exp);
  const best = rows[0], worst = rows[rows.length - 1];
  const concentrated = rows.length > 1 && best.exp > 0 && worst.exp < 0;
  return {
    id: "T4", title: "Regime-conditional performance", weakness: concentrated,
    finding: concentrated
      ? `Edge concentrates in ${REGIME_LABEL[best.r]} (expectancy ${pct(best.exp)}) and inverts in ${REGIME_LABEL[worst.r]} (${pct(worst.exp)}) — the strategy is regime-dependent.`
      : `Performance is reasonably consistent across regimes (best ${REGIME_LABEL[best.r]} ${pct(best.exp)}).`,
    evidence: rows.map(x => ({ stat: `${REGIME_LABEL[x.r]} expectancy`, value: pct(x.exp), n: x.n })),
    metricsHurt: concentrated ? ["expectancy", "sortino", "maxDrawdown"] : [],
    fixHint: concentrated ? `Add a regime filter so the bot only trades in ${REGIME_LABEL[best.r]}-like conditions.` : undefined,
    severity: concentrated ? "high" : "info",
  };
}

/* T8 — MAE/MFE efficiency → derive optimal stop/target, quantify wasted profit. */
export function testerExcursion(run: RunArtifact): TesterResult {
  const w = run.ledger.filter(t => t.outcome === "win");
  const exitEff = w.length ? mean(w.map(t => t.exitEff)) : 0;
  const wasted = w.length ? mean(w.map(t => t.wastedProfit)) : 0;
  const winnerMaeAtr = w.length ? mean(w.map(t => Math.abs(t.maeAtr))) : 0;
  const bad = exitEff < 0.55 && w.length >= 5;
  return {
    id: "T8", title: "Excursion efficiency (MAE/MFE)", weakness: bad,
    finding: bad
      ? `Winners capture only ${pct(exitEff)} of their favorable move — ${pct(wasted)} of the run is left on the table. Winners drew down ${winnerMaeAtr.toFixed(1)} ATR before working.`
      : `Exit efficiency is healthy (${pct(exitEff)} of the move captured).`,
    evidence: [{ stat: "avg exit efficiency", value: pct(exitEff), n: w.length }, { stat: "avg wasted profit", value: pct(wasted) }, { stat: "winner MAE (ATR)", value: winnerMaeAtr.toFixed(2) }],
    metricsHurt: bad ? ["payoff", "profitFactor", "exitEfficiency"] : [],
    fixHint: bad ? `Replace the fixed target with an ATR trailing stop (~${Math.max(1.5, winnerMaeAtr * 1.3).toFixed(1)}× ATR) to let winners run.` : undefined,
    patch: bad ? { exit: { atrStopMult: +Math.max(1.5, winnerMaeAtr * 1.3).toFixed(1), takeProfitPct: undefined } } : undefined,
    severity: bad ? "med" : "info",
  };
}

/* T11 — Exit-reason decomposition. Finds which exit path bleeds money. */
export function testerExitReason(run: RunArtifact): TesterResult {
  const by: Record<string, number[]> = {};
  for (const t of run.ledger) (by[t.exitReason] ||= []).push(t.netRet);
  const rows = Object.entries(by).map(([reason, rets]) => ({ reason, n: rets.length, exp: mean(rets), share: rets.length / run.ledger.length })).sort((a, b) => a.exp - b.exp);
  const worst = rows[0];
  const bad = rows.length > 1 && worst.exp < 0 && worst.share > 0.1;
  const ex = run.spec.exit;
  let patch: SpecPatch | undefined;
  if (bad) {
    if (worst.reason === "time") patch = { exit: { timeBars: undefined, trailingPct: ex.trailingPct || 8 } };
    else if (worst.reason === "stop") patch = { exit: { stopLossPct: +(((ex.stopLossPct || 5) * 1.5).toFixed(1)) } };
  }
  return {
    id: "T11", title: "Exit-reason decomposition", weakness: bad,
    finding: bad
      ? `The "${worst.reason}" exit path is the weak link: ${pct(worst.exp)} expectancy across ${pct(worst.share)} of trades.`
      : `No single exit path is a major drag.`,
    evidence: rows.map(x => ({ stat: `${x.reason} expectancy`, value: pct(x.exp), n: x.n })),
    metricsHurt: bad ? ["expectancy", "profitFactor"] : [],
    fixHint: bad ? (worst.reason === "time" ? "Replace the time-exit with a trailing stop." : worst.reason === "stop" ? `Widen the stop-loss to ${(((ex.stopLossPct || 5) * 1.5)).toFixed(1)}% — stops are firing into reversals.` : `Rework the ${worst.reason} exit.`) : undefined,
    patch, severity: bad ? "high" : "info",
  };
}

/* T9 — Equity-curve trend + residuals → detect edge decay / lumpiness. */
export function testerEquityTrend(run: RunArtifact): TesterResult {
  const eq = run.equity.map(e => Math.log(Math.max(1e-9, e.value)));
  const n = eq.length; if (n < 20) return { id: "T9", title: "Equity trend & decay", finding: "Too few bars for trend analysis.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const xs = eq.map((_, i) => i); const mx = mean(xs), my = mean(eq);
  const slope = sum(xs.map((x, i) => (x - mx) * (eq[i] - my))) / sum(xs.map(x => (x - mx) ** 2));
  const yhat = xs.map(x => my + slope * (x - mx));
  const ssRes = sum(eq.map((y, i) => (y - yhat[i]) ** 2)), ssTot = sum(eq.map(y => (y - my) ** 2));
  const r2 = ssTot ? 1 - ssRes / ssTot : 0;
  // decay: slope of last third vs first third
  const t = Math.floor(n / 3);
  const slopeOf = (a: number[], b: number[]) => { const m1 = mean(a.map((_, i) => i)); const m2 = mean(b); return sum(a.map((x, i) => (i - m1) * (b[i] - m2))) / (sum(a.map((_, i) => (i - m1) ** 2)) || 1); };
  const sFirst = slopeOf(eq.slice(0, t), eq.slice(0, t)), sLast = slopeOf(eq.slice(-t), eq.slice(-t));
  const decaying = sLast < sFirst * 0.4 && sFirst > 0;
  const bad = r2 < 0.85 || decaying;
  return {
    id: "T9", title: "Equity trend & decay", weakness: bad,
    finding: decaying ? `Edge is decaying — recent compounding (${sLast.toExponential(1)}) is far below early (${sFirst.toExponential(1)}).`
      : r2 < 0.85 ? `Equity is lumpy (R²=${r2.toFixed(2)}) — returns come in bursts, not a smooth line.`
        : `Equity compounds smoothly (R²=${r2.toFixed(2)}), no decay detected.`,
    evidence: [{ stat: "log-equity R²", value: r2.toFixed(3) }, { stat: "early slope", value: sFirst.toExponential(1) }, { stat: "late slope", value: sLast.toExponential(1) }],
    metricsHurt: bad ? ["sharpe", "calmar"] : [],
    fixHint: decaying ? "Re-optimize on recent data or add an adaptivity mechanism; the edge may be fading." : undefined,
    severity: decaying ? "high" : bad ? "low" : "info",
  };
}

/* T6 — Monte-Carlo trade-order bootstrap → luck vs skill / sequence risk. */
export function testerMonteCarlo(run: RunArtifact, runs = 1000): TesterResult {
  const r = run.rTrade; if (r.length < 5) return { id: "T6", title: "Monte-Carlo robustness", finding: "Need ≥5 trades.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  let seed = 987654321; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const finals: number[] = [], dds: number[] = [];
  for (let k = 0; k < runs; k++) {
    const sh = [...r]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
    let eq = 1, peak = 1, mdd = 0; for (const x of sh) { eq *= 1 + x; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); }
    finals.push((eq - 1) * 100); dds.push(mdd * 100);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const p = (a: number[], x: number) => a[Math.min(a.length - 1, Math.floor(x * a.length))];   // C8: clamp index (was OOB → NaN)
  const winProb = finals.filter(x => x > 0).length / finals.length;
  const bad = winProb < 0.6;
  return {
    id: "T6", title: "Monte-Carlo robustness", weakness: bad,
    finding: `Across ${runs} reshuffled trade orders, ${pct(winProb)} stay profitable; median return ${p(finals, 0.5).toFixed(1)}%, worst-5% drawdown ${p(dds, 0.05).toFixed(1)}%.`,
    evidence: [{ stat: "P(profit)", value: pct(winProb) }, { stat: "return P5", value: p(finals, 0.05).toFixed(1) + "%" }, { stat: "return P95", value: p(finals, 0.95).toFixed(1) + "%" }, { stat: "DD P95 (worst)", value: p(dds, 0.05).toFixed(1) + "%" }],
    metricsHurt: bad ? ["sharpe"] : [],
    fixHint: bad ? "Result is sequence-sensitive — the headline may be luck. Add trades / diversify before trusting it." : undefined,
    severity: bad ? "high" : "info",
  };
}

/* T2 (core) — Deflated Sharpe: is the Sharpe an artifact of N trials? */
export function testerDeflatedSharpe(run: RunArtifact, nTrials: number): TesterResult {
  const a = run.rBar; const n = a.length;
  if (n < 20) return { id: "T2", title: "Deflated Sharpe (overfit gate)", finding: "Need ≥20 bars.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const s = std(a) || 1e-9; const sr = mean(a) / s;
  const m = mean(a); const g3 = mean(a.map(x => ((x - m) / s) ** 3)); const g4 = mean(a.map(x => ((x - m) / s) ** 4));
  // expected max Sharpe from N trials (Bailey–López de Prado)
  const gamma = 0.5772156649; const N = Math.max(2, nTrials);   // H10: Bailey–LdP needs N≥2 (N=1 makes the deflation term negative → falsely inflates DSR)
  const eMaxSR = Math.sqrt(1 / (n - 1)) * ((1 - gamma) * invNorm(1 - 1 / N) + gamma * invNorm(1 - 1 / (N * Math.E)));
  const denom = Math.sqrt(Math.max(1e-9, 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr));
  const dsr = normCdf(((sr - eMaxSR) * Math.sqrt(n - 1)) / denom);
  const bad = dsr < 0.95;
  return {
    id: "T2", title: "Deflated Sharpe (overfit gate)", weakness: bad,
    finding: bad
      ? `Deflated Sharpe = ${dsr.toFixed(2)} (< 0.95): after correcting for ${N} trial(s) + non-normal returns, the Sharpe is likely a multiple-testing / overfitting artifact.`
      : `Deflated Sharpe = ${dsr.toFixed(2)}: the Sharpe survives correction for trials and non-normality — statistically credible.`,
    evidence: [{ stat: "annualized Sharpe", value: (sr * Math.sqrt(run.meta.A)).toFixed(2) }, { stat: "expected max Sharpe (per-bar)", value: eMaxSR.toFixed(3) }, { stat: "trials", value: N }, { stat: "DSR", value: dsr.toFixed(3) }],
    metricsHurt: bad ? ["sharpe", "probabilisticSharpe"] : [],
    fixHint: bad ? "Reduce parameter search, validate on walk-forward/held-out data before trusting the Sharpe." : undefined,
    severity: bad ? "high" : "info",
  };
}

/* T7 — Capacity / market-impact (square-root law). Re-prices fills at escalating
   AUM; finds the size where impact eats the edge. Exposes toy-size-only edges. */
export function testerCapacity(run: RunArtifact): TesterResult {
  const trades = run.ledger; if (trades.length < 5) return { id: "T7", title: "Capacity / market impact", finding: "Too few trades.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const adv = mean(run.bars.map(b => (b.v || 0) * b.c)) || 1e7;      // avg daily $ volume
  const baseRet = run.metrics.totalReturnPct / 100;
  const capAt = (aum: number) => { let eq = 1; for (const t of trades) { const notional = aum; const impactBps = 1.0 * 0.16 * Math.sqrt(notional / adv); const cost = impactBps; eq *= 1 + (t.netRet - cost); } return (eq - 1); };
  let capacity = 0; for (const aum of [1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8]) { if (capAt(aum) > baseRet * 0.5) capacity = aum; else break; }
  const bad = capacity < 1e6;
  const capStr = capacity < 1e5 ? "< $0.1M" : capacity >= 1e6 ? `$${(capacity / 1e6).toFixed(1)}M` : `$${(capacity / 1e3).toFixed(0)}k`;
  return {
    id: "T7", title: "Capacity / market impact", weakness: bad,
    finding: capacity < 1e5 ? `Very cost-sensitive — square-root market impact halves the edge below $0.1M of capital (avg daily volume $${(adv / 1e6).toFixed(0)}M). This only works at tiny size.` : `Edge holds up to ~${capStr} before square-root market impact halves it (avg daily volume $${(adv / 1e6).toFixed(0)}M).`,
    evidence: [{ stat: "capacity", value: capStr }, { stat: "avg daily $vol", value: `$${(adv / 1e6).toFixed(0)}M` }],
    metricsHurt: bad ? ["expectancy"] : [], fixHint: bad ? "Trade more liquid symbols or reduce frequency — this edge only works at small size." : undefined, severity: bad ? "med" : "info",
  };
}

/* T8b — Optimal stop from the MAE distribution: where marginal stopped-winner
   loss = saved-loser gain. */
export function testerOptimalStop(run: RunArtifact): TesterResult {
  const L = run.ledger; if (L.length < 10) return { id: "T8b", title: "Optimal stop (MAE)", finding: "Too few trades.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const winnerMae = L.filter(t => t.outcome === "win").map(t => Math.abs(t.maeAtr));
  const p75 = winnerMae.length ? [...winnerMae].sort((a, b) => a - b)[Math.floor(winnerMae.length * 0.75)] : 1.5;
  const rec = +Math.max(1.2, p75 * 1.15).toFixed(1);
  const cur = run.spec.exit.atrStopMult;
  const tooTight = cur != null && cur < p75;
  return {
    id: "T8b", title: "Optimal stop (MAE)", weakness: tooTight,
    finding: tooTight ? `75% of winners drew down ${p75.toFixed(1)} ATR before working — a stop tighter than that clips winners. Suggested stop ≈ ${rec}× ATR.` : `Stop placement looks compatible with how far winners retrace (winner MAE p75 = ${p75.toFixed(1)} ATR).`,
    evidence: [{ stat: "winner MAE p75 (ATR)", value: p75.toFixed(2), n: winnerMae.length }, { stat: "suggested ATR stop", value: rec }],
    metricsHurt: tooTight ? ["winRate", "expectancy"] : [], fixHint: tooTight ? `Set the ATR stop to ~${rec}× so normal winner drawdowns don't stop you out.` : undefined,
    patch: tooTight ? { exit: { atrStopMult: rec } } : undefined, severity: tooTight ? "med" : "info",
  };
}

/* T-tail — EVT / historical tail risk (CVaR + a fat-tail flag). */
export function testerTailRisk(run: RunArtifact): TesterResult {
  const a = run.rBar; if (a.length < 20) return { id: "Ttail", title: "Tail risk (CVaR/EVT)", finding: "Too few bars.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const sorted = [...a].sort((x, y) => x - y); const var95 = sorted[Math.floor(0.05 * sorted.length)];
  const tail = sorted.filter(x => x <= var95); const cvar = tail.length ? mean(tail) : var95;
  const m = mean(a), s = std(a) || 1e-9; const kurt = mean(a.map(x => ((x - m) / s) ** 4)) - 3;
  const fat = kurt > 4 || cvar < var95 * 1.6;
  return {
    id: "Ttail", title: "Tail risk (CVaR / EVT)", weakness: fat,
    finding: fat ? `Fat-tailed losses: worst-5% day averages ${(cvar * 100).toFixed(2)}% (CVaR), well beyond the ${(var95 * 100).toFixed(2)}% VaR — excess kurtosis ${kurt.toFixed(1)}. A bad day can be catastrophic.` : `Tail is contained (CVaR ${(cvar * 100).toFixed(2)}%, kurtosis ${kurt.toFixed(1)}).`,
    evidence: [{ stat: "VaR 95", value: (var95 * 100).toFixed(2) + "%" }, { stat: "CVaR 95", value: (cvar * 100).toFixed(2) + "%" }, { stat: "excess kurtosis", value: kurt.toFixed(1) }],
    metricsHurt: fat ? ["maxDrawdown", "cvar95"] : [], fixHint: fat ? "Cap position size / add a volatility filter to blunt the fat left tail." : undefined, severity: fat ? "high" : "info",
  };
}

/* T-serial — serial dependence of trade returns (are wins/losses streaky?). */
export function testerSerialDependence(run: RunArtifact): TesterResult {
  const r = run.rTrade; if (r.length < 12) return { id: "Tserial", title: "Serial dependence", finding: "Too few trades.", weakness: false, evidence: [], metricsHurt: [], severity: "info" };
  const m = mean(r); let num = 0, den = 0; for (let i = 1; i < r.length; i++) num += (r[i] - m) * (r[i - 1] - m); for (let i = 0; i < r.length; i++) den += (r[i] - m) ** 2;
  const ac1 = den ? num / den : 0; const streaky = Math.abs(ac1) > 0.25;
  return {
    id: "Tserial", title: "Serial dependence", weakness: streaky && ac1 > 0,
    finding: streaky ? (ac1 > 0 ? `Trade outcomes are streaky (autocorrelation ${ac1.toFixed(2)}) — wins cluster with wins, losses with losses. Drawdowns will be deeper than the win rate implies.` : `Trade outcomes mean-revert (autocorrelation ${ac1.toFixed(2)}) — a loss tends to follow a win.`) : `Trades are near-independent (autocorrelation ${ac1.toFixed(2)}) — good, the win rate is trustworthy.`,
    evidence: [{ stat: "lag-1 autocorrelation", value: ac1.toFixed(3), n: r.length }],
    metricsHurt: (streaky && ac1 > 0) ? ["maxDrawdown"] : [], fixHint: (streaky && ac1 > 0) ? "Streaky losses deepen drawdowns — a max-consecutive-loss circuit breaker or regime filter helps." : undefined, severity: (streaky && ac1 > 0) ? "med" : "info",
  };
}

/* T-exposure — is capital working, or idle most of the time? */
export function testerExposure(run: RunArtifact): TesterResult {
  const exp = run.metrics.exposurePct; const bad = exp < 35;
  return {
    id: "Texp", title: "Capital exposure", weakness: bad,
    finding: bad ? `Capital is idle ${(100 - exp).toFixed(0)}% of the time (only ${exp}% exposure) — the edge is real but under-deployed; returns per year are capped by inactivity.` : `Capital is deployed a healthy ${exp}% of the time.`,
    evidence: [{ stat: "exposure", value: exp + "%" }],
    metricsHurt: bad ? ["cagr"] : [], fixHint: bad ? "Add a complementary strategy (or more symbols) to fill the idle time — see Portfolio Forge." : undefined, severity: bad ? "low" : "info",
  };
}

export function runLedgerTesters(run: RunArtifact, nTrials = 1): TesterResult[] {
  return [testerRegime(run), testerExitReason(run), testerExcursion(run), testerEquityTrend(run), testerMonteCarlo(run), testerDeflatedSharpe(run, nTrials),
    testerCapacity(run), testerOptimalStop(run), testerTailRisk(run), testerSerialDependence(run), testerExposure(run)];
}

/* ── math helpers ── */
function normCdf(x: number): number { return 0.5 * (1 + erf(x / Math.SQRT2)); }
function erf(x: number): number { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
function invNorm(p: number): number { // Acklam's inverse normal CDF
  if (p <= 0) return -6; if (p >= 1) return 6;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425, ph = 1 - pl; let x;
  if (p < pl) { const qq = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * qq + c[1]) * qq + c[2]) * qq + c[3]) * qq + c[4]) * qq + c[5]) / ((((d[0] * qq + d[1]) * qq + d[2]) * qq + d[3]) * qq + 1); }
  else if (p <= ph) { const qq = p - 0.5, rr = qq * qq; x = (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * qq / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1); }
  else { const qq = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * qq + c[1]) * qq + c[2]) * qq + c[3]) * qq + c[4]) * qq + c[5]) / ((((d[0] * qq + d[1]) * qq + d[2]) * qq + d[3]) * qq + 1); }
  return x;
}
