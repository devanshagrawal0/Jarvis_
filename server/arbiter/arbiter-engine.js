// Arbiter engine — cross-platform divergence detection.
//
// scan() fetches Kalshi + Polymarket markets per category, matches the same
// event across platforms by title similarity, and scores the price divergence
// as an "edge". This is the v1 edge engine; JARVIS-probability and historical
// base-rate scoring layers come next.

const STOPWORDS = new Set([
  "will", "the", "be", "a", "an", "to", "of", "on", "at", "in", "by", "is", "are",
  "for", "and", "or", "win", "wins", "won", "get", "have", "before", "after",
  "this", "that", "which", "who", "whom", "his", "her", "their", "any", "up",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function similarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter); // plain Jaccard (kept for callers/tests)
}

// Question archetype — the predicate being asked. Two markets can share the
// entity ("LeBron James") but ask different questions ("win the election" vs
// "be the nominee"); those must NOT match. Returns a coarse type.
function archetype(q) {
  const s = String(q || "").toLowerCase();
  // Sports/novelty meta predicates first — these must be distinct archetypes so
  // Kalshi's host/retirement/debut/count markets can never match a Polymarket
  // outright winner that shares an entity token.
  if (/\bhost\b|be announced as (a |the )?host/.test(s)) return "host";
  if (/\bretire\b|\bretirement\b/.test(s)) return "retire";
  if (/\bdebut\b|play in a game/.test(s)) return "debut";
  if (/\bhow many\b|at least \d+\b/.test(s)) return "count";
  if (/\bnominee\b|\bnomination\b|\bprimary\b/.test(s)) return "nomination";
  if (/\b(win|winner)\b.*\b(presiden|election|white house)\b|\belected\b|\bbe president\b/.test(s)) return "win_office";
  if (/\badvance|make the|reach the|round of|qualify|group stage\b/.test(s)) return "advance";
  if (/\b(win|winner|champion)\b.*\b(world cup|super bowl|championship|finals?|title|cup|league|series|open|masters|bowl)\b/.test(s)) return "win_title";
  if (/\bconfirm|approved|pass(es|ed)?|shutdown|ceasefire|announce/.test(s)) return "event";
  return "generic";
}

// Structurally non-comparable Kalshi sports markets — grouped multi-team bundles,
// multi-year count markets, and novelty markets that have no single-entity
// Polymarket counterpart. Filtered from the sports pool so they neither produce
// false matches nor consume LLM enrichment budget.
function nonComparableSports(text) {
  const s = String(text || "").toLowerCase();
  return (
    /\bhow many\b/.test(s) ||                       // count markets ("how many majors")
    /at least \d+ championship/.test(s) ||          // grouped count bundles
    /\bteam,.*\bteam\b/.test(s) ||                  // multi-team grouped lists
    /be announced as (a |the )?host/.test(s) ||     // host announcements
    /\bretire\b|\bretirement\b/.test(s) ||          // retirement novelty
    /\bdebut\b|play in a game/.test(s) ||           // debut novelty
    /\brelocat|\bexpansion\b|\bexpand\b/.test(s)    // franchise relocation/expansion
  );
}

// IDF over the scan's market corpus. Common event words ("presidential",
// "election", "2028", "champion") get near-zero weight; rare distinguishing
// tokens (candidate names, teams) get high weight — so matching hinges on the
// entity, not the shared context.
function buildIdf(titles) {
  const df = new Map();
  const N = titles.length || 1;
  for (const t of titles) {
    for (const tok of new Set(tokenize(t))) df.set(tok, (df.get(tok) || 0) + 1);
  }
  const idf = new Map();
  for (const [tok, count] of df) idf.set(tok, Math.log((N + 1) / (count + 1)) + 1);
  return idf;
}

// Weighted Jaccard using IDF, plus the max IDF among shared tokens (so we can
// require at least one distinguishing token to overlap).
function weightedMatch(a, b, idf) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return { sim: 0, sharedPeakIdf: 0 };
  let interW = 0, unionW = 0, peak = 0;
  const union = new Set([...A, ...B]);
  for (const tok of union) {
    const w = idf.get(tok) || 1;
    unionW += w;
    if (A.has(tok) && B.has(tok)) { interW += w; if (w > peak) peak = w; }
  }
  return { sim: unionW ? interW / unionW : 0, sharedPeakIdf: peak };
}

function humanCloses(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "closing";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

// Honest fallback when a real time-series isn't available (new market, API
// miss, or a JARVIS/model reference line that has no market history): a flat
// line at the known current value — no fabricated movement.
function flatLine(currentCents, n = 16) {
  const c = Math.max(1, Math.min(99, Math.round(currentCents)));
  return Array.from({ length: n }, () => c);
}

function scoreConfidence(divergence, kLiq, pLiq) {
  const liquid = (pLiq || 0) >= 20000 || (kLiq || 0) >= 5000;
  if (divergence >= 8 && liquid) return "VERY HIGH";
  if (divergence >= 8) return "HIGH";
  if (divergence >= 5) return "HIGH";
  if (divergence >= 3) return "MODERATE";
  return "LOW";
}

// Translate an edge into a plain-language position: which side, which platform,
// at what entry, vs JARVIS's fair value. Informational readout, not advice.
function buildSuggestion({ isCross, kCents, pCents, modelProb, vegasProb }) {
  // Cross-platform: the SAME YES outcome is priced differently on the two venues
  // → the actionable move is to buy the cheaper side; it should converge up.
  if (isCross && kCents != null) {
    const buyPoly = pCents <= kCents;
    const buyPlat = buyPoly ? "Polymarket" : "Kalshi";
    const buyPrice = buyPoly ? pCents : kCents;
    const otherPlat = buyPoly ? "Kalshi" : "Polymarket";
    const otherPrice = buyPoly ? kCents : pCents;
    const gap = Math.abs(kCents - pCents);
    return {
      side: "YES",
      platform: buyPlat,
      entry: buyPrice,
      action: `Buy YES · ${buyPlat} ${buyPrice}¢`,
      detail: `Same outcome is ${gap}¢ cheaper on ${buyPlat} (${buyPrice}¢) than ${otherPlat} (${otherPrice}¢). Buy YES on ${buyPlat}; the two prices should converge toward ~${otherPrice}¢.`,
    };
  }
  // Model / Vegas vs a single market: directional call from the fair value.
  const fair = modelProb != null ? modelProb : vegasProb;
  if (fair == null) return null;
  const gap = Math.abs(fair - pCents);
  if (fair >= pCents) {
    return {
      side: "YES",
      platform: "Polymarket",
      entry: pCents,
      action: `Buy YES · Polymarket ${pCents}¢`,
      detail: `JARVIS fair value ~${fair}% vs the market's ${pCents}% — YES looks underpriced by ~${gap} pts.`,
    };
  }
  return {
    side: "NO",
    platform: "Polymarket",
    entry: 100 - pCents,
    action: `Buy NO · Polymarket ${100 - pCents}¢`,
    detail: `JARVIS fair value ~${fair}% vs the market's ${pCents}% — YES looks overpriced by ~${gap} pts, so NO carries the edge.`,
  };
}

function createArbiterEngine({ providers, llm = null }) {
  let last = { edges: [], catalysts: [], stats: {}, scannedAt: null };

  // Real price-history is fetched per surfaced edge and cached briefly so the
  // 10-min scans (and rapid room refreshes) mostly hit cache instead of
  // re-pulling the same market's series.
  const histCache = new Map(); // key -> { at, series }
  const HIST_TTL_MS = 5 * 60 * 1000;
  async function cachedHist(key, fetchSeries) {
    const hit = histCache.get(key);
    if (hit && Date.now() - hit.at < HIST_TTL_MS) return hit.series;
    let series = [];
    try { series = (await fetchSeries()) || []; } catch { series = []; }
    histCache.set(key, { at: Date.now(), series });
    return series;
  }

  async function scanCategory(category, { matchThreshold = 0.42, enrichLimit = 6 } = {}) {
    const [poly, kalshiRes] = await Promise.all([
      providers.polymarket.markets({ category, limit: 80 }).catch(() => []),
      providers.kalshi.events({ category, limit: 300 }).catch(() => ({ markets: [] })),
    ]);
    let kMarkets = (kalshiRes.markets || []).filter((k) => k.yesBid != null || k.yesAsk != null);
    // Sports: drop Kalshi's grouped/novelty/count markets — they have no clean
    // single-entity Polymarket counterpart, so they only add false-match risk
    // and enrichment cost.
    if (category === "sports") {
      kMarkets = kMarkets.filter((k) => !nonComparableSports(`${k.title} ${k.subtitle || ""}`));
    }

    // IDF over the combined corpus so entity tokens (names/teams) decide matches.
    const idf = buildIdf([
      ...poly.map((p) => p.question),
      ...kMarkets.map((k) => `${k.title} ${k.subtitle}`),
    ]);
    // A shared token counts as "distinguishing" if its IDF is near the corpus
    // max (i.e., it appears in only a handful of markets — a name/team, not a
    // context word). Scaled to corpus so it's not saturated.
    const maxIdf = Math.max(1, ...idf.values());
    const distinguishingIdf = 0.7 * maxIdf;

    // ── 1. Cross-platform candidate matches (IDF + archetype gated) ──
    const matched = new Map(); // polyId -> candidate
    for (const p of poly) {
      const pType = archetype(p.question);
      let best = null, bestSim = 0, bestPeak = 0;
      for (const k of kMarkets) {
        const kType = archetype(`${k.title} ${k.subtitle}`);
        if (pType !== kType && pType !== "generic" && kType !== "generic") continue;
        const { sim, sharedPeakIdf } = weightedMatch(p.question, `${k.title} ${k.subtitle}`, idf);
        if (sim > bestSim) { bestSim = sim; bestPeak = sharedPeakIdf; best = k; }
      }
      if (!best || bestSim < matchThreshold || bestPeak < distinguishingIdf) continue;
      const kCents = best.yesBid != null && best.yesAsk != null
        ? Math.round((best.yesBid + best.yesAsk) / 2)
        : (best.yesBid ?? best.yesAsk);
      const divergence = Math.abs(kCents - p.yesCents);
      if (divergence > 25 && bestSim < 0.72) continue; // mismatch guard
      matched.set(p.id, { poly: p, kCents, kTitle: best.title, kTicker: best.ticker, kVol: best.volume, sim: bestSim, divergence });
    }

    // ── 2. Candidate set to enrich: matched (by divergence) + top-volume unmatched ──
    // Model-vs-market gives edges even where no Kalshi pair exists (e.g. sports).
    const candidates = [
      ...[...matched.values()].sort((a, b) => b.divergence - a.divergence),
      ...poly.filter((p) => !matched.has(p.id)).sort((a, b) => b.volume - a.volume)
        .slice(0, enrichLimit).map((poly) => ({ poly, kCents: null })),
    ].slice(0, enrichLimit);

    // ── 3. LLM enrichment: verify match + estimate true probability (bounded, cached) ──
    const enriched = await Promise.all(candidates.map(async (c) => {
      let e = null;
      if (llm) {
        e = await llm.enrichEdge({
          question: c.poly.question, category, polymarket: c.poly.yesCents,
          kalshi: c.kCents ?? undefined, kalshiTitle: c.kTitle,
        }).catch(() => null);
      }
      return { c, e };
    }));

    // ── 4. Build edges from divergence + model-vs-market signals ──
    const edges = [];
    const rawSignals = []; // firehose: every candidate evaluated, pre-filter
    const histJobs = []; // { edge, polyToken, kTicker, leftCents, pCents } for real-history backfill
    for (const { c, e } of enriched) {
      const p = c.poly;
      const pCents = p.yesCents;
      const isCross = c.kCents != null;
      const matchRejected = isCross && e && e.sameMarket === false; // LLM rejected the match
      const divergence = isCross ? Math.abs(c.kCents - pCents) : 0;
      const modelProb = e ? e.trueProbability : null;
      const modelGap = modelProb != null ? Math.abs(modelProb - pCents) : 0;
      const vegasProb = e?.vegasProbability ?? null;
      const vegasGap = vegasProb != null ? Math.abs(vegasProb - pCents) : 0;
      const sentimentProb = e?.sentimentProbability ?? null;
      const sentimentGap = sentimentProb != null ? Math.abs(sentimentProb - pCents) : 0;

      const triggers = [];
      if (!matchRejected) {
        if (divergence >= 3) triggers.push("cross-platform");
        if (modelGap >= 6) triggers.push("model-vs-market");
        if (vegasGap >= 6) triggers.push("vegas-vs-market");
        // Sentiment is noisier than a model/Vegas read, so it needs a wider gap to
        // count as actionable.
        if (sentimentGap >= 8) triggers.push("sentiment-vs-market");
      }

      const rawScore = Math.max(divergence, modelGap, vegasGap, sentimentGap);

      // Firehose entry: log the candidate whatever the outcome, so the Signals
      // view can show what was evaluated and why most don't clear the bar.
      rawSignals.push({
        id: `${category}-${p.id}`,
        question: p.question,
        category,
        polymarket: pCents,
        kalshi: isCross ? c.kCents : null,
        modelProb, vegas: vegasProb, sentiment: sentimentProb,
        divergence, modelGap, vegasGap, sentimentGap,
        rawScore: Math.round(rawScore * 10) / 10,
        status: matchRejected ? "match-rejected" : triggers.length ? "actionable" : "below-threshold",
        triggers,
        matchScore: isCross ? Math.round(c.sim * 100) / 100 : null,
      });

      if (matchRejected) continue; // LLM rejected the cross-platform match
      const signals = triggers;
      if (!signals.length) continue; // nothing actionable — logged above, but no edge
      const liqBonus = p.liquidity >= 50000 ? 1.15 : p.liquidity >= 10000 ? 1.05 : 1;
      const matchW = isCross ? c.sim : 1;
      const edgeScore = Math.round(rawScore * matchW * liqBonus * 10) / 10;

      let confidence = scoreConfidence(rawScore, c.kVol, p.liquidity);
      if (e?.confidence === "low") confidence = rawScore >= 8 ? "MODERATE" : "LOW";
      else if (e?.confidence === "high" && rawScore >= 6) confidence = "VERY HIGH";

      const leftLabel = isCross ? "KALSHI" : "JARVIS";
      const leftCents = isCross ? c.kCents : (modelProb ?? pCents);

      const edge = {
        id: `${category}-${p.id}`,
        question: p.question,
        category,
        kalshi: leftCents,          // left pill value (Kalshi price, or JARVIS model prob)
        leftLabel,
        polymarket: pCents,
        modelProb,
        vegas: vegasProb,
        sentiment: sentimentProb,
        edgeScore,
        confidence,
        signals,
        matchScore: isCross ? Math.round(c.sim * 100) / 100 : null,
        fairValue: modelProb != null ? modelProb : (vegasProb != null ? vegasProb : null),
        suggestion: buildSuggestion({ isCross, kCents: c.kCents, pCents, modelProb, vegasProb }),
        rationale: e?.rationale
          || (isCross ? `${divergence}¢ divergence — Kalshi ${c.kCents}¢ vs Polymarket ${pCents}¢.`
                      : `JARVIS model vs Polymarket ${pCents}¢.`),
        closesIn: humanCloses(p.endDate),
        volume: `$${(Math.max(p.volume, c.kVol || 0) / 1e6).toFixed(1)}M`,
        liquidity: p.liquidity >= 50000 ? "HIGH" : p.liquidity >= 10000 ? "MEDIUM" : "LOW",
        // Defaults to an honest flat line; replaced with real series below when available.
        kalshiHist: flatLine(leftCents),
        polyHist: flatLine(pCents),
        related: [],
        kalshiTicker: c.kTicker || null,
        polyUrl: p.url,
      };
      edges.push(edge);
      histJobs.push({ edge, polyToken: p.clobTokenIdYes || null, kTicker: c.kTicker || null, leftCents, pCents });
    }

    // ── 5. Backfill real price-history for surfaced edges (parallel, cached) ──
    // Polymarket CLOB history for every edge; Kalshi candlesticks only for
    // cross-platform edges. Failures leave the honest flat-line default.
    await Promise.all(histJobs.map(async ({ edge, polyToken, kTicker }) => {
      if (polyToken) {
        const poly = await cachedHist(`poly:${polyToken}`, () =>
          providers.polymarket.priceHistory({ tokenId: polyToken }));
        if (poly.length) edge.polyHist = poly;
      }
      if (kTicker) {
        const kal = await cachedHist(`kalshi:${kTicker}`, () =>
          providers.kalshi.candlesticks(kTicker));
        if (kal.length) edge.kalshiHist = kal;
      }
    }));

    // Catalysts: group markets by their Polymarket event so each upcoming event
    // lists every market it directly moves, flagging which are live edges.
    const edgeById = new Map(edges.map((e) => [e.id, e]));
    const eventMap = new Map();
    for (const p of poly) {
      if (!p.endDate) continue;
      const key = p.eventSlug || p.eventTitle || p.id;
      if (!eventMap.has(key)) eventMap.set(key, { title: p.eventTitle || p.question, endDate: p.endDate, markets: [] });
      const g = eventMap.get(key);
      if (new Date(p.endDate) < new Date(g.endDate)) g.endDate = p.endDate;
      const edge = edgeById.get(`${category}-${p.id}`);
      g.markets.push({
        question: p.question,
        yes: p.yesCents,
        volume: p.volume,
        isEdge: Boolean(edge),
        edgeScore: edge ? edge.edgeScore : null,
        action: edge?.suggestion ? edge.suggestion.action : null,
      });
    }
    const catalysts = [...eventMap.values()]
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
      .slice(0, 8)
      .map((g) => {
        const markets = g.markets
          .sort((a, b) => (Number(b.isEdge) - Number(a.isEdge)) || (b.volume - a.volume))
          .slice(0, 15);
        return {
          id: `cat-${g.title}-${g.endDate}`.slice(0, 120),
          date: new Date(g.endDate).toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
          time: new Date(g.endDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) + " ET",
          kind: category === "sports" ? "game" : "vote",
          title: g.title,
          market: g.markets[0]?.question || g.title,
          category,
          marketCount: g.markets.length,
          edgeCount: g.markets.filter((m) => m.isEdge).length,
          impacted: markets.map((m) => ({ question: m.question, yes: m.yes, isEdge: m.isEdge, edgeScore: m.edgeScore, action: m.action })),
        };
      });

    return { edges, catalysts, signals: rawSignals };
  }

  async function scan({ categories = ["politics", "sports"] } = {}) {
    const results = await Promise.all(categories.map((c) => scanCategory(c).catch(() => ({ edges: [], catalysts: [], signals: [] }))));
    const edges = results.flatMap((r) => r.edges).sort((a, b) => b.edgeScore - a.edgeScore);
    const catalysts = results.flatMap((r) => r.catalysts)
      .sort((a, b) => new Date(`${a.date} 2026`) - new Date(`${b.date} 2026`));
    const signals = results.flatMap((r) => r.signals || []).sort((a, b) => b.rawScore - a.rawScore);
    const spreads = edges.map((e) => Math.abs(e.kalshi - e.polymarket));
    const stats = {
      marketsTracked: signals.length,
      liveEdges: edges.length,
      avgDivergence: spreads.length ? Math.round(spreads.reduce((s, v) => s + v, 0) / spreads.length) : 0,
      topEdge: edges.length ? edges[0].edgeScore : 0,
    };
    last = { edges, catalysts, signals, stats, scannedAt: new Date().toISOString() };
    return last;
  }

  function getLast() { return last; }

  return { scan, getLast };
}

module.exports = { createArbiterEngine, similarity, tokenize, archetype, nonComparableSports, buildSuggestion };
