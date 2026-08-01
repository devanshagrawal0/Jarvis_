/* 🌀 REGIME INTELLIGENCE — split real performance by market regime. Regimes come from
   the improver's no-look-ahead classifier (trend × vol); per-regime stats are aggregated
   from the real ledger. Surfaces WHERE the strategy makes and loses money. */
import type { RunArtifact, RegimeId } from "../forge/improver/artifact";
import { REGIME_LABEL, REGIME_COLOR } from "../forge/improver/artifact";

export interface RegimeStat { id: RegimeId; label: string; color: string; barPct: number; trades: number; winRatePct: number; totalPnl: number; avgRetPct: number }
export interface RegimeReport { regimes: RegimeStat[]; ribbon: { t: number; id: RegimeId }[]; best: RegimeStat | null; worst: RegimeStat | null }

const IDS: RegimeId[] = ["calm-bull", "volatile-bull", "grind-bear", "crisis"];

export function perRegimeStats(art: RunArtifact): RegimeReport {
  const nBars = art.regimes.length || 1;
  const regimes: RegimeStat[] = IDS.map((id) => {
    const barCount = art.regimes.filter((r) => r === id).length;
    const trades = art.ledger.filter((t) => t.regimeAtEntry === id);
    const wins = trades.filter((t) => t.outcome === "win").length;
    return {
      id, label: REGIME_LABEL[id], color: REGIME_COLOR[id],
      barPct: (barCount / nBars) * 100,
      trades: trades.length,
      winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
      totalPnl: trades.reduce((s, t) => s + t.pnl, 0),
      avgRetPct: trades.length ? (trades.reduce((s, t) => s + t.netRet, 0) / trades.length) * 100 : 0,
    };
  });
  // ribbon: pair each bar's regime with its equity timestamp (downsample handled in the UI canvas)
  const ribbon = art.equity.map((e, i) => ({ t: e.t, id: art.regimes[i] || "calm-bull" }));
  const traded = regimes.filter((r) => r.trades > 0);
  const best = traded.length ? traded.reduce((a, b) => (b.totalPnl > a.totalPnl ? b : a)) : null;
  const worst = traded.length ? traded.reduce((a, b) => (b.totalPnl < a.totalPnl ? b : a)) : null;
  return { regimes, ribbon, best, worst };
}
