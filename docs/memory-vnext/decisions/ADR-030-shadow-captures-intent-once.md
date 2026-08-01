# ADR-030: Shadow Evaluation Captures Intent Once and Reuses Enrichment

- Status: Accepted for Wave 31
- Date: 2026-07-26

The compatibility boundary captures each typed memory intent once in the canonical ledger with an idempotency key and a durable `memory-vnext.shadow-replay` outbox target. Legacy remains answer authority during shadow. The vNext replay consumes the captured intent and immutable enrichment reference; it must not repeat a paid Gemini, embedding, reranking, OCR, or research call.

Counterfactual evaluation stores queries, both result bodies, and explanations encrypted. Plaintext tables contain only hashes, timings, bounded structural metrics, classifications, and signed receipts. Scope leakage, privacy failure, deletion failure, temporal error, missing recall, reference overlap, latency, and quality direction are measured independently.

A cutover gate may be re-evaluated while the soak is running, but it cannot pass until the reconciled import, benchmark suite, zero high/critical divergence, zero privacy/scope/deletion failure, complete projection coverage, verified restore, every domain rollback rehearsal, latency target, and full soak duration all pass. A failed preview leaves the session evaluating; it does not create a permanent false gate.
