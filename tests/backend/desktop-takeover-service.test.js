"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDesktopTakeoverService } = require("../../server/desktop-takeover-service");

function temporaryRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-takeover-"));
}

test("desktop takeover is task-bound, owner-controllable, and persisted", (t) => {
  const runtimeDir = temporaryRuntime();
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const emitted = [];
  const service = createDesktopTakeoverService({ runtimeDir, emit: (state) => emitted.push(state) });

  const started = service.start({ taskId: "task-42", objective: "Open Calculator on my screen", mode: "takeover" });
  assert.equal(started.active, true);
  assert.equal(started.overlayVisible, true);
  assert.equal(service.controlState(), "running");

  const planned = service.applyAgentStep({ step: 1, phase: "planned", action: "click", x: 420, y: 180, reasoning: "Select Calculator" });
  assert.equal(planned.phase, "planning");
  assert.deepEqual(planned.target, { x: 420, y: 180, label: "Select Calculator" });

  assert.equal(service.pause("Owner is typing").phase, "paused");
  assert.equal(service.controlState(), "paused");
  assert.equal(service.resume("Owner finished").phase, "observing");
  assert.equal(service.handBack("Owner requested control").phase, "handed_back");
  assert.equal(service.controlState(), "cancelled");
  assert.equal(service.status().overlayVisible, false);
  assert.ok(emitted.length >= 5);

  const onDisk = JSON.parse(fs.readFileSync(service.statePath, "utf8"));
  assert.equal(onDisk.taskId, "task-42");
  assert.equal(onDisk.phase, "handed_back");
});

test("a backend restart never resumes physical input", (t) => {
  const runtimeDir = temporaryRuntime();
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const first = createDesktopTakeoverService({ runtimeDir });
  first.start({ taskId: "task-interrupted", objective: "Test safe recovery" });

  const recovered = createDesktopTakeoverService({ runtimeDir });
  assert.equal(recovered.status().active, false);
  assert.equal(recovered.status().overlayVisible, false);
  assert.equal(recovered.status().phase, "failed");
  assert.match(recovered.status().reason, /restart/i);
});

test("invalid takeover modes are rejected", (t) => {
  const runtimeDir = temporaryRuntime();
  t.after(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const service = createDesktopTakeoverService({ runtimeDir });
  assert.throws(() => service.start({ taskId: "x", mode: "invisible-native" }), /takeover, assist, or annotate/);
});
