// Measures how long the action planner actually takes, against its own timeout budgets.
//
// The open question from the payload measurement: the prompt is only ~4.4 KB and hard-capped, so
// size is not what kills these runs. That leaves latency. PLANNER_ROUTER_TIMEOUT_MS is 4s and
// PLANNER_ACTION_TIMEOUT_MS is 8s, and an abort is the most common way a task dies.
//
// This drives the REAL agent - real browser-service, real Chromium, real Gemini calls - against the
// local chat harness, and reads the latency out of production's own trace output rather than a
// reimplementation. It costs a handful of Gemini calls.
//
//   node scripts/benchmark-planner-latency.mjs [samples]
//
// The key is read from the DPAPI secret vault in-process and never printed.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = Math.max(1, Math.min(Number(process.argv[2] || 3), 10));

const { createSecretStore } = await import("../server/secret-store.js");
const { createBrowserAutomationService } = await import("../server/browser-service.js");
const { createUniversalBrowserAgent, PLANNER_ROUTER_TIMEOUT_MS, PLANNER_ACTION_TIMEOUT_MS } = await import("../server/universal-browser-agent.js");

const runtimeRoot = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
const secrets = createSecretStore(runtimeRoot).load();
const geminiKey = secrets.geminiKey;
if (!geminiKey) {
  console.error("No geminiKey in the DPAPI vault. Nothing to measure.");
  process.exit(1);
}
console.log(`Key loaded from the vault (${geminiKey.length} chars). It is never printed.\n`);

// Capture production's own planner trace instead of re-deriving the timings here.
const attempts = [];
const realLog = console.log;
console.log = (...args) => {
  const line = args.map(String).join(" ");
  const match = /^\[auto:planner\] (ok|fail|timeout) (\{.*\})$/.exec(line);
  if (match) {
    try { attempts.push({ result: match[1], ...JSON.parse(match[2]) }); } catch { /* keep going */ }
    return;
  }
  realLog(...args);
};

const html = fs.readFileSync(path.join(ROOT, "tests/fixtures/chat-harness/index.html"));
const server = http.createServer((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-bench-"));
const browser = createBrowserAutomationService({ runtimeDir, headless: true, channel: undefined, interactiveLogin: false });
const agent = createUniversalBrowserAgent({
  browserService: browser,
  runtimeDir,
  getSettings: () => ({ geminiKey }),
});

// A read-only objective the deterministic fast path does not cover, so every step costs a real
// planner call. Nothing here sends anything.
const OBJECTIVE = "Open the conversation with Yash and report the exact text of the most recent message shown in it";

for (let i = 0; i < SAMPLES; i += 1) {
  const started = Date.now();
  let outcome = "?";
  try {
    const result = await agent.execute(OBJECTIVE, { taskId: `bench-${i}`, startUrl: url, maxSteps: 4, keepBrowserOpen: true });
    outcome = result.success ? "success" : (result.error || result.result || "incomplete");
  } catch (error) {
    outcome = `threw: ${error.message}`;
  }
  realLog(`  run ${i + 1}/${SAMPLES}: ${Date.now() - started}ms wall  -  ${String(outcome).slice(0, 110)}`);
}

console.log = realLog;
await browser.close().catch(() => null);
server.close();
fs.rmSync(runtimeDir, { recursive: true, force: true });

if (!attempts.length) {
  console.log("\nNo planner calls were made - the deterministic fast path handled every step.");
  process.exit(0);
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

const byModel = new Map();
for (const attempt of attempts) {
  if (!byModel.has(attempt.model)) byModel.set(attempt.model, []);
  byModel.get(attempt.model).push(attempt);
}

console.log(`\nPlanner latency over ${attempts.length} real calls`);
console.log(`budgets: router ${PLANNER_ROUTER_TIMEOUT_MS}ms · action ${PLANNER_ACTION_TIMEOUT_MS}ms\n`);
for (const [model, rows] of byModel) {
  const times = rows.map((r) => Number(r.durationMs) || 0);
  const budget = Number(rows[0].timeoutMs) || 0;
  const timeouts = rows.filter((r) => r.result === "timeout").length;
  const failures = rows.filter((r) => r.result === "fail").length;
  const headroom = budget ? Math.round(((budget - percentile(times, 95)) / budget) * 100) : 0;
  console.log(`  ${model}`);
  console.log(`    calls ${rows.length}  ok ${rows.length - timeouts - failures}  timeout ${timeouts}  other-fail ${failures}`);
  console.log(`    min ${Math.min(...times)}ms  median ${percentile(times, 50)}ms  p95 ${percentile(times, 95)}ms  max ${Math.max(...times)}ms`);
  console.log(`    budget ${budget}ms  ->  ${headroom}% headroom at p95${headroom < 25 ? "  << TIGHT" : ""}\n`);
}
console.log(`prompt size: ${Math.max(...attempts.map((a) => Number(a.promptBytes) || 0))} bytes (capped)`);
