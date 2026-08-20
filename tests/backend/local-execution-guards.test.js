"use strict";

// B-21 / B-22: the guards around local file writes and shell execution.
//
// B-21 — write_file/delete_file were guarded by one regex covering three directories on a single
// drive. ProgramData, every other drive, UNC shares and the per-user Startup folder were all
// writable, so a single approved write_file established boot persistence. Jarvis's own runtime
// state (memory databases, keyring, browser profile) was writable too.
//
// B-22 — run_command's PowerShell blocklist was treated as containment. It is not: every entry
// is trivially expressible another way, and the command runs with -ExecutionPolicy Bypass. The
// gate that actually holds is the owner confirmation, and `effectiveLevel !== "autopilot"`
// removed it at the highest autonomy level.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
// Normalised to LF. The fragment markers below are written with "\n", so on a CRLF checkout —
// which is what git hands you on Windows — `indexOf("\n}\n")` matches nothing and the whole file
// fails to load with "could not find the end of function errorWithStatus". That is the test's own
// line endings failing, not the guard it is meant to be checking.
const engineSource = fs.readFileSync(path.join(root, "server", "capability-engine.js"), "utf8").replace(/\r\n/g, "\n");
const { evaluateAutonomy } = require("../../server/autonomy-policy");

// Lift the real guard out of the engine rather than reimplementing it, so the test tracks the
// shipped code. All fragments share one scope — evaluating them separately leaves
// PROTECTED_WRITE_TARGETS undefined, and the resulting throw would read as a successful block.
function loadPathGuard() {
  const frag = (startMarker, endMarker, offset = 2) => {
    const start = engineSource.indexOf(startMarker);
    assert.notEqual(start, -1, `could not find ${startMarker}`);
    const end = engineSource.indexOf(endMarker, start);
    assert.ok(end > start, `could not find the end of ${startMarker}`);
    return engineSource.slice(start, end + offset);
  };
  const bundle = [
    frag("function errorWithStatus", "\n}\n"),
    frag("const PROTECTED_WRITE_TARGETS = [", "];"),
    frag("function assertWritableTarget", "\n}\n"),
    "return assertWritableTarget;",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  return new Function("require", "path", bundle)(require, path);
}

const assertWritableTarget = loadPathGuard();
const RUNTIME = path.join(root, "runtime");

// A refusal only counts when the guard says so — any other throw means the test broke.
function refusalFor(target) {
  try { assertWritableTarget(target, RUNTIME); return null; }
  catch (error) {
    assert.match(error.message, /^Refused:/, `guard threw something other than a refusal: ${error.message}`);
    return error.message;
  }
}

test("B-21 — persistence, system and network paths are refused", () => {
  const mustBlock = [
    ["Startup folder", "C:\\Users\\dev\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.bat"],
    ["ProgramData", "C:\\ProgramData\\payload.dll"],
    ["Windows directory", "C:\\Windows\\System32\\drivers\\etc\\hosts"],
    ["Program Files", "C:\\Program Files\\app\\x.exe"],
    ["Program Files (x86)", "C:\\Program Files (x86)\\app\\x.exe"],
    ["Windows on another drive", "D:\\Windows\\thing.dll"],
    ["UNC share", "\\\\server\\share\\payload.exe"],
    ["system32 on any drive", "D:\\stuff\\System32\\bad.dll"],
    ["git metadata", "C:\\proj\\.git\\config"],
    ["node_modules", "C:\\proj\\node_modules\\pkg\\index.js"],
  ];
  for (const [label, target] of mustBlock) {
    assert.ok(refusalFor(target), `${label} was allowed: ${target}`);
  }
});

test("B-21 — Jarvis's own runtime state is not writable by a model-chosen path", () => {
  // Losing the vault or the keyring to a stray path argument would be silent and unrecoverable.
  for (const relative of ["neural_vault/db/neural_vault.sqlite", "user-context.sqlite", "browser-profile/Default/Cookies"]) {
    const target = path.join(RUNTIME, ...relative.split("/"));
    assert.ok(refusalFor(target), `runtime state was writable: ${target}`);
  }
});

test("B-21 — ordinary destinations still work", () => {
  // A guard that blocks everything is not a fix; write_file has to keep working.
  for (const target of [
    "C:\\Users\\dev\\OneDrive\\Desktop\\notes.md",
    "C:\\Users\\dev\\OneDrive\\Documents\\report.docx",
    "D:\\work\\output.csv",
    path.join(root, "src", "App.tsx"),
  ]) {
    assert.equal(refusalFor(target), null, `a normal destination was blocked: ${target}`);
  }
});

// `{ level: "autopilot" }` alone is NOT autopilot: without a future `autopilotExpiresAt` the
// profile downgrades to "act", where confirmation was already required. A test written that way
// passes whether or not the fix exists — verified by mutation. The expiry is mandatory here.
const liveAutopilot = () => ({ level: "autopilot", autopilotExpiresAt: new Date(Date.now() + 3_600_000).toISOString() });

test("B-22 — run_command requires owner confirmation at EVERY autonomy level", () => {
  for (const profile of [{ level: "manual" }, { level: "assisted" }, liveAutopilot()]) {
    const verdict = evaluateAutonomy({ tool: "run_command", definition: { risk: "execute" }, profile, context: {} });
    assert.equal(verdict.requiresConfirmation, true,
      `run_command ran unconfirmed at level "${profile.level}" (effective "${verdict.effectiveLevel}")`);
  }
});

test("B-22 — a live autopilot session is genuinely reachable, so the guard is load-bearing", () => {
  // If this ever downgrades, the test above stops testing anything.
  const verdict = evaluateAutonomy({ tool: "run_command", definition: { risk: "execute" }, profile: liveAutopilot(), context: {} });
  assert.equal(verdict.effectiveLevel, "autopilot",
    "the fixture no longer produces a live autopilot session — the confirmation test would pass vacuously");
});

test("B-22 — the low-risk execute carve-out is preserved", () => {
  // Autopilot must still mean something, or the fix is just friction.
  const verdict = evaluateAutonomy({ tool: "open_url", definition: { risk: "execute" }, profile: liveAutopilot(), context: {} });
  assert.equal(verdict.requiresConfirmation, false, "open_url should stay unconfirmed at autopilot");
});

test("B-22 — the blocklist covers the pipeline loop forms it originally missed", () => {
  const start = engineSource.indexOf("const BLOCKED_PS = [");
  const list = engineSource.slice(start, engineSource.indexOf("];", start));
  // Plain substrings: the list is regex SOURCE, so it contains escapes like `Diagnostics\.Process`
  // and a pattern whose `.` matches one character cannot span the backslash-dot pair.
  for (const construct of ["ForEach-Object", "scriptblock", "Start-Job", "Diagnostics", "schtasks", "Invoke-Command"]) {
    assert.ok(list.includes(construct), `BLOCKED_PS no longer covers ${construct}`);
  }
  // And the honest framing must survive: this is resource protection, not containment.
  assert.match(engineSource.slice(start - 900, start), /not a security boundary/i,
    "the blocklist must stay documented as a heuristic so it is not mistaken for containment");
});
