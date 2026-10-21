// UI FIXTURE — generate REAL event streams into the live store so the console can be verified
// by replay, with zero API cost. Two missions:
//   1. m_uifix_full_*      a complete Wave-2 mission (contract → hires → scouts → follow-up →
//                          verify → answer), produced by the scripted model + fake web.
//   2. m_uifix_preflight_* a mission frozen at the editable-preflight moment, so the panel that
//                          only exists while a mission is RUNNING can be seen at all.
// Cleanup:  node evals/ui-fixture.js --clean
const path = require("path");
const fs = require("fs");
const os = require("os");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { runMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");
const { fakeSearch, fakeFetch, makeLiveCall, mission } = require("./fixtures/scripted-world");

const RUNTIME = path.resolve(__dirname, "../../../runtime");
const PREFIX = "m_uifix_";

function clean() {
  const store = openStore({ dir: RUNTIME });
  const ids = store.db.prepare(`SELECT DISTINCT mission_id FROM eclipse_events WHERE mission_id LIKE ?`).all(PREFIX + "%").map((r) => r.mission_id);
  for (const id of ids) {
    for (const t of ["eclipse_events", "evidence_objects", "claims", "eclipse_task_ledger", "eclipse_progress_ledger", "eclipse_scout_registry", "eclipse_graph_runs", "eclipse_node_runs", "eclipse_receipts"]) {
      try { store.db.prepare(`DELETE FROM ${t} WHERE mission_id=?`).run(id); } catch { /* table may not carry mission_id */ }
    }
  }
  try { store.db.prepare(`DELETE FROM eclipse_semantic_memory WHERE first_mission LIKE ?`).run(PREFIX + "%"); } catch {}
  console.log(`removed ${ids.length} fixture mission(s): ${ids.join(", ") || "(none)"}`);
  store.close();
}

async function generate() {
  const store = openStore({ dir: RUNTIME });
  const stamp = Date.now().toString(36);

  // ── 1. the complete mission ──────────────────────────────────────────────────────────────
  const fullId = `${PREFIX}full_${stamp}`;
  const { liveCall } = makeLiveCall();
  const artifactsDir = path.join(RUNTIME, "eclipse-artifacts");
  const r = await runMission({
    mission: mission(fullId, "UI FIXTURE — national output, reserves and the largest producers (scripted, no API cost)"),
    store, checkpointer: SqliteSaver.fromConnString(path.join(os.tmpdir(), `uifix_${stamp}.sqlite`)),
    mode: "live", liveCall, toolMode: "live", search: fakeSearch, webFetch: fakeFetch, artifactsDir,
  });
  const evs = store.getEvents(fullId);
  const types = new Set(evs.map((e) => e.event_type));
  console.log(`full mission ${fullId}: ${r.status}, ${evs.length} events`);
  for (const need of ["contract.ready", "plan.preflight", "hire", "scout.brief", "scout.search", "scout.read",
    "contract.status", "claim.promoted", "plan.followup", "followup.launch", "mission.complete"]) {
    console.log(`   ${types.has(need) ? "✓" : "✗ MISSING"} ${need}`);
  }

  // ── 2. the preflight moment (the panel only exists while status is 'running') ─────────────
  // Replay the real prefix of the mission above: everything up to and including plan.preflight,
  // with no terminal event — exactly what the console sees during the editable window.
  const pfId = `${PREFIX}preflight_${stamp}`;
  const cut = evs.findIndex((e) => e.event_type === "plan.preflight");
  if (cut < 0) { console.log("no plan.preflight in the generated mission — cannot build the preflight fixture"); store.close(); return; }
  for (const e of evs.slice(0, cut + 1)) {
    const payload = typeof e.payload === "object" ? e.payload : JSON.parse(e.payload_json || "{}");
    store.appendEvent(pfId, e.event_type, payload);
  }
  store.db.prepare(`INSERT OR REPLACE INTO eclipse_graph_runs(graph_run_id,mission_id,graph_version,status,phase,state_revision,started_at)
    VALUES(?,?,?,?,?,?,datetime())`).run(pfId, pfId, "1", "running", "plan", 0);
  console.log(`preflight mission ${pfId}: ${cut + 1} events, frozen at plan.preflight`);

  console.log("\nreopen these in the console (localStorage fleet.history.v1) — replay only, no spend");
  console.log(JSON.stringify({ full: fullId, preflight: pfId }));
  store.close();
}

if (process.argv.includes("--clean")) clean();
else generate().catch((e) => { console.error("FIXTURE FAILED", e.message); process.exit(1); });
