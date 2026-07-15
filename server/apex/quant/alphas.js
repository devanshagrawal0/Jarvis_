// APEX native quant — the alpha library. A runnable starter catalog: classic signals + Alpha101-
// flavored factors ported from HKUDS/Vibe-Trading's factor zoo (single-asset adaptation). Each alpha
// exposes meta + compute(bars) → target weight per bar (-1..1). This backs /api/apex/engine/alphas.

const F = require("./factors");

const closes = (bars) => bars.map((b) => F.nz(b.close));
const lows = (bars) => bars.map((b) => F.nz(b.low ?? b.close));
const highs = (bars) => bars.map((b) => F.nz(b.high ?? b.close));
const vols = (bars) => bars.map((b) => F.nz(b.volume ?? 0));
const w = (v) => F.clampWeight(v);

const ALPHAS = [
  {
    id: "mom_20", nickname: "20-day Momentum", theme: ["trend", "momentum"],
    formula: "tanh(zscore(20d return, 60))", source: "classic time-series momentum",
    compute: (bars) => { const c = closes(bars); const r20 = F.delta(c, 20).map((d, i) => (c[i] ? d / c[i] : 0)); const z = F.zscore(r20, 60); return z.map((x) => w(F.tanh(x))); },
  },
  {
    id: "meanrev_5", nickname: "5-day Mean Reversion", theme: ["reversal"],
    formula: "-tanh(zscore(close, 5))", source: "classic short-horizon reversal",
    compute: (bars) => F.zscore(closes(bars), 5).map((x) => w(-F.tanh(x))),
  },
  {
    id: "ma_cross_10_30", nickname: "MA Cross 10/30", theme: ["trend"],
    formula: "sign(ema10 - ema30)", source: "moving-average crossover",
    compute: (bars) => { const c = closes(bars); const f = F.ema(c, 10), s = F.ema(c, 30); return c.map((_, i) => w(Math.sign(F.nz(f[i]) - F.nz(s[i])))); },
  },
  {
    id: "breakout_20", nickname: "Donchian Breakout 20", theme: ["trend", "breakout"],
    formula: "+1 above 20d high, -1 below 20d low", source: "channel breakout",
    compute: (bars) => { const c = closes(bars); const hi = F.delay(F.tsMax(highs(bars), 20), 1); const lo = F.delay(F.tsMin(lows(bars), 20), 1); return c.map((px, i) => (Number.isFinite(hi[i]) && px > hi[i] ? 1 : Number.isFinite(lo[i]) && px < lo[i] ? -1 : 0)); },
  },
  {
    id: "rsi_revert_14", nickname: "RSI Reversion", theme: ["reversal", "oscillator"],
    formula: "long RSI<30, short RSI>70", source: "Wilder RSI(14)",
    compute: (bars) => F.rsi(closes(bars), 14).map((v) => (v < 30 ? 1 : v > 70 ? -1 : 0)),
  },
  {
    id: "macd_trend", nickname: "MACD Trend", theme: ["trend", "momentum"],
    formula: "sign(MACD - signal)", source: "MACD(12,26,9)",
    compute: (bars) => { const c = closes(bars); const macd = F.ema(c, 12).map((v, i) => F.nz(v) - F.nz(F.ema(c, 26)[i])); const sig = F.ema(macd, 9); return c.map((_, i) => w(F.tanh((F.nz(macd[i]) - F.nz(sig[i])) / (Math.abs(F.nz(sig[i])) + 1e-6)))); },
  },
  {
    id: "bollinger_revert", nickname: "Bollinger Reversion", theme: ["reversal", "volatility"],
    formula: "-zscore(close, 20) clamped", source: "Bollinger bands mean-revert",
    compute: (bars) => F.zscore(closes(bars), 20).map((z) => w(-z / 2)),
  },
  {
    id: "vol_scaled_mom", nickname: "Vol-Scaled Momentum", theme: ["trend", "risk"],
    formula: "mom(20) / rolling_vol(20)", source: "risk-adjusted momentum",
    compute: (bars) => { const c = closes(bars); const r = F.ret(c); const mom = F.delta(c, 20).map((d, i) => (c[i] ? d / c[i] : 0)); const vol = F.tsStd(r, 20); return mom.map((m, i) => w(F.tanh(m / (F.nz(vol[i]) + 1e-4) / 8))); },
  },
  {
    id: "alpha101_001", nickname: "Kakushadze Alpha #1", theme: ["reversal", "volatility"],
    formula: "rank(ts_argmax(SignedPower((ret<0)?std(ret,20):close, 2), 5)) - 0.5", source: "Kakushadze (2015) arXiv:1601.00991 eq.1 — single-asset ts adaptation",
    compute: (bars) => { const c = closes(bars); const r = F.ret(c); const stdr = F.tsStd(r, 20); const x = c.map((cl, i) => (r[i] < 0 ? F.nz(stdr[i]) : cl)); const sp = F.signedPower(x, 2); const am = F.tsArgMax(sp, 5); const rk = F.tsRank(am, 60); return rk.map((v) => w((F.nz(v, 0.5) - 0.5) * 2)); },
  },
  {
    id: "alpha101_004", nickname: "Kakushadze Alpha #4", theme: ["reversal"],
    formula: "-1 * Ts_Rank(rank(low), 9)", source: "Kakushadze (2015) eq.4 — single-asset ts adaptation",
    compute: (bars) => F.tsRank(lows(bars), 9).map((v) => w(-(F.nz(v, 0.5) - 0.5) * 2)),
  },
  {
    id: "alpha101_012", nickname: "Kakushadze Alpha #12", theme: ["reversal", "volume"],
    formula: "sign(delta(volume,1)) * (-1 * delta(close,1))", source: "Kakushadze (2015) eq.12",
    compute: (bars) => { const c = closes(bars); const v = vols(bars); const dv = F.delta(v, 1); const dc = F.delta(c, 1); return c.map((cl, i) => w(F.tanh(Math.sign(F.nz(dv[i])) * (-F.nz(dc[i]) / (cl || 1)) * 50))); },
  },
  {
    id: "dual_momentum", nickname: "Dual Momentum", theme: ["trend"],
    formula: "long if 60d & 120d returns > 0", source: "absolute momentum",
    compute: (bars) => { const c = closes(bars); const r60 = F.delta(c, 60), r120 = F.delta(c, 120); return c.map((_, i) => (F.nz(r60[i]) > 0 && F.nz(r120[i]) > 0 ? 1 : F.nz(r60[i]) < 0 && F.nz(r120[i]) < 0 ? -1 : 0)); },
  },
];

const byId = Object.fromEntries(ALPHAS.map((a) => [a.id, a]));
function listAlphas() { return ALPHAS.map(({ id, nickname, theme, formula, source }) => ({ id, nickname, theme, formula, source })); }
function getAlpha(id) { return byId[id] || null; }

module.exports = { ALPHAS, listAlphas, getAlpha };
