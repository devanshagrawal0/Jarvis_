"use strict";

const crypto = require("node:crypto");
const {
  AUTHORITY_MODES,
  COMMAND_TYPES,
  MEMORY_API_VERSION,
  MEMORY_SERVICE_VERSION,
  MemoryServiceError,
  QUERY_TYPES,
  WRITE_COMMAND_TYPES,
  validateCommandEnvelope,
  validateQueryEnvelope,
} = require("./contracts");

function defaultAuthorize({ context }) {
  return context.actor.kind === "local-owner"
    && context.actor.trustLevel === "owner"
    && context.actor.directOwner === true
    && context.scope.kind === "owner"
    && context.scope.id === "local-owner";
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function stableResultId(text) {
  return `compat_${crypto.createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 24)}`;
}

function safeTelemetry(telemetry, event) {
  try { telemetry?.(Object.freeze({ ...event })); } catch {}
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("adapter timeout")), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function createMemoryService({ adapters = [], authorize = defaultAuthorize, clock = () => new Date(), telemetry, adapterTimeoutMs = 300, authorityProvider = null } = {}) {
  const registered = new Map();
  const receipts = new Map();
  let closed = false;

  for (const adapter of adapters) {
    if (!adapter?.id || registered.has(adapter.id)) throw new Error("Memory adapters require unique ids.");
    if (adapter.capabilities?.write === true) throw new Error(`Wave 2 rejects writable adapter: ${adapter.id}`);
    registered.set(adapter.id, adapter);
  }

  function assertOpen() {
    if (closed) throw new MemoryServiceError("SERVICE_CLOSED", "The memory service boundary is closed.", 503);
  }

  async function assertAuthorized(operation, context) {
    const allowed = await authorize({ operation, context });
    if (!allowed) throw new MemoryServiceError("ACCESS_DENIED", "This memory operation requires the direct local owner.", 403);
  }

  // Reads the cutover ledger when a provider is supplied, instead of asserting a constant.
  // This previously returned a frozen `writableAuthority: "legacy"` unconditionally, so
  // `activateDomain()` could move every domain to vNext while this still reported legacy —
  // the ledger and the runtime silently disagreeing.
  //
  // With no provider (tests, or a boundary built without a store) it returns exactly the old
  // constant, so nothing that exists today changes behaviour.
  function authorityState() {
    let explicit = null;
    try { explicit = authorityProvider?.status?.() || null; } catch { explicit = null; }
    const domains = explicit?.domains || {};
    // `explicit_commands` governs remember / correct / forget writes.
    //
    // Ledger authority is necessary but NOT sufficient: `executeCommand` still rejects every
    // mutation type with UNSUPPORTED_COMMAND. Deriving "writes enabled" from authority alone made
    // the health payload report `vnextWritesEnabled: true, dualWritable: true` in the same
    // response as `writes.mutationCommandsEnabled: false`, while every remember/correct/forget
    // returned 400 — the system describing a capability it does not have. Authority and
    // capability are reported separately now; flip the constant when the handlers land.
    const MUTATION_COMMANDS_IMPLEMENTED = false;
    const writesAuthorized = domains.explicit_commands === "vnext";
    const writesOnVNext = writesAuthorized && MUTATION_COMMANDS_IMPLEMENTED;
    const anyVNext = Object.values(domains).some((value) => value === "vnext");
    return Object.freeze({
      mode: anyVNext ? "vnext_primary" : AUTHORITY_MODES.LEGACY_COMPAT,
      // Authority = who the ledger says owns writes. Capability = whether this service can
      // actually perform one. They are different questions and are answered separately.
      writableAuthority: writesAuthorized ? "vnext" : "legacy",
      legacyWritesEnabled: true,       // legacy keeps writing until its archive is sealed
      vnextWritesEnabled: writesOnVNext,
      dualWritable: writesOnVNext,     // both write during the reversible window
      mutationCommandsImplemented: MUTATION_COMMANDS_IMPLEMENTED,
      writesAuthorizedPendingImplementation: writesAuthorized && !MUTATION_COMMANDS_IMPLEMENTED,
      canonicalStoreCreated: Boolean(explicit?.planId),
      planId: explicit?.planId || null,
      planStatus: explicit?.planStatus || null,
      domains,
      degraded: Boolean(explicit?.degraded),
    });
  }

  async function collectAdapterHealth() {
    const items = [];
    for (const adapter of registered.values()) {
      if (!adapter.capabilities?.health || typeof adapter.health !== "function") continue;
      try {
        const result = await withTimeout(adapter.health(), adapterTimeoutMs);
        items.push({ id: adapter.id, authority: adapter.authority || "legacy", ok: result?.ok !== false, detail: result || {} });
      } catch {
        items.push({ id: adapter.id, authority: adapter.authority || "legacy", ok: false, errorCode: "ADAPTER_UNAVAILABLE" });
      }
    }
    return items;
  }

  async function health() {
    assertOpen();
    const adapterHealth = await collectAdapterHealth();
    return {
      ok: adapterHealth.every((item) => item.ok),
      state: adapterHealth.some((item) => !item.ok) ? "degraded" : "ready",
      apiVersion: MEMORY_API_VERSION,
      serviceVersion: MEMORY_SERVICE_VERSION,
      phase: "wave2_compatibility_boundary",
      authority: authorityState(),
      adapters: adapterHealth,
      writes: { acceptedCommands: [COMMAND_TYPES.NOOP], mutationCommandsEnabled: false },
      generatedAt: clock().toISOString(),
    };
  }

  async function search(input, context) {
    const startedAt = Date.now();
    const query = String(input.query || "").trim();
    if (!query) throw new MemoryServiceError("INVALID_QUERY", "Search query is required.");
    if (query.length > 2_000) throw new MemoryServiceError("INVALID_QUERY", "Search query is too long.");
    const limit = Math.max(1, Math.min(50, Number(input.limit) || 10));
    const kinds = Array.isArray(input.kinds) ? input.kinds.map(String).filter(Boolean).slice(0, 10) : [];
    const searchable = [...registered.values()].filter((adapter) => adapter.capabilities?.search
      && typeof adapter.search === "function"
      && (!Array.isArray(adapter.scopes) || adapter.scopes.includes(context.scope.kind)));
    const results = [];
    const adapterTrace = [];
    for (const adapter of searchable) {
      try {
        const rows = await withTimeout(adapter.search({ query, limit, kinds, scope: context.scope }), adapterTimeoutMs);
        const safeRows = Array.isArray(rows) ? rows : [];
        results.push(...safeRows.map((row) => ({ ...row, adapterId: adapter.id })));
        adapterTrace.push({ id: adapter.id, ok: true, returned: safeRows.length });
      } catch {
        adapterTrace.push({ id: adapter.id, ok: false, returned: 0, errorCode: "ADAPTER_UNAVAILABLE" });
      }
    }
    const unique = new Map();
    for (const row of results) {
      const normalized = normalizeText(row.text);
      if (!normalized) continue;
      const existing = unique.get(normalized);
      const candidate = {
        id: stableResultId(row.text),
        legacyRef: row.ref || null,
        text: String(row.text),
        kind: row.kind || "unknown",
        category: row.category ?? null,
        source: row.source || "legacy",
        confidence: Number(row.confidence) || 0,
        importance: Number(row.importance) || 0,
        score: Number(row.score) || 0,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
        adapterIds: [row.adapterId],
      };
      if (!existing || candidate.score > existing.score) unique.set(normalized, candidate);
      else if (!existing.adapterIds.includes(row.adapterId)) existing.adapterIds.push(row.adapterId);
    }
    const items = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const durationMs = Date.now() - startedAt;
    safeTelemetry(telemetry, {
      name: "memory.query.completed",
      operation: QUERY_TYPES.SEARCH,
      ok: true,
      durationMs,
      adapterCount: searchable.length,
      resultCount: items.length,
      scopeKind: context.scope.kind,
    });
    return {
      items,
      consistency: "legacy_compat",
      authority: authorityState(),
      trace: { adapterTrace, resultCount: items.length, durationMs, contentLogged: false },
    };
  }

  async function query(envelope) {
    assertOpen();
    const request = validateQueryEnvelope(envelope);
    await assertAuthorized(request.type, request.context);
    if (request.type === QUERY_TYPES.HEALTH) return health();
    if (request.type === QUERY_TYPES.SEARCH) return search(request.input, request.context);
    throw new MemoryServiceError("UNSUPPORTED_QUERY", "This memory query type is not supported.");
  }

  async function executeCommand(envelope) {
    assertOpen();
    const request = validateCommandEnvelope(envelope);
    await assertAuthorized(request.type, request.context);
    // Writes follow the ledger, not a constant. Until `explicit_commands` cuts over this
    // throws exactly as before; afterwards vNext accepts mutations. Refusing by default means
    // a missing/degraded resolver can never accidentally open the write path.
    if (WRITE_COMMAND_TYPES.has(request.type) && authorityState().writableAuthority !== "vnext") {
      throw new MemoryServiceError("WRITE_NOT_ENABLED", "Memory mutations remain on the legacy authority until the controlled cutover.", 409);
    }
    if (request.type !== COMMAND_TYPES.NOOP) {
      throw new MemoryServiceError("UNSUPPORTED_COMMAND", "This memory command type is not supported.");
    }
    const receiptKey = `${request.context.actor.id}\u0000${request.idempotencyKey}`;
    const prior = receipts.get(receiptKey);
    if (prior) return { ...prior, replayed: true };
    const receipt = Object.freeze({
      ok: true,
      accepted: true,
      mutated: false,
      replayed: false,
      commandType: request.type,
      idempotencyKey: request.idempotencyKey,
      authority: authorityState(),
      completedAt: clock().toISOString(),
    });
    receipts.set(receiptKey, receipt);
    safeTelemetry(telemetry, { name: "memory.command.completed", operation: request.type, ok: true, mutated: false });
    return receipt;
  }

  function shutdown() {
    closed = true;
    receipts.clear();
  }

  return Object.freeze({ authorityState, executeCommand, health, query, shutdown });
}

module.exports = { createMemoryService, defaultAuthorize, normalizeText };
