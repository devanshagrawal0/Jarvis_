# ADR-019: Graph Retrieval Is a Gated Temporal Oracle

- Status: Accepted for Wave 20
- Date: 2026-07-25

Graph relationships carry scope, valid time, recorded time, provenance, confidence, and typed semantics. Traversal is bounded to three hops, PPR operates on a bounded subgraph, and every returned connection includes a reproducible path explanation.

Graph and global-community work is disabled for ordinary recall. It runs only when the retrieval planner permits the lane and expected relationship/global gain exceeds the baseline. Graph indexes and community reports are derived, deletable aids; they cannot become a second source of truth.

