"use strict";

// What the owner reads before approving, and what happens when approving is not the end of the run.
//
// The card used to render the raw argument bag, so a decision about sending someone a message was
// presented as `_commitBoundary: [object Object]` beside a truncated `task` — under a button that
// said "Approve computer use". And when the approved re-run stopped at a second commit, the reply
// carried a fresh confirmation that every consumer dropped: one surface reported failure, the other
// reported success, and the route marked the task failed, which made the next approval auto-denied.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pendingExternalCommit } = require("../../server/computer-use");

const SEND_TASK = "Open Instagram Direct, open the chat with Sam and send 'hi'";
// The element list belongs to the snapshot the decision came from, so it carries that run's ref.
const commit = (element, decision = { action: "click", ref: "e47" }, context = { url: "https://www.instagram.com/direct/t/1234", title: "Instagram" }) =>
  pendingExternalCommit(SEND_TASK, decision, [{ ref: decision.ref, ...element }], [{ action: "fill", value: "hi" }], context);

test("the boundary says what approving does, in words", () => {
  assert.equal(commit({ name: "Send" }).intent, "Click “Send”");
  assert.equal(commit({ name: "" }).intent, "Click an unlabelled control");
  assert.equal(
    pendingExternalCommit(SEND_TASK, { action: "press", key: "Enter" }, [], [{ action: "fill" }]).intent,
    "Press Enter to send what is in the composer");
});

test("an unnamed control is disclosed, not papered over", () => {
  // The alternative — inventing a confident label from the planner's reasoning — would make the
  // card most reassuring exactly where the machine is least sure.
  assert.match(commit({ name: "" }).intent, /unlabelled/);
  assert.doesNotMatch(commit({ name: "" }).intent, /send/i);
});

test("the card carries where the action lands", () => {
  const pending = commit({ name: "Send" });
  assert.equal(pending.url, "https://www.instagram.com/direct/t/1234");
  assert.equal(pending.pageTitle, "Instagram");
});

test("the destination is shown but never matched on", () => {
  // A re-run that picks up a tracking parameter must not be refused for it — that is the same class
  // of bug as matching on the element ref.
  const { createCommitApproval } = require("../../server/computer-use");
  const approval = createCommitApproval({ resume: commit({ name: "Send" }) });
  const later = commit({ name: "Send" }, { action: "click", ref: "e52" }, { url: "https://www.instagram.com/direct/t/1234?hl=en", title: "Instagram" });
  assert.equal(approval.matches(later), true);
});

// ── the consumers ──────────────────────────────────────────────────────────
const read = (file) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");

test("both chat surfaces handle a re-pause instead of discarding the new card", () => {
  for (const file of ["src/JarvisUI.tsx", "src/SimpleApp.tsx"]) {
    const code = read(file);
    assert.match(code, /status === "confirmation_required"/,
      `${file} must recognise that approving can stop at another commit`);
    assert.match(code, /stopped at another action that needs your approval/,
      `${file} must say so rather than reporting success or failure`);
  }
});

test("the approve route does not fail a task that merely paused again", () => {
  const code = read("server.js");
  assert.match(code, /const repaused = result\?\.status === "confirmation_required"/,
    "a re-pause must be distinguished from a failed execution");
  // The guard that auto-denies approvals for inactive tasks is what made this fatal.
  assert.match(code, /"cancelled", "failed", "blocked", "partial", "delivered"/,
    "the inactive-task guard still exists, so the repause branch must keep the task out of those states");
});

test("the card no longer renders the raw argument bag for a commit", () => {
  const code = read("src/JarvisUI.tsx");
  assert.match(code, /const summary = commit \? "" :/,
    "when a commit boundary exists, the argument dump must not be what the owner reads");
  assert.match(code, /jr-approval-intent/, "the action itself must be rendered");
});

test("the Approve button names the action, not the tool", () => {
  const code = read("src/SimpleApp.tsx");
  assert.match(code, /confirmation\.commit\?\.intent \|\|/,
    "`summary.reason` never existed, so every card read 'Approve computer use'");
});

test("approving shows that work is happening", () => {
  // The run takes seconds and drives a real page; a card that looks unchanged is indistinguishable
  // from a card that did nothing, which is precisely how this was reported.
  const code = read("src/JarvisUI.tsx");
  assert.match(code, /busy \? "Working…" : "Approve once"/);
});
