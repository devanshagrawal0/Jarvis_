// APEX Oracle — regime detection. Classifies {TREND_UP, TREND_DOWN, MEAN_REVERT, HIGH_VOL}
// from four cheap estimators (EMA slope, Wilder ADX, realized-vol percentile, Hurst) plus a
// 2-state Markov transition matrix. Bars: [{t,o,h,l,c,v}] (hourly). Returns label + confidence.

const { ema, std, logRets, percentileRank, clamp, nz } = require("./mathx");

// Wilder ADX / +DI / -DI (period p). Returns { adx, plusDI, minusDI }.
function adx(bars, p = 14) {
  const n = bars.length; if (n < p + 2) return { adx: NaN, plusDI: NaN, minusDI: NaN };
  let trS = 0, pdmS = 0, ndmS = 0;
  // seed with first p
  for (let i = 1; i <= p; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c, ph = bars[i - 1].h, pl = bars[i - 1].l;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const up = h - ph, dn = pl - l;
    trS += tr; pdmS += (up > dn && up > 0) ? up : 0; ndmS += (dn > up && dn > 0) ? dn : 0;
  }
  let adxPrev = NaN; const dxs = [];
  for (let i = p + 1; i < n; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c, ph = bars[i - 1].h, pl = bars[i - 1].l;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    const up = h - ph, dn = pl - l;
    const pdm = (up > dn && up > 0) ? up : 0, ndm = (dn > up && dn > 0) ? dn : 0;
    trS = trS - trS / p + tr; pdmS = pdmS - pdmS / p + pdm; ndmS = ndmS - ndmS / p + ndm;
    const pDI = 100 * pdmS / (trS || 1e-9), nDI = 100 * ndmS / (trS || 1e-9);
    const dx = 100 * Math.abs(pDI - nDI) / ((pDI + nDI) || 1e-9);
    dxs.push({ dx, pDI, nDI });
  }
  // seed ADX with mean of first p DX, then Wilder-smooth
  if (dxs.length < p) { const last = dxs[dxs.length - 1] || {}; return { adx: NaN, plusDI: last.pDI, minusDI: last.nDI }; }
  adxPrev = dxs.slice(0, p).reduce((s, d) => s + d.dx, 0) / p;
  for (let i = p; i < dxs.length; i++) adxPrev = ((p - 1) * adxPrev + dxs[i].dx) / p;
  const last = dxs[dxs.length - 1];
  return { adx: adxPrev, plusDI: last.pDI, minusDI: last.nDI };
}

// Hurst exponent via rescaled-range (R/S) over several block sizes.
function hurst(rets) {
  const n = rets.length; if (n < 32) return 0.5;
  const sizes = [8, 16, 32, Math.floor(n / 4), Math.floor(n / 2)].filter((t) => t >= 8 && t <= n);
  const xs = [], ys = [];
  for (const T of sizes) {
    const blocks = Math.floor(n / T); if (blocks < 1) continue; let rsSum = 0, cnt = 0;
    for (let b = 0; b < blocks; b++) {
      const seg = rets.slice(b * T, b * T + T);
      const m = seg.reduce((s, x) => s + x, 0) / T; let z = 0, mn = Infinity, mx = -Infinity, ss = 0;
      for (const x of seg) { z += x - m; mn = Math.min(mn, z); mx = Math.max(mx, z); ss += (x - m) ** 2; }
      const R = mx - mn, S = Math.sqrt(ss / T);
      if (S > 1e-12) { rsSum += R / S; cnt++; }
    }
    if (cnt > 0) { xs.push(Math.log(T)); ys.push(Math.log(rsSum / cnt)); }
  }
  if (xs.length < 2) return 0.5;
  // OLS slope of log(R/S) vs log(T)
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let num = 0, den = 0; for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? clamp(num / den, 0.05, 0.95) : 0.5;
}

// 2-state (calm/stormy) Markov transition matrix on |r| with dwell + change probability.
function markov2(rets) {
  if (rets.length < 10) return { pLL: 0.9, pHH: 0.7, dwellLow: 10, dwellHigh: 3, pChange: 0.2, curState: "LOW" };
  const absr = rets.map(Math.abs).sort((a, b) => a - b);
  const theta = absr[Math.floor(absr.length / 2)] * 1.5;
  const states = rets.map((r) => (Math.abs(r) > theta ? 1 : 0));
  let ll = 0, lh = 0, hl = 0, hh = 0;
  for (let i = 1; i < states.length; i++) { const a = states[i - 1], b = states[i]; if (a === 0 && b === 0) ll++; else if (a === 0 && b === 1) lh++; else if (a === 1 && b === 0) hl++; else hh++; }
  const pLL = ll / ((ll + lh) || 1), pHH = hh / ((hl + hh) || 1);
  const cur = states[states.length - 1] === 1 ? "HIGH" : "LOW";
  const pChange = cur === "LOW" ? 1 - pLL : 1 - pHH;
  return { pLL, pHH, dwellLow: 1 / ((1 - pLL) || 1e-6), dwellHigh: 1 / ((1 - pHH) || 1e-6), pChange, curState: cur };
}

function detectRegime(bars) {
  const closes = bars.map((b) => b.c);
  const rets = logRets(closes);
  const blank = { label: "UNKNOWN", confidence: 0, trendScore: 0, revertScore: 0, adx: null, plusDI: null, minusDI: null, hurst: 0.5, volPct: 0.5, markov: null };
  if (bars.length < 30) return blank;
  // 1. EMA slope (fast/slow)
  const eF = ema(closes, 12), eS = ema(closes, 26);
  const k = 10, px = closes[closes.length - 1];
  const slope = (eF[eF.length - 1] - eF[Math.max(0, eF.length - 1 - k)]) / (k * (px || 1));
  const trendSign = Math.sign(eF[eF.length - 1] - eS[eS.length - 1]) || 1;
  // 2. ADX
  const { adx: adxV, plusDI, minusDI } = adx(bars, 14);
  // 3. realized-vol percentile
  const w = 20; const rv = [];
  for (let i = w; i < rets.length; i++) rv.push(std(rets.slice(i - w, i)));
  const rvNow = rv.length ? rv[rv.length - 1] : std(rets.slice(-w));
  const volPct = rv.length > 5 ? percentileRank(rvNow, rv) : 0.5;
  // 4. Hurst
  const H = hurst(rets);
  // 5. Markov
  const mk = markov2(rets);
  // fusion
  const adxN = Number.isFinite(adxV) ? (adxV - 25) / 25 : 0;
  const diSign = Number.isFinite(plusDI) ? Math.sign(plusDI - minusDI) || trendSign : trendSign;
  const trendScore = 0.4 * Math.tanh(slope * 400) + 0.35 * clamp(adxN, -1, 1) * diSign + 0.25 * (H - 0.5) * 2;
  const revertScore = 0.5 * Math.max(0, (20 - nz(adxV)) / 20) + 0.5 * Math.max(0, (0.5 - H) * 2);
  let label, winner, runnerUp;
  if (volPct > 0.82 && Math.abs(trendScore) < 0.25) { label = "HIGH_VOL"; winner = volPct; runnerUp = Math.abs(trendScore); }
  else if (Math.abs(trendScore) >= revertScore) { label = trendScore >= 0 ? "TREND_UP" : "TREND_DOWN"; winner = Math.abs(trendScore); runnerUp = revertScore; }
  else { label = "MEAN_REVERT"; winner = revertScore; runnerUp = Math.abs(trendScore); }
  const confidence = clamp(Math.abs(winner - runnerUp), 0, 1);
  return { label, confidence, trendScore, revertScore, slope, adx: adxV, plusDI, minusDI, hurst: H, volPct, markov: mk, g: clamp(0.5 + trendScore, 0, 1) };
}

module.exports = { detectRegime, adx, hurst, markov2 };
