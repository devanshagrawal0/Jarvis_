# Memory vNext Wave 1 — Snapshot and Structural Inventory

**Generated:** 2026-07-23T13:46:31.001Z  
**Snapshot root:** `C:\Users\devan\AppData\Local\Jarvis\memory-vNext\wave1-snapshots\2026-07-23T13-46-17-837Z`  
**Safety:** SQLite online backups; no live DB/WAL copied directly; no row contents or secret values emitted.  

## Summary

- Stores declared: 17
- Verified snapshots: 17
- Source DB size: 927.31 MiB
- Live WAL observed: 160.46 MiB
- Code files scanned without snippets: 446
- Environment/API variable names found: 64; values were never read or written.

## Stores

| Store | Owner | Snapshot status | DB MiB | WAL MiB | Tables | Declared FKs | Snapshot SHA-256 | Decommission disposition |
|---|---|---|---:|---:|---:|---:|---|---|
| `runtime/jarvis-memory.sqlite` | jarvis | snapshotted_verified | 1.57 | 4.00 | 5 | 2 | `38c699a87003095751bd817e94b64098de2087003142114d4f01348fbff6ad2e` | migrate_then_disable |
| `runtime/memory/jarvis_memory.sqlite` | jarvis | snapshotted_verified | 175.28 | 3.99 | 3 | 0 | `7ab89c437bc229a0c93344895bcd375596fd2195a46a3ae64677dc115417b96a` | telemetry_archive |
| `runtime/neural_vault/db/neural_vault.sqlite` | neural_vault | snapshotted_verified | 27.59 | 4.87 | 97 | 3 | `fb1d47a35dc6ed7c82632d79e9a000405afd6c8db38e4fc49810a56c248efd6e` | migrate_then_disable |
| `runtime/memory-vectors.sqlite` | jarvis | snapshotted_verified | 0.00 | 2.13 | 1 | 0 | `7421fa9528d4e68a039e3535f74dcc3936c13322f64ba07847294778611bf75e` | rebuild_do_not_import |
| `runtime/user-context.sqlite` | jarvis | snapshotted_verified | 0.00 | 0.23 | 19 | 0 | `9916768dc4a33862ac6764d3eb72415ae7a4a85bf6cfecef2d17803105cf652f` | migrate_then_disable |
| `runtime/jarvis-missions.sqlite` | missions | snapshotted_verified | 671.47 | 123.93 | 2 | 0 | `a26e83ed8dff51c5e2590b9d99bd77a123a1527e54b83a13f7e8bbb020ece3ab` | split_task_truth_from_telemetry |
| `runtime/jarvis-pc-graph.sqlite` | pc_graph | snapshotted_verified | 8.42 | 3.96 | 3 | 0 | `baf04c65141f079cb2e868c4e1022b11a9e813f32d83ada619eee3b3cd3dcf32` | manifest_and_pointer_migration |
| `runtime/jarvis-skills.sqlite` | skills | snapshotted_verified | 11.79 | 3.96 | 2 | 0 | `8a955a87cf75a4cd696396356cc20f7a416a11f8043d79ab05fbfc65e248cc1a` | candidate_import |
| `runtime/helix.sqlite` | helix | snapshotted_verified | 1.09 | 1.38 | 76 | 29 | `6c3e08b5b8c851345f5e3d036db8d99d0e56337e98907c9741670eabe318f0fa` | retain_domain_owner_publish_manifests |
| `runtime/apex.sqlite` | apex | snapshotted_verified | 29.18 | 3.96 | 24 | 0 | `ea9d222503e87afd98036805e90afd0442004557b972918211cca3f6d1fc6fbe` | retain_domain_owner_publish_manifests |
| `runtime/apex-oracle.sqlite` | apex | snapshotted_verified | 0.48 | 3.93 | 6 | 1 | `fa35dc637b5f313084ca293aea232a8ffcad0ca6e480ac2d3b70a7dcf581639b` | retain_domain_owner_publish_manifests |
| `runtime/eclipse.sqlite` | eclipse | snapshotted_verified | 0.00 | 3.34 | 13 | 0 | `3f081a3d7ca60e1b2268292385596973b03c6afa5bf282461598fe39357ff413` | retain_domain_owner_publish_manifests |
| `runtime/eclipse-checkpoints.sqlite` | eclipse | snapshotted_verified | 0.40 | 0.00 | 2 | 0 | `8dc13bbe00b9974d9b5339f9962024fa72df66f30a5c388fdcbeb86ce3e82d0b` | retain_domain_owner_publish_manifests |
| `runtime/coop_symbiote/coop.db` | mesh | snapshotted_verified | 0.00 | 0.79 | 3 | 0 | `95886bd14e5a8ac637363e42b45eb8544e0042b50ed583b00d2892256a5636dc` | retain_domain_owner_publish_manifests |
| `runtime/arbiter.db` | arbiter | snapshotted_verified | 0.01 | 0.00 | 1 | 0 | `ee540bf2a64e196199fab5fe95c73af4abcf30acc4403ec6d4252a53d5404053` | inspect_then_classify |
| `runtime/old-brain-3/brain/memory/commands.db` | legacy_archive | snapshotted_verified | 0.01 | 0.00 | 1 | 0 | `a14c9e622708732c7d0d445771d11eeb358417d1677ff58e78089ef3ff14ddd3` | candidate_import_then_archive |
| `runtime/old-brain-3/brain/memory/habits.db` | legacy_archive | snapshotted_verified | 0.02 | 0.00 | 2 | 0 | `c887ea759464cbe39bbccf145542d8b06efb4a366a30f00acf5a8fe81355b6d8` | candidate_import_then_archive |

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
