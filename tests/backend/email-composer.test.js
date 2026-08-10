"use strict";
// The composer's offline fallback must never invent content: direct speech ("saying hi") is relayed
// verbatim, and a reported-speech brief with no model available degrades to a safe short relay rather
// than a hallucinated email. (The full LLM compose path is exercised live, not here.)
// Run: node --test tests/backend/email-composer.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { heuristicCompose, createEmailComposer } = require("../../server/email-composer");

test("direct speech is relayed verbatim", () => {
  const r = heuristicCompose("saying hi", "AJ");
  assert.equal(r.mode, "verbatim");
  assert.equal(r.body, "hi");
});

test("'that says' quotes literally too", () => {
  const r = heuristicCompose("that says on my way", "TG");
  assert.equal(r.mode, "verbatim");
  assert.equal(r.body, "on my way");
});

test("reported-speech brief degrades to a safe short relay (no invented content)", () => {
  const r = heuristicCompose("tell him the automation works", "AJ");
  assert.equal(r.mode, "verbatim");
  assert.match(r.body, /automation works/i);
  assert.doesNotMatch(r.body, /^tell him/i);
});

test("composer with no API key falls back to the heuristic, never throws", async () => {
  const composer = createEmailComposer({ getSettings: () => ({}) }); // no geminiKey
  const r = await composer.compose({ instruction: "saying hey what's up", recipientName: "AJ" });
  assert.equal(r.mode, "verbatim");
  assert.match(r.body, /hey what's up/i);
});
