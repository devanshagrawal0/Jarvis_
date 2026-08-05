"use strict";

// The agent opened the right conversation and then walked away from it.
//
// From the persisted state of the real failed Raghav send
// (runtime/universal-browser-tasks/task_msfytwbh_*.json), in order:
//
//   1. navigate  -> instagram.com/direct/inbox/
//   2. click     -> "Raghav Mittal Reacted ... 1d Unread"   => /direct/t/17847063437627518/  CORRECT
//   3. fill      -> "Search"  (6 characters: "Raghav")                                       WRONG
//   4. click     -> "Open the profile page of raghavm_iv"   => /raghavm_iv/                  lost
//   5. navigate  -> /direct/inbox/
//   6. click     -> "Next"
//   7. click     -> the Raghav thread again
//   8-11. extract, click, extract, extract
//
// It never typed a character of the message. The cause is one missing condition: the identity
// search branch tested `person && !filledPerson` and did not care whether the conversation was
// already open. Having just clicked into the right chat, the fast path searched for him again,
// clicked a search result that opened his profile, and lost the composer it already had.
//
// Searching is how you FIND someone. Once their conversation is open, the next step is to write.

const test = require("node:test");
const assert = require("node:assert/strict");

const { deterministicDecision } = require("../../server/universal-browser-agent");

const OUTCOME = { commit: { required: true }, entities: { people: ["Raghav"], messageValues: ["hi"] } };

// The snapshot as it stands after step 2: the thread is open, the composer is present, and the
// inbox search box is still on screen — which is exactly why the old code reached for it.
const OPEN_THREAD = {
  url: "https://www.instagram.com/direct/t/17847063437627518/",
  title: "Instagram • Messages",
  pageText: "Raghav Mittal Active 2h ago. Reacted to your message",
  elements: [
    { ref: "s1", role: "textbox", tag: "input", name: "Search", placeholder: "Search" },
    { ref: "c1", role: "textbox", tag: "div", name: "Message", ariaLabel: "Message" },
    { ref: "b1", role: "button", tag: "button", name: "Send" },
  ],
};

// Step 2, verbatim: the DOM label of the thread row that was clicked.
const OPENED_THE_THREAD = [{
  action: "click",
  ref: "e39",
  targetName: "Raghav Mittal Reacted 😂 to your message · 1d Unread Raghav Mittal Reacted 😂 to your message · 1d Unread",
  ok: true,
}];

test("with the conversation open, the next step is to write, not to search again", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: OPEN_THREAD,
    history: OPENED_THE_THREAD,
    entityHints: [{ kind: "person", query: "Raghav", status: "not_found", candidates: [] }],
  });

  const first = decision?.actions?.[0];
  assert.ok(first, "the fast path should decide this without a planner call");
  assert.equal(first.action, "fill", "the composer is right there");
  assert.equal(first.ref, "c1", "and it is the message box, not the search box");
  assert.equal(first.value, "hi");
  assert.notEqual(first.ref, "s1", "searching again is what lost the conversation last time");
});

test("searching still happens when the conversation is NOT open", () => {
  // The guard must not break finding people. From the inbox with nothing opened yet, searching is
  // still the correct first move.
  const inbox = {
    url: "https://www.instagram.com/direct/inbox/",
    title: "Instagram • Messages",
    pageText: "Messages. Requests.",
    elements: [
      { ref: "s1", role: "textbox", tag: "input", name: "Search", placeholder: "Search" },
      { ref: "r1", role: "button", tag: "div", name: "Yash" },
    ],
  };
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: inbox,
    history: [{ action: "navigate", url: "https://www.instagram.com/direct/inbox/", ok: true }],
    entityHints: [{ kind: "person", query: "Raghav", status: "not_found", candidates: [] }],
  });
  assert.equal(decision?.actions?.[0]?.action, "fill");
  assert.equal(decision.actions[0].ref, "s1", "with no conversation open, search is the way to find him");
  assert.equal(decision.actions[0].value, "Raghav");
});

test("after writing, it proceeds to the send control rather than wandering", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: OPEN_THREAD,
    history: [...OPENED_THE_THREAD, { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true }],
    entityHints: [{ kind: "person", query: "Raghav", status: "not_found", candidates: [] }],
  });
  assert.equal(decision?.actions?.[0]?.action, "click");
  assert.equal(decision.actions[0].ref, "b1");
});

test("the whole sequence never returns to search once the thread is open", () => {
  // Walk the fast path forward the way the runtime does, feeding each decision back as history.
  // The original run oscillated: thread -> search -> profile -> inbox -> thread. Two steps must be
  // enough here, and neither may touch the search field.
  const history = [...OPENED_THE_THREAD];
  const refs = [];
  for (let step = 0; step < 2; step += 1) {
    const decision = deterministicDecision({
      outcome: OUTCOME,
      snapshot: OPEN_THREAD,
      history,
      entityHints: [{ kind: "person", query: "Raghav", status: "not_found", candidates: [] }],
    });
    const action = decision?.actions?.[0];
    assert.ok(action, `step ${step + 1} produced no decision`);
    refs.push(action.ref);
    history.push({ ...action, targetName: action.ref === "c1" ? "Message" : "Send", ok: true });
  }
  assert.deepEqual(refs, ["c1", "b1"], "write, then send — no detour");
  assert.equal(refs.includes("s1"), false, "the search box must never be touched again");
});
