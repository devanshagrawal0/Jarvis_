# Waves 6–8 Combined Bug and Test Report

Date: 2026-07-24  
Batch result: Complete

## Bugs found and corrected

1. Equal-timestamp turns were ordered by random UUID. Ordering now uses client sequence with timestamp/ID fallback.
2. Stream chunk content could be inserted before the chunk row failed. Encrypted chunk, chunk row, status transition, and chunk event now share one transaction.
3. Interruptions changed turn status without an immutable event. `turn.interrupted` is now journaled.
4. Observer callback exceptions could escape health collection. Subscribers are isolated.
5. Telemetry labels could accept arbitrary prose. They now require bounded identifier syntax.
6. Caller-supplied referent/state-item/context-binding IDs could target another branch. Ownership is checked before upsert.
7. Persisting a snapshot used separate encrypted-object and snapshot writes. They now commit atomically and replay without orphan objects.
8. Forked branches started with no structural state. Active parent topics, slots, referents, loops, focus, state items, and context bindings are inherited as branch-local references.
9. Strict branch filtering removed legitimate ancestor dependency turns. Snapshot lineage now permits ancestors only, never child/sibling turns.
10. Merge could target itself or an unavailable branch. Both cases now fail closed.

## Gate result

- Waves 6–8 focused tests: 11/11 passed.
- Cumulative Waves 1–8 tests and legacy regressions: 56/56 passed.
- Memory boundary guard: passed.
- New-module and `server.js` syntax checks: passed.
- Isolated Memory Command Center strict TypeScript check: passed.
- Repository-wide TypeScript check: blocked by four unrelated active HELIX type/declaration errors; no HELIX file was modified.
- Credential-pattern scan: no matches.
- Default production vNext database: absent.
- Network/provider calls: 0.
- Live legacy authority changes: 0.
