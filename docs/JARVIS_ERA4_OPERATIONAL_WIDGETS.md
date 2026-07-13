# JARVIS Era IV — Operational Widgets, Wave 1

Era IV begins the interior rebuild of each current widget. It adds no permanent top bar, bottom strip, or alternative shell. Widgets continue to open in normal mode through the existing Modules launcher and retain minimize, normal, expand, refresh, drag, resize, and close.

## Projects

Project Operations now uses the real `/api/projects` scan instead of inventing project statuses. It provides:

- workspace, file, Git, package, README, and attention metrics;
- search and truthful healthy/attention filters;
- recent-work ordering;
- project inspector with absolute path, repository and README health, file count, package metadata, dependencies, and scripts;
- explicit Open Folder through `/api/projects/open`;
- Ask Jarvis and Set Context actions containing the exact project path.

## Agents

Mission Control now distinguishes three different concepts that the old card incorrectly collapsed:

- specialist definitions from `/api/agents`;
- deployable-agent missions from `/api/agents/missions`;
- durable Task OS missions from `/api/missions`.

It displays real running, queued, failed, and total counts; search and status filters; sanitized mission titles; source substrate; role; progress; objective; durable execution plan; recent events; error; and pause/resume/cancel controls for durable missions. The Specialists view exposes each specialist's kind, description, and actual tool envelope.

## Modules

Module Console now exposes the real 58-module capability registry from `/api/modules`:

- total, ready, blocked, connected-provider, and category counts;
- search, domain, and readiness filters;
- truthful installed/available, ready/blocked, surface, permission, requirement, and missing-provider states;
- exact blocker copy supplied by the backend;
- launch routing to an existing widget where a working surface exists;
- Jarvis guidance for capabilities that require configuration or implementation.

## Interaction repair

The spatial frame previously raised z-order on every pointer-down across the entire widget. That state update could interrupt the subsequent click on a child filter, row, tab, or action. Focus changes are now owned by the draggable header. Interior controls execute without a container rerender between pointer-down and click.

## Verification

- Production Vite build passes.
- Era III shell contracts remain green.
- Era IV contracts cover the three live API mappings, actions, readiness truth, and the child-control interaction repair.
- Live browser verification confirms 24 projects, 58 modules, 66 missions across both mission substrates, eight specialist cards, no permanent top/bottom strip, and no application console errors.

## Wave 2 — Assurance and evidence

### Connections

Connection Operations reads `/api/provider-health` and keeps three concepts separate: a provider can be registered, configured, or actually connected. The console reports provider/model identity, authentication mode, environment, measured latency, last request, last tool, scopes, endpoint metadata, missing environment-variable names, and provider error evidence. It never renders raw key values. Search plus connected/action-required filtering makes configuration gaps inspectable. “Diagnose with Jarvis” sends the selected provider’s exact evidence into the primary command pipeline.

### Trust

Trust & Authority joins `/api/security/trust`, `/api/confirmations/pending`, and `/api/devices`. It shows the resolved principal, owner trust, loopback bind boundary, paired identities, pending device state, owner-confirmation queue, and remote-relay status. Four visible invariants communicate the real security model: private routes deny by default, secret values stay server-side, consequential actions stop for approval, and action evidence survives as receipts. The queue only offers a safe explanation action; the UI does not silently approve a request.

### Receipts

Receipt Explorer turns `/api/receipts` into a searchable evidence ledger. It supports action/target/result/device search, risk and status filters, full JSON export, per-receipt download, and inspection of input fingerprint, execution plan, result, verification evidence, identity, risk, and timestamp. Previously loaded receipts remain visible during a background refresh instead of disappearing behind a loading placeholder.

## Wave 3 — Owner and machine intelligence

### Profile

The Owner Context Plane separates verified profile facts from missing context. It exposes identity, preferred name, locale, email, resolved/current place, location source, coordinates, timezone, preferences, goals, locations, and standalone facts. Empty goal and fact stores are visible rather than inferred. It also renders live model economics from the profile cost ledger: calls, input/output tokens, cost by model, month/all-time totals, and action prompts for context audit and workload routing.

### Weather

Local Environment uses only fields returned by `/api/weather`: current temperature, apparent temperature, humidity, wind, four forecast days, daily ranges, and maximum precipitation probability. Planning signals are derived only when the response is available. A provider timeout produces an explicit evidence-unavailable state, disables trend analysis, and offers a recovery prompt; empty values are never converted into reassuring weather claims.

### System Vitals

System Observability separates host and Node/JARVIS telemetry. It exposes host/platform identity, operating-system uptime, logical cores, physical-memory pressure, JARVIS RSS, JavaScript heap, and backend uptime. On Windows, `os.loadavg()` returning zero is labeled “not supplied,” not interpreted as zero CPU utilization. Memory thresholds produce nominal, pressure, or critical states and can seed a read-only diagnostic/runbook request.

### Spatial hydration repair

Restoring many saved spatial windows previously allowed the hydration effect to launch duplicate requests for a widget while its first request was still active. A per-widget in-flight registry now deduplicates initial loads, manual opens, and periodic refresh overlap. Last-good data remains visible during refreshes.

## Wave 4 — Memory Observatory and command integration

### Layered memory truth

The Memory widget now joins five live sources:

- `/api/memory-os/v4/status` for file-backed Memory OS structure and agent/count health;
- `/api/memory-os/v4/objects?limit=100` for canonical `memory://` objects;
- `/api/neural-vault/status` for the legacy SQLite/FTS layer;
- `/api/neural-vault/entries?limit=100` for high-priority semantic assertions;
- `/api/neural-vault/continuity` for active project/topic/issue/goal/artifact and pronoun resolution.

This proves the system is not merely one flat table, but it also makes the unfinished parts impossible to hide. At implementation time the live system contained 642 canonical objects, 703 semantic memories, and 220 indexed files, but zero v4 relationship edges, zero raw Memory OS events, and zero recorded memory-agent runs. Agent definitions exist without execution history. The Architecture view labels those as gaps rather than calling the whole substrate complete.

### Retrieval and provenance

Explore provides backend Memory OS search, type filtering, retrieval confidence, a canonical object inspector, stable URI, privacy, confidence, importance, timestamps, tags, content preview, file path, and provenance. Storage Trace calls `/api/memory-os/v4/storage-trace` and exposes the SQLite row, canonical Markdown file, URI, checksum, parent count, and recent queries. An object can be copied, audited, or installed as an explicit Jarvis context package.

Continuity exposes the active working set and the current resolution targets for follow-up language. The user correction, assistant commitment, active artifact, active tool, and likely “it” referent can be audited without mutating the store.

### Real widget-to-Jarvis actions

Operational widget buttons emit `jarvis:command`. Era IV discovered that the current shell did not consume that event, making apparently useful buttons inert. `JarvisUI` now routes widget commands through the exact same streamed `/api/chat/stream` submission path as typed commands. `JarvisCommandBar` dispatches the fallback event only when no direct `onSubmit` handler exists, preventing typed prompts from being submitted twice.

## Era IV verification contract

- Existing launcher and spatial-frame behavior remain: normal first open; minimize, normal, expanded, refresh, drag, resize, focus, and close.
- No permanent top toolbar or bottom widget strip was reintroduced.
- Launcher and command bar remain above independent windows; windows do not blur the workspace and may coexist.
- Fourteen focused Era IV contract tests cover live endpoint composition, truthful empty/error states, provider/trust/receipt evidence, memory layering, command routing, and refresh deduplication.
- Production Vite build succeeds. TypeScript diagnostics in concurrent HELIX v2 files are tracked separately and were not modified by this JARVIS work.
