// ECLIPSE tool gateway — the ONE place a tool call is authorized against a lease. Agents never
// call tools directly; they call mediate(lease, callSpec, fn). If the lease lacks the scope,
// the resource is out of glob range, the call budget is spent, the lease is expired/revoked, or
// a side effect isn't authorized, the call is DENIED before fn runs. This is the enforcement
// that makes leases real — an agent's prompt cannot talk its way past it.
const { verify, matches, LeaseError } = require("./lease");

// Each tool declares the scope it consumes. Unknown tools default-deny.
const TOOL_SCOPE = {
  "web.search": "web.search",
  "web.fetch": "web.fetch",
  "url_context": "web.fetch",
  "memory.retrieve": "memory.read",
  "memory.promote": "memory.write",
  "code.exec": "code.exec",
  "calc.repro": "code.exec",
  "fs.read": "fs.read",
  "fs.write": "fs.write",
  "artifact.write": "artifact.write",
  "citation.verify": "web.fetch",
  "spawn": "spawn",
};
const SIDE_EFFECTING = new Set(["memory.promote", "fs.write", "artifact.write"]);

// Tools reachable through the Jarvis bridge are registered by the caller rather than hard-coded
// here, so this gateway stays a generic enforcement point and does not have to know what the rest
// of the assistant can do. Anything not registered stays default-denied.
function createGateway({ store = null, onDecision = null, extraScopes = null, extraSideEffecting = null } = {}) {
  const counters = new Map(); // `${leaseId}:${tool}` → count
  const scopes = extraScopes ? { ...TOOL_SCOPE, ...extraScopes } : TOOL_SCOPE;
  const sideEffecting = extraSideEffecting ? new Set([...SIDE_EFFECTING, ...extraSideEffecting]) : SIDE_EFFECTING;

  // authorize(lease, {tool, resource}) → { allow, reason, scope }. Pure check; no side effect.
  function authorize(lease, { tool, resource = null } = {}) {
    try { verify(lease); } catch (e) { return deny(`lease invalid: ${e.leaseCode || e.message}`, tool); }
    const scope = scopes[tool];
    if (!scope) return deny(`unknown tool "${tool}" (default-deny)`, tool);
    if (!lease.scopes.includes(scope)) return deny(`lease lacks scope "${scope}" for tool "${tool}"`, tool, scope);
    if (resource != null && !(lease.resourceGlobs || []).some((g) => matches(g, resource))) {
      return deny(`resource "${resource}" not in lease globs`, tool, scope);
    }
    const max = lease.maxCalls && lease.maxCalls[tool];
    if (max != null) {
      const used = counters.get(`${lease.leaseId}:${tool}`) || 0;
      if (used >= max) return deny(`call budget for "${tool}" exhausted (${used}/${max})`, tool, scope);
    }
    if (sideEffecting.has(tool) && !lease.sideEffecting) {
      return deny(`side-effecting tool "${tool}" requires an approved (sideEffecting) lease → HITL`, tool, scope);
    }
    return { allow: true, reason: "ok", scope };
  }

  function deny(reason, tool, scope) { return { allow: false, reason, tool, scope }; }

  // mediate — authorize, then run fn, counting the call. Throws LeaseError on denial (fn never runs).
  async function mediate(lease, callSpec, fn) {
    const decision = authorize(lease, callSpec);
    record(lease, callSpec, decision);
    if (!decision.allow) {
      const e = new LeaseError(`tool call denied: ${decision.reason}`, "DENIED");
      e.tool = callSpec.tool; throw e;
    }
    const key = `${lease.leaseId}:${callSpec.tool}`;
    counters.set(key, (counters.get(key) || 0) + 1);
    return fn ? fn() : undefined;
  }

  function record(lease, callSpec, decision) {
    if (store && store.appendEvent && lease.missionId) {
      store.appendEvent(lease.missionId, decision.allow ? "tool.grant" : "tool.deny", { tool: callSpec.tool, resource: callSpec.resource || null, leaseId: lease.leaseId, reason: decision.reason });
    }
    if (onDecision) onDecision({ lease, callSpec, decision });
  }

  function callCount(leaseId, tool) { return counters.get(`${leaseId}:${tool}`) || 0; }

  // Return the EFFECTIVE tables, not the module defaults: a caller that registered bridge tools
  // must be able to see them, and a test asserting against the defaults while the gateway enforces
  // something wider is a test that cannot fail.
  return { authorize, mediate, callCount, TOOL_SCOPE: scopes, SIDE_EFFECTING: sideEffecting };
}

module.exports = { createGateway, TOOL_SCOPE, SIDE_EFFECTING };
