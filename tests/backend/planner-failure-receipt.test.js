"use strict";

// What the owner is told when the planner does not answer.
//
// Two separate defects, both found by reading the failure path rather than the happy path:
//
//  1. An aborted fetch surfaces as the bare string "This operation was aborted". That sentence
//     was the ENTIRE explanation the owner received for a dead task. It names no cause, no
//     budget, and no model, and it reads like a crash rather than a timeout.
//
//  2. A planner failure was thrown out of execute() instead of returned. Every other terminal
//     condition in that loop returns a receipt — history, evidence, world model, state path — so
//     this one path silently discarded the record of everything the run had already done and
//     handed the caller an exception object instead.
//
// The second is the more serious: it is the difference between "the run navigated, searched, and
// then the planner timed out" and no information at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createUniversalBrowserAgent,
  PLANNER_ROUTER_TIMEOUT_MS,
  PLANNER_ACTION_TIMEOUT_MS,
} = require("../../server/universal-browser-agent");

const PAGE = {
  url: "https://docs.example.invalid/releases",
  title: "Release notes",
  pageText: "Release notes for the current quarter. Nothing here resembles a person or a control.",
  elements: [
    { ref: "e1", role: "link", tag: "a", name: "Archive", href: "https://docs.example.invalid/archive" },
    { ref: "e2", role: "heading", tag: "h1", name: "Release notes" },
  ],
};

// A browser that reports the same static page forever. The point of these tests is what happens
// above the browser, so the browser must contribute nothing and never fail.
function fakeBrowser() {
  return {
    navigate: async () => ({ url: PAGE.url, title: PAGE.title }),
    snapshot: async () => ({ ...PAGE, elements: PAGE.elements.map((e) => ({ ...e })) }),
    status: async () => ({ tabs: [{ pageId: "p1", url: PAGE.url, title: PAGE.title }] }),
    wait: async () => ({ ok: true }),
    screenshot: async () => ({ path: "/dev/null", url: PAGE.url, title: PAGE.title }),
    releaseTask: async () => ({ ok: true }),
    commit: async () => ({ ok: true }),
    noteSessionStatus: () => {},
  };
}

function makeAgent(overrides = {}) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-receipt-"));
  const agent = createUniversalBrowserAgent({
    browserService: fakeBrowser(),
    runtimeDir,
    getSettings: () => ({ geminiKey: "test-key-not-used-for-a-real-call" }),
    ...overrides,
  });
  return { agent, runtimeDir, cleanup: () => { try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch { /* locked */ } } };
}

const OBJECTIVE = "Read the release notes page and report the latest published version";

test("a planner timeout is reported as a timeout, naming the budget and the model", async () => {
  // Drive the REAL askPlanner — an injected planner would skip the very code being tested — and
  // make the network layer fail exactly the way an aborted fetch does.
  const realFetch = globalThis.fetch;
  const tried = [];
  globalThis.fetch = async (url) => {
    tried.push(String(url).split("/models/")[1]?.split(":")[0] || "?");
    const error = new Error("This operation was aborted");
    error.name = "AbortError";
    throw error;
  };

  const { agent, cleanup } = makeAgent();
  try {
    const result = await agent.execute(OBJECTIVE, { maxSteps: 2 });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/i,
      `the owner must be told this was a timeout, not handed "This operation was aborted" (got: ${result.error})`);
    assert.doesNotMatch(result.error, /^The browser planner could not produce a next action: This operation was aborted/,
      "the raw abort string must not be the whole explanation");

    // The numbers that make the message actionable: which budget was exceeded, and how big the
    // prompt was — the two quantities that distinguish "the model is slow" from "we sent too much".
    const budget = new RegExp(`${PLANNER_ROUTER_TIMEOUT_MS}ms|${PLANNER_ACTION_TIMEOUT_MS}ms`);
    assert.match(result.error, budget, "the message must name the latency budget that was exceeded");
    assert.match(result.error, /prompt \d+ bytes/, "and the payload size, so the two causes can be told apart");

    // Every model in the fallback chain failed, and saying so is a different diagnosis from one
    // model having a bad moment.
    assert.ok(tried.length >= 2, `the fallback chain should have been exhausted (tried: ${tried.join(", ")})`);
    assert.match(result.error, /All \d+ planner models failed/, "an exhausted chain must be reported as such");
    assert.ok(Array.isArray(result.plannerAttempts) && result.plannerAttempts.length >= 2,
      "the per-model attempt record must survive into the receipt");
    assert.ok(result.plannerAttempts.every((a) => a.timedOut === true), "each attempt must be marked as a timeout");
  } finally {
    globalThis.fetch = realFetch;
    cleanup();
  }
});

test("a planner failure returns a receipt instead of throwing away the run", async () => {
  // The run does real work first, so there is something to lose. If the planner failure escapes
  // as an exception, that work is unrecoverable from the caller's point of view.
  let calls = 0;
  const { agent, cleanup } = makeAgent({
    planner: async () => {
      calls += 1;
      if (calls === 1) {
        return { summary: "opening the archive", confidence: 0.9, actions: [{ action: "click", ref: "e1", reason: "the archive holds older releases", expected: "the archive list" }] };
      }
      throw new Error("Gemini 503 Service Unavailable");
    },
  });

  try {
    // assert.rejects would pass on the OLD behaviour, so assert on the returned value instead.
    const result = await agent.execute(OBJECTIVE, { maxSteps: 4 });

    assert.equal(result.success, false, "a planner that cannot answer is not a success");
    assert.equal(result.blocked, true, "and it is a blocked outcome, which the caller already knows how to render");
    assert.match(result.error, /503/, "the underlying reason must survive to the owner");

    // The trail. This is what the throw destroyed.
    assert.ok(Array.isArray(result.history) && result.history.length >= 1,
      "the actions already taken must appear in the receipt, not vanish with the exception");
    assert.equal(result.history[0].action, "click");
    assert.ok(result.statePath && fs.existsSync(result.statePath),
      "the persisted state must be pointed at so the task can be resumed rather than restarted");
    assert.ok(result.world, "the world model must survive");
    assert.equal(result.finalUrl, PAGE.url);
    assert.equal(result.mode, "playwright-universal-v2");
  } finally {
    cleanup();
  }
});

test("a planner that answers with nothing usable is also a receipt, not a crash", async () => {
  // Distinct from a failed call: the model responded, but with no action this runtime can execute.
  const { agent, cleanup } = makeAgent({
    planner: async () => ({ summary: "I am not sure what to do here", blocker: "no recognized control", confidence: 0.2, actions: [{ action: "teleport", ref: "e1" }] }),
  });

  try {
    const result = await agent.execute(OBJECTIVE, { maxSteps: 2 });
    assert.equal(result.success, false);
    assert.equal(result.blocked, true);
    assert.match(result.error, /no valid action/i);
    assert.match(result.error, /no recognized control/, "the planner's own stated blocker must be carried through");
    assert.ok(result.statePath && fs.existsSync(result.statePath));
  } finally {
    cleanup();
  }
});
