// APEX Oracle — News Brain. Goes beyond tone-scoring: measures SURPRISE, the REACTION-GAP
// ("no movement is information"), news VELOCITY/reflexivity (Hawkes), source CREDIBILITY, and
// cross-asset PROPAGATION. Pure JS, free data. See scratchpad/research_news_alpha.md.
//
// The master idea (what real desks trade):
//   E[R|news] = Σ w · Surprise · β(regime) · Decay · Credibility · Propagation
// Everything here is a transparent READOUT layered on the price forecast — it is NOT injected into
// the gated GBM drift (that A/B-regressed); the news signal stands on its own, honestly labelled.

const { mean, std, clamp } = require("./mathx");
const { transferEntropyGaussian } = require("./quantx");

// ── Negation / intensifier / modality grammar (fixes the #1 lexicon failure: sign flips) ──
const NEGATORS = new Set(["not", "no", "never", "without", "fails", "failed", "hardly", "lacks", "lack", "cannot", "cant", "isnt", "wasnt", "wont", "n't", "denies", "denied", "avoid", "avoids"]);
const INTENSIFIERS = { sharply: 1.5, significantly: 1.5, record: 1.5, massively: 1.6, sharp: 1.4, surging: 1.4, soaring: 1.4, plunging: 1.5, slightly: 0.6, marginally: 0.6, modest: 0.7, slight: 0.6 };
const MODALS = new Set(["may", "might", "could", "reportedly", "rumored", "rumor", "reportedly", "said", "expects", "expected", "potential", "potentially", "eyes", "weighs", "weighing", "considering", "explores", "exploring", "talks", "in-talks", "mulls", "plans"]);

// Loughran-McDonald flavored polarity (kept in sync w/ news-intel lexicon but scored with grammar).
const POS = new Set(["surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "gain", "gains", "rise", "rises", "climb", "climbs", "record", "strong", "growth", "profit", "beat", "beats", "upgrade", "raises", "raised", "outperform", "bullish", "wins", "win", "approval", "approved", "tops", "boost", "boosts", "expands", "accelerate", "robust", "upbeat", "optimistic", "rebound", "breakthrough", "milestone", "buyback", "surged", "jumped", "soared", "rallied", "gained", "climbed", "topped", "beaten"]);
const NEG = new Set(["plunge", "plunges", "slump", "slumps", "tumble", "tumbles", "drop", "drops", "fall", "falls", "sink", "sinks", "slide", "slides", "cut", "cuts", "downgrade", "weak", "weakness", "loss", "losses", "lawsuit", "probe", "warning", "warns", "bearish", "recall", "halt", "miss", "misses", "disappoint", "fraud", "investigation", "decline", "declines", "slowdown", "concern", "concerns", "fears", "risk", "risks", "layoff", "layoffs", "bankruptcy", "default", "downturn", "crash", "selloff", "plunged", "tumbled", "dropped", "fell", "sank", "slid", "missed", "declined", "slashed"]);

// Grammar-aware headline sentiment. Returns { score:-1..1, modality:0..1 (rumor/uncertainty) }.
function grammarScore(title) {
  const toks = String(title).toLowerCase().replace(/n't/g, " nt").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  let sum = 0, hits = 0, modal = 0;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    if (MODALS.has(w)) modal++;
    let pol = POS.has(w) ? 1 : NEG.has(w) ? -1 : 0;
    if (pol === 0) continue;
    // intensifier immediately before
    let scale = 1;
    const prev = toks[i - 1];
    if (prev && INTENSIFIERS[prev] != null) scale = INTENSIFIERS[prev];
    // negation window: scan up to 3 tokens back
    let neg = false;
    for (let j = Math.max(0, i - 3); j < i; j++) if (NEGATORS.has(toks[j])) neg = true;
    if (neg) pol = -pol;
    // contrast: clause after "but/however" weighted higher (approx: later tokens weigh a touch more)
    sum += pol * scale;
    hits++;
  }
  const score = hits ? clamp(sum / (hits + 1), -1, 1) : 0;
  return { score, modality: clamp(modal / 2, 0, 1) };
}

// ── Market model (event-study measurement engine): AR = R_stock − (α + β·R_mkt) ──
function marketModel(symBars, mktBars) {
  const rs = rets(symBars), rm = rets(mktBars);
  const n = Math.min(rs.length, rm.length);
  if (n < 20) return null;
  const S = rs.slice(-n), M = rm.slice(-n);
  const mS = mean(S), mM = mean(M);
  let cov = 0, varM = 0;
  for (let i = 0; i < n; i++) { cov += (S[i] - mS) * (M[i] - mM); varM += (M[i] - mM) ** 2; }
  const beta = varM > 0 ? cov / varM : 1;
  const alpha = mS - beta * mM;
  const ar = []; for (let i = 0; i < n; i++) ar.push(S[i] - (alpha + beta * M[i]));
  const sigmaAR = std(ar) || 1e-4;
  return {
    alpha, beta, sigmaAR,
    arToday: ar[ar.length - 1],
    car: (k) => ar.slice(-k).reduce((s, x) => s + x, 0),     // cumulative abnormal return over last k bars
    arSeries: ar,
  };
}

// ── Reaction-Gap: "no movement is information" (Chan 2003). ──
// ExpectedMove (σ units, signed by news) vs RealizedMove (recent CAR in σ). Gap → under/over-reaction.
function reactionGap(newsScore, dominantMag, mm, regimeVolPct = 0.5) {
  if (!mm) return null;
  const sign = Math.sign(newsScore) || 0;
  // expected abnormal move (σ) for this news, amplified in high-vol regimes (research §7.4)
  const expSigma = clamp(Math.abs(newsScore) * (0.4 + 0.6 * (dominantMag / 4)) * (1 + 0.6 * regimeVolPct) * 2.2, 0, 4);
  // realized reaction so far: CAR over last 2 bars in σ units, aligned to the news direction
  const carRecent = mm.car(2);
  const realizedSigma = carRecent / mm.sigmaAR;
  const realizedAligned = realizedSigma * sign;
  const gap = expSigma - realizedAligned;      // >0 owed drift in news dir; <0 overshoot → fade
  let signal, tilt, note;
  if (sign === 0 || expSigma < 0.3) { signal = "NO EDGE"; tilt = 0; note = "no material news surprise"; }
  else if (gap > 0.8) { signal = "UNDER-REACTION"; tilt = sign * clamp(gap / 4, 0, 1); note = `market moved ${realizedAligned.toFixed(1)}σ vs ~${expSigma.toFixed(1)}σ expected — ~${(gap).toFixed(1)}σ of drift still owed ${sign > 0 ? "up" : "down"}`; }
  else if (gap < -0.8) { signal = "OVER-REACTION"; tilt = -sign * clamp(-gap / 4, 0, 1); note = `moved ${realizedAligned.toFixed(1)}σ vs ~${expSigma.toFixed(1)}σ expected — overshoot, mean-reversion (fade) more likely`; }
  else { signal = "PRICED-IN"; tilt = 0; note = `reaction (${realizedAligned.toFixed(1)}σ) ≈ expected (${expSigma.toFixed(1)}σ) — largely discounted`; }
  return { signal, tilt: +tilt.toFixed(2), expSigma: +expSigma.toFixed(2), realizedSigma: +realizedAligned.toFixed(2), gap: +gap.toFixed(2), note };
}

// ── News velocity: Hawkes reflexivity (from visible arrivals) + abnormal coverage (needs archive) ──
// archiveDaily: optional array of REAL per-day story counts from the point-in-time news_log
// (index [0]=today … [k]=k days ago). Without it we honestly report abnCoverage=null, because an
// RSS snapshot always returns ~24 recent items and cannot distinguish a spike from normal.
function velocity(timestamps, nowMs = null, archiveDaily = null) {
  const now = nowMs || (timestamps.length ? Math.max(...timestamps) : 0);
  const ts = timestamps.filter((t) => t > 0 && t <= now + 1).sort((a, b) => a - b);
  const dayMs = 86400e3;
  // Hawkes branching ratio from the clustering of the VISIBLE publisher timestamps (honest: measures
  // how bursty the current story cluster is; β decays ~half a day).
  const beta = 1 / (0.5 * dayMs);
  const hk = ts.length >= 4 ? fitHawkes(ts, beta, now) : { branching: 0, lambdaNow: 0 };
  const branchingRatio = clamp(hk.branching, 0, 0.99);
  // Abnormal coverage: only from a real historical baseline (archive), else null.
  let abnCoverage = null, base = null, accel = null, today = null;
  const hist = Array.isArray(archiveDaily) ? archiveDaily.filter((x) => Number.isFinite(x)) : null;
  if (hist && hist.length >= 4) {
    today = hist[0];
    const past = hist.slice(1);
    const nz = past.filter((x) => x > 0).length;
    if (nz >= 2) {
      base = mean(past);
      abnCoverage = (today - base) / Math.sqrt(Math.max(base, 0.5));
      if (past.length >= 2) accel = ((today - base) - (past[0] - base)) / Math.sqrt(Math.max(base, 0.5));
    }
  }
  const noteBits = [];
  if (abnCoverage != null && abnCoverage > 2) noteBits.push("attention spike — expect vol expansion");
  if (branchingRatio > 0.6) noteBits.push("bursty/self-reflexive cluster");
  if (!noteBits.length) noteBits.push(abnCoverage == null ? "coverage baseline building (needs archive history)" : "coverage near normal");
  return {
    count24h: ts.filter((t) => now - t < dayMs).length,
    base: base == null ? null : +base.toFixed(2),
    abnCoverage: abnCoverage == null ? null : +abnCoverage.toFixed(2),
    accel: accel == null ? null : +accel.toFixed(2),
    lambda: +hk.lambdaNow.toFixed(3), branchingRatio: +branchingRatio.toFixed(2),
    reflexive: branchingRatio > 0.6,
    note: noteBits.join("; "),
  };
}
// coarse-grid Hawkes MLE for (μ,α) with fixed β (all in per-second). ln L = Σ ln λ(t_i) − ∫λ.
// Returns branching ratio n = α/β directly (unit-consistent).
function fitHawkes(ts, beta, now) {
  if (ts.length < 3) return { mu: 0, alpha: 0, branching: 0, lambdaNow: 0 };
  const b = beta * 1000;                              // convert per-ms β → per-second
  const T = (now - ts[0]) / 1000 || 1;               // seconds span
  const t = ts.map((x) => (x - ts[0]) / 1000);       // seconds since first
  const A = new Array(t.length).fill(0);              // recursive kernel A_i = Σ_{j<i} e^{-b(t_i-t_j)}
  for (let i = 1; i < t.length; i++) A[i] = Math.exp(-b * (t[i] - t[i - 1])) * (A[i - 1] + 1);
  let best = { ll: -Infinity, mu: 1e-3 / 86400, alpha: 0 };
  const muGrid = [1e-4, 5e-4, 1e-3, 5e-3, 1e-2].map((x) => x / 86400);   // per-second baselines
  const alGrid = [0, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9].map((x) => x * b);   // α = fraction of β (per-sec)
  for (const mu of muGrid) for (const alpha of alGrid) {
    let ll = 0;
    for (let i = 0; i < t.length; i++) { const lam = mu + alpha * A[i]; if (lam <= 0) { ll = -Infinity; break; } ll += Math.log(lam); }
    if (!Number.isFinite(ll)) continue;
    let integ = mu * T; for (const ti of t) integ += (alpha / b) * (1 - Math.exp(-b * (T - ti)));
    ll -= integ;
    if (ll > best.ll) best = { ll, mu, alpha };
  }
  let An = 0; for (let i = 0; i < t.length; i++) An += Math.exp(-b * (T - t[i]));
  return { mu: best.mu, alpha: best.alpha, branching: best.alpha / b, lambdaNow: (best.mu + best.alpha * An) * 86400 };
}

// ── Source credibility + independence-adjusted corroboration (noisy-OR) ──
const SOURCE_RELIABILITY = { reuters: 0.95, bloomberg: 0.95, "associated press": 0.92, ap: 0.92, "wall street journal": 0.9, wsj: 0.9, cnbc: 0.85, barron: 0.85, "financial times": 0.9, ft: 0.9, marketwatch: 0.8, yahoo: 0.75, "seeking alpha": 0.6, benzinga: 0.6, "motley fool": 0.5, zacks: 0.65, "the street": 0.65, investorplace: 0.5, google: 0.7 };
function reliabilityOf(source) {
  const s = String(source || "").toLowerCase();
  for (const k of Object.keys(SOURCE_RELIABILITY)) if (s.includes(k)) return SOURCE_RELIABILITY[k];
  return 0.55; // unknown source prior
}
// noisy-OR confidence across INDEPENDENT source families for a corroborated claim.
function corroborationConfidence(sourceList) {
  const fams = new Map();
  for (const s of sourceList) { const r = reliabilityOf(s); const key = String(s || "").toLowerCase().split(/[ .-]/)[0]; if (!fams.has(key) || fams.get(key) < r) fams.set(key, r); }
  let prodMiss = 1; for (const r of fams.values()) prodMiss *= (1 - r);
  return { confidence: +(1 - prodMiss).toFixed(3), independentSources: fams.size };
}

// ── Cross-asset propagation via transfer entropy (who-moves-whom), signed by correlation ──
function propagate(newsDir, subjectRets, neighbors) {
  // neighbors: [{sym, kind, rets, defaultSign}]
  const out = [];
  for (const nb of neighbors) {
    if (!nb.rets || nb.rets.length < 20) { out.push({ sym: nb.sym, kind: nb.kind, te: null, rho: null, effect: 0, dir: "flat", lead: null }); continue; }
    const teSubjToNb = transferEntropyGaussian(subjectRets, nb.rets, 1);
    const teNbToSubj = transferEntropyGaussian(nb.rets, subjectRets, 1);
    const rho = corr(subjectRets, nb.rets);
    const netLead = teSubjToNb - teNbToSubj;              // >0: subject leads neighbor → tradeable pre-position
    const sign = rho >= 0 ? 1 : -1;                       // co-move vs inverse (competitor share-shift)
    const effect = clamp(newsDir * sign * Math.abs(rho) * (0.5 + clamp(netLead * 4, 0, 0.5)), -1, 1);
    out.push({
      sym: nb.sym, kind: nb.kind, te: +teSubjToNb.toFixed(3), rho: +rho.toFixed(2),
      lead: netLead > 0.005 ? "subject leads" : netLead < -0.005 ? "neighbor leads" : "coincident",
      effect: +effect.toFixed(2), dir: effect > 0.03 ? "up" : effect < -0.03 ? "down" : "flat",
    });
  }
  out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
  return out;
}

// ── Compression signal: high news-volume + low realized move = coiled spring (vol expansion) ──
function compression(abnCoverage, realizedVolZ) {
  const s = abnCoverage - realizedVolZ;
  return { score: +s.toFixed(2), signal: s > 1.5 ? "COILED — vol expansion likely (breakout/straddle)" : s < -1.5 ? "EXHAUSTED — move done, expect calm" : "neutral" };
}

function rets(bars) { const c = (bars || []).map((b) => b.c); const o = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) o.push(Math.log(c[i] / c[i - 1])); return o; }
function corr(a, b) { const n = Math.min(a.length, b.length); if (n < 5) return 0; const A = a.slice(-n), B = b.slice(-n); const ma = mean(A), mb = mean(B); let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (A[i] - ma) * (B[i] - mb); da += (A[i] - ma) ** 2; db += (B[i] - mb) ** 2; } return da > 0 && db > 0 ? clamp(num / Math.sqrt(da * db), -1, 1) : 0; }

module.exports = { grammarScore, marketModel, reactionGap, velocity, fitHawkes, corroborationConfidence, reliabilityOf, propagate, compression, rets };
