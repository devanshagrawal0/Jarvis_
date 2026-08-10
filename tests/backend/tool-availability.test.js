"use strict";

// B-04 / B-07: the model must be able to reach the tools it is told it has.
//
// B-04 — `indirect` is the prompt-injection guard: "these arguments may have been shaped by
// content the owner didn't write". It was wired to `turn > 0`, the round counter, which is not a
// trust signal. Anything not on the browser-continuation allowlist whose risk isn't `observe`
// was denied from round 1 onward, so an ordinary "look it up, then save it" turn returned
// `denied` and the model paraphrased that to the owner as "I don't have an active file-writing
// tool available in this session" — while `write_file` sat in `alwaysUseful` the whole time.
//
// B-07 — three Instagram capabilities had definitions and handlers but no declaration, so
// `selectTools` (which resolves names against `declarations`) could never surface them, while
// `toolAvailability()` and `catalog()` (built from `definitions`) advertised them as available.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const engineSource = fs.readFileSync(path.join(root, "server", "capability-engine.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

function sliceBlock(source, opener, closer) {
  const start = source.indexOf(opener);
  assert.notEqual(start, -1, `could not find ${opener}`);
  const end = source.indexOf(closer, start);
  assert.ok(end > start, `could not find the end of ${opener}`);
  return source.slice(start, end);
}

// ── B-07 ───────────────────────────────────────────────────────────────────
test("B-07 — every advertised capability is declarable, so nothing is announced but unreachable", () => {
  // `definitions` is an ARRAY OF TUPLES — ["name", "description", risk, bool]. A parser that
  // assumes the object form finds zero entries and reports a vacuous pass, so the counts are
  // asserted first: if the parser breaks, this test fails instead of quietly succeeding.
  const definitions = [...sliceBlock(engineSource, "const definitions = [", "\n  ];").matchAll(/^\s*\[\s*"([a-z0-9_]+)"/gim)].map((m) => m[1]);
  const declarations = [...sliceBlock(engineSource, "const declarations = [", "\n  ];").matchAll(/name:\s*"([a-z0-9_]+)"/gi)].map((m) => m[1]);
  const handlers = [...sliceBlock(engineSource, "const handlers = {", "\n  };").matchAll(/^\s{4}(?:async\s+)?([a-z0-9_]+)\s*[:(]/gim)].map((m) => m[1]);

  assert.ok(definitions.length > 100, `parser found only ${definitions.length} definitions — the registry shape changed`);
  assert.ok(declarations.length > 100, `parser found only ${declarations.length} declarations — the registry shape changed`);
  assert.ok(handlers.length > 100, `parser found only ${handlers.length} handlers — the registry shape changed`);

  const missingDeclaration = definitions.filter((name) => !declarations.includes(name));
  const missingHandler = definitions.filter((name) => !handlers.includes(name));
  const orphanDeclaration = declarations.filter((name) => !definitions.includes(name));

  assert.deepEqual(missingDeclaration, [], `advertised but unreachable by the model: ${missingDeclaration.join(", ")}`);
  assert.deepEqual(missingHandler, [], `declared with no implementation: ${missingHandler.join(", ")}`);
  assert.deepEqual(orphanDeclaration, [], `declared but undefined: ${orphanDeclaration.join(", ")}`);
});

test("B-07 — the three Instagram capabilities specifically are reachable", () => {
  const declarations = sliceBlock(engineSource, "const declarations = [", "\n  ];");
  for (const name of ["instagram_like_current", "instagram_prepare_dm", "instagram_send_current"]) {
    assert.match(declarations, new RegExp(`name:\\s*"${name}"`), `${name} is still missing a declaration`);
  }
});

// ── B-04 ───────────────────────────────────────────────────────────────────
// The denial rule, lifted from capability-engine.js so the test exercises the real predicate.
function indirectBlocked({ tool, risk, indirect }) {
  const safeBrowserContinuation = new Set([...sliceBlock(engineSource, "const safeBrowserContinuation = new Set([", "]);").matchAll(/"([a-z0-9_]+)"/gi)].map((m) => m[1]));
  return Boolean(indirect) && !safeBrowserContinuation.has(tool) && (
    risk !== "observe" || ["list_processes", "network_inventory", "search_files", "memory_search"].includes(tool)
  );
}

test("B-04 — the taint flag follows provenance, not the round counter", () => {
  assert.match(serverSource, /indirect: untrustedContentInLoop/, "the execution site should pass the provenance flag");
  assert.doesNotMatch(serverSource, /indirect: turn > 0/, "the round counter must no longer stand in for trust");
  assert.match(serverSource, /if \(UNTRUSTED_CONTENT_TOOL\.test\(functionCall\.name\)\) untrustedContentInLoop = true;/, "the flag must actually be raised when external content enters the loop");
});

test("B-04 — the scenario the owner hit: look something up, then write a file", () => {
  const UNTRUSTED = new RegExp(sliceBlock(serverSource, "const UNTRUSTED_CONTENT_TOOL = /", "/i;").replace("const UNTRUSTED_CONTENT_TOOL = /", ""), "i");
  // Round 0: a memory lookup — the owner's own data, taints nothing.
  let tainted = false;
  if (UNTRUSTED.test("memory_search")) tainted = true;
  assert.equal(tainted, false, "a memory lookup must not taint the turn");
  // Round 1: write the file. This is what was being denied.
  assert.equal(indirectBlocked({ tool: "write_file", risk: "commit", indirect: tainted }), false,
    "write_file was denied after a harmless lookup — the exact false 'I have no file tool' refusal");
});

test("B-04 — inbound reads taint the turn; drafting the owner's own email does not", () => {
  const UNTRUSTED = new RegExp(sliceBlock(serverSource, "const UNTRUSTED_CONTENT_TOOL = /", "/i;").replace("const UNTRUSTED_CONTENT_TOOL = /", ""), "i");
  // Tools that pull content the owner didn't write MUST taint — including READING inbound gmail.
  for (const tool of ["url_read", "web_research", "browser_extract", "screen_capture", "computer_use", "read_clipboard", "gmail_read", "gmail_search", "gmail_thread", "gmail_message"]) {
    assert.equal(UNTRUSTED.test(tool), true, `${tool} pulls external content and must raise the taint flag`);
  }
  // gmail_prepare_email / gmail_send_prepared act on the owner's OWN draft — the recipient/subject/body
  // are fields the owner (or the model on their behalf) supplied, and the "read back" is of that same
  // draft, not an inbound message. They ingest nothing untrusted, so they must NOT taint. If they did,
  // the send in the same turn would be denied as "indirect" before an approval card could appear — the
  // real prepare→send failure this guard once caused. The trust line is inbound-read, not gmail-prefix.
  for (const tool of ["gmail_prepare_email", "gmail_send_prepared"]) {
    assert.equal(UNTRUSTED.test(tool), false, `${tool} works on the owner's own draft and must NOT taint the turn`);
  }
  // …and once a real inbound read tainted the turn, a side-effecting tool is still refused. Guard on.
  assert.equal(indirectBlocked({ tool: "write_file", risk: "commit", indirect: true }), true,
    "after untrusted content entered the loop, write_file must still be denied");
  assert.equal(indirectBlocked({ tool: "run_command", risk: "execute", indirect: true }), true);
  assert.equal(indirectBlocked({ tool: "delete_file", risk: "commit", indirect: true }), true);
});

test("B-04 — owner-scoped reads never taint", () => {
  const UNTRUSTED = new RegExp(sliceBlock(serverSource, "const UNTRUSTED_CONTENT_TOOL = /", "/i;").replace("const UNTRUSTED_CONTENT_TOOL = /", ""), "i");
  for (const tool of ["memory_search", "neural_vault_context", "system_status", "kalshi_positions", "skill_list", "mesh_status"]) {
    assert.equal(UNTRUSTED.test(tool), false, `${tool} reads the owner's own data and must not taint the turn`);
  }
});

// ── B-23 ───────────────────────────────────────────────────────────────────
// `jarvis-intelligence.test.js` asserts `selectTools` against a hand-written ~40-declaration
// fixture from which `write_file`, `run_command`, `delete_file` and `compose_artifact` are
// absent — so the `slice(0, limit)` truncation that dropped `write_file` in production (B-10)
// could not occur in it, and mentally reinstating B-10 left every assertion green. This drives
// the REAL declaration set through the REAL `selectTools`.
const { createToolGateway } = require("../../server/tool-gateway");

function realGateway() {
  // `definitions` is an array of TUPLES: ["name", "description", risk, confirmationRequired].
  const definitions = [...sliceBlock(engineSource, "const definitions = [", "\n  ];")
    .matchAll(/^\s*\[\s*"([a-z0-9_]+)"\s*,\s*"((?:[^"\\]|\\.)*)"/gim)]
    .map((m) => ({ name: m[1], description: m[2].replace(/\\"/g, '"') }));
  const declarations = [...sliceBlock(engineSource, "const declarations = [", "\n  ];")
    .matchAll(/name:\s*"([a-z0-9_]+)"/gi)]
    .map((m) => ({ name: m[1], description: "", parameters: { type: "object", properties: {} } }));

  // Guard the parsers themselves — a fixture that silently comes back tiny IS the B-23 defect.
  assert.ok(definitions.length > 60,
    `the real definition set should be large — got ${definitions.length}; a small fixture is exactly what this replaces`);
  assert.ok(declarations.length > 60, `expected the real declaration set — got ${declarations.length}`);
  for (const required of ["write_file", "run_command", "delete_file", "compose_artifact"]) {
    assert.ok(definitions.some((d) => d.name === required),
      `${required} must be present, or this test reproduces the fixture it is meant to replace`);
  }
  return createToolGateway({
    capabilityEngine: { declarations, definitions, execute: async () => ({ ok: true }) },
    moduleRegistry: { list: () => [] },
    codeKnowledge: { inspect: () => ({}) },
  });
}

test("B-23 — write_file survives selection for a file-writing prompt, against the real tool set", () => {
  const gateway = realGateway();
  const selected = gateway.selectTools("write a file called notes.md with my meeting notes", { limit: 10, intent: "action", route: { action: true } });
  assert.ok(selected.some((tool) => tool.name === "write_file"),
    "this is the exact production failure B-10 fixed, and no test anywhere covered it");
});

test("B-23 — the prompt-matched tool is not truncated away by lower-ranked suggestions", () => {
  const gateway = realGateway();
  // A small limit is where truncation bites: whatever the prompt names has to outrank filler.
  const selected = gateway.selectTools("run a command to list the running processes", { limit: 3, intent: "action", route: { action: true } });
  assert.ok(selected.length <= 3, "the limit must still be honoured");
  assert.ok(selected.some((tool) => tool.name === "run_command"),
    "a required (prompt-matched) tool must be kept before suggestions fill the remaining slots");
});
