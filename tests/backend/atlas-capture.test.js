"use strict";
// Wave-2 correctness: plain sentences must resolve to the RIGHT ATLAS row with the RIGHT local
// time, deterministically and offline. `now` is pinned so asserts are stable across machines/clocks.
// Run: node --test tests/backend/atlas-capture.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { parseCapture, capture } = require("../../server/atlas/atlas-capture");
const { createAtlasStore } = require("../../server/atlas/atlas-store");

const TZ = "America/New_York";
// Sunday 2026-08-09, 14:30 local (EDT, UTC-4) => 18:30Z. A pinned "now" for every case below.
const NOW = new Date("2026-08-09T18:30:00.000Z");

// local wall-clock of an ISO in TZ, as "YYYY-MM-DD HH:MM"
function localOf(iso, tz = TZ) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const P = (text) => parseCapture(text, { tz: TZ, now: NOW });

test("reminder: explicit clock later today keeps today's date", () => {
  const r = P("remind me to call the bank at 5pm");
  assert.equal(r.kind, "reminder");
  assert.match(r.title, /call the bank/i);
  assert.equal(localOf(r.fireAt), "2026-08-09 17:00");
});

test("reminder: a clock already past today rolls to tomorrow", () => {
  const r = P("remind me to take meds at 9am");           // now is 14:30, 9am passed
  assert.equal(r.kind, "reminder");
  assert.equal(localOf(r.fireAt), "2026-08-10 09:00");
});

test("reminder: 'in N minutes' resolves to now + N", () => {
  const r = P("remind me in 20 minutes to move the car");
  assert.equal(r.kind, "reminder");
  assert.equal(r.fireAt, new Date(NOW.getTime() + 20 * 60000).toISOString());
  assert.match(r.title, /move the car/i);
});

test("reminder with no time degrades honestly to a task", () => {
  const r = P("remind me to email the professor");
  assert.equal(r.kind, "task");
  assert.equal(r.waitingOn, "me");
  assert.match(r.title, /email the professor/i);
});

test("task: explicit 'add a task' phrasing, urgent bumps priority", () => {
  const r = P("add a task: file the reimbursement, urgent");
  assert.equal(r.kind, "task");
  assert.equal(r.priority, 3);
  assert.match(r.title, /file the reimbursement/i);
  assert.doesNotMatch(r.title, /urgent/i, "priority words don't leak into the title");
  assert.doesNotMatch(r.title, /\s,|,\s*$/, "no stray comma spacing");
});

test("task: 'i need to' imperative", () => {
  const r = P("i need to renew my passport");
  assert.equal(r.kind, "task");
  assert.match(r.title, /renew my passport/i);
});

test("event: noun + time becomes a calendar event with a 1h slot", () => {
  const r = P("lunch with Priya tomorrow at 1pm");
  assert.equal(r.kind, "event");
  assert.equal(localOf(r.startAt), "2026-08-10 13:00");
  assert.equal(localOf(r.endAt), "2026-08-10 14:00");
  assert.match(r.title, /priya/i);
});

test("event: weekday resolves to the coming occurrence", () => {
  const r = P("schedule a dentist appointment on friday at 10am");
  assert.equal(r.kind, "event");
  assert.equal(localOf(r.startAt), "2026-08-14 10:00");   // Fri after Sun 8/9
});

test("waiting-on: 'X said he will' is THEIR commitment, not mine", () => {
  const r = P("Raghav said he'll send the scanner doc");
  assert.equal(r.kind, "task");
  assert.equal(r.waitingOn, "them");
  assert.equal(r.actor, "Raghav");
});

test("note: explicit note prefix", () => {
  const r = P("note: parking spot is B12");
  assert.equal(r.kind, "note");
  assert.equal(r.body, "parking spot is B12");
});

test("recurring reminder: 'every day at 9am' repeats daily, first fire next 9am", () => {
  const r = P("remind me to take meds every day at 9am");   // 9am already passed at 14:30
  assert.equal(r.kind, "reminder");
  assert.deepEqual(r.recurrence, { freq: "daily", phrase: r.recurrence.phrase });
  assert.equal(r.recurrence.freq, "daily");
  assert.equal(localOf(r.fireAt), "2026-08-10 09:00");
  assert.doesNotMatch(r.title, /every|daily/i, "recurrence words don't leak into the title");
  assert.match(r.title, /take meds/i);
});

test("recurring reminder: 'every monday at 10am' is weekly on the right weekday", () => {
  const r = P("remind me to submit the report every monday at 10am");
  assert.equal(r.kind, "reminder");
  assert.equal(r.recurrence.freq, "weekly");
  assert.equal(r.recurrence.weekday, 1);
  assert.equal(localOf(r.fireAt), "2026-08-10 10:00");   // Mon after Sun 8/9
});

test("recurring reminder: 'every morning' uses the 9am default", () => {
  const r = P("remind me to stretch every morning");
  assert.equal(r.recurrence.freq, "daily");
  assert.equal(localOf(r.fireAt), "2026-08-10 09:00");
});

test("recurring reminder: 'every weekday at 8am' skips the weekend", () => {
  const r = P("remind me to check email every weekday at 8am");
  assert.equal(r.recurrence.freq, "weekdays");
  assert.equal(localOf(r.fireAt), "2026-08-10 08:00");   // Mon
});

test("nextOccurrence after a fire lands strictly in the future", () => {
  const { nextOccurrence } = require("../../server/atlas/atlas-capture");
  const firedAt = new Date("2026-08-10T13:00:00.000Z").getTime();   // Mon 9am EDT
  const next = nextOccurrence({ freq: "daily" }, firedAt, TZ, 9, 0);
  assert.ok(new Date(next).getTime() > firedAt);
  assert.equal(localOf(next), "2026-08-11 09:00");
});

test("non-capture questions return kind:null so the brain handles them", () => {
  assert.equal(P("what's the weather like today?").kind, null);
  assert.equal(P("who won the game last night").kind, null);
  assert.equal(P("").kind, null);
});

test("capture() writes the right row into a real store", () => {
  const s = createAtlasStore({ file: ":memory:" });
  const a = capture(s, "remind me to call mom at 6pm", { tz: TZ, now: NOW });
  assert.ok(a.ok && a.kind === "reminder");
  assert.equal(s.pendingReminders().length, 1);

  const b = capture(s, "add a task buy groceries", { tz: TZ, now: NOW });
  assert.ok(b.ok && b.kind === "task");
  assert.equal(s.listTasks({ status: "open" }).length, 1);

  const c = capture(s, "lunch with Sam tomorrow at noon", { tz: TZ, now: NOW });
  assert.ok(c.ok && c.kind === "event");

  const d = capture(s, "note: wifi password is mango", { tz: TZ, now: NOW });
  assert.ok(d.ok && d.kind === "note");
  assert.equal(s.listNotes().length, 1);

  const none = capture(s, "how are you", { tz: TZ, now: NOW });
  assert.equal(none.ok, false);
  s.close();
});
