# Memory vNext Wave 1 — Snapshot and Structural Inventory

**Generated:** 2026-09-14T00:06:17.931Z  
**Snapshot root:** `C:\Users\Devansh\AppData\Local\Jarvis\memory-vNext\wave1-snapshots\2026-09-14T00-06-16-441Z`  
**Safety:** SQLite online backups; no live DB/WAL copied directly; no row contents or secret values emitted.  

## Summary

- Stores declared: 17
- Verified snapshots: 11
- Source DB size: 0.05 MiB
- Live WAL observed: 6.33 MiB
- Code files scanned without snippets: 1506
- Environment/API variable names found: 97; values were never read or written.

## Stores

| Store | Owner | Snapshot status | DB MiB | WAL MiB | Tables | Declared FKs | Snapshot SHA-256 | Decommission disposition |
|---|---|---|---:|---:|---:|---:|---|---|
| `runtime/jarvis-memory.sqlite` | jarvis | missing | 0.00 | 0.00 | — | — | `—` | migrate_then_disable |
| `runtime/memory/jarvis_memory.sqlite` | jarvis | snapshotted_verified | 0.00 | 0.04 | 3 | 0 | `531fdab588c99abf1cbb2de86cf6defd360cf86ccf898f52f659a744087aa8ae` | telemetry_archive |
| `runtime/neural_vault/db/neural_vault.sqlite` | neural_vault | snapshotted_verified | 0.00 | 2.84 | 97 | 3 | `dd88bf9969cf2c1b4854e4bd23d7e658322ccc1ae2a02735c0f8fbfeeaf87f89` | migrate_then_disable |
| `runtime/memory-vectors.sqlite` | jarvis | snapshotted_verified | 0.00 | 0.01 | 1 | 0 | `ccec07eaf5532fa5eabd43ff8148d834eb8194b5624cd51b3b504c88967fe5a2` | rebuild_do_not_import |
| `runtime/user-context.sqlite` | jarvis | snapshotted_verified | 0.00 | 0.20 | 19 | 0 | `700b57462604ac922427f458b54c9d26f5099503fcbb9a578d4137198fe9dcf4` | migrate_then_disable |
| `runtime/jarvis-missions.sqlite` | missions | snapshotted_verified | 0.00 | 0.04 | 2 | 0 | `4a341297bbe9107e774ec66b1c16894fb1cefd0eb0cf404c5dd457eb40a87fa6` | split_task_truth_from_telemetry |
| `runtime/jarvis-pc-graph.sqlite` | pc_graph | snapshotted_verified | 0.00 | 0.07 | 3 | 0 | `e3df3dbfc44621167b9d4421bb658c64d95a9bfeee3e93c76e617eab23ba39af` | manifest_and_pointer_migration |
| `runtime/jarvis-skills.sqlite` | skills | snapshotted_verified | 0.00 | 0.04 | 2 | 0 | `56058bbf0e5e2e76786dc1966a1c5ea643011ceeb04e2037ab40d9c623608c5b` | candidate_import |
| `runtime/helix.sqlite` | helix | snapshotted_verified | 0.00 | 2.36 | 76 | 29 | `e5c933c3bbf4c127b22621f406ed7b68af4b4af5ec8748d50ac81c7a0179f594` | retain_domain_owner_publish_manifests |
| `runtime/apex.sqlite` | apex | snapshotted_verified | 0.00 | 0.67 | 20 | 0 | `b8eb010f281b1eced1a4741f08cd9c4ab83af3d6a2b29d339373cb52bd6c7f65` | retain_domain_owner_publish_manifests |
| `runtime/apex-oracle.sqlite` | apex | missing | 0.00 | 0.00 | — | — | `—` | retain_domain_owner_publish_manifests |
| `runtime/eclipse.sqlite` | eclipse | missing | 0.00 | 0.00 | — | — | `—` | retain_domain_owner_publish_manifests |
| `runtime/eclipse-checkpoints.sqlite` | eclipse | missing | 0.00 | 0.00 | — | — | `—` | retain_domain_owner_publish_manifests |
| `runtime/coop_symbiote/coop.db` | mesh | snapshotted_verified | 0.00 | 0.07 | 3 | 0 | `f2a3c01763ddb54b465de0b2ae8a39d25cfd5c27b92f004e50cb772d7cfff859` | retain_domain_owner_publish_manifests |
| `runtime/arbiter.db` | arbiter | snapshotted_verified | 0.01 | 0.00 | 1 | 0 | `a3b231b0d124499904966283b64f2314d88ec5ed1b480d277f02498ad3ed1348` | inspect_then_classify |
| `runtime/old-brain-3/brain/memory/commands.db` | legacy_archive | missing | 0.00 | 0.00 | — | — | `—` | candidate_import_then_archive |
| `runtime/old-brain-3/brain/memory/habits.db` | legacy_archive | missing | 0.00 | 0.00 | — | — | `—` | candidate_import_then_archive |

## Restore rule

1. Stop only the target service after recording its process/port and current paths.
2. Never overwrite the sole live copy; restore into a new empty directory.
3. Verify the snapshot SHA-256 against `database-inventory.json`.
4. Open the restored copy read-only and require `PRAGMA quick_check` = `ok`.
5. Point a test-only adapter at the restored copy and run its baseline queries.
6. Production restoration/cutover requires an explicit rollback record and is not performed by this Wave 1 tool.

## Legacy-memory decommission invariant

Old personal-memory authorities are not deleted in Wave 1. They progress through: snapshotted → mapped → imported as candidates → reconciled → legacy writers disabled → legacy readers disabled → archived read-only → retention-approved destruction. Domain stores remain domain-owned and publish manifests. This prevents both data loss and two writable cognitive authorities.

## Credential invariant

The audit records environment-variable names and referencing files only. It does not read or copy `.env` values, API keys, tokens, secret files, credentials, browser profiles, or credential-bearing row content.
