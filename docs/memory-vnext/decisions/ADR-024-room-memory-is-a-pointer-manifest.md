# ADR-024: Room Memory Is a Pointer Manifest, Not a Second Room Database

- Status: Accepted for Wave 25
- Date: 2026-07-26

HELIX, APEX, Forge, and later rooms retain ownership of their raw domain records. Global memory receives an encrypted, versioned manifest containing current objective, bounded summary, status, open loops, warnings, cost, visibility scopes, typed object references, compact context packages, lineage edges, exclusions, and a signed publication receipt.

Each room/project stream advances by a monotonic source sequence. Replaying identical content at the same sequence is idempotent; different content at that sequence is a conflict; an older sequence is stale. A new current manifest supersedes rather than overwrites its predecessor. Context packages may reference only objects declared in the same manifest, and lineage endpoints must also be declared versioned references.

References are pointers, never copied source bodies. Raw text, prompts, responses, message arrays, chunks, market bars, ticks, and telemetry are rejected at the publication boundary. Objectives, summaries, open loops, warnings, packages, and pointer payloads are encrypted. Reads and lineage inspection enforce the manifest scope before decrypting anything.

HELIX maps project, folder, segment, question, plan, run, source, evidence, claim, decision, artifact, task, and operation references into this contract. Internal HELIX model calls and telemetry are explicit exclusions, so JARVIS can explain the research state without polluting global conversation memory or cloning the HELIX database.
