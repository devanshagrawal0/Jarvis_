import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-memory-os-v4-"));
const port = 8990 + Math.floor(Math.random() * 120);
const base = `http://127.0.0.1:${port}`;
const results = [];
let sessionCookie = "";

function pass(name, detail = "") {
  results.push({ name, status: "pass", detail });
}

function fail(name, error) {
  results.push({ name, status: "fail", detail: error?.message || String(error) });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers || {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 25_000) {
    if (child.exitCode !== null) throw new Error(`Server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error("Timed out waiting for server.");
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), JARVIS_RUNTIME_DIR: runtime, NODE_ENV: "test", JARVIS_GEMINI_BUDGET_MS: "500" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

try {
  await waitForServer(child);
  const healthResponse = await fetch(`${base}/api/health`);
  sessionCookie = healthResponse.headers.getSetCookie?.().map((item) => item.split(";")[0]).join("; ")
    || healthResponse.headers.get("set-cookie")?.split(";")[0]
    || "";
  assert(sessionCookie, "Local session cookie was not established.");
  pass("Local trusted session", sessionCookie.split("=")[0]);

  const status = await request("/api/memory-os/v4/status");
  assert(status.ok, "MemoryOS status did not return ok.");
  assert(status.version.includes("memory-os-filedb-agents"), "MemoryOS v4 version missing.");
  assert(status.agents.length >= 19, "Required memory agents were not scaffolded.");
  pass("MemoryOS status and agents", `${status.agents.length} agents`);

  const created = await request("/api/memory-os/v4/objects", {
    method: "POST",
    body: JSON.stringify({
      type: "decision",
      title: "MemoryOS v4 automated test decision",
      summary: "Automated test object proves file-backed memory works.",
      content: "Jarvis stores this object as a markdown file and a database row.",
      tags: ["qa", "memory-os-v4"],
      parentUris: ["memory://projects/jarvis/tests"],
    }),
  });
  assert(created.object?.uri, "Memory object URI missing.");
  assert(fs.existsSync(created.object.filePath), "Memory object file was not written.");
  pass("File-backed memory object", created.object.uri);

  const read = await request(`/api/memory-os/v4/objects?uri=${encodeURIComponent(created.object.uri)}`);
  assert(read.object.fileExists, "Memory object file reread failed.");
  assert(read.object.fileContent.includes("MemoryOS v4 automated test decision"), "Memory object file content missing title.");
  pass("Memory object reread", read.object.filePath);

  const query = await request(`/api/memory-os/v4/query?q=${encodeURIComponent("automated test decision")}`);
  assert(query.objects.some((item) => item.id === created.object.id), "Hybrid query did not retrieve created object.");
  assert(query.confidence > 0.3, "Hybrid query confidence too low for exact object.");
  pass("Hybrid query engine", query.answerSummary);

  const scan = await request("/api/memory-os/v4/files/scan", {
    method: "POST",
    body: JSON.stringify({ limit: 90 }),
  });
  assert(scan.inspected > 0, "FileDB scan inspected no files.");
  assert(fs.existsSync(scan.reportPath), "File inspection report missing.");
  pass("FileDB scan", `${scan.inspected} files`);

  const files = await request("/api/memory-os/v4/files?limit=12");
  assert(files.files.length > 0, "FileDB index endpoint returned no files.");
  pass("FileDB index query", `${files.files.length} indexed rows`);

  const agentRun = await request("/api/memory-os/v4/agents/run", {
    method: "POST",
    body: JSON.stringify({ agentId: "retrieval-evaluator-agent", task: "Automated retrieval evaluator smoke test" }),
  });
  assert(agentRun.run?.status === "complete", "Memory agent did not complete.");
  assert(fs.existsSync(agentRun.run.reportPath), "Agent report missing.");
  pass("Memory agent run", agentRun.run.summary);

  const recheck = await request("/api/memory-os/v4/recheck", { method: "POST", body: "{}" });
  assert(fs.existsSync(recheck.reportPath), "MemoryOS recheck report missing.");
  pass("4-hour recheck scaffold", recheck.status);

  const trace = await request(`/api/memory-os/v4/storage-trace?uri=${encodeURIComponent(created.object.uri)}`);
  assert(trace.trace.some((line) => line.includes("memory_objects row")), "Storage trace missing DB row.");
  pass("Storage trace", trace.trace.join(" | "));

  const finalStatus = await request("/api/memory-os/v4/status");
  assert(finalStatus.counts.objects >= status.counts.objects, "Object count regressed.");
  pass("Reports present", finalStatus.reports.map((item) => path.basename(item)).join(", "));
} catch (error) {
  fail("MemoryOS v4 check", error);
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

for (const result of results) {
  console.log(`${result.status === "pass" ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` - ${result.detail}` : ""}`);
}

if (results.some((result) => result.status === "fail")) {
  console.error(stderr || stdout);
  process.exit(1);
}
