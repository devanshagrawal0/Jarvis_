// Deterministic fixtures for contract + migration tests (no Gemini, no live DB).
const { nowIso } = require("../../contracts/validate");
const AT = nowIso();

const goodMissionMinimal = {
  schemaVersion: "eclipse.mission.v1",
  missionId: "m_min", userId: "dev",
  prompt: "Research the competitive landscape for AI trading copilots and draft a brief.",
  effort: "totality",
  createdAt: AT,
  // constraints / acceptanceTests / requestedOutputs rely on schema defaults
};

const goodMissionFull = {
  schemaVersion: "eclipse.mission.v1",
  missionId: "m_full", userId: "dev", kind: "eclipse", roomId: "apex",
  prompt: "Compare LangGraph vs CrewAI vs AutoGen for our runtime and recommend one.",
  effort: "deep",
  requestedOutputs: [{ kind: "docx", audience: "engineering", format: "brief" }],
  constraints: { maxCostUsd: 0.75, maxTokens: 300000, allowedPaths: ["docs/"], privacy: "provider" },
  acceptanceTests: [{ id: "t1", description: "Recommendation is evidence-backed", kind: "claim_supported" }],
  createdAt: AT,
};

const badMission = { // missing prompt + wrong schemaVersion → must fail
  schemaVersion: "eclipse.mission.v0", missionId: "m_bad", userId: "dev", effort: "deep", createdAt: AT,
};

const goodPacket = {
  packetId: "p1", missionId: "m_full", agentSessionId: "s1", blueprint: "Worker",
  claim: "LangGraph offers durable checkpoints via SqliteSaver.",
  status: "validated", confidence: 0.82,
  evidence: [{ sourceUri: "https://langgraphjs.guide/persistence/", quote: "SqliteSaver persists checkpoints", retrievedAt: AT }],
  provenance: { toolsUsed: ["web.fetch"], leaseId: "l1", tokens: 1200 },
  quarantined: false,
  cost: { tokens: 1200, wallclockMs: 4200 },
};

const goodEvent = {
  eventId: "e1", sequence: 0, occurredAt: AT, missionId: "m_full",
  type: "mission.created", payload: { prompt: "…" },
};

module.exports = { goodMissionMinimal, goodMissionFull, badMission, goodPacket, goodEvent };
