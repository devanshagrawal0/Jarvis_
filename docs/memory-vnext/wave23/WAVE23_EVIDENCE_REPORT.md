# Wave 23 Evidence Report - Multimodal Artifact Parts and Retrieval

Date: 2026-07-26  
Result: Complete in isolated implementation/test mode  
Production activation: No  
Paid provider calls: 0

## Delivered

- Version-bound extraction runs for document, PDF, slides, sheet, code, image, audio, video, and multimodal adapters.
- Input-manifest binding, extractor/version identity, expected/produced coverage, and complete/partial/failure lifecycle fields.
- Typed parts for document, page, slide, sheet, table, cell, code file, code symbol, image, region, audio/video segment, frame, transcript, and chart.
- Validated page, slide, sheet/range, file/symbol, region/bounding-box, time-range, frame/timecode, and chart locators.
- Encrypted part locators, content, and features plus keyed content hashes.
- Grounding confidence and renderer status on every part.
- Scope-separated hashed exact keys and hashed FTS5 word/trigram indexes with no plaintext prose.
- Native-type coordinate priority and exact page, slide, cell, symbol, frame, clip, caption, filename, timecode, and chart lookup.
- Cross-format contains/equivalent/derived/visualizes/transcribes/same-content/reference relations.
- Optional equivalence expansion with active scope/version/artifact filtering.
- Source-complete encrypted normalized document graphs.
- Encrypted retrieval queries and structural candidate traces.
- Correction and deletion closure for FTS, exact keys, relations, parts, graphs, and payloads.

## Verified

- Fixture extraction retrieves exact pages, slides, cells, symbols, frames, audio clips, charts, and image regions.
- A page outranks a nested region sharing the same page coordinate.
- Cross-format visualization expansion returns its linked chart.
- Incomplete normalized graph coverage fails closed.
- Extraction input hash mismatch and coordinate mutation fail closed.
- Unauthorized retrieval scope is rejected before query persistence.
- Private part prose does not appear in raw SQLite bytes.
- Corrected-source parts become stale and disappear from retrieval.
- Artifact deletion nulls all part/graph payload references and removes FTS/exact/relation rows.
- Part, graph, and retrieval fault points roll back encrypted payloads and structural rows atomically.

## Deliberate boundary

This wave supplies the adapter contract, typed storage, privacy-preserving index, exact retrieval, and lifecycle closure. It does not execute production OCR, PDF rendering, office rendering, media decoding, visual embeddings, or provider calls. Those engines remain future measured adapters; accepting a caller-provided extraction result is not reported as performing OCR or rendering.
