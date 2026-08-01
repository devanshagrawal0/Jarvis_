# Wave 16 Evidence Report - Coherent Cache Fabric

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Consistency watermarks containing canonical sequence, working-set sequence, active projection epochs, and policy version.
- Versioned projection epochs with blue-green activation per projector and shard.
- Separate record, working-set, embedding, plan, candidate, context, artifact, negative, and provider namespaces.
- Privacy-separated keyed cache identities containing namespace, scope, policy, generation, and canonicalized request key.
- Encrypted cache payloads and encrypted provider-cache handles.
- Strict, bounded-stale, and live-domain consistency modes.
- Strict rejection when canonical, working-set, projection, or policy watermarks are behind the caller requirement.
- Live-domain bypass for data that must not be answered from cache.
- Exact dependency invalidation through both cache-specific and global dependency indexes.
- Generation-based purge for broad invalidation and policy/index transitions.
- Negative-cache TTL capped at 30 seconds.
- Namespace entry/byte limits with size- and recompute-cost-aware eviction.
- In-flight leases for stampede suppression and safe lease takeover after expiry.
- Hit, miss, stale-reject, put, prewarm, eviction, invalidation, purge, and lease-wait telemetry without payload content.
- Provider-handle lifecycle with encrypted storage and payload shredding on deletion.

## Verified

- A strict hit succeeds at the captured watermark and rejects a newer canonical requirement.
- Bounded-stale reads honor the age budget.
- Live-domain reads bypass even a present cache entry.
- A caller cannot cross from owner scope into project scope.
- Exact dependency invalidation makes the entry unreadable and deletes its encrypted payload.
- Generation advance makes every prior-generation entry unreachable.
- Two workers cannot simultaneously acquire the same in-flight key.
- A requested ten-minute negative TTL expires at the enforced 30-second ceiling.
- Provider handle deletion nulls the reference and shreds its encrypted object.
- An injected cache-put crash leaves no entry and no encrypted payload.

## Deliberate boundary

Cache state is never truth. A miss, stale rejection, live-domain bypass, eviction, corruption, or provider-cache loss must fall through to canonical/retrieval lanes. This wave does not connect cache namespaces to the live JARVIS response path.

