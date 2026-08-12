"use strict";
// Deterministic NL date/time resolution — the calendar must never land an item on the wrong day
// because the LLM miscomputed "tomorrow" / "next monday" / "in 2 weeks". Anchor: Wed 2026-08-12 10:00.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveWhen } = require("../../server/atlas/when-resolver");

const NOW = { y: 2026, mo: 8, d: 12, h: 10, mi: 0, dow: 3 }; // Wednesday
const fmt = (r) => r ? `${r.y}-${String(r.mo).padStart(2, "0")}-${String(r.d).padStart(2, "0")}${r.hadTime ? ` ${String(r.h).padStart(2, "0")}:${String(r.mi).padStart(2, "0")}` : ""}` : "null";

const CASES = [
  ["remind me tomorrow at 3pm", "2026-08-13 15:00"],
  ["dinner tomorrow evening", "2026-08-13 18:00"],
  ["lunch day after tomorrow at noon", "2026-08-14 12:00"],
  ["call next monday at 2pm", "2026-08-17 14:00"],
  ["meeting next tuesday", "2026-08-18"],
  ["in 2 weeks", "2026-08-26"],
  ["in 3 days", "2026-08-15"],
  ["remind me in 2 hours", "2026-08-12 12:00"],
  ["in 30 minutes", "2026-08-12 10:30"],
  ["this friday at 5pm", "2026-08-14 17:00"],
  ["end of the month", "2026-08-31"],
  ["beginning of next month", "2026-09-01"],
  ["august 20 at 5pm", "2026-08-20 17:00"],
  ["on the 25th", "2026-08-25"],
  ["tonight at 9", "2026-08-12 21:00"],
  ["tomorrow morning", "2026-08-13 09:00"],
  ["next wednesday", "2026-08-19"],
  ["dec 25", "2026-12-25"],
  ["jan 3", "2027-01-03"],   // already past in 2026 → next year
];

test("relative and absolute date phrases resolve to the correct owner-local day/time", () => {
  for (const [phrase, expected] of CASES) {
    assert.equal(fmt(resolveWhen(phrase, NOW)), expected, `"${phrase}" should resolve to ${expected}`);
  }
});

test("a bare hour is not misread as a time, and non-temporal text resolves to null", () => {
  assert.equal(resolveWhen("what is the capital of france", NOW), null);
  assert.equal(resolveWhen("add a task to renew my passport", NOW), null); // no date/time → null (task, no due)
  // "in 2 weeks" must not read the 2 as 2 o'clock.
  assert.equal(resolveWhen("in 2 weeks", NOW).hadTime, false);
});

test("a bare weekday means the NEXT occurrence, never today", () => {
  // today is Wednesday; "wednesday" must be next week, not today.
  assert.equal(fmt(resolveWhen("wednesday", NOW)), "2026-08-19");
});
