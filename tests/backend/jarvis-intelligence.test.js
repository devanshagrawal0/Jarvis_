const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const { createAgentRuntime } = require("../../server/agent-runtime");
const { createCodeKnowledge } = require("../../server/code-knowledge");
const { createMemoryStore } = require("../../server/memory-store");
const { createToolGateway } = require("../../server/tool-gateway");
const { createAgentRepair } = require("../../server/agent-repair");
const { evaluatePersonality, personalityInstruction } = require("../../server/jarvis-personality");

const temporaryDirectories = [];

function tempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("personality contract rejects generic AI language", () => {
  assert.match(personalityInstruction(), /calm, precise/i);
  const weak = evaluatePersonality("As an AI, I don't have feelings. I hope this helps.");
  assert.equal(weak.passed, false);
  assert.ok(weak.issues.length >= 2);
  assert.equal(evaluatePersonality("Done, sir. The project is open.").passed, true);
});

test("layered memory extracts personal facts and operating procedures", () => {
  const runtime = tempDir("jarvis-memory-layers-");
  const memory = createMemoryStore(runtime);
  memory.ingestTurn({
    userText: "I prefer concise answers. From now on, never repeat the same status twice.",
    assistantText: "Understood.",
    source: "test-session",
  });
  const profile = memory.profile();
  assert.ok(profile.semantic.some((item) => /prefer concise/i.test(item.text)));
  assert.ok(profile.procedural.some((item) => /never repeat/i.test(item.text)));
  assert.match(memory.getWorking("test-session").lastTurn.user, /concise answers/i);
  memory.close();
});

test("agent repair persists and retrieves debug traces by turn id", () => {
  const runtime = tempDir("jarvis-agent-repair-");
  const repair = createAgentRepair({ runtimeDir: runtime });
  const turn = repair.prepareTurn({
    prompt: "what FIFA games are there today",
    capabilityEngine: { definitions: [{ name: "research_v2" }, { name: "kalshi_markets" }] },
    providerStatus: {},
  });
  repair.recordDebugTrace({
    turn,
    prompt: "what FIFA games are there today",
    selectedTools: ["research_v2"],
    toolResults: [{ tool: "research_v2", ok: true, status: "completed" }],
    finalAnswer: "Verified sports schedule answer.",
  });
  const trace = repair.getDebugTrace(turn.turnId);
  assert.equal(trace.turnId, turn.turnId);
  assert.equal(trace.intent, "sports_schedule");
  assert.ok(trace.blockedTools.includes("kalshi_markets"));
  assert.equal(repair.listDebugTraces(1).length, 1);
  repair.close();
});

test("code knowledge indexes symbols and retrieves implementation evidence", async () => {
  const root = tempDir("jarvis-code-root-");
  const runtime = tempDir("jarvis-code-runtime-");
  fs.writeFileSync(path.join(root, "brain.js"), `
    function selectThinkingModel(intent) {
      return intent === "complex" ? "pro" : "flash";
    }
    module.exports = { selectThinkingModel };
  `);
  const knowledge = createCodeKnowledge({ rootDir: root, runtimeDir: runtime, getSettings: () => ({ geminiKey: "" }) });
  await knowledge.rebuild({ embeddings: false });
  const matches = await knowledge.search("Where is the thinking model selected?", { semantic: false });
  assert.equal(matches[0].path, "brain.js");
  assert.ok(matches[0].symbols.includes("selectThinkingModel"));
  assert.equal(knowledge.stats().files, 1);
});

test("MCP gateway dynamically selects only relevant tools", () => {
  const capabilityEngine = {
    definitions: [
      { name: "open_app", description: "Open an application.", risk: "execute" },
      { name: "weather_forecast", description: "Read a weather forecast.", risk: "observe" },
      { name: "research_v2", description: "Multi-angle public research with citations and verification.", risk: "observe" },
      { name: "web_research", description: "Answer current web questions with grounded search.", risk: "observe" },
      { name: "web_research_deep", description: "Deep source-backed public research with evidence.", risk: "observe" },
      { name: "url_read", description: "Read and extract clean text from a public URL.", risk: "observe" },
      { name: "compose_artifact", description: "Create verified reports, briefings, documents, and artifacts.", risk: "prepare" },
      { name: "artifact_status", description: "Inspect verified artifact status.", risk: "observe" },
      { name: "codebase_search", description: "Search Jarvis source code.", risk: "observe" },
      { name: "jarvis_self_inspect", description: "Inspect Jarvis architecture.", risk: "observe" },
      { name: "memory_search", description: "Search memory.", risk: "observe" },
      { name: "system_status", description: "Read system status.", risk: "observe" },
      { name: "canvas_assignments", description: "Read Canvas assignments.", risk: "observe" },
      { name: "canvas_courses", description: "Read Canvas courses.", risk: "observe" },
      { name: "canvas_browser_assignments", description: "Open Canvas assignments in browser.", risk: "observe" },
      { name: "browser_navigate", description: "Navigate browser.", risk: "prepare" },
      { name: "browser_snapshot", description: "Observe browser page.", risk: "observe" },
      { name: "screen_capture", description: "Capture the laptop primary display for visual analysis.", risk: "observe" },
      { name: "screen_inspect", description: "Inspect visible laptop screen controls.", risk: "observe" },
      { name: "screen_act", description: "Observe, locate, click, type, press, or fullscreen on the visible laptop screen.", risk: "execute" },
      { name: "youtube_open_video", description: "Search YouTube and open the first matching video on the visible laptop browser.", risk: "execute" },
      { name: "desktop_control", description: "Control visible laptop desktop, full screen, tabs, clicks, and hotkeys.", risk: "execute" },
      { name: "kalshi_market_discovery", description: "Find Kalshi markets for games, events, and bets.", risk: "observe" },
      { name: "kalshi_markets", description: "Search Kalshi markets.", risk: "observe" },
      { name: "kalshi_portfolio", description: "Read Kalshi portfolio.", risk: "observe" },
      { name: "kalshi_positions", description: "Read Kalshi positions.", risk: "observe" },
      { name: "kalshi_fills", description: "Read Kalshi fills.", risk: "observe" },
      { name: "kalshi_balance", description: "Read Kalshi balance.", risk: "observe" },
      { name: "mesh_status", description: "Read OmniPresence device mesh status, links, objects, and commands.", risk: "observe" },
      { name: "mesh_objects", description: "Read device mesh object portal uploads and notes.", risk: "observe" },
      { name: "mesh_pair_link", description: "Create a one-time phone or iPad pair link.", risk: "prepare" },
      { name: "mesh_send_command", description: "Send a command card to a paired device.", risk: "prepare" },
    ],
    declarations: [
      { name: "open_app", parameters: {} },
      { name: "weather_forecast", parameters: {} },
      { name: "research_v2", parameters: {} },
      { name: "web_research", parameters: {} },
      { name: "web_research_deep", parameters: {} },
      { name: "url_read", parameters: {} },
      { name: "compose_artifact", parameters: {} },
      { name: "artifact_status", parameters: {} },
      { name: "codebase_search", parameters: {} },
      { name: "jarvis_self_inspect", parameters: {} },
      { name: "memory_search", parameters: {} },
      { name: "system_status", parameters: {} },
      { name: "canvas_assignments", parameters: {} },
      { name: "canvas_courses", parameters: {} },
      { name: "canvas_browser_assignments", parameters: {} },
      { name: "browser_navigate", parameters: {} },
      { name: "browser_snapshot", parameters: {} },
      { name: "screen_capture", parameters: {} },
      { name: "screen_inspect", parameters: {} },
      { name: "screen_act", parameters: {} },
      { name: "youtube_open_video", parameters: {} },
      { name: "desktop_control", parameters: {} },
      { name: "kalshi_market_discovery", parameters: {} },
      { name: "kalshi_markets", parameters: {} },
      { name: "kalshi_portfolio", parameters: {} },
      { name: "kalshi_positions", parameters: {} },
      { name: "kalshi_fills", parameters: {} },
      { name: "kalshi_balance", parameters: {} },
      { name: "mesh_status", parameters: {} },
      { name: "mesh_objects", parameters: {} },
      { name: "mesh_pair_link", parameters: {} },
      { name: "mesh_send_command", parameters: {} },
    ],
  };
  const gateway = createToolGateway({
    capabilityEngine,
    moduleRegistry: () => [],
    codeKnowledge: { stats: () => ({ chunks: 2 }) },
  });
  const selected = gateway.selectTools("Explain which source file controls the server architecture", { limit: 5 });
  assert.ok(selected.some((tool) => tool.name === "codebase_search"));
  assert.ok(selected.some((tool) => tool.name === "jarvis_self_inspect"));
  assert.ok(selected.length <= 5);
  assert.equal(selected.some((tool) => tool.name === "weather_forecast"), false);
  const assignmentTools = gateway.selectTools("Check my Canvas assignments", { limit: 10 });
  assert.ok(assignmentTools.some((tool) => tool.name === "canvas_assignments"));
  assert.ok(assignmentTools.some((tool) => tool.name === "canvas_browser_assignments"));
  const desktopTools = gateway.selectTools("open youtube on my laptop full screen and switch tabs", { limit: 10 });
  assert.ok(desktopTools.some((tool) => tool.name === "desktop_control"));
  const videoTools = gateway.selectTools("open the YouTube video titled last to miss penalty", { limit: 10 });
  assert.ok(videoTools.some((tool) => tool.name === "screen_act"));
  const visibleTools = gateway.selectTools("click the first video on my screen and make it full screen", { limit: 10 });
  assert.ok(visibleTools.some((tool) => tool.name === "screen_act"));
  const followUpSearchTools = gateway.selectTools("ok search sidemen in it current laptop screen screen_act", { limit: 10 });
  assert.ok(followUpSearchTools.some((tool) => tool.name === "screen_act"));
  assert.ok(followUpSearchTools.some((tool) => tool.name === "desktop_control"));
  const screenTools = gateway.selectTools("whats on my laptop screen", { limit: 5 });
  assert.ok(screenTools.some((tool) => tool.name === "screen_capture"));
  assert.equal(screenTools.some((tool) => tool.name === "pc_graph_search"), false);
  const recentTools = gateway.selectTools("who won the most recent NBA finals", { limit: 10 });
  assert.ok(recentTools.some((tool) => tool.name === "research_v2"));
  assert.ok(recentTools.some((tool) => tool.name === "web_research"));
  const deepTools = gateway.selectTools("deep research report with citations on AI search agents", { limit: 10 });
  assert.ok(deepTools.some((tool) => tool.name === "research_v2"));
  assert.ok(deepTools.some((tool) => tool.name === "web_research_deep"));
  assert.ok(deepTools.some((tool) => tool.name === "compose_artifact"));
  const portfolioTools = gateway.selectTools("what is my Kalshi portfolio summary", { limit: 10 });
  assert.ok(portfolioTools.some((tool) => tool.name === "kalshi_portfolio"));
  assert.equal(portfolioTools.some((tool) => tool.name === "kalshi_market_discovery"), false);
  const marketTools = gateway.selectTools("find the current Mexico game on Kalshi", { limit: 10 });
  assert.ok(marketTools.some((tool) => tool.name === "kalshi_market_discovery"));
  const fifaScheduleTools = gateway.selectTools("what FIFA World Cup games are there today", { limit: 10 });
  assert.ok(fifaScheduleTools.some((tool) => tool.name === "research_v2"));
  assert.ok(fifaScheduleTools.some((tool) => tool.name === "web_research"));
  assert.equal(fifaScheduleTools.some((tool) => tool.name === "kalshi_market_discovery"), false);
  const meshTools = gateway.selectTools("read mesh_status and show my Cloudflare phone link", { limit: 10 });
  assert.ok(meshTools.some((tool) => tool.name === "mesh_status"));
  assert.ok(meshTools.some((tool) => tool.name === "mesh_objects"));
  const pairTools = gateway.selectTools("connect my phone to the device mesh", { limit: 10 });
  assert.ok(pairTools.some((tool) => tool.name === "mesh_pair_link"));
  assert.equal(gateway.catalog().protocol, "MCP");
});

test("agent runtime routes deep research and artifact creation to high-thinking action work", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiReasoningModel: "gemini-3.1-pro-preview" }),
    toolGateway: {
      selectTools: () => [{ name: "web_research_deep" }, { name: "compose_artifact" }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({
    prompt: "Create a source-backed research briefing on fast AI search systems with citations.",
    history: [],
  });
  assert.equal(prepared.route.action, true);
  assert.equal(prepared.route.fresh, true);
  assert.equal(prepared.route.workComposer, true);
  assert.equal(prepared.route.deepResearch, true);
  assert.equal(prepared.route.complexity, "deep");
  assert.equal(prepared.model, "gemini-3.1-pro-preview");
  assert.ok(prepared.selectedTools.some((tool) => tool.name === "compose_artifact"));
});

test("agent runtime routes code questions to deep self-knowledge", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({
      geminiModel: "gemini-2.5-flash",
      geminiReasoningModel: "gemini-3.1-pro-preview",
    }),
    toolGateway: {
      selectTools: () => [{ name: "codebase_search" }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: {
      search: async () => [{ path: "server.js", startLine: 10, endLine: 20, excerpt: "function callGemini() {}" }],
      inspect: () => ({ activeRuntime: { frontendEntry: "src/main.tsx", currentShell: "src/SimpleApp.tsx" } }),
      stats: () => ({ chunks: 1 }),
    },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({
    prompt: "Explain how your code chooses a model and where that function lives.",
    history: [],
  });
  assert.equal(prepared.route.intent, "self-knowledge");
  assert.equal(prepared.route.complexity, "deep");
  assert.equal(prepared.model, "gemini-3.1-pro-preview");
  assert.equal(prepared.codeContext[0].path, "server.js");
});

test("natural Kalshi portfolio questions route to authenticated portfolio tools", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiFastModel: "gemini-3.1-flash-lite" }),
    toolGateway: {
      selectTools: () => [{ name: "kalshi_portfolio" }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({ prompt: "What was my latest Kalshi bet?", history: [] });
  assert.equal(prepared.route.action, true);
  assert.equal(prepared.route.intent, "action");
  assert.equal(prepared.route.marketDiscovery, false);
  assert.equal(prepared.selectedTools[0].name, "kalshi_portfolio");
});

test("market and game requests route to Kalshi discovery instead of exact search", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiFastModel: "gemini-3.1-flash-lite" }),
    toolGateway: {
      selectTools: () => [{ name: "kalshi_market_discovery" }, { name: "kalshi_markets" }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({ prompt: "Find the current Mexico game on Kalshi", history: [] });
  assert.equal(prepared.route.action, true);
  assert.equal(prepared.route.fresh, true);
  assert.equal(prepared.route.marketDiscovery, true);
  assert.equal(prepared.selectedTools[0].name, "kalshi_market_discovery");
});

test("public FIFA schedule requests route to web research, not Kalshi discovery", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiFastModel: "gemini-3.1-flash-lite" }),
    toolGateway: {
      selectTools: () => [{ name: "web_research" }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({ prompt: "What FIFA World Cup games are there today?", history: [] });
  assert.equal(prepared.route.action, false);
  assert.equal(prepared.route.fresh, true);
  assert.equal(prepared.route.marketDiscovery, false);
  assert.ok(prepared.selectedTools.some((tool) => tool.name === "web_research"));
});

test("device mesh questions expose mesh tools to Jarvis", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiFastModel: "gemini-3.1-flash-lite" }),
    toolGateway: {
      selectTools: (prompt) => String(prompt).includes("mesh_status")
        ? [{ name: "mesh_status" }, { name: "mesh_objects" }, { name: "mesh_send_command" }]
        : [],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({ prompt: "Read mesh_status and tell me my Cloudflare phone link.", history: [] });
  assert.equal(prepared.route.action, true);
  assert.equal(prepared.route.deviceMesh, true);
  assert.ok(prepared.selectedTools.some((tool) => tool.name === "mesh_status"));
});

test("screen action follow-ups after YouTube context route to laptop control tools", async () => {
  let gatewayPrompt = "";
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiFastModel: "gemini-3.1-flash-lite" }),
    toolGateway: {
      selectTools: (prompt) => {
        gatewayPrompt = prompt;
        return [{ name: "screen_act" }, { name: "screen_capture" }, { name: "desktop_control" }];
      },
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({
    prompt: "ok search sidemen in it",
    history: [
      { role: "user", text: "can you see the search bar for youtube" },
      { role: "model", text: "Yes, sir, the YouTube search bar is visible near the top center of the page." },
    ],
  });
  assert.equal(prepared.route.action, true);
  assert.equal(prepared.route.screenFollowUp, true);
  assert.match(gatewayPrompt, /current laptop screen/);
  assert.ok(prepared.selectedTools.some((tool) => tool.name === "screen_act"));
  assert.ok(prepared.selectedTools.some((tool) => tool.name === "desktop_control"));
});
