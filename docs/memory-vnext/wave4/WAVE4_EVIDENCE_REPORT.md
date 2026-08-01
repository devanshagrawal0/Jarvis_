# Wave 4 Evidence Report — Ledger, Outbox, Supervisor, and Jobs

Date: 2026-07-23  
Result: Complete in isolated implementation/test mode  
Legacy authority changed: No  
Paid provider calls: 0

## Delivered

- Selective encrypted event envelope with global and per-stream monotonic sequence.
- HMAC previous-event chain covering causation/correlation/device-clock metadata.
- Atomic canonical state, ledger, stream head, outbox, and command receipt transaction.
- Actor-scoped command idempotency and canonical compare-and-swap versions.
- Ordered outbox leasing, completion, retry/backoff, expiry reaping, and dead-letter state.
- Durable job queue with immutable input references, prerequisites, latency classes, cost ceilings, backpressure, cancellation, worker leases/heartbeats, retry, dead letter, and receipts.
- Deterministic Supervisor running/paused/draining controls and health state.

## Tests

- Idempotent replay creates one canonical effect.
- Injected crash after outbox insertion rolls back encrypted payloads, canonical state, sequence, ledger, outbox, and receipt.
- Correlation-field tampering breaks stream verification.
- Same-partition jobs cannot overtake earlier work.
- Expired leases re-enter bounded retry.
- Completion receipt replay is idempotent.
- Raw worker failure text is replaced by a controlled error code.
- Pause/drain rejects new work without deleting state.
