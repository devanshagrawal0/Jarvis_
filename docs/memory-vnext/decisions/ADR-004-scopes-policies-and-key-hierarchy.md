# ADR-004: Scopes, Policies, Capability Leases, and Key Hierarchy

- Status: Accepted for Wave 5
- Date: 2026-07-23

## Decision

Authorization is evaluated before canonical access. Every operation binds actor, capability, scope, purpose, sensitivity, local/cloud channel, and share intent. Scope containment is explicit and cycle-checked. Non-owner agents, services, devices, and collaborators require matching expiring grants; a deny grant wins over an allow grant.

Baseline privacy policy:

- public owner data may use cloud/share paths;
- internal cloud/share operations require explicit approval;
- private and restricted data are denied cloud/share by default;
- agent and co-op authority is purpose-bound, resource-bound, sensitivity-bounded, and expiring;
- co-op grants target a co-op session scope and expire with their lease;
- denial receipts contain policy metadata, not protected content.

Per-scope data keys are random 256-bit keys wrapped by the DPAPI-protected master key. Rotation transactionally retires the old version and creates the new active version. Retired versions can be cryptographically destroyed by erasing wrapped key material while retaining non-secret audit metadata.
