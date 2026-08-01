# Waves 24-26 Combined Bug and Test Report

Date: 2026-07-26  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. The first lesson-candidate insert declared one more SQL placeholder than supplied values. The statement was corrected and promotion is covered end to end.
2. Lesson-test runs initially had a uniqueness constraint on candidate plus case-set. That prevented a failed candidate from being retested after the missing condition was corrected. Tests remain immutable, but multiple versioned attempts over the same case set are now permitted.
3. The owner gate first delegated to a generic active-actor lookup, causing a missing actor to emit an untyped error. Missing, inactive, non-owner, and wrong-zone approval attempts now all fail with `OWNER_AUTHORITY_REQUIRED`.
4. Freshness registration initially evaluated state against wall-clock time instead of the injected deterministic clock. Registration and resolution now share the governed clock, making expiry decisions reproducible.
5. Retrieval utility previously trusted a caller-supplied `verified` flag. Schema 22+ now requires a real scope-matched verification receipt and stores its ID transactionally.
6. Room integration risked becoming a second copy of HELIX/APEX data. Pointer-only validation and forbidden raw-body keys now reject source text, prompts/responses, messages, chunks, market data, telemetry, and code bodies at the boundary.
7. A context package could otherwise smuggle references not represented by the parent publication. Package members and lineage endpoints must now match a declared kind/ID/version tuple in the same manifest.
8. Concurrent or reordered room publications could silently replace newer context. Monotonic sequence, exact replay, conflict, current, and superseded states are explicit.
9. APEX snapshots could be interpreted as current without evidence of recency. Immutable freshness contracts now distinguish fresh, stale, and unknown and force live routing unless a fresh snapshot is explicitly permitted.
10. Forge writes span a common room manifest plus Forge-specific projections. Nested transaction fault tests prove both layers roll back as one unit.

## Gate result

- Waves 24-26 focused tests: 12/12 passed.
- Cumulative Memory vNext tests: 111/111 passed.
- Cumulative Memory vNext plus legacy personality-memory and Neural Vault regressions: 124/124 passed.
- All 60 JavaScript files under `server/memory-vnext`: syntax check passed.
- Migration schema 21 -> 24: verified backup, all application tables STRICT, all 24 migrations recorded.
- Injected Wave 26 migration crash: rolled back to schema 23 with no partial APEX tables and recovered to schema 24.
- Verification, case coverage, lesson tests, owner gates, environment matching, adapter, retrieval-utility, and regression-suspension tests: passed.
- HELIX manifest, package, exclusion, lineage, sequence, replay, scope, privacy, and rollback tests: passed.
- APEX raw-data ownership, Forge lineage, freshness, validation, scope, and rollback tests: passed.
- Memory repository-boundary guard: passed.
- Production vNext database: absent.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Live legacy authority changes: 0.

## Deliberate non-activation

All new services are isolated construction APIs exercised against disposable encrypted stores. They are not wired into live prompts, HELIX, APEX, Forge, Eclipse, Device Mesh, external models, file watchers, or production storage. Legacy memory remains the sole live authority; there is no dual read/write, import, shadow read, or cutover.
