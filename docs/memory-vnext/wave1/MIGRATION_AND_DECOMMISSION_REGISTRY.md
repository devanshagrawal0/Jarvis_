# Memory vNext Wave 1 — Migration and Decommission Registry

This registry defines what is preserved, imported, rebuilt, retained as domain truth, archived, or eventually destroyed. It prevents “remove old memory” from becoming accidental loss of personal information, tasks, artifacts, research, or credentials.

## Disposition vocabulary

- **Canonical candidate:** import content and provenance into staging; activate only after policy/reconciliation.
- **Derived candidate:** regenerate or verify before activation.
- **Manifest/pointer:** keep domain data in its owner store; publish meaningful versions and references.
- **Telemetry archive:** retain separately under policy; never inject by default.
- **Rebuild:** discard old index representation after source coverage is proven.
- **Metadata only:** preserve names/scopes/status without secret values or payloads.
- **Do not import:** excluded from cognitive memory.

## Store registry

| Source | Important content | Disposition | Verification before old reader/writer shutdown |
|---|---|---|---|
| `runtime/jarvis-memory.sqlite` | memories, events, entities and terms from a dormant older store | Canonical candidates; terms/entities rebuilt | Content/provenance hash and dedupe comparison against Neural Vault |
| Neural Vault `ms_memories` | short facts, rules, episodes and corrections | Canonical candidates with source/status reconstruction | Every active record classified; corrections checked by subject/predicate/scope |
| Neural Vault `memories` | long memory, summaries and bridge duplicates | Canonical or derived candidates depending on provenance | Bridge duplicates collapsed without losing source lineage |
| Neural Vault continuity/carryover/referents | current conversation heuristics | Derived candidates or expired working state | Only source-supported current state imported; no global default |
| Neural Vault entities/relationships/edges | entity aliases and graph links | Candidate import with reversible merge mapping | All edges retain source memory/evidence or remain untrusted candidates |
| Neural Vault episodes/procedures/skills | experience and learned behavior | Candidate import | Verified outcomes, environment/version and failures attached before promotion |
| Neural Vault projects/artifacts/source files/memory objects/file index | project/file/artifact knowledge | Artifact/manifest import | File/hash availability checked; FTS rebuilt |
| Neural Vault permissions/approvals | permission and review records | Metadata/canonical policy candidates | Owner/source/expiry verified; no implicit grant migration |
| Neural Vault API/integration tables | provider names, env-var names, scopes and health | Metadata only | Assert no raw key/token value exists in exported rows |
| Neural Vault access logs/temp events/governance/maintenance/query logs | operational history | Telemetry archive | Excluded from normal retrieval and assigned retention |
| Neural Vault FTS tables | search postings | Rebuild | Accepted canonical coverage reaches 100% for lexical policy |
| `user-context.sqlite` | identity, profile blocks, preferences, facts, goals, locations and other typed personal data | High-priority reviewed canonical candidates | Seed/default values separated from owner-confirmed facts; sensitive types remain local |
| `memory-vectors.sqlite` | 88 current embeddings | Rebuild; do not import vectors as truth | Canonical source IDs accepted, then blue/green re-embed |
| `runtime/memory/jarvis_memory.sqlite` | debug traces and one conversation state row | Telemetry archive; supported state candidate only | No secret/tool payload leaks; active supported state represented elsewhere |
| `jarvis-missions.sqlite` | mission truth and 272k+ mission events | Current mission/checkpoint import plus telemetry archive | Task state/step/output counts reconcile; side-effect receipts retained |
| `jarvis-skills.sqlite` | skills and run outcomes | Candidate import | Reliability recalculated from run evidence; no automatic activation |
| `jarvis-pc-graph.sqlite` | indexed local nodes/edges/run | Domain manifest/pointers | Paths/hashes checked; no file content uploaded during migration |
| `helix.sqlite` | research projects, sources, evidence, claims, runs and artifacts | Retain domain authority; publish manifests | Source/evidence/claim/artifact linkage and project scope verified |
| `apex.sqlite` and `apex-oracle.sqlite` | market state, strategies, signals, tests, predictions and outcomes | Retain domain authority; publish manifests | Current/live freshness contract and strategy/dataset/outcome lineage verified |
| Eclipse stores | missions, checkpoints, claims, evidence, agent outcomes and artifacts | Retain domain authority; publish manifests | Scope/capability, source/evidence and checkpoint consistency verified |
| Mesh/co-op stores | sessions, permissions, messages, replays and shared packets | Retain domain authority; signed scoped packets | Device/session/lease/expiry/revocation verified |
| `arbiter.db` | relationship/arbitration edges | Inspect as domain metadata | Every edge assigned owner and evidence before any import |
| old-brain command/habit DBs | seven command records and archived sessions | Candidate import then archive | Duplicate/provenance review; no silent procedure promotion |

## Information-preservation rules

1. Import immutable source IDs, store/table/primary-key locators and snapshot hash with every migrated record.
2. Never collapse two source rows only because their text is similar; preserve equivalence mappings and lineage.
3. Preserve negative evidence, corrections, failures and prior versions when needed for temporal truth.
4. Do not promote generated summaries, assistant claims, seed values or maintenance guesses as owner facts.
5. A missing vNext projector/index does not justify deleting its source record.
6. A source remains readable until its import count, exclusions, hashes, important samples and retrieval golden cases reconcile.
7. Physical destruction requires owner approval after the rollback/retention window and a deletion-closure receipt.

## API/secret exclusion policy

- Never snapshot or export `.env`, secrets files, private keys, browser credentials or token stores as part of memory migration.
- Store credential references as `provider + env variable name + allowed purpose + last health status`, never the secret.
- Redact URL query strings, authorization headers, cookies and tool arguments before telemetry or benchmark capture.
- Test fixtures use invented placeholders that cannot match production credential formats.
- External calls remain disabled during import/reconciliation unless a named benchmark explicitly authorizes a stubbed or budgeted provider lane.

## Cutover invariant

Legacy personal-memory writers are disabled in one controlled stage only after vNext command capture, imports, shadow reads, corrections, scope tests, secret checks and rollback rehearsal pass. Domain databases are not “old memory” and are not deleted; they lose any claim to global cognitive authority and communicate through manifests.

