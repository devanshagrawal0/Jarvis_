# Jarvis Neural Vault v4 MemoryOS

## What changed

Neural Vault now has a file-backed MemoryOS layer instead of only database rows.

- Human-readable memory object files live under `runtime/neural_vault/memory_os/objects/`.
- SQLite rows in `memory_objects` point to those files and store URI, checksum, type, privacy, provenance, parent paths, tags, and summaries.
- FileDB indexing stores project/source files in `memory_file_index`.
- Hybrid retrieval is exposed through `/api/memory-os/v4/query`.
- Nineteen runnable memory agents are scaffolded and executable through `/api/memory-os/v4/agents/run`.
- Reports are written under `runtime/neural_vault/memory_os/reports/`.

## Main routes

- `GET /api/memory-os/v4/status`
- `POST /api/memory-os/v4/objects`
- `GET /api/memory-os/v4/objects?uri=...`
- `GET /api/memory-os/v4/query?q=...`
- `POST /api/memory-os/v4/files/scan`
- `GET /api/memory-os/v4/files`
- `GET /api/memory-os/v4/agents`
- `POST /api/memory-os/v4/agents/run`
- `POST /api/memory-os/v4/recheck`
- `GET /api/memory-os/v4/storage-trace?uri=...`

## Jarvis tools

Jarvis can call these capabilities:

- `memory_os_v4_status`
- `memory_os_v4_query`
- `memory_os_v4_scan_files`
- `memory_os_v4_run_agent`

## Verification

Run:

```powershell
npm run test:memory-os-v4
```

This verifies file-backed object creation, DB row linkage, reread, query, FileDB scan, agent run, recheck report, and storage trace.
