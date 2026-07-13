const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { after, before, test } = require("node:test");
const { createAgentRuntime } = require("../../server/agent-runtime");

const jarvisPort = 8895;
const geminiPort = 8894;
const jarvisUrl = `http://127.0.0.1:${jarvisPort}`;
let jarvis;
let gemini;
let runtimeDir;
let sessionCookie;
let geminiRequests = [];

test("ambiguous mixed requests remain eligible for semantic routing", () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiKey: "configured" }),
    toolGateway: { selectTools: () => [], catalog: () => ({ tools: [] }) },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prompt = "I am not sure whether you should open the project or first explain what changed, because the earlier result looked incomplete.";
  const baseline = runtime.classify(prompt, [], "chat");
  assert.equal(runtime.shouldUseSemanticRouter(prompt, baseline, []), true);
});

async function waitFor(url) {
  // A clean runtime initializes the local indexes and service graph before the
  // HTTP listener is ready. On slower Windows/OneDrive hosts that can exceed
  // five seconds even though the server starts successfully.
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

before(async () => {
  gemini = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/browser-fixture") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Operator Fixture</title><main><button id='continue'>Continue</button></main>");
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body || "{}");
    geminiRequests.push({ url: request.url, payload });
    const functionResponses = payload.contents?.flatMap((item) => item.parts || []).filter((part) => part.functionResponse) || [];
    if (request.url.includes("streamGenerateContent")) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "At your " }] } }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "service, sir." }] } }] })}\n\n`);
      return;
    }
    response.setHeader("content-type", "application/json");
    const prompt = payload.contents?.at(-1)?.parts?.find((part) => part.text)?.text || "";
    const responseNames = functionResponses.map((part) => part.functionResponse.name);
    const originalPrompt = payload.contents?.flatMap((item) => item.parts || []).find((part) => /operator fixture/i.test(part.text || ""))?.text || "";
    if (/fake-no-grounding latest youtube/i.test(prompt)) {
      response.end(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "His latest video is DEFINITELY MADE UP." }] } }],
      }));
      return;
    }
    if (/fake agent claim/i.test(prompt)) {
      response.end(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "I launched the YouTube preference agent and it is scanning now." }] } }],
      }));
      return;
    }
    if (/clarify action claim/i.test(prompt)) {
      response.end(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "Which YouTube channel should I inspect, sir?" }] } }],
      }));
      return;
    }
    if (/operator fixture/i.test(originalPrompt)) {
      if (!responseNames.includes("browser_navigate")) {
        response.end(JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ functionCall: {
            name: "browser_navigate",
            args: { url: `http://127.0.0.1:${geminiPort}/browser-fixture` },
          } }] } }],
        }));
        return;
      }
      if (!responseNames.includes("browser_snapshot")) {
        response.end(JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ functionCall: {
            name: "browser_snapshot",
            args: {},
          } }] } }],
        }));
        return;
      }
      response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Browser workflow complete, sir." }] } }] }));
      return;
    }
    if (functionResponses.length) {
      setTimeout(() => {
        if (!response.destroyed) response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "late synthesis" }] } }] }));
      }, 1_000);
      return;
    }
    if (/system status/i.test(prompt)) {
      response.end(JSON.stringify({
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { name: "system_status", args: {} } }],
          },
        }],
      }));
      return;
    }
    response.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "At your service, sir." }] } }] }));
  });
  await new Promise((resolve) => gemini.listen(geminiPort, "127.0.0.1", resolve));

  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-latency-"));
  jarvis = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(jarvisPort),
      JARVIS_HOST: "127.0.0.1",
      JARVIS_RUNTIME_DIR: runtimeDir,
      JARVIS_GEMINI_API_BASE_URL: `http://127.0.0.1:${geminiPort}`,
      JARVIS_GEMINI_BUDGET_MS: "800",
      NODE_ENV: "test",
      GEMINI_API_KEY: "test-key",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  await waitFor(`${jarvisUrl}/api/health`);
  const bootstrap = await fetch(`${jarvisUrl}/api/capabilities`);
  sessionCookie = bootstrap.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (jarvis && !jarvis.killed) {
    const exited = new Promise((resolve) => jarvis.once("exit", resolve));
    jarvis.kill();
    await exited;
  }
  if (gemini) await new Promise((resolve) => gemini.close(resolve));
  if (runtimeDir) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(runtimeDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
});

test("obvious conversation skips the router model and exposes timing metadata", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "Hello" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.response, /How can I assist you/i);
  assert.equal(body.source, "local-instant");
  assert.equal(body.route.classifier, "deterministic");
  assert.equal(body.timing.routerModelCalls, 0);
  assert.equal(body.timing.answerModelCalls, 0);
  assert.equal(body.timing.totalModelCalls, 0);
  assert.equal(geminiRequests.length, 0);
  assert.ok(body.timing.totalMs < 100);
});

test("verified tool results survive a post-tool synthesis timeout", async () => {
  geminiRequests = [];
  const started = Date.now();
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "Run system status" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.source, "tool-recovery");
  assert.equal(body.timing.synthesisRecovered, true);
  assert.ok(body.toolResults.some((item) => item.tool === "system_status" && item.ok));
  assert.match(body.response, /system_status completed/i);
  assert.ok(Date.now() - started < 2_500);
  assert.equal(body.timing.totalModelCalls, 2);
});

test("stream endpoint emits deltas and a final result", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "Explain something concise" }),
  });
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(response.status, 200);
  assert.ok(events.filter((event) => event.type === "delta").length >= 2);
  assert.ok(events.some((event) => event.type === "done"));
  assert.match(events.find((event) => event.type === "done").result.response, /At your service/i);
});

test("fresh information routes can expose a relevant local tool without semantic routing", async () => {
  const runtime = createAgentRuntime({
    getSettings: () => ({ geminiKey: "configured", semanticRouting: false }),
    toolGateway: {
      selectTools: () => [{ name: "weather_forecast", parameters: {} }],
      catalog: () => ({ tools: [] }),
    },
    codeKnowledge: { search: async () => [], inspect: () => null, stats: () => ({ chunks: 0 }) },
    memoryStore: { search: () => [] },
  });
  const prepared = await runtime.prepare({ prompt: "What is the weather today in Boston?", history: [] });
  assert.equal(prepared.route.fresh, true);
  assert.equal(prepared.route.routerModelCalls, 0);
  assert.equal(prepared.selectedTools[0].name, "weather_forecast");
});

test("browser operator continues through navigate and snapshot before answering", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "Open the operator fixture website and inspect it." }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.response, /workflow complete/i);
  assert.deepEqual(body.toolResults.map((item) => item.tool), ["browser_navigate", "browser_snapshot"]);
  assert.equal(body.timing.answerModelCalls, 3);
  assert.equal(body.toolResults.every((item) => item.ok), true);
});

test("fresh information answers are blocked when Gemini provides no evidence", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "fake-no-grounding latest youtube: what is Samay Raina's latest YouTube video title?" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.response, /not verified|can't confirm/i);
  assert.match(body.response, /will not guess/i);
  assert.equal(body.evidenceGate.blocked, true);
  assert.equal(body.evidenceGate.kind, "fresh-information");
  assert.equal(body.sources.length, 0);
});

test("action claims are blocked when no tool actually ran", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "fake agent claim: create an agent to scan my YouTube preferences" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.response, /not verified|can't confirm/i);
  assert.match(body.response, /not executed a tool|not have an exposed tool|don't have that action wired/i);
  assert.equal(body.evidenceGate.blocked, true);
  assert.equal(body.evidenceGate.kind, "action");
  assert.deepEqual(body.toolResults, []);
});

test("action clarification questions are allowed before a tool runs", async () => {
  geminiRequests = [];
  const response = await fetch(`${jarvisUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({ prompt: "clarify action claim: create an agent to scan my YouTube preferences" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.response, /Which YouTube channel/i);
  assert.equal(body.evidenceGate, undefined);
  assert.deepEqual(body.toolResults, []);
});
