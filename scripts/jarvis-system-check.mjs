import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { classifyIntent, trustedTime } = require("../server/agent-repair");
const { createNeuralVault } = require("../server/neural-vault");
const { createResearchV2, expandResearchQueries, rankSources } = require("../server/research-v2");
const { createCodeKnowledge } = require("../server/code-knowledge");
const { createPcKnowledgeGraph } = require("../server/pc-knowledge-graph");
const { evaluatePersonality, polishPersonality, RESPONSE_STATES, renderOperationalResponse } = require("../server/jarvis-personality");

const jarvisPort = Number(process.env.JARVIS_SYSTEM_TEST_PORT || 8896);
const geminiPort = Number(process.env.JARVIS_SYSTEM_TEST_GEMINI_PORT || 8893);
const baseUrl = `http://127.0.0.1:${jarvisPort}`;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const results = [];
let runtimeDir = "";
let serverProcess = null;
let fakeGemini = null;
let sessionCookie = "";

function pass(name, evidence = "") {
  results.push({ name, status: "pass", evidence });
}

function fail(name, error) {
  results.push({ name, status: "fail", evidence: error?.stack || error?.message || String(error) });
}

async function check(name, fn) {
  try {
    const evidence = await fn();
    pass(name, evidence || "");
  } catch (error) {
    fail(name, error);
  }
}

async function waitFor(url, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startFakeGemini() {
  fakeGemini = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = body ? JSON.parse(body) : {};
    const functionResponses = payload.contents?.flatMap((item) => item.parts || []).filter((part) => part.functionResponse) || [];
    const prompt = payload.contents?.flatMap((item) => item.parts || []).find((part) => part.text)?.text || "";
    response.setHeader("content-type", "application/json");
    if (request.url.includes(":embedContent")) {
      response.end(JSON.stringify({ embeddings: [{ values: Array.from({ length: 16 }, (_, index) => (index + 1) / 100) }] }));
      return;
    }
    if (functionResponses.length) {
      response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Done. I verified the tool result and kept the raw details in debug." }] } }] }));
      return;
    }
    if (/frustrated|fully failing|what do I do/i.test(prompt)) {
      response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "I see the failure. First I would run system check, then inspect the latest debug trace, then fix the exact failing adapter." }] } }] }));
      return;
    }
    response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "At your service. I checked the available context and will keep the answer clean." }] } }] }));
  });
  return new Promise((resolve) => fakeGemini.listen(geminiPort, "127.0.0.1", resolve));
}

async function startJarvis() {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-system-test-"));
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(jarvisPort),
      JARVIS_HOST: "127.0.0.1",
      JARVIS_RUNTIME_DIR: runtimeDir,
      JARVIS_GEMINI_API_BASE_URL: `http://127.0.0.1:${geminiPort}`,
      GEMINI_API_KEY: "test-key",
      GOOGLE_ACCESS_TOKEN: "",
      GOOGLE_REFRESH_TOKEN: "",
      NEWS_API_KEY: "",
      NODE_ENV: "test",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitFor(`${baseUrl}/api/health`);
  const bootstrap = await fetch(`${baseUrl}/api/capabilities`);
  sessionCookie = bootstrap.headers.get("set-cookie")?.split(";")[0] || "";
}

async function stopAll() {
  if (serverProcess && !serverProcess.killed) {
    const exited = new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess.kill();
    await exited.catch(() => {});
  }
  if (fakeGemini) await new Promise((resolve) => fakeGemini.close(resolve));
  if (runtimeDir) fs.rmSync(runtimeDir, { recursive: true, force: true });
}

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { response, body };
}

async function chat(prompt) {
  return api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
}

function tempDir(prefix = "jarvis-module-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

await startFakeGemini();
await startJarvis();

await check("Clean simple chat", async () => {
  const { response, body } = await chat("hi");
  assert.equal(response.status, 200);
  assert.match(body.response, /assist/i);
  assert.doesNotMatch(body.response, /\{|\btoolResults\b|\breceipt\b/);
  return body.response;
});

await check("Date/time", async () => {
  const { body } = await chat("what is today's date and time");
  assert.match(body.response, /Eastern|EST|EDT|2026|Saturday|June/i);
  assert.equal(body.toolResults.length, 0);
});

await check("Pasted behavior prompt", async () => {
  const prompt = "You are Jarvis, Devansh's personal desktop assistant. Core rules: Never say done unless verified. Use Kalshi only when I explicitly ask for Kalshi. For every tool task, verify. Do not pretend browser control is web search.";
  const { body } = await chat(prompt);
  assert.equal(body.intent, "system_instruction_update");
  assert.deepEqual(body.toolResults, []);
});

await check("Raw tool logs blocked", async () => {
  const { body } = await chat("Jarvis system check");
  assert.match(body.response, /Jarvis System Check/);
  assert.doesNotMatch(body.response, /\binputHash\b|\bverification_json\b|\bfunctionResponse\b/);
});

await check("FIFA schedule no Kalshi", () => {
  const routed = classifyIntent("what fifa games are tomorrow");
  assert.equal(routed.intent, "sports_schedule");
  assert.ok(routed.blockedTools.includes("kalshi_markets"));
});

await check("Not Kalshi correction", () => {
  const routed = classifyIntent("not kalshi what fifa world cup games are there");
  assert.equal(routed.intent, "sports_schedule");
  assert.ok(routed.blockedTools.includes("kalshi_market_discovery"));
});

await check("Topic prevents sport drift", () => {
  const routed = classifyIntent("what were the results today", { activeTopic: "fifa_world_cup" });
  assert.equal(routed.intent, "sports_results");
});

await check("Kalshi market route", () => {
  const routed = classifyIntent("find the Mexico Kalshi market");
  assert.equal(routed.intent, "kalshi_market");
});

await check("Boston tomorrow", () => {
  const queries = expandResearchQueries("what is Boston tomorrow", { intent: "local_briefing", time: trustedTime(), limit: 10 });
  assert.ok(queries.some((query) => /weather/i.test(query)));
  assert.ok(queries.some((query) => /events|things to do/i.test(query)));
  assert.ok(queries.some((query) => /traffic|transit/i.test(query)));
});

await check("Current tech news", async () => {
  const research = createResearchV2({
    getSettings: () => ({ geminiKey: "" }),
    webResearch: async ({ query }) => ({ answer: `Evidence for ${query}`, sources: [{ title: "Reuters Tech", url: "https://www.reuters.com/technology/" }] }),
    urlRead: async ({ url }) => ({ title: "Reuters Tech", finalUrl: url, text: "Current technology story evidence.", textLength: 42 }),
  });
  const result = await research.run({ query: "browse current internet and tell me one top tech news story today", intent: "news", maxSearches: 4, readTopSources: 1 });
  assert.ok(result.expandedQueries.length >= 3);
  assert.ok(result.sources.length >= 1);
  assert.ok(result.evidence.confidence > 0);
});

await check("GitHub discovery", async () => {
  const research = createResearchV2({
    getSettings: () => ({ geminiKey: "" }),
    webResearch: async ({ query }) => ({ answer: `GitHub browser agent result for ${query}`, sources: [{ title: "GitHub Repo", url: "https://github.com/browser-use/browser-use" }] }),
    urlRead: async ({ url }) => ({ title: "browser-use", finalUrl: url, text: "Maintained AI browser automation repository.", textLength: 52 }),
  });
  const result = await research.run({ query: "find github repos for AI browser agents", intent: "how_to", maxSearches: 4, readTopSources: 1 });
  assert.ok(result.sources.some((source) => /github\.com/i.test(source.url)));
});

await check("Contradictory sources", () => {
  const ranked = rankSources([
    { title: "Official", url: "https://www.fifa.com/en/tournaments" },
    { title: "Forum", url: "https://reddit.com/r/soccer/example" },
  ], "sports");
  assert.match(ranked[0].url, /fifa\.com/);
});

await check("Remember preference", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.ingestTurn({ userMessage: "remember that I want Jarvis to stop overusing sir", assistantMessage: "Stored." });
  const matches = vault.searchMemories("stop overusing sir");
  assert.ok(matches.length >= 1);
  vault.close();
});

await check("Cross-chat it resolution", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.saveContinuity({ active_topic: "Neural Vault memory system", last_discussed_object: "Neural Vault prompt", likely_next_references: { it: "Neural Vault prompt", this: "current addition" } });
  assert.match(vault.resolveReferences("add this to it").resolvedMessage, /Neural Vault prompt/);
  vault.close();
});

await check("Previous issue resolution", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.saveContinuity({ active_issue: "FIFA routed to Kalshi", last_discussed_object: "FIFA routing issue", likely_next_references: { it: "FIFA routing issue" } });
  assert.match(vault.resolveReferences("it still routes wrong").resolvedMessage, /FIFA routing issue/);
  vault.close();
});

await check("Last artifact retrieval", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.indexArtifact({ title: "Last Memory Prompt", path: "runtime/artifacts/last-memory.md", summary: "Latest memory prompt." });
  const pack = vault.getContextPack("open the file from last time");
  assert.ok(pack.memories.some((item) => /Last Memory Prompt|last-memory/i.test(item.content)));
  vault.close();
});

await check("Low confidence clarification", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.saveContinuity({ active_project: "", active_topic: "", last_discussed_object: "", likely_next_references: {} });
  assert.equal(vault.resolveReferences("fix it").candidates.length, 0);
  vault.close();
});

await check("User correction updates referent", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.ingestTurn({ userMessage: "no I meant the memory system", assistantMessage: "Understood." });
  assert.match(vault.getContinuity().likely_next_references.it || "", /Memory|Jarvis|Neural/i);
  vault.close();
});

await check("API key metadata no secret", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.rememberApiKeyMetadata({ provider: "Gemini", keyLabel: "Gemini API key", envVarName: "GEMINI_API_KEY" });
  assert.equal(vault.listApiKeyMetadata()[0].envVarName, "GEMINI_API_KEY");
  assert.throws(() => vault.rememberApiKeyMetadata({
    provider: "x",
    keyLabel: "bad",
    envVarName: "SAFE_ENV_VAR",
    rawValue: ["AIza", "SyA123456789012345678901234567890123"].join(""),
  }));
  vault.close();
});

await check("Integration health", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.recordIntegrationHealth({ provider: "Gemini", status: "working", affectedTools: ["research_v2"] });
  assert.equal(vault.listIntegrationHealth()[0].provider, "Gemini");
  vault.close();
});

await check("YouTube macro creation", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  const macro = vault.createActionMacro({ name: "Search YouTube", triggerPhrases: ["search YouTube for {query}"], parametersSchema: { query: "string" }, steps: [{ type: "desktop_control", action: "youtube_search_visible", text: "{query}" }] });
  assert.equal(macro.parametersSchema.query, "string");
  vault.close();
});

await check("YouTube macro replay", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  assert.ok(vault.matchActionMacros("search YouTube for linear algebra eigenvalues").length >= 1);
  vault.close();
});

await check("Failed action improves macro", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  const macro = vault.createActionMacro({ name: "Fallback Macro", triggerPhrases: ["do fallback"], steps: [{ type: "ui" }], fallbackSteps: [{ type: "open_url" }] });
  vault.recordActionMacroRun({ macroId: macro.id, status: "failure" });
  vault.recordActionMacroRun({ macroId: macro.id, status: "failure" });
  vault.recordActionMacroRun({ macroId: macro.id, status: "success" });
  assert.equal(vault.listActionMacros().find((item) => item.id === macro.id).steps[0].type, "open_url");
  vault.close();
});

await check("Capability memory prevents fake claims", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.upsertCapabilityMemory({ capabilityName: "background_scheduler", category: "runtime", status: "unavailable", description: "No scheduler." });
  assert.ok(vault.getContextPack("tell me later when this is done").capabilityHealth.some((item) => item.capabilityName === "background_scheduler"));
  vault.close();
});

await check("Index project", async () => {
  const root = tempDir("jarvis-code-index-");
  fs.writeFileSync(path.join(root, "server.js"), "function routeMessage() { return true; }");
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "node_modules", "ignored.js"), "function ignored() {}");
  const code = createCodeKnowledge({ rootDir: root, runtimeDir: tempDir(), getSettings: () => ({}) });
  const index = await code.rebuild({ embeddings: false, force: true });
  assert.equal(index.files, 1);
});

await check("Secret blocking", async () => {
  const root = tempDir("jarvis-secret-index-");
  fs.writeFileSync(path.join(root, "config.js"), "const apiKey = 'abcdefghijklmnopqrstuvwxyz1234567890';");
  const code = createCodeKnowledge({ rootDir: root, runtimeDir: tempDir(), getSettings: () => ({}) });
  await code.rebuild({ embeddings: false, force: true });
  const matches = await code.search("api key", { semantic: false });
  assert.ok(matches.some((item) => /blocked/i.test(item.excerpt)));
  assert.ok(!matches.some((item) => /abcdefghijklmnopqrstuvwxyz1234567890/i.test(item.excerpt)));
});

await check("Source-code query", async () => {
  const root = tempDir("jarvis-router-query-");
  fs.writeFileSync(path.join(root, "router.js"), "function deterministicRouter(prompt) { return prompt; }");
  const code = createCodeKnowledge({ rootDir: root, runtimeDir: tempDir(), getSettings: () => ({}) });
  await code.rebuild({ embeddings: false, force: true });
  const matches = await code.search("where is the router implemented");
  assert.match(matches[0].path, /router\.js/);
});

await check("Memory maintenance", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  vault.upsertMemory({ content: "duplicate memory fact" });
  vault.upsertMemory({ content: "duplicate memory fact" });
  const result = vault.maintenanceRun();
  assert.equal(result.status, "complete");
  assert.ok(fs.existsSync(result.reportPath));
  vault.close();
});

await check("Dedupe", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  for (let index = 0; index < 5; index += 1) vault.upsertMemory({ content: "Jarvis should keep answers clean", kind: "semantic" });
  assert.equal(vault.searchMemories("keep answers clean").length, 1);
  vault.close();
});

await check("Belief revision", () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  const old = vault.upsertMemory({ content: "Jarvis cannot stream screen.", kind: "semantic" });
  vault.upsertMemory({ content: "Jarvis can stream screen through device mesh.", kind: "semantic", supersededBy: old.id });
  const matches = vault.searchMemories("stream screen device mesh");
  assert.ok(matches.some((item) => /can stream/i.test(item.content)));
  vault.close();
});

await check("ChatGPT/Claude-style structure", () => {
  const response = renderOperationalResponse(RESPONSE_STATES.SUCCESS, { result: "I updated the memory layer and verified tests." });
  assert.equal(evaluatePersonality(response).passed, true);
  assert.doesNotMatch(response, /verification_json|runId/);
});

await check("Thorough mode", () => {
  const routed = classifyIntent("be very thorough dont miss anything");
  assert.ok(["memory_write", "general_chat"].includes(routed.intent));
});

await check("Frustrated user style", () => {
  const polished = polishPersonality("I could not complete the request: the browser session expired");
  assert.match(polished, /browser session expired/i);
  assert.doesNotMatch(polished, /as an ai/i);
});

await check("Performance targets", async () => {
  const vault = createNeuralVault({ runtimeDir: tempDir() });
  const startResolve = performance.now();
  vault.resolveReferences("keep improving it");
  const resolveMs = performance.now() - startResolve;
  const startContext = performance.now();
  vault.getContextPack("what do you remember about Jarvis");
  const contextMs = performance.now() - startContext;
  assert.ok(resolveMs < 100, `continuity resolution ${resolveMs}ms`);
  assert.ok(contextMs < 1500, `context pack ${contextMs}ms`);
  vault.close();
  return `continuity ${resolveMs.toFixed(1)}ms, context ${contextMs.toFixed(1)}ms`;
});

await check("System check endpoint", async () => {
  const { body } = await api("/api/jarvis/system-check");
  assert.match(body.text, /Jarvis System Check/);
  assert.equal(body.memory.neuralVault, "online");
});

await check("PC graph secret-safe sample", () => {
  const root = tempDir("jarvis-pc-graph-");
  fs.writeFileSync(path.join(root, "package.json"), "{\"name\":\"fixture\"}");
  fs.writeFileSync(path.join(root, "notes.md"), "access_token = abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN");
  const graph = createPcKnowledgeGraph({ runtimeDir: tempDir(), workspaceRoot: root });
  graph.rebuild({ roots: [root], limit: 20 });
  const result = graph.search({ query: "access token", limit: 5 });
  assert.ok(result.matches.length >= 1);
  assert.ok(JSON.stringify(result).includes("blocked"));
  graph.close();
});

const failed = results.filter((item) => item.status === "fail");
const passed = results.filter((item) => item.status === "pass");
console.log("\nJarvis system verification runner");
console.log(`Passed: ${passed.length}`);
console.log(`Failed: ${failed.length}`);
for (const item of results) {
  const mark = item.status === "pass" ? "PASS" : "FAIL";
  console.log(`${mark} - ${item.name}${item.evidence ? `: ${String(item.evidence).split("\n")[0].slice(0, 180)}` : ""}`);
}

await stopAll();

if (failed.length) {
  process.exitCode = 1;
}
