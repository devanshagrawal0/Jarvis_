"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");
const { createBrowserAutomationService } = require("../../server/browser-service");
const { createUniversalBrowserAgent } = require("../../server/universal-browser-agent");
const { compileOutcome } = require("../../server/automation/outcome-compiler");
const { createSecretStore } = require("../../server/secret-store");

function byLabel(snapshot, pattern) {
  return snapshot.elements.find((item) => pattern.test(`${item.name || ""} ${item.text || ""}`));
}

function mazePlanner({ objective, snapshot, tabs, history, navigationHints }) {
  const title = snapshot.title;
  const actions = history.map((item) => item.action);
  if (title === "Maze Lobby") {
    const quick = byLabel(snapshot, /Quick launch/i);
    const avoided = navigationHints.some((item) => item.ref === quick?.ref && item.recommendation.startsWith("avoid"));
    if (!avoided && !history.some((item) => item.targetName?.includes("Quick launch"))) {
      return { actions: [{ action: "click", ref: quick.ref, reason: "Try the prominent quick launch route", expected: "Research workspace opens" }], confidence: 0.62 };
    }
    return { actions: [{ action: "click", ref: byLabel(snapshot, /Open research workspace/i).ref, reason: "Use the previously effective semantic workspace route", expected: "Research workspace and reference tabs open" }], confidence: 0.97 };
  }
  if (/Decoy/.test(title)) {
    const workspace = tabs.find((tab) => tab.title === "Research Grid");
    if (!workspace) return { actions: [{ action: "wait", milliseconds: 120, reason: "Wait for the workspace popup", expected: "Research Grid tab appears" }], confidence: 0.8 };
    return { actions: [{ action: "switch_tab", pageId: workspace.pageId, reason: "Ignore reference decoys and switch to the actual research workspace", expected: "Research Grid becomes active" }], confidence: 1 };
  }
  if (title === "Research Grid") {
    const reports = byLabel(snapshot, /^Reports/i);
    const search = byLabel(snapshot, /Search reports/i);
    if (reports && !search) return { actions: [{ action: "click", ref: reports.ref, reason: "Open the reports section", expected: "Report search appears" }], confidence: 1 };
    if (search && search.value !== "Project Orion") return { actions: [{ action: "fill", ref: search.ref, value: "Project Orion", reason: "Search for the exact requested report family", expected: "All Orion candidates become visible" }], confidence: 1 };
    const candidates = snapshot.elements.filter((item) => /Project Orion/i.test(`${item.name || ""} ${item.text || ""}`) && item.ref !== search?.ref);
    if (!candidates.length) return { actions: [{ action: "wait", milliseconds: 140, reason: "Wait for delayed search results", expected: "Orion report candidates appear" }], confidence: 0.95 };
    const qualified = candidates.filter((item) => /Active/i.test(item.name || item.text || "") && /verified/i.test(item.name || item.text || "") && !/Sandbox|Archived/i.test(item.name || item.text || ""));
    if (!/active|verified|current|production|real/i.test(objective) && candidates.length > 1) {
      return { actions: [{ action: "blocked", reason: "Three reports share the requested name and score; active/archived/sandbox status is required", candidates: candidates.map((item) => item.name || item.text) }], confidence: 1 };
    }
    if (qualified.length !== 1) return { actions: [{ action: "blocked", reason: "The report identity remains ambiguous after applying status qualifiers", candidates: candidates.map((item) => item.name || item.text) }], confidence: 1 };
    return { actions: [{ action: "click", ref: qualified[0].ref, reason: "Open the unique active verified Project Orion report, not the same-score archived or sandbox records", expected: "The active Orion report opens in a task-owned tab" }], confidence: 1 };
  }
  if (title === "Orion Active Report") {
    const evidenceTab = byLabel(snapshot, /^Evidence/i);
    const source = byLabel(snapshot, /Open source dataset/i);
    if (!/APX-84-VERIFIED/.test(snapshot.pageText)) return { actions: [{ action: "click", ref: evidenceTab.ref, reason: "Open the evidence panel", expected: "Approval code and source control become visible" }], confidence: 1 };
    if (!history.some((item) => item.action === "extract" && /approval code/i.test(item.reason || ""))) return { actions: [{ action: "extract", selector: "#evidence-panel", reason: "Extract the verified approval code", expected: "Approval code APX-84-VERIFIED is retained" }], confidence: 1 };
    return { actions: [{ action: "click", ref: source.ref, reason: "Open the linked source dataset in its task-owned tab", expected: "Dataset Ledger opens" }], confidence: 1 };
  }
  if (title === "Dataset Ledger") {
    if (!actions.includes("extract") || !history.some((item) => /dataset row count/i.test(item.reason || ""))) return { actions: [{ action: "extract", selector: "main", reason: "Extract the dataset row count and checksum", expected: "420 rows and checksum are retained" }], confidence: 1 };
    return { actions: [{ action: "complete", reason: "The unique active report, approval code, and source dataset facts were all observed" }], result: "Verified Project Orion: approval APX-84-VERIFIED; dataset has 420 rows with checksum ORION-420-Z", confidence: 1 };
  }
  throw new Error(`Maze planner has no route for ${title}`);
}

test("maze-like NLP does not invent people, downloads, or social commits", () => {
  const outcome = compileOutcome("Tell me the result, get evidence, and follow the evidence trail across tabs");
  assert.deepEqual(outcome.entities.people, []);
  assert.equal(outcome.completionContract.requireArtifactIntegrity, false);
  assert.equal(outcome.commit.required, false);
  assert.equal(compileOutcome("Follow its evidence into the source tab").commit.required, false);
  assert.equal(compileOutcome("Follow AJ on Instagram").commit.required, true);
});

test("extreme multi-tab maze learns from a dead end, resolves qualified duplicates, and handles NLP variants", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/maze") return response.end(`<!doctype html><title>Maze Lobby</title><main><h1>Research Nexus</h1><button id="quick">Quick launch</button><button id="workspace">Open research workspace</button></main><script>document.querySelector('#quick').onclick=()=>{};document.querySelector('#workspace').onclick=()=>{window.open('/workspace');window.open('/noise-a');window.open('/noise-b');window.open('/noise-c');window.open('/noise-d')}</script>`);
    if (/^\/noise-/.test(request.url)) return response.end(`<title>Decoy ${request.url.slice(-1).toUpperCase()}</title><main><h1>Reference tab ${request.url.slice(-1)}</h1><p>This is contextual noise, not the requested workspace.</p></main>`);
    if (request.url === "/workspace") return response.end(`<!doctype html><title>Research Grid</title><main><nav><button id="dashboard">Dashboard</button><button id="reports">Reports</button><button id="people">People</button><button id="activity">Activity</button></nav><section id="panel"><p>Choose a workspace section.</p></section></main><script>const panel=document.querySelector('#panel');document.querySelector('#reports').onclick=()=>{panel.innerHTML='<label>Search reports <input id="search" role="searchbox" aria-label="Search reports"></label><div id="results"></div>';document.querySelector('#search').oninput=(event)=>{document.querySelector('#results').innerHTML='<span>Searching multiple indexes…</span>';setTimeout(()=>{document.querySelector('#results').innerHTML='<button>Project Orion — Archived — score 84</button><button id="correct">Project Orion — Active — score 84 — verified</button><button>Project Orion Sandbox — Active — score 84</button>';document.querySelector('#correct').onclick=()=>window.open('/report/current')},80)}};</script>`);
    if (request.url === "/report/current") return response.end(`<!doctype html><title>Orion Active Report</title><main><h1>Project Orion</h1><p>Status Active · score 84 · verified</p><nav><button>Overview</button><button id="evidence">Evidence</button><button>History</button></nav><section id="evidence-panel"></section></main><script>document.querySelector('#evidence').onclick=()=>{document.querySelector('#evidence-panel').innerHTML='<h2>Verified evidence</h2><p>Approval code APX-84-VERIFIED</p><button id="source">Open source dataset</button>';document.querySelector('#source').onclick=()=>window.open('/source-ledger')}</script>`);
    if (request.url === "/source-ledger") return response.end("<title>Dataset Ledger</title><main><h1>Orion source ledger</h1><p>Rows: 420</p><p>Checksum: ORION-420-Z</p><p>Validation: passed</p></main>");
    response.statusCode = 404;
    return response.end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-browser-maze-"));
  const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  });
  const agent = createUniversalBrowserAgent({ browserService: browser, runtimeDir, getSettings: () => ({}), planner: mazePlanner });
  const prompts = [
    "Find the current active verified Project Orion report with score 84, ignore archived and sandbox copies, retrieve its approval code and source row count",
    "Navigate the research maze and get evidence for the verified active Orion 84 result; exclude stale and test records",
    "I need the current Project Orion item—score eighty-four and verified—not archive/sandbox. Return the approval and dataset facts",
    "Search all report results for Orion, disambiguate identical scores using active verified status, then inspect evidence and its source",
    "Locate Orion's production report at 84, follow the evidence trail across tabs, and tell me the code plus row count",
    "Use the real active verified Orion result among duplicates; traverse the workspace tabs and source ledger",
  ];
  const runs = [];
  for (let index = 0; index < prompts.length; index += 1) {
    const events = [];
    const result = await agent.execute(prompts[index], { taskId: `maze-${index + 1}`, startUrl: `${base}/maze`, maxSteps: 24, onStep: (event) => events.push(event) });
    assert.equal(result.success, true, JSON.stringify({ error: result.error, result: result.result, history: result.history?.slice(-10) }));
    assert.match(result.result, /APX-84-VERIFIED/);
    assert.match(result.result, /420/);
    assert.ok(result.world.tabs.length >= 5, "maze should contain many task-owned tabs");
    assert.ok(events.some((event) => event.phase === "learned"));
    runs.push(result);
  }
  assert.ok(runs[0].history.some((item) => /Quick launch/.test(item.targetName || "")), "first run should encounter the dead end");
  assert.ok(runs.slice(1).every((run) => !run.history.some((item) => /Quick launch/.test(item.targetName || ""))), "later runs should avoid the learned dead end");
  assert.ok(agent.navigationMemory.status().successes > 0);
  assert.ok(agent.navigationMemory.status().failures > 0);
  assert.equal(browser.runtimeStatus().tasks.length, 0, "completed tasks should release every task-owned popup/tab");

  if (process.env.JARVIS_LIVE_MAZE === "1") {
    const projectRuntime = path.resolve(process.cwd(), "runtime");
    const publicSettings = (() => { try { return JSON.parse(fs.readFileSync(path.join(projectRuntime, "settings.json"), "utf8")); } catch { return {}; } })();
    const secrets = createSecretStore(projectRuntime).load();
    assert.ok(secrets.geminiKey || process.env.GEMINI_API_KEY, "JARVIS_LIVE_MAZE requires the configured Gemini key");
    const liveAgent = createUniversalBrowserAgent({ browserService: browser, runtimeDir, getSettings: () => ({ ...publicSettings, ...secrets, geminiKey: process.env.GEMINI_API_KEY || secrets.geminiKey }) });
    const liveEvents = [];
    const live = await liveAgent.execute("Inside this unfamiliar research portal, find the one current active verified Project Orion report scoring 84, reject archive and sandbox lookalikes, follow its evidence into the source tab, and return the approval code, row count, and checksum", { taskId: "maze-live-gemini", startUrl: `${base}/maze`, onStep: (event) => liveEvents.push(event) });
    assert.equal(live.success, true, JSON.stringify({ error: live.error, result: live.result, history: live.history?.slice(-12) }));
    assert.equal(live.finalTitle, "Dataset Ledger");
    assert.ok(live.history.filter((item) => item.action === "extract").length >= 2);
    assert.ok(liveEvents.some((event) => event.model && event.model !== "local-semantic-fast-path"));
  }

  const ambiguous = await agent.execute("Open Project Orion score 84 and give me the evidence", { taskId: "maze-ambiguous", startUrl: `${base}/maze`, maxSteps: 18 });
  assert.equal(ambiguous.blocked, true);
  assert.match(ambiguous.error, /share the requested name and score/i);
  assert.equal(ambiguous.candidates.length, 3);
});
