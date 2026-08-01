"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compileOutcome } = require("../../server/automation/outcome-compiler");

const cases = [
  ["send hi to Raghav Mittal on Instagram", ["Raghav Mittal"], ["hi"]],
  ["send a message to TG on insta saying hi", ["TG"], ["hi"]],
  ["message Raghav Mittal hi on Instagram", ["Raghav Mittal"], ["hi"]],
  ["dm @raghav.mittal \"hello bro\" on insta", ["@raghav.mittal"], ["hello bro"]],
  ["send AJ a message on Instagram saying are you free tonight", ["AJ"], ["are you free tonight"]],
  ["send a message saying hi to AJ on Instagram", ["AJ"], ["hi"]],
  ["message AJ on Instagram saying hello there", ["AJ"], ["hello there"]],
  ["dm aj on insta: check this out", ["aj"], ["check this out"]],
  ["send hello there to aj on insta", ["aj"], ["hello there"]],
  ["send Raghav Mittal thanks for the help on Instagram", ["Raghav Mittal"], ["thanks for the help"]],
];

for (const [prompt, people, messages] of cases) {
  test(`extracts messaging intent: ${prompt}`, () => {
    const outcome = compileOutcome(prompt);
    assert.deepEqual(outcome.entities.people, people);
    assert.deepEqual(outcome.entities.messageValues, messages);
    assert.equal(outcome.commit.required, true);
    assert.equal(outcome.completionContract.requireRecipientVerification, true);
  });
}

test("quoted text remains authoritative even when it contains routing words", () => {
  const outcome = compileOutcome('send "say hi to dad on Friday" to AJ on Instagram');
  assert.deepEqual(outcome.entities.people, ["AJ"]);
  assert.deepEqual(outcome.entities.messageValues, ["say hi to dad on Friday"]);
});

test("prepare-only language preserves the exact draft but removes the send commit", () => {
  const outcome = compileOutcome("message Raghav Mittal hi on Instagram but do not send");
  assert.deepEqual(outcome.entities.people, ["Raghav Mittal"]);
  assert.deepEqual(outcome.entities.messageValues, ["hi"]);
  assert.equal(outcome.commit.required, false);
});
