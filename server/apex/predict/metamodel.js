// APEX Oracle — learned meta-model. A small logistic regression over causal technical features
// that outputs a calibrated P(up) per horizon. Trained walk-forward (train on the past, test on
// the future — no look-ahead) so the ensemble weights are EARNED, not hand-tuned. Pure JS.

const { sigmoid, clamp, mean, std } = require("./mathx");
const fin = (v) => (Number.isFinite(v) ? v : 0);

// ── Causal indicator arrays (value at i depends only on data ≤ i) ──
function emaArr(src, n) { const k = 2 / (n + 1); let p = NaN; const o = []; for (const v of src) { p = Number.isFinite(p) ? v * k + p * (1 - k) : v; o.push(p); } return o; }
function rsiArr(c, n = 14) {
  const o = new Array(c.length).fill(50); let ag = 0, al = 0;
  for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } }
  return o;
}
function rollStd(r, n) { const o = new Array(r.length).fill(0); for (let i = n; i < r.length; i++) o[i] = std(r.slice(i - n, i)); return o; }

// Build the causal feature matrix + labels for a horizon (in bars).
function buildDataset(bars, horizon) {
  const c = bars.map((b) => b.c); const n = c.length;
  const r = []; for (let i = 1; i < n; i++) r.push(c[i - 1] > 0 ? Math.log(c[i] / c[i - 1]) : 0);
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26), e50 = emaArr(c, 50), rsi = rsiArr(c, 14);
  const macd = c.map((_, i) => e12[i] - e26[i]); const macdSig = emaArr(macd, 9);
  const sma20 = emaArr(c, 20); const rs = rollStd(r, 20); const rs60 = rollStd(r, 60);
  const mom = (i, k) => (i - k >= 0 && c[i - k] > 0 ? c[i] / c[i - k] - 1 : 0);
  const X = [], y = [], idx = [];
  const warm = 65;
  for (let i = warm; i + horizon < n; i++) {
    const px = c[i] || 1; const sd = rs[i] || 1e-9;
    const bbW = (rs[i] * 2 * px) || 1;
    X.push([
      (rsi[i] - 50) / 50,                          // RSI
      clamp((macd[i] - macdSig[i]) / (px * 0.01), -3, 3), // MACD hist
      clamp((e12[i] - e50[i]) / px * 100, -5, 5),  // trend (fast vs slow)
      clamp(mom(i, 5) * 20, -3, 3),                // 5-bar momentum
      clamp(mom(i, 20) * 8, -3, 3),                // 20-bar momentum
      clamp(mom(i, 60) * 4, -3, 3),                // 60-bar momentum
      clamp((c[i] - sma20[i]) / bbW, -3, 3),       // %B-ish (distance from mean in bands)
      clamp((rs[i] / (rs60[i] || 1e-9) - 1), -2, 2), // vol regime (short vs long RV)
      clamp((r[i - 1] || 0) / sd, -4, 4),          // last-bar shock
    ]);
    y.push(c[i + horizon] > c[i] ? 1 : 0);
    idx.push(i);
  }
  return { X, y, idx, closes: c };
}

// Standardize features (fit on train), fit logistic regression by gradient descent + L2.
function fitLogistic(X, y, { iters = 400, lr = 0.3, l2 = 0.01 } = {}) {
  const m = X.length, d = X[0].length;
  const mu = new Array(d).fill(0), sg = new Array(d).fill(1);
  for (let j = 0; j < d; j++) { const col = X.map((r) => fin(r[j])); mu[j] = fin(mean(col)); sg[j] = fin(std(col)) || 1; }
  const Z = X.map((r) => r.map((v, j) => (fin(v) - mu[j]) / sg[j]));
  const w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < m; i++) { const p = sigmoid(Z[i].reduce((s, v, j) => s + v * w[j], b)); const e = p - y[i]; for (let j = 0; j < d; j++) gw[j] += e * Z[i][j]; gb += e; }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / m + l2 * w[j]); b -= lr * (gb / m);
  }
  return { w, b, mu, sg };
}
function predictLogistic(model, row) {
  const z = row.map((v, j) => (fin(v) - model.mu[j]) / model.sg[j]);
  const p = clamp(sigmoid(z.reduce((s, v, j) => s + v * model.w[j], model.b)), 0.02, 0.98);
  return Number.isFinite(p) ? p : null;
}

// Walk-forward A/B: fit on the first `trainFrac`, test out-of-sample on the rest. Compare the
// meta-model's directional hit-rate to a trend-following baseline on the SAME test set.
function metaTest(bars, horizon, trainFrac = 0.65) {
  const ds = buildDataset(bars, horizon); const m = ds.X.length;
  if (m < 80) return { ok: false, reason: "insufficient samples", n: m };
  const cut = Math.floor(m * trainFrac);
  const model = fitLogistic(ds.X.slice(0, cut), ds.y.slice(0, cut));
  let metaHit = 0, baseHit = 0, nTest = 0, brier = 0;
  for (let i = cut; i < m; i++) {
    const p = predictLogistic(model, ds.X[i]); const up = ds.y[i];
    metaHit += (p >= 0.5 ? 1 : 0) === up ? 1 : 0;
    // baseline: trend sign (feature #2 = fast-vs-slow trend)
    const baseUp = ds.X[i][2] >= 0 ? 1 : 0; baseHit += baseUp === up ? 1 : 0;
    brier += (p - up) ** 2; nTest++;
  }
  return { ok: true, n: nTest, metaHit: metaHit / nTest, baselineHit: baseHit / nTest, brier: brier / nTest };
}

// Feature vector at the CURRENT (last) bar — mirrors buildDataset's row construction so live and
// training features are identical. Uses only data ≤ end (causal).
function currentFeatures(bars) {
  const c = bars.map((b) => b.c); const n = c.length; if (n < 66) return null;
  const r = []; for (let i = 1; i < n; i++) r.push(c[i - 1] > 0 ? Math.log(c[i] / c[i - 1]) : 0);
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26), e50 = emaArr(c, 50), rsi = rsiArr(c, 14);
  const macd = c.map((_, i) => e12[i] - e26[i]); const macdSig = emaArr(macd, 9);
  const sma20 = emaArr(c, 20); const rs = rollStd(r, 20); const rs60 = rollStd(r, 60);
  const i = n - 1; const px = c[i] || 1; const bbW = (rs[i] * 2 * px) || 1;
  const mom = (k) => (i - k >= 0 && c[i - k] > 0 ? c[i] / c[i - k] - 1 : 0);
  return [
    (rsi[i] - 50) / 50,
    clamp((macd[i] - macdSig[i]) / (px * 0.01), -3, 3),
    clamp((e12[i] - e50[i]) / px * 100, -5, 5),
    clamp(mom(5) * 20, -3, 3), clamp(mom(20) * 8, -3, 3), clamp(mom(60) * 4, -3, 3),
    clamp((c[i] - sma20[i]) / bbW, -3, 3),
    clamp((rs[i] / (rs60[i] || 1e-9) - 1), -2, 2),
    clamp((r[i - 1] || 0) / (rs[i] || 1e-9), -4, 4),
  ];
}

// Train on all available samples for `horizon` bars, then predict P(up) for the current bar.
// Returns null if there isn't enough data to train reliably.
function metaProb(bars, horizon) {
  const ds = buildDataset(bars, horizon); if (ds.X.length < 100) return null;
  const model = fitLogistic(ds.X, ds.y);
  const row = currentFeatures(bars); if (!row) return null;
  return predictLogistic(model, row);
}

module.exports = { buildDataset, fitLogistic, predictLogistic, metaTest, metaProb, currentFeatures, emaArr, rsiArr };
