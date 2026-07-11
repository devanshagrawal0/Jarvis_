/* THE IMPROVER — K0 substrate: the canonical Run artifact + per-trade Ledger.
   Normalizes a BacktestResult + bars into the single object every metric,
   tester, and record reads from (spec §2). Computes excursions (MAE/MFE/eff),
   regime tags, and taxonomy flags per trade — all ATR-normalized, long-only
   (the engine is long-only). Pure, dependency-free. */

import type { Bar } from "../forge-blocks";
import type { BacktestResult, Trade } from "../forge-engine";
import type { BotSpec } from "../forge-spec";

/* A concrete, mechanically-applicable mutation of a BotSpec (exit/sizing/risk
   tweaks). Cards carrying one can be one-click applied + re-backtested. */
export interface SpecPatch { exit?: Partial<BotSpec["exit"]>; sizing?: Partial<BotSpec["sizing"]>; risk?: Partial<BotSpec["risk"]> }

export type RegimeId = "calm-bull" | "volatile-bull" | "grind-bear" | "crisis";
export const REGIME_LABEL: Record<RegimeId, string> = { "calm-bull": "Calm Bull", "volatile-bull": "Volatile Bull", "grind-bear": "Grind / Bear", "crisis": "Crisis" };
export const REGIME_COLOR: Record<RegimeId, string> = { "calm-bull": "#4dffb0", "volatile-bull": "#eaf6ff", "grind-bear": "#c3d4e6", "crisis": "#ff7285" };

export interface TradeRecord {
  id: string; side: "long"; entryT: number; exitT: number; entryBarIdx: number; exitBarIdx: number;
  entryPx: number; exitPx: number; barsHeld: number; netRet: number; pnl: number; outcome: "win" | "loss" | "scratch";
  atr: number;                 // ATR(14) at entry, the excursion unit
  mae: number; mfe: number;    // % adverse / favorable excursion (mae ≤ 0, mfe ≥ 0)
  maeAtr: number; mfeAtr: number; tMFE: number; ttfe: number;
  entryEff: number; exitEff: number; wastedProfit: number;  // 0..1, 0..1, % of MFE left on table
  regimeAtEntry: RegimeId; exitReason: string;
  flags: string[];             // trade-failure taxonomy hits (§6)
  narrative: string;
}

export interface RunArtifact {
  meta: { symbol: string; bar: string; barCount: number; A: number };
  bars: Bar[];
  equity: { t: number; value: number; drawdown: number }[];
  rBar: number[];              // per-bar strategy returns
  rTrade: number[];            // per-trade net returns (fractions)
  regimes: RegimeId[];         // per-bar regime
  ledger: TradeRecord[];
  metrics: BacktestResult["metrics"];
  spec: BotSpec;
}

const A_FOR: Record<string, number> = { "1d": 252, "1h": 252 * 7, "15m": 252 * 26 };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function sma(vals: number[], p: number, i: number): number {
  if (i < p - 1) return NaN; let s = 0; for (let k = i - p + 1; k <= i; k++) s += vals[k]; return s / p;
}
/* Wilder ATR series. */
function atrSeries(bars: Bar[], p = 14): number[] {
  const tr: number[] = [], out: number[] = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = i ? bars[i - 1].c : bars[i].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let acc = 0;
  for (let i = 0; i < bars.length; i++) { if (i < p) { acc += tr[i]; if (i === p - 1) out[i] = acc / p; } else out[i] = (out[i - 1] * (p - 1) + tr[i]) / p; }
  return out;
}

/* Per-bar regime = trend (close vs SMA100) × vol (20-bar realized vol vs its median). */
export function classifyRegimes(bars: Bar[]): RegimeId[] {
  const close = bars.map(b => b.c);
  const ret: number[] = bars.map((b, i) => (i ? Math.log(b.c / bars[i - 1].c) : 0));
  const rv: number[] = bars.map((_, i) => { if (i < 20) return NaN; const w = ret.slice(i - 19, i + 1); const m = mean(w); return Math.sqrt(mean(w.map(x => (x - m) ** 2))); });
  // M6: expanding median (no look-ahead) — bar i is classified using only vol seen up to i,
  // not a median that peeks at the whole (future-inclusive) sample.
  const seen: number[] = [];
  return bars.map((b, i) => {
    if (Number.isFinite(rv[i])) seen.push(rv[i]);
    const rvMed = seen.length ? median(seen) : NaN;
    const ma = sma(close, 100, i);
    // M5: during warmup (SMA100 not defined yet) use a short-horizon trend proxy instead of defaulting bearish.
    const up = Number.isFinite(ma) ? b.c > (ma as number) : (i > 0 ? b.c > close[Math.max(0, i - 20)] : true);
    const hi = Number.isFinite(rvMed) ? (rv[i] || (rvMed as number)) > (rvMed as number) : false;
    if (up) return hi ? "volatile-bull" : "calm-bull";
    return hi ? "crisis" : "grind-bear";
  });
}

/* Map a timestamp to the nearest bar index (bars ascending by t). */
function idxAt(bars: Bar[], t: number): number {
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

/* Detect trade-failure taxonomy flags from the excursion + context of one trade. */
function detectFlags(tr: Omit<TradeRecord, "flags" | "narrative">, fwd: Bar[]): string[] {
  const f: string[] = [];
  if (tr.exitReason === "stop") {
    // stopped-then-reversed: price returns above entry within 3 bars after exit
    if (fwd.slice(0, 3).some(b => b.h >= tr.entryPx)) f.push("stopped-then-reversed");
  }
  if (tr.exitReason === "time" && tr.netRet > 0) f.push("timed-out-in-profit");
  if (tr.exitReason === "target" && tr.exitEff < 0.5) f.push("exit-too-tight");
  if (tr.netRet > 0 && tr.wastedProfit > 0.4) f.push("exit-too-loose");
  if (tr.maeAtr < -0.75 && tr.netRet > 0) f.push("entered-too-early");
  if (tr.outcome === "loss" && tr.barsHeld > 0 && tr.maeAtr < -1.5) f.push("held-a-loser");
  return f;
}

export function buildRun(spec: BotSpec, result: BacktestResult, bars: Bar[]): RunArtifact {
  const A = A_FOR[spec.universe.bar] || 252;
  const atr = atrSeries(bars, 14);
  const regimes = classifyRegimes(bars);
  const equity = result.equity.map(e => ({ t: e.t, value: e.equity, drawdown: e.drawdown }));
  const rBar: number[] = equity.map((e, i) => (i && equity[i - 1].value ? e.value / equity[i - 1].value - 1 : 0)).slice(1);

  const ledger: TradeRecord[] = (result.trades || []).map((t: Trade, k) => {
    const ei = idxAt(bars, t.entryT), xi = Math.max(ei, idxAt(bars, t.exitT));
    const seg = bars.slice(ei, xi + 1);
    const hi = seg.length ? Math.max(...seg.map(b => b.h)) : t.exitPx;
    const lo = seg.length ? Math.min(...seg.map(b => b.l)) : t.exitPx;
    const mfe = (hi - t.entryPx) / t.entryPx, mae = (lo - t.entryPx) / t.entryPx;
    const a = atr[ei] || (t.entryPx * 0.02);
    const tMFEidx = seg.length ? ei + seg.reduce((bi, b, j) => (b.h > seg[bi - ei]?.h ? j + ei : bi), ei) - ei : ei;
    const netRet = t.retPct / 100;
    const exitEff = mfe > 0 ? Math.max(0, Math.min(1, netRet / mfe)) : 0;
    const entryEff = (mfe - mae) > 0 ? Math.max(0, Math.min(1, mfe / (mfe - mae))) : 0.5;
    const base: Omit<TradeRecord, "flags" | "narrative"> = {
      id: `t${k}`, side: "long", entryT: t.entryT, exitT: t.exitT, entryBarIdx: ei, exitBarIdx: xi,
      entryPx: t.entryPx, exitPx: t.exitPx, barsHeld: t.bars, netRet, pnl: t.pnl,
      outcome: netRet > 0.0005 ? "win" : netRet < -0.0005 ? "loss" : "scratch",
      atr: a, mae, mfe, maeAtr: (mae * t.entryPx) / a, mfeAtr: (mfe * t.entryPx) / a,
      tMFE: tMFEidx, ttfe: Math.max(0, tMFEidx - ei), entryEff, exitEff, wastedProfit: mfe > 0 ? Math.max(0, (mfe - netRet) / mfe) : 0,
      regimeAtEntry: regimes[ei] || "calm-bull", exitReason: t.reason,
    };
    const flags = detectFlags(base, bars.slice(xi + 1, xi + 4));
    const narrative = `${base.outcome.toUpperCase()} ${(netRet * 100).toFixed(1)}% over ${t.bars} bars in ${REGIME_LABEL[base.regimeAtEntry]}; drew ${base.maeAtr.toFixed(1)} ATR, ran ${base.mfeAtr.toFixed(1)} ATR, captured ${(exitEff * 100).toFixed(0)}% of the move; exit=${t.reason}.`;
    return { ...base, flags, narrative };
  });

  return { meta: { symbol: result.symbol, bar: spec.universe.bar, barCount: bars.length, A }, bars, equity, rBar, rTrade: ledger.map(l => l.netRet), regimes, ledger, metrics: result.metrics, spec };
}
