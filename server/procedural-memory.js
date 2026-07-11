// Behavioral preference system — soft inference model with evidence accumulation.
// Preferences are stored as kind="preference" memories in neural-vault.
// Each preference has a score (0.0–0.95) that grows from reinforcing signals and
// fades only if contradicted. A single correction creates an "emerging" belief (~0.28),
// not a hard rule. It takes 3–4 confirming signals to reach "strong" (0.65+).

// ─── SIGNAL DETECTION ────────────────────────────────────────────────────────

const CORRECTION_PATTERNS = [
  // Explicit directives: stop, never, don't
  /\b(no[,.]?\s+don'?t|never|stop\s+\w+ing|stop\s+(?:doing|saying|adding|using|asking|starting|ending|beginning|summariz|repeat)|don'?t\s+(?:do|say|add|use|ask|always|ever|keep|start))\b/i,
  // Future-tense behavioral rules
  /\b(from\s+now\s+on|always|by\s+default|in\s+the\s+future|going\s+forward)\b/i,
  // Explicit preference statements
  /\b(i\s+(?:prefer|want|like|hate|dislike|told\s+you|said\s+(?:not\s+to|to)))\b/i,
  // Identity / format directives
  /\b(call\s+me|refer\s+to\s+me\s+as|my\s+name\s+is|use\s+(?:the\s+word|format|style))\b/i,
  // Explicit corrections — full set
  /\b(that'?s\s+(?:wrong|incorrect|not\s+right)|wrong\s+(?:format|style|way|tone|order)|not\s+quite|incorrect|that\s+wasn'?t\s+right)\b/i,
  // Short-form corrections that must appear at start of message or as standalone
  /^(actually[,. ]|i\s+meant[, ]|no[,!. ]|stop\s+it|wrong[,!. ]|not\s+like\s+that)/i,
];

const POSITIVE_SIGNAL_PATTERNS = [
  /\b(yes[,.]?\s+exactly|perfect[,!]|that'?s\s+(?:right|correct|it|perfect|what\s+i\s+(?:wanted|meant|needed))|exactly\s+right|spot\s+on|nailed\s+it)\b/i,
  /^(yes[,!.]|perfect[,!.]|exactly[,!.]|correct[,!.]|that'?s\s+it[,!.])$/i,
];

// Signal weights — contribution to score on each occurrence
const SIGNAL_WEIGHTS = {
  explicit_instruction: 0.35,    // "always give me X", "I prefer X", "from now on"
  direct_correction:    0.28,    // "don't do X", "stop X", "never X"
  positive_confirmation: 0.12,   // "yes exactly", "perfect" near a preference topic
};

// ─── TOPIC CLASSIFICATION ─────────────────────────────────────────────────────

const PREFERENCE_TOPICS = [
  { pattern: /\b(tool|capability|clipboard|screenshot)\b/i,                               topic: "tool_usage" },
  { pattern: /\b(tone|formal|casual|professional|friendly|concise|brief|verbose|terse|chatty)\b/i, topic: "response_tone" },
  { pattern: /\b(format|markdown|bullet|list|paragraph|heading|code\s+block|json|plain\s+text)\b/i, topic: "response_format" },
  { pattern: /\b(language|speak|english|hindi|urdu|spanish|french|translate)\b/i,        topic: "language" },
  { pattern: /\b(name|call\s+me|refer)\b/i,                                               topic: "user_identity" },
  { pattern: /\b(memory|remember|forget|recall)\b/i,                                     topic: "memory_behavior" },
  { pattern: /\b(direct|summary|summaries|summarize|short\s+answer|long\s+answer|detail)\b/i, topic: "answer_length" },
];

function detectTopic(text) {
  const lower = String(text || "").toLowerCase();
  for (const { pattern, topic } of PREFERENCE_TOPICS) {
    if (pattern.test(lower)) return topic;
  }
  return "behavioral_rule";
}

function isCorrection(text) {
  return CORRECTION_PATTERNS.some((re) => re.test(String(text || "")));
}

function isPositiveSignal(text) {
  return POSITIVE_SIGNAL_PATTERNS.some((re) => re.test(String(text || "")));
}

// ─── SCORE HELPERS ───────────────────────────────────────────────────────────

// Behavior level derived from score — no hard buckets, continuous spectrum
function getBehaviorLevel(score) {
  if (score < 0.22) return "speculative";
  if (score < 0.48) return "emerging";
  if (score < 0.70) return "strong";
  return "core";
}

// Map score to neural-vault importance (1–10 integer)
function scoreToImportance(score) {
  return Math.max(1, Math.min(10, Math.round(score * 10)));
}

// Reinforcing signal: diminishing returns, asymptotic to 0.95
function applyReinforcement(currentScore, weight) {
  return Math.min(0.95, currentScore + weight * (1 - currentScore));
}

function summarizeRule(text, maxLen = 300) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function tryParseMeta(json) {
  try { return JSON.parse(json || "{}"); } catch { return {}; }
}

const MAX_CORRECTION_LENGTH = 5000;

// ─── MAIN MODULE ─────────────────────────────────────────────────────────────

function createProceduralMemory({ neuralVault }) {
  // Find an existing active preference belief for this topic.
  // Uses topic-scoped search to ensure one canonical belief per topic.
  function findExistingForTopic(topic) {
    return neuralVault
      .searchMemories(topic, { limit: 15 })
      .filter((m) => (m.kind === "preference" || m.kind === "procedure") && m.topic === topic)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))[0] || null;
  }

  function ingestCorrection(userMessage, sessionId = "default") {
    const text = String(userMessage || "").trim();
    if (!text || text.length > MAX_CORRECTION_LENGTH || !isCorrection(text)) return null;

    const topic = detectTopic(text);
    const summary = summarizeRule(text);

    const signalType = /\b(prefer|want|like|always|from\s+now|by\s+default)\b/i.test(text)
      ? "explicit_instruction"
      : "direct_correction";
    const weight = SIGNAL_WEIGHTS[signalType];

    const existing = findExistingForTopic(topic);
    // searchMemories returns publicMemory() objects which have `metadata` (parsed), not `metadata_json`
    const meta = existing?.metadata || {};
    const currentScore = meta.score ?? 0;
    const newScore = applyReinforcement(currentScore, weight);
    const level = getBehaviorLevel(newScore);

    // Passing existing.content (when found) triggers the UPDATE path in upsertMemory,
    // ensuring one active belief per topic rather than accumulating duplicates.
    const contentKey = existing ? existing.content : text;

    return neuralVault.upsertMemory({
      kind: "preference",
      content: contentKey,
      title: `preference:${topic}`,
      summary,
      importance: scoreToImportance(newScore),
      confidence: newScore,
      topic,
      sourceType: "user_correction",
      metadata: {
        sessionId,
        score: newScore,
        signal_count: (meta.signal_count || 0) + 1,
        supporting: (meta.supporting || 0) + 1,
        contradicting: meta.contradicting || 0,
        last_signal_type: signalType,
        last_signal_at: new Date().toISOString(),
        behavior_level: level,
        latest_text: text,
      },
    });
  }

  // Call when user gives positive confirmation ("yes exactly", "perfect") adjacent to a topic.
  function ingestPositiveSignal(sessionId = "default", recentTopic = null) {
    if (!recentTopic) return null;
    const existing = findExistingForTopic(recentTopic);
    if (!existing) return null;

    const meta = existing.metadata || {};
    const currentScore = meta.score ?? 0.25;
    const newScore = applyReinforcement(currentScore, SIGNAL_WEIGHTS.positive_confirmation);
    const level = getBehaviorLevel(newScore);

    return neuralVault.upsertMemory({
      kind: "preference",
      content: existing.content,
      title: existing.title,
      summary: existing.summary,
      importance: scoreToImportance(newScore),
      confidence: newScore,
      topic: existing.topic,
      sourceType: "positive_confirmation",
      metadata: {
        ...meta,
        score: newScore,
        signal_count: (meta.signal_count || 1) + 1,
        supporting: (meta.supporting || 1) + 1,
        last_signal_type: "positive_confirmation",
        last_signal_at: new Date().toISOString(),
        behavior_level: level,
      },
    });
  }

  function getRules(limit = 20) {
    return neuralVault
      .searchMemories("preference behavioral rule", { limit: limit * 2 })
      .filter((m) => m.kind === "preference" || m.kind === "procedure")
      .sort((a, b) => {
        const sA = (a.metadata || {}).score ?? (a.kind === "procedure" ? 0.7 : 0);
        const sB = (b.metadata || {}).score ?? (b.kind === "procedure" ? 0.7 : 0);
        return sB - sA;
      })
      .slice(0, limit);
  }

  function formatRulesForContext(limit = 12) {
    const rules = getRules(limit).filter((r) => {
      const meta = r.metadata || {};
      // Only inject beliefs that have at least reached "emerging" threshold
      return (meta.score ?? (r.kind === "procedure" ? 0.7 : 0)) >= 0.22;
    });
    if (!rules.length) return "";
    const header = "Behavioral preferences (core/strong = always apply, emerging = context-dependent):";
    const lines = rules.map((r) => {
      const meta = r.metadata || {};
      const score = meta.score ?? (r.kind === "procedure" ? 0.7 : 0.5);
      const level = meta.behavior_level || getBehaviorLevel(score);
      const signals = meta.signal_count || 1;
      const topic = r.topic || "rule";
      const text = meta.latest_text || r.summary || r.content;
      return `• [${topic}, ${level} ${score.toFixed(2)}, ${signals} signal${signals !== 1 ? "s" : ""}] ${text}`;
    });
    return `${header}\n${lines.join("\n")}`;
  }

  return { ingestCorrection, ingestPositiveSignal, getRules, formatRulesForContext, isCorrection, isPositiveSignal };
}

module.exports = {
  createProceduralMemory,
  isCorrection,
  isPositiveSignal,
  detectTopic,
  getBehaviorLevel,
};
