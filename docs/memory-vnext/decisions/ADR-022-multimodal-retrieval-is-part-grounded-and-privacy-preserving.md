# ADR-022: Multimodal Retrieval Is Part-Grounded and Privacy-Preserving

- Status: Accepted for Wave 23
- Date: 2026-07-26

PDFs, pages, slides, sheets, tables, cells, code files/symbols, images/regions, audio/video segments, frames, transcripts, and charts are represented as typed artifact parts. Every active part has a validated exact locator, artifact/version parent, extraction run/version, content hash, grounding confidence, render status, and encrypted content. Extraction input is bound to the registered artifact manifest, coordinate slots are immutable, and completion requires declared coverage.

Retrieval combines scope-separated hashed exact keys with a hashed FTS5 lexical stream; neither index contains raw private prose. Native locator types outrank nested coordinate matches. Optional equivalence traversal links visualizations, transcriptions, and same-content representations without bypassing scope or artifact-state filters. Normalized document graphs require explicit source-part coverage and commit atomically.

Wave 23 defines the local extractor-output contract and retrieval substrate. It does not claim that OCR, video decoding, rendering engines, visual embeddings, or paid providers ran in this wave. Those adapters must submit grounded outputs through the contract and pass their own renderer/source-integrity gates before production activation.
