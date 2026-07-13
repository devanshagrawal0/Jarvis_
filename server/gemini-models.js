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

module.exports = { MODELS, STRENGTH, DEFAULT_STRENGTH, modelFor, strengthProfile };
