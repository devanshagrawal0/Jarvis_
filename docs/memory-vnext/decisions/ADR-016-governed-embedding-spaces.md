# ADR-016: Embeddings Are Governed, Versioned Projection Spaces

- Status: Accepted for Wave 17
- Date: 2026-07-25

An embedding is identified by its complete space: provider, model and version, dimensions, modality, preprocessing version, task instruction, metric, and normalization behavior. Records from different spaces may never share an index or query.

Only selection policy can request an embedding. Exact-only records are skipped; private and restricted content remains local; cloud work is also subject to eligibility, budget, and circuit state. Vectors are encrypted, derived, deletable projections—not canonical memory. Missing adapters or indexes degrade to exact, lexical, graph, and task lanes.

