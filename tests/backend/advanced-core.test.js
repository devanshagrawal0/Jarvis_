const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { evaluateAutonomy } = require("../../server/autonomy-policy");
const { createMemoryStore } = require("../../server/memory-store");
const { createMissionEngine } = require("../../server/mission-engine");
const { createWindowsBrokerClient } = require("../../server/windows-broker-client");

const temporaryDirs = [];
const closers = [];

function tempDir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-"));
  temporaryDirs.push(value);
  return value;
}

afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const directory of temporaryDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test("autonomy levels enforce observe, prepare, act, and timed autopilot", () => {
  const execute = { risk: "execute" };
  const denied = evaluateAutonomy({
    definition: execute,
    tool: "open_app",
    args: { app: "notepad" },
    profile: { level: "observe" },
    context: {},
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.needsElevation, true);

  const act = evaluateAutonomy({
    definition: execute,
    tool: "open_app",
    args: { app: "notepad" },
    profile: { level: "act", allowedApps: ["notepad"] },
    context: {},
  });
  assert.equal(act.allowed, true);
  assert.equal(act.requiresConfirmation, true);

  const autopilot = evaluateAutonomy({
    definition: execute,
    tool: "open_app",
    args: { app: "notepad" },
    profile: { level: "autopilot", allowedApps: ["notepad"], autopilotExpiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: {},
  });
  assert.equal(autopilot.allowed, true);
  assert.equal(autopilot.requiresConfirmation, false);
});

test("long-term memory supports provenance, relevance, correction, and forgetting", () => {
  const store = createMemoryStore(tempDir());
  closers.push(() => store.close());
  const original = store.add({
    kind: "semantic",
    category: "preference",
    text: "Devansh prefers concise operational answers.",
    source: "user",
    confidence: 1,
    importance: 0.9,
  });
  const matches = store.search("operational concise", { limit: 5 });
  assert.equal(matches[0].id, original.id);
  assert.equal(matches[0].source, "user");

  const corrected = store.correct(original.id, { text: "Devansh prefers concise answers with verification evidence." });
  assert.equal(store.search("verification evidence")[0].id, corrected.id);
  assert.equal(store.search("operational concise").some((item) => item.id === original.id), false);
  const graph = store.lifeGraph();
  assert.ok(graph.buckets.preferences.some((item) => /verification evidence/i.test(item.text)));
  assert.ok(graph.summary.preferences >= 1);

  store.forget(corrected.id, "test cleanup");
  assert.equal(store.search("verification evidence").length, 0);
});

test("coordinator missions deploy real child roles and synthesize their results", async () => {
  const engine = createMissionEngine(tempDir(), {
    executor: async (mission) => ({
      response: `${mission.role} completed ${mission.objective}`,
      toolResults: [{ tool: "test_evidence", status: "completed", ok: true }],
      pendingConfirmations: [],
    }),
  });
  closers.push(() => engine.close());
  const coordinator = engine.create({ title: "Build briefing", objective: "Produce a verified briefing", role: "coordinator" });
  await engine.drain();
  const completed = engine.get(coordinator.id);
  assert.equal(completed.status, "complete");
  assert.equal(completed.checkpoint.phase, "complete");
  const children = engine.list().filter((mission) => mission.parentId === coordinator.id);
  assert.deepEqual(children.map((mission) => mission.role).sort(), ["analyst", "research", "verifier"]);
  assert.ok(children.every((mission) => mission.status === "complete"));
  assert.match(completed.result.response, /coordinator completed/i);
});

test("Windows automation broker is isolated and returns semantic window data", async () => {
  const broker = createWindowsBrokerClient(path.resolve(__dirname, "../.."));
  closers.push(() => broker.stop());
  const health = await broker.health();
  assert.equal(health.semanticAutomation, true);
  const result = await broker.call("list_windows", { limit: 5 });
  assert.ok(Array.isArray(result.windows));
  assert.ok(result.windows.every((window) => Object.hasOwn(window, "processId")));
  await assert.rejects(() => broker.call("arbitrary_shell", { command: "whoami" }), /unknown broker method/i);
});

test("memory survives a process-style close and reopen", () => {
  const directory = tempDir();
  let store = createMemoryStore(directory);
  const saved = store.add({ text: "Persistent memory marker", category: "recovery", source: "test" });
  store.close();
  store = createMemoryStore(directory);
  closers.push(() => store.close());
  assert.equal(store.search("persistent marker")[0].id, saved.id);
});

test("a mission marked running is recovered and completed after restart", async () => {
  const directory = tempDir();
  let engine = createMissionEngine(directory);
  const mission = engine.create({ title: "Restart mission", objective: "Verify restart recovery", role: "verifier" });
  engine.close();

  const db = new DatabaseSync(path.join(directory, "jarvis-missions.sqlite"));
  db.prepare("UPDATE missions SET status='running', checkpoint_json=? WHERE id=?")
    .run(JSON.stringify({ phase: "executing", marker: "before-restart" }), mission.id);
  db.close();

  engine = createMissionEngine(directory, {
    executor: async () => ({ response: "Recovered execution completed", toolResults: [], pendingConfirmations: [] }),
  });
  closers.push(() => engine.close());
  const recovery = engine.recover();
  assert.equal(recovery.recovered, 1);
  await engine.drain();
  const completed = engine.get(mission.id);
  assert.equal(completed.status, "complete");
  assert.ok(completed.events.some((event) => event.type === "recovered"));
});

test("Task OS missions start with evidence requirements and suggested tools", () => {
  const directory = tempDir();
  const engine = createMissionEngine(directory);
  closers.push(() => engine.close());
  const mission = engine.create({
    title: "Canvas upload",
    objective: "Open Canvas, find my assignment, upload the PDF, and submit it after approval",
    role: "operator",
  });
  assert.ok(mission.checkpoint.plan.length >= 5);
  assert.ok(mission.checkpoint.evidenceRequirements.some((item) => /Website claims/i.test(item)));
  assert.ok(mission.checkpoint.evidenceRequirements.some((item) => /File claims/i.test(item)));
  assert.ok(mission.checkpoint.suggestedTools.includes("browser_login_handoff"));
  assert.ok(mission.events.some((event) => event.type === "planned"));
});

test("cancellation wins over a late executor result", async () => {
  const directory = tempDir();
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const engine = createMissionEngine(directory, {
    executor: async () => {
      await blocker;
      return { response: "Late completion", toolResults: [], pendingConfirmations: [] };
    },
  });
  closers.push(() => engine.close());
  const mission = engine.create({ title: "Cancellation mission", objective: "Wait until cancelled", role: "verifier" });
  const draining = engine.drain();
  for (let attempt = 0; attempt < 50 && engine.get(mission.id).status !== "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  engine.control(mission.id, "cancel");
  release();
  await draining;
  assert.equal(engine.get(mission.id).status, "cancelled");
});
