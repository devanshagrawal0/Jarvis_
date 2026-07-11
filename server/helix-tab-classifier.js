// server/helix-tab-classifier.js
// Wave 1-A: Tab classification pipeline + structured data builders
// classifyStrand() stays in helix-db.js for decay/routing — this is additive only

const TAB_TYPES = ["market","code","data","decision","comparison","design","people","media","research"];

// ── Classification cache — 50-entry LRU keyed by normalized query text ────────
// Avoids redundant Gemini calls for identical queries (e.g. retry after timeout)
const CLASS_CACHE = new Map();
const CLASS_CACHE_MAX = 50;

function cacheKey(text) {
  return text.toLowerCase().trim().slice(0, 120);
}

function cacheGet(text) {
  const k = cacheKey(text);
  if (!CLASS_CACHE.has(k)) return null;
  // Move to end (most-recently-used)
  const v = CLASS_CACHE.get(k);
  CLASS_CACHE.delete(k);
  CLASS_CACHE.set(k, v);
  return v;
}

function cacheSet(text, result) {
  const k = cacheKey(text);
  CLASS_CACHE.delete(k); // remove old position if exists
  CLASS_CACHE.set(k, result);
  // Evict oldest (first) entry if over cap
  if (CLASS_CACHE.size > CLASS_CACHE_MAX) {
    CLASS_CACHE.delete(CLASS_CACHE.keys().next().value);
  }
}

// ── Layer 2: Gemini Flash classification ──────────────────────────────────────

function buildClassifyPrompt(text, projectContext) {
  return `Classify this inquiry and extract metadata. Return JSON only, no prose, no markdown.

Tab types: market | code | data | decision | comparison | design | people | media | research | unknown

Definitions:
- market: stocks, crypto, Kalshi contracts, price analysis, trading signals, bets
- code: programming, debugging, scripts, APIs, system design implementation
- data: datasets, backtests, quantitative models, formulas, statistics
- decision: "should I", choosing between options, tradeoffs, recommendations
- comparison: X vs Y, spec comparison, feature analysis, two or more things being evaluated
- design: architecture diagrams, system design, database schemas, component structure
- people: persons, companies, organizations, biographical info
- media: articles, books, videos, podcasts, papers — content to analyze or summarize
- research: evidence gathering, factual questions, explanations, general knowledge
- unknown: does not fit any category above

Signal roles: ticker | language | person | org | item_a | item_b | trade_intent | time_bound | domain_keyword | formula | dataset_name

Inquiry: "${text.slice(0, 350)}"
Project context: "${(projectContext || "none").slice(0, 120)}"

Return exactly:
{
  "primary": "type",
  "secondary": "type or null",
  "confidence": 0.0,
  "signals": [{"text": "signal text", "role": "role"}],
  "metadata": {},
  "setup": {}
}

metadata by type:
- market: {"tickers": [], "kalshi_slug": null, "direction_intent": null}
- code: {"language": null, "problem_type": "debug|implement|explain|optimize|test"}
- data: {"dataset_name": null, "formula": null, "chart_type": "bar|line|scatter|none"}
- decision: {"option_count": 2, "domain": null}
- comparison: {"item_a": null, "item_b": null}
- design: {"diagram_type": "flow|erd|component|sequence|class"}
- people: {"name": null, "org": null}
- media: {"title": null, "media_type": "article|book|video|podcast|paper"}
- research: {"domain": null}
- unknown: {}

setup by type:
- market: {"fetch_price": false, "fetch_kalshi": false}
- code: {"run_capable": false}
- default: {}`;
}

async function detectTabType(text, projectContext, callGemini) {
  // Return cached result for identical query text (ignores projectContext — context
  // can shift the result slightly, but identical queries should classify identically)
  const cached = cacheGet(text);
  if (cached) return cached;

  try {
    const prompt = buildClassifyPrompt(text, projectContext);
    const result = await Promise.race([
      callGemini({ prompt, mode: "chat", sessionId: "helix-classifier", deviceId: "helix-system", source: "helix-tab-classify", history: [] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("classify-timeout")), 600))
    ]);

    const raw = (result.response || "").trim();
    // Strip markdown code fences if Gemini wraps despite instructions
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!TAB_TYPES.includes(parsed.primary) && parsed.primary !== "unknown") {
      parsed.primary = "research";
    }
    if (parsed.secondary && !TAB_TYPES.includes(parsed.secondary)) {
      parsed.secondary = null;
    }
    parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
    if (!Array.isArray(parsed.signals)) parsed.signals = [];
    if (!parsed.metadata || typeof parsed.metadata !== "object") parsed.metadata = {};
    if (!parsed.setup || typeof parsed.setup !== "object") parsed.setup = {};

    cacheSet(text, parsed);
    return parsed;
  } catch {
    return { primary: "research", secondary: null, confidence: 0.5, signals: [], metadata: {}, setup: {} };
  }
}

// ── Layer 3: Tab data builders ────────────────────────────────────────────────

function computeSignalFromText(text) {
  const t = (text || "").toLowerCase();
  const buyScore = (t.match(/\b(buy|bullish|upside|strong buy|long|yes bet|opportunity|undervalued|breakout|positive|recommend)\b/g) || []).length;
  const sellScore = (t.match(/\b(sell|bearish|downside|short|no bet|overvalued|risk|decline|negative|caution|avoid)\b/g) || []).length;
  const holdScore = (t.match(/\b(hold|neutral|wait|mixed|unclear|monitor|watch|moderate|balanced)\b/g) || []).length;
  const max = Math.max(buyScore, sellScore, holdScore);
  if (max === 0) return { signal: "WAIT", signalScore: 0.5 };
  if (max === buyScore) return { signal: "BUY", signalScore: Math.min(0.95, 0.6 + buyScore * 0.08) };
  if (max === sellScore) return { signal: "SELL", signalScore: Math.min(0.95, 0.6 + sellScore * 0.08) };
  return { signal: "HOLD", signalScore: Math.min(0.85, 0.5 + holdScore * 0.07) };
}

async function buildMarketData(metadata, text, geminiResponse, callGemini) {
  const tickers = Array.isArray(metadata.tickers) ? metadata.tickers.slice(0, 3) : [];
  const kalshiSlug = metadata.kalshi_slug || null;

  let priceData = null;
  if (tickers.length > 0 || kalshiSlug) {
    try {
      const pricePrompt = `Return current market data as JSON only. Ticker or contract: "${tickers[0] || kalshiSlug}".
Return: {"symbol":"TICKER","price":0.00,"change24h":0.00,"rsi":null,"maPosition":"above|below|at","volume":null,"note":""}
Use real grounded data if available. If no real data, return best estimate with note field explaining.
JSON only, no prose.`;
      const r = await Promise.race([
        callGemini({ prompt: pricePrompt, mode: "chat", sessionId: "helix-price", deviceId: "helix-system", source: "helix-price", history: [] }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("price-timeout")), 3000))
      ]);
      const raw = (r.response || "").replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) priceData = JSON.parse(match[0]);
    } catch { priceData = null; }
  }

  const { signal, signalScore } = computeSignalFromText(geminiResponse);
  return { type: "market", tickers, kalshiSlug, priceData, kalshiData: null, signal, signalScore };
}

function buildCodeData(metadata, text, geminiResponse) {
  const language = metadata.language || detectLanguageFromText(geminiResponse) || "unknown";
  const codeBlocks = extractCodeBlocks(geminiResponse);
  const issues = extractListSection(geminiResponse, /issue|bug|problem|error|fix/i);
  const improvements = extractListSection(geminiResponse, /improve|optimiz|suggest|consider|better/i);
  const steps = extractListSection(geminiResponse, /step|first|then|next|finally|\d+\./i);
  return {
    type: "code",
    language,
    problemType: metadata.problem_type || "explain",
    code: codeBlocks[0] || "",
    explanation: steps.slice(0, 5),
    issues: issues.slice(0, 5),
    improvements: improvements.slice(0, 5),
  };
}

function buildDataTabData(metadata, text, geminiResponse) {
  const formula = metadata.formula || extractFormula(geminiResponse);
  const metrics = extractMetrics(geminiResponse);
  return {
    type: "data",
    datasetName: metadata.dataset_name || null,
    chartType: metadata.chart_type || "none",
    formula,
    metrics: metrics.slice(0, 10),
    tables: [],
    summary: extractFirstParagraph(geminiResponse),
  };
}

function buildDecisionData(metadata, text, geminiResponse) {
  const options = extractDecisionOptions(geminiResponse, metadata.option_count || 2);
  const recommendation = extractRecommendation(geminiResponse);
  return {
    type: "decision",
    domain: metadata.domain || null,
    options: options.slice(0, 4),
    recommendation,
    assumptions: extractListSection(geminiResponse, /assum|depend|given|if|require/i).slice(0, 4),
  };
}

function buildComparisonData(metadata, text, geminiResponse) {
  return {
    type: "comparison",
    itemA: metadata.item_a || null,
    itemB: metadata.item_b || null,
    attributes: extractComparisonRows(geminiResponse).slice(0, 12),
    winner: extractRecommendation(geminiResponse),
  };
}

function buildDesignData(metadata, text, geminiResponse) {
  return {
    type: "design",
    diagramType: metadata.diagram_type || "flow",
    components: extractListSection(geminiResponse, /component|service|module|layer|system|table|entity/i).slice(0, 8),
    dependencies: extractListSection(geminiResponse, /depend|connect|link|call|uses|integrat/i).slice(0, 6),
    summary: extractFirstParagraph(geminiResponse),
  };
}

function buildPeopleData(metadata, text, geminiResponse) {
  return {
    type: "people",
    name: metadata.name || null,
    org: metadata.org || null,
    facts: extractListSection(geminiResponse, /.+/i).slice(0, 8),
    summary: extractFirstParagraph(geminiResponse),
  };
}

function buildMediaData(metadata, text, geminiResponse) {
  return {
    type: "media",
    title: metadata.title || extractTitle(geminiResponse),
    mediaType: metadata.media_type || "article",
    outline: extractListSection(geminiResponse, /section|chapter|part|topic|\d+\./i).slice(0, 8),
    quotes: extractQuotes(geminiResponse).slice(0, 3),
    summary: extractFirstParagraph(geminiResponse),
  };
}

function buildResearchData(metadata, text, geminiResponse) {
  return {
    type: "research",
    domain: metadata.domain || null,
    claims: extractListSection(geminiResponse, /find|show|evidence|study|result|conclud|suggest/i).slice(0, 6),
    confidence: extractConfidenceBreakdown(geminiResponse),
    summary: extractFirstParagraph(geminiResponse),
  };
}

async function buildGenericData(primaryType, text, geminiResponse, callGemini) {
  try {
    const prompt = `Design a specialized analysis tab for this inquiry type: "${primaryType}".
Create 3-5 informative sections from the response below.
Return JSON only: {"label":"Short Tab Label","icon":"single emoji","sections":[{"type":"text|list|table|metric|quote","title":"Section Title","content":"text content or array of strings"}]}

Response to analyze:
"${geminiResponse.slice(0, 600)}"

JSON only, no prose.`;
    const r = await Promise.race([
      callGemini({ prompt, mode: "chat", sessionId: "helix-generic-tab", deviceId: "helix-system", source: "helix-generic", history: [] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("generic-timeout")), 3000))
    ]);
    const raw = (r.response || "").replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { type: "generic", label: parsed.label || primaryType, icon: parsed.icon || "◆", sections: parsed.sections || [] };
    }
  } catch { /* fall through */ }
  return {
    type: "generic",
    label: primaryType,
    icon: "◆",
    sections: [{ type: "text", title: "Overview", content: extractFirstParagraph(geminiResponse) }],
  };
}

const BUILDERS = {
  market:     buildMarketData,
  code:       (meta, text, resp) => Promise.resolve(buildCodeData(meta, text, resp)),
  data:       (meta, text, resp) => Promise.resolve(buildDataTabData(meta, text, resp)),
  decision:   (meta, text, resp) => Promise.resolve(buildDecisionData(meta, text, resp)),
  comparison: (meta, text, resp) => Promise.resolve(buildComparisonData(meta, text, resp)),
  design:     (meta, text, resp) => Promise.resolve(buildDesignData(meta, text, resp)),
  people:     (meta, text, resp) => Promise.resolve(buildPeopleData(meta, text, resp)),
  media:      (meta, text, resp) => Promise.resolve(buildMediaData(meta, text, resp)),
  research:   (meta, text, resp) => Promise.resolve(buildResearchData(meta, text, resp)),
};

async function buildTabData(classification, text, geminiResponse, callGemini) {
  const { primary, secondary, metadata } = classification;
  const tabs = [];

  const buildOne = async (type) => {
    if (!type || type === "unknown") {
      return buildGenericData(type || "general", text, geminiResponse, callGemini);
    }
    const builder = BUILDERS[type];
    if (!builder) return buildGenericData(type, text, geminiResponse, callGemini);
    try {
      return await builder(metadata, text, geminiResponse, callGemini);
    } catch {
      return buildGenericData(type, text, geminiResponse, callGemini);
    }
  };

  const [primaryTab, secondaryTab] = await Promise.all([
    buildOne(primary),
    secondary ? buildOne(secondary) : Promise.resolve(null),
  ]);

  if (primaryTab) tabs.push(primaryTab);
  if (secondaryTab) tabs.push(secondaryTab);

  return {
    tabs,
    workflowStage: "captured",
    nextActions: getInitialNextActions(primary),
  };
}

function getInitialNextActions(tabType) {
  const defaults = {
    market:     ["triangulate", "redteam"],
    code:       ["develop", "probe"],
    data:       ["triangulate", "develop"],
    decision:   ["redteam", "probe"],
    comparison: ["triangulate", "probe"],
    research:   ["triangulate", "prior-art"],
  };
  return defaults[tabType] || ["triangulate"];
}

// ── Text extraction helpers ───────────────────────────────────────────────────

function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```(?:\w+)?\n?([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].trim());
  // Also try indented blocks as fallback
  if (blocks.length === 0) {
    const indented = text.match(/(?:^|\n)((?:    .+\n?)+)/m);
    if (indented) blocks.push(indented[1].replace(/^    /gm, "").trim());
  }
  return blocks;
}

function extractListSection(text, headingPattern) {
  const lines = text.split("\n");
  const results = [];
  for (const line of lines) {
    const clean = line.replace(/^[-*•→\d.)\s]+/, "").trim();
    if (clean.length > 10 && clean.length < 300 && headingPattern.test(clean)) {
      results.push(clean);
    }
  }
  // If pattern is catch-all, just return bulleted lines
  if (headingPattern.source === ".+") {
    return lines
      .filter(l => /^[-*•→\d.]/.test(l.trim()))
      .map(l => l.replace(/^[-*•→\d.)\s]+/, "").trim())
      .filter(l => l.length > 5 && l.length < 300);
  }
  return results;
}

function detectLanguageFromText(text) {
  const t = text.toLowerCase();
  if (/\bpython\b|def |import numpy|pandas|\.py\b/.test(t)) return "python";
  if (/\bjavascript\b|\bjs\b|const |let |async function|\.js\b/.test(t)) return "javascript";
  if (/\btypescript\b|\.tsx?\b|interface |type /.test(t)) return "typescript";
  if (/\brust\b|fn main|impl |use std/.test(t)) return "rust";
  if (/\bgolang\b|\bgo\b|func main|package main/.test(t)) return "go";
  if (/\bjava\b|public class|System\.out/.test(t)) return "java";
  if (/\bsql\b|SELECT |FROM |WHERE /.test(t)) return "sql";
  if (/\bbash\b|#!/.test(t)) return "bash";
  return null;
}

function extractFormula(text) {
  const m = text.match(/f\*?\s*=\s*[^.\n]+|E\[.+?\]\s*=|∑|∫|formula[:\s]+([^\n]+)/i);
  return m ? m[0].trim() : null;
}

function extractMetrics(text) {
  const metrics = [];
  const re = /([A-Z][A-Za-z\s]{2,20})[:\s]+([−\-]?\d+(?:[.,]\d+)?(?:\s*%)?)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    metrics.push({ name: m[1].trim(), value: m[2].trim() });
    if (metrics.length >= 10) break;
  }
  return metrics;
}

function extractDecisionOptions(text, count) {
  const options = [];
  const lines = text.split("\n");
  const optionRe = /^(?:option\s*[a-z1-9]|[a-z1-9][.)]\s+|\*\*[a-z])/i;
  for (const line of lines) {
    if (optionRe.test(line.trim())) {
      const clean = line.replace(/^[-*•→\d.)\s*]+/, "").trim();
      if (clean.length > 5) {
        options.push({ title: clean.slice(0, 80), rationale: "", pros: [], cons: [], confidence: 0.7 });
      }
    }
    if (options.length >= (count || 4)) break;
  }
  // fallback: take numbered items
  if (options.length === 0) {
    for (const line of lines) {
      if (/^\d[.)]\s+/.test(line.trim())) {
        const clean = line.replace(/^\d[.)\s]+/, "").trim();
        if (clean.length > 5) options.push({ title: clean.slice(0, 80), rationale: "", pros: [], cons: [], confidence: 0.7 });
      }
      if (options.length >= 4) break;
    }
  }
  return options;
}

function extractRecommendation(text) {
  const m = text.match(/recommend(?:ation)?[:\s]+([^\n.]{10,200})|suggest\s+([^\n.]{10,200})|best\s+option[:\s]+([^\n.]{10,200})/i);
  if (m) return (m[1] || m[2] || m[3] || "").trim();
  return null;
}

function extractComparisonRows(text) {
  const rows = [];
  const lines = text.split("\n");
  for (const line of lines) {
    // Match markdown table rows: | attr | val | val |
    const cells = line.split("|").map(c => c.trim()).filter(Boolean);
    if (cells.length >= 3 && !/^[-:\s]+$/.test(cells[0])) {
      rows.push({ attribute: cells[0], valueA: cells[1], valueB: cells[2] });
    }
  }
  return rows;
}

function extractFirstParagraph(text) {
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 30 && !p.startsWith("#") && !p.startsWith("-") && !p.startsWith("*"));
  return (paras[0] || text.slice(0, 300)).slice(0, 500);
}

function extractTitle(text) {
  const m = text.match(/^#+\s+(.+)$/m) || text.match(/^([A-Z][^\n]{10,100})\n/m);
  return m ? m[1].trim() : null;
}

function extractQuotes(text) {
  const quotes = [];
  const re = /"([^"]{20,300})"/g;
  let m;
  while ((m = re.exec(text)) !== null) quotes.push(m[1]);
  return quotes;
}

function extractConfidenceBreakdown(text) {
  const m = text.match(/confidence[:\s]+(\d+(?:\.\d+)?%?)/i) || text.match(/(\d+)%\s+confident/i);
  return m ? m[1] : null;
}

// ── Wave 1-C: Self-correcting classification bias ─────────────────────────────

function getProjectClassificationBias(projectId, db) {
  try {
    const count = db.getTabCorrectionCount(projectId);
    if (count < 3) return ""; // not enough signal yet

    // Fetch last 20 corrections, most-recent first (listTabCorrections orders DESC)
    const corrections = db.listTabCorrections(projectId).slice(0, 20);

    // Weight recent corrections exponentially: index 0 (newest) → weight 1.0,
    // each step back decays by 0.85 so recent overrides matter more than old ones
    const groups = {};
    corrections.forEach((c, i) => {
      const key = `${c.original_type}→${c.corrected_type}`;
      const weight = Math.pow(0.85, i);
      groups[key] = (groups[key] || 0) + weight;
    });

    const hints = Object.entries(groups)
      .filter(([, w]) => w >= 1.5) // weighted threshold — roughly 2 recent or 3+ older
      .sort((a, b) => b[1] - a[1])  // highest-weight patterns first
      .slice(0, 4)
      .map(([key]) => {
        const [from, to] = key.split("→");
        return `- In this project, queries classified as "${from}" are often corrected to "${to}"`;
      });

    if (hints.length === 0) return "";
    return `\n\nProject classification corrections (learn from these — weighted by recency):\n${hints.join("\n")}`;
  } catch { return ""; }
}

module.exports = { detectTabType, buildTabData, getProjectClassificationBias };
