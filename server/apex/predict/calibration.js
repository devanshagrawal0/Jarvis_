// APEX Oracle — scoring a resolved prediction + updating adaptive calibration state
// (EWMA bias multiplier, coverage-driven vol multiplier, Platt prob recalibration).

const { normCdf, normPdf, normInv, clamp } = require("./mathx");

// CRPS for a Normal predictive dist (closed form). m,s in LOG space; compare to realized log price.
function crpsNormal(mu, s, y) {
  if (s <= 0) return Math.abs(y - mu);
  const z = (y - mu) / s;
  return s * (z * (2 * normCdf(z) - 1) + 2 * normPdf(z) - 1 / Math.sqrt(Math.PI));
}

// Score one prediction against realized price. pred is a stored predictions row.
function scorePrediction(pred, realizedPrice) {
  const S0 = pred.spot_at_make, y = realizedPrice;
  const realizedRet = Math.log(y / S0);
  const predRet = Math.log(pred.p50 / S0);
  const dirHit = Math.sign(pred.p50 - S0) === Math.sign(y - S0) ? 1 : 0;
  const outcomeUp = y > S0 ? 1 : 0;
  const brier = (pred.p_up - outcomeUp) ** 2;
  const absPctErr = Math.abs(y - pred.p50) / (Math.abs(y) || 1);
  const signedErr = Math.log(y) - Math.log(pred.p50); // log-space bias for correction
  // pinball across the five quantiles
  const qs = [[0.05, pred.p05], [0.25, pred.p25], [0.5, pred.p50], [0.75, pred.p75], [0.95, pred.p95]];
  let pinball = 0;
  for (const [tau, q] of qs) pinball += y >= q ? tau * (y - q) : (1 - tau) * (q - y);
  pinball /= qs.length;
  const cov50 = y >= pred.p25 && y <= pred.p75 ? 1 : 0;
  const cov90 = y >= pred.p05 && y <= pred.p95 ? 1 : 0;
  // CRPS in log space
  const s = pred.sigma_h && pred.sigma_h > 0 ? pred.sigma_h : (Math.log(pred.p95) - Math.log(pred.p05)) / (2 * 1.6449);
  const m = Math.log(pred.p50);
  const crps = crpsNormal(m, s, Math.log(y));
  return { realized_price: y, realized_ret: realizedRet, hit: dirHit, abs_pct_err: absPctErr, signed_err: signedErr, brier, pinball, cov50, cov90, crps };
}

// Update per-(symbol,horizon) calibration from a fresh outcome. Returns the new calibration row.
function updateCalibration(cal, outcome, opts = {}) {
  const gamma = opts.gamma ?? 0.90, eta = opts.eta ?? 0.15, emaK = opts.emaK ?? 0.15;
  const c = cal || { bias_ewma: 0, drift_mult: 1, vol_mult: 1, hit_rate: 0.5, mean_brier: 0.25, mean_pinball: 0, cov90: 0.9, platt_a: 1, platt_b: 0, n_samples: 0 };
  const n = c.n_samples || 0;
  const bias_ewma = gamma * (c.bias_ewma || 0) + (1 - gamma) * outcome.signed_err;
  const hit_rate = n === 0 ? outcome.hit : (1 - emaK) * c.hit_rate + emaK * outcome.hit;
  const mean_brier = n === 0 ? outcome.brier : (1 - emaK) * c.mean_brier + emaK * outcome.brier;
  const mean_pinball = n === 0 ? outcome.pinball : (1 - emaK) * (c.mean_pinball || 0) + emaK * outcome.pinball;
  const cov90 = n === 0 ? outcome.cov90 : (1 - emaK) * c.cov90 + emaK * outcome.cov90;
  const vol_mult = clamp((c.vol_mult || 1) * (1 + eta * (cov90 - 0.90)), 0.3, 3);
  const drift_mult = clamp(1 - clamp(bias_ewma * 4, -0.5, 0.5), 0.5, 1.5);
  // simple Platt nudge toward calibration: if chronically over/under-confident, adjust slope/intercept
  const platt_a = clamp((c.platt_a || 1) + 0.02 * (0.5 - Math.abs(hit_rate - 0.5)) * Math.sign(1), 0.5, 2);
  const platt_b = clamp((c.platt_b || 0), -1, 1);
  return { bias_ewma, drift_mult, vol_mult, hit_rate, mean_brier, mean_pinball, cov90, platt_a, platt_b, n_samples: n + 1 };
}

module.exports = { scorePrediction, updateCalibration, crpsNormal };
