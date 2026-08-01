# Memory Service v1 — Wave 2 Compatibility Contract

## Runtime state

| Field | Wave 2 value |
|---|---|
| API version | `v1` |
| Service version | `0.2.0-wave2` |
| Authority mode | `legacy_compat` |
| Writable authority | `legacy` |
| vNext database | Not created |
| vNext mutations | Disabled |
| Legacy mutations | Unchanged |
| Remote/device access | Disabled; direct local owner only |
| Provider calls | None |

## Query envelope

```json
{
  "type": "memory.search.v1",
  "context": {
    "actor": {
      "id": "local-owner",
      "kind": "local-owner",
      "trustLevel": "owner",
      "directOwner": true
    },
    "sessionId": "session-id",
    "scope": { "kind": "owner", "id": "local-owner" },
    "purpose": "owner_memory_search",
    "requestId": "request-id"
  },
  "input": {
    "query": "search terms",
    "limit": 10,
    "kinds": ["semantic", "episodic"]
  }
}
```

Supported queries:

- `memory.health.v1`
- `memory.search.v1`

The search response returns bounded normalized items, compatibility authority state, and a content-free adapter trace. Duplicate text is collapsed by a normalized SHA-256-derived compatibility identifier. It does not claim that this identifier is a future canonical memory ID.

## Command envelope

Every command requires a caller-supplied idempotency key. The only accepted Wave 2 command is `memory.noop.v1`; it returns a receipt with `mutated: false`. Replaying the same actor/key pair returns the same receipt with `replayed: true`.

The following declared commands are deliberately unavailable:

- `memory.remember.v1`
- `memory.correct.v1`
- `memory.forget.v1`
- `memory.pin.v1`

They return HTTP 409 / `WRITE_NOT_ENABLED` and never call an adapter.

## Local HTTP routes

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/memory/v1/health` | Contract, authority, adapter, and write-state health |
| `POST` | `/api/memory/v1/query/search` | Owner-scoped legacy compatibility search |
| `POST` | `/api/memory/v1/commands/noop` | Side-effect-free idempotency/command probe |

The existing global request-trust gate runs first. The Memory v1 handler then applies a stricter direct-local-owner check. Signed relays and paired devices are denied during compatibility mode even when they are trusted elsewhere.

## Failure codes

| Code | Meaning |
|---|---|
| `ACCESS_DENIED` | Actor or scope is not the direct local owner |
| `INVALID_CONTEXT` | Required actor, scope, or purpose data is missing |
| `INVALID_QUERY` | Search text is empty or too long |
| `IDEMPOTENCY_REQUIRED` | Command lacks an idempotency key |
| `SECRET_FIELD_REJECTED` | Envelope contains a secret-bearing field name |
| `REQUEST_TOO_LARGE` | JSON envelope exceeds 32 KiB |
| `WRITE_NOT_ENABLED` | Mutation is blocked until controlled cutover |
| `ADAPTER_UNAVAILABLE` | A legacy read/health adapter failed or timed out |

Unexpected adapter exception messages are never returned to the caller.
