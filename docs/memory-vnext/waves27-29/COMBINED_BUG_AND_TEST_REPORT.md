# Waves 27-29 Combined Bug and Test Report

Date: 2026-07-26  
Batch result: Complete in isolated implementation/test mode

## Bugs and risks found and corrected

1. Wave 25’s room-reference constraint predated Eclipse and rejected mission, branch, node, and agent references. Wave 27 now performs a preservation migration that rebuilds the reference table, copies existing HELIX/APEX rows, restores the index, and adds the new kinds.
2. The first restore implementation imported the SQLite driver from an ordinary repository. That violated the protected single database-owner boundary. Snapshot inspection now runs through the core storage owner; repositories receive only the bounded inspection result.
3. The first full Command Center read model used several conceptual plan names instead of actual schema names (`assertion_conflicts`, `conversation_state_versions`, `predictive_staging_sessions`, and `policy_rules`). Every query now targets the canonical tables and is exercised against an empty schema-27 store.
4. Provider-cache status was initially queried as `state`; the canonical column is `status`. The live read-model smoke test caught and corrected it.
5. Backup restore originally preferred the local wrapped key and did not prove recovery wrapping. Restore now has an explicit recovery path, and the test forces scrypt recovery unwrap.
6. The first backup implementation created a closed encrypted package but lacked a governed off-runtime copy operation. Export now requires one-time owner confirmation, rejects the live runtime as a destination, performs atomic copy, re-hashes the destination, audits the action, and removes a failed export.
7. HLC implementation could not be accepted from creation tests alone. The suite now delivers packets out of order between independent stores, verifies exact replay, late retention, replay-pointer monotonicity, tamper rejection, and clock-skew denial.
8. Room package filtering could leak a private member through a public package summary. Eclipse recall returns a package only when all referenced members pass the same capability/trust filter.
9. Agent success could be mistaken for truth or automatic training approval. Agent experience links are signed but permanently non-promotable; Wave 24 remains the only governed procedure-promotion path.
10. Synchronizing collaborative state risked expanding into canonical memory replication. Packet validation rejects database/WAL bodies, and the CRDT allowlist excludes truth, identity, permission, and canonical memory domains.

## Gate result

- Waves 27-29 focused tests: 13/13 passed.
- Cumulative Memory vNext tests: 124/124 passed.
- Cumulative Memory vNext plus legacy personality-memory and Neural Vault regressions: 137/137 passed.
- All 66 JavaScript files under `server/memory-vnext`: syntax check passed.
- TypeScript `--noEmit`: passed.
- Production Vite build: passed (3,319 modules transformed).
- Migration schema 24 -> 27: verified backup, preserved encrypted fixture, all application tables STRICT, all 27 migrations recorded.
- Injected Wave 29 migration crash: rolled back to schema 26 with no partial operations tables and recovered to schema 27.
- Eclipse visibility, trust, capability, reasoning exclusion, outcome lineage, privacy, and rollback tests: passed.
- Mesh encryption, signing, capability, resource, offline HLC, duplicate, late, skew, tamper, expiry, revocation, CRDT, privacy, and rollback tests: passed.
- Owner confirmation, control, online backup, encrypted export, recovery restore, projection rebuild, read-model, soak, and rollback tests: passed.
- Memory repository-boundary guard: passed.
- Network/provider/Gemini calls: 0.
- Backend restart: not performed.
- Production vNext database: absent.
- Live legacy authority changes: 0.

## Deliberate non-activation

The integrations, synchronization service, operations service, and vNext Command Center are complete construction surfaces exercised against disposable encrypted stores. They are not mounted into live prompts, Eclipse, Device Mesh, co-op, or the legacy Memory UI. Import, reconciliation, owner review, shadow comparison, and progressive cutover remain Waves 30-32.
