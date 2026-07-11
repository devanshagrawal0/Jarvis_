const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const { createNeuralVault } = require("../../server/neural-vault");

const temporaryDirectories = [];
const vaults = [];

function tempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-neural-vault-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createVault() {
  const vault = createNeuralVault({
    runtimeDir: tempDir(),
    getProviders: () => ({ gemini: { connected: true }, kalshi: { connected: false } }),
    getToolDefinitions: () => [
      { name: "research_v2", risk: "observe" },
      { name: "screen_act", risk: "execute" },
    ],
  });
  vaults.push(vault);
  return vault;
}

afterEach(() => {
  while (vaults.length) vaults.pop().close();
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("Neural Vault creates the memory OS folders, schema, default project, agent, and macro", () => {
  const vault = createVault();
  const status = vault.status();
  assert.equal(status.ok, true);
  assert.ok(fs.existsSync(status.root));
  assert.ok(fs.existsSync(status.dbPath));
  assert.equal(status.counts.projects, 1);
  assert.equal(status.counts.agents, 1);
  assert.equal(status.counts.actionMacros, 1);
});

test("continuity resolves ambiguous follow-ups instead of losing the active subject", () => {
  const vault = createVault();
  vault.saveContinuity({
    active_project: "Jarvis",
    active_topic: "device mesh",
    last_discussed_object: "the phone pairing link",
    likely_next_references: {
      it: "the phone pairing link",
      this: "the device mesh setup",
    },
  }, "turn-1");
  const resolved = vault.resolveReferences("make it valid for 5 minutes", { turnId: "turn-2" });
  assert.match(resolved.resolvedMessage, /phone pairing link/i);
  assert.ok(resolved.confidence >= 0.7);
});

test("context pack retrieves answer style, macros, integration health, and capability memory", () => {
  const vault = createVault();
  vault.recordIntegrationHealth({
    provider: "kalshi",
    status: "missing_credentials",
    affectedTools: ["kalshi_portfolio"],
  });
  vault.upsertCapabilityMemory({
    capabilityName: "background_scheduler",
    category: "runtime",
    status: "unavailable",
    description: "No always-on scheduler is enabled in this local runtime.",
    limitations: ["Server must be running for actions to execute."],
  });
  const pack = vault.getContextPack("make me a codex prompt and tell me what works", { limit: 8 });
  assert.ok(pack.answerFrames.some((frame) => /Codex implementation prompt/i.test(frame.name)));
  assert.ok(pack.actionMacros.some((macro) => /YouTube/i.test(macro.name)));
  assert.ok(pack.integrationHealth.some((item) => item.provider === "kalshi"));
  assert.ok(pack.capabilityHealth.some((item) => item.capabilityName === "background_scheduler"));
  assert.match(pack.contextText, /Neural Vault Context/i);
});

test("API key metadata stores only safe references and rejects raw secrets", () => {
  const vault = createVault();
  const metadata = vault.rememberApiKeyMetadata({
    provider: "gemini",
    keyLabel: "Gemini API key",
    envVarName: "GEMINI_API_KEY",
    status: "configured",
    requiredForTools: ["research_v2"],
  });
  assert.equal(metadata.provider, "gemini");
  assert.equal(metadata.envVarName, "GEMINI_API_KEY");
  assert.equal(vault.listApiKeyMetadata()[0].envVarName, "GEMINI_API_KEY");
  assert.throws(
    () => vault.rememberApiKeyMetadata({
      provider: "x",
      keyLabel: "secret",
      envVarName: "SAFE_ENV_VAR",
      rawValue: ["AIza", "SyA123456789012345678901234567890123"].join(""),
    }),
    /environment variable name|raw secret/i,
  );
});

test("action macros can be created, matched, replay-recorded, and improved after failures", () => {
  const vault = createVault();
  const macro = vault.createActionMacro({
    name: "Open Canvas Assignments",
    slug: "open-canvas-assignments",
    triggerPhrases: ["check assignments", "open Canvas assignments"],
    requiredTools: ["browser_login_handoff", "browser_page_brief"],
    steps: [{ type: "browser_login_handoff", url: "https://northeastern.instructure.com/" }],
    fallbackSteps: [{ type: "open_url", url: "https://northeastern.instructure.com/calendar" }],
  });
  assert.ok(vault.matchActionMacros("please check assignments for me").some((item) => item.id === macro.id));
  vault.recordActionMacroRun({ macroId: macro.id, status: "failure", error: "Login required" });
  vault.recordActionMacroRun({ macroId: macro.id, status: "failure", error: "Selector missing" });
  vault.recordActionMacroRun({ macroId: macro.id, status: "success", verification: ["Calendar opened"] });
  const improved = vault.listActionMacros().find((item) => item.id === macro.id);
  assert.equal(improved.metadata.preferredFallbackAfterFailures, true);
  assert.equal(improved.steps[0].type, "open_url");
});

test("agents, skills, projects, artifacts, and raw events become searchable memory", () => {
  const vault = createVault();
  const agent = vault.registerAgent({
    name: "Kalshi Risk Agent",
    role: "Summarizes portfolio risk in normal English.",
    allowedTools: ["kalshi_portfolio"],
  });
  assert.equal(agent.slug, "kalshi-risk-agent");

  const skill = vault.compileSkill({
    name: "Trading Mode Brief",
    triggerPhrases: ["trading mode"],
    steps: [{ tool: "kalshi_portfolio" }, { tool: "research_v2" }],
  });
  assert.equal(skill.slug, "trading-mode-brief");

  vault.indexArtifact({
    title: "Jarvis Neural Vault Design",
    path: path.join(vault.status().root, "compiled", "design.md"),
    summary: "Memory mesh design for Jarvis continuity.",
  });
  vault.ingestTurn({
    userMessage: "Remember that Jarvis should call me sir.",
    assistantMessage: "Stored, sir.",
    route: { intent: "memory" },
    toolResults: [{ tool: "memory_add", ok: true, result: { stored: true } }],
  });
  const matches = vault.searchMemories("call me sir", { limit: 5 });
  assert.ok(matches.some((item) => /call me sir/i.test(item.content)));
});

test("permission rules protect external sends while allowing runtime reads", () => {
  const vault = createVault();
  assert.equal(vault.checkPermission({ resource: "runtime/neural_vault/db/neural_vault.sqlite", action: "read" }).allowed, true);
  assert.equal(vault.checkPermission({ resource: "runtime/neural_vault/db/neural_vault.sqlite", action: "external_send" }).allowed, false);
});

test("maintenance run archives duplicate memories and writes a report", () => {
  const vault = createVault();
  vault.upsertMemory({ content: "Duplicate operational fact.", kind: "semantic" });
  vault.upsertMemory({ content: "Duplicate operational fact.", kind: "semantic", metadata: { source: "second" } });
  const report = vault.maintenanceRun();
  assert.equal(report.status, "complete");
  assert.ok(fs.existsSync(report.reportPath));
  assert.match(fs.readFileSync(report.reportPath, "utf8"), /Neural Vault Maintenance Report/);
});
