"use strict";
/* APEX ingestion orchestrator — wires the source registry (apex-db) to the
   rate governor and the keyless adapters, keeps hot caches, runs the Binance
   depth WebSocket, and exposes read getters for the /api/apex/* routes and a
   data-health check for the health bot. CommonJS. Wave-1 (keyless) scope. */

const { createGovernor } = require("./providers/apex/governor");
const { createDataCatalog } = require("./providers/apex/catalog");
const { createNewsEngine } = require("./providers/apex/news-engine");
const { createQuant } = require("./providers/apex/quant");
const A = require("./providers/apex/adapters");
const KA = require("./providers/apex/keyed-adapters");

const DEFAULT_EQ = ["^GSPC", "^IXIC", "^DJI", "^VIX", "NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "META"];
const DEFAULT_CRYPTO = ["BTCUSDT", "ETHUSDT"];

function createApexIngest({ apexDb, WebSocketImpl }) {
  const hot = { quotes: {}, orderbook: {}, overview: { indices: [], updated: null }, gainers: [], nws: [], yields: [], cryptoGlobal: null, macro: [], macroAlt: { cboe: null, cftc: null, nasdaq: null, kenFrench: null, bls: null, fed: null, defi: null, updated: null }, movers: { stocks: { gainers: [], losers: [] }, crypto: { gainers: [], losers: [] } }, insider: [], regime: null, internals: null, sectors: [], session: [], correlation: null, rrg: [], depthHistory: [], trades: [], cryptoFng: null, attention: null, form4: [], btcNet: null, anomalies: null };
  const quant = createQuant({ adapters: A });
  const gov = createGovernor({
    onHealth: (id, health, err) => { try { apexDb.setSourceHealth(id, health === "ok" ? "ok" : "degraded", err || null); } catch { /* db optional */ } },
  });
  const catalog = createDataCatalog({ apexDb });
  const watchlist = DEFAULT_EQ.filter((t) => !t.startsWith("^"));
  const keyPresent = KA.keysPresent();
  const newsEngine = createNewsEngine({ apexDb, adapters: A, getWatchlist: () => watchlist, keyed: KA });
  let binanceWs = null;
  let tradesWs = null;
  let stopped = false;
  let newsState = { status: "idle", lastRun: null };
  let lastHealthFixes = []; // proposed fixes from the most recent health check (for the apply step)

  // ── pollers ───────────────────────────────────────────────
  async function pollEquities() {
    const qs = await A.yahooQuotes(DEFAULT_EQ);
    for (const q of qs) { hot.quotes[q.ticker] = q; try { apexDb.upsertQuote({ ticker: q.ticker, last: q.last, prev_c: q.prev }); } catch { /* noop */ } }
    hot.overview = { indices: qs.filter((q) => q.ticker.startsWith("^")), updated: isoNowSafe() };
    computeRegime(); // refresh regime with the latest index momentum
  }
  async function pollCrypto() {
    for (const s of DEFAULT_CRYPTO) { const t = await A.binance24h(s); hot.quotes[s] = t; }
    if (!binanceWs) hot.orderbook.BTCUSDT = await A.binanceDepth("BTCUSDT", 50); // WS keeps it fresh once open
  }
  async function pollNews() {
    // Wave-4 engine: multi-lane ingest → cluster → verify → impact-map → rank → decay.
    const r = await newsEngine.run();
    newsState = { status: r.ok ? "ok" : "empty", lastRun: isoNowSafe(), ...r };
  }
  async function pollNws() { hot.nws = await A.nwsAlerts(); }
  async function pollYields() { hot.yields = await A.treasuryYields(); }
  async function pollGainers() { hot.gainers = await A.tvScan(15); }

  // Sector ETFs → real sector heatmap.
  const SECTOR_ETFS = [["XLK", "Technology"], ["XLF", "Financials"], ["XLE", "Energy"], ["XLV", "Health Care"], ["XLY", "Cons. Disc."], ["XLP", "Cons. Staples"], ["XLI", "Industrials"], ["XLC", "Comm. Svcs"], ["XLU", "Utilities"], ["XLB", "Materials"], ["XLRE", "Real Estate"]];
  async function pollSectors() {
    try {
      const qs = await A.yahooQuotes(SECTOR_ETFS.map((s) => s[0]));
      const byT = Object.fromEntries(qs.map((q) => [q.ticker, q]));
      hot.sectors = SECTOR_ETFS.map(([etf, name]) => ({ etf, name, changePct: byT[etf] ? byT[etf].changePct : null })).filter((s) => s.changePct != null);
    } catch { /* noop */ }
  }
  // Per-index session: yesterday close → today open (gap) → day range → last.
  const SESSION_IDX = [["^GSPC", "S&P 500"], ["^IXIC", "NASDAQ"], ["^DJI", "Dow Jones"], ["^VIX", "VIX"]];
  async function pollSession() {
    const out = [];
    for (const [sym, name] of SESSION_IDX) {
      try {
        const ch = await A.yahooChart(sym, "5d", "1d");
        const bars = (ch.bars || []).filter((b) => b.c != null);
        if (bars.length < 2) continue;
        const last = bars[bars.length - 1], prev = bars[bars.length - 2];
        out.push({ ticker: sym, name, prevClose: prev.c, open: last.o, dayHi: last.h, dayLo: last.l, last: last.c,
          changePct: prev.c ? ((last.c - prev.c) / prev.c) * 100 : null, gap: prev.c ? ((last.o - prev.c) / prev.c) * 100 : null });
      } catch { /* skip one */ }
    }
    if (out.length) hot.session = out;
  }

  // Quant (public-data): correlation of watchlist + a couple of ETFs; sector RRG.
  // Market network: watchlist + majors + key sector ETFs + cross-asset (bonds/gold/oil).
  const NETWORK_UNIVERSE = [...new Set([...watchlist, "SPY", "QQQ", "DIA", "IWM", "GLD", "TLT", "USO", "XLK", "XLF", "XLE", "XLV", "XLY", "XLI"])];
  async function pollCorrelation() { try { const c = await quant.correlation(NETWORK_UNIVERSE); if (c.symbols.length) hot.correlation = c; } catch { /* keep last */ } }
  async function pollRRG() { try { const r = await quant.rrg(); if (r.length) hot.rrg = r; } catch { /* keep last */ } }
  async function pollAnomalies() { try { const a = await quant.anomalies(NETWORK_UNIVERSE); if (a && a.items.length) hot.anomalies = a; } catch { /* keep last */ } }

  // Assemble a data-grounded market brief (deterministic — no LLM). type: now|morning|eod.
  function getBrief(type = "now") {
    const r = hot.regime; const m = hot.movers; const sec = hot.sectors || []; const macro = hot.macro || [];
    const news = (() => { try { return apexDb.listStories(5); } catch { return []; } })();
    const best = sec.length ? [...sec].sort((a, b) => b.changePct - a.changePct)[0] : null;
    const worst = sec.length ? [...sec].sort((a, b) => a.changePct - b.changePct)[0] : null;
    const idx = hot.session.length ? hot.session : (hot.overview.indices || []).map((q) => ({ name: q.ticker, changePct: q.changePct, last: q.last }));
    const lead = idx.filter((i) => i.name !== "VIX").sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))[0];
    const tenY = macro.find((x) => x.series === "DGS10");
    const pctS = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    const idxLine = idx.filter((i) => i.name !== "VIX").map((i) => `${i.name} ${pctS(i.changePct)}`).join(", ");
    const narrative = r
      ? `US markets are ${r.label} (${r.score}/100). ${idxLine}.` +
        (best && worst ? ` ${best.name} ${pctS(best.changePct)} leads, ${worst.name} ${pctS(worst.changePct)} lags.` : "") +
        (r.pctUp != null ? ` Breadth ${Math.round(r.pctUp * 100)}% advancing.` : "") +
        (r.vix != null ? ` VIX ${r.vix.toFixed(1)} (${r.fearGreedLabel}).` : "") +
        (news[0] ? ` Top story: "${news[0].title}".` : "")
      : "Computing live market read…";
    const watch = [];
    if (lead) watch.push(`${lead.name} ${lead.changePct != null && lead.changePct >= 0 ? "leading up" : "leading down"} ${pctS(lead.changePct)}`);
    if (m.stocks.gainers[0]) watch.push(`${m.stocks.gainers[0].ticker} top gainer ${pctS(m.stocks.gainers[0].changePct)}`);
    if (tenY && tenY.value != null) watch.push(`10Y Treasury at ${tenY.value}%`);
    if (r && r.vix != null && r.vix > 20) watch.push(`Elevated VIX ${r.vix.toFixed(1)} — hedge risk`);
    if (news[0]) { const t = (news[0].impact && news[0].impact.tickers || []).map((x) => x.t || x.s).filter(Boolean)[0]; if (t) watch.push(`News driver: ${t}`); }
    return {
      type, asOf: isoNowSafe(),
      headline: r ? `${r.label} · ${lead ? lead.name + " " + pctS(lead.changePct) : "markets mixed"}` : "Market brief",
      regime: r ? { score: r.score, label: r.label, fearGreed: r.fearGreedLabel, vix: r.vix, breadthPctUp: r.pctUp, momentum: r.momentum } : null,
      narrative,
      session: hot.session,
      movers: { gainers: m.stocks.gainers.slice(0, 3), losers: m.stocks.losers.slice(0, 3) },
      sectors: { best, worst },
      macro: macro.map((x) => ({ series: x.label, value: x.value, unit: x.unit })),
      topNews: news.map((s) => ({ title: s.title, lane: s.impact && s.impact.lane, tickers: ((s.impact && s.impact.tickers) || []).map((t) => t.t || t.s).filter(Boolean) })),
      watch: watch.slice(0, 4),
    };
  }

  // Real market breadth + regime + fear/greed, computed from live inputs (VIX, index momentum, breadth).
  async function pollRegime() {
    let breadth = null;
    try { breadth = await A.tvBreadth(); } catch { /* keep last */ }
    if (breadth) hot.internals = { ...breadth, updated: isoNowSafe() };
    computeRegime();
  }
  function computeRegime() {
    const idx = hot.overview.indices || [];
    const chg = (t) => { const q = idx.find((i) => i.ticker === t); return q && q.changePct != null ? q.changePct : null; };
    const mom = [chg("^GSPC"), chg("^IXIC"), chg("^DJI")].filter((x) => x != null);
    const momentum = mom.length ? mom.reduce((a, b) => a + b, 0) / mom.length : null;
    const vixQ = idx.find((i) => i.ticker === "^VIX"); const vix = vixQ ? vixQ.last : null;
    const pctUp = hot.internals ? hot.internals.pctUp : null;
    // Composite 0-100: neutral 50, adjusted by momentum, VIX level, breadth.
    let score = 50;
    if (momentum != null) score += Math.max(-18, Math.min(18, momentum * 9));
    if (vix != null) score += Math.max(-15, Math.min(12, (17 - vix) * 1.4));
    if (pctUp != null) score += Math.max(-18, Math.min(18, (pctUp - 0.5) * 44));
    score = Math.round(Math.max(2, Math.min(98, score)));
    const label = score >= 66 ? "RISK-ON" : score >= 54 ? "BULLISH LEAN" : score >= 46 ? "NEUTRAL" : score >= 34 ? "RISK-OFF LEAN" : "RISK-OFF";
    const fg = score; // fear/greed uses the same composite
    const fgLabel = fg >= 75 ? "Extreme Greed" : fg >= 58 ? "Greed" : fg >= 43 ? "Neutral" : fg >= 25 ? "Fear" : "Extreme Fear";
    hot.regime = { score, label, momentum, vix, pctUp, fearGreed: fg, fearGreedLabel: fgLabel, updated: isoNowSafe() };
  }

  // ── keyed movers + insider (Wave 6 real data) ──
  async function pollMovers() {
    try { const st = await A.tvMovers(3); hot.movers.stocks = st; } catch { /* keep last */ }
    if (keyPresent.coingecko) { try { hot.movers.crypto = await KA.coingeckoMovers(3); } catch { /* keep last */ } }
  }
  async function pollInsider() {
    if (!keyPresent.finnhub) return;
    const all = [];
    for (const s of watchlist) {
      try { const tx = await KA.finnhubInsider(s); all.push(...tx); } catch { /* skip one */ }
    }
    // most recent, meaningful (non-zero) transactions first
    all.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Math.abs(b.value) - Math.abs(a.value));
    if (all.length) hot.insider = all.slice(0, 40); // never clobber last-good data with an empty (rate-limited) cycle
  }
  // ── alt-data pollers (Wave G3), keyless ──
  async function pollFng() { try { const f = await A.cryptoFearGreed(30); if (f) hot.cryptoFng = f; } catch { /* keep last */ } }
  async function pollAttention() { try { const a = await A.wikiAttention(Date.now()); if (a && a.items.length) hot.attention = a; } catch { /* keep last */ } }
  async function pollForm4() { try { const f = await A.secFormFour(30); if (f && f.length) hot.form4 = f; } catch { /* keep last */ } }
  async function pollBtcNet() { try { const b = await A.btcNetwork(); if (b) hot.btcNet = b; } catch { /* keep last */ } }
  async function pollCboe() { try { const x = await A.cboeMarketSnapshot(); if (x) { hot.macroAlt.cboe = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollCftc() { try { const x = await A.cftcCotSnapshot(); if (x && x.items && x.items.length) { hot.macroAlt.cftc = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollNasdaqSymbols() { try { const x = await A.nasdaqTraderSymbols(); if (x && x.total) { hot.macroAlt.nasdaq = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollKenFrench() { try { const x = await A.kenFrenchSnapshot(); if (x && x.date) { hot.macroAlt.kenFrench = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollBls() { try { const x = await A.blsSnapshot(); if (x && x.series && x.series.length) { hot.macroAlt.bls = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollFed() { try { const x = await A.fedH15Snapshot(); if (x) { hot.macroAlt.fed = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }
  async function pollDefi() { try { const x = await A.defiLlamaSnapshot(); if (x) { hot.macroAlt.defi = x; hot.macroAlt.updated = isoNowSafe(); } } catch { /* keep last */ } }

  // ── keyed pollers (Wave 3) — only registered when the key is present ──
  async function pollFinnhubQuotes() {
    for (const s of watchlist) {
      try { const q = await KA.finnhubQuote(s); if (q && q.last != null) { hot.quotes[s] = q; apexDb.upsertQuote({ ticker: s, last: q.last, prev_c: q.prev }); } } catch { /* skip one */ }
    }
  }
  async function pollCryptoGlobal() { try { const g = await KA.coingeckoGlobal(); if (g) hot.cryptoGlobal = { ...g, updated: isoNowSafe() }; } catch { /* noop */ } }
  async function pollMacro() {
    const out = [];
    for (const s of KA.FRED_SERIES) {
      try { const r = await KA.fredSeries(s.id); out.push({ ...r, label: s.label, unit: s.unit, dir: r.prev != null && r.value != null ? Math.sign(r.value - r.prev) : 0 }); } catch { /* skip */ }
    }
    if (out.length) hot.macro = out;
  }

  async function seedUniverse() {
    try { if (apexDb.countUniverse() > 100) return; } catch { return; }
    try {
      const list = await A.edgarTickers();
      apexDb.upsertUniverse(list.slice(0, 8000).map((x) => ({ ticker: x.ticker, name: x.name, cik: x.cik, asset_class: "equity" })));
      // (catalog for apex_universe is handled by snapshotCatalog with a stable id)
    } catch { /* seed best-effort */ }
  }

  function startWs() {
    if (!WebSocketImpl) return;
    try {
      binanceWs = new WebSocketImpl("wss://stream.binance.com:9443/ws/btcusdt@depth20@1000ms");
      binanceWs.on("message", (m) => {
        try { const d = JSON.parse(m.toString()); hot.orderbook.BTCUSDT = { bids: (d.bids || []).map((x) => ({ p: +x[0], q: +x[1] })), asks: (d.asks || []).map((x) => ({ p: +x[0], q: +x[1] })) }; } catch { /* noop */ }
      });
      binanceWs.on("error", () => { /* stays on REST fallback via pollCrypto */ });
      binanceWs.on("close", () => { if (!stopped) setTimeout(startWs, 5000); });
    } catch { /* WS optional */ }
  }
  // Microstructure poller (Coinbase REST — reliable where Binance WS is geo-blocked):
  // depth snapshot → rolling depthHistory; recent trades (deduped) → tape ring buffer.
  let lastTradeId = 0;
  async function pollMicro() {
    try {
      const book = await A.coinbaseDepth("BTCUSDT", 40);
      if (book && (book.bids.length || book.asks.length)) { hot.depthHistory.push({ t: Date.now(), bids: book.bids, asks: book.asks }); if (hot.depthHistory.length > 90) hot.depthHistory.shift(); }
    } catch { /* skip */ }
    try {
      const tr = await A.coinbaseTrades("BTCUSDT", 100); // newest-first
      const fresh = tr.filter((t) => t.id > lastTradeId).sort((a, b) => a.id - b.id);
      if (fresh.length) { lastTradeId = fresh[fresh.length - 1].id; for (const t of fresh) hot.trades.push({ t: t.t, p: t.p, q: t.q, side: t.side }); while (hot.trades.length > 400) hot.trades.shift(); }
    } catch { /* skip */ }
  }
  // Volume profile: bucket recent trades by price → volume + buy/sell split, POC + value area.
  function getVolumeProfile(buckets = 40) {
    const tr = hot.trades; if (tr.length < 5) return null;
    let lo = Infinity, hi = -Infinity; for (const t of tr) { if (t.p < lo) lo = t.p; if (t.p > hi) hi = t.p; }
    if (!(hi > lo)) return null;
    const step = (hi - lo) / buckets;
    const rows = Array.from({ length: buckets }, (_, i) => ({ price: +(lo + step * (i + 0.5)).toFixed(0), buy: 0, sell: 0 }));
    let total = 0;
    for (const t of tr) { const i = Math.min(buckets - 1, Math.floor((t.p - lo) / step)); if (t.side === "sell") rows[i].sell += t.q; else rows[i].buy += t.q; total += t.q; }
    let pocI = 0, pocV = -1; rows.forEach((r, i) => { const v = r.buy + r.sell; if (v > pocV) { pocV = v; pocI = i; } });
    // value area = 70% of volume around POC
    const order = rows.map((r, i) => ({ i, v: r.buy + r.sell })).sort((a, b) => b.v - a.v);
    let acc = 0; const va = new Set(); for (const o of order) { va.add(o.i); acc += o.v; if (acc >= total * 0.7) break; }
    return { lo: +lo.toFixed(0), hi: +hi.toFixed(0), poc: rows[pocI].price, rows: rows.map((r, i) => ({ ...r, va: va.has(i) })), last: tr[tr.length - 1].p };
  }

  function start() {
    stopped = false;
    seedUniverse();
    gov.register("yahoo", pollEquities, 60);
    gov.register("binance", pollCrypto, 15);
    gov.register("gdelt", pollNews, 900);
    gov.register("nws", pollNws, 300);
    gov.register("treasury", pollYields, 86400);
    gov.register("tv-screener", pollGainers, 300);
    gov.register("tv-movers", pollMovers, 300);
    gov.register("tv-breadth", pollRegime, 120);
    gov.register("sectors", pollSectors, 300);
    gov.register("session", pollSession, 300);
    gov.register("correlation", pollCorrelation, 1800);
    gov.register("rrg", pollRRG, 1800);
    gov.register("micro", pollMicro, 2);
    gov.register("crypto-fng", pollFng, 1800);
    gov.register("wiki-attention", pollAttention, 3600);
    gov.register("sec-form4", pollForm4, 300);
    gov.register("btc-network", pollBtcNet, 120);
    gov.register("anomalies", pollAnomalies, 900);
    gov.register("cboe-market", pollCboe, 3600);
    gov.register("cftc-cot", pollCftc, 86400);
    gov.register("nasdaq-trader", pollNasdaqSymbols, 86400);
    gov.register("ken-french", pollKenFrench, 86400);
    gov.register("bls", pollBls, 86400);
    gov.register("federal-reserve", pollFed, 86400);
    gov.register("defillama", pollDefi, 1800);
    if (keyPresent.finnhub) gov.register("insider", pollInsider, 900);
    // keyed pollers + registry enable (Wave 3) — only when the key is present
    if (keyPresent.finnhub) { enableSource("finnhub"); gov.register("finnhub", pollFinnhubQuotes, 60); }
    if (keyPresent.coingecko) { enableSource("coingecko"); gov.register("coingecko", pollCryptoGlobal, 300); }
    if (keyPresent.fred) { enableSource("fred"); gov.register("fred", pollMacro, 86400); }
    if (keyPresent.marketaux) enableSource("marketaux"); // consumed inside the news engine
    if (keyPresent.tiingo) enableSource("tiingo");       // on-demand (history)
    if (keyPresent.alphavantage) enableSource("alphavantage"); // on-demand (fundamentals)
    gov.start();
    startWs();
    // Cold tier: catalog our own (public) tables so Jarvis can discover them.
    // NOTE: no local/proprietary data is seeded — APEX ships only public data.
    try { catalog.snapshotTables(); } catch { /* noop */ }
  }
  function stop() { stopped = true; gov.stop(); try { binanceWs && binanceWs.close(); } catch { /* noop */ } try { tradesWs && tradesWs.close(); } catch { /* noop */ } }

  // Soft reload from the registry (used by the data-health bot's APPLY step — no process restart).
  function hotReload() { try { gov.hotReload(apexDb.listSources()); } catch { /* noop */ } }

  // On-demand data-health audit across ALL enabled sources (keyless + keyed),
  // producing a report + analysis + proposed config fixes for the apply step.
  async function runHealthCheck() {
    const checks = {
      binance: () => A.binance24h("BTCUSDT"),
      yahoo: () => A.yahooQuotes(["AAPL"]),
      gdelt: () => A.gdeltNews("markets", 1),
      nws: () => A.nwsAlerts(),
      "sec-edgar": () => A.edgarTickers(),
      treasury: () => A.treasuryYields(),
      "tv-screener": () => A.tvScan(1),
      finnhub: () => KA.finnhubQuote("AAPL"),
      tiingo: () => KA.tiingoDaily("AAPL", "2026-06-01"),
      fred: () => KA.fredSeries("DGS10"),
      marketaux: () => KA.marketauxNews(""),
      coingecko: () => KA.coingeckoGlobal(),
    };
    const report = []; const fixes = []; let ok = 0, down = 0, disabled = 0, skipped = 0;
    for (const s of safeSources()) {
      if (!s.enabled) { disabled++; report.push({ id: s.id, status: "disabled" }); continue; }
      // Alpha Vantage: on-demand only (25/day) — don't burn budget on a health ping.
      if (s.id === "alphavantage") { skipped++; report.push({ id: s.id, status: "on-demand", note: "verified per-request (25/day budget)" }); continue; }
      const fn = checks[s.id];
      if (!fn) { report.push({ id: s.id, status: "no-check" }); continue; }
      const t0 = Date.now();
      try { await fn(); ok++; report.push({ id: s.id, status: "ok", latencyMs: Date.now() - t0 }); try { apexDb.setSourceHealth(s.id, "ok"); } catch { /* noop */ } }
      catch (e) {
        down++; const msg = e && e.message; report.push({ id: s.id, status: "down", error: msg });
        try { apexDb.setSourceHealth(s.id, "down", msg); } catch { /* noop */ }
        // propose a fix: back off (disable) the failing source so the governor stops hammering it
        fixes.push({ id: s.id, action: "disable", patch: { enabled: 0 }, reason: `Unreachable (${msg || "error"}). Disable to stop retries; re-enable after investigating or when the provider recovers.` });
      }
    }
    lastHealthFixes = fixes;
    const analysis = down === 0
      ? `All ${ok} checked sources healthy${skipped ? ` (${skipped} on-demand, ${disabled} disabled)` : disabled ? ` (${disabled} disabled)` : ""}.`
      : `${down} source(s) DOWN: ${report.filter((r) => r.status === "down").map((r) => r.id).join(", ")}. ${fixes.length} fix(es) proposed — approve to disable the failing source(s) and hot-reload (no restart), then I'll re-verify.`;
    let id = null; try { id = apexDb.insertHealthReport({ ok_count: ok, degraded_count: 0, down_count: down, report, analysis }); } catch { /* noop */ }
    return { id, ok, down, disabled, skipped, report, analysis, fixes };
  }

  // Apply approved fixes → governor hot-reload (NO restart) → quick re-verify.
  async function applyHealthFixes(ids) {
    const pool = lastHealthFixes || [];
    const chosen = (Array.isArray(ids) && ids.length) ? pool.filter((f) => ids.includes(f.id)) : pool;
    const applied = [];
    for (const f of chosen) {
      if (!f || !f.id || !f.patch) continue;
      try { apexDb.setSourceConfig(f.id, f.patch); applied.push({ id: f.id, action: f.action }); } catch { /* noop */ }
    }
    hotReload(); // soft internal refresh — governor picks up new config, process keeps running
    const reverify = await runHealthCheck(); // confirm the change took and nothing else broke
    return { applied, appliedCount: applied.length, reverify: { ok: reverify.ok, down: reverify.down, downSources: reverify.report.filter((r) => r.status === "down").map((r) => r.id) } };
  }

  function enableSource(id) { try { apexDb.setSourceConfig(id, { enabled: 1 }); } catch { /* noop */ } }
  function safeSources() { try { return apexDb.listSources(); } catch { return []; } }
  function isoNowSafe() { try { return new Date().toISOString(); } catch { return null; } }
  function hashId(s) { let h = 0; const str = String(s || ""); for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; } return "n" + (h >>> 0).toString(16); }

  return {
    start, stop, hotReload, runHealthCheck, applyHealthFixes, getHealthFixes: () => lastHealthFixes, hot,
    getOverview: () => hot.overview,
    getQuote: (t) => hot.quotes[t] || (safeQuote(t)),
    getOrderBook: (s = "BTCUSDT") => hot.orderbook[s] || null,
    getMicro: () => ({ book: hot.orderbook.BTCUSDT || null, depthHistory: hot.depthHistory, trades: hot.trades.slice(-60), volumeProfile: getVolumeProfile(40), tradeCount: hot.trades.length }),
    getGainers: () => hot.gainers,
    getNws: () => hot.nws,
    getYields: () => hot.yields,
    getCryptoGlobal: () => hot.cryptoGlobal,
    getMacro: () => hot.macro,
    getMacroAlt: () => hot.macroAlt,
    getMovers: () => hot.movers,
    getRegime: () => hot.regime,
    getInternals: () => hot.internals,
    getSectors: () => hot.sectors,
    getSession: () => hot.session,
    getCorrelation: () => hot.correlation,
    getRRG: () => hot.rrg,
    getCryptoFng: () => hot.cryptoFng,
    getAttention: () => hot.attention,
    getForm4: () => hot.form4,
    getBtcNet: () => hot.btcNet,
    listStrategies: () => { try { return apexDb.listStrategies(); } catch { return []; } },
    getStrategyById: (id) => { try { return apexDb.getStrategy(id); } catch { return null; } },
    listFolders: () => { try { return apexDb.listFolders(); } catch { return []; } },
    getFolderById: (id) => { try { return apexDb.getFolder(id); } catch { return null; } },
    listVariables: () => { try { return apexDb.listVariables(); } catch { return []; } },
    listSignals: () => { try { return apexDb.listSignals(); } catch { return []; } },
    latestReport: (id) => { try { return apexDb.latestReport(id); } catch { return null; } },
    listReports: (n) => { try { return apexDb.listReports(n || 50); } catch { return []; } },
    getVol: async (sym) => { try { return await quant.realizedVol(sym); } catch { return null; } },
    getRiskLab: async (sym) => { try { return await quant.riskLab(sym); } catch { return null; } },
    getAnomalies: () => hot.anomalies,
    getMonteCarlo: async (sym, opts) => { try { return await quant.monteCarlo(sym, opts); } catch { return null; } },
    getBrief: (type) => getBrief(type),
    getInsider: (ticker) => ticker ? hot.insider.filter((t) => t.ticker === String(ticker).toUpperCase()) : hot.insider,
    getFundamentals: async (sym) => { if (!keyPresent.alphavantage) return null; try { return await KA.alphaOverview(sym); } catch { return null; } },
    getCompanyIntel: async (sym) => { try { return await A.secCompanyIntel(sym); } catch { return null; } },
    getShortVolume: async (sym) => { try { return await A.finraShortVolume(sym); } catch { return null; } },
    getOptionsChain: async (sym) => { try { return await A.yahooOptionsChain(sym); } catch { return null; } },
    getHistory: async (sym, start) => { if (!keyPresent.tiingo) return []; try { return await KA.tiingoDaily(sym, start); } catch { return []; } },
    keysPresent: () => keyPresent,
    getKlines: A.binanceKlines,
    getChart: A.yahooChart,
    getNews: (n = 50) => { try { return apexDb.listStories(n); } catch { return []; } },
    getNewsImpact: (ticker, n = 10) => { try { return apexDb.impactByTicker(ticker, n); } catch { return []; } },
    newsStatus: () => newsState,
    runNews: () => { newsState = { status: "running", lastRun: isoNowSafe() }; pollNews().catch(() => { newsState = { status: "error", lastRun: isoNowSafe() }; }); return newsState; },
    resetNews: () => { let cleared = 0; try { cleared = apexDb.clearStories(); } catch { /* noop */ } newsState = { status: "running", lastRun: isoNowSafe(), cleared }; pollNews().catch(() => { newsState = { status: "error", lastRun: isoNowSafe() }; }); return { cleared, status: newsState.status }; },
    listSources: safeSources,
    searchCatalog: (q) => { try { return apexDb.searchCatalog(q); } catch { return []; } },
    dataSummary: (name) => { try { return apexDb.getCatalog(name); } catch { return null; } },
    catalogAll: () => { try { return apexDb.searchCatalog(""); } catch { return []; } },
    clearSeededBars: () => { try { return apexDb.clearBars(); } catch { return 0; } },
  };
  function safeQuote(t) { try { return apexDb.getQuote(t); } catch { return null; } }
}

module.exports = { createApexIngest };
