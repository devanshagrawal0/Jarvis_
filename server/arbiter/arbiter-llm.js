// Arbiter LLM enrichment — match verification + probability estimation.
//
// One Anthropic call per candidate edge returns structured JSON:
//   { sameMarket, trueProbability, vegasProbability, sentimentProbability,
//     confidence, rationale }
// This (a) confirms a cross-platform match is really the same question
// (killing residual mismatches the token matcher can't catch), (b) produces
// JARVIS's own probability estimate for the model-vs-market edge signal,
// (c) extracts a Vegas-implied probability for sports, and (d) reads recent
// news + Reddit chatter to derive a sentiment-implied probability for the
// sentiment-vs-market signal.
//
// Results are cached in-memory (60 min) keyed by the market pair + prices, so
// re-scans of unchanged markets don't re-spend the research budget.

const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const CACHE_TTL_MS = 60 * 60 * 1000;

function createArbiterLLM({ apiKey = process.env.ANTHROPIC_API_KEY, model = DEFAULT_MODEL, search = null, news = null, getBaseRates = null } = {}) {
  const cache = new Map(); // key -> { at, value }
  let baseRatesCache = { at: 0, value: {} }; // memoized per-category calibration feedback

  // Feedback loop: tell the model how its own past resolved calls in this
  // category compare to reality, so it can correct its bias. Silent until there
  // are enough resolved edges (getBaseRates only returns qualified categories).
  function calibrationNote(category) {
    if (!getBaseRates) return "";
    if (Date.now() - baseRatesCache.at > 60_000) {
      try { baseRatesCache = { at: Date.now(), value: getBaseRates() || {} }; }
      catch { baseRatesCache = { at: Date.now(), value: {} }; }
    }
    const br = baseRatesCache.value?.[category];
    if (!br || !br.n) return "";
    const dir = br.biasPoints > 0 ? "higher than" : "lower than";
    return `Historical calibration: across ${br.n} of your resolved ${category} calls, your average YES estimate was ${br.avgPredicted}% but they resolved YES ${br.realizedYesRate}% of the time — you tend to estimate ${Math.abs(br.biasPoints)} pts ${dir} reality. Correct for this bias when setting trueProbability.`;
  }

  // Vegas odds lookup for sports (via web search). Returns a short text snippet
  // for the LLM to extract an implied probability from — LLM parsing is far more
  // robust than regex over messy odds formats.
  async function vegasSnippet(question) {
    if (!search) return "";
    try {
      const r = await search(`${question} betting odds implied probability sportsbook`);
      const parts = [];
      if (r.answerBox?.answer) parts.push(String(r.answerBox.answer));
      if (r.knowledgeGraph?.description) parts.push(String(r.knowledgeGraph.description));
      for (const o of (r.organic || []).slice(0, 4)) if (o.description) parts.push(o.description);
      return parts.join(" ").slice(0, 900);
    } catch {
      return "";
    }
  }

  // Keyless Reddit search — recent posts mentioning the market's subject. Reddit
  // gates server traffic without a descriptive User-Agent, so we send one and
  // treat any failure (403/429/network) as "no signal" rather than an error.
  async function redditSnippet(question) {
    try {
      const q = encodeURIComponent(String(question).slice(0, 120));
      const res = await fetch(
        `https://www.reddit.com/search.json?q=${q}&sort=new&limit=8&t=week`,
        { headers: { "User-Agent": "JARVIS-Arbiter/1.0" }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return "";
      const data = await res.json().catch(() => ({}));
      const posts = data?.data?.children || [];
      return posts
        .map((p) => p?.data?.title)
        .filter(Boolean)
        .slice(0, 8)
        .join(" · ")
        .slice(0, 700);
    } catch {
      return "";
    }
  }

  // Sentiment context = recent news headlines (Mediastack) + Reddit chatter.
  // Runs for every category (news is a strong signal for politics as well as
  // sports). Both sources are best-effort and combined into one short blob for
  // the LLM to read the crowd/news mood from.
  async function sentimentSnippet(question) {
    const [articles, reddit] = await Promise.all([
      news ? Promise.resolve(news(question)).catch(() => []) : Promise.resolve([]),
      redditSnippet(question),
    ]);
    const headlines = (articles || [])
      .map((a) => a && (a.title || a.description))
      .filter(Boolean)
      .slice(0, 6)
      .join(" · ");
    const parts = [];
    if (headlines) parts.push(`NEWS: ${headlines}`);
    if (reddit) parts.push(`REDDIT: ${reddit}`);
    return parts.join("\n").slice(0, 1100);
  }

  function cacheKey(c) {
    return `${c.category}|${c.question}|${c.kalshi ?? "-"}|${c.polymarket}`;
  }

  function parseJson(text) {
    if (!text) return null;
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }

  async function callClaude(system, user) {
    if (!apiKey) throw new Error("No Anthropic key configured");
    const res = await fetch(`${ANTHROPIC_API}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Anthropic ${res.status}`);
    }
    const data = await res.json();
    return data.content?.find((b) => b.type === "text")?.text || "";
  }

  const SYSTEM = [
    "You are Arbiter, a prediction-market analyst. You evaluate whether two markets are the SAME question and estimate the true probability of the outcome.",
    "Respond ONLY with a JSON object, no prose. Schema:",
    `{"sameMarket": boolean, "trueProbability": number (0-100, your best estimate of YES resolving), "vegasProbability": number|null (0-100 implied prob from any Vegas/sportsbook odds in the provided context; null if none), "sentimentProbability": number|null (0-100 probability of YES implied by the mood/direction of the provided news + social context; null if the context is empty or too thin to read), "confidence": "high"|"medium"|"low", "rationale": string (<=240 chars, cite the concrete reasoning)}`,
    "sameMarket is true only if the two markets resolve on the SAME event and criteria (same entity, same predicate, compatible dates). Different resolution criteria => false.",
    "Base trueProbability on real-world knowledge, base rates, and the market prices as a prior. Be calibrated, not anchored.",
    "If Vegas/sportsbook odds context is provided, convert it to an implied probability for vegasProbability; otherwise set vegasProbability to null.",
    "For sentimentProbability, read ONLY the provided news + Reddit context: is recent coverage/chatter trending toward YES or NO, and how strongly? Map that mood to a probability. This is a read of momentum/narrative, NOT your own base-rate estimate (that is trueProbability). If there is no usable sentiment context, set sentimentProbability to null — do not guess.",
  ].join("\n");

  // Enrich one candidate. `candidate` needs: question, category, polymarket (cents),
  // and optionally kalshi (cents) + kalshiTitle for cross-platform verification.
  async function enrichEdge(candidate) {
    const key = cacheKey(candidate);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const cross = candidate.kalshi != null
      ? `Kalshi market title: "${candidate.kalshiTitle || candidate.question}" priced at ${candidate.kalshi}¢ YES.\nPolymarket market: "${candidate.question}" priced at ${candidate.polymarket}¢ YES.\nAre these the SAME market?`
      : `Polymarket market: "${candidate.question}" priced at ${candidate.polymarket}¢ YES. (No cross-platform pair — set sameMarket true.)`;
    // Fetch enrichment context in parallel: Vegas odds (sports only) + news/social
    // sentiment (all categories). Both are best-effort and short.
    const [vegas, sentiment] = await Promise.all([
      candidate.category === "sports" ? vegasSnippet(candidate.question) : Promise.resolve(""),
      sentimentSnippet(candidate.question),
    ]);
    const calib = calibrationNote(candidate.category);
    const user = `Category: ${candidate.category}\n${cross}` +
      (vegas ? `\n\nVegas/sportsbook odds context (extract vegasProbability from this):\n${vegas}` : "") +
      (sentiment ? `\n\nNews + social sentiment context (derive sentimentProbability from this):\n${sentiment}` : "") +
      (calib ? `\n\n${calib}` : "") +
      `\nReturn the JSON.`;

    const clampProb = (v) =>
      v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.round(Number(v))));

    let value = null;
    try {
      const raw = await callClaude(SYSTEM, user);
      const parsed = parseJson(raw);
      if (parsed) {
        value = {
          sameMarket: parsed.sameMarket !== false,
          trueProbability: Math.max(0, Math.min(100, Math.round(Number(parsed.trueProbability)))),
          vegasProbability: clampProb(parsed.vegasProbability),
          sentimentProbability: clampProb(parsed.sentimentProbability),
          confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
          rationale: String(parsed.rationale || "").slice(0, 240),
        };
      }
    } catch {
      value = null; // caller falls back to the divergence-only edge
    }
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  return { enrichEdge };
}

module.exports = { createArbiterLLM };
