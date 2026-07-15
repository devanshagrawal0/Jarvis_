// APEX · Live Markets — technical indicators over real OHLCV bars.
// Pure functions, no side effects. All inputs are the shared Bar shape
// ({ t,o,h,l,c,v }); every output is aligned index-for-index with the input
// (leading warm-up values are NaN so the chart can skip them cleanly).

import type { Bar } from "../apex-data";

export type Num = number;
const nz = (v: number | null | undefined): number => (Number.isFinite(v as number) ? (v as number) : NaN);

export const closes = (bars: Bar[]) => bars.map((b) => nz(b.c));
export const highs = (bars: Bar[]) => bars.map((b) => nz(b.h ?? b.c));
export const lows = (bars: Bar[]) => bars.map((b) => nz(b.l ?? b.c));
export const vols = (bars: Bar[]) => bars.map((b) => nz(b.v ?? 0));

export function sma(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN);
  let sum = 0, count = 0;
  const q: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (Number.isFinite(v)) { q.push(v); sum += v; count++; } else { q.push(0); }
    if (q.length > n) { sum -= q.shift() as number; count = Math.min(count, n); }
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(src: number[], n: number): number[] {
  const out = new Array(src.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!Number.isFinite(v)) { out[i] = prev; continue; }
    prev = Number.isFinite(prev) ? v * k + prev * (1 - k) : v;
    out[i] = prev;
  }
  // blank the warm-up region so the line doesn't start from bar 0
  for (let i = 0; i < Math.min(n - 1, out.length); i++) out[i] = NaN;
  return out;
}

// Wilder's RSI(14) over closes.
export function rsi(src: number[], n = 14): number[] {
  const out = new Array(src.length).fill(NaN);
  let avgG = 0, avgL = 0;
  for (let i = 1; i < src.length; i++) {
    const ch = src[i] - src[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { avgG += g; avgL += l; if (i === n) { avgG /= n; avgL /= n; out[i] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL)); } }
    else { avgG = (avgG * (n - 1) + g) / n; avgL = (avgL * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL)); }
  }
  return out;
}

// MACD(12,26,9) → { macd, signal, hist }.
export function macd(src: number[], fast = 12, slow = 26, sig = 9) {
  const ef = ema(src, fast), es = ema(src, slow);
  const line = src.map((_, i) => (Number.isFinite(ef[i]) && Number.isFinite(es[i]) ? ef[i] - es[i] : NaN));
  const signal = ema(line.map((v) => (Number.isFinite(v) ? v : 0)), sig).map((v, i) => (Number.isFinite(line[i]) ? v : NaN));
  const hist = line.map((v, i) => (Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN));
  return { macd: line, signal, hist };
}

// Bollinger Bands(20, 2σ) → { mid, upper, lower }.
export function bollinger(src: number[], n = 20, k = 2) {
  const mid = sma(src, n);
  const upper = new Array(src.length).fill(NaN);
  const lower = new Array(src.length).fill(NaN);
  for (let i = n - 1; i < src.length; i++) {
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (src[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + k * sd; lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

// Session VWAP: resets each calendar day (typical price × volume, cumulative).
export function vwap(bars: Bar[]): number[] {
  const out = new Array(bars.length).fill(NaN);
  let cumPV = 0, cumV = 0, day = "";
  for (let i = 0; i < bars.length; i++) {
    const d = String(bars[i].t).slice(0, 10);
    if (d !== day) { day = d; cumPV = 0; cumV = 0; }
    const tp = (nz(bars[i].h) + nz(bars[i].l) + nz(bars[i].c)) / 3;
    const v = nz(bars[i].v) || 0;
    cumPV += tp * v; cumV += v;
    out[i] = cumV > 0 ? cumPV / cumV : nz(bars[i].c);
  }
  return out;
}

// ATR(14) — average true range, Wilder smoothing.
export function atr(bars: Bar[], n = 14): number[] {
  const out = new Array(bars.length).fill(NaN);
  let prevATR = NaN;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      nz(bars[i].h) - nz(bars[i].l),
      Math.abs(nz(bars[i].h) - nz(bars[i - 1].c)),
      Math.abs(nz(bars[i].l) - nz(bars[i - 1].c)),
    );
    if (i < n) { prevATR = Number.isFinite(prevATR) ? prevATR + tr : tr; if (i === n - 1) { prevATR /= n - 1; out[i] = prevATR; } }
    else { prevATR = (prevATR * (n - 1) + tr) / n; out[i] = prevATR; }
  }
  return out;
}

// Relative volume: today's volume vs the N-day average at each bar.
export function relVol(bars: Bar[], n = 20): number[] {
  const v = vols(bars); const avg = sma(v, n);
  return v.map((x, i) => (Number.isFinite(avg[i]) && avg[i] > 0 ? x / avg[i] : NaN));
}

// ── Backplay strategies: each returns a target position per bar (+1 long, -1 short, 0 flat).
// These power the "strategy replay" overlay — deterministic, computed from the same real bars.
export type StrategyId = "sma_cross" | "rsi_revert" | "macd_trend" | "breakout" | "bollinger" | "ema_stack";
export interface StrategyDef { id: StrategyId; name: string; desc: string; signal: (bars: Bar[]) => number[] }

export const STRATEGIES: StrategyDef[] = [
  {
    id: "sma_cross", name: "SMA Cross 10/30", desc: "Long when SMA-10 > SMA-30, short below.",
    signal: (bars) => { const c = closes(bars); const f = sma(c, 10), s = sma(c, 30); return c.map((_, i) => (!Number.isFinite(f[i]) || !Number.isFinite(s[i]) ? 0 : f[i] > s[i] ? 1 : -1)); },
  },
  {
    id: "ema_stack", name: "EMA Stack 20/50/200", desc: "Long when price>EMA20>EMA50>EMA200 (full trend stack).",
    signal: (bars) => { const c = closes(bars); const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200); return c.map((px, i) => { if (!Number.isFinite(e50[i])) return 0; const up = px > e20[i] && e20[i] > e50[i] && (!Number.isFinite(e200[i]) || e50[i] > e200[i]); const dn = px < e20[i] && e20[i] < e50[i]; return up ? 1 : dn ? -1 : 0; }); },
  },
  {
    id: "rsi_revert", name: "RSI Reversion", desc: "Long RSI<30, exit >55; short RSI>70, cover <45.",
    signal: (bars) => { const r = rsi(closes(bars), 14); let pos = 0; return r.map((v) => { if (!Number.isFinite(v)) return 0; if (pos <= 0 && v < 30) pos = 1; else if (pos >= 0 && v > 70) pos = -1; else if (pos === 1 && v > 55) pos = 0; else if (pos === -1 && v < 45) pos = 0; return pos; }); },
  },
  {
    id: "macd_trend", name: "MACD Trend", desc: "Long when MACD line above signal, short below.",
    signal: (bars) => { const m = macd(closes(bars)); return m.macd.map((v, i) => (!Number.isFinite(v) || !Number.isFinite(m.signal[i]) ? 0 : v > m.signal[i] ? 1 : -1)); },
  },
  {
    id: "breakout", name: "Donchian Breakout 20", desc: "Long on close above 20-bar high, short below 20-bar low.",
    signal: (bars) => { const c = closes(bars), h = highs(bars), l = lows(bars); let pos = 0; return c.map((px, i) => { if (i < 20) return 0; let hh = -Infinity, ll = Infinity; for (let j = i - 20; j < i; j++) { hh = Math.max(hh, h[j]); ll = Math.min(ll, l[j]); } if (px > hh) pos = 1; else if (px < ll) pos = -1; return pos; }); },
  },
  {
    id: "bollinger", name: "Bollinger Reversion", desc: "Long below lower band, short above upper band.",
    signal: (bars) => { const c = closes(bars); const bb = bollinger(c, 20, 2); let pos = 0; return c.map((px, i) => { if (!Number.isFinite(bb.mid[i])) return 0; if (px < bb.lower[i]) pos = 1; else if (px > bb.upper[i]) pos = -1; else if (pos === 1 && px >= bb.mid[i]) pos = 0; else if (pos === -1 && px <= bb.mid[i]) pos = 0; return pos; }); },
  },
];

export function getStrategy(id: StrategyId): StrategyDef { return STRATEGIES.find((s) => s.id === id) || STRATEGIES[0]; }

// Run a strategy over bars → per-bar equity, trade markers, and summary stats.
export interface ReplayTrade { i: number; time: number; side: "buy" | "sell"; price: number; kind: "entry" | "exit"; pnlPct?: number }
export interface ReplayResult {
  equity: number[]; // growth-of-1 series aligned to bars
  positions: number[]; // target position per bar
  trades: ReplayTrade[];
  stats: { totalReturn: number; trades: number; winRate: number | null; maxDD: number; sharpe: number; exposure: number };
}

export function runReplay(bars: Bar[], signal: number[], commission = 0.0005): ReplayResult {
  const c = closes(bars);
  const eq = new Array(bars.length).fill(1);
  const positions = signal.slice();
  const trades: ReplayTrade[] = [];
  let equity = 1, prevPos = 0, exposedBars = 0;
  const wins: number[] = []; let entryPrice = 0, entrySide: "buy" | "sell" = "buy";
  const times = bars.map((b) => Math.floor(new Date(b.t).getTime() / 1000));
  for (let i = 1; i < bars.length; i++) {
    const pos = Number.isFinite(signal[i - 1]) ? signal[i - 1] : 0; // act on prior bar's signal (no look-ahead)
    const r = c[i - 1] ? (c[i] - c[i - 1]) / c[i - 1] : 0;
    const turnover = Math.abs(pos - prevPos);
    const barRet = pos * r - turnover * commission;
    equity *= 1 + barRet;
    eq[i] = equity;
    if (Math.abs(pos) > 0) exposedBars++;
    if (pos !== prevPos) {
      // close previous
      if (prevPos !== 0) { const pnl = entrySide === "buy" ? (c[i] - entryPrice) / entryPrice : (entryPrice - c[i]) / entryPrice; wins.push(pnl); trades.push({ i, time: times[i], side: prevPos > 0 ? "sell" : "buy", price: c[i], kind: "exit", pnlPct: pnl * 100 }); }
      // open new
      if (pos !== 0) { entryPrice = c[i]; entrySide = pos > 0 ? "buy" : "sell"; trades.push({ i, time: times[i], side: pos > 0 ? "buy" : "sell", price: c[i], kind: "entry" }); }
      prevPos = pos;
    }
  }
  // stats
  const rets: number[] = [];
  for (let i = 1; i < eq.length; i++) if (eq[i - 1] > 0) rets.push(eq[i] / eq[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1);
  const sd = Math.sqrt(variance);
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  let peak = -Infinity, maxDD = 0;
  for (const v of eq) { peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); }
  const closed = wins.length;
  const winRate = closed > 0 ? (wins.filter((w) => w > 0).length / closed) * 100 : null;
  return {
    equity: eq, positions, trades,
    stats: { totalReturn: (equity - 1) * 100, trades: closed, winRate, maxDD: maxDD * 100, sharpe, exposure: (exposedBars / (bars.length || 1)) * 100 },
  };
}
