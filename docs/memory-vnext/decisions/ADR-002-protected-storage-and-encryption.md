# ADR-002: Protected Core Storage and Encryption

- Status: Accepted for Wave 3
- Date: 2026-07-23

## Decision

The canonical core will use one SQLite database rooted at `%LOCALAPPDATA%\Jarvis\memory-vNext\core`, outside the repository and OneDrive. One process owns the writer lock. The connection enables foreign keys, WAL, bounded busy timeout, `wal_autocheckpoint`, and `synchronous=FULL` for truth tables.

All schema changes use ordered transactional migrations, `STRICT` tables, checks, and pre-migration online backups verified by `quick_check` and SHA-256. Sensitive payloads use AES-256-GCM with record-bound additional authenticated data and a keyed content MAC. The master key is wrapped to the current Windows user through DPAPI; raw key material is sent to PowerShell through stdin, never command arguments or logs.

Full-page encryption is not claimed. DPAPI protects keys, not SQLite pages. SQLCipher or another page-encryption build remains deferred until runtime compatibility, latency, backup, recovery, and packaging tests pass.

## Failure behavior

- Unsafe repository/OneDrive paths fail closed.
- A live writer lock prevents a second writer.
- Stale locks are preserved with a timestamp before recovery.
- Migration fault injection rolls back DDL and version changes.
- Wrapped-key loss or fingerprint mismatch prevents opening encrypted content.
- AEAD/AAD/content-MAC mismatches prevent decryption.
- Closing zeroes the in-process master key buffer and releases the owned lock.
