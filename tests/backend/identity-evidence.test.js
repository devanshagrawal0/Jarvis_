"use strict";

// Two gates in the universal browser lane accepted the planner's own prose as evidence.
//
// A model-authored `reason` string is a claim about the world. `targetName` is built by the agent
// from the snapshot element a click actually landed on, and page text is what the browser rendered.
// Those are observations. The distinction is the whole difference between a check and a formality.
//
//  1. `deterministicDecision.identityChosen` — what unlocks the send step. It accepted a click whose
//     reason matched /resolved|selected|exact/ near "recipient" and mentioned the name. A planner
//     that clicks the wrong row while narrating "selected recipient tg" advanced to the send
//     control against a conversation with someone else.
//
//  2. `completionProblems` recipient verification. The click branch matched
//     /identity|conversation|recipient|chat/ against the planner's reason, so "Open the chat list"
//     satisfied "the intended recipient is evidenced". That branch only runs when the recipient is
//     NOT visible on the page — precisely when a self-authored claim deserves the least trust.
//
// Neither gate could fail against a planner that describes its actions favourably, which is the
// default behaviour of a model asked to explain itself.

const test = require("node:test");
const assert = require("node:assert/strict");

const { deterministicDecision, completionProblems, visiblyContains } = require("../../server/universal-browser-agent");

const OUTCOME = {
  commit: { required: true },
  entities: { people: ["tg"], messageValues: ["hi"] },
  completionContract: { requireRecipientVerification: true },
};

// A thread that belongs to someone else. Nothing on this page names Tg.
const WRONG_THREAD = {
  url: "https://www.instagram.invalid/direct/t/9",
  title: "Inbox",
  pageText: "Raghav Mittal. Active now. hey what's up",
  elements: [
    { ref: "c1", role: "textbox", tag: "div", name: "Message", ariaLabel: "Message" },
    { ref: "c2", role: "button", tag: "button", name: "Send" },
  ],
};

// The same page, but the conversation really is with Tg.
const RIGHT_THREAD = { ...WRONG_THREAD, pageText: "Tg. Active 1m ago. hey" };

// The planner searched, then clicked something unrelated while describing it flatteringly.
const FLATTERING_HISTORY = [
  { action: "fill", ref: "s1", value: "tg", targetName: "Search", ok: true },
  { action: "click", ref: "x1", targetName: "Raghav Mittal", reason: "selected recipient tg", expected: "the conversation with tg opens", ok: true },
];

test("a planner cannot talk its way into the send step", () => {
  // The message must already be composed, or the run stops short of the send step for an unrelated
  // reason and the assertion proves nothing. An earlier version of this test asserted inside an
  // `if (action === "click")` that never fired — a check that could not fail, in a file about
  // checks that cannot fail. Mutation testing is what caught it.
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: WRONG_THREAD,
    history: [...FLATTERING_HISTORY, { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true }],
    entityHints: [{ kind: "person", query: "tg", status: "not_found", candidates: [] }],
  });

  // Everything is staged: the message is in the composer and a Send button is on screen. The only
  // thing standing between this run and a message to the wrong person is whether the planner's own
  // sentence counts as having resolved the recipient. It must not.
  const first = decision?.actions?.[0];
  assert.notEqual(first?.ref, "c2",
    "the send control was reached on the strength of the planner's own description of its click");
  assert.notEqual(first?.action, "complete", "and it must not be declared done either");
});

test("the same claim is accepted once the page corroborates it", () => {
  // The guard must not make legitimate flows impossible. Where the row carried no usable label but
  // the opened thread does name the person, the claim is corroborated and stands.
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: RIGHT_THREAD,
    history: [
      ...FLATTERING_HISTORY,
      { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true },
    ],
    entityHints: [{ kind: "person", query: "tg", status: "not_found", candidates: [] }],
  });
  assert.equal(decision?.actions?.[0]?.action, "click");
  assert.equal(decision.actions[0].ref, "c2", "with the page naming Tg, sending is the correct next step");
});

test("a DOM-authored label alone is sufficient, with no prose at all", () => {
  // The honest path: the click landed on an element the snapshot says is named Tg.
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: WRONG_THREAD,
    history: [
      { action: "fill", ref: "s1", value: "tg", targetName: "Search", ok: true },
      { action: "click", ref: "x1", targetName: "Tg", ok: true },
      { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true },
    ],
    entityHints: [{ kind: "person", query: "tg", status: "not_found", candidates: [] }],
  });
  assert.equal(decision?.actions?.[0]?.ref, "c2",
    "evidence from the DOM needs no narration to count");
});

test("a completion claim is not evidenced by the planner mentioning the word 'chat'", () => {
  const state = {
    outcome: OUTCOME,
    history: [
      { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true },
      { action: "click", ref: "x1", targetName: "Direct", reason: "open the chat list", ok: true, committed: true },
    ],
    evidence: [],
    knownFiles: [],
  };

  const problems = completionProblems(state, WRONG_THREAD);
  assert.ok(problems.some((p) => /recipient/i.test(p)),
    `a click described as opening "the chat list" is not recipient verification (problems: ${JSON.stringify(problems)})`);
});

test("a completion claim survives on real recipient evidence", () => {
  // Clicking an element the snapshot names, on a page that shows the sent text.
  const state = {
    outcome: OUTCOME,
    history: [
      { action: "click", ref: "x1", targetName: "Tg", ok: true },
      { action: "fill", ref: "c1", value: "hi", targetName: "Message", ok: true },
      { action: "click", ref: "c2", targetName: "Send", ok: true, committed: true },
    ],
    evidence: [],
    knownFiles: [],
  };
  const problems = completionProblems(state, { ...RIGHT_THREAD, pageText: "Tg. Active 1m ago. hey hi" });
  assert.deepEqual(problems, [], "an honestly evidenced send must still be accepted");
});

// ── visiblyContains ───────────────────────────────────────────────────────────
// Found while building the tests above: a thread header rendering "Tg." did not match "tg".
// canonicalVisibleText preserves . _ and - because handles depend on them, so an edge period
// defeated the match. That is not the safe direction of failure — this function is how the runtime
// decides whether an executed send is verified, and failing to see a delivered message makes the
// agent treat the send as unconfirmed and try again.

test("punctuation attached to a name does not hide it", () => {
  assert.ok(visiblyContains("Tg. Active 1m ago", "tg"), "a thread header ending in a period is the same person");
  assert.ok(visiblyContains("You sent: hi.", "hi"), "and a sent bubble ending in a period is the same message");
  assert.ok(visiblyContains("-Tg-", "tg"));
});

test("but a handle is still a distinct identity", () => {
  // The reason the punctuation is preserved in the first place. Trimming happens only at token
  // edges, so an interior separator keeps the token whole.
  assert.equal(visiblyContains("messaged dev.agrawal", "dev"), false, "dev.agrawal is not dev");
  assert.equal(visiblyContains("open dev_2 profile", "dev"), false);
  assert.equal(visiblyContains("hit send", "hi"), false, "and a prefix is still not a match");
  assert.equal(visiblyContains("Tg. Active", ""), false, "an empty needle matches nothing");
});

test("an addressed email field still counts without any click", () => {
  // Mail surfaces have no thread to open; the recipient is a field value. That branch pairs a
  // DOM-authored label with the recipient's actual value, so it was already an observation.
  const state = {
    outcome: {
      commit: { required: true },
      entities: { people: ["dev@example.com"], messageValues: ["hi"] },
      completionContract: { requireRecipientVerification: true },
    },
    history: [
      { action: "fill", ref: "t1", value: "dev@example.com", targetName: "To recipient", ok: true },
      { action: "fill", ref: "b1", value: "hi", targetName: "Message body", ok: true },
      { action: "click", ref: "s1", targetName: "Send", ok: true, committed: true },
    ],
    evidence: [],
    knownFiles: [],
  };
  const problems = completionProblems(state, { pageText: "Message sent. hi" });
  assert.ok(!problems.some((p) => /recipient/i.test(p)), `problems: ${JSON.stringify(problems)}`);
});
