import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNeuralVault } = require("../server/neural-vault");
const { createLocalFileAccess } = require("../server/local-file-access");

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-local-file-root-"));
const runtimeDir = path.join(fixtureRoot, "runtime");
fs.mkdirSync(runtimeDir, { recursive: true });
fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# Fixture\n\nJarvis local file access can read and summarize this file.\n", "utf8");
fs.writeFileSync(path.join(fixtureRoot, "notes.txt"), "assignment research task\n", "utf8");
fs.writeFileSync(path.join(fixtureRoot, ".env"), "SECRET=value\n", "utf8");

const neuralVault = createNeuralVault({ runtimeDir });
const files = createLocalFileAccess({ runtimeDir, rootDir: fixtureRoot, neuralVault });

try {
  const found = files.searchFiles("Jarvis");
  assert.ok(found.results.length >= 1);

  const named = files.findFile("readme");
  assert.ok(named.results.some((item) => item.name === "README.md"));

  const listed = files.listFolder(fixtureRoot);
  assert.ok(listed.entries.some((item) => item.name === "README.md"));

  const session = files.openFile(path.join(fixtureRoot, "README.md"));
  assert.equal(session.status, "open");

  const read = files.readFile(path.join(fixtureRoot, "README.md"));
  assert.match(read.content, /Jarvis local file access/);

  const summary = files.summarizeFile(path.join(fixtureRoot, "README.md"));
  assert.match(summary.summary, /README.md/);

  const patch = files.previewPatch(path.join(fixtureRoot, "notes.txt"), "assignment research task\nupdated\n");
  assert.equal(patch.status, "pending_approval");
  assert.throws(() => files.applyPatch(patch.id, { approved: false }));
  const applied = files.applyPatch(patch.id, { approved: true, approvalId: patch.approvalId });
  assert.equal(applied.ok, true);

  const pendingDelete = files.deleteFile(path.join(fixtureRoot, "notes.txt"));
  assert.equal(pendingDelete.status, "pending_approval");

  assert.throws(() => files.readFile(path.join(fixtureRoot, ".env")), /Blocked/);

  const indexed = files.indexFiles({ limit: 20 });
  assert.ok(indexed.indexed >= 1);

  const closed = files.closeFile(session.id);
  assert.equal(closed.status, "closed");

  const status = files.status();
  assert.ok(status.counts.operations >= 8);
  assert.ok(status.counts.registry >= 1);

  console.log(JSON.stringify({ ok: true, fixtureRoot, operations: status.counts.operations, registry: status.counts.registry }, null, 2));
} finally {
  files.close();
  neuralVault.close();
}
