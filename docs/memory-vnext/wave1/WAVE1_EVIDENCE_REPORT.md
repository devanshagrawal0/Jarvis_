# Memory vNext Wave 1 — Evidence and Exit Report

**Wave:** Freeze, baseline, and replay corpus  
**Status:** Complete  
**Runtime behavior change:** None  
**External provider/API calls made by Wave 1:** Zero  
**Live database writes made by Wave 1:** Zero

## Preservation result

- Seventeen declared live/legacy SQLite stores were backed up using SQLite's online backup API.
- All seventeen closed snapshot databases passed `PRAGMA quick_check`.
- Source database size represented: 927.31 MiB.
- Live WAL observed during capture: 160.46 MiB.
- The authoritative snapshot directory is recorded in `database-inventory.json` and currently contains exactly seventeen base database files with no WAL/SHM sidecars.
- Every snapshot SHA-256 was recomputed after capture with zero mismatches.
- Snapshot files are outside the repository and OneDrive under `%LOCALAPPDATA%\Jarvis\memory-vNext\wave1-snapshots`.

`database-inventory.json` is the machine-readable manifest containing store purpose/owner, source sizes, WAL sizes, SQLite version, integrity result, table/column structure, row counts, foreign-key/index counts, snapshot file, and SHA-256. It contains no row values.

## Important data protected

- 175 active records in the dormant root personal store plus its events/entities/terms.
- Neural Vault/MemoryOS structures, including short and long memories, profile, continuity, referents, episodes, projects, artifacts, skills, permissions, agents, files, mesh/co-op and maintenance history.
- Typed user-context structures and populated identity/profile/location/preferences.
- 15,898 missions and 272,776 mission events.
- PC graph, skills/runs, HELIX, APEX/Oracle, Eclipse/checkpoints, co-op, arbiter and archived command/habit stores.
- Existing vector projection captured for rollback evidence but explicitly classified for rebuild, not truth import.

## Current implementation risks proven by mapping

1. The active server constructs `memoryStore`/`memoryExtractor`, then constructs a second pair after Neural Vault is available without closing the first store connection.
2. One chat turn can traverse deterministic short-memory ingestion, five-turn Gemini extraction, a shadow bridge into long memory, Neural Vault turn ingestion and procedural correction logic.
3. `rememberedText`, agent runtime, Neural Vault context packs and vector recall can independently retrieve overlapping meaning.
4. The fixed five-turn extractor is not a semantic boundary and direct failures are largely swallowed.
5. The vector module makes direct Gemini embedding calls outside the main provider/cost gateway and can initiate up to sixty startup backfill requests.
6. Several Gemini REST paths place an API key in a URL query parameter; URLs must be redacted and vNext should prefer the supported API-key header.
7. Tests that spawn the server can inherit the production environment/secret store unless explicit no-network/provider-stub isolation is introduced.
8. Memory manager and decay engines mutate/merge/archive active Neural Vault state on startup and intervals, so migration must use closed snapshots and a controlled final delta/cutover.
9. The same Neural Vault physical DB contains many logical authorities with very few declared foreign keys; one file is not the same as one canonical model.
10. Domain stores must remain domain-owned; removing them as if they were duplicate personal memory would destroy HELIX/APEX/Eclipse/Mesh state.

## Code and authority map

- 446 source files were scanned structurally.
- Only file paths, line numbers, categories and environment-variable names were recorded; no source snippets or secret values were emitted by the scanner.
- The machine-readable map is `memory-code-map.json`.
- The human-reviewed authority/writer/decommission analysis is `CURRENT_AUTHORITY_AND_WRITER_MAP.md`.
- The table/store migration rules are `MIGRATION_AND_DECOMMISSION_REGISTRY.md`.

## Credential and API safety

- `.env` and secret values were not read, copied, printed or included in snapshots/reports/fixtures.
- Browser-profile databases were explicitly excluded.
- Environment/API variable names were cataloged by name only so future adapters know which secret references exist.
- Credential-looking patterns were scanned across Wave 1 reports/fixtures; no matches were found.
- API metadata will migrate as references/scopes/health only, never raw values.

## Baseline and replay corpus

The initial sanitized `JarvisMemoryBench` fixture contains thirty cases across:

- conversation continuity, branches, referents, open loops and restart;
- identity, seeded-value safety, contextual preference and protected directives;
- correction, temporal truth, scope and capability denial;
- forget closure and secret boundaries;
- retrieval routing, live-domain freshness and mid-task retrieval;
- cache scope/invalidation/negative entries and consistency watermarks;
- duplicate/lost-lease worker behavior;
- artifacts, HELIX manifests and procedure-promotion safety.

## Verification executed

| Verification | Result | Provider/network use |
|---|---|---|
| Audit tool syntax check | Pass | None |
| Wave 1 benchmark fixture structure/security test | 1/1 pass | None |
| Existing Neural Vault backend suite | 8/8 pass in temporary runtime | None |
| Existing personality/memory backend suite | 5/5 pass in temporary runtime | None |
| Existing governance master check | Pass in temporary runtime | None |
| Snapshot integrity | 17/17 `quick_check` pass | None |
| Snapshot SHA-256 recheck | 17/17 match | None |
| Snapshot sidecar check | 0 WAL/SHM in authoritative snapshot | None |
| Credential-pattern scan of Wave 1 artifacts | No matches | None |

These legacy tests demonstrate current intended behavior; they do not negate the architectural flaws above. The new golden cases become failing behavioral targets as Wave 2 onward introduces vNext contracts.

## Superseded preliminary capture

A preliminary verified snapshot was created at `C:\Users\devan\AppData\Local\Jarvis\memory-vNext\wave1-snapshots\2026-07-23T13-40-14-029Z` before the audit tool was improved to remove verification-created empty WAL/SHM sidecars. It is not the authoritative restore source and is tracked for retention-controlled cleanup. It was not deleted automatically because it contains a complete personal-data backup and destructive cleanup requires an explicit, audited retention action.

## Legacy decommission decision

No old cognitive database or writer was deleted/disabled in Wave 1. The approved sequence is:

```text
snapshot and hash
→ map every authority/writer
→ import into candidate/staging space
→ reconcile important data and exclusions
→ shadow reads and replay tests
→ atomically disable legacy personal-memory writers
→ switch all readers to vNext
→ archive old personal stores read-only
→ owner-approved destruction after rollback/retention window
```

This is the mechanism that prevents two competing memories without sacrificing information. HELIX/APEX/Eclipse/Mesh remain domain databases and will publish manifests rather than becoming global memory authorities.

## Wave 1 exit gate

**Passed.** A restorable, checksummed audit package exists; schemas/counts/WAL/runtime behavior and writer paths are mapped; a sanitized replay corpus exists; migration/decommission rules are explicit; secrets were excluded; and runtime behavior did not change.

Wave 2 may now implement the logical Memory Service boundary and compatibility command facade. It must not create a second production writer.
