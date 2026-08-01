# Wave 22 Evidence Report - Encrypted Content-Addressed Artifact Registry

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Stable artifact identity separated from paths and numbered artifact versions.
- Encrypted scope-separated content-addressed blobs stored under the protected core writer.
- Same-scope/sensitivity deduplication with explicit reference counts; cross-scope equality is concealed.
- Magic/extension-aware MIME classification for common document, archive, image, code, audio, and video types.
- Encrypted artifact titles, locators, manifests, operation details, and validation details.
- Version manifests containing inputs, source versions, lineage, operations, checks, reproduction data, visibility, content semantics, keyed address, and byte size.
- Historical locator reconciliation for rename/move discovery.
- Artifact-to-artifact lineage and canonical-record-to-version dependency edges.
- Source-correction staleness propagation and artifact-change/deletion invalidation.
- Direct-owner deletion with shared-reference accounting and zero-reference cryptographic shredding.
- Manifest-to-version-to-blob integrity binding on every verified read.

## Verified

- Re-ingesting identical bytes into one artifact replays the current version.
- Equal bytes in two same-scope artifacts share one blob and increment its reference count.
- Equal bytes in another scope receive a different keyed address/blob.
- Changed bytes create a new version while retaining the superseded version.
- Old and new paths both resolve with historical/current state.
- Lineage and input record versions persist in the manifest and structural tables.
- Source correction marks the dependent artifact/version stale while retaining encrypted evidence for regeneration.
- Manifest/blob substitution fails integrity verification.
- A non-owner cannot delete an artifact.
- Owner deletion closes downstream cache copies, locators, manifests, operation/check details, parts, graphs, and indexes.
- A zero-reference blob retains no nonce, ciphertext, authentication tag, AAD, or MAC.
- Ingest faults roll back the artifact, encrypted objects, and blob atomically.

## Deliberate boundary

The registry is not wired to live file watching, downloads, HELIX/APEX output creation, or the production JARVIS reply path. It stores test fixture bytes only inside disposable protected databases.
