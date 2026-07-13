// ECLIPSE orchestrator — builds the durable mission graph, runs it with a LangGraph
// SqliteSaver checkpointer, mirrors each run into eclipse.sqlite, and supports
// resume (from checkpoint) + cooperative cancel/pause. Nodes are small + idempotent so a
// crash between supersteps resumes with no duplicate side effects (the W3 gate).
const path = require("path");
const { StateGraph, START, END } = require("@langchain/langgraph");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { EclipseGraphState } = require("./state");
const { createNodes } = require("./nodes");
const { openStore } = require("./store");
const { createAdapter } = require("../model/adapter");
const { createLedger } = require("../model/cost-ledger");
const { issueRootLease } = require("../capabilities/lease");
const { createGateway } = require("../capabilities/tool-gateway");
const { createToolbox } = require("../tools");
const { createEvidenceStore } = require("../evidence/store");
const { validate, MissionSpec } = require("../contracts");

function buildApp(nodes, checkpointer) {
  const g = new StateGraph(EclipseGraphState)
    .addNode("intake", nodes.intake)
    .addNode("contract", nodes.contract)
    .addNode("context", nodes.context)
    .addNode("plan", nodes.plan)
    .addNode("worker", nodes.worker)
    .addNode("critic", nodes.critic)
    .addNode("verify", nodes.verify)      // Evidence Prosecutor (promotion authority)
    .addNode("repair", nodes.repair)      // Recovery Engineer
    .addNode("synthesize", nodes.synthesize)
    .addNode("artifact", nodes.artifact)
    .addNode("commit", nodes.commit)
    .addEdge(START, "intake")
    .addEdge("intake", "contract")
    .addEdge("contract", "context")
    .addEdge("context", "plan")
    .addConditionalEdges("plan", nodes.fanOut, ["worker"])  // Send fan-out
    .addEdge("worker", "critic")           // superstep barrier: all workers finish → critic
    .addEdge("critic", "verify")
    .addConditionalEdges("verify", nodes.afterVerify, { synthesize: "synthesize", repair: "repair" })
    .addEdge("repair", "verify")
    .addEdge("synthesize", "artifact")
    .addEdge("artifact", "commit")
    .addEdge("commit", END);
  return g.compile({ checkpointer });
}

// Build the shared pieces of a run (store, ledger, adapter, checkpointer). Reused by resume.
function makeRun(opts) {
  const {
    mission, dir = ".", mode = "stub", stubResponder, liveCall,
    store: injectedStore, db, checkpointConn,
  } = opts;
  const store = injectedStore || openStore({ dir, db });
  const ledger = opts.ledger || createLedger(mission.constraints || {});
  const adapter = createAdapter({ mode, ledger, stubResponder, liveCall, sleep: opts.sleep });
  const conn = checkpointConn || path.join(dir, "eclipse-checkpoints.sqlite");
  const checkpointer = opts.checkpointer || SqliteSaver.fromConnString(conn);
  const graphRunId = mission.missionId;
  const rootLease = opts.rootLease || issueRootLease(mission, "root");   // mission authority ceiling
  const gateway = opts.gateway || createGateway({ store });              // enforces every tool call
  // W5: real tools + evidence store activate when fixtures/corpus/live are supplied. Absent →
  // W4 stub behavior (backward-compatible). evidenceStore is cheap; only used in W5 mode.
  const evidenceStore = createEvidenceStore(store.db);
  const wantsTools = opts.toolbox || opts.fixtures || opts.corpus || opts.toolMode === "live" || opts.search || opts.webFetch;
  const toolbox = opts.toolbox || (wantsTools ? createToolbox({ mode: opts.toolMode || "fixture", fixtures: opts.fixtures || {}, corpus: opts.corpus || [], webFetch: opts.webFetch, search: opts.search }) : null);
  const artifactsDir = opts.artifactsDir || path.join(dir, "eclipse-artifacts");
  return { store, ledger, adapter, checkpointer, graphRunId, conn, rootLease, gateway, evidenceStore, toolbox, artifactsDir };
}

function buildNodesAndApp(run, mission, control) {
  const nodes = createNodes({
    adapter: run.adapter, store: run.store, ledger: run.ledger,
    missionId: mission.missionId, graphRunId: run.graphRunId,
    rootLease: run.rootLease, gateway: run.gateway,
    toolbox: run.toolbox, evidenceStore: run.evidenceStore, artifactsDir: run.artifactsDir, live: run.adapter.mode === "live",
    faults: control.faults || {}, sideEffectSink: control.sideEffectSink || null,
    cancelAt: control.cancelAt || null, pauseAt: control.pauseAt || null,
    maxRepairs: control.maxRepairs ?? 1,
  });
  return buildApp(nodes, run.checkpointer);
}

async function execute(app, input, cfg, run, mission) {
  try {
    const state = await app.invoke(input, cfg);
    run.store.setStatus(run.graphRunId, "complete", state.phase);
    const snap = run.ledger.snapshot();
    run.store.mirrorCheckpoint(run.graphRunId, { phase: state.phase, tokens: snap.tokens, costUsd: snap.costUsd, revision: state.revision });
    // Mission-lifecycle terminal event (owned by the orchestrator, not a node) → always last.
    run.store.appendEvent(mission.missionId, "mission.complete", { tokens: snap.tokens, costUsd: snap.costUsd, phase: state.phase });
    return { graphRunId: run.graphRunId, status: "complete", state, ledger: snap, run, cfg, mission };
  } catch (err) {
    if (err && err.eclipseControl) {
      const status = err.eclipseControl === "pause" ? "paused" : "cancelled";
      run.store.setStatus(run.graphRunId, status, null);
      return { graphRunId: run.graphRunId, status, atNode: err.atNode, run, cfg, mission, resumable: status === "paused" };
    }
    if (err && (err.code === "ECLIPSE_BUDGET")) {
      run.store.setStatus(run.graphRunId, "failed", null);
      run.store.appendEvent(mission.missionId, "mission.failed", { reason: "budget", detail: err.detail });
      return { graphRunId: run.graphRunId, status: "failed", reason: "budget", error: err.message, run, cfg, mission };
    }
    // Genuine crash (e.g. injected fault) — leave checkpoint intact for resume, rethrow tagged.
    run.store.setStatus(run.graphRunId, "failed", null);
    run.store.appendEvent(mission.missionId, "mission.crashed", { error: String(err && err.message) });
    err.graphRunId = run.graphRunId; err.run = run; err.cfg = cfg; err.mission = mission;
    throw err;
  }
}

// runMission — validate, set up, run to completion (or control-stop / crash).
async function runMission(opts) {
  const mission = validate(MissionSpec, opts.mission, "mission");
  const run = makeRun({ ...opts, mission });
  run.store.upsertRun({ graph_run_id: run.graphRunId, mission_id: mission.missionId, status: "running", phase: "intake" });
  run.store.appendEvent(mission.missionId, "mission.created", { prompt: mission.prompt, effort: mission.effort });
  const cfg = { configurable: { thread_id: run.graphRunId }, recursionLimit: opts.recursionLimit || 50 };
  const app = buildNodesAndApp(run, mission, opts);
  return execute(app, mission.__initialState || defaultInitialState(mission), cfg, run, mission);
}

// resume — continue a paused/crashed run from its last checkpoint. Reuses the SAME store/
// ledger/checkpointer so :memory: works and the ledger keeps accumulating. Control flags
// (faults/pauseAt) are cleared unless overridden.
async function resumeMission(prev, control = {}) {
  const { run, cfg, mission } = prev;
  const app = buildNodesAndApp(run, mission, control);
  return execute(app, null, cfg, run, mission); // null input → resume from checkpoint
}

function defaultInitialState(mission) {
  return { mission, effort: mission.effort || "deep", phase: "intake" };
}

// Cooperative controls that persist to the store (durable across restart).
function requestCancel(store, graphRunId) { store.requestCancel(graphRunId); }

module.exports = { runMission, resumeMission, buildApp, requestCancel, defaultInitialState };
