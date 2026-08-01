# Waves 30-32 Combined Bug and Test Report

Date: 2026-07-26  
Batch result: Construction complete; production activation gated

## Bugs and risks found and corrected

1. Opening snapshots from ordinary repositories would violate the one-driver-owner boundary. Closed legacy inspection now lives behind the protected core store and exposes only bounded table/column reads.
2. A general snapshot reader could inspect the live vNext database or loose WAL/SHM files. Path validation denies those names and requires the resolved file to remain under an approved snapshot root.
3. Treating every legacy database row as memory would promote FTS projections, vectors, 5,276 debug traces, 56,700 access-log rows, provider metadata, execution logs, and raw domain feeds. Explicit adapter exclusions now preserve them only as external/archive evidence.
4. Trusting legacy `global` would flatten scope again. Ambiguous rows are `unscoped-review`; protected stores are restricted owner candidates; explicit projects retain project proposals.
5. Using broad categories as typed keys would create false conflicts. Typed conflict logic now requires a real key, predicate, or kind/name identity.
6. Rejected/generated rows could have appeared in a scope-review batch and been promoted accidentally. Review selection now excludes already rejected candidates.
7. Similarity-only dedupe could erase meaningful contradictory values. Exact relationships are reversible; near similarity is proposal-only; typed-value differences create owner-resolved conflicts.
8. A pre-soak gate evaluation originally risked becoming a terminal failed record. Gate evaluation is now re-runnable and remains `evaluating` until it genuinely passes.
9. Archiving any valid SQLite file could falsely satisfy cutover. Archives must match a source key and SHA-256 from the reconciled import, and completion requires every distinct imported snapshot.
10. Rolling back a foundational domain while downstream domains remained vNext would create mixed-authority incoherence. Rollback now cascades to every active downstream domain while preserving replay exports.

## Gate results

- Waves 30-32 focused tests: 15/15 passed.
- Cumulative Memory vNext plus legacy personality-memory and Neural Vault: 152/152 passed.
- Memory repository-boundary guard: passed.
- Schema 27 -> 30: verified pre-migration backup; all 30 migrations recorded; all application tables STRICT.
- Injected Wave 32 migration crash: rolled back to schema 29 with no partial cutover table.
- TypeScript `--noEmit`: passed.
- Production Vite build: passed; 3,319 modules transformed.
- Frozen production snapshot preflight: 17/17 hashes matched, 17/17 `quick_check` passed, 260 tables inspected.
- Production vNext database: absent.
- Production vNext writer lock: absent.
- Legacy authority changes: 0.
- Provider/Gemini/network calls made by Waves 30-32: 0.
- Full repository backend suite: 258 passed, 1 skipped, 1 unrelated existing failure in `latency-reliability.test.js` where a mocked fresh-information answer was not replaced by the expected unverified wording. The isolated failure does not import or exercise Memory vNext.

## Remaining operational gates

1. Create the production vNext core only during an approved migration window.
2. Execute the declared source/table import from the 17 frozen snapshots.
3. Complete owner review and obtain a passing signed reconciliation receipt.
4. Run the real shadow soak with representative conversation, correction, deletion, room, privacy, latency, and restart cases.
5. Verify backup/restore and all four rollback rehearsals against the production candidate.
6. Activate one domain at a time with canaries; retain fallback and archives.
7. Complete all owner-acceptance cases before signing the model-plan handoff.
