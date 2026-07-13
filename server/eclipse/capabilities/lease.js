// ECLIPSE capability leases — the authority algebra. A lease is a signed, scoped, time-boxed
// grant. Child leases are MONOTONICALLY NARROWING: a child can only ever be a subset of its
// parent (scopes ∩, globs ∩, min budget, min expiry, depth+1). This is the mechanism behind
// "prompts are never the security boundary" — an agent cannot widen its own authority because
// narrow() refuses to grant anything the parent lacks. depth ≤ 2 (Workers can't spawn Workers).
const { id, nowIso, hashOf } = require("../contracts/validate");

const MAX_DEPTH = 2;

// Scope vocabulary (v1). Tools declare the scope they need; leases grant scopes.
const SCOPES = ["web.search", "web.fetch", "memory.read", "memory.write", "code.exec", "fs.read", "fs.write", "artifact.write", "task_os.control", "spawn"];

// A root lease derived from the mission's constraints — broad READ authority, no external writes.
function issueRootLease(mission, sessionId, { scopes, ttlMs = 30 * 60 * 1000 } = {}) {
  const c = mission.constraints || {};
  const lease = {
    schemaVersion: "eclipse.lease.v1",
    leaseId: id("lease"),
    missionId: mission.missionId,
    sessionId: sessionId || "root",
    // Root = the mission's authority CEILING (union of what any agent may need). Write scopes are
    // still gated per-lease by sideEffecting + HITL at the gateway — granting the scope here only
    // makes it *narrowable* to a specific agent, not usable by root itself (root.sideEffecting=false).
    scopes: scopes || ["web.search", "web.fetch", "memory.read", "memory.write", "code.exec", "artifact.write", "task_os.control", "spawn"],
    resourceGlobs: ["https://*", "http://*", "memory:*", "sandbox:*", "artifacts:*"],
    maxCalls: {},
    budgetTokens: c.maxTokens || 400000,
    maxCostUsd: c.maxCostUsd || 1.0,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    mayDelegate: true,
    sideEffecting: false,
    depth: 0,
    dropped: [],
  };
  return sign(lease);
}

const inter = (a, b) => (a || []).filter((x) => (b || []).includes(x));

// narrow(parent, request) → a child lease ⊆ parent, or throws LeaseError if it can't be issued.
// request: { sessionId, scopes, resourceGlobs?, maxCostUsd?, budgetTokens?, mayDelegate?, sideEffecting?, ttlMs? }
function narrow(parent, request = {}) {
  verify(parent); // parent must be intact + live
  const newDepth = (parent.depth || 0) + 1;
  if (newDepth > MAX_DEPTH) throw new LeaseError(`delegation depth ${newDepth} exceeds MAX_DEPTH ${MAX_DEPTH}`, "DEPTH");
  if (!parent.mayDelegate) throw new LeaseError("parent lease may not delegate", "NO_DELEGATE");

  const grantedScopes = inter(request.scopes || [], parent.scopes);
  const droppedScopes = (request.scopes || []).filter((s) => !parent.scopes.includes(s));
  // Globs narrow to those the parent already covers; no request → inherit parent's set unchanged.
  const grantedGlobs = request.resourceGlobs ? intersectGlobs(request.resourceGlobs, parent.resourceGlobs) : parent.resourceGlobs;

  const child = {
    schemaVersion: "eclipse.lease.v1",
    leaseId: id("lease"),
    missionId: parent.missionId,
    sessionId: request.sessionId || id("sess"),
    parentLeaseId: parent.leaseId,
    scopes: grantedScopes,
    resourceGlobs: grantedGlobs,
    maxCalls: request.maxCalls || {},
    budgetTokens: Math.min(request.budgetTokens ?? parent.budgetTokens, parent.budgetTokens),
    maxCostUsd: Math.min(request.maxCostUsd ?? parent.maxCostUsd, parent.maxCostUsd),
    expiresAt: minIso(request.ttlMs ? new Date(Date.now() + request.ttlMs).toISOString() : parent.expiresAt, parent.expiresAt),
    mayDelegate: !!(request.mayDelegate && parent.mayDelegate) && newDepth < MAX_DEPTH,
    sideEffecting: !!request.sideEffecting && grantedScopes.some((s) => /write|control/.test(s)),
    depth: newDepth,
    dropped: droppedScopes,
  };
  return sign(child);
}

// Integrity tag over canonical content (NOT a secret-keyed auth signature — no server secret is
// available to Eclipse; this makes tampering detectable, which is what verify() relies on).
function sign(lease) {
  const { signature, ...rest } = lease;
  return { ...rest, signature: hashOf(canonical(rest)) };
}
function verify(lease) {
  if (!lease || !lease.signature) throw new LeaseError("lease is unsigned", "UNSIGNED");
  const { signature, ...rest } = lease;
  if (hashOf(canonical(rest)) !== signature) throw new LeaseError("lease signature mismatch (tampered)", "TAMPERED");
  if (lease.revokedAt) throw new LeaseError("lease revoked", "REVOKED");
  if (new Date(lease.expiresAt).getTime() < Date.now()) throw new LeaseError("lease expired", "EXPIRED");
  return true;
}
function revoke(lease) { return sign({ ...unsign(lease), revokedAt: nowIso() }); }
function unsign(lease) { const { signature, ...rest } = lease; return rest; }

// Canonical JSON (sorted keys, signature excluded) so the hash is stable.
function canonical(obj) {
  const seen = (o) => {
    if (Array.isArray(o)) return o.map(seen);
    if (o && typeof o === "object") return Object.keys(o).sort().reduce((a, k) => (a[k] = seen(o[k]), a), {});
    return o;
  };
  return JSON.stringify(seen(obj));
}
function minIso(a, b) { return new Date(a).getTime() <= new Date(b).getTime() ? a : b; }
// Narrowing of resource globs: keep child globs that are covered by (⊆) some parent glob.
function intersectGlobs(childGlobs, parentGlobs) {
  return (childGlobs || []).filter((cg) => (parentGlobs || []).some((pg) => globCovers(pg, cg)));
}
function globToRegex(glob) { return new RegExp("^" + String(glob).split("*").map(escapeRe).join(".*") + "$"); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function globCovers(parentGlob, childGlobOrResource) {
  // parent covers child if the parent glob matches the child's literal prefix (approx: match the
  // child with '*' removed, or the child glob's non-wildcard head).
  const probe = String(childGlobOrResource).replace(/\*/g, "x");
  return globToRegex(parentGlob).test(probe);
}
function matches(glob, resource) { return globToRegex(glob).test(String(resource)); }

// Return the schema-valid subset (drops internal depth/dropped fields) for persistence/validation.
function toSchema(lease) { const { depth, dropped, ...rest } = lease; return rest; }

class LeaseError extends Error { constructor(msg, code) { super(msg); this.name = "LeaseError"; this.code = "ECLIPSE_LEASE"; this.leaseCode = code; } }

module.exports = { issueRootLease, narrow, sign, verify, revoke, toSchema, matches, globCovers, LeaseError, SCOPES, MAX_DEPTH };
