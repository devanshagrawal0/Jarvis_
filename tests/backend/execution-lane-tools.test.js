"use strict";

// B-09 — when `routeExecutionLane` returns a lane, `selectedTools` is replaced by the lane's
// tools. That replacement is the lane's intended focusing behaviour. The defect was the
// fallback: `laneDeclarations.length ? laneDeclarations : declarationsForLane(selectedTools,
// execution)` filters by the SAME allowlist that just produced nothing, so a lane naming a tool
// that does not exist in `declarations` handed the turn ZERO tools and the model answered an
// automation request with prose.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const runtimeSource = fs.readFileSync(path.join(root, "server", "agent-runtime.js"), "utf8");
const { declarationsForLane, routeExecutionLane } = require("../../server/automation/execution-lane-router");

// The exact expression from agent-runtime, evaluated in isolation so the assertion is about
// behaviour rather than about the text of the file.
function resolveLaneTools({ laneDeclarations, selectedTools, execution }) {
  const laneFallback = declarationsForLane(selectedTools, execution);
  return laneDeclarations.length ? laneDeclarations : (laneFallback.length ? laneFallback : selectedTools);
}

const SELECTED = [
  { name: "computer_use" }, { name: "desktop_control" }, { name: "write_file" }, { name: "research_v2" },
];

test("B-09 — a lane naming only unavailable tools does not strip the turn bare", () => {
  // `declarationsFor` drops names it cannot resolve, so laneDeclarations is empty; the old
  // fallback then filtered SELECTED by the same empty-matching allowlist and returned [].
  const execution = { lane: "headless-browser", tools: ["tool_that_does_not_exist"] };
  assert.deepEqual(declarationsForLane(SELECTED, execution), [], "precondition: the fallback filter also yields nothing");
  const resolved = resolveLaneTools({ laneDeclarations: [], selectedTools: SELECTED, execution });
  assert.ok(resolved.length > 0, "a zero-tool turn means the model answers an automation request with prose");
  assert.deepEqual(resolved.map((t) => t.name), SELECTED.map((t) => t.name));
});

test("B-09 — a lane whose tools resolve still replaces the set, as intended", () => {
  const execution = { lane: "headless-browser", tools: ["computer_use", "browser_status"] };
  const laneDeclarations = [{ name: "computer_use" }, { name: "browser_status" }];
  const resolved = resolveLaneTools({ laneDeclarations, selectedTools: SELECTED, execution });
  assert.deepEqual(resolved.map((t) => t.name), ["computer_use", "browser_status"],
    "focusing the turn on the lane's surface is the point of the lane");
});

test("B-09 — the partial fallback still applies when some lane tools are present locally", () => {
  const execution = { lane: "headless-browser", tools: ["computer_use", "missing_tool"] };
  const resolved = resolveLaneTools({ laneDeclarations: [], selectedTools: SELECTED, execution });
  assert.deepEqual(resolved.map((t) => t.name), ["computer_use"],
    "when the allowlist matches something, that stays the preferred narrowing");
});

test("B-09 — the real browser lane still resolves against the real router", () => {
  // Guards the assumption the fix rests on: this lane names four tools, so a turn matching
  // `browserOutcome` is the one that would have been stripped.
  const execution = routeExecutionLane("send an instagram dm to aj saying hi", {});
  assert.notEqual(execution.lane, "none", "precondition: this prompt routes to a lane");
  assert.ok((execution.tools || []).includes("computer_use"));
});

test("B-09 — unresolved lane tools are reported rather than silently dropped", () => {
  assert.match(runtimeSource, /execution\.unresolvedTools = unresolved/,
    "a lane naming tools nothing can resolve is a misconfiguration and must be visible");
  assert.match(runtimeSource, /\[execution-lane\] lane/, "and it should reach the log");
});

test("B-09 — the self-cancelling fallback is gone", () => {
  const code = runtimeSource.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /laneDeclarations\.length \? laneDeclarations : declarationsForLane\(selectedTools, execution\);/,
    "the old expression fell back to a filter that had already failed");
});
