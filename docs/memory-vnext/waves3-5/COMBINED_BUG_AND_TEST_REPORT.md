# Waves 3–5 Combined Bug and Test Report

Date: 2026-07-23

## Bugs found and corrected during the batch gate

1. Policy denials were initially recorded both by the evaluator and Supervisor. Evaluation is now non-recording at that boundary and the Supervisor writes exactly one denial receipt.
2. DPAPI protection failed because this Windows PowerShell session had not loaded `System.Security`. The wrapper now explicitly loads the assembly and uses the fully qualified protection types.
3. Ledger MAC input omitted device HLC, causation, and correlation fields. All are now integrity-covered and tamper-tested.
4. Arbitrary worker error text could be normalized into an apparent error code. Only already-valid controlled codes are retained; all other text becomes a generic code.
5. Expired outbox leases had no recovery operation. The repository now reaps them into bounded retry/dead-letter handling.
6. Worker lease scope metadata used a caller default rather than the leased job's scope. It now derives from the job row.
7. Scope-key rotation could retire the active key before a crash. Create, rotate, recovery logging, and destruction are now transactional.
8. Encrypted-object reads trusted the stored content MAC. Reads now recompute and timing-safely verify it after AEAD decryption.

## Combined gate

The batch gate covers syntax, boundary bypass, migrations, backups, encryption, DPAPI, key loss, single writer, atomic rollback, idempotency, ledger tampering, ordering, retries, leases, backpressure, Supervisor modes, scope cycles, policies, cloud/share denials, agent/co-op expiry, key rotation rollback, crypto-shred metadata, older Wave 1/2 contracts, Neural Vault regression, and personality/memory regression.

No live server restart, live legacy write, production vNext database creation, API-key access, Gemini call, embedding call, or external network call is part of this batch.

Result: 45/45 tests passed at the Waves 3–5 gate. The later cumulative Waves 1–8 gate also passed 56/56.
