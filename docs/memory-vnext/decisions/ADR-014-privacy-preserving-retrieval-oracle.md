# ADR-014: Exact-First, Privacy-Preserving Lexical Retrieval

- Status: Accepted for Wave 15
- Date: 2026-07-25

Exact identity is a separate retrieval lane and always precedes fuzzy similarity. Paths, IDs, names, quotes, tickers, predicates, and error strings are keyed hashes, while FTS contains keyed word and trigram tokens rather than plaintext. Source content, locators, and full queries remain encrypted.

Every candidate is constrained by active projection, authorized scope, status, and valid time before it can be returned. Blue-green activation is coverage-gated. This design sacrifices ordinary SQLite index inspection and linguistic stemming in exchange for keeping private lexical material out of the database while retaining deterministic local retrieval.

