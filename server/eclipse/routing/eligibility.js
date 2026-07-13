// ECLIPSE routing — the smart gate. Turns a raw prompt into a routing decision:
//   cortex   → direct answer / clarify (no mission, no tools beyond a device call)
//   pulse    → Cortex Prime, single agent, 0–2 tools (a fact, an extract, a bounded action)
//   deep     → Eclipse Umbra-lite: a small bounded mission, ≥1 tool Worker
//   totality → Eclipse Totality: full multi-agent mission
//
// Design goal (user's words): "its a smart system … not like if i say normal prompts it goes
// crazy and researches too much." So the cascade BIASES TO CHEAP and only escalates to a
// mission on strong, corroborated signal. Fully DETERMINISTIC — costs zero Gemini. eligibility
// never calls a model; a Flash-Lite refine pass is a separate opt-in step for the caller.

const { extractGenome } = require("./intent-genome");

// ── Stage 0: deterministic allowlist (always → cortex, cheapest path) ─────────────────
const GREETING = /^(hi+|hey+|hello|yo+|sup|howdy|thanks?|thank you|thx|ty|ok(ay)?|k|cool|nice|great|awesome|lol|lmao|gm|gn|good ?(morning|afternoon|evening|night))[\s!.?]*$/i;
const TIME = /^(what(?:'?s| is)?\s+)?(the\s+|current\s+)?(time|date|day)(\s+is\s+it)?\??$/i;
const DEVICE_VERB = /^(turn (on|off)|open|close|launch|start|stop|play|pause|resume|mute|unmute|set|toggle|dim|brighten|lock|unlock)\b/i;
const DEVICE_NOUN = /\b(light|lamp|lights|music|song|track|volume|brightness|screen|monitor|display|door|fan|tv|ac|thermostat|app|window|tab|spotify|desk|blinds?)\b/i;
const RESEARCHY = /\b(research|compare|versus|\bvs\b|analy[sz]e|investigate|draft|report|brief|landscape)\b/i;

function stripLead(t) {
  return t.replace(/^(what(?:'?s| is| are)|calculate|compute|whats)\s+/i, "").trim();
}
function isArithmetic(t) {
  const body = stripLead(t).replace(/[?=\s]+$/g, "");
  return body.length > 0 && /^[\d.\s+\-*/^%()]+$/.test(body) && /[-+*/^%\d]/.test(body);
}

// Returns a reason string if the prompt is on the allowlist, else null.
function allowlistReason(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (GREETING.test(t)) return "greeting/social";
  if (isArithmetic(t)) return "trivial arithmetic";
  if (TIME.test(t)) return "time/date lookup";
  const wordCount = t.split(/\s+/).length;
  if (wordCount <= 8 && DEVICE_VERB.test(t) && DEVICE_NOUN.test(t) && !RESEARCHY.test(t)) return "device/app command";
  return null;
}

// ── Stage 1: mission score from the genome (research/depth need, NOT consequence) ────
// Consequence is deliberately excluded here: a high-consequence single action ("email the
// board") is NOT a research mission — it routes to Cortex Prime + a capability approval, per
// the guardrail "consequence ≠ depth". Score ∈ [0,1] after clamp.
const W = { depth: 0.45, family: 0.30, fresh: 0.20, breadth: 0.15, memory: 0.30, ambiguity: 0.25 };
function familyWeight(fam) {
  if (fam === "research" || fam === "compare" || fam === "analyze") return 1.0;
  if (fam === "build") return 0.5;
  return 0.0;
}
function missionScore(g) {
  const depthNorm = Math.min(1, g.depth / 3);
  let s = W.depth * depthNorm + W.family * familyWeight(g.taskFamily) + W.fresh * g.freshness + W.breadth * g.breadth;
  s -= W.memory * g.answerableFromMemory + W.ambiguity * g.ambiguity;
  return Math.max(0, Math.min(1, s));
}

// Thresholds. Totality also requires a SECOND signal so a bounded 3-way compare doesn't
// over-trigger a full mission (bias to cheap).
const T_DEEP = 0.35, T_TOTAL = 0.70;

// ── The cascade. opts: {answerableFromMemory, allowMissions=true} ────────────────────
function classify(prompt, opts = {}) {
  const raw = String(prompt || "");
  const reasons = [];

  // Stage 0 — allowlist.
  const allow = allowlistReason(raw);
  if (allow) {
    return decision("cortex", "allowlist", [allow], 0, extractGenome(raw, opts));
  }

  const g = extractGenome(raw, { answerableFromMemory: opts.answerableFromMemory || 0 });
  const score = missionScore(g);

  // Hard guardrail A — explicit user intent to go deep overrides scoring.
  if (g.explicitDeep) {
    return decision("totality", "explicit-intent", ["user explicitly requested a deep/full research pass"], score, g);
  }

  // Hard guardrail B — ambiguity: never launch a mission on a vague prompt; clarify cheaply.
  if (g.ambiguity >= 0.7) {
    return decision("cortex", "clarify", ["prompt is ambiguous → ask a clarifying question, not a mission"], score, g);
  }

  // Hard guardrail C — consequence ≠ depth. A side-effecting single action stays on Cortex
  // Prime (which will request a capability lease/approval), it does NOT fan out.
  if (g.consequence >= 0.7 && g.depth <= 1 && familyWeight(g.taskFamily) < 1.0) {
    return decision("pulse", "consequence-gate", ["high-consequence action → single agent + capability approval (no fan-out)"], score, g, { requiresApproval: true });
  }

  // Missions can be globally disabled (e.g. eclipseEnabled flag off) — cap at pulse.
  const allowMissions = opts.allowMissions !== false;

  // Stage 2 — tiers.
  if (score >= T_TOTAL) {
    // Totality needs a signal ON A DIFFERENT AXIS than depth (depth already drove the score):
    // breadth of scope or real consequence. A deep-but-narrow task stays a bounded Deep mission.
    const secondSignal = g.breadth === 1 || g.consequence >= 0.5;
    if (allowMissions && secondSignal) {
      reasons.push(`missionScore ${score.toFixed(2)} ≥ ${T_TOTAL} + cross-axis signal (breadth/consequence)`);
      return decision("totality", "classifier", reasons, score, g);
    }
    // High score but only one signal → downgrade to a bounded deep mission (bias to cheap).
    reasons.push(`missionScore ${score.toFixed(2)} high but single-signal → bounded Deep, not Totality`);
    return decision(allowMissions ? "deep" : "pulse", "classifier", reasons, score, g);
  }

  if (score >= T_DEEP) {
    reasons.push(`missionScore ${score.toFixed(2)} in [${T_DEEP}, ${T_TOTAL}) → bounded Deep mission`);
    return decision(allowMissions ? "deep" : "pulse", "classifier", reasons, score, g);
  }

  // Below deep threshold. Freshness override: a fresh-fact question still needs ≥1 tool.
  if (g.freshness === 1 && allowMissions) {
    reasons.push("freshness override: current-info question needs ≥1 tool Worker → Deep-min");
    return decision("deep", "freshness-override", reasons, score, g);
  }

  reasons.push(`missionScore ${score.toFixed(2)} < ${T_DEEP} → single-agent Pulse`);
  return decision("pulse", "classifier", reasons, score, g);
}

function decision(tier, stage, reasons, score, genome, extra = {}) {
  return { tier, stage, reasons, score: Number(score.toFixed(3)), genome, ...extra };
}

module.exports = { classify, allowlistReason, missionScore, extractGenome, T_DEEP, T_TOTAL };
