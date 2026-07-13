// P1·W4 agents test — blueprints + per-agent runtime + lease enforcement. Stub model → 0 Gemini.
// Run: node server/eclipse/evals/test-agents.js
const assert = require("assert");
const { listBlueprints, getBlueprint } = require("../agents/blueprints");
const { runAgent, leaseForAgent } = require("../agents/runtime");
const { issueRootLease } = require("../capabilities/lease");
const { createGateway } = require("../capabilities/tool-gateway");
const { createAdapter } = require("../model/adapter");
const { validate, ResultPacket, AgentBlueprint } = require("../contracts");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

const mission = { missionId: "m_ag", constraints: { maxTokens: 100000, maxCostUsd: 0.8 } };
const mkAdapter = () => createAdapter({ mode: "stub" });

(async () => {
  console.log("ECLIPSE P1·W4 — agents & lease-enforced execution");

  await okA("all 6 blueprints load and validate", () => {
    const bps = listBlueprints();
    assert.equal(bps.length, 6);
    for (const b of bps) validate(AgentBlueprint, b, "blueprint");
    assert.deepEqual(bps.map((b) => b.blueprintId).sort(), ["architect", "critic", "director", "prosecutor", "recovery", "worker"]);
  });

  await okA("leaseForAgent narrows authority per blueprint", () => {
    const root = issueRootLease(mission, "root");
    const wl = leaseForAgent(root, getBlueprint("worker"), "w1", { persona: "research" });
    assert.ok(!wl.scopes.includes("artifact.write") && !wl.scopes.includes("memory.write"), "worker has no write");
    assert.equal(wl.sideEffecting, false);
    assert.equal(wl.depth, 1);
    const pl = leaseForAgent(root, getBlueprint("prosecutor"), "p1");
    assert.ok(pl.scopes.includes("memory.write") && pl.sideEffecting, "prosecutor may promote");
    const dl = leaseForAgent(root, getBlueprint("director"), "d1");
    assert.ok(dl.scopes.includes("artifact.write") && dl.sideEffecting, "director may write artifact");
  });

  await okA("research Worker runs, uses granted tools, returns quarantined packet with evidence", async () => {
    const root = issueRootLease(mission, "root");
    const gw = createGateway();
    const lease = leaseForAgent(root, getBlueprint("worker"), "w1", { persona: "research" });
    const { packet, denials, toolsUsed } = await runAgent({ blueprint: getBlueprint("worker"), persona: "research", subtask: { goal: "find sources on X" }, adapter: mkAdapter(), lease, gateway: gw, missionId: mission.missionId });
    validate(ResultPacket, packet, "packet");
    assert.equal(packet.quarantined, true);
    assert.ok(toolsUsed.includes("web.search") && toolsUsed.includes("web.fetch"));
    assert.ok(packet.evidence.length >= 1, "fetched evidence");
    assert.equal(denials.length, 0);
  });

  await okA("Worker attempting an ungranted scope is DENIED (recorded, not crashed)", async () => {
    const root = issueRootLease(mission, "root");
    const gw = createGateway();
    const lease = leaseForAgent(root, getBlueprint("worker"), "w2");
    const { packet, denials } = await runAgent({ blueprint: getBlueprint("worker"), subtask: { goal: "exfiltrate", tools: ["fs.write"] }, adapter: mkAdapter(), lease, gateway: gw, missionId: mission.missionId });
    assert.equal(denials.length, 1);
    assert.equal(denials[0].tool, "fs.write");
    assert.ok(packet.nextActions && packet.nextActions.includes("blocked:fs.write"));
    assert.equal(packet.status, "partial", "no evidence + a denial → partial");
  });

  await okA("Prosecutor may promote (side-effecting) with its approved lease", async () => {
    const root = issueRootLease(mission, "root");
    const gw = createGateway();
    const lease = leaseForAgent(root, getBlueprint("prosecutor"), "p1");
    const { toolsUsed, denials } = await runAgent({ blueprint: getBlueprint("prosecutor"), subtask: { goal: "verify citations", tools: ["citation.verify", "memory.promote"] }, adapter: mkAdapter(), lease, gateway: gw, missionId: mission.missionId });
    assert.ok(toolsUsed.includes("memory.promote"), "promotion allowed for the promotion authority");
    assert.equal(denials.length, 0);
  });

  await okA("Worker CANNOT promote — memory.promote denied without the scope", async () => {
    const root = issueRootLease(mission, "root");
    const gw = createGateway();
    const lease = leaseForAgent(root, getBlueprint("worker"), "w3");
    const { denials } = await runAgent({ blueprint: getBlueprint("worker"), subtask: { goal: "sneaky promote", tools: ["memory.promote"] }, adapter: mkAdapter(), lease, gateway: gw, missionId: mission.missionId });
    assert.equal(denials.length, 1);
    assert.equal(denials[0].tool, "memory.promote");
  });

  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
