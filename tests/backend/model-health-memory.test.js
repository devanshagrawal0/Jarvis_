"use strict";

// Paying for the same broken model on every single request.
//
// The failover ladder is walked from the top every time, so a model that is timing out or returning
// 503 is tried again, at full cost, on the next request — and the one after that. Measured on a live
// send: `gemini-3.6-flash` burned 6.7s and failed, `gemini-flash-latest` burned 12.3s and failed,
// and `gemini-2.5-flash` then answered in about a second. Nineteen of those twenty seconds bought
// nothing, and the next request paid them again, because these outages last minutes and the
// ladder's memory was zero.
//
// The rule being pinned here: remember a failure briefly, demote that model, and let it earn its
// place back — without ever leaving a request with nothing to try.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MODELS,
  MODEL_FAILURE_TTL_MS,
  candidatesFor,
  fallbacksFor,
  isModelUnhealthy,
  noteModelFailure,
  noteModelSuccess,
} = require("../../server/gemini-models");

const MAIN = MODELS.main;
const LADDER = fallbacksFor(MAIN);

// Every test starts from a clean slate — module state is shared across the file.
function forget() {
  for (const name of [MAIN, ...LADDER]) noteModelSuccess(name);
}

test("a model that just failed is tried last, not first", () => {
  forget();
  const before = candidatesFor(MAIN);
  assert.equal(before[0], MAIN, "normally the preferred model leads");

  noteModelFailure(MAIN);
  const after = candidatesFor(MAIN);
  assert.notEqual(after[0], MAIN, "the model that just cost us 6.7s must not lead the next request");
  assert.equal(after.at(-1), MAIN, "it goes to the back, so it is still available if everything else fails");
});

test("nothing is ever removed, only reordered", () => {
  forget();
  const before = candidatesFor(MAIN);
  noteModelFailure(MAIN);
  const after = candidatesFor(MAIN);
  assert.deepEqual([...after].sort(), [...before].sort(), "a demoted model must remain reachable");
});

test("when everything has failed the full ladder is still tried", () => {
  // "Everything looks broken" must not quietly become "try nothing".
  forget();
  const expected = candidatesFor(MAIN);
  for (const name of expected) noteModelFailure(name);
  assert.deepEqual(candidatesFor(MAIN), expected, "with no healthy model left, the original order stands");
});

test("the memory expires so a model can recover on its own", () => {
  forget();
  noteModelFailure(MAIN, 0);
  assert.equal(isModelUnhealthy(MAIN, MODEL_FAILURE_TTL_MS - 1), true, "still shunned inside the window");
  assert.equal(isModelUnhealthy(MAIN, MODEL_FAILURE_TTL_MS + 1), false, "back in the running afterwards");
});

test("a success clears the mark immediately", () => {
  // Recovery is observed, not waited out — an outage that ends should not keep costing us.
  forget();
  noteModelFailure(MAIN);
  assert.equal(isModelUnhealthy(MAIN), true);
  noteModelSuccess(MAIN);
  assert.equal(isModelUnhealthy(MAIN), false);
  assert.equal(candidatesFor(MAIN)[0], MAIN);
});

test("the window is short enough that a demotion is not a ban", () => {
  assert.ok(MODEL_FAILURE_TTL_MS <= 10 * 60_000, `${MODEL_FAILURE_TTL_MS}ms is long enough to feel like a ban`);
  assert.ok(MODEL_FAILURE_TTL_MS >= 60_000, `${MODEL_FAILURE_TTL_MS}ms is too short to outlast a real outage`);
});

test("failures and successes are actually recorded by the answer loop", () => {
  // Without these call sites the memory above is decorative.
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "server.js"), "utf8");
  assert.match(source, /noteModelFailure\(candidateModel\);/, "a failed candidate must be remembered");
  assert.match(source, /if \(response\.ok\) \{ noteModelSuccess\(candidateModel\); break; \}/, "a working candidate must be un-marked");
});
