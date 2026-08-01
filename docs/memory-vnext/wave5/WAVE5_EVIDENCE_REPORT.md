# Wave 5 Evidence Report — Policies, Capabilities, and Keys

Date: 2026-07-23  
Result: Complete in isolated implementation/test mode  
Legacy authority changed: No  
Paid provider calls: 0

## Delivered

- Typed actors, scope lattice, containment edges, and cycle rejection.
- Versioned policy, grant, denial, retention, key metadata, and key-event tables.
- Deny-before-access evaluator for actor/capability/scope/purpose/sensitivity/channel/share.
- Direct-owner baseline and fail-closed non-owner behavior.
- Purpose/resource/sensitivity-bound agent leases with maximum expiry.
- Co-op-session grants with collaborator and expiry enforcement.
- Supervisor policy attachment before canonical command commit.
- Per-scope wrapped data keys, recovery tests, transactional rotation, retiring state, and cryptographic destruction.

## Tests

- Wrong purpose, excessive sensitivity, cloud, missing lease, and expired lease deny before commit.
- Private owner cloud access is denied; internal cloud access returns explicit `ask`.
- Scope-containment cycles are rejected.
- Co-op authority expires automatically.
- Only one authorized agent event commits; denied command creates no ledger event.
- Rotation produces a distinct active key and preserves metadata.
- Injected rotation crash rolls retirement back, leaving the prior key active and recoverable.
- Destroyed retired key material is physically null while non-secret audit metadata remains.
