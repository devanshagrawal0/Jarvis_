# Wave 11 Evidence Report - Sources, Evidence, Entities, and Hierarchy

Date: 2026-07-24  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Source identities with scope, trust zone, reliability, access policy, and encrypted canonical locators/titles.
- Append-only capture versions keyed by content hash; immutable capture and evidence triggers prevent update/delete.
- Typed evidence locators for text, PDF, image, audio/video, table, code, and tool receipts.
- Evidence links with stance, entailment, and independent-source grouping.
- Scope-local entities, encrypted canonical names/aliases, keyed lookup hashes, and evidence-linked aliases.
- Reversible entity merge events; duplicates can be restored without reconstructing lost rows.
- Atomic typed assertion candidates that retain their raw semantic-segment reference.
- Owner/project/topic/entity profiles with versioning, parent lineage, ordered candidate membership, source coverage, and explicit uncovered failures.
- End-to-end drill-down from a profile candidate to evidence unit, capture version, and source.

## Verified

- New content becomes capture version 2; version 1 is not overwritten.
- Imprecise PDF locators fail closed; precise page/bounding-box locators drill down exactly.
- A profile with uncovered candidates is rejected unless failures are explicitly recorded.
- Entity alias resolution cannot cross scope boundaries.
- Entity merge and reverse restore the original duplicate.
- Injected capture and merge crashes leave no partial capture/merge or changed entity state.
- Source title and evidence excerpt plaintext do not appear in the checkpointed SQLite file.

