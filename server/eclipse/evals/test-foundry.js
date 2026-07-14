// P2·W6 Agent Foundry test — persona generation, blueprint synthesis, qualification,
// reputation, memory curator. Run: node server/eclipse/evals/test-foundry.js. Zero Gemini.
const assert = require("assert");
const Database = require("better-sqlite3");
const { migrate } = require("../db/migrations");
const { generatePersona, synthesizeWorkerBlueprint } = require("../agents/foundry");
const { qualify } = require("../agents/qualification");
const { createReputation } = require("../agents/reputation");
const { runCurator, getSemantic } = require("../memory/curator");
const { validate, AgentBlueprint } = require("../contracts");
const { getBlueprint } = require("../agents/blueprints");
const { nowIso } = require("../contracts/validate");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

(async () => {
  console.log("ECLIPSE P2·W6 — Agent Foundry");

  await okA("generatePersona detects capabilities + keeps tools within scopes", () => {
    const research = generatePersona({ id: "s1", goal: "research the latest sources on LangGraph checkpointing" });
    assert.ok(research.tools.includes("web.search") && research.tools.includes("web.fetch"));
    const compute = generatePersona({ id: "s2", goal: "calculate and reproduce the compound interest result" });
    assert.ok(compute.tools.includes("code.exec"));
    // every tool's scope is granted by the lease scopes (well-formed by construction)
    const scopeOf = { "web.search": "web.search", "web.fetch": "web.fetch", "memory.retrieve": "memory.read", "code.exec": "code.exec", "calc.repro": "code.exec" };
    for (const t of research.tools) assert.ok(research.leaseScopes.includes(scopeOf[t]), `scope for ${t}`);
    // judgment-heavy research escalates to the reasoning tier
    const hard = generatePersona({ id: "s3", goal: "analyze the trade-offs and recommend, with research and evidence" });
    assert.equal(hard.modelRole, "reasoning");
  });

  await okA("synthesizeWorkerBlueprint yields a schema-valid blueprint", () => {
    const p = generatePersona({ id: "s1", goal: "research sources on X and cite them" });
    const bp = synthesizeWorkerBlueprint(p);
    validate(AgentBlueprint, bp, "blueprint");
    assert.ok(bp.systemInstructionTemplate.includes("[Persona]"));
    assert.deepEqual(bp.toolRequirements, p.tools);
    assert.ok(bp.blueprintId.startsWith("worker."));
  });

  await okA("qualification: well-formed blueprint qualifies; ephemeral persona qualifies", async () => {
    const worker = await qualify(getBlueprint("worker"));
    assert.equal(worker.status, "qualified");
    assert.equal(worker.score, 1);
    const p = generatePersona({ id: "s1", goal: "research and cite sources on durable execution" });
    const eph = await qualify(synthesizeWorkerBlueprint(p));
    assert.equal(eph.status, "qualified", `ephemeral persona should qualify (${JSON.stringify(eph.results)})`);
  });

  await okA("qualification: malformed blueprint (tool exceeds scope) is DENIED → draft", async () => {
    const bad = validate(AgentBlueprint, {
      blueprintId: "bad.worker", version: "1.0.0", name: "Bad", missionRole: "x",
      systemInstructionTemplate: "x", toolRequirements: ["fs.write"],
      leaseTemplate: { scopes: ["web.search"], maxCostUsd: 0.2, mayDelegate: false },
      contextPolicy: { maxTokens: 1000, memoryClasses: [], fileScopes: [] }, modelRole: "main",
    }, "blueprint");
    const r = await qualify(bad);
    assert.equal(r.status, "draft");
    assert.ok(r.results.some((x) => /denied/.test(x.reason)));
  });

  await okA("reputation: 3 strong missions → promoted; 3 weak → retired; pickBest ranks", () => {
    const db = new Database(":memory:"); migrate(db);
    const rep = createReputation(db);
    let good; for (let i = 0; i < 3; i++) good = rep.recordOutcome({ blueprintId: "worker", persona: "research", validated: 2, packets: 2 });
    assert.equal(good.status, "promoted"); assert.ok(good.reputation >= 0.75);
    let bad; for (let i = 0; i < 3; i++) bad = rep.recordOutcome({ blueprintId: "worker", persona: "flaky", validated: 0, packets: 2 });
    assert.equal(bad.status, "retired"); assert.ok(bad.reputation <= 0.25);
    assert.equal(rep.pickBest("worker", ["research", "flaky"]), "research"); // retired 'flaky' excluded
  });

  await okA("curator: promotes validated, corroborates dupes, reflects failures, prunes stale", () => {
    const db = new Database(":memory:"); migrate(db);
    const ins = db.prepare(`INSERT INTO claims(claim_id,mission_id,text,class,confidence,status,quarantined) VALUES(?,?,?,?,?,?,0)`);
    ins.run("c1", "m1", "LangGraph supports durable checkpointing", "fact", 0.8, "supported");
    ins.run("c2", "m2", "langgraph  supports durable checkpointing.", "fact", 0.9, "supported"); // dup (normalizes same)
    ins.run("c3", "m1", "CrewAI lacks native state persistence", "fact", 0.7, "supported");
    ins.run("c4", "m1", "some weak unverified assertion here", "fact", 0.3, "unsupported");
    ins.run("c5", "m1", "trivial low confidence fact zzz", "fact", 0.2, "supported"); // will be pruned
    const rep = runCurator(db);
    assert.equal(rep.promoted, 3);      // c1, c3, c5 inserted
    assert.equal(rep.corroborated, 1);  // c2 bumped c1
    assert.equal(rep.reflexions, 1);    // c4
    assert.equal(rep.pruned, 1);        // c5 pruned (conf 0.2, support 1)
    const facts = getSemantic(db, { kind: "fact" });
    assert.equal(facts.length, 2);      // c1(+c2) and c3 survive
    assert.equal(facts.find((f) => /LangGraph/i.test(f.text)).support_count, 2);
  });

  await okA("integration: mission with Foundry forges personas + records reputation", async () => {
    const { runMission } = require("../orchestration/run-graph");
    const { openStore } = require("../orchestration/store");
    const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
    const store = openStore({ db: new Database(":memory:") });
    const reputation = createReputation(store.db);
    const mission = { schemaVersion: "eclipse.mission.v1", missionId: "m_foundry", userId: "dev", prompt: "Research and compare durable execution options, with evidence.", effort: "deep", createdAt: new Date(0).toISOString() };
    const r = await runMission({ mission, store, checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "stub", useFoundry: true, reputation });
    assert.equal(r.status, "complete");
    const types = store.getEvents(mission.missionId).map((e) => e.event_type);
    assert.ok(types.includes("persona.forged"), "Foundry forged ephemeral personas");
    assert.ok(r.state.packets.length >= 1);
    const rep = reputation.list();
    assert.ok(rep.length >= 1 && rep.some((row) => /^worker\./.test(row.blueprint_id)), "reputation recorded for ephemeral worker blueprint");
    assert.ok(rep[0].missions === 1);
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
