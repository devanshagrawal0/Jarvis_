"use strict";

// A-17 / A-19 / B-24 / B-25 / B-26 / C-05 — the P3 tail.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// ── B-24 ───────────────────────────────────────────────────────────────────
// The truthiness guard tested `normalized` while the match used a further-stripped string, so a
// trigger phrase that is entirely placeholder + stopword matched every query ever asked.
const vaultSource = read("server/neural-vault.js");
function loadMacroMatcher() {
  const start = vaultSource.indexOf("function matchActionMacros(query) {");
  assert.ok(start > 0, "matchActionMacros should exist");
  // Brace-counting is wrong here: the body contains regex literals carrying `{` and `}`
  // (`/\{[^}]+\}/g`), which a naive walk mistakes for block delimiters. Anchor on the closing
  // brace at the declaration's own indent instead.
  const end = vaultSource.indexOf("\n  }\n", start);
  assert.ok(end > start, "matchActionMacros should close at its own indent");
  const body = vaultSource.slice(start, end + 4);
  // eslint-disable-next-line no-new-func
  return new Function("listActionMacros", `${body}\nreturn matchActionMacros;`);
}
const macro = (slug, ...triggerPhrases) => ({ slug, id: slug, triggerPhrases });

test("B-24 — a trigger phrase that is entirely placeholder + stopword matches nothing", () => {
  const match = loadMacroMatcher()(() => [macro("greedy", "for {query}")]);
  assert.deepEqual(match("what is the weather in surat").map((m) => m.slug), [],
    "`for {query}` normalized to `for`, stripped to ``, and includes('') is true for every query");
  assert.deepEqual(match("anything at all").map((m) => m.slug), []);
});

test("B-24 — real trigger phrases still match, and only when they should", () => {
  const match = loadMacroMatcher()(() => [macro("youtube-search", "search youtube for {query}")]);
  assert.deepEqual(match("search youtube for lofi beats").map((m) => m.slug), ["youtube-search"]);
  assert.deepEqual(match("what is the capital of france").map((m) => m.slug), []);
});

// ── B-25 ───────────────────────────────────────────────────────────────────
test("B-25 — a trace with no slug does not report the YouTube macro as the macro", () => {
  const code = vaultSource.split(/\r?\n/).filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /macros\.find\(\(macro\) => macro\.slug === "youtube-search"\) \|\| macros\[0\]/,
    "a debug trace that names an arbitrary macro misleads any human or model reading it");
});

// ── B-26 ───────────────────────────────────────────────────────────────────
const repairSource = read("server/agent-repair.js");
function loadIsCorrection() {
  const start = repairSource.indexOf("function isCorrection(lower) {");
  let depth = 0; let i = repairSource.indexOf("{", start);
  for (; i < repairSource.length; i++) {
    if (repairSource[i] === "{") depth++;
    else if (repairSource[i] === "}" && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${repairSource.slice(start, i + 1)}\nreturn isCorrection;`)();
}

test("B-26 — ordinary turns containing no/wrong/actually are not corrections", () => {
  const isCorrection = loadIsCorrection();
  for (const text of [
    "is there no way to do this faster",
    "i took the wrong train this morning",
    "actually i think the second option is better",
    "no problem, carry on",
  ]) {
    assert.equal(isCorrection(text), false, `"${text}" must not be classified as a memory_write correction`);
  }
});

test("B-26 — genuine corrections are still caught", () => {
  const isCorrection = loadIsCorrection();
  for (const text of [
    "no, i am in surat not boston",
    "that's not what i asked",
    "thats not right",
    "i meant the other one",
    "actually, i live in india now",
    "nope, try again",
  ]) {
    assert.equal(isCorrection(text), true, `"${text}" is a correction`);
  }
});

// ── A-19 ───────────────────────────────────────────────────────────────────
test("A-19 — a literal ? in a policy pattern is not a regex wildcard", () => {
  const source = read("server/memory-vnext/policy-engine.js");
  const start = source.indexOf("function globMatch(");
  let depth = 0; let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  // eslint-disable-next-line no-new-func
  const globMatch = new Function(`${source.slice(start, i + 1)}\nreturn globMatch;`)();
  assert.equal(globMatch("report?", "report?"), true, "the literal must still match itself");
  assert.equal(globMatch("report?", "reports"), false, "`?` must not match an arbitrary character");
  assert.equal(globMatch("apex/*", "apex/anything"), true, "`*` is still the one intentional wildcard");
});

// ── A-17 ───────────────────────────────────────────────────────────────────
test("A-17 — the reported canary policy follows the phase actually in force", () => {
  const source = read("server/memory-vnext/shadow-runtime.js");
  const at = source.indexOf("canaryPolicy:");
  const block = source.slice(at, at + 900);
  assert.match(block, /maxFacts: primary \? 12 : 6/,
    "the status endpoint reported the guarded limits even after cutover applied 12/4000");
  assert.match(block, /maxCharacters: primary \? 4000 : 1800/);
  assert.match(block, /phase: primary \? "primary" : "guarded"/, "the phase itself should be reported");
  // The numbers must match the ones prepareCanaryContext actually applies.
  assert.match(source, /\.slice\(0, primary \? 12 : 6\)/);
  assert.match(source, /\.slice\(0, primary \? 4000 : 1800\)/);
});

test("A-17 — the zero cost is stated as a design property, not recomputed as a measurement", () => {
  const source = read("server/memory-vnext/shadow-runtime.js");
  assert.match(source, /costBasis = "local_only_no_provider_calls"/,
    "`providerCalls = 0` was an assignment on every turn, so the reported zero was true by construction");
});

// ── C-05 ───────────────────────────────────────────────────────────────────
test("C-05 — history is windowed by a named constant and trimmed entries are archived", () => {
  const source = read("server.js");
  assert.match(source, /const HISTORY_WINDOW = 500;/, "three unexplained 120s pinned both files at the cap");
  assert.doesNotMatch(source, /\[\.\.\.loadConversation\(\), \.\.\.clean\]\.slice\(-120\)/);
  assert.doesNotMatch(source, /writeJson\(RECEIPTS_PATH, receipts\.slice\(0, 120\)\)/);
  assert.match(source, /function archiveTrimmed\(/, "what falls out of the window must be recorded, not discarded");
  assert.match(source, /archiveTrimmed\(RECEIPTS_PATH, receipts\.slice\(HISTORY_WINDOW\)\)/,
    "receipts are newest-first, so the OLD end is the tail");
});

test("C-05 — trimHistory keeps the newest window and hands back the rest", () => {
  const source = read("server.js");
  const start = source.indexOf("function trimHistory(");
  let depth = 0; let i = source.indexOf("{", start);
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) break;
  }
  const archived = [];
  // eslint-disable-next-line no-new-func
  const trimHistory = new Function("HISTORY_WINDOW", "archiveTrimmed",
    `${source.slice(start, i + 1)}\nreturn trimHistory;`)(3, (_p, dropped) => archived.push(...dropped));

  assert.deepEqual(trimHistory("f", [1, 2]), [1, 2], "under the window nothing is touched");
  assert.deepEqual(archived, []);
  assert.deepEqual(trimHistory("f", [1, 2, 3, 4, 5]), [3, 4, 5], "the newest entries are kept");
  assert.deepEqual(archived, [1, 2], "the oldest are archived, not dropped");
});
