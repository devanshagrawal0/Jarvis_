import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { openCoreStore, createMemoryMigration } = require("../server/memory-vnext");
const { buildMigrationPolicy } = require("../server/memory-vnext/migration-policy");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(repoRoot, "docs", "memory-vnext", "wave1", "database-inventory.json");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const policy = buildMigrationPolicy(inventory);
const mode = process.argv[2] || "plan";
const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const runtimeDir = path.resolve(process.env.JARVIS_MEMORY_CANDIDATE_ROOT || path.join(localAppData, "Jarvis", "memory-vNext", "candidate-localhost"));

function safePolicy() {
  return { policyVersion: policy.policyVersion, policyHash: policy.policyHash, summary: policy.summary, sources: policy.sources.map(({ snapshotPath, columns, ...source }) => ({ ...source, columnCount: columns.length, snapshotPathHash: crypto.createHash("sha256").update(snapshotPath).digest("hex") })) };
}

if (mode === "plan") {
  process.stdout.write(`${JSON.stringify({ runtimeDir, ...safePolicy() }, null, 2)}\n`);
  process.exit(0);
}

if (mode === "status") {
  const summaryPath = path.join(runtimeDir, "candidate-trial-summary.json");
  process.stdout.write(fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, "utf8") : `${JSON.stringify({ runtimeDir, status: "not_started" }, null, 2)}\n`);
  process.exit(0);
}

if (mode === "reset-partial") {
  if (path.basename(runtimeDir) !== "candidate-localhost" || path.basename(path.dirname(runtimeDir)) !== "memory-vNext") throw new Error("Candidate reset target failed the fixed-path guard.");
  if (fs.existsSync(path.join(runtimeDir, "candidate-trial-summary.json"))) throw new Error("Completed candidate trial cannot be reset by the partial-cleanup command.");
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ runtimeDir, partialCandidateRemoved: !fs.existsSync(runtimeDir) })}\n`);
  process.exit(0);
}

if (mode === "reset-contained") {
  if (process.argv[3] !== "CONFIRM_CONTAINED_CANDIDATE_ONLY") throw new Error("Explicit contained-candidate reset confirmation is required.");
  if (path.basename(runtimeDir) !== "candidate-localhost" || path.basename(path.dirname(runtimeDir)) !== "memory-vNext") throw new Error("Candidate reset target failed the fixed-path guard.");
  const lockPath = path.join(runtimeDir, "core-writer.lock.json"); if (fs.existsSync(lockPath)) { const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")); let alive = false; try { process.kill(Number(lock.pid), 0); alive = true; } catch {} if (alive) throw new Error("Candidate writer is still active; stop it before reset."); fs.unlinkSync(lockPath); }
  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.stdout.write(`${JSON.stringify({ runtimeDir, containedCandidateRemoved: !fs.existsSync(runtimeDir) })}\n`);
  process.exit(0);
}

if (mode !== "import") throw new Error("Usage: memory-vnext-candidate-trial.mjs [plan|import|status|reset-partial|reset-contained]");
if (fs.existsSync(path.join(runtimeDir, "memory-vnext.sqlite"))) throw new Error(`Candidate store already exists at ${runtimeDir}; refusing to overwrite it.`);

fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
const startedAt = new Date();
const store = await openCoreStore({ runtimeDir });
try {
  const migration = createMemoryMigration({ store, allowedSnapshotRoots: [inventory.snapshotRoot] });
  let completedTables = 0;
  const staged = migration.stageClosedSnapshots({
    id: `candidate-import:${startedAt.toISOString()}`,
    inventoryHash: crypto.createHash("sha256").update(fs.readFileSync(inventoryPath)).digest("hex"),
    snapshotSetHash: crypto.createHash("sha256").update(JSON.stringify(inventory.stores.filter((item) => item.status === "snapshotted_verified").map((item) => [item.relativePath, item.snapshotSha256]))).digest("hex"),
    adapterVersion: policy.policyVersion,
    sources: policy.sources,
    batchSize: 250,
    onProgress(progress) {
      completedTables += 1;
      if (completedTables === 1 || completedTables % 10 === 0 || completedTables === policy.sources.length) process.stdout.write(`${JSON.stringify({ phase: "import", completedTables, totalTables: policy.sources.length, source: progress.sourceKey, table: progress.table, action: progress.action, rows: progress.rows })}\n`);
    },
  });
  const batches = [];
  for (const batchType of ["protected", "procedure", "domain_manifest", "scope", "sample"]) {
    const batch = migration.createReviewBatch({ runId: staged.id, batchType, actorId: "local-owner", limit: 1000 });
    if (batch.candidateIds.length) batches.push({ id: batch.id, batchType, count: batch.candidateIds.length });
  }
  const reconciliation = migration.reconcile({ runId: staged.id });
  const view = migration.inspectRun(staged.id);
  const byRecordType = Object.fromEntries([...new Set(view.candidates.map((candidate) => candidate.record_type))].sort().map((recordType) => [recordType, view.candidates.filter((candidate) => candidate.record_type === recordType).length]));
  const byDecision = Object.fromEntries([...new Set(view.candidates.map((candidate) => candidate.decision))].sort().map((decision) => [decision, view.candidates.filter((candidate) => candidate.decision === decision).length]));
  const summary = { schemaVersion: 1, trialType: "contained-localhost", runtimeDir, importRunId: staged.id, policyVersion: policy.policyVersion, policyHash: policy.policyHash, startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), liveAuthorityChanged: false, legacyWrites: 0, providerCalls: 0, policy: policy.summary, import: { status: view.status, expectedRows: view.expected_rows, observedRows: view.observed_rows, stagedRows: view.staged_rows, excludedRows: view.excluded_rows, conflictRows: view.conflict_rows, pendingReviewRows: view.pending_review_rows, candidates: view.candidates.length, equivalences: view.equivalences.length, conflicts: view.conflicts.length, byRecordType, byDecision }, reviewBatches: batches, reconciliation: { passed: reconciliation.passed, pendingReviewRows: reconciliation.pendingReviewRows, conflictRows: reconciliation.conflictRows }, store: store.health() };
  fs.writeFileSync(path.join(runtimeDir, "candidate-trial-policy.json"), `${JSON.stringify(safePolicy(), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(runtimeDir, "candidate-trial-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  process.stdout.write(`${JSON.stringify({ phase: "complete", ...summary }, null, 2)}\n`);
} finally {
  store.close();
}
