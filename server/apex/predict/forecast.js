// APEX Oracle — multi-horizon price forecast. GBM with regime-blended drift + EWMA vol,
// sqrt-t horizon scaling, lognormal prediction intervals, P(up), fractional Kelly, VaR/CVaR.
// Horizons on hourly bars: 1h/5h/12h/1d/5d → tau 1/5/12/6.5/32.5.

const { normCdf, normInv, normPdf, logRets, ema, std, clamp, nz } = require("./mathx");

const HORIZONS = [
  { key: "1h", tau: 1, overnights: 0 },
  { key: "5h", tau: 5, overnights: 0 },
  { key: "12h", tau: 12, overnights: 1 },
  { key: "1d", tau: 6.5, overnights: 1 },
  { key: "5d", tau: 32.5, overnights: 5 },
];

// EWMA per-bar variance (RiskMetrics). lambda≈0.97 for hourly.
function ewmaVar(rets, lambda = 0.97) {
  if (!rets.length) return 0;
  let v = rets[0] * rets[0];
  for (let i = 1; i < rets.length; i++) v = lambda * v + (1 - lambda) * rets[i] * rets[i];
  return v;
}

// OU speed via AR(1) on log-price deviations from a reference EMA → half-life.
function ouHalfLife(closes, refSpan = 26) {
  if (closes.length < 30) return { kappa: 0, halfLife: Infinity };
  const ref = ema(closes, refSpan);
  const x = closes.map((c, i) => Math.log(c) - Math.log(ref[i])); // deviation
  // AR(1): x_t = a + b x_{t-1}
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 1; i < x.length; i++) { const xp = x[i - 1], y = x[i]; sx += xp; sy += y; sxx += xp * xp; sxy += xp * y; n++; }
  const b = (n * sxy - sx * sy) / ((n * sxx - sx * sx) || 1e-9);
  const kappa = b > 0 && b < 1 ? -Math.log(b) : 0;
  return { kappa, halfLife: kappa > 0 ? Math.log(2) / kappa : Infinity, dev: x[x.length - 1] };
}

// Build a forecast for one horizon given per-bar mu/sigma and calibration multipliers.
function horizonForecast(S0, muBar, sigBar, h, regime, cal) {
  const tau = h.tau;
  let sigH = sigBar * Math.sqrt(tau);
  // regime + regime-change inflation
  const volPct = nz(regime.volPct), pChg = regime.markov ? nz(regime.markov.pChange) : 0.2;
  sigH *= (1 + 0.5 * volPct + 0.5 * pChg);
  // overnight gap variance in quadrature
  if (h.overnights > 0) { const sigGap = sigBar * 1.4; sigH = Math.sqrt(sigH * sigH + sigGap * sigGap * h.overnights); }
  // calibration vol multiplier
  sigH *= clamp(cal ? cal.vol_mult : 1, 0.3, 3);
  // Clip drift much tighter: raw momentum drift was allowed to reach ±3σ, producing absurd
  // multi-day targets (e.g. +15%). Cap at ±0.8σ_H so diffusion dominates and forecasts stay sane.
  const muH = clamp(muBar * tau, -0.8 * sigH, 0.8 * sigH);
  // center in log space, minus persistent bias
  let m = Math.log(S0) + (muBar - 0.5 * sigBar * sigBar) * tau;
  if (cal && Number.isFinite(cal.bias_ewma)) m -= cal.bias_ewma;
  m += muH - muBar * tau; // fold clipped drift adjustment (keeps m ≈ ln S0 + driftτ)
  const s = sigH;
  const q = (p) => Math.exp(m + s * normInv(p));
  const p50 = Math.exp(m);
  const pUpRaw = normCdf((m - Math.log(S0)) / s);
  // calibrated prob (Platt)
  const a = cal && Number.isFinite(cal.platt_a) ? cal.platt_a : 1, bb = cal && Number.isFinite(cal.platt_b) ? cal.platt_b : 0;
  const pUp = clamp(1 / (1 + Math.exp(-(a * Math.log(pUpRaw / (1 - pUpRaw + 1e-9)) + bb))), 0.01, 0.99);
  const dir = pUp >= 0.5 ? "LONG" : "SHORT";
  const edge = Math.abs(pUp - 0.5) * 2;
  // VaR/CVaR (parametric, 95%) on horizon return
  const muRet = m - Math.log(S0);
  const z = normInv(0.05);
  const var95 = -(muRet + s * z);
  const cvar95 = -muRet + s * normPdf(normInv(0.05)) / 0.05;
  // fractional Kelly (continuous): f = mu/sigma^2, half-Kelly, capped
  const kelly = s > 0 ? clamp(0.5 * (muRet / (s * s)), -1, 1) : 0;
  const size = clamp(Math.abs(kelly), 0, 0.25) * Math.sign(muRet || 1);
  return {
    horizon: h.key, tau, spot: S0,
    p05: q(0.05), p25: q(0.25), p50, p75: q(0.75), p95: q(0.95),
    predRet: (p50 / S0 - 1) * 100,
    dir, pUp, edge, size, sigmaH: s, muH: muRet,
    var95: var95 * 100, cvar95: cvar95 * 100,
    m, s,
  };
}

// Full forecast across all horizons. regime from regime.js; cals: {horizonKey: calibrationRow}.
function forecast(bars, regime, cals = {}) {
  const closes = bars.map((b) => b.c);
  const rets = logRets(closes);
  if (rets.length < 20) return { ok: false, reason: "insufficient history", horizons: [] };
  const S0 = closes[closes.length - 1];
  // drift blend: momentum (EWMA of r) vs mean-revert (OU pull)
  const muMom = ema(rets, 12)[rets.length - 1];
  const ou = ouHalfLife(closes, 26);
  const muMr = -ou.kappa * nz(ou.dev); // pull back toward EMA ref
  const g = clamp(regime.g != null ? regime.g : 0.5, 0, 1);
  // Momentum haircut: raw EWMA momentum overstates future drift (returns partially mean-revert),
  // so shrink it toward 0 — the biggest driver of realistic magnitude forecasts.
  const DRIFT_HAIRCUT = 0.45;
  const muBar = (g * muMom + (1 - g) * muMr) * DRIFT_HAIRCUT;
  const sigBar = Math.sqrt(ewmaVar(rets, 0.97)) || std(rets);
  const horizons = HORIZONS.map((h) => horizonForecast(S0, muBar, sigBar, h, regime, cals[h.key]));
  return { ok: true, spot: S0, muBar, sigBar, ou, g, horizons };
}

module.exports = { forecast, horizonForecast, ewmaVar, ouHalfLife, HORIZONS };
