// APEX native quant — time-series factor operators (Node analogues of Vibe-Trading's
// src/factors/base.py), operating on a single asset's bar series to emit a signal. Cross-sectional
// operators (rank over a universe) are approximated as rolling time-series percentile for the
// single-asset engine. Pure functions over number[] arrays.

const nz = (x, d = 0) => (Number.isFinite(x) ? x : d);
const closes = (bars) => bars.map((b) => nz(b.close));

function delay(s, n) { return s.map((_, i) => (i >= n ? s[i - n] : NaN)); }
function delta(s, n) { return s.map((_, i) => (i >= n ? s[i] - s[i - n] : NaN)); }
function ret(s) { return s.map((v, i) => (i && s[i - 1] ? v / s[i - 1] - 1 : 0)); }

function roll(s, n, fn) {
  return s.map((_, i) => {
    if (i < n - 1) return NaN;
    return fn(s.slice(i - n + 1, i + 1));
  });
}
const sum = (a) => a.reduce((x, y) => x + nz(y), 0);
const avg = (a) => (a.length ? sum(a) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = avg(a); return Math.sqrt(a.reduce((x, y) => x + (nz(y) - m) ** 2, 0) / (a.length - 1)); };

const sma = (s, n) => roll(s, n, avg);
const tsStd = (s, n) => roll(s, n, sd);
const tsMax = (s, n) => roll(s, n, (a) => Math.max(...a.map(nz)));
const tsMin = (s, n) => roll(s, n, (a) => Math.min(...a.map(nz)));
const tsArgMax = (s, n) => roll(s, n, (a) => { let bi = 0, bv = -Infinity; a.forEach((v, i) => { if (nz(v) > bv) { bv = nz(v); bi = i; } }); return bi; });
const tsArgMin = (s, n) => roll(s, n, (a) => { let bi = 0, bv = Infinity; a.forEach((v, i) => { if (nz(v) < bv) { bv = nz(v); bi = i; } }); return bi; });
// ts_rank: percentile rank of the last value within the trailing window (0..1).
const tsRank = (s, n) => roll(s, n, (a) => { const last = nz(a[a.length - 1]); const below = a.filter((v) => nz(v) < last).length; return a.length > 1 ? below / (a.length - 1) : 0.5; });
// zscore over trailing window.
const zscore = (s, n) => s.map((_, i) => { if (i < n - 1) return NaN; const win = s.slice(i - n + 1, i + 1); const m = avg(win), v = sd(win); return v ? (nz(s[i]) - m) / v : 0; });

function ema(s, n) {
  const k = 2 / (n + 1); const out = new Array(s.length).fill(NaN);
  let prev = nz(s[0]);
  for (let i = 0; i < s.length; i++) { prev = i === 0 ? nz(s[0]) : nz(s[i]) * k + prev * (1 - k); out[i] = prev; }
  return out;
}
function rsi(s, n = 14) {
  const out = new Array(s.length).fill(50);
  let gain = 0, loss = 0;
  for (let i = 1; i < s.length; i++) {
    const ch = nz(s[i]) - nz(s[i - 1]);
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; out[i] = 100 - 100 / (1 + gain / (loss || 1e-10)); } }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + gain / (loss || 1e-10)); }
  }
  return out;
}
const signedPower = (s, p) => s.map((v) => (v == null || !Number.isFinite(v) ? NaN : Math.sign(v) * Math.abs(v) ** p));
const clampWeight = (w) => Math.max(-1, Math.min(1, Number.isFinite(w) ? w : 0));
const tanh = (x) => (Number.isFinite(x) ? Math.tanh(x) : 0);

module.exports = { nz, closes, delay, delta, ret, sma, ema, tsStd, tsMax, tsMin, tsArgMax, tsArgMin, tsRank, zscore, rsi, signedPower, clampWeight, tanh, roll, avg, sd };
