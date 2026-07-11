"use strict";
/* APEX keyed data adapters (Wave 3). Each reads its key lazily from
   process.env.APEX_* (loaded from .env by env-loader). Returns normalized
   shapes matching the keyless adapters. Rate notes:
     Finnhub 60/min · Tiingo 50/hr,1000/day · FRED generous ·
     Marketaux 100/day (free) · Alpha Vantage 25/DAY (on-demand only!) ·
     CoinGecko demo ~30/min. CommonJS. */

const { fetchJson } = require("./apex-fetch");

const K = () => ({
  finnhub: process.env.APEX_FINNHUB_KEY || "",
  tiingo: process.env.APEX_TIINGO_KEY || "",
  fred: process.env.APEX_FRED_KEY || "",
  marketaux: process.env.APEX_MARKETAUX_KEY || "",
  alpha: process.env.APEX_ALPHAVANTAGE_KEY || "",
  coingecko: process.env.APEX_COINGECKO_KEY || "",
});
// Which keyed sources have a key present (drives source-registry enable + pollers).
function keysPresent() {
  const k = K();
  return { finnhub: !!k.finnhub, tiingo: !!k.tiingo, fred: !!k.fred, marketaux: !!k.marketaux, alphavantage: !!k.alpha, coingecko: !!k.coingecko };
}

/* ── Finnhub — real-time equity quote + news (equities workhorse) ── */
async function finnhubQuote(sym) {
  const d = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${K().finnhub}`);
  if (!d || d.c == null) return null;
  return { ticker: sym, last: d.c, prev: d.pc, changePct: d.dp, high: d.h, low: d.l, open: d.o };
}
async function finnhubGeneralNews() {
  const d = await fetchJson(`https://finnhub.io/api/v1/news?category=general&token=${K().finnhub}`);
  return (Array.isArray(d) ? d : []).slice(0, 30).map((a) => ({ title: a.headline, url: a.url, source: a.source, published_at: a.datetime ? new Date(a.datetime * 1000).toISOString() : null, lane: "finance" }));
}
async function finnhubCompanyNews(sym, days = 5) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const d = await fetchJson(`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${K().finnhub}`);
  return (Array.isArray(d) ? d : []).slice(0, 8).map((a) => ({ title: a.headline, url: a.url, source: a.source, published_at: a.datetime ? new Date(a.datetime * 1000).toISOString() : null, lane: "equity", ticker: sym }));
}

/* ── Tiingo — daily history (30yr), on-demand ── */
async function tiingoDaily(sym, start = "2015-01-01") {
  const d = await fetchJson(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym)}/prices?startDate=${start}&token=${K().tiingo}`);
  return (Array.isArray(d) ? d : []).map((b) => ({ t: b.date, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }));
}

/* ── FRED — macro series (latest + prior observation) ── */
async function fredSeries(seriesId) {
  const d = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${K().fred}&file_type=json&sort_order=desc&limit=2`);
  const obs = (d && d.observations) || [];
  const num = (x) => { const n = x && x.value != null ? Number(x.value) : NaN; return Number.isNaN(n) ? null : n; };
  return { series: seriesId, value: num(obs[0]), date: obs[0] ? obs[0].date : null, prev: num(obs[1]) };
}
const FRED_SERIES = [
  { id: "DFF", label: "Fed Funds Rate", unit: "%" },
  { id: "DGS10", label: "10Y Treasury", unit: "%" },
  { id: "CPIAUCSL", label: "CPI", unit: "idx" },
  { id: "UNRATE", label: "Unemployment", unit: "%" },
  { id: "T10Y2Y", label: "10Y-2Y Spread", unit: "%" },
];

/* ── Marketaux — per-ticker financial news + sentiment (enricher) ── */
async function marketauxNews(symbols = "") {
  const q = symbols ? `symbols=${encodeURIComponent(symbols)}&` : "";
  const d = await fetchJson(`https://api.marketaux.com/v1/news/all?${q}filter_entities=true&language=en&limit=10&api_token=${K().marketaux}`);
  return ((d && d.data) || []).map((a) => ({
    title: a.title, url: a.url, source: a.source, published_at: a.published_at, lane: "finance",
    sentiment: a.entities && a.entities[0] ? a.entities[0].sentiment_score : null,
    ticker: a.entities && a.entities[0] ? a.entities[0].symbol : null,
  }));
}

/* ── Alpha Vantage — fundamentals overview (ON-DEMAND only, 25/day cap) ── */
async function alphaOverview(sym) {
  const d = await fetchJson(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(sym)}&apikey=${K().alpha}`);
  if (!d || !d.Symbol) return null;
  const n = (x) => { const v = Number(x); return Number.isNaN(v) ? null : v; };
  return { ticker: sym, name: d.Name, sector: d.Sector, industry: d.Industry, marketCap: n(d.MarketCapitalization), pe: n(d.PERatio), eps: n(d.EPS), beta: n(d.Beta), divYield: n(d.DividendYield), high52: n(d["52WeekHigh"]), low52: n(d["52WeekLow"]) };
}

/* ── CoinGecko (demo) — global market stats + top markets ── */
const cgHeaders = () => ({ "x-cg-demo-api-key": K().coingecko });
async function coingeckoGlobal() {
  const d = await fetchJson("https://api.coingecko.com/api/v3/global", { headers: cgHeaders() });
  const g = d && d.data; if (!g) return null;
  return {
    totalMcap: g.total_market_cap && g.total_market_cap.usd,
    mcapChangePct: g.market_cap_change_percentage_24h_usd,
    volume: g.total_volume && g.total_volume.usd,
    btcDom: g.market_cap_percentage && g.market_cap_percentage.btc,
    ethDom: g.market_cap_percentage && g.market_cap_percentage.eth,
  };
}
async function coingeckoMarkets(n = 20) {
  const d = await fetchJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${n}&page=1`, { headers: cgHeaders() });
  return (Array.isArray(d) ? d : []).map((c) => ({ id: c.id, ticker: (c.symbol || "").toUpperCase(), name: c.name, last: c.current_price, changePct: c.price_change_percentage_24h, mktcap: c.market_cap }));
}
// Top crypto gainers + losers over the top-100 by market cap (avoids illiquid micro-cap noise).
async function coingeckoMovers(limit = 3) {
  const m = (await coingeckoMarkets(100)).filter((c) => c.changePct != null && c.mktcap);
  const sorted = [...m].sort((a, b) => b.changePct - a.changePct);
  return { gainers: sorted.slice(0, limit), losers: sorted.slice(-limit).reverse() };
}

/* ── Finnhub insider transactions (free tier) — the "hidden info" feed ── */
async function finnhubInsider(sym, months = 3) {
  const from = new Date(Date.now() - months * 30 * 864e5).toISOString().slice(0, 10);
  const d = await fetchJson(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(sym)}&from=${from}&token=${K().finnhub}`);
  return ((d && d.data) || []).map((t) => ({
    ticker: sym, name: t.name, shares: t.share, change: t.change, date: t.transactionDate,
    code: t.transactionCode, price: t.transactionPrice,
    // P/A = acquisition (buy-ish), S/D = disposal (sell-ish)
    side: /^[PA]/i.test(t.transactionCode || "") ? "buy" : /^[SD]/i.test(t.transactionCode || "") ? "sell" : "other",
    value: (t.transactionPrice || 0) * Math.abs(t.change || 0),
  }));
}

module.exports = {
  K, keysPresent, FRED_SERIES,
  finnhubQuote, finnhubGeneralNews, finnhubCompanyNews,
  tiingoDaily, fredSeries, marketauxNews, alphaOverview,
  coingeckoGlobal, coingeckoMarkets, coingeckoMovers, finnhubInsider,
};
