/* THE FORGE — block registry. Each signal block is a pure, testable function
   that turns bars → a numeric series aligned to the bars. NO LOOK-AHEAD: the
   value at index i uses only bars[0..i]. The registry also carries UI metadata
   (label, param schema) so forms + node editor render generically. */

export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

export interface ParamSpec { key: string; label: string; def: number; min: number; max: number; step: number }
export interface SignalDef {
  type: string; label: string; group: string; desc: string;
  params: ParamSpec[];
  /** produce a series aligned to bars (NaN where warming up). */
  compute: (bars: Bar[], p: Record<string, number>) => number[];
}

const closes = (b: Bar[]) => b.map(x => x.c);

/* ── indicator maths (all causal / no look-ahead) ── */
function sma(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN); let sum = 0;
  for (let i = 0; i < src.length; i++) { sum += src[i]; if (i >= n) sum -= src[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}
function ema(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN); const k = 2 / (n + 1); let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += src[j]; prev = s / n; out[i] = prev; }
    else if (i >= n) { prev = src[i] * k + prev * (1 - k); out[i] = prev; }
  }
  return out;
}
function rsi(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN); let ag = 0, al = 0;
  for (let i = 1; i < src.length; i++) {
    const ch = src[i] - src[i - 1], g = Math.max(0, ch), l = Math.max(0, -ch);
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
  }
  return out;
}
function atr(bars: Bar[], n: number): number[] {
  const out = new Array(bars.length).fill(NaN); const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i].h, l = bars[i].l, pc = i ? bars[i - 1].c : bars[i].c;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = NaN;
  for (let i = 0; i < bars.length; i++) {
    if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += tr[j]; prev = s / n; out[i] = prev; }
    else if (i >= n) { prev = (prev * (n - 1) + tr[i]) / n; out[i] = prev; }
  }
  return out;
}
/* Donchian over the PRIOR n bars (excludes the current bar) so a breakout =
   "price crosses above the prior N-bar high" actually fires (no self-compare). */
function donchian(bars: Bar[], n: number, hi: boolean): number[] {
  const out = new Array(bars.length).fill(NaN);
  for (let i = n; i < bars.length; i++) {
    let v = hi ? -Infinity : Infinity;
    for (let j = i - n; j <= i - 1; j++) v = hi ? Math.max(v, bars[j].h) : Math.min(v, bars[j].l);
    out[i] = v;
  }
  return out;
}
function roc(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN);
  for (let i = n; i < src.length; i++) out[i] = src[i - n] ? ((src[i] - src[i - n]) / src[i - n]) * 100 : NaN;
  return out;
}
function stdev(src: number[], n: number): number[] {
  const m = sma(src, n); const out = new Array(src.length).fill(NaN);
  for (let i = n - 1; i < src.length; i++) { let s = 0; for (let j = i - n + 1; j <= i; j++) s += (src[j] - m[i]) ** 2; out[i] = Math.sqrt(s / n); }
  return out;
}

export const SIGNALS: Record<string, SignalDef> = {
  ema: { type: "ema", label: "EMA", group: "Trend", desc: "Exponential moving average of close.", params: [{ key: "period", label: "Period", def: 20, min: 2, max: 400, step: 1 }], compute: (b, p) => ema(closes(b), p.period) },
  sma: { type: "sma", label: "SMA", group: "Trend", desc: "Simple moving average of close.", params: [{ key: "period", label: "Period", def: 50, min: 2, max: 400, step: 1 }], compute: (b, p) => sma(closes(b), p.period) },
  rsi: { type: "rsi", label: "RSI", group: "Momentum", desc: "Relative Strength Index (0–100).", params: [{ key: "period", label: "Period", def: 14, min: 2, max: 100, step: 1 }], compute: (b, p) => rsi(closes(b), p.period) },
  atr: { type: "atr", label: "ATR", group: "Volatility", desc: "Average True Range (absolute).", params: [{ key: "period", label: "Period", def: 14, min: 2, max: 100, step: 1 }], compute: (b, p) => atr(b, p.period) },
  donchian_hi: { type: "donchian_hi", label: "Donchian High", group: "Breakout", desc: "Highest high over N bars.", params: [{ key: "period", label: "Period", def: 20, min: 2, max: 200, step: 1 }], compute: (b, p) => donchian(b, p.period, true) },
  donchian_lo: { type: "donchian_lo", label: "Donchian Low", group: "Breakout", desc: "Lowest low over N bars.", params: [{ key: "period", label: "Period", def: 20, min: 2, max: 200, step: 1 }], compute: (b, p) => donchian(b, p.period, false) },
  roc: { type: "roc", label: "Momentum (ROC)", group: "Momentum", desc: "Rate of change over N bars (%).", params: [{ key: "period", label: "Period", def: 10, min: 1, max: 200, step: 1 }], compute: (b, p) => roc(closes(b), p.period) },
  boll_up: { type: "boll_up", label: "Bollinger Upper", group: "Volatility", desc: "SMA + k·stdev.", params: [{ key: "period", label: "Period", def: 20, min: 2, max: 200, step: 1 }, { key: "k", label: "Std ×", def: 2, min: 0.5, max: 4, step: 0.1 }], compute: (b, p) => { const c = closes(b), m = sma(c, p.period), sd = stdev(c, p.period); return m.map((v, i) => v + p.k * sd[i]); } },
  boll_dn: { type: "boll_dn", label: "Bollinger Lower", group: "Volatility", desc: "SMA − k·stdev.", params: [{ key: "period", label: "Period", def: 20, min: 2, max: 200, step: 1 }, { key: "k", label: "Std ×", def: 2, min: 0.5, max: 4, step: 0.1 }], compute: (b, p) => { const c = closes(b), m = sma(c, p.period), sd = stdev(c, p.period); return m.map((v, i) => v - p.k * sd[i]); } },
  price: { type: "price", label: "Price (close)", group: "Core", desc: "The close price itself.", params: [], compute: (b) => closes(b) },
};

/* Convenience: compute all signals in a spec once → a map of id → series. */
export function computeSignals(signals: { id: string; type: string; params: Record<string, number | string | boolean> }[], bars: Bar[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const s of signals) {
    const def = SIGNALS[s.type];
    if (!def) { out[s.id] = new Array(bars.length).fill(NaN); continue; }
    const p: Record<string, number> = {};
    for (const ps of def.params) p[ps.key] = Number(s.params[ps.key] ?? ps.def);
    out[s.id] = def.compute(bars, p);
  }
  return out;
}

export const SIGNAL_GROUPS = [...new Set(Object.values(SIGNALS).map(s => s.group))];
