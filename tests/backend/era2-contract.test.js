const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");

const port = 8893;
const base = `http://127.0.0.1:${port}`;
let server;
let runtimeDir;
let cookie = "";

async function waitFor(url) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

before(async () => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-era2-"));
  server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir, NODE_ENV: "test", GEMINI_API_KEY: "" },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitFor(`${base}/api/health`);
  const capabilities = await fetch(`${base}/api/capabilities`);
  cookie = capabilities.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (server && !server.killed) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (runtimeDir) fs.rmSync(runtimeDir, { recursive: true, force: true });
});

test("Era II exposes real HUD capabilities", async () => {
  const response = await fetch(`${base}/api/capabilities`, { headers: { cookie } });
  const body = await response.json();
  const names = new Set(body.capabilities.map((item) => item.name));
  for (const name of ["ui_open_widget", "ui_focus_widget", "ui_close_widget", "ui_populate", "ui_render_card"]) assert.equal(names.has(name), true, name);
});

test("conversation stream emits an event envelope and a focus action", async () => {
  const response = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ prompt: "Open the memory widget in focus mode", strength: "cost-guarded" }),
  });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const activity = events.find((event) => event.type === "event");
  const done = events.find((event) => event.type === "done");
  assert.equal(typeof activity.turnId, "string");
  assert.equal(activity.sequence > 0, true);
  assert.equal(done.result.uiActions[0].id, "memory");
  assert.equal(done.result.uiActions[0].focus, true);
});

test("Work Composer artifacts have an authenticated working download route", async () => {
  const response = await fetch(`${base}/api/capabilities/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ tool: "compose_artifact", args: { title: "Era II proof", content: "Verified downloadable content." } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  const download = await fetch(`${base}/api/artifacts/${encodeURIComponent(body.result.id)}/files/final.md`, { headers: { cookie } });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") || "", /attachment; filename="final\.md"/);
  assert.match(await download.text(), /Verified downloadable content/);
});

test("current shell wires multi-file context, Talk-Live, cards, and artifact toast", () => {
  const ui = fs.readFileSync(path.join(process.cwd(), "src", "JarvisUI.tsx"), "utf8");
  const bar = fs.readFileSync(path.join(process.cwd(), "src", "globe-room", "JarvisCommandBar.tsx"), "utf8");
  assert.match(ui, /prepareAttachments\(files\)/);
  assert.match(ui, /attachments: remainingAttachments/);
  assert.match(ui, /jr-activity-rail/);
  assert.match(ui, /jr-toast/);
  assert.match(ui, /LiveVoiceController/);
  assert.match(bar, /Talk-Live/);
  assert.match(bar, /onDrop=/);
});
