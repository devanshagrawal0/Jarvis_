"use strict";
/* APEX keyless data adapters — direct fetch to public endpoints, no npm
   deps beyond global fetch. Each returns normalized data; the orchestrator
   handles caching + DB writes. Keyed adapters (Finnhub/Tiingo/FRED/etc.)
   are added in Wave 3 once Dev drops keys. CommonJS. */

const zlib = require("zlib");
const { fetchJson, fetchText, fetchBuffer } = require("./apex-fetch");

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
// Shared parser. `adjc` = split/dividend-adjusted close (a NON-breaking extra field so long-horizon
// backtests can use total-return-correct prices; charts wanting nominal prices keep reading `c`).
function _parseChartResult(r) {
  if (!r) return { meta: null, bars: [] };
  const ts = r.timestamp || [], q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const adj = (r.indicators && r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose) || null;
  const bars = ts.map((t, i) => ({ t: new Date(t * 1000).toISOString(), o: q.open && q.open[i], h: q.high && q.high[i], l: q.low && q.low[i], c: q.close && q.close[i], adjc: adj && adj[i] != null ? adj[i] : (q.close && q.close[i]), v: q.volume && q.volume[i] })).filter((b) => b.c != null);
  return { meta: { symbol: r.meta && r.meta.symbol, price: r.meta && r.meta.regularMarketPrice, prevClose: r.meta && r.meta.chartPreviousClose, currency: r.meta && r.meta.currency }, bars };
}
async function yahooChart(symbol, range = "6mo", interval = "1d") {
  const d = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  return _parseChartResult(d && d.chart && d.chart.result && d.chart.result[0]);
}
// Explicit date-range bars (period1/period2 in SECONDS). Yahoo returns TRUE daily bars for any span
// this way — unlike range=max, which silently coerces multi-year daily requests to monthly (~331 pts).
async function yahooChartPeriod(symbol, period1Sec, period2Sec, interval = "1d") {
  const d = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(period1Sec)}&period2=${Math.floor(period2Sec)}&interval=${interval}&events=div%2Csplit`);
  return _parseChartResult(d && d.chart && d.chart.result && d.chart.result[0]);
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

async function secTickerRecord(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  if (!sym) return null;
  const rows = await edgarTickers();
  return rows.find((r) => r.ticker === sym) || null;
}

function latestFact(facts, concept, unitHint = null) {
  const node = facts && facts["us-gaap"] && facts["us-gaap"][concept];
  if (!node || !node.units) return null;
  const units = Object.keys(node.units);
  const unit = unitHint && node.units[unitHint] ? unitHint : units.find((u) => /USD|shares|USD\/shares|pure/i.test(u)) || units[0];
  const arr = (node.units[unit] || [])
    .filter((x) => x && x.val != null && x.end && x.filed)
    .sort((a, b) => String(b.end).localeCompare(String(a.end)) || String(b.filed).localeCompare(String(a.filed)));
  const x = arr[0];
  return x ? { concept, label: node.label || concept, unit, value: +x.val, fy: x.fy, fp: x.fp, form: x.form, end: x.end, filed: x.filed } : null;
}

async function secCompanyIntel(symbol) {
  const rec = await secTickerRecord(symbol);
  if (!rec) return null;
  const [facts, submissions] = await Promise.all([
    fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${rec.cik}.json`, SEC_UA).catch(() => null),
    fetchJson(`https://data.sec.gov/submissions/CIK${rec.cik}.json`, SEC_UA).catch(() => null),
  ]);
  const concepts = [
    ["Assets", "USD"], ["Liabilities", "USD"], ["StockholdersEquity", "USD"],
    ["CashAndCashEquivalentsAtCarryingValue", "USD"], ["LongTermDebtNoncurrent", "USD"], ["DebtCurrent", "USD"],
    ["Revenues", "USD"], ["RevenueFromContractWithCustomerExcludingAssessedTax", "USD"],
    ["NetIncomeLoss", "USD"], ["OperatingIncomeLoss", "USD"], ["EarningsPerShareDiluted", "USD/shares"],
    ["WeightedAverageNumberOfDilutedSharesOutstanding", "shares"],
  ];
  const seen = new Set();
  const financials = [];
  for (const [concept, unit] of concepts) {
    const f = latestFact(facts && facts.facts, concept, unit);
    if (f && !seen.has(f.label)) { seen.add(f.label); financials.push(f); }
  }
  const recent = submissions && submissions.filings && submissions.filings.recent;
  const filings = recent && Array.isArray(recent.accessionNumber)
    ? recent.accessionNumber.slice(0, 12).map((_, i) => ({
      accession: recent.accessionNumber[i],
      form: recent.form && recent.form[i],
      filed: recent.filingDate && recent.filingDate[i],
      report: recent.reportDate && recent.reportDate[i],
      description: recent.primaryDocDescription && recent.primaryDocDescription[i],
      document: recent.primaryDocument && recent.primaryDocument[i],
    }))
    : [];
  return { ticker: rec.ticker, cik: rec.cik, name: rec.name, financials, filings, updated: Date.now() };
}

/* ── Treasury — average interest rates / yields (keyless) ───── */
async function treasuryYields() {
  const d = await fetchJson("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?sort=-record_date&page[size]=16");
  return ((d && d.data) || []).map((x) => ({ date: x.record_date, security: x.security_desc, rate: +x.avg_interest_rate_amt }));
}

function parseDelimited(text, delim = ",") {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(delim).map((x) => x.trim()));
}

function lastWeekdays(max = 12) {
  const out = [];
  const d = new Date();
  for (let i = 0; out.length < max && i < 25; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i));
    const day = x.getUTCDay();
    if (day !== 0 && day !== 6) out.push(`${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, "0")}${String(x.getUTCDate()).padStart(2, "0")}`);
  }
  return out;
}

async function finraShortVolume(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  if (!sym) return null;
  const feeds = ["CNMS", "FNYX", "FNQC", "FADF", "FORF"];
  for (const ymd of lastWeekdays(14)) {
    const rows = [];
    for (const feed of feeds) {
      try {
        const txt = await fetchText(`https://cdn.finra.org/equity/regsho/daily/${feed}shvol${ymd}.txt`, { timeoutMs: 12000 });
        const parsed = parseDelimited(txt, "|");
        const head = parsed[0] || [];
        const idx = (name) => head.findIndex((h) => h.toLowerCase() === name.toLowerCase());
        const iSym = idx("Symbol"), iShort = idx("ShortVolume"), iExempt = idx("ShortExemptVolume"), iTotal = idx("TotalVolume"), iMarket = idx("Market");
        for (const r of parsed.slice(1)) {
          if (iSym < 0 || String(r[iSym]).toUpperCase() !== sym) continue;
          rows.push({ market: iMarket >= 0 ? r[iMarket] : feed, shortVolume: +(r[iShort] || 0), exemptVolume: +(r[iExempt] || 0), totalVolume: +(r[iTotal] || 0) });
        }
      } catch { /* try next feed/date */ }
    }
    if (rows.length) {
      const shortVolume = rows.reduce((a, b) => a + b.shortVolume, 0);
      const exemptVolume = rows.reduce((a, b) => a + b.exemptVolume, 0);
      const totalVolume = rows.reduce((a, b) => a + b.totalVolume, 0);
      return { ticker: sym, date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`, shortVolume, exemptVolume, totalVolume, shortPct: totalVolume ? +(shortVolume / totalVolume * 100).toFixed(2) : null, venues: rows };
    }
  }
  return null;
}

async function cboeMarketSnapshot() {
  const csvLast = async (url) => {
    const txt = await fetchText(url, { timeoutMs: 16000 });
    const rows = parseDelimited(txt, ",");
    const head = rows[0] || [];
    const last = rows.slice(1).filter((r) => r.length >= 2).pop();
    return { head, last };
  };
  const [vix, vvix, vix3m, pc] = await Promise.all([
    csvLast("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv").catch(() => null),
    csvLast("https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv").catch(() => null),
    csvLast("https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX3M_History.csv").catch(() => null),
    csvLast("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/totalpc.csv").catch(() => null),
  ]);
  const closeFrom = (x) => {
    if (!x || !x.last) return null;
    const i = x.head.findIndex((h) => /close/i.test(h));
    return i >= 0 ? +x.last[i] : +x.last[x.last.length - 1];
  };
  const dateFrom = (x) => x && x.last ? x.last[0] : null;
  const vixClose = closeFrom(vix), vix3mClose = closeFrom(vix3m);
  const pcRatio = pc && pc.last ? +(pc.last[pc.last.length - 1]) : null;
  const snap = {
    updated: Date.now(),
    vix: vixClose, vvix: closeFrom(vvix), vix3m: vix3mClose,
    vixDate: dateFrom(vix), putCallDate: dateFrom(pc),
    termSpread: vixClose != null && vix3mClose != null ? +(vix3mClose - vixClose).toFixed(2) : null,
    putCallRatio: Number.isFinite(pcRatio) ? pcRatio : null,
  };
  return [snap.vix, snap.vvix, snap.vix3m, snap.putCallRatio].some((x) => x != null && Number.isFinite(x)) ? snap : null;
}

async function cftcCotSnapshot() {
  const markets = ["E-MINI S&P 500", "NASDAQ-100", "RUSSELL", "VIX", "GOLD", "CRUDE OIL", "U.S. DOLLAR INDEX"];
  const where = encodeURIComponent(markets.map((m) => `market_and_exchange_names like '%${m}%'`).join(" OR "));
  const url = `https://publicreporting.cftc.gov/resource/jun7-fc8e.json?$limit=80&$order=report_date_as_yyyy_mm_dd DESC&$where=${where}`;
  const rows = await fetchJson(url, { timeoutMs: 20000 }).catch(() => []);
  const byKey = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = (r.market_and_exchange_names || "").replace(/\s+/g, " ").trim();
    if (!key || byKey.has(key)) continue;
    const long = +(r.noncomm_positions_long_all || 0);
    const short = +(r.noncomm_positions_short_all || 0);
    byKey.set(key, {
      market: key,
      date: r.report_date_as_yyyy_mm_dd,
      asset: r.cftc_contract_market_code,
      nonCommercialLong: long,
      nonCommercialShort: short,
      nonCommercialNet: long - short,
      openInterest: +(r.open_interest_all || 0),
    });
  }
  const items = Array.from(byKey.values()).slice(0, 12);
  return items.length ? { updated: Date.now(), items } : null;
}

async function nasdaqTraderSymbols() {
  const listed = await fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", { timeoutMs: 16000 }).catch(() => "");
  const other = await fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", { timeoutMs: 16000 }).catch(() => "");
  const parse = (txt, exchange) => {
    const rows = parseDelimited(txt, "|").filter((r) => r[0] && !/^File Creation Time/i.test(r[0]));
    const head = rows[0] || [];
    const body = rows.slice(1);
    const ix = (n) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase());
    return body.map((r) => ({
      symbol: r[ix(exchange === "NASDAQ" ? "Symbol" : "ACT Symbol")],
      name: r[ix("Security Name")] || r[ix("SecurityName")],
      etf: /Y/i.test(r[ix("ETF")]),
      test: /Y/i.test(r[ix("Test Issue")]),
      exchange,
    })).filter((r) => r.symbol);
  };
  const rows = [...parse(listed, "NASDAQ"), ...parse(other, "NYSE/AMEX")].filter((r) => !r.test);
  if (!a && !b) return null;
  return {
    updated: Date.now(),
    total: rows.length,
    etfs: rows.filter((r) => r.etf).length,
    stocks: rows.filter((r) => !r.etf).length,
    nasdaq: rows.filter((r) => r.exchange === "NASDAQ").length,
    other: rows.filter((r) => r.exchange !== "NASDAQ").length,
    sample: rows.slice(0, 24),
  };
}

function unzipFirstFile(buf) {
  let off = 0;
  while (off < buf.length - 30) {
    if (buf.readUInt32LE(off) !== 0x04034b50) { off += 1; continue; }
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString("utf8");
    const start = off + 30 + nameLen + extraLen;
    const data = buf.slice(start, start + compSize);
    if (!/\/$/.test(name)) return method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
    off = start + compSize;
  }
  return "";
}

function parseKenFrenchCsv(text) {
  const rows = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const data = [];
  for (const line of rows) {
    if (!/^\d{8},/.test(line)) continue;
    const parts = line.split(",").map((x) => x.trim());
    const date = `${parts[0].slice(0, 4)}-${parts[0].slice(4, 6)}-${parts[0].slice(6)}`;
    data.push({ date, values: parts.slice(1).map(Number) });
  }
  return data;
}

async function kenFrenchSnapshot() {
  const readZip = async (url) => parseKenFrenchCsv(unzipFirstFile(await fetchBuffer(url, { timeoutMs: 25000 })));
  const [ff, mom] = await Promise.all([
    readZip("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Research_Data_Factors_daily_CSV.zip").catch(() => []),
    readZip("https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/F-F_Momentum_Factor_daily_CSV.zip").catch(() => []),
  ]);
  const a = ff[ff.length - 1], b = mom[mom.length - 1];
  return {
    updated: Date.now(),
    date: a && a.date,
    mktRf: a ? a.values[0] : null,
    smb: a ? a.values[1] : null,
    hml: a ? a.values[2] : null,
    rf: a ? a.values[3] : null,
    momentumDate: b && b.date,
    momentum: b ? b.values[0] : null,
  };
}

async function blsSnapshot() {
  const now = new Date();
  const body = JSON.stringify({
    seriesid: ["CUSR0000SA0", "LNS14000000", "CES0000000001", "CES0500000003"],
    startyear: String(now.getUTCFullYear() - 2),
    endyear: String(now.getUTCFullYear()),
  });
  const d = await fetchJson("https://api.bls.gov/publicAPI/v2/timeseries/data/", { method: "POST", headers: { "content-type": "application/json" }, body, timeoutMs: 20000 });
  const labels = { CUSR0000SA0: "CPI", LNS14000000: "Unemployment", CES0000000001: "Payrolls", CES0500000003: "Avg Hourly Earnings" };
  const series = ((d && d.Results && d.Results.series) || []).map((s) => {
    const rows = (s.data || []).slice().sort((a, b) => (a.year + a.period).localeCompare(b.year + b.period));
    const cur = rows[rows.length - 1], prev = rows[rows.length - 2];
    const value = cur ? +cur.value : null, prior = prev ? +prev.value : null;
    return { id: s.seriesID, label: labels[s.seriesID] || s.seriesID, period: cur ? `${cur.periodName} ${cur.year}` : null, value, prev: prior, change: value != null && prior != null ? +(value - prior).toFixed(3) : null };
  });
  return { updated: Date.now(), series };
}

async function fedH15Snapshot() {
  const txt = await fetchText("https://www.federalreserve.gov/releases/h15/current/default.htm", { timeoutMs: 16000 }).catch(() => "");
  const pick = (label) => {
    const rx = new RegExp(label + "[\\s\\S]{0,700}?([0-9]+\\.[0-9]+)", "i");
    const m = txt.match(rx);
    return m ? +m[1] : null;
  };
  const snap = {
    updated: Date.now(),
    fedFunds: pick("Federal funds"),
    treasury3m: pick("3-month"),
    treasury2y: pick("2-year"),
    treasury10y: pick("10-year"),
    source: "Federal Reserve H.15 current release",
  };
  return [snap.fedFunds, snap.treasury3m, snap.treasury2y, snap.treasury10y].some((x) => x != null && Number.isFinite(x)) ? snap : null;
}

async function defiLlamaSnapshot() {
  const [protocols, stables] = await Promise.all([
    fetchJson("https://api.llama.fi/protocols", { timeoutMs: 20000 }).catch(() => []),
    fetchJson("https://stablecoins.llama.fi/stablecoins?includePrices=true", { timeoutMs: 20000 }).catch(() => null),
  ]);
  const ps = Array.isArray(protocols) ? protocols : [];
  const topProtocols = ps.filter((p) => Number.isFinite(+p.tvl)).sort((a, b) => +b.tvl - +a.tvl).slice(0, 8).map((p) => ({ name: p.name, chain: p.chain, category: p.category, tvl: +p.tvl, change1d: +(p.change_1d || 0), change7d: +(p.change_7d || 0) }));
  const tvl = ps.reduce((a, p) => a + (+p.tvl || 0), 0);
  const stablecoins = ((stables && stables.peggedAssets) || [])
    .filter((x) => Number.isFinite(+(x.circulating && x.circulating.peggedUSD)))
    .sort((a, b) => +(b.circulating && b.circulating.peggedUSD || 0) - +(a.circulating && a.circulating.peggedUSD || 0))
    .slice(0, 6)
    .map((x) => ({ name: x.name, symbol: x.symbol, mcap: +(x.circulating && x.circulating.peggedUSD || 0) }));
  const stableMcap = stablecoins.reduce((a, x) => a + x.mcap, 0);
  return { updated: Date.now(), tvl, topProtocols, stableMcap, stablecoins };
}

async function yahooOptionsChain(symbol) {
  const sym = String(symbol || "").toUpperCase().trim();
  if (!sym) return null;
  const d = await fetchJson(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(sym)}`, { timeoutMs: 16000 });
  const root = d && d.optionChain && d.optionChain.result && d.optionChain.result[0];
  const opt = root && root.options && root.options[0];
  if (!root || !opt) return null;
  const calls = opt.calls || [], puts = opt.puts || [];
  const sum = (arr, key) => arr.reduce((a, x) => a + (+x[key] || 0), 0);
  const avgIv = (arr) => {
    const xs = arr.map((x) => +x.impliedVolatility).filter(Number.isFinite);
    return xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length * 100).toFixed(2) : null;
  };
  const callVol = sum(calls, "volume"), putVol = sum(puts, "volume");
  const callOi = sum(calls, "openInterest"), putOi = sum(puts, "openInterest");
  return {
    ticker: sym,
    quote: root.quote || null,
    expiry: opt.expirationDate ? new Date(opt.expirationDate * 1000).toISOString().slice(0, 10) : null,
    expirations: (root.expirationDates || []).slice(0, 8).map((t) => new Date(t * 1000).toISOString().slice(0, 10)),
    callVolume: callVol, putVolume: putVol, putCallVolume: callVol ? +(putVol / callVol).toFixed(2) : null,
    callOpenInterest: callOi, putOpenInterest: putOi, putCallOpenInterest: callOi ? +(putOi / callOi).toFixed(2) : null,
    callIv: avgIv(calls), putIv: avgIv(puts),
    topCalls: calls.filter((x) => x.volume || x.openInterest).sort((a, b) => (+b.volume || 0) - (+a.volume || 0)).slice(0, 5).map((x) => ({ strike: x.strike, volume: x.volume || 0, oi: x.openInterest || 0, iv: x.impliedVolatility ? +(x.impliedVolatility * 100).toFixed(2) : null })),
    topPuts: puts.filter((x) => x.volume || x.openInterest).sort((a, b) => (+b.volume || 0) - (+a.volume || 0)).slice(0, 5).map((x) => ({ strike: x.strike, volume: x.volume || 0, oi: x.openInterest || 0, iv: x.impliedVolatility ? +(x.impliedVolatility * 100).toFixed(2) : null })),
  };
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

module.exports = {
  binanceKlines, binanceDepth, binance24h, coinbaseDepth, coinbaseTrades,
  yahooChart, yahooChartPeriod, yahooQuotes, yahooOptionsChain,
  gdeltNews, nwsAlerts, edgarTickers, secCompanyIntel, finraShortVolume,
  treasuryYields, cboeMarketSnapshot, cftcCotSnapshot, nasdaqTraderSymbols,
  kenFrenchSnapshot, blsSnapshot, fedH15Snapshot, defiLlamaSnapshot,
  tvScan, tvMovers, tvBreadth, cryptoFearGreed, wikiAttention, secFormFour, btcNetwork,
};
