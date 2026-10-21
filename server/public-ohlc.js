"use strict";

// Free public price history for chart panels, used when APEX's local apex_bars table has no rows
// for the requested ticker (which is most of them). Stocks come from the keyless Yahoo Finance
// chart API, crypto from the keyless Coinbase candles API. (stooq now serves a JS bot-challenge and
// Binance geoblocks, so neither is usable server-side.) Returns bars in the exact shape apex
// getBars produces: [{ t: ISO, o, h, l, c, v }], oldest first. Never throws — returns [] on failure.

const CRYPTO = new Set([
  "BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "MATIC", "POL", "LTC", "LINK",
  "TRX", "SHIB", "UNI", "ATOM", "XLM", "ETC", "BCH", "NEAR", "APT", "ARB", "OP", "FIL", "ICP",
  "HBAR", "VET", "INJ", "SUI", "SEI", "TIA", "RUNE", "AAVE", "ALGO", "GRT", "SAND", "MANA", "PEPE", "WIF",
]);

const isoFromMs = (ms) => new Date(ms).toISOString();

async function fetchJson(url, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (JARVIS)" } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

// Coinbase candles: [ time(sec), low, high, open, close, volume ], newest first. No weekly.
async function fetchCrypto(base, tf, days) {
  const granularity = tf === "5m" ? 300 : 86400;
  const cutoff = Date.now() - days * 86400_000;
  const rows = await fetchJson(`https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${granularity}`);
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows
    .map((r) => ({ t: isoFromMs(r[0] * 1000), o: Number(r[3]), h: Number(r[2]), l: Number(r[1]), c: Number(r[4]), v: Number(r[5]) }))
    .filter((b) => Number.isFinite(b.c) && new Date(b.t).getTime() >= cutoff)
    .sort((a, b) => new Date(a.t) - new Date(b.t));
}

// Yahoo chart API: result[0].timestamp[] (sec) + indicators.quote[0].{open,high,low,close,volume}[].
function yahooRange(days) {
  if (days <= 5) return "5d";
  if (days <= 31) return "1mo";
  if (days <= 93) return "3mo";
  if (days <= 186) return "6mo";
  if (days <= 366) return "1y";
  if (days <= 732) return "2y";
  if (days <= 1830) return "5y";
  return "max";
}
async function fetchStock(ticker, tf, days) {
  const interval = tf === "1wk" ? "1wk" : tf === "5m" ? "5m" : "1d";
  // 5m data is only available over short ranges on Yahoo.
  const range = interval === "5m" ? (days <= 5 ? "5d" : "1mo") : yahooRange(days);
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    const j = await fetchJson(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`);
    const r = j && j.chart && Array.isArray(j.chart.result) ? j.chart.result[0] : null;
    const ts = r && Array.isArray(r.timestamp) ? r.timestamp : null;
    const q = r && r.indicators && Array.isArray(r.indicators.quote) ? r.indicators.quote[0] : null;
    if (ts && q) {
      const cutoff = Date.now() - days * 86400_000;
      const bars = ts.map((t, i) => ({ t: isoFromMs(t * 1000), o: Number(q.open?.[i]), h: Number(q.high?.[i]), l: Number(q.low?.[i]), c: Number(q.close?.[i]), v: Number(q.volume?.[i]) }))
        .filter((b) => Number.isFinite(b.c) && new Date(b.t).getTime() >= cutoff);
      if (bars.length) return bars;
    }
  }
  return [];
}

// ticker: "BTC", "TSLA", "BTC-USD", "BTCUSD"… tf: 1d|1wk|5m ; days: window.
async function fetchPublicOHLC(ticker, { tf = "1d", days = 30 } = {}) {
  const raw = String(ticker || "").toUpperCase().trim();
  if (!raw) return [];
  const base = raw.replace(/[-/]?USDT?$/i, "").replace(/[-/]?USD$/i, "");
  try {
    if (CRYPTO.has(base)) return await fetchCrypto(base, tf, days);
    return await fetchStock(raw.replace(/\.US$/i, ""), tf, days);
  } catch { return []; }
}

module.exports = { fetchPublicOHLC, CRYPTO };
