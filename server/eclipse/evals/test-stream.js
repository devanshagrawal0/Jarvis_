// P1·W3 stream + live-wiring test. Run: node server/eclipse/evals/test-stream.js
// Mock req/res → SSE replay + live tail. Live Interactions client is checked for WIRING only
// (throws 412 with no key) and NEVER calls Gemini. Exit 1 on failure.
const assert = require("assert");
const Database = require("better-sqlite3");
const { openStore } = require("../orchestration/store");
const { sseFrame, streamMission, cursorFrom } = require("../orchestration/events");
const { createInteractionsClient } = require("../model/interactions-client");
const { createAdapter } = require("../model/adapter");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

function mockRes() {
  const chunks = [];
  return { headers: null, chunks, writeHead(code, h) { this.headers = h; }, write(s) { chunks.push(s); return true; }, body() { return chunks.join(""); } };
}
function mockReq({ headers = {}, query = {} } = {}) {
  const handlers = {};
  return { headers, query, on(ev, fn) { handlers[ev] = fn; }, fire(ev) { handlers[ev] && handlers[ev](); } };
}

(async () => {
  console.log("ECLIPSE P1·W3 — event stream + live wiring");

  await okA("sseFrame emits id/event/data", () => {
    const f = sseFrame({ sequence: 3, type: "node.start", payload: { node: "plan" }, occurredAt: "T" });
    assert.ok(f.includes("id: 3\n"));
    assert.ok(f.includes("event: node.start\n"));
    assert.ok(f.includes('"payload":{"node":"plan"}'));
    assert.ok(f.endsWith("\n\n"));
  });

  await okA("cursorFrom reads Last-Event-ID then ?since", () => {
    assert.equal(cursorFrom({ headers: { "last-event-id": "7" }, query: {} }), 7);
    assert.equal(cursorFrom({ headers: {}, query: { since: "4" } }), 4);
    assert.equal(cursorFrom({ headers: {}, query: {} }), -1);
  });

  await okA("streamMission replays persisted events then tails live", () => {
    const store = openStore({ db: new Database(":memory:") });
    const mid = "m_stream";
    store.appendEvent(mid, "mission.created", { a: 1 });
    store.appendEvent(mid, "node.start", { node: "intake" });
    const req = mockReq(), res = mockRes();
    streamMission(req, res, { store, missionId: mid });
    // replay delivered both
    assert.ok(res.body().includes("id: 0\n"));
    assert.ok(res.body().includes("id: 1\n"));
    // live event after subscription is tailed
    store.appendEvent(mid, "mission.complete", { done: true });
    assert.ok(res.body().includes("id: 2\n"));
    assert.ok(res.body().includes("event: mission.complete\n"));
    req.fire("close"); // cleanup unsubscribes without throwing
    // after close, further events are not written
    const before = res.chunks.length;
    store.appendEvent(mid, "extra", {});
    assert.equal(res.chunks.length, before, "unsubscribed after close");
  });

  await okA("streamMission with a cursor only sends newer events", () => {
    const store = openStore({ db: new Database(":memory:") });
    const mid = "m_cursor";
    for (let i = 0; i < 4; i++) store.appendEvent(mid, "n", { i });
    const res = mockRes();
    streamMission(mockReq({ headers: { "last-event-id": "1" } }), res, { store, missionId: mid });
    assert.ok(!res.body().includes("id: 0\n") && !res.body().includes("id: 1\n"));
    assert.ok(res.body().includes("id: 2\n") && res.body().includes("id: 3\n"));
  });

  await okA("live Interactions client is wired but needs a key (no network)", async () => {
    const { liveCall } = createInteractionsClient({ getApiKey: () => "" });
    await assert.rejects(() => liveCall({ modelId: "x", input: "y" }), (e) => e.status === 412);
    assert.throws(() => createInteractionsClient({}), /getApiKey/);
  });

  await okA("adapter mode:live routes to the injected liveCall (no Gemini)", async () => {
    // Prove the adapter↔liveCall seam without a network call: inject a fake liveCall.
    let seen = null;
    const a = createAdapter({ mode: "live", liveCall: async (call) => { seen = call; return { text: "LIVE:" + call.node, usage: { tokensIn: 3, tokensOut: 3 } }; } });
    const r = await a.run({ node: "worker", input: "hi" });
    assert.equal(r.text, "LIVE:worker");
    assert.equal(seen.modelId && typeof seen.modelId, "string");
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
