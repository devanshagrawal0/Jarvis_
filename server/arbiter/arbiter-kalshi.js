// Standalone public Kalshi read client for the Arbiter — only `events()` and
// `candlesticks()`, the two methods the engine/scheduler need. Kept separate
// from server/providers/kalshi-provider.js (the authenticated trading provider
// APEX uses) so the Arbiter's public, key-free reads never touch it. Both
// endpoints below are public on the Kalshi elections API — no auth required.
const KALSHI_PRODUCTION_API = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_CATEGORY_MAP = {
  politics: ["politics", "elections", "world"],
  sports: ["sports"],
};

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(String(url), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Kalshi ${res.status}`);
  const data = await res.json();
  return { data };
}

function createArbiterKalshi({ fetchImpl = fetch } = {}) {
  // Paginated open-market pull for a category, flattening nested markets and
  // normalizing YES bid/ask to cents. Mirrors the friend's Arbiter contract.
  async function events({ category = "politics", limit = 250, maxPages = 3 } = {}) {
    const keep = new Set((KALSHI_CATEGORY_MAP[category] || [category]).map((c) => c.toLowerCase()));
    const out = [];
    let cursor = "";
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(`${KALSHI_PRODUCTION_API}/events`);
      url.searchParams.set("status", "open");
      url.searchParams.set("with_nested_markets", "true");
      url.searchParams.set("limit", String(Math.min(200, limit)));
      if (cursor) url.searchParams.set("cursor", cursor);
      let data;
      try {
        ({ data } = await fetchJson(fetchImpl, url));
      } catch {
        break;
      }
      for (const ev of data.events || []) {
        if (!keep.has(String(ev.category || "").toLowerCase())) continue;
        for (const m of ev.markets || []) {
          const yesBidDollars = m.yes_bid_dollars;
          const yesAskDollars = m.yes_ask_dollars;
          if (yesBidDollars == null && yesAskDollars == null) continue;
          const yesBid = yesBidDollars == null ? null : Math.round(Number(yesBidDollars) * 100);
          const yesAsk = yesAskDollars == null ? null : Math.round(Number(yesAskDollars) * 100);
          if (!yesBid && !yesAsk) continue; // skip zero-priced
          out.push({
            ticker: m.ticker,
            title: m.title || m.yes_sub_title || ev.title || "",
            eventTitle: ev.title || "",
            subtitle: m.subtitle || m.yes_sub_title || "",
            category: ev.category || "",
            yesBid, yesAsk,
            volume: m.volume ?? 0,
            closeTime: m.close_time || m.expiration_time || ev.close_time || "",
          });
        }
      }
      cursor = data.cursor || data.next_cursor || "";
      if (!cursor || out.length >= limit * 2) break;
    }
    return { markets: out, category, source: `${KALSHI_PRODUCTION_API}/events` };
  }

  // Hourly candlesticks for a single market → array of YES cents (downsampled).
  async function candlesticks(ticker, { days = 7, periodMinutes = 60, points = 24 } = {}) {
    if (!ticker) return [];
    const series = String(ticker).split("-")[0];
    if (!series) return [];
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - days * 86400;
    try {
      const url = new URL(`${KALSHI_PRODUCTION_API}/series/${series}/markets/${ticker}/candlesticks`);
      url.searchParams.set("start_ts", String(startTs));
      url.searchParams.set("end_ts", String(endTs));
      url.searchParams.set("period_interval", String(periodMinutes));
      const { data } = await fetchJson(fetchImpl, url);
      const num = (v) => (v == null || v === "" ? null : Number(v));
      const out = [];
      for (const c of data.candlesticks || []) {
        const yb = num(c.yes_bid?.close_dollars);
        const ya = num(c.yes_ask?.close_dollars);
        const mid = yb != null && ya != null ? (yb + ya) / 2 : null;
        const dollars =
          num(c.price?.close_dollars) ?? num(c.price?.mean_dollars) ?? mid ?? num(c.price?.previous_dollars);
        if (dollars == null || !Number.isFinite(dollars)) continue;
        out.push(Math.max(1, Math.min(99, Math.round(dollars * 100))));
      }
      if (out.length <= points) return out;
      const step = (out.length - 1) / (points - 1);
      const sampled = [];
      for (let i = 0; i < points; i += 1) sampled.push(out[Math.round(i * step)]);
      return sampled;
    } catch {
      return [];
    }
  }

  return { events, candlesticks };
}

module.exports = { createArbiterKalshi };
