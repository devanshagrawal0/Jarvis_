// helix-gateway.js — HELIX rebuild H1: bounded model policy, honest confidence,
// and real cost metering. Replaces the Math.random confidence (server.js:6767) and
// the hardcoded cost formula, and gives HELIX internal ops an explicit contract so
// they stop being routed to expensive models / ingesting global memory.
//
// CommonJS per jarvis-coding-rules.

// ── Operation policy ─────────────────────────────────────────────────
// Every internal HELIX model call declares its class; the flags below keep cheap
// ops cheap and stop internal scaffolding leaking into the global Neural Vault.
const HELIX_OP_POLICY = {
  classify:      { modelClass: "extraction", allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
  extract:       { modelClass: "extraction", allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
  synthesize:    { modelClass: "synthesis",  allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
  contradiction: { modelClass: "extraction", allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
  research:      { modelClass: "synthesis",  allowTools: true,  allowGrounding: true,  ingestGlobalMemory: false },
  brief:         { modelClass: "synthesis",  allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
  decision:      { modelClass: "reasoning",  allowTools: false, allowGrounding: false, ingestGlobalMemory: false },
};
function policyFor(op) { return HELIX_OP_POLICY[op] || HELIX_OP_POLICY.synthesize; }
function memoryNamespace(projectId) { return `helix:${projectId}`; }

// ── Honest confidence (replaces Math.random) ─────────────────────────
// A raw single-model answer with no verified sources is, by definition, unverified.
// We never fabricate a high number. Confidence is computed from real signals and
// surfaces as an ordinal label (§14 Q7) with its inputs recorded.
const NON_ANSWER_RE = /\b(i (?:have not|haven't|cannot|can't|am unable to|do not have|don't have)|i'm not able to|no response received|i have not verified|unable to (?:verify|confirm|access)|as an ai|i don't have (?:access|real-?time))\b/i;

function isNonAnswer(text) {
  const t = String(text || "").trim();
  if (t.length < 8) return true;
  return NON_ANSWER_RE.test(t);
}

/**
 * Assess confidence for a freshly-produced inquiry answer.
 * Returns { value(0..1), classification, status, supportStatus, method, inputs }.
 * grounded/sourceCount reflect whether real retrieval/grounding backed the answer.
 */
function assessInquiryConfidence({ responseText, isError = false, grounded = false, sourceCount = 0 } = {}) {
  if (isError || isNonAnswer(responseText)) {
    return {
      value: 0.1, classification: "insufficient", status: "cannot_assess", supportStatus: "unsupported",
      method: "non-answer-detected",
      inputs: { grounded: false, sources: 0, reason: isError ? "model error" : "refusal / non-answer" },
    };
  }
  if (grounded && sourceCount > 0) {
    // Grounded with sources. Grounding metadata alone is NOT strong — a single
    // grounded call can attach sources to a trivial answer. "Strong" requires
    // multiple independent sources; otherwise cap at moderate. (Honest calibration.)
    const value = sourceCount >= 4 ? 0.72 : sourceCount >= 2 ? 0.58 : 0.5;
    return {
      value, classification: sourceCount >= 4 ? "moderate" : sourceCount >= 2 ? "moderate" : "weak",
      status: "computed", supportStatus: "supported",
      method: "grounded-sources",
      inputs: { grounded: true, sources: sourceCount, note: "grounding present; strong requires independent corroboration + review" },
    };
  }
  // Single-model, no verified sources: honestly weak — an unverified assertion.
  return {
    value: 0.4, classification: "weak", status: "computed", supportStatus: "not_assessed",
    method: "single-model-unverified",
    inputs: { grounded: false, sources: 0, note: "answer not yet backed by retrieved sources" },
  };
}

// ── Real cost metering (replaces the hardcoded Flash-2.0 formula) ─────
// Approximate Gemini list prices, USD per 1M tokens [input, output].
const PRICING = [
  { re: /pro/i,        in: 1.25, out: 10.0 },
  { re: /flash-lite/i, in: 0.10, out: 0.40 },
  { re: /flash/i,      in: 0.30, out: 2.50 },
  { re: /embedding/i,  in: 0.15, out: 0.0 },
];
function priceFor(model) {
  const m = String(model || "");
  return PRICING.find(p => p.re.test(m)) || { in: 0.30, out: 2.50 };
}
// ── GROUNDED SEARCH IS BILLED PER REQUEST, NOT PER TOKEN ──────────────────
// Google bills Search-grounding requests separately from tokens (list price ~$35 per 1,000).
// This meter only ever counted tokens, so a research run firing 6 grounded searches reported
// ~$0.03 when it really cost ~$0.24 — about 8x understated. That under-report is exactly what
// let a day of testing drain a balance without either of us seeing it in the numbers. Every
// grounded call must be counted, or the figure is worse than useless: it is misleading.
const GROUNDING_USD_PER_REQUEST = Number(process.env.HELIX_GROUNDING_USD || 0.035);

function helixCostUsd(model, inTokens = 0, outTokens = 0, opts = {}) {
  const p = priceFor(model);
  const tokens = ((inTokens * p.in) + (outTokens * p.out)) / 1_000_000;
  return +(tokens + (opts.grounded ? GROUNDING_USD_PER_REQUEST : 0)).toFixed(6);
}
// Rough token estimate when a provider doesn't return usage (~4 chars/token).
function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

module.exports = {
  HELIX_OP_POLICY, policyFor, memoryNamespace,
  isNonAnswer, assessInquiryConfidence,
  helixCostUsd, priceFor, estimateTokens, GROUNDING_USD_PER_REQUEST,
};
