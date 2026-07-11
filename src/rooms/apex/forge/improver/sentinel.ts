/* THE FORGE — F2 Overfitting Sentinel. A trust score for a strategy: is the
   backtest real or a mirage? Combines the Deflated Sharpe (corrects for #trials
   + non-normality), Monte-Carlo trade-shuffle robustness, and PARAMETER
   SENSITIVITY (re-backtest with jittered exit params — a robust plateau survives,
   an overfit cliff collapses). Built on the Improver kernel + the backtest oracle. */

import { fetchBars } from "../../apex-data";
import type { Bar } from "../forge-blocks";
import type { BotSpec } from "../forge-spec";
import type { BacktestResult } from "../forge-engine";
import { runBacktest } from "../forge-data";
import { backtest } from "../forge-engine";
import { buildRun } from "./artifact";
import { testerDeflatedSharpe, testerMonteCarlo, type TesterResult } from "./testers";

/* Walk-forward: re-optimize the stop on rolling in-sample windows, trade it on
   the following out-of-sample window, and measure OOS-vs-IS efficiency. Runs on
   the already-fetched bars (synchronous engine), so no extra network. */
function walkForward(spec: BotSpec, symbol: string, bars: Bar[]): { wfe: number; isSharpe: number; oosSharpe: number; windows: number; isWindows: number[]; oosWindows: number[] } {
  // C7: rolling in-sample window (~35%, not 50%) + an EMBARGO gap before the out-of-sample
  // block so a position open across the IS/OOS boundary can't leak (López de Prado).
  const N = bars.length; const L_is = Math.max(60, Math.floor(N * 0.35)), L_oos = Math.max(20, Math.floor(N * 0.15));
  const embargo = Math.max(1, Math.floor(L_oos * 0.1));
  const grid = [3, 5, 7, 9, 12]; const isS: number[] = [], oosS: number[] = [];
  for (let start = 0; start + L_is + embargo + L_oos <= N; start += L_oos) {
    const isBars = bars.slice(start, start + L_is), oosBars = bars.slice(start + L_is + embargo, start + L_is + embargo + L_oos);
    let bestP = grid[0], bestSh = -Infinity;
    for (const p of grid) { const r = backtest({ ...spec, exit: { ...spec.exit, stopLossPct: p } }, symbol, isBars); if (!Number.isNaN(r.metrics.sharpe) && r.metrics.trades >= 2 && r.metrics.sharpe > bestSh) { bestSh = r.metrics.sharpe; bestP = p; } }
    if (bestSh === -Infinity) continue;
    const ro = backtest({ ...spec, exit: { ...spec.exit, stopLossPct: bestP } }, symbol, oosBars);
    isS.push(bestSh); oosS.push(Number.isNaN(ro.metrics.sharpe) ? 0 : ro.metrics.sharpe);
  }
  const im = isS.length ? isS.reduce((s, x) => s + x, 0) / isS.length : 0;
  const om = oosS.length ? oosS.reduce((s, x) => s + x, 0) / oosS.length : 0;
  return { wfe: im > 0 ? +(om / im).toFixed(2) : 0, isSharpe: +im.toFixed(2), oosSharpe: +om.toFixed(2), windows: isS.length, isWindows: isS.map(v => +v.toFixed(2)), oosWindows: oosS.map(v => +v.toFixed(2)) };
}

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };
const toBars = (raw: { t: string | number; o: number; h: number; l: number; c: number; v: number }[]): Bar[] =>
  raw.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

export interface SentinelResult {
  trust: number; grade: string; verdict: string;
  dsr: TesterResult; mc: TesterResult;
  sensitivity: { sharpeStd: number; robust: boolean; samples: number[]; baseSharpe: number };
  wf: { wfe: number; isSharpe: number; oosSharpe: number; windows: number; isWindows: number[]; oosWindows: number[] };
}

export async function runSentinel(spec: BotSpec, result: BacktestResult, trials = 20): Promise<SentinelResult | null> {
  try {
    const sym = spec.universe.symbols[0] || result.symbol || "SPY";
    const raw = await fetchBars(sym, spec.universe.bar, RANGE_FOR[spec.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 30) return null;
    const run = buildRun(spec, result, bars);
    const dsr = testerDeflatedSharpe(run, trials);
    const mc = testerMonteCarlo(run);

    // parameter sensitivity: re-backtest with jittered exit params, watch Sharpe
    const base = result.metrics.sharpe;
    const samples = [base];
    for (const f of [0.8, 0.9, 1.1, 1.25]) {
      const ex = spec.exit;
      const jittered: BotSpec = { ...spec, exit: { ...ex, stopLossPct: ex.stopLossPct ? +(ex.stopLossPct * f).toFixed(2) : ex.stopLossPct, takeProfitPct: ex.takeProfitPct ? +(ex.takeProfitPct * f).toFixed(2) : ex.takeProfitPct, trailingPct: ex.trailingPct ? +(ex.trailingPct * f).toFixed(2) : ex.trailingPct } };
      try { const r = backtest(jittered, sym, bars); if (!Number.isNaN(r.metrics.sharpe)) samples.push(r.metrics.sharpe); } catch { /* skip */ }   // P3/L8: reuse fetched bars (was a network re-fetch per jitter)
    }
    const sharpeStd = +std(samples).toFixed(3);
    const robust = sharpeStd < 0.3;
    const wf = walkForward(spec, sym, bars);

    // trust 0..100 — DSR + walk-forward are the gates, then robustness + MC
    const dsrVal = dsr.evidence.find(e => e.stat === "DSR")?.value; const dsrNum = typeof dsrVal === "string" ? parseFloat(dsrVal) : (dsrVal ?? 0.5);
    const mcProb = parseFloat(String(mc.evidence.find(e => e.stat === "P(profit)")?.value || "50%")) / 100;
    let trust = 0;
    trust += Math.max(0, Math.min(1, dsrNum)) * 38;                  // 0–38: statistical significance
    trust += Math.max(0, Math.min(1, wf.wfe)) * 24;                  // 0–24: out-of-sample efficiency
    trust += Math.max(0, 1 - Math.min(1, sharpeStd / 0.6)) * 22;     // 0–22: parameter robustness
    trust += Math.max(0, Math.min(1, (mcProb - 0.4) / 0.6)) * 16;    // 0–16: sequence robustness
    trust = Math.round(Math.max(0, Math.min(100, trust)));
    const grade = trust >= 80 ? "TRUSTWORTHY" : trust >= 60 ? "PLAUSIBLE" : trust >= 40 ? "SHAKY" : "LIKELY MIRAGE";
    const verdict = trust >= 80 ? "This edge survives correction for trials, parameter jitter, and trade sequencing — credible."
      : trust >= 60 ? "Mostly holds up, but watch the weak dimension below before sizing up."
        : trust >= 40 ? "Fragile — small parameter changes or a reshuffled trade order move the result a lot. Validate on more data."
          : "The backtest is probably not real. Deflated Sharpe and/or sensitivity say this is overfit to history.";

    return { trust, grade, verdict, dsr, mc, sensitivity: { sharpeStd, robust, samples, baseSharpe: base }, wf };
  } catch { return null; }
}
