# Wave 20 Evidence Report - Temporal Graph, Hierarchy, and Multi-Hop Retrieval

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Typed graph nodes for owners, entities, assertions, episodes, tasks, agents, artifacts, sources, scopes, procedures, projects, topics, and rooms.
- Twenty-two bounded structural relationship types including dependency, provenance, contradiction, production, hierarchy, evidence, and version relations.
- Encrypted labels and edge attributes; structural graph indexes contain no prose payload.
- Scope-local edges with cross-scope rejection.
- Valid-time and recorded-time intervals for every edge.
- Recorded-time revision that preserves the edge state known before a later update.
- Evidence links for graph relationships.
- Bounded zero-to-three-hop traversal with path score and typed path explanation.
- Deterministic Personalized PageRank over a bounded local subgraph.
- Hierarchy navigation through `PART_OF`, `VERSION_OF`, and `BELONGS_TO_SCOPE`.
- Relationship/global expected-gain gate comparing graph need with baseline retrieval confidence.
- Ordinary `none`, working-only, exact, and live-domain plans skip graph access.
- Candidate/active/retired community reports with minimum-corpus activation thresholds.
- Community reports accessible only to the deep global lane.
- Dependency edges from canonical sources to derived graph edges.
- Correction/forget invalidation that marks dependent edges deleted and shreds encrypted attributes.
- Encrypted path explanations created inside the graph-run transaction.

## Verified

- Exact/ordinary recall skips graph work entirely.
- A two-hop strategy -> dataset -> source question returns the typed path and explanation.
- Hop count never exceeds three.
- Unauthorized graph scope fails before traversal.
- An old recorded-time query sees `PART_OF`; the current query sees its `DEPENDS_ON` revision instead.
- Bounded PPR reaches and ranks a multi-hop source.
- A corpus below the configured threshold cannot create a community report.
- A hybrid plan cannot retrieve a global community report; a deep global plan can.
- Owner-forget removes a derived graph edge through the same verified closure as other projections.
- Edge, node, community, traversal, and PPR payload creation is transactional.
- Injected edge/traversal crashes leave no orphan attributes or path explanations.

## Deliberate boundary

This is the exact bounded graph oracle. It does not run Neo4j, hosted GraphRAG, an LLM community summarizer, or graph work on every query. Large-corpus community detection and threshold tuning remain measured backends behind this gate.

