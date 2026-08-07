"use strict";

// Waiting for the composer beats paying a model to guess where it is.
//
// On the first snapshot after opening a conversation the composer often has not rendered yet — a
// live run saw 52 controls on that snapshot and 89 on the next. `findMessageComposer` correctly
// found nothing, the deterministic path returned null, and the step fell through to the remote
// planner, which guessed at a field. The composer guard then refused:
//
//   fill  ref=undefined  ok=false
//   "Refused to place the requested message into an unlabeled field; a semantic message composer
//    is required."
//
// The guard was right — typing the owner's message into an unidentified input is the thing it
// exists to prevent — but the detour cost a planner call plus a full re-observation, and the
// composer was simply late.

const test = require("node:test");
const assert = require("node:assert/strict");

const { deterministicDecision } = require("../../server/universal-browser-agent");

const MESSAGE = "hi";
const OUTCOME = { entities: { people: [], messageValues: [MESSAGE] }, commit: { required: true, types: ["send"] } };
const COMPOSER = { ref: "e75", role: "textbox", tag: "div", name: "", placeholder: "Message..." };
const snapshot = (elements) => ({ url: "https://www.instagram.com/direct/t/1234567890/", pageText: "", elements });

// The conversation is open; the composer has not arrived.
const NOT_YET = snapshot([{ ref: "e1", role: "link", tag: "a", name: "Home" }]);
const waitStep = { action: "wait", reason: "Wait for the message composer to render before typing", ok: true };

test("a missing composer produces a wait, not a planner call", () => {
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: NOT_YET, history: [] });
  assert.ok(decision, "returning null here is what handed the step to the planner");
  assert.equal(decision.actions[0].action, "wait");
  assert.equal(decision.model, "local-semantic-fast-path");
});

test("the wait never types anything", () => {
  // The failure being prevented is a fill aimed at a field nobody identified.
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: NOT_YET, history: [] });
  assert.notEqual(decision.actions[0].action, "fill");
  assert.equal(decision.actions[0].value, undefined);
});

test("once the composer arrives it types immediately", () => {
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshot([COMPOSER]), history: [waitStep] });
  assert.equal(decision.actions[0].action, "fill");
  assert.equal(decision.actions[0].ref, "e75");
});

test("waiting is bounded — a page with no composer still reaches the planner", () => {
  // Otherwise a surface that simply has no composer would spin here until the step budget ran out,
  // which is a worse failure than the one being fixed.
  const history = [waitStep, waitStep, waitStep];
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: NOT_YET, history });
  assert.equal(decision, null, "after three waits it must hand over rather than wait forever");
});

test("the message having been typed already does not trigger a wait", () => {
  const typed = [{ action: "fill", ref: "e75", value: MESSAGE, composerFill: true, ok: true }];
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: NOT_YET, history: typed });
  const action = decision?.actions?.[0];
  assert.ok(!action || action.action !== "wait", "nothing to wait for once the message is in the composer");
});
