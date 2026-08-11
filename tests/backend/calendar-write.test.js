"use strict";
// W6.1: the calendar-command parser must classify create / move / cancel across many phrasings, pull a
// clean title or target, produce a valid startAt, and stay silent on reminders, to-dos, reads, and
// non-calendar "cancel"/"add" commands. Time correctness itself is covered by atlas-capture's tests;
// here we assert action, title/target, and that instants are valid ISO.
// Run: node --test tests/backend/calendar-write.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { parseCalendarCommand, splitMoveOnTo, matchCalendarTarget } = require("../../server/atlas/calendar-write");

const TZ = "America/New_York";
const NOW = new Date("2026-08-11T15:00:00Z"); // fixed so "passed time rolls to tomorrow" is deterministic
const parse = (t) => parseCalendarCommand(t, { tz: TZ, now: NOW });
const isIso = (s) => typeof s === "string" && !Number.isNaN(Date.parse(s));

test("CREATE — explicit and implicit event phrasings", () => {
  const a = parse("schedule lunch with Sam tomorrow at 1");
  assert.equal(a.action, "create");
  assert.match(a.title, /lunch with sam/i);
  assert.ok(isIso(a.startAt) && isIso(a.endAt));

  assert.equal(parse("book dentist friday 2pm").action, "create");
  assert.match(parse("book dentist friday 2pm").title, /dentist/i);
  assert.match(parse("add a meeting monday at 9").title, /meeting/i);
  assert.match(parse("put gym on my calendar tomorrow morning").title, /gym/i);
  assert.match(parse("set up a call with the vendor next tuesday 3pm").title, /call|vendor/i);
  assert.match(parse("add lunch tomorrow").title, /^lunch$/i); // leading verb stripped, not "Add lunch"
});

test("CREATE — default end is one hour after start", () => {
  const a = parse("schedule review friday 2pm");
  assert.equal(new Date(a.endAt) - new Date(a.startAt), 60 * 60 * 1000);
});

test("MOVE — reschedule an existing event to a new time", () => {
  const m = parse("move my 3pm to 4pm");
  assert.equal(m.action, "move");
  assert.ok(isIso(m.newStartAt));

  assert.equal(parse("reschedule standup to tomorrow 10am").action, "move");
  assert.match(parse("reschedule standup to tomorrow 10am").targetQuery, /standup/i);
  assert.match(parse("push the review to friday").targetQuery, /review/i);
});

test("MOVE — splits on the LAST 'to' so a title containing 'to' survives", () => {
  const s = splitMoveOnTo("move my talk to sam to friday 2pm");
  assert.match(s.before, /talk to sam/i);
  assert.match(s.after, /friday 2pm/i);
  const m = parse("move my talk to sam to friday 2pm");
  assert.equal(m.action, "move");
  assert.match(m.targetQuery, /sam/i);
});

test("CANCEL — by title or by time", () => {
  assert.equal(parse("cancel my 3pm").action, "cancel");
  assert.ok(parse("cancel my 3pm").targetWhen); // a time hint is captured for matching
  assert.equal(parse("delete the standup").action, "cancel");
  assert.match(parse("delete the standup").targetQuery, /standup/i);
  assert.match(parse("cancel lunch tomorrow").targetQuery, /lunch/i);
  assert.match(parse("remove my dentist appointment").targetQuery, /dentist/i);
});

test("does NOT fire on reminders / to-dos (atlas capture owns those)", () => {
  assert.equal(parse("remind me to call mom at 5"), null);
  assert.equal(parse("set a reminder for the meeting at 9"), null);
  assert.equal(parse("add a task to email Bob"), null);
  assert.equal(parse("don't let me forget to call the dentist at 4"), null);
});

test("does NOT fire on non-calendar cancel / add / reads", () => {
  assert.equal(parse("cancel the order"), null);        // no event reference
  assert.equal(parse("cancel my subscription"), null);
  assert.equal(parse("what's on my calendar"), null);   // a read, not a write (no time/create verb)
  assert.equal(parse("add a report about sales"), null);
  assert.equal(parse("move the file to the archive"), null);
  assert.equal(parse(""), null);
  assert.equal(parse("hello there"), null);
});

test("move with no resolvable new time is not actionable", () => {
  assert.equal(parse("move the couch"), null);
  assert.equal(parse("reschedule the meeting"), null); // no "to <time>"
});

test("matchCalendarTarget ranks by title text and time proximity", () => {
  const events = [
    { id: "a", title: "Daily Standup", startAt: "2026-08-11T13:00:00Z" },
    { id: "b", title: "Design Review", startAt: "2026-08-11T19:00:00Z" }, // 3pm ET
    { id: "c", title: "Lunch with Sam", startAt: "2026-08-11T16:00:00Z" },
  ];
  // by title
  const byTitle = matchCalendarTarget(events, "standup", null);
  assert.equal(byTitle[0].event.id, "a");
  // by time hint (3pm ET ≈ 19:00Z) with no useful title
  const byTime = matchCalendarTarget(events, "", "2026-08-11T19:00:00Z");
  assert.equal(byTime[0].event.id, "b");
  // no match → empty
  assert.equal(matchCalendarTarget(events, "dentist", null).length, 0);
  // title + time agree → strong top match, others filtered out or lower
  const both = matchCalendarTarget(events, "review", "2026-08-11T19:05:00Z");
  assert.equal(both[0].event.id, "b");
  assert.ok(both[0].score >= 4);
});
