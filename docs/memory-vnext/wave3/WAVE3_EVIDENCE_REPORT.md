# Wave 3 Evidence Report — Protected Core Storage

Date: 2026-07-23  
Result: Complete in isolated implementation/test mode  
Production core provisioned: No  
Legacy authority changed: No  
Paid provider calls: 0

## Delivered

- Safe `%LOCALAPPDATA%` default and repository/OneDrive rejection.
- Single-writer ownership lock with stale-lock preservation and owned release.
- SQLite WAL, foreign keys, bounded busy timeout, `synchronous=FULL`, checkpoint policy, and integrity checks.
- Three ordered transactional `STRICT` migrations with schema/check/FK constraints.
- Verified online pre-migration backups stored under the protected runtime root.
- AES-256-GCM encrypted objects with object-bound AAD and keyed content MAC.
- Windows current-user DPAPI wrapper with stdin key transfer.
- Atomic wrapped-key document write and fingerprint verification.
- Repository guard limiting the SQLite driver to `storage/core-store.js`.

## Tests

- Unsafe path denial.
- All application tables report SQLite `strict=1`.
- Plaintext fixture absent from the database bytes.
- AEAD/content-MAC tampering rejected.
- Wrapped-key loss rejected.
- Concurrent writer rejected and lock released on close/failure.
- Injected migration crash rolls back schema and `user_version`.
- v1-to-v3 online backup passes `quick_check`, hash verification, and restore continuity.
- Native Windows DPAPI protect/unprotect round trip passes with random non-production bytes.

No production vNext database was created. Activation remains behind the service/cutover gates.
