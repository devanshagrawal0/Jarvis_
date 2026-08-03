"use strict";

// B-11 / B-12 — the commit boundary on the visible-desktop lane.
//
// B-11 `capability-engine` passes `resume: args._commitBoundary` when the owner approves; this
//      module never read it and instead received `approvedExternal: true`, restarting the whole
//      vision loop with every commit pre-approved. The action the owner saw was not the action
//      guaranteed to run.
// B-12 (1) the commit gate read model-authored reasoning and DOM labels, so an icon-only or
//      non-English send button clicked with no approval at all; (2) `unapprovedDone` fired on
//      every completion of a commit-verb task, so a send task could never succeed on first pass.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pendingExternalCommit, createCommitApproval } = require("../../server/computer-use");
const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "computer-use.js"), "utf8");

const TASK = 'send an instagram dm to aj saying "hi"';
const typedHistory = [{ action: "fill", value: "hi" }];

// ── B-12(1): under-blocking ────────────────────────────────────────────────
test("B-12 — an icon-only send button after typing still pauses for approval", () => {
  // No accessible name, no reasoning that names a commit verb: the old `explicitControl` test
  // returned false and the click went through unapproved.
  const decision = { action: "click", ref: "ref_9", reasoning: "clicking the blue arrow" };
  const elements = [{ ref: "ref_9", name: "", text: "", ariaLabel: "", type: "button" }];
  const pending = pendingExternalCommit(TASK, decision, elements, typedHistory);
  assert.ok(pending, "a click that follows composing text on a send task must be gated");
  assert.equal(pending.action, "click");
});

test("B-12 — a non-English send label still pauses for approval", () => {
  const decision = { action: "click", ref: "ref_3", reasoning: "presiono el boton" };
  const elements = [{ ref: "ref_3", name: "Enviar", type: "button" }];
  assert.ok(pendingExternalCommit(TASK, decision, elements, typedHistory));
});

test("B-12 — navigating to the right chat is still not a commit", () => {
  // The widened rule must not gate every click, or the lane stops functioning.
  const decision = { action: "click", ref: "ref_1", reasoning: "select the chat for aj in the search results" };
  const elements = [{ ref: "ref_1", name: "aj", type: "listitem" }];
  assert.equal(pendingExternalCommit(TASK, decision, elements, typedHistory), null,
    "search/selection steps must not trip the gate");
});

test("B-12 — a click before anything is typed is not treated as a commit", () => {
  const decision = { action: "click", ref: "ref_2", reasoning: "open the message box" };
  const elements = [{ ref: "ref_2", name: "", type: "div" }];
  assert.equal(pendingExternalCommit(TASK, decision, elements, []), null);
});

test("B-12 — a read-only task is never gated", () => {
  const decision = { action: "click", ref: "ref_4", reasoning: "clicking the blue arrow" };
  assert.equal(pendingExternalCommit("open instagram and check my feed", decision, [{ ref: "ref_4" }], typedHistory), null);
});

// ── B-12(2): the un-satisfiable completion gate ────────────────────────────
test("B-12 — finishing a send task does not itself require confirmation", () => {
  const done = { action: "done", done: true, result: "sent" };
  assert.equal(pendingExternalCommit(TASK, done, [], [{ action: "fill", value: "hi" }, { action: "click" }]), null,
    "a send task must be able to complete; the gate belongs before the commit, not after it");
});

test("B-12 — the un-satisfiable rule is gone from the source, not just unreachable", () => {
  const code = source.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /unapprovedDone/,
    "`(decision.done || action === 'done') && history.length > 0` made every commit-verb task fail its first pass");
});

// ── B-11: scoped resume ────────────────────────────────────────────────────
const APPROVED = { action: "click", ref: "ref_9", elementId: null, key: null, label: "Send" };

test("B-11 — the approved commit is allowed exactly once", () => {
  const approval = createCommitApproval({ resume: APPROVED });
  assert.equal(approval.matches({ ...APPROVED }), true, "the approved action should proceed");
  assert.equal(approval.matches({ ...APPROVED }), false, "one approval must not authorise a second commit");
});

test("B-11 — a different commit in the same resumed run still pauses", () => {
  const approval = createCommitApproval({ resume: APPROVED });
  assert.equal(approval.matches({ action: "click", ref: "ref_42", label: "Delete" }), false,
    "a re-planned run must not be able to commit something the owner never saw");
});

test("B-11 — approving a click does not authorise pressing Enter", () => {
  const approval = createCommitApproval({ resume: APPROVED });
  assert.equal(approval.matches({ action: "press", key: "enter", ref: "ref_9" }), false);
});

test("B-11 — with no resume descriptor the run stays gated rather than fully open", () => {
  assert.equal(createCommitApproval({ approvedExternal: true }).matches({ ...APPROVED }), false,
    "we cannot tell what was approved, so nothing is pre-approved");
  assert.equal(createCommitApproval({}).matches({ ...APPROVED }), false);
});

test("B-11 — the blanket bypass is gone from both loops", () => {
  assert.doesNotMatch(source, /options\.approvedExternal === true \? null :/,
    "`approvedExternal` short-circuited the gate for every commit in the restarted task");
  assert.equal((source.match(/commitApproval\.matches\(proposedCommit\)/g) || []).length, 2,
    "both the playwright and screen loops must scope approval to the approved descriptor");
  assert.equal((source.match(/createCommitApproval\(options\)/g) || []).length, 2,
    "each run needs its own single-use tracker");
});

test("B-11 — capability-engine still supplies the descriptor this depends on", () => {
  // If this plumbing disappears, the fix silently degrades to "always gated".
  const engine = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");
  assert.match(engine, /resume: args\._commitBoundary/, "approval must pass the boundary back in");
  assert.match(engine, /_commitBoundary: result\.pendingAction/, "the boundary must be stored on the confirmation");
});
