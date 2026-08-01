# ADR-020: Consolidation Is Quarantined Replay Governance

- Status: Accepted for Wave 21
- Date: 2026-07-26

Consolidation may propose episodes, profiles, merges, conflict resolutions, lessons, and utility changes, but a proposal is not truth. Every proposal remains encrypted and quarantined with exact source/version coverage, uncovered-failure disclosure, sensitivity, risk, privacy class, and protected-target classification.

Promotion requires a frozen scope-matched replay corpus, exact case coverage, every required case passing, the configured pass-rate and improvement threshold, zero privacy violations, zero protected-mutation attempts, and direct owner approval. A promotion returns the candidate payload and a signed structural receipt but deliberately reports `canonicalMutationApplied=false`; a later canonical command must perform any real mutation through its own policy boundary.

Predictive staging is a separate deterministic optimization. It stages only record references under explicit scope, sensitivity, byte, token, cost, and TTL budgets; focus changes cancel prior work, and used versus wasted items remain measurable. Staging cannot promote truth or silently enlarge model context.
