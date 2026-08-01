# Wave 9 Evidence Report - Task, Checkpoint, Agent, and Tool Truth

Date: 2026-07-24  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Ordered dependency DAGs with cycle and invalid-edge rejection.
- Durable task and step status, attempts, active-step pointer, artifacts, and significant events.
- Explicit approval requests, expiry, decisions, and side-effect gating.
- Tool invocation identity from keyed argument hashes plus one durable idempotency key.
- Encrypted side-effect receipts that replay instead of repeating a completed operation.
- Encrypted task checkpoints with hashed, single-purpose resume tokens; plaintext tokens are never stored.
- Scoped agent leases with actor/grant checks and deterministic expiry.
- Active task projection into the Wave 8 Conversation State Kernel when a finalized source turn exists.
- Cognitive events accept significant task transitions only; arbitrary debug trace types fail closed.

## Verified

- Dependency readiness and input step order survive equal timestamps.
- Cyclic step plans are rejected before any row is written.
- Approval-required steps and external/irreversible tools cannot start without a live approval.
- Completed tool receipts replay with the original result and cost; changed arguments conflict.
- Checkpoint crash leaves no checkpoint or orphan encrypted snapshot.
- Resume rejects forged tokens and returns completed side effects separately from incomplete work.
- Expired agent leases become expired without changing completed task truth.
- Injected tool-receipt crash leaves the invocation running with no receipt or partial encrypted object.

