"use strict";
/* APEX keyless data adapters — direct fetch to public endpoints, no npm
   deps beyond global fetch. Each returns normalized data; the orchestrator
   handles caching + DB writes. Keyed adapters (Finnhub/Tiingo/FRED/etc.)
   are added in Wave 3 once Dev drops keys. CommonJS. */

const { fetchJson, fetchText } = require("./apex-fetch");

/* ── Crypto — Binance public REST, with Coinbase fallback (both keyless).
   Binance geo-blocks some IPs (HTTP 451); Coinbase Exchange is the fallback
   so crypto works regardless of region. Same normalized shape either way. ── */
const cbProduct = (sym) => sym.replace(/USDT$|USD$/i, "") + "-USD"; // BTCUSDT → BTC-USD
async function coinbaseTicker(symbol) {
  const p = cbProduct(symbol);
  const [t, s] = await Promise.all([
    fetchJson(`https://api.exchange.coinbase.com/products/${p}/ticker`),
    fetchJson(`https://api.exchange.coinbase.com/products/${p}/stats`),
  ]);
  const last = +t.price, open = +s.open;
  return { ticker: symbol, last, changePct: open ? ((last - open) / open) * 100 : null, high: +s.high, low: +s.low, vol: +s.volume };
}
async function coinbaseDepth(symbol, limit = 50) {
  const d = await fetchJson(`https://api.exchange.coinbase.com/products/${cbProduct(symbol)}/book?level=2`);
  return { bids: (d.bids || []).slice(0, limit).map((x) => ({ p: +x[0], q: +x[1] })), asks: (d.asks || []).slice(0, limit).map((x) => ({ p: +x[0], q: +x[1] })) };
}
async function coinbaseTrades(symbol, limit = 100) {
  const d = await fetchJson(`https://api.exchange.coinbase.com/products/${cbProduct(symbol)}/trades?limit=${limit}`);
  // Coinbase 'side' = maker side; taker (aggressor) is the opposite. Newest-first.
  return (Array.isArray(d) ? d : []).map((t) => ({ id: +t.trade_id, t: Date.parse(t.time), p: +t.price, q: +t.size, side: t.side === "buy" ? "sell" : "buy" }));
}
async function coinbaseKlines(symbol, interval = "1d", limit = 200) {
  const gran = interval === "1d" ? 86400 : interval === "1h" ? 3600 : interval === "5m" ? 300 : 60;
  const d = await fetchJson(`https://api.exchange.coinbase.com/products/${cbProduct(symbol)}/candles?granularity=${gran}`);
  return (Array.isArray(d) ? d : []).slice(0, limit).reverse().map((k) => ({ t: new Date(k[0] * 1000).toISOString(), o: +k[3], h: +k[2], l: +k[1], c: +k[4], v: +k[5] })); // [time,low,high,open,close,volume]
}
async function binanceKlines(symbol = "BTCUSDT", interval = "1d", limit = 200) {
  try {
    const d = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return (Array.isArray(d) ? d : []).map((k) => ({ t: new Date(k[0]).toISOString(), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  } catch { return coinbaseKlines(symbol, interval, limit); }
}
async function binanceDepth(symbol = "BTCUSDT", limit = 50) {
  try {
    const d = await fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${limit}`);
    return { bids: (d.bids || []).map((x) => ({ p: +x[0], q: +x[1] })), asks: (d.asks || []).map((x) => ({ p: +x[0], q: +x[1] })) };
  } catch { return coinbaseDepth(symbol, limit); }
}
async function binance24h(symbol = "BTCUSDT") {
  try {
    const d = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
    return { ticker: symbol, last: +d.lastPrice, changePct: +d.priceChangePercent, high: +d.highPrice, low: +d.lowPrice, vol: +d.quoteVolume };
  } catch { return coinbaseTicker(symbol); }
}

/* ── Equities / indices — Yahoo public chart+quote (keyless, unofficial) ── */
async function yahooChart(symbol, range = "6mo", interval = "1d") {
  const d = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const r = d && d.chart && d.chart.result && d.chart.result[0];
  if (!r) return { meta: null, bars: [] };
  const ts = r.timestamp || [], q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const bars = ts.map((t, i) => ({ t: new Date(t * 1000).toISOString(), o: q.open && q.open[i], h: q.high && q.high[i], l: q.low && q.low[i], c: q.close && q.close[i], v: q.volume && q.volume[i] })).filter((b) => b.c != null);
  return { meta: { symbol: r.meta && r.meta.symbol, price: r.meta && r.meta.regularMarketPrice, prevClose: r.meta && r.meta.chartPreviousClose, currency: r.meta && r.meta.currency }, bars };
}
// v7 /quote now requires a crumb+cookie; the keyless v8 /chart endpoint doesn't,
// so we derive quotes from each symbol's chart meta (small default set, cadence 60s).
async function yahooQuotes(symbols = []) {
  if (!symbols.length) return [];
  const out = await Promise.all(symbols.map(async (s) => {
    try {
      const c = await yahooChart(s, "5d", "1d");
      const m = c.meta; if (!m || m.price == null) return null;
      return { ticker: s, last: m.price, prev: m.prevClose, changePct: m.prevClose ? ((m.price - m.prevClose) / m.prevClose) * 100 : null, name: m.symbol || s };
    } catch { return null; }
  }));
  return out.filter(Boolean);
}

/* ── News — GDELT 2.0 DOC API (keyless) ─────────────────────── */
async function gdeltNews(query = "(stock market OR economy OR federal reserve OR inflation)", max = 25) {
  // GDELT is slow + rate-limited (~1/sec) — allow a longer timeout so responses land.
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=${max}&format=json&sort=DateDesc`;
  const d = await fetchJson(url, { timeoutMs: 30000 });
  return ((d && d.articles) || []).map((a) => ({ title: a.title, url: a.url, source: a.domain, published_at: a.seendate, lane: "geopolitics", sentiment: a.tone != null ? +a.tone / 10 : null }));
}

/* ── Weather / disaster — NWS (keyless, US) ─────────────────── */
async function nwsAlerts() {
  const d = await fetchJson("https://api.weather.gov/alerts/active?severity=Extreme,Severe,Moderate", { accept: "application/geo+json" });
  return ((d && d.features) || []).map((f) => ({ id: f.id, event: f.properties && f.properties.event, severity: f.properties && f.properties.severity, area: f.properties && f.properties.areaDesc, sent: f.properties && f.properties.sent, headline: f.properties && f.properties.headline }));
}

/* ── SEC EDGAR — ticker universe (keyless; UA required) ─────── */
async function edgarTickers() {
  const d = await fetchJson("https://www.sec.gov/files/company_tickers.json");
  return Object.values(d || {}).map((x) => ({ ticker: String(x.ticker), name: x.title, cik: String(x.cik_str).padStart(10, "0") }));
}

/* ── Treasury — average interest rates / yields (keyless) ───── */
async function treasuryYields() {
  const d = await fetchJson("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=16");
  return ((d && d.data) || []).map((x) => ({ date: x.record_date, security: x.security_desc, rate: +x.avg_interest_rate_amt }));
}

/* ── TradingView scanner — top gainers + TA rating (public JSON; gray-area) ── */
async function tvScan(limit = 15) {
  const body = JSON.stringify({
    // Liquidity filters keep out illiquid OTC/foreign junk (which returns absurd % moves).
    filter: [{ left: "change", operation: "greater", right: 0 }, { left: "type", operation: "equal", right: "stock" }, { left: "close", operation: "greater", right: 3 }, { left: "volume", operation: "greater", right: 1000000 }, { left: "market_cap_basic", operation: "greater", right: 5e8 }],
    options: { lang: "en" },
    columns: ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All"],
    sort: { sortBy: "change", sortOrder: "desc" },
    range: [0, limit],
    markets: ["america"],
  });
  const d = await fetchJson("https://scanner.tradingview.com/america/scan", { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body });
  const ratingLabel = (v) => v == null ? "—" : v >= 0.5 ? "Strong Buy" : v >= 0.1 ? "Buy" : v > -0.1 ? "Neutral" : v > -0.5 ? "Sell" : "Strong Sell";
  return ((d && d.data) || []).map((row) => ({ ticker: row.d && row.d[0], last: row.d && row.d[1], changePct: row.d && row.d[2], vol: row.d && row.d[3], mktcap: row.d && row.d[4], rating: ratingLabel(row.d && row.d[5]) }));
}

/* ── TradingView movers — real top gainers AND losers (liquid US stocks) ── */
async function tvMovers(limit = 3) {
  const scan = async (order) => {
    const body = JSON.stringify({
      filter: [{ left: "type", operation: "equal", right: "stock" }, { left: "close", operation: "greater", right: 3 }, { left: "volume", operation: "greater", right: 1000000 }, { left: "market_cap_basic", operation: "greater", right: 5e8 }],
      options: { lang: "en" },
      columns: ["name", "close", "change", "volume", "market_cap_basic", "Recommend.All"],
      sort: { sortBy: "change", sortOrder: order },
      range: [0, limit],
      markets: ["america"],
    });
    const d = await fetchJson("https://scanner.tradingview.com/america/scan", { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body });
    const rating = (v) => v == null ? "—" : v >= 0.5 ? "Strong Buy" : v >= 0.1 ? "Buy" : v > -0.1 ? "Neutral" : v > -0.5 ? "Sell" : "Strong Sell";
    return ((d && d.data) || []).map((r) => ({ ticker: r.d[0], last: r.d[1], changePct: r.d[2], vol: r.d[3], mktcap: r.d[4], rating: rating(r.d[5]) }));
  };
  const [gainers, losers] = await Promise.all([scan("desc"), scan("asc")]);
  return { gainers, losers };
}

/* ── TradingView breadth — real market-wide advancers/decliners via totalCount ── */
async function tvBreadth() {
  const count = async (op) => {
    const body = JSON.stringify({ filter: [{ left: "type", operation: "equal", right: "stock" }, { left: "exchange", operation: "in_range", right: ["NASDAQ", "NYSE", "AMEX"] }, { left: "change", operation: op, right: 0 }], columns: ["name"], range: [0, 1], markets: ["america"] });
    const d = await fetchJson("https://scanner.tradingview.com/america/scan", { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body });
    return (d && d.totalCount) || 0;
  };
  const [advancers, decliners] = await Promise.all([count("greater"), count("less")]);
  const tot = advancers + decliners;
  return { advancers, decliners, pctUp: tot ? advancers / tot : null };
}

/* ── Alt-data (Wave G3), all keyless ──────────────────────────────── */

/* Crypto Fear & Greed index — alternative.me. Real market sentiment gauge
   (0=Extreme Fear, 100=Extreme Greed) with daily history for a sparkline. */
async function cryptoFearGreed(limit = 30) {
  const d = await fetchJson(`https://api.alternative.me/fng/?limit=${limit}`);
  const rows = (d && d.data) || [];
  if (!rows.length) return null;
  const history = rows.map((r) => ({ t: +r.timestamp * 1000, value: +r.value })).reverse(); // oldest→newest
  const cur = rows[0];
  return { value: +cur.value, label: cur.value_classification, history, updated: Date.now() };
}

/* Wikipedia retail-attention — daily pageviews per company/asset article.
   Spikes flag names retail is suddenly reading about. Keyless Wikimedia REST. */
const WIKI_UNIVERSE = [
  { ticker: "NVDA", article: "Nvidia" }, { ticker: "TSLA", article: "Tesla,_Inc." },
  { ticker: "AAPL", article: "Apple_Inc." }, { ticker: "AMZN", article: "Amazon_(company)" },
  { ticker: "GOOGL", article: "Google" }, { ticker: "MSFT", article: "Microsoft" },
  { ticker: "META", article: "Meta_Platforms" }, { ticker: "AMD", article: "Advanced_Micro_Devices" },
  { ticker: "PLTR", article: "Palantir_Technologies" }, { ticker: "GME", article: "GameStop" },
  { ticker: "COIN", article: "Coinbase" }, { ticker: "BTC", article: "Bitcoin" },
  { ticker: "ETH", article: "Ethereum" }, { ticker: "MSTR", article: "Strategy_(company)" },
];
function ymd(d) { return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0") + "00"; }
async function wikiAttention(nowMs) {
  const end = new Date(nowMs), start = new Date(nowMs - 8 * 86400000); // 8-day window
  const UA = { headers: { "User-Agent": "APEX-markets/1.0 (markets dashboard)" } };
  const out = [];
  for (const e of WIKI_UNIVERSE) {
    try {
      const u = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(e.article)}/daily/${ymd(start)}/${ymd(end)}`;
      const d = await fetchJson(u, UA);
      const items = (d && d.items) || [];
      if (items.length < 2) continue;
      const views = items[items.length - 1].views;
      const base = items.slice(0, -1).reduce((a, b) => a + b.views, 0) / Math.max(1, items.length - 1); // trailing avg
      const spikePct = base ? ((views - base) / base) * 100 : 0;
      out.push({ ticker: e.ticker, article: e.article.replace(/_/g, " "), views, avg: Math.round(base), spikePct: +spikePct.toFixed(1), spark: items.slice(-7).map((i) => i.views) });
    } catch { /* skip one */ }
  }
  out.sort((a, b) => b.spikePct - a.spikePct);
  return { updated: nowMs, items: out };
}

/* SEC EDGAR — market-wide latest Form-4 (insider) filings, live. Atom feed,
   keyless (SEC requires a descriptive User-Agent). No retail tool shows a
   free cross-market insider tape like this. */
const SEC_UA = { headers: { "User-Agent": "APEX-markets/1.0 (markets dashboard; contact apex@example.com)" } };
async function secFormFour(limit = 30) {
  const xml = await fetchText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&company=&dateb=&owner=include&count=${Math.min(100, limit * 2)}&output=atom`, SEC_UA);
  const entries = xml.split(/<entry>/).slice(1);
  const out = [];
  for (const e of entries) {
    const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1] || "";
    const href = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    const updated = (e.match(/<updated>([^<]+)<\/updated>/) || [])[1] || "";
    // title looks like: "4 - NAME (0001234567) (Reporting)"  or  "(Issuer)"
    const m = title.match(/^\s*4\s*-\s*(.+?)\s*\((\d+)\)\s*\((Reporting|Issuer)\)/i);
    if (!m) continue;
    out.push({ name: m[1].trim(), cik: m[2], role: m[3].toLowerCase(), date: updated, link: href.replace(/&amp;/g, "&") });
  }
  return out.slice(0, limit);
}

/* BTC on-chain / network heat — mempool congestion, fees, hashrate. Keyless
   (mempool.space + blockchain.info). A live read on real settlement demand. */
async function btcNetwork() {
  const [fees, mp, stats] = await Promise.all([
    fetchJson("https://mempool.space/api/v1/fees/recommended").catch(() => null),
    fetchJson("https://mempool.space/api/mempool").catch(() => null),
    fetchJson("https://api.blockchain.info/stats?cors=true").catch(() => null),
  ]);
  if (!fees && !mp && !stats) return null;
  return {
    fastFee: fees ? fees.fastestFee : null, halfHourFee: fees ? fees.halfHourFee : null, hourFee: fees ? fees.hourFee : null,
    mempoolTxs: mp ? mp.count : null, mempoolVsize: mp ? mp.vsize : null, // vbytes
    hashRateEH: stats ? +(stats.hash_rate / 1e9).toFixed(1) : null, // GH/s → EH/s
    nTx24h: stats ? stats.n_tx : null, price: stats ? stats.market_price_usd : null,
    difficulty: stats ? stats.difficulty : null, updated: Date.now(),
  };
}

module.exports = { binanceKlines, binanceDepth, binance24h, coinbaseDepth, coinbaseTrades, yahooChart, yahooQuotes, gdeltNews, nwsAlerts, edgarTickers, treasuryYields, tvScan, tvMovers, tvBreadth, cryptoFearGreed, wikiAttention, secFormFour, btcNetwork };
