# ADR-028: A Backup Is Valid Only After Encrypted Restore Verification

- Status: Accepted for Wave 29
- Date: 2026-07-26

Memory backup uses the SQLite online backup API through the protected core database owner. A live database or its WAL is never copied directly. The consistent snapshot must pass `quick_check`, then receives a manifest containing schema, canonical sequence, SQLite version, table coverage, foreign-key result, encrypted-object integrity samples, and plaintext snapshot hash.

The snapshot is encrypted with a random data key using AES-256-GCM. The data key is wrapped under the local Memory keyring and may also be wrapped using an owner-supplied recovery secret derived with scrypt. The closed `.jmbak` package is checksummed and recorded only after an atomic write. Export copies only this closed encrypted package to a target outside the live runtime and verifies the destination checksum.

A restore action never replaces the live database. It decrypts into an isolated drill directory, validates package and snapshot hashes, schema/migration agreement, quick and integrity checks, foreign keys, owner bootstrap records, and encrypted-object samples, then deletes the drill database. Local-key and recovery-secret restore paths are independently selectable.

All operational actions require a short-lived, single-use owner confirmation and emit operator audit records. Projection rebuilds receive bounded structural ledger events rather than raw SQL access and activate only at complete coverage. The Command Center reads every displayed metric directly from the vNext store and never exposes encrypted payload bodies or hidden reasoning.
