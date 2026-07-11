# Jarvis Memory Governance / Task-to-Skill / Local File Access Implementation

## External repos reviewed

- https://github.com/microsoft/playwright-mcp: structured browser action surfaces and accessibility-first automation.
- https://github.com/browser-use/browser-use: persistent browser agent loops, action history, and recovery ideas.
- https://github.com/getzep/graphiti: temporal context graph, provenance, and hybrid retrieval ideas.
- https://github.com/Gentleman-Programming/engram: local-first SQLite plus full-text memory for coding agents.

Repos were shallow-cloned into `.codex-analysis/repo-research` for inspection only. No external runtime was installed into Jarvis.

## Implemented checklist

- Memory Governance service with `runtime/memory_temp`, `runtime/memory_os`, and `runtime/memory_governance`.
- Structured temp event capture.
- Structured temp task capture.
- SQLite tables: `memory_temp_events`, `memory_temp_tasks`, `memory_task_patterns`, `memory_governance_runs`, `memory_approval_queue`.
- Manual worker run endpoint.
- Temp-to-permanent MemoryOS promotion.
- Task classification into memory/command/skill/module/agent style candidates.
- Approval proposal files and queue.
- Cleanup status that preserves raw evidence and archives organized temp tasks.
- Runtime reports under `runtime/memory_governance/reports`.
- Generic Task-to-Skill Factory with domain classification, parameter extraction, duplicate detection, candidate files, approvals, and MemoryOS registration.
- SQLite table: `task_to_skill_candidates`.
- Local File Access service with safe roots, blocked secret patterns, managed sessions, operation logs, registry, patch previews, and explicit approval before mutation.
- SQLite tables: `local_file_registry`, `local_file_sessions`, `local_file_operations`, `local_file_patches`.
- Universal object envelope and protocol validator TypeScript files.
- Memory cockpit panels for Worker Control Tower, Task-to-Skill Factory, and Local File Access.
- Tests: `test:memory-governance-master`, `test:task-to-skill`, `test:local-file-access-protocols`.

## Live verification

- `npm run test:memory-governance-master`: pass.
- `npm run test:task-to-skill`: pass.
- `npm run test:local-file-access-protocols`: pass.
- `npm run check`: pass.
- Live API status endpoints on `http://127.0.0.1:8799`: pass.
- Live Local File Access project index: 220 safe files registered.
- Live Memory Worker smoke task: 1 temp task organized, 1 MemoryOS skill object created, 1 approval pending, 1 Task-to-Skill candidate created.

## Safety notes

- File read/search blocks `.env`, private key formats, credential/token/secret paths, `node_modules`, `dist`, `build`, `.git/objects`, and private runtime roots.
- Mutating file operations are approval-gated through patch previews or pending approval responses.
- No credentials were added to code or reports.
