/* THE IMPROVER — client entry. Fetches the strategy's bars (same range the
   backtest used, so the ledger excursions align), builds the Run artifact, and
   runs the diagnostic engine. Returns the full report for the Analysis panel. */

import { fetchBars } from "../../apex-data";
import type { Bar } from "../forge-blocks";
import type { BotSpec } from "../forge-spec";
import type { BacktestResult } from "../forge-engine";
import { buildRun, type RunArtifact } from "./artifact";
import { runImprover, type ImproverReport } from "./engine";

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };

function toBars(raw: { t: string | number; o: number; h: number; l: number; c: number; v: number }[]): Bar[] {
  return raw.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));
}

export interface Analysis { report: ImproverReport; run: RunArtifact }

export async function analyzeStrategy(spec: BotSpec, result: BacktestResult): Promise<Analysis | null> {
  try {
    const sym = spec.universe.symbols[0] || result.symbol || "SPY";
    const raw = await fetchBars(sym, spec.universe.bar, RANGE_FOR[spec.universe.bar] || "2y");
    const bars = toBars(raw);
    if (bars.length < 30) return null;
    const run = buildRun(spec, result, bars);
    // C6: feed a realistic trial count into the Deflated-Sharpe gate. Each tunable knob
    // (signal params, exit thresholds, entry level) is a degree of freedom that was
    // effectively searched; ~6 values per knob is a conservative proxy so the DSR
    // actually deflates for over-parameterized strategies instead of blessing them.
    const dof = spec.signals.reduce((n, s) => n + Object.keys(s.params || {}).length, 0)
      + [spec.exit.stopLossPct, spec.exit.takeProfitPct, spec.exit.trailingPct, spec.exit.timeBars].filter(v => v != null).length + 1;
    const nTrials = Math.max(2, Math.min(200, dof * 6));
    return { report: runImprover(run, { nTrials }), run };
  } catch { return null; }
}

/* F1 — Regime Radar: per-regime performance + the bar-by-bar regime timeline. */
import { REGIME_LABEL, REGIME_COLOR, type RegimeId } from "./artifact";
import { testerRegime } from "./testers";
export interface RegimeCell { regime: RegimeId; label: string; color: string; barShare: number; trades: number; expectancy: number; winRate: number }
export interface RegimeAnalysis { regimes: RegimeId[]; equity: number[]; cells: RegimeCell[]; verdict: string; concentrated: boolean }

export async function analyzeRegimes(spec: BotSpec, result: BacktestResult): Promise<RegimeAnalysis | null> {
  try {
    const sym = spec.universe.symbols[0] || result.symbol || "SPY";
    const raw = await fetchBars(sym, spec.universe.bar, RANGE_FOR[spec.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 30) return null;
    const run = buildRun(spec, result, bars);
    const present = [...new Set(run.regimes)] as RegimeId[];
    const cells: RegimeCell[] = present.map(r => {
      const barShare = run.regimes.filter(x => x === r).length / run.regimes.length;
      const ts = run.ledger.filter(l => l.regimeAtEntry === r);
      const rets = ts.map(t => t.netRet);
      return { regime: r, label: REGIME_LABEL[r], color: REGIME_COLOR[r], barShare, trades: ts.length, expectancy: rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0, winRate: ts.length ? ts.filter(t => t.outcome === "win").length / ts.length : 0 };
    }).sort((a, b) => b.expectancy - a.expectancy);
    const tr = testerRegime(run);
    return { regimes: run.regimes, equity: run.equity.map(e => e.value), cells, verdict: tr.finding, concentrated: tr.weakness };
  } catch { return null; }
}

export type { ImproverReport } from "./engine";
export type { RunArtifact } from "./artifact";
