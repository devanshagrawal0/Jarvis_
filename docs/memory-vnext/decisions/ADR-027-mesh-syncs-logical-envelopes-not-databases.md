# ADR-027: Device Mesh Synchronizes Logical Envelopes, Never Databases

- Status: Accepted for Wave 28
- Date: 2026-07-26

Device Mesh and co-op synchronization operate on bounded logical packets. Live SQLite files, WAL/SHM files, database bytes, secrets, credentials, tokens, and unrestricted memory bodies are rejected at the boundary.

Peers are scope-bound. Every session uses an expiring, non-delegable capability lease constrained by packet capability and resource pattern. Wire payloads use AES-256-GCM with a transient 32-byte session key and an HMAC signature; the session key is never persisted. Decrypted packet content is immediately re-encrypted under the local Memory vNext keyring.

Hybrid logical clocks order packets by wall time, counter, and node. Exact duplicate envelopes are idempotent, conflicting IDs fail closed, offline late arrivals are retained without rewinding the replay pointer, and excessive future clock skew is rejected. Revocation atomically disables leases, envelopes, packets, and collaborative updates; expiry removes packets from active selective recall.

CRDT updates are permitted only for collaborative layout, scratchpad, whiteboard, task-board, and decision-log documents. Canonical memory, truth, permissions, identity, and database state are never CRDT domains.
