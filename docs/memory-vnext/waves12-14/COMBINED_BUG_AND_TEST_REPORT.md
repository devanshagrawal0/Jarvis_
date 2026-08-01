# Waves 12-14 Combined Bug and Test Report

Date: 2026-07-24  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. Conflict resolution initially created a replacement source-asserted version without carrying its evidence. Revisions now inherit prior evidence unless explicitly replaced.
2. Mutable assertion status could have hidden a losing claim from historical recorded-time queries. Query truth now follows bitemporal version state; resolution creates new recorded versions.
3. Source-asserted truth initially accepted any evidence stance. It now requires at least one supporting evidence unit.
4. Identity initially checked only the assertion predicate. It now requires the encrypted identity value to exactly match current owner-asserted truth.
5. Imported preference callers could request active status. Every non-explicit preference is now forced to candidate state.
6. Non-owner agents could request active goals or authoritative goal transitions. Agent-created goals remain proposed and authoritative transitions require the owner.
7. Correction logic treated an encrypted JSON null as if no replacement had been supplied. Replacement presence now uses the encrypted-object reference.
8. Reusing a previously closed/retracted assertion object could return an inactive assertion. Correction now creates a new recorded version when reactivating prior semantics.
9. Deep dependency edges could remain active after invalidating only the root. Every edge touching the recursive closure is now invalidated/deleted.
10. Forget initially handled only the selected row, allowing linked assertion truth or earlier directive/identity versions to reconstruct the memory. Forget jobs now store expanded linked/dependent targets.
11. Goal and commitment event payloads could retain forgotten private text. Their structural events now allow payload shredding without deleting state history.
12. A migration edit briefly relaxed required ledger/open-loop payload columns while adding nullable personal-event payloads. The schema review restored the original invariants before the gate.
13. Plain structural fields could accept prose/PII. Assertion subjects, predicates, identity predicates, directive keys, and preference domains now require bounded structural identifiers.

## Gate result

- Waves 12-14 focused tests: 12/12 passed.
- Cumulative Waves 1-14 plus Neural Vault and personality-memory regressions: 77/77 passed.
- Migration 9 -> 12: verified backup, preserved encrypted fixture, all migrations present, all application tables STRICT.
- Injected Wave 14 migration crash: rolled back to schema 11 and recovered to schema 12.
- Transaction faults: assertion creation, identity update, correction paths, and forget closure leave no partial state.
- Temporal/conflict golden tests: passed.
- Protected owner-memory tests: passed.
- Transitive deletion and reconstruction-prevention tests: passed.
- Memory boundary guard: passed.
- Syntax and diff-whitespace checks: passed.
- Credential-pattern scan: no matches.
- Default production vNext database: absent.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Live legacy authority changes: 0.

## Deliberate non-activation

The new services remain exported only for isolated construction and tests. They are not connected to the live write/read path. Legacy memory remains the sole live authority; no dual write, import, shadow read, destructive migration, provider embedding, or old-memory deletion occurred.

