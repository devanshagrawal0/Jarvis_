# ADR-009: Semantic Closure, Not Fixed Turn Counts

- Status: Accepted for Wave 10
- Date: 2026-07-24

Episode boundaries are driven by semantic evidence: topic overlap, explicit transitions or closure, idle gaps, task completion, and branch lifecycle. Clear cases are deterministic. Only ambiguous cases may call an injected, versioned local classifier. The hot reply path never depends on a provider call.

Each decision is recorded once per turn with its feature set, score, profile version, and reason. Non-contiguous returns create linked segments. Episodes retain exact ordered members and a coverage checksum. No rule promotes memory merely because a fixed number of turns elapsed.

