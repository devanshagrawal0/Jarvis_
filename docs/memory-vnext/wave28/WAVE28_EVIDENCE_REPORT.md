# Wave 28 Evidence Report - Device Mesh and Co-op Selective Sync

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Network connections: 0

## Delivered

- Scope-bound peer identities stored encrypted with keyed fingerprints.
- Expiring, signed, non-delegable capability leases with resource patterns.
- AES-256-GCM wire encryption and HMAC signatures using transient session keys.
- Encrypted-at-rest inbound and outbound logical envelopes.
- HLC wall/counter/node ordering and durable replay pointers.
- Exact duplicate idempotency, conflicting-envelope rejection, late-packet retention, and future-skew rejection.
- Selective packet recall under the same live lease capability and resource filters.
- Expiring shared memory packets and signed revocation receipts.
- Atomic peer/session/lease revocation across packets, envelopes, and collaborative documents.
- CRDT update storage only for approved collaborative UI/document domains.
- Hard rejection of database, SQLite, WAL, SHM, secret, credential, key, token, and password payloads.

## Verified

- Wire ciphertext and raw SQLite files do not contain the shared packet summary.
- A lease cannot widen authority or delegate.
- Unauthorized resources fail before envelope creation.
- A newer offline packet advances the replay pointer; an older arrival is retained as late without rewinding it.
- Exact replay is idempotent and tampered ciphertext fails signature validation.
- Excessive future HLC skew fails closed.
- Revoked leases cannot list packets.
- Natural expiry transitions both leases and shares out of active state.
- Canonical-memory CRDT updates are rejected.
- Controlled sync faults leave no envelope, packet, replay-pointer, or encrypted payload residue.

## Deliberate boundary

No WebSocket, WebRTC, TURN, relay, remote device, or production co-op session was used. Wave 28 builds the logical memory synchronization boundary; existing Device Mesh transport wiring remains unchanged until staged activation.
