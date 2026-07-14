// ECLIPSE Agent Foundry (P2·W6) — generate EPHEMERAL Worker personas per subtask instead of
// picking from 4 fixed identities. A persona = framing + tool preset + lease scopes + model tier,
// derived DETERMINISTICALLY from the subtask's capability signals. synthesizeWorkerBlueprint()
// turns a persona into a schema-valid AgentBlueprint (base Worker + persona overrides), so a
// generated persona plugs into the same runtime/gateway as the hand-written blueprints.
const { validate, AgentBlueprint } = require("../contracts");
const { id } = require("../contracts/validate");
const { getBlueprint } = require("./blueprints");

// Capability signals — what the subtask needs, inferred from its text.
const SIGNAL = {
  web: /\b(research|find|sources?|latest|current|news|cite|citation|documentation|docs|according to|evidence|compare|survey|landscape|who|what|when|where)\b/i,
  code: /\b(compute|calculate|run|execute|simulate|script|code|program|algorithm|reproduce|verify the (number|math)|derive)\b/i,
  data: /\b(dataset|data set|csv|table|statistics|numbers?|metric|average|median|correlation|regression|percentage|quantitativ)\b/i,
  extract: /\b(summari[sz]e|extract|key points?|from (the|this) (document|pdf|file|text)|tl;?dr|condense|pull out)\b/i,
  analyze: /\b(analy[sz]e|evaluate|assess|reason|trade-?offs?|recommend|judge|critique|implications?)\b/i,
};

const TOOLSET = {
  web: ["web.search", "web.fetch", "memory.retrieve"],
  code: ["code.exec", "calc.repro"],
  data: ["code.exec", "calc.repro", "memory.retrieve"],
  extract: ["memory.retrieve"],
};
const SCOPE_FOR = { "web.search": "web.search", "web.fetch": "web.fetch", "memory.retrieve": "memory.read", "code.exec": "code.exec", "calc.repro": "code.exec" };

// generatePersona(subtask, {genome}) → { id, label, capabilities, framing, tools, leaseScopes, modelRole }
function generatePersona(subtask = {}, { genome } = {}) {
  const text = String(subtask.goal || subtask.prompt || "");
  const caps = Object.keys(SIGNAL).filter((k) => SIGNAL[k].test(text));
  if (!caps.length) caps.push("web"); // default to a research persona

  const tools = uniq(caps.flatMap((c) => TOOLSET[c] || []));
  const leaseScopes = uniq(tools.map((t) => SCOPE_FOR[t]).filter(Boolean));
  // Escalate to the reasoning tier when the subtask is judgment-heavy; else the Flash workhorse.
  const modelRole = caps.includes("analyze") && (caps.includes("web") || caps.includes("data")) ? "reasoning" : "main";
  const label = caps.filter((c) => c !== "analyze").slice(0, 2).join("+") || "research";
  const framing = `You are a purpose-built ${label} Worker for this subtask. ` + caps.map((c) => FRAMING[c]).filter(Boolean).join(" ");

  return { id: id("persona"), label, capabilities: caps, framing, tools, leaseScopes, modelRole, forSubtask: subtask.id || null };
}
const FRAMING = {
  web: "Gather and cite external evidence; every claim needs a source with a short verbatim quote.",
  code: "Reproduce numbers/logic by running code; report the exact result and how it was derived.",
  data: "Work quantitatively; verify every figure independently before asserting it.",
  extract: "Extract only what the supplied material actually states; do not add outside facts.",
  analyze: "Reason explicitly about trade-offs and give a defensible recommendation, flagging uncertainty.",
};

// synthesizeWorkerBlueprint(persona) → AgentBlueprint (base Worker + persona overrides), validated.
function synthesizeWorkerBlueprint(persona) {
  const base = getBlueprint("worker");
  return validate(AgentBlueprint, {
    ...base,
    blueprintId: `worker.${persona.label}.${persona.id.slice(-6)}`,
    version: "1.0.0-ephemeral",
    name: `Worker (${persona.label})`,
    systemInstructionTemplate: `${base.systemInstructionTemplate}\n\n[Persona] ${persona.framing}`,
    toolRequirements: persona.tools,
    leaseTemplate: { ...base.leaseTemplate, scopes: persona.leaseScopes.length ? persona.leaseScopes : base.leaseTemplate.scopes },
    modelRole: persona.modelRole === "reasoning" ? "reasoning" : "main",
    qualification: { fixtures: [`fx.${persona.label}`], minScore: 0.6, status: "draft" },
  }, `blueprint:${persona.label}`);
}

function uniq(a) { return a.filter((v, i) => a.indexOf(v) === i); }

module.exports = { generatePersona, synthesizeWorkerBlueprint, SIGNAL, TOOLSET };
