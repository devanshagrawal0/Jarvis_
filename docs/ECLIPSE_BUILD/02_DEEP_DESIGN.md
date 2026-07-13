# ECLIPSE — Deep Design (research-grounded)

Companion to `00_PLAN.md` (waves) and `01_ADRS.md` (decisions). This doc is the intricate
"how it actually works" layer: model routing, the smart-conversation gate, the agent
roster, orchestration wiring, tools, memory, and deployment — grounded in the current
Gemini/LangGraph/Interactions docs and the multi-agent literature (Anthropic multi-agent
research, Cognition/Manus context-engineering, ADK patterns, Perplexity routing,
Reflexion/Self-RAG/HippoRAG). Still plan-only; no code.

> **The one load-bearing truth.** A multi-agent mission costs **~15× a chat turn** and
> ~4× a single agent (Anthropic), and it only pays off on **breadth-first, separable**
> work. The failure mode is the **merge** (fragmented context → incoherent synthesis —
> Cognition's critique), *not* the fan-out. So Eclipse's value hinges on two disciplines:
> (1) **route almost everything to cheap Cortex** and only escalate real missions;
> (2) inside a mission, exchange **typed, verified ResultPackets via a blackboard** —
> never raw transcripts — with a single synthesis owner and a verification pass.

---

## 1. Model layer & routing tiers

Gemini naming is messy mid-2026; treat `gemini-models.js` as the source of truth and map
by **role**, verifying IDs against `models.list`. Practical tiering:

| Role in Eclipse | Tier (per research) | Registry key today | Used for |
|---|---|---|---|
| Router / classifier | **3.1 Flash-Lite** | `router` | Intent Genome, the escalation gate, extraction, cheap fan-out |
| Everyday chat (Cortex) | **3 Flash** (only free tier) / `main` 3.5-flash | `main` | Direct answers, simple tool turns |
| Agent workhorse (Workers) | **3.5 Flash** (flagship agentic) | `main` | Sub-agents, tool loops, Computer Use, Antigravity sandbox |
| Deep reasoning (Architect/Critic/Prosecutor/Synth) | **3.1 Pro** | `reasoning` | Planning, adversarial reasoning, verification judgment, long-form synthesis |
| Research node | Hosted **Deep Research** | `deepResearch(Max)` | Heavy multi-source research (background+store) |
| Embeddings | **Embedding 2**, MRL @ **768 or 1536 dims** | `embedding` | Memory retrieval + evidence dedup (keep the index small) |

**Adopt the Interactions API as the node backbone (refines ADR-006).** Each mission node
runs as a **stored `background=true` Interaction**: we get server-side durability through
Electron restarts, **observable execution steps** (free mission-timeline UI), **thought-
signature management** (required for coherent multi-step tool calls), `previous_interaction_id`
(state continuity + **implicit caching ≈90% off** repeated context), and resumable
streaming (`last_event_id`). `generateContent` stays the flagged compatibility path.

**Thinking policy per role:** Pro → `high`; Workers (3.5) → `medium`, escalate to `high`
only on a high-consequence subtask; Router → `minimal/low`. **Never send both
`thinking_level` and `thinking_budget` (400).** Keep temperature at the 1.0 default on
Gemini 3 (lowering it degrades reasoning).

**Caching strategy (biggest cost lever):** rely on **implicit** caching via
`previous_interaction_id`; add **explicit** caching only for the shared mission brief
reused across many Workers; mirror Antigravity's **~135k-token auto-compaction**
(summarize + evict old steps) for long missions.

---

## 2. THE SMART-ROUTING GATE — normal prompts stay cheap (highest priority)

Your explicit requirement: "hi", "what's 2+2", casual chat answer **directly on Cortex**;
only genuine breadth/depth work becomes a mission. Because a mission is ~15× the cost,
we **bias toward the cheap tier and escalate on evidence of insufficiency** (the opposite
of Perplexity, whose cost asymmetry is smaller). This lives at `agentRuntime.prepare()` in
the current pipeline — before `callGemini`.

### Intent Genome (cheap feature vector every turn)
Five genes, computed with regex/embeddings or one Flash-Lite call for hard cases:
- **Task family** — research/compare/find-all/analyze/build-a-plan vs greeting/thanks/fact/command
- **Depth** — # distinct sub-questions, conjunctions, entities, comparative terms
- **Consequence** — side effects / spend / publish / irreversible; user-flagged importance
- **Freshness** — "latest/current/2026", volatile entities → needs tools
- **Ambiguity** — underspecification / referential vagueness

### 3-stage cascade (cheapest first)
- **Stage 0 — deterministic direct-answer allowlist (~0 ms, no model).** Greetings, thanks,
  chit-chat, arithmetic, unit/time, single facts already in memory, basic device commands
  → **Cortex, answer now. Full stop.** This single rule makes "hi → mission" *impossible*.
- **Stage 1 — cheap classifier (Flash-Lite, ~50–150 ms).** Emits the genome + a
  `mission_score ∈ [0,1]`:
  `score = w1·depth + w2·family_research + w3·freshness_needs_tools + w4·consequence − w5·answerable_from_memory − w6·ambiguity`.
  **Ambiguity lowers the score** — an ambiguous prompt triggers a *clarifying question on
  Cortex*, never a speculative mission.
- **Stage 2 — tier assignment with hysteresis:**

| Tier | Band | Runtime | Budget |
|---|---|---|---|
| **Pulse** (Cortex / Cortex Prime) | `< 0.35` | Direct answer or single-agent + ≤1–2 tools | tiny |
| **Deep** (Eclipse, bounded) | `0.35–0.70` | Architect + ≤3 Workers, 1 wave, Critic optional | medium |
| **Totality** (Eclipse, full) | `> 0.70` **AND** (depth≥3 **OR** consequence high) | Full roster, ≤5 Workers × ≤2 waves, Critic+Prosecutor | high |

### Guardrails
- **Anti-over-trigger:** Stage-0 allowlist is deterministic; **bias-to-cheap on ambiguity**
  (answer on Cortex + *offer* "run a full research mission?" — user pull, not auto-push);
  **two-signal rule for Totality** (score alone never triggers the full roster);
  **cost-preview + confirm** for Totality via a LangGraph `interrupt()`.
- **Anti-under-trigger:** **Pulse-fails→escalate** (low self-check confidence or "I'd need
  to research this" auto-offers Deep); **freshness override** (volatile query memory can't
  satisfy → at least one tool Worker); **explicit intent** ("do a deep dive") hard-routes
  to Totality.
- **Consequence ≠ depth (orthogonal).** "Email the board my Q3 summary" is high-consequence
  but *not* research → Cortex Prime + Capability-Engine `interrupt()` approval, **not** a
  fan-out. Only high **depth/breadth** triggers Eclipse.

### Worked routing (encodes the rules)
`hi`/`thanks`→Cortex · `2+2`→Cortex · `capital of France`→Pulse · `turn on desk light`→Cortex tool ·
`current BTC price`→Deep-min (1 tool Worker, freshness) · `summarize this PDF`→Cortex Prime + extract (not a mission) ·
`compare LangGraph vs CrewAI vs AutoGen and recommend`→Deep/Totality · `research the competitive landscape and draft a brief`→Totality ·
`what should I do about the thing`→Cortex **clarifying question** · `email the board my summary`→Cortex Prime + Capability approval.

---

## 3. Agent roster — ship 6 blueprints, not 30 identities

Collapse the spec's ~30 named specialists into **Worker personas** (prompt + tool-preset +
lease template selected at spawn) — 30 hardcoded identities is the anti-pattern (Manus) and
the source of Anthropic's duplication bugs. **v1 = 6 versioned blueprints:**

| # | Blueprint | Model | Spawn | Output | Lease (authority envelope) |
|---|---|---|---|---|---|
| 1 | **Mission Architect** (orchestrator; absorbs "Research Cartographer" as its planning step) | Pro | Deep/Totality only | `MissionPlan` packet (subtasks w/ objective+format+tool-guidance+boundaries + requested lease + depth budget) | `plan.read_all + spawn(depth≤2) + no_external_writes` — planner is read-only |
| 2 | **Worker** (parameterized: research / data / code / extract personas = config, not code) | Flash (→Pro if flagged) | Architect `Send` per subtask, parallel | `quarantined:true` ResultPacket w/ evidence refs | narrow per-subtask, time-boxed; read/search default; any write needs Architect grant + receipt |
| 3 | **Adversarial Critic** | Pro | after a fan-out batch, pre-synthesis | `Critique` packets (per-claim challenges, refuted/needs-more, new subtasks) | `read_all + verify_search(≤3)` — no write |
| 4 | **Evidence Prosecutor / Verifier** | Pro (mechanical checks → code) | after Critic | packets flipped `validated` w/ verified citations, or dropped | `read_all + memory.write(promoted_only) + fetch(citation_verify)` — the **only promotion authority** |
| 5 | **Artifact Director / Synthesizer** | Pro | once validated set sufficient | artifact + `MissionResult` (cost/coverage) | `read_validated + artifact.write` |
| 6 | **Recovery Engineer** (thin) | Flash (mostly rules) | attached as supervisor | lifecycle transitions + `RecoveryReport` | `task_os.control + no_external` |

**Deferred:** Memory Curator → a **nightly deterministic consolidation job** (cheaper,
testable) for v1.1; live curator agent later.

`ResultPacket` (the handoff currency): `{packet_id, mission_id, agent_session_id, blueprint,
claim(1 sentence), status: validated|unverified|refuted|partial, confidence, evidence:[{uri,
quote≤25w, retrieved_at, hash}], provenance:{tools_used, lease_id, tokens}, quarantined,
next_actions?, cost}`.

Mirror Anthropic's model asymmetry: **Pro lead + Flash workers.**

---

## 4. Orchestration wiring — orchestrator-worker on a durable graph, typed blackboard

Compose all three (don't pick one): **orchestrator-worker = the *who*; LangGraph durable
graph = *how it runs*; typed blackboard = *what they exchange*.**

- **Fan-out:** Architect's router returns `Send("worker", subtaskState)[]` — count is
  runtime data (static edges can't do this). Each branch = a fresh Worker subgraph
  (`search→extract→self-check`).
- **Fan-in:** collect via a reducer `Annotated<ResultPacket[], concat>`; the **superstep
  barrier** holds all branches until every one finishes — this *is* the merge barrier.
- **Durability:** checkpointer saves state **between** supersteps → an interrupted wave
  resumes from the last completed superstep (this is the Recovery Engineer's substrate).
- **HITL / capability gates:** `interrupt()` persists and waits indefinitely for side-
  effecting leases (spend, send, write) — resumes on a `Command`.
- **Blackboard rule (the anti-fragmentation decision):** store **validated ResultPackets,
  never transcripts**; unique state key per branch to avoid fan-in races.
- **Session lifecycle** create→qualify(depth≤limit, budget, **dedup vs blackboard claims**)
  →lease→run→verify→**merge(promotion gate)**→expire, each wired to Task OS rows + receipts.
- **Guardrails:** **delegation depth ≤ 2** (Workers can't spawn Workers), **width ≤ 5×2
  waves**. **Capability leases** are signed, scoped, **monotonically narrowing** (child ⊆
  parent), enforced **at the MCP/tool gateway** (an agent that "decides" it needs `fs.write`
  is denied — its lease lacks the scope). Prompts are never the security boundary.

Node caveat: LangGraph checkpoints save **between** nodes, not inside — so keep nodes small
+ idempotent, and delegate genuinely long side-effecting steps to a **background Interaction
whose ID is the checkpointed state** (closes the durability gap with no heavy engine).

---

## 5. Special-tools catalog (verifiability is Eclipse's edge over chat)

**Top-5 to ship in Part 1** (they make missions *verifiable*):

| Tool | What | Powered by | Complexity |
|---|---|---|---|
| **Code Sandbox Executor** | reproducible Python/data runs, calc verification, figures | in-model `code_execution` (Python, 30s) + Antigravity remote for big jobs | S/M |
| **Deep Web Reader** | multi-hop fetch+extract+clean → evidence chunks | `url_context` + Search grounding; escalate to Deep Research | M |
| **Citation Verifier** | re-fetch each cited URL, check the claim is actually supported, flag hallucinated/dead sources | Pro judge + `url_context` + `validated` structured verdicts | M |
| **Calculation Reproducer** | independently re-derive every number, diff vs claimed | `code_execution` | S |
| **Semantic Memory Retriever** | task-typed embedding search over past missions/artifacts | Embedding 2 (768–1536d) | S |

**Later:** Spreadsheet/Data engine, File-Intelligence/OCR, Knowledge-Graph builder, Browser
Automation (Computer Use + Playwright, HITL on `safety_decision`), MCP remote-tool federation
(Notion/GitHub/Plaid/Kalshi), Scheduler/cron, Notification/handoff. Keep active tools **≤10–20**
per node; MCP names **snake_case**.

---

## 6. Capabilities we're missing — v1 must-haves
Escalation gate/cost router (§2) · context/caching management (implicit + explicit + ~135k
compaction) · **structured-output repair loop** (validate→feed-error→retry ×2–3) · **retry/
fallback classification** (429/503→backoff; 400→fix-don't-retry; 5xx→tier-fallback Pro→Flash)
· **per-mission token/cost accounting** with a hard cap · resumable/durable execution ·
sandboxed code-exec · (should-have) tool-result streaming to the UI, PII redaction on egress/
storage, **OpenTelemetry GenAI spans** (portable tracing, free Langfuse/Uptrace).

---

## 7. Memory architecture — adopt the cheap 80%, defer the graph builds

**v1 stores (all SQLite):** Working (blackboard, per-mission, checkpointed) · Episodic
(past missions + **Reflexion failure notes** keyed by task-signature) · Semantic (promoted
facts w/ citations, **FTS5 + vectors**) · Preference (existing Memory OS). **Promotion gate**
(control, not a store): only the Prosecutor + a deterministic citation-hash check writes to
Semantic — **evidence quarantine → promote on pass** is the single most important integrity
control (one hallucinating Worker can't poison shared state).

**Retrieval per agent:** query → FTS5 + vector → **Reciprocal Rank Fusion** → recency/
importance re-weight → top-k into a **minimal Context Capsule** (subtask spec + relevant
validated packets, *not* the full transcript — Manus's context isolation). Add a **Self-RAG
self-check** node inside each Worker subgraph before it emits a packet.

**Adopt now:** hybrid RRF fusion, context capsules, quarantine/promotion, Reflexion,
Self-RAG. **Defer:** RAPTOR (nightly offline consolidation, v1.1) · HippoRAG entity graph
(v1.2 "Memory OS graph layer") · **skip GraphRAG** (highest cost, relevance regressions,
overkill for one user). "Memory Resonance" = a decay+boost score on the fusion, not a new
subsystem.

This upgrades the current **flat brute-force cosine** in `memory-vectors.js` in place
(namespaces + metadata pre-filters + RRF + rerank), never touching the live 704 MB Neural
Vault (ADR-003).

---

## 8. Deployment & durability — two layers, no Temporal

- **Layer A (free, first):** every expensive node = a stored `background=true` Interaction.
  Google keeps it running through app restarts; we persist only **interaction IDs +
  `last_event_id`** and re-attach on relaunch.
- **Layer B (local):** LangGraph.js mission DAG + **`@langchain/langgraph-checkpoint-sqlite`
  `SqliteSaver`** (built on **better-sqlite3** — the same engine Jarvis already uses) →
  checkpoints, interrupts, HITL. This settles ADR-002's checkpointer.
- **Skip Temporal** (over-engineered for a personal local app); **Cloudflare DO alarms**
  optional later for cron/notify; **MCP** for remote tools; **A2A** optional adapter for
  remote agents. Local app stays authoritative.

---

## 9. Gemini gotchas to bake into the adapter
`thinking_level` XOR `thinking_budget` (400 if both) · don't drop temp below 1.0 on Gemini 3
· can't chain `previous_interaction_id` onto an `in_progress` interaction (poll to terminal)
· `store=false` disables background + `previous_interaction_id` (durable missions **must**
store; mind retention 55d paid/1d free; delete sensitive) · tools/system_instruction/
generation_config are **per-interaction**, re-send each turn · Deep Research: MCP-only tools,
no structured output, 60-min cap, needs background+store · code-exec: Python-only, 30s, no
custom libs, matplotlib-only media · Computer Use: client executes actions, 0–1000 coords,
**must** implement `safety_decision` HITL · Antigravity: no temp/top_p/max_output_tokens, no
file_search/computer_use/maps inside it, function calling needs stateful mode · tools ≤10–20,
MCP names snake_case.
