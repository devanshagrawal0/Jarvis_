const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const TIMEZONE = "America/New_York";

function textOf(value) {
  return String(value || "").trim();
}

function lowerOf(value) {
  return textOf(value).toLowerCase();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function trustedTime() {
  const date = new Date();
  const parts = localDateParts(date);
  return {
    now: date.toISOString(),
    timezone: TIMEZONE,
    source: "system_clock",
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localLabel: `${parts.weekday}, ${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`,
  };
}

function defaultTopicState() {
  return {
    activeTopic: null,
    activeSport: null,
    activeCompetition: null,
    activeTeam: null,
    activeSourcePreference: null,
    lastCorrection: null,
    blockedToolsThisTurn: [],
    lastSuccessfulTools: [],
    lastFailedTools: [],
    thorough: false,
    currentDateResolved: trustedTime().localDate,
    currentTimezone: TIMEZONE,
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function looksLikeBehaviorRules(prompt) {
  const text = textOf(prompt);
  const lower = text.toLowerCase();
  if (text.length < 120) return false;
  const ruleSignals = [
    /you are jarvis/i,
    /core rules?/i,
    /never say/i,
    /use kalshi only/i,
    /for every tool task/i,
    /system prompt/i,
    /behavior rules?/i,
    /do not pretend/i,
  ].filter((pattern) => pattern.test(text)).length;
  return ruleSignals >= 3 || (/^you are jarvis/i.test(text) && (lower.includes("never") || lower.includes("core rules")));
}

function hasSportsCue(lower) {
  return /\b(fifa|world cup|club world cup|soccer|football|match|matches|game|games|score|scores|result|results|who plays|match time|kickoff|kick-off)\b/.test(lower)
    || (/\bfixture|fixtures|schedule\b/.test(lower) && /\b(fifa|world cup|club world cup|soccer|football|match|matches|game|games)\b/.test(lower));
}

function hasKalshiCue(lower) {
  return /\bkalshi\b/.test(lower)
    || /\b(my|kalshi)\s+(portfolio|fills|orders?|positions?|balance|bets?)\b/.test(lower)
    || /\b(get|check|find|show)\s+(odds|markets?|contracts?|prices?)\s+(from|on)\s+kalshi\b/.test(lower);
}

function hasScheduleCue(lower) {
  return /\b(schedule|fixture|fixtures|games?|matches?|match times?|scores?|results?|live|today|tomorrow|next|upcoming|who plays|what .* games?)\b/.test(lower);
}

// Cortex v4 · 2.5 — STRONG schedule cue for topic INHERITANCE only: excludes bare
// time words (today/tomorrow/next/live) that also appear in non-sports questions
// ("is it a workday today?"). Prevents an old sports topic from hijacking unrelated turns.
function hasStrongScheduleCue(lower) {
  return /\b(schedule|fixture|fixtures|games?|matches?|match times?|scores?|results?|who plays|kickoff|line ?up|standings|final|semifinal|quarterfinal)\b/.test(lower);
}

function isCorrection(lower) {
  return /\b(not kalshi|we were talking about|that'?s not what i asked|thats not what i asked|today is|don'?t miss|dont miss|be thorough|wrong|no,?|actually|i meant)\b/.test(lower);
}

function inferSportsTopic(lower, previous = defaultTopicState()) {
  if (/\bfifa|world cup|club world cup\b/.test(lower)) {
    return {
      activeTopic: "fifa_world_cup",
      activeSport: "soccer",
      activeCompetition: "FIFA World Cup 2026",
    };
  }
  if (/\bsoccer|football\b/.test(lower)) {
    return {
      activeTopic: previous.activeTopic || "soccer",
      activeSport: "soccer",
      activeCompetition: previous.activeCompetition,
    };
  }
  return {};
}

function classifyIntent(prompt, topicState = defaultTopicState()) {
  const text = textOf(prompt);
  const lower = lowerOf(text);
  const correction = isCorrection(lower);
  const explicitNotKalshi = /\bnot kalshi|not about kalshi|no kalshi\b/.test(lower);
  const inheritedFifa = topicState.activeTopic === "fifa_world_cup"
    && hasStrongScheduleCue(lower)
    && !hasKalshiCue(lower);

  if (looksLikeBehaviorRules(text)) {
    return {
      intent: "system_instruction_update",
      confidence: 0.98,
      blockedTools: ["kalshi_market_discovery", "kalshi_markets", "web_research", "browser_navigate", "screen_act"],
      reason: "Pasted behavior/system rules should update local behavior config, not call tools.",
    };
  }
  if (explicitNotKalshi || (hasSportsCue(lower) && hasScheduleCue(lower) && !hasKalshiCue(lower)) || inheritedFifa) {
    return {
      intent: /\bscore|scores|result|results|won|final\b/.test(lower) ? "sports_results" : "sports_schedule",
      confidence: explicitNotKalshi ? 0.96 : 0.9,
      blockedTools: ["kalshi_market_discovery", "kalshi_markets"],
      reason: explicitNotKalshi ? "User explicitly corrected away from Kalshi." : "Sports schedule/results question without market language.",
    };
  }
  if (hasKalshiCue(lower)) {
    if (/\bportfolio|fills|orders?|positions?|balance|cash|latest bet|active positions?|p&l|profit|loss\b/.test(lower)) {
      return { intent: "kalshi_portfolio", confidence: 0.9, blockedTools: [], reason: "Kalshi account wording." };
    }
    return { intent: "kalshi_market", confidence: 0.9, blockedTools: [], reason: "Kalshi market/bet wording." };
  }
  if (/\b(mesh_status|device mesh|omnipresence|object portal|command cards?|phone link|cloudflare link|stable link)\b/.test(lower)) {
    return { intent: "device_mesh_status", confidence: 0.92, blockedTools: [], reason: "Device mesh wording." };
  }
  if (/\b(click|type|press|fullscreen|full screen|switch tabs?|current screen|on my screen|laptop screen|look at my screen)\b/.test(lower)) {
    return { intent: "screen_action", confidence: 0.86, blockedTools: [], reason: "Visible screen/control wording." };
  }
  if (/\b(open|go to|navigate|website|web page|browser|chrome|canvas|instagram|gmail|youtube|github|reddit)\b/.test(lower)) {
    return { intent: "browser_action", confidence: 0.82, blockedTools: [], reason: "Browser/navigation wording." };
  }
  if (/\b(latest|current|right now|online|news|research|look up|who won|who is|when is|where is)\b/.test(lower)) {
    return { intent: "general_web_search", confidence: 0.78, blockedTools: [], reason: "Current public information wording." };
  }
  if (/\b(make|create|generate|write|build|compose).*\b(report|brief|artifact|document|doc|pdf|slides?)\b/.test(lower)) {
    return { intent: "artifact_creation", confidence: 0.82, blockedTools: [], reason: "Artifact creation wording." };
  }
  return {
    intent: correction ? "memory_write" : "general_chat",
    confidence: correction ? 0.72 : 0.6,
    blockedTools: correction && explicitNotKalshi ? ["kalshi_market_discovery", "kalshi_markets"] : [],
    reason: correction ? "User correction/preference update." : "No tool-required intent detected.",
  };
}

function expandQueries(prompt, topicState, intent) {
  const text = textOf(prompt);
  const time = trustedTime();
  if (intent === "sports_schedule" || intent === "sports_results") {
    const base = topicState.activeCompetition || (/\bfifa|world cup/i.test(text) ? "FIFA World Cup 2026" : "sports");
    return [
      text,
      `${base} schedule ${time.localDate}`,
      `${base} games today ${time.localDate}`,
      `${base} results today ${time.localDate}`,
      `${base} live scores ${time.localDate}`,
      `${base} official schedule`,
    ];
  }
  if (intent === "kalshi_market") {
    return [
      text,
      text.replace(/\bgame\b/gi, "market"),
      `${text} Kalshi market`,
      `${text} odds contracts`,
      `${text} YES NO`,
    ];
  }
  if (intent === "general_web_search") {
    return [text, `${text} ${time.localDate}`, `${text} official source`];
  }
  return [text].filter(Boolean);
}

function createAgentRepair({ runtimeDir }) {
  const configDir = path.join(runtimeDir, "config");
  const memoryDir = path.join(runtimeDir, "memory");
  const behaviorMdPath = path.join(configDir, "jarvis_behavior.md");
  const behaviorJsonPath = path.join(configDir, "jarvis_behavior.json");
  const topicPath = path.join(runtimeDir, "topic-state.json");
  const dbPath = path.join(memoryDir, "jarvis_memory.sqlite");
  ensureDir(memoryDir);
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversation_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_events (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      intent TEXT,
      input_json TEXT,
      output_json TEXT,
      success INTEGER NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      verification_json TEXT
    );
    CREATE TABLE IF NOT EXISTS debug_traces (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL,
      user_message TEXT NOT NULL,
      intent TEXT,
      active_topic TEXT,
      selected_tools_json TEXT,
      blocked_tools_json TEXT,
      trace_json TEXT NOT NULL,
      final_answer TEXT,
      created_at TEXT NOT NULL
    );
  `);

  function loadTopic() {
    const fromJson = readJson(topicPath, null);
    if (fromJson && typeof fromJson === "object") return { ...defaultTopicState(), ...fromJson };
    const row = db.prepare("SELECT value_json FROM conversation_state WHERE key = ?").get("topic_state");
    if (!row) return defaultTopicState();
    try {
      return { ...defaultTopicState(), ...JSON.parse(row.value_json) };
    } catch {
      return defaultTopicState();
    }
  }

  function saveTopic(topicState) {
    const next = { ...defaultTopicState(), ...topicState, currentDateResolved: trustedTime().localDate, currentTimezone: TIMEZONE };
    writeJsonAtomic(topicPath, next);
    db.prepare(`
      INSERT INTO conversation_state(key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run("topic_state", JSON.stringify(next), nowIso());
    return next;
  }

  function updateTopic(prompt, intentResult) {
    const previous = loadTopic();
    const lower = lowerOf(prompt);
    const sportsPatch = inferSportsTopic(lower, previous);
    // Cortex v4 · 2.5 — topic decay. If this turn is clearly NOT sports (no sports cue,
    // non-sports intent) and didn't set a new sports topic, clear the sticky sports
    // topic so an old FIFA thread stops flavoring unrelated questions.
    const staysSports = Object.keys(sportsPatch).length > 0
      || hasSportsCue(lower)
      || intentResult.intent.startsWith("sports");
    const decay = (!staysSports && previous.activeTopic)
      ? { activeTopic: null, activeSport: null, activeCompetition: null }
      : {};
    const next = {
      ...previous,
      ...sportsPatch,
      ...decay,
      activeSourcePreference: intentResult.intent.startsWith("sports") ? "sports"
        : intentResult.intent.startsWith("kalshi") ? "kalshi"
          : previous.activeSourcePreference,
      lastCorrection: isCorrection(lower) ? textOf(prompt).slice(0, 500) : previous.lastCorrection,
      blockedToolsThisTurn: intentResult.blockedTools || [],
      thorough: previous.thorough || /\bbe thorough|don'?t miss|dont miss|all games|every game|everything\b/i.test(prompt),
    };
    return saveTopic(next);
  }

  function saveBehavior(prompt) {
    // T7b: cap at 50 KB to prevent unbounded file growth
    const body = textOf(prompt).slice(0, 50_000);
    ensureDir(configDir);
    fs.writeFileSync(behaviorMdPath, `${body}\n`, { encoding: "utf8", mode: 0o600 });
    writeJsonAtomic(behaviorJsonPath, {
      updatedAt: nowIso(),
      source: "user_paste",
      rules: body.split(/\r?\n| \* /).map((line) => line.trim()).filter(Boolean).slice(0, 80),
    });
    return {
      response: "Got it. I updated my behavior rules. I’ll verify actions before saying done, use sports/web for schedules, use Kalshi only for markets or account questions, keep replies cleaner, and avoid fake background promises.",
      files: { markdown: behaviorMdPath, json: behaviorJsonPath },
    };
  }

  function toolAvailability(capabilityEngine, providerStatus = {}) {
    const tools = {};
    const definitions = capabilityEngine?.definitions || [];
    for (const definition of definitions) {
      tools[definition.name] = "available";
    }
    if (providerStatus.kalshi && !providerStatus.kalshi.connected) {
      for (const name of Object.keys(tools).filter((name) => name.startsWith("kalshi_"))) tools[name] = "requires_login";
    }
    if (!tools.web_research) tools.web_research = "unavailable";
    if (!tools.mesh_status) tools.mesh_status = "unavailable";
    return tools;
  }

  function prepareTurn({ prompt, capabilityEngine, providerStatus }) {
    const topicBefore = loadTopic();
    const intentResult = classifyIntent(prompt, topicBefore);
    const topicAfter = updateTopic(prompt, intentResult);
    const expandedQueries = expandQueries(prompt, topicAfter, intentResult.intent);
    const turnId = crypto.randomUUID();
    return {
      turnId,
      time: trustedTime(),
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      reason: intentResult.reason,
      topicBefore,
      topicAfter,
      blockedTools: intentResult.blockedTools || [],
      expandedQueries,
      availableTools: toolAvailability(capabilityEngine, providerStatus),
      behaviorUpdate: intentResult.intent === "system_instruction_update" ? saveBehavior(prompt) : null,
    };
  }

  function recordDebugTrace({ turn, prompt, selectedTools = [], toolResults = [], finalAnswer = "" }) {
    if (!turn?.turnId) return null;
    const trace = {
      turnId: turn.turnId,
      timestamp: nowIso(),
      userMessage: textOf(prompt),
      normalizedMessage: lowerOf(prompt),
      intent: turn.intent,
      confidence: turn.confidence,
      reason: turn.reason,
      topicBefore: turn.topicBefore,
      topicAfter: turn.topicAfter,
      availableTools: turn.availableTools,
      blockedTools: turn.blockedTools,
      selectedTools,
      expandedQueries: turn.expandedQueries,
      toolResults: toolResults.map((item) => ({
        toolName: item.tool,
        success: Boolean(item.ok),
        status: item.status,
        error: item.error || "",
      })),
      finalAnswer,
    };
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO debug_traces(id, turn_id, user_message, intent, active_topic, selected_tools_json, blocked_tools_json, trace_json, final_answer, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      turn.turnId,
      textOf(prompt).slice(0, 4000),
      turn.intent,
      turn.topicAfter?.activeTopic || "",
      JSON.stringify(selectedTools),
      JSON.stringify(turn.blockedTools || []),
      JSON.stringify(trace),
      String(finalAnswer || "").slice(0, 8000),
      nowIso(),
    );
    return { id, trace };
  }

  function getDebugTrace(turnIdOrId) {
    const id = textOf(turnIdOrId);
    if (!id) return null;
    const row = db.prepare(`
      SELECT id, turn_id, user_message, intent, active_topic, selected_tools_json, blocked_tools_json, trace_json, final_answer, created_at
      FROM debug_traces
      WHERE turn_id = ? OR id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(id, id);
    if (!row) return null;
    let trace = {};
    try {
      trace = JSON.parse(row.trace_json);
    } catch {
      trace = {};
    }
    return {
      id: row.id,
      turnId: row.turn_id,
      userMessage: row.user_message,
      intent: row.intent,
      activeTopic: row.active_topic,
      selectedTools: readJsonFromText(row.selected_tools_json, []),
      blockedTools: readJsonFromText(row.blocked_tools_json, []),
      finalAnswer: row.final_answer,
      createdAt: row.created_at,
      trace,
    };
  }

  function listDebugTraces(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return db.prepare(`
      SELECT id, turn_id, user_message, intent, active_topic, selected_tools_json, blocked_tools_json, final_answer, created_at
      FROM debug_traces
      ORDER BY created_at DESC
      LIMIT ?
    `).all(safeLimit).map((row) => ({
      id: row.id,
      turnId: row.turn_id,
      userMessage: row.user_message,
      intent: row.intent,
      activeTopic: row.active_topic,
      selectedTools: readJsonFromText(row.selected_tools_json, []),
      blockedTools: readJsonFromText(row.blocked_tools_json, []),
      finalAnswer: row.final_answer,
      createdAt: row.created_at,
    }));
  }

  function readJsonFromText(text, fallback) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  return {
    classifyIntent,
    prepareTurn,
    recordDebugTrace,
    getDebugTrace,
    listDebugTraces,
    loadTopic,
    saveTopic,
    trustedTime,
    saveBehavior,
    dbPath,
    behaviorMdPath,
    close: () => db.close(),
  };
}

module.exports = {
  createAgentRepair,
  classifyIntent,
  expandQueries,
  looksLikeBehaviorRules,
  trustedTime,
};
