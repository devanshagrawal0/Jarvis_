"use strict";

// The planner budget, and why browser automation was dying before it reached anything interesting.
//
// Two live runs failed identically: "All 2 planner models failed: gemini-3.1-flash-lite timed out
// at 4000ms; gemini-3.6-flash timed out at 8000ms." Neither reached the approval boundary.
//
// Measured against the live endpoint at 17.7 KB — the size real runs produce, not the 4.4 KB the
// old budgets were derived from (scripts/measure-planner-budget.mjs, 8 samples):
//
//   gemini-3.1-flash-lite   median 1608ms   max 2152ms
//   gemini-3.6-flash        median 5068ms   max 5839ms
//   gemini-2.5-flash        median 3692ms   max 5119ms
//   gemini-flash-latest     HTTP 503 "currently experiencing high demand"  <- observed live
//
// So size was never the cause; transient degradation is. The fix has to survive a bad minute, which
// means both real headroom over the median AND a fallback deep enough to reach a healthy model.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_PLANNER_MODELS,
  PLANNER_ACTION_TIMEOUT_MS,
  PLANNER_ROUTER_TIMEOUT_MS,
  plannerModelChain,
} = require("../../server/universal-browser-agent");
const { MODELS } = require("../../server/gemini-models");

// The numbers above, as data. If the models get slower, re-measure and change these deliberately.
// `action` uses gemini-2.5-flash — the model the chain actually falls back to (see the speed
// ordering), which measured faster than the registry's nominal main model.
const MEASURED_MEDIAN_MS = { router: 1608, action: 3692 };
const MEASURED_MAX_MS = { router: 2152, action: 5119 };

test("a stuck planner step gives up within 12 seconds", () => {
  // The ceiling that matters, and the one thing here the owner actually feels.
  //
  // These budgets were briefly raised to 8s/15s across a 3-model chain, on the argument that more
  // headroom would ride out a degraded API. Measured against reality that was wrong twice over: it
  // did not make sends succeed, and it took the worst case from 12s to 38s PER STEP, which over a
  // multi-step run is the difference between "slow" and "this feature is hung".
  //
  // A saved-contact send now reaches the composer and the send control with no planner call at all,
  // so the planner is a fallback. A fallback against a flaky API should fail fast and let the
  // deterministic path or a retry carry the run.
  const worstStepMs = PLANNER_ROUTER_TIMEOUT_MS + (PLANNER_ACTION_TIMEOUT_MS * (MAX_PLANNER_MODELS - 1));
  assert.ok(worstStepMs <= 12_000, `a stuck step burns ${worstStepMs}ms before giving up; the ceiling is 12000ms`);
});

test("the budgets still clear measured latency on a healthy call", () => {
  // Fast-fail must not mean failing calls that would have answered. Both budgets stay above the
  // measured medians AND the measured maxima, so a normally-behaving model is never cut off.
  assert.ok(PLANNER_ROUTER_TIMEOUT_MS > MEASURED_MAX_MS.router,
    `router budget ${PLANNER_ROUTER_TIMEOUT_MS}ms would cut off a call that measured ${MEASURED_MAX_MS.router}ms`);
  assert.ok(PLANNER_ACTION_TIMEOUT_MS > MEASURED_MAX_MS.action,
    `action budget ${PLANNER_ACTION_TIMEOUT_MS}ms would cut off a call that measured ${MEASURED_MAX_MS.action}ms`);
});

test("the chain has a fallback but stays inside the ceiling", () => {
  const chain = plannerModelChain({});
  assert.equal(chain.length, 2, `chain is ${chain.length} deep: ${chain.join(", ")} — a third attempt breaks the 12s ceiling`);
});

test("the fallback actually includes the model that was measured fast and healthy", () => {
  const chain = plannerModelChain({});
  assert.ok(chain.includes("gemini-2.5-flash"),
    `the chain ${chain.join(", ")} never reaches gemini-2.5-flash, which outran the main model in measurement`);
});

test("the chain is ordered best-first and has no duplicates", () => {
  // This asserted the CHEAP router model leads, which is the assumption a live send disproved.
  // `MODELS.router` is `gemini-3.1-flash-lite`, and it failed six planner calls out of six with
  // "returned no JSON object" — cut off mid-answer at 4.1-4.7s against a 4s window, because the
  // prompt reaches 10-17KB once the page is in it. Nor was it cheaper in wall-clock: the alternative
  // answered those same calls in 4.5-5.7s. Cheapest-first is only best-first while the cheap one
  // answers, so the rule is measured reliability rather than the registry's label.
  const chain = plannerModelChain({});
  assert.equal(chain[0], "gemini-2.5-flash", "the model that answers must lead");
  assert.notEqual(chain[0], MODELS.router, "leading with the router model is the bug this replaces");
  assert.equal(new Set(chain).size, chain.length, `duplicate models waste an attempt: ${chain.join(", ")}`);
});

test("an explicit model override still leads the chain", () => {
  const chain = plannerModelChain({ geminiActionModel: "gemini-2.5-flash" });
  assert.ok(chain.indexOf("gemini-2.5-flash") <= 1, `override ignored: ${chain.join(", ")}`);
});

test("the chain never exceeds its own cap", () => {
  assert.ok(plannerModelChain({}).length <= MAX_PLANNER_MODELS);
  assert.ok(plannerModelChain({ geminiRouterModel: "a", geminiActionModel: "b" }).length <= MAX_PLANNER_MODELS);
});
