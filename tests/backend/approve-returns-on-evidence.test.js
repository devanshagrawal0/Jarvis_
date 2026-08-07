"use strict";

// Approving should finish when the message is on screen, not keep asking whether it worked.
//
// After the approved action was replayed, the run fell through into the full decision loop to
// "verify" — more snapshots, and remote planner calls, to establish something already proven: the
// message we just sent is visible in the conversation. That cost roughly 45 seconds on every
// approval, and eventually overran the request timeout entirely: an approved send came back HTTP
// 502 and was recorded as "Approved action failed" while the browser was still working on it.
//
// Returning on the page's own text is both faster and stricter than asking a model. The guard that
// matters: it must only short-circuit when the text is actually there.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AGENT = path.join(__dirname, "..", "..", "server", "universal-browser-agent.js");
const SOURCE = fs.readFileSync(AGENT, "utf8");

// The post-commit block, isolated, so these assertions cannot accidentally match the main loop.
const BLOCK = (() => {
  const start = SOURCE.indexOf("if (resume?.pendingAction && options.approvedExternal === true)");
  assert.ok(start > -1, "the approved-replay block must exist");
  const end = SOURCE.indexOf("for (let iteration = 0", start);
  assert.ok(end > start, "the decision loop must follow it");
  return SOURCE.slice(start, end);
})();

test("a confirmed send finishes without entering the decision loop", () => {
  assert.match(BLOCK, /return \{\s*\n?\s*success: true,/,
    "with the message visible, approving must return — not fall through to more planner calls");
});

test("it only returns once the message is actually visible", () => {
  // The whole safety of the short-circuit. A send that did not land must NOT be waved through.
  assert.match(BLOCK, /if \(settled && visiblyContains\(settled\.pageText, sentText\)\) \{/,
    "the early return must be gated on the page showing the sent text");
});

test("a send that never appears still falls through to the loop", () => {
  // There is no `else { return ... }` — running out of attempts leaves the loop to handle it.
  //
  // This counted ALL returns, which was only ever a proxy for the rule and became wrong the moment
  // the block gained a legitimate early exit: the recipient re-check, which refuses when the page
  // says the open conversation is a group. That return reports failure, so it does not weaken
  // anything. The rule worth pinning is that exactly one path out of here claims success.
  const successReturns = BLOCK.match(/return \{\s*\n?\s*success: true,/g) || [];
  assert.equal(successReturns.length, 1, `exactly one success exit, found ${successReturns.length}`);
  assert.doesNotMatch(BLOCK, /success: true[\s\S]*?\}\s*\n\s*\}\s*\n\s*return \{\s*success: true/,
    "no unconditional success return");
});

test("the replay re-checks the recipient before clicking, not only when the card was written", () => {
  // The card's recipient was true minutes earlier. This path replays a click with no further
  // planning on a site that re-renders continuously, so the check has to happen at the moment of
  // sending or it guarantees nothing.
  assert.match(BLOCK, /refusalFor\(\{/, "the replay must re-evaluate who receives this");
  const refusalIndex = BLOCK.indexOf("refusalFor({");
  const commitIndex = BLOCK.indexOf("browserService.commit(");
  assert.ok(refusalIndex > -1 && refusalIndex < commitIndex,
    "the check must run BEFORE the commit, otherwise it only reports what already happened");
});

test("the waiting is bounded", () => {
  assert.match(BLOCK, /attempt < 6/, "a page that never shows the message must not be waited on forever");
});

test("the conversation it sent in is recorded before returning", () => {
  // This is what later makes that contact fast; returning early must not skip it.
  assert.match(BLOCK, /kind: "post-commit-observation"/,
    "the early return must still record where the message was sent");
  assert.match(BLOCK, /url: settled\.url/, "and that record must carry the conversation URL");
});

test("the run is still persisted on the early return", () => {
  assert.match(BLOCK, /const statePath = persist\(state\);/,
    "skipping the loop must not skip writing the run's own record");
});
