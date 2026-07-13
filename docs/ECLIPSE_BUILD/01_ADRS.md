# ECLIPSE — Architecture Decision Records

Each ADR: **Context → Options → Decision (recommended) → Consequences**. ADR-001 is the
one awaiting your explicit pick; the rest are recommendations grounded in the audit and
the spec's invariants, open to your amendment.

---

## ADR-001 — Implementation language for `server/eclipse/`  ⟵ *your call*

**Context.** The whole backend is `"type": "commonjs"` `.js` with `require()` and **no
build step** (`node server.js` runs source directly). The project's own rule is
CommonJS-only. The spec's directory map shows `.ts` files + Zod. `zod@4.4` is already a
dependency. The spec's actual *invariant* (§18) is "**Zod at process boundaries + a
persisted `schemaVersion`**" — which is language-agnostic.

**Options.**
- **A. JS + Zod + JSDoc** *(recommended).* Plain CommonJS `.js`. Zod schemas give the
  runtime boundary validation the invariants require; JSDoc `@typedef`/`import('zod').infer`
  gives editor types. Zero new tooling. Matches existing coding rules and the other 60+
  server modules. `node server.js` keeps starting instantly.
- **B. TypeScript + build step.** Author `server/eclipse/**.ts`, add a `tsc`/`esbuild`
  compile (watch in dev, emit in `app:build`). Stronger static types, spec-literal. But
  introduces the first server build pipeline into a build-free backend, complicates
  startup/electron packaging, and creates a mixed `.js`/`.ts` require graph at the seam.
- **C. `.ts` run via a loader** (tsx/ts-node). No emit, but adds a runtime transpile
  dependency to a production `node server.js`; startup + electron-rebuild risk.

**Recommended decision: A (JS + Zod + JSDoc).** Lowest risk, fastest, honors the invariant
exactly, no build/packaging changes. The spec's `.ts` is illustrative — we lose nothing
that the invariant requires. (If you want compile-time types badly enough to accept a
server build step, choose B and I'll wire a scoped `tsconfig` for `server/eclipse` only.)

**Consequences (A).** Contracts are `mission.js` etc. exporting Zod schemas +
`schemaVersion` constants; every node does `Schema.parse()` at its boundary; a `.d.ts`
or JSDoc types file gives the frontend/editors the shapes.

---

## ADR-002 — Canonical state owner & LangGraph checkpoints

**Context.** Invariant: Task OS is the *only* mission-state authority; LangGraph is an
execution engine, not a second DB (§16). Current mission store =
`mission-engine.js` → `runtime/jarvis-missions.sqlite`.

**Decision.** Keep `jarvis-missions.sqlite` as the one store. Add `eclipse_graph_runs`,
`eclipse_node_runs`, `eclipse_events`, `evidence_objects`, `claims`,
`claim_evidence_edges`, `capability_leases`, `artifact_manifests` **in that same DB**
(FK → `missions(id)`), per spec §27.1. For checkpoints, use the **official
`@langchain/langgraph-checkpoint-sqlite` `SqliteSaver`** (it's built on **better-sqlite3**,
the same engine Jarvis already uses) pointed at a `runtime/eclipse.sqlite` (or the missions
DB), rather than hand-rolling a `BaseCheckpointSaver`; mirror each committed superstep's
`graph_run_id`/`checkpoint_id` into the `eclipse_graph_runs` row so Task OS stays the
canonical index. Every LangGraph superstep is thus durably checkpointed and resumable by
`thread_id`. Provider (Gemini Interactions) conversation state is an *optimization* and
must be reconstructable from Task OS.

Durability is **two-layer** (research-confirmed): (A) each expensive node is a stored
`background=true` **Interaction** — Google keeps it running through Electron restarts; we
persist the interaction ID + `last_event_id` and re-attach on relaunch. (B) the local
`SqliteSaver` checkpoints the graph between supersteps. Checkpointers save *between* nodes,
not inside — so nodes stay small/idempotent and any long side-effecting step is delegated
to a background Interaction whose ID *is* the checkpointed state. **Temporal is skipped**
(over-engineered for a personal local app).

**Consequences.** One recoverable source of truth; crash/replay works against SQLite;
no divergence between LangGraph's memory and Jarvis's mission record.

**W3 build refinement (2026-07-13).** Two deliberate splits from the letter of the decision,
same spirit: (1) Eclipse tables live in their **own** `runtime/eclipse.sqlite`, not inside the
live `jarvis-missions.sqlite`, so Eclipse never contends with the connection the running server
holds open (the never-restart constraint); `mission_id` is a **soft ref** to `missions.id`
(no cross-DB FK), and Task OS stays canonical. (2) The LangGraph `SqliteSaver` writes to a
**separate** `runtime/eclipse-checkpoints.sqlite` (checkpoint blobs) from the domain store
(graph_runs/node_runs/events/receipts) — cleaner separation and no writer-writer lock
contention. Crash/replay safety is enforced by an **idempotency `onceGuard`** (receipt written
before the side effect; replay skips it) — verified by the W3 gate.

---

## ADR-003 — Vector / index store for Memory Resonance

**Context.** `memory-vectors.js` loads **all** rows and brute-forces cosine — the spec's
named limitation. It is non-destructive (own sqlite). Current scale ≈ 700 memories.

**Decision.** **Evolve in place, don't replace.** Add `namespace`, metadata columns and
hard pre-filters (user/room/lease/path/sensitivity) to `runtime/memory-vectors.sqlite`;
add the explainable fusion + rerank score (spec §22 formula: dense + lexical + graph
proximity + mission relevance + recency + authority + affinity + reuse + novelty − dup −
staleness − sensitivity) computed across the Memory Resonance federation, not just cosine.
Keep brute-force ANN for now (fine ≤ a few-thousand vectors); add an index
(`sqlite-vec` or `hnswlib-node`) **only when a scale gate is hit** — recorded as a future
ADR, not installed speculatively.

**Consequences.** Immediate recall/provenance gains with no risky migration of the live
704 MB Neural Vault; a clean upgrade path when scale demands it.

---

## ADR-004 — Event transport & mission streaming

**Context.** Era II already ships ordered NDJSON envelopes over `/api/chat/stream`.
Eclipse needs a per-mission event stream + durable replay (`EclipseEvent` §27).

**Decision.** Reuse the existing streaming pattern. Persist every `EclipseEvent` to
`eclipse_events` (monotonic `sequence`) as the durable log; expose
`GET /api/eclipse/missions/:id/stream` (SSE) that replays from a cursor then tails live.
The frontend Mission Forge consumes it exactly like the current chat stream. No new WS
framework; the mesh-hub stays device-only.

**Consequences.** UI is always reconstructable from persisted events (no fake activity);
reconnection resumes from `sequence`.

---

## ADR-005 — Artifact storage & manifests

**Context.** `work-composer.js` already assembles artifacts; Era II serves them via a
scoped download route.

**Decision.** Artifact Reactor feeds the **canonical content graph** into `work-composer`;
outputs are written under the existing Work Composer root and recorded as
`artifact_manifests` rows (`sha256`, `sourceClaimIds`, `sourceEvidenceIds`, `checks[]`,
`jarvisVisibility`). Downloads reuse the existing authenticated artifact route; Jarvis
stores id/path/summary/deps for later recall/regeneration.

**Consequences.** No new blob store; artifacts are content-addressed, verifiable, and
regenerable when a source claim changes.

---

## ADR-006 — Model layer: Gen AI SDK, Interactions API, LangGraph

**Context.** `@google/genai@2.8` and `gemini-models.js` exist; LangGraph is absent. Spec
prefers the **Interactions API** for new work (unified model/agent, observable steps,
`previous_interaction_id`, background exec) but keep `generateContent` until parity is
proven.

**Decision.** (1) Extend `gemini-models.js` with per-model **capability metadata**
(thinking policy, retry class, context/cache, cost) + a `modelForNode(node, effort)`
router — do not fork the registry. (2) Add one **provider adapter**
(`routing/model-router` + a thin Interactions client) owning structured-output validation,
tool schemas, streaming, token accounting, fallback classification; `generateContent`
stays the compatibility path behind a flag. (3) Install **`@langchain/langgraph` +
`@langchain/langgraph-checkpoint-sqlite`** at P1·W3 (not before); no LangChain chains, no
Temporal/A2A now.

**Research-confirmed backbone.** Run **every mission node as a stored `background=true`
Interaction** — near-zero-effort server-side durability across Electron restarts,
**observable execution steps** (free mission-timeline feed), automatic **thought-signature**
management (needed for coherent multi-step tool calls), implicit caching (~90% off repeated
context) via `previous_interaction_id`, and resumable streaming via `last_event_id`. Adapter
must encode: `thinking_level` XOR `thinking_budget`; no chaining onto an `in_progress`
interaction; `store=false` disables background/`previous_interaction_id`; per-interaction
tools/system_instruction/generation_config; tools ≤10–20; MCP names snake_case; temp stays 1.0.

**Consequences.** One model-call boundary, Interactions adopted incrementally with a
proven fallback, Task OS still canonical even when `previous_interaction_id` is used.

**W3 build refinement (2026-07-13).** The adapter (`model/adapter.js`) is the single boundary;
the actual provider call is an **injected function** (`liveCall`) so all adapter logic (routing,
structured-output repair, retry/fallback, ledger) is unit-tested at **zero Gemini cost**.
`model/interactions-client.js` implements `liveCall` to this ADR's contract (Interactions API
preferred, `generateContent` fallback, `thinking_level` XOR budget, temp 1.0, background+store,
`previous_interaction_id`, thought-signature passthrough) and is **flag-gated + unexercised**
until a later minimal credit-budgeted checkout validates it against the real API.

---

### Cross-cutting invariants honored by all ADRs
Task OS owns state · model proposes / deterministic code enforces · every consequential
action = lease + idempotency key + receipt · claims evidence-linked or marked inference ·
one canonical content graph · smallest-subgraph repair · Eclipse escalation is earned ·
no fabricated/empty widgets (continues Era I–IV product-truth contract).
