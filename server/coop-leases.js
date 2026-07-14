// Synapse (Co-Op) W3 — capability leases for a remote guest. Built on ECLIPSE's lease algebra
// (server/eclipse/capabilities/lease.js): a guest lease is a SIGNED, SCOPED, TIME-BOXED,
// non-delegable, non-side-effecting grant, narrowed from a session root so it can never widen its
// own authority (narrow() only intersects). Revoked on session end / kick.

const { narrow, sign, verify, revoke, matches, LeaseError } = require("./eclipse/capabilities/lease");

// Co-op scope vocabulary — what a guest may do inside ONE session. Note there is deliberately no
// "apply" / "fs.write" scope: applying a patch to the host's disk is host-authority-only (§1.4).
const COOP_SCOPES = [
  "coop.chat", "coop.task.write", "coop.patch.propose",
  "coop.source.readtree", "coop.source.readfile", "coop.bridge.msg",
  "coop.memory.packet", "coop.skill.offer", "coop.call.join",
  "coop.cursor.share", "coop.canvas.write",
];
// What an approved guest gets by default (everything a collaborator needs; still no apply).
const DEFAULT_GUEST_SCOPES = COOP_SCOPES.slice();

const HOUR = 3600 * 1000;

// A session's authority ceiling. mayDelegate so it can be narrowed to the guest; scoped to this
// session's glob so a lease can never reference another session's resources.
function coopRoot(sessionId, ttlMs) {
  return sign({
    schemaVersion: "coop.lease.v1",
    leaseId: `coop-root-${sessionId}`,
    missionId: `coop:${sessionId}`,
    sessionId: `coop-root:${sessionId}`,
    scopes: COOP_SCOPES.slice(),
    resourceGlobs: [`coop:session/${sessionId}/*`],
    maxCalls: {}, budgetTokens: 0, maxCostUsd: 0,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    mayDelegate: true, sideEffecting: false, depth: 0, dropped: [],
  });
}

// Mint the guest's root lease at approval. Narrows the session root → guest-scoped, non-delegable,
// non-side-effecting, expiring at session end or `ttlMs`, whichever is first.
function mintGuestLease(sessionId, { grantedScopes, ttlMs = 4 * HOUR } = {}) {
  const root = coopRoot(sessionId, ttlMs);
  const scopes = (grantedScopes && grantedScopes.length ? grantedScopes : DEFAULT_GUEST_SCOPES)
    .filter((s) => COOP_SCOPES.includes(s));
  return narrow(root, {
    sessionId: `coop-guest:${sessionId}`,
    scopes,
    resourceGlobs: [`coop:session/${sessionId}/*`],
    sideEffecting: false,
    mayDelegate: false,
    ttlMs,
  });
}

// True only if the lease is intact + live AND grants `scope` (and covers `resource`, if given).
function leaseAllows(lease, scope, resource) {
  try { verify(lease); } catch { return false; }
  if (!Array.isArray(lease.scopes) || !lease.scopes.includes(scope)) return false;
  if (resource && !(lease.resourceGlobs || []).some((g) => matches(g, resource))) return false;
  return true;
}

function revokeLease(lease) { return lease ? revoke(lease) : lease; }

module.exports = { COOP_SCOPES, DEFAULT_GUEST_SCOPES, mintGuestLease, leaseAllows, revokeLease, LeaseError };
