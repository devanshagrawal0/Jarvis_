// APEX Oracle — options pricing (Black–Scholes–Merton) + Greeks + IV + contract selection.
// Paper-proof: premium priced at model sigma_H; EV computed under OUR forecast (m,s) — replayable.

const { normCdf, normPdf, normInv, clamp } = require("./mathx");

// Black-Scholes price + Greeks. S spot, K strike, r rate, q div yield, sig vol, T years, type 'call'|'put'.
function bs(S, K, r, q, sig, T, type = "call") {
  if (T <= 0 || sig <= 0) { const iv = type === "call" ? Math.max(0, S - K) : Math.max(0, K - S); return { price: iv, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0, d1: 0, d2: 0 }; }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sig * sig) * T) / (sig * sqrtT);
  const d2 = d1 - sig * sqrtT;
  const eqT = Math.exp(-q * T), erT = Math.exp(-r * T);
  let price, delta, theta, rho;
  const gamma = eqT * normPdf(d1) / (S * sig * sqrtT);
  const vega = S * eqT * normPdf(d1) * sqrtT / 100; // per 1% vol
  if (type === "call") {
    price = S * eqT * normCdf(d1) - K * erT * normCdf(d2);
    delta = eqT * normCdf(d1);
    theta = (-S * eqT * normPdf(d1) * sig / (2 * sqrtT) - r * K * erT * normCdf(d2) + q * S * eqT * normCdf(d1)) / 365;
    rho = K * T * erT * normCdf(d2) / 100;
  } else {
    price = K * erT * normCdf(-d2) - S * eqT * normCdf(-d1);
    delta = -eqT * normCdf(-d1);
    theta = (-S * eqT * normPdf(d1) * sig / (2 * sqrtT) + r * K * erT * normCdf(-d2) - q * S * eqT * normCdf(-d1)) / 365;
    rho = -K * T * erT * normCdf(-d2) / 100;
  }
  return { price, delta, gamma, vega, theta, rho, d1, d2 };
}

// Implied vol via Newton–Raphson (fallback bisection).
function impliedVol(mktPrice, S, K, r, q, T, type = "call") {
  if (mktPrice <= 0 || T <= 0) return NaN;
  let sig = Math.sqrt(2 * Math.PI / T) * (mktPrice / S) || 0.3;
  sig = clamp(sig, 0.01, 3);
  for (let i = 0; i < 50; i++) {
    const o = bs(S, K, r, q, sig, T, type); const diff = o.price - mktPrice; const vega = o.vega * 100;
    if (Math.abs(diff) < 1e-5) return sig;
    if (vega < 1e-8) break;
    sig = clamp(sig - diff / vega, 1e-4, 5);
  }
  // bisection fallback
  let lo = 1e-4, hi = 5;
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; const p = bs(S, K, r, q, mid, T, type).price; if (p > mktPrice) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

// EV of a contract under OUR lognormal forecast (m,s in log space). Closed form.
function expectedValue(K, m, s, premium, type = "call") {
  const d1p = (m + s * s - Math.log(K)) / s, d2p = d1p - s;
  let payoff;
  if (type === "call") payoff = Math.exp(m + s * s / 2) * normCdf(d1p) - K * normCdf(d2p);
  else payoff = K * normCdf(-d2p) - Math.exp(m + s * s / 2) * normCdf(-d1p);
  const pITM = type === "call" ? normCdf(d2p) : normCdf(-d2p);
  return { payoff, ev: payoff - premium, roi: premium > 0 ? (payoff - premium) / premium : 0, pITM };
}

// Recommend a contract given the directional forecast for one horizon.
// fc: a horizon forecast row from forecast.js; opts: { r, q }.
function recommendContract(fc, opts = {}) {
  const S = fc.spot, r = opts.r ?? 0.045, q = opts.q ?? 0;
  const type = fc.dir === "LONG" ? "call" : "put";
  // expiry: horizon end in years, min ~1 trading day; add buffer so theta isn't brutal
  const days = Math.max(1, Math.ceil((fc.tau / 6.5) * 1.6));
  const T = days / 365;
  const sig = fc.sigmaH / Math.sqrt(fc.tau) * Math.sqrt(6.5) || 0.3; // annualize per-bar-ish
  const sigAnn = clamp(fc.s / Math.sqrt(fc.tau) * Math.sqrt(6.5 * 252), 0.05, 3);
  // Scan strikes around spot; select a directional contract in a sensible delta band
  // (~0.25–0.55), then rank by ROI. Prevents the "always deepest-ITM" degenerate pick.
  const targetDelta = 0.40;
  const cands = [];
  for (let pctOff = -0.30; pctOff <= 0.30; pctOff += 0.01) {
    const K = Math.round(S * (1 + pctOff) * 2) / 2; // 0.50 strike grid
    if (K <= 0) continue;
    const o = bs(S, K, r, q, sigAnn, T, type);
    if (o.price < 0.02) continue;
    const ev = expectedValue(K, fc.m, fc.s, o.price, type);
    cands.push({ K, T, days, type, premium: o.price, ...o, ...ev, sigAnn, absDelta: Math.abs(o.delta) });
  }
  if (!cands.length) return null;
  const inBand = cands.filter((c) => c.absDelta >= 0.25 && c.absDelta <= 0.55);
  const pool = inBand.length ? inBand : cands;
  // within the band, prefer positive EV then closeness to target delta
  let best = pool.slice().sort((a, b) => (b.roi - a.roi) || (Math.abs(a.absDelta - targetDelta) - Math.abs(b.absDelta - targetDelta)))[0];
  if (best.ev <= 0) best = pool.slice().sort((a, b) => Math.abs(a.absDelta - targetDelta) - Math.abs(b.absDelta - targetDelta))[0];
  return {
    type: best.type, strike: best.K, expiryDays: best.days, T: best.T,
    premium: +best.premium.toFixed(3), impliedVol: +(best.sigAnn * 100).toFixed(1),
    delta: +best.delta.toFixed(3), gamma: +best.gamma.toFixed(4), vega: +best.vega.toFixed(3), theta: +best.theta.toFixed(3), rho: +best.rho.toFixed(3),
    ev: +best.ev.toFixed(3), roi: +(best.roi * 100).toFixed(1), pITM: +(best.pITM * 100).toFixed(1),
    breakeven: best.type === "call" ? +(best.K + best.premium).toFixed(2) : +(best.K - best.premium).toFixed(2),
  };
}

module.exports = { bs, impliedVol, expectedValue, recommendContract };
