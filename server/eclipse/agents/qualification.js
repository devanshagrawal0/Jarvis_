// ECLIPSE qualification pipeline (P2·W6) — a blueprint (hand-written OR a generated ephemeral
// persona) must PROVE it can operate before it runs a real mission: it produces a valid
// ResultPacket AND every tool it declares is actually usable within the lease it would be
// granted. A persona whose tools exceed its scopes gets DENIED at the gateway → fails
// qualification. Runs on the stub adapter → deterministic, zero Gemini.
const { runAgent, leaseForAgent } = require("./runtime");
const { issueRootLease } = require("../capabilities/lease");
const { createGateway } = require("../capabilities/tool-gateway");
const { createAdapter } = require("../model/adapter");
const { id } = require("../contracts/validate");

function defaultProbes(blueprint) {
  return [
    { goal: "qualification probe: exercise all declared tools on a bounded task", tools: blueprint.toolRequirements || [] },
    { goal: "qualification probe: complete a minimal task with no tools", tools: [] },
  ];
}

// qualify(blueprint, opts) → { blueprintId, score, status, minScore, results }
async function qualify(blueprint, opts = {}) {
  const adapter = opts.adapter || createAdapter({ mode: "stub" });
  const gateway = opts.gateway || createGateway();
  const missionId = opts.missionId || "qual";
  const rootLease = opts.rootLease || issueRootLease({ missionId, constraints: {} }, "qual-root");
  const probes = opts.probes || defaultProbes(blueprint);
  const minScore = (blueprint.qualification && blueprint.qualification.minScore) != null ? blueprint.qualification.minScore : 0.6;

  const results = [];
  for (const p of probes) {
    let ok = false, denials = [], reason = "";
    try {
      const lease = leaseForAgent(rootLease, blueprint, id("sess-q"));
      const r = await runAgent({ blueprint, subtask: { goal: p.goal, tools: p.tools }, adapter, lease, gateway, missionId });
      denials = r.denials || [];
      const producedPacket = !!r.packet && !!r.packet.packetId;
      const expectOk = !p.expect || matchExpect(r.packet, p.expect);
      ok = producedPacket && expectOk && denials.length === 0;
      reason = !producedPacket ? "no packet" : denials.length ? `denied: ${denials.map((d) => d.tool).join(",")}` : !expectOk ? "output mismatch" : "ok";
    } catch (e) { ok = false; reason = `threw: ${String(e.message).slice(0, 60)}`; }
    results.push({ goal: p.goal, ok, denials, reason });
  }
  const passed = results.filter((r) => r.ok).length;
  const score = results.length ? passed / results.length : 0;
  const status = score >= minScore ? "qualified" : "draft";
  return { blueprintId: blueprint.blueprintId, score: Number(score.toFixed(3)), status, minScore, passed, total: results.length, results };
}

function matchExpect(packet, expect) {
  if (typeof expect === "function") return !!expect(packet);
  const hay = `${packet.claim || ""} ${(packet.provenance && packet.provenance.toolsUsed || []).join(" ")}`.toLowerCase();
  return hay.includes(String(expect).toLowerCase());
}

module.exports = { qualify, defaultProbes };
