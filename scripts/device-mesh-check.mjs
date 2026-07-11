import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-device-mesh-"));
const port = 8897 + Math.floor(Math.random() * 100);
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

function cookieFrom(headers) {
  return headers.getSetCookie?.().map((item) => item.split(";")[0]).join("; ")
    || headers.get("set-cookie")?.split(";")[0]
    || "";
}

async function request(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(payload.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return { response, payload };
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 25_000) {
    if (child.exitCode !== null) throw new Error(`Server exited early with ${child.exitCode}`);
    try {
      const { response } = await fetch(`${base}/api/status`).then(async (res) => ({ response: res, payload: await res.json().catch(() => ({})) }));
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
  const status = await fetch(`${base}/api/status`);
  const localCookie = cookieFrom(status.headers);
  assert(localCookie, "Local session cookie was not established.");
  pass("Local trusted session", localCookie.split("=")[0]);

  const pair = await request("/api/pair", { headers: { cookie: localCookie } });
  assert(/^\d{6}$/.test(pair.payload.pairing.code), "Pair code is not six digits.");
  assert(pair.payload.qrDataUrl?.startsWith("data:image/png;base64,"), "QR code data URL missing.");
  assert(pair.payload.preferredPairUrl, "Preferred pair URL missing.");
  pass("Pair phone by QR/code", pair.payload.preferredPairUrl);

  const claimed = await request("/api/pair", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: localCookie },
    body: JSON.stringify({ code: pair.payload.pairing.code, name: "Test phone", kind: "phone", role: "phone", trustLevel: "screen_view" }),
  });
  assert(claimed.payload.accessToken, "Access token missing after pairing.");
  assert(claimed.payload.device?.approved, "Paired device was not approved.");
  pass("Claim pair code", claimed.payload.device.id);

  const bearer = `Bearer ${claimed.payload.accessToken}`;
  const devices = await request("/api/devices", { headers: { authorization: bearer } });
  assert(devices.payload.devices.some((device) => device.id === claimed.payload.device.id), "Paired device not visible in registry.");
  assert(devices.payload.mesh?.meshRuntimeVersion?.includes("live-control"), "Mesh status is not live-control runtime version.");
  pass("Connected devices shown", `${devices.payload.devices.length} device(s)`);

  const memory = await request("/api/device-mesh/memory", { headers: { authorization: bearer } });
  assert(Array.isArray(memory.payload.devices), "Mesh memory devices missing.");
  assert(memory.payload.storage?.tables?.includes("mesh_devices"), "Mesh storage table list missing.");
  pass("Mesh memory endpoint", `${memory.payload.devices.length} neural device(s)`);

  const live = await request("/api/device-mesh/live/start", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ quality: "balanced", targetFps: 1 }),
  });
  assert(live.payload.mesh.liveScreen.active, "Live screen did not become active.");
  pass("Live screen starts", live.payload.mesh.liveScreen.sessionId);

  const liveStatus = await request("/api/device-mesh/live/status", { headers: { authorization: bearer } });
  assert(liveStatus.payload.mesh.liveScreen.active, "Live status lost active state.");
  pass("Live status reports active", `${liveStatus.payload.mesh.liveScreen.targetFps} fps target`);

  const controlRequest = await request("/api/device-mesh/control/request", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ reason: "Automated device mesh check", durationSeconds: 60 }),
  });
  assert(controlRequest.payload.mesh.controlBaton.status === "requested", "Control request was not recorded.");
  pass("Remote control request recorded", controlRequest.payload.mesh.controlBaton.requestedBy);

  const deniedEvent = await fetch(`${base}/api/device-mesh/control/event`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ action: "hotkey", hotkey: "escape" }),
  }).then(async (res) => ({ ok: res.ok, status: res.status, payload: await res.json().catch(() => ({})) }));
  assert(!deniedEvent.ok && deniedEvent.status === 403, "Unapproved remote control event was not rejected.");
  pass("Unapproved control is blocked", deniedEvent.payload.error);

  const approved = await request("/api/device-mesh/control/approve", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: localCookie },
    body: JSON.stringify({ deviceId: claimed.payload.device.id, durationSeconds: 60 }),
  });
  assert(approved.payload.mesh.controlBaton.status === "approved", "Control baton was not approved.");
  pass("Laptop approves control baton", approved.payload.mesh.controlBaton.holderDeviceName);

  const object = await request("/api/device-mesh/objects", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ type: "link", name: "Mesh test link", link: "https://example.com", summary: "Test link from phone." }),
  });
  assert(object.payload.object.id, "Object portal did not create object.");
  pass("Phone link/object inbox", object.payload.object.id);

  const upload = await request("/api/device-mesh/upload", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ name: "mesh-test.txt", mimeType: "text/plain", data: `data:text/plain;base64,${Buffer.from("hello mesh").toString("base64")}` }),
  });
  assert(upload.payload.file?.url, "Upload did not return file URL.");
  pass("Phone file upload", upload.payload.file.url);

  const overlay = await request("/api/device-mesh/overlays", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ type: "note", overlay: { text: "Look here" }, followed: false }),
  });
  assert(overlay.payload.overlay?.id, "Overlay was not recorded.");
  pass("Overlay memory", overlay.payload.overlay.id);

  const replay = await request("/api/device-mesh/replay", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: JSON.stringify({ summary: "Automated replay check", actionGraph: ["pair", "start_live", "send_object"] }),
  });
  assert(replay.payload.replay?.id, "Replay was not recorded.");
  pass("Replay marker", replay.payload.replay.id);

  const skill = await request(`/api/device-mesh/replay/${encodeURIComponent(replay.payload.replay.id)}/skill`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: localCookie },
    body: JSON.stringify({ name: "Automated mesh replay skill" }),
  });
  assert(skill.payload.skill?.id, "Replay did not compile into skill.");
  pass("Replay compiles into skill", skill.payload.skill.name);

  const stop = await request("/api/device-mesh/live/stop", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer },
    body: "{}",
  });
  assert(!stop.payload.mesh.liveScreen.active, "Live screen did not stop.");
  pass("Live screen stops", "stopped");

  const finalMemory = await request("/api/device-mesh/memory", { headers: { authorization: bearer } });
  assert(finalMemory.payload.inboxItems.length >= 2, "Mesh inbox memory did not record objects/uploads.");
  assert(finalMemory.payload.replays.length >= 1, "Mesh replay memory missing.");
  pass("Neural Vault mesh trace persists", `${finalMemory.payload.inboxItems.length} inbox item(s), ${finalMemory.payload.replays.length} replay(s)`);
} catch (error) {
  fail("Device Mesh check", error);
} finally {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

for (const result of results) {
  const icon = result.status === "pass" ? "PASS" : "FAIL";
  console.log(`${icon} ${result.name}${result.detail ? ` - ${result.detail}` : ""}`);
}

if (results.some((result) => result.status === "fail")) {
  console.error(stderr || stdout);
  process.exit(1);
}
