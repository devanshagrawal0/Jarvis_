# ADR-015: The Coherent Cache Fabric Is Never Truth

- Status: Accepted for Wave 16
- Date: 2026-07-25

A cache result is usable only when scope, policy, generation, expiry, and requested consistency watermark agree. Strict reads require canonical, working-set, projection, and policy coherence; bounded-stale reads require an explicit age allowance; live-domain requests bypass cache entirely.

Exact dependency invalidation is primary, generation advance is the broad fallback, and encrypted payload deletion accompanies invalidation, eviction, expiry, and purge. Any cache failure degrades to canonical/retrieval computation rather than becoming an answer or an availability dependency.

