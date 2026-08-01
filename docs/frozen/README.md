# Frozen JARVIS model/runtime rebuild plan

The file `rebuildplanfinal.pre-memory-rework.2026-07-23.md` is the byte-for-byte frozen model/runtime rebuild specification captured before the dedicated memory redesign.

## Required build sequence

1. Fully rethink and specify the complete memory system in its own authoritative memory rebuild document.
2. Build the complete new memory system first, including safe migration of existing memory and all retrieval, graph, correction, forgetting, privacy, room, artifact, latency, cost, evaluation, rollback, and UI requirements.
3. Validate the new memory system in production-like use and complete its cutover before beginning the broader model/runtime rebuild.
4. Return to the existing model/runtime plan only after the new memory implementation and its real interfaces are stable.
5. Rework the model/runtime plan around the memory system that was actually built. Replace assumptions and obsolete memory waves with the real storage, APIs, context packages, behavior, cost, latency, and integration contracts.
6. Freeze that revised model/runtime plan as a new dated version and then execute it.
7. Do not create or require a combined master plan unless the owner explicitly chooses that later.
8. Never silently overwrite this frozen pre-memory copy. Preserve it as the historical baseline even after the revised plan exists.

## Integrity record

- Frozen filename: `rebuildplanfinal.pre-memory-rework.2026-07-23.md`
- Size: `151017` bytes
- SHA-256: `8cfccfd990cc7e5dd18f5f846c34e26688232eb36e34daf1ba2c158d6ee81edb`
- Filesystem attribute: read-only
- Original working document: `docs/rebuildplanfinal.md`

Before using the frozen file, recompute SHA-256 and compare it with the value above.
