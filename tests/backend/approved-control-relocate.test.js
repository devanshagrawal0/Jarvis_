"use strict";

// The owner approved, and nothing was sent.
//
// Approving replays the exact element that was approved, by its ref. A ref is a slot in one
// snapshot, and a live messaging site re-renders its thread list continuously — so the element can
// detach while the approval card is on screen. The live failure was:
//
//   "Element reference e17 is stale. Take a new browser snapshot."   (HTTP 400, after approval)
//
// on a run that had sat at the boundary for 207 seconds. The faster path survived it purely by
// being quick. Re-finding the control by the signature the PAGE supplied fixes it — but only when
// that is unambiguous, because guessing which control to click is the exact thing an approval gate
// exists to prevent.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { commitBoundary, elementSignature } = require("../../server/universal-browser-agent");

const SEND = { ref: "e17", role: "button", tag: "div", name: "", text: "", ariaLabel: "", placeholder: "", title: "", href: "", id: "" };
const snapshotWith = (elements) => ({ url: "https://www.instagram.com/direct/t/1234567890/", pageText: "hi", elements });

test("the approved commit records what the page said about the control", () => {
  const pending = commitBoundary(
    "send hi to the contact on instagram",
    { action: "click", ref: "e17", reason: "Send the exact prepared message", expected: "the message appears" },
    snapshotWith([SEND]),
    { outcome: { commit: { required: true } }, history: [{ action: "fill", composerFill: true, ok: true }] },
  );
  assert.ok(pending, "this must still be gated");
  assert.ok(pending.targetSignature, "without a signature there is nothing to re-find a dead handle with");
  assert.equal(pending.targetSignature, elementSignature(SEND));
});

test("the signature survives the ref changing", () => {
  // The whole point: same control, new snapshot, different slot number.
  assert.equal(elementSignature({ ...SEND, ref: "e17" }), elementSignature({ ...SEND, ref: "e42" }));
});

test("the signature distinguishes genuinely different controls", () => {
  assert.notEqual(elementSignature(SEND), elementSignature({ ...SEND, role: "link", href: "https://example.test/delete" }));
  assert.notEqual(elementSignature(SEND), elementSignature({ ...SEND, name: "Delete chat" }));
});

test("the signature ignores the ref and anything a model wrote", () => {
  const sig = elementSignature(SEND);
  assert.ok(!sig.includes("e17"), "a slot number is not an identity — that assumption caused this bug");
  assert.ok(!sig.includes("reason"));
});

test("re-locating refuses to guess", () => {
  // Asserted on the shipped source: the recovery must require EXACTLY one match. Clicking the first
  // of several look-alike controls after the page changed would send to whatever moved into place.
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "universal-browser-agent.js"), "utf8");
  assert.match(source, /if \(matches\.length !== 1\) \{/,
    "the relocate path must abort unless exactly one element matches");
  assert.match(source, /Nothing was sent/,
    "a failed relocate must say plainly that nothing went out");
});

test("re-locating only happens for a stale handle, and only with a signature", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server", "universal-browser-agent.js"), "utf8");
  assert.match(source, /if \(!\/stale\/i\.test\(String\(error\?\.message \|\| ""\)\) \|\| !signature\) throw error;/,
    "any other failure must surface as itself rather than being retried against a fresh page");
});

test("an unnamed control still produces a usable signature", () => {
  // Instagram's send control has no accessible name at all. A signature that collapsed to nothing
  // would either match everything or match nothing, and both are dangerous.
  const sig = elementSignature(SEND);
  assert.ok(sig.includes("role=button"));
  assert.ok(sig.includes("tag=div"));
  assert.notEqual(sig, elementSignature({}));
});
