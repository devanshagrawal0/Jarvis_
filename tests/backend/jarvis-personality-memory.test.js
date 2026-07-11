const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  RESPONSE_STATES,
  evaluatePersonality,
  polishPersonality,
  renderOperationalResponse,
} = require("../../server/jarvis-personality");
const { createMemoryStore } = require("../../server/memory-store");

const temporaryDirectories = [];
const stores = [];

function memoryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-personality-memory-"));
  temporaryDirectories.push(directory);
  const store = createMemoryStore(directory);
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length) stores.pop().close();
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("operational states produce natural and evidence-aware JARVIS responses", () => {
  const cases = [
    [RESPONSE_STATES.SUCCESS, { result: "The project is open" }, /Done, sir/i],
    [RESPONSE_STATES.APPROVAL, { action: "the email" }, /Approve it and I will proceed/i],
    [RESPONSE_STATES.PARTIAL_SUCCESS, { result: "the draft", blocker: "Gmail is not connected" }, /completed the draft.+but Gmail/i],
    [RESPONSE_STATES.PROVIDER_MISSING, { provider: "Google Workspace", action: "sending the email" }, /not connected yet/i],
    [RESPONSE_STATES.FAILURE, { blocker: "the browser session expired" }, /did not complete/i],
    [RESPONSE_STATES.CLARIFICATION, { question: "Which Alex do you mean, sir?" }, /Which Alex/i],
    [RESPONSE_STATES.RECOVERY, { result: "I retained the verified scan results" }, /first attempt did not complete/i],
  ];
  for (const [state, context, expected] of cases) {
    const response = renderOperationalResponse(state, context);
    assert.match(response, expected);
    assert.equal(evaluatePersonality(response).passed, true);
  }
});

test("robotic command failures are repaired instead of echoed", () => {
  const response = polishPersonality("Cannot do this command: Instagram is not connected");
  assert.doesNotMatch(response, /cannot do this command/i);
  assert.match(response, /Instagram is not connected/i);
  assert.match(response, /closest supported action/i);
});

test("failed, test, and low-value turns never become durable episodes", () => {
  const store = memoryStore();
  store.ingestTurn({
    userText: "Open Instagram.",
    assistantText: "I could not complete the request: Instagram is not connected.",
    source: "chat",
    metadata: { tools: ["open_url"], outcome: "failure" },
  });
  store.ingestTurn({
    userText: "Run the benchmark.",
    assistantText: "The benchmark completed successfully.",
    source: "test-session",
    metadata: { tools: ["benchmark"], outcome: "success" },
  });
  store.ingestTurn({
    userText: "Hello.",
    assistantText: "Understood.",
    source: "chat",
  });
  assert.equal(store.profile().recentEpisodes.length, 0);
});

test("verified outcomes become episodes while corrections supersede old preferences", () => {
  const store = memoryStore();
  store.ingestTurn({
    userText: "Open the Kalshi project.",
    assistantText: "Done, sir. The Kalshi project is open.",
    source: "chat",
    metadata: { tools: ["open_project"], outcome: "success" },
  });
  store.ingestTurn({
    userText: "I prefer concise status updates.",
    assistantText: "Noted.",
    source: "chat",
  });
  store.ingestTurn({
    userText: "Actually, I prefer detailed status updates with evidence.",
    assistantText: "Understood.",
    source: "chat",
  });
  const profile = store.profile();
  assert.equal(profile.recentEpisodes.length, 1);
  assert.equal(profile.semantic.filter((item) => item.category === "preference").length, 1);
  assert.match(profile.semantic.find((item) => item.category === "preference").text, /detailed status updates/i);
});

test("procedural extraction recognizes defaults and explicit behavior changes", () => {
  const store = memoryStore();
  store.ingestTurn({
    userText: "By default, verify a browser action before reporting success. Stop doing long introductions.",
    assistantText: "Understood.",
    source: "chat",
  });
  const procedures = store.profile().procedural.map((item) => item.text).join("\n");
  assert.match(procedures, /verify a browser action/i);
  assert.match(procedures, /Stop doing long introductions/i);
});
