"use strict";

const crypto = require("node:crypto");
const { COMMAND_TYPES, QUERY_TYPES, publicError } = require("./contracts");

function contextForRequest(req, purpose) {
  return {
    actor: { id: "local-owner", kind: "local-owner", trustLevel: "owner", directOwner: true },
    sessionId: String(req.jarvisSession?.id || "local-session"),
    scope: { kind: "owner", id: "local-owner" },
    purpose,
    requestId: String(req.headers?.["x-request-id"] || crypto.randomUUID()).slice(0, 200),
  };
}

async function handleMemoryV1Request({ req, res, pathname, service, parseBody, sendJson, isDirectOwnerRequest }) {
  if (!pathname.startsWith("/api/memory/v1/")) return false;
  if (!service) {
    sendJson(res, 503, { ok: false, error: { code: "MEMORY_SERVICE_UNAVAILABLE", message: "Memory service boundary is unavailable." } });
    return true;
  }
  if (!isDirectOwnerRequest(req)) {
    sendJson(res, 403, { ok: false, error: { code: "ACCESS_DENIED", message: "Memory v1 is restricted to the direct local owner during compatibility mode." } });
    return true;
  }
  try {
    if (req.method === "GET" && pathname === "/api/memory/v1/health") {
      sendJson(res, 200, { ok: true, data: await service.health() });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/memory/v1/query/search") {
      const body = await parseBody(req);
      const data = await service.query({
        type: QUERY_TYPES.SEARCH,
        context: contextForRequest(req, "owner_memory_search"),
        input: body,
      });
      sendJson(res, 200, { ok: true, data });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/memory/v1/commands/noop") {
      const body = await parseBody(req);
      const data = await service.executeCommand({
        type: COMMAND_TYPES.NOOP,
        idempotencyKey: String(body.idempotencyKey || req.headers?.["idempotency-key"] || ""),
        context: contextForRequest(req, "memory_boundary_probe"),
        input: body.input || {},
      });
      sendJson(res, 200, { ok: true, data });
      return true;
    }
    sendJson(res, 404, { ok: false, error: { code: "MEMORY_ROUTE_NOT_FOUND", message: "Unknown Memory v1 route." } });
    return true;
  } catch (error) {
    const safe = publicError(error);
    sendJson(res, safe.statusCode, { ok: false, error: { code: safe.code, message: safe.message } });
    return true;
  }
}

module.exports = { contextForRequest, handleMemoryV1Request };
