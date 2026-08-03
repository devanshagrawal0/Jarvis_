"use strict";

// B-20 — `navigation-memory` was instantiated only inside `universal-browser-agent`, so the
// visible-desktop lane (screen_act, desktop_control, computer-use's screen loop, the YouTube
// preflight) had no outcome memory, no failure counter and no adaptation: an identical request
// could fail the same deterministic way forever.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const { createNavigationMemory, routeSignature } = require("../../server/automation/navigation-memory");
const computerUseSource = fs.readFileSync(path.join(root, "server", "computer-use.js"), "utf8");

const dirs = [];
test.afterEach(() => {
  while (dirs.length) { try { fs.rmSync(dirs.pop(), { recursive: true, force: true }); } catch { /* locked */ } }
});
function memory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-navmem-"));
  dirs.push(dir);
  return createNavigationMemory({ runtimeDir: dir });
}

// ── the route key ──────────────────────────────────────────────────────────
test("B-20 — a foreground window has a route key, which is what unblocked this lane", () => {
  // Before: any non-URL returned "", `safeActionRecord` bailed, and nothing was ever learned.
  assert.notEqual(routeSignature("chrome"), "", "a bare process name must produce a route");
  assert.equal(routeSignature("chrome"), "surface://chrome");
});

test("B-20 — the volatile document prefix does not fragment the route", () => {
  // "notes.txt - Notepad" and "todo.txt - Notepad" are the same surface; keying on the full
  // title would make every document its own route and nothing would ever accumulate samples.
  assert.equal(routeSignature("notes.txt - Notepad"), routeSignature("todo.txt - Notepad"));
});

test("B-20 — URLs are untouched, so the headless lane's existing memory still keys the same way", () => {
  assert.equal(routeSignature("https://youtube.com/results?q=x"), "https://youtube.com/results");
  assert.doesNotMatch(routeSignature("https://youtube.com/watch"), /^surface:\/\//);
});

// ── it actually learns ─────────────────────────────────────────────────────
const snapshot = { url: "chrome", elements: [{ id: 4, name: "Search", role: "button" }] };
const target = { id: 4, name: "Search", role: "button" };

test("B-20 — a repeated failure on the visible lane is remembered and surfaced as avoid", () => {
  const nav = memory();
  for (let i = 0; i < 3; i++) {
    const learned = nav.record({ snapshot, action: { action: "click", reason: "open the search" }, targetElement: target, ok: false, changed: false, error: "element not visible" });
    assert.equal(learned.learned, true, "the visible lane must be able to learn at all — this is the finding");
  }
  const hints = nav.hints(snapshot);
  assert.equal(hints.length, 1, "the next identical request must see what happened last time");
  assert.equal(hints[0].failures, 3);
  assert.equal(hints[0].recommendation, "avoid_unless_page_evidence_changed");
  assert.equal(hints[0].lastErrorClass, "unavailable_target");
});

test("B-20 — a route that works is remembered as effective", () => {
  const nav = memory();
  for (let i = 0; i < 3; i++) {
    nav.record({ snapshot, action: { action: "click", reason: "open the search" }, targetElement: target, ok: true, changed: true, durationMs: 120 });
  }
  const [hint] = nav.hints(snapshot);
  assert.equal(hint.recommendation, "previously_effective_route");
  assert.ok(hint.confidence > 0.5, `confidence should build with evidence, got ${hint.confidence}`);
});

test("B-20 — the module's existing safety rules still apply on this lane", () => {
  const nav = memory();
  // Commit-verb actions must not be learned — the lane must never get more confident about
  // pressing Send. This is why reusing the module matters rather than writing a new store.
  assert.equal(nav.record({ snapshot, action: { action: "click", reason: "send the message" }, targetElement: target, ok: true, changed: true }).learned, false);
  // Neither must person-shaped or contact-shaped labels.
  assert.equal(nav.record({ snapshot, action: { action: "click", reason: "open chat" }, targetElement: { id: 9, name: "Aditya Sharma", role: "button" }, ok: true, changed: true }).learned, false);
  assert.equal(nav.record({ snapshot, action: { action: "click", reason: "open chat" }, targetElement: { id: 9, name: "dev@example.com", role: "button" }, ok: true, changed: true }).learned, false);
});

// ── it is wired in ─────────────────────────────────────────────────────────
test("B-20 — the screen loop records outcomes and feeds hints to the planner", () => {
  assert.match(computerUseSource, /createNavigationMemory\(/, "the visible lane must instantiate the memory it never had");
  assert.match(computerUseSource, /\$\{hintText\(memorySnapshot\)\}/, "past outcomes must reach the planner prompt");
  assert.equal((computerUseSource.match(/recordOutcome\(pendingLearn,/g) || []).length, 2,
    "both the success path (next observation) and the failure path (catch) must record");
  assert.match(computerUseSource, /recordOutcome\(pendingLearn, \{ elements, ok: false, error: execErr\.message \}\)/,
    "a thrown action is the most useful thing to learn and must not be dropped");
});

test("B-20 — 'it changed something' is observed, not assumed", () => {
  // The same standard B-03 applies to completion claims: the loop compares the element-set
  // signature before and after rather than trusting that the action did anything.
  assert.match(computerUseSource, /function surfaceSignature\(/);
  assert.match(computerUseSource, /changed: ok && surfaceSignature\(elements\) !== pending\.signature/,
    "a click that changes nothing must not be recorded as a success");
});

test("B-20 — the memory is persisted beside the runtime, not in the process cwd", () => {
  const engine = fs.readFileSync(path.join(root, "server", "capability-engine.js"), "utf8");
  assert.match(engine, /createComputerUse\(\{ screenCapture, getSettings, browserService: browser, runtimeDir \}\)/);
});
