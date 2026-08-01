"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  COMMAND_TYPES,
  QUERY_TYPES,
  createMemoryService,
  createMemoryVNextBoundary,
  handleMemoryV1Request,
} = require("../../server/memory-vnext");

const ownerContext = Object.freeze({
  actor: { id: "local-owner", kind: "local-owner", trustLevel: "owner", directOwner: true },
  sessionId: "test-session",
  scope: { kind: "owner", id: "local-owner" },
  purpose: "conformance_test",
  requestId: "test-request",
});

function queryEnvelope(input = {}) {
  return { type: QUERY_TYPES.SEARCH, context: ownerContext, input: { query: "project atlas", ...input } };
}

function commandEnvelope(type, input = {}, idempotencyKey = "idem-1") {
  return { type, context: ownerContext, input, idempotencyKey };
}

function fakeResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

test("Wave 2 health declares one writable legacy authority and no vNext store", async () => {
  const service = createMemoryService({
    adapters: [{
      id: "fixture",
      authority: "legacy",
      capabilities: { health: true, search: false, write: false },
      async health() { return { ok: true }; },
    }],
    clock: () => new Date("2026-07-23T00:00:00.000Z"),
  });
  const health = await service.health();
  assert.equal(health.ok, true);
  assert.equal(health.authority.mode, "legacy_compat");
  assert.equal(health.authority.writableAuthority, "legacy");
  assert.equal(health.authority.legacyWritesEnabled, true);
  assert.equal(health.authority.vnextWritesEnabled, false);
  assert.equal(health.authority.dualWritable, false);
  assert.equal(health.authority.canonicalStoreCreated, false);
  assert.equal(health.writes.mutationCommandsEnabled, false);
});

test("Wave 2 rejects every memory mutation before an adapter can write", async () => {
  let adapterCalls = 0;
  const service = createMemoryService({
    adapters: [{
      id: "read-only",
      capabilities: { search: true, health: false, write: false },
      scopes: ["owner"],
      async search() { adapterCalls += 1; return []; },
    }],
  });
  for (const type of [COMMAND_TYPES.REMEMBER, COMMAND_TYPES.CORRECT, COMMAND_TYPES.FORGET, COMMAND_TYPES.PIN]) {
    await assert.rejects(service.executeCommand(commandEnvelope(type)), (error) => error.code === "WRITE_NOT_ENABLED" && error.statusCode === 409);
  }
  assert.equal(adapterCalls, 0);
});

test("Wave 2 no-op is side-effect free and idempotent", async () => {
  const events = [];
  const service = createMemoryService({ telemetry: (event) => events.push(event) });
  const first = await service.executeCommand(commandEnvelope(COMMAND_TYPES.NOOP));
  const second = await service.executeCommand(commandEnvelope(COMMAND_TYPES.NOOP));
  assert.equal(first.mutated, false);
  assert.equal(first.replayed, false);
  assert.equal(second.mutated, false);
  assert.equal(second.replayed, true);
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ["mutated", "name", "ok", "operation"]);
});

test("authorization and scope checks happen before legacy retrieval", async () => {
  let calls = 0;
  const service = createMemoryService({
    adapters: [{
      id: "legacy",
      capabilities: { search: true, health: false, write: false },
      scopes: ["owner"],
      async search() { calls += 1; return []; },
    }],
  });
  const untrusted = { ...ownerContext, actor: { ...ownerContext.actor, directOwner: false } };
  await assert.rejects(service.query({ ...queryEnvelope(), context: untrusted }), (error) => error.code === "ACCESS_DENIED");
  const wrongScope = { ...ownerContext, scope: { kind: "helix-project", id: "project-1" } };
  await assert.rejects(service.query({ ...queryEnvelope(), context: wrongScope }), (error) => error.code === "ACCESS_DENIED");
  assert.equal(calls, 0);
});

test("legacy search results are normalized, deduplicated, bounded, and content is absent from telemetry", async () => {
  const events = [];
  const makeAdapter = (id, score, text) => ({
    id,
    capabilities: { search: true, health: false, write: false },
    scopes: ["owner"],
    async search() { return [{ ref: `${id}-1`, text, kind: "semantic", score, confidence: 0.9 }]; },
  });
  const service = createMemoryService({
    adapters: [makeAdapter("a", 0.5, "Project   Atlas"), makeAdapter("b", 0.9, "project atlas")],
    telemetry: (event) => events.push(event),
  });
  const result = await service.query(queryEnvelope({ limit: 1 }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].score, 0.9);
  assert.match(result.items[0].id, /^compat_[a-f0-9]{24}$/);
  assert.equal(result.trace.contentLogged, false);
  assert.equal(JSON.stringify(events).includes("project atlas"), false);
});

test("adapter failures degrade safely without exposing provider or secret text", async () => {
  const service = createMemoryService({
    adapters: [{
      id: "broken",
      capabilities: { search: true, health: true, write: false },
      scopes: ["owner"],
      async health() { throw new Error("API_KEY=do-not-leak"); },
      async search() { throw new Error("password=do-not-leak"); },
    }],
  });
  const health = await service.health();
  const result = await service.query(queryEnvelope());
  const serialized = JSON.stringify({ health, result });
  assert.equal(health.state, "degraded");
  assert.equal(result.items.length, 0);
  assert.match(serialized, /ADAPTER_UNAVAILABLE/);
  assert.doesNotMatch(serialized, /do-not-leak|API_KEY|password/);
});

test("secret-bearing fields and writable adapters fail closed", async () => {
  const service = createMemoryService();
  await assert.rejects(
    service.query(queryEnvelope({ metadata: { apiKey: "forbidden" } })),
    (error) => error.code === "SECRET_FIELD_REJECTED",
  );
  assert.throws(() => createMemoryService({
    adapters: [{ id: "writer", capabilities: { write: true } }],
  }), /rejects writable adapter/);
});

test("Neural Vault is health-only and its mutating search method is never called", async () => {
  let memorySearchCalls = 0;
  let neuralSearchCalls = 0;
  const boundary = createMemoryVNextBoundary({
    memoryStore: {
      stats: () => ({ active: 1 }),
      search: () => { memorySearchCalls += 1; return [{ id: "m1", text: "Atlas", score: 1 }]; },
    },
    neuralVault: {
      status: () => ({ ok: true, counts: { memories: 1 } }),
      searchMemories: () => { neuralSearchCalls += 1; return []; },
    },
  });
  const result = await boundary.query(queryEnvelope());
  assert.equal(result.items.length, 1);
  assert.equal(memorySearchCalls, 1);
  assert.equal(neuralSearchCalls, 0);
});

test("HTTP compatibility routes require direct-owner access and return safe envelopes", async () => {
  const service = createMemoryService();
  const deniedRes = fakeResponse();
  const handledDenied = await handleMemoryV1Request({
    req: { method: "GET", headers: {}, jarvisSession: { id: "s" } },
    res: deniedRes,
    pathname: "/api/memory/v1/health",
    service,
    parseBody: async () => ({}),
    sendJson,
    isDirectOwnerRequest: () => false,
  });
  assert.equal(handledDenied, true);
  assert.equal(deniedRes.statusCode, 403);

  const healthRes = fakeResponse();
  await handleMemoryV1Request({
    req: { method: "GET", headers: {}, jarvisSession: { id: "s" } },
    res: healthRes,
    pathname: "/api/memory/v1/health",
    service,
    parseBody: async () => ({}),
    sendJson,
    isDirectOwnerRequest: () => true,
  });
  assert.equal(healthRes.statusCode, 200);
  assert.equal(JSON.parse(healthRes.body).data.authority.dualWritable, false);

  const noopRes = fakeResponse();
  await handleMemoryV1Request({
    req: { method: "POST", headers: {}, jarvisSession: { id: "s" } },
    res: noopRes,
    pathname: "/api/memory/v1/commands/noop",
    service,
    parseBody: async () => ({ idempotencyKey: "http-idem" }),
    sendJson,
    isDirectOwnerRequest: () => true,
  });
  assert.equal(noopRes.statusCode, 200);
  assert.equal(JSON.parse(noopRes.body).data.mutated, false);
});

test("Wave 2 compatibility boundary owns no database and contains no direct SQL mutation", () => {
  const root = path.join(__dirname, "..", "..", "server", "memory-vnext");
  const source = ["contracts.js", "http-handler.js", "legacy-adapters.js", "service.js"]
    .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /better-sqlite3|node:sqlite|sqlite3/i);
  assert.doesNotMatch(source, /[\"'`]\s*(?:INSERT|UPDATE|DELETE|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\s+/i);
  assert.doesNotMatch(source, /\.db\s*\.prepare\s*\(/i);
});

test("the server composition root wires the Wave 2 boundary and its shutdown", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  // Asserts the WIRING, not its formatting. The call gained an `authorityProvider` — so the
  // boundary reports the same authority the answer path acts on instead of a constant — and
  // now spans several lines. The invariant under test is unchanged: the composition root
  // still supplies the legacy store and the vault.
  assert.match(source, /createMemoryVNextBoundary\(\{[\s\S]{0,800}?memoryStore,[\s\S]{0,800}?neuralVault,/);
  assert.match(source, /authorityProvider:/, "the boundary must resolve authority from the cutover ledger");
  assert.match(source, /await handleMemoryV1Request\(\{/);
  assert.match(source, /memoryVNextBoundary\?\.shutdown\?\.\(\)/);
});

test("repository boundary guard rejects new production bypasses", () => {
  const guard = path.join(__dirname, "..", "..", "scripts", "memory-vnext-boundary-guard.mjs");
  const output = execFileSync(process.execPath, [guard], { encoding: "utf8" });
  assert.match(output, /boundary guard passed/i);
});
