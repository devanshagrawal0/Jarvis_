// APEX Oracle — shared math primitives (pure JS, no deps). Closed-form / O(n) only.
// Normal CDF (Abramowitz–Stegun 7.1.26), PDF, inverse-CDF (Acklam), plus small stats.

const SQRT2PI = Math.sqrt(2 * Math.PI);

function normPdf(x) { return Math.exp(-x * x / 2) / SQRT2PI; }

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// Peter Acklam's rational approximation for the inverse normal CDF (|err| < 1.15e-9).
function normInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425, ph = 1 - pl; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const nz = (v) => (Number.isFinite(v) ? v : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function std(a, ddof = 1) {
  if (a.length <= ddof) return 0;
  const m = mean(a); let s = 0; for (const x of a) s += (x - m) ** 2;
  return Math.sqrt(s / (a.length - ddof));
}
// log returns from a close series
function logRets(closes) {
  const out = []; for (let i = 1; i < closes.length; i++) { if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1])); }
  return out;
}
function ema(src, span) {
  const k = 2 / (span + 1); let prev = NaN; const out = [];
  for (let i = 0; i < src.length; i++) { const v = src[i]; prev = Number.isFinite(prev) ? v * k + prev * (1 - k) : v; out.push(prev); }
  return out;
}
// percentile rank of x within arr (0..1)
function percentileRank(x, arr) {
  if (!arr.length) return 0.5; let c = 0; for (const v of arr) if (v <= x) c++;
  return c / arr.length;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

module.exports = { normPdf, normCdf, normInv, nz, mean, std, logRets, ema, percentileRank, clamp, logit, sigmoid, SQRT2PI };
