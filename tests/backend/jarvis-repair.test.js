const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const { createAgentRepair, classifyIntent } = require("../../server/agent-repair");
const { createToolGateway } = require("../../server/tool-gateway");

const temporaryDirectories = [];

function tempDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    try {
      fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
    } catch {
      // SQLite WAL handles can linger for a moment on Windows test cleanup.
    }
  }
});

function testGateway() {
  const capabilityEngine = {
    definitions: [
      { name: "web_research", description: "Answer current web questions with grounded search.", risk: "observe" },
      { name: "research_v2", description: "Multi-angle public research with citations and verification.", risk: "observe" },
      { name: "kalshi_market_discovery", description: "Find Kalshi markets for games, events, and bets.", risk: "observe" },
      { name: "kalshi_markets", description: "Search Kalshi markets.", risk: "observe" },
      { name: "browser_navigate", description: "Navigate browser.", risk: "prepare" },
      { name: "browser_snapshot", description: "Observe browser page.", risk: "observe" },
      { name: "mesh_status", description: "Read device mesh status.", risk: "observe" },
      { name: "mesh_objects", description: "Read mesh objects.", risk: "observe" },
    ],
    declarations: [
      { name: "web_research", parameters: {} },
      { name: "research_v2", parameters: {} },
      { name: "kalshi_market_discovery", parameters: {} },
      { name: "kalshi_markets", parameters: {} },
      { name: "browser_navigate", parameters: {} },
      { name: "browser_snapshot", parameters: {} },
      { name: "mesh_status", parameters: {} },
      { name: "mesh_objects", parameters: {} },
    ],
  };
  return createToolGateway({
    capabilityEngine,
    moduleRegistry: () => [],
    codeKnowledge: { stats: () => ({ chunks: 0 }) },
  });
}

test("pasted behavior rules update config without tools", () => {
  const repair = createAgentRepair({ runtimeDir: tempDir("jarvis-repair-") });
  const turn = repair.prepareTurn({
    prompt: "You are Jarvis, Devansh's personal desktop assistant. Core rules: Never say done unless verified. Use Kalshi only when I say Kalshi. For every tool task, verify. Do not pretend browser control is web search.",
    capabilityEngine: { definitions: [] },
    providerStatus: {},
  });
  assert.equal(turn.intent, "system_instruction_update");
  assert.ok(turn.behaviorUpdate.response.includes("updated my behavior rules"));
  assert.ok(fs.existsSync(repair.behaviorMdPath));
});

test("FIFA schedule and correction route to sports, not Kalshi", () => {
  const repair = createAgentRepair({ runtimeDir: tempDir("jarvis-repair-") });
  const first = repair.prepareTurn({
    prompt: "check online the next fifa game schedules",
    capabilityEngine: { definitions: [] },
    providerStatus: {},
  });
  assert.equal(first.intent, "sports_schedule");
  assert.ok(first.blockedTools.includes("kalshi_market_discovery"));
  assert.equal(first.topicAfter.activeTopic, "fifa_world_cup");

  const second = repair.prepareTurn({
    prompt: "not Kalshi what FIFA World Cup games are there",
    capabilityEngine: { definitions: [] },
    providerStatus: {},
  });
  assert.equal(second.intent, "sports_schedule");
  assert.ok(second.blockedTools.includes("kalshi_market_discovery"));
  assert.equal(second.topicAfter.activeCompetition, "FIFA World Cup 2026");
});

test("FIFA topic prevents generic results question drifting to MLB", () => {
  const repair = createAgentRepair({ runtimeDir: tempDir("jarvis-repair-") });
  repair.prepareTurn({ prompt: "what fifa games are today", capabilityEngine: { definitions: [] }, providerStatus: {} });
  const followup = repair.prepareTurn({ prompt: "what were the results today", capabilityEngine: { definitions: [] }, providerStatus: {} });
  assert.equal(followup.intent, "sports_results");
  assert.equal(followup.topicAfter.activeTopic, "fifa_world_cup");
});

test("Kalshi is only selected for explicit Kalshi wording", () => {
  assert.equal(classifyIntent("what are the Mexico game odds today", {}).intent, "sports_schedule");
  assert.equal(classifyIntent("get odds from Kalshi for the Mexico game", {}).intent, "kalshi_market");

  const gateway = testGateway();
  const publicSportsTools = gateway.selectTools("what are the Mexico game odds today", { limit: 10 }).map((tool) => tool.name);
  assert.ok(publicSportsTools.includes("research_v2"));
  assert.ok(publicSportsTools.includes("web_research"));
  assert.equal(publicSportsTools.includes("kalshi_market_discovery"), false);

  const kalshiTools = gateway.selectTools("get odds from Kalshi for the Mexico game", { limit: 10 }).map((tool) => tool.name);
  assert.ok(kalshiTools.includes("kalshi_market_discovery"));
});

test("debug traces are private and persisted", () => {
  const repair = createAgentRepair({ runtimeDir: tempDir("jarvis-repair-") });
  const turn = repair.prepareTurn({ prompt: "what fifa games are today", capabilityEngine: { definitions: [] }, providerStatus: {} });
  const saved = repair.recordDebugTrace({
    turn,
    prompt: "what fifa games are today",
    selectedTools: ["web_research"],
    toolResults: [{ tool: "web_research", ok: true, status: "completed" }],
    finalAnswer: "FIFA schedule answer",
  });
  assert.ok(saved.id);
  assert.equal(saved.trace.intent, "sports_schedule");
  assert.deepEqual(saved.trace.blockedTools, ["kalshi_market_discovery", "kalshi_markets"]);
});
