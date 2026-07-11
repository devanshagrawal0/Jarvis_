import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNeuralVault } = require("../server/neural-vault");
const { createTaskToSkillFactory } = require("../server/task-to-skill");

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-task-to-skill-"));
const rootDir = process.cwd();
const neuralVault = createNeuralVault({ runtimeDir });
const factory = createTaskToSkillFactory({ runtimeDir, rootDir, neuralVault });

try {
  const fixtures = [
    {
      id: "browser-fixture",
      title: "Search a website",
      originalUserRequest: "Open a website and search a query.",
      normalizedTask: "open site search query",
      steps: [{ actionType: "open_url", url: "https://example.com" }, { actionType: "type", text: "memory" }, { actionType: "verify" }],
      websitesUsed: ["https://example.com"],
      filesAccessed: [],
    },
    {
      id: "file-fixture",
      title: "Summarize a file",
      originalUserRequest: "Open a PDF file, summarize it, save notes.",
      normalizedTask: "summarize file save notes",
      steps: [{ actionType: "read_text", target: "document" }, { actionType: "create_file", target: "notes" }],
      websitesUsed: [],
      filesAccessed: [path.join(rootDir, "README.md")],
    },
    {
      id: "device-fixture",
      title: "Connect phone and send file",
      originalUserRequest: "Connect phone and send a file to Jarvis.",
      normalizedTask: "connect phone send file",
      steps: [{ actionType: "pair_device" }, { actionType: "send_file" }, { actionType: "verify" }],
      websitesUsed: [],
      filesAccessed: [],
    },
    {
      id: "coding-fixture",
      title: "Run tests and report failure",
      originalUserRequest: "Run tests, read failure, create fix report.",
      normalizedTask: "run tests read failure create report",
      steps: [{ actionType: "run_command", text: "npm test" }, { actionType: "read_text" }, { actionType: "create_file" }],
      websitesUsed: [],
      filesAccessed: [],
    },
  ];

  const candidates = fixtures.map((fixture) => factory.createCandidateFromTask({
    ...fixture,
    projectId: "jarvis",
    toolsUsed: [],
    screenshots: [],
    outputs: [],
    errors: [],
    evidenceSummary: "Fixture evidence",
  }));

  assert.equal(candidates.length, 4);
  assert.equal(candidates[0].domain, "browser");
  assert.equal(candidates[1].domain, "file");
  assert.notEqual(candidates[0].slug, "youtube-test");
  assert.ok(candidates.every((candidate) => candidate.parameters));
  assert.ok(candidates.every((candidate) => fs.existsSync(candidate.files.candidate)));

  const duplicate = factory.createCandidateFromTask({ ...fixtures[0], projectId: "jarvis", steps: fixtures[0].steps });
  assert.equal(duplicate.status, "duplicate_candidate");

  const listed = factory.listCandidates();
  assert.ok(listed.length >= 5);
  const active = factory.decideCandidate(listed[0].id, "approve", "test");
  assert.equal(active.status, "active");

  console.log(JSON.stringify({ ok: true, runtimeDir, candidates: listed.length, duplicate: duplicate.id }, null, 2));
} finally {
  factory.close();
  neuralVault.close();
}
