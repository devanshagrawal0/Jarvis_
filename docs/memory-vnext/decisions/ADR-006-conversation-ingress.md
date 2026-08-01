# ADR-006: Immutable Conversation Ingress and Streaming Recovery

- Status: Accepted for Wave 7
- Date: 2026-07-24

Every accepted turn has stable conversation, branch, turn, client-event, and optional client-sequence identity. Raw content, attachment locators, stream chunks, and sensitive event metadata are encrypted. Checksums bind role, content, sequence, attachments, and focus deltas.

Client-event and client-sequence retries are idempotent when content matches and fail with an explicit conflict when it differs. Streaming assistant output journals a start, contiguous chunks, interruption, and finalization. Chunk content, the chunk row, and its immutable event commit atomically. An interrupted turn advertises the next required chunk and can resume without repeating prior chunks.

Raw retention policy remains a conversation property; turn identity and structural history do not depend on retaining plaintext indefinitely.
