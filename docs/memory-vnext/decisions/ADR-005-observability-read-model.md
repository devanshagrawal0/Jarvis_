# ADR-005: Operational Observability Is a Content-Free Read Model

- Status: Accepted for Wave 6
- Date: 2026-07-24

The Memory Command Center reads structured operational state: canonical sequence, schema/WAL/integrity, migrations, jobs, worker leases, outbox, dead letters, policy denials, costs, projection cursors, and verified backups. It never reads or displays memory payloads through the operations path.

Correlation traces join commands, ledger events, outbox rows, jobs, metrics, and costs by identifiers and status metadata only. Metric/provider/model labels must be bounded identifiers so arbitrary memory or exception text cannot be smuggled into telemetry. Observer callback failures are isolated from health collection.

Operator actions are audited independently from their effects. A read model never mutates canonical truth merely because the UI opened it.
