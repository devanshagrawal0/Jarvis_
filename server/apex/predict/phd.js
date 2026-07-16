// APEX Oracle — PhD-level quant computations. Pure JS, closed-form / O(n). Each returns a
// small labelled result the "Quant Lab" panel renders. Optional peer series enables the
// cointegration & copula co-crash measures. All formulas cited in research_quant.md §9.

const { normCdf, normInv, mean, std, logRets, clamp, nz } = require("./mathx");

// 1. Fractional Kelly (continuous): f* = mu/sigma^2 per bar; report half-Kelly, capped.
function kelly(rets) {
  const mu = mean(rets), v = std(rets) ** 2 || 1e-9;
  const f = mu / v; return { full: f, half: clamp(0.5 * f, -1, 1), note: "f*=μ/σ² (½-Kelly, capped ±1)" };
}

// 2. Kalman local-level+slope trend filter. State [level,slope], F=[[1,1],[0,1]], H=[1,0].
function kalmanTrend(closes) {
  if (closes.length < 10) return { level: closes[closes.length - 1] || 0, slope: 0 };
  const q = 1e-3, r = 1e-1; let x = [closes[0], 0]; let P = [[1, 0], [0, 1]];
  for (let i = 1; i < closes.length; i++) {
    // predict
    const xl = x[0] + x[1], xs = x[1];
    let P00 = P[0][0] + P[0][1] + P[1][0] + P[1][1] + q, P01 = P[0][1] + P[1][1], P10 = P[1][0] + P[1][1], P11 = P[1][1] + q;
    // update (H=[1,0])
    const y = closes[i] - xl; const S = P00 + r; const K0 = P00 / S, K1 = P10 / S;
    x = [xl + K0 * y, xs + K1 * y];
    P = [[P00 - K0 * P00, P01 - K0 * P01], [P10 - K1 * P00, P11 - K1 * P01]];
  }
  return { level: x[0], slope: x[1], slopePct: closes[closes.length - 1] ? (x[1] / closes[closes.length - 1]) * 100 : 0, note: "Kalman level+slope" };
}

// 3. GARCH(1,1) vol term structure. Fixed RiskMetrics-ish params; long-run var + k-step.
function garch(rets) {
  const v = std(rets) ** 2; const alpha = 0.08, beta = 0.90, omega = v * (1 - alpha - beta);
  const VL = omega / (1 - alpha - beta);
  let s2 = v; for (let i = 1; i < rets.length; i++) s2 = omega + alpha * rets[i - 1] ** 2 + beta * s2;
  const term = [1, 5, 22].map((k) => Math.sqrt(VL + Math.pow(alpha + beta, k) * (s2 - VL)));
  return { sigmaNow: Math.sqrt(s2), longRun: Math.sqrt(VL), term1: term[0], term5: term[1], term22: term[2], persistence: alpha + beta, note: "GARCH(1,1) ω+αr²+βσ²" };
}

// 4. Ornstein-Uhlenbeck half-life via AR(1) on log-price deviation from mean.
function ouHalf(closes) {
  const lp = closes.map(Math.log); const m = mean(lp); const dev = lp.map((x) => x - m);
  let sxy = 0, sxx = 0; for (let i = 1; i < dev.length; i++) { sxy += dev[i - 1] * dev[i]; sxx += dev[i - 1] ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0; const kappa = b > 0 && b < 1 ? -Math.log(b) : 0;
  return { kappa, halfLifeBars: kappa > 0 ? Math.log(2) / kappa : Infinity, note: "OU half-life=ln2/κ" };
}

// 5. Engle-Granger cointegration z-score vs a peer (needs aligned peer closes).
function cointegration(a, b) {
  const n = Math.min(a.length, b.length); if (n < 30) return null;
  const A = a.slice(-n).map(Math.log), B = b.slice(-n).map(Math.log);
  const mb = mean(B), ma = mean(A); let sbb = 0, sab = 0; for (let i = 0; i < n; i++) { sbb += (B[i] - mb) ** 2; sab += (A[i] - ma) * (B[i] - mb); }
  const beta = sbb > 0 ? sab / sbb : 1; const alpha = ma - beta * mb;
  const resid = A.map((x, i) => x - alpha - beta * B[i]); const mr = mean(resid), sr = std(resid) || 1e-9;
  const z = (resid[resid.length - 1] - mr) / sr;
  return { beta: +beta.toFixed(3), z: +z.toFixed(2), signal: z > 2 ? "spread rich → short A/long B" : z < -2 ? "spread cheap → long A/short B" : "in band", note: "EG residual z-score" };
}

// 6. CUSUM change-point + Shannon entropy of return distribution.
function changePoint(rets) {
  const m = mean(rets), s = std(rets) || 1e-9, k = 0.5; let g = 0, gmax = 0;
  for (const r of rets) { g = Math.max(0, g + (Math.abs(r - m) / s - k)); gmax = Math.max(gmax, g); }
  // entropy over 10 bins of recent returns
  const rec = rets.slice(-60); const lo = Math.min(...rec), hi = Math.max(...rec), rg = hi - lo || 1; const bins = new Array(10).fill(0);
  for (const r of rec) bins[Math.min(9, Math.floor(((r - lo) / rg) * 10))]++;
  const p = bins.map((c) => c / (rec.length || 1)); const H = -p.reduce((a, x) => a + (x > 0 ? x * Math.log(x) : 0), 0) / Math.log(10);
  return { cusum: +g.toFixed(2), cusumMax: +gmax.toFixed(2), entropy: +H.toFixed(2), alarm: g > 4, note: "CUSUM g + normalized entropy" };
}

// 7. Merton jump detection: returns beyond 3σ = jumps; estimate intensity λ and jump vol.
function jumps(rets) {
  const s = std(rets) || 1e-9; const js = rets.filter((r) => Math.abs(r) > 3 * s);
  const lambda = rets.length ? js.length / rets.length : 0;
  const jumpVol = js.length ? std(js) : 0;
  return { count: js.length, lambdaPerBar: +lambda.toFixed(4), jumpVol: +(jumpVol * 100).toFixed(2), note: "|r|>3σ jump events" };
}

// 8. Parametric VaR / CVaR at 95% on 1-bar returns.
function varCvar(rets) {
  const m = mean(rets), s = std(rets) || 1e-9; const z = normInv(0.05);
  const var95 = -(m + s * z); const cvar95 = -m + s * (Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI)) / 0.05;
  return { var95: +(var95 * 100).toFixed(2), cvar95: +(cvar95 * 100).toFixed(2), note: "parametric 95% (1 bar)" };
}

// 9. Fractional differentiation weights + stationarity gain proxy (ADF-lite: lag-1 autocorr drop).
function fracDiff(closes, d = 0.4, width = 20) {
  const w = [1]; for (let k = 1; k < width; k++) w.push(-w[k - 1] * (d - k + 1) / k);
  const out = []; for (let i = width; i < closes.length; i++) { let s = 0; for (let k = 0; k < width; k++) s += w[k] * closes[i - k]; out.push(s); }
  const ac1 = (arr) => { const m = mean(arr); let n = 0, dd = 0; for (let i = 1; i < arr.length; i++) { n += (arr[i] - m) * (arr[i - 1] - m); dd += (arr[i] - m) ** 2; } return dd ? n / dd : 0; };
  return { d, acf1Price: +ac1(closes).toFixed(3), acf1FracDiff: +ac1(out).toFixed(3), note: "López de Prado frac-diff (memory-preserving)" };
}

// 10. Kyle's lambda (price impact) via OFI proxy: regress signed volume on |return|.
function kyleLambda(bars) {
  const rows = []; for (let i = 1; i < bars.length; i++) { const dp = bars[i].c - bars[i - 1].c; const ofi = Math.sign(dp) * (bars[i].v || 0); rows.push([ofi, dp]); }
  const mx = mean(rows.map((r) => r[0])), my = mean(rows.map((r) => r[1])); let sxy = 0, sxx = 0;
  for (const [x, y] of rows) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
  const lambda = sxx > 0 ? sxy / sxx : 0;
  return { lambda: lambda.toExponential(2), illiquidity: Math.abs(lambda) > 0 ? "impact per unit OFI" : "n/a", note: "Kyle λ = Δp/OFI" };
}

// 12. 2-state HMM posterior via one forward pass (calm/stormy Gaussian on returns).
function hmmPosterior(rets) {
  if (rets.length < 20) return { pStormy: 0.5, note: "HMM 2-state posterior" };
  const s = std(rets) || 1e-9; const muC = 0, sC = s * 0.6, muS = 0, sS = s * 1.8;
  const A = [[0.95, 0.05], [0.10, 0.90]]; let a = [0.5, 0.5];
  const g = (r, mu, sd) => Math.exp(-((r - mu) ** 2) / (2 * sd * sd)) / (sd * Math.sqrt(2 * Math.PI));
  for (const r of rets) {
    const pc = (a[0] * A[0][0] + a[1] * A[1][0]) * g(r, muC, sC);
    const ps = (a[0] * A[0][1] + a[1] * A[1][1]) * g(r, muS, sS);
    const z = pc + ps || 1e-12; a = [pc / z, ps / z];
  }
  return { pStormy: +a[1].toFixed(2), pCalm: +a[0].toFixed(2), note: "HMM forward posterior" };
}

// 13. Hawkes self-exciting intensity of jump events (branching approx).
function hawkes(rets) {
  const s = std(rets) || 1e-9; const events = rets.map((r, i) => (Math.abs(r) > 2.5 * s ? i : -1)).filter((i) => i >= 0);
  if (events.length < 2) return { intensity: 0, branching: 0, note: "Hawkes self-excitation" };
  const beta = 0.2, alpha = 0.12; let lam = events.length / rets.length; let intensity = lam;
  for (let i = 1; i < events.length; i++) intensity = lam + alpha * Math.exp(-beta * (events[i] - events[i - 1]));
  return { intensity: +intensity.toFixed(3), branching: +(alpha / beta).toFixed(2), lastGap: events.length > 1 ? events[events.length - 1] - events[events.length - 2] : null, note: "Hawkes λ(t)=μ+Σαe^{-βΔ}" };
}

// 14. Gaussian-copula co-crash probability with a peer (both in lower tails together).
function copulaCoCrash(a, b, q = 0.1) {
  const n = Math.min(a.length, b.length); if (n < 30) return null;
  const ra = logRets(a.slice(-n)), rb = logRets(b.slice(-n)); const m = Math.min(ra.length, rb.length);
  const A = ra.slice(-m), B = rb.slice(-m); const ma = mean(A), mb = mean(B), sa = std(A) || 1e-9, sb = std(B) || 1e-9;
  let cov = 0; for (let i = 0; i < m; i++) cov += (A[i] - ma) * (B[i] - mb); const rho = clamp(cov / m / (sa * sb), -0.99, 0.99);
  // P(both below q-quantile) via bivariate normal approx (lower tail dependence)
  const zq = normInv(q);
  // crude bivariate lower-tail: use Gaussian copula C(q,q) ≈ Φ2(zq,zq;rho); approximate via product boosted by rho
  const joint = q * q + rho * normCdf(zq) * (q - q * q);
  return { rho: +rho.toFixed(2), coCrashProb: +clamp(joint, 0, 1).toFixed(3), lambdaLower: +clamp(joint / q, 0, 1).toFixed(2), note: "Gaussian-copula co-crash" };
}

function computeQuant(bars, peerBars = null) {
  const closes = bars.map((b) => b.c); const rets = logRets(closes);
  if (rets.length < 20) return { ok: false };
  const out = {
    ok: true,
    kelly: kelly(rets),
    kalman: kalmanTrend(closes),
    garch: garch(rets),
    ou: ouHalf(closes),
    changePoint: changePoint(rets),
    jumps: jumps(rets),
    varCvar: varCvar(rets),
    fracDiff: fracDiff(closes),
    kyle: kyleLambda(bars),
    hmm: hmmPosterior(rets),
    hawkes: hawkes(rets),
  };
  if (peerBars && peerBars.length > 30) {
    const pc = peerBars.map((b) => b.c);
    out.cointegration = cointegration(closes, pc);
    out.copula = copulaCoCrash(closes, pc);
  }
  return out;
}

module.exports = { computeQuant, kelly, kalmanTrend, garch, ouHalf, cointegration, changePoint, jumps, varCvar, fracDiff, kyleLambda, hmmPosterior, hawkes, copulaCoCrash };
