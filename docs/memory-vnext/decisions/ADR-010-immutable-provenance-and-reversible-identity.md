# ADR-010: Immutable Provenance and Reversible Identity

- Status: Accepted for Wave 11
- Date: 2026-07-24

Source captures and evidence units are immutable at the database layer. Changed material creates a new capture version. Evidence must carry a modality-specific locator precise enough to revisit the supporting region. Assertions preserve raw-segment references, and profiles preserve ordered candidates, source coverage, and uncovered failures.

Entity names and aliases are encrypted with scope-local keyed lookup hashes. Deduplication records a merge event and marks the duplicate; it never deletes the duplicate. Reversal restores the prior active identity. This keeps provenance and correction possible as the memory graph grows.

