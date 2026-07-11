// Polymarket provider — public Gamma API (read-only, no key required).
// Used by Arbiter to fetch live prediction-market prices for cross-platform
// divergence detection. Trading/relayer credentials are NOT used here; Arbiter
// is read-only intelligence.
const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

// Category → Gamma tag_slug. Filtering only works on the /events endpoint
// (the /markets endpoint ignores tag filters), so we fetch events by tag_slug
// and flatten their nested markets.
const CATEGORY_TAGS = {
  politics: "politics",
  sports: "sports",
};

function createPolymarketProvider({ getSettings } = {}) {
  // Public reads need no auth. Keep getSettings for future authenticated calls.
  void getSettings;

  // outcomes / outcomePrices come back from Gamma as JSON-encoded strings
  // (e.g. "[\"Yes\", \"No\"]"). Parse defensively whether string or array.
  function parseJsonish(value, fallback) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return fallback;
  }

  function toCents(price) {
    const n = Number(price);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n * 100)));
  }

  function normalize(market) {
    const outcomes = parseJsonish(market.outcomes, []);
    const prices = parseJsonish(market.outcomePrices, []);
    // Standard binary market: outcomes = ["Yes","No"]. Find the YES leg.
    let yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
    if (yesIdx < 0) yesIdx = 0; // fall back to first leg for non-Yes/No binaries
    const yesCents = toCents(prices[yesIdx]);
    if (yesCents == null) return null;
    const noCents = 100 - yesCents;
    // clobTokenIds pairs 1:1 with outcomes; the YES leg's token id is what the
    // CLOB prices-history endpoint keys on. Comes back as a JSON-encoded string.
    const clobTokenIds = parseJsonish(market.clobTokenIds, []);
    const clobTokenIdYes = clobTokenIds[yesIdx] != null ? String(clobTokenIds[yesIdx]) : null;
    return {
      id: String(market.id),
      question: market.question || market.slug || "",
      slug: market.slug || "",
      yesCents,
      noCents,
      clobTokenIdYes,
      bestBidCents: toCents(market.bestBid),
      bestAskCents: toCents(market.bestAsk),
      spreadCents: market.spread != null ? Math.round(Number(market.spread) * 100) : null,
      volume: Math.round(Number(market.volumeNum ?? market.volume ?? 0)),
      liquidity: Math.round(Number(market.liquidityNum ?? market.liquidity ?? 0)),
      oneWeekChange: market.oneWeekPriceChange != null ? Number(market.oneWeekPriceChange) : null,
      endDate: market.endDate || market.endDateIso || "",
      outcomes,
      url: market.slug ? `https://polymarket.com/event/${market.slug}` : "https://polymarket.com",
    };
  }

  async function fetchEvents(params) {
    const qs = new URLSearchParams({ closed: "false", active: "true", ...params }).toString();
    const res = await fetch(`${GAMMA_BASE}/events?${qs}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Object.assign(new Error(`Polymarket ${res.status}`), { statusCode: res.status });
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  }

  // markets({ category, limit, minVolume }) → normalized, liquid, binary markets.
  // Fetches events by tag_slug, then flattens + normalizes their nested markets.
  async function markets({ category = "politics", limit = 40, minVolume = 5000, eventLimit = 40 } = {}) {
    const tagSlug = CATEGORY_TAGS[category] || CATEGORY_TAGS.politics;
    let events = [];
    try {
      events = await fetchEvents({ tag_slug: tagSlug, limit: String(eventLimit), order: "volume", ascending: "false" });
    } catch {
      return [];
    }
    const seen = new Map();
    for (const ev of events) {
      if (ev.closed || ev.archived) continue;
      for (const m of ev.markets || []) {
        if (m.closed || m.archived) continue;
        const n = normalize(m);
        if (!n) continue;
        if (n.volume < minVolume) continue;
        if (n.outcomes.length !== 2) continue; // binary Yes/No only — comparable to Kalshi
        if (!seen.has(n.id)) {
          seen.set(n.id, { ...n, category, eventTitle: ev.title || "", eventSlug: ev.slug || "" });
        }
      }
    }
    return [...seen.values()].sort((a, b) => b.volume - a.volume).slice(0, limit);
  }

  // Fetch a single market by id to check resolution (for scorecard grading).
  // Returns { closed, resolvedOutcome: "YES"|"NO"|null } or null on error.
  async function marketById(id) {
    try {
      const res = await fetch(`${GAMMA_BASE}/markets/${encodeURIComponent(id)}`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      const m = await res.json();
      if (!m || (!m.closed && !m.archived)) return { closed: false, resolvedOutcome: null };
      const prices = parseJsonish(m.outcomePrices, []);
      const outcomes = parseJsonish(m.outcomes, []);
      let resolvedOutcome = null;
      // A resolved binary market has prices settled to ~1 / ~0.
      const yesIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
      const yi = yesIdx >= 0 ? yesIdx : 0;
      const yesPrice = Number(prices[yi]);
      if (Number.isFinite(yesPrice)) resolvedOutcome = yesPrice >= 0.9 ? "YES" : yesPrice <= 0.1 ? "NO" : null;
      return { closed: true, resolvedOutcome };
    } catch {
      return null;
    }
  }

  // Downsample a series to at most `max` evenly-spaced points so charts stay
  // light without distorting the shape.
  function downsample(arr, max = 24) {
    if (arr.length <= max) return arr;
    const step = (arr.length - 1) / (max - 1);
    const out = [];
    for (let i = 0; i < max; i += 1) out.push(arr[Math.round(i * step)]);
    return out;
  }

  // Real YES-price history for a market's CLOB token, as a cents series.
  // Keyless CLOB endpoint. Returns [] on any failure (caller falls back).
  //   priceHistory({ tokenId, interval, fidelity })
  async function priceHistory({ tokenId, interval = "1w", fidelity = 60, points = 24 } = {}) {
    if (!tokenId) return [];
    try {
      const qs = new URLSearchParams({ market: String(tokenId), interval, fidelity: String(fidelity) });
      const res = await fetch(`${CLOB_BASE}/prices-history?${qs}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      const series = (data.history || [])
        .map((h) => toCents(h.p))
        .filter((c) => c != null);
      return downsample(series, points);
    } catch {
      return [];
    }
  }

  async function health() {
    try {
      const res = await fetch(`${GAMMA_BASE}/markets?limit=1`, { signal: AbortSignal.timeout(8000) });
      return { connected: res.ok, source: "public-gamma" };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  return { markets, marketById, priceHistory, health, _normalize: normalize };
}

module.exports = { createPolymarketProvider, CATEGORY_TAGS };
