"use strict";

// The planner paid four seconds for a guaranteed failure on every single step.
//
// Measured on a live send, `gemini-3.1-flash-lite` failed six calls out of six — "returned no JSON
// object" at 4126ms, 4202ms and 4740ms against a 4000ms router window. It was not slower than the
// alternative; it was being cut off mid-answer, because the prompt grows to 10-17KB once the page
// is in it. `gemini-2.5-flash` answered every one of those same calls in 4.5-5.7s. So the leading
// model was both failing and not faster, and one step burned both attempts and killed the run.
//
// Two things were wrong, and only one of them is the ordering. The other is that nothing REMEMBERED
// the failures: the health memory was wired into the answer path only, so the planner re-paid the
// same 4.2s on every step of every run, forever, with the evidence sitting in its own log.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AGENT = path.join(__dirname, "..", "..", "server", "universal-browser-agent.js");
const SOURCE = fs.readFileSync(AGENT, "utf8");
// Executable lines only. Searching the raw file matched `// noteModelFailure(model);` just as
// happily as the real call, so commenting the recording out — restoring the exact bug — passed.
// Two mutations survived against this file before the comments were stripped.
const CODE = SOURCE.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
const { plannerModelChain, MAX_PLANNER_MODELS } = require("../../server/universal-browser-agent");
const { noteModelFailure, noteModelSuccess, isModelUnhealthy } = require("../../server/gemini-models");

test("the model that answered leads the model that did not", () => {
  const order = /const PLANNER_SPEED_ORDER = \[([^\]]+)\]/.exec(SOURCE)?.[1] || "";
  const models = [...order.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const working = models.indexOf("gemini-2.5-flash");
  const failing = models.indexOf("gemini-3.1-flash-lite");
  assert.ok(working > -1 && failing > -1, "both measured models should still be in the ladder");
  assert.ok(working < failing,
    "the model that answered every call must be tried before the one that answered none");
});

test("the failing model is demoted, not deleted", () => {
  // It is genuinely quick on small prompts. Deleting it would trade one wrong fixed order for
  // another; the health memory is what makes the ordering adapt.
  assert.match(SOURCE, /"gemini-3\.1-flash-lite"/, "the fallback rung should remain available");
});

test("a planner failure is remembered", () => {
  assert.match(CODE, /noteModelFailure\(model\);/,
    "a failed planner call must feed the health memory, or the ladder re-pays it every step");
  const failIndex = CODE.indexOf("noteModelFailure(model);");
  const traceIndex = CODE.indexOf('trace("planner", aborted ? "timeout" : "fail"');
  assert.ok(failIndex > -1 && traceIndex > -1 && Math.abs(failIndex - traceIndex) < 400,
    "it must be recorded on the planner's own failure path");
});

test("a planner success clears the memory", () => {
  // Otherwise one bad minute would demote a model for the rest of the process's life.
  assert.match(CODE, /noteModelSuccess\(model\);/);
});

test("the health memory actually changes the answer", () => {
  // The behaviour, not the wiring: a model marked unhealthy must be reported as such. Without this
  // the two assertions above would pass against a memory that recorded and then ignored everything.
  const model = "gemini-3.1-flash-lite";
  noteModelSuccess(model);
  assert.equal(isModelUnhealthy(model), false, "a healthy model must not start out demoted");
  noteModelFailure(model);
  assert.equal(isModelUnhealthy(model), true, "a recorded failure must be visible to the ladder");
  noteModelSuccess(model);
  assert.equal(isModelUnhealthy(model), false, "a success must clear it again");
});

test("the fallback depth still fits the twelve-second ceiling", () => {
  // The ceiling is load-bearing and predates this change; reordering must not quietly widen it.
  assert.equal(MAX_PLANNER_MODELS, 2);
  assert.ok(plannerModelChain({}).length <= MAX_PLANNER_MODELS,
    "one planner decision must never try more models than the budget allows");
});
