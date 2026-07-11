const crypto = require("crypto");

function cleanString(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function errorWithStatus(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function uniq(values) {
  return [...new Set(values.map((value) => cleanString(value, 240)).filter(Boolean))];
}

function trustedTime(timezone = "America/New_York", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    timezone,
    iso: now.toISOString(),
    localDate,
    tomorrowDate: `${tomorrowParts.year}-${tomorrowParts.month}-${tomorrowParts.day}`,
  };
}

function classifyResearchIntent(query) {
  const lower = String(query || "").toLowerCase();
  if (/https?:\/\/[^\s)]+/i.test(query)) return "url_or_page";
  if (/\b(weather|forecast|rain|snow|temperature|humid|wind|air quality)\b/.test(lower)) return "weather";
  if (/\b(nba|nfl|nhl|mlb|fifa|world cup|soccer|football|game|games|match|matches|score|scores|schedule|fixture|fixtures|standings|playoff|finals)\b/.test(lower)) return "sports";
  if (/\b(stock|stocks|market|price|earnings|company|crypto|bitcoin|finance|economy|fed|inflation)\b/.test(lower)) return "finance";
  if (/\b(news|latest|today|current|right now|breaking|recent|update)\b/.test(lower)) return "news";
  if (/\b(events?|concert|things to do|restaurants?|places?|near me|city|boston|new york|nyc|cambridge|local)\b/.test(lower)) return "local_briefing";
  if (/\b(compare|best|review|buy|product|which should|recommend)\b/.test(lower)) return "comparison";
  if (/\b(research|investigate|citations?|sources?|evidence|deep dive|explain deeply)\b/.test(lower)) return "deep_research";
  if (/\b(how to|tutorial|guide|steps|fix|debug|install|setup)\b/.test(lower)) return "how_to";
  return "general";
}

function researchModeFor(query, explicitMode = "") {
  const lower = String(query || "").toLowerCase();
  if (/^(deep|balanced|fast)$/i.test(explicitMode)) return explicitMode.toLowerCase();
  if (/\b(deep|properly|full research|research report|citations?|compare sources?|read sources?|investigate)\b/.test(lower)) return "deep";
  if (/\b(quick|fast|briefly|short)\b/.test(lower)) return "fast";
  return "balanced";
}

function maybeLocation(query) {
  const text = String(query || "");
  const explicit = text.match(/\b(?:in|at|for|around)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/);
  if (explicit) return explicit[1];
  const known = text.match(/\b(Boston|Cambridge|New York|NYC|San Francisco|Los Angeles|Miami|Chicago|Seattle|Washington DC)\b/i);
  return known ? known[1] : "";
}

function expandResearchQueries(query, options = {}) {
  const base = cleanString(query, 500);
  const time = options.time || trustedTime(options.timezone);
  const intent = options.intent || classifyResearchIntent(base);
  const lower = base.toLowerCase();
  const hasTomorrow = /\btomorrow\b/.test(lower);
  const hasToday = /\btoday|right now|current|live\b/.test(lower);
  const datePhrase = hasTomorrow
    ? time.tomorrowDate
    : hasToday
      ? time.localDate
      : "";
  const location = maybeLocation(base);
  const withDate = datePhrase ? `${base} ${datePhrase}` : base;
  const officialPrefix = location ? `${location} ` : "";
  const queries = [base, withDate];

  if (intent === "weather") {
    queries.push(`${officialPrefix}weather forecast ${datePhrase || "today tomorrow"}`);
    queries.push(`${officialPrefix}National Weather Service forecast ${datePhrase || ""}`);
    queries.push(`${officialPrefix}hourly forecast ${datePhrase || ""}`);
  } else if (intent === "sports") {
    queries.push(`${base} official schedule ${datePhrase}`);
    queries.push(`${base} scores results ${datePhrase}`);
    queries.push(`${base} ESPN schedule ${datePhrase}`);
    queries.push(`${base} official league site ${datePhrase}`);
  } else if (intent === "local_briefing") {
    queries.push(`${officialPrefix}events ${datePhrase || "tomorrow"}`);
    queries.push(`${officialPrefix}things to do ${datePhrase || "tomorrow"}`);
    queries.push(`${officialPrefix}weather ${datePhrase || "tomorrow"}`);
    queries.push(`${officialPrefix}news ${datePhrase || "today"}`);
    queries.push(`${officialPrefix}traffic transit alerts ${datePhrase || "tomorrow"}`);
    queries.push(`${officialPrefix}sports schedule ${datePhrase || "tomorrow"}`);
  } else if (intent === "news") {
    queries.push(`${base} latest`);
    queries.push(`${base} official announcement`);
    queries.push(`${base} Reuters AP BBC`);
  } else if (intent === "finance") {
    queries.push(`${base} latest price market news`);
    queries.push(`${base} official investor relations latest`);
    queries.push(`${base} Reuters CNBC MarketWatch`);
  } else if (intent === "comparison") {
    queries.push(`${base} reviews comparison`);
    queries.push(`${base} official specs pricing`);
    queries.push(`${base} reddit reviews`);
  } else if (intent === "how_to") {
    queries.push(`${base} official docs`);
    queries.push(`${base} troubleshooting`);
    queries.push(`${base} github issue`);
  } else {
    queries.push(`${base} latest`);
    queries.push(`${base} official source`);
    queries.push(`${base} explained`);
  }

  return uniq(queries).slice(0, options.limit || 10);
}

function sourceHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sourceQuality(source, intent = "general") {
  const host = sourceHost(source.url);
  let score = 0.45;
  if (!host) return 0.1;
  if (/\.(gov|edu)$/i.test(host)) score += 0.25;
  if (/\b(reuters|apnews|bbc|espn|weather\.gov|nba|nfl|nhl|mlb|fifa|uefa|sec\.gov|investor|official)\b/i.test(host)) score += 0.22;
  if (intent === "weather" && /weather\.gov|weather|accuweather|weather\.com/i.test(host)) score += 0.18;
  if (intent === "sports" && /espn|nba|nfl|mlb|nhl|fifa|uefa|foxsports|cbssports/i.test(host)) score += 0.18;
  if (/reddit|medium|quora|pinterest|tiktok/i.test(host)) score -= 0.12;
  return Math.max(0.05, Math.min(0.98, score));
}

function dedupeSources(sources = []) {
  const seen = new Set();
  const output = [];
  for (const source of sources) {
    const url = cleanString(source.url || source.uri, 2000);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({
      title: cleanString(source.title || url, 220),
      url,
      provider: cleanString(source.provider || source.source || "search", 80),
      query: cleanString(source.query, 240),
    });
  }
  return output;
}

function rankSources(sources, intent) {
  return dedupeSources(sources)
    .map((source) => ({ ...source, quality: sourceQuality(source, intent), host: sourceHost(source.url) }))
    .sort((a, b) => b.quality - a.quality)
    .slice(0, 12);
}

function compactEvidenceText({ query, intent, searchRuns, readSources }) {
  return [
    `Question: ${query}`,
    `Intent: ${intent}`,
    "Search answers:",
    ...searchRuns.slice(0, 8).map((run, index) => [
      `${index + 1}. Query: ${run.query}`,
      `Provider: ${run.provider}`,
      run.answer ? `Answer/excerpt: ${cleanString(run.answer, 1200)}` : "",
      run.error ? `Error: ${run.error}` : "",
      run.sources?.length ? `Sources: ${run.sources.slice(0, 5).map((source) => `${source.title} (${source.url})`).join("; ")}` : "",
    ].filter(Boolean).join("\n")),
    "Read source excerpts:",
    ...readSources.slice(0, 6).map((source, index) => [
      `${index + 1}. ${source.title || source.url}`,
      `URL: ${source.url}`,
      source.error ? `Read error: ${source.error}` : `Excerpt: ${cleanString(source.excerpt || source.text, 1800)}`,
    ].join("\n")),
  ].join("\n\n").slice(0, 22000);
}

async function synthesizeWithGemini({ getSettings, query, intent, time, searchRuns, readSources, mode, fetchImpl }) {
  const settings = getSettings();
  const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) return "";
  const model = settings.geminiFastModel || settings.geminiModel || "gemini-2.5-flash";
  const apiBase = String(settings.geminiApiBaseUrl || process.env.JARVIS_GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const evidenceText = compactEvidenceText({ query, intent, searchRuns, readSources });
  const { signal, clear } = timeoutSignal(mode === "deep" ? 12000 : 8000);
  try {
    const response = await fetchImpl(`${apiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "You are JARVIS Research Engine v2. Write a precise, source-grounded answer for Devansh.",
              "Use only the evidence below. Do not invent facts, dates, names, URLs, or certainty.",
              "If evidence is thin or conflicting, state that plainly. Include source names inline where useful.",
              "Use concise polished Jarvis tone. Call him sir once if natural.",
              `Trusted time: ${time.iso}. Local date: ${time.localDate}. Tomorrow: ${time.tomorrowDate}. Timezone: ${time.timezone}.`,
              `Research mode: ${mode}.`,
              evidenceText,
            ].join("\n\n"),
          }],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: mode === "deep" ? 1200 : 800 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return "";
    return (data.candidates?.[0]?.content?.parts || []).map((part) => part.text).filter(Boolean).join("\n").trim();
  } catch {
    return "";
  } finally {
    clear();
  }
}

async function tavilySearch({ apiKey, query, fetchImpl }) {
  const { signal, clear } = timeoutSignal(7000);
  try {
    const response = await fetchImpl("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "basic", max_results: 5, include_answer: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Tavily failed (${response.status})`);
    return {
      provider: "tavily",
      query,
      answer: cleanString(data.answer, 1800),
      sources: (data.results || []).map((item) => ({
        title: item.title,
        url: item.url,
        provider: "tavily",
        query,
      })),
    };
  } finally {
    clear();
  }
}

async function braveSearch({ apiKey, query, fetchImpl }) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  const { signal, clear } = timeoutSignal(6000);
  try {
    const response = await fetchImpl(url, {
      headers: { "X-Subscription-Token": apiKey, accept: "application/json" },
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Brave Search failed (${response.status})`);
    const results = data.web?.results || [];
    return {
      provider: "brave",
      query,
      answer: results.slice(0, 3).map((item) => `${item.title}: ${item.description || ""}`).join("\n"),
      sources: results.map((item) => ({ title: item.title, url: item.url, provider: "brave", query })),
    };
  } finally {
    clear();
  }
}

async function exaSearch({ apiKey, query, fetchImpl }) {
  const { signal, clear } = timeoutSignal(7000);
  try {
    const response = await fetchImpl("https://api.exa.ai/search", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal,
      body: JSON.stringify({ query, numResults: 5, useAutoprompt: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `Exa failed (${response.status})`);
    return {
      provider: "exa",
      query,
      answer: (data.results || []).slice(0, 3).map((item) => `${item.title}: ${item.text || item.summary || ""}`).join("\n"),
      sources: (data.results || []).map((item) => ({ title: item.title, url: item.url, provider: "exa", query })),
    };
  } finally {
    clear();
  }
}

function createResearchV2({ getSettings, webResearch, urlRead, fetchImpl = fetch, now = () => new Date() }) {
  async function run(args = {}) {
    const query = cleanString(args.query, 1200);
    if (!query) throw errorWithStatus("Research v2 query is required", 400);
    const time = trustedTime("America/New_York", now());
    const intent = cleanString(args.intent, 80) || classifyResearchIntent(query);
    const mode = researchModeFor(query, cleanString(args.mode, 20));
    const maxSearches = Math.max(1, Math.min(10, Number(args.maxSearches || (mode === "fast" ? 3 : mode === "deep" ? 7 : 5))));
    const readTopSources = Math.max(0, Math.min(6, Number(args.readTopSources ?? (mode === "fast" ? 1 : mode === "deep" ? 4 : 2))));
    const progress = [];
    const tick = (phase, message, detail = {}) => {
      progress.push({ at: new Date().toISOString(), phase, message, ...detail });
    };

    tick("plan", "Classifying request and building search angles.", { intent, mode });
    const expandedQueries = expandResearchQueries(query, { intent, time, limit: Math.max(maxSearches, 6) });
    tick("plan", `Expanded into ${expandedQueries.length} search angles.`, { expandedQueries });

    const settings = getSettings();
    const providerKeys = {
      tavily: settings.tavilyApiKey || process.env.TAVILY_API_KEY,
      brave: settings.braveSearchApiKey || process.env.BRAVE_SEARCH_API_KEY,
      exa: settings.exaApiKey || process.env.EXA_API_KEY,
    };
    const searchQueries = expandedQueries.slice(0, maxSearches);
    tick("search", `Searching ${searchQueries.length} angles. Gemini uses one grouped grounded-search call unless deep mode needs extra probes.`, { providers: ["gemini", ...Object.entries(providerKeys).filter(([, value]) => value).map(([key]) => key)] });

    const tasks = [];
    const groupedContext = [
      `Research Engine v2 intent: ${intent}.`,
      `Original user request: ${query}`,
      `Trusted local date: ${time.localDate}. Tomorrow: ${time.tomorrowDate}. Timezone: ${time.timezone}.`,
      "Search these angles and synthesize only from grounded Google Search evidence:",
      ...searchQueries.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n");
    const geminiQueries = mode === "deep"
      ? uniq([query, ...searchQueries.slice(1, 3)])
      : [query];
    for (const searchQuery of geminiQueries) {
      tasks.push(
        Promise.resolve()
          .then(() => webResearch({ query: searchQuery, context: groupedContext }))
          .then((result) => ({
            provider: "gemini_grounded",
            query: searchQuery,
            answer: result.answer || result.plainEnglish || "",
            sources: (result.sources || []).map((source) => ({ ...source, provider: "gemini_grounded", query: searchQuery })),
          })),
      );
    }
    if (providerKeys.tavily) tasks.push(tavilySearch({ apiKey: providerKeys.tavily, query, fetchImpl }));
    if (providerKeys.brave) tasks.push(braveSearch({ apiKey: providerKeys.brave, query, fetchImpl }));
    if (providerKeys.exa) tasks.push(exaSearch({ apiKey: providerKeys.exa, query, fetchImpl }));

    const settled = await Promise.allSettled(tasks);
    const searchRuns = settled.map((item) => item.status === "fulfilled"
      ? item.value
      : { provider: "search", query, answer: "", sources: [], error: item.reason?.message || String(item.reason) });
    tick("search", `Search complete: ${searchRuns.filter((run) => !run.error).length}/${searchRuns.length} providers returned evidence.`);

    const rankedSources = rankSources(searchRuns.flatMap((run) => run.sources || []), intent);
    tick("rank", `Ranked ${rankedSources.length} candidate sources.`, { topHosts: rankedSources.slice(0, 5).map((source) => source.host) });

    const readSources = [];
    if (readTopSources > 0) {
      tick("read", `Reading top ${Math.min(readTopSources, rankedSources.length)} pages for direct evidence.`);
      const readSettled = await Promise.allSettled(rankedSources.slice(0, readTopSources).map((source) =>
        urlRead({ url: source.url, maxChars: mode === "deep" ? 10000 : 6000 })
          .then((read) => ({
            title: read.title || source.title,
            url: read.finalUrl || source.url,
            host: source.host,
            excerpt: cleanString(read.text, 1800),
            textLength: read.textLength,
            quality: source.quality,
          })),
      ));
      for (let i = 0; i < readSettled.length; i += 1) {
        const item = readSettled[i];
        if (item.status === "fulfilled") readSources.push(item.value);
        else readSources.push({
          title: rankedSources[i]?.title,
          url: rankedSources[i]?.url,
          host: rankedSources[i]?.host,
          error: item.reason?.message || String(item.reason),
        });
      }
    }

    const successfulSearches = searchRuns.filter((run) => !run.error && (run.answer || run.sources?.length));
    const successfulReads = readSources.filter((source) => !source.error);
    const confidence = Math.max(0.18, Math.min(0.96,
      (successfulSearches.length ? 0.32 : 0)
      + Math.min(0.28, rankedSources.length * 0.035)
      + Math.min(0.24, successfulReads.length * 0.08)
      + (rankedSources.some((source) => source.quality >= 0.75) ? 0.12 : 0)
    ));
    const verification = [
      `${expandedQueries.length} search angles planned`,
      `${successfulSearches.length}/${searchRuns.length} search runs returned evidence`,
      `${successfulReads.length}/${readSources.length} source pages were readable`,
      rankedSources.some((source) => source.quality >= 0.75) ? "At least one high-authority source was found" : "No high-authority source was clearly identified",
    ];
    const limits = [];
    if (!successfulSearches.length) limits.push("No search provider returned usable evidence.");
    if (readTopSources > 0 && !successfulReads.length) limits.push("Top pages could not be read directly; answer must rely on search-grounded snippets only.");
    if (confidence < 0.55) limits.push("Evidence confidence is low; do not present uncertain claims as fact.");

    tick("verify", "Checking evidence quality and uncertainty.", { confidence });
    const synthesized = await synthesizeWithGemini({
      getSettings,
      query,
      intent,
      time,
      searchRuns,
      readSources,
      mode,
      fetchImpl,
    });
    const fallbackAnswer = successfulSearches.length
      ? successfulSearches.slice(0, 3).map((run) => run.answer).filter(Boolean).join("\n\n").slice(0, 1800)
      : "I could not verify this from connected research providers.";
    const answer = synthesized || fallbackAnswer;
    tick("compose", "Answer composed from verified evidence.");

    const id = crypto.randomUUID();
    return {
      id,
      query,
      intent,
      mode,
      time,
      expandedQueries,
      searchRuns: searchRuns.map((run) => ({
        provider: run.provider,
        query: run.query,
        answer: cleanString(run.answer, 1400),
        error: run.error,
        sourceCount: run.sources?.length || 0,
      })),
      sources: rankedSources.map(({ title, url, provider, host, quality }) => ({ title, url, provider, host, quality })),
      readSources,
      evidence: {
        id,
        confidence: Number(confidence.toFixed(2)),
        verification,
        limits,
      },
      progress,
      answer,
      plainEnglish: answer,
      fetchedAt: new Date().toISOString(),
    };
  }

  return { run };
}

module.exports = {
  createResearchV2,
  classifyResearchIntent,
  expandResearchQueries,
  trustedTime,
  rankSources,
};
