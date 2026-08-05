// Measures the action planner's prompt, section by section, against a realistic page.
//
// Phase 3 of the automation repair. The point is to replace a guess with a number: the planner
// is given PLANNER_ACTION_TIMEOUT_MS (8s) and an "AbortError" is the most common way a task dies
// with no usable reason, so the payload it has to chew through matters. Measuring costs nothing
// and needs no API key — the prompt is built before the request is sent.
//
//   node scripts/measure-planner-payload.mjs
//
// Uses the local chat harness as the page, so the numbers reflect a realistic messaging surface
// (60+ conversation rows, an open thread, a composer) rather than a toy document.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { hintsForOutcome } = await import("../server/automation/entity-resolver.js");

const html = fs.readFileSync("tests/fixtures/chat-harness/index.html");
const server = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "measure-"));
const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: undefined, interactiveLogin: false });

const nameOf = (e) => String(e?.name || "").trim();
const clip = (value, max) => String(value ?? "").slice(0, max);

await browser.navigate({ url, taskId: "m" });
let snapshot = await browser.snapshot({ taskId: "m", limit: 140 });
// Open a thread so the snapshot carries a composer, as it would mid-task.
await browser.click({ taskId: "m", ref: snapshot.elements.find((e) => nameOf(e) === "Tg").ref });
snapshot = await browser.snapshot({ taskId: "m", limit: 140 });

const outcome = { entities: { people: ["tg"] } };
const entityHints = hintsForOutcome(outcome, snapshot);

// Reproduce each section exactly as askPlanner builds it (universal-browser-agent.js:455-480).
const sections = {
  "TEXT (capped 2500)": clip(snapshot.pageText, 2_500),
  "VISIBLE CONTROLS (capped 70)": (snapshot.elements || []).slice(0, 70)
    .map((e) => `${e.ref} | ${e.role || e.tag} | ${JSON.stringify(clip(e.name || e.text || e.placeholder, 160))}`).join("\n"),
  "LIVE WORLD MODEL (uncapped)": JSON.stringify({ url: snapshot.url, title: snapshot.title, visited: [], goals: [] }, null, 2),
  "FACT LEDGER (uncapped)": JSON.stringify([], null, 2),
  "ENTITY HINTS (uncapped)": JSON.stringify(entityHints, null, 2),
  "ROUTE MEMORY (uncapped)": JSON.stringify([], null, 2),
};

const total = Object.values(sections).reduce((sum, part) => sum + part.length, 0);
const rows = Object.entries(sections)
  .map(([name, body]) => ({ name, bytes: body.length, pct: ((body.length / total) * 100).toFixed(1) }))
  .sort((a, b) => b.bytes - a.bytes);

console.log(`\nPlanner payload against a realistic messaging page`);
console.log(`snapshot: ${snapshot.elements.length} elements kept, truncated=${snapshot.truncated}, candidates=${snapshot.elementCandidates}\n`);
for (const row of rows) {
  console.log(`  ${String(row.bytes).padStart(7)} B  ${String(row.pct).padStart(5)}%  ${row.name}`);
}
console.log(`  ${String(total).padStart(7)} B         TOTAL (sections only, excludes the static rule text)\n`);
console.log(`NOTE: this is the VARIABLE portion only. The full prompt measured against the same page`);
console.log(`during a live run is ~11.5 KB — the static rule block is the larger half. Neither number`);
console.log(`explains a timeout: see scripts/benchmark-planner-latency.mjs, where the router answers`);
console.log(`in a 1.6-2.8s band against a 4s budget.\n`);

// Where does entityHints spend its bytes?
const hint = entityHints[0];
if (hint) {
  const candidates = JSON.stringify(hint.candidates || [], null, 2).length;
  const rest = JSON.stringify({ ...hint, candidates: undefined }, null, 2).length;
  console.log(`ENTITY HINTS breakdown for one person:`);
  console.log(`  candidates array : ${candidates} B  (${(hint.candidates || []).length} entries)`);
  console.log(`  everything else  : ${rest} B`);
  console.log(`  → the ranked candidate list is ${((candidates / (candidates + rest)) * 100).toFixed(0)}% of the hint\n`);
}

await browser.close();
server.close();
fs.rmSync(runtimeDir, { recursive: true, force: true });
