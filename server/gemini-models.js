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
  main: "gemini-3.6-flash",               // main brain: chat, tools, vision, grounding
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
const FALLBACKS = {
  main:      ["gemini-flash-latest", "gemini-2.5-flash", "gemini-3.1-flash-lite"],
  reasoning: ["gemini-pro-latest", "gemini-3.6-flash", "gemini-flash-latest"],
  router:    ["gemini-3.5-flash-lite", "gemini-flash-lite-latest"],
};

// Which ladder applies to a concrete model name (so callers never re-hardcode).
function fallbacksFor(model) {
  const m = String(model || "");
  if (/pro/.test(m)) return FALLBACKS.reasoning;
  if (/flash-lite/.test(m)) return FALLBACKS.router;
  return FALLBACKS.main;
}

// The full ordered candidate list for a model: itself first, then its ladder,
// deduped. This is the one place the brain should build its failover order from.
function candidatesFor(model) {
  return [...new Set([model, ...fallbacksFor(model)].filter(Boolean))];
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

module.exports = { MODELS, FALLBACKS, STRENGTH, DEFAULT_STRENGTH, modelFor, strengthProfile, fallbacksFor, candidatesFor, resolveCortexExecution };
