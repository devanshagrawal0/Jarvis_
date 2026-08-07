"use strict";

// Sending to a saved contact should not need a model at all.
//
// The composer was already found structurally (`findMessageComposer`) and filled with zero planner
// calls. The SEND step then looked for a control labelled `send` — and Instagram's send control is
// an unlabelled `div[role=button]` that does not even exist until text has been typed. So the last
// step of every message fell through to the remote planner: several seconds when it answered, a
// dead task when it did not. Live runs died there repeatedly.
//
// Enter in the composer is Instagram's real send. These tests pin that it is chosen deterministically
// AND that it still trips the approval gate — an Enter that sends without approval is far worse than
// a slow one.

const test = require("node:test");
const assert = require("node:assert/strict");

const { commitBoundary, deterministicDecision, findMessageComposer } = require("../../server/universal-browser-agent");

const MESSAGE = "hi";
const OUTCOME = { entities: { people: [], messageValues: [MESSAGE] }, commit: { required: true, types: ["send"] } };

// An Instagram thread: an unlabelled contenteditable composer and no control named "send".
const COMPOSER = { ref: "e75", role: "textbox", tag: "div", name: "", text: "", ariaLabel: "", placeholder: "Message..." };
const snapshotWith = (extra = []) => ({
  url: "https://www.instagram.com/direct/t/1234567890/",
  pageText: "Message...",
  elements: [
    { ref: "e10", role: "link", tag: "a", name: "Home" },
    COMPOSER,
    ...extra,
  ],
});
// What the agent records after typing: `composerFill` is the stamp `messagePrepared` requires.
const FILLED = [{ action: "fill", ref: "e75", value: MESSAGE, composerFill: true, ok: true }];

test("the composer is found without a model", () => {
  const found = findMessageComposer(snapshotWith().elements);
  assert.ok(found?.element?.ref, "an unlabelled composer must still be identified structurally");
  assert.equal(found.element.ref, "e75");
});

test("sending needs no planner call when nothing is labelled Send", () => {
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshotWith(), history: FILLED });
  assert.ok(decision, "returning null here is what handed the last step to the remote planner");
  const action = decision.actions[0];
  assert.equal(action.action, "press");
  assert.equal(action.key, "Enter");
  assert.equal(action.ref, "e75", "Enter must be pressed in the composer, not somewhere else");
  assert.equal(decision.model, "local-semantic-fast-path");
});

test("a real labelled Send control is still preferred over Enter", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: snapshotWith([{ ref: "e80", role: "button", tag: "button", name: "Send" }]),
    history: FILLED,
  });
  assert.equal(decision.actions[0].action, "click");
  assert.equal(decision.actions[0].ref, "e80");
});

const gateFor = (action, objective = "send hi to the saved contact on instagram") =>
  commitBoundary(objective, action, snapshotWith(), { outcome: OUTCOME, history: FILLED });

test("the deterministic Enter still stops at the approval gate", () => {
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshotWith(), history: FILLED });
  const pending = gateFor(decision.actions[0]);
  assert.ok(pending, "an unapproved Enter would send the message with nobody having agreed to it");
  assert.equal(pending.action, "press");
  assert.match(String(pending.key), /enter/i);
});

test("the gate does not depend on how the action is worded", () => {
  // This is the assertion the previous version only appeared to make: it passed either way, so it
  // could not tell a safe gate from a wording coincidence.
  //
  // `commitBoundary` has two independent routes to gating a keypress — `terminalEnter`, which reads
  // the action's prose for a commit word, and `unlabelledCommit`, which reads the run's own state
  // (commit intent + text already composed). Prose is a claim; state is evidence. If the gate were
  // holding only because this action happens to say "Send", then any rephrasing — by a future edit
  // or a model — would silently start sending messages nobody approved.
  const stripped = { action: "press", ref: "e75", key: "Enter", reason: "press the key", expected: "done" };
  assert.ok(gateFor(stripped), "the gate must hold on evidence, not on the word 'Send' appearing");

  // And it must still hold when the objective is wordless too, leaving only run state.
  assert.ok(gateFor(stripped, "do the thing"), "state alone must be enough to gate a commit");
});

test("the wording rule independently gates when there is no composed-text evidence", () => {
  // The other half of the redundancy, pinned so it is a fact rather than an assumption. With no
  // composer fill in history the state-based rule cannot fire, and only the wording is left. Both
  // rules must be able to gate alone, or "belt-and-braces" is one belt.
  const noComposedText = commitBoundary(
    "send hi to the saved contact on instagram",
    { action: "press", ref: "e75", key: "Enter", reason: "Send the exact prepared message", expected: "the message appears" },
    snapshotWith(),
    { outcome: OUTCOME, history: [] },
  );
  assert.ok(noComposedText, "an Enter that announces a send must gate even with no other evidence");
});

test("the send is not pressed twice", () => {
  const history = [...FILLED, { action: "press", ref: "e75", key: "Enter", ok: true }];
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshotWith(), history });
  // Either nothing further, or something that is not another Enter — never a second send.
  const action = decision?.actions?.[0];
  assert.ok(!action || !(action.action === "press" && /^enter$/i.test(String(action.key || ""))),
    "one message, one send");
});

test("Enter is not offered before the message has been typed", () => {
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshotWith(), history: [] });
  const action = decision?.actions?.[0];
  assert.ok(!action || action.action !== "press",
    "pressing Enter into an empty composer sends nothing and burns the one allowed send");
});

test("a fill that never landed in the composer does not unlock the send", () => {
  // `composerFill` is the stamp that says the text went into the message box rather than a search
  // field. Without it, an Enter would fire on whatever was focused.
  const strayFill = [{ action: "fill", ref: "e99", value: MESSAGE, ok: true }];
  const decision = deterministicDecision({ outcome: OUTCOME, snapshot: snapshotWith(), history: strayFill });
  const action = decision?.actions?.[0];
  assert.ok(!action || action.action !== "press", "only a real composer fill unlocks the send");
});
