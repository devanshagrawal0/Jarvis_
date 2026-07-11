import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-device-mesh-repair-"));
const port = 8870 + Math.floor(Math.random() * 120);
const base = `http://127.0.0.1:${port}`;
const results = [];

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
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.message || payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 25_000) {
    if (child.exitCode !== null) throw new Error(`Server exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/mesh/health`);
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

  const health = await request("/mesh/health");
  assert(health.ok, "Mesh health did not return ok.");
  assert(health.host === "0.0.0.0", "Server is not bound to 0.0.0.0.");
  pass("Mesh health and binding", `${health.host}:${health.port}`);

  const pair = await request("/api/pair");
  assert(/^\d{6}$/.test(pair.pairing.code), "Pairing code is not six digits.");
  assert(pair.qrDataUrl?.startsWith("data:image/png;base64,"), "QR data URL missing.");
  assert(pair.preferredPairUrl?.includes("/mesh/pair?code="), "Preferred QR URL is not the phone pairing route.");
  if (pair.candidates?.some((item) => item.pairable)) {
    assert(!/localhost|127\.0\.0\.1/.test(pair.preferredPairUrl), "QR URL incorrectly prefers localhost when a phone-reachable IP exists.");
  }
  pass("QR URL generation", pair.preferredPairUrl);

  const page = await fetch(`${base}/mesh/pair?code=${pair.pairing.code}`).then((response) => response.text());
  assert(page.includes("Jarvis Device Mesh"), "Phone pairing page did not render.");
  pass("Phone pairing page", "/mesh/pair");

  const claimed = await request("/mesh/api/pair/request", {
    method: "POST",
    body: JSON.stringify({
      code: pair.pairing.code,
      name: "Repair Test Phone",
      kind: "phone",
      role: "phone",
      trustLevel: "screen_view",
      permissions: { chat: true, uploadFiles: true, phoneCameraUpload: true, requestLaptopScreen: true },
    }),
  });
  assert(claimed.ok && claimed.accessToken, "Pair request did not issue a device token.");
  assert(claimed.device.approved, "Claimed device is not approved.");
  pass("Pairing request", claimed.device.id);

  const auth = { authorization: `Bearer ${claimed.accessToken}` };
  const heartbeat = await request("/mesh/api/heartbeat", { method: "POST", headers: auth, body: "{}" });
  assert(heartbeat.ok, "Heartbeat failed.");
  pass("Heartbeat", heartbeat.device.status);

  const text = await request("/mesh/api/inbox/text", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ text: "hello from repaired phone mesh" }),
  });
  assert(text.object?.type === "text", "Text inbox object not created.");
  pass("Text endpoint", text.object.summary);

  const link = await request("/mesh/api/inbox/link", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ url: "https://example.com/mesh-repair" }),
  });
  assert(link.object?.type === "link", "Link inbox object not created.");
  pass("Link endpoint", link.object.link);

  const upload = await request("/mesh/api/inbox/upload", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "repair-note.txt",
      mimeType: "text/plain",
      data: `data:text/plain;base64,${Buffer.from("mesh repair upload").toString("base64")}`,
    }),
  });
  assert(upload.file?.url, "Upload URL missing.");
  assert(fs.existsSync(upload.file.path), "Uploaded file not stored.");
  pass("File upload endpoint", upload.file.url);

  const inbox = await request("/mesh/api/inbox", { headers: auth });
  assert(inbox.inbox.length >= 3, "Inbox did not contain text/link/file items.");
  pass("Inbox endpoint", `${inbox.inbox.length} items`);

  const events = await request("/mesh/api/events", { headers: auth });
  assert(events.events.some((event) => event.type === "text_received"), "Event log missing text_received.");
  assert(events.events.some((event) => event.type === "file_received"), "Event log missing file_received.");
  pass("Human-readable event log", `${events.events.length} events`);

  const memory = await request("/api/device-mesh/memory", { headers: auth });
  assert(memory.inboxItems.length >= 2, "Neural mesh memory did not record inbox items.");
  pass("Mesh memory storage", `${memory.inboxItems.length} traces`);

  const selfTest = await request("/mesh/api/self-test", { method: "POST", body: "{}" });
  assert(Array.isArray(selfTest.tests) && selfTest.tests.length >= 8, "Self-test did not return required tests.");
  assert(fs.existsSync(selfTest.reportPath), "Self-test report missing.");
  pass("Self-test report", selfTest.reportPath);
} catch (error) {
  fail("Device Mesh emergency repair check", error);
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
