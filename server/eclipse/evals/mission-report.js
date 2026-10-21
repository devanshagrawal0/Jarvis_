// Mission forensics (S1.B5) — dump EVERYTHING about one mission so a failed/odd run diagnoses
// itself. Usage: node evals/mission-report.js [missionId]   (default: the most recent mission)
// Read-only. Prints: timeline, failure hotspots, task+progress ledgers, hires, scout stats,
// dedup, claims by status, evidence dup-check, cost incl. per-request fees, scout log paths.
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const root = path.resolve(__dirname, "../../..");
const db = new Database(path.join(root, "runtime/eclipse.sqlite"), { readonly: true });

const missionId = process.argv[2] || db.prepare(
  "SELECT mission_id FROM eclipse_events ORDER BY rowid DESC LIMIT 1").get()?.mission_id;
if (!missionId) { console.log("no missions found"); process.exit(1); }
console.log("═".repeat(90));
console.log("MISSION REPORT:", missionId);

const events = db.prepare("SELECT sequence, event_type, payload_json, occurred_at FROM eclipse_events WHERE mission_id=? ORDER BY sequence").all(missionId);
const P = (e) => { try { return JSON.parse(e.payload_json || "{}"); } catch { return {}; } };
const of = (t) => events.filter((e) => e.event_type === t);

// ── 1. Failure hotspots FIRST — the "what failed" answer ──
const FAIL_TYPES = ["mission.failed", "mission.crashed", "plan.fallback", "plan.rejected", "plan.schemafail",
  "contract.fallback", "ledger.error", "finalize.error", "coverage.error", "critic.error", "fetch.failed", "tool.deny"];
const fails = events.filter((e) => FAIL_TYPES.includes(e.event_type));
console.log(`\n■ FAILURE HOTSPOTS (${fails.length})`);
if (!fails.length) console.log("  none recorded");
for (const e of fails) console.log(`  [${e.sequence}] ${e.event_type}: ${JSON.stringify(P(e)).slice(0, 220)}`);

// ── 2. Phase timeline w/ durations ──
console.log("\n■ PHASE TIMELINE");
const starts = {};
for (const e of events) {
  const p = P(e);
  if (e.event_type === "node.start") starts[`${p.node}:${e.sequence}`] = { node: p.node, at: e.occurred_at, seq: e.sequence };
}
const nodeEnds = of("node.end");
let lastNodeByName = {};
for (const e of of("node.start")) lastNodeByName[P(e).node] = e;
const pairs = [];
const openStarts = [];
for (const e of events) {
  const p = P(e);
  if (e.event_type === "node.start") openStarts.push({ node: p.node, at: new Date(e.occurred_at).getTime(), seq: e.sequence });
  if (e.event_type === "node.end") {
    const i = openStarts.map((x) => x.node).lastIndexOf(p.node);
    if (i >= 0) { const st = openStarts.splice(i, 1)[0]; pairs.push({ node: p.node, ms: new Date(e.occurred_at).getTime() - st.at, seq: st.seq }); }
  }
}
for (const pr of pairs) console.log(`  ${String(pr.node).padEnd(11)} ${(pr.ms / 1000).toFixed(1)}s`);
for (const st of openStarts) console.log(`  ${String(st.node).padEnd(11)} NEVER ENDED (started seq ${st.seq}) ← check here`);

// ── 3. Conductor: contract + plan + preflight + hires ──
const tl = db.prepare("SELECT * FROM eclipse_task_ledger WHERE mission_id=?").get(missionId);
console.log("\n■ CONDUCTOR");
if (!tl) console.log("  NO task ledger row — contract call failed or legacy path ran");
else {
  const c = JSON.parse(tl.contract_json || "{}");
  console.log(`  contract: ${(c.requirements || []).length} reqs · revision ${tl.revision}`);
  for (const r of c.requirements || []) console.log(`    ${r.reqId} [${r.freshness}] ${String(r.text).slice(0, 90)}`);
  const facts = JSON.parse(tl.facts_json || "[]");
  console.log(`  facts (code-written from promoted claims): ${facts.length}`);
  const g = JSON.parse(tl.guesses_json || "[]");
  if (g.length) console.log(`  guesses: ${g.map((x) => String(x).slice(0, 60)).join(" | ")}`);
}
for (const e of of("plan.preflight")) console.log(`  preflight shown: ${JSON.stringify(P(e).plan?.hires?.map((h) => h.brief?.angle)).slice(0, 160)}`);
for (const e of of("plan.verified")) console.log(`  plan.verified: hires=${P(e).hires}${P(e).edited ? " (edited)" : ""}`);
const hires = of("hire").map(P);
console.log(`  hires: ${hires.length}`);
for (const h of hires) console.log(`    ${h.agentId} · ${String(h.brief?.angle).slice(0, 50)} · owns ${(h.brief?.reqIds || []).join(",")} · $${h.budget?.usdCap} ${h.budget?.searches}s/${h.budget?.reads}r`);
for (const e of of("plan.followup")) console.log(`  FOLLOW-UP on ${P(e).reqId}: ${String(P(e).objective).slice(0, 80)}`);
for (const e of of("plan.reflection")) console.log(`  REFLECTION: ${P(e).lesson}`);

// ── 4. Scouts: per-scout stats from events + log files ──
console.log("\n■ SCOUTS");
const briefs = of("scout.brief").map(P);
for (const b of briefs) {
  const sid = b.scoutId;
  const searches = of("scout.search").filter((e) => P(e).scoutId === sid).length;
  const reads = of("scout.read").filter((e) => P(e).scoutId === sid);
  const claims = reads.reduce((a, e) => a + (Number(P(e).claims) || 0), 0);
  const kb = of("scout.kb").filter((e) => P(e).scoutId === sid).length;
  const conflicts = of("scout.conflict").filter((e) => P(e).scoutId === sid).length;
  console.log(`  ${sid.slice(0, 20)} · ${String(b.angle).slice(0, 45)} · ${searches} searches, ${reads.length} reads, ${claims} claims, kb:${kb}, conflicts:${conflicts}`);
}
const logDir = path.join(root, "runtime/eclipse-artifacts", missionId, "scouts");
if (fs.existsSync(logDir)) for (const f of fs.readdirSync(logDir)) {
  const st = fs.statSync(path.join(logDir, f));
  console.log(`  log: ${path.join(logDir, f)} (${st.size}b)`);
} else console.log("  no scout logs on disk");

// ── 5. Verification: dedup, claims, coverage ──
console.log("\n■ VERIFICATION");
for (const e of of("packet.deduped")) console.log(`  deduped: ${P(e).count} — ${JSON.stringify(P(e).pairs).slice(0, 160)}`);
const promoted = of("claim.promoted").length, rejected = of("claim.rejected").length;
console.log(`  promoted ${promoted} · rejected ${rejected}`);
for (const e of of("claim.rejected").slice(0, 8)) console.log(`    ✗ ${String(P(e).claim).slice(0, 80)} — ${String(P(e).reason).slice(0, 90)}`);
for (const e of of("contract.status")) console.log(`  ${P(e).reqId}: ${P(e).status}`);
const dbClaims = db.prepare("SELECT status, count(*) n FROM claims WHERE mission_id=? GROUP BY status").all(missionId);
console.log(`  claims table: ${dbClaims.map((r) => `${r.status}:${r.n}`).join("  ") || "empty"}`);

// ── 6. Evidence + dup ratio ──
const ev = db.prepare("SELECT count(*) n, count(DISTINCT content_hash) h, count(DISTINCT uri) u FROM evidence_objects WHERE mission_id=?").get(missionId);
console.log(`\n■ EVIDENCE: ${ev.n} rows · ${ev.u} uris · ${ev.h} distinct hashes${ev.n !== ev.h ? "  ← DUPES present" : ""}`);
for (const e of of("evidence.reused")) console.log(`  reused: ${P(e).uri}`);

// ── 7. Cost + fees + progress ledger ──
const run = db.prepare("SELECT tokens, cost_usd, status, phase FROM eclipse_graph_runs WHERE mission_id=? ORDER BY rowid DESC LIMIT 1").get(missionId);
console.log(`\n■ COST/STATE: status=${run?.status} phase=${run?.phase} tokens=${run?.tokens} cost=$${run?.cost_usd}`);
const feeSearches = of("scout.search").length + events.filter((e) => e.event_type === "tool.grant" && P(e).tool === "web.search").length;
console.log(`  web.search grants (fee events at ~$0.035 each apply to live searches)`);
const pl = db.prepare("SELECT seq, trigger, progress, stall_count FROM eclipse_progress_ledger WHERE mission_id=? ORDER BY seq").all(missionId);
for (const r of pl) console.log(`  progress[${r.seq}] ${r.trigger}: ${r.progress} verified, stall=${r.stall_count}`);

// ── 8. Full timeline (compact) ──
console.log(`\n■ FULL TIMELINE (${events.length} events)`);
for (const e of events) console.log(`  ${String(e.sequence).padStart(3)} ${e.event_type.padEnd(20)} ${JSON.stringify(P(e)).slice(0, 130)}`);
console.log("═".repeat(90));
