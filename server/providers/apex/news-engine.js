"use strict";
/* APEX news intelligence engine (Wave 4, keyless).
   Pipeline: ingest per-lane (GDELT + NWS weather) → cluster/dedupe →
   verify (corroboration + source credibility) → impact-map (entity→ticker/
   sector via alias map + rule triggers) → rank (recency decay × verify ×
   impact × watchlist boost) → persist + roll/decay. CommonJS, no npm deps.

   Keyed enrichers (Finnhub per-company, Marketaux/AlphaVantage sentiment)
   plug in at Wave 3 — this stage is fully keyless. */

// ── Lanes: each is one GDELT query. Broad macro + narrower high-impact micro.
const LANES = [
  { lane: "macro", query: "(federal reserve OR interest rates OR inflation OR CPI OR jobs report OR GDP OR recession)" },
  { lane: "finance", query: "(stock market OR earnings OR wall street OR treasury yields OR bond market)" },
  { lane: "commodities", query: "(crude oil OR OPEC OR natural gas OR gold price OR wheat OR copper)" },
  { lane: "crypto", query: "(bitcoin OR ethereum OR crypto regulation OR SEC crypto OR stablecoin)" },
  { lane: "geopolitics", query: "(sanctions OR war OR trade war OR tariffs OR election OR central bank)" },
  { lane: "commercial", query: "(merger OR acquisition OR bankruptcy OR layoffs OR IPO OR antitrust)" },
];

// ── Source credibility (domain → 0..1). Unknown domains default to 0.45.
const CREDIBILITY = {
  "reuters.com": 0.95, "apnews.com": 0.95, "bloomberg.com": 0.92, "wsj.com": 0.92,
  "ft.com": 0.9, "cnbc.com": 0.82, "nytimes.com": 0.85, "washingtonpost.com": 0.83,
  "theguardian.com": 0.8, "bbc.com": 0.85, "bbc.co.uk": 0.85, "marketwatch.com": 0.75,
  "barrons.com": 0.82, "forbes.com": 0.6, "businessinsider.com": 0.6, "yahoo.com": 0.6,
  "seekingalpha.com": 0.55, "benzinga.com": 0.5, "coindesk.com": 0.72, "cointelegraph.com": 0.6,
};
const credOf = (domain) => CREDIBILITY[String(domain || "").toLowerCase().replace(/^www\./, "")] ?? 0.45;

const STOPWORDS = new Set("the a an and or but of to in on for with as at by from is are was were be been has have will its it this that these those new say says said after over amid into out up down more most than then now stock stocks market markets us u.s".split(" "));

// Cheap headline-direction heuristic for sources without a sentiment score (Finnhub).
const NEG_WORDS = /\b(sank|sink|sinks|fall|falls|fell|drop|drops|plunge|plunges|tumble|tumbles|slump|slumps|slide|slides|crash|crashes|cut|cuts|miss|misses|missed|warn|warning|warns|risk|risks|lawsuit|probe|recall|downgrade|downgrades|loss|losses|weak|weaker|bearish|selloff|sell-off|layoff|layoffs|slowdown|halt|halts|decline|declines|sued)\b/i;
const POS_WORDS = /\b(rise|rises|rose|surge|surges|surged|rally|rallies|jump|jumps|jumped|soar|soars|gain|gains|beat|beats|record|upgrade|upgrades|bullish|breakout|high|higher|profit|profits|strong|stronger|outperform|soars|climbs|climb|boost|boosts|wins|win|approval|approved)\b/i;
function titleDir(title) {
  const t = String(title || "");
  const neg = NEG_WORDS.test(t), pos = POS_WORDS.test(t);
  if (neg && !pos) return -1;
  if (pos && !neg) return 1;
  return 1; // ambiguous/none → mild positive default
}
function tokenize(title) {
  return String(title || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Deterministic id from a string (so re-clustering upserts the same story).
function hashId(prefix, s) {
  let h = 0; const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return prefix + (h >>> 0).toString(16);
}

// ── Starter alias map + impact rules (seeded once if the tables are empty). ──
const SEED_ALIASES = [
  ["apple", "AAPL", "technology"], ["nvidia", "NVDA", "technology"], ["microsoft", "MSFT", "technology"],
  ["amazon", "AMZN", "consumer"], ["tesla", "TSLA", "auto"], ["meta", "META", "technology"],
  ["alphabet", "GOOGL", "technology"], ["google", "GOOGL", "technology"], ["jpmorgan", "JPM", "financials"],
  ["exxon", "XOM", "energy"], ["chevron", "CVX", "energy"], ["coinbase", "COIN", "crypto"],
  ["microstrategy", "MSTR", "crypto"], ["boeing", "BA", "industrials"], ["pfizer", "PFE", "healthcare"],
  ["walmart", "WMT", "consumer"], ["netflix", "NFLX", "technology"], ["amd", "AMD", "technology"],
].map(([name, ticker, sector]) => ({ name, ticker, sector }));

// affected: [{scope:'ticker'|'sector'|'broad', value, dir:+1/-1, weight}]
const SEED_RULES = [
  { trigger: "rate cut|dovish|stimulus", affected: [{ scope: "broad", value: "SPY", dir: 1, weight: 0.7 }], note: "Easing → risk-on" },
  { trigger: "rate hike|hawkish|tightening", affected: [{ scope: "broad", value: "SPY", dir: -1, weight: 0.7 }], note: "Tightening → risk-off" },
  { trigger: "inflation|cpi|hot prices", affected: [{ scope: "broad", value: "SPY", dir: -1, weight: 0.5 }, { scope: "ticker", value: "GLD", dir: 1, weight: 0.4 }], note: "Inflation" },
  { trigger: "recession|slowdown|contraction", affected: [{ scope: "broad", value: "SPY", dir: -1, weight: 0.8 }], note: "Growth scare" },
  { trigger: "crude oil|opec|oil price|barrel", affected: [{ scope: "sector", value: "energy", dir: 1, weight: 0.6 }, { scope: "ticker", value: "USO", dir: 1, weight: 0.5 }], note: "Oil" },
  { trigger: "natural gas", affected: [{ scope: "ticker", value: "UNG", dir: 1, weight: 0.5 }], note: "NatGas" },
  { trigger: "gold price|bullion", affected: [{ scope: "ticker", value: "GLD", dir: 1, weight: 0.5 }], note: "Gold" },
  { trigger: "bitcoin|ethereum|crypto rally", affected: [{ scope: "sector", value: "crypto", dir: 1, weight: 0.6 }, { scope: "ticker", value: "COIN", dir: 1, weight: 0.5 }], note: "Crypto up" },
  { trigger: "sec crypto|crypto crackdown|crypto ban", affected: [{ scope: "sector", value: "crypto", dir: -1, weight: 0.7 }], note: "Crypto regulatory" },
  { trigger: "tariff|trade war|sanction", affected: [{ scope: "broad", value: "SPY", dir: -1, weight: 0.5 }, { scope: "sector", value: "industrials", dir: -1, weight: 0.4 }], note: "Trade friction" },
  { trigger: "war|invasion|military strike|conflict", affected: [{ scope: "sector", value: "defense", dir: 1, weight: 0.6 }, { scope: "sector", value: "energy", dir: 1, weight: 0.4 }], note: "Conflict" },
  { trigger: "hurricane|storm|flood|wildfire", affected: [{ scope: "sector", value: "insurance", dir: -1, weight: 0.5 }], note: "Weather disaster" },
  { trigger: "layoffs|job cuts|bankruptcy", affected: [{ scope: "broad", value: "SPY", dir: -1, weight: 0.4 }], note: "Corporate stress" },
  { trigger: "chip|semiconductor|export controls", affected: [{ scope: "sector", value: "technology", dir: -1, weight: 0.5 }, { scope: "ticker", value: "SMH", dir: -1, weight: 0.5 }], note: "Semis" },
];

function createNewsEngine({ apexDb, adapters, getWatchlist, keyed }) {
  const A = adapters;
  const kp = () => (keyed ? keyed.keysPresent() : {});

  function ensureSeeds() {
    try { if (apexDb.countAliases() === 0) apexDb.seedAlias(SEED_ALIASES); } catch { /* noop */ }
    try { if (apexDb.countRules() === 0) apexDb.seedRules(SEED_RULES); } catch { /* noop */ }
  }

  // ── cluster raw articles by title-token similarity ──
  function cluster(articles) {
    const clusters = [];
    for (const a of articles) {
      const toks = new Set(tokenize(a.title));
      if (toks.size < 2) continue;
      let best = null, bestSim = 0;
      for (const c of clusters) { const sim = jaccard(toks, c.toks); if (sim > bestSim) { bestSim = sim; best = c; } }
      if (best && bestSim >= 0.4) {
        best.articles.push(a);
        for (const t of toks) best.toks.add(t);
      } else {
        clusters.push({ toks, articles: [a], repTitle: a.title, key: hashId("st", [...toks].sort().slice(0, 6).join("-")) });
      }
    }
    return clusters;
  }

  // ── verify: corroboration (distinct domains) + avg credibility ──
  function verify(c) {
    const domains = new Set(c.articles.map((a) => a.source).filter(Boolean));
    const cred = c.articles.reduce((s, a) => s + credOf(a.source), 0) / c.articles.length;
    const corroboration = Math.min(1, domains.size / 3); // 3+ distinct outlets = fully corroborated
    return { verifyScore: +(0.35 * corroboration + 0.65 * cred).toFixed(3), domains: [...domains] };
  }

  // ── impact-map: scan text against alias map + rule triggers ──
  // Word-boundary match so "war" doesn't fire on "warning", "oil" not on "boiling", etc.
  function hasTerm(text, term) {
    const t = String(term).trim();
    if (!t) return false;
    const re = new RegExp("(^|[^a-z0-9])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^a-z0-9]|$)", "i");
    return re.test(text);
  }
  function impactMap(c, aliases, rules) {
    const text = c.articles.map((a) => a.title).join(" • ").toLowerCase();
    const hits = new Map(); // key = ticker|sector → {ticker,sector,dir,weight}
    const add = (ticker, sector, dir, weight) => {
      const key = ticker || ("sec:" + sector);
      const cur = hits.get(key) || { ticker: ticker || null, sector: sector || null, score: 0 };
      cur.score += dir * weight;
      hits.set(key, cur);
    };
    // Explicit tickers from keyed sources (Finnhub company news, Marketaux) — highest confidence.
    for (const a of c.articles) {
      if (!a.ticker) continue;
      const dir = a.sentiment == null ? titleDir(a.title) : (a.sentiment > 0.05 ? 1 : a.sentiment < -0.05 ? -1 : 1);
      add(String(a.ticker).toUpperCase(), null, dir, a.sentiment != null ? 0.7 : 0.55);
    }
    for (const al of aliases) { if (hasTerm(text, al.name)) add(al.ticker, al.sector, 1, 0.5); }
    for (const rule of rules) {
      const triggers = String(rule.trigger).split("|");
      if (triggers.some((t) => hasTerm(text, t))) {
        for (const eff of (rule.affected || [])) {
          if (eff.scope === "ticker" || eff.scope === "broad") add(eff.value, null, eff.dir, eff.weight);
          else if (eff.scope === "sector") add(null, eff.value, eff.dir, eff.weight);
        }
      }
    }
    return [...hits.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 8);
  }

  // Weather is a real but minor market lane — don't let local storm-alert
  // corroboration outrank actual market/macro news.
  const LANE_WEIGHT = { weather: 0.4, commercial: 0.9 };
  // ── rank: recency decay × verify × (1+impact magnitude) × watchlist boost ──
  function rankOf(c, verifyScore, impacts, watch) {
    const latest = c.articles.reduce((m, a) => Math.max(m, parseGdeltDate(a.published_at) || 0), 0);
    const ageHrs = latest ? Math.max(0, (Date.now() - latest) / 3.6e6) : 24;
    const recency = Math.exp(-ageHrs / 18); // ~half-life 12.5h
    const impactMag = impacts.reduce((s, i) => s + Math.abs(i.score), 0);
    const corroboration = Math.min(1, c.articles.length / 4);
    const onWatch = impacts.some((i) => i.ticker && watch.has(i.ticker));
    const laneW = LANE_WEIGHT[c.articles[0] && c.articles[0].lane] ?? 1;
    const base = recency * (0.3 + 0.7 * verifyScore) * (1 + impactMag) * (0.6 + 0.4 * corroboration);
    return +(base * laneW * (onWatch ? 1.6 : 1)).toFixed(4);
  }

  function parseGdeltDate(s) {
    if (!s) return null;
    // GDELT: "20260708T143000Z"; also tolerate ISO.
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s));
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const t = Date.parse(s); return Number.isNaN(t) ? null : t;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function fetchLanes() {
    // GDELT rate-limits ~1 req/sec — fetch lanes sequentially with a gap to avoid 429s.
    const results = [];
    for (const l of LANES) {
      // sourcelang:english keeps the feed market-relevant (GDELT is global/multilingual by default).
      try { const arts = await A.gdeltNews(l.query + " sourcelang:english", 20); results.push(arts.map((a) => ({ ...a, lane: l.lane }))); }
      catch { results.push([]); }
      await sleep(6000); // GDELT hard-limits to 1 request / 5 seconds — respect it or every lane 429s.
    }
    // Keyed news sources (Wave 3) — clean + ticker-tagged, generous rate limits,
    // so fetch them in parallel (no GDELT-style throttling needed).
    const present = kp();
    if (keyed) {
      const watch = (getWatchlist ? getWatchlist() : []).slice(0, 8);
      const keyedJobs = [];
      if (present.finnhub) {
        keyedJobs.push(keyed.finnhubGeneralNews().catch(() => []));
        for (const t of watch) keyedJobs.push(keyed.finnhubCompanyNews(t).catch(() => []));
      }
      if (present.marketaux) keyedJobs.push(keyed.marketauxNews(watch.join(",")).catch(() => []));
      try { const keyedRes = await Promise.all(keyedJobs); results.push(...keyedRes); } catch { /* noop */ }
    }
    // Weather → market lane (keyless, US): active severe alerts as pseudo-articles.
    let weather = [];
    try {
      const al = await A.nwsAlerts();
      weather = (al || []).slice(0, 8).map((x) => ({ title: `${x.event}: ${x.headline || x.area || ""}`.slice(0, 200), url: x.id, source: "weather.gov", published_at: x.sent, lane: "weather", sentiment: -0.3 }));
    } catch { /* noop */ }
    return results.flat().concat(weather);
  }

  // ── full run: fetch → pipeline → persist → decay/roll ──
  async function run() {
    ensureSeeds();
    const articles = await fetchLanes();
    if (!articles.length) return { ok: false, reason: "no articles" };
    const aliases = apexDb.listAliases();
    const rules = apexDb.listRules();
    const watch = new Set((getWatchlist ? getWatchlist() : []).map((s) => String(s).toUpperCase()));

    const clusters = cluster(articles);
    let stored = 0;
    for (const c of clusters) {
      const { verifyScore, domains } = verify(c);
      const impacts = impactMap(c, aliases, rules);
      const rank = rankOf(c, verifyScore, impacts, watch);
      // Drop pure noise: single-source clusters with no market impact and negligible rank.
      if (!impacts.length && c.articles.length < 2 && rank < 0.15) continue;
      const storyId = c.key;
      const impactSummary = impacts.map((i) => ({ t: i.ticker, s: i.sector, dir: i.score >= 0 ? 1 : -1, mag: +Math.abs(i.score).toFixed(2) }));
      try {
        apexDb.upsertStory({
          id: storyId, cluster_key: c.key, title: c.repTitle,
          sources: domains, article_count: c.articles.length,
          verify_score: verifyScore, impact: { lane: c.articles[0].lane, tickers: impactSummary },
          rank, pinned: rank > 2.5 ? 1 : 0,
        });
        // per-article events + per-ticker impact rows
        for (const a of c.articles) apexDb.insertEvent({ id: hashId("ev", a.url || a.title), lane: a.lane, source: a.source, url: a.url, title: a.title, published_at: a.published_at, sentiment: a.sentiment, story_id: storyId });
        for (const i of impacts) if (i.ticker) apexDb.insertImpact({ id: hashId("im", storyId + i.ticker), story_id: storyId, ticker: i.ticker, sector: i.sector, impact: Math.abs(i.score), sentiment_dir: i.score >= 0 ? 1 : -1 });
        stored++;
      } catch { /* dup / db optional */ }
    }
    let decayed = 0, pruned = 0;
    try { decayed = apexDb.decayOldStories(1440); } catch { /* noop */ }
    try { pruned = apexDb.pruneNoiseStories(); } catch { /* noop */ }
    return { ok: true, ingested: articles.length, clusters: clusters.length, stored, decayed, pruned, active: apexDb.countActiveStories() };
  }

  return { run, ensureSeeds, LANES, _internals: { cluster, verify, impactMap, rankOf } };
}

module.exports = { createNewsEngine, SEED_ALIASES, SEED_RULES, LANES };
