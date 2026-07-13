const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const port = 8897;
const baseUrl = `http://127.0.0.1:${port}`;
let server;
let sessionCookie;
let runtimeDir;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Test server did not start");
}

async function execute(tool, args = {}, options = {}) {
  const response = await fetch(`${baseUrl}/api/capabilities/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ tool, args, ...options }),
  });
  return { response, body: await response.json() };
}

before(async () => {
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-capabilities-"));
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
      NEWS_API_KEY: "",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
  const bootstrap = await fetch(`${baseUrl}/api/capabilities`);
  sessionCookie = bootstrap.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (server && !server.killed) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (runtimeDir) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(runtimeDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

test("registers the complete truthful capability catalog", async () => {
  const response = await fetch(`${baseUrl}/api/capabilities`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.capabilities.length >= 28);
  assert.ok(body.capabilities.some((item) => item.name === "open_url" && item.risk === "execute"));
  assert.ok(body.capabilities.some((item) => item.name === "screen_inspect" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "screen_act" && item.risk === "execute"));
  assert.ok(body.capabilities.some((item) => item.name === "youtube_open_video" && item.risk === "execute"));
  assert.ok(body.apps.includes("calculator"));
  assert.ok(body.capabilities.some((item) => item.name === "canvas_assignments"));
  assert.ok(body.capabilities.some((item) => item.name === "canvas_browser_assignments"));
  assert.ok(body.capabilities.some((item) => item.name === "kalshi_balance" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "kalshi_positions" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "send_email" && item.confirmationRequired));
  assert.ok(body.capabilities.some((item) => item.name === "network_inventory" && !item.confirmationRequired));
  assert.ok(body.capabilities.some((item) => item.name === "browser_status" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "browser_login_handoff" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "browser_snapshot" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "browser_act" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "browser_commit" && item.confirmationRequired));
  assert.ok(body.capabilities.some((item) => item.name === "web_research_deep" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "url_read" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "compose_artifact" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "artifact_status" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "pc_graph_rebuild" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "pc_graph_search" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "agent_deploy" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "skill_compile" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "skill_run" && item.risk === "prepare"));
  assert.ok(body.capabilities.some((item) => item.name === "life_graph" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "screen_capture" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "device_files" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "device_latest_image" && item.risk === "observe"));
  assert.ok(body.capabilities.some((item) => item.name === "desktop_control" && item.risk === "execute"));
});

test("reports live capability truth without claiming missing providers work", async () => {
  const response = await fetch(`${baseUrl}/api/jarvis/capability-truth`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  const byName = Object.fromEntries(body.capabilities.map((item) => [item.name, item]));
  assert.equal(byName.canvas_assignments.readiness, "needs_provider");
  assert.equal(byName.canvas_browser_assignments.readiness, "available_via_browser_login");
  assert.equal(byName.browser_login_handoff.readiness, "available_login_handoff");
  assert.ok(body.highValueRecipes.some((item) => item.id === "website_operator"));
});

test("voice status is explicit and voice-origin actions cannot directly execute local control", async () => {
  const statusResponse = await fetch(`${baseUrl}/api/voice/status`, { headers: { cookie: sessionCookie } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.status, "disabled");
  const denied = await execute("open_app", { app: "notepad" }, { source: "voice" });
  assert.equal(denied.body.ok, false);
  assert.equal(denied.body.status, "denied");
  assert.match(denied.body.error, /voice sessions/i);
});

test("rejects unsafe URL protocols before launching a browser", async () => {
  const { response, body } = await execute("open_url", { url: "javascript:alert(1)" });
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /HTTP and HTTPS/i);
});

test("returns a local daily briefing when Gemini is unavailable", async () => {
  const response = await fetch(`${baseUrl}/api/briefing`, { headers: { cookie: sessionCookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.response, "string");
  assert.ok(body.response.length > 0);
});

test("returns measured system status and a verified receipt", async () => {
  const { response, body } = await execute("system_status");
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, "completed");
  assert.equal(body.result.hostname.length > 0, true);
  assert.equal(body.result.memory.usedPercent >= 0 && body.result.memory.usedPercent <= 100, true);
  assert.equal(body.receipt.status, "verified");
});

test("binds commit confirmations to the established local session", async () => {
  const first = await execute("close_app", { app: "notepad" });
  assert.equal(first.body.status, "confirmation_required");
  assert.equal(first.body.confirmation.tool, "close_app");
  assert.equal(first.body.confirmation.token, undefined);

  const otherBootstrap = await fetch(`${baseUrl}/api/capabilities`);
  const otherCookie = otherBootstrap.headers.get("set-cookie").split(";")[0];
  const approval = await fetch(`${baseUrl}/api/confirmations/${first.body.confirmation.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: otherCookie },
    body: JSON.stringify({ approved: true }),
  });
  assert.equal(approval.status, 403);
});

test("persists and searches real agent memory", async () => {
  const marker = `backend-memory-${Date.now()}`;
  const added = await execute("memory_add", { text: marker, category: "test" });
  assert.equal(added.body.ok, true);
  const searched = await execute("memory_search", { query: marker });
  assert.equal(searched.body.ok, true);
  assert.ok(searched.body.result.matches.some((item) => item.text === marker));
});

test("creates verified Work Composer artifacts and rejects private URL reads", async () => {
  const created = await execute("compose_artifact", {
    title: "Backend Test Briefing",
    objective: "Verify artifact creation",
    format: "briefing",
    content: "This is a verified backend test artifact.",
    sections: [{ heading: "Checks", bullets: ["Files exist", "Verification receipt exists"] }],
    sources: [{ title: "Test source", url: "https://example.com" }],
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.ok, true);
  assert.equal(created.body.result.status, "verified");
  assert.ok(fs.existsSync(created.body.result.files.markdown));
  assert.ok(fs.existsSync(created.body.result.files.html));
  assert.ok(fs.existsSync(created.body.result.files.verification));

  const listed = await execute("artifact_status", { id: created.body.result.id });
  assert.equal(listed.body.ok, true);
  assert.equal(listed.body.result.id, created.body.result.id);
  assert.ok(listed.body.result.files.includes("final.md"));

  const rejected = await execute("url_read", { url: "http://127.0.0.1:1/private" });
  assert.equal(rejected.body.ok, false);
  assert.match(rejected.body.error, /private|local|reserved/i);
});

test("indexes the Personal Reality Graph and answers local file timeline queries", async () => {
  const root = path.join(runtimeDir, "pc-graph-fixture");
  fs.mkdirSync(path.join(root, "classes", "finance"), { recursive: true });
  fs.writeFileSync(path.join(root, "classes", "finance", "kalshi-assignment-notes.md"), "# Finance assignment\nCanvas rubric and Kalshi market notes.\n", "utf8");

  const rebuilt = await execute("pc_graph_rebuild", { roots: [root], limit: 50 });
  assert.equal(rebuilt.body.ok, true);
  assert.equal(rebuilt.body.result.status, "complete");
  assert.ok(rebuilt.body.result.indexed >= 1);

  const searched = await execute("pc_graph_search", { query: "kalshi assignment notes", limit: 5 });
  assert.equal(searched.body.ok, true);
  assert.ok(searched.body.result.matches.some((item) => item.name === "kalshi-assignment-notes.md"));

  const timeline = await execute("pc_graph_timeline", { hours: 24, limit: 10 });
  assert.equal(timeline.body.ok, true);
  assert.ok(timeline.body.result.items.some((item) => item.name === "kalshi-assignment-notes.md"));
});

test("deploys typed agents and compiles reusable skill autopilot missions", async () => {
  const deployed = await execute("agent_deploy", {
    agent: "kalshi",
    objective: "Check portfolio, related news, and explain current exposure in plain English.",
  });
  assert.equal(deployed.body.ok, true);
  assert.equal(deployed.body.result.agent, "kalshi");
  assert.equal(deployed.body.result.mission.role, "kalshi");
  assert.match(deployed.body.result.mission.id, /^[0-9a-f-]{36}$/i);

  const compiled = await execute("skill_compile", {
    trigger: "trading mode",
    objective: "When I say trading mode, check Kalshi portfolio, related news, risk, and watchlist, then verify evidence.",
  });
  assert.equal(compiled.body.ok, true);
  assert.equal(compiled.body.result.skill.trigger, "trading mode");
  assert.ok(compiled.body.result.skill.steps.some((step) => step.agent === "kalshi"));
  assert.ok(compiled.body.result.skill.steps.some((step) => step.agent === "verifier"));

  const run = await execute("skill_run", { trigger: "trading mode", input: "Use current account state only." });
  assert.equal(run.body.ok, true);
  assert.equal(run.body.result.status, "queued");
  assert.ok(run.body.result.missions.length >= 2);
  assert.ok(run.body.result.missions.some((mission) => mission.role === "kalshi"));
});

test("fails honestly when a provider is not configured", async () => {
  const { response, body } = await execute("news_headlines", {});
  if (process.env.NEWS_API_KEY) {
    assert.equal(body.ok, true);
  } else {
    assert.equal(response.status, 412);
    assert.equal(body.ok, false);
    assert.match(body.error, /not configured/i);
    assert.equal(body.receipt.status, "failed");
  }
});

test("rejects unknown capabilities", async () => {
  const { response, body } = await execute("arbitrary_shell", { command: "whoami" });
  assert.equal(response.status, 404);
  assert.match(body.error, /unknown capability/i);
});

test("rejects mutation requests without an established session", async () => {
  const response = await fetch(`${baseUrl}/api/capabilities/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool: "system_status", args: {} }),
  });
  assert.equal(response.status, 401);
});

test("rejects cross-site and non-JSON mutation requests", async () => {
  const crossSite = await fetch(`${baseUrl}/api/capabilities/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ tool: "system_status", args: {} }),
  });
  assert.equal(crossSite.status, 403);

  const form = await fetch(`${baseUrl}/api/capabilities/execute`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: sessionCookie },
    body: "tool=system_status",
  });
  assert.equal(form.status, 415);
});

test("rejects DNS-rebinding Host headers and never serves runtime files", async () => {
  const reboundStatus = await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/health",
      headers: { host: "attacker.example" },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(reboundStatus, 403);

  const runtimeFile = await fetch(`${baseUrl}/runtime/settings.json`);
  assert.ok([403, 404].includes(runtimeFile.status));
  assert.doesNotMatch(await runtimeFile.text(), /remotePin|geminiKey|autonomy/);
});

test("loads public mesh URLs from BOM-prefixed settings files", async () => {
  fs.writeFileSync(path.join(runtimeDir, "settings.json"), `\uFEFF${JSON.stringify({
    webhookBaseUrl: "https://bom-example.trycloudflare.com",
    stablePhoneUrl: "https://bom-phone.example.workers.dev",
  }, null, 2)}\n`);
  const response = await fetch(`${baseUrl}/api/settings`, { headers: { cookie: sessionCookie } });
  const settings = await response.json();
  assert.equal(response.status, 200);
  assert.equal(settings.webhookBaseUrl, "https://bom-example.trycloudflare.com");
  assert.equal(settings.stablePhoneUrl, "https://bom-phone.example.workers.dev");
});

test("accepts only the configured public webhook hostname", async () => {
  const session = await fetch(`${baseUrl}/api/capabilities`);
  const cookie = session.headers.get("set-cookie").split(";")[0];
  const update = await fetch(`${baseUrl}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      webhookBaseUrl: "https://jarvis-example.trycloudflare.com",
      stablePhoneUrl: "https://devansh-jarvis.example.workers.dev",
    }),
  });
  assert.equal(update.status, 200);
  const settings = await update.json();
  assert.equal(settings.webhookBaseUrl, "https://jarvis-example.trycloudflare.com");
  assert.equal(settings.stablePhoneUrl, "https://devansh-jarvis.example.workers.dev");
  const requestWithHost = (host) => new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/api/health",
      method: "GET",
      headers: { host },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(await requestWithHost("jarvis-example.trycloudflare.com"), 200);
  assert.equal(await requestWithHost("attacker.example"), 403);
});

test("pairs a device once, authenticates by bearer token, and stores uploads in the mesh inbox", async () => {
  const pairResponse = await fetch(`${baseUrl}/api/pair`, { headers: { cookie: sessionCookie } });
  assert.equal(pairResponse.status, 200);
  const pairBody = await pairResponse.json();
  // Pairing uses a 256-bit URL-safe token; the former six-digit code was
  // brute-forceable and is intentionally no longer part of the contract.
  assert.match(pairBody.pairing.code, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(pairBody.pairUrls.some((item) => item.includes(`pair_code=${pairBody.pairing.code}`)));
  assert.ok(pairBody.pairUrls.some((item) => item.startsWith("https://devansh-jarvis.example.workers.dev")));

  const claimResponse = await fetch(`${baseUrl}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: pairBody.pairing.code,
      name: "Test phone",
      kind: "phone",
      capabilities: ["chat", "uploadFiles", "requestLaptopScreen"],
    }),
  });
  assert.equal(claimResponse.status, 202);
  const claim = await claimResponse.json();
  assert.equal(claim.accessToken, undefined);
  assert.equal(claim.device.approved, false);
  assert.equal(claim.device.status, "claimed_pending_approval");

  const approveResponse = await fetch(`${baseUrl}/api/pair/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ requestId: claim.requestId, trustLevel: "screen_view", actor: "test-laptop" }),
  });
  assert.equal(approveResponse.status, 200);
  const approved = await approveResponse.json();
  assert.match(approved.accessToken, /^jarvis_device_/);
  assert.equal(approved.device.approved, true);
  assert.equal(claim.device.tokenHash, undefined);

  const meshStatus = await fetch(`${baseUrl}/api/device-mesh/status`, {
    headers: { authorization: `Bearer ${approved.accessToken}` },
  });
  assert.equal(meshStatus.status, 200);
  const meshStatusBody = await meshStatus.json();
  assert.equal(meshStatusBody.meshVersion, "2.0.0");
  assert.equal(meshStatusBody.currentDevice.name, "Test phone");
  assert.equal(meshStatusBody.currentDevice.role, "phone");
  assert.ok(meshStatusBody.trustLevels.screen_view);

  const upload = await fetch(`${baseUrl}/api/device-mesh/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approved.accessToken}` },
    body: JSON.stringify({
      name: "phone-note.txt",
      mimeType: "text/plain",
      data: `data:text/plain;base64,${Buffer.from("hello from phone").toString("base64")}`,
    }),
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.file.bytes, "hello from phone".length);
  assert.equal(uploadBody.object.type, "document");
  assert.ok(fs.existsSync(uploadBody.file.path));

  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
  const imageUpload = await fetch(`${baseUrl}/api/device-mesh/upload`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approved.accessToken}` },
    body: JSON.stringify({
      name: "phone-pixel.png",
      mimeType: "image/png",
      data: `data:image/png;base64,${imageBytes.toString("base64")}`,
    }),
  });
  assert.equal(imageUpload.status, 201);
  const imageBody = await imageUpload.json();
  assert.equal(imageBody.file.isImage, true);
  assert.equal(imageBody.object.type, "image");
  assert.ok(imageBody.file.url.includes("/api/device-mesh/file/"));

  const served = await fetch(`${baseUrl}${imageBody.file.url}`, {
    headers: { authorization: `Bearer ${approved.accessToken}` },
  });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");

  const latestEndpoint = await fetch(`${baseUrl}/api/device-mesh/latest-image`, {
    headers: { authorization: `Bearer ${approved.accessToken}` },
  });
  assert.equal(latestEndpoint.status, 200);
  const latestBody = await latestEndpoint.json();
  assert.equal(latestBody.image.found, true);
  assert.match(latestBody.image.name, /phone-pixel\.png$/);

  const capability = await execute("device_latest_image");
  assert.equal(capability.response.status, 200);
  assert.equal(capability.body.ok, true);
  assert.equal(capability.body.result.isImage, true);
  assert.match(capability.body.result.name, /phone-pixel\.png$/);

  const objectCreate = await fetch(`${baseUrl}/api/device-mesh/objects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approved.accessToken}` },
    body: JSON.stringify({
      type: "link",
      name: "Mesh research link",
      link: "https://example.com/jarvis",
      summary: "Saved link for mesh object portal test.",
    }),
  });
  assert.equal(objectCreate.status, 201);
  const objectBody = await objectCreate.json();
  assert.equal(objectBody.object.type, "link");

  const commandCreate = await fetch(`${baseUrl}/api/device-mesh/commands`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approved.accessToken}` },
    body: JSON.stringify({
      type: "ask_jarvis",
      title: "Test card",
      body: "Summarize the mesh object portal.",
      targetDeviceId: "any",
    }),
  });
  assert.equal(commandCreate.status, 201);
  const commandBody = await commandCreate.json();
  assert.equal(commandBody.command.status, "pending");

  const commandAck = await fetch(`${baseUrl}/api/device-mesh/commands/${encodeURIComponent(commandBody.command.id)}/ack`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${approved.accessToken}` },
    body: JSON.stringify({}),
  });
  assert.equal(commandAck.status, 200);
  assert.equal((await commandAck.json()).command.status, "acknowledged");

  const meshCapability = await execute("mesh_status");
  assert.equal(meshCapability.body.ok, true);
  assert.equal(meshCapability.body.result.meshVersion, "2.0.0");

  const meshObjectsCapability = await execute("mesh_objects", { type: "link" });
  assert.equal(meshObjectsCapability.body.ok, true);
  assert.ok(meshObjectsCapability.body.result.objects.some((item) => item.id === objectBody.object.id));
});

test("reports provider setup blockers without claiming a connection", async () => {
  const response = await fetch(`${baseUrl}/api/provider-health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const id of ["google", "canvas", "kalshi"]) {
    assert.equal(body.providers[id].connected, false);
    assert.equal(body.providers[id].validationState, "not_configured");
  }

  const googleStart = await fetch(`${baseUrl}/api/oauth/google/start`);
  assert.equal(googleStart.status, 412);
  assert.match((await googleStart.json()).error, /clientid|clientsecret/i);
});

test("persists a multi-turn conversation for future context and export", async () => {
  const first = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "My favorite test game is FIFA." }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "What game did I just mention?" }),
  });
  assert.equal(second.status, 200);

  const conversation = await fetch(`${baseUrl}/api/conversation`, { headers: { cookie: sessionCookie } });
  assert.equal(conversation.status, 200);
  const body = await conversation.json();
  assert.ok(body.messages.some((item) => item.role === "user" && item.text.includes("FIFA")));
  assert.ok(body.messages.some((item) => item.role === "model"));
});

test("autonomy changes are enforced by the executor", async () => {
  const observe = await fetch(`${baseUrl}/api/autonomy`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ level: "observe" }),
  });
  assert.equal(observe.status, 200);

  const denied = await execute("open_app", { app: "notepad" });
  assert.equal(denied.body.status, "autonomy_elevation_required");
  assert.equal(denied.body.ok, false);

  const reset = await fetch(`${baseUrl}/api/autonomy`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ level: "act" }),
  });
  assert.equal(reset.status, 200);
});

test("Gemini Live receives a one-use ephemeral token rather than the server key", async (t) => {
  const status = await fetch(`${baseUrl}/api/settings`, { headers: { cookie: sessionCookie } });
  const settings = await status.json();
  if (!settings.hasGeminiKey) return t.skip("Gemini is not configured in this environment");
  const response = await fetch(`${baseUrl}/api/live/token`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: "{}",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.token, /^auth_tokens\//);
  assert.match(body.model, /native-audio|live/i);
  assert.equal(body.uses, undefined);
});
