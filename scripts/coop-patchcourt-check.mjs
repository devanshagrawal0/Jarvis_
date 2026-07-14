// Synapse W7 — real Patch Court acceptance. Unit-checks multi-hunk apply, the git-worktree CI-lite
// (real syntax detection for JS + TS), the risky-pattern scan, and the deterministic adversarial
// review verdicts. Then drives a live server: propose a multi-hunk patch → ghost-test (CI-lite +
// review) → approve → apply (host writes disk) → verify; a bad-syntax patch fails CI; a secret is
// blocked at propose. All on throwaway files, cleaned up. Exit non-zero on failure.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PC = require(path.join(ROOT, "server", "coop-patchcourt.js"));

let pass = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS ${n}${d ? ` — ${d}` : ""}`); };
const tmpFiles = [];
const mkTmp = (name, content) => { const p = path.join(ROOT, name); fs.writeFileSync(p, content, "utf8"); tmpFiles.push(p); return name; };

// ---- 1) unit: multi-hunk apply ----
{
  const r = PC.applyHunks("alpha beta gamma", [{ originalText: "alpha", replacementText: "A" }, { originalText: "gamma", replacementText: "G" }]);
  assert.ok(r.ok && r.content === "A beta G", "two hunks applied in sequence");
  const fail = PC.applyHunks("alpha", [{ originalText: "missing", replacementText: "x" }]);
  assert.ok(!fail.ok && fail.failedHunk === 0, "unmatched hunk fails cleanly");
  ok("multi-hunk apply (sequential + failure)");

  assert.deepEqual(PC.scanRisky("const x = eval('2+2'); require('child_process')"), ["uses eval()", "spawns a child process / shell"]);
  assert.equal(PC.scanRisky("const x = 1").length, 0);
  ok("risky-pattern scan");
}

// ---- 2) unit: CI-lite (git worktree) syntax detection ----
{
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), "pc-ci-"));
  const goodJs = PC.ciLite({ rootDir: ROOT, relPath: "tmp.js", content: "const x = 1; module.exports = x;", sandboxDir: path.join(sb, "a") });
  assert.equal(goodJs.status, "passed", "valid JS passes CI-lite");
  assert.ok(goodJs.checks.find((c) => c.name === "git-worktree")?.ok, "ran in a git worktree");
  const badJs = PC.ciLite({ rootDir: ROOT, relPath: "tmp.js", content: "const x = ;", sandboxDir: path.join(sb, "b") });
  assert.equal(badJs.status, "failed", "invalid JS fails CI-lite (node --check)");
  const goodTs = PC.ciLite({ rootDir: ROOT, relPath: "tmp.tsx", content: "const x: number = 1; export const C = () => <div>{x}</div>;", sandboxDir: path.join(sb, "c") });
  assert.equal(goodTs.status, "passed", "valid TSX passes");
  const badTs = PC.ciLite({ rootDir: ROOT, relPath: "tmp.ts", content: "const x: = 1 1 1", sandboxDir: path.join(sb, "d") });
  assert.equal(badTs.status, "failed", "invalid TS fails (tsc syntax)");
  fs.rmSync(sb, { recursive: true, force: true });
  ok("git-worktree CI-lite detects good/bad JS + TS syntax");
}

// ---- 3) unit: adversarial review verdicts ----
{
  const clean = PC.redTeamReview({ patch: { testsToRun: ["t"], baseLength: 10 }, content: "ok", hasSecret: false, ciResult: { checks: [{ name: "node --check", ok: true }], risky: [] } });
  assert.equal(clean.verdict, "pass", "clean patch → pass");
  const secret = PC.redTeamReview({ patch: { testsToRun: ["t"] }, content: "x", hasSecret: true, ciResult: { checks: [], risky: [] } });
  assert.equal(secret.verdict, "block", "secret → block");
  const badSyntax = PC.redTeamReview({ patch: { testsToRun: ["t"] }, content: "x", hasSecret: false, ciResult: { checks: [{ name: "node --check", ok: false, detail: "err" }], risky: [] } });
  assert.equal(badSyntax.verdict, "block", "syntax failure → block");
  const risky = PC.redTeamReview({ patch: { testsToRun: ["t"], baseLength: 5 }, content: "eval()", hasSecret: false, ciResult: { checks: [{ name: "node --check", ok: true }], risky: ["uses eval()"] } });
  assert.equal(risky.verdict, "warn", "risky pattern → warn (not block)");
  ok("adversarial review verdicts (pass/warn/block)");
}

// ---- 4) live HTTP flow ----
const port = Number(process.env.SYN_W7_PORT || 8989);
const base = `http://127.0.0.1:${port}`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-w7-"));
let server;
try {
  // throwaway files in the repo the patches target (real filesystem apply, then cleaned up).
  const cleanFile = mkTmp(".synapse-w7-clean.js", "const greeting = 'hello';\nmodule.exports = { greeting };\n");
  const badFile = mkTmp(".synapse-w7-bad.js", "const value = 1;\nmodule.exports = { value };\n");

  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir, GEMINI_API_KEY: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "", JARVIS_MOCK_SCREEN_CAPTURE: "1", JARVIS_DESKTOP_CONTROL_DRY_RUN: "1" },
    stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  const cookie = (await fetch(`${base}/api/capabilities`)).headers.get("set-cookie")?.split(";")[0] || "";
  const H = { "content-type": "application/json", cookie };
  const j = async (p, b) => (await fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) })).json();
  const raw = (p, b) => fetch(`${base}${p}`, { method: "POST", headers: H, body: JSON.stringify(b) });

  const sid = (await j("/api/coop-symbiote/session/create", { title: "W7", mode: "Code Review Mode" })).session.id;

  // Multi-hunk patch on the clean file → ghost-test → review → approve → apply → verify.
  const patch = (await j("/api/coop-symbiote/patches", { sessionId: sid, filePath: cleanFile, author: "Aryan", summary: "two-hunk edit", hunks: [{ originalText: "'hello'", replacementText: "'hello world'" }, { originalText: "greeting }", replacementText: "greeting, ok: true }" }] })).patch;
  assert.equal(patch.hunks.length, 2, "multi-hunk patch stored");
  const ghosted = (await j(`/api/coop-symbiote/patches/${patch.id}/ghost-test`, { sessionId: sid })).patch;
  assert.equal(ghosted.status, "ghost_passed", "clean multi-hunk patch passes CI-lite");
  assert.ok(["pass", "warn"].includes(ghosted.review.verdict), "adversarial review ran and did not block a clean patch");
  assert.ok(ghosted.ghostResult.checks.some((c) => c.name === "node --check" && c.ok), "node --check ran and passed in worktree");
  await j(`/api/coop-symbiote/patches/${patch.id}/approve`, { sessionId: sid, actor: "Dev" });
  const applied = await raw(`/api/coop-symbiote/patches/${patch.id}/apply`, { sessionId: sid, actor: "Dev" });
  assert.equal(applied.status, 200, "clean patch applies");
  assert.ok(fs.readFileSync(path.join(ROOT, cleanFile), "utf8").includes("hello world"), "hunk 1 landed on disk");
  assert.ok(fs.readFileSync(path.join(ROOT, cleanFile), "utf8").includes("ok: true"), "hunk 2 landed on disk");
  ok("multi-hunk patch: propose → CI-lite → approve → apply (both hunks on disk)");

  // Bad-syntax patch → CI-lite fails → ghost_failed → apply rejected.
  const badPatch = (await j("/api/coop-symbiote/patches", { sessionId: sid, filePath: badFile, author: "Aryan", summary: "break it", originalText: "const value = 1;", replacementText: "const value = ;" })).patch;
  const badGhost = (await j(`/api/coop-symbiote/patches/${badPatch.id}/ghost-test`, { sessionId: sid })).patch;
  assert.equal(badGhost.status, "ghost_failed", "bad-syntax patch fails CI-lite");
  const badApply = await raw(`/api/coop-symbiote/patches/${badPatch.id}/apply`, { sessionId: sid, actor: "Dev" });
  assert.equal(badApply.status, 409, "bad patch cannot be applied");
  assert.ok(!fs.readFileSync(path.join(ROOT, badFile), "utf8").includes("= ;"), "bad content never touched disk");
  ok("bad-syntax patch fails CI-lite and is refused at apply");

  // Secret in a patch → blocked at propose.
  const secretRes = await raw("/api/coop-symbiote/patches", { sessionId: sid, filePath: cleanFile, author: "Aryan", summary: "leak", originalText: "'hello world'", replacementText: "'AIzaSyA1234567890abcdefghijklmnopqrstuv'" });
  assert.equal(secretRes.status, 403, "secret-bearing patch blocked at propose");
  ok("secret-bearing patch blocked before it enters Patch Court");

  console.log(`\nSynapse W7 Patch Court check passed: ${pass}/${pass}`);
} finally {
  if (server && !server.killed) { const exited = new Promise((r) => server.once("exit", r)); server.kill(); await exited; }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch {} }
}
