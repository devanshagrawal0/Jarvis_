# ADR-031: Cutover Switches Authority Pointers, Not History

- Status: Accepted for Wave 32
- Date: 2026-07-26

Cutover is direct-owner approved, reversible, and domain-ordered: explicit commands, conversation runtime, retrieval/context, then room integrations. A domain cannot advance before every predecessor is primary. Retrieval additionally requires cache purge and projection verification; rooms require verified manifests.

Each transition preserves fallback, encrypts its gate snapshot, and signs a receipt. Rollback exports post-cutover vNext event references, switches the selected authority and every dependent downstream domain back to legacy, and performs zero legacy rewrites. The old database is never reconciled by destructive mutation.

Every snapshot declared by the reconciled import must be checksum-verified, reopened read-only, sealed in the archive registry, and retained for at least 90 days. An unrelated snapshot cannot satisfy this gate. Completion also requires all four domains primary, all rollback rehearsals passing, every required owner-acceptance case passing, and a signed memory-contract handoff to the frozen model plan.

Implementation completion is not production activation. The production authority cannot change until the real import is reviewed by the owner and the real shadow soak and cutover gates pass.
