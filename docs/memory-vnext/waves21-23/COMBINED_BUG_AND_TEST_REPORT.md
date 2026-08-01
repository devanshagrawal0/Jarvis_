# Waves 21-23 Combined Bug and Test Report

Date: 2026-07-26  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. Artifact operation/check encrypted references were initially deleted before their nullable foreign-key columns were cleared. Deletion now nulls every reference inside the same transaction before shredding.
2. Multimodal part and normalized-graph payloads were initially outside the artifact deletion closure. The owner-delete path now removes FTS/exact/relation rows, nulls part/graph payloads, cancels unfinished extraction, and shreds the payloads.
3. Artifact manifest verification initially checked only the signed manifest hash. It now binds artifact ID, version number, blob ID, keyed content address, byte size, and MIME type to the live version/blob row.
4. Artifact content semantics relied on a database constraint. The API now validates the bounded source-copy/mixed/independent contract before persistence.
5. Locator reconciliation accepted a missing locator and could fail during encryption. Reconcile and lookup now require explicit scope/value inputs.
6. Derived artifact versions and parts were absent from the common truth-maintenance projection set. Both now receive stale or destructive invalidation with residue verification.
7. The first part-provenance insert used an unsupported `extracts` dependency relation with `INSERT OR IGNORE`, silently dropping the edge. It now uses the governed `indexes` relation, and correction propagation is regression-tested.
8. Exact page lookup could return a nested region before the page itself because both share a page coordinate. Native part types now receive deterministic exact-score priority.
9. A cross-format equivalence test was masked by a broader shared slide-coordinate hit. The retrieval suite now isolates an exact caption seed and verifies the distinct equivalence channel.
10. Stale artifact versions were initially eligible under a not-deleted query. Retrieval now permits only active/superseded versions of active artifacts and active parts.
11. Audio/video range locators required caller-supplied timecode keys. Range locators now infer an exact start-end timecode key.
12. Extraction runs accepted a caller hash unrelated to the registered artifact. The input hash is now fixed to the registered version manifest and mismatches fail closed.
13. Partial extraction mode could accept more parts than declared. Overproduction now always fails; partial mode only permits bounded under-coverage.
14. Normalized graph encryption occurred just before its insert without a transaction fault boundary. Payload creation and graph persistence now commit or roll back together.
15. Destructive source invalidation could delete the last usable version while leaving the artifact marked active. The logical artifact is now marked stale for explicit regeneration/reconciliation.
16. The frozen replay schema exposed a retired state while enforcing strict corpus immutability. No retirement mutation API was added; frozen corpus content remains immutable by construction.

## Gate result

- Waves 21-23 focused tests: 12/12 passed.
- Cumulative Memory vNext tests: 99/99 passed.
- Cumulative Memory vNext plus legacy personality-memory and Neural Vault regressions: 112/112 passed.
- Migration schema 18 -> 21: verified backup, preserved encrypted fixture, all 21 migrations recorded, all application tables STRICT.
- Injected Wave 23 migration crash: rolled back to schema 20 with no partial multimodal tables and recovered to schema 21.
- Consolidation quarantine, exact replay coverage, privacy/protected-mutation gates, owner approval, immutable corpus, and staging-budget tests: passed.
- Artifact dedupe, scope separation, versioning, locator history, lineage, integrity, correction, deletion, and cryptographic-shredding tests: passed.
- Exact multimodal locator, hashed lexical, cross-format equivalence, normalized graph, privacy, scope, and invalidation tests: passed.
- Proposal, artifact, part, graph, retrieval, and migration transaction-fault tests: passed.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Default production vNext database: not provisioned.
- Live legacy authority changes: 0.

## Deliberate non-activation

The laboratory, artifact registry, and multimodal services are isolated construction APIs and test oracles. They are not connected to live JARVIS prompts, HELIX/APEX workflows, file watchers, external renderers, OCR engines, embeddings, providers, or production storage. Legacy memory remains the sole live authority; there is no dual read/write or cutover.
