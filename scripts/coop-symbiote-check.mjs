import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const port = Number(process.env.JARVIS_COOP_TEST_PORT || 8994);
const baseUrl = `http://127.0.0.1:${port}`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-coop-symbiote-"));
let server;
let sessionCookie = "";
const results = [];

function pass(name, detail = "") {
  results.push({ name, status: "PASS", detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { text };
  }
  return { response, body };
}

async function post(pathname, body) {
  return request(pathname, { method: "POST", body: JSON.stringify(body || {}) });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Co-op test server did not start.");
}

try {
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      JARVIS_HOST: "127.0.0.1",
      JARVIS_RUNTIME_DIR: runtimeDir,
      GEMINI_API_KEY: "",
      GOOGLE_ACCESS_TOKEN: "",
      GOOGLE_REFRESH_TOKEN: "",
      JARVIS_MOCK_SCREEN_CAPTURE: "1",
      JARVIS_DESKTOP_CONTROL_DRY_RUN: "1",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
  const bootstrap = await fetch(`${baseUrl}/api/capabilities`);
  sessionCookie = bootstrap.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(sessionCookie);
  pass("Trusted local session");

  let result = await post("/api/coop-symbiote/session/create", { title: "Test Symbiote", mode: "Ghost Sandbox Mode" });
  assert.equal(result.response.status, 201);
  const session = result.body.session;
  assert.match(session.code, /^\d{3}-\d{3}$/);
  assert.ok(session.inviteLinks.length >= 1);
  pass("Host creates session", session.code);

  result = await post("/api/coop-symbiote/session/join", {
    code: "000-000",
    displayName: "Bad actor",
  });
  assert.equal(result.response.status, 404);
  pass("Invalid code rejected");

  result = await post("/api/coop-symbiote/session/join", {
    code: session.code,
    displayName: "Aryan",
    deviceName: "Aryan laptop",
    repoFingerprint: session.repoFingerprintHost,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.session.pendingJoin.displayName, "Aryan");
  pass("Guest joins with valid code");

  result = await post(`/api/coop-symbiote/session/${session.id}/approve-join`, {});
  assert.equal(result.response.status, 200);
  assert.equal(result.body.session.peerName, "Aryan");
  pass("Host approves join");

  result = await request("/api/coop-symbiote/manifest?limit=120");
  assert.equal(result.response.status, 200);
  assert.ok(result.body.files.some((file) => file.path === "server.js"));
  assert.ok(result.body.files.every((file) => file.shareMode === "blocked" || file.hash));
  pass("Safe file manifest generated", `${result.body.files.length} entries`);

  result = await request("/api/coop-symbiote/file?path=.env.example");
  assert.equal(result.response.status, 403);
  pass("Secret/path file blocked");

  result = await post("/api/coop-symbiote/chat", { sessionId: session.id, text: "Patch the co-op router carefully.", senderName: "Devansh" });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.message.text, "Patch the co-op router carefully.");
  pass("Human chat works");

  result = await post("/api/coop-symbiote/patches", {
    sessionId: session.id,
    filePath: "docs/JARVIS_COOP_SYMBIOTE_MESH_GUIDE.md",
    originalText: "private two-person collaboration workspace",
    replacementText: "private two-person collaboration workspace with explicit approval",
    summary: "Clarify approval rule",
    author: "Aryan",
  });
  assert.equal(result.response.status, 201);
  const patch = result.body.patch;
  assert.equal(patch.status, "proposed");
  pass("Patch proposal created", patch.id);

  result = await post(`/api/coop-symbiote/patches/${patch.id}/ghost-test`, { sessionId: session.id });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.patch.ghostResult.status, "passed");
  pass("Ghost Sandbox verifies patch");

  result = await post(`/api/coop-symbiote/patches/${patch.id}/approve`, { sessionId: session.id, actor: "Devansh" });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.patch.status, "approved");
  pass("Patch Court approval");

  result = await post("/api/coop-symbiote/debate", { sessionId: session.id, topic: "Should this patch be applied now?" });
  assert.equal(result.response.status, 201);
  assert.match(result.body.recommendation.payload.nextStep, /Ghost Sandbox|Patch Court/);
  pass("Jarvis-to-Jarvis debate");

  result = await post("/api/coop-symbiote/tasks", { sessionId: session.id, title: "Run co-op tests", assignedTo: "Devansh" });
  assert.equal(result.response.status, 201);
  pass("Shared task board");

  result = await post("/api/coop-symbiote/memory-packets", { sessionId: session.id, sharedBy: "Devansh" });
  assert.equal(result.response.status, 201);
  assert.ok(result.body.packet.blocked.includes("API keys"));
  pass("Project memory packet preview");

  result = await post("/api/coop-symbiote/skill-transfers", { sessionId: session.id, name: "co-op-review-skill" });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.transfer.status, "offered");
  pass("Skill transfer offer");

  result = await post("/api/coop-symbiote/replays", { sessionId: session.id, summary: "Test replay" });
  assert.equal(result.response.status, 201);
  const replay = result.body.replay;
  pass("Replay Theater records timeline");

  result = await post(`/api/coop-symbiote/replays/${replay.id}/skill`, { sessionId: session.id });
  assert.equal(result.response.status, 201);
  assert.match(result.body.transfer.skillId, /^coop-replay-/);
  pass("Replay-to-skill compiler");

  result = await request(`/api/coop-symbiote/memory?sessionId=${encodeURIComponent(session.id)}`);
  assert.equal(result.response.status, 200);
  assert.ok(result.body.counts.events >= 1);
  assert.ok(result.body.storage.tables.includes("coop_sessions"));
  pass("Neural Vault co-op storage");

  result = await post(`/api/coop-symbiote/session/${session.id}/end`, { reason: "test complete" });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.session.status, "ended");
  pass("Session end revokes access");

  console.log(`\nJarvis Co-Op Symbiote Mesh check passed: ${results.length}/${results.length}`);
} finally {
  if (server && !server.killed) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
