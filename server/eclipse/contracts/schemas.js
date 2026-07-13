// ECLIPSE contracts — Zod schemas (ADR-001: JS + Zod + JSDoc, CommonJS).
// Every object at a process/graph boundary is parsed here; every persisted object carries
// a `schemaVersion`. Safe to require() with the feature flag off — no side effects on load.
const { z } = require("zod");

// ── shared enums / primitives ────────────────────────────────────────────
const Effort = z.enum(["pulse", "deep", "totality"]);
const NodeStatus = z.enum(["queued", "running", "waiting", "succeeded", "failed", "cancelled"]);
const Phase = z.enum(["intake", "context", "planning", "executing", "verifying", "producing", "complete", "failed"]);
const Privacy = z.enum(["local", "provider", "mixed"]);
const ClaimClass = z.enum(["fact", "estimate", "inference", "recommendation"]);
const ClaimStatus = z.enum(["supported", "mixed", "unsupported", "stale"]);
const PacketStatus = z.enum(["validated", "unverified", "refuted", "partial"]);
const isoString = z.string().min(1); // ISO timestamp (kept as string for SQLite portability)

// ── mission (user contract) ──────────────────────────────────────────────
const ArtifactRequest = z.object({
  kind: z.enum(["docx", "pptx", "pdf", "xlsx", "code", "site", "image", "bundle", "answer"]),
  audience: z.string().optional(),
  format: z.string().optional(),
  notes: z.string().optional(),
});
const AcceptanceTest = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.enum(["claim_supported", "calculation", "coverage", "render", "custom"]).default("custom"),
  status: z.enum(["pending", "pass", "fail"]).default("pending"),
});
const MissionConstraints = z.object({
  deadlineMs: z.number().int().positive().optional(),
  maxCostUsd: z.number().nonnegative().default(1.0),   // ENFORCED (circuit breaker)
  maxTokens: z.number().int().positive().default(400000),
  allowedPaths: z.array(z.string()).default([]),
  excludedSources: z.array(z.string()).optional(),
  privacy: Privacy.default("provider"),
});
const MissionSpec = z.object({
  schemaVersion: z.literal("eclipse.mission.v1"),
  missionId: z.string(),
  userId: z.string(),
  kind: z.literal("eclipse").default("eclipse"), // discriminator vs. ReAct missions in the same table
  roomId: z.string().optional(),
  folderId: z.string().optional(),
  prompt: z.string().min(1),
  effort: Effort,
  requestedOutputs: z.array(ArtifactRequest).default([]),
  constraints: MissionConstraints.default(() => MissionConstraints.parse({})), // apply inner field defaults
  acceptanceTests: z.array(AcceptanceTest).default([]),
  createdAt: isoString,
});

// ── intent genome (routing signature) ────────────────────────────────────
const IntentGenome = z.object({
  schemaVersion: z.literal("eclipse.genome.v1").default("eclipse.genome.v1"),
  taskFamily: z.enum(["chat", "fact", "command", "compute", "extract", "research", "compare", "build", "analyze"]),
  depth: z.number().min(0),           // # distinct sub-questions / breadth
  consequence: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  ambiguity: z.number().min(0).max(1),
  answerableFromMemory: z.number().min(0).max(1).default(0),
  missionScore: z.number().min(0).max(1),
  tier: z.enum(["cortex", "pulse", "deep", "totality"]),
  reasons: z.array(z.string()).default([]),
  stage: z.enum(["allowlist", "classifier", "override"]),
});

// ── graph plan / nodes ───────────────────────────────────────────────────
const NodeSpec = z.object({
  nodeId: z.string(),
  op: z.enum(["intake", "context", "plan", "research", "analyze", "synthesize", "verify", "repair", "artifact", "commit", "worker"]),
  dependsOn: z.array(z.string()).default([]),
  agentBlueprint: z.string().optional(),
  policy: z.enum(["direct", "decompose", "react", "beam", "tree", "debate", "counterfactual", "evolutionary", "programmatic"]).default("direct"),
  modelRole: z.enum(["router", "main", "reasoning", "deepResearch"]).default("main"),
  tools: z.array(z.string()).default([]),
  budgetTokens: z.number().int().positive().optional(),
  outputSchemaRef: z.string().optional(),
  verifier: z.string().optional(),
  fallback: z.string().optional(),
});
const GraphPlan = z.object({
  schemaVersion: z.literal("eclipse.plan.v1").default("eclipse.plan.v1"),
  nodes: z.array(NodeSpec).default([]),
  branchLimit: z.number().int().nonnegative().default(0),
  stopRules: z.array(z.string()).default([]),
});
const NodeRun = z.object({
  nodeRunId: z.string(),
  graphRunId: z.string(),
  nodeId: z.string(),
  attempt: z.number().int().nonnegative().default(0),
  status: NodeStatus,
  leaseId: z.string().optional(),
  modelId: z.string().optional(),
  interactionId: z.string().optional(),
  inputHash: z.string().optional(),
  outputHash: z.string().optional(),
  errorClass: z.string().optional(),
  tokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  startedAt: isoString.optional(),
  completedAt: isoString.optional(),
});

// ── evidence / claims / result packets ───────────────────────────────────
const EvidenceObject = z.object({
  evidenceId: z.string(),
  missionId: z.string(),
  sourceType: z.enum(["web", "file", "api", "dataset", "calculation"]),
  uri: z.string().optional(),
  localPath: z.string().optional(),
  locator: z.object({ page: z.number().optional(), lines: z.tuple([z.number(), z.number()]).optional(), cellRange: z.string().optional() }).partial().optional(),
  capturedAt: isoString,
  publishedAt: isoString.optional(),
  contentHash: z.string(),
  excerpt: z.string().max(4000),
  metadata: z.record(z.string(), z.unknown()).default({}),
  reliability: z.object({ authority: z.number().min(0).max(1), freshness: z.number().min(0).max(1), directness: z.number().min(0).max(1), notes: z.array(z.string()).default([]) }),
});
const Claim = z.object({
  claimId: z.string(),
  text: z.string(),
  class: ClaimClass,
  support: z.array(z.object({ evidenceId: z.string(), entailment: z.number().min(0).max(1), quoteSafe: z.boolean() })).default([]),
  contradicts: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  status: ClaimStatus,
});
const EvidenceRef = z.object({ sourceUri: z.string().optional(), quote: z.string().max(400).optional(), retrievedAt: isoString.optional(), hash: z.string().optional() });
const ResultPacket = z.object({
  schemaVersion: z.literal("eclipse.packet.v1").default("eclipse.packet.v1"),
  packetId: z.string(),
  missionId: z.string(),
  agentSessionId: z.string(),
  blueprint: z.string(),
  claim: z.string(),                    // one-sentence finding
  status: PacketStatus,
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceRef).default([]),
  provenance: z.object({ toolsUsed: z.array(z.string()).default([]), leaseId: z.string().optional(), tokens: z.number().int().nonnegative().default(0) }),
  quarantined: z.boolean().default(true), // until the Prosecutor promotes
  nextActions: z.array(z.string()).optional(),
  cost: z.object({ tokens: z.number().int().nonnegative().default(0), wallclockMs: z.number().int().nonnegative().default(0) }),
});

// ── capability lease / agent blueprint ───────────────────────────────────
const CapabilityLease = z.object({
  schemaVersion: z.literal("eclipse.lease.v1").default("eclipse.lease.v1"),
  leaseId: z.string(),
  missionId: z.string(),
  sessionId: z.string(),
  parentLeaseId: z.string().optional(),
  scopes: z.array(z.string()).default([]),          // e.g. ["web.search","web.fetch"]
  resourceGlobs: z.array(z.string()).default([]),   // e.g. ["https://*","db:read:public.*"]
  maxCalls: z.record(z.string(), z.number().int().nonnegative()).default({}),
  budgetTokens: z.number().int().nonnegative().default(0),
  maxCostUsd: z.number().nonnegative().default(0),
  expiresAt: isoString,
  mayDelegate: z.boolean().default(false),
  sideEffecting: z.boolean().default(false),        // true → requires interrupt() approval
  signature: z.string().optional(),
  revokedAt: isoString.optional(),
});
const AgentBlueprint = z.object({
  schemaVersion: z.literal("eclipse.blueprint.v1").default("eclipse.blueprint.v1"),
  blueprintId: z.string(),
  version: z.string(),
  name: z.string(),
  missionRole: z.string(),
  domainProfile: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).default([]),
  systemInstructionTemplate: z.string(),
  inputSchemaRef: z.string().optional(),
  outputSchemaRef: z.string().optional(),
  toolRequirements: z.array(z.string()).default([]),
  leaseTemplate: z.object({ scopes: z.array(z.string()).default([]), maxCostUsd: z.number().nonnegative().default(0.25), mayDelegate: z.boolean().default(false) }),
  contextPolicy: z.object({ maxTokens: z.number().int().positive().default(40000), memoryClasses: z.array(z.string()).default([]), fileScopes: z.array(z.string()).default([]) }),
  modelRole: z.enum(["router", "main", "reasoning"]).default("main"),
  qualification: z.object({ fixtures: z.array(z.string()).default([]), minScore: z.number().min(0).max(1).default(0.6), status: z.enum(["draft", "qualified", "retired"]).default("draft") }).default({ fixtures: [], minScore: 0.6, status: "draft" }),
});

// ── artifacts ────────────────────────────────────────────────────────────
const ArtifactManifest = z.object({
  schemaVersion: z.literal("eclipse.artifact.v1").default("eclipse.artifact.v1"),
  artifactId: z.string(),
  missionId: z.string(),
  version: z.number().int().nonnegative().default(0),
  kind: z.enum(["markdown", "report", "docx", "pptx", "pdf", "xlsx", "code", "site", "image", "bundle"]),
  path: z.string(),
  mimeType: z.string(),
  sha256: z.string(),
  sizeBytes: z.number().int().nonnegative().default(0),
  sourceClaimIds: z.array(z.string()).default([]),
  sourceEvidenceIds: z.array(z.string()).default([]),
  parentArtifactIds: z.array(z.string()).default([]),
  checks: z.array(z.object({ name: z.string(), status: z.enum(["pass", "fail", "warn"]), receiptId: z.string().optional() })).default([]),
  audience: z.string().optional(),
  styleProfile: z.string().optional(),
  createdAt: isoString,
  jarvisVisibility: z.enum(["private", "room", "global"]).default("private"),
});

// ── context capsule / budget / mission state ─────────────────────────────
const ContextCapsule = z.object({
  schemaVersion: z.literal("eclipse.capsule.v1").default("eclipse.capsule.v1"),
  forNodeId: z.string().optional(),
  contractSlice: z.string(),
  memory: z.array(z.object({ id: z.string(), text: z.string(), reason: z.string(), score: z.number(), tokens: z.number().int().nonnegative().default(0) })).default([]),
  packets: z.array(z.string()).default([]),   // referenced validated packet ids
  openQuestions: z.array(z.string()).default([]),
  tokenLedger: z.object({ used: z.number().int().nonnegative().default(0), budget: z.number().int().nonnegative().default(40000) }),
});
const BudgetLedger = z.object({
  maxCostUsd: z.number().nonnegative(),
  maxTokens: z.number().int().positive(),
  spentUsd: z.number().nonnegative().default(0),
  spentTokens: z.number().int().nonnegative().default(0),
  byNode: z.record(z.string(), z.object({ usd: z.number(), tokens: z.number() })).default({}),
});
const FailureRecord = z.object({ nodeRunId: z.string().optional(), class: z.string(), message: z.string(), at: isoString, recovered: z.boolean().default(false) });
const EclipseState = z.object({
  schemaVersion: z.literal("eclipse.state.v1").default("eclipse.state.v1"),
  mission: MissionSpec,
  phase: Phase.default("intake"),
  intentGenome: IntentGenome.optional(),
  contextCapsule: ContextCapsule.optional(),
  graphPlan: GraphPlan.optional(),
  nodeRuns: z.record(z.string(), NodeRun).default({}),
  evidence: z.array(EvidenceObject).default([]),
  claims: z.array(Claim).default([]),
  resultPackets: z.array(ResultPacket).default([]),
  artifacts: z.array(ArtifactManifest).default([]),
  budget: BudgetLedger,
  failures: z.array(FailureRecord).default([]),
  warnings: z.array(z.string()).default([]),
  revision: z.number().int().nonnegative().default(0),
});

// ── event envelope ───────────────────────────────────────────────────────
const EclipseEventType = z.enum([
  "mission.created", "mission.phase_changed", "mission.completed", "mission.failed",
  "graph.compiled", "node.queued", "node.started", "node.progress", "node.completed", "node.failed",
  "branch.created", "branch.pruned", "agent.spawned", "agent.handoff",
  "tool.started", "tool.completed", "evidence.added", "claim.updated", "verification.updated",
  "artifact.started", "artifact.ready", "budget.updated", "control.required", "context.delta",
]);
const EclipseEvent = z.object({
  schemaVersion: z.literal("eclipse.event.v1").default("eclipse.event.v1"),
  eventId: z.string(),
  sequence: z.number().int().nonnegative(),
  occurredAt: isoString,
  missionId: z.string(),
  graphRunId: z.string().optional(),
  nodeRunId: z.string().optional(),
  type: EclipseEventType,
  payload: z.unknown().default({}),
});

module.exports = {
  Effort, NodeStatus, Phase, Privacy, ClaimClass, ClaimStatus, PacketStatus,
  ArtifactRequest, AcceptanceTest, MissionConstraints, MissionSpec,
  IntentGenome, NodeSpec, GraphPlan, NodeRun,
  EvidenceObject, EvidenceRef, Claim, ResultPacket,
  CapabilityLease, AgentBlueprint, ArtifactManifest,
  ContextCapsule, BudgetLedger, FailureRecord, EclipseState,
  EclipseEventType, EclipseEvent,
};
