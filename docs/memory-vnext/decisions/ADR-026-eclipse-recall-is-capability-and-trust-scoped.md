# ADR-026: Eclipse Recall Is Capability- and Trust-Scoped

- Status: Accepted for Wave 27
- Date: 2026-07-26

Eclipse publishes mission, branch, node, claim, evidence, artifact, agent, task, operation, and agent-outcome references through the common room-manifest contract. The publication is resumable and versioned, but presence in a manifest does not automatically make an object globally retrievable.

Every reference receives an immutable recall policy with visibility, required capability, optional subject, optional lease, trust zone, and expiry. Owner-wide recall accepts only trusted references. Mission references require the mission subject or an explicit cross-mission capability. Agent-private references require the same agent identity. Quarantined references require an explicit quarantine capability and opt-in. Packages are returned only when every member is visible, preventing package summaries from bypassing reference policy.

Raw reasoning traces, chain of thought, scratchpads, prompts, responses, message arrays, private agent state, and telemetry are not global memory. Verified agent success and failure can link to Wave 24 experience cases, but the link is always `promotable=false`; it is evidence about an agent outcome, not canonical truth or an automatic procedure promotion.
