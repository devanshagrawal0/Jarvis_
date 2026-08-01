# Wave 8 Evidence Report — Conversation State Kernel

Date: 2026-07-24  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Compare-and-swap conversation state heads.
- Branch-local topic stack and inherited fork baseline.
- TTL working slots and leased focus/context bindings.
- Resolved/unresolved referents with encrypted candidate sets.
- Open questions, promises, decisions, approvals, commitments, and typed state items.
- Branch fork, suspend, resume, and explicit merge lineage.
- Dependency-selected verbatim tail plus recent active-branch turns.
- Encrypted idempotent working-set snapshots with source coverage.

## Verified

- Old dependency turn remains available even with a one-turn recency limit.
- Ambiguous referent remains unresolved.
- Expired slot/focus/context data leaves the hot snapshot.
- State-sequence conflict rejects a stale delta.
- Injected delta crash leaves sequence and state unchanged.
- Caller-supplied IDs cannot mutate another branch.
- Child state inherits parent context; parent snapshots never contain child turns/topics.
- Same persisted state sequence produces the same checksum and no orphan encrypted object.
- Turn ordering uses client sequence, not random UUID, when timestamps tie.
- Wave 8 migration crash preserves the Wave 7 schema and recovers cleanly.
