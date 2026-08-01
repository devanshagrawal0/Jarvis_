# ADR-003: Ledger, Transactional Outbox, Supervisor, and Workers

- Status: Accepted for Wave 4
- Date: 2026-07-23

## Decision

A deterministic Memory Supervisor controls canonical commands. Within one `BEGIN IMMEDIATE` transaction it commits the encrypted event payload, optional canonical object/version, global and stream sequences, HMAC-chained ledger event, stream head, outbox rows, and command receipt. A fault before commit leaves none of these effects behind.

Outbox and job delivery is at-least-once. Correctness comes from caller idempotency keys, unique constraints, compare-and-swap canonical versions, ordered partitions, leases, bounded retry/backoff, immutable input references, and durable receipts. Repeated failures become visible dead letters; they are never represented as successful work.

The Supervisor supports running, paused, and draining modes. Pausing or draining blocks new accepted work without deleting queued or committed state.

## Integrity boundary

The ledger MAC covers event identity, global/stream sequence, actor, scope, times, causation, correlation, device clock, idempotency key, encrypted-payload content MAC, and previous stream MAC. Changing any covered field breaks verification.
