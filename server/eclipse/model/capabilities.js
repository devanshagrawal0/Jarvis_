// ECLIPSE model layer — per-role capability metadata + node→model routing.
// ADR-006: DO NOT fork the registry. We read model IDs from the live gemini-models.js
// (read-only require) and attach Eclipse-only capability metadata here (thinking policy,
// retry class, cost estimate). Nothing in the live server imports this; safe on load.
const registry = require("../../gemini-models"); // { MODELS, modelFor(role), ... }

// Cost is an ESTIMATE for budgeting/cap enforcement only (USD per 1M tokens). Mid-2026
// public Gemini pricing is fuzzy; these are conservative order-of-magnitude figures, tuned
// later against real usage receipts. Over-estimating is the safe direction for a hard cap.
const ROLE_CAPS = {
  router:    { tier: "flash-lite", thinking: "minimal", retryClass: "cheap",   costIn: 0.10, costOut: 0.40, maxTools: 12, supportsThoughtSig: true },
  main:      { tier: "flash",      thinking: "medium",  retryClass: "standard", costIn: 0.30, costOut: 1.20, maxTools: 20, supportsThoughtSig: true },
  reasoning: { tier: "pro",        thinking: "high",    retryClass: "premium",  costIn: 1.25, costOut: 5.00, maxTools: 20, supportsThoughtSig: true },
  embedding: { tier: "embedding",  thinking: "none",    retryClass: "cheap",    costIn: 0.02, costOut: 0.00, maxTools: 0,  supportsThoughtSig: false },
  deepResearch:    { tier: "deep-research", thinking: "high", retryClass: "premium", costIn: 2.00, costOut: 8.00, maxTools: 20, supportsThoughtSig: true },
  deepResearchMax: { tier: "deep-research", thinking: "high", retryClass: "premium", costIn: 4.00, costOut: 16.0, maxTools: 20, supportsThoughtSig: true },
};

// Which role each graph node runs on. Bookkeeping nodes (commit) use no model.
const NODE_ROLE = {
  intake: "router",       // cheap parse/normalize the raw prompt
  contract: "reasoning",  // shape MissionSpec + acceptance tests (Architect-adjacent)
  context: "router",      // assemble context capsule (mostly retrieval, cheap)
  plan: "reasoning",      // Mission Architect — the plan graph
  worker: "main",         // the 3.5 agentic workhorse (fan-out)
  synthesize: "reasoning",// long-form synthesis from validated packets
  verify: "reasoning",    // Adversarial Critic / Evidence Prosecutor judgment
  repair: "main",         // targeted smallest-subgraph repair
  artifact: "reasoning",  // Artifact Director composes the deliverable
  commit: null,           // deterministic bookkeeping — no model call
};

// effort ∈ Effort enum (pulse|deep|totality) can escalate Worker thinking on consequential runs.
function thinkingFor(role, effort) {
  const base = (ROLE_CAPS[role] || ROLE_CAPS.main).thinking;
  if (role === "main" && effort === "totality") return "high"; // escalate workhorse on full missions
  return base;
}

// Resolve a node to a concrete model call spec. Returns null for model-less nodes (commit).
function modelForNode(node, effort = "deep") {
  const role = NODE_ROLE[node];
  if (role === null || role === undefined) return null;
  const caps = ROLE_CAPS[role] || ROLE_CAPS.main;
  return {
    node,
    role,
    modelId: registry.modelFor(role),
    thinking: thinkingFor(role, effort),
    retryClass: caps.retryClass,
    maxTools: caps.maxTools,
    supportsThoughtSig: caps.supportsThoughtSig,
    cost: { in: caps.costIn, out: caps.costOut }, // USD per 1M tokens (estimate)
  };
}

// Fallback tier chain for a role when its model 5xx's (Pro → Flash → Flash-Lite).
const FALLBACK_CHAIN = { reasoning: "main", main: "router", router: "router", deepResearch: "reasoning", deepResearchMax: "reasoning", embedding: "embedding" };
function fallbackRole(role) { return FALLBACK_CHAIN[role] || "main"; }

module.exports = { ROLE_CAPS, NODE_ROLE, modelForNode, thinkingFor, fallbackRole, registry };
