"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { chromium } = require("playwright");
const { createBrowserAutomationService } = require("../../server/browser-service");
const { MAX_PLANNER_MODELS, MAX_STAGNANT_OBSERVATIONS, PLANNER_ACTION_TIMEOUT_MS, PLANNER_ROUTER_TIMEOUT_MS, commitBoundary, completionProblems, createUniversalBrowserAgent, deterministicDecision, fingerprint, inferredStepBudget, parseJson } = require("../../server/universal-browser-agent");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});

test("generic commit boundary distinguishes search/preparation from an external commit", () => {
  const snapshot = { elements: [
    { ref: "e1", name: "Search", sensitive: false },
    { ref: "e2", name: "Message", sensitive: false },
    { ref: "e3", name: "Send", sensitive: true },
  ] };
  assert.equal(commitBoundary("send Raghav hi", { action: "fill", ref: "e2", value: "hi", reason: "Prepare exact message" }, snapshot), null);
  assert.equal(commitBoundary("send Raghav hi", { action: "click", ref: "e1", reason: "Search for the named person" }, snapshot), null);
  assert.equal(commitBoundary("find Project Orion", { action: "press", ref: "e1", key: "Enter", reason: "Submit the search query" }, { elements: [{ ref: "e1", role: "searchbox", name: "Search reports" }] }), null);
  assert.equal(commitBoundary("send Raghav hi", { action: "click", ref: "e1", reason: "Open conversations so I can eventually send the message" }, { elements: [{ ref: "e1", name: "Open conversations", sensitive: false }] }), null);
  const commit = commitBoundary("send Raghav hi", { action: "click", ref: "e3", reason: "Send the prepared message" }, snapshot);
  assert.equal(commit.action, "click");
  assert.match(commit.label, /send/i);
});

test("page fingerprint changes with observable state", () => {
  const before = fingerprint({ url: "https://fixture.test", title: "Inbox", pageText: "Ready", elements: [] });
  const after = fingerprint({ url: "https://fixture.test", title: "Inbox", pageText: "Message sent", elements: [] });
  assert.notEqual(before, after);
});

test("planner JSON repair tolerates literal control characters without changing actions", () => {
  const parsed = parseJson('{"summary":"line one\nline two","actions":[{"action":"wait","reason":"steady\tstate"}],"confidence":0.8}');
  assert.equal(parsed.actions[0].action, "wait");
  assert.match(parsed.summary, /line one line two/);
});

test("remote planner fallback stays bounded", () => {
  // This used to pin the literal 2 / 4000ms / 8000ms. Those numbers came from a measurement taken
  // when the planner prompt was ~4.4 KB, and live runs at 12-18 KB failed with every model in the
  // chain timing out — so pinning them froze a budget that no longer matched reality, and the test
  // could only ever say "the constants are still the constants".
  //
  // The property worth keeping is that the fallback is bounded at all: a stuck step must give up
  // rather than hang the run. The budgets themselves are justified against measured latency in
  // tests/backend/planner-budget.test.js, which is where a change to them should have to argue.
  const worstStepMs = PLANNER_ROUTER_TIMEOUT_MS + (PLANNER_ACTION_TIMEOUT_MS * (MAX_PLANNER_MODELS - 1));
  assert.ok(MAX_PLANNER_MODELS >= 2 && MAX_PLANNER_MODELS <= 4, `chain depth ${MAX_PLANNER_MODELS} is outside the sane range`);
  assert.ok(worstStepMs <= 12_000, `a fully stuck step would burn ${worstStepMs}ms before giving up`);
});

test("browser decision budget expands only for genuinely complex workflows", () => {
  assert.equal(inferredStepBudget("Open the dashboard", { steps: [{}] }), 24);
  assert.equal(inferredStepBudget("Search the report, then inspect its evidence across tabs", { steps: [{}, {}] }), 32);
  assert.equal(inferredStepBudget("Find the report, then compare multiple sources across tabs, analyze evidence, download the dataset, and upload it to the repository", { steps: [{}, {}, {}, {}] }), 40);
});

test("unchanged pages trigger bounded recovery telemetry and stop before blind repetition", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-universal-recovery-"));
  cleanup.push(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const events = [];
  const statusTaskIds = [];
  let actionCalls = 0;
  const browserService = {
    async snapshot() { return { pageId: "page-1", url: "https://fixture.test/stuck", title: "Stuck", pageText: "Still loading", elements: [{ ref: "e1", role: "button", name: "Continue" }] }; },
    async status(args) { statusTaskIds.push(args.taskId); return { tabs: [] }; },
    async act() { actionCalls += 1; return { clicked: true }; },
    async wait() { return { waited: true }; },
  };
  const agent = createUniversalBrowserAgent({ browserService, runtimeDir, getSettings: () => ({}), planner: async () => ({ actions: [{ action: "click", ref: "e1", reason: "Try the only available continuation", expected: "Page changes" }], confidence: 0.7 }) });
  const result = await agent.execute("Continue through the contained fixture", { taskId: "stuck-task", maxSteps: 20, onStep: (event) => events.push(event) });
  assert.equal(result.blocked, true);
  assert.match(result.error, new RegExp(String(MAX_STAGNANT_OBSERVATIONS)));
  assert.ok(events.some((event) => event.phase === "recovering"));
  assert.ok(events.some((event) => event.phase === "observed"));
  assert.ok(actionCalls < MAX_STAGNANT_OBSERVATIONS);
  assert.ok(statusTaskIds.every((taskId) => taskId === "stuck-task"));
});

test("generic semantic fast path searches, resolves, and prepares an exact message without site scripts", () => {
  const outcome = { entities: { people: ["Raghav Mittal"], quotedValues: ["hi"] } };
  const enterMessaging = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "new", role: "button", name: "New message" }] },
    history: [],
    entityHints: [],
  });
  assert.equal(enterMessaging.actions[0].action, "click");
  assert.equal(enterMessaging.actions[0].ref, "new");

  const search = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "search", role: "searchbox", name: "Search people" }] },
    history: [],
    entityHints: [],
  });
  assert.deepEqual(search.actions[0], {
    action: "fill",
    ref: "search",
    value: "Raghav Mittal",
    reason: "Search for the exact requested identity Raghav Mittal",
    expected: "Candidate identities for Raghav Mittal become visible",
  });

  const visibleRecentConversation = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "recent", role: "button", name: "Raghav Mittal Reacted to your message 5 hours ago" }] },
    history: [],
    entityHints: [{ kind: "person", status: "resolved", match: { ref: "recent", matchScore: 0.94 } }],
  });
  assert.equal(visibleRecentConversation.actions[0].action, "click");
  assert.equal(visibleRecentConversation.actions[0].ref, "recent");

  const resolve = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "raghav", role: "link", name: "Raghav Mittal" }] },
    history: [{ action: "fill", value: "Raghav Mittal", ok: true }],
    entityHints: [{ kind: "person", status: "resolved", match: { ref: "raghav", matchScore: 1 } }],
  });
  assert.equal(resolve.actions[0].action, "click");
  assert.equal(resolve.actions[0].ref, "raghav");

  const loading = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "search", role: "searchbox", name: "Search people", value: "Raghav Mittal" }] },
    history: [{ action: "fill", value: "Raghav Mittal", ok: true }],
    entityHints: [{ kind: "person", status: "not_found", candidates: [] }],
  });
  assert.equal(loading.actions[0].action, "wait");
  assert.equal(loading.actions[0].milliseconds, 900);

  const continueToChat = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "selected", role: "button", name: "Raghav Mittal" }, { ref: "chat", role: "button", name: "Chat" }] },
    history: [{ action: "fill", value: "Raghav Mittal", ok: true }, { action: "click", ref: "raghav", targetName: "Raghav Mittal", reason: "Open resolved recipient identity", ok: true }],
    entityHints: [{ kind: "person", status: "resolved", match: { ref: "selected", matchScore: 1 } }],
  });
  assert.equal(continueToChat.actions[0].ref, "chat");

  const compose = deterministicDecision({
    outcome,
    snapshot: { elements: [{ ref: "composer", role: "textbox", name: "Message" }] },
    history: [{ action: "fill", value: "Raghav Mittal", ok: true }, { action: "click", ref: "raghav", targetName: "Raghav Mittal", ok: true }],
    entityHints: [],
  });
  assert.equal(compose.actions[0].action, "fill");
  assert.equal(compose.actions[0].value, "hi");

  const complete = deterministicDecision({
    outcome: { ...outcome, commit: { required: false } },
    snapshot: { elements: [{ ref: "composer", role: "textbox", name: "Message", value: "hi" }] },
    history: [{ action: "fill", value: "Raghav Mittal", ok: true }, { action: "click", ref: "raghav", targetName: "Raghav Mittal", reason: "Open resolved recipient conversation", ok: true }, { action: "fill", ref: "composer", targetName: "Message", value: "hi", ok: true }],
    entityHints: [],
  });
  assert.equal(complete.actions[0].action, "complete");
});

test("completion contract rejects prepared-but-unsent work and accepts a verified exact-recipient commit", () => {
  const state = {
    history: [{ action: "fill", targetName: "Message", value: "hi", ok: true }],
    knownFiles: [],
    outcome: {
      commit: { required: true },
      entities: { people: ["Raghav Mittal"] },
      completionContract: { requireRecipientVerification: true, requireArtifactIntegrity: false },
    },
  };
  assert.ok(completionProblems(state, { pageText: "Chat with Raghav Mittal" }).some((item) => /commit/i.test(item)));
  state.history.push({ action: "click", committed: true, ok: true, reason: "Send to Raghav Mittal" });
  assert.deepEqual(completionProblems(state, { pageText: "Chat with Raghav Mittal — hi" }), []);
});

test("completion rejects a send when the exact payload is absent from the post-send conversation", () => {
  const state = {
    history: [
      { action: "fill", targetName: "Message", value: "jarvis proof 4821", ok: true },
      { action: "click", committed: true, ok: true, reason: "Send to Raghav Mittal" },
    ],
    knownFiles: [],
    outcome: {
      commit: { required: true },
      entities: { people: ["Raghav Mittal"], messageValues: ["jarvis proof 4821"] },
      completionContract: { requireRecipientVerification: true, requireArtifactIntegrity: false },
    },
  };
  const missing = completionProblems(state, { pageText: "Chat with Raghav Mittal — message sent" });
  assert.ok(missing.some((item) => /post-send conversation/i.test(item)));
  assert.deepEqual(completionProblems(state, { pageText: "Chat with Raghav Mittal — jarvis proof 4821" }), []);
});

test("short payload verification uses token boundaries rather than substring matches", () => {
  const state = {
    history: [
      { action: "fill", targetName: "Message", value: "hi", ok: true },
      { action: "click", committed: true, ok: true, reason: "Send to Raghav Mittal" },
    ],
    knownFiles: [],
    outcome: {
      commit: { required: true },
      entities: { people: ["Raghav Mittal"], messageValues: ["hi"] },
      completionContract: { requireRecipientVerification: true, requireArtifactIntegrity: false },
    },
  };
  assert.ok(completionProblems(state, { pageText: "Chat with Raghav Mittal — this was sent" }).some((item) => /post-send/i.test(item)));
});

test("completion contract does not mistake recipient search text for a prepared message", () => {
  const state = {
    history: [{ action: "fill", ref: "to", targetName: "To:", value: "hi", ok: true }],
    knownFiles: [],
    outcome: { commit: { required: false }, entities: { people: ["Raghav Mittal"], messageValues: ["hi"] }, completionContract: {} },
  };
  assert.ok(completionProblems(state, { pageText: "To: Raghav Mittal hi" }).some((item) => /message composer/i.test(item)));
});

test("owner cancellation stops before the next browser operation and releases the task surface", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-universal-cancel-"));
  cleanup.push(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const calls = [];
  const agent = createUniversalBrowserAgent({
    runtimeDir,
    getSettings: () => ({}),
    browserService: {
      async releaseTask(args) { calls.push({ action: "release", ...args }); return { released: true }; },
    },
    planner: async () => { throw new Error("planner must not run after cancellation"); },
  });
  const result = await agent.execute("Open a fixture site", { taskId: "cancel-fixture", controlState: () => "cancelled" });
  assert.equal(result.cancelled, true);
  assert.deepEqual(calls, [{ action: "release", taskId: "cancel-fixture", close: true }]);
});

test("persistent browser assigns isolated pages to concurrent task ids without foreground switching", async (t) => {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Playwright Chromium is not installed");
    return;
  }
  const server = http.createServer((request, response) => {
    const name = request.url === "/a" ? "Task A" : "Task B";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<title>${name}</title><main><label>Value <input id="value"></label><p>${name}</p></main>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-universal-browser-"));
  cleanup.push(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const service = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  cleanup.push(() => service.close());
  const port = server.address().port;

  await service.navigate({ taskId: "task-a", url: `http://127.0.0.1:${port}/a` });
  await service.navigate({ taskId: "task-b", url: `http://127.0.0.1:${port}/b` });
  const a = await service.snapshot({ taskId: "task-a" });
  const b = await service.snapshot({ taskId: "task-b" });
  assert.equal(a.title, "Task A");
  assert.equal(b.title, "Task B");
  assert.notEqual(a.pageId, b.pageId);
  const aRef = a.elements.find((item) => item.id === "value").ref;
  const bRef = b.elements.find((item) => item.id === "value").ref;
  // Capturing task B must not invalidate task A's page-scoped references.
  await service.act({ taskId: "task-a", action: "fill", ref: aRef, value: "alpha" });
  await service.act({ taskId: "task-b", action: "fill", ref: bRef, value: "beta" });
  assert.equal((await service.snapshot({ taskId: "task-a" })).elements.find((item) => item.id === "value").value, "alpha");
  assert.equal((await service.snapshot({ taskId: "task-b" })).elements.find((item) => item.id === "value").value, "beta");
  const status = await service.status({ taskId: "task-a" });
  assert.ok(status.tasks.some((item) => item.taskId === "task-a"));
  assert.ok(status.tasks.some((item) => item.taskId === "task-b"));
  const released = await service.releaseTask({ taskId: "task-a", close: true });
  assert.equal(released.closed, true);
});

async function instagramLikeFixture(t) {
  if (!fs.existsSync(chromium.executablePath())) {
    t.skip("Playwright Chromium is not installed");
    return null;
  }
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Direct Inbox Fixture</title><main><h1>Messages</h1><button id="new-message">New message</button><section id="stage"></section></main><script>
      const stage=document.querySelector('#stage');
      document.querySelector('#new-message').onclick=()=>{document.querySelector('#new-message').remove();stage.innerHTML='<label>Search people <input id="search" role="searchbox" aria-label="Search people"></label>';const search=document.querySelector('#search');search.addEventListener('input',()=>{stage.querySelector('#person')?.remove();if(search.value.trim())stage.insertAdjacentHTML('beforeend','<button id="person" aria-label="Raghav Mittal">Raghav Mittal</button>');const person=document.querySelector('#person');if(person)person.onclick=()=>{stage.innerHTML='<h2>Raghav Mittal</h2><label>Message <textarea id="composer" aria-label="Message"></textarea></label><button id="send">Send</button>';document.querySelector('#send').onclick=()=>{const value=document.querySelector('#composer').value;stage.innerHTML='<h2>Raghav Mittal</h2><p id="sent">'+value.replace(/[&<>]/g,'')+'</p><span>Sent</span>'}}})};
    </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-message-fixture-"));
  cleanup.push(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const service = createBrowserAutomationService({ runtimeDir, headless: true, channel: null });
  cleanup.push(() => service.close());
  return { service, runtimeDir, url: `http://127.0.0.1:${server.address().port}/` };
}

test("end-to-end semantic messaging prepares the exact draft without a model call", async (t) => {
  const fixture = await instagramLikeFixture(t);
  if (!fixture) return;
  let plannerCalls = 0;
  const steps = [];
  const agent = createUniversalBrowserAgent({
    browserService: fixture.service,
    runtimeDir: fixture.runtimeDir,
    getSettings: () => ({}),
    planner: async () => { plannerCalls += 1; throw new Error("fixture should stay on the deterministic fast path"); },
  });
  const result = await agent.execute("message Raghav Mittal hi on Instagram but do not send", { taskId: "draft-flow", startUrl: fixture.url, onStep: (step) => steps.push(step) });
  assert.equal(result.success, true);
  assert.equal(plannerCalls, 0);
  assert.match(result.result, /prepared/i);
  assert.ok(steps.some((step) => step.action === "fill" && step.value === "Raghav Mittal"));
  assert.ok(steps.some((step) => step.action === "fill" && step.value === "hi"));
  assert.ok(steps.filter((step) => step.phase === "planned").every((step) => step.model === "local-semantic-fast-path"));
  assert.ok(steps.filter((step) => step.phase === "planned").every((step) => Number.isFinite(step.plannerLatencyMs) && step.plannerAttempts?.length === 1));
});

test("end-to-end semantic messaging pauses at Send then verifies the exact post-send payload", async (t) => {
  const fixture = await instagramLikeFixture(t);
  if (!fixture) return;
  let plannerCalls = 0;
  const agent = createUniversalBrowserAgent({
    browserService: fixture.service,
    runtimeDir: fixture.runtimeDir,
    getSettings: () => ({}),
    planner: async () => { plannerCalls += 1; throw new Error("fixture should stay on the deterministic fast path"); },
  });
  const prepared = await agent.execute("send hi to Raghav Mittal on Instagram", { taskId: "send-flow", startUrl: fixture.url });
  assert.equal(prepared.requiresConfirmation, true);
  assert.match(prepared.pendingAction.pendingAction.label, /send/i);
  const sent = await agent.execute("send hi to Raghav Mittal on Instagram", { taskId: "send-flow", resume: prepared.pendingAction, approvedExternal: true });
  assert.equal(sent.success, true);
  assert.equal(plannerCalls, 0);
  assert.match(sent.result, /verified/i);
  assert.ok(sent.history.some((step) => step.committed === true));
});
