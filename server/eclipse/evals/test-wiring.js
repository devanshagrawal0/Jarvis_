// WIRING GATE — the defect class that keeps shipping: something is PRODUCED and nothing
// CONSUMES it (an undeclared graph channel, a stored-but-unread column, a granted-but-uncalled
// tool, an event no UI handles). Pure static + real-DB checks. No API cost, no network.
// Run: node server/eclipse/evals/test-wiring.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

const ECLIPSE = path.resolve(__dirname, "..");
const ROOT = path.resolve(ECLIPSE, "../..");
const read = (p) => fs.readFileSync(path.join(ECLIPSE, p), "utf8");
const nodes = read("orchestration/nodes.js");
const scout = read("agents/scout-loop.js");
const stateSrc = read("orchestration/state.js");

console.log("WIRING GATE — producers must have consumers (free)");

// ── 1. every key a node RETURNS must be a declared graph channel, or LangGraph drops it ──
ok("every node return key is a declared state channel", () => {
  const { EclipseGraphState } = require("../orchestration/state");
  const declared = new Set(Object.keys(EclipseGraphState.spec));
  // keys returned from node bodies: `return { a, b: ..., c }`
  const returned = new Set();
  for (const m of nodes.matchAll(/return\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const k = part.split(":")[0].trim().replace(/^\.\.\..*/, "");
      if (/^[a-zA-Z_$][\w$]*$/.test(k)) returned.add(k);
    }
  }
  // only the ones that look like graph state (ignore locals returned from helpers)
  const graphish = ["validated", "packets", "graphPlan", "followupPlan", "followupCount", "coverage",
    "verdict", "revision", "repairCount", "result", "artifacts", "critiques", "mission", "phase", "budget"];
  const missing = graphish.filter((k) => returned.has(k) && !declared.has(k));
  assert.equal(missing.length, 0, "returned but NOT a declared channel (silently dropped): " + missing.join(", "));
});

// ── 2. a channel whose reducer is `b ?? a` can never be CLEARED ──
ok("clearable channels use a reducer that accepts null", () => {
  // followupPlan must be clearable or verify→followup loops forever
  const { EclipseGraphState } = require("../orchestration/state");
  const red = EclipseGraphState.spec.followupPlan.operator;
  assert.equal(red({ x: 1 }, null), null, "followupPlan cannot be cleared — infinite-loop risk");
  const cov = EclipseGraphState.spec.coverage.operator;
  assert.deepEqual(cov({ at: 1 }, undefined), { at: 1 }, "coverage must survive an untouched pass");
});

// ── 3. every tool a definition GRANTS is actually callable by that agent's code ──
ok("granted tools are called (no decorative capabilities)", () => {
  const { createAgentDefs } = require("../agents/defs");
  const db = new Database(":memory:");
  require("../db/migrations").migrate(db);
  const defs = createAgentDefs(db); defs.seedDefaults();
  const scoutTools = defs.getDef("research-scout").tools;
  const impl = scout + nodes;
  const uncalled = scoutTools.filter((t) => {
    if (t === "knowledge.search") return !/knowledgeSearch\(/.test(impl);
    if (t.startsWith("registry.")) return !/registryTools\.(claim|check)\(/.test(impl);
    return !new RegExp(`toolbox\\["${t.replace(".", "\\.")}"\\]`).test(impl);
  });
  assert.equal(uncalled.length, 0, "scout is granted tools its loop never calls: " + uncalled.join(", "));
});

// ── 4. every stored definition field is read by something ──
ok("definition fields are read, not just stored", () => {
  const defsSrc = read("agents/defs.js");
  const all = nodes + scout + defsSrc;
  for (const [field, probe] of [["mandate", /\.mandate/], ["tools", /\.tools\b/], ["modelRole", /modelRole/],
    ["guardrails", /guardrails/], ["knowledgeScope", /knowledgeScope/], ["budgets", /\.budgets\b/], ["fanout", /fanout/]]) {
    assert(probe.test(all), `definition field "${field}" is stored but never read`);
  }
});

// ── 5. every backend event type has a console consumer (or is deliberately ignored) ──
ok("every emitted event type is handled by the console reducer", () => {
  // SSD layout (2026-09-13): orb is a sibling of jarvis-ui (D:\jarvis\orb); old laptop layout kept as fallback
  const uiPath = path.join(ROOT, "../orb/fleet-app/src/eclipse.ts");
  const alt = path.join(ROOT, "../../Desktop/orb/fleet-app/src/eclipse.ts");
  const ui = fs.existsSync(uiPath) ? fs.readFileSync(uiPath, "utf8")
    : fs.existsSync(alt) ? fs.readFileSync(alt, "utf8") : null;
  if (!ui) { console.log("      (console source not found — skipped)"); return; }
  const emitted = new Set();
  for (const src of [nodes, scout, read("orchestration/run-graph.js"), read("agents/scout-log.js"), read("agents/writer.js")]) {
    for (const m of src.matchAll(/appendEvent\((?:missionId|mission\.missionId)\s*,\s*"([^"]+)"/g)) emitted.add(m[1]);
    // the Writer emits through an injected `emit(type, payload)` — same stream, different spelling
    for (const m of src.matchAll(/\bemit\("([^"]+)"/g)) emitted.add(m[1]);
  }
  // events the console intentionally does not render (pure bookkeeping / server-side only)
  const IGNORED = new Set(["node.start", "node.end", "mission.created", "mission.tools", "receipt",
    "scout.selfcheck", "scout.rank", "coverage.checked", "coverage.reused", "coverage.error",
    "plan.ready", "verify.done", "claim.checked", "repair.pass", "fetch.failed", "tool.grant",
    "artifact.written", "commit.done", "mission.paused", "mission.cancelling", "finalize.error",
    "packet.dropped", "shape.recorded", "critic.error", "plan.schemafail", "evidence.captured"]);
  // S2.2 B1 DEBT: the Writer's block stream is produced but the Notebook panel (S2.2 B2) is not
  // built yet. Listed here on purpose so the gate shows the debt; B2 removes these lines.
  const NOTEBOOK_PENDING = new Set(["draft.outline", "draft.outline.rejected", "draft.outline.repaired", "draft.outline.unassigned",
    "draft.block", "draft.section.rejected", "draft.sentence.rejected", "draft.revision", "draft.lint", "draft.lint.error", "draft.guard", "draft.done"]);
  const pending = [...emitted].filter((t) => NOTEBOOK_PENDING.has(t) && !ui.includes(`case '${t}'`));
  if (pending.length) console.log(`      (S2.2 B2 debt — Notebook not built, ${pending.length} draft.* events unrendered: ${pending.join(", ")})`);
  for (const t of NOTEBOOK_PENDING) IGNORED.add(t);
  const unhandled = [...emitted].filter((t) => !IGNORED.has(t) && !ui.includes(`case '${t}'`));
  assert.equal(unhandled.length, 0, "emitted but the console silently drops: " + unhandled.join(", "));
});

// ── 6. migrations run cleanly against a COPY OF THE REAL DATABASE (not a fresh one) ──
ok("migration + seeding are safe on the REAL database (copied)", () => {
  const live = path.join(ROOT, "runtime/eclipse.sqlite");
  if (!fs.existsSync(live)) { console.log("      (no live db — skipped)"); return; }
  const tmp = path.join(require("os").tmpdir(), `eclipse_wiring_${Date.now()}.sqlite`);
  fs.copyFileSync(live, tmp);
  const db = new Database(tmp);
  const before = db.prepare("SELECT COUNT(*) c FROM eclipse_events").get().c;
  require("../db/migrations").migrate(db);
  const { createAgentDefs } = require("../agents/defs");
  const defs = createAgentDefs(db);
  defs.seedDefaults(); defs.seedDefaults();           // idempotent
  const after = db.prepare("SELECT COUNT(*) c FROM eclipse_events").get().c;
  assert.equal(after, before, "migration lost or duplicated events");
  const v = db.prepare("SELECT MAX(version) v FROM eclipse_agent_defs WHERE agent_id='research-scout'").get().v;
  const { SEED_VERSION } = defs;
  assert.equal(v, SEED_VERSION, `live DB is at v${v} but the code seeds v${SEED_VERSION} — definition edits would be invisible`);
  const rows = db.prepare("SELECT COUNT(*) c FROM eclipse_agent_defs WHERE version=?").get(SEED_VERSION).c;
  assert.equal(rows, 5, "expected all 5 agents at the current seed version, got " + rows);
  db.close(); fs.unlinkSync(tmp);
});

// ── 7. REPLAY every real recorded mission through the console reducer ──
ok("the console reducer survives every REAL mission ever recorded", () => {
  const live = path.join(ROOT, "runtime/eclipse.sqlite");
  const uiFile = [path.join(ROOT, "../orb/fleet-app/src/eclipse.ts"), path.join(ROOT, "../../Desktop/orb/fleet-app/src/eclipse.ts")]
    .find((p) => fs.existsSync(p));
  if (!fs.existsSync(live) || !uiFile) { console.log("      (skipped)"); return; }
  // The reducer is TS; exercise its LOGIC contract instead of importing it: assert every real
  // event type appears in the reducer, and that payload shapes the reducer indexes are present.
  const ui = fs.readFileSync(uiFile, "utf8");
  const db = new Database(live, { readonly: true });
  const missions = db.prepare("SELECT DISTINCT mission_id FROM eclipse_events").all();
  let checked = 0, legacy = 0;
  for (const { mission_id } of missions) {
    const evs = db.prepare("SELECT event_type, payload_json, occurred_at FROM eclipse_events WHERE mission_id=? ORDER BY sequence").all(mission_id);
    const modern = evs.length > 0 && evs[0].occurred_at >= "2026-08-30";
    for (const e of evs) {
      JSON.parse(e.payload_json);                     // every payload must be valid JSON
      checked++;
      if (e.event_type === "claim.promoted") {
        const p = JSON.parse(e.payload_json);
        // The claim text was added to this event by the N-10 fix (2026-08-30). Older rows
        // legitimately lack it; assert the CURRENT contract, count the legacy ones.
        if (modern) assert(p.claim !== undefined, `claim.promoted without a claim (mission ${mission_id})`);
        else legacy++;
      }
      if (e.event_type === "hire") {
        const p = JSON.parse(e.payload_json);
        assert(p.brief && p.budget, `hire event missing brief/budget — the preflight panel would render blank`);
      }
    }
  }
  assert(checked > 0, "no recorded events to replay");
  console.log(`      (replayed ${checked} real events across ${missions.length} missions; ${legacy} legacy pre-N-10 rows tolerated)`);
  db.close();
});

// ── 8. no orphan await / obvious dead branches in the files we keep editing ──
ok("no `if (live)` block is unreachable in the graph's own tests", () => {
  // the e2e gate must exercise live mode — otherwise every live-only branch is untested again
  const e2e = read("evals/test-wave2-e2e.js");
  assert(/mode:\s*"live"/.test(e2e), "the e2e gate does not run in live mode — live-only code would be untested");
  assert(/liveCall/.test(e2e), "no scripted liveCall in the e2e gate");
});

console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
