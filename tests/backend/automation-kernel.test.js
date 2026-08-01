"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compileOutcome } = require("../../server/automation/outcome-compiler");
const { TaskWorldModel, observationKey } = require("../../server/automation/task-world-model");
const { rankCandidates, resolveEntity } = require("../../server/automation/entity-resolver");

test("outcome compiler preserves ordered cross-site work and terminal effects", () => {
  const outcome = compileOutcome("In the background, send hi to Raghav Mittal on Instagram then download the latest quant report and upload it to GitHub");
  assert.equal(outcome.steps.length, 2);
  assert.deepEqual(outcome.entities.people, ["Raghav Mittal"]);
  assert.deepEqual(outcome.entities.files, ["the latest quant report"]);
  assert.equal(outcome.constraints.delivery, "runtime");
  assert.equal(outcome.constraints.preserveFocus, true);
  assert.ok(outcome.commit.types.includes("send"));
  assert.equal(outcome.completionContract.requireRecipientVerification, true);
  assert.equal(outcome.completionContract.requireArtifactIntegrity, true);
});

test("outcome compiler distinguishes a prepared unsent message from an external send", () => {
  const prepared = compileOutcome("Message Raghav Mittal with 'hi' but leave the message unsent");
  assert.equal(prepared.commit.required, false);
  assert.equal(prepared.successCriteria[0].kind, "state");
  assert.match(prepared.successCriteria[0].description, /remains unsent/);
  const sent = compileOutcome("Send Raghav Mittal the message 'hi'");
  assert.equal(sent.commit.required, true);
  assert.ok(sent.commit.types.includes("send"));
  assert.deepEqual(compileOutcome("Send hi to Raghav Mittal on Instagram").entities.messageValues, ["hi"]);
  assert.deepEqual(compileOutcome("Search for Raghav Mittal, resolve the user, and prepare 'hi'").entities.people, ["Raghav Mittal"]);
  const browserDraft = compileOutcome("Search for Raghav Mittal, type 'hi' into the message input field, and stop without clicking Send or submitting the message");
  assert.deepEqual(browserDraft.entities.people, ["Raghav Mittal"]);
  assert.equal(browserDraft.commit.required, false);
  assert.deepEqual(compileOutcome("Select Raghav Mittal and open their chat").entities.people, ["Raghav Mittal"]);
  assert.deepEqual(compileOutcome("Navigate to Instagram Direct inbox. Find the direct message thread with Raghav Mittal, open it, and type 'hi' into the message input field. Do not click Send.").entities.people, ["Raghav Mittal"]);
});

test("entity resolver chooses a clear exact identity and blocks weak ambiguity", () => {
  const elements = [
    { ref: "e1", role: "link", name: "Raghav Mehta" },
    { ref: "e2", role: "link", name: "Raghav Mittal" },
    { ref: "e3", role: "link", name: "Raghav Mittal Fan Club" },
  ];
  const exact = resolveEntity("Raghav Mittal", elements);
  assert.equal(exact.status, "resolved");
  assert.equal(exact.match.ref, "e2");
  const ambiguous = resolveEntity("Raghav", elements);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(rankCandidates("Raghav", elements).length, 3);
});

test("entity resolver does not mistake typed search text for an identity result", () => {
  const elements = [
    { ref: "search", role: "textbox", name: "Search", value: "Raghav Mittal" },
    { ref: "result", role: "button", name: "Raghav Mittal raghav.m" },
    { ref: "identity", role: "generic", name: "Raghav Mittal" },
    { ref: "heading", role: "heading", name: "Raghav Mittal" },
  ];
  assert.equal(rankCandidates("Raghav Mittal", elements).some((item) => item.ref === "search"), false);
  const resolved = resolveEntity("Raghav Mittal", elements);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.match.ref, "result");
});

test("world model turns failures and unchanged state into recovery guidance", () => {
  const outcome = compileOutcome("Find an unfamiliar repository and open its issues");
  const world = new TaskWorldModel({ taskId: "task-1", outcome });
  const snapshot = { url: "https://example.test", title: "Search", pageText: "No result", elements: [{ role: "textbox", name: "Search" }] };
  const key = observationKey(snapshot);
  assert.equal(typeof key, "string");
  for (let index = 0; index < 3; index += 1) {
    world.observe(snapshot, []);
    world.fail({ action: "click", ref: "e9" }, new Error("Target disappeared"));
  }
  assert.equal(world.repeatedState(3), true);
  assert.equal(world.repeatedFailure(3), true);
  assert.match(world.recoveryHint(), /Do not retry/i);
  assert.equal(world.summary().recentFailures.length, 3);
});
