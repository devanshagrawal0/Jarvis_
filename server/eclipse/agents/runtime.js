// ECLIPSE agent runtime — executes ONE agent turn from a blueprint. Every tool the agent
// intends to use is routed through the gateway against the agent's (narrowed) lease, so an
// agent physically cannot act beyond its authority. Returns a schema-valid ResultPacket (the
// blackboard currency). Model calls run through the adapter (stub in tests → zero Gemini).
const { validate, ResultPacket } = require("../contracts");
const { id } = require("../contracts/validate");
const { narrow } = require("../capabilities/lease");
const { WORKER_PERSONAS } = require("./blueprints");

// Which adapter "node" (→ model tier) each blueprint runs on.
const AGENT_NODE = { architect: "plan", worker: "worker", critic: "verify", prosecutor: "verify", director: "artifact", recovery: "repair" };

function fillTemplate(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`)); }

// Issue a child lease for an agent by narrowing the mission root lease (all agents = depth 1).
// The Architect proposes scopes; the orchestrator (holding root) issues the actual lease.
function leaseForAgent(rootLease, blueprint, sessionId, { persona } = {}) {
  const scopes = blueprint.leaseTemplate.scopes;
  const wantsSideEffect = scopes.some((s) => /write|control/.test(s));
  const personaCfg = persona ? WORKER_PERSONAS[persona] : null;
  const maxCalls = personaCfg ? { "web.search": 5, "web.fetch": 8, "code.exec": 4 } : (blueprint.blueprintId === "critic" ? { "web.search": 3 } : {});
  return narrow(rootLease, {
    sessionId, scopes, maxCalls,
    maxCostUsd: blueprint.leaseTemplate.maxCostUsd,
    mayDelegate: blueprint.leaseTemplate.mayDelegate,
    sideEffecting: wantsSideEffect,
  });
}

function toolResource(tool, missionId) {
  if (tool === "web.search") return "https://search.example/q";
  if (tool === "web.fetch" || tool === "url_context" || tool === "citation.verify") return "https://example.com/evidence";
  if (tool === "memory.retrieve" || tool === "memory.promote") return `memory:${missionId}`;
  if (tool === "code.exec" || tool === "calc.repro") return "sandbox:py";
  if (tool === "artifact.write") return `artifacts:${missionId}/report`;
  return null;
}
// Deterministic tool stub (real top-5 tools are W5). Produces an evidence ref for fetch-like tools.
function defaultToolStub(tool, subtask, missionId) {
  if (["web.fetch", "url_context", "citation.verify"].includes(tool)) {
    return { evidence: { sourceUri: "https://example.com/evidence", quote: `supporting note for ${String(subtask.goal || "").slice(0, 30)}`, retrievedAt: new Date(0).toISOString(), hash: id("h") } };
  }
  return { ok: true };
}

// runAgent(opts) → { packet, denials, toolsUsed }
async function runAgent(opts) {
  const { blueprint, persona, subtask = {}, adapter, lease, gateway, missionId, effort = "deep", toolStub, stub } = opts;
  const personaCfg = persona ? WORKER_PERSONAS[persona] : null;
  const system = fillTemplate(blueprint.systemInstructionTemplate, { persona: persona || "", focus: personaCfg ? personaCfg.focus : "" });
  const node = AGENT_NODE[blueprint.blueprintId] || "worker";

  // 1) Mediate intended tool calls through the gateway (lease enforcement). Denials don't crash
  // the agent — it records them and returns a partial packet (honest about what it couldn't do).
  // preEvidence: evidence already captured by the node's own lease-mediated tool calls (W5).
  const toolsUsed = [], evidence = Array.isArray(opts.preEvidence) ? opts.preEvidence.slice() : [], denials = [];
  const intended = subtask.tools || (personaCfg && personaCfg.tools) || blueprint.toolRequirements || [];
  for (const tool of intended) {
    try {
      const res = await gateway.mediate(lease, { tool, resource: toolResource(tool, missionId) }, () => (toolStub ? toolStub(tool, subtask) : defaultToolStub(tool, subtask, missionId)));
      toolsUsed.push(tool);
      if (res && res.evidence) evidence.push(res.evidence);
    } catch (e) {
      if (e.leaseCode === "DENIED") denials.push({ tool, reason: e.message });
      else throw e;
    }
  }

  // 2) Model turn (stub in tests).
  const r = await adapter.run({ node, effort, system, input: subtask.goal || opts.input || "", stub });

  // 3) Emit the blackboard packet. Only the Prosecutor un-quarantines; everyone else stays quarantined.
  const status = denials.length && !evidence.length ? "partial" : "unverified";
  // Live model text becomes the claim; stub output ("[stub:...]") falls back to a templated claim.
  const modelText = r.text && !/^\[stub:/.test(r.text) ? r.text.trim() : null;
  const packet = validate(ResultPacket, {
    packetId: id("p"), missionId, agentSessionId: lease.sessionId, blueprint: blueprint.blueprintId,
    claim: modelText ? modelText.slice(0, 900) : (subtask.goal ? `Finding for: ${String(subtask.goal).slice(0, 120)}` : (r.text || "result").slice(0, 160)),
    status, confidence: evidence.length ? 0.7 : 0.5, evidence,
    provenance: { toolsUsed, leaseId: lease.leaseId, tokens: (r.usage && r.usage.tokensOut) || 0 },
    quarantined: true,
    nextActions: denials.length ? denials.map((d) => `blocked:${d.tool}`) : undefined,
    cost: { tokens: (r.usage && r.usage.tokensOut) || 0, wallclockMs: 0 },
  }, "packet");
  return { packet, denials, toolsUsed };
}

module.exports = { runAgent, leaseForAgent, AGENT_NODE, toolResource, defaultToolStub, fillTemplate };
