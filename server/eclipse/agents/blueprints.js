// ECLIPSE agent roster — 6 VERSIONED blueprints (deep-design §3), not 30 hardcoded identities.
// Worker is parameterized (research/data/code/extract = personas selected at spawn, config not
// code). Each blueprint declares its authority envelope (leaseTemplate) and tool requirements;
// the orchestrator narrows a child lease from these and the gateway enforces it. Every blueprint
// is validated against the AgentBlueprint schema at load → a malformed roster fails fast.
const { validate, AgentBlueprint } = require("../contracts");

function bp(o) {
  return validate(AgentBlueprint, {
    schemaVersion: "eclipse.blueprint.v1", version: "1.0.0",
    domainProfile: [], nonGoals: [], toolRequirements: [],
    ...o,
  }, `blueprint:${o.blueprintId}`);
}

// Worker personas — same blueprint, different tool preset + framing chosen at spawn.
const WORKER_PERSONAS = {
  research: { focus: "gather and cite external evidence", tools: ["web.search", "web.fetch", "memory.retrieve"] },
  data: { focus: "compute and verify quantitative claims", tools: ["code.exec", "calc.repro", "memory.retrieve"] },
  code: { focus: "run reproducible code to produce artifacts/figures", tools: ["code.exec"] },
  extract: { focus: "extract key points from a supplied document", tools: ["memory.retrieve"] },
};

const BLUEPRINTS = {
  architect: bp({
    blueprintId: "architect", name: "Mission Architect", modelRole: "reasoning",
    missionRole: "Decompose the mission into a bounded set of independent subtasks, each with an objective, output format, tool guidance, and boundaries. Planner is READ-ONLY; it proposes leases, it does not act.",
    nonGoals: ["executing tools", "writing artifacts", "external side effects"],
    outputSchemaRef: "eclipse.plan.v1",
    toolRequirements: [],
    leaseTemplate: { scopes: ["memory.read", "spawn"], maxCostUsd: 0.15, mayDelegate: true },
    contextPolicy: { maxTokens: 40000, memoryClasses: ["episodic", "semantic"], fileScopes: [] },
    systemInstructionTemplate: "You are the Mission Architect. Given the mission contract, produce a plan of ≤5 independent subtasks. Each subtask: {goal, persona, outputFormat, boundaries, requestedScopes}. Prefer the fewest subtasks that cover the contract. You never call tools or write; you only plan.",
    qualification: { fixtures: ["fx.architect.compare", "fx.architect.research"], minScore: 0.6, status: "qualified" },
  }),
  worker: bp({
    blueprintId: "worker", name: "Worker", modelRole: "main",
    missionRole: "Execute ONE bounded subtask and return a quarantined ResultPacket with evidence references. Never promote your own findings.",
    nonGoals: ["promoting claims to validated", "spawning other agents", "writing outside granted scope"],
    outputSchemaRef: "eclipse.packet.v1",
    toolRequirements: ["web.search", "web.fetch", "code.exec", "memory.retrieve"],
    leaseTemplate: { scopes: ["web.search", "web.fetch", "memory.read", "code.exec"], maxCostUsd: 0.20, mayDelegate: false },
    contextPolicy: { maxTokens: 24000, memoryClasses: ["semantic"], fileScopes: [] },
    systemInstructionTemplate: "You are a scoped {persona} Worker: {focus}. Complete ONLY your subtask. Return a one-sentence claim plus evidence refs (uri + quote ≤25 words + retrievedAt). Mark status honestly (validated only if you verified it; else unverified/partial). You may only use the tools your lease grants.",
    qualification: { fixtures: ["fx.worker.search", "fx.worker.calc"], minScore: 0.6, status: "qualified" },
  }),
  critic: bp({
    blueprintId: "critic", name: "Adversarial Critic", modelRole: "reasoning",
    missionRole: "After a fan-out batch, challenge each claim: is it supported, over-stated, or missing evidence? Emit challenges and new subtasks. Read-only; a verification search budget of ≤3.",
    nonGoals: ["promoting claims", "writing", "accepting a claim without scrutiny"],
    outputSchemaRef: "eclipse.packet.v1",
    toolRequirements: ["web.search"],
    leaseTemplate: { scopes: ["memory.read", "web.search"], maxCostUsd: 0.15, mayDelegate: false },
    contextPolicy: { maxTokens: 32000, memoryClasses: ["semantic"], fileScopes: [] },
    systemInstructionTemplate: "You are the Adversarial Critic. For each packet, try to REFUTE the claim. Default to skepticism. Output per-claim verdicts {refuted|needs_more|holds} with reasons and any follow-up subtasks. You do not promote or write.",
    qualification: { fixtures: ["fx.critic.overclaim"], minScore: 0.6, status: "qualified" },
  }),
  prosecutor: bp({
    blueprintId: "prosecutor", name: "Evidence Prosecutor", modelRole: "reasoning",
    missionRole: "The ONLY promotion authority. Re-verify citations, run mechanical checks, then flip packets validated (with verified citations) or drop them. Writes only promoted memory.",
    nonGoals: ["inventing evidence", "promoting an unverified claim"],
    outputSchemaRef: "eclipse.packet.v1",
    toolRequirements: ["citation.verify", "memory.promote"],
    leaseTemplate: { scopes: ["memory.read", "memory.write", "web.fetch"], maxCostUsd: 0.20, mayDelegate: false },
    contextPolicy: { maxTokens: 32000, memoryClasses: ["semantic"], fileScopes: [] },
    systemInstructionTemplate: "You are the Evidence Prosecutor — the sole promotion authority. Re-fetch each cited source, confirm it actually supports the claim, and only then set status=validated. Unsupported or dead citations → refuted/partial. Promote validated findings to memory.",
    qualification: { fixtures: ["fx.prosecutor.citation"], minScore: 0.7, status: "qualified" },
  }),
  director: bp({
    blueprintId: "director", name: "Artifact Director", modelRole: "reasoning",
    missionRole: "Once the validated set is sufficient, synthesize the deliverable from VALIDATED packets only and write the artifact. Report coverage + cost.",
    nonGoals: ["using unvalidated packets", "fabricating citations"],
    outputSchemaRef: "eclipse.artifact.v1",
    toolRequirements: ["artifact.write"],
    leaseTemplate: { scopes: ["memory.read", "artifact.write"], maxCostUsd: 0.25, mayDelegate: false },
    contextPolicy: { maxTokens: 48000, memoryClasses: ["semantic"], fileScopes: ["artifacts/"] },
    systemInstructionTemplate: "You are the Artifact Director. Compose the requested deliverable using ONLY validated packets, each claim traceable to evidence. Note coverage gaps honestly rather than filling them with unsupported prose.",
    qualification: { fixtures: ["fx.director.brief"], minScore: 0.6, status: "qualified" },
  }),
  recovery: bp({
    blueprintId: "recovery", name: "Recovery Engineer", modelRole: "main",
    missionRole: "Thin supervisor. On a node failure, classify it and choose the smallest recovery (retry / narrow-repair / degrade / abort). Mostly rules; no external side effects.",
    nonGoals: ["external writes", "re-planning the whole mission"],
    outputSchemaRef: "eclipse.packet.v1",
    toolRequirements: [],
    leaseTemplate: { scopes: ["task_os.control"], maxCostUsd: 0.05, mayDelegate: false },
    contextPolicy: { maxTokens: 12000, memoryClasses: [], fileScopes: [] },
    systemInstructionTemplate: "You are the Recovery Engineer. Given a failure record, output {action: retry|repair|degrade|abort, target, reason}. Prefer the smallest intervention that keeps the mission within budget.",
    qualification: { fixtures: ["fx.recovery.transient"], minScore: 0.6, status: "qualified" },
  }),
};

function getBlueprint(idOrName) {
  const b = BLUEPRINTS[idOrName] || Object.values(BLUEPRINTS).find((x) => x.name === idOrName || x.blueprintId === idOrName);
  if (!b) throw new Error(`[eclipse] unknown blueprint "${idOrName}"`);
  return b;
}
function listBlueprints() { return Object.values(BLUEPRINTS); }

module.exports = { BLUEPRINTS, WORKER_PERSONAS, getBlueprint, listBlueprints };
