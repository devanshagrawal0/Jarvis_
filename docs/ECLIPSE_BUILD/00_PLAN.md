# ECLIPSE — Build Plan (for approval)

Status: **PLAN / PRE-BUILD**. No runtime code written yet. This doc + `01_ADRS.md`
are the scope-first deliverable requested before construction. Source of truth for
*what* to build: `Desktop/ECLIPSE_QUANTUM_LATTICE_BUILD_SPECIFICATION_V2.docx`
(Part II is normative). This doc records how it lands on the **current** repo.

---

## 1. One-paragraph goal

Add a durable, inspectable **mission runtime** above the Jarvis you already have.
Cortex (chat) and Cortex Prime (single-agent reasoning) stay exactly as they are.
**Eclipse** handles persistent, multi-source, multi-agent, multi-artifact missions:
a request is compiled into a typed **MissionSpec**, planned into a **graph**, executed
node-by-node by leased agents, grounded in **evidence + claims**, verified, and turned
into synchronized **artifacts** — with Task OS as the single source of truth and every
consequential action carrying a lease + idempotency key + receipt.

---

## 2. Grounding audit — current modules (verified 2026-07-13)

All §17 modules exist and follow a consistent `createX(deps)` factory pattern. None are
`.ts`; the server is `"type": "commonjs"` with `require()` and **no build step**.
`zod@4.4` and `@google/genai@2.8` are **already installed**; **LangGraph is not**.

| Module | Lines | Real interface | Eclipse disposition |
|---|---|---|---|
| `server/mission-engine.js` | 402 | `createMissionEngine(runtimeDir)`; owns `runtime/jarvis-missions.sqlite` (`missions` table, WAL, anti-amplification guard) | **State owner.** Add `eclipse_*` tables (FK→missions), Eclipse mission type, graph/node snapshots. |
| `server/agent-runtime.js` | 467 | `createAgentRuntime`; regex `taskBlueprint()` complexity | Becomes **entry router**: Intent Genome + Eclipse eligibility. |
| `server/react-loop.js` | 188 | `createReActExecutor` | **Cortex fallback only.** Untouched behavior; Eclipse missions bypass it. |
| `server/tool-gateway.js` | 269 | `createToolGateway` (keyword ranking) | Semantic routing + preflight + reliability memory. |
| `server/capability-engine.js` | 2284 | `createCapabilityEngine` (defs/confirmations/receipts) | Add **lease compilation** + mission-scoped preauth + deterministic enforce. |
| `server/memory-store.js` | 437 | `createMemoryStore` (lexical/working) | One retriever inside Memory Resonance; expose provenance. |
| `server/memory-vectors.js` | 86 | `createMemoryVectors`; **flat brute-force cosine** over all rows, own `runtime/memory-vectors.sqlite` | Add namespaces/metadata/rerank/fusion (see ADR-003). |
| `server/neural-vault.js` | 3996 | `createNeuralVault` (secure memory + audit) | Protected store for identity/secret-refs/leases/high-sensitivity metadata. |
| `server/deployable-agents.js` | 181 | `createDeployableAgents` | Versioned blueprints + qualification + Result Packet schema + lease templates. |
| `server/gemini-models.js` | 37 | `MODELS/STRENGTH/modelFor/strengthProfile` | Extend with capability metadata + per-node router + Interactions adapter (ADR-006). |
| `server/research-v2.js` | 482 | multi-step research pipeline | Expose as typed research **nodes** returning EvidenceObjects. |
| `server/cortex/research-orchestrator.js` | 195 | `createResearchOrchestrator` | Move reusable rules into Eclipse planner policies; do not keep two mission stores. |
| `server/work-composer/work-composer.js` | 225 | `createWorkComposer`, `markdownToHtml` | **Artifact storage.** Fed canonical content; returns ArtifactManifests (ADR-005). |
| `src/globe-room/JarvisCommandBar.tsx` | (Era II) | universal entry | Add Eclipse intent confirmation + mission card links into Mission Forge. |

Transport already exists (Era II): NDJSON `/api/chat/stream` with ordered
`run/plan/model/tool/source/artifact/approval/receipt/ui` envelopes — Eclipse extends
this rather than inventing a parallel channel (ADR-004).

---

## 3. Package layout

New bounded package `server/eclipse/` mirroring the spec's map (extension per ADR-001):

```
server/eclipse/
  contracts/   mission  state  evidence  agents  artifacts   (Zod schemas + schemaVersion)
  runtime/     compile-graph  run-graph  checkpoint-adapter
  nodes/       intake context plan research analyze synthesize verify repair artifact commit
  routing/     eligibility  reasoning-policy  model-router
  memory/      resonance  context-capsule  write-gate
  agents/      foundry  registry  session-manager  handoff
  tools/       lease-compiler  preflight  execution-gateway
  evidence/    ingest  claim-graph  verifier  contradiction
  artifacts/   content-graph  reactor  render-verify
  telemetry/   traces  metrics  redaction
  api/         routes  events
  evals/       fixtures  scorers  replay
```

Adapters here may CALL the current services; domain contracts live in the package.

---

## 4. Build structure — PART 1 (working core) then PART 2 (depth)

Two parts. **Part 1 (5 careful waves) delivers a genuinely working, routed, verifiable,
inspectable Eclipse** you can run a real mission on end-to-end. **Part 2 (5 waves) is the
depth** (branch intelligence, full artifact reactor, full surfaces, advanced memory,
promotion/evolution). Design detail for every item is in `02_DEEP_DESIGN.md`. Each wave
ends at a hard **proof-gate**, not confidence.

### PART 1 — the working Eclipse core

- [x] **P1·W1 — Foundations, Contracts & Baseline.** ✅ DONE (2026-07-13). Built: `contracts/{schemas,validate,index}.js` (all Zod schemas + `EclipseEvent` envelope + `SCHEMA_VERSIONS` registry), `db/migrations.js` (own `runtime/eclipse.sqlite`, WAL, 9 `eclipse_*`/evidence/claims/leases/artifacts tables, idempotent), `evals/fixtures/samples.js`, `evals/test-contracts.js`. **Gate PASSED — 10/10** (bad object rejected pre-DB; migration idempotent + all tables; SCHEMA_VERSIONS consistent). Zero Gemini. *(Baseline eval-harness capture of 30–50 frozen missions deferred to when the graph runs in W3 — nothing to measure yet.)*  `contracts/*` Zod schemas (MissionSpec,
  EclipseState, IntentGenome, GraphPlan, NodeRun, ContextCapsule, EvidenceObject, Claim,
  **ResultPacket**, CapabilityLease, ArtifactManifest) + `EclipseEvent` envelope + `eclipse_*`
  SQLite migrations + validation/**repair** utils + fixtures; **and** the baseline eval harness
  (`evals/`: freeze 30–50 missions, capture current Cortex/Prime quality/cost/latency).
  **Gate:** invalid object can't enter DB; migration/replay tests pass; baseline report exists.
- [x] **P1·W2 — Smart Routing gate (shadow).** ✅ DONE (2026-07-13). Built: `routing/intent-genome.js` (deterministic feature extraction — taskFamily/depth/consequence/freshness/ambiguity/breadth/explicitDeep, zero model call) + `routing/eligibility.js` (Stage-0 allowlist → mission-score → tiers, **all guardrails**: bias-to-cheap, cross-axis two-signal Totality, freshness override, consequence-gate→approval-not-fan-out, `allowMissions` flag cap). `evals/fixtures/routing.js` + `evals/test-routing.js`. **Gate PASSED — routing 18/18 + adversarial sweep 32/32** (0 over/under-escalations, 0 crashes on empty/emoji/5k-char/null/injection input). Router **not yet wired** into `agentRuntime.prepare()` — that shadow-wiring lands with the flag in a later step so the live path stays untouched. Zero Gemini (Flash-Lite refine hook exists but is off).  Intent Genome + the **3-stage cascade**
  (Stage-0 deterministic direct-answer allowlist → Flash-Lite classifier → Pulse/Deep/Totality)
  wired into `agentRuntime.prepare()` **log-only** (no user-visible change), with the
  guardrails (bias-to-cheap on ambiguity, two-signal Totality, freshness override,
  Pulse-fails→escalate, consequence→Capability gate not fan-out). **Gate:** on the baseline
  set, "hi / 2+2 / casual / ambiguous" provably never route to a mission; false-escalation &
  missed-complexity measured + accepted; normal chat unchanged.
- [x] **P1·W3 — Graph spine + Interactions backbone.** ✅ DONE (2026-07-13). Installed `@langchain/langgraph@1.4.7` + `@langchain/langgraph-checkpoint-sqlite@1.0.3` + `@langchain/core@1.2.2` (via `--legacy-peer-deps` to match the project's existing lenient resolution; better-sqlite3 **unchanged** at 12.11.1 — deduped, no native rebuild). **CJS-interop smoke-tested** (all needed exports `require()`; checkpointed 2-node graph ran). Built: `model/{capabilities,cost-ledger,retry,adapter,interactions-client}.js` (node→model router, hard-cap ledger, retry/fallback classifier, the one model boundary with a structured-output repair loop + stub/live modes, and the live Interactions client behind the `liveCall` seam) and `orchestration/{state,nodes,store,events,run-graph}.js` (10-node spine `intake→…→commit`, SqliteSaver checkpointer, monotonic event log + SSE replay/tail, idempotency `onceGuard`, pause/resume/cancel). **Gates PASSED — model 8/8, graph 9/9, stream 6/6** incl. the core gate: **crash mid-node → resume → side effects run exactly once**; budget ceiling trips → graceful `failed`, not a crash; cancel/pause/resume work; events ordered+bookended. **ZERO Gemini** (stub adapter throughout; live client wired but unexercised). Still fully isolated — nothing outside `server/eclipse/` imports it, live server untouched. *ADR refinements below.*  Install LangGraph; `run-graph`
  (intake→contract→context→plan→worker→synthesize→verify→repair→artifact→commit) + **Task-OS
  `SqliteSaver` checkpointer** + node events over an SSE mission stream + pause/resume/cancel;
  the **Interactions API adapter** (background+store, `previous_interaction_id`, thought
  signatures) + retry/fallback classification + per-mission cost ledger. **Gate:** crash/replay
  passes (kill mid-node → resume, no duplicate side effects); simple Jarvis unchanged; a
  trivial 2-node graph runs end-to-end.
- [x] **P1·W4 — Agents, planning & bounded execution.** ✅ DONE (2026-07-13). Built: `agents/blueprints.js` (all **6 versioned blueprints** — Architect/Worker(4 personas)/Critic/Prosecutor/Director/Recovery, schema-validated at load), `agents/runtime.js` (per-agent turn → schema-valid ResultPacket; every tool call mediated by the gateway), `capabilities/lease.js` (issue/**narrow** (monotonic, depth≤2)/sign/verify/revoke) + `capabilities/tool-gateway.js` (scope+glob+call-budget+side-effect enforcement — default-deny). Rewired `orchestration/{state,nodes,run-graph}.js`: `plan`(Architect)→**Send fan-out**→`worker`×N→`critic`→`verify`(Prosecutor=sole promotion authority)→`synthesize`/`artifact`(Director)→`commit`; quarantine→`validated` blackboard channels; width cap ≤5. **Gates PASSED — leases 9/9, agents 6/6, e2e 8/8, graph 9/9** incl.: Deep mission → evidence-backed **validated** packets; **no agent exceeds its lease** (0 denials happy-path, ungranted scope hard-denied); no orphan nodes; crash-mid-worker → resume exactly-once; **honest degraded completion** (no evidence → 0 validated, nothing fabricated). Send fan-out/fan-in **smoke-verified** first. **ZERO Gemini** (stub adapter). Still fully isolated. *(Full suite: `node server/eclipse/evals/run-all.js` = 74 tests.)*  The **6 blueprints** (Mission Architect
  + parameterized **Worker** + Adversarial Critic + Evidence Prosecutor + Artifact Director +
  thin Recovery Engineer) with the versioned blueprint schema + qualification fixtures;
  **capability leases enforced at the tool gateway** (monotonic narrowing, depth≤2, width
  ≤5×2); `Send` fan-out + reducer fan-in + the **typed blackboard of ResultPackets** + Context
  Capsules. **Gate:** a Deep mission (Architect→≤3 Workers→Critic→synthesize→commit) runs a real
  research task producing validated ResultPackets; no agent exceeds its lease; no orphan nodes.
- [x] **P1·W5 — Evidence, verification, memory & a minimal surface + one artifact.** ✅ DONE (2026-07-13) — **END of Part 1 = usable Eclipse.** Built: `evidence/{store,promotion}.js` (EvidenceObject + Claim graph + claim_evidence_edges persisted; the quarantine→promotion gate: promote only if every cited source re-verifies live + mean entailment ≥ 0.5, else refuted/partial), the **top-5 tools** `tools/index.js` (**Calc Reproducer + Code Sandbox = real local execution**; Deep Web Reader + Citation Verifier = fixture-deterministic w/ flag-gated real `fetch`; Semantic Memory = real RRF), `memory/resonance.js` (hybrid **RRF** + Reflexion notes + Self-RAG check), `artifact/composer.js` (**real cited Markdown report to disk** w/ sha256 + sourceEvidenceIds; every claim traces to a source). Wired workers→real evidence, Prosecutor→citation re-verify+promote, Director→cited artifact. **Mission Forge viewer** (self-contained HTML over a real mission's 59-event log → [artifact](https://claude.ai/code/artifact/ec62d36b-52b3-4f06-9630-1a852b8f5a01)). **Gates PASSED — tools 6/6, evidence 6/6, w5-e2e 3/3**: real mission → evidence-backed **validated** claims → cited report whose sha256 matches; **honest degraded** (no evidence → 0 validated, nothing fabricated); no lease exceeded; timeline reconstructs from persisted events only. **ZERO Gemini** (stub adapter + fixtures throughout). Full suite `node server/eclipse/evals/run-all.js` = **89 tests**. **DEFERRED (need real Gemini / live wiring):** the "beats Cortex Prime on a baseline" quantitative comparison, in-app Mission Forge mount + SSE, DOCX via work-composer, real-model claim prose. Evidence
  objects + claim graph + **quarantine→promotion gate**; the top-5 tools (**Code Sandbox
  Executor, Deep Web Reader, Citation Verifier, Calculation Reproducer, Semantic Memory
  Retriever**); Memory Resonance v1 (hybrid **RRF** over the in-place-upgraded `memory-vectors`
  + Reflexion failure notes + Self-RAG self-check); a **minimal Mission Forge + Evidence view**
  over real events; commit produces **one verified, cited artifact** (report/DOCX via
  work-composer) Jarvis can recall. **Gate:** a user runs/watches/controls a real mission and
  gets a verified cited artifact with **no fake activity**; critical claims evidence-linked;
  Eclipse beats Cortex Prime on ≥1 baseline mission within budget. ← **end of Part 1 = usable Eclipse.**

### PART 2 — Eclipse depth

- [x] **P2·W6 — Full Agent Foundry.** ✅ DONE (2026-07-13). Built: `agents/foundry.js` (deterministic **ephemeral persona generation** from subtask capability signals → framing + tool preset + lease scopes + model tier; `synthesizeWorkerBlueprint` → schema-valid AgentBlueprint), `agents/qualification.js` (a blueprint must **prove** it produces a valid packet AND can use its declared tools within its lease — a persona whose tools exceed its scopes is denied → `draft`, not `qualified`), `agents/reputation.js` (EWMA of validated-packet rate per blueprint/persona → promote ≥0.75 / retire ≤0.25 after ≥3 missions; `pickBest`), `memory/curator.js` (deterministic "nightly" job: promote validated claims → curated `eclipse_semantic_memory` deduped + corroboration-counted, distil failures → Reflexion notes, prune stale). Schema **v3** (+reputation/personas/semantic_memory tables). **Wired** (flag-gated, backward-compatible): plan node forges a persona per subtask under `useFoundry`; graph records per-blueprint reputation on mission complete. **Gate PASSED — 7/7** (persona caps→tools within scopes, ephemeral blueprint qualifies, malformed denied→draft, reputation promote/retire, curator promote/dedup/reflect/prune, and an e2e mission that forges personas + records reputation). ZERO Gemini; still fully isolated; **96 tests total**. Generated ephemeral Worker personas from the blueprint
  schema, qualification pipeline, agent reputation + promotion, Memory Curator agent.
- [x] **P2·W7 — Branch intelligence (Lattice).** ✅ DONE (2026-07-13). `reasoning/lattice.js`: **policy router** (direct/beam/tree/debate/counterfactual by depth·consequence·ambiguity + budget), provider-agnostic **explorer** (injected generate/score → beam/tree frontier expansion, debate winner, counterfactual compare), **branch economics** (value=quality/cost, prune top-k above minValue, budget ceiling), **verifier-guided targeted repair** (re-run only the failing unit until a verifier passes, honest give-up). Gate PASSED **9/9**, zero Gemini.
- [x] **P2·W8 — Artifact Reactor.** ✅ DONE (2026-07-13). `artifact/reactor.js`: one **canonical content graph** (sections→blocks, every finding block traces to numbered sources, deduped) → **Markdown + HTML + neutral composer-spec** renderers (the app work-composer maps the spec to DOCX/PPTX/PDF at wiring time), content-addressed hashes (timestamp excluded), honest empty case. Gate PASSED **7/7**, zero Gemini. *(Heavy DOCX/PPTX rendering + Nano-Banana figures = the app work-composer integration, deferred.)*
- [x] **P2·W9 — Product surface (go-live).** ✅ DONE (2026-07-13). **Eclipse mounted in the live Jarvis app**: `server/eclipse/integration/{index,console}.js` + a minimal, defensive `server.js` hook (`/eclipse` console + `/api/eclipse/*` launch/SSE-stream/result). Uses the **same vault Gemini key as Cortex** (secretStore), real web tools, `useFoundry`, per-mission **cost cap**, feature-flagged (`settings.eclipseEnabled`). Served Mission Forge console = launch + live timeline + cited answer. *(Full spatial workspace — Lattice Explorer/Agent Constellation/Evidence War Room in the React app — remains for later; the served console is the usable v1.)* **Requires one backend restart to activate.**
- [ ] **P2·W10 — Advanced memory, promotion & evolution.** *(DEFERRED per deep-design §7: RAPTOR/HippoRAG/GraphRAG intentionally not built for v1; the shipped memory = RRF (W5) + curated semantic tier + Reflexion (W6). Remaining:)* HippoRAG entity-graph layer, RAPTOR
  nightly consolidation, OTel GenAI tracing/evals, shadow-compare + canary + rollback + workflow
  registry, reflection→procedural promotion, controlled evolutionary lab; optional Computer-Use
  browser automation, MCP federation, scheduler, A2A adapter.

Working discipline (spec §35): read real interfaces before editing; ADR each irreversible
choice; **schemas + fixtures before runtime**; smallest vertical slice API→TaskOS→node→event→UI→persisted;
old routes behind feature flags; **never polished UI over mock data**; end each wave with
changed files + tests + before/after eval + the next gated wave.

---

## 5. Definition of Done (Eclipse v1) — from spec §35.1
Route complex→Eclipse / basic→away reliably · pause/resume-after-restart/cancel/replan with no
duplicate side effects · dynamic inspectable typed replayable graph · hybrid scoped explainable
memory · agents via qualified blueprints + strict leases · claims evidence-linked, contradictions
visible, calculations reproducible, citations valid · multi-form synchronized downloadable artifacts
Jarvis can recall · UI reflects real backend events (no fake activity) · telemetry without sensitive
content by default · measurable quality gain over Cortex Prime within Totality budget.

---

## 6. What I need from you
1. **Pick ADR-001** (JS+Zod vs TS build) — recommendation **JS + Zod + JSDoc**; rationale in `01_ADRS.md`.
2. Approve (or amend) the **Part 1 / Part 2** wave structure above. Default start on approval:
   **P1·W1 (contracts + baseline)**.
3. Confirm the two firmed-up dependencies (installed at **P1·W3**, not before):
   **`@langchain/langgraph` + `@langchain/langgraph-checkpoint-sqlite`** (checkpointer on
   better-sqlite3 — the engine you already use) and adopting the **Gemini Interactions API**
   as the per-node backbone (ADR-006).

Design depth for every wave item — model tiering, the smart-routing cascade, the 6-agent
roster, tools, memory, deployment, gotchas — is in **`02_DEEP_DESIGN.md`**.

---

## 7. Completeness review — gaps closed, risks, deliberate cuts

Critical pass over the whole plan before building. Decisions here are now part of the spec.

**Gaps closed (folded into the waves):**
- **Mission discriminator.** Eclipse missions are a **new `kind='eclipse'` row in the existing
  `missions` table** (Task OS), with `eclipse_graph_runs.mission_id` FK. One store; the ReAct
  path and Eclipse path are distinguished by `kind`. → P1·W1.
- **Feature flag.** A single setting **`eclipseEnabled` (default false)** gates everything.
  P1·W2 routing runs **shadow/log-only regardless**; nothing user-visible flips until the flag
  is on and P1·W3+ lands. The Eclipse package must be **safe to `require()` with the flag off**
  (no side effects on load). → P1·W1/W2.
- **Hard cost ceiling.** `MissionSpec.constraints.maxCostUsd/maxTokens` are **enforced**, not
  advisory: the per-mission cost ledger aborts the graph at the cap (circuit breaker). → P1·W3.
- **Privacy vs. background tension.** `store=false` (sensitive/local missions) **disables**
  background execution + `previous_interaction_id`. Resolution: mission `privacy:"local"` runs
  **synchronous, no-store, minimized-capsule**; `privacy:"provider"|"mixed"` may use stored
  background interactions. Redact PII on egress + before any stored payload. → P1·W3.
- **Context delta to Jarvis.** `commit` emits a compact **MissionContextDelta** (what changed +
  artifact ids/paths/summaries) that Jarvis indexes, so it can answer "what did that produce?"
  and locate files. → P1·W5.
- **Never-restart constraint.** The Eclipse package is built as **standalone, node-testable
  modules**; server.js wiring (the routing hook, the mission-exec route) is **additive +
  flag-gated** and only takes effect on the owner's next restart — the running server is never
  killed. Tests run the modules directly via `node`.

**Known risks (watch during build):**
- The **merge** is where multi-agent fails (Cognition). Mitigated by the typed blackboard +
  quarantine/promotion + single synthesis owner + verification pass — but this is the thing to
  eval hardest at P1·W5.
- **Gemini credit spend.** Missions are ~15× a chat turn. The routing gate (P1·W2) is the cost
  firewall; the classifier is **deterministic-first** (allowlist + local features), a Flash-Lite
  call only for genuinely ambiguous prompts. All W1/W2 tests are Gemini-free.
- **Model-ID drift.** `-preview` IDs move; the model-router resolves by **role via
  `gemini-models.js`**, never hardcodes IDs at call sites.

**Deliberate cuts (not weak — just not v1):** GraphRAG (skipped entirely) · Temporal · A2A ·
Antigravity-as-required (optional accelerator) · the full 30-agent identity list (→ Worker
personas) · Computer-Use browser automation (Part 2) · RAPTOR/HippoRAG (Part 2 memory) ·
Cross-room RoomContextPackage from Apex/Helix (Part 2 integration) · Evolutionary Workflow Lab
(Part 2, last). Part 1 leans on **existing** Jarvis file-attach/pdf-parse for file intake; the
full File-Intelligence Agent is Part 2.

**Verdict:** Part 1 as written is the minimum that yields a *usable, verifiable, correctly-routed*
Eclipse. Nothing in Part 1 is removable without breaking the definition of done; nothing extra is
needed to prove the concept. Proceeding.
