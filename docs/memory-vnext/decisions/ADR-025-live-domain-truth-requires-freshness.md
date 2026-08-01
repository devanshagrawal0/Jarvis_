# ADR-025: Live Domain Truth Requires Explicit Freshness

- Status: Accepted for Wave 26
- Date: 2026-07-26

APEX owns raw prices, quotes, bars, ticks, trade logs, equity curves, and telemetry. Memory stores versioned pointers, decisions, validated outcomes, compact Forge structure, and lineage. This prevents a stale global-memory copy from silently becoming market truth.

Every reusable APEX snapshot can carry an immutable freshness contract with scope, reference type/ID/version, as-of time, expiry, maximum age, route, source health, and encrypted live pointer. Resolution returns explicit `fresh`, `stale`, or `unknown` state. A snapshot is usable only while fresh and only when its route permits snapshots; live pointers or stale/unknown state require a live APEX fetch.

Forge publishes compact strategy, graph, branch, block, mutation, dataset, signal, test, outcome, and report references. Run metrics and structural manifests are encrypted, while source-to-test-to-outcome-to-report lineage remains queryable. Validation requires versioned evidence references and may bind to a same-scope freshness contract; its receipt is signed.

No market provider, backtest engine, Gemini model, or live APEX adapter was invoked to implement this contract. Wave 26 establishes the storage, publication, freshness, and validation boundary that a future live adapter must satisfy.
