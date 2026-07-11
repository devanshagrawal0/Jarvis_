import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createNeuralVault } = require("../server/neural-vault.js");
const { createAgentRuntime } = require("../server/agent-runtime.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.JARVIS_ACTION_TEST_PORT || 8898);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const results = [];

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function check(name, fn) {
  const start = nowMs();
  try {
    await fn();
    results.push({ name, status: "pass", durationMs: nowMs() - start, notes: "" });
  } catch (error) {
    results.push({ name, status: "fail", durationMs: nowMs() - start, notes: error?.stack || String(error) });
  }
}

function assertNoSecrets(text) {
  assert.doesNotMatch(String(text), /\bAIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{40,}\b/);
}

function findEventFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const out = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile() && entry.name === "events.jsonl") out.push(target);
    }
  }
  return out;
}

async function waitForServer(child) {
  const deadline = Date.now() + 20_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}: ${lastError}`);
}

async function startServer() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  await waitForServer(child);
  return child;
}

async function createSession() {
  const response = await fetch(`${BASE_URL}/api/capabilities`);
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "session cookie missing");
  return cookie;
}

async function chat(cookie, prompt) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ prompt, mode: "main" }),
  });
  assert.equal(response.status, 200, `${prompt} returned ${response.status}`);
  const data = await response.json();
  assert.ok(data.response, `empty response for ${prompt}`);
  assertNoSecrets(data.response);
  return data;
}

function makeRuntimeClassifier() {
  return createAgentRuntime({
    getSettings: () => ({ geminiModel: "test-model" }),
    toolGateway: { catalog: () => ({ tools: [] }), selectTools: () => [] },
    codeKnowledge: { stats: () => ({ files: 0 }) },
    memoryStore: {},
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-actions-memory-"));
const vault = createNeuralVault({
  runtimeDir: tmp,
  getProviders: () => ({ gemini: { connected: true }, kalshi: { connected: true } }),
  getToolDefinitions: () => [{ name: "browser_open" }, { name: "research_v2" }, { name: "kalshi_portfolio" }],
});
const classifier = makeRuntimeClassifier();
let server;
let cookie;
let youtubeMacro;
let youtubeRun;

try {
  server = await startServer();
  cookie = await createSession();

  await check("System status command", async () => {
    const data = await chat(cookie, "Jarvis system check");
    assert.match(data.response, /Jarvis System Check/i);
    assert.match(data.response, /Memory:/i);
  });

  await check("Saved actions list", async () => {
    const data = await chat(cookie, "show saved actions");
    assert.match(data.response, /Saved Actions/i);
    assert.match(data.response, /YouTube/i);
    assert.match(data.response, /Verification:/i);
  });

  await check("Saved skills list", async () => {
    const data = await chat(cookie, "show saved skills");
    assert.match(data.response, /Saved Skills/i);
    assert.match(data.response, /Deep Research/i);
  });

  await check("API metadata without secrets", async () => {
    const metadata = vault.rememberApiKeyMetadata({ provider: "Gemini", envVarName: "GEMINI_API_KEY", scopes: ["model", "grounded_search"] });
    assert.equal(metadata.secretStored, false);
    assert.equal(metadata.envVarName, "GEMINI_API_KEY");
    assert.throws(() => vault.rememberApiKeyMetadata({ provider: "Gemini", envVarName: "GEMINI_API_KEY", rawValue: "FAKE_RAW_SECRET_12345678901234567890" }));
    const data = await chat(cookie, "show integration health");
    assertNoSecrets(data.response);
  });

  await check("YouTube macro exists or is created", async () => {
    youtubeMacro = vault.listActionMacros().find((macro) => macro.slug === "youtube-search");
    assert.ok(youtubeMacro, "youtube-search macro missing");
    assert.equal(youtubeMacro.parametersSchema.query, "string");
    assert.ok(youtubeMacro.fallbackSteps.length, "fallback direct URL missing");
  });

  await check("YouTube macro replay", async () => {
    youtubeRun = vault.recordActionMacroRun({
      macroId: youtubeMacro.id,
      status: "success",
      inputParams: { query: "eigenvalues explained simply" },
      executedSteps: [{ tool: "browser_open", status: "success", summary: "Opened YouTube search results URL" }],
      verification: ["URL contains youtube.com/results", "query appears on page", "results visible"],
      durationMs: 42,
      originalUserMessage: "search YouTube for eigenvalues explained simply",
      resolvedUserMessage: "run YouTube Search action with query='eigenvalues explained simply'",
      requiredTools: ["browser_open", "browser_status"],
      permissionsChecked: ["browser_control"],
      userVisibleSummary: "I opened YouTube search results for eigenvalues explained simply.",
      debugTraceId: "test-debug-trace",
    });
    const run = vault.listActionMacroRuns({ macroId: youtubeMacro.id, limit: 1 })[0];
    assert.equal(run.id, youtubeRun.id);
    assert.equal(run.metadata.memoryWritten, true);
    assert.equal(run.verification.passed, true);
  });

  await check("Action run writes memory", async () => {
    const memories = vault.searchMemories("eigenvalues YouTube action", { limit: 5 });
    assert.ok(memories.some((memory) => memory.sourceType === "action_macro_run"));
    const eventFiles = findEventFiles(path.join(tmp, "neural_vault", "raw", "tool_calls"));
    assert.ok(eventFiles.length, "tool call raw event was not written");
  });

  await check("Failed action improves fallback", async () => {
    const macro = vault.createActionMacro({
      name: "Selector Fallback Test",
      slug: "selector-fallback-test",
      triggerPhrases: ["run selector fallback"],
      steps: [{ type: "ui_selector", selector: "#missing" }],
      fallbackSteps: [{ type: "open_url", url: "https://www.youtube.com/results?search_query={encoded_query}" }],
    });
    vault.recordActionMacroRun({ macroId: macro.id, status: "failure", error: "selector_not_found" });
    vault.recordActionMacroRun({ macroId: macro.id, status: "failure", error: "selector_not_found" });
    vault.recordActionMacroRun({ macroId: macro.id, status: "success", verification: ["fallback URL loaded"] });
    const improved = vault.listActionMacros().find((item) => item.id === macro.id);
    assert.equal(improved.steps[0].type, "open_url");
    assert.equal(improved.metadata.preferredFallbackAfterFailures, true);
  });

  await check("Remote dashboard triggers action", async () => {
    const actions = await fetch(`${BASE_URL}/api/device-mesh/actions`, { headers: { cookie } });
    assert.equal(actions.status, 200);
    const listed = await actions.json();
    const macro = listed.actions.find((item) => item.slug === "youtube-search");
    assert.ok(macro, "remote action list did not include youtube-search");
    const run = await fetch(`${BASE_URL}/api/device-mesh/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: "youtube-search", params: { query: "Tauri React tutorial" } }),
    });
    assert.equal(run.status, 202);
    const body = await run.json();
    assert.equal(body.status, "queued");
    assert.ok(body.run.id);
    assert.ok(body.command.payload.actionRunId);
  });

  await check("Local approval executes remote saved action", async () => {
    const queue = await fetch(`${BASE_URL}/api/device-mesh/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: "youtube-search", params: { query: "Tauri React tutorial" } }),
    });
    assert.equal(queue.status, 202);
    const queued = await queue.json();
    const execute = await fetch(`${BASE_URL}/api/device-mesh/commands/${encodeURIComponent(queued.command.id)}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({}),
    });
    assert.equal(execute.status, 200);
    const executed = await execute.json();
    assert.equal(executed.status, "success");
    assert.equal(executed.command.status, "completed");
    assert.equal(executed.run.id, queued.run.id);
    assert.equal(executed.run.status, "success");
  });

  await check("Memory continuity with action", async () => {
    const resolved = vault.resolveReferences("do it again but for linear algebra matrices", { turnId: "test-action-follow-up" });
    assert.ok(resolved.candidates.some((item) => /YouTube|action/i.test(item.resolvedTo)));
  });

  await check("Memory continuity with artifact", async () => {
    vault.saveContinuity({ ...vault.getContinuity(), active_artifact: "Jarvis report.md", last_discussed_object: "Jarvis report.md" });
    const resolved = vault.resolveReferences("open it", { turnId: "test-artifact-follow-up" });
    assert.ok(resolved.candidates.some((item) => /Jarvis report\.md/i.test(item.resolvedTo)));
  });

  await check("Project/source-code action", async () => {
    const system = await fetch(`${BASE_URL}/api/jarvis/system-check`);
    assert.equal(system.status, 200);
    const body = await system.json();
    assert.ok(body.internals.sourceCodeBrain.files > 0);
  });

  await check("Integration failure memory", async () => {
    vault.recordIntegrationHealth({ provider: "Gemini", status: "rate_limited", error: "test rate limit", affectedTools: ["research_v2"] });
    const health = vault.listIntegrationHealth({ limit: 5 });
    assert.ok(health.some((item) => item.provider === "Gemini" && item.status === "rate_limited"));
  });

  await check("Kalshi route still correct", async () => {
    const portfolio = classifier.classify("check my Kalshi portfolio");
    const fifa = classifier.classify("what fifa games are tomorrow");
    assert.equal(portfolio.intent, "action");
    assert.equal(portfolio.action, true);
    assert.equal(portfolio.personal, true);
    assert.equal(fifa.intent, "fresh-information");
    assert.equal(fifa.fresh, true);
    assert.equal(fifa.marketDiscovery, false);
  });

  await check("Personal answer style", async () => {
    const memories = vault.searchMemories("Codex prompts rules tests final output", { limit: 5 });
    assert.ok(memories.some((memory) => /Codex prompts/i.test(memory.content)));
  });

  await check("Memory maintenance includes actions", async () => {
    const report = vault.maintenanceRun();
    assert.equal(report.status, "complete");
    assert.ok(fs.existsSync(report.reportPath));
  });

  await check("Permission gate", async () => {
    const destructive = vault.createActionMacro({ name: "Delete Downloads Folder", slug: "delete-downloads-folder", triggerPhrases: ["delete downloads"], steps: [{ type: "file_delete", path: "Downloads" }] });
    const response = await fetch(`${BASE_URL}/api/device-mesh/actions/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: destructive.slug, params: {} }),
    });
    assert.ok([403, 404].includes(response.status));
    const kalshi = vault.checkPermission({ resource: "kalshi/trades", action: "external_send" });
    assert.equal(kalshi.allowed, false);
  });

  await check("Debug only when asked", async () => {
    const clean = await chat(cookie, "show action history");
    assert.doesNotMatch(clean.response, /\"tool\"|metadata_json|trace_json/);
    const debug = await chat(cookie, "show storage trace for last action");
    assert.match(debug.response, /Storage Trace/i);
  });

  await check("Simple user-facing wrappers", async () => {
    const data = await chat(cookie, "what can you do now?");
    assert.match(data.response, /approved apps|browser|projects|agents|context/i);
    assert.doesNotMatch(data.response, /action_macro_runs|metadata_json/);
  });

  await check("Performance", async () => {
    const start = nowMs();
    vault.listActionMacros();
    const actionLookupMs = nowMs() - start;
    const cStart = nowMs();
    vault.resolveReferences("do it again");
    const continuityMs = nowMs() - cStart;
    const sStart = nowMs();
    await chat(cookie, "Jarvis system check");
    const systemMs = nowMs() - sStart;
    assert.ok(actionLookupMs < 100, `action lookup ${actionLookupMs}ms`);
    assert.ok(continuityMs < 100, `continuity ${continuityMs}ms`);
    assert.ok(systemMs < 1500, `system check ${systemMs}ms`);
  });

  await check("Storage Test A - action storage trace", async () => {
    const trace = vault.actionStorageTrace({ macroSlug: "youtube-search" });
    assert.equal(trace.lastRun.id, youtubeRun.id);
    assert.ok(trace.storage.rawEventLake);
    assertNoSecrets(JSON.stringify(trace));
  });

  await check("Storage Test B - referent storage trace", async () => {
    vault.recordActionMacroRun({
      macroId: youtubeMacro.id,
      status: "success",
      inputParams: { query: "matrices" },
      executedSteps: [{ tool: "browser_open", status: "success", summary: "Opened YouTube results" }],
      verification: ["YouTube results loaded"],
      userVisibleSummary: "I opened YouTube search results for matrices.",
    });
    const continuity = vault.getContinuity();
    assert.match(continuity.last_action || "", /youtube-search/i);
    assert.match(JSON.stringify(continuity.likely_next_references || {}), /YouTube|action/i);
  });

  await check("Storage Test C - API metadata storage", async () => {
    const trace = vault.actionStorageTrace({ provider: "Gemini" });
    assert.ok(trace.apiKeyMetadata.some((item) => item.envVarName === "GEMINI_API_KEY"));
    assertNoSecrets(JSON.stringify(trace));
  });

  await check("Storage Test D - failed action storage", async () => {
    const health = vault.listIntegrationHealth({ limit: 20 });
    assert.ok(health.some((item) => /selector_not_found|Action did not verify|degraded/i.test(`${item.error} ${item.status}`)));
  });

  await check("Storage Test E - maintenance uses stored action data", async () => {
    const report = vault.maintenanceRun();
    const text = fs.readFileSync(report.reportPath, "utf8");
    assert.match(text, /Active topic|Last discussed object/i);
  });
} finally {
  vault.close();
  if (server && server.exitCode == null) server.kill();
}

const passed = results.filter((item) => item.status === "pass").length;
const failed = results.filter((item) => item.status === "fail").length;
console.log("\nJarvis actions + memory integration runner");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
for (const result of results) {
  console.log(`${result.status.toUpperCase()} - ${result.name} (${result.durationMs}ms)${result.notes ? `\n${result.notes}` : ""}`);
}

if (failed) process.exitCode = 1;
