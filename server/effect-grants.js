"use strict";

// Authority for an EFFECT, scoped to one owner turn, revoked the moment it stops being justified.
//
// The gate this replaces asked per CALL and keyed off the tool's NAME. Both are wrong, and the
// second one is what got exercised on 2026-08-21: `open_app` sat waiting for approval while the
// same outcome went through `desktop_control`, which was on an exemption list. Authority that
// attaches to a name is defeated by any second route to the same effect.
//
// Asking per call is the other half of the problem, and it is a security bug rather than an
// annoyance. The published guidance is blunt about it: by the fortieth "Allow this?" the owner has
// stopped reading, and there is now a catalogued attack (ATR-2026-00118, Human Approval Fatigue
// Exploitation) whose whole method is to generate rapid repeated approvals so the dangerous one is
// waved through with the rest. A gate that fires constantly protects nothing.
//
// So: the owner approves an EFFECT once, it covers the turn, and it dies at the end of it.
// Modelled on PORTICO's request-grant-invoke lifecycle with epoch-bound handles, narrowed
// deliberately — an epoch here is a single owner turn, never longer. PORTICO's "lingering
// authority" (a capability still exposed after the episode that justified it has closed) cannot
// occur if nothing outlives the turn.
//
// Deliberately in memory only. A grant that survives a restart is lingering authority with extra
// steps.

const { EFFECTS } = require("./tool-effects");

// sessionId -> { epoch, grants: Map<effectKey, {effect, scope, at}>, revokedReason }
const sessions = new Map();

// Effects that are never granted ambiently, at any autonomy level.
//
// An email, a DM, a mesh command or a trade is gone the instant it fires and cannot be taken back.
// These are the prompts worth reading, and they stay per-action precisely so that they remain rare
// enough to still be read. Everything cheap and reversible is what a lease is for.
const NEVER_AMBIENT = new Set([EFFECTS.EGRESS, EFFECTS.DESTRUCTIVE]);

// A grant is a LEASE over a task, not a permit for one turn.
//
// Turn-scoped was the first cut and it was wrong twice over: it made revocation dead code (nothing
// survived into the turn where untrusted content could arrive), and it re-asked on every turn of a
// multi-step task, which is the clicking-becomes-habitual failure the whole design exists to avoid.
//
// A task has no reliable marker in the transcript, and the model claiming "the task is finished"
// cannot be one — planner text authorises nothing. So closure is bound to signals that can be
// observed instead of asserted:
//
//   * untrusted content enters the turn  -> revoked immediately (Rule of Two)
//   * the owner stops working for a while -> idle expiry
//   * enough wall-clock has passed        -> absolute expiry, renewal or not
//
// Using the lease renews the idle clock, so a task in flight keeps its authority while it is
// actually in flight, and a walked-away-from task loses it without anyone deciding anything.
const LEASE_IDLE_MS = 10 * 60 * 1000;   // untouched for this long -> the task is over
const LEASE_MAX_MS = 30 * 60 * 1000;    // hard ceiling; no amount of use extends past this

function stateFor(sessionId) {
  const key = String(sessionId || "");
  if (!key) return null;
  if (!sessions.has(key)) sessions.set(key, { epoch: 0, grants: new Map(), revokedReason: "" });
  return sessions.get(key);
}

// Has this lease run out? Two independent clocks, and either one ends it.
function expired(record, now) {
  if (!record) return true;
  if (now - record.at >= LEASE_MAX_MS) return true;          // ceiling: use cannot extend it
  if (now - record.lastUsedAt >= LEASE_IDLE_MS) return true; // idle: the owner moved on
  return false;
}

// A new owner turn opens a new epoch. It does NOT wipe the ledger — a task spans turns, and that is
// the point of leasing. It drops whatever has expired, so a stale lease can never be found by the
// next lookup rather than being noticed later.
function openEpoch(sessionId, now = Date.now()) {
  const state = stateFor(sessionId);
  if (!state) return 0;
  state.epoch += 1;
  for (const [key, record] of state.grants) if (expired(record, now)) state.grants.delete(key);
  state.revokedReason = "";
  return state.epoch;
}

const keyFor = (effect, scope) => `${effect}${scope || "*"}`;

// The owner approved something. Record the EFFECT it authorises, not the tool that asked.
//
// `scope` narrows the grant where a narrower one is meaningful (an app name, a host). "*" means the
// effect itself was approved for this turn. Returning a handle rather than a boolean keeps the call
// site honest: possession of the handle is the authority, so a later check cannot be satisfied by
// the model simply asserting that approval happened.
function grant({ sessionId, effect, scope = "*", now = Date.now() } = {}) {
  const state = stateFor(sessionId);
  if (!state) return null;
  if (!effect || NEVER_AMBIENT.has(effect)) return null;   // irreversible effects are never leased
  const record = { effect, scope, epoch: state.epoch, at: now, lastUsedAt: now };
  state.grants.set(keyFor(effect, scope), record);
  return { ...record, sessionId: String(sessionId) };
}

// Is this effect authorised right now? Never consults the tool name.
//
// Using a live lease renews its idle clock — that is what keeps a task in flight from re-asking on
// every turn. It cannot push past LEASE_MAX_MS, so renewal buys continuity, never permanence.
function isGranted({ sessionId, effect, scope = "*", now = Date.now() } = {}) {
  const state = stateFor(sessionId);
  if (!state || !effect) return false;
  if (NEVER_AMBIENT.has(effect)) return false;
  for (const key of [keyFor(effect, scope), keyFor(effect, "*")]) {
    const record = state.grants.get(key);
    if (!record) continue;
    if (expired(record, now)) { state.grants.delete(key); continue; }
    record.lastUsedAt = now;
    return true;
  }
  return false;
}

// Untrusted content just entered the turn — the Rule of Two's [A] leg. Drop every effect grant
// immediately, mid-turn, so what is left can look but cannot act.
//
// This replaces `safeBrowserContinuation`, an exemption list that sat under a comment promising
// "anything that can act or leave the machine stays blocked" while listing 24 tools that can act.
// Revocation cannot drift from its own description the way a name list does.
function revokeAll({ sessionId, reason = "untrusted content entered the turn" } = {}) {
  const state = stateFor(sessionId);
  if (!state) return 0;
  const dropped = state.grants.size;
  state.grants.clear();
  state.revokedReason = reason;
  return dropped;
}

function statusFor(sessionId) {
  const state = stateFor(sessionId);
  if (!state) return { epoch: 0, grants: [], revokedReason: "" };
  return {
    epoch: state.epoch,
    grants: [...state.grants.values()].map((item) => ({ effect: item.effect, scope: item.scope })),
    revokedReason: state.revokedReason,
  };
}

// Test seam. Nothing in the running server should need this.
function _reset() { sessions.clear(); }

module.exports = { NEVER_AMBIENT, LEASE_IDLE_MS, LEASE_MAX_MS, openEpoch, grant, isGranted, revokeAll, statusFor, _reset };
