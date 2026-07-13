const crypto = require("crypto");
const { cleanString, errorWithStatus, fetchJson } = require("./provider-utils");

const KALSHI_PRODUCTION_API = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_LEGACY_API = "https://external-api.kalshi.com/trade-api/v2";
const KALSHI_DEMO_API = "https://demo-api.kalshi.co/trade-api/v2";
const ALLOWED_BASES = new Set([KALSHI_PRODUCTION_API, KALSHI_LEGACY_API, KALSHI_DEMO_API]);

function createKalshiProvider({ getSettings, fetchImpl = fetch }) {
  function baseUrl(settings = getSettings()) {
    const explicit = cleanString(settings.kalshiBaseUrl, 500).replace(/\/+$/, "");
    const selected = explicit || (settings.kalshiEnvironment === "demo" ? KALSHI_DEMO_API : KALSHI_LEGACY_API);
    if (!ALLOWED_BASES.has(selected)) throw errorWithStatus("Kalshi API base URL is not approved", 412);
    return selected;
  }

  function credentials(settings = getSettings()) {
    return {
      keyId: settings.kalshiKeyId || process.env.KALSHI_API_KEY_ID || "",
      privateKey: settings.kalshiPrivateKey || process.env.KALSHI_PRIVATE_KEY || "",
    };
  }

  function status(settings = getSettings()) {
    const { keyId, privateKey } = credentials(settings);
    const missing = [];
    if (!keyId) missing.push("kalshiKeyId");
    if (!privateKey) missing.push("kalshiPrivateKey");
    return {
      connected: Boolean(keyId && privateKey),
      configured: Boolean(keyId && privateKey),
      source: process.env.KALSHI_API_KEY_ID || process.env.KALSHI_PRIVATE_KEY ? "env" : keyId || privateKey ? "local" : "missing",
      label: "Kalshi Auth",
      authMode: "rsa-pss",
      environment: settings.kalshiEnvironment === "demo" ? "demo" : "production",
      baseUrl: baseUrl(settings),
      missing,
      publicDataAvailable: true,
    };
  }

  function signedHeaders(method, pathWithQuery, settings = getSettings(), timestamp = String(Date.now())) {
    const { keyId, privateKey } = credentials(settings);
    if (!keyId || !privateKey) throw errorWithStatus("Kalshi authenticated APIs require a key ID and RSA private key", 412);
    const pathWithoutQuery = String(pathWithQuery).split("?")[0];
    const message = `${timestamp}${String(method).toUpperCase()}${pathWithoutQuery}`;
    let signature;
    try {
      signature = crypto.sign("sha256", Buffer.from(message), {
        key: privateKey.replace(/\\n/g, "\n"),
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }).toString("base64");
    } catch (error) {
      throw errorWithStatus(`Kalshi private key is invalid: ${error.message}`, 412);
    }
    return {
      "KALSHI-ACCESS-KEY": keyId,
      "KALSHI-ACCESS-TIMESTAMP": timestamp,
      "KALSHI-ACCESS-SIGNATURE": signature,
    };
  }

  async function authenticatedGet(pathWithQuery) {
    const base = baseUrl();
    const url = new URL(pathWithQuery, `${base}/`);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith("/trade-api/v2/")) {
      throw errorWithStatus("Kalshi request path is not approved", 400);
    }
    const { data } = await fetchJson(fetchImpl, url, {
      headers: signedHeaders("GET", `${url.pathname}${url.search}`),
    });
    return data;
  }

  async function publicGet(pathWithQuery) {
    const base = baseUrl();
    const url = new URL(pathWithQuery, `${base}/`);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith("/trade-api/v2/")) {
      throw errorWithStatus("Kalshi request path is not approved", 400);
    }
    const { data } = await fetchJson(fetchImpl, url);
    return data;
  }

  function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function money(value) {
    return Math.round(numberValue(value) * 100) / 100;
  }

  function centsToDollars(value) {
    return Math.round((numberValue(value) / 100) * 100) / 100;
  }

  function priceLabel(value) {
    const parsed = numberValue(value);
    if (!Number.isFinite(parsed)) return "";
    return `${Math.round(parsed * 100)}¢`;
  }

  function sideLabel(side = "") {
    const value = String(side || "").toLowerCase();
    if (value === "yes") return "YES";
    if (value === "no") return "NO";
    return value ? value.toUpperCase() : "contract";
  }

  function humanTime(value) {
    if (!value) return "";
    const parsed = typeof value === "number" ? new Date(value * 1000) : new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
  }

  const SERIES_KEYWORD_MAP = [
    { match: ["bitcoin", "btc"], series: ["KXBTC"] },
    { match: ["ethereum", "eth", "ether"], series: ["KXETH"] },
    { match: ["crypto", "cryptocurrency"], series: ["KXBTC", "KXETH"] },
    { match: ["fed", "federal reserve", "fomc", "interest rate", "rate cut", "rate hike", "basis points"], series: ["KXFED"] },
    { match: ["cpi", "inflation", "consumer price", "pce"], series: ["KXCPI"] },
    { match: ["nba", "basketball", "pro basketball"], series: ["KXNBA"] },
    { match: ["mlb", "baseball", "pro baseball", "world series"], series: ["KXMLB"] },
    { match: ["world cup", "fifa", "soccer", "wc2026"], series: ["KXWCADVANCE", "KXWC1H", "KXWCBTTS"] },
    { match: ["usa", "united states", "usmnt", "us team"], series: ["KXWCADVANCE", "KXWC1H", "KXWCBTTS"] },
    { match: ["advance", "qualify", "knockout", "win the match"], series: ["KXWCADVANCE"] },
    { match: ["both teams score", "btts"], series: ["KXWCBTTS"] },
    { match: ["1st half", "first half", "halftime", "half time"], series: ["KXWC1H"] },
  ];
  const DEFAULT_BROWSE_SERIES = ["KXBTC", "KXETH", "KXFED", "KXCPI", "KXNBA", "KXMLB", "KXWCADVANCE", "KXWC1H", "KXWCBTTS"];

  const TEAM_ALIASES = {
    mexico: ["mexico", "mex", "mexican", "el tri"],
    "united states": ["united states", "usa", "usmnt", "u.s.", "america"],
    canada: ["canada", "can", "canadian"],
    jamaica: ["jamaica", "jam"],
    brazil: ["brazil", "bra"],
    argentina: ["argentina", "arg"],
    england: ["england", "eng"],
    france: ["france", "fra"],
    germany: ["germany", "ger", "deutschland"],
    spain: ["spain", "esp"],
    italy: ["italy", "ita"],
    portugal: ["portugal", "por"],
    netherlands: ["netherlands", "ned", "holland"],
    colombia: ["colombia", "col"],
    uruguay: ["uruguay", "uru"],
    japan: ["japan", "jpn"],
    "south korea": ["south korea", "korea", "kor"],
    czechia: ["czechia", "czech republic", "cze"],
  };

  const MARKET_SYNONYMS = [
    ["world cup", "fifa", "soccer", "football", "match", "game"],
    ["winner", "win", "wins", "moneyline", "match winner"],
    ["advance", "qualify", "group", "round", "knockout"],
    ["goals", "score", "assist", "shots", "corners"],
  ];
  const STOP_MARKET_TERMS = new Set([
    "the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "please",
    "can", "could", "would", "find", "search", "check", "look", "current", "live", "today",
    "right", "now", "on", "in", "at", "to", "of", "el", "kalshi", "market", "markets", "bet", "bets",
    "odds", "line", "lines", "contract", "contracts",
  ]);
  const GENERIC_MARKET_TERMS = new Set(["game", "match", "winner", "win", "wins", "moneyline", "advance", "qualify", "goals", "score", "assist", "group"]);
  const GENERIC_MARKET_PHRASES = new Set(["game", "match", "to win", "match winner", "to advance", "goals", "score", "assist"]);

  function textTerms(value) {
    return [...new Set(String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !STOP_MARKET_TERMS.has(term)))];
  }

  function searchText(market = {}) {
    return [
      market.ticker,
      market.title,
      market.subtitle,
      market.event_ticker,
      market.series_ticker,
      market.category,
      market.rules_primary,
      market.rules_secondary,
      market.status,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function expandMarketQuery(query = "") {
    const clean = cleanString(query, 700).toLowerCase();
    const terms = new Set(textTerms(clean));
    const phrases = new Set([clean].filter(Boolean));
    const requiredTerms = new Set();
    const requiredPhrases = new Set();
    for (const [canonical, aliases] of Object.entries(TEAM_ALIASES)) {
      if (aliases.some((alias) => clean.includes(alias))) {
        phrases.add(canonical);
        aliases.forEach((alias) => {
          phrases.add(alias);
          requiredPhrases.add(alias);
          textTerms(alias).forEach((term) => {
            terms.add(term);
            requiredTerms.add(term);
          });
        });
      }
    }
    for (const group of MARKET_SYNONYMS) {
      if (group.some((term) => clean.includes(term))) {
        group.forEach((term) => {
          phrases.add(term);
          textTerms(term).forEach((part) => terms.add(part));
        });
      }
    }
    if (/\b(game|match|playing|score|world cup|fifa|soccer|football)\b/i.test(clean)) {
      ["world cup", "fifa", "soccer", "football", "match winner", "to win", "to advance"].forEach((term) => phrases.add(term));
    }
    const dateMatches = clean.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g) || [];
    dateMatches.forEach((date) => phrases.add(date));
    return {
      original: cleanString(query, 700),
      terms: [...terms],
      phrases: [...phrases].filter(Boolean).slice(0, 40),
      requiredTerms: [...requiredTerms],
      requiredPhrases: [...requiredPhrases],
    };
  }

  function scoreMarket(market, expanded) {
    const haystack = searchText(market);
    if (!expanded.original) return 1;
    let score = 0;
    let relevance = 0;
    let specificMatched = false;
    let requiredMatched = false;
    const needsSpecificMatch = expanded.terms.some((term) => !GENERIC_MARKET_TERMS.has(term))
      || expanded.phrases.some((phrase) => phrase.includes(" ") && !GENERIC_MARKET_PHRASES.has(phrase));
    const reasons = [];
    for (const phrase of expanded.phrases) {
      if (!phrase || phrase.length < 2) continue;
      if (haystack.includes(phrase)) {
        const weight = phrase.includes(" ") ? 8 : 5;
        const generic = GENERIC_MARKET_PHRASES.has(phrase);
        score += generic ? 1 : weight;
        relevance += generic ? 1 : weight;
        if (!generic) specificMatched = true;
        if ((expanded.requiredPhrases || []).includes(phrase)) requiredMatched = true;
        reasons.push(`matched "${phrase}"`);
      }
    }
    for (const term of expanded.terms) {
      if (!term || term.length < 2) continue;
      const termRegex = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (termRegex.test(haystack)) {
        const generic = GENERIC_MARKET_TERMS.has(term);
        const weight = generic ? 1 : term.length <= 3 ? 3 : 4;
        score += weight;
        relevance += weight;
        if (!generic) specificMatched = true;
        if ((expanded.requiredTerms || []).includes(term)) requiredMatched = true;
        if (!reasons.some((reason) => reason.includes(`"${term}"`))) reasons.push(`term ${term}`);
      }
    }
    if (!relevance) return { score: 0, reasons: [] };
    if ((expanded.requiredTerms?.length || expanded.requiredPhrases?.length) && !requiredMatched) return { score: 0, reasons: [] };
    if (needsSpecificMatch && !specificMatched) return { score: 0, reasons: [] };
    if (String(market.status || "").toLowerCase() === "open") score += 4;
    if (market.volume || market.volume_24h || market.volume_fp) score += 1;
    if (/\b(world cup|fifa|soccer|football)\b/i.test(expanded.original) && /\b(world cup|fifa|soccer|football)\b/i.test(haystack)) {
      score += 6;
      reasons.push("sports context");
    }
    return { score, reasons: reasons.slice(0, 8) };
  }

  function marketIdentity(market = {}, ticker = "") {
    return {
      ticker: market.ticker || ticker,
      title: market.title || "",
      subtitle: market.subtitle || "",
      eventTicker: market.event_ticker || "",
      seriesTicker: market.series_ticker || "",
      category: market.category || "",
      status: market.status || "",
      yesBidDollars: market.yes_bid_dollars ?? null,
      yesAskDollars: market.yes_ask_dollars ?? null,
      noBidDollars: market.no_bid_dollars ?? null,
      noAskDollars: market.no_ask_dollars ?? null,
      closeTime: market.close_time || market.expiration_time || "",
    };
  }

  async function marketByTicker(ticker) {
    const cleanTicker = cleanString(ticker, 200);
    if (!cleanTicker) return null;
    try {
      const data = await publicGet(`/trade-api/v2/markets/${encodeURIComponent(cleanTicker)}`);
      return marketIdentity(data.market || data, cleanTicker);
    } catch {
      try {
        const data = await publicGet(`/trade-api/v2/historical/markets/${encodeURIComponent(cleanTicker)}`);
        return marketIdentity(data.market || data, cleanTicker);
      } catch {
        return marketIdentity({}, cleanTicker);
      }
    }
  }

  async function enrichTickers(tickers = []) {
    const unique = [...new Set(tickers.map((ticker) => cleanString(ticker, 200)).filter(Boolean))].slice(0, 50);
    if (!unique.length) return new Map();
    const map = new Map();
    try {
      const query = new URL("/trade-api/v2/markets", "https://kalshi.local");
      query.searchParams.set("tickers", unique.join(","));
      query.searchParams.set("limit", String(Math.min(1000, unique.length)));
      const data = await publicGet(`${query.pathname}${query.search}`);
      for (const market of data.markets || []) map.set(market.ticker, marketIdentity(market, market.ticker));
    } catch {
      // Fall through to per-market lookup. Market metadata is helpful, not required.
    }
    await Promise.all(unique.filter((ticker) => !map.has(ticker)).map(async (ticker) => {
      map.set(ticker, await marketByTicker(ticker));
    }));
    return map;
  }

  function normalizePosition(position, market = {}) {
    const title = market.title || "";
    const contracts = numberValue(position.position_fp);
    const exposure = money(position.market_exposure_dollars);
    const realizedPnl = money(position.realized_pnl_dollars);
    const traded = money(position.total_traded_dollars);
    const restingOrders = Number(position.resting_orders_count || 0);
    return {
      ticker: position.ticker,
      marketTitle: title,
      subtitle: market.subtitle || "",
      eventTicker: position.event_ticker || market.eventTicker || "",
      contracts,
      exposureDollars: exposure,
      realizedPnlDollars: realizedPnl,
      totalTradedDollars: traded,
      feesPaidDollars: money(position.fees_paid_dollars),
      restingOrders,
      lastUpdatedAt: position.last_updated_ts || "",
      plainEnglish: [
        title || `Market ${position.ticker}`,
        `${contracts >= 0 ? "Long" : "Short"} ${Math.abs(contracts)} contracts`,
        exposure ? `$${Math.abs(exposure).toFixed(2)} exposure` : "",
        realizedPnl ? `${realizedPnl >= 0 ? "+" : "-"}$${Math.abs(realizedPnl).toFixed(2)} realized P&L` : "$0.00 realized P&L",
        restingOrders ? `${restingOrders} resting order${restingOrders === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
    };
  }

  function normalizeFill(fill, market = {}) {
    const ticker = fill.ticker || fill.market_ticker;
    const rawSide = fill.side || fill.outcome_side;
    const side = sideLabel(rawSide);
    const contracts = numberValue(fill.count_fp);
    const price = String(side).toLowerCase() === "no" ? fill.no_price_dollars : fill.yes_price_dollars;
    const priceDollars = money(price);
    const title = market.title || "";
    const action = fill.action || "matched";
    const unknownSide = !rawSide;
    const priceText = unknownSide
      ? `YES ${priceLabel(fill.yes_price_dollars) || "n/a"} / NO ${priceLabel(fill.no_price_dollars) || "n/a"}`
      : priceLabel(priceDollars);
    return {
      fillId: fill.fill_id || "",
      tradeId: fill.trade_id || "",
      orderId: fill.order_id || "",
      ticker,
      marketTitle: title,
      subtitle: market.subtitle || "",
      side: unknownSide ? "" : side,
      action,
      contracts,
      priceDollars,
      priceLabel: priceText,
      feeDollars: money(fill.fee_cost || fill.fee_cost_dollars),
      createdAt: humanTime(fill.created_time || fill.ts),
      isTaker: Boolean(fill.is_taker),
      plainEnglish: [
        unknownSide
          ? `${action === "matched" || action === "filled" ? "Matched" : action} ${contracts} contract${Math.abs(contracts) === 1 ? "" : "s"}`
          : `${action === "matched" || action === "filled" ? "Matched" : action} ${contracts} ${side} contract${Math.abs(contracts) === 1 ? "" : "s"}`,
        `at ${priceText || `$${priceDollars.toFixed(2)}`}`,
        title ? `on ${title}` : `on ${ticker}`,
      ].join(" "),
    };
  }

  function seriesFromTicker(ticker) {
    return String(ticker || "").split("-")[0] || "";
  }

  function normalizeMarketCents(market) {
    const yesBidCents = market.yes_bid_dollars == null ? null : Math.round(Number(market.yes_bid_dollars) * 100);
    const yesAskCents = market.yes_ask_dollars == null ? null : Math.round(Number(market.yes_ask_dollars) * 100);
    const noBidCents = market.no_bid_dollars != null
      ? Math.round(Number(market.no_bid_dollars) * 100)
      : (yesAskCents != null ? 100 - yesAskCents : null);
    const noAskCents = market.no_ask_dollars != null
      ? Math.round(Number(market.no_ask_dollars) * 100)
      : (yesBidCents != null ? 100 - yesBidCents : null);
    return {
      ticker: market.ticker,
      title: market.title,
      subtitle: market.subtitle || "",
      category: market.category || "",
      eventTicker: market.event_ticker,
      seriesTicker: market.series_ticker || seriesFromTicker(market.ticker),
      yesBid: yesBidCents,
      yesAsk: yesAskCents,
      yesBidDollars: market.yes_bid_dollars ?? null,
      yesAskDollars: market.yes_ask_dollars ?? null,
      noBid: noBidCents,
      noAsk: noAskCents,
      spread: Math.abs((yesAskCents ?? 52) - (yesBidCents ?? 50)),
      volume: market.volume ?? market.volume_24h ?? market.volume_fp ?? 0,
      closeTime: market.close_time || market.expiration_time || "",
      status: market.status,
    };
  }

  async function fetchSeries(seriesTicker, perSeriesLimit = 100) {
    const url = new URL(`${baseUrl()}/markets`);
    url.searchParams.set("series_ticker", seriesTicker);
    url.searchParams.set("limit", String(perSeriesLimit));
    try {
      const { data } = await fetchJson(fetchImpl, url);
      return data.markets || [];
    } catch {
      return [];
    }
  }

  function marketVolume(m) {
    return Number(m.volume_fp || m.volume_24h_fp || m.volume || m.volume_24h || 0);
  }

  async function markets(query = "", options = {}) {
    const expanded = expandMarketQuery(query);
    const limit = Math.max(1, Math.min(50, Number(options.limit || 24)));
    const lowerQuery = (query || "").toLowerCase();

    const seriesHits = new Set();
    for (const mapping of SERIES_KEYWORD_MAP) {
      if (mapping.match.some((term) => lowerQuery.includes(term))) {
        mapping.series.forEach((s) => seriesHits.add(s));
      }
    }
    const inSeriesMode = seriesHits.size > 0;
    const targetSeries = inSeriesMode ? [...seriesHits].slice(0, 8) : [...DEFAULT_BROWSE_SERIES];

    // For search: fetch up to 100 per series; for browse: cap per-series to keep mix balanced
    const perSeriesLimit = inSeriesMode ? 100 : Math.ceil((limit * 3) / targetSeries.length) + 5;
    const batches = await Promise.all(targetSeries.map((s) => fetchSeries(s, perSeriesLimit)));

    const seen = new Set();
    const collected = [];
    for (const batch of batches) {
      for (const market of batch) {
        if (!seen.has(market.ticker)) {
          seen.add(market.ticker);
          collected.push(market);
        }
      }
    }

    const scored = collected
      .map((market) => {
        const result = scoreMarket(market, expanded);
        // Series selection narrows the fetch but does not make every provider
        // row relevant; cross-category records still require a query match.
        const score = result.score;
        return { market, score, reasons: result.reasons, vol: marketVolume(market) };
      })
      .filter((item) => !expanded.original || item.score > 0)
      .sort((left, right) => right.score !== left.score ? right.score - left.score : right.vol - left.vol);

    const DEAD_STATUSES = new Set(["finalized", "settled", "resolved"]);
    const values = scored
      .filter((item) => !DEAD_STATUSES.has(String(item.market.status || "").toLowerCase()))
      .filter((item) => !String(item.market.ticker || "").includes("MULTIGAMEEXTENDED"))
      .filter((item) => !String(item.market.ticker || "").includes("CROSSCATEGORY"))
      .filter((item) => !/^(yes |no )/i.test(String(item.market.title || "")))
      .filter((item) => (String(item.market.title || "").match(/,/g) || []).length < 2)
      .slice(0, limit)
      .map((item) => ({ ...normalizeMarketCents(item.market), score: item.score, matchReasons: item.reasons || [] }));

    return {
      markets: values,
      fetchedAt: new Date().toISOString(),
      source: baseUrl(),
      searchPlan: {
        originalQuery: expanded.original,
        targetSeries,
        fetchedMarkets: collected.length,
        returnedMarkets: values.length,
      },
      plainEnglish: values.length
        ? values.slice(0, 5).map((market, index) =>
          `${index + 1}. ${market.title || market.ticker} (${market.ticker})${market.yesBid != null || market.yesAsk != null ? ` YES ${market.yesBid ?? "?"}-${market.yesAsk ?? "?"} cents` : ""}`
        ).join("\n")
        : `No Kalshi markets found for "${expanded.original}" in series [${targetSeries.join(", ")}].`,
    };
  }

  async function marketDiscovery(args = {}) {
    const query = cleanString(args.query || args.event || args.game || "", 700);
    const result = await markets(query, {
      maxPages: args.maxPages || 8,
      limit: args.limit || 12,
    });
    return {
      ...result,
      workflow: "kalshi_market_discovery",
      instruction: result.markets.length
        ? "Use these ranked candidates. If the user said they see a different market on screen, inspect the visible screen before saying it is unavailable."
        : "Do not claim the market does not exist globally. Say these exact Kalshi API searches found no match, then try web/screen context if available.",
    };
  }

  async function balance() {
    const data = await authenticatedGet("/trade-api/v2/portfolio/balance");
    const balanceDollars = data.balance_dollars != null ? money(data.balance_dollars) : centsToDollars(data.balance);
    const portfolioValueDollars = data.portfolio_value_dollars != null
      ? money(data.portfolio_value_dollars)
      : centsToDollars(data.portfolio_value);
    return {
      balance: data.balance,
      balanceDollars,
      portfolioValue: data.portfolio_value ?? null,
      portfolioValueDollars,
      updatedAt: humanTime(data.updated_ts),
      currency: "USD",
      plainEnglish: `Cash balance $${balanceDollars.toFixed(2)}; portfolio value $${portfolioValueDollars.toFixed(2)}.`,
    };
  }

  async function positions({ limit = 100, cursor = "", settlementStatus = "" } = {}) {
    const url = new URL("/trade-api/v2/portfolio/positions", "https://kalshi.local");
    url.searchParams.set("limit", String(Math.max(1, Math.min(1000, Number(limit) || 100))));
    if (cursor) url.searchParams.set("cursor", cleanString(cursor, 500));
    if (settlementStatus) url.searchParams.set("settlement_status", cleanString(settlementStatus, 30));
    const data = await authenticatedGet(`${url.pathname}${url.search}`);
    const marketPositions = data.market_positions || [];
    const metadata = await enrichTickers(marketPositions.map((position) => position.ticker));
    const normalizedMarketPositions = marketPositions.map((position) => normalizePosition(position, metadata.get(position.ticker) || {}));
    return {
      marketPositions,
      positions: normalizedMarketPositions,
      eventPositions: data.event_positions || [],
      cursor: data.cursor || "",
      plainEnglish: normalizedMarketPositions.length
        ? normalizedMarketPositions.slice(0, 8).map((position) => position.plainEnglish).join("\n")
        : "No Kalshi positions were returned.",
    };
  }

  async function fills({ limit = 100, cursor = "", ticker = "", orderId = "" } = {}) {
    const url = new URL("/trade-api/v2/portfolio/fills", "https://kalshi.local");
    url.searchParams.set("limit", String(Math.max(1, Math.min(1000, Number(limit) || 100))));
    if (cursor) url.searchParams.set("cursor", cleanString(cursor, 500));
    if (ticker) url.searchParams.set("ticker", cleanString(ticker, 200));
    if (orderId) url.searchParams.set("order_id", cleanString(orderId, 200));
    const data = await authenticatedGet(`${url.pathname}${url.search}`);
    const sortedFills = (data.fills || []).sort((left, right) => {
        const leftTime = new Date(left.created_time || Number(left.ts || 0)).getTime();
        const rightTime = new Date(right.created_time || Number(right.ts || 0)).getTime();
        return rightTime - leftTime;
      });
    const metadata = await enrichTickers(sortedFills.map((fill) => fill.ticker || fill.market_ticker));
    const normalizedFills = sortedFills.map((fill) => normalizeFill(fill, metadata.get(fill.ticker || fill.market_ticker) || {}));
    return {
      latestFill: normalizedFills[0] || null,
      fillCount: sortedFills.length,
      fills: normalizedFills,
      rawFills: sortedFills,
      cursor: data.cursor || "",
      plainEnglish: normalizedFills.length
        ? normalizedFills.slice(0, 8).map((fill) => fill.plainEnglish).join("\n")
        : "No Kalshi fills were returned.",
    };
  }

  async function portfolioSummary() {
    const [account, positionData, fillData] = await Promise.all([
      balance(),
      positions({ limit: 1000 }),
      fills({ limit: 100 }),
    ]);
    const marketPositions = positionData.marketPositions || [];
    const normalizedPositions = positionData.positions || [];
    const activePositions = normalizedPositions.filter((position) =>
      Math.abs(numberValue(position.contracts)) > 0
      || Math.abs(numberValue(position.exposureDollars)) > 0
      || Number(position.restingOrders || 0) > 0
    );
    const byRealizedPnl = (left, right) =>
      numberValue(right.realizedPnlDollars) - numberValue(left.realizedPnlDollars);
    const latestFill = fillData.latestFill;
    const bestActivePosition = [...activePositions].sort(byRealizedPnl)[0] || null;
    const bestRealizedPosition = [...normalizedPositions].sort(byRealizedPnl)[0] || null;
    const latestBet = latestFill || null;
    const cashBalanceDollars = account.balanceDollars ?? centsToDollars(account.balance);
    const portfolioValueDollars = account.portfolioValueDollars ?? centsToDollars(account.portfolioValue);
    return {
      cashBalanceDollars,
      portfolioValueDollars,
      activePositionCount: activePositions.length,
      restingOrderCount: activePositions.reduce((total, position) => total + Number(position.restingOrders || 0), 0),
      latestBet,
      bestPosition: bestActivePosition
        ? bestActivePosition
        : "No active Kalshi position is currently open.",
      bestRealizedPosition: bestRealizedPosition
        ? {
          ticker: bestRealizedPosition.ticker,
          marketTitle: bestRealizedPosition.marketTitle,
          realizedPnlDollars: numberValue(bestRealizedPosition.realizedPnlDollars),
          plainEnglish: bestRealizedPosition.plainEnglish,
        }
        : null,
      rankingNote: "Best active position is ranked by realized P&L because Kalshi positions do not include unrealized P&L.",
      totalMarketCount: marketPositions.length,
      latestFill,
      bestActivePosition,
      activePositions,
      plainEnglish: [
        `Cash balance is $${cashBalanceDollars.toFixed(2)} and portfolio value is $${portfolioValueDollars.toFixed(2)}.`,
        latestBet ? `Latest matched bet: ${latestBet.plainEnglish}.` : "No recent matched bets were returned.",
        bestActivePosition ? `Best active position by realized P&L: ${bestActivePosition.plainEnglish}.` : "No active positions were returned.",
        activePositions.length ? `Active positions returned: ${activePositions.length}.` : "",
      ].filter(Boolean).join(" "),
      fetchedAt: new Date().toISOString(),
    };
  }

  async function orderbook(ticker) {
    const cleanTicker = cleanString(ticker, 200);
    if (!cleanTicker) return { ticker: "", yesLevels: [], noLevels: [] };
    try {
      const data = await publicGet(`/trade-api/v2/markets/${encodeURIComponent(cleanTicker)}/orderbook?depth=10`);
      return {
        ticker: cleanTicker,
        yesLevels: (data.orderbook?.yes || []).map(([price, qty]) => ({ price: Math.round(Number(price) * 100), qty: Number(qty) })),
        noLevels:  (data.orderbook?.no  || []).map(([price, qty]) => ({ price: Math.round(Number(price) * 100), qty: Number(qty) })),
      };
    } catch {
      return { ticker: cleanTicker, yesLevels: [], noLevels: [] };
    }
  }

  async function placeOrder({ ticker, side, type = "limit", action = "buy", count, yes_price, no_price }) {
    const cleanTicker = cleanString(ticker, 200);
    if (!cleanTicker) throw errorWithStatus("ticker is required", 400);
    const normalizedSide = String(side || "").toLowerCase() === "no" ? "no" : "yes";
    const bodyObj = {
      ticker: cleanTicker,
      side: normalizedSide,
      type: ["limit", "market"].includes(type) ? type : "limit",
      action: ["buy", "sell"].includes(action) ? action : "buy",
      count: Math.max(1, Math.round(Number(count) || 1)),
    };
    if (type === "limit") {
      if (yes_price != null) bodyObj.yes_price = Math.round(Number(yes_price));
      if (no_price != null)  bodyObj.no_price  = Math.round(Number(no_price));
    }
    const base = baseUrl();
    const urlPath = "/trade-api/v2/portfolio/orders";
    const fullUrl = new URL(urlPath, `${base}/`);
    const hdrs = {
      ...signedHeaders("POST", urlPath),
      "Content-Type": "application/json",
    };
    const { data } = await fetchJson(fetchImpl, fullUrl, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(bodyObj),
    });
    return { ok: true, order: data.order || data };
  }

  function wsAuthHeaders() {
    const { keyId, privateKey } = credentials();
    if (!keyId || !privateKey) return null;
    const ts = String(Date.now());
    const wsPath = "/trade-api/ws/v2";
    const message = `${ts}GET${wsPath}`;
    let sig;
    try {
      sig = crypto.sign("sha256", Buffer.from(message), {
        key: privateKey.replace(/\\n/g, "\n"),
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
      }).toString("base64");
    } catch {
      return null;
    }
    return {
      "KALSHI-ACCESS-KEY": keyId,
      "KALSHI-ACCESS-TIMESTAMP": ts,
      "KALSHI-ACCESS-SIGNATURE": sig,
    };
  }

  async function test() {
    const result = await balance();
    return { connected: true, ...result, environment: status().environment };
  }

  return { balance, fills, marketByTicker, marketDiscovery, markets, orderbook, placeOrder, portfolioSummary, positions, signedHeaders, status, test, wsAuthHeaders };
}

module.exports = {
  ALLOWED_BASES,
  KALSHI_DEMO_API,
  KALSHI_LEGACY_API,
  KALSHI_PRODUCTION_API,
  createKalshiProvider,
};
