# Waves 18-20 Combined Bug and Test Report

Date: 2026-07-25  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. Uppercase ticker detection initially used a case-insensitive expression, causing ordinary words such as `hi` to appear identifier-like. Ticker detection now requires truly uppercase input.
2. Fusion candidates initially lacked an explicit scope column and authorization check. Candidate scope is now required in storage and validated before ranking.
3. Outcome utility was initially recorded but absent from the transparent feature score. It is now a bounded feature and exact results still receive hard ordering priority.
4. The planner initially stored only an explicit time lens. Deterministic yesterday, last-seven-days, and historical expansion now becomes part of the signed query identity.
5. Mid-task retrieval could be authorized but had no explicit consumption transition. An allowed checkpoint now binds to its resulting plan through `consumeMidtask`.
6. Context pack uniqueness would have prevented rebuilding an identical manifest after correction invalidated the old pack. Replay now targets only live packs and the schema permits a new post-invalidation instance.
7. Custom context-profile block order was used during selection but ignored during reproduction. Reproduction now reads the exact profile order stored with the pack profile.
8. Provider privacy initially relied only on the context profile. Provider-allowed sensitivities are now intersected with profile policy before selection.
9. Silently excluding a provider-ineligible protected directive could change system behavior. Such a pack now fails closed with a typed error.
10. Trusted factual items initially required a non-empty reference array but not a reference version. Source ID and version are now both mandatory.
11. Released/expired context-block leases retained foreign-key payload references while attempting encrypted deletion. Lease payload columns now support verified nulling for terminal states, and shredding occurs in the same transaction.
12. New context packs and graph edges were not originally part of correction/forget closure. Both are now registered projection dependents with typed purge and residue verification.
13. The first graph PPR implementation reused a traversal run, which would have persisted BFS scores while returning PPR scores. PPR now writes its own exact run and score/path results.
14. Graph edge attributes were first encrypted just before the edge transaction. An injected crash exposed an orphan encrypted object; encryption now occurs inside the transaction.
15. Graph path explanations had the same pre-transaction residue risk. They now commit or roll back with the graph run.
16. Graph node labels and community reports were hardened to the same transactional encryption rule before the final gate.

## Gate result

- Waves 18-20 focused tests: 12/12 passed.
- Cumulative Memory vNext tests: 87/87 passed.
- Cumulative Memory vNext plus legacy personality-memory and Neural Vault regressions: 100/100 passed.
- Migration 15 -> 18: verified backup, preserved encrypted fixture, all 18 migrations recorded, all application tables STRICT.
- Injected Wave 20 migration crash: rolled back to schema 17 with no partial graph tables and recovered to schema 18.
- Six-way retrieval routing and avoided-call tests: passed.
- RRF, exact priority, diversity, utility, temporal expansion, scope, and mid-task budget tests: passed.
- Six model/effort profiles, deterministic reproduction, privacy, source, budget, lease, injection, and influence tests: passed.
- Temporal traversal, recorded-time revision, hierarchy, PPR, community threshold, global gate, and path explanation tests: passed.
- Context-pack and graph-edge owner-forget closure: passed.
- Planner, context, graph-edge, and graph-run transaction fault tests: passed.
- Memory boundary guard: passed.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Default production vNext database: not provisioned.
- Live legacy authority changes: 0.

## Deliberate non-activation

The planner, context runtime, and temporal graph are isolated construction APIs and test oracles. They are not wired to the live JARVIS reply path. Legacy memory remains the sole live authority; no dual read/write, provider reranking, production graph build, or context injection occurred.

