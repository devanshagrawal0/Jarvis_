# Waves 15-17 Combined Bug and Test Report

Date: 2026-07-25  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. The first cache-entry INSERT contained one more value than columns, making every new cache write fail. The placeholder list now exactly matches the 17-column schema.
2. Exact-only embedding requests initially used a unique idempotency key without checking for an existing skipped request. Replays now return the prior skip result instead of raising a uniqueness error.
3. Embedding preprocessing initially coerced objects to `[object Object]`, collapsing unrelated structured content. Non-string content now uses normalized JSON text before hashing.
4. Wave 14 truth maintenance knew only the generic derived-copy table. New FTS, cache, and vector projections could therefore survive a canonical correction or forget. The recursive invalidator now has typed purge handlers for all three new projection kinds.
5. Retrieval invalidation could have left exact keys and FTS tokens after deleting only encrypted document content. It now removes both index surfaces within the same transaction.
6. Vector invalidation could have left deleted vectors reachable from active index membership. Membership rows are deleted before the encrypted vector is shredded.
7. Forget closure originally rejected the three new projection types as unsupported dependents. They are now explicit non-canonical projection dependents and participate in verification counts.
8. Forget verification originally checked only generic derived copies. It now fails if a retrieval document, cache entry, or embedding record remains active.
9. A raw lexical FTS index would have leaked private search text despite encrypted source records. Wave 15 stores keyed word/trigram tokens and hashes typed exact keys instead.
10. A cache key lacking scope, policy, or generation would enable cross-context reuse. All three are cryptographically bound into the cache identity.
11. Semantic content could have been unnecessarily sent to an embedding provider. Exact-only policy, privacy routing, adapter absence, budget, and circuit states all stop the call before provider execution.
12. A replacement lexical/vector index could activate with partial coverage. Both activation paths now enforce their selected-record coverage gates transactionally.

## Gate result

- Waves 15-17 focused tests: 11/11 passed.
- Cumulative Memory vNext tests: 75/75 passed.
- Cumulative Memory vNext plus legacy JARVIS personality-memory and Neural Vault regressions: 88/88 passed.
- Migration 12 -> 15: verified backup, preserved encrypted fixture, all 15 migrations recorded, all application tables STRICT.
- Injected Wave 17 migration crash: rolled back to schema 14 with no partial vector tables, then recovered to schema 15.
- Transaction faults: lexical indexing, cache put, vector completion, and index activation leave no partial state.
- Scope/privacy/temporal retrieval tests: passed.
- Cache watermark, expiry, invalidation, generation, stampede, and provider-handle tests: passed.
- Embedding routing, idempotency, dimensionality, mixed-space, coverage, fallback, and encrypted-at-rest tests: passed.
- Correction and owner-forget propagation across FTS, cache, and vectors: passed.
- Memory boundary guard: passed.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Default production vNext database: not provisioned.
- Live legacy authority changes: 0.

## Deliberate non-activation

The new services are exported for isolated construction and testing only. They are not wired into the live response/write path. Legacy memory remains the sole live authority; no dual write, shadow read, import, destructive legacy deletion, provider embedding, or production cache/index activation occurred.

