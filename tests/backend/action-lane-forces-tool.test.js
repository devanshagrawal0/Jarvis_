"use strict";

// "Send this to that person on Instagram" must actually send it.
//
// The execution-lane router classifies that request deterministically as an action: a commit verb
// plus a named surface. It then selects `computer_use` and sets `route.action = true`. But the tool
// was only OFFERED to the model — `functionCallingConfig: { mode: "AUTO" }` — so calling it stayed
// the model's choice, and it sometimes chose not to.
//
// The observed live failure, from the run's own event stream:
//
//   run     Request accepted
//   plan    Plan ready
//   model   Reasoning  x3
//   receipt Receipt recorded
//   run     Response complete
//
// No tool event, no runtime task, no browser, no approval card — the turn just talked. The same
// request had worked minutes before, which is why this reads as the feature randomly breaking.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { routeExecutionLane } = require("../../server/automation/execution-lane-router");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");

test("a send to a named surface is classified as an action lane", () => {
  // Both shapes that matter: a contact with a stored conversation, and one without.
  for (const prompt of [
    'send "hello" to Some Person on instagram',
    "send a message to someone on insta",
    "message my friend on whatsapp",
  ]) {
    const lane = routeExecutionLane(prompt, {});
    assert.notEqual(lane.lane, "none", `"${prompt}" must be an action lane, not a conversation`);
    assert.ok((lane.tools || []).length, `"${prompt}" must select tools`);
  }
});

test("an ordinary question is NOT an action lane", () => {
  // The forcing must not leak onto conversational turns, or every question becomes a tool call.
  for (const prompt of ["what is the weather like today", "explain how this project is structured", "who am i"]) {
    assert.equal(routeExecutionLane(prompt, {}).lane, "none", `"${prompt}" must stay a conversation`);
  }
});

test("an action lane makes the tool call mandatory", () => {
  assert.match(SOURCE, /const forceToolCall = Boolean\(prepared\.route\?\.executionLane\) && prepared\.route\.executionLane\.lane !== "none";/,
    "the forcing must key on the deterministic lane classification, not on anything the model said");
  assert.match(SOURCE, /mode: forceToolCall && turn === 0 \? "ANY" : "AUTO"/,
    "an action lane must force a function call instead of leaving it to the model");
});

test("forcing is first-turn only", () => {
  // ANY forces a call on EVERY turn. Left on after the tool result returns, the model would call
  // another tool rather than answering, and the turn would never finish.
  assert.match(SOURCE, /turn === 0 \? "ANY" : "AUTO"/,
    "forcing past the first turn would loop the conversation forever");
  assert.doesNotMatch(SOURCE, /mode: "ANY"(?!.*turn)/,
    "no unconditional ANY anywhere");
});

test("conversational turns keep AUTO", () => {
  // `sendFns` gates the whole toolConfig, and without a lane the mode stays AUTO — a question with
  // tools available must still be answerable in words.
  assert.match(SOURCE, /\.\.\.\(sendFns \? \{ toolConfig: \{ functionCallingConfig: \{ mode: forceToolCall && turn === 0 \? "ANY" : "AUTO" \} \} \} : \{\}\)/);
});
