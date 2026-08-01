# Wave 26 Evidence Report - APEX/Forge Lineage and Freshness

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- APEX room snapshots for strategy, dataset, signal, test, outcome, report, market, watchlist, alert, run, and artifact pointers.
- Explicit raw-data and telemetry exclusions so APEX remains the live-domain owner.
- Immutable, versioned freshness contracts containing as-of, expiry, maximum age, source health, route, and encrypted live pointer.
- Freshness resolution that requires live fetch for stale, unknown, or live-pointer routes and allows snapshots only while explicitly fresh.
- Compact Forge run manifests for strategy version, graph version, branches, blocks, mutations, metrics, and domain references.
- Versioned Forge lineage written both to its run projection and the common room-manifest lineage.
- Evidence-backed APEX validation receipts, encrypted metrics, optional same-scope freshness binding, and signed receipt MACs.
- Scoped current-project and Forge-run reads.

## Verified

- Raw bars, ticks, prices, quotes, telemetry, trade logs, equity curves, code bodies, prompts, responses, and messages are rejected from compact manifests.
- Raw market-data and telemetry references are retained only as exclusions, not duplicated payloads.
- Fresh contracts may permit a snapshot; expiry deterministically changes the decision to live fetch.
- A contract version cannot be silently rewritten with different content.
- Forge branch/block/mutation/test/outcome/report lineage is queryable and versioned.
- Validation without evidence fails; valid receipts bind target version, evidence versions, and optional freshness.
- Scope mismatches fail before protected data is returned.
- Controlled Forge, freshness, and validation faults roll back every row and encrypted payload atomically, including the nested room publication.

## Deliberate boundary

No live price request, Kalshi request, backtest, Forge strategy execution, Gemini call, or production APEX publication occurred. The adapter contract deliberately routes live truth back to APEX instead of claiming cached memory is current.
