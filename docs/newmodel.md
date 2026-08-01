# New Model Program — AION Cognitive Runtime

Status: design record only; not implemented  
Owner decision required before build  
Created: 2026-07-23  
Scope: the proposed model tier above Cortex and Eclipse

## 1. Purpose

AION is the working name for a new JARVIS model class. It is not merely a renamed Gemini model and it is not a fixed multi-agent graph. It is a cognitive runtime that selects models, memory, tools, research depth, agents, verification, and output form according to the request.

The design objective is:

- Stay conversational and fast for ordinary prompts.
- Become substantially more analytical when the request requires it.
- Conduct reproducible, source-backed research rather than decorative searching.
- Know the owner, active projects, rooms, decisions, and artifacts through a reliable memory system.
- Create useful deliverables, not only chat text.
- Allocate expensive reasoning only where its expected value justifies cost and latency.
- Preserve a durable state so long missions can pause, resume, and be inspected.

## 2. Product position

The intended model family after the proposed simplification is:

| Product | Role | Execution character |
|---|---|---|
| Cortex | Everyday personal JARVIS | Fast conversation, memory, tools, current information, bounded reasoning |
| Eclipse | Durable structured mission engine | Multi-step research and analysis with persisted evidence and artifacts |
| AION | Adaptive cognitive runtime | Dynamically composes reasoning, research, agents, memory, verification, and creation |

AION is above Eclipse in adaptability, not merely in model price. Eclipse can remain a deliberate mission mode with a visible graph. AION decides whether a graph, direct response, research campaign, specialist team, calculation, or artifact pipeline is appropriate.

## 3. Non-negotiable distinction

AION must not be marketed internally as a newly trained foundation model unless an actual model is trained or fine-tuned. Its buildable definition is:

~~~text
AION =
Adaptive Compute Governor
+ Cognitive Contract
+ Hypothesis Graph
+ Evidence-Causal Research Engine
+ Personal Memory Lattice
+ Permissioned Agent Fabric
+ Independent Verification Tribunal
+ Canonical Knowledge Package
+ Multi-format Intelligence Compiler
+ Durable Cognitive State
+ Continuous Evaluation
~~~

Gemini models provide inference. AION supplies the system-level intelligence and execution discipline.

## 4. Core design principle: model-predictive cognition

AION does not execute one fixed sequence for every request. After each observation it selects the next action with the highest expected utility.

~~~text
Utility(action) =
  expected information gain
  + expected accuracy improvement
  + expected user value
  + personalization value
  - latency cost
  - token/API cost
  - duplication penalty
  - operational risk
  - permission risk
~~~

Possible next actions include:

- Answer directly.
- Ask one necessary clarification.
- Retrieve personal or project memory.
- Search the public web.
- inspect a known URL or uploaded file.
- Run a calculation or code experiment.
- Generate alternative hypotheses.
- Ask a specialist agent.
- Verify a claim independently.
- Repair a weak section.
- Produce or render an artifact.
- Stop because further computation has diminishing expected value.

The controller plans a short horizon, executes one or a bounded group of actions, observes the results, and replans. This prevents both shallow answers and uncontrolled agent swarms.

## 5. Execution classes

These are internal compute classes. The user may choose an effort ceiling, but the governor may finish earlier.

| Class | Appropriate work | Typical behavior |
|---|---|---|
| Reflex | Greetings, controls, simple recall | Local classification, direct response, optional exact memory lookup |
| Focus | Writing, explanation, bounded analysis | Context retrieval, one primary reasoning pass, lightweight verification |
| Deliberate | Strategy, comparisons, technical analysis | Decomposition, selective parallel retrieval, competing hypotheses, critic |
| Expedition | Due diligence, major research, complex creation | Background mission, research swarm, computation, iterative verification, artifacts |

Proposed user-facing effort controls:

- Swift: latency-prioritized ceiling.
- Balanced: adaptive default.
- Sovereign: high compute ceiling.

Effort must be a ceiling, not a command to waste computation. A greeting in Sovereign still receives a fast conversational response.

## 6. End-to-end cognitive cycle

### 6.1 Intake and request crystallization

Convert the raw prompt into a Cognitive Contract containing:

- Literal request.
- Inferred objective, marked explicitly as an inference.
- Required deliverables.
- Required freshness.
- Consequence of error.
- Personal/project context requirements.
- Required research breadth.
- Output format and expected audience.
- Tool and side-effect permissions.
- Cost and latency ceilings.
- Ambiguities that would materially alter the outcome.
- Completion and verification criteria.

Every component receives the same contract. Subagents must not receive lossy paraphrases without access to the original request.

### 6.2 Context resonance

Construct a bounded context package from:

- Current conversation.
- Relevant original episodes.
- Stable user facts and preferences.
- Recent tasks and unresolved commitments.
- Active projects and rooms.
- Related files and artifacts.
- Previous decisions and corrections.
- Relevant people, companies, instruments, and entities.
- Current time, location, and application state.

Suggested ranking:

~~~text
MemoryScore =
  semantic match
  + entity overlap
  + temporal relevance
  + project affinity
  + causal relevance
  + user importance
  + explicit-reference bonus
  - contradiction penalty
  - staleness penalty
~~~

### 6.3 Complexity and uncertainty prediction

A cheap routing model estimates:

- Complexity and number of dependent steps.
- Freshness need.
- Private-data need.
- Domain count.
- Ambiguity.
- Verification difficulty.
- Expected benefit of parallelism.
- Estimated value of deeper compute.

The result is an initial budget and capability contract, not a hardcoded graph.

### 6.4 Hypothesis graph

Reasoning state is represented as a typed graph.

Node types:

- Question.
- Assumption.
- Candidate explanation.
- Claim.
- Evidence.
- Counterargument.
- Calculation.
- Decision.
- Unknown.
- Proposed action.

Edge types:

- Supports.
- Contradicts.
- Depends on.
- Refines.
- Causes.
- Derived from.
- Supersedes.
- Requires verification.

Only useful, user-inspectable reasoning metadata should be exposed: plans, assumptions, evidence, decisions, tool actions, and concise reasoning summaries. The product must not fabricate or promise raw private chain-of-thought.

### 6.5 Cognitive auction

Specialists submit lightweight bids before being launched:

- Proposed task.
- Expected information gain.
- Required capabilities.
- Estimated latency.
- Estimated cost.
- Dependency list.
- Duplicate-work probability.
- Verification value.

The governor selects the smallest portfolio with the highest expected utility. Agents are not launched simply because a high effort level was selected.

### 6.6 Research campaign

Research begins with a coverage map:

- What must be established?
- What is already known from reliable context?
- What requires current evidence?
- Which claims require primary sources?
- Which disagreements must be resolved?
- What evidence could change the conclusion?

Research loop:

1. Decompose the question.
2. Generate diversified queries.
3. Assign source roles.
4. Discover sources in parallel where beneficial.
5. Read relevant pages/documents, not only snippets.
6. Extract evidence atoms.
7. Deduplicate sources and syndicated claims.
8. Link evidence to candidate claims.
9. Detect conflicts, gaps, and scope mismatches.
10. Run targeted follow-up queries.
11. Decide whether evidence is sufficient.
12. Preserve the campaign for replay and citation.

Source portfolio:

- Primary documentation.
- Official statistics and datasets.
- Regulatory filings.
- Research papers.
- Company disclosures.
- High-quality original reporting.
- Credible expert analysis.
- Contrary evidence.
- Historical evidence when comparison requires it.

### 6.7 Evidence atoms and claim ledger

Minimum evidence object:

~~~json
{
  "evidenceId": "ev_...",
  "claimCandidate": "...",
  "sourceUri": "...",
  "sourceType": "official_dataset",
  "retrievedAt": "...",
  "publishedAt": "...",
  "supportingExcerpt": "...",
  "location": "table 4, row 7",
  "scope": "...",
  "confidence": 0.0,
  "freshness": 0.0,
  "limitations": [],
  "contradictions": [],
  "contentHash": "..."
}
~~~

Verification must test entailment, numeric fidelity, geography, period, source primacy, retained uncertainty, freshness, and contrary evidence. Mere word overlap is insufficient.

### 6.8 Independent verification tribunal

Use verification appropriate to the claim:

| Claim type | Verification method |
|---|---|
| Current fact | Independent source and freshness check |
| Mathematical result | Recompute independently |
| Code behavior | Test, execute safely, or statically verify |
| Market/data claim | Inspect dataset, period, units, and revisions |
| Causal claim | Alternative-explanation and confounder review |
| Recommendation | Constraint, downside, and counterfactual analysis |
| Personal memory | Inspect source episode and correction history |
| Artifact claim | Render and inspect final output |

Where practical, the verifier should not be told which agent produced a claim. Verification outputs must be structured and must not silently approve unsupported prose.

### 6.9 Synthesis and output morphogenesis

The synthesizer receives structured accepted claims, unresolved disputes, evidence atoms, computations, memory context, and output constraints. It must not synthesize directly from a pile of competing essays.

Create one canonical Knowledge Package and compile it into:

- Conversational answer.
- Executive debrief.
- Research report or paper.
- Strategy document.
- Presentation.
- Spreadsheet.
- Python analysis.
- Website or dashboard.
- Infographic.
- Audio briefing.
- Structured dataset.
- Reusable context package.

All representations must share the same accepted-claim graph so the report, deck, and dashboard cannot quietly disagree.

### 6.10 Commit and continuation

At completion:

- Save the Cognitive Contract.
- Save the execution graph and event log.
- Save evidence and citations.
- Register artifacts and hashes.
- Store accepted user/project memories with provenance.
- Store unresolved questions and commitments.
- Record cost, latency, failures, and retries.
- Permit continuation by mission ID after restart.

## 7. Memory architecture

Required memory classes:

- Ground-truth episodic memory: original conversations and task episodes.
- Semantic memory: stable extracted facts linked to episodes.
- Preference memory: communication and workflow preferences.
- Procedural memory: how the owner prefers recurring work performed.
- Project memory: objectives, decisions, state, files, and dependencies.
- Entity memory: people, organizations, products, and relationships.
- Temporal memory: validity intervals and changes over time.
- Commitment memory: promises, deadlines, and unresolved work.
- Correction memory: explicit owner corrections and superseded beliefs.
- Room memory: Helix, Apex, Forge, Eclipse, and future-room state.
- Artifact memory: generated deliverables and provenance.
- Meta-memory: retrieval usefulness, confidence, and correction rate.

Rules:

- Never replace an original episode with a summary.
- Treat extracted memories as interpretations linked to ground truth.
- Distinguish explicit statements from inference.
- Track confidence, provenance, and temporal validity.
- Allow contradiction rather than overwriting silently.
- Retrieve adaptively; do not send the full memory store on every turn.
- Show what memory affected an important answer.

## 8. Agent fabric

Agent categories:

- Persistent primary specialists with tested blueprints.
- Ephemeral task specialists generated from an approved blueprint schema.
- Deterministic workers for parsing, ranking, calculation, and formatting.
- Independent critics and verifiers.

Every agent instance requires:

- Agent blueprint/version.
- Cognitive Contract slice plus original request reference.
- Allowed tools and data domains.
- Read/write boundaries.
- Side-effect policy.
- Time/token/cost budget.
- Required output schema.
- Evidence and provenance obligations.
- Termination conditions.
- Escalation path.

No agent receives unrestricted access merely because it is specialized. Permission boundaries improve reliability as well as security by preventing accidental cross-task actions.

## 9. Gemini capability mapping

This mapping is a dated design assumption and must be revalidated at implementation time.

| Role | Proposed capability |
|---|---|
| Cheap classification/extraction | Fast Flash-Lite-class model |
| Default agentic reasoning | Stable Flash-class model with tools and grounding |
| Difficult arbitration | Pro-class reasoning model |
| Rapid current facts | Native search grounding |
| Known-page reading | URL Context or controlled fetch/read |
| User corpora | File Search plus local retrieval |
| Computation | Managed code execution or secure local sandbox |
| Extended research | Gemini Deep Research, selectively |
| External services | Permissioned function calls or MCP |
| Images | Native image-generation model |
| Long work | Interactions background execution with durable local tracking |

Do not hardcode product behavior to model strings. Use a versioned registry with capability descriptors, health, stable/preview status, cost, latency, and contract-aware fallback.

## 10. Speed architecture

Run three bounded tracks:

1. Foreground: acknowledge, interpret, stream useful progress, and provide safe partial results.
2. Background: long research, document reading, agents, computation, and artifact rendering.
3. Speculative: prefetch likely memory/source context and cancel unused work.

Product experience targets, subject to measurement:

- Local acknowledgment under 300 ms.
- First visible progress under 700 ms.
- First meaningful streamed content in approximately 1–3 seconds.
- Focus response in approximately 3–10 seconds.
- Deliberate response in approximately 10–45 seconds.
- Expedition runs asynchronously with reconnectable progress.

Use context-prefix stability, provider caching, result caching with freshness policies, parallel independent reads, circuit breakers, and cancellation. Do not parallelize dependent reasoning steps merely to appear busy.

## 11. Cognitive interface

Required surfaces:

- Current objective and completion contract.
- Execution class and effort ceiling.
- Research coverage map.
- Live and completed actions.
- Evidence count by source quality.
- Unresolved contradictions and gaps.
- Hypothesis/claim graph.
- Memories used.
- Agent roster and contribution.
- Cost, latency, retries, and model path.
- Artifact dock.
- Why-this-conclusion inspection.
- Challenge-this-assumption control.
- Search-deeper-here control.
- Exclude-source control.
- Convert-to-artifact menu.
- Background mission resume/cancel controls.

The interface exposes observable work and evidence, not invented internal monologue.

## 12. Reliability and safety kernel

Required controls:

- Capability-based leases.
- Human confirmation for material side effects.
- Idempotency keys and receipts.
- Separate read and write tools.
- Secure code execution; never rely on an in-process language VM as a hostile-code sandbox.
- Per-agent budgets enforced at the gateway.
- Model/provider circuit breakers.
- Contract-aware failover.
- Privacy mode controlling provider storage.
- Secret isolation and redaction.
- Complete event and provenance logs.
- Honest degradation when freshness or verification requirements cannot be met.

## 13. Evaluation program

Measure the system, not only prose preference.

### Quality

- Task completion.
- Factual correctness.
- Citation entailment.
- Source precision and diversity.
- Evidence coverage.
- Contradiction discovery.
- Calculation/code correctness.
- Recommendation constraint satisfaction.

### Memory

- Episodic recall.
- Temporal correctness.
- Correction adherence.
- Relevant-memory precision.
- Unsupported-personalization rate.
- Cross-room continuity.

### Operations

- Tool success and recovery.
- Resume-after-restart success.
- Duplicate-agent work.
- Wasted branches.
- P50/P95 latency.
- Cost per successful task.
- Provider/model failover success.
- Artifact render and download success.

### User experience

- Time to first useful information.
- Answer-structure appropriateness.
- Progress honesty.
- Control discoverability.
- Artifact usefulness.
- Correction effort.

## 14. Proposed implementation eras

No era starts without explicit approval.

### Era A — contracts and observability

- Canonical Cognitive Contract.
- Capability-aware model registry.
- Unified event schema.
- Durable mission/run identity.
- End-to-end trace viewer.
- Baseline evaluation corpus.

### Era B — memory lattice

- Original episode store.
- Typed extracted memories.
- Provenance and temporal validity.
- Hybrid retrieval/reranking.
- Correction and contradiction handling.
- Cross-room context packages.

### Era C — evidence research engine

- Coverage planner.
- Search/read adapters.
- Evidence atoms.
- Claim-evidence graph.
- Gap and contradiction loops.
- Source-quality policy.

### Era D — adaptive cognitive governor

- Complexity predictor.
- Action-value estimates.
- Dynamic graph expansion/pruning.
- Stop conditions.
- Cost/latency controls.
- Cognitive auction.

### Era E — agent and verification fabric

- Blueprint registry.
- Ephemeral agent creation.
- Isolated sessions.
- Independent verification.
- Process and outcome scoring.
- Recovery and replay.

### Era F — knowledge package and artifact compiler

- Canonical accepted-claim package.
- Report, paper, deck, spreadsheet, code, and site compilers.
- Citation and style validation.
- Render verification.
- Artifact registry and download/access flow.

### Era G — cognitive UI and controlled rollout

- Live objective/progress/evidence UI.
- Graph and source inspection.
- Background mission controls.
- Shadow evaluation.
- Canary rollout.
- Cost and quality tuning.

## 15. Research basis

- Gemini Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini background execution: https://ai.google.dev/gemini-api/docs/background-execution
- Gemini Deep Research Agent: https://ai.google.dev/gemini-api/docs/deep-research
- Gemini function calling: https://ai.google.dev/gemini-api/docs/function-calling
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching
- Graph of Thoughts: https://arxiv.org/abs/2308.09687
- Scaling Test-time Compute for LLM Agents: https://arxiv.org/abs/2506.12928
- Adaptive Test-Time Compute Allocation: https://arxiv.org/abs/2604.14853
- ThinkPRM: https://arxiv.org/abs/2504.16828
- MemGPT: https://arxiv.org/abs/2310.08560
- A-MEM: https://arxiv.org/abs/2502.12110
- MemMachine: https://arxiv.org/abs/2604.04853

## 16. Decisions still required

- Final product name; AION is a working name.
- Whether AION is visible as a model or invoked automatically above Eclipse.
- User-facing effort names.
- Maximum default cost and latency.
- Which provider-managed agents are permitted.
- Local versus provider storage defaults.
- Which artifact formats are required in the first release.
- Which actions always require confirmation.
- Whether Eclipse remains independently selectable after AION launches.
- Whether AION may automatically continue work in the background.

## 17. Definition of done

AION is not complete because a graph runs or multiple agents produce output. It is complete only when it measurably:

- Preserves fast normal conversation.
- Selects deeper computation appropriately.
- Retrieves personal/project context with provenance.
- Produces verified research with reproducible citations.
- Resumes missions after process restart.
- Generates consistent, downloadable artifacts.
- Exposes useful progress and evidence.
- Beats Cortex and Eclipse on agreed quality benchmarks within agreed cost/latency ceilings.
- Degrades honestly when required evidence, tools, or providers are unavailable.

