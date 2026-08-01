# ADR-021: Artifacts Use Scope-Separated Encrypted Content Addressing

- Status: Accepted for Wave 22
- Date: 2026-07-26

An artifact has a stable logical identity, immutable numbered versions, encrypted manifests, historical locators, lineage, operation receipts, and checks. A path or URI is a locator rather than identity. Rename and move reconciliation therefore changes locator history without changing the artifact.

Blob identity is a keyed content address derived in a scope-specific domain. Equal bytes deduplicate inside the same scope and sensitivity class but do not expose equality across scopes. Blob bytes, titles, locators, manifests, and operation/check details are encrypted; only bounded structural metadata and keyed hashes remain queryable. Reads bind the manifest to artifact ID, version, blob ID, keyed address, byte size, and MIME type before decrypting content.

Source changes invalidate dependent artifact versions through the common dependency closure. Direct owner deletion invalidates downstream copies, nulls every encrypted reference, decrements shared references, cryptographically shreds zero-reference blobs, and removes multimodal indexes while retaining content-free lifecycle structure.
