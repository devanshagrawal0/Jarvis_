"use strict";

// The universal browser lane could send a message through an unlabelled control with no approval.
//
// `commitBoundary` decided whether a click was a commit by reading text: the element's accessible
// name, title, or the planner's own prose, matched against a list of English commit verbs. Every
// one of those is optional on a real page. An icon-only send button with no aria-label, a
// non-English interface, or a planner that writes "clicking the blue arrow" all produced no match,
// the gate returned null, and the click executed unapproved on a task whose entire purpose was to
// send something.
//
// This is B-12(1), which was fixed in computer-use.js and left unfixed here — and this lane, not
// that one, is the lane real browser runs use.
//
// The rule added: on a task that intends an outward commit, a click AFTER text was composed into a
// message composer is a commit candidate regardless of labels. Search and selection steps are
// excluded upstream, so navigating to the right conversation is unaffected.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { commitBoundary } = require("../../server/universal-browser-agent");

const OBJECTIVE = "Send Tg a message saying hi on Instagram";
const OUTCOME = { commit: { required: true }, entities: { people: ["tg"], messageValues: ["hi"] } };

// An icon-only send button: a real control with nothing readable attached to it. This is what
// Instagram's paper-plane button looks like to an accessibility snapshot on a bad day.
const ICON_ONLY = {
  url: "https://www.instagram.invalid/direct/t/1",
  title: "Inbox",
  elements: [
    { ref: "e9", role: "button", tag: "button", name: "", text: "", ariaLabel: "", sensitive: false },
    { ref: "e8", role: "textbox", tag: "div", name: "Message", ariaLabel: "Message" },
  ],
};

const COMPOSED = [{ action: "fill", ref: "e8", value: "hi", targetName: "Message", ok: true }];

test("an unlabelled control clicked after composing is gated", () => {
  const action = { action: "click", ref: "e9", reason: "clicking the blue arrow", expected: "the message appears in the thread" };

  // Without the context there is nothing to reason from, and the old behaviour is preserved.
  assert.equal(commitBoundary(OBJECTIVE, action, ICON_ONLY), null,
    "precondition: nothing in the label, the element, or the planner's prose says 'send'");

  const gated = commitBoundary(OBJECTIVE, action, ICON_ONLY, { outcome: OUTCOME, history: COMPOSED });
  assert.ok(gated, "a click that follows composing on a send task must reach the owner for approval");
  assert.equal(gated.ref, "e9");
  assert.equal(gated.basis, "unlabelled-after-compose", "and must say which rule caught it");
  assert.match(gated.label, /blue arrow|unlabelled/i, "the prompt must describe something the owner can recognise");
});

test("nothing composed yet means nothing to commit", () => {
  // Opening the conversation happens before the message exists. Gating there would prompt the
  // owner for a navigation click, which teaches them to approve without reading.
  const openThread = { action: "click", ref: "e9", reason: "Open the uniquely resolved identity tg", expected: "the conversation opens" };
  assert.equal(commitBoundary(OBJECTIVE, openThread, ICON_ONLY, { outcome: OUTCOME, history: [] }), null);
});

test("filling a search box is not composing", () => {
  // The recipient's name typed into search must not arm the rule; only a message composer counts.
  const history = [{ action: "fill", ref: "e1", value: "tg", targetName: "Search", ok: true }];
  const action = { action: "click", ref: "e9", reason: "clicking the blue arrow", expected: "something happens" };
  assert.equal(commitBoundary(OBJECTIVE, action, ICON_ONLY, { outcome: OUTCOME, history }), null,
    "'Search' is not a composer label, so this click is still navigation");
});

test("a failed fill does not arm the rule", () => {
  const history = [{ action: "fill", ref: "e8", value: "hi", targetName: "Message", ok: false }];
  const action = { action: "click", ref: "e9", reason: "clicking the blue arrow" };
  assert.equal(commitBoundary(OBJECTIVE, action, ICON_ONLY, { outcome: OUTCOME, history }), null,
    "text that never landed cannot be sent");
});

test("a read-only task is not gated even after typing", () => {
  // Typing into a note field on a task with no outward commit must not start prompting.
  const readOnly = { commit: { required: false }, entities: {} };
  const action = { action: "click", ref: "e9", reason: "clicking the blue arrow" };
  assert.equal(commitBoundary("Read my latest messages and summarise them", action, ICON_ONLY, { outcome: readOnly, history: COMPOSED }), null);
});

test("the labelled paths still work and are still distinguishable", () => {
  const labelled = { ...ICON_ONLY, elements: [{ ref: "e9", role: "button", tag: "button", name: "Send", sensitive: true }] };
  const click = commitBoundary(OBJECTIVE, { action: "click", ref: "e9" }, labelled, { outcome: OUTCOME, history: COMPOSED });
  assert.ok(click);
  assert.equal(click.basis, "labelled-control", "a named control is caught by the older, narrower rule");

  const enter = commitBoundary(OBJECTIVE, { action: "press", key: "Enter", reason: "send the message" }, ICON_ONLY, { outcome: OUTCOME, history: COMPOSED });
  assert.ok(enter);
  assert.equal(enter.basis, "terminal-enter");
});

test("the rule is reachable from production, not dead code", () => {
  // `context` is an optional parameter, so every test above passes even if the agent stops
  // supplying it — and the icon-only send button walks straight through in the live path. This is
  // the same failure mode the single-recipient flag had.
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "universal-browser-agent.js"), "utf8");
  assert.match(source, /commitBoundary\(state\.objective, action, snapshot, \{ outcome, history: state\.history \}\)/,
    "the agent must pass the outcome and history into commitBoundary");
});
