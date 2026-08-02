"use strict";

// B-03 regression: computer_use must not certify its own success.
//
// Both ReAct loops returned `{ success: true }` the instant the planner emitted `done`, with
// nothing re-observed. `capability-engine` maps that to `ok: true`, the receipt records it as
// verified, and the model tells the owner the thing happened. From the production log:
//
//   user:   "you didnt tex him hi do it insta and his chat is open"
//   jarvis: "I have typed \"hi\" and pressed enter in the open chat window for you, Dev."
//   user:   "your lying now"
//
// The headless lane already refuses completions it cannot evidence
// (universal-browser-agent.completionProblems). This asserts the same contract on the two loops
// in computer-use.js, which is the surface the owner actually watches.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Pure predicate, lifted from the shipped source so the test tracks the real code. All fragments
// evaluate in one scope — separately, `COMMITTING_TASK_RE` is undefined and the resulting throw
// would read as "rejected", which is the can't-fail trap this audit is about.
function loadContract() {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "server", "computer-use.js"), "utf8");
  const frag = (marker, end, offset = 2) => {
    const start = src.indexOf(marker);
    assert.notEqual(start, -1, `could not find ${marker}`);
    const stop = src.indexOf(end, start);
    assert.ok(stop > start, `could not find the end of ${marker}`);
    return src.slice(start, stop + offset);
  };
  const bundle = [
    frag("const COMMITTING_TASK_RE =", ";", 1),
    frag("const COMMIT_ACTION_RE =", ";", 1),
    frag("function quotedMessageIn(", "\n}\n"),
    frag("function normalizeText(", "\n}\n"),
    frag("function completionProblems(", "\n}\n"),
    "return completionProblems;",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  return new Function(bundle)();
}

const completionProblems = loadContract();

const SEND_TASK = 'Open the chat and send "hi" to AJ on Instagram';

test("B-03 — a planner that says done without typing or sending is rejected", () => {
  // The incident: navigation happened, nothing else did.
  const history = [
    { action: "navigate", url: "https://instagram.com/direct/inbox/", ok: true },
    { action: "click", ref: "e-4", targetName: "Search", reasoning: "open the conversation", ok: true },
  ];
  const problems = completionProblems(SEND_TASK, history);
  assert.ok(problems.length > 0, "a completion with no typing and no send was accepted");
  assert.match(problems.join(" "), /never typed/, "the missing text should be named");
  assert.match(problems.join(" "), /nothing was committed/, "the missing send should be named");
});

test("B-03 — typing without sending is still not a completion", () => {
  const history = [
    { action: "fill", targetName: "Message", value: "hi", ok: true },
  ];
  const problems = completionProblems(SEND_TASK, history);
  assert.ok(problems.some((p) => /nothing was committed/.test(p)),
    "a draft left in the composer must not report as sent");
  assert.ok(!problems.some((p) => /never typed/.test(p)), "the typing step should be recognised");
});

test("B-03 — sending the WRONG text is not a completion", () => {
  const history = [
    { action: "fill", targetName: "Message", value: "hello there", ok: true },
    { action: "press", key: "Enter", ok: true },
  ];
  const problems = completionProblems(SEND_TASK, history);
  assert.ok(problems.some((p) => /never typed/.test(p)),
    'sending "hello there" must not satisfy a request to send "hi"');
});

test("B-03 — a genuine send passes, by click or by Enter", () => {
  // The contract must not become a mute button; real completions have to survive.
  const viaEnter = [
    { action: "fill", targetName: "Message", value: "hi", ok: true },
    { action: "press", key: "Enter", ok: true },
  ];
  assert.deepEqual(completionProblems(SEND_TASK, viaEnter), [], "an Enter-key send should be accepted");

  const viaClick = [
    { action: "fill", targetName: "Message", value: "hi", ok: true },
    { action: "click", targetName: "Send", reasoning: "commit the message", ok: true },
  ];
  assert.deepEqual(completionProblems(SEND_TASK, viaClick), [], "a Send-button click should be accepted");
});

test("B-03 — failed steps do not count as evidence", () => {
  const history = [
    { action: "fill", targetName: "Message", value: "hi", ok: false },
    { action: "press", key: "Enter", ok: false },
  ];
  assert.ok(completionProblems(SEND_TASK, history).length > 0,
    "steps that failed must not satisfy the contract");
});

test("B-03 — read-only tasks are unaffected", () => {
  // Only committing tasks get the extra bar; "open youtube" finishing is finishing.
  for (const task of ["open youtube", "what is on my screen", "find the latest sidemen video"]) {
    assert.deepEqual(completionProblems(task, [{ action: "navigate", url: "https://youtube.com", ok: true }]), [],
      `a read-only task was wrongly gated: ${task}`);
  }
});

test("B-03 — both loops actually consult the contract", () => {
  // The predicate being correct is worthless if the loops still return success unconditionally.
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "server", "computer-use.js"), "utf8");
  const calls = (src.match(/const problems = completionProblems\(task, history\);/g) || []).length;
  assert.equal(calls, 2, `expected both ReAct loops to check the contract, found ${calls}`);
  assert.equal((src.match(/success: true, verified: true/g) || []).length, 2,
    "a verified success should be the only success either loop can return");
});
