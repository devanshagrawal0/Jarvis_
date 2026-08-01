# ADR-013: Forgetting Requires Verified Dependency Closure

- Status: Accepted for Wave 14
- Date: 2026-07-24

A tombstone on one canonical row is not forgetting. An exact owner-authorized forget job freezes target projection, expands linked canonical targets, walks the recursive dependency graph, scrubs encrypted canonical/event payloads, deletes or redacts registered copies, verifies closure, and only then emits a signed content-free receipt.

Ambiguous target resolution never guesses. Unsupported canonical dependents fail the transaction before destructive commit. Structural event history may remain only after its private payload is removed. Correction uses the same dependency graph for invalidation but retains historical truth according to bitemporal semantics.

