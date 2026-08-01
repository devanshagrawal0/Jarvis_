"use strict";

// The runtime half of Wave 32.
//
// `activateDomain()` writes authority into the cutover ledger. This turns that ledger row into
// an answer the live request path can act on. Three properties matter more than anything else
// here, because this sits on the owner's personal memory:
//
//   1. FAIL SAFE TO LEGACY. Every failure mode — no plan, no store, malformed ledger, closed
//      DB, thrown query — resolves to "legacy". vNext authority is only ever returned when the
//      ledger positively says so. The dangerous direction is silently answering "vnext".
//   2. NEVER BLOCK A TURN. Resolution is a cached synchronous read; a stale value for a few
//      seconds is fine, a slow answer path is not.
//   3. READ-ONLY. Nothing here can grant authority. Only the gated coordinator can.

const { createAuthorityRepository } = require("./repositories/authority-repository");

const DEFAULT_TTL_MS = 5_000;
const LEGACY = "legacy";

function createAuthorityResolver({ store, ttlMs = DEFAULT_TTL_MS, logger = console } = {}) {
  let cache = null;
  let cachedAt = 0;
  let repo = null;
  let lastError = "";

  function fallback(reason) {
    return { planId: null, planStatus: null, domains: {}, degraded: true, reason };
  }

  function load() {
    if (!store?.attachRepository) return fallback("no_store");
    try {
      repo = repo || store.attachRepository(createAuthorityRepository);
      return repo.domainAuthority();
    } catch (error) {
      // A resolver failure must never take the answer path down with it.
      lastError = String(error?.message || error).slice(0, 300);
      logger.warn?.(`[memory-vnext-authority] falling back to legacy: ${lastError}`);
      return fallback("error");
    }
  }

  function snapshot({ force = false } = {}) {
    const now = Date.now();
    if (!force && cache && now - cachedAt < ttlMs) return cache;
    cache = load();
    cachedAt = now;
    return cache;
  }

  /** Authority for one domain. Returns "legacy" unless the ledger positively says "vnext". */
  function authorityFor(domain) {
    const state = snapshot();
    return state?.domains?.[String(domain)] === "vnext" ? "vnext" : LEGACY;
  }

  /** True only when vNext is the primary source for that domain. */
  function isVNextPrimary(domain) { return authorityFor(domain) === "vnext"; }

  /** Invalidate immediately — call right after an activation or rollback so the next turn
   *  observes the change instead of waiting out the TTL. */
  function invalidate() { cache = null; cachedAt = 0; }

  function livePlanId() {
    try { repo = repo || store?.attachRepository?.(createAuthorityRepository); return repo?.livePlanId?.() || null; } catch { return null; }
  }

  function status() {
    const state = snapshot();
    return {
      planId: state?.planId || null,
      planStatus: state?.planStatus || null,
      rollbackWindowEndsAt: state?.rollbackWindowEndsAt || null,
      domains: state?.domains || {},
      detail: state?.detail || {},
      degraded: Boolean(state?.degraded),
      reason: state?.reason || null,
      lastError: lastError || null,
      anyVNext: Object.values(state?.domains || {}).some((value) => value === "vnext"),
    };
  }

  return Object.freeze({ authorityFor, invalidate, isVNextPrimary, livePlanId, snapshot, status });
}

module.exports = { LEGACY, createAuthorityResolver };
