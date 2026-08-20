// ─────────────────────────────────────────────────────────────────────────
//  Gemini model registry — Cortex v4, single source of truth
//
//  One place to name every Gemini model + map the in-chat "Strength" dial to
//  model/tool choices. Verified available on the owner's key 2026-07-11 via
//  the models.list endpoint. Rename here → the whole app follows.
//
//  Cost intent: cheap models do the routine work; the premium tier (Pro,
//  Computer Use, hosted Deep Research, premium image) is gated by Strength.
// ─────────────────────────────────────────────────────────────────────────
const MODELS = {
  router: "gemini-3.1-flash-lite",        // routing, classify, extract, background, triage
  // 2026-08-15: gemini-3.6-flash went unstable on Google's side. Measured on the owner's key,
  // same trivial prompt, 4 calls: 2483/4608/2199/12080ms (31498ms in an earlier sample) — which
  // blows the 22s turn budget on roughly half of all turns, so Jarvis "stopped answering".
  // gemini-3.5-flash measured 1226/1371/1383/1733ms, zero failures. Main brain moves there.
  main: "gemini-3.5-flash",               // main brain: chat, tools, vision, grounding
  reasoning: "gemini-3.1-pro-preview",    // hard-reasoning escalation only
  live: "gemini-3.1-flash-live-preview",  // realtime voice
  embedding: "gemini-embedding-2",        // multimodal memory vectors
  image: "gemini-3.1-flash-image",        // Nano Banana 2 — charts/cards/report assets
  imagePro: "nano-banana-pro-preview",    // premium image (typography/layout)
  deepResearch: "deep-research-preview-04-2026",       // hosted Deep Research (option)
  deepResearchMax: "deep-research-max-preview-04-2026",
  computerUse: "gemini-2.5-computer-use-preview-10-2025",
  sandbox: "antigravity-preview-05-2026", // cloud Linux sandbox agent (heavy jobs)
};

// ─── Failover ladders — the real fix for "Jarvis can't answer anything" ──────
//  Google routinely 503s whatever single model is pinned (2026-07: gemini-3.5-flash
//  went hard-503; before that 2.5-flash did). Re-pinning is NOT a fix — it just moves
//  the outage. The permanent fix is a ladder of DISTINCT, verified-live, grounding-
//  capable models the brain walks on 503/429/500/404. Every rung below was verified
//  live on the owner's key (models.list + a real generateContent + googleSearch
//  grounding) on 2026-07-22. `*-latest` rungs are self-healing aliases Google keeps
//  pointed at a live model — they survive future model retirements with no code change.
//  ORDER MATTERS: grounding-capable models first; flash-lite is a last resort ONLY
//  (it does NOT return groundingMetadata, so a fresh-info turn on it would hallucinate).
//  2026-08-15 re-measure (owner's key, 4 calls each, same prompt):
//    gemini-2.5-flash       948ms avg / 1039ms worst / 0 failures  → promoted to rung 1
//    gemini-3-flash-preview 2200ms avg / 5220ms worst / 0 failures → rung 2
//    gemini-3.1-flash-lite   809ms avg / 0 failures                → last resort (no grounding)
//    gemini-flash-latest    4917ms avg / 10887ms worst / 1x 503    → REMOVED from rung 1; the
//      `-latest` aliases currently resolve to the unstable new models, so they are the opposite
//      of self-healing during a launch-capacity crunch.
const FALLBACKS = {
  main:      ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"],
  reasoning: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"],
  router:    ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
};

// Which ladder applies to a concrete model name (so callers never re-hardcode).
function fallbacksFor(model) {
  const m = String(model || "");
  if (/pro/.test(m)) return FALLBACKS.reasoning;
  if (/flash-lite/.test(m)) return FALLBACKS.router;
  return FALLBACKS.main;
}

// Short-lived memory of which models are currently letting us down.
//
// The ladder is walked from the top on EVERY request, so a model that is timing out or returning
// 503 gets re-tried, at full cost, every single time. Measured on a live send: `gemini-3.6-flash`
// burned 6.7s and failed, `gemini-flash-latest` burned 12.3s and failed, and `gemini-2.5-flash`
// then answered in about a second. Nineteen of those twenty seconds bought nothing — and the next
// request paid them again, because the outage lasts minutes and the ladder's memory was zero.
//
// Remembering a failure briefly means the next request starts where the last one succeeded. The
// window is deliberately short: these outages pass, and a demoted model has to be able to earn its
// place back on its own.
const MODEL_FAILURE_TTL_MS = 3 * 60_000;
const unhealthyUntil = new Map();

function noteModelFailure(model, atMs = Date.now()) {
  const name = String(model || "").trim();
  if (name) unhealthyUntil.set(name, atMs + MODEL_FAILURE_TTL_MS);
}

function noteModelSuccess(model) {
  // Recovery is observed, not assumed to arrive on a timer.
  unhealthyUntil.delete(String(model || "").trim());
}

function isModelUnhealthy(model, atMs = Date.now()) {
  const name = String(model || "").trim();
  const until = unhealthyUntil.get(name);
  if (!until) return false;
  if (until <= atMs) { unhealthyUntil.delete(name); return false; }
  return true;
}

// The full ordered candidate list for a model: itself first, then its ladder, deduped — with
// recently-failing models moved to the BACK rather than dropped.
//
// Demoted, never removed: if every candidate has failed recently the original order is returned
// unchanged, so the request still gets its full ladder. "Everything looks broken" must not quietly
// become "try nothing".
function candidatesFor(model, atMs = Date.now()) {
  const ordered = [...new Set([model, ...fallbacksFor(model)].filter(Boolean))];
  const healthy = ordered.filter((name) => !isModelUnhealthy(name, atMs));
  if (!healthy.length || healthy.length === ordered.length) return ordered;
  return [...healthy, ...ordered.filter((name) => isModelUnhealthy(name, atMs))];
}

// The Strength dial governs ONLY the premium tier. Cheap models (router/main/
// embedding) + free-tier Search grounding are always on with local fallbacks.
const STRENGTH = {
  "cost-guarded": { escalateToPro: false, computerUse: false, hostedDeepResearch: false, premiumImage: false },
  "balanced":     { escalateToPro: true,  computerUse: true,  hostedDeepResearch: true,  premiumImage: false },
  "full":         { escalateToPro: true,  computerUse: true,  hostedDeepResearch: true,  premiumImage: true, alwaysBest: true },
};
const DEFAULT_STRENGTH = "cost-guarded";

function modelFor(role) { return MODELS[role] || MODELS.main; }
function strengthProfile(name) { return STRENGTH[String(name || DEFAULT_STRENGTH).toLowerCase()] || STRENGTH[DEFAULT_STRENGTH]; }

// One honest Cortex control: Eco/Balanced stay on the strong main model with
// different thinking depth; Max absorbs the old Cortex Prime benefit by forcing
// Pro + high thinking. Old clients that still send `cortex-prime` migrate to Max
// here instead of keeping a second product path alive throughout the backend.
function resolveCortexExecution({ model, strength } = {}) {
  const migratedFromPrime = String(model || "").toLowerCase() === "cortex-prime";
  const requested = migratedFromPrime ? "full" : String(strength || DEFAULT_STRENGTH).toLowerCase();
  const resolvedStrength = Object.prototype.hasOwnProperty.call(STRENGTH, requested) ? requested : DEFAULT_STRENGTH;
  const isMax = resolvedStrength === "full";
  return {
    product: "cortex",
    strength: resolvedStrength,
    forceModel: isMax ? MODELS.reasoning : MODELS.main,
    thinkingLevel: isMax ? "high" : resolvedStrength === "balanced" ? "medium" : "minimal",
    migratedFromPrime,
  };
}

module.exports = { MODELS, FALLBACKS, MODEL_FAILURE_TTL_MS, STRENGTH, DEFAULT_STRENGTH, modelFor, strengthProfile, fallbacksFor, candidatesFor, isModelUnhealthy, noteModelFailure, noteModelSuccess, resolveCortexExecution };
