// APEX Oracle — Quant Brain v2 primitives (pure JS, no deps). Closed-form / O(n) where possible.
// Everything here is NEW relative to regime.js/forecast.js/phd.js and is unit-testable in isolation.
// Sources (see scratchpad/research_quant_advanced.md): Yang-Zhang 2000, Corsi HAR, Adams-MacKay BOCPD,
// split-conformal + ACI (Gibbs-Candes), Hedge/exp-weights (Cesa-Bianchi-Lugosi), DFA (Peng),
// Kaufman ER, Amihud 2002, Roll 1984, Corwin-Schmidt 2012, Schreiber transfer entropy.

const { mean, std, clamp, logRets, nz } = require("./mathx");

// ----------------------------------------------------------------------------
// tiny linear algebra (OLS via normal equations; symmetric eigen via Jacobi)
// ----------------------------------------------------------------------------
function solveLinear(A, b) {
  // Gaussian elimination with partial pivoting. A: n×n (row-major arrays), b: n. Returns x or null.
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);   // matrix is now diagonal: x_i = b_i / A_ii
}

// Ordinary least squares. X: rows of features (each row length p, include intercept col yourself), y: n.
// Ridge lambda>0 stabilizes. Returns beta (length p) or null.
function ols(X, y, lambda = 1e-8) {
  const n = X.length; if (!n) return null;
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += xi[a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += xi[a] * xi[b];
    }
  }
  for (let a = 0; a < p; a++) XtX[a][a] += lambda;
  return solveLinear(XtX, Xty);
}

// Jacobi eigenvalue algorithm for a small symmetric matrix. Returns {values[], vectors[][]} (cols = vectors).
function jacobiEigen(Ain, iters = 100) {
  const n = Ain.length;
  const A = Ain.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < iters; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = A.map((r, i) => r[i]);
  return { values, vectors: V };
}

// ----------------------------------------------------------------------------
// A9 — range-based realized-vol estimators (Yang-Zhang & friends). bars: {o,h,l,c}
// Returns PER-BAR daily variance (not annualized); caller scales.
// ----------------------------------------------------------------------------
function rangeVol(bars, window = 20) {
  const b = bars.filter((x) => x && x.h > 0 && x.l > 0 && x.o > 0 && x.c > 0);
  if (b.length < 5) return null;
  const w = Math.min(window, b.length - 1);
  const slice = b.slice(-w - 1);
  // Rogers-Satchell (drift independent)
  let rsSum = 0, gkSum = 0, parkSum = 0;
  for (let i = 1; i < slice.length; i++) {
    const { o, h, l, c } = slice[i];
    const ho = Math.log(h / o), lo = Math.log(l / o), co = Math.log(c / o), hl = Math.log(h / l);
    rsSum += ho * (ho - co) + lo * (lo - co);
    gkSum += 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
    parkSum += (hl * hl) / (4 * Math.log(2));
  }
  const m = slice.length - 1;
  const rs = rsSum / m, gk = gkSum / m, park = parkSum / m;
  // Yang-Zhang: overnight + k*open-close + (1-k)*RS
  const oRet = [], cRet = [];
  for (let i = 1; i < slice.length; i++) {
    oRet.push(Math.log(slice[i].o / slice[i - 1].c));   // overnight
    cRet.push(Math.log(slice[i].c / slice[i].o));        // open->close
  }
  const varOpen = variance(oRet), varClose = variance(cRet);
  const k = 0.34 / (1.34 + (m + 1) / (m - 1));
  const yz = varOpen + k * varClose + (1 - k) * rs;
  return { yz: Math.max(yz, 1e-8), rs: Math.max(rs, 1e-8), gk: Math.max(gk, 1e-8), parkinson: Math.max(park, 1e-8), yzVolDaily: Math.sqrt(Math.max(yz, 1e-8)) };
}
function variance(a) { if (a.length < 2) return 0; const m = mean(a); let s = 0; for (const x of a) s += (x - m) ** 2; return s / (a.length - 1); }

// ----------------------------------------------------------------------------
// A10 — DFA-Hurst, Kaufman efficiency ratio, Katz fractal dimension (trend character)
// ----------------------------------------------------------------------------
function dfaHurst(rets) {
  if (rets.length < 32) return { hurst: 0.5, n: rets.length };
  const x = rets.slice();
  const mu = mean(x);
  const prof = []; let acc = 0;
  for (const v of x) { acc += v - mu; prof.push(acc); }
  const N = prof.length;
  const scales = [];
  for (let s = 4; s <= Math.floor(N / 4); s = Math.ceil(s * 1.5)) scales.push(s);
  const logS = [], logF = [];
  for (const s of scales) {
    const nSeg = Math.floor(N / s);
    if (nSeg < 1) continue;
    let f2 = 0;
    for (let v = 0; v < nSeg; v++) {
      const seg = prof.slice(v * s, v * s + s);
      // linear detrend
      const tt = seg.map((_, i) => i);
      const sm = mean(tt), ym = mean(seg);
      let num = 0, den = 0;
      for (let i = 0; i < s; i++) { num += (tt[i] - sm) * (seg[i] - ym); den += (tt[i] - sm) ** 2; }
      const slope = den ? num / den : 0, inter = ym - slope * sm;
      let rms = 0; for (let i = 0; i < s; i++) { const d = seg[i] - (slope * tt[i] + inter); rms += d * d; }
      f2 += rms / s;
    }
    const F = Math.sqrt(f2 / nSeg);
    if (F > 0) { logS.push(Math.log(s)); logF.push(Math.log(F)); }
  }
  if (logS.length < 3) return { hurst: 0.5, n: rets.length };
  // slope of logF vs logS = Hurst
  const sm = mean(logS), ym = mean(logF); let num = 0, den = 0;
  for (let i = 0; i < logS.length; i++) { num += (logS[i] - sm) * (logF[i] - ym); den += (logS[i] - sm) ** 2; }
  const H = den ? num / den : 0.5;
  return { hurst: clamp(H, 0, 1), n: rets.length };
}
// Kaufman efficiency ratio over last n prices: |net move| / sum|steps|
function kaufmanER(prices, n = 20) {
  if (prices.length < n + 1) n = prices.length - 1;
  if (n < 2) return 0;
  const p = prices.slice(-n - 1);
  const net = Math.abs(p[p.length - 1] - p[0]);
  let vol = 0; for (let i = 1; i < p.length; i++) vol += Math.abs(p[i] - p[i - 1]);
  return vol > 0 ? clamp(net / vol, 0, 1) : 0;
}
// Katz fractal dimension of a price curve (higher = choppier)
function katzFD(prices) {
  const n = prices.length; if (n < 3) return 1;
  let L = 0, d = 0;
  for (let i = 1; i < n; i++) { L += Math.abs(prices[i] - prices[i - 1]); d = Math.max(d, Math.abs(prices[i] - prices[0])); }
  if (L <= 0 || d <= 0) return 1;
  const lnN = Math.log(n - 1);
  return lnN / (lnN + Math.log(d / L));
}

// ----------------------------------------------------------------------------
// A14 — liquidity fragility: Amihud illiquidity, Roll spread, Corwin-Schmidt
// bars need volume (v). All rolling over `window`.
// ----------------------------------------------------------------------------
function liquidity(bars, window = 20) {
  const b = bars.filter((x) => x && x.c > 0);
  if (b.length < 5) return null;
  const w = Math.min(window, b.length - 1);
  const slice = b.slice(-w - 1);
  // Amihud: |ret| / dollar-volume, averaged
  let amiSum = 0, amiN = 0;
  for (let i = 1; i < slice.length; i++) {
    const r = Math.abs(Math.log(slice[i].c / slice[i - 1].c));
    const dv = (slice[i].v || 0) * slice[i].c;
    if (dv > 0) { amiSum += r / dv; amiN++; }
  }
  const amihud = amiN ? (amiSum / amiN) * 1e9 : null; // scaled to readable units
  // Roll implied spread from serial covariance of price changes
  const dp = []; for (let i = 1; i < slice.length; i++) dp.push(slice[i].c - slice[i - 1].c);
  let cov = 0; { const m0 = mean(dp.slice(1)), m1 = mean(dp.slice(0, -1)); for (let i = 1; i < dp.length; i++) cov += (dp[i] - m0) * (dp[i - 1] - m1); cov /= Math.max(1, dp.length - 1); }
  const roll = cov < 0 ? 2 * Math.sqrt(-cov) : 0;
  const rollPct = slice.length ? roll / slice[slice.length - 1].c : 0;
  // Corwin-Schmidt high-low spread (2-day)
  let csSum = 0, csN = 0;
  for (let i = 1; i < slice.length; i++) {
    const b1 = Math.pow(Math.log(slice[i - 1].h / slice[i - 1].l), 2);
    const b2 = Math.pow(Math.log(slice[i].h / slice[i].l), 2);
    const beta = b1 + b2;
    const hHi = Math.max(slice[i - 1].h, slice[i].h), lLo = Math.min(slice[i - 1].l, slice[i].l);
    const gamma = Math.pow(Math.log(hHi / lLo), 2);
    const k = 3 - 2 * Math.sqrt(2);
    const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k);
    const s = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha));
    if (Number.isFinite(s) && s > 0) { csSum += s; csN++; }
  }
  const corwinSchmidt = csN ? csSum / csN : 0;
  return { amihud, rollPct, corwinSchmidt };
}

// ----------------------------------------------------------------------------
// A4 — HAR-RV: forecast realized variance from daily/weekly/monthly components.
// rvSeries: array of PER-BAR variances (e.g. from rangeVol.yz history). Returns next-bar var forecast.
// ----------------------------------------------------------------------------
function harRV(rvSeries) {
  const rv = rvSeries.filter((v) => v > 0 && Number.isFinite(v));
  if (rv.length < 30) return rv.length ? { forecast: rv[rv.length - 1], beta: null } : null;
  const X = [], y = [];
  for (let t = 22; t < rv.length - 1; t++) {
    const d = rv[t];
    const w = mean(rv.slice(t - 5, t));
    const m = mean(rv.slice(t - 22, t));
    X.push([1, Math.log(d), Math.log(w), Math.log(m)]);
    y.push(Math.log(rv[t + 1]));
  }
  const beta = ols(X, y, 1e-6);
  if (!beta) return { forecast: rv[rv.length - 1], beta: null };
  const t = rv.length - 1;
  const d = rv[t], w = mean(rv.slice(t - 5, t)), m = mean(rv.slice(t - 22, t));
  const logRes = beta[0] + beta[1] * Math.log(d) + beta[2] * Math.log(w) + beta[3] * Math.log(m);
  // residual variance for log-bias correction
  let sse = 0; for (let i = 0; i < X.length; i++) { const p = X[i].reduce((s, xv, j) => s + xv * beta[j], 0); sse += (y[i] - p) ** 2; }
  const s2 = sse / Math.max(1, X.length - 4);
  return { forecast: Math.exp(logRes + 0.5 * s2), beta, s2 };
}

// ----------------------------------------------------------------------------
// A1 — Bayesian Online Changepoint Detection (BOCPD), Normal-Inverse-Gamma predictive.
// Returns run-length posterior summary each step; last = current fragility.
// ----------------------------------------------------------------------------
function bocpd(rets, hazardLambda = 120, prune = 1e-4) {
  if (rets.length < 10) return { changepointProb: 0, expectedRunLength: rets.length, maxRunProb: 1 };
  const H = 1 / hazardLambda;
  // NIG priors
  const mu0 = 0, kappa0 = 1, alpha0 = 1, beta0 = 1e-4;
  let R = [1];                 // run-length probabilities
  let mu = [mu0], kappa = [kappa0], alpha = [alpha0], beta = [beta0];
  const studentT = (x, m, a, b, k) => {
    const nu = 2 * a; const scale2 = (b * (k + 1)) / (a * k);
    const z = (x - m) / Math.sqrt(scale2);
    // t-pdf
    const lg = lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI * scale2);
    return Math.exp(lg) * Math.pow(1 + (z * z) / nu, -(nu + 1) / 2);
  };
  for (const x of rets) {
    const n = R.length;
    const pred = new Array(n);
    for (let i = 0; i < n; i++) pred[i] = studentT(x, mu[i], alpha[i], beta[i], kappa[i]);
    const growth = new Array(n), cp = [];
    let cpMass = 0;
    for (let i = 0; i < n; i++) {
      growth[i] = R[i] * pred[i] * (1 - H);
      cpMass += R[i] * pred[i] * H;
    }
    // new run-length arrays: index 0 = changepoint (run length 0)
    const nR = new Array(n + 1), nmu = new Array(n + 1), nkap = new Array(n + 1), nalp = new Array(n + 1), nbet = new Array(n + 1);
    nR[0] = cpMass; nmu[0] = mu0; nkap[0] = kappa0; nalp[0] = alpha0; nbet[0] = beta0;
    for (let i = 0; i < n; i++) {
      nR[i + 1] = growth[i];
      // NIG sufficient-stat update for the continued run
      nkap[i + 1] = kappa[i] + 1;
      nmu[i + 1] = (kappa[i] * mu[i] + x) / (kappa[i] + 1);
      nalp[i + 1] = alpha[i] + 0.5;
      nbet[i + 1] = beta[i] + (kappa[i] * (x - mu[i]) ** 2) / (2 * (kappa[i] + 1));
    }
    // normalize + prune
    let Z = 0; for (const v of nR) Z += v; if (Z <= 0) Z = 1;
    R = []; mu = []; kappa = []; alpha = []; beta = [];
    for (let i = 0; i < nR.length; i++) {
      const p = nR[i] / Z;
      if (p >= prune || i === 0) { R.push(p); mu.push(nmu[i]); kappa.push(nkap[i]); alpha.push(nalp[i]); beta.push(nbet[i]); }
    }
    let z2 = 0; for (const v of R) z2 += v; for (let i = 0; i < R.length; i++) R[i] /= z2;
  }
  let expLen = 0, maxP = 0, maxIdx = 0;
  for (let i = 0; i < R.length; i++) { expLen += i * R[i]; if (R[i] > maxP) { maxP = R[i]; maxIdx = i; } }
  return { changepointProb: R[0] || 0, expectedRunLength: expLen, maxRunProb: maxP, modeRunLength: maxIdx };
}
function lgamma(x) {
  // Lanczos approximation
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ----------------------------------------------------------------------------
// A2 — split-conformal + ACI calibrated interval half-width from a residual pool.
// residuals: array of |actual-forecast| (or normalized). Returns quantile at (1-alpha).
// ----------------------------------------------------------------------------
function conformalHalfWidth(absResiduals, alpha = 0.1) {
  const r = absResiduals.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!r.length) return null;
  const n = r.length;
  const q = Math.ceil((n + 1) * (1 - alpha)) / n;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return r[idx];
}
// ACI online update: nudge effective alpha toward realized coverage. Returns new alpha_t.
function aciUpdate(alphaT, covered, targetAlpha = 0.1, gamma = 0.02) {
  const err = covered ? 0 : 1;      // 1 if truth fell outside
  const next = alphaT + gamma * (targetAlpha - err);
  return clamp(next, 0.001, 0.5);
}

// ----------------------------------------------------------------------------
// A8 — Hedge / exponential-weights adaptive combiner with fixed-share.
// Given prior weights and each model's latest loss, return updated weights.
// ----------------------------------------------------------------------------
function hedgeUpdate(weights, losses, eta = 0.5, share = 0.02) {
  const n = weights.length; if (!n) return weights;
  const w = weights.map((wi, i) => wi * Math.exp(-eta * (losses[i] || 0)));
  let Z = w.reduce((s, x) => s + x, 0) || 1;
  let nw = w.map((x) => x / Z);
  // fixed-share: mix toward uniform so weights can re-adapt across regimes
  const u = 1 / n;
  nw = nw.map((x) => (1 - share) * x + share * u);
  Z = nw.reduce((s, x) => s + x, 0) || 1;
  return nw.map((x) => x / Z);
}

// ----------------------------------------------------------------------------
// A6 — transfer entropy (Gaussian/linear closed form) X→Y: does X's past reduce
// uncertainty about Y's future beyond Y's own past. Returns TE in nats (>=0).
// ----------------------------------------------------------------------------
function transferEntropyGaussian(driver, target, lag = 1) {
  // build target_{t} on [target_{t-lag}] (restricted) vs [target_{t-lag}, driver_{t-lag}] (full)
  const y = [], y1 = [], x1 = [];
  const N = Math.min(driver.length, target.length);
  for (let t = lag; t < N; t++) { y.push(target[t]); y1.push(target[t - lag]); x1.push(driver[t - lag]); }
  if (y.length < 20) return 0;
  const rssRestricted = olsRSS([y1], y);
  const rssFull = olsRSS([y1, x1], y);
  if (rssRestricted <= 0 || rssFull <= 0) return 0;
  return Math.max(0, 0.5 * Math.log(rssRestricted / rssFull));
}
function olsRSS(cols, y) {
  const n = y.length;
  const X = [];
  for (let i = 0; i < n; i++) { const row = [1]; for (const c of cols) row.push(c[i]); X.push(row); }
  const beta = ols(X, y, 1e-8); if (!beta) return 0;
  let sse = 0; for (let i = 0; i < n; i++) { const p = X[i].reduce((s, xv, j) => s + xv * beta[j], 0); sse += (y[i] - p) ** 2; }
  return sse / n;
}
// Build a directed lead-lag network among named return series. Returns edges sorted by TE.
function leadLagNetwork(seriesMap, lag = 1, minTE = 0.01) {
  const names = Object.keys(seriesMap);
  const edges = [];
  for (const a of names) for (const b of names) {
    if (a === b) continue;
    const te = transferEntropyGaussian(seriesMap[a], seriesMap[b], lag);
    if (te >= minTE) edges.push({ from: a, to: b, te: +te.toFixed(4) });
  }
  edges.sort((x, y) => y.te - x.te);
  const influence = {};
  for (const n of names) influence[n] = { out: 0, in: 0 };
  for (const e of edges) { influence[e.from].out += e.te; influence[e.to].in += e.te; }
  return { edges, influence };
}

// ----------------------------------------------------------------------------
// A7 — PCA statistical factors + residual momentum/reversion.
// panel: {name: returns[]} all same length. Returns per-name residual z + residual momentum.
// ----------------------------------------------------------------------------
function pcaResiduals(panel, nFactors = 3) {
  const names = Object.keys(panel);
  const T = Math.min(...names.map((n) => panel[n].length));
  if (T < 30 || names.length < 3) return null;
  // standardized matrix R (T×N)
  const cols = names.map((n) => {
    const s = panel[n].slice(-T);
    const m = mean(s), sd = std(s) || 1;
    return s.map((v) => (v - m) / sd);
  });
  const N = names.length;
  // correlation matrix
  const C = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let a = 0; a < N; a++) for (let b = a; b < N; b++) {
    let s = 0; for (let t = 0; t < T; t++) s += cols[a][t] * cols[b][t];
    C[a][b] = C[b][a] = s / (T - 1);
  }
  const { values, vectors } = jacobiEigen(C);
  // sort eigenvalues desc
  const order = values.map((v, i) => i).sort((i, j) => values[j] - values[i]);
  const topIdx = order.slice(0, Math.min(nFactors, N));
  // factor time series F_k = R · v_k
  const factors = topIdx.map((k) => {
    const v = vectors.map((row) => row[k]);
    const f = new Array(T).fill(0);
    for (let t = 0; t < T; t++) { let s = 0; for (let a = 0; a < N; a++) s += cols[a][t] * v[a]; f[t] = s; }
    return f;
  });
  // regress each asset on factors, get residuals
  const out = {};
  for (let a = 0; a < N; a++) {
    const X = [], y = [];
    for (let t = 0; t < T; t++) { X.push([1, ...factors.map((f) => f[t])]); y.push(cols[a][t]); }
    const beta = ols(X, y, 1e-6);
    const resid = new Array(T);
    for (let t = 0; t < T; t++) { const p = beta ? X[t].reduce((s, xv, j) => s + xv * beta[j], 0) : 0; resid[t] = y[t] - p; }
    // cumulative residual for OU z-score
    const cum = []; let acc = 0; for (const r of resid) { acc += r; cum.push(acc); }
    const zm = mean(cum), zsd = std(cum) || 1;
    const residZ = (cum[cum.length - 1] - zm) / zsd;
    const residMom = mean(resid.slice(-20));           // factor-neutral momentum
    out[names[a]] = { residZ: +residZ.toFixed(3), residMom: +(residMom).toFixed(5) };
  }
  return { names, explained: topIdx.map((k) => values[k]), residuals: out };
}

module.exports = {
  solveLinear, ols, jacobiEigen,
  rangeVol, variance,
  dfaHurst, kaufmanER, katzFD,
  liquidity,
  harRV,
  bocpd,
  conformalHalfWidth, aciUpdate,
  hedgeUpdate,
  transferEntropyGaussian, leadLagNetwork,
  pcaResiduals,
};
