# Waves 9-11 Combined Bug and Test Report

Date: 2026-07-24  
Batch result: Complete in isolated implementation/test mode

## Bugs found and corrected during the gate

1. Equal-timestamp task steps initially sorted by random UUID. A protected `step_order` is now stored and uniquely constrained per task.
2. A tool idempotency key could otherwise hide argument drift. Reuse now requires the same task and keyed argument hash.
3. External tool execution could otherwise be separated from approval truth. Start now requires an approved, unexpired approval row.
4. A checkpoint could otherwise expose a reusable plaintext resume secret. Only the domain-separated keyed hash is stored.
5. Semantic ambiguity could otherwise force a model call on every turn. Deterministic thresholds own clear cases; only the narrow ambiguous band can use an injected local classifier.
6. Topic return could otherwise flatten two separated sessions. A new segment records a reversible link to the prior same-topic segment.
7. Evidence locators could otherwise claim precision with only a page number. Modality-specific minimum coordinates now fail closed.
8. Capture/evidence APIs were append-only but direct SQL could still mutate rows. Database triggers now reject update and delete.
9. Profiles could otherwise look sourced while some candidates had no evidence. Missing coverage must be rejected or explicitly listed as an uncovered failure.
10. Entity deduplication could otherwise destroy the duplicate identity. Merge events retain both rows and reverse cleanly.

## Gate result

- Waves 9-11 focused tests: 9/9 passed.
- Cumulative Waves 1-11 plus Neural Vault and personality-memory regressions: 65/65 passed.
- Migration 6 -> 9: verified backup, preserved encrypted fixture, all migrations present, all application tables STRICT.
- Injected Wave 11 migration crash: rolled back to schema 8 and recovered to schema 9.
- Transaction faults: checkpoint, tool receipt, segment, capture, entity merge, and migration all left no partial state.
- Memory boundary guard: passed.
- New-module syntax and export checks: passed.
- Credential-pattern scan: no matches.
- Default production vNext database: absent.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Live legacy authority changes: 0.

## Deliberate non-activation

These services are exported for isolated tests and later composition, but they are not connected to the live request path. The legacy store is still the sole live authority. Old memory deletion, dual writes, import, shadow reads, provider embeddings, and cutover remain prohibited until their later gates.

