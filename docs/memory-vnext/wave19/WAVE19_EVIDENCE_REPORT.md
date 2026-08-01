# Wave 19 Evidence Report - Adaptive Context Runtime and Influence Receipts

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Active context profiles for Cortex Cost-Guarded, Balanced, and Full plus Eclipse Pulse, Deep, and Totality.
- Independent memory, tool, and output token reservations per product/effort profile.
- Ordered blocks for protected directives, execution state, working set, personal facts, episodes, manifests, evidence, conflicts, consistency, and untrusted data.
- Deterministic item hashing, ordering, selection, manifest hashing, encrypted persistence, and exact reproduction.
- Canonical/working-set sequences, projection epochs, and policy version embedded in every manifest.
- Mandatory source/version references for trusted personal, episodic, manifest, evidence, and conflict items.
- Scope and provider-sensitivity filtering before context selection.
- Fail-closed handling when a protected directive is not eligible for the selected provider.
- Protected-directive budget enforcement; protected rules are never silently truncated.
- Explicit abstention when evidence is required but absent or conflicts are present.
- Forced untrusted-data fencing with `authority=none`, regardless of the retrieved text's requested authority.
- Branch-local context-block leases with attach, suspend, resume, release, expiry, and encrypted-payload shredding.
- Suspended branches retained outside the hot prompt.
- Dependency edges from source records to compiled context packs.
- Influence receipts separating delivered, used, unused, unsupported, and unknown states.
- A `used` state requires an explicit answer span and evidence references; otherwise it becomes `unknown`.
- Correction/forget invalidation that removes pack items, influence claims, and the encrypted manifest.

## Verified

- All six current model/effort families resolve to active profiles.
- Recompiling identical inputs returns the same live pack and deterministic manifest hash.
- Reproduction verifies every item hash and the complete manifest.
- Cross-scope context is rejected before encryption/selection.
- Trusted factual content without exact source/version references is rejected.
- A cloud-ineligible private directive fails rather than disappearing silently.
- Retrieved prompt-injection text remains fenced data with no instruction authority.
- Suspended branch blocks disappear from the hot pack and reappear after resume.
- Lease expiry nulls the payload reference and deletes the encrypted payload.
- Claimed usage without span/evidence is recorded as unknown, not fabricated certainty.
- Owner-forget invalidates the complete pack dependency.
- Context compilation faults leave no pack or encrypted manifest/item residue.

## Deliberate boundary

The runtime produces a structured evidence package; it is not yet connected to the live Cortex/Eclipse prompting path. It records influence supplied by the caller and never exposes hidden reasoning or infers model usage from retrieval alone.

