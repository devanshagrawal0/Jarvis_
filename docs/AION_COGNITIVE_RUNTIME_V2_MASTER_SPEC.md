# AION Cognitive Runtime V2 - Master Architecture and Build Specification

Status: implementation-grade design; not yet authorized for production build  
Created: 2026-08-03  
Supersedes for future design: `docs/newmodel.md`  
Preservation rule: the original `newmodel.md` remains unchanged as the historical design record  
Scope: JARVIS flagship adaptive cognitive runtime above Cortex and Eclipse  

---

## 0. Executive verdict

AION should be built, but not as a giant prompt, a renamed Gemini model, an always-on agent swarm, or a second Eclipse graph.

The strongest buildable definition is:

```text
AION =
  deterministic cognitive kernel
  + adaptive model and compute governor
  + bounded dynamic mission graphs
  + governed specialist-agent fabric
  + Memory vNext context interface
  + evidence and claim truth system
  + permissioned universal tool gateway
  + deterministic and independent verification
  + canonical knowledge-package compiler
  + durable local mission runtime
  + continuous evaluation and route learning
```

Gemini supplies inference and managed capabilities. LangGraph supplies bounded graph execution and checkpoints. MCP supplies a tool interoperability protocol. Memory vNext supplies personal, project, room, artifact, temporal, and procedural context. AION supplies the policy that decides what is necessary, what is sufficient, what is trusted, what is allowed, and when work is complete.

The most important design choice is restraint: AION becomes powerful by spending computation only where it changes the result. Most turns must not create a graph or spawn an agent. Difficult work may deploy a carefully selected team, branch competing hypotheses, perform research, use tools, generate artifacts, and verify the result. The decision is made from observed task demand and uncertainty, not branding or a fixed effort label.

### 0.1 What is retained from V1

- The Cognitive Contract concept.
- Adaptive rather than fixed orchestration.
- Hypothesis exploration.
- Evidence atoms and claim-level verification.
- Specialist agents with capability boundaries.
- A canonical knowledge package feeding multiple artifact formats.
- Durable missions, progress visibility, and resumability.
- An explicit quality, latency, and cost evaluation program.

### 0.2 What is replaced or corrected

| V1 area | Problem | V2 correction |
|---|---|---|
| Personal Memory Lattice | Would duplicate the newly built Memory vNext system | AION becomes a client of Memory vNext through versioned query, context, influence, correction, artifact, and procedure contracts |
| Execution classes | Four labels are too coarse and can become hard boundaries | Use a continuous Work Profile plus user effort ceiling; named lanes are observable presets, not rigid workflows |
| Cognitive auction | Undefined and potentially costs model calls before useful work starts | Use deterministic eligibility and cached capability matching first; request bids only from a tiny shortlisted set when marginal value is uncertain |
| Hypothesis graph | Mixes execution, claims, evidence, and hidden reasoning | Separate Task DAG, Claim-Evidence Graph, Decision Record, and private ephemeral scratch state |
| Verification tribunal | Implies one powerful judge can certify everything | Use deterministic verification first, independent recomputation/source checks second, calibrated model judges only as advisory signals |
| Memory era | Rebuilds memory inside AION | Replace with a Memory vNext integration and cutover gate |
| Agent fabric | Missing recursion, concurrency, handoff, isolation, and failure rules | Add a governed Agent Foundry, blueprint registry, lease lifecycle, context quarantine, fan-out limits, typed packets, and promotion gates |
| Speed architecture | Provides targets without an execution mechanism | Add zero-call paths, staged routing, latency reservations, cancellable speculation, context budgets, provider classes, and asynchronous missions |
| Model mapping | Static and provider-name coupled | Add a versioned Capability Registry with health, price, latency, privacy, feature, and fallback descriptors |
| Research loop | Good principles but no measurable coverage or stop rule | Add a Research Coverage Contract, claim frontier, source-role quotas, contradiction debt, and marginal-evidence stop policy |
| Reliability | Lists controls but lacks state semantics | Add event-sourced mission state, idempotency, outbox receipts, typed retry matrix, leases, heartbeats, checkpoint ownership, and recovery invariants |
| Evaluation | Metrics exist without release mechanics | Add frozen corpora, counterfactual routing, shadow mode, mutation testing, canaries, rollback thresholds, and per-route scorecards |

### 0.3 Current-system reality that governs this design

Memory vNext contains the required service modules and 32 construction waves, including retrieval planning, context compilation, temporal graphs, artifacts, procedural learning, room manifests, and Eclipse integration contracts. The historical wave ledger records these as isolated/gated construction. A later live inspection on 2026-08-03 shows that activation has progressed into a guarded canary, but only for selected domains.

Observed authority state:

| Domain | Current authority |
|---|---|
| Explicit memory commands | Memory vNext |
| Conversation runtime/journaling | Memory vNext |
| Retrieval and context used for answers | Legacy |
| Room integrations | Legacy |
| Final answer authority during shadow | Legacy |

The runtime reports `guarded_context_canary` / `shadowing`. This is not “fully live” and not “purely isolated.” It is a partial, domain-by-domain cutover.

Therefore:

1. AION may be developed against Memory vNext interfaces and the guarded canary.
2. AION must resolve authority per domain through the existing authority resolver.
3. AION must never directly read or write legacy or vNext database files.
4. AION production activation is blocked until retrieval/context and required room integration authority gates are complete.
5. AION must not claim full task continuity, agent learning, artifact memory, or cross-room awareness merely because repository classes exist.
6. Shadow comparison must reuse one captured intent/enrichment so it creates no duplicate Gemini calls.

---

## 1. Product identity and boundaries

### 1.1 Product family

| Product | Purpose | Normal execution |
|---|---|---|
| Cortex | Everyday personal JARVIS | Fast conversational response, memory-aware context, tools when needed, bounded research |
| Eclipse | Explicit durable mission mode | Visible structured graph, research/analysis mission, evidence and artifacts |
| AION | Adaptive flagship cognitive runtime | Chooses direct conversation, a tool transaction, research, an Eclipse-style mission, specialist agents, or artifact production based on demand |

AION is not automatically “more verbose” than Cortex. AION may answer a simple prompt faster than Eclipse because it can prove that deeper machinery is unnecessary.

### 1.2 AION is a runtime, not a trained foundation model

Do not claim that AION is a new foundation model unless model weights are actually trained or fine-tuned. The product value comes from routing, context, tools, research, verification, memory integration, durable execution, and output compilation around one or more inference providers.

### 1.3 Non-goals

AION will not:

- Spawn subagents for greetings or ordinary questions.
- Display or promise raw private chain-of-thought.
- Send the full memory database to a model.
- Treat retrieved text as instructions.
- Let agents call tools without a gateway.
- Let an LLM self-certify side effects or factual correctness.
- Store agent scratchpads as personal truth.
- Duplicate HELIX, APEX, Forge, Eclipse, or domain-owned databases.
- Use a provider-managed research agent for every web query.
- Hardcode model names into product behavior.
- Equate longer output with higher effort or higher quality.
- Learn procedures from unverified success claims.
- silently retry external commits.

### 1.4 Owner-visible effort controls

Use three effort ceilings:

| Effort | Meaning | What it does not mean |
|---|---|---|
| Swift | Optimize for immediate useful response | It does not forbid tools or freshness checks when required |
| Balanced | Default adaptive quality/latency policy | It does not force a medium-size workflow |
| Sovereign | Permit maximum useful depth | It does not force agents, searches, or token expenditure when value is negligible |

The user chooses the ceiling. AION chooses the amount actually consumed beneath that ceiling.

---

## 2. Framework decision

### 2.1 Selected stack

```text
JARVIS UI / conversation ingress
        |
        v
AION deterministic cognitive kernel (custom TypeScript)
        |
        +-- Direct response / one-tool transaction
        |
        +-- Bounded LangGraph mission epoch
        |
        +-- Provider-managed specialist through adapter
        |
        +-- Background artifact or evaluation job
        |
        +-- Memory vNext context and knowledge ports
        |
        +-- MCP / native tools through one capability gateway
        |
        +-- Gemini Interactions API through one model gateway
```

Day-one components:

- Node.js 20+ and the existing CommonJS application architecture.
- TypeScript contracts where new AION modules are introduced.
- Zod for runtime validation and versioned schemas.
- `@langchain/langgraph` for bounded dynamic mission graphs.
- SQLite LangGraph checkpointer for local graph checkpoints.
- Existing Memory vNext ledger, outbox, supervisor, task runtime, and encrypted stores as reusable primitives.
- `@google/genai` and Gemini Interactions API behind one provider adapter.
- `@modelcontextprotocol/sdk` plus native JARVIS tools behind one capability gateway.
- OpenTelemetry-compatible spans and metrics with content disabled by default.

The local mission ledger should reuse the Memory vNext single-writer, ledger, outbox, supervisor, task-runtime, and encryption primitives where their contracts fit. It must not create a competing operational database with duplicate task/checkpoint authority. `MissionRuntimePort` is the AION-facing boundary; the chosen local implementation owns each mission record once and publishes projections/pointers to other views.

### 2.2 Why LangGraph remains the graph runtime

The codebase already contains LangGraph JS, SQLite checkpointing, `Send` fan-out, pause/resume, agent blueprints, leases, evidence promotion, and tests under `server/eclipse`. LangGraph's current JavaScript persistence model provides step checkpoints, interrupts, subgraphs, pending writes, and recovery. Reusing it avoids a language boundary and lets AION generalize proven Eclipse components.

LangGraph is not the authority for:

- Personal memory.
- Project or room truth.
- External side-effect truth.
- Artifact identity.
- Provider billing truth.
- Long-term procedure learning.

Its checkpoints are disposable execution projections. Canonical mission events and side-effect receipts live in the JARVIS durable runtime ledger.

### 2.3 Why Google ADK is not the day-one core

ADK is a credible reference and future adapter, especially for Gemini-native agents. Its latest graph and dynamic-workflow capabilities are strongest in Python and Go, while this application is a Node/Electron system and already uses LangGraph JS. Adding ADK now would duplicate sessions, memory, events, artifacts, agents, and graph execution.

Use ADK only if one of these becomes true:

- A separate Python/Go service is intentionally introduced.
- A provider-hosted ADK agent has a measured advantage on a specific specialist task.
- Migration tests show a clear quality/reliability win after accounting for integration overhead.

### 2.4 Why Temporal is not a day-one dependency

Temporal is excellent for distributed crash-resistant business workflows, but day-one AION is a local desktop system with SQLite, an event ledger, outbox workers, a supervisor, and LangGraph checkpoints. Adding a Temporal service would introduce another control plane, another state authority, operational setup, and weaker offline ergonomics.

Define a `MissionRuntimePort` now with:

- `start`
- `signal`
- `lease`
- `heartbeat`
- `checkpoint`
- `retry`
- `pause`
- `resume`
- `cancel`
- `wait`
- `complete`
- `fail`

Add a Temporal adapter later only when measured requirements include distributed workers, high availability, cloud execution across device outages, multi-day schedules at scale, or cross-device ownership transfer. The local SQLite implementation remains the default.

### 2.5 Why CrewAI, AutoGen, or an always-on supervisor are rejected

They add another abstraction over agents without solving AION's actual hard problems: memory authority, tool permissions, evidence truth, side-effect receipts, cost routing, and durable local state. AION needs explicit contracts and controlled dynamic graphs, not a collection of role prompts talking to one another.

---

## 3. System invariants

These conditions are architectural laws, not recommendations.

1. One model-call gateway spends provider credits.
2. One tool gateway authorizes and records capability use.
3. One active memory authority is resolved per domain.
4. One canonical mission ledger records durable execution truth.
5. One external side effect has one idempotency key and one final receipt.
6. Every model, prompt, agent, tool, context pack, policy, and schema has a version.
7. Untrusted content has data authority only and can never become instruction authority.
8. Agent output begins quarantined and cannot become accepted truth without promotion.
9. Graph checkpoints are not personal memory or side-effect truth.
10. Provider conversation state is a cache/continuation optimization, not canonical memory.
11. A result can be complete, partial, blocked, failed, cancelled, or awaiting owner input; these are not interchangeable.
12. Retrying a read may be automatic; retrying a commit requires an idempotency-safe receipt protocol.
13. An LLM judge alone cannot certify a high-consequence factual, code, numeric, or side-effect claim.
14. AION may expose plans, evidence, assumptions, decisions, actions, and concise reasoning summaries, but never fabricate hidden internal reasoning.
15. Retrieval must be budgeted and scoped before data leaves storage.
16. Memory writes are proposals unless the active Memory vNext command contract explicitly authorizes mutation.
17. Agent fan-out, depth, recursion, concurrency, and lifetime are bounded.
18. A branch without expected information gain or verification value is pruned.
19. A provider failure cannot silently lower required freshness, privacy, or verification.
20. No production activation occurs without replay, shadow, canary, rollback, and owner acceptance evidence.

---

## 4. Four-plane architecture

### 4.1 Control plane

Owns:

- Cognitive Contract.
- Work Profile.
- route selection.
- model and tool capability selection.
- agent deployment.
- budgets and reservations.
- permission policy.
- stop/continue decisions.
- mission state transitions.

It must be mostly deterministic. Model-assisted arbitration is allowed only where lexical/rule routing is genuinely uncertain.

### 4.2 Knowledge plane

Owns:

- Memory vNext context packages.
- evidence atoms.
- claims and contradictions.
- decisions and assumptions.
- research coverage.
- room pointer manifests.
- artifact lineage.
- influence receipts.

It distinguishes ground truth, observation, inference, proposal, contradiction, and stale knowledge.

### 4.3 Execution plane

Owns:

- model calls.
- tool transactions.
- agent sessions.
- LangGraph epochs.
- browser/desktop/filesystem/code operations.
- background work.
- retries, heartbeats, leases, and cancellation.

No executor may promote its own output to truth or expand its own permissions.

### 4.4 Experience plane

Owns:

- traces and content-free metrics.
- verified outcomes.
- route scorecards.
- agent qualification and reputation.
- failure and counterexample cases.
- procedure candidates.
- replay corpora.
- shadow and canary comparisons.

Learning is asynchronous and promotion-gated. Live requests do not mutate routing logic directly.

---

## 5. Canonical request lifecycle

### 5.1 State machine

```text
accepted
  -> classified
  -> context_planned
  -> context_ready
  -> route_selected
  -> executing
       -> waiting_owner
       -> waiting_external
       -> recovering
       -> executing
  -> verifying
       -> repairing
       -> verifying
  -> composing
  -> delivering
  -> committing
  -> completed

Terminal alternatives:
  partial | blocked | failed | cancelled | expired
```

Every transition requires:

- prior state.
- event ID.
- actor.
- reason code.
- policy version.
- timestamp.
- input/output references.
- idempotency key where relevant.
- trace and mission IDs.

### 5.2 Stage 0 - ingress normalization

Normalize text, attachments, room, focused files, voice transcription, current application state, time, locale, and active conversation branch into a `RequestEnvelope`. Preserve the original user input exactly.

Do not make a provider call here.

### 5.3 Stage 1 - deterministic fast-path classification

Extract cheap observable features:

- greeting/acknowledgement.
- direct recall phrase.
- continuation/reference words.
- explicit web/freshness request.
- explicit file, browser, desktop, code, or artifact intent.
- side-effect verbs.
- number of named deliverables.
- domain count.
- consequence keywords.
- ambiguity and missing identifiers.
- attachment types.
- deadline or background intent.

Output one of:

- `zero_call_response`
- `single_inference`
- `single_tool_transaction`
- `bounded_agent_loop`
- `durable_mission`
- `managed_research`
- `artifact_pipeline`
- `clarification_required`

### 5.4 Stage 2 - lazy Cognitive Contract

Do not build the full contract for every turn. Use three materialization levels.

#### Compact contract

For conversation and one-step actions:

- literal request.
- response requirement.
- freshness requirement.
- memory need.
- side-effect class.
- completion criterion.

#### Standard contract

Adds:

- deliverables.
- constraints.
- known entities.
- tool requirements.
- verification requirements.
- ambiguity ledger.
- output/audience style.

#### Mission contract

Adds:

- dependency graph.
- acceptance tests.
- research coverage contract.
- artifact specification.
- budgets/reservations.
- agent/tool capability plan.
- risk and approval matrix.
- pause/resume/cancel semantics.
- partial-delivery rules.

### 5.5 Stage 3 - memory-need and context plan

AION calls the Memory vNext retrieval planner. It does not invent a second retrieval router.

The planner returns one of:

- `none`
- `working_only`
- `exact`
- `hybrid`
- `live_domain`
- `deep`

The plan contains token, latency, cost, scope, privacy, temporal, and consistency budgets. AION may request a narrower plan; it may not broaden scope or weaken policy.

### 5.6 Stage 4 - continuous Work Profile

Compute a feature vector rather than one hard complexity label.

```json
{
  "ambiguity": 0.0,
  "dependencyDepth": 0.0,
  "domainBreadth": 0.0,
  "freshnessNeed": 0.0,
  "privateContextNeed": 0.0,
  "toolIntensity": 0.0,
  "sideEffectRisk": 0.0,
  "verificationDifficulty": 0.0,
  "artifactComplexity": 0.0,
  "expectedDuration": 0.0,
  "parallelBenefit": 0.0,
  "uncertainty": 0.0
}
```

This profile controls each resource independently. A prompt may require fresh search but little reasoning, or deep reasoning with no web access.

### 5.7 Stage 5 - route selection

Use a three-tier router:

1. Deterministic rules for obvious cases, permissions, freshness, and known procedures.
2. Experience-boundary lookup from verified similar cases.
3. Cheap semantic arbitration only when the first two disagree or confidence is below threshold.

Router output includes:

- chosen route.
- rejected routes.
- reason codes.
- confidence.
- predicted latency band.
- predicted calls/tokens.
- uncertainty budget.
- escalation triggers.
- route-policy version.

### 5.8 Stage 6 - execute, observe, replan

AION plans only a short horizon. It executes one action or a bounded independent batch, observes real results, updates the Task DAG and Work Profile, and selects the next action.

This receding-horizon loop prevents a beautiful initial plan from surviving after the environment has changed.

### 5.9 Stage 7 - verify and repair

Verification runs against explicit completion criteria. Failures identify the smallest invalid unit: one claim, source, calculation, file section, tool action, or artifact render. Repair only that unit and its dependents.

### 5.10 Stage 8 - compose and deliver

The response composer selects structure from the user's request, not a global template. It receives accepted claims, uncertainty, relevant personal context, verified tool outcomes, artifact links, and style constraints.

### 5.11 Stage 9 - commit experience

Persist mission state, receipts, evidence, artifacts, and verified outcome signals. Submit memory and procedure candidates through Memory vNext governance. Never store raw hidden reasoning or treat a fluent answer as a successful outcome.

---

## 6. Adaptive compute governor

### 6.1 Objective

The governor maximizes verified user value, not reasoning length.

```text
NetValue(action) =
    P(action changes answer) * expected quality gain
  + expected information gain
  + expected verification gain
  + expected task-completion gain
  + personalization gain
  - latency penalty
  - provider cost penalty
  - context growth penalty
  - duplicate-work penalty
  - operational risk penalty
  - permission friction penalty
```

The quantities are initially heuristic and versioned. They become calibrated from frozen replay and verified outcomes, never from unreviewed live self-feedback.

### 6.2 Resource reservations

Track separately:

- input tokens.
- output/thinking tokens.
- memory/context tokens.
- tool calls.
- web searches.
- page/document reads.
- code/sandbox time.
- agent count.
- branch width/depth.
- elapsed wall time.
- provider monetary cost.
- owner-attention requests.

One pool cannot silently consume another. A long search campaign cannot eliminate the output budget needed to explain its result.

### 6.3 Escalation triggers

Escalate only when at least one is true:

- required current fact is unavailable.
- exact memory lookup is insufficient.
- tool result contradicts the working hypothesis.
- dependency count crosses the route's proven boundary.
- consequence of error requires independent verification.
- evidence coverage is below contract.
- a calculation or code path lacks deterministic validation.
- uncertainty remains above the accepted threshold.
- artifact validation fails.
- the chosen route resembles historically failed cases.

### 6.4 Stop conditions

Stop when all required criteria are satisfied and the expected value of the best next action is below threshold.

Hard stops:

- contract completed.
- owner cancels.
- deadline expires.
- permission denied.
- required provider/tool unavailable with no contract-preserving fallback.
- branch/call/time ceilings reached.
- repeated identical failure.
- remaining uncertainty is irreducible and disclosed.

### 6.5 Token-efficiency mechanisms

1. Zero-provider-call greeting and control paths.
2. Exact retrieval before semantic retrieval.
3. Role-scoped context packs for every agent.
4. Context quarantine: subagent tool output does not enter the parent prompt automatically.
5. Structured packets instead of full essays between agents.
6. Content-addressed observation store; prompts use references plus selected excerpts.
7. Recent-action window plus durable task notebook, not full tool history.
8. Prefix-stable provider instructions for cache reuse.
9. Provider state used only where privacy policy permits.
10. Batch/Flex lanes for non-urgent offline evaluation or extraction.
11. Cancellable speculative retrieval.
12. Deduplication by source, claim, semantic cluster, and task signature.
13. Single-agent default; multi-agent deployment must beat a measured marginal-value threshold.
14. Summarize only after preserving the original referenced evidence.
15. Compress suspended branches out of hot context.
16. Route simple extraction/ranking to deterministic code or the cheapest qualified model.
17. Never ask several agents to write the same entire answer unless comparison is the explicit experiment.

### 6.6 Latency lanes

| Lane | Target behavior | Typical machinery |
|---|---|---|
| Reflex | Immediate conversation/control | Local classifier, optional exact memory, zero or one model call |
| Focus | Useful answer in seconds | Bounded context, one primary inference, optional one/few tools |
| Deliberate | Structured analysis | Task DAG, targeted retrieval, selective tools, critic only where needed |
| Expedition | Asynchronous complex mission | Durable graph epochs, specialists, research, computation, artifacts, iterative verification |

These are observability lanes derived from the Work Profile. They are not four hardcoded pipelines.

---

## 7. State representation: four graphs, not one confused graph

### 7.1 Task DAG

Represents work to perform.

Node types:

- objective.
- deliverable.
- subtask.
- observation.
- tool transaction.
- approval.
- verification.
- artifact operation.
- wait condition.

Edge types:

- depends on.
- unlocks.
- invalidates.
- can run with.
- requires approval.
- produces.

### 7.2 Claim-Evidence Graph

Represents what may be true and why.

Node types:

- claim.
- evidence atom.
- counterevidence.
- calculation.
- assumption.
- uncertainty.

Edge types:

- supports.
- contradicts.
- entails.
- scoped by.
- derived from.
- stale after.

### 7.3 Decision Record

Represents choices made from accepted information.

Fields:

- decision.
- alternatives considered.
- constraints.
- accepted claims.
- unresolved uncertainty.
- selected option.
- reason summary.
- reversibility.
- owner approval when applicable.

### 7.4 Ephemeral cognitive scratch

The model may reason privately within provider/runtime boundaries. This scratch state is not persisted as user memory, not treated as evidence, not shown as raw chain-of-thought, and not sent to other agents. Only structured outputs such as assumptions, plans, claims, tool intents, and concise reasoning summaries cross boundaries.

### 7.5 Why the separation matters

- Completing a task does not prove a claim.
- Supporting a claim does not authorize an action.
- A tool receipt does not become personal memory.
- A model hypothesis does not become room truth.
- A decision can remain valid while one execution route fails.
- Corrections can invalidate dependent claims/artifacts without deleting the historical mission.

---

## 8. Memory vNext integration

### 8.1 Authority model

AION does not own long-term memory. It consumes the active authority selected by `server/memory-vnext/authority-resolver.js` and the versioned Memory vNext boundary.

Canonical responsibilities remain with Memory vNext:

- conversation ingress journal.
- branch-local conversation state.
- tasks, checkpoints, agents, and tool receipts.
- semantic episodes and lifecycle.
- sources, evidence, entities, aliases, and hierarchy.
- bitemporal assertions and conflicts.
- personal facts, preferences, directives, goals, and commitments.
- truth maintenance and verified forgetting.
- exact, lexical, vector, and graph retrieval.
- adaptive context packs and influence receipts.
- cache fabric.
- artifacts and multimodal parts.
- verified experiences and procedures.
- HELIX, APEX/Forge, Eclipse, Mesh, and co-op pointer manifests.

### 8.2 AION memory ports

Define these logical interfaces; implementations may map to existing repository/service methods.

```ts
interface MemoryNeedPort {
  plan(request: MemoryNeedRequest): Promise<RetrievalPlan>;
}

interface ContextPort {
  compile(request: ContextCompileRequest): Promise<ContextManifest>;
  reproduce(manifestId: string): Promise<ContextManifest>;
  release(leaseId: string): Promise<ReleaseReceipt>;
}

interface KnowledgePort {
  exact(query: ExactQuery): Promise<CandidateSet>;
  retrieve(plan: RetrievalPlan): Promise<CandidateSet>;
  traverse(query: GraphQuery): Promise<GraphResult>;
}

interface MemoryCommandPort {
  propose(candidate: MemoryCandidate): Promise<CandidateReceipt>;
  correct(command: CorrectionCommand): Promise<CommandReceipt>;
  forget(command: ForgetCommand): Promise<ClosureReceipt>;
}

interface InfluencePort {
  record(receipt: InfluenceReceipt): Promise<void>;
}

interface ArtifactMemoryPort {
  register(input: ArtifactRegistration): Promise<ArtifactVersion>;
  resolve(query: ArtifactQuery): Promise<ArtifactResult>;
}

interface ProcedurePort {
  find(signature: TaskSignature): Promise<ProcedureCandidate[]>;
  submitOutcome(outcome: VerifiedOutcome): Promise<ExperienceReceipt>;
}
```

### 8.3 Context package contract

Every context pack contains:

- manifest ID and hash.
- request/mission/branch/scope IDs.
- authority snapshot.
- context-profile version.
- policy version.
- canonical and projection watermarks.
- ordered blocks.
- source/version references.
- privacy/provider eligibility.
- token count and reservations.
- conflicts and abstention flags.
- lease and expiry.

Ordered block precedence:

1. Protected owner directives.
2. Current request and Cognitive Contract.
3. Branch-local conversation state.
4. Active task state and commitments.
5. Exact personal/project facts.
6. Relevant episodes.
7. Room manifests and artifact pointers.
8. Evidence and accepted claims.
9. Conflicts, corrections, and temporal warnings.
10. Clearly fenced untrusted data.

### 8.4 Agent-scoped context

Each agent receives the smallest context slice sufficient for its role:

- original request reference.
- assigned task contract.
- selected context blocks.
- relevant evidence/claim frontier.
- permitted artifact references.
- capability lease.
- output schema.

An agent does not receive the user's entire personal profile, unrelated room state, sibling-agent scratch, or raw conversation history.

### 8.5 Provider state versus owner memory

Gemini `previous_interaction_id` may reduce repeated context and improve continuity, but provider state is temporary and subject to provider retention. As documented on 2026-08-03, stored paid-tier Interactions may be retained for up to 55 days, with shorter project retention configurable. It must be indexed as an execution optimization with an expiry and privacy class. AION must be able to reconstruct required context from local canonical records without it.

Use `store=false` for stateless/private calls when background execution and provider continuation are not required. Use stored interactions only under an explicit provider-retention policy.

### 8.6 Memory-write policy

AION may automatically propose:

- explicit stable personal facts.
- explicit preferences.
- project decisions.
- commitments.
- corrections.
- artifact lineage.
- verified task outcomes.

AION must not automatically promote:

- inferred sensitive facts.
- agent speculation.
- unverified web content.
- prompt-injection text.
- transient mood guesses.
- raw reasoning.
- failed or ambiguous procedures.
- provider-generated profile summaries without episode provenance.

### 8.7 Cross-room behavior

HELIX, APEX/Forge, and Eclipse publish pointer manifests. AION queries those manifests through Memory vNext and follows pointers to the domain owner when full or live data is required.

Examples:

- HELIX: current project, research plan, evidence/claim lineage, open loops, report/artifact pointers.
- APEX/Forge: strategy, dataset, signal, test, outcome, report, market freshness, graph version, branch lineage.
- Eclipse: mission, branch, agent, evidence, claim, artifact, task, and outcome pointers with visibility/trust scopes.

AION does not copy raw room databases into global memory.

### 8.8 Cutover compatibility

Before Memory vNext activation:

- AION uses the authority resolver.
- all vNext writes remain gated.
- vNext context may run in shadow against a shared intent snapshot.
- legacy and vNext outputs are compared without double provider calls.
- no route claims vNext provenance unless the pack was actually produced by vNext.

After cutover:

- commands activate first.
- conversation authority activates next.
- retrieval/context activates next.
- room manifests activate last.
- rollback changes authority pointers and never rewrites history.

### 8.9 Verified live population snapshot

The protected canary store inspected on 2026-08-03 is:

`C:\Users\devan\AppData\Local\Jarvis\memory-vNext\candidate-localhost\memory-vnext.sqlite`

Inspection showed SQLite schema version 30, WAL and foreign keys enabled, and `quick_check = ok`.

| Component | Records |
|---|---:|
| Conversations | 55 |
| Turns | 268 |
| Assertions | 1,243 |
| Assertion versions | 1,249 |
| Retrieval documents | 2,483 |
| Retrieval plans | 561 |
| Context packs | 552 |
| Context-pack items | 2,003 |
| Graph nodes | 2,527 |
| Graph edges | 4,710 |
| Conversation-state heads/topics/working slots/referents/open loops/focus | 0 |
| Context leases and influence receipts | 0 |
| Room manifests and packages | 0 |
| Tasks/steps/agent sessions/tool invocations | 0 |
| Consolidation proposals and procedures | 0 |
| Cache entries and embeddings | 0 |
| Registered artifacts | 0 |

Interpretation: storage, assertions, retrieval plans, packs, and graph projections are populated. Rich working conversation state, influence, rooms, agents, procedures, caches, embeddings, and artifacts are implemented but not participating in the live path yet.

### 8.10 Required integration repairs before AION memory use

#### Add AION context profiles

`server/memory-vnext/repositories/context-runtime-repository.js` currently registers Cortex and Eclipse profiles, not AION. Add Swift, Balanced, and Sovereign AION profiles before `product: "aion"` may compile context.

#### Pass the real provider descriptor

`server/memory-vnext/shadow-runtime.js` currently identifies the context consumer as Cortex/local in the inspected path even when context later goes to Gemini. AION must provide the actual provider, resolved model, privacy mode, storage policy, and sensitivity ceiling before retrieval and compilation.

#### Activate Conversation State Kernel projection

Journaling messages is not enough. AION needs branch-local topics, referents, open loops, focus, working slots, active constraints, and semantic-closure transitions. Their zero live counts show this is not active.

#### Replace narrow flat fact extraction

The current `personal-context-router.js` recognizes a small set of explicit patterns and projects captured mutations through identity-oriented paths. Goals, preferences, commitments, relationships, decisions, corrections, and time-varying facts need typed admission into their canonical domains with source spans and explicit-versus-inferred status.

#### Execute selected retrieval channels

The planner may declare working, exact, lexical, dense, temporal, graph, task, artifact, procedure, and room channels. AION context assembly must actually execute qualified selected channels and explain skipped ones. It cannot report a “deep” plan while materially using only limited lexical/graph retrieval.

#### Use bounded real multi-hop retrieval

The inspected personal route caps graph traversal at one hop. AION may request two or three hops only when the graph oracle's expected-gain gate and budget permit it.

#### Protect evidence and contradiction budgets

Static first-fit block ordering can let personal/context blocks consume the pack before decisive evidence or conflicts. AION profiles need minimum quotas for protected directives, working state, decisive evidence, and relevant contradictions, followed by utility-ranked remaining items.

#### Make abstention claim-specific

The presence of any evidence cannot satisfy every claim, and any unrelated conflict cannot block an entire answer. Verification requirements and abstention must bind to decisive claim IDs.

#### Record influence

The current live snapshot has hundreds of context packs and zero influence receipts. AION must record delivered, used, unused, unknown, helpful, distracting, and correction-linked influence at item/claim/answer-span level.

#### Activate room publishers

HELIX, APEX/Forge, and Eclipse integrations exist as contracts, but no live room manifests/packages were present and room authority remains legacy. AION cannot promise cross-room knowledge until publishers emit versioned pointer manifests and authority is switched.

#### Unify the supported mutation path

The compatibility service still advertises memory mutation commands as unimplemented while other internal paths perform selected vNext mutations. AION must receive one supported application port and must not choose among repositories, compatibility routes, and private router methods.

### 8.11 AION context request V2

```json
{
  "runId": "aion-run-id",
  "taskId": "memory-task-id",
  "threadId": "conversation-id",
  "branchId": "active-branch",
  "originalRequestRef": "turn-id",
  "objective": {},
  "workProfile": {},
  "effortCeiling": "swift|balanced|sovereign",
  "requestedChannels": [
    "working", "personal", "episodes", "tasks",
    "artifacts", "rooms", "graph", "evidence", "procedures"
  ],
  "allowedScopes": [],
  "provider": {
    "provider": "google|local|none",
    "model": "resolved-capability-id",
    "privacyMode": "local-only|eligible-cloud|redacted-cloud",
    "storagePolicy": "none|provider-continuation|background-required"
  },
  "sensitivityCeiling": "private",
  "timeLens": {},
  "freshnessRequirements": {},
  "evidenceRequirements": [],
  "memoryTokenCeiling": 0,
  "latencyCeilingMs": 0,
  "capabilityLeaseId": null
}
```

### 8.12 Context pyramid

| Layer | Content | Policy |
|---|---|---|
| L0 | owner directives, literal request, hard constraints | tiny, protected, always present when applicable |
| L1 | branch-local working state, referents, open loops, current task/artifact | local, current, bounded |
| L2 | personal facts, episodes, decisions, room packages, accepted evidence | adaptive retrieval |
| L3 | graph expansion, old episodes, source bodies, large artifacts | tool-accessed on demand |

Initial memory ceilings for benchmark, not mandatory consumption:

- Swift: 600-900 tokens.
- Balanced: 1,500-2,400 tokens.
- Sovereign: 4,000-6,000 tokens.

Large Expedition corpora remain outside the hot prompt and are dereferenced as needed.

### 8.13 Correction and forgetting during active missions

When a correction or forget invalidates a source used by AION:

1. Publish a structural invalidation event without deleted prose.
2. Invalidate affected context manifests and cache entries.
3. Revoke affected agent/context leases.
4. Mark paused checkpoints as requiring refresh.
5. Remove invalid provider caches where possible and mark unverifiable retention explicitly.
6. Notify active agents through IDs and dependency edges.
7. Rebuild permitted context at the new watermark.
8. Mark dependent claims, decisions, reports, and artifacts stale.
9. Prevent resume until the new context manifest is attached.
10. Record a verified closure receipt.

---

## 9. Agent fabric and Agent Foundry

### 9.1 Default policy

The primary AION controller solves the task alone unless a specialist has a measurable advantage. Multi-agent execution is an optimization for context isolation, parallel independent work, domain specialization, or independent verification. It is not a badge of intelligence.

### 9.2 Agent categories

1. Deterministic workers: parsing, ranking, hashing, validation, conversion, calculation.
2. Primary specialists: versioned, tested blueprints for recurring domains.
3. Ephemeral specialists: generated from an approved blueprint schema for a specific subtask.
4. Independent verifiers: receive claims/evidence without the producer's persuasive narrative where practical.
5. Managed provider agents: Deep Research or future provider agents behind restricted adapters.
6. Remote specialists: optional A2A/MCP services across explicit trust boundaries.

### 9.3 Primary specialist roster

| Specialist | Responsibility | Typical tools | What it cannot do |
|---|---|---|---|
| Research Cartographer | coverage map, search strategy, source-role planning | search, URL/document read | certify claims or write final report |
| Source Forensic | primary-source inspection and evidence extraction | URL/file read, evidence capture | synthesize unsupported conclusions |
| Citation Auditor | entailment, scope, date, geography, quotation and citation checks | source reopen, claim ledger | alter the claim silently |
| Quantitative Analyst | calculations, statistics, uncertainty, tables and charts | sandbox, datasets, calculator | accept unverified input units |
| Systems Architect | architecture, interfaces, failure modes, implementation sequencing | repo/file read, diagram/compiler | mutate code without an authorized task |
| Code Investigator | inspect, test, reproduce and isolate code behavior | repo tools, sandbox, test runner | report a test as passed without receipt |
| Automation Operator | browser/desktop/filesystem task execution | world observation, action tools | commit consequential actions without policy |
| Data Engineer | dataset discovery, schema, joins, quality and transformations | data tools, sandbox, artifact store | publish derived data without lineage |
| Counterexample Hunter | falsification, edge cases, alternative explanations | evidence, simulation, tests | replace accepted truth without promotion |
| Artifact Director | canonical content graph and format compilation | artifact tools, renderers | invent new claims during rendering |
| Memory Liaison | request context and submit governed candidates | Memory vNext ports | directly write canonical personal truth |
| Recovery Engineer | classify failures and choose contract-preserving recovery | health, receipts, route history | broaden permissions or lower requirements |

Domain specialists such as finance, legal, medical, academic, market, design, or security are capability profiles layered on this core roster. Their use must be benchmarked and policy-scoped.

### 9.4 Blueprint schema

```json
{
  "blueprintId": "agent.research-cartographer",
  "version": "2.0.0",
  "purpose": "...",
  "taskFamilies": ["research.coverage"],
  "modelRequirements": ["structured_output", "tool_calling"],
  "toolRequirements": ["web.search", "web.read"],
  "leaseTemplate": {
    "scopes": ["web.read"],
    "resources": ["https://*"],
    "maxCalls": 20,
    "sideEffects": "deny"
  },
  "contextProfile": "agent.research.minimal.v1",
  "inputSchema": "SubtaskContract.v2",
  "outputSchema": "ResultPacket.v2",
  "qualificationSuite": "qual.research.v3",
  "termination": {
    "maxTurns": 6,
    "maxIdleTurns": 1,
    "deadlineMs": 120000
  },
  "escalation": ["missing_primary_source", "scope_conflict"],
  "privacyClasses": ["public", "private-local-redacted"]
}
```

### 9.5 Ephemeral-agent generation

The Agent Foundry may synthesize a specialist configuration, not arbitrary executable authority.

Pipeline:

1. Derive capability signals from the assigned subtask.
2. Select a base blueprint.
3. Narrow tools, scope, resources, and context.
4. Generate framing and output schema hints.
5. Validate schema.
6. Simulate qualification with deterministic probes.
7. Check historical reputation for the task/environment family.
8. Issue a child capability lease.
9. Run once or for the bounded mission epoch.
10. Revoke the lease and quarantine the packet.

The Foundry cannot create new native tools, grant new permissions, install code, or write long-term memory.

### 9.6 Spawn decision

Use deterministic eligibility first.

```text
SpawnValue(agent) =
    task-specialty fit
  + expected context-isolation benefit
  + expected parallel-time saving
  + independent-verification value
  + verified historical reliability
  - context preparation cost
  - model/tool cost
  - coordination cost
  - overlap with active agents
  - privacy exposure
```

Spawn only when:

- the agent is qualified.
- required tools and model are healthy.
- its task is sufficiently independent or specialized.
- its context can be scoped.
- there is a unique expected contribution.
- the current effort ceiling permits it.
- global and per-mission concurrency allow it.

### 9.7 Bounds

Initial safe defaults subject to replay tuning:

- Direct/Focus: zero subagents by default, maximum one specialist.
- Deliberate: maximum three concurrent specialists.
- Expedition: maximum five concurrent specialists per wave.
- Maximum nested agent depth: two.
- Agents cannot spawn peers directly; they submit a spawn proposal to the governor.
- Maximum repair attempts per failed unit: two before route change or owner-visible failure.
- One verifier must not share the exact producer context when independence matters.

### 9.8 Typed Result Packet

Agents return structured packets, not essays.

```json
{
  "packetId": "pkt_...",
  "missionId": "mis_...",
  "agentInstanceId": "agi_...",
  "subtaskId": "tsk_...",
  "status": "complete|partial|blocked|failed",
  "claims": [],
  "evidenceRefs": [],
  "observations": [],
  "artifacts": [],
  "assumptions": [],
  "uncertainties": [],
  "contradictions": [],
  "toolReceipts": [],
  "requestedFollowups": [],
  "completionCriteria": [],
  "usage": {},
  "provenance": {}
}
```

Free-form explanation may be included as a bounded field but cannot replace required structure.

### 9.9 Blackboard and promotion

All agent packets enter a quarantined blackboard. Promotion gates validate:

- schema.
- scope and lease compliance.
- evidence presence.
- evidence accessibility and freshness.
- entailment/scope/period/units.
- deterministic calculations or tests where applicable.
- contradictions.
- completion criteria.
- provenance and tool receipts.

Accepted claims, rejected claims, unresolved claims, and observations are stored separately.

### 9.10 Reputation and procedural learning

Reputation is keyed by:

- blueprint and version.
- task family.
- environment family.
- tool/provider versions.
- risk class.
- verification method.

Do not use one global score. A research agent can be excellent at source discovery and poor at numeric extraction.

Only verified outcomes update reputation. Repeated regressions suspend a blueprint for the affected environment/task family without deleting history.

---

## 10. Model and provider fabric

### 10.1 One provider gateway

All inference calls pass through one gateway responsible for:

- capability-based model selection.
- Interactions versus legacy API selection.
- thinking configuration.
- structured-output validation.
- tool configuration.
- privacy and provider-storage policy.
- timeout, retry, and fallback.
- token estimation/counting.
- caching and continuation IDs.
- cost ledger.
- circuit breakers.
- trace receipts.

No room, agent, or tool calls Gemini directly.

### 10.2 Capability registry

Each model/provider entry contains:

- stable logical role.
- provider/model identifier.
- stable/preview/deprecated state.
- supported modalities.
- context and output limits.
- structured output.
- function calling.
- built-in search, URL, code, file search, and MCP support.
- background/streaming support.
- thinking controls.
- storage/retention behavior.
- regional/privacy constraints.
- measured P50/P95 latency.
- current price and quota.
- health/circuit state.
- benchmark scores by task family.
- fallback compatibility.

Product code asks for capabilities, not model strings.

### 10.3 Logical model roles

| Role | Work |
|---|---|
| `route_cheap` | rare semantic routing arbitration |
| `extract_cheap` | schemas, entity/constraint extraction, classification |
| `converse_fast` | natural everyday dialogue and lightweight tools |
| `reason_balanced` | standard analysis, planning, coding, tool loops |
| `reason_frontier` | hard arbitration, synthesis, complex code/analysis |
| `verify_independent` | independent claim/decision review |
| `multimodal_fast` | image/audio/video/document understanding |
| `research_managed` | provider Deep Research |
| `image_create` | image generation/editing |
| `live_voice` | real-time voice interaction |

### 10.4 Gemini Interactions API policy

Prefer Interactions for new Gemini paths because it provides a unified model/agent interface, optional server-side continuation, observable steps, streaming, and background execution.

Rules:

- persist the local mission ID before starting a background interaction.
- store the provider interaction ID as a revocable external reference.
- reconnect streams using provider event cursors.
- poll only under bounded backoff.
- map provider states into AION states; do not expose provider wording as canonical state.
- re-specify tools, system instructions, and generation configuration on continued interactions when required by the API.
- never depend on provider retention as the only copy of the task.

### 10.5 Managed Deep Research policy

Deep Research is a specialist route, not AION's default research engine.

Google's current documentation estimates that a moderate Deep Research task may perform roughly 80 searches, consume about 250,000 input and 60,000 output tokens, and cost approximately USD 1-3. These are estimates, not guarantees, but they make indiscriminate admission unacceptable. Deep Research also requires background stored execution and currently has capability/structured-output limitations that AION must compensate for.

Use it when:

- the task is a broad literature/market/competitive/due-diligence campaign.
- several minutes of background execution are acceptable.
- provider storage policy is acceptable.
- a structured AION post-processing and verification stage will follow.
- its estimated cost and breadth beat the local research plan.

Do not use it when:

- one or a few current facts are needed.
- a specific known page/document needs reading.
- custom local tools are required but cannot be provided through its supported path.
- strict structured output is required directly from the managed agent.
- sensitive local context should not enter stored provider state.
- the user needs an immediate conversational response.

Managed reports enter as untrusted research packets. AION extracts evidence and claims, reopens decisive sources, validates citations, and builds its own Knowledge Package.

### 10.6 Fallback semantics

A fallback is allowed only if it preserves the contract.

Examples:

- Pro unavailable -> qualified Flash path may continue for low-risk synthesis, but not silently for a required frontier arbitration.
- Search grounding unavailable -> direct source adapters may satisfy freshness if coverage remains valid.
- Background provider unavailable -> local durable mission may replace it.
- Structured output unavailable -> one bounded repair call or deterministic extraction may be used.
- Privacy-ineligible provider -> local/stateless qualified path or explicit blocked result.

Every fallback records the changed capability, expected quality effect, and verification compensation.

---

## 11. Tool and capability architecture

### 11.1 Tool principle

AION has potential access to the full JARVIS capability inventory, but no individual request or agent sees every tool. The capability compiler creates the smallest task-specific tool view.

This distinction matters:

```text
System capability inventory != model-visible tool list != agent capability lease
```

### 11.2 Canonical tool contract

Every tool definition contains:

- tool ID and semantic version.
- human-readable purpose.
- input and output schemas.
- read, prepare, commit, compensate, or observe class.
- resource patterns.
- required actor/scope/capability.
- consequence level.
- side-effect and confirmation policy.
- idempotency support.
- timeout and retry class.
- privacy/data-egress class.
- expected latency/cost.
- health and availability probe.
- proof/receipt schema.
- fallback tools.
- prompt-injection exposure class.

### 11.3 Five universal cognitive tools

These are AION-level logical tools assembled from existing services. They do not replace domain tools.

#### `context.resolve`

Requests a scoped, reproducible Memory vNext context manifest. It never returns the full memory store and cannot mutate truth.

#### `world.observe`

Returns structured current state from files, browser, desktop, applications, devices, or domain services. Observations carry timestamps, environment identity, confidence, and provenance.

#### `evidence.capture`

Converts a page, dataset row, document region, tool result, calculation, screenshot, or receipt into an evidence atom with exact location and content hash.

#### `compute.verify`

Executes deterministic calculations, code, tests, schema checks, transformations, or simulations in an appropriate sandbox and returns reproducible inputs, outputs, logs, hashes, and limits.

#### `artifact.compile`

Compiles a versioned Knowledge Package into a requested artifact, validates format/citations/layout, renders it, registers its lineage, and returns a downloadable artifact reference.

### 11.4 Tool discovery

Tool selection uses:

1. exact capability match.
2. task and resource eligibility.
3. side-effect/risk compatibility.
4. health.
5. historical reliability in the current environment.
6. expected latency/cost.
7. proof strength.

The model should not receive hundreds of tool schemas. The compiler exposes a small set and may provide a `capability.search` meta-tool for qualified discovery. Any discovered tool still requires gateway authorization.

### 11.5 Read, prepare, commit

Consequential operations are decomposed:

```text
observe -> prepare -> verify proposed change -> approve when required -> commit -> verify outcome
```

Examples:

- Email: resolve account/recipient -> create draft -> re-read exact fields -> approve/commit -> verify sent item.
- Files: resolve exact path -> produce change plan -> write atomically -> hash/read back -> register artifact.
- Browser: resolve entity/page -> prepare form/message -> confirm identity and exact content -> commit -> verify visible server-side outcome.
- Git: inspect repo/state -> prepare patch/commit -> validate tests/diff -> push under explicit scope -> verify remote ref.

### 11.6 Side-effect guarantee

Do not promise exactly-once external effects. Use:

- at-least-once internal delivery.
- idempotency keys when the external service supports them.
- precondition hashes.
- commit receipts.
- postcondition verification.
- reconciliation for unknown outcomes.
- compensation where safe and defined.

Unknown commit outcomes are never automatically repeated until reconciliation proves the previous attempt did not succeed.

### 11.7 MCP policy

MCP is an interoperability boundary, not a trust shortcut.

- Validate schemas and server identity.
- Treat tool descriptions/annotations as untrusted unless the server is trusted.
- Restrict the allowed tool list.
- Bind authorization to audience and scope.
- Never pass provider/user tokens through to a third party.
- Use secure out-of-band authorization for external accounts.
- Taint MCP output as untrusted content.
- Enforce the same leases, budgets, and receipts as native tools.
- Pin or approve server/version changes.

### 11.8 Code execution

Use a real process/container/sandbox boundary appropriate to the risk. The in-process JavaScript VM is not a hostile-code sandbox.

Every code job declares:

- inputs and mounted paths.
- network policy.
- filesystem write policy.
- CPU/memory/time limits.
- environment/toolchain version.
- dependency policy.
- expected outputs.
- reproducibility metadata.

---

## 12. Research and evidence engine

### 12.1 Research route selection

| Need | Route |
|---|---|
| One current fact | targeted search/official source read |
| Known page or URL | direct URL context or controlled fetch |
| User-provided document | local parser/multimodal read, optionally provider document understanding |
| Private corpus question | Memory vNext/artifact retrieval or qualified file search path |
| Multi-source analysis | local AION research campaign |
| Broad public due diligence | compare local campaign with managed Deep Research |
| Numeric/data investigation | dataset tools plus compute verification |

### 12.2 Research Coverage Contract

Before broad research, define:

- questions that must be answered.
- decisive claims.
- required source roles.
- freshness cutoff.
- jurisdiction/geography.
- period and units.
- primary-source requirements.
- contrary-evidence requirement.
- required datasets or documents.
- uncertainty tolerance.
- citation and artifact requirements.

Coverage is measured by satisfied cells, not by number of browser tabs or search queries.

### 12.3 Claim frontier

Maintain four sets:

- established claims.
- contested claims.
- unsupported candidate claims.
- unresolved unknowns.

Research actions target the highest-value frontier item. Search does not continue merely to collect more links.

### 12.4 Query diversification

For a claim, generate bounded query roles:

- direct official source.
- definition/specification.
- dataset/statistics.
- contrary/negative evidence.
- historical comparison.
- jurisdiction/time-specific evidence.
- implementation/reproduction evidence.

Deduplicate query intent and stop issuing variants once the source-role cell is satisfied.

### 12.5 Source identity and syndication

Canonicalize:

- final URL and redirects.
- publisher/domain.
- title/date/author.
- document identifiers/DOI/filing IDs.
- content hash.
- quoted/extracted location.
- syndicated-parent relationship.

Ten sites copying one press release count as one evidence origin.

### 12.6 Evidence atom V2

```json
{
  "evidenceId": "ev_...",
  "sourceId": "src_...",
  "sourceVersion": "...",
  "canonicalUri": "...",
  "sourceType": "official_dataset",
  "sourceRole": "primary",
  "publisher": "...",
  "publishedAt": "...",
  "retrievedAt": "...",
  "contentHash": "...",
  "location": {
    "kind": "page|line|table|row|cell|timestamp|region|selector",
    "value": "..."
  },
  "excerptOrValue": "...",
  "unit": "...",
  "period": "...",
  "geography": "...",
  "scope": "...",
  "polarity": "supports|contradicts|context",
  "claimCandidates": [],
  "freshness": 0.0,
  "authority": 0.0,
  "directness": 0.0,
  "limitations": [],
  "taint": "untrusted_data",
  "retentionClass": "...",
  "license": "...",
  "provenance": {}
}
```

### 12.7 Claim object

```json
{
  "claimId": "clm_...",
  "text": "...",
  "type": "current_fact|numeric|causal|recommendation|code_behavior|personal|forecast",
  "scope": {},
  "epistemicState": "candidate|accepted|contested|rejected|stale",
  "supportingEvidence": [],
  "contraryEvidence": [],
  "assumptions": [],
  "uncertainty": {},
  "verificationRequirements": [],
  "validTime": {},
  "recordedTime": {},
  "derivedBy": {},
  "supersedes": null
}
```

### 12.8 Evidence sufficiency

Sufficiency is claim-specific.

- Current fact: current authoritative source or two independent credible sources when no authority exists.
- Numeric claim: source value, unit, period, transformation lineage, and independent recomputation where derived.
- Causal claim: mechanism, temporal ordering, confounders, alternative explanation, and limitations.
- Recommendation: owner constraints, alternatives, downside, reversibility, and evidence applicability.
- Code behavior: repository version plus test, execution, or tight static proof.
- Personal memory: source episode and correction/validity history.
- Forecast: inputs, model/assumptions, horizon, uncertainty, and update conditions.

### 12.9 Contradiction debt

Track unresolved contradiction severity. A report cannot be marked complete when contradiction debt exceeds the contract threshold.

Possible resolutions:

- sources cover different periods/scopes.
- one source supersedes another.
- one source is less authoritative.
- evidence remains genuinely contested.
- claim is narrowed.
- conclusion abstains.

### 12.10 Research stopping policy

Stop when:

- all mandatory coverage cells pass.
- decisive claims meet evidence requirements.
- required contrary-evidence sweep is complete.
- remaining unknowns do not change the conclusion or are disclosed.
- the best next query has low expected marginal evidence value.
- two research epochs produce no material coverage gain.
- the deadline/effort ceiling is reached and a partial result is allowed.

---

## 13. Verification and epistemic control

### 13.1 Verification hierarchy

Use the cheapest reliable verifier first.

1. Schema and type validation.
2. Range, invariant, unit, and date validation.
3. Hash, receipt, and postcondition validation.
4. Deterministic calculation or executable test.
5. Source reopen and exact-location check.
6. Independent source or dataset check.
7. Counterexample/alternative-explanation search.
8. Independent model evaluation.
9. Owner review for material ambiguity or consequence.

### 13.2 LLM-judge limitation

Model judges are useful for advisory comparison, style, coverage, and detecting candidate problems. They are not trusted as the sole verifier. Current research shows weak reliability in fine-grained evidence-based research failure detection. Therefore AION records judge identity/version, rubric, confidence, and disagreement, and requires deterministic or evidence-grounded proof for critical criteria.

### 13.3 Blind verification

Where practical, a verifier receives:

- candidate claim/result.
- required criterion.
- evidence or reproducible inputs.
- environment/version.

It does not receive:

- producer reputation.
- persuasive narrative.
- producer's confidence.
- hidden scratch state.

### 13.4 Verification plans by output

#### Conversational factual answer

- freshness and claim/evidence checks for decisive statements.
- memory provenance for personal facts.
- citation entailment when citations are shown.

#### Code

- syntax/type/build.
- targeted tests.
- regression tests.
- security/static checks proportional to risk.
- read-back/diff.

#### Research paper/report

- claim coverage.
- citation validity.
- source diversity/primacy.
- numeric consistency.
- unresolved contradiction disclosure.
- render/layout inspection.

#### Automation

- precondition state.
- prepared action preview.
- approval if required.
- commit receipt.
- postcondition observation.
- reconciliation on unknown outcome.

#### Data analysis

- schema/data-quality report.
- transformation lineage.
- unit/timezone handling.
- independent aggregates or spot checks.
- reproducible code/notebook.

### 13.5 Targeted repair

On verification failure:

1. Identify the smallest failed unit.
2. Mark dependents stale.
3. Select repair strategy based on failure type.
4. Re-run only the unit and dependents.
5. Preserve the failed version and evidence.
6. Stop after the bounded repair limit or change route.

Do not regenerate the entire answer because one citation, chart, paragraph, or test failed.

---

## 14. Knowledge Package and artifact compiler

### 14.1 Knowledge Package is a DAG, not a blob

The canonical package contains versioned nodes for:

- objective and audience.
- accepted claims.
- evidence.
- assumptions and uncertainty.
- decisions.
- calculations/datasets.
- narrative sections.
- tables/charts/media.
- artifact fragments.
- citations and bibliography.
- style/layout constraints.
- provenance and lineage.

### 14.2 Package manifest

```json
{
  "packageId": "kp_...",
  "version": 1,
  "missionId": "mis_...",
  "contractId": "cc_...",
  "title": "...",
  "audiences": [],
  "acceptedClaimIds": [],
  "unresolvedClaimIds": [],
  "evidenceIds": [],
  "decisionIds": [],
  "artifactInputs": [],
  "sections": [],
  "styleProfile": "...",
  "citationProfile": "...",
  "validationProfile": "...",
  "sourceWatermarks": {},
  "contentHash": "..."
}
```

### 14.3 Compilers

Supported compiler families:

- chat response.
- executive debrief.
- Markdown report.
- DOCX research paper/report.
- PDF.
- PPTX presentation.
- XLSX/CSV dataset or analysis workbook.
- Python/R/JS analysis package.
- website/dashboard.
- infographic/image set.
- audio briefing/transcript.
- machine-readable JSON knowledge package.
- reusable JARVIS context package.

### 14.4 Compiler rule

Renderers may transform structure, wording, visual hierarchy, and medium. They may not invent factual claims. A format-specific need for new information creates a claim/research task and returns through verification.

### 14.5 Artifact validation

Each format has deterministic and visual checks.

- File opens and parses.
- Required sections/slides/sheets exist.
- Citations resolve.
- Tables/charts use correct values and labels.
- Text is not clipped or overflowing.
- Fonts, spacing, contrast, and page/slide dimensions are valid.
- Hyperlinks and downloads work.
- Code executes or passes specified checks.
- Website routes/assets load.
- Content hashes match the registered manifest.

The final artifact is registered with Memory vNext's encrypted content-addressed registry and linked to its source claims, evidence, inputs, operations, checks, and superseded versions.

---

## 15. Durable local mission runtime

### 15.1 Authority split

| State | Authority |
|---|---|
| Mission lifecycle and work items | local mission event ledger |
| Current query projection | rebuildable mission projection |
| Cognitive node scratch | LangGraph checkpoint |
| Personal/project/room memory | Memory vNext active authority |
| External model continuation | provider interaction reference |
| Side effects | tool receipt plus external postcondition |
| Artifacts | Memory vNext artifact registry/domain store |

There must be one operational task identity. If the local `MissionRuntimePort` is implemented on Memory vNext task/ledger primitives, those records are canonical and AION does not mirror a second independently mutable mission database. If an existing Eclipse operational store must remain during migration, it is a compatibility projection linked to the canonical mission/event IDs and cannot accept independent state transitions.

### 15.2 Event-sourced mission records

Required event families:

- `mission.accepted`
- `contract.compiled`
- `context.planned`
- `context.compiled`
- `route.selected`
- `epoch.started`
- `agent.spawned`
- `tool.prepared`
- `approval.requested`
- `approval.resolved`
- `tool.committed`
- `tool.reconciled`
- `evidence.captured`
- `claim.promoted`
- `verification.failed`
- `repair.started`
- `artifact.registered`
- `mission.paused`
- `mission.resumed`
- `mission.cancelled`
- `mission.completed`
- `mission.failed`

### 15.3 Work items and leases

Workers claim work with:

- unique work-item key.
- lease owner.
- lease expiry.
- heartbeat interval.
- attempt count.
- retry policy.
- dependency watermark.
- input hash.
- expected output schema.

Expired leases return to recovery unless a commit outcome is unknown, in which case reconciliation runs first.

### 15.4 Checkpoint rules

- Checkpoint before and after expensive/nondeterministic nodes.
- Place model, search, and external API calls inside idempotent/checkpointed task boundaries.
- Do not execute an irreversible action before an interrupt in a node that will restart from the beginning.
- Keep side-effect preparation and commit in separate nodes.
- Persist the provider/tool call key before sending the request.
- Link every checkpoint namespace to mission, epoch, and graph version.
- Prune checkpoint payloads after retention while preserving durable events and result references.

### 15.5 Background and reconnect

The UI may disconnect without stopping a mission. The backend persists mission state, provider interaction IDs, stream cursors, work leases, and current progress. On reconnect, the client receives a projection and resumes events from its last cursor.

### 15.6 Cancellation

Cancellation propagates to:

- queued work.
- active agent leases.
- provider background interactions when supported.
- sandbox jobs.
- browser/desktop sessions.
- artifact renders.

Completed external side effects are not undone unless a defined compensation is safe and the owner requests it.

---

## 16. Failure taxonomy and recovery

### 16.1 Failure classes

| Class | Examples | Default response |
|---|---|---|
| Transient provider | timeout, 429, 5xx | bounded backoff, health update, compatible fallback |
| Permanent provider | invalid capability/model/request | no blind retry; repair config or route |
| Tool precondition | wrong page, missing file, stale state | re-observe and replan |
| Tool unknown outcome | connection lost after commit | reconcile before retry |
| Permission | denied/expired lease | stop or request narrowly scoped approval |
| Schema | malformed model/tool output | deterministic parse or one repair call |
| Evidence | missing, stale, contradictory | targeted research or abstain |
| Verification | test/claim/render failed | smallest-unit repair |
| Context | conflict, missing source, privacy ineligible | rebuild context or block |
| Agent | timeout, duplicate, low-quality packet | revoke, retry once, change specialist/route |
| Infrastructure | DB lock, disk full, process crash | durable recovery, health alert, no false completion |
| Contract | impossible/incompatible requirements | explain conflict and request decision |

### 16.2 Retry matrix

Every operation class declares:

- maximum attempts.
- retryable codes.
- backoff with jitter.
- idempotency/reconciliation requirement.
- fallback compatibility.
- circuit-breaker contribution.
- owner-visible delay threshold.

No universal retry wrapper is permitted.

### 16.3 Plateau detection

Stop or change strategy when:

- two epochs add no accepted claim/evidence/criterion coverage.
- the same tool error repeats after one repair.
- agents return semantically duplicate packets.
- uncertainty does not improve despite added compute.
- the best branch score stays below the frontier.

### 16.4 Honest degradation

When a required capability is unavailable, AION states:

- what remains verified.
- what could not be established or executed.
- which capability failed.
- whether a compatible fallback was attempted.
- what the owner can do next.

It never replaces “current” with cached data or “executed” with “planned” without saying so.

---

## 17. Security, privacy, and trust kernel

### 17.1 Threat model

AION must assume:

- webpages, files, emails, repositories, tool responses, agents, and MCP servers may contain prompt injection.
- memory candidates can carry persistent poisoning.
- agents can misuse overly broad tools even without malicious intent.
- external identities/accounts can be ambiguous.
- hidden secrets can leak through prompts, traces, artifacts, or model providers.
- repeated autonomous actions can create cascading damage.

### 17.2 Instruction/data separation

Every context item has an authority label:

- system policy.
- owner directive.
- task contract.
- trusted tool policy.
- observation.
- untrusted content.
- evidence.
- agent proposal.

Only the first four may influence instructions. Untrusted content can affect factual reasoning after verification but cannot request tools, change goals, or modify memory policy.

### 17.3 Taint propagation

Derived summaries, agent packets, claims, and artifacts retain taint from untrusted inputs until verification removes only the relevant uncertainty. Summarization does not sanitize prompt injection.

### 17.4 Data-egress classifier

Before any provider/tool call, classify fields:

- public.
- owner-private.
- sensitive personal.
- credential/secret.
- room-confidential.
- restricted by provider policy.

Secrets are never placed in model prompts or general telemetry. Sensitive context is minimized/redacted or routed to an eligible local/stateless path.

### 17.5 Capability leases

Leases bind:

- actor/agent.
- mission/subtask.
- allowed operations.
- resource patterns.
- read/write/commit class.
- maximum calls.
- data sensitivity.
- expiry.
- delegation depth.
- revocation state.

The gateway checks the lease at execution time, not only when the prompt is created.

### 17.6 Approval policy

Approval is based on consequence and reversibility, not whether a model feels confident.

Group safe related actions into a clear plan where possible. Never make the owner approve harmless reads individually. Never hide a material commit among many low-risk steps.

### 17.7 Memory poisoning defense

- Agent/web/tool text enters as untrusted candidates.
- Stable personal facts require owner statement or strong verified provenance.
- Protected directives require explicit owner authority.
- Conflicts do not overwrite silently.
- Procedure learning requires verified outcomes, failures, and counterexamples.
- Corrections and forgetting follow dependency closure.
- Retrieval fences untrusted data and records influence.
- Security replay corpus includes delayed/persistent poisoning attacks.

### 17.8 Provider retention

Provider storage is a policy decision per call. The local trace records whether storage was enabled, why, and the external retention reference without copying sensitive content into telemetry.

---

## 18. Response intelligence and conversational behavior

### 18.1 AION must sound like a capable collaborator

The response composer chooses form based on intent:

- direct sentence for a simple fact.
- natural conversation for personal discussion.
- concise steps for an action.
- table only for useful comparison.
- structured report for analysis.
- artifact plus executive summary for creation work.

It must not force the same headings, bullet count, disclaimers, or length onto every response.

### 18.2 Response plan

The composer receives a small `ResponsePlan`:

- answer-first outcome.
- audience and assumed expertise.
- required detail.
- desired tone.
- evidence/citation density.
- uncertainty disclosure.
- artifact/action status.
- follow-up need.

### 18.3 Progress communication

For long work, expose:

- current objective.
- plain-language current step.
- verified progress.
- what is waiting or blocked.
- artifacts/results as they become useful.

Do not stream fake internal monologue. Thinking summaries, when provider-supported, are treated as progress hints and filtered into factual observable updates.

### 18.4 Personalization

Personalization comes from specific, relevant memories with provenance. Do not add the user's name, “sir,” or stylistic quirks mechanically. Memory should change useful decisions: constraints, preferences, recurring procedures, active projects, people, files, and prior corrections.

---

## 19. Cognitive interface

### 19.1 Default conversation surface

Keep normal conversation uncluttered. Show small status affordances only when work actually expands:

- searching.
- using a tool.
- waiting for approval.
- continuing in background.
- artifact ready.

### 19.2 Mission inspection surface

Expanded view may show:

- objective and completion criteria.
- task DAG.
- accepted/contested/unknown claim counts.
- research coverage.
- sources and evidence.
- specialist roster and unique contribution.
- tools/actions and receipts.
- relevant memories used.
- artifacts.
- current route/model class.
- latency/cost/cache summary.
- pause/cancel/resume/steer controls.

### 19.3 User controls

- Challenge this claim.
- Search deeper here.
- Exclude a source/domain.
- Change audience/output form.
- Add a constraint.
- Inspect memories used.
- Correct/forget memory.
- Approve/deny prepared action.
- Convert result to artifact.
- Fork from a checkpoint.
- Stop after current safe boundary.

### 19.4 UI truthfulness

Never show:

- a progress percentage not derived from contract coverage.
- an agent as active when no worker exists.
- evidence counts that are only search results.
- a “verified” badge based only on model confidence.
- an artifact as complete before render/read-back validation.

---

## 20. Observability

### 20.1 Trace hierarchy

```text
conversation turn
  -> mission
      -> cognitive epoch
          -> context retrieval
          -> model invocation
          -> agent invocation
          -> tool transaction
          -> verification
          -> artifact operation
```

### 20.2 Metrics

Quality:

- contract completion.
- factual correctness.
- evidence coverage.
- citation entailment.
- contradiction discovery.
- artifact validation.
- automation postcondition success.

Efficiency:

- zero-call rate.
- calls/tokens/cost by route.
- cached token ratio.
- avoided calls.
- agent contribution versus overhead.
- duplicate source/packet rate.
- context useful-token ratio.
- time to first useful output.

Reliability:

- resume success.
- lease recovery.
- unknown commit outcomes.
- idempotency conflicts.
- retry/fallback success.
- circuit breaker openings.
- projection rebuild success.

Memory:

- relevant-memory precision/recall.
- temporal correctness.
- correction adherence.
- unsupported personalization.
- influence receipt completeness.
- cross-room pointer accuracy.

### 20.3 Privacy of observability

Prompt/output/tool content is opt-in and encrypted when retained. Normal telemetry stores IDs, hashes, sizes, classifications, route decisions, durations, counts, and outcome codes. OpenTelemetry GenAI conventions are wrapped in an internal adapter because the standard evolves and some fields can contain PII.

---

## 21. Continuous improvement without live self-corruption

### 21.1 Learning loop

```text
verified mission outcome
  -> experience case
  -> failure/counterexample cluster
  -> candidate route/agent/procedure improvement
  -> frozen replay
  -> security/privacy tests
  -> shadow comparison
  -> owner/policy approval where required
  -> canary
  -> wider rollout or rollback
```

### 21.2 What may adapt

- route thresholds.
- model choice by task family.
- agent eligibility/reputation.
- source ranking.
- context packing weights.
- retry/fallback policies.
- procedure versions.
- response structure selection.

### 21.3 What may not adapt directly from live model output

- permissions.
- protected directives.
- truth/conflict rules.
- memory write authority.
- secret/data-egress rules.
- approval consequence classes.
- maximum recursion/delegation.
- release gates.

### 21.4 Failure-derived tests

Every material failure becomes a minimized replay case containing:

- original contract.
- sanitized environment snapshot.
- expected behavior.
- actual failure point.
- required invariant.
- regression assertion.

The system learns by improving policies and procedures that pass replay, not by storing “try harder next time.”

---

## 22. Advanced upgrades introduced by V2

The following upgrades are architectural, not decorative feature names.

1. Lazy three-level Cognitive Contract materialization.
2. Continuous Work Profile instead of one hard complexity bucket.
3. Cheapest-qualified route subject to a quality threshold.
4. Experience-boundary router using verified similar cases.
5. Explicit escalation and stop predicates.
6. Separate reservations for context, output, tools, agents, and owner attention.
7. Four-plane authority architecture.
8. Four separate graph/state types instead of one reasoning graph.
9. Memory vNext as the only long-term knowledge authority.
10. Per-epoch immutable context snapshots.
11. Influence receipts connecting memory to answer spans/evidence.
12. Agent-specific context slices.
13. Context quarantine and reference-based agent communication.
14. Deterministic specialist eligibility before model-based arbitration.
15. Weighted capability coverage for the smallest useful team.
16. Bounded ephemeral-agent compiler.
17. Static lease and tool analysis before spawn.
18. Task/environment-specific agent reputation.
19. Agent recursion and parallelism controls.
20. Quarantined typed Result Packets.
21. Claim/evidence promotion rather than trusting worker prose.
22. Research Coverage Contract.
23. Claim-frontier-driven search.
24. Source-role quotas rather than raw link counts.
25. Syndication and duplicate-origin detection.
26. Contradiction debt and explicit resolution.
27. Marginal-evidence stopping.
28. Independent, risk-weighted verification.
29. Deterministic checks before LLM judges.
30. Blind verification packets.
31. Smallest-unit targeted repair.
32. Knowledge Package DAG.
33. Fact-preserving multi-format compilers.
34. Cross-format consistency validation.
35. Render/read-back verification.
36. One provider capability registry.
37. Provider-retention classifier.
38. Managed Deep Research admission policy.
39. Tool-combination compiler rather than binding every tool.
40. One capability gateway for native and MCP tools.
41. Observe/prepare/commit/reconcile action protocol.
42. Unknown-outcome reconciliation before retry.
43. Local event ledger as mission authority.
44. LangGraph as bounded scratch/checkpoint state only.
45. Future-compatible `MissionRuntimePort` without adding Temporal now.
46. Typed failure and retry matrix.
47. Plateau detection and branch pruning.
48. Prompt-injection taint propagation.
49. Data-egress classification per call.
50. Memory-poisoning replay suite.
51. Natural response planning instead of fixed formatting.
52. Evidence-derived progress rather than fake percentages.
53. OpenTelemetry-compatible trace hierarchy.
54. Cost/cache/token telemetry by route and agent contribution.
55. Eval-gated route and procedure learning.
56. Failure-derived regression cases.
57. Shadow/canary/rollback for every policy or model change.
58. Cross-room pointer resolution without data duplication.
59. Durable provider-stream reconnection through local mission state.
60. Honest partial/blocked/degraded results as first-class terminal states.

---

## 23. Logic-gap closure matrix

| Failure risk | Design closure | Required proof |
|---|---|---|
| Greeting triggers expensive workflow | zero-call deterministic gate | latency/call-count test |
| Effort mode wastes tokens | effort is ceiling; marginal-value stop | matched-prompt cost benchmark |
| Memory duplication | Memory vNext ports only | architecture lint/no direct DB import |
| Memory not live but treated as live | authority resolver and cutover gate | authority-state integration test |
| Agent swarm redundancy | eligibility, set cover, overlap penalty, fan-out bound | duplicate-contribution benchmark |
| Agent invents permissions | immutable lease issued by governor | adversarial permission tests |
| Recursive agent explosion | depth two, spawn proposal only | recursion/fan-out property test |
| Agent prose pollutes parent | typed packet plus quarantine | schema/context-size test |
| Search count mistaken for research | coverage/claim frontier | coverage benchmark |
| Copied news treated as independent | canonical source/syndication graph | duplicate-origin test |
| LLM judge falsely approves | deterministic/independent verification hierarchy | controlled-intervention eval |
| Provider state becomes memory | local canonical reconstruction | provider-state deletion test |
| Background stream disconnect loses mission | local IDs/cursors/reconnect | network-drop chaos test |
| Side effect repeats after crash | prepare/commit split, idempotency, reconcile | crash-at-every-boundary test |
| Fallback lowers freshness/quality | contract-aware compatibility check | forced-outage tests |
| Prompt injection reaches tools | authority labels, taint, gateway | web/file/MCP injection suite |
| Sensitive memory sent to provider | egress classifier/context slice | redaction/deny tests |
| Artifact formats disagree | one Knowledge Package DAG | cross-format claim/hash test |
| One failed citation regenerates everything | targeted dependency repair | mutation test |
| System claims success without proof | explicit criteria and receipts | false-success negative tests |
| Self-learning corrupts policy | replay/shadow/canary promotion | rollback and poisoned-feedback test |

---

## 24. Implementation program

Each wave is independently testable. No wave is considered complete because files exist; it needs the stated exit evidence.

### Wave 0 - freeze, baseline, and authority map

- Preserve `newmodel.md` and this V2 spec.
- Capture current Cortex, Eclipse, gateway, tools, memory, and artifact flows.
- Record active memory authority and provider call sites.
- Build a representative task/replay corpus.
- Measure P50/P95 latency, tokens, calls, cost, tool success, memory recall, and artifact success.

Exit: reproducible baseline and no unexplained provider/tool/memory writer.

### Wave 1 - AION contracts and IDs

- `RequestEnvelope.v1`.
- `CognitiveContract.v2` compact/standard/mission.
- `WorkProfile.v1`.
- mission/run/epoch/work/agent/tool/evidence/claim/artifact IDs.
- schema registry and compatibility rules.

Exit: contract corpus compiles deterministically and preserves explicit/inferred distinctions.

### Wave 2 - authoritative local mission runtime

- `MissionRuntimePort`.
- SQLite event ledger/projections/outbox/leases/heartbeats.
- pause/resume/cancel/wait/expiry.
- idempotency and projection rebuild.
- UI event cursor.

Exit: crash/restart tests recover every non-terminal state without duplicate work.

### Wave 3 - unified model gateway

- capability registry.
- Gemini Interactions adapter.
- privacy/storage policy.
- thinking and structured-output configuration.
- background/stream/reconnect.
- cost/cache/token ledger.
- typed fallback/circuit breakers.

Exit: all AION calls use the gateway; forced failures preserve contracts.

### Wave 4 - Memory vNext context adapter

- authority resolution.
- memory-need plan.
- context compile/reproduce/release.
- role-scoped slices.
- influence receipts.
- provider eligibility.
- legacy/shadow compatibility.

Exit: no direct legacy or room DB access; all context is reproducible and scoped.

### Wave 5 - adaptive router and governor V1

- deterministic feature extraction.
- route rules.
- continuous Work Profile.
- resource reservations.
- escalation/stop policy.
- avoided-call telemetry.

Exit: greetings cost zero provider calls; route corpus meets accuracy/latency thresholds.

### Wave 6 - universal capability compiler and gateway

- canonical tool schema.
- capability search.
- minimal model-visible tool view.
- leases and resource patterns.
- read/prepare/commit/reconcile.
- native and MCP adapters.
- proof receipts.

Exit: unauthorized and injection-driven calls fail before execution; safe reads remain low-friction.

### Wave 7 - bounded LangGraph cognitive epochs

- Task DAG state.
- checkpoint linkage.
- conditional routing.
- independent parallel work.
- interrupts.
- targeted repair subgraphs.
- checkpoint retention/pruning.

Exit: graph crash/resume and interrupt replay cause no repeated commit.

### Wave 8 - Agent Registry and Foundry

- primary specialist blueprints.
- qualification suites.
- ephemeral profile compiler.
- set-cover selection.
- context slicing.
- Result Packets/blackboard/quarantine.
- reputation by task/environment.

Exit: agents contribute unique validated work and cannot exceed leases or spawn recursively.

### Wave 9 - research and evidence engine

- coverage contract.
- source canonicalization.
- query roles.
- evidence atoms.
- claim frontier.
- contradiction debt.
- stop policy.
- managed Deep Research adapter.

Exit: research benchmarks improve evidence coverage without uncontrolled searches/tokens.

### Wave 10 - verification and epistemic promotion

- verification plan compiler.
- deterministic validators.
- source/citation verifier.
- computation/test verifier.
- independent model advisory path.
- claim promotion and targeted repair.

Exit: controlled factual, citation, numeric, code, and artifact corruptions are detected at required rates.

### Wave 11 - Knowledge Package DAG

- package schemas/versioning.
- accepted/unresolved claim linkage.
- evidence/citation/style manifests.
- incremental dependency invalidation.
- content hashes.

Exit: one corrected source invalidates only dependent package nodes.

### Wave 12 - artifact compilers

- chat/Markdown/DOCX/PDF/PPTX/XLSX/code/site/image/audio compilers in prioritized order.
- deterministic validation.
- render inspection.
- Memory vNext artifact registration.
- download/access flow.

Exit: formats agree on claims/data and pass file/render/read-back checks.

### Wave 13 - response intelligence and UI

- response-plan compiler.
- natural length/format policy.
- progress/events.
- mission inspection.
- evidence/memory/agent/artifact controls.
- owner steering.

Exit: simple chat stays simple; complex missions are inspectable without exposing fake reasoning.

### Wave 14 - security and adversarial hardening

- authority labels and taint.
- data-egress classification.
- memory/tool/MCP injection tests.
- secret scanning/redaction.
- sandbox/network/filesystem policies.
- cascading failure containment.

Exit: adversarial corpus cannot change goals, grant tools, poison canonical memory, or leak secrets.

### Wave 15 - evaluation and experience learning

- frozen replay.
- golden trajectories.
- controlled-intervention failures.
- route/agent/model scorecards.
- procedure candidate integration.
- shadow/canary/rollback.

Exit: no adaptive policy reaches production without evidence and rollback.

### Wave 16 - production readiness

- memory cutover prerequisite check.
- backup/restore.
- soak.
- provider outage drills.
- disk/DB/process/network chaos.
- owner acceptance.
- operational handbook.

Exit: all gates pass with signed evidence; otherwise AION remains shadow-only.

---

## 25. Evaluation corpus and acceptance tests

### 25.1 Conversation

- greeting, thanks, casual discussion: no agent/research overhead.
- answer length matches prompt.
- natural follow-up reference resolution.
- owner preference changes useful structure but does not create repetitive phrasing.
- correction overrides stale memory.

### 25.2 Routing and cost

- same prompt under Swift/Balanced/Sovereign uses only justified extra work.
- obvious current fact routes to targeted search, not Deep Research.
- deep due diligence becomes asynchronous.
- duplicate agents/searches are pruned.
- context size does not grow monotonically across a long mission.

### 25.3 Memory

- old explicit personal fact recalled in a relevant new conversation.
- changed weight/address/preference uses correct valid time.
- uncertain identity abstains.
- direct correction invalidates dependent context/artifacts.
- owner forget removes derived retrieval/graph/cache dependencies.
- room manifests expose pointers without copying raw domain data.
- provider state deletion does not remove local continuity.

### 25.4 Agents

- no agent for a simple prompt.
- one specialized agent for a bounded domain gap.
- independent parallel agents for separable subtasks.
- duplicate specialist proposals rejected.
- malicious/invalid blueprint denied.
- child tries to spawn recursively and is denied.
- expired lease blocks a tool call.
- failed agent returns a typed failure without polluting accepted claims.

### 25.5 Research

- official primary source outranks copied commentary.
- syndicated copies count as one origin.
- current and historical periods are not mixed.
- contrary evidence is retrieved for a contested recommendation.
- exact citations reopen to the supporting location.
- managed Deep Research output is treated as a packet and reverified.

### 25.6 Verification

- altered number/unit/date is caught.
- citation that mentions keywords but does not entail the claim is rejected.
- code that looks correct but fails hidden/edge tests is not promoted.
- LLM judge approves an injected error but deterministic verifier prevents promotion.
- one bad claim triggers local repair, not full mission regeneration.

### 25.7 Tools and automation

- safe read runs without unnecessary approval.
- recipient ambiguity stops before message commit.
- crash after prepared draft does not send.
- crash after commit reconciles instead of repeating.
- prompt injection in webpage/file/MCP response cannot invoke tools.
- unavailable preferred tool routes to a compatible adapter or honest block.

### 25.8 Artifacts

- report, deck, and spreadsheet share the same figures and accepted claims.
- source correction marks dependent artifacts stale.
- DOCX/PDF/PPTX render without overflow or missing citations.
- artifact move/rename remains resolvable.
- deleted artifact closes indexes/cache/parts under policy.

### 25.9 Durability and chaos

- backend process killed at every state transition.
- network dropped during provider stream.
- DB lock/disk-full simulation.
- provider returns 429/5xx/malformed schema.
- worker lease expires.
- owner cancels during parallel agents.
- restore from encrypted backup.
- projection rebuilt from ledger.

---

## 26. Release scorecard

AION cannot ship based on a single average score. It requires gates.

### Hard gates

- zero unauthorized side effects.
- zero cross-scope memory leakage.
- zero secrets in prompts/normal telemetry.
- 100% idempotency/reconciliation tests for supported commits.
- 100% restart recovery for supported mission states.
- all protected memory correction/forget tests pass.
- artifact formats open/render/read back.
- rollback demonstrated.

### Quality gates

- beats Cortex on complex contract completion.
- beats Eclipse or routes to Eclipse-equivalent execution on durable missions.
- does not regress Cortex-like conversational quality/latency on simple prompts.
- improves evidence coverage and citation correctness.
- calibrated route confidence and abstention.

### Efficiency gates

- high zero-call rate for trivial interactions.
- agent deployment improves verified success enough to justify overhead.
- context useful-token ratio remains within target.
- Deep Research admission is rare and explainable.
- cached/stateful calls demonstrate measured benefit under privacy policy.

---

## 27. Build-path mapping to the current repository

Reuse or adapt, do not blindly copy:

- `server/eclipse/orchestration/run-graph.js`: LangGraph/checkpoint/resume patterns.
- `server/eclipse/orchestration/nodes.js`: small nodes, `Send` fan-out, quarantine/promotion flow; replace fixed global pipeline with adaptive epochs.
- `server/eclipse/agents/blueprints.js`: versioned blueprint base.
- `server/eclipse/agents/foundry.js`: deterministic ephemeral-persona seed; expand qualification and capability coverage.
- `server/eclipse/agents/qualification.js`: zero-credit deterministic qualification seed.
- `server/eclipse/agents/reputation.js`: replace global EWMA with task/environment scorecards.
- `server/eclipse/agents/runtime.js`: typed packet and lease-mediated execution seed.
- `server/eclipse/capabilities/tool-gateway.js`: capability enforcement seed; unify with the main gateway.
- `server/eclipse/model/adapter.js`: one-call-boundary seed.
- `server/eclipse/model/interactions-client.js`: Interactions integration seed; update to current API contracts and privacy policy.
- `server/eclipse/reasoning/lattice.js`: bounded branch policies and targeted repair seed; integrate with calibrated Work Profile.
- `server/eclipse/evidence/promotion.js`: promotion seed; strengthen evidence/claim verification.
- `server/eclipse/artifact/reactor.js`: canonical content graph seed; evolve into Knowledge Package DAG and real compilers.
- `server/memory-vnext/*`: canonical memory/context/artifact/procedure/room interfaces.
- `server/capability-engine.js`, `server/tool-gateway.js`: main capability inventory and execution adapters.
- `server/action-fabric/*`, `server/automation/*`: world execution, receipts, lane routing, and task projection inputs.

Proposed new module boundary when implementation is approved:

```text
server/aion/
  contracts/
  kernel/
  routing/
  runtime/
  models/
  memory/
  tools/
  agents/
  research/
  knowledge/
  verification/
  artifacts/
  security/
  telemetry/
  evals/
```

No implementation starts by creating all folders. Each wave introduces only the modules it needs.

---

## 28. Decisions to lock before build

1. Confirm AION as the product name or replace it.
2. Decide whether AION is a selectable model, an automatic top-level runtime, or both.
3. Confirm Swift/Balanced/Sovereign naming.
4. Approve provider-storage policy classes.
5. Define consequence levels and mandatory approvals.
6. Prioritize first-release artifact formats.
7. Select the initial specialist roster.
8. Decide whether managed Deep Research is enabled at launch or shadow-only.
9. Define production latency and quality SLOs from the baseline.
10. Complete or explicitly schedule Memory vNext operational cutover before AION production activation.

---

## 29. Research basis

Primary official documentation:

- Gemini Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini background execution: https://ai.google.dev/gemini-api/docs/background-execution
- Gemini Deep Research: https://ai.google.dev/gemini-api/docs/deep-research
- Gemini tools: https://ai.google.dev/gemini-api/docs/tools
- Gemini tool combination: https://ai.google.dev/gemini-api/docs/tool-combination
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- Gemini Batch API: https://ai.google.dev/gemini-api/docs/batch-api
- Gemini pricing: https://ai.google.dev/gemini-api/docs/pricing
- Google ADK: https://adk.dev/
- Google ADK workflows: https://adk.dev/workflows/
- Google ADK evaluation: https://adk.dev/evaluate/
- LangGraph JS overview: https://docs.langchain.com/oss/javascript/langgraph/overview
- LangGraph JS persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph JS interrupts: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- LangGraph JS subgraphs: https://docs.langchain.com/oss/javascript/langgraph/use-subgraphs
- LangGraph workflows/agents: https://docs.langchain.com/oss/python/langgraph/workflows-agents
- Temporal documentation: https://docs.temporal.io/
- MCP specification: https://modelcontextprotocol.io/specification/
- MCP elicitation/security: https://modelcontextprotocol.io/specification/draft/client/elicitation
- OpenTelemetry GenAI semantic conventions: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
- NIST AI RMF Generative AI Profile: https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- OWASP Top 10 for Agentic Applications: https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/

Research papers informing specific design choices:

- Graph of Thoughts: https://arxiv.org/abs/2308.09687
- Scaling Test-time Compute for LLM Agents: https://arxiv.org/abs/2506.12928
- RouteLLM: https://arxiv.org/abs/2406.18665
- FrugalGPT: https://arxiv.org/abs/2305.05176
- AgentPrune: https://arxiv.org/abs/2410.02506
- RCR-Router: https://arxiv.org/abs/2508.04903
- Learning Agent Routing From Early Experience: https://arxiv.org/abs/2605.07180
- Single-Agent LLMs Outperform Multi-Agent Systems under Equal Thinking Budgets: https://arxiv.org/abs/2604.02460
- Active Context Compression: https://arxiv.org/abs/2601.07190
- ContextBudget: https://arxiv.org/abs/2604.01664
- Less Context, Better Agents: https://arxiv.org/abs/2606.10209
- LongMemEval: https://arxiv.org/abs/2410.10813
- LongMemEval-V2: https://arxiv.org/abs/2605.12493
- MemGPT: https://arxiv.org/abs/2310.08560
- A-MEM: https://arxiv.org/abs/2502.12110
- REFLECT evaluation of evidence-based research judges: https://arxiv.org/abs/2605.19196

These papers are evidence for design hypotheses, not automatic proof that a technique will improve JARVIS. Every technique still requires local replay and benchmark evidence.

---

## 30. Final definition of done

AION is complete only when it can demonstrate all of the following in the real JARVIS environment:

- Simple conversation remains fast, natural, and inexpensive.
- The right personal/project/room context appears without flooding prompts or leaking scope.
- Complex requests become explicit, resumable missions with honest progress.
- Specialist agents are deployed only when they add unique verified value.
- Research establishes claim coverage with primary, current, and contrary evidence where required.
- Tools perform real tasks through scoped permissions and verifiable receipts.
- Failures recover without duplicate external actions or fabricated completion.
- Claims, reports, presentations, spreadsheets, code, and websites agree because they derive from one Knowledge Package.
- Provider/model/tool failures degrade honestly and preserve the contract.
- Every important result is reproducible from context manifests, evidence, receipts, model/tool versions, and artifact hashes.
- Route, agent, memory, and procedure improvements pass replay, shadow, canary, and rollback gates.
- AION measurably beats Cortex and Eclipse on the tasks for which it is intended, while avoiding their unnecessary overhead on tasks for which it is not.

The benchmark is not whether AION looks complex. The benchmark is whether it behaves like an exact, adaptive machine: fast when the answer is easy, deep when the work is hard, restrained when extra computation has no value, and honest whenever the world prevents completion.
