"use strict";

// Pacing is the account's safety, so its promises are tested exactly: timings land in the human
// ranges and vary, and a daily cap can never be exceeded.

const test = require("node:test");
const assert = require("node:assert/strict");

const { jitter, typingDelays, ActionBudget, createPacer, DEFAULT_TIMING } = require("../../server/instagram/pacing");

test("jitter stays within the range", () => {
  const lows = [() => 0, () => 0.5, () => 1];
  for (const r of lows) {
    const v = jitter(30, 90, r);
    assert.ok(v >= 30 && v <= 90, `jitter produced ${v}, outside [30,90]`);
  }
  assert.equal(jitter(30, 90, () => 0), 30);
  assert.equal(jitter(30, 90, () => 1), 90);
});

test("typing produces one jittered delay per character, all in range", () => {
  const delays = typingDelays("hello", DEFAULT_TIMING, () => 0.5);
  assert.equal(delays.length, 5);
  for (const d of delays) assert.ok(d >= DEFAULT_TIMING.typeMinMs && d <= DEFAULT_TIMING.typeMaxMs);
});

test("timing is never instant — no zero-length gaps", () => {
  const pacer = createPacer({ random: () => 0 }); // worst case: minimum end of every range
  assert.ok(pacer.thinkPause() > 0);
  assert.ok(pacer.actionGap() > 0);
  assert.ok(pacer.typingDelays("x")[0] > 0);
});

test("the daily cap allows up to the limit and then refuses", () => {
  const budget = new ActionBudget({ caps: { like: 3 }, now: () => 0 });
  assert.equal(budget.remaining("like"), 3);
  budget.record("like"); budget.record("like"); budget.record("like");
  assert.equal(budget.allow("like"), false);
  assert.throws(() => budget.record("like"), (e) => e.code === "budget_exceeded");
});

test("record throws rather than silently blowing past the cap", () => {
  // The backstop: even if a caller forgets to check allow(), the cap holds.
  const budget = new ActionBudget({ caps: { follow: 1 }, now: () => 0 });
  budget.record("follow");
  assert.throws(() => budget.record("follow"), (e) => e.code === "budget_exceeded");
  assert.equal(budget.used("follow"), 1, "the refused action must NOT have been counted");
});

test("an unknown action type falls back to the default cap", () => {
  const budget = new ActionBudget({ caps: { default: 2 }, now: () => 0 });
  assert.equal(budget.remaining("some_new_action"), 2);
});

test("the budget resets when the day changes", () => {
  let t = new Date("2026-08-09T12:00:00").getTime();
  const budget = new ActionBudget({ caps: { like: 1 }, now: () => t });
  budget.record("like");
  assert.equal(budget.allow("like"), false);
  t = new Date("2026-08-10T09:00:00").getTime(); // next day
  assert.equal(budget.allow("like"), true, "a new day must restore the budget");
  assert.equal(budget.used("like"), 0);
});

test("timings vary across calls (not a fixed constant)", () => {
  let i = 0;
  const random = () => [0.1, 0.9, 0.4, 0.7][i++ % 4];
  const pacer = createPacer({ random });
  const gaps = [pacer.actionGap(), pacer.actionGap(), pacer.actionGap()];
  assert.ok(new Set(gaps).size > 1, "gaps must not all be identical — even intervals look robotic");
});
