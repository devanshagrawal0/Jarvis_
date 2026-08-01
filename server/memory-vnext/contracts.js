"use strict";

const MEMORY_API_VERSION = "v1";
const MEMORY_SERVICE_VERSION = "0.2.0-wave2";

const AUTHORITY_MODES = Object.freeze({
  LEGACY_COMPAT: "legacy_compat",
  VNEXT_SHADOW: "vnext_shadow",
  VNEXT_PRIMARY: "vnext_primary",
  LEGACY_ARCHIVED: "legacy_archived",
});

const QUERY_TYPES = Object.freeze({
  HEALTH: "memory.health.v1",
  SEARCH: "memory.search.v1",
});

const COMMAND_TYPES = Object.freeze({
  NOOP: "memory.noop.v1",
  REMEMBER: "memory.remember.v1",
  CORRECT: "memory.correct.v1",
  FORGET: "memory.forget.v1",
  PIN: "memory.pin.v1",
});

const WRITE_COMMAND_TYPES = new Set([
  COMMAND_TYPES.REMEMBER,
  COMMAND_TYPES.CORRECT,
  COMMAND_TYPES.FORGET,
  COMMAND_TYPES.PIN,
]);

const SECRET_KEY_PATTERN = /(?:^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|password|passwd|secret|private[_-]?key|raw[_-]?value|key[_-]?value)(?:$|[_-])/i;
const MAX_ENVELOPE_BYTES = 32 * 1024;
const MAX_OBJECT_DEPTH = 8;

class MemoryServiceError extends Error {
  constructor(code, message, statusCode = 400, details = undefined) {
    super(message);
    this.name = "MemoryServiceError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MemoryServiceError("INVALID_REQUEST", `${label} must be an object.`);
  }
}

function assertNoSecretFields(value, path = "$", depth = 0, seen = new Set()) {
  if (depth > MAX_OBJECT_DEPTH) {
    throw new MemoryServiceError("INVALID_REQUEST", "Request nesting is too deep.");
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new MemoryServiceError("INVALID_REQUEST", "Request contains a circular value.");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new MemoryServiceError("SECRET_FIELD_REJECTED", `Secret-bearing field is not allowed at ${path}.`, 400);
    }
    assertNoSecretFields(child, `${path}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

function assertEnvelopeSize(value) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new MemoryServiceError("INVALID_REQUEST", "Request must be JSON serializable.");
  }
  if (Buffer.byteLength(encoded || "", "utf8") > MAX_ENVELOPE_BYTES) {
    throw new MemoryServiceError("REQUEST_TOO_LARGE", "Memory request exceeds the Wave 2 contract limit.", 413);
  }
}

function normalizeContext(context) {
  assertPlainObject(context, "context");
  const actor = context.actor;
  const scope = context.scope;
  assertPlainObject(actor, "context.actor");
  assertPlainObject(scope, "context.scope");
  const normalized = {
    actor: {
      id: String(actor.id || "").slice(0, 160),
      kind: String(actor.kind || "").slice(0, 80),
      trustLevel: String(actor.trustLevel || "").slice(0, 40),
      directOwner: actor.directOwner === true,
    },
    sessionId: String(context.sessionId || "").slice(0, 200),
    scope: {
      kind: String(scope.kind || "").slice(0, 80),
      id: String(scope.id || "").slice(0, 200),
    },
    purpose: String(context.purpose || "").slice(0, 160),
    requestId: String(context.requestId || "").slice(0, 200),
  };
  if (!normalized.actor.id || !normalized.actor.kind || !normalized.scope.kind || !normalized.scope.id || !normalized.purpose) {
    throw new MemoryServiceError("INVALID_CONTEXT", "Actor, scope, and purpose are required.");
  }
  return normalized;
}

function validateQueryEnvelope(envelope) {
  assertPlainObject(envelope, "query envelope");
  assertEnvelopeSize(envelope);
  assertNoSecretFields(envelope);
  const type = String(envelope.type || "");
  if (!Object.values(QUERY_TYPES).includes(type)) {
    throw new MemoryServiceError("UNSUPPORTED_QUERY", "This memory query type is not supported.", 400);
  }
  const context = normalizeContext(envelope.context);
  const input = envelope.input == null ? {} : envelope.input;
  assertPlainObject(input, "input");
  return { type, context, input };
}

function validateCommandEnvelope(envelope) {
  assertPlainObject(envelope, "command envelope");
  assertEnvelopeSize(envelope);
  assertNoSecretFields(envelope);
  const type = String(envelope.type || "");
  const idempotencyKey = String(envelope.idempotencyKey || "").trim().slice(0, 240);
  if (!type) throw new MemoryServiceError("INVALID_COMMAND", "Command type is required.");
  if (!idempotencyKey) throw new MemoryServiceError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.");
  const context = normalizeContext(envelope.context);
  const input = envelope.input == null ? {} : envelope.input;
  assertPlainObject(input, "input");
  return { type, idempotencyKey, context, input };
}

function publicError(error) {
  if (error instanceof MemoryServiceError) {
    return { code: error.code, message: error.message, statusCode: error.statusCode };
  }
  return { code: "MEMORY_SERVICE_FAILURE", message: "The memory service could not complete this request.", statusCode: 500 };
}

module.exports = {
  AUTHORITY_MODES,
  COMMAND_TYPES,
  MAX_ENVELOPE_BYTES,
  MEMORY_API_VERSION,
  MEMORY_SERVICE_VERSION,
  MemoryServiceError,
  QUERY_TYPES,
  WRITE_COMMAND_TYPES,
  publicError,
  validateCommandEnvelope,
  validateQueryEnvelope,
};
