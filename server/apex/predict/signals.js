// APEX Oracle — signal packages. Builds normalized sub-scores in [-1,1] from technical,
// peer/substitute, sector-ETF, news, and macro inputs, then combines into one crossScore.
// Injected fetchers: getBars(symbol,{interval,range})->bars ; getNews(symbol)->[{title,sentiment?}] (optional).

const { ema, std, logRets, clamp, nz, mean } = require("./mathx");

// Compact peer / sector-ETF map for common names. Unknown → market (SPY) only.
const PEERS = {
  NVDA: { etf: "XLK", peers: ["AMD", "AVGO", "TSM", "QCOM", "INTC"] },
  AMD: { etf: "XLK", peers: ["NVDA", "INTC", "AVGO", "QCOM", "MU"] },
  AAPL: { etf: "XLK", peers: ["MSFT", "GOOGL", "META", "AMZN", "DELL"] },
  MSFT: { etf: "XLK", peers: ["AAPL", "GOOGL", "AMZN", "ORCL", "CRM"] },
  GOOGL: { etf: "XLC", peers: ["META", "MSFT", "AMZN", "NFLX", "AAPL"] },
  META: { etf: "XLC", peers: ["GOOGL", "SNAP", "PINS", "NFLX", "MSFT"] },
  AMZN: { etf: "XLY", peers: ["WMT", "TGT", "SHOP", "MELI", "COST"] },
  TSLA: { etf: "XLY", peers: ["RIVN", "LCID", "F", "GM", "NIO"] },
  JPM: { etf: "XLF", peers: ["BAC", "WFC", "C", "GS", "MS"] },
  XOM: { etf: "XLE", peers: ["CVX", "COP", "SLB", "OXY", "PSX"] },
  SPY: { etf: "SPY", peers: ["QQQ", "DIA", "IWM"] },
};

// Pearson correlation of two aligned return series.
function corr(a, b) {
  const n = Math.min(a.length, b.length); if (n < 5) return 0;
  const A = a.slice(-n), B = b.slice(-n);
  const ma = mean(A), mb = mean(B); let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (A[i] - ma) * (B[i] - mb); da += (A[i] - ma) ** 2; db += (B[i] - mb) ** 2; }
  return da > 0 && db > 0 ? clamp(num / Math.sqrt(da * db), -1, 1) : 0;
}
const momentum = (closes, n) => (closes.length > n && closes[closes.length - 1 - n] > 0 ? closes[closes.length - 1] / closes[closes.length - 1 - n] - 1 : 0);

// Technical sub-score from the symbol's own bars.
function technicalPackage(bars) {
  const c = bars.map((b) => b.c); const rets = logRets(c); if (c.length < 30) return { score: 0, parts: {} };
  const last = (a) => a[a.length - 1];
  const e20 = last(ema(c, 20)), e50 = last(ema(c, 50));
  const px = last(c);
  // RSI(14)
  let ag = 0, al = 0; for (let i = Math.max(1, c.length - 14); i < c.length; i++) { const ch = c[i] - c[i - 1]; if (ch > 0) ag += ch; else al -= ch; } const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  const macdHist = last(ema(c, 12)) - last(ema(c, 26)) - (last(ema(c.map((_, i) => ema(c, 12)[i] - ema(c, 26)[i]), 9)));
  const volZ = rets.length > 20 ? (last(rets) - mean(rets.slice(-20))) / (std(rets.slice(-20)) || 1) : 0;
  const parts = {
    trend: clamp(((px > e20 ? 1 : -1) + (e20 > e50 ? 1 : -1)) / 2, -1, 1),
    rsi: clamp((rsi - 50) / 50, -1, 1),
    macd: clamp(Math.tanh(macdHist / (px * 0.01 || 1)), -1, 1),
    mom: clamp(Math.tanh(momentum(c, 20) * 8), -1, 1),
    vol: clamp(-Math.tanh(volZ / 3), -1, 1),
  };
  const score = clamp(0.3 * parts.trend + 0.2 * parts.mom + 0.2 * parts.macd + 0.2 * parts.rsi + 0.1 * parts.vol, -1, 1);
  return { score, parts, rsi };
}

async function buildPackages(symbol, bars, deps = {}) {
  const { getBars, getNews } = deps;
  const tk = symbol.toUpperCase();
  const tech = technicalPackage(bars);
  const cRets = logRets(bars.map((b) => b.c));
  const pkg = { technical: tech.score, news: 0, peer: 0, sector: 0, macro: 0 };
  const detail = { technical: tech.parts, peers: [], sector: null, news: null };

  // Peers + sector (best-effort, parallel, tolerant of failures)
  const cfg = PEERS[tk] || { etf: "SPY", peers: [] };
  if (getBars) {
    const targets = [...cfg.peers.slice(0, 5), cfg.etf];
    const results = await Promise.allSettled(targets.map((s) => getBars(s, { interval: "1d", range: "6mo" })));
    const symDaily = null; // we compare on daily returns; fetch symbol daily too
    let symD = [];
    try { const sb = await getBars(tk, { interval: "1d", range: "6mo" }); symD = logRets(sb.map((b) => b.c)); } catch { symD = cRets; }
    const peerScores = [];
    results.forEach((r, i) => {
      const name = targets[i]; if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
      const pr = logRets(r.value.map((b) => b.c)); const rho = corr(symD, pr);
      const closes = r.value.map((b) => b.c); const pm = momentum(closes, 20);
      if (name === cfg.etf) {
        const symMom = momentum(bars.map((b) => b.c), 20 * 6.5 | 0) || momentum(bars.map((b) => b.c), 20);
        detail.sector = { etf: name, rho: +rho.toFixed(2), etfMom: +(pm * 100).toFixed(2) };
        pkg.sector = clamp(0.5 * Math.sign(pm) + 0.5 * Math.tanh((symMom - pm) * 6), -1, 1);
      } else {
        peerScores.push({ sym: name, rho, mom: pm });
        detail.peers.push({ sym: name, rho: +rho.toFixed(2), mom: +(pm * 100).toFixed(2), kind: rho > 0.4 ? "substitute" : "related" });
      }
    });
    if (peerScores.length) {
      const peerAvgMom = mean(peerScores.map((p) => p.mom));
      const symMom = momentum(bars.map((b) => b.c), 20);
      // convergence pressure: if peers lead the stock, expect catch-up
      pkg.peer = clamp(Math.tanh((peerAvgMom - symMom) * 6) * mean(peerScores.map((p) => Math.abs(p.rho))), -1, 1);
    }
  }

  // Macro package — VIX (risk), 10y yield trend, dollar. Free via Yahoo index symbols (no FRED key).
  if (getBars) {
    try {
      const [vix, tnx, dxy] = await Promise.allSettled([getBars("^VIX", { interval: "1d", range: "3mo" }), getBars("^TNX", { interval: "1d", range: "3mo" }), getBars("DX-Y.NYB", { interval: "1d", range: "3mo" })]);
      const series = (r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value.map((b) => b.c) : []);
      const vc = series(vix), tc = series(tnx), dc = series(dxy);
      const level = vc.length ? vc[vc.length - 1] : null;
      const vixRisk = level != null ? clamp(-(level - 18) / 12, -1, 1) : 0; // high VIX → risk-off (negative)
      const trend = (a) => (a.length > 10 ? Math.tanh((a[a.length - 1] / a[a.length - 11] - 1) * 8) : 0);
      pkg.macro = clamp(0.5 * vixRisk - 0.25 * trend(tc) - 0.25 * trend(dc), -1, 1);
      detail.macro = { vix: level != null ? +level.toFixed(1) : null, tnxTrend: +trend(tc).toFixed(2), usdTrend: +trend(dc).toFixed(2), score: +pkg.macro.toFixed(2) };
    } catch { /* skip */ }
  }

  // News (optional injected)
  if (getNews) {
    try {
      const items = await getNews(tk);
      if (Array.isArray(items) && items.length) {
        const scored = items.slice(0, 20).map((n, i) => (n.sentiment != null ? n.sentiment : lexScore(n.title || "")) * Math.exp(-i / 8));
        const wsum = items.slice(0, 20).reduce((s, _, i) => s + Math.exp(-i / 8), 0) || 1;
        pkg.news = clamp(scored.reduce((s, x) => s + x, 0) / wsum, -1, 1);
        detail.news = { count: items.length, score: +pkg.news.toFixed(2) };
      }
    } catch { /* skip */ }
  }

  // Combine with default weights (tech leads); macro left 0 unless wired.
  const w = { technical: 0.4, sector: 0.2, peer: 0.15, news: 0.15, macro: 0.1 };
  const crossScore = clamp(Object.keys(w).reduce((s, k) => s + w[k] * (pkg[k] || 0), 0) / Object.values(w).reduce((a, b) => a + b, 0), -1, 1);
  return { crossScore, packages: pkg, detail, weights: w };
}

// Tiny finance sentiment lexicon fallback (Loughran-McDonald flavored).
const POS_W = ["beat", "beats", "surge", "surges", "soar", "soars", "rally", "gains", "gain", "up", "record", "strong", "growth", "upgrade", "raises", "raised", "outperform", "bullish", "profit", "wins", "approval", "tops"];
const NEG_W = ["miss", "misses", "plunge", "plunges", "fall", "falls", "drop", "drops", "cut", "cuts", "downgrade", "weak", "loss", "losses", "lawsuit", "probe", "warning", "warns", "bearish", "slump", "recall", "halt", "delay"];
function lexScore(title) {
  const t = String(title).toLowerCase(); let p = 0, n = 0;
  for (const w of POS_W) if (t.includes(w)) p++;
  for (const w of NEG_W) if (t.includes(w)) n++;
  return (p - n) / (p + n + 1);
}

module.exports = { buildPackages, technicalPackage, lexScore, PEERS };
