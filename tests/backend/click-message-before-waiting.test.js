"use strict";

// The three wasted rounds at the start of every profile-route send.
//
// On the profile route the run lands on the person's profile, where the message box does not exist
// and cannot exist until the "Message" button is clicked to open the chat. But the deterministic
// logic reached its "wait for the composer to render" step first, so it waited — three times, each
// with a full page read — for a box that could not appear until a button it had not pressed yet was
// pressed. The successful live send recorded it exactly:
//
//   1. navigate (profile)
//   2. wait "message composer to render"
//   3. wait "message composer to render"
//   4. wait "message composer to render"
//   5. click "Message"          <- what should have happened at step 2
//   6. fill / 7. click send
//
// The fix: with no composer on the page but a Message button present, click it first. This must NOT
// disturb the saved-conversation route, where the composer is already on screen at the first read
// and there is no Message button to click.

const test = require("node:test");
const assert = require("node:assert/strict");

const { deterministicDecision } = require("../../server/universal-browser-agent");

const OUTCOME = { entities: { messageValues: ["hello there"], people: [] }, commit: { required: true } };
const messageButton = { ref: "e5", role: "button", name: "Message" };
const composer = { ref: "e10", role: "textbox", ariaLabel: "Message" }; // labelled composer, findable
const profileNav = { action: "navigate", url: "https://www.instagram.com/someone/", ok: true };
const openChatClick = { action: "click", ref: "e5", reason: "Click the Message button to open the chat before typing", ok: true };

test("on a profile with no composer, it clicks Message instead of waiting", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: { elements: [messageButton, { ref: "e6", role: "link", name: "Followers" }], pageText: "someone" },
    history: [profileNav],
  });
  assert.equal(decision?.actions?.[0]?.action, "click", "it must open the chat, not wait for a box that cannot exist yet");
  assert.equal(decision.actions[0].ref, "e5", "and click the Message button specifically");
  assert.match(decision.actions[0].reason, /open the chat before typing/i);
});

test("once the chat is open and the composer appears, it types", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: { elements: [composer], pageText: "someone" },
    history: [profileNav, openChatClick],
  });
  assert.equal(decision?.actions?.[0]?.action, "fill", "the composer is now present, so type");
  assert.equal(decision.actions[0].value, "hello there");
});

test("it does not click Message twice", () => {
  // The chat was opened but the composer has not rendered yet. It must wait ONCE, not re-click.
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: { elements: [messageButton], pageText: "someone" }, // Message button still visible, no composer
    history: [profileNav, openChatClick],
  });
  assert.equal(decision?.actions?.[0]?.action, "wait", "after opening the chat once, wait for the box — do not re-open");
});

test("the saved-conversation route is untouched: composer already there, type immediately", () => {
  // No Message button, composer on the first read (the direct /direct/t/ link). This is the fast
  // route the fix must not disturb — it must type at once, with no chat-opening click.
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: { elements: [composer], pageText: "chat" },
    history: [{ action: "navigate", url: "https://www.instagram.com/direct/t/123456/", ok: true }],
  });
  assert.equal(decision?.actions?.[0]?.action, "fill", "a ready composer must be typed into directly");
  assert.equal(decision.actions[0].value, "hello there");
});

test("a disabled Message button is not clicked", () => {
  const decision = deterministicDecision({
    outcome: OUTCOME,
    snapshot: { elements: [{ ...messageButton, disabled: true }], pageText: "someone" },
    history: [profileNav],
  });
  // With nothing to click and no composer, it falls through to the bounded wait, not a click.
  assert.notEqual(decision?.actions?.[0]?.ref, "e5", "a disabled Message button must never be clicked");
});
