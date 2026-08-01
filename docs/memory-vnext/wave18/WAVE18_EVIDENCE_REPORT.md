# Wave 18 Evidence Report - Memory-Need Gate and Adaptive Retrieval Planner

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Deterministic `none`, `working_only`, `exact`, `hybrid`, `live_domain`, and `deep` decisions.
- Inspectable classification features for greeting, acknowledgement, memory management, exact identifiers, continuity, freshness, relationships, research breadth, task risk, uncertainty, working-set sufficiency, and query size.
- Per-plan latency, cost, privacy, consistency, time-lens, and watermark records.
- Zero-retrieval handling for greetings and acknowledgements.
- Working-state-only handling for resolvable continuation prompts.
- Exact management/identifier routes that avoid general RAG.
- Live-domain routing with mandatory live consistency mode.
- Deep routes that remain budget constrained instead of automatically enabling every expensive lane.
- Deterministic relative-time expansion for yesterday, last week, and historical/before queries.
- Baseline Reciprocal Rank Fusion with versioned transparent feature weights.
- Hard exact-lane priority before fuzzy ranking.
- Bounded outcome-conditioned utility that cannot override exact truth.
- Cluster quotas for duplicate/diversity control.
- Candidate scope enforcement before fusion.
- Bounded mid-task retrieval for unresolved entities, missing procedures, tool failures, and low-confidence decisions.
- Verified helpful, distracting, missed-beneficial, correction, and neutral outcome records.
- Avoided-call telemetry and content-free route/candidate diagnostics.

## Verified

- A greeting selects `none`, schedules no lane, performs no model/provider call, and records all avoided baseline calls.
- Continuity, exact personal recall, semantic recall, live-domain, and deep research prompts select distinct routes.
- A zero-cost deep plan excludes the optional paid reranker while keeping local lanes.
- Exact results remain first even with poor historical utility and a lower raw channel rank.
- Duplicate report candidates are constrained by a per-cluster quota.
- Cross-scope fusion fails closed.
- Mid-task retrieval stops at the task budget.
- Unverified feedback produces zero utility change.
- A verified correction records negative utility but explicitly cannot override truth or safety.
- Planner transaction faults leave neither a plan nor its encrypted query.

## Deliberate boundary

The planner is deterministic and inspectable. It does not call a router model, reranker, Gemini, or external service. A learned routing policy may be evaluated later only through frozen counterfactual replay and may never bypass authorization, exact truth, directives, temporal validity, or provenance gates.

