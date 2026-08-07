"use strict";

// Answering the approval prompt in words, by keyboard or by voice.
//
// JARVIS asks "approve this?" and the only way to say yes was to click. Worse, saying it did active
// harm: `handleSubmit` clears `approvals` on every submit, so typing "confirm" dismissed the card
// AND sent the word "confirm" to the model as a fresh request — the pending action was abandoned
// silently, which looks exactly like the bug this whole change set is about.
//
// The risk in the other direction is real, so the match is deliberately exact. A test that fired on
// "yes" appearing anywhere in a sentence would let an unrelated message commit a pending send.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "src", "JarvisUI.tsx"), "utf8");

// The literal regexes the UI uses, pulled from the source so this tests the shipped behaviour
// rather than a copy of it that could drift.
function regexNamed(name) {
  const match = new RegExp(`const ${name} = (/\\^[^;]+/)\\.test\\(norm\\)`).exec(SOURCE);
  assert.ok(match, `expected a \`const ${name} = /…/.test(norm)\` line in JarvisUI.tsx`);
  // eslint-disable-next-line no-eval -- reading the shipped literal is the point of the test
  return eval(match[1]);
}

test("the spoken decision is handled before the card is cleared", () => {
  // Comments discuss `setApprovals([])` by name, so search the code only — otherwise this passes or
  // fails on prose, which is the definition of a check that is not really checking anything.
  const code = SOURCE.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  const submitBody = code.slice(code.indexOf("const handleSubmit"), code.indexOf("const handleSubmit") + 4000);
  const decisionAt = submitBody.indexOf("decideApproval");
  const clearAt = submitBody.indexOf("setApprovals([])");
  assert.ok(decisionAt > -1, "handleSubmit must route a spoken decision to decideApproval");
  assert.ok(clearAt > -1, "handleSubmit still clears approvals for a genuine new request");
  assert.ok(decisionAt < clearAt,
    "the decision must be handled BEFORE approvals are cleared, or saying 'confirm' throws the card away");
});

test("plain words approve", () => {
  const approve = regexNamed("spokenApproval");
  for (const word of ["confirm", "confirmed", "approve", "approved", "yes", "yep", "yeah", "ok", "okay", "do it", "send it", "go ahead", "proceed"]) {
    assert.equal(approve.test(word), true, `"${word}" should approve`);
  }
});

test("plain words deny", () => {
  const deny = regexNamed("spokenDenial");
  for (const word of ["deny", "cancel", "no", "nope", "stop", "abort"]) {
    assert.equal(deny.test(word), true, `"${word}" should deny`);
  }
});

test("a sentence that merely contains yes does NOT commit anything", () => {
  // The dangerous case: an ordinary request, typed while something happens to be pending, must go
  // to the model as a request — not silently send someone a message.
  const approve = regexNamed("spokenApproval");
  for (const sentence of [
    "yes i was wondering what the weather is",
    "confirm whether the deploy finished",
    "ok so what did you find",
    "tell him ok",
    "send it to the printer instead",
    "does he say yes",
  ]) {
    assert.equal(approve.test(sentence), false, `"${sentence}" must not be read as an approval`);
  }
});

test("a sentence that merely contains no does not deny", () => {
  const deny = regexNamed("spokenDenial");
  for (const sentence of ["no idea what that means", "cancel my subscription please", "stop the music"]) {
    assert.equal(deny.test(sentence), false, `"${sentence}" must not be read as a denial`);
  }
});

test("the shortcut is not offered when it would be ambiguous", () => {
  assert.match(SOURCE, /approvals\.length > 1/,
    "with more than one pending action, a bare 'confirm' does not say which one — it must fall back to the buttons");
});

test("the shortcut only runs while something is actually pending", () => {
  assert.match(SOURCE, /if \(approvals\.length\) \{/,
    "with nothing pending, 'confirm' is just a word and belongs to the model");
});

test("the card says the shortcut exists", () => {
  // An affordance nobody knows about is not an affordance.
  assert.match(SOURCE, /type or say .confirm./i);
});
