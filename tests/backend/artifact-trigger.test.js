"use strict";

// B-08 — `runComposerIfNeeded` runs `compose_artifact` *before the answer model*, and that tool
// writes four files with `confirmationRequired: false`. Its trigger classified the raw prompt,
// which on room surfaces is "<context>\n\nUser: <message>" — so artifact words left over in the
// context prefix produced files the owner never asked for, while the tool they did ask for
// (`write_file`) stops for confirmation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const source = fs.readFileSync(path.join(root, "server.js"), "utf8");
const { rawUserMessage } = require("../../server/brain-classify");

// The three classifiers are plain functions on the server module's top level; lift them out
// rather than booting the whole server.
function loadClassifiers() {
  const grab = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start > 0, `${name} should exist in server.js`);
    let depth = 0;
    let i = source.indexOf("{", start);
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) break;
    }
    return source.slice(start, i + 1);
  };
  const body = ["wantsWorkArtifact", "artifactFormatForPrompt", "artifactTitleForPrompt"].map(grab).join("\n\n");
  // eslint-disable-next-line no-new-func
  return new Function("rawUserMessage", `${body}\nreturn { wantsWorkArtifact, artifactFormatForPrompt, artifactTitleForPrompt };`)(rawUserMessage);
}

// A real room-surface prompt: the context prefix mentions an artifact, the owner's message does not.
const CONTAMINATED = [
  "Context: the owner asked me earlier to create a research document about Kalshi spreads.",
  "",
  "User: how do I activate it",
].join("\n");

test("B-08 — artifact words in the context prefix do not fire the composer", () => {
  const { wantsWorkArtifact } = loadClassifiers();
  assert.equal(rawUserMessage(CONTAMINATED), "how do I activate it", "precondition: the owner's message has no artifact request");
  assert.equal(wantsWorkArtifact(CONTAMINATED, {}), false,
    "a follow-up question must not write four files because the context mentioned a document");
});

test("B-08 — the owner actually asking for an artifact still fires it", () => {
  const { wantsWorkArtifact } = loadClassifiers();
  assert.equal(wantsWorkArtifact("Context: unrelated chatter.\n\nUser: create a research brief on Kalshi spreads", {}), true);
  assert.equal(wantsWorkArtifact("make me a study sheet on options greeks", {}), true, "a bare prompt with no prefix still works");
});

test("B-08 — an explicit route still wins regardless of wording", () => {
  const { wantsWorkArtifact } = loadClassifiers();
  assert.equal(wantsWorkArtifact("anything at all", { route: { workComposer: true } }), true);
});

test("B-08 — the title comes from the owner's message, not the context prefix", () => {
  const { artifactTitleForPrompt } = loadClassifiers();
  const title = artifactTitleForPrompt("Context: earlier we discussed the Q3 revenue teardown.\n\nUser: build a briefing on prediction market liquidity");
  assert.doesNotMatch(title, /Q3 revenue teardown/, "context text must not leak into the artifact title");
  assert.match(title, /prediction market liquidity/);
});

test("B-08 — the format comes from the owner's message too", () => {
  const { artifactFormatForPrompt } = loadClassifiers();
  assert.equal(
    artifactFormatForPrompt("Context: we were looking at slides and a presentation deck.\n\nUser: write a study sheet on greeks"),
    "study_sheet",
    "the context's 'deck' must not override the owner's 'study sheet'",
  );
});

test("B-08 — no classifier is left reading the raw prompt", () => {
  // The bug was one function being missed while its siblings were fixed. Guard all three.
  for (const name of ["wantsWorkArtifact", "artifactFormatForPrompt", "artifactTitleForPrompt"]) {
    const start = source.indexOf(`function ${name}(`);
    const block = source.slice(start, source.indexOf("\n}", start));
    assert.match(block, /rawUserMessage\(prompt\)/, `${name} must classify the owner's message only`);
    assert.doesNotMatch(block, /String\(prompt \|\| ""\)/, `${name} still reads the context-contaminated prompt`);
  }
});
