# Wave 25 Evidence Report - HELIX Pointer Manifests and Research Lineage

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Generic versioned room-manifest substrate for current objective, summary, status, open loops, warnings, cost, visibility, references, packages, lineage, and exclusions.
- Monotonic per-room/project source sequence, exact replay idempotency, conflicting-replay rejection, and supersession history.
- Encrypted objectives, summaries, open loops, warnings, pointer payloads, and package payloads.
- Typed, versioned, domain-owned pointers instead of copied domain bodies.
- Folder and segment context packages constrained to references in the publishing manifest.
- Evidence/claim/decision/artifact/run lineage constrained to declared manifest endpoints.
- Scope checks before manifest or lineage reads.
- Signed content-minimal publication receipts.
- HELIX mapping for projects, folders, segments, questions, plans, runs, sources, evidence, claims, decisions, artifacts, tasks, and operations.
- Explicit exclusions for HELIX internal model calls and room-owned telemetry.

## Verified

- JARVIS-facing context can recover the current HELIX project, folder/segment packages, unresolved loops, warnings, and source pointers.
- Source-to-evidence-to-claim-to-decision and run-to-artifact lineage is reproducible.
- Internal model-call references do not appear in global room references.
- Raw source bodies, prompts, responses, messages, chunks, bars, ticks, and telemetry are rejected.
- An unauthorized scope cannot read a room manifest or lineage.
- Identical sequence replay is idempotent; stale sequence and conflicting content fail closed.
- Private research summary text is absent from raw SQLite bytes.
- A controlled publication fault rolls back manifest, refs, packages, lineage, exclusions, receipts, and encrypted payloads together.

## Deliberate boundary

The HELIX UI and live HELIX database do not yet publish into this API. The wave defines and proves the integration boundary using disposable stores; it does not duplicate, migrate, modify, or query the production HELIX database and does not call research providers.
