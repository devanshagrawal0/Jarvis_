import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNeuralVault } = require("../server/neural-vault");
const { createTaskToSkillFactory } = require("../server/task-to-skill");
const { createMemoryGovernance } = require("../server/memory-governance");

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-governance-"));
const rootDir = process.cwd();
const neuralVault = createNeuralVault({ runtimeDir });
const taskToSkillFactory = createTaskToSkillFactory({ runtimeDir, rootDir, neuralVault });
const memoryGovernance = createMemoryGovernance({ runtimeDir, neuralVault, taskToSkillFactory });

try {
  const task = memoryGovernance.createTempTask({
    title: "Open a website and save a research summary",
    originalUserRequest: "Open example.com, click search, type Jarvis memory, read result, save summary.",
    normalizedTask: "open website search query save summary",
    steps: [
      { index: 0, actionType: "open_url", url: "https://example.com", success: true },
      { index: 1, actionType: "type", text: "Jarvis memory", success: true },
      { index: 2, actionType: "read", success: true },
      { index: 3, actionType: "verify", success: true },
    ],
    websitesUsed: ["https://example.com"],
    toolsUsed: ["browser"],
    finalStatus: "success",
    evidenceSummary: "Fixture browser task completed with reusable evidence.",
  });
  assert.match(task.id, /^temp_task_/);

  const event = memoryGovernance.captureTempEvent({
    eventType: "browser_action",
    taskId: task.id,
    actor: "tool",
    payload: { action: "open_url", url: "https://example.com" },
    relatedUrls: ["https://example.com"],
  });
  assert.equal(event.status, "new");

  const run = memoryGovernance.runWorker({ runType: "manual", scope: "fixture", limit: 10 });
  assert.equal(run.ok, true);
  assert.equal(run.organized.length, 1);
  assert.ok(run.proposals.length >= 1);
  assert.ok(fs.existsSync(run.summaryPath));

  const status = memoryGovernance.status();
  assert.equal(status.counts.tempTasks, 1);
  assert.ok(status.counts.pendingApprovals >= 1);

  const cleanup = memoryGovernance.cleanupStatus();
  assert.equal(cleanup.rawPreserved, true);
  assert.ok(cleanup.organized >= 1);

  const approvals = memoryGovernance.listApprovals();
  const approved = memoryGovernance.decideApproval(approvals[0].id, "approve", "test approval", "test");
  assert.equal(approved.status, "approved");

  console.log(JSON.stringify({
    ok: true,
    runtimeDir,
    taskId: task.id,
    runId: run.id,
    organized: run.organized.length,
    approvals: memoryGovernance.listApprovals().length,
    report: run.summaryPath,
  }, null, 2));
} finally {
  memoryGovernance.close();
  taskToSkillFactory.close();
  neuralVault.close();
}
