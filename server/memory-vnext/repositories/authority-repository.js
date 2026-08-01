"use strict";

// Reads the cutover ledger and answers one question: for a given domain, who is authoritative
// right now — legacy or vNext?
//
// WHY THIS EXISTS: Wave 32 built the full cutover ledger (plans, gated transitions, receipts,
// rollback) but nothing ever read `cutover_domain_states.authority`. `service.js` returned a
// hardcoded `writableAuthority: "legacy"` constant and `server.js` never instantiated the
// coordinator. So `activateDomain()` wrote a perfect, gated, signed receipt and changed no
// behaviour whatsoever — a cutover that exists on paper while the system runs unchanged is
// the most dangerous possible state, because the ledger claims you migrated.
//
// This repository is the missing wire. It is deliberately read-only: nothing here can change
// authority. Only the gated coordinator can do that.

const { CUTOVER_DOMAINS } = require("./shadow-evaluation-repository");

// A domain counts as cut over ONLY when authority is vnext AND the state is primary.
// `rolled_back` rows keep authority='legacy', but this double condition means a partially
// applied or unexpected state can never be read as "vNext is in charge".
const LIVE_STATE = "primary";
// Only these plan states can confer authority. A draft plan must never affect the runtime.
const LIVE_PLAN_STATUSES = new Set(["active", "completed"]);

function createAuthorityRepository({ db }) {
  // Schema 30 introduced the cutover tables. Below that there is nothing to read, and the
  // caller must fall back to legacy rather than crash the answer path.
  const ready = Number(db.pragma("user_version", { simple: true })) >= 30;

  function activePlan() {
    if (!ready) return null;
    try {
      return db.prepare(
        `SELECT id, status, rollback_window_ends_at, retention_until, completed_at
           FROM cutover_plans
          WHERE status IN ('active','completed')
          ORDER BY completed_at IS NULL, created_at DESC
          LIMIT 1`,
      ).get() || null;
    } catch { return null; }
  }

  /** Per-domain authority for the live plan. Absent plan → every domain legacy. */
  function domainAuthority() {
    const base = Object.fromEntries(CUTOVER_DOMAINS.map((domain) => [domain, "legacy"]));
    const plan = activePlan();
    if (!plan || !LIVE_PLAN_STATUSES.has(String(plan.status))) return { planId: null, planStatus: null, domains: base };
    try {
      const rows = db.prepare(
        `SELECT domain, authority, state, fallback_enabled AS fallbackEnabled, activation_sequence AS sequence
           FROM cutover_domain_states WHERE plan_id=?`,
      ).all(plan.id);
      const detail = {};
      for (const row of rows) {
        const live = String(row.authority) === "vnext" && String(row.state) === LIVE_STATE;
        base[row.domain] = live ? "vnext" : "legacy";
        detail[row.domain] = { authority: base[row.domain], state: row.state, fallbackEnabled: row.fallbackEnabled !== 0, sequence: row.sequence };
      }
      return { planId: plan.id, planStatus: plan.status, rollbackWindowEndsAt: plan.rollback_window_ends_at, domains: base, detail };
    } catch {
      // A malformed or partially-migrated ledger must degrade to legacy, never to vNext.
      return { planId: plan.id, planStatus: plan.status, domains: base };
    }
  }

  /** The plan the operator surface should act on: the newest one that is live or awaiting
   *  activation. Kept here rather than in the runtime because all SQL belongs behind a
   *  repository — the boundary guard enforces that, correctly. */
  function livePlanId() {
    if (!ready) return null;
    try {
      return db.prepare(
        `SELECT id FROM cutover_plans
          WHERE status IN ('active','approved','completed')
          ORDER BY created_at DESC LIMIT 1`,
      ).get()?.id || null;
    } catch { return null; }
  }

  return Object.freeze({ CUTOVER_DOMAINS, activePlan, domainAuthority, livePlanId, ready });
}

module.exports = { createAuthorityRepository, LIVE_PLAN_STATUSES, LIVE_STATE };
