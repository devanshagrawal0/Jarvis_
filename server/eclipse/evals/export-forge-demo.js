// Run a REAL W5 mission (stub model, fixtures → zero Gemini) and export its full record as JSON
// for the Mission Forge viewer. Usage: node server/eclipse/evals/export-forge-demo.js <outfile>
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { runMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");

const FIXTURES = {
  "https://langchain-ai.github.io/langgraphjs/how-tos/persistence/": { text: "LangGraph.js persists graph state between supersteps with a checkpointer; SqliteSaver stores checkpoints in SQLite so an interrupted run resumes from the last completed step.", reliability: { authority: 0.9, freshness: 0.8, directness: 0.95, notes: ["official docs"] } },
  "https://docs.crewai.com/concepts/memory": { text: "CrewAI provides role-based multi-agent crews and short/long-term memory, but does not offer graph-level durable checkpointing of execution state.", reliability: { authority: 0.75, freshness: 0.7, directness: 0.8, notes: [] } },
  "https://arxiv.org/abs/2308.11432": { text: "Surveys of LLM-agent architectures note that durable, resumable execution and evidence verification are the main gaps between demos and production agent systems.", reliability: { authority: 0.85, freshness: 0.6, directness: 0.7, notes: ["survey"] } },
};

(async () => {
  const out = process.argv[2] || path.join(os.tmpdir(), "forge-demo.json");
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclipse-forge-"));
  const store = openStore({ db: new Database(":memory:") });
  const mission = {
    schemaVersion: "eclipse.mission.v1", missionId: "m_forge_demo", userId: "dev",
    prompt: "Compare LangGraph and CrewAI on durable execution and recommend one for Eclipse.",
    effort: "totality", createdAt: new Date(0).toISOString(),
    constraints: { maxCostUsd: 1.0, maxTokens: 400000, allowedPaths: [], privacy: "provider" },
  };
  const r = await runMission({ mission, store, checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "stub", fixtures: FIXTURES, artifactsDir });
  const es = r.run.evidenceStore;
  const art = r.state.artifacts[0];
  const report = fs.readFileSync(path.join(artifactsDir, mission.missionId, "report.md"), "utf8");
  const bundle = {
    mission, status: r.status, ledger: r.ledger,
    events: store.getEvents(mission.missionId).map((e) => ({ seq: e.sequence, type: e.event_type, payload: e.payload, at: e.occurred_at })),
    evidence: es.getEvidence(mission.missionId),
    claims: es.getClaims(mission.missionId).map((c) => ({ id: c.claim_id, text: c.text, status: c.status, confidence: c.confidence, support: es.getSupport(c.claim_id) })),
    validated: r.state.validated.map((p) => ({ claim: p.claim, confidence: p.confidence, evidence: p.evidence })),
    artifact: { manifest: art, markdown: report },
    trail: r.state.trail,
  };
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  fs.rmSync(artifactsDir, { recursive: true, force: true });
  console.log(`wrote ${out}  (events=${bundle.events.length}, evidence=${bundle.evidence.length}, validated=${bundle.validated.length})`);
})();
