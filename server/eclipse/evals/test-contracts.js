// P1·W1 gate test — contracts + migrations. Run: node server/eclipse/evals/test-contracts.js
// Pure/local: no Gemini, no live DB (uses an in-memory sqlite). Exit 1 on any failure.
const assert = require("assert");
const Database = require("better-sqlite3");
const C = require("../contracts");
const { migrate, tableNames, SCHEMA_VERSION } = require("../db/migrations");
const fx = require("./fixtures/samples");

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

console.log("ECLIPSE P1·W1 — contracts & migrations");

// 1. Good missions validate (and defaults fill in).
ok("MissionSpec minimal validates + defaults applied", () => {
  const m = C.validate(C.MissionSpec, fx.goodMissionMinimal, "mission");
  assert.equal(m.kind, "eclipse");
  assert.equal(m.constraints.maxCostUsd, 1.0);
  assert.deepEqual(m.requestedOutputs, []);
});
ok("MissionSpec full validates", () => {
  const m = C.validate(C.MissionSpec, fx.goodMissionFull, "mission");
  assert.equal(m.constraints.maxCostUsd, 0.75);
  assert.equal(m.acceptanceTests[0].status, "pending"); // default
});

// 2. Bad mission rejected (schema is a real boundary).
ok("bad MissionSpec is rejected with issues", () => {
  const r = C.safeValidate(C.MissionSpec, fx.badMission);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
  assert.throws(() => C.validate(C.MissionSpec, fx.badMission, "mission"), /invalid mission/);
});

// 3. ResultPacket + EclipseEvent round-trip.
ok("ResultPacket validates", () => {
  const p = C.validate(C.ResultPacket, fx.goodPacket, "packet");
  assert.equal(p.schemaVersion, "eclipse.packet.v1");
  assert.equal(p.quarantined, false);
});
ok("EclipseEvent validates + defaults schemaVersion", () => {
  const e = C.validate(C.EclipseEvent, fx.goodEvent, "event");
  assert.equal(e.schemaVersion, "eclipse.event.v1");
});

// 4. EclipseState (nested) validates with a budget.
ok("EclipseState validates", () => {
  const s = C.validate(C.EclipseState, {
    mission: fx.goodMissionFull,
    budget: { maxCostUsd: 0.75, maxTokens: 300000 },
  }, "state");
  assert.equal(s.phase, "intake");
  assert.equal(s.revision, 0);
});

// 5. CapabilityLease + AgentBlueprint validate.
ok("CapabilityLease validates", () => {
  C.validate(C.CapabilityLease, {
    leaseId: "l1", missionId: "m_full", sessionId: "s1",
    scopes: ["web.search", "web.fetch"], resourceGlobs: ["https://*"],
    expiresAt: fx.goodEvent.occurredAt,
  }, "lease");
});
ok("AgentBlueprint validates", () => {
  C.validate(C.AgentBlueprint, {
    blueprintId: "bp_worker", version: "1.0.0", name: "Worker", missionRole: "execute one bounded subtask",
    systemInstructionTemplate: "You are a scoped worker…",
    leaseTemplate: { scopes: ["web.search"] }, contextPolicy: {},
  }, "blueprint");
});

// 6. Migration is idempotent and creates every table.
ok("migrate() creates all eclipse tables (idempotent)", () => {
  const db = new Database(":memory:");
  const r1 = migrate(db);
  const r2 = migrate(db); // run twice — must not throw
  assert.equal(r1.schemaVersion, SCHEMA_VERSION);
  assert.equal(r2.schemaVersion, SCHEMA_VERSION);
  const t = tableNames(db);
  for (const want of ["eclipse_graph_runs", "eclipse_node_runs", "eclipse_events", "evidence_objects", "claims", "claim_evidence_edges", "capability_leases", "artifact_manifests", "eclipse_meta"]) {
    assert.ok(t.includes(want), `missing table ${want}`);
  }
  // insert + read a graph run
  db.prepare("INSERT INTO eclipse_graph_runs(graph_run_id, mission_id, graph_version, status) VALUES(?,?,?,?)").run("g1", "m_full", "v1", "running");
  assert.equal(db.prepare("SELECT status FROM eclipse_graph_runs WHERE graph_run_id='g1'").get().status, "running");
  db.close();
});

// 7. SCHEMA_VERSIONS registry matches literal schemaVersions.
ok("SCHEMA_VERSIONS registry consistent", () => {
  assert.equal(C.SCHEMA_VERSIONS.mission, "eclipse.mission.v1");
  assert.equal(C.SCHEMA_VERSIONS.event, "eclipse.event.v1");
});

console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
