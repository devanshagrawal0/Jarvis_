// ECLIPSE graph state — the LangGraph Annotation.Root that the durable graph carries between
// supersteps. This is the WORKING state (checkpointed); Task OS + eclipse.sqlite remain the
// canonical record. List channels use concat reducers so fan-out branches merge at the
// superstep barrier without clobbering each other (ADR-002 / deep-design §4).
const { Annotation } = require("@langchain/langgraph");

const concat = (a, b) => (a || []).concat(b == null ? [] : b);
const merge = (a, b) => ({ ...(a || {}), ...(b || {}) });

const EclipseGraphState = Annotation.Root({
  // Set once at intake, then read-only downstream.
  mission: Annotation({ reducer: (a, b) => b ?? a, default: () => null }),
  genome: Annotation({ reducer: (a, b) => b ?? a, default: () => null }),
  effort: Annotation({ reducer: (a, b) => b ?? a, default: () => "deep" }),

  // Progresses through the pipeline; last write wins.
  phase: Annotation({ reducer: (a, b) => b ?? a, default: () => "intake" }),
  graphPlan: Annotation({ reducer: (a, b) => b ?? a, default: () => null }), // 'plan' collides with the plan node name

  // Accumulated evidence — concat so parallel Workers merge cleanly.
  packets: Annotation({ reducer: concat, default: () => [] }),      // quarantined (worker output)
  validated: Annotation({ reducer: concat, default: () => [] }),    // promoted by the Prosecutor only
  critiques: Annotation({ reducer: concat, default: () => [] }),    // Adversarial Critic verdicts
  claims: Annotation({ reducer: concat, default: () => [] }),
  evidence: Annotation({ reducer: concat, default: () => [] }),
  artifacts: Annotation({ reducer: concat, default: () => [] }),
  failures: Annotation({ reducer: concat, default: () => [] }),

  // A light execution trail for tests/observability (full log lives in eclipse_events).
  trail: Annotation({ reducer: concat, default: () => [] }),

  // Budget snapshot (mirrored from the cost ledger) + control flags + result.
  budget: Annotation({ reducer: merge, default: () => ({ tokens: 0, costUsd: 0 }) }),
  control: Annotation({ reducer: merge, default: () => ({ cancelled: false, paused: false }) }),
  result: Annotation({ reducer: (a, b) => b ?? a, default: () => null }),
  revision: Annotation({ reducer: (a, b) => (b == null ? a : a + 1), default: () => 0 }),

  // Verification outcome that steers the repair loop (set by verify, read by the router).
  verdict: Annotation({ reducer: (a, b) => b ?? a, default: () => null }),
  repairCount: Annotation({ reducer: (a, b) => (b == null ? a : b), default: () => 0 }),
});

module.exports = { EclipseGraphState, concat, merge };
