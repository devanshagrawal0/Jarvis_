/* APEX Backtest — pure analytics derived from the REAL equity + trade series.
   All descriptive statistics; nothing modeled here except where a function name says so. */
import type { EquityPoint, SeriesPoint, MonthlyCell } from "./bt-types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dailyReturns(equity: EquityPoint[]): { t: number; r: number }[] {
  const out: { t: number; r: number }[] = [];
  for (let i = 1; i < equity.length; i++) { const p = equity[i - 1].equity; out.push({ t: equity[i].t, r: p ? equity[i].equity / p - 1 : 0 }); }
  return out;
}
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

/** Rolling annualized Sharpe over a window of bars. */
export function rollingSharpe(equity: EquityPoint[], win = 63, bpy = 252): SeriesPoint[] {
  const rets = dailyReturns(equity); const out: SeriesPoint[] = [];
  for (let i = win; i < rets.length; i++) {
    const w = rets.slice(i - win, i).map((x) => x.r); const s = std(w);
    out.push({ t: rets[i].t, v: s ? (mean(w) / s) * Math.sqrt(bpy) : 0 });
  }
  return out;
}

/** Calendar-year returns (compounded within each year). */
export function annualReturns(equity: EquityPoint[]): { year: number; retPct: number }[] {
  const ends = new Map<number, number>(); let firstByYear = new Map<number, number>();
  for (const p of equity) { const y = new Date(p.t).getUTCFullYear(); if (!firstByYear.has(y)) firstByYear.set(y, p.equity); ends.set(y, p.equity); }
  return [...ends.keys()].sort().map((y) => ({ year: y, retPct: (ends.get(y)! / (firstByYear.get(y) || ends.get(y)!) - 1) * 100 }));
}

/** Histogram of returns + shape stats. */
export function returnHistogram(equity: EquityPoint[], bins = 41): { bins: { x0: number; x1: number; count: number }[]; mean: number; std: number; skew: number; kurt: number } {
  const r = dailyReturns(equity).map((x) => x.r * 100);
  if (r.length < 3) return { bins: [], mean: 0, std: 0, skew: 0, kurt: 0 };
  const lo = Math.min(...r), hi = Math.max(...r), rg = hi - lo || 1;
  const b = Array.from({ length: bins }, (_, i) => ({ x0: lo + (i / bins) * rg, x1: lo + ((i + 1) / bins) * rg, count: 0 }));
  for (const v of r) b[Math.min(bins - 1, Math.floor(((v - lo) / rg) * bins))].count++;
  const m = mean(r), s = std(r) || 1e-9; const n = r.length;
  const skew = r.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / n;
  const kurt = r.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / n - 3;
  return { bins: b, mean: m, std: std(r), skew, kurt };
}

/** Pearson correlation of two daily-return series aligned by timestamp. */
export function correlation(a: EquityPoint[], b: SeriesPoint[]): number {
  const ra = new Map(dailyReturns(a).map((x) => [Math.floor(x.t / 86400000), x.r]));
  const rbArr: { t: number; r: number }[] = [];
  for (let i = 1; i < b.length; i++) { const p = b[i - 1].v; rbArr.push({ t: b[i].t, r: p ? b[i].v / p - 1 : 0 }); }
  const xs: number[] = [], ys: number[] = [];
  for (const rb of rbArr) { const key = Math.floor(rb.t / 86400000); if (ra.has(key)) { xs.push(ra.get(key)!); ys.push(rb.r); } }
  if (xs.length < 3) return 0;
  const mx = mean(xs), my = mean(ys); let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** Historical VaR / CVaR (expected shortfall) at level p, as % of equity. */
export function varCvar(equity: EquityPoint[], p = 0.05): { varPct: number; cvarPct: number } {
  const r = dailyReturns(equity).map((x) => x.r).sort((a, b) => a - b);
  if (r.length < 10) return { varPct: 0, cvarPct: 0 };
  const idx = Math.max(0, Math.floor(p * r.length));
  const tail = r.slice(0, idx + 1);
  return { varPct: r[idx] * 100, cvarPct: (tail.reduce((s, x) => s + x, 0) / tail.length) * 100 };
}

/** Ulcer index (RMS drawdown) + tail ratio (95th / |5th| return). */
export function ulcerIndex(equity: EquityPoint[]): number {
  let peak = -Infinity, sum = 0;
  for (const p of equity) { peak = Math.max(peak, p.equity); const dd = peak ? (p.equity / peak - 1) * 100 : 0; sum += dd * dd; }
  return equity.length ? Math.sqrt(sum / equity.length) : 0;
}
export function tailRatio(equity: EquityPoint[]): number {
  const r = dailyReturns(equity).map((x) => x.r).sort((a, b) => a - b);
  if (r.length < 20) return 0;
  const q = (pp: number) => r[Math.min(r.length - 1, Math.floor(pp * r.length))];
  const lo = Math.abs(q(0.05));
  return lo ? Math.abs(q(0.95)) / lo : 0;
}

/** Average return by calendar month (seasonality). */
export function monthlySeasonality(monthly: MonthlyCell[]): { month: string; avgPct: number; n: number }[] {
  return MONTHS.map((m, mi) => { const cs = monthly.filter((c) => c.month === mi); return { month: m, avgPct: cs.length ? (cs.reduce((s, c) => s + c.ret, 0) / cs.length) * 100 : 0, n: cs.length }; });
}
