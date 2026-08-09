"use strict";
// Wave-1 correctness: the ATLAS store + scheduler must fire a reminder EXACTLY ONCE, even when
// two ticks race or the process "restarts" (a fresh scheduler over the same DB). These asserts
// are written so they FAIL if the fire-once guard is removed. Run: node --test tests/backend/atlas-store.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { createAtlasStore } = require("../../server/atlas/atlas-store");
const { createAtlasScheduler } = require("../../server/atlas/atlas-scheduler");

const past = (ms) => new Date(Date.now() - ms).toISOString();
const future = (ms) => new Date(Date.now() + ms).toISOString();

test("task create/list and the waiting-on ledgers keep actor/beneficiary straight", () => {
  const s = createAtlasStore({ file: ":memory:" });
  const mine = s.createTask({ title: "Email professor", dueAt: future(3600_000), waitingOn: "me" });
  s.createTask({ title: "Raghav sends scanner doc", waitingOn: "them", actor: "Raghav", beneficiary: "owner" });
  assert.equal(s.listTasks().length, 2);
  assert.ok(s.waitingOnMe().some((t) => t.id === mine.id), "my task is in waiting-on-me");
  assert.ok(s.waitingOnThem().some((t) => t.actor === "Raghav"), "their task is in waiting-on-them");
  assert.equal(s.waitingOnMe().some((t) => t.actor === "Raghav"), false, "their commitment is NOT in my list");
  const done = s.updateTask(mine.id, { status: "done" });
  assert.ok(done.completedAt, "completing sets completedAt");
  assert.equal(s.listTasks({ status: "open" }).length, 1);
  s.close();
});

test("a due reminder fires exactly once even when two ticks race", async () => {
  const s = createAtlasStore({ file: ":memory:" });
  s.createReminder({ title: "standup", fireAt: past(1000) });
  const delivered = [];
  const sched = createAtlasScheduler({ store: s, deliver: (r) => delivered.push(r.id), intervalMs: 999999, logger: { warn() {}, log() {} } });
  await Promise.all([sched.tick(), sched.tick(), sched.tick()]); // simulate overlapping/racing ticks
  assert.equal(delivered.length, 1, "reminder delivered exactly once across racing ticks");
  await sched.tick();
  assert.equal(delivered.length, 1, "a later tick does not re-deliver");
  s.close();
});

test("reminders that came due while 'down' fire once on restart catch-up; future ones wait", async () => {
  const s = createAtlasStore({ file: ":memory:" });
  s.createReminder({ title: "missed while offline", fireAt: past(60_000) });
  const later = s.createReminder({ title: "later today", fireAt: future(3600_000) });
  // First process instance never ticked (simulating downtime). Now a fresh scheduler boots:
  const delivered = [];
  const sched = createAtlasScheduler({ store: s, deliver: (r) => delivered.push(r.title), intervalMs: 999999, logger: { warn() {}, log() {} } });
  await sched.tick(); // the catch-up pass start() would run
  assert.deepEqual(delivered, ["missed while offline"], "past-due fired on catch-up, future one did not");
  assert.equal(s.pendingReminders().some((r) => r.id === later.id), true, "future reminder still pending");
  s.close();
});

test("cancelling a reminder before it fires prevents delivery", async () => {
  const s = createAtlasStore({ file: ":memory:" });
  const r = s.createReminder({ title: "cancel me", fireAt: past(1000) });
  s.cancelReminder(r.id);
  const delivered = [];
  const sched = createAtlasScheduler({ store: s, deliver: (x) => delivered.push(x.id), intervalMs: 999999, logger: { warn() {}, log() {} } });
  await sched.tick();
  assert.equal(delivered.length, 0, "cancelled reminder never fires");
  s.close();
});

test("events between a window are returned in start order for the Today timeline", () => {
  const s = createAtlasStore({ file: ":memory:" });
  s.createEvent({ title: "Class", startAt: future(2 * 3600_000), endAt: future(3 * 3600_000) });
  s.createEvent({ title: "Coffee", startAt: future(1 * 3600_000), endAt: future(1.5 * 3600_000) });
  const day = s.eventsBetween(past(3600_000), future(6 * 3600_000));
  assert.deepEqual(day.map((e) => e.title), ["Coffee", "Class"], "sorted by start");
  s.close();
});
