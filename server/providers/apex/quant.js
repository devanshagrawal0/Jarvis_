"use strict";
/* APEX quant computations — correlation, sector RRG, and realized volatility,
   all derived from PUBLIC daily price bars (Yahoo). No options/IV data and no
   local/proprietary data: realized vol = stdev of log returns, annualized.
   CommonJS. */

function logReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}
function stdev(a) {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  const v = a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((x, y) => x + y, 0) / n, mb = bx.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ax[i] - ma, y = bx[i] - mb; num += x * y; da += x * x; db += y * y; }
  const d = Math.sqrt(da * db);
  return d ? num / d : 0;
}

const SECTORS = [["XLK", "Technology"], ["XLF", "Financials"], ["XLE", "Energy"], ["XLV", "Health Care"], ["XLY", "Cons. Disc."], ["XLP", "Cons. Staples"], ["XLI", "Industrials"], ["XLC", "Comm. Svcs"], ["XLU", "Utilities"], ["XLB", "Materials"], ["XLRE", "Real Estate"]];

function createQuant({ adapters }) {
  const A = adapters;
  async function closesFor(sym, range = "6mo") {
    try { const c = await A.yahooChart(sym, range, "1d"); return (c.bars || []).filter((b) => b.c != null).map((b) => b.c); }
    catch { return []; }
  }

  // Pairwise Pearson correlation of daily log returns (public bars). Fetched in
  // small batches to avoid throttling; returns matrix + per-node day change.
  async function correlation(symbols) {
    const series = {}, chg = {};
    for (let i = 0; i < symbols.length; i += 6) {
      await Promise.all(symbols.slice(i, i + 6).map(async (s) => {
        const c = await closesFor(s, "6mo");
        series[s] = logReturns(c);
        chg[s] = c.length > 1 && c[c.length - 2] ? +(((c[c.length - 1] - c[c.length - 2]) / c[c.length - 2]) * 100).toFixed(2) : null;
      }));
    }
    const syms = symbols.filter((s) => (series[s] || []).length > 15);
    const matrix = syms.map((a) => syms.map((b) => +pearson(series[a], series[b]).toFixed(2)));
    const nodes = syms.map((s) => ({ sym: s, changePct: chg[s] }));
    return { symbols: syms, nodes, matrix, updated: new Date().toISOString() };
  }

  // Relative-Rotation-Graph approximation: each sector ETF's relative strength
  // vs SPY (RS-Ratio ~100) and its momentum (RS-Momentum ~100). Public bars.
  async function rrg() {
    const spy = await closesFor("SPY", "6mo");
    if (spy.length < 40) return [];
    const out = [];
    await Promise.all(SECTORS.map(async ([etf, name]) => {
      const c = await closesFor(etf, "6mo");
      if (c.length < 40) return;
      const n = Math.min(c.length, spy.length);
      const rs = [];
      for (let i = 0; i < n; i++) { const e = c[c.length - n + i], s = spy[spy.length - n + i]; if (s > 0) rs.push(e / s); }
      if (rs.length < 20) return;
      const normAt = (endIdx, lb = 10) => { const win = rs.slice(endIdx - lb, endIdx); const base = win.reduce((x, y) => x + y, 0) / win.length; return base ? (rs[endIdx - 1] / base) * 100 : 100; };
      const rsRatio = normAt(rs.length, 10);
      const rsPrev = normAt(rs.length - 5, 10);
      const rsMomentum = 100 + (rsRatio - rsPrev);
      out.push({ etf, name, rsRatio: +rsRatio.toFixed(2), rsMomentum: +rsMomentum.toFixed(2) });
    }));
    return out;
  }

  // Realized-vol CONE (annualized) — for each horizon, the historical percentile
  // band of that horizon's rolling RV + the current reading. Public prices only.
  async function realizedVol(sym) {
    const c = await closesFor(sym, "2y");
    const rets = logReturns(c);
    if (rets.length < 60) return null;
    const horizons = [10, 20, 30, 60, 90, 120].filter((w) => rets.length >= w + 20);
    const cone = horizons.map((w) => {
      const roll = [];
      for (let i = w; i <= rets.length; i++) roll.push(stdev(rets.slice(i - w, i)) * Math.sqrt(252) * 100);
      roll.sort((a, b) => a - b);
      const pct = (p) => +roll[Math.floor((roll.length - 1) * p)].toFixed(1);
      return { w, min: pct(0), p25: pct(0.25), median: pct(0.5), p75: pct(0.75), max: pct(1), cur: +(stdev(rets.slice(-w)) * Math.sqrt(252) * 100).toFixed(1) };
    });
    return { symbol: sym, cone };
  }

  // Monte-Carlo GBM projection: exact analytical percentile fan + simulated
  // sample paths + probability-of-touch. Drift/vol estimated from public bars.
  function gaussian() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  async function monteCarlo(sym, { days = 30, sims = 2000, target = null } = {}) {
    const c = await closesFor(sym, "1y");
    const rets = logReturns(c);
    if (rets.length < 20 || !c.length) return null;
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length; // daily log drift
    const sigma = stdev(rets);
    const S0 = c[c.length - 1];
    const Z = { p5: -1.645, p25: -0.674, p50: 0, p75: 0.674, p95: 1.645 };
    const bands = [];
    for (let t = 1; t <= days; t++) {
      const drift = (mu - sigma * sigma / 2) * t, vol = sigma * Math.sqrt(t);
      bands.push({ t, p5: +(S0 * Math.exp(drift + Z.p5 * vol)).toFixed(2), p25: +(S0 * Math.exp(drift + Z.p25 * vol)).toFixed(2), p50: +(S0 * Math.exp(drift + Z.p50 * vol)).toFixed(2), p75: +(S0 * Math.exp(drift + Z.p75 * vol)).toFixed(2), p95: +(S0 * Math.exp(drift + Z.p95 * vol)).toFixed(2) });
    }
    let touch = 0; const paths = []; const sampleN = 14;
    for (let s = 0; s < sims; s++) {
      let S = S0; const path = [S0]; let hit = false;
      for (let t = 1; t <= days; t++) { S = S * Math.exp((mu - sigma * sigma / 2) + sigma * gaussian()); path.push(S); if (target != null && ((target >= S0 && S >= target) || (target < S0 && S <= target))) hit = true; }
      if (hit) touch++;
      if (s < sampleN) paths.push(path.map((x) => +x.toFixed(2)));
    }
    return { symbol: sym, S0: +S0.toFixed(2), days, driftAnnPct: +(mu * 252 * 100).toFixed(1), volAnnPct: +(sigma * Math.sqrt(252) * 100).toFixed(1), bands, paths, target, probTouch: target != null ? +(touch / sims).toFixed(3) : null };
  }

  // ── G4 Quant Lab: risk decomposition for a symbol vs the market ──
  // All from public daily bars: EWMA vol, historical VaR/CVaR, max drawdown,
  // Sharpe, beta vs SPY, and a return-distribution histogram.
  async function riskLab(sym) {
    const [c, spyC] = await Promise.all([closesFor(sym, "2y"), closesFor("SPY", "2y")]);
    const rets = logReturns(c);
    if (rets.length < 60) return null;
    const ann = Math.sqrt(252);
    const realizedVol = +(stdev(rets) * ann * 100).toFixed(1);
    // EWMA (RiskMetrics λ=0.94)
    let ew = rets[0] * rets[0];
    for (let i = 1; i < rets.length; i++) ew = 0.94 * ew + 0.06 * rets[i] * rets[i];
    const ewmaVol = +(Math.sqrt(ew) * ann * 100).toFixed(1);
    // Historical 1-day VaR / CVaR (loss is positive %)
    const sorted = [...rets].sort((a, b) => a - b);
    const q = (p) => sorted[Math.max(0, Math.floor((sorted.length - 1) * p))];
    const varCvar = (p) => { const cut = q(p); const tail = sorted.filter((r) => r <= cut); const cv = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : cut; return { var: +(-cut * 100).toFixed(2), cvar: +(-cv * 100).toFixed(2) }; };
    const var95 = varCvar(0.05), var99 = varCvar(0.01);
    // Max drawdown from the price path
    let peak = c[0], maxDD = 0;
    for (const p of c) { if (p > peak) peak = p; const dd = (p - peak) / peak; if (dd < maxDD) maxDD = dd; }
    // Sharpe (annualized, rf=0) overall + rolling 60d for a sparkline
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sharpe = +((mean * 252) / (stdev(rets) * ann) || 0).toFixed(2);
    const rollSharpe = [];
    for (let i = 60; i <= rets.length; i += 2) { const w = rets.slice(i - 60, i); const mw = w.reduce((a, b) => a + b, 0) / w.length; const sw = stdev(w); rollSharpe.push(+((mw * 252) / (sw * ann) || 0).toFixed(2)); }
    // Beta vs SPY (aligned tail)
    const spyR = logReturns(spyC); const n = Math.min(rets.length, spyR.length);
    const a1 = rets.slice(-n), b1 = spyR.slice(-n);
    const mb = b1.reduce((x, y) => x + y, 0) / n, ma = a1.reduce((x, y) => x + y, 0) / n;
    let cov = 0, vb = 0; for (let i = 0; i < n; i++) { cov += (a1[i] - ma) * (b1[i] - mb); vb += (b1[i] - mb) * (b1[i] - mb); }
    const beta = vb ? +(cov / vb).toFixed(2) : null;
    // Return distribution histogram (daily %, ~19 bins)
    const pct = rets.map((r) => r * 100);
    const lo = Math.min(...pct), hi = Math.max(...pct), BINS = 19, span = (hi - lo) || 1;
    const hist = new Array(BINS).fill(0);
    pct.forEach((v) => { const b = Math.min(BINS - 1, Math.floor(((v - lo) / span) * BINS)); hist[b]++; });
    const bins = hist.map((count, i) => ({ x: +(lo + (i + 0.5) * (span / BINS)).toFixed(2), count }));
    return { symbol: sym, realizedVol, ewmaVol, var95: var95.var, cvar95: var95.cvar, var99: var99.var, cvar99: var99.cvar, maxDD: +(maxDD * 100).toFixed(1), sharpe, rollSharpe: rollSharpe.slice(-40), beta, days: rets.length, bins };
  }

  // Statistical anomaly scanner: today's return z-score vs each name's trailing
  // 60-day return distribution. Flags moves that are statistical outliers.
  async function anomalies(symbols) {
    const out = [];
    for (let i = 0; i < symbols.length; i += 6) {
      await Promise.all(symbols.slice(i, i + 6).map(async (s) => {
        const c = await closesFor(s, "6mo"); const r = logReturns(c);
        if (r.length < 40) return;
        const today = r[r.length - 1]; const hist = r.slice(-61, -1);
        const m = hist.reduce((a, b) => a + b, 0) / hist.length; const sd = stdev(hist);
        if (!sd) return;
        const z = (today - m) / sd;
        out.push({ sym: s, changePct: +(today * 100).toFixed(2), z: +z.toFixed(2), sigma: +Math.abs(z).toFixed(1) });
      }));
    }
    out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    return { updated: new Date().toISOString(), items: out };
  }

  return { correlation, rrg, realizedVol, monteCarlo, riskLab, anomalies, SECTORS };
}

module.exports = { createQuant };
