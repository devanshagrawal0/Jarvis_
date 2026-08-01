# Wave 30 Evidence Report - Import, Dedupe, Scope Reconstruction, and Review

Date: 2026-07-26  
Implementation result: Complete in isolated/test mode  
Production import: Not executed  
Legacy writes: 0  
Paid provider calls: 0

## Delivered

- Schema v28 staging records for runs, sources, candidates, equivalences, conflicts, review batches, review items, and signed reconciliation receipts.
- Approved-root, read-only, closed-snapshot SQLite inspection with SHA-256, `quick_check`, table allowlisting, column allowlisting, bounded pagination, and live-vNext/WAL/SHM denial.
- Encrypted snapshot paths, candidate bodies, provenance, conflict resolution, and manifests. Plaintext is limited to structural hashes, classifications, counts, scope proposals, and state.
- Explicit adapters for legacy memory, MemoryOS, protected personal context, continuity, tasks/procedures, artifact pointers, and HELIX/APEX/Forge/Eclipse/Mesh/co-op domain pointers.
- Hard exclusions for FTS/vector/embedding projections, debug and access telemetry, generated/test records, raw market/news feeds, execution logs, old command/habit archives, and any row bearing secret material.
- Deterministic scope reconstruction and direct-owner review for protected, ambiguous, procedural, conflict, and domain-manifest candidates.
- Reversible stable-ID/exact/typed equivalence; proposed-only near-text matching; typed-value conflict creation and explicit owner resolution.
- Conservation proof: expected = observed = staged + excluded, with zero open conflicts and zero pending review required for reconciliation.

## Verified

- A real disposable closed SQLite snapshot imported in two pages and reconciled 4/4 rows.
- Duplicate content produced a confirmed reversible equivalence without deleting either candidate.
- Ambiguous scope required owner review; generated content stayed excluded and could not enter a review batch.
- Conflicting protected typed values did not merge and could not resolve without direct-owner authority.
- Candidate text and snapshot paths were absent from plaintext SQLite bytes.
- Migration crash and staging crash left no partial schema or candidate rows.

## Activation gate

The frozen production inventory contains 17 verified snapshots and 260 tables. Its files and hashes pass preflight, but no production vNext store or import run was created. Real import requires a source/table policy manifest followed by owner review of protected, ambiguous, conflict, procedure, and domain batches.
