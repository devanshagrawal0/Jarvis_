# ADR-029: Legacy Import Is Staged, Reversible, and Owner-Reviewed

- Status: Accepted for Wave 30
- Date: 2026-07-26

Legacy memory is imported only from verified closed SQLite snapshots whose path is inside an explicit snapshot root and whose SHA-256 matches the frozen inventory. The protected storage owner exposes bounded table and column reads; callers receive no arbitrary SQL capability and cannot select the live vNext database, WAL, or shared-memory file.

Every observed source row receives exactly one auditable outcome: encrypted candidate or explicit exclusion. FTS tables, vectors, embeddings, debug traces, access logs, telemetry, provider caches, generated fixtures, raw domain feeds, execution logs, old command/habit archives, and secret-bearing rows cannot become memory truth. Domain databases remain domain-owned; vNext stages encrypted pointer manifests rather than copying raw market, research, or agent execution bodies.

Legacy `global` is not trusted as owner-wide authority. Explicit project metadata becomes a project proposal; protected personal stores become restricted owner proposals; ambiguous rows enter `unscoped-review`; generated/debug rows are rejected. Protected seeds, procedures, ambiguous scopes, conflicts, and domain manifests require direct-owner review.

Stable identity and exact normalized hashes may create confirmed reversible equivalence edges. Typed keys with different values create conflicts. Near-text and semantic similarity may only propose a candidate relationship; cosine similarity can never merge records. Import completion requires row-count conservation, zero open conflicts, zero pending review items, encrypted provenance, signed reconciliation, and no canonical vNext mutation.
