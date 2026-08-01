# Wave 15 Evidence Report - Exact and Lexical Retrieval Oracle

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Versioned blue-green retrieval projections with explicit building, active, retiring, and failed states.
- Coverage-gated activation so an incomplete replacement index cannot become authoritative.
- Typed exact keys for names, paths, IDs, quotes, tickers, error strings, and predicates.
- Exact-first fusion: identifier matches rank ahead of lexical similarity instead of being buried by semantic scores.
- SQLite FTS5/BM25 lexical retrieval with keyed word and trigram tokens.
- No raw source text, exact-key value, path, ticker, or query string in the lexical index.
- Encrypted document payloads and locators; encrypted query bodies; content-free structural traces.
- Mandatory allowed-scope subset checks before retrieval.
- Projection, scope, status, valid-from, and valid-to filtering in both exact and lexical paths.
- Per-run candidate lineage containing channel, rank, structural features, decision, and reason code.
- Dependency edges from canonical sources to retrieval documents.
- Correction/forget propagation that removes FTS rows and exact keys, deletes encrypted content, and marks the document deleted.
- Transactional indexing and activation fault points.

## Verified

- Exact ticker retrieval outranks a simultaneous lexical match.
- A project-scoped document cannot appear in an owner-only query.
- An unauthorized requested scope fails closed.
- Expired valid-time documents do not appear in present-time retrieval.
- Keyed lexical tokens still retrieve the intended document.
- A private fixture phrase is absent from the SQLite database after checkpoint.
- Retrieval traces do not contain the plaintext query.
- Incomplete green projection activation is rejected and the blue projection remains active.
- A failed document-index transaction leaves no document, FTS row, or encrypted payload.
- Correction and owner-forget both purge their registered retrieval copies through the shared dependency graph.

## Deliberate boundary

This is a deterministic local exact/lexical oracle, not the final hybrid retriever. It does not yet perform graph traversal, vector fusion, reranking, context packing, evaluation-driven tuning, or live legacy reads. Those remain later waves.

