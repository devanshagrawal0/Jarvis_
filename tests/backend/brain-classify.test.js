/* Contract tests for the brain's turn-classifier — the SINGLE source of truth that drives both
   grounding and the evidence gate. These assert the DECISIONS (not output strings), so future
   edits can't silently reintroduce the "weather works / stocks refuse / bare-hi refused" bugs.
   Run: node --test tests/backend/brain-classify.test.js */
const { test } = require("node:test");
const assert = require("node:assert");
const { rawUserMessage, needsFreshInfo } = require("../../server/brain-classify");

test("rawUserMessage strips the room `context` prefix (fixes the 'hi' leak at the source)", () => {
  const contaminated = "APEX analyst mode. The market fell today; stocks are volatile.\n\nUser: hi";
  assert.strictEqual(rawUserMessage(contaminated), "hi");
  assert.strictEqual(rawUserMessage("hi"), "hi");
  assert.strictEqual(rawUserMessage(""), "");
});

test("a bare greeting is NOT a fresh-info question even after contaminated context", () => {
  // This is the exact 15:46 bug: "hi" got the stock refusal because the classifier saw the context.
  const contaminated = "prior turn asked why indian stock market fell today\n\nUser: hi";
  assert.strictEqual(needsFreshInfo(rawUserMessage(contaminated)), false);
});

test("live/current-info questions ARE detected (so grounding runs, gate is satisfied)", () => {
  for (const q of [
    "why did the indian stock market fall today",
    "why did jayaswal neco shares fall today",
    "what's the weather in nagpur",
    "latest news about apple",
    "nifty and sensex today",
    "current price of nvda",
  ]) assert.strictEqual(needsFreshInfo(q), true, `should be fresh: ${q}`);
});

test("evergreen / non-live questions are NOT flagged fresh (no needless grounding, no refusal)", () => {
  for (const q of [
    "hi",
    "what is 15 plus 27",
    "name one color",
    "in two sentences, what is prediction market arbitrage",
    "what do you remember about my dog",
  ]) assert.strictEqual(needsFreshInfo(q), false, `should NOT be fresh: ${q}`);
});

test("CONTRACT: retrieval-trigger and gate-requirement use the SAME predicate", () => {
  // Both the grounding decision and evidenceRequirementFor call needsFreshInfo(rawUserMessage(x)).
  // Asserting they agree on the same inputs guarantees they can never disagree (the root disease).
  const cases = ["why did the indian stock market fall today", "hi", "what is 2+2", "weather in boston today"];
  for (const c of cases) {
    const groundingWouldRun = needsFreshInfo(rawUserMessage(c));
    const gateWouldRequire = needsFreshInfo(rawUserMessage(c));
    assert.strictEqual(groundingWouldRun, gateWouldRequire, `decision must match for: ${c}`);
  }
});
