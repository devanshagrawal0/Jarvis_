"use strict";

// Pressing Approve did nothing, and it could never have done anything.
//
// Approving does not resume the paused run — `approveConfirmation` re-executes the task from the
// beginning with `confirmed: true`. That re-run takes a FRESH DOM snapshot, so every element gets a
// fresh ref. The approval matcher required `pending.ref === approved.ref`, so the agent would walk
// back to the very same Send button, compare the new ref against the approved one, refuse, and
// raise a second approval card. Approve, nothing happens, approve again, nothing happens.
//
// These tests pin the two halves that matter: an approval must survive re-identification of the
// same control, and must NOT stretch to cover a different action, a different instruction, or a
// second commit.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCommitApproval, pendingExternalCommit } = require("../../server/computer-use");

const SEND_TASK = "Open Instagram Direct, open the chat with Sam and send 'hi'";

// What the gate produces on a run: composing text, then clicking the send control.
function commitFor({ ref, task = SEND_TASK, name = "", action = "click" }) {
  const elements = [{ ref, name }];
  const history = [{ action: "fill", ref: "e10" }];
  return pendingExternalCommit(task, { action, ref, reasoning: "clicking send" }, elements, history);
}

test("an approval survives the re-run it triggers", () => {
  // The exact reported bug. First run offers the control as e47; the owner approves; the re-run
  // finds the same control as e52 because the snapshot is new.
  const firstRun = commitFor({ ref: "e47" });
  assert.ok(firstRun, "composing then clicking must be treated as a commit");

  const approval = createCommitApproval({ resume: firstRun });
  const secondRun = commitFor({ ref: "e52" });

  assert.equal(approval.matches(secondRun), true,
    "a fresh ref for the same control on the same task must still count as approved");
});

test("one approval authorises exactly one commit", () => {
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47" }) });
  assert.equal(approval.matches(commitFor({ ref: "e52" })), true);
  assert.equal(approval.matches(commitFor({ ref: "e60" })), false,
    "the approval is spent — a second send needs its own approval");
});

test("an approval does not carry over to a different instruction", () => {
  // The dangerous direction of loosening the match: approving "send hi to Sam" must never authorise
  // a commit belonging to some other task.
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47" }) });
  const otherTask = commitFor({ ref: "e47", task: "Open Instagram Direct, open the chat with Casey and send 'hi'" });
  assert.equal(approval.matches(otherTask), false);
});

test("approving a click does not approve pressing Enter", () => {
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47", action: "click" }) });
  const enterCommit = pendingExternalCommit(SEND_TASK, { action: "press", key: "Enter", ref: "e47" }, [{ ref: "e47" }], [{ action: "fill" }]);
  assert.ok(enterCommit, "enter-after-typing is itself a commit");
  assert.equal(approval.matches(enterCommit), false);
});

test("approving one click does not approve a double click", () => {
  // Isolates the action guard from the key guard: both descriptors carry no key, so only the
  // action distinguishes them. A double click on Send can send twice.
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47", action: "click" }) });
  assert.equal(approval.matches(commitFor({ ref: "e52", action: "double_click" })), false);
});

test("Enter and Return are the same key", () => {
  // The bug being fixed, in miniature: the planner may word the same physical keypress either way
  // across the two runs, and a literal comparison would refuse the owner's own approval again.
  const press = (key) => pendingExternalCommit(SEND_TASK, { action: "press", key, ref: "e47" }, [{ ref: "e47" }], [{ action: "fill" }]);
  const approval = createCommitApproval({ resume: press("Enter") });
  assert.equal(approval.matches(press("Return")), true);
});

test("approving Enter does not approve some other keypress", () => {
  // Hand-built descriptors: today's gate only emits enter/return for `press`, so this guard is not
  // reachable through it. `createCommitApproval` is exported and takes any descriptor, and a
  // safety primitive must not depend on its only current caller staying narrow.
  const approval = createCommitApproval({ resume: { action: "press", key: "Enter", task: SEND_TASK, targetName: "" } });
  assert.equal(approval.matches({ action: "press", key: "Escape", task: SEND_TASK, targetName: "" }), false);
});

test("approving Send does not approve Delete", () => {
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47", name: "Send" }) });
  assert.equal(approval.matches(commitFor({ ref: "e52", name: "Delete chat" })), false);
  const fresh = createCommitApproval({ resume: commitFor({ ref: "e47", name: "Send" }) });
  assert.equal(fresh.matches(commitFor({ ref: "e52", name: "Send" })), true);
});

test("identity comes from every DOM fact, not just the name", () => {
  // Two unnamed controls the page still describes differently — a link vs a button — must not be
  // interchangeable. Only the ref differs between snapshots; everything else describes the element.
  const el = (extra) => pendingExternalCommit(SEND_TASK, { action: "click", ref: "e47" },
    [{ ref: "e47", name: "", ...extra }], [{ action: "fill" }]);
  const approval = createCommitApproval({ resume: el({ role: "button", tag: "div" }) });
  assert.equal(approval.matches(el({ role: "link", tag: "a", href: "https://example.test/delete" })), false);
});

test("an unnamed control still works — Instagram's send button has no accessible name", () => {
  // Requiring a name would have recreated the same dead end for the one surface this was built for.
  const approval = createCommitApproval({ resume: commitFor({ ref: "e47", name: "" }) });
  assert.equal(approval.matches(commitFor({ ref: "e52", name: "" })), true);
});

test("a descriptor with no signature at all does not match on nothing", () => {
  // Confirmations persisted before signatures existed. An empty signature on both sides must not
  // read as "identity verified" — the descriptor falls back to the identity it does carry.
  const approval = createCommitApproval({ resume: { action: "click", label: "Send", task: SEND_TASK } });
  assert.equal(approval.matches({ action: "click", label: "Delete", task: SEND_TASK }), false);
  const fresh = createCommitApproval({ resume: { action: "click", label: "Send", task: SEND_TASK } });
  assert.equal(fresh.matches({ action: "click", label: "Send", task: SEND_TASK }), true);
});

test("no approval means no commit", () => {
  const none = createCommitApproval({});
  assert.equal(none.matches(commitFor({ ref: "e47" })), false);
  assert.equal(none.matches(null), false);
});

test("the pending action carries a DOM-authored identity, not planner prose", () => {
  // `label` deliberately blends the model's reasoning with page text — good for showing a human,
  // useless as an identity, because the model can word the second run differently and the same
  // button would stop matching itself.
  const commit = pendingExternalCommit(SEND_TASK,
    { action: "click", ref: "e47", reasoning: "I will now click the blue arrow to deliver it" },
    [{ ref: "e47", name: "Send" }], [{ action: "fill" }]);
  assert.equal(commit.targetName, "Send", "identity comes from the element, not the reasoning");
  assert.match(commit.label, /blue arrow/, "the human-facing label may still quote the planner");
});
