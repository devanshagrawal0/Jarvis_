"use strict";

// The instruction Jarvis writes for itself must not be scraped for fake entities.
//
// The profile route worked, then a "safer" verbose rewrite of its instruction broke it — not the
// browser, the WORDS. The entity compiler reads the task string for recipients and messages, and a
// paragraph of warnings ("do not search for anyone", "the search matches group conversations", the
// quoted "Message" button) handed it three fake recipients and a second message:
//
//   people:        ["open", "anyone", "matches"]
//   messageValues: ["Message", "profile route test"]
//
// Two message values means the deterministic "type the one message and send it" step cannot tell
// which to send, so every step fell through to the remote planner — which then failed on the heavy
// DM page and the send died. The fix was to make the instruction short and quote only the message.
// This pins that property directly, because it is invisible until a live run and expensive to learn
// there.

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileOutcome } = require("../../server/automation/outcome-compiler");

// The exact shape capability-engine builds for the profile route (openExactly + the payload).
function profileRouteTask(message, { commit = true } = {}) {
  const openExactly = "Click the Message button on this profile";
  return `${openExactly}, then type ${JSON.stringify(message)} into the message box${commit ? ", then send it." : " and leave it unsent."}`;
}

test("the profile-route instruction names no recipient of its own", () => {
  // person must stay empty: the profile URL already fixes who this goes to, and a phantom recipient
  // pulled from the prose makes the send logic wait to "resolve" someone who was never named.
  const outcome = compileOutcome(profileRouteTask("profile route test"));
  assert.deepEqual(outcome.entities.people, [],
    `the instruction leaked a recipient: ${JSON.stringify(outcome.entities.people)}`);
});

test("exactly one message survives, and it is the real one", () => {
  const outcome = compileOutcome(profileRouteTask("hello there"));
  assert.deepEqual(outcome.entities.messageValues, ["hello there"],
    "a second 'message' scraped from the prose is what stops the send deciding what to type");
});

test("a message that contains loaded words is still a single clean message", () => {
  // The words that leaked last time, now INSIDE the legitimate message. They must ride along as the
  // message, not re-appear as recipients.
  const outcome = compileOutcome(profileRouteTask("can you open the door for anyone"));
  assert.deepEqual(outcome.entities.messageValues, ["can you open the door for anyone"]);
  assert.deepEqual(outcome.entities.people, []);
});

test("the send intent is preserved", () => {
  assert.equal(compileOutcome(profileRouteTask("hi")).commit.required, true);
  assert.equal(compileOutcome(profileRouteTask("hi", { commit: false })).commit.required, false);
});

test("the verbose instruction that broke it would fail this test", () => {
  // Guards the guard: prove these assertions actually catch the regression, using the real string
  // that shipped and broke the live send.
  const verbose = `You are on @someone's Instagram profile. Click the "Message" button on this profile to open a one-to-one chat with them. Do not go to the Direct inbox and do not search for anyone - the search matches group conversations as well as people. Then type "profile route test" into the message input, then send it.`;
  const outcome = compileOutcome(verbose);
  const leaked = outcome.entities.people.length > 0 || outcome.entities.messageValues.length !== 1;
  assert.ok(leaked, "if the verbose form no longer leaks, these assertions have lost their teeth");
});
