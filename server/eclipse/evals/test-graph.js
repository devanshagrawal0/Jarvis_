// P1·W3 gate test — durable graph spine. Run: node server/eclipse/evals/test-graph.js
// In-memory sqlite + stub model → ZERO Gemini. Covers the W3 gate: trivial 2-node graph runs,
// full spine runs end-to-end, crash mid-node → resume with NO duplicate side effects, cost
// ledger accrues + mirrors, cancel stops promptly, pause→resume completes. Exit 1 on failure.
const assert = require("assert");
const Database = require("better-sqlite3");
const { StateGraph, START, END, Annotation } = require("@langchain/langgraph");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { runMission, resumeMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

let mc = 0;
function mission(effort = "deep") {
  return { schemaVersion: "eclipse.mission.v1", missionId: `m_test_${++mc}`, userId: "dev", prompt: "Compare A vs B and recommend one.", effort, createdAt: new Date(0).toISOString() };
}
// Fresh fully in-memory rig per test (shared saver + store instances so resume works on :memory:).
function rig(extra = {}) {
  const db = new Database(":memory:");
  const store = openStore({ db });
  const checkpointer = SqliteSaver.fromConnString(":memory:");
  return { store, db, checkpointer, mode: "stub", ...extra };
}

(async () => {
  console.log("ECLIPSE P1·W3 — durable graph spine");

  // 1. Trivial 2-node graph through OUR stack (gate wording) with the real checkpointer.
  await okA("trivial 2-node checkpointed graph runs end-to-end", async () => {
    const S = Annotation.Root({ n: Annotation({ reducer: (a, b) => b ?? a, default: () => 0 }) });
    const app = new StateGraph(S).addNode("inc", (s) => ({ n: s.n + 1 })).addNode("dbl", (s) => ({ n: s.n * 2 }))
      .addEdge(START, "inc").addEdge("inc", "dbl").addEdge("dbl", END)
      .compile({ checkpointer: SqliteSaver.fromConnString(":memory:") });
    const out = await app.invoke({ n: 5 }, { configurable: { thread_id: "x" } });
    assert.equal(out.n, 12);
  });

  // 2. Full spine end-to-end.
  await okA("full 10-node spine runs to phase=complete", async () => {
    const sink = [];
    const r = await runMission({ mission: mission("deep"), sideEffectSink: sink, ...rig() });
    assert.equal(r.status, "complete");
    assert.equal(r.state.phase, "complete");
    for (const nm of ["intake", "contract", "context", "plan", "worker", "synthesize", "verify", "artifact", "commit"]) {
      assert.ok(r.state.trail.includes(nm), `trail missing ${nm}`);
    }
    assert.equal(r.state.packets.length, 2, "deep → 2 worker packets");
    assert.equal(r.state.artifacts.length, 1);
    assert.equal(sink.length, 2, "two subtask side effects");
    assert.ok(r.ledger.tokens > 0, "ledger accrued tokens");
  });

  // 3. Events are ordered, monotonic, and bookend the mission.
  await okA("events persisted, monotonic, bookended", async () => {
    const shared = rig();
    const m = mission("deep");
    await runMission({ mission: m, ...shared });
    const evs = shared.store.getEvents(m.missionId, -1);
    assert.ok(evs.length > 10);
    for (let i = 0; i < evs.length; i++) assert.equal(evs[i].sequence, i, "sequence gap");
    assert.equal(evs[0].event_type, "mission.created");
    assert.equal(evs[evs.length - 1].event_type, "mission.complete");
  });

  // 4. CRASH mid-node → resume, NO duplicate side effects (the core gate).
  await okA("crash in worker → resume → side effect runs exactly once", async () => {
    const sink = [];
    const shared = rig();
    let prev = null;
    try {
      await runMission({ mission: mission("deep"), sideEffectSink: sink, faults: { worker: 1 }, ...shared });
      assert.fail("expected injected crash");
    } catch (e) {
      assert.ok(e.injected, "should be the injected fault");
      prev = { run: e.run, cfg: e.cfg, mission: e.mission };
    }
    assert.equal(sink.length, 2, "worker did its side effects before crashing");
    const done = await resumeMission(prev); // fault cleared on resume
    assert.equal(done.status, "complete");
    assert.equal(done.state.phase, "complete");
    assert.equal(sink.length, 2, "IDEMPOTENT: side effects NOT duplicated on replay");
    assert.equal(done.state.packets.length, 2);
  });

  // 5. Cost ledger mirrors into eclipse_graph_runs.
  await okA("ledger mirrored into graph_runs row", async () => {
    const shared = rig();
    const m = mission("deep");
    const r = await runMission({ mission: m, ...shared });
    const row = shared.store.getRun(m.missionId);
    assert.equal(row.status, "complete");
    assert.ok(row.tokens > 0 && row.cost_usd >= 0);
    assert.equal(row.tokens, r.ledger.tokens);
  });

  // 6. Cancel stops promptly — downstream nodes never run.
  await okA("cancelAt=plan → cancelled, no downstream side effects", async () => {
    const sink = [];
    const r = await runMission({ mission: mission("deep"), sideEffectSink: sink, cancelAt: "plan", ...rig() });
    assert.equal(r.status, "cancelled");
    assert.equal(r.atNode, "plan");
    assert.equal(sink.length, 0, "worker never ran");
  });

  // 7. Pause → resume → complete.
  await okA("pauseAt=synthesize → paused → resume → complete", async () => {
    const sink = [];
    const shared = rig();
    const paused = await runMission({ mission: mission("deep"), sideEffectSink: sink, pauseAt: "synthesize", ...shared });
    assert.equal(paused.status, "paused");
    assert.equal(paused.atNode, "synthesize");
    assert.equal(sink.length, 2, "worker ran before the pause");
    const done = await resumeMission(paused, {}); // pauseAt cleared
    assert.equal(done.status, "complete");
    assert.equal(sink.length, 2, "no duplicate work across pause");
    assert.equal(done.state.artifacts.length, 1);
  });

  // 8. Totality plans more workers than deep; pulse → 1 (effort flows through).
  await okA("totality → 3 workers, deep → 2, pulse → 1", async () => {
    const rt = await runMission({ mission: mission("totality"), ...rig() });
    assert.equal(rt.state.packets.length, 3);
    const rp = await runMission({ mission: mission("pulse"), ...rig() });
    assert.equal(rp.state.packets.length, 1);
  });

  // 9. Hard budget ceiling trips mid-mission → graceful failure, not a crash.
  await okA("tiny budget cap → status failed(reason=budget), not a throw", async () => {
    const m = mission("deep");
    m.constraints = { maxTokens: 5, maxCostUsd: 1 }; // absurdly tiny → first model node trips it
    const shared = rig();
    const r = await runMission({ mission: m, ...shared });
    assert.equal(r.status, "failed");
    assert.equal(r.reason, "budget");
    const evs = shared.store.getEvents(m.missionId).map((e) => e.event_type);
    assert.ok(evs.includes("mission.failed"), "emitted mission.failed");
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
