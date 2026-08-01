# Wave 17 Evidence Report - Governed Embedding and Vector Gateway

Date: 2026-07-25  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Provider-neutral embedding profiles keyed by provider, model and version, dimension, modality, preprocessing version, task instruction, metric, normalization, and local/cloud lane.
- Projection policy that embeds selected records only and explicitly skips exact-only content.
- Privacy routing that denies private and restricted material from cloud embedding lanes.
- Scope-local keyed content-hash reuse to prevent duplicate embedding work without sharing private cache identity across scopes.
- Idempotent queued, skipped, succeeded, failed, and replayed request states.
- Adapter injection boundary; repository code has no direct network/provider dependency.
- Dimension, finite-number, and non-zero-norm validation before vector persistence.
- Encrypted vectors at rest plus content-free provider/model/cost/duration receipts.
- Daily cloud-budget and provider circuit checks.
- Explicit exact/lexical/graph/task fallback lanes when an adapter or vector index is unavailable.
- Blue-green vector indexes with exact selected-record coverage gates.
- Hard rejection of mixed embedding spaces during both membership and search.
- Scope-filtered exact vector scan using the profile metric.
- Dependency edges from canonical records to embedding records.
- Correction/forget deletion that removes index memberships and shreds encrypted vectors.

## Verified

- Exact-only records produce a repeatable skipped receipt and zero provider work.
- Repeated normalized content in the same scope reuses the first embedding record.
- A local injected adapter is invoked once for two identical requests.
- Missing adapters degrade to deterministic non-vector lanes without losing the queued request.
- Private content is denied on a cloud profile even when the caller marks it cloud-eligible.
- Wrong dimensions fail before vector persistence; the original request remains safely retryable.
- Incomplete vector index coverage blocks activation.
- A three-dimensional vector cannot enter or query a four-dimensional index.
- Exact scope-filtered scan ranks the closest record first.
- Correction and owner-forget remove vector membership and encrypted vector payload.
- An injected completion crash leaves the request queued and creates no record, receipt, or vector object.

## Deliberate boundary

No real embedding model, Gemini endpoint, cloud API, network socket, or paid key was used. The shipped gateway is the governed control plane and exact test oracle; provider adapters and scalable approximate-nearest-neighbor backends remain separately selectable after evaluation.

