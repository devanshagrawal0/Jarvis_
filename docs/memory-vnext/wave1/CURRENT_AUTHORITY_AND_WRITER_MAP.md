# Memory vNext Wave 1 — Current Authority and Writer Map

**Status:** Read-only mapping of the pre-vNext runtime  
**No legacy writer has been disabled yet.** Disabling before import/reconciliation would risk losing owner information.

## Executive finding

The active system does not have one memory authority. The dominant physical file is `runtime/neural_vault/db/neural_vault.sqlite`, but it contains several independently managed logical systems, while `user-context.sqlite`, `memory-vectors.sqlite`, task/skill/graph stores, room stores, and repair traces maintain additional state.

The most serious double-authority path is inside `server.js`:

1. `memoryStore` and a five-turn `memoryExtractor` are created at lines 11752–11753.
2. `neuralVault` is then created.
3. A second `memoryStore` and `memoryExtractor` are created at lines 11779–11784 so short-memory writes can be bridged into long memory.
4. The first store connection is not closed before its variable is replaced.
5. Each qualifying chat turn can write through deterministic `memoryStore.ingestTurn`, the five-turn extractor, `neuralVault.ingestTurn`, and procedural correction logic.

This is why vNext must introduce one command facade before disabling anything.

## Current logical authorities

| Authority | Physical store | Current writers | Current readers | vNext disposition |
|---|---|---|---|---|
| Short semantic/procedural/episodic memory | Neural Vault `ms_*` tables | `memory-store.js`, `memory-extractor.js`, chat/brain routes | `memory-store.js`, `agent-runtime.js`, capability endpoints | Import accepted versions; disable writers/readers after cutover |
| Long Neural Vault memory | Neural Vault `memories`, entity, relationship, continuity and carryover tables | `neural-vault.js`, bridge from `memory-store.js`, memory manager/decay, several subsystems | `getContextPack`, debug/UI/capability endpoints | Import by type/provenance; replace global context authority |
| Typed user profile | `user-context.sqlite` | `user-context.js` and profile/location endpoints | prompt profile block, location/time APIs | Import as reviewed typed candidates; seed values are not owner truth |
| Vector projection | `memory-vectors.sqlite` | startup backfill and lazy embedding calls | semantic recall in `callGemini`, vector API | Do not import as truth; rebuild after canonical acceptance |
| Conversation repair/debug | `runtime/memory/jarvis_memory.sqlite` | `agent-repair.js` | repair/debug endpoints | Archive telemetry; import only explicit supported state |
| Missions/tasks | `jarvis-missions.sqlite` | `mission-engine.js` | mission/task endpoints | Import current task truth/checkpoints; archive raw event telemetry |
| Skills/procedures | `jarvis-skills.sqlite` plus Neural Vault skills/procedures | skill autopilot, task-to-skill, Neural Vault | agent/tool selection and UI | Candidate import with outcome evidence; no automatic activation |
| PC graph | `jarvis-pc-graph.sqlite` | PC graph indexers | file/code/context search | Retain domain ownership; publish versioned manifests/pointers |
| HELIX | `helix.sqlite` | HELIX DB/pipeline/substrate | HELIX UI and APIs | Retain domain ownership; publish research manifests |
| APEX/Oracle | `apex.sqlite`, `apex-oracle.sqlite` | APEX ingest, paper, forecasting | APEX/Forge UI and APIs | Retain domain ownership; publish strategy/data/outcome manifests |
| Eclipse | `eclipse.sqlite`, `eclipse-checkpoints.sqlite` | Eclipse orchestration/evidence/checkpoints | Eclipse UI/integration | Retain domain ownership; publish mission/evidence manifests |
| Device Mesh/co-op | Neural Vault mesh/coop tables and `coop.db` | mesh/co-op services | device/co-op APIs/UI | Retain domain ownership; capability-scoped signed memory packets |
| Dormant legacy personal DB | `runtime/jarvis-memory.sqlite` | no production source reference found | no production source reference found | Candidate import only; archive after reconciliation |
| Archived old brain | `commands.db`, `habits.db` | no current production writer found | no current production reader found | Candidate import then archive |

## Active write paths that must be intercepted

| Path | Trigger | Current effect | Risk | Replacement contract |
|---|---|---|---|---|
| `memoryStore.ingestTurn` | successful chat/voice responses | heuristically stores episodes, preferences, personal facts and rules; writes working state | regex over-admission and category-level correction | `journal-turn` plus deterministic candidate commands |
| `memoryExtractor.push` | chat/voice and `/api/brain`; every fifth buffered turn | paid Gemini extraction into `ms_memories` | fixed boundary, swallowed failures, direct provider usage | semantic-segment extraction job through provider gateway |
| Neural Vault bridge | every `memoryStore.add` | duplicates short-memory content into `memories` | same meaning in two logical authorities | one canonical command plus projections |
| `neuralVault.ingestTurn` | model completion/error paths | continuity, referents, carryover and memory objects | overlaps short store and can ingest failed/generated content | immutable turn journal plus governed derivation |
| `proceduralMemory.ingestCorrection` | completion and some error fallbacks | reinforces/proposes procedures | duplicate invocation and weak outcome evidence | precise correction resolver plus outcome-gated experience case |
| `memoryManager.start` | startup + interval | archives, prunes, merges entities and writes reports | background mutation during migration; destructive merge semantics | quarantined maintenance proposals and reversible commands |
| `memoryDecay.start` | startup + interval | changes priority and flags duplicates | implicit mutation and timing-dependent results | versioned lifecycle policy worker |
| Vector startup backfill | four seconds after startup | up to 60 direct embedding requests | unmetered startup API spend and incomplete coverage | provider gateway, content cache, batch/backfill jobs |

## Read/context paths that currently combine authorities

- `rememberedText` combines Neural Vault search and `memoryStore.search` without canonical dedupe.
- `callGemini` builds a Neural Vault context pack and separately lets `agentRuntime.prepare` retrieve short memory.
- Semantic-vector results are appended again for memory-looking prompts.
- The prompt includes only the last eight raw history items while continuity/referents are separately inferred.
- API/UI endpoints expose legacy memory, Neural Vault, vector, profile and repair views independently.

vNext replaces these with a single Adaptive Context Runtime and an influence/consistency manifest.

## API and credential safety findings

No credential values were read during Wave 1. The structural code scan recorded only environment-variable names and referencing files.

Required protections during the rebuild:

1. Never import `.env`, the secrets directory, browser profiles, private keys, tokens, or raw credential values into memory.
2. `api_key_metadata` may migrate provider name, environment-variable name, scope and ownership metadata only; `secretStored` remains false.
3. Existing Gemini REST calls place the key in URL query parameters in several paths. vNext provider adapters must prefer the supported API-key header and redact URLs/headers from logs and receipts.
4. `memory-vectors.js` bypasses the cost/provider gateway and performs startup embedding calls. It must be disabled only when its vNext replacement is ready, then removed from the legacy path.
5. Test servers must receive an explicit no-network/provider stub policy; they must not inherit usable production API credentials merely because `NODE_ENV=test`.
6. Snapshot, import, benchmark and diagnostic artifacts contain schemas/counts/hashes only unless a separately approved encrypted data-migration process requires row content.

## Safe decommission state machine

```text
discovered
→ online-snapshotted
→ structurally mapped
→ import rules approved
→ imported into candidate/staging space
→ reconciled against source counts/hashes
→ vNext shadow reads pass
→ legacy writer disabled
→ legacy reader disabled
→ legacy DB archived read-only
→ retention window expires
→ owner-approved verified destruction
```

At no point may both legacy and vNext be independently writable authorities for the same cognitive record. During shadowing, one typed intent is captured and replayed idempotently; this is not two unrelated writes.

