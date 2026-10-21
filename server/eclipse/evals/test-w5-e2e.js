// P1·W5 GATE — verified, cited artifact end-to-end. Run: node server/eclipse/evals/test-w5-e2e.js
// Real tools (fixtures) → real EvidenceObjects → citation re-verify → promotion gate → validated
// Claims persisted → a REAL cited report.md on disk with a matching sha256. Zero Gemini.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { runMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");

let pass = 0;
const okA = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

const FIXTURES = {
  "https://a.example/langgraph": { text: "LangGraph provides durable checkpoints via SqliteSaver, enabling crash recovery across process restarts.", reliability: { authority: 0.85, freshness: 0.7, directness: 0.9, notes: [] } },
  "https://b.example/crewai": { text: "CrewAI offers role-based multi-agent orchestration with a simpler API but weaker durability guarantees.", reliability: { authority: 0.7, freshness: 0.6, directness: 0.8, notes: [] } },
};

// The verify rebuild made promotion MODEL-judged (claim -> atoms -> sentence-ID entailment), so the
// text-only default stub can no longer validate anything: this gate scripts contract-shaped JSON
// derived ONLY from each call's input. The judge stays FAILABLE - an atom whose content words do not
// appear in the numbered source gets NOT_ENOUGH_INFO, so a fabricated claim still dies here.
function makeScriptedStub(fixtures) {
  const urls = Object.keys(fixtures);
  return (call) => {
    const inp = String(call.input || "");
    if (inp.includes('Return JSON {"action"')) {
      // Worker step: search once, fetch each fixture url, then final (forceFinalize builds the packet).
      if (!inp.includes('web.search "')) return { json: { action: "web.search", args: { query: "durability comparison" } } };
      const unfetched = urls.find((u) => !inp.includes(`) ${u}`)); // gathered sources render as "(web) url"
      if (unfetched && !inp.includes("This is your FINAL step")) return { json: { action: "web.fetch", args: { url: unfetched } } };
      return { json: { action: "final", claim: "", supports: [] } };
    }
    if (inp.startsWith("Subtask:") && inp.includes("Gathered sources:")) {
      // Grounded finalize: claim the first fixture's first sentence, cite S1 with a verbatim quote.
      const first = String(fixtures[urls[0]].text).split(". ")[0] + ".";
      return { json: { claim: first, supports: [{ sourceId: "S1", quote: first }] } };
    }
    if (inp.includes("ATOMIC CLAIMS:") && inp.includes("SOURCE (numbered sentences):")) {
      // Entailment judge: lexical overlap against the numbered doc - deterministic AND failable.
      const doc = inp.split("SOURCE (numbered sentences):")[1].split("ATOMIC CLAIMS (repeated):")[0];
      const sents = doc.split("\n").map((l) => l.match(/^\[S(\d+)\]\s+(.*)$/)).filter(Boolean);
      const atoms = inp.split("ATOMIC CLAIMS:")[1].split("SOURCE (numbered sentences):")[0]
        .split("\n").map((l) => l.match(/^(\d+)\.\s+(.*)$/)).filter(Boolean);
      const words = (t) => new Set(String(t).toLowerCase().match(/[a-z]{4,}/g) || []);
      const verdicts = atoms.map((a) => {
        const aw = words(a[2]);
        const hit = sents.find((sl) => { const sw = words(sl[2]); let n = 0; for (const w of aw) if (sw.has(w)) n++; return n >= Math.min(3, aw.size); });
        return hit ? { atom_id: Number(a[1]), verdict: "SUPPORTED", evidence_sentence_ids: [Number(hit[1])], confidence: 0.9 }
                   : { atom_id: Number(a[1]), verdict: "NOT_ENOUGH_INFO", evidence_sentence_ids: [], confidence: 0.3 };
      });
      return { json: { verdicts } };
    }
    return { text: "[stub:default]" };
  };
}
const scripted = makeScriptedStub(FIXTURES);

let mc = 0;
function mission(effort = "deep") { return { schemaVersion: "eclipse.mission.v1", missionId: `m_w5_${++mc}`, userId: "dev", prompt: "Compare LangGraph vs CrewAI on durability and recommend one.", effort, createdAt: new Date(0).toISOString() }; }

(async () => {
  console.log("ECLIPSE P1·W5 — verified cited artifact (gate)");
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eclipse-w5-"));

  await okA("Deep mission → real evidence → validated claims → cited report on disk", async () => {
    const shared = { store: openStore({ db: new Database(":memory:") }), checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "stub", stubResponder: scripted, fixtures: FIXTURES, artifactsDir };
    const m = mission("deep");
    const r = await runMission({ mission: m, ...shared });
    assert.equal(r.status, "complete");
    assert.ok(r.state.validated.length >= 1, "≥1 validated claim");

    // real evidence + claims persisted to eclipse.sqlite
    const es = r.run.evidenceStore;
    assert.ok(es.getEvidence(m.missionId).length >= 1, "evidence_objects persisted");
    const claims = es.getClaims(m.missionId);
    assert.ok(claims.length >= 1 && claims.every((c) => c.status === "supported"), "claims promoted (supported) + persisted");
    // claim ↔ evidence edges exist
    assert.ok(es.getSupport(claims[0].claim_id).length >= 1, "claim linked to evidence");

    // the artifact is a REAL file with a matching hash
    const art = r.state.artifacts[0];
    const file = path.join(artifactsDir, m.missionId, "report.md");
    assert.ok(fs.existsSync(file), "report.md written to disk");
    const md = fs.readFileSync(file, "utf8");
    assert.ok(md.includes("## Findings") && md.includes("## Sources"), "report has findings + sources");
    assert.ok(/\[1\]/.test(md), "findings carry citation markers");
    assert.ok(md.includes(m.prompt), "report states the mission");
    const sha = crypto.createHash("sha256").update(md).digest("hex");
    assert.equal(art.sha256, sha, "manifest sha256 matches file content");
    assert.ok(art.sourceEvidenceIds.length >= 1, "artifact traces to evidence");
  });

  await okA("no fabrication — every finding line is cited; no tool denied", async () => {
    const shared = { store: openStore({ db: new Database(":memory:") }), checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "stub", stubResponder: scripted, fixtures: FIXTURES, artifactsDir };
    const m = mission("deep");
    const r = await runMission({ mission: m, ...shared });
    const md = fs.readFileSync(path.join(artifactsDir, m.missionId, "report.md"), "utf8");
    const findingLines = md.split("\n").filter((l) => l.startsWith("- **"));
    assert.ok(findingLines.length >= 1);
    assert.ok(findingLines.every((l) => /\[\d+\]/.test(l)), "every asserted finding is cited");
    const types = r.run.store.getEvents(m.missionId).map((e) => e.event_type);
    assert.ok(types.includes("evidence.captured") && types.includes("claim.promoted") && types.includes("artifact.written"));
    assert.ok(!types.includes("tool.deny"), "no agent exceeded its lease");
  });

  await okA("watchable timeline — ordered events reconstruct the whole mission", async () => {
    const shared = { store: openStore({ db: new Database(":memory:") }), checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "stub", stubResponder: scripted, fixtures: FIXTURES, artifactsDir };
    const m = mission("deep");
    await runMission({ mission: m, ...shared });
    const evs = shared.store.getEvents(m.missionId);
    for (let i = 0; i < evs.length; i++) assert.equal(evs[i].sequence, i);
    assert.equal(evs[0].event_type, "mission.created");
    assert.equal(evs[evs.length - 1].event_type, "mission.complete");
  });

  try { fs.rmSync(artifactsDir, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
