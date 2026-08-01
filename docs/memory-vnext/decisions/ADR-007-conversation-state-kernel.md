# ADR-007: Deterministic Branch-Local Conversation State Kernel

- Status: Accepted for Wave 8
- Date: 2026-07-24

The Conversation State Kernel derives typed state from finalized turn-linked deltas. Each delta compare-and-swaps a conversation state sequence and updates only the active branch. Topics, working slots, referents, open loops, commitments/decisions/constraints, focus, and context bindings are typed rows with encrypted values and source-turn links.

Forked branches inherit a point-in-time structural baseline by referencing the same immutable encrypted payloads under new branch-local rows. A child may see its ancestor turns only when inherited state depends on them; a parent never sees child turns. Caller-supplied state IDs cannot update another branch. Merge records lineage but does not silently resolve conflicting state.

Invocation state uses recent finalized turns plus older dependency-selected turns. Unresolved referents remain unresolved. TTL/lease expiry removes derived hot state without turning it into a durable fact. Persisted working-set snapshots are encrypted, checksum-bound, transactionally written, and idempotent per state sequence.
