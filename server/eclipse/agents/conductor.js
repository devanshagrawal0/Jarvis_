// ECLIPSE Conductor support (Wave 2, S1.B2) — the deterministic half of the planning brain.
// The MODEL writes the contract and the staffing plan; everything here is the code that
// constrains it: schemas, budget arithmetic (ZEBRA: never let the LLM do knapsack math),
// the six plan critics (LLM-Modulo: a plan-checker that can actually FAIL), and the
// editable-preflight wait (Gemini Deep Research pattern).
// Blueprint: orb/agent-specs/BLUEPRINT_CONDUCTOR.md §4–§7.
const { z } = require("zod");
const { nowIso } = require("../contracts/validate");

// ── schemas (blueprint §4/§5) ────────────────────────────────────────────────────────────────
const ContractSchema = z.object({
  requirements: z.array(z.object({
    reqId: z.string(),
    text: z.string().min(3),
    freshness: z.enum(["today", "recent", "stable"]).default("stable"),
  })).min(1).max(8),
  guesses: z.array(z.string()).default([]),      // assumptions to verify-or-kill
});

const StaffingPlanSchema = z.object({
  complexityClass: z.enum(["fact", "snapshot", "comparison", "deep"]),
  assumptions: z.array(z.string()).default([]),
  hires: z.array(z.object({
    agentId: z.string(),
    tier: z.enum(["normal", "deep"]).default("normal"),
    brief: z.object({                             // the 4 Anthropic delegation fields, REQUIRED
      objective: z.string().min(8),
      angle: z.string().min(2),
      outputHint: z.string().min(4),
      sourceHints: z.array(z.string()).default([]),
      boundary: z.array(z.string()).default([]),
      reqIds: z.array(z.string()).min(1),         // which contract requirements this hire owns
      // Structured freshness instruction. critic#6 used to regex the objective for words like
      // "today|current" (a hardcoded word list on model output — LAW 0 smell). The requirement
      // is now DATA the plan must carry, so the check is structural.
      freshnessNote: z.string().optional().default(""),
    }),
    difficultyRank: z.number().int().min(1),
    why: z.string().min(3),
  })).min(1).max(5),
  notHired: z.array(z.object({ agentId: z.string(), why: z.string() })).default([]),
});

// ── budgets: model ranks difficulty, CODE computes the split (blueprint §5) ──────────────────
// capUsd*(1-reserve) distributed by inverse difficulty rank (rank 1 = hardest = largest share).
function computeBudgets(hires, { capUsd = 0.5, reservePct = 0.18, feeUsd = 0.035, tierBudgets = {} } = {}) {
  const pool = capUsd * (1 - reservePct);
  // 1/sqrt(rank): the 1/rank curve starved rank-3/4 scouts to a single search (measured live
  // 2026-09-03, SMR mission) - flatter split, floor applied below.
  const weights = hires.map((h) => 1 / Math.sqrt(h.difficultyRank));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const out = hires.map((h, i) => {
    const usdCap = Number(((weights[i] / wSum) * pool).toFixed(4));
    const tb = (tierBudgets[h.tier] || tierBudgets.normal || { searches: 5, reads: 6, tokens: 120000 });
    // Searches are the expensive line item (per-request fee): cap them so fees alone can't
    // exceed this scout's share.
    const maxSearchesByFee = Math.max(1, Math.floor((usdCap * 0.7) / feeUsd));
    return {
      ...h,
      budget: {
        usdCap,
        searches: Math.max(2, Math.min(tb.searches, maxSearchesByFee)), // floor 2: one search is a starved scout
        reads: tb.reads,
        tokens: tb.tokens,
        // These were dropped on the floor: the scout fell back to its defaults and the deep
        // tier's 12 variants / 3 contradiction searches could never have arrived.
        variants: tb.variants,
        contradiction: tb.contradiction,
      },
    };
  });
  return { hires: out, reserveUsd: Number((capUsd * reservePct).toFixed(4)) };
}

// ── the six plan critics (blueprint §6) — deterministic, each can FAIL ───────────────────────
// Deterministic word overlap (shared with the reuse critic).
function wordOverlap(a, b) {
  const w = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const wa = w(a), wb = w(b);
  if (!wa.size || !wb.size) return 0;
  let n = 0; for (const x of wa) if (wb.has(x)) n++;
  return n / Math.min(wa.size, wb.size);
}
function freshnessOf(contract, reqId) {
  const r = (contract.requirements || []).find((x) => x.reqId === reqId);
  return r ? r.freshness : "stable";
}

function verifyPlan(plan, contract, cards, { capUsd = 0.5, knownFacts = [] } = {}) {
  const errors = [];
  const reqIds = new Set(contract.requirements.map((r) => r.reqId));

  // 1. Coverage map: every contract requirement owned by ≥1 hire.
  const covered = new Set(plan.hires.flatMap((h) => h.brief.reqIds));
  for (const id of reqIds) if (!covered.has(id)) errors.push(`critic#1 coverage: requirement ${id} is owned by no hire`);
  for (const id of covered) if (!reqIds.has(id)) errors.push(`critic#1 coverage: hire claims unknown requirement ${id}`);

  // 2. Boundary disjointness: no requirement owned by two hires.
  const seen = new Map();
  for (const h of plan.hires) for (const id of h.brief.reqIds) {
    if (seen.has(id)) errors.push(`critic#2 boundary: requirement ${id} owned by two hires (${seen.get(id)} and ${h.agentId}#${h.difficultyRank})`);
    else seen.set(id, `${h.agentId}#${h.difficultyRank}`);
  }

  // 3. Budget feasibility: shares + reserve fit the cap (computeBudgets guarantees this by
  //    construction, so this critic guards against a TAMPERED/edited plan).
  const totalUsd = plan.hires.reduce((a, h) => a + (h.budget ? h.budget.usdCap : 0), 0) + (plan.reserveUsd || 0);
  if (totalUsd > capUsd + 1e-9) errors.push(`critic#3 budget: allocations $${totalUsd.toFixed(4)} exceed cap $${capUsd}`);

  // 4. Known-fact reuse (blueprint §6.4), ADVISORY: warn when a hire is about to re-research
  //    something the fleet already verified with compatible freshness. Deterministic overlap —
  //    settled facts come from knowledge.search, passed in by the caller.
  const warnings = [];
  for (const h of plan.hires) {
    for (const f of knownFacts) {
      const ov = wordOverlap(h.brief.objective, f.text);
      const staleOk = h.brief.reqIds.every((rid) => freshnessOf(contract, rid) !== "today");
      if (ov > 0.5 && staleOk) warnings.push(`critic#4 reuse: "${String(h.brief.angle).slice(0, 40)}" may re-research a settled fact — "${String(f.text).slice(0, 70)}"`);
    }
  }

  // 5. Fan-out sanity: ≤5 hires; every agentId is a real, non-retired, fanout-0 card.
  if (plan.hires.length > 5) errors.push(`critic#5 fanout: ${plan.hires.length} hires (max 5)`);
  const byId = new Map(cards.map((c) => [c.agentId, c]));
  for (const h of plan.hires) {
    const card = byId.get(h.agentId);
    if (!card) errors.push(`critic#5 fanout: unknown/retired agent "${h.agentId}"`);
    else if (card.fanout !== 0) errors.push(`critic#5 fanout: "${h.agentId}" has fanout ${card.fanout} — only leaf agents may be hired`);
  }

  // 6. Brief completeness: schema enforces fields; here: freshness constraints copied onto
  //    time-sensitive hires' briefs (a hire owning a 'today' requirement must say so).
  const freshById = new Map(contract.requirements.map((r) => [r.reqId, r.freshness]));
  for (const h of plan.hires) {
    const needsFresh = h.brief.reqIds.some((id) => freshById.get(id) === "today");
    // Structural, not lexical: the plan must CARRY the instruction in its own field.
    if (needsFresh && !String(h.brief.freshnessNote || "").trim()) {
      errors.push(`critic#6 brief: hire ${h.agentId}#${h.difficultyRank} owns a 'today' requirement but its brief has no freshnessNote`);
    }
  }

  // 7. Honest staffing (blueprint §10): every hireable card is either hired or explained in
  //    notHired — silent omission of an available agent fails the plan.
  const hiredIds = new Set(plan.hires.map((h) => h.agentId));
  const excusedIds = new Set((plan.notHired || []).map((n) => n.agentId));
  for (const c of cards) {
    if (!hiredIds.has(c.agentId) && !excusedIds.has(c.agentId)) {
      errors.push(`critic#7 honesty: agent "${c.agentId}" neither hired nor explained in notHired`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ── task ledger I/O (blueprint §4) ───────────────────────────────────────────────────────────
function createTaskLedger(db) {
  const up = db.prepare(`INSERT INTO eclipse_task_ledger(mission_id,contract_json,facts_json,guesses_json,plan_json,revision,updated_at)
    VALUES(@mission_id,@contract,@facts,@guesses,@plan,@revision,@at)
    ON CONFLICT(mission_id) DO UPDATE SET contract_json=@contract,facts_json=@facts,guesses_json=@guesses,plan_json=@plan,revision=@revision,updated_at=@at`);
  const get = db.prepare(`SELECT * FROM eclipse_task_ledger WHERE mission_id=?`);
  return {
    write({ missionId, contract, facts = [], guesses = [], plan = {}, revision = 0 }) {
      up.run({ mission_id: missionId, contract: JSON.stringify(contract), facts: JSON.stringify(facts), guesses: JSON.stringify(guesses), plan: JSON.stringify(plan), revision, at: nowIso() });
    },
    read(missionId) {
      const r = get.get(missionId);
      if (!r) return null;
      return { contract: JSON.parse(r.contract_json), facts: JSON.parse(r.facts_json), guesses: JSON.parse(r.guesses_json), plan: JSON.parse(r.plan_json || "{}"), revision: r.revision, updatedAt: r.updated_at };
    },
  };
}

// ── editable preflight (blueprint §6 tail) ───────────────────────────────────────────────────
// The plan renders in the console; the owner may edit via POST /missions/:id/plan, which writes
// {editedPlan, approvedAt} into plan_json. The plan node polls here for up to waitMs; an edit
// is re-verified by the critics before adoption (an invalid edit is rejected → original plan).
async function waitForPreflight(ledger, missionId, { waitMs = 20000, pollMs = 1000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < waitMs) {
    const row = ledger.read(missionId);
    const pj = row && row.plan;
    if (pj && pj.approvedAt) return { edited: !!pj.editedPlan, plan: pj.editedPlan || null };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { edited: false, plan: null, timedOut: true };
}

// The staffing schema with agentId locked to the REAL card ids - the model structurally
// cannot hire a display string or a ghost (plan-only test 2026-09-03 caught it doing exactly that).
function staffingSchemaFor(cardIds) {
  return StaffingPlanSchema.extend({
    hires: z.array(StaffingPlanSchema.shape.hires.element.extend({ agentId: z.enum(cardIds) })).min(1).max(5),
    notHired: z.array(z.object({ agentId: z.string(), why: z.string() })).default([]),
  });
}

module.exports = { ContractSchema, StaffingPlanSchema, staffingSchemaFor, computeBudgets, verifyPlan, createTaskLedger, waitForPreflight };
