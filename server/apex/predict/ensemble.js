// APEX Oracle — ensemble. Fuses three views per horizon (technical GBM, cross-asset, LLM)
// in log-odds space (product-of-experts), with inverse-Brier weighting + disagreement spread.

const { logit, sigmoid, clamp } = require("./mathx");

// views: [{p, brier}] where p∈(0,1); LLM view optional. Returns { p, spread, weights }.
function fuse(views) {
  const valid = views.filter((v) => v && Number.isFinite(v.p));
  if (!valid.length) return { p: 0.5, spread: 0.5, weights: [] };
  // inverse-Brier weights (lower Brier ⇒ more trust); default Brier 0.25 (uninformed).
  const ws = valid.map((v) => 1 / Math.max(0.02, v.brier ?? 0.25));
  const wsum = ws.reduce((a, b) => a + b, 0) || 1;
  const L = valid.reduce((s, v, i) => s + (ws[i] / wsum) * logit(v.p), 0);
  const p = clamp(sigmoid(L), 0.02, 0.98);
  // disagreement = std of the views' probabilities (0..~0.5); widens uncertainty
  const mp = valid.reduce((s, v) => s + v.p, 0) / valid.length;
  const spread = Math.sqrt(valid.reduce((s, v) => s + (v.p - mp) ** 2, 0) / valid.length);
  return { p, spread, weights: ws.map((w) => +(w / wsum).toFixed(2)), n: valid.length };
}

module.exports = { fuse };
