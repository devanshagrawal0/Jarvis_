"use strict";

// B-13 / B-14 / B-15 / B-16 — the automation lane's honesty and containment gaps.
//
// B-13 run_command discarded stdout/stderr/exitCode on failure, so every non-zero exit became
//      "run_command completed without verifying the requested outcome" with the real message gone.
// B-14 react-loop hardcoded `indirect: true` (denying missions every non-observe tool), emitted
//      confirmations with no id/ownerChallenge (unapprovable, so the mission hung), and rendered
//      raw execution envelopes as the user-facing answer.
// B-15 computer-use parsed planner JSON with a bare JSON.parse while its sibling module carries a
//      documented repair ladder for exactly the failure that reached the owner as
//      "Bad control character in string literal in JSON at position 24".
// B-16 snapshot() computed securitySignals and nothing read them; page text went straight into
//      the planner prompt, so hostile page content could steer the next action.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const engineSource = read("server/capability-engine.js");
const computerUseSource = read("server/computer-use.js");
const reactLoopSource = read("server/react-loop.js");

// Several fixes document the bug they replaced, so an assertion against the raw source would
// match its own explanation. Compare executable lines only.
const stripComments = (source) => source
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

// ── B-15 ───────────────────────────────────────────────────────────────────
test("B-15 — planner JSON goes through the repair ladder, not a bare JSON.parse", () => {
  assert.doesNotMatch(computerUseSource, /return JSON\.parse\(clean\);/,
    "a bare JSON.parse on a planner response is what leaked the raw V8 message to the owner");
  assert.equal((computerUseSource.match(/parsePlannerJson\(clean\)/g) || []).length, 2,
    "both planner call sites should use the repair ladder");
});

test("B-15 — the repair ladder actually survives a literal newline inside a JSON string", () => {
  const { parseJson } = require("../../server/universal-browser-agent");
  const broken = '{"action":"fill","value":"line one\nline two","done":false}';
  assert.throws(() => JSON.parse(broken), /control character/i, "precondition: this input breaks JSON.parse");
  const repaired = parseJson(broken);
  assert.equal(repaired.action, "fill", "the repair ladder should recover the planner decision");
});

// ── B-13 ───────────────────────────────────────────────────────────────────
test("B-13 — a failing run_command reports the real reason, not a generic sentence", () => {
  const start = engineSource.indexOf("run_command: async");
  const block = engineSource.slice(start, start + 4000);
  assert.match(block, /error: `Command exited/,
    "the failure must set `error`, which is the field execute() actually reads");
  assert.match(block, /err\.stderr/, "stderr should feed the reported reason");
  assert.match(block, /exitCode: err\.code/, "the exit code should survive");
  // The old shape set neither `error` nor `result`, which is why execute() fell through to its
  // content-free message.
  assert.doesNotMatch(block, /return \{ ok: false, stdout: \(err\.stdout \|\| ""\)\.trim\(\), stderr/,
    "the original lossy return shape should be gone");
});

// ── B-16 ───────────────────────────────────────────────────────────────────
test("B-16 — securitySignals are enforced, not merely computed", () => {
  assert.match(computerUseSource, /snap\.securitySignals/,
    "the planner loop must read the signals the snapshot produces");
  assert.match(computerUseSource, /securityHalt: true/,
    "a detected injection attempt must halt the run rather than continue into the prompt");
  // The halt has to happen BEFORE page text is handed to the planner.
  const haltAt = computerUseSource.indexOf("securityHalt: true");
  const promptAt = computerUseSource.indexOf("PAGE TEXT EXCERPT");
  assert.ok(haltAt > 0 && haltAt < promptAt,
    "the security halt must precede the prompt that embeds page text");
});

// ── B-14 ───────────────────────────────────────────────────────────────────
test("B-14 — missions no longer hardcode the taint flag", () => {
  // Strip comments: the fix documents the old `indirect: true` in prose, which would self-match.
  const code = stripComments(reactLoopSource);
  assert.doesNotMatch(code, /indirect: true/,
    "hardcoding indirect denied a mission every non-observe tool");
  assert.match(reactLoopSource, /indirect: untrustedContentSeen/,
    "the flag should follow provenance, as it does in server.js");
  assert.match(reactLoopSource, /if \(UNTRUSTED_CONTENT_TOOL\.test\(call\.name\)\) untrustedContentSeen = true;/,
    "external-content tools must raise the flag");
});

test("B-14 — unapprovable confirmations are reported as blocked, not left pending", () => {
  assert.match(reactLoopSource, /\.filter\(\(item\) => item && item\.id && item\.ownerChallenge\)/,
    "only confirmations carrying both an id and an owner challenge can be approved");
  assert.match(reactLoopSource, /blockedForApproval/,
    "tools refused for want of an owner session should be surfaced as blocked");
});

test("B-14 — raw execution envelopes never become the answer", () => {
  // Everything after the comment marker; the comment itself mentions the old code.
  const code = reactLoopSource.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /JSON\.stringify\(toolResults/,
    "serialising execution envelopes into the response leaked paths, receipts and internal errors");
  assert.match(code, /summarizeToolResults\(toolResults\)/, "a readable summary should be the answer");
});

test("B-14 — the summariser produces prose, and leaks nothing structural", () => {
  const start = reactLoopSource.indexOf("function summarizeToolResults");
  const end = reactLoopSource.indexOf("\n}\n", start);
  // eslint-disable-next-line no-new-func
  const summarize = new Function(`${reactLoopSource.slice(start, end + 2)}\nreturn summarizeToolResults;`)();

  const summary = summarize([
    { tool: "memory_search", ok: true, result: { hits: 3 } },
    { tool: "write_file", ok: false, error: "Refused: the Startup folder would establish boot persistence.", receipt: { id: "r-1" } },
  ]);
  assert.match(summary, /Completed 2 tool operations \(1 succeeded\)/);
  assert.match(summary, /write_file failed: Refused/, "a failure reason should reach the owner");
  assert.doesNotMatch(summary, /receipt|\{|\}/, "no envelope structure should appear in prose");
});
