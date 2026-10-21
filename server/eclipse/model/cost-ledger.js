// ECLIPSE per-mission token/cost ledger with a HARD cap. The single most important cost
// guard: a mission is ~15× a chat turn, so a runaway loop must be stopped by accounting, not
// hope. Every model call routes its usage through add(); assertWithinCap() is called BEFORE a
// node spends, so we refuse to start a call that would blow the ceiling rather than detecting
// it after paying. Pure/deterministic; no external deps.

class BudgetExceeded extends Error {
  constructor(msg, detail) { super(msg); this.name = "BudgetExceeded"; this.code = "ECLIPSE_BUDGET"; this.detail = detail; }
}

// caps: { maxCostUsd, maxTokens }. Either may be null/Infinity to disable that axis.
function createLedger({ maxCostUsd = 1.0, maxTokens = 400000 } = {}) {
  const cap = {
    maxCostUsd: maxCostUsd == null ? Infinity : maxCostUsd,
    maxTokens: maxTokens == null ? Infinity : maxTokens,
  };
  let tokens = 0, costUsd = 0, calls = 0;
  const byNode = {};  // node  → { tokens, costUsd, calls }
  const byAgent = {}; // agent → { tokens, costUsd, calls }   (several workers share node "worker")
  const fees = {};    // kind  → { count, usd }  — provider PER-REQUEST fees (e.g. grounded
                      // search bills per call, NOT per token; the ledger under-reported every
                      // search-using mission until S1.B1 added this).

  // usage: { node, agent, tokensIn, tokensOut, cost:{in,out} } where cost is USD per 1M tokens.
  // `agent` is the second dimension: the node name alone cannot separate fanned-out workers,
  // which all run under node "worker", so per-agent spend is unrecoverable without it.
  function add({ node = "?", agent = null, tokensIn = 0, tokensOut = 0, cost = { in: 0, out: 0 } } = {}) {
    const usd = (tokensIn / 1e6) * (cost.in || 0) + (tokensOut / 1e6) * (cost.out || 0);
    const tok = (tokensIn || 0) + (tokensOut || 0);
    tokens += tok; costUsd += usd; calls += 1;
    const b = (byNode[node] = byNode[node] || { tokens: 0, costUsd: 0, calls: 0 });
    b.tokens += tok; b.costUsd += usd; b.calls += 1;
    if (agent) {
      const a = (byAgent[agent] = byAgent[agent] || { tokens: 0, costUsd: 0, calls: 0 });
      a.tokens += tok; a.costUsd += usd; a.calls += 1;
    }
    return { tokens, costUsd, addedTokens: tok, addedUsd: usd };
  }

  // Record a provider per-request fee (no tokens involved). Counts toward the mission cost cap
  // exactly like model spend — a fee that can blow the cap refuses the same way.
  function addFee({ node = "?", agent = null, kind = "fee", usd = 0 } = {}) {
    costUsd += usd; calls += 1;
    const f = (fees[kind] = fees[kind] || { count: 0, usd: 0 });
    f.count += 1; f.usd += usd;
    const b = (byNode[node] = byNode[node] || { tokens: 0, costUsd: 0, calls: 0 });
    b.costUsd += usd; b.calls += 1;
    if (agent) {
      const a = (byAgent[agent] = byAgent[agent] || { tokens: 0, costUsd: 0, calls: 0 });
      a.costUsd += usd; a.calls += 1;
    }
    return { costUsd, addedUsd: usd };
  }

  // Running total for one agent. Returns zeros (not undefined) for an agent that has not spent.
  function forAgent(agent) {
    const a = byAgent[agent];
    return a ? { tokens: a.tokens, costUsd: a.costUsd, calls: a.calls } : { tokens: 0, costUsd: 0, calls: 0 };
  }

  // Call BEFORE a model call. estTokens is a conservative pre-estimate for the pending call.
  function assertWithinCap(estTokens = 0, estUsd = 0) {
    if (tokens + estTokens > cap.maxTokens) {
      throw new BudgetExceeded(`token cap ${cap.maxTokens} would be exceeded (${tokens}+${estTokens})`, { axis: "tokens", cap: cap.maxTokens, spent: tokens });
    }
    if (costUsd + estUsd > cap.maxCostUsd) {
      throw new BudgetExceeded(`cost cap $${cap.maxCostUsd} would be exceeded ($${costUsd.toFixed(4)}+$${estUsd.toFixed(4)})`, { axis: "cost", cap: cap.maxCostUsd, spent: costUsd });
    }
  }

  function snapshot() {
    return {
      tokens, costUsd: Number(costUsd.toFixed(6)), calls,
      cap: { maxTokens: cap.maxTokens, maxCostUsd: cap.maxCostUsd },
      remainingTokens: cap.maxTokens === Infinity ? Infinity : Math.max(0, cap.maxTokens - tokens),
      remainingUsd: cap.maxCostUsd === Infinity ? Infinity : Math.max(0, cap.maxCostUsd - costUsd),
      byNode: JSON.parse(JSON.stringify(byNode)),
      byAgent: JSON.parse(JSON.stringify(byAgent)),
      fees: JSON.parse(JSON.stringify(fees)),
    };
  }

  return { add, addFee, assertWithinCap, snapshot, forAgent, get tokens() { return tokens; }, get costUsd() { return costUsd; } };
}

module.exports = { createLedger, BudgetExceeded };
