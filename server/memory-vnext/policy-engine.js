"use strict";

const { createPolicyRepository } = require("./repositories/policy-repository");

const SENSITIVITY = Object.freeze({ public: 0, internal: 1, private: 2, restricted: 3 });

function globMatch(pattern, value) {
  const escaped = String(pattern || "").replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(String(value || ""));
}

function createPolicyEngine({ store, clock = () => new Date(), maxAgentLeaseMs = 24 * 60 * 60 * 1_000 } = {}) {
  const repository = store.attachRepository(createPolicyRepository);

  function deny(request, reasonCode, policyId = null, record = true) {
    const decision = { allowed: false, effect: "deny", reasonCode, policyId };
    if (record) repository.recordDenial({ ...request, reasonCode, policyId });
    return decision;
  }

  function evaluate(input = {}, options = {}) {
    const request = {
      actorId: String(input.actorId || ""),
      capability: String(input.capability || ""),
      scopeId: String(input.scopeId || ""),
      purpose: String(input.purpose || ""),
      sensitivity: String(input.sensitivity || "private"),
      channel: String(input.channel || "local"),
      share: input.share === true,
      correlationId: input.correlationId ? String(input.correlationId) : null,
    };
    if (!request.actorId || !request.capability || !request.scopeId || !request.purpose) return deny(request, "POLICY_CONTEXT_INCOMPLETE", null, options.record !== false);
    if (!(request.sensitivity in SENSITIVITY)) return deny(request, "UNKNOWN_SENSITIVITY", null, options.record !== false);
    const actor = repository.getActor(request.actorId);
    const scope = repository.getScope(request.scopeId);
    if (!actor || actor.status !== "active") return deny(request, "ACTOR_INACTIVE", null, options.record !== false);
    if (!scope || scope.status !== "active") return deny(request, "SCOPE_INACTIVE", null, options.record !== false);

    if (request.actorId === "local-owner") {
      if (!repository.scopeContains("owner:local", request.scopeId)) return deny(request, "OWNER_SCOPE_MISMATCH", null, options.record !== false);
      if (request.channel === "cloud" && SENSITIVITY[request.sensitivity] >= SENSITIVITY.private) return deny(request, "PRIVATE_CLOUD_DENIED", "baseline:cloud", options.record !== false);
      if (request.share && SENSITIVITY[request.sensitivity] >= SENSITIVITY.private) return deny(request, "PRIVATE_SHARE_DENIED", "baseline:share", options.record !== false);
      if (request.channel === "cloud" && request.sensitivity === "internal") return { allowed: false, effect: "ask", reasonCode: "INTERNAL_CLOUD_REQUIRES_APPROVAL", policyId: "baseline:cloud" };
      if (request.share && request.sensitivity === "internal") return { allowed: false, effect: "ask", reasonCode: "INTERNAL_SHARE_REQUIRES_APPROVAL", policyId: "baseline:share" };
      return { allowed: true, effect: "allow", reasonCode: "DIRECT_OWNER_LOCAL", policyId: "baseline:owner" };
    }

    const grants = repository.activeGrants(request.actorId, request.capability);
    const matching = grants.filter((grant) => globMatch(grant.resourcePattern, request.scopeId) && globMatch(grant.purposePattern, request.purpose));
    const explicitDeny = matching.find((grant) => grant.effect === "deny");
    if (explicitDeny) return deny(request, "EXPLICIT_GRANT_DENY", explicitDeny.id, options.record !== false);
    const allow = matching.find((grant) => grant.effect === "allow"
      && SENSITIVITY[request.sensitivity] <= SENSITIVITY[grant.maxSensitivity]
      && (request.channel !== "cloud" || grant.cloudAllowed)
      && (!request.share || grant.shareAllowed));
    if (!allow) return deny(request, "CAPABILITY_LEASE_MISSING", null, options.record !== false);
    if (!repository.scopeContains("owner:local", request.scopeId)) return deny(request, "RESOURCE_OUTSIDE_OWNER_LATTICE", allow.id, options.record !== false);
    return { allowed: true, effect: "allow", reasonCode: "ACTIVE_CAPABILITY_LEASE", policyId: allow.id, expiresAt: allow.expiresAt };
  }

  function issueCapabilityLease(input = {}) {
    if (input.issuedBy !== "local-owner") throw new Error("Only the local owner can issue Wave 5 capability leases.");
    const actor = repository.getActor(input.actorId);
    if (!actor || actor.status !== "active" || !["agent", "service", "device"].includes(actor.actor_type)) throw new Error("Capability lease target must be an active agent, service, or device.");
    const expiresAt = new Date(input.expiresAt);
    const duration = expiresAt.getTime() - clock().getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxAgentLeaseMs) throw new Error("Capability lease expiry exceeds the configured maximum.");
    return repository.issueGrant({ ...input, originType: "agent_lease" });
  }

  function issueCoopGrant(input = {}) {
    if (input.issuedBy !== "local-owner") throw new Error("Only the local owner can issue co-op grants.");
    const actor = repository.getActor(input.actorId);
    const scope = repository.getScope(input.scopeId);
    if (!actor || actor.actor_type !== "collaborator") throw new Error("Co-op grant target must be a collaborator actor.");
    if (!scope || scope.scope_type !== "coop_session") throw new Error("Co-op grant must target a co-op session scope.");
    const expiresAt = new Date(input.expiresAt);
    const duration = expiresAt.getTime() - clock().getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > maxAgentLeaseMs) throw new Error("Co-op grant expiry exceeds the session maximum.");
    return repository.issueGrant({ ...input, resourcePattern: input.scopeId, originType: "coop_session", originId: input.scopeId });
  }

  return Object.freeze({ evaluate, issueCapabilityLease, issueCoopGrant, repository });
}

module.exports = { SENSITIVITY, createPolicyEngine, globMatch };
