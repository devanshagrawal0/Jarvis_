"use strict";

// JARVIS told its owner a message had been sent when nothing had been typed.
//
// The real exchange, from runtime/conversation.json:
//
//     owner : "send raghav hi on instagram"
//     JARVIS: "Done, sir. The verified result is:
//              - browser_status completed: activePage: pageId: page-2,
//                url: https://www.instagram.com/direct/t/17847063437627518/ ..."
//
// `browser_status` is registered at risk "observe": it answers "which page is the browser looking
// at" and changes nothing. It answered successfully. The summary counted any successful tool as
// proof of completion, so the owner was told the send was done AND verified. The browser run behind
// it never typed a character.
//
// The claim could not fail. Every request that ran any tool at all ended in "Done, sir."
//
// These tests use the tool names and risk tiers as registered in capability-engine.js, and the
// last case asserts against the live registry so the rule cannot quietly stop matching reality.

const test = require("node:test");
const assert = require("node:assert/strict");

const { changedSomething, classifyToolResults, summaryPrefix } = require("../../server/tool-result-honesty");

const OBSERVE = new Set(["browser_status", "browser_snapshot", "screen_capture", "apex_market_snapshot"]);

const summarize = (toolResults) => summaryPrefix(classifyToolResults(toolResults, OBSERVE));

test("looking at a page is not sending a message", () => {
  // The exact shape of the incident.
  const results = [{
    tool: "browser_status",
    ok: true,
    result: { activePage: { pageId: "page-2", url: "https://www.instagram.com/direct/t/17847063437627518/" } },
  }];

  const prefix = summarize(results);
  assert.doesNotMatch(prefix, /^Done/,
    "a status read must never be reported as the requested action having happened");
  assert.match(prefix, /didn'?t complete/i, "and the owner must be told plainly that it did not happen");
});

test("several observations are still no observations", () => {
  // Volume is not evidence. Three successful looks are three looks.
  const prefix = summarize([
    { tool: "browser_status", ok: true, result: {} },
    { tool: "browser_snapshot", ok: true, result: { elements: 240 } },
    { tool: "screen_capture", ok: true, result: { dimensions: "1920x1080" } },
  ]);
  assert.doesNotMatch(prefix, /^Done/);
});

test("a real action still reports as done", () => {
  // The guard must not make success unreportable, or it is just a different lie.
  const prefix = summarize([
    { tool: "browser_status", ok: true, result: {} },
    { tool: "computer_use", ok: true, result: { completed: true, result: "The message is visible in the conversation" } },
  ]);
  assert.match(prefix, /^Done/);
});

test("an action that paused for approval is not done", () => {
  // This is the commit boundary working correctly. Reporting it as "Done" would train the owner to
  // ignore the approval prompt that is the whole safety mechanism.
  const prefix = summarize([
    { tool: "computer_use", ok: true, result: { requiresConfirmation: true, result: "Prepared up to the external commit" } },
  ]);
  assert.doesNotMatch(prefix, /^Done/);
});

test("an action that stopped at a login wall or a block is not done", () => {
  for (const result of [{ requiresLogin: true }, { blocked: true }, { completed: false }, { cancelled: true }]) {
    assert.equal(changedSomething({ tool: "computer_use", ok: true, result }, OBSERVE), false,
      `${JSON.stringify(result)} is a failure wearing a successful envelope`);
  }
});

test("a confirmation still reads as ready, not done", () => {
  const prefix = summarize([
    { tool: "computer_use", status: "confirmation_required", ok: false, confirmation: { summary: { reason: "Send the message" } } },
  ]);
  assert.match(prefix, /^Ready/);
});

test("nothing succeeding reads as a failure", () => {
  assert.match(summarize([{ tool: "computer_use", ok: false, error: "planner timed out" }]), /could not complete/i);
  assert.match(summarize([]), /could not complete/i);
});

test("the observe tier used by the rule matches the live registry", () => {
  // The rule keys off the risk tier registered in capability-engine.js. If browser_status were
  // retiered, or the registry stopped carrying `risk`, every test above would still pass while the
  // live path went back to calling a page-status read a completed send.
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");
  assert.match(source, /\["browser_status",[^\]]*"observe"/,
    "browser_status must remain an observe-tier tool for this rule to catch the original bug");

  const server = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  assert.match(server, /classifyToolResults\(toolResults, observeOnlyTools\(\)\)/,
    "server.js must build its summary through the tested classifier");
  assert.match(server, /item\.risk === "observe"/,
    "and must derive the observe set from the registry rather than a hand-maintained list");
  assert.doesNotMatch(server, /const prefix = completed\.length/,
    "the old any-tool-succeeded prefix must be gone");
});
