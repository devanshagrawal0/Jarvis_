# Wave 2 Evidence Report — Logical Memory Service Boundary

Date: 2026-07-23  
Result: Complete  
Runtime restart performed: No  
Legacy authority changed: No  
Paid provider/API calls: 0

## Delivered

- Versioned query and command contracts with typed validation and public error mapping.
- Explicit authority modes and a health payload that proves `dualWritable: false` and `canonicalStoreCreated: false`.
- Dependency-injected Memory Service with owner/scope/purpose authorization before retrieval.
- Read-only legacy `memory-store` adapter.
- Health-only Neural Vault adapter; its current search method is intentionally excluded because it mutates access metadata.
- Bounded compatibility search with normalization, deterministic deduplication, adapter timeouts, and content-free telemetry.
- Side-effect-free, in-memory idempotent `memory.noop.v1` vertical slice.
- Fail-closed declarations for future remember/correct/forget/pin commands.
- Direct-local-owner HTTP routes for health, search, and no-op.
- Repository boundary guard preventing new production modules from constructing legacy memory stores and restricting the later vNext database driver to one protected core owner.
- Narrow integration into the existing composition root and graceful shutdown path.

## Verification

Commands run:

```text
node scripts/memory-vnext-boundary-guard.mjs
node --test tests/backend/memory-vnext-service.test.js tests/backend/memory-vnext-wave1.test.js
node --check server.js
Get-ChildItem server/memory-vnext/*.js | ForEach-Object { node --check $_.FullName }
```

Conformance coverage includes:

1. single writable legacy authority;
2. no vNext store and no dual-write state;
3. all mutation commands rejected before adapter access;
4. no-op idempotency with no side effect;
5. authorization and owner scope before retrieval;
6. deterministic deduplication and bounded results;
7. no query or memory text in telemetry;
8. sanitized adapter failures;
9. secret-bearing field rejection;
10. writable-adapter rejection;
11. Neural Vault search not invoked;
12. direct-owner-only HTTP behavior;
13. no database driver/direct SQL in the boundary;
14. server composition/shutdown wiring;
15. repository bypass guard;
16. Wave 1 sanitized replay fixture remains valid.

## Safety assessment

No live database was opened by the new boundary itself, no old database was deleted, no legacy writer was disabled, no API key/token value was read or copied, and no network/provider call was introduced. The currently running backend has not been restarted in this wave, so the new routes become live only on the next controlled restart.

## Exit-gate decision

Wave 2 exit is satisfied: a test caller can submit a versioned command/query through the contract, the no-op/read-only slice works, dependency injection isolates legacy storage, and automated checks detect a new constructor bypass. Wave 3 may create protected core storage only after its own migration, encryption, key-loss/recovery, crash, and path-safety gates are implemented.
