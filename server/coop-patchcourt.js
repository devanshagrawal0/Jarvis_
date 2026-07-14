// Synapse (Co-Op) W7 — real Patch Court: multi-hunk patches, isolated git-worktree CI-lite
// (syntax + risky-pattern checks), and a deterministic adversarial red-team review that must not
// BLOCK before a patch can be applied. No model needed — these are real, fast, verifiable checks.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// Patterns a red-team reviewer flags in a proposed change.
const RISKY = [
  { re: /\beval\s*\(/, msg: "uses eval()" },
  { re: /\bnew\s+Function\s*\(/, msg: "constructs code via new Function()" },
  { re: /child_process|\bexecSync\s*\(|\bspawnSync?\s*\(|\bexecFileSync\s*\(/, msg: "spawns a child process / shell" },
  { re: /fs\.(rm|rmSync|unlink|unlinkSync|rmdir)\b/, msg: "deletes files" },
  { re: /\bprocess\.exit\s*\(/, msg: "calls process.exit()" },
  { re: /dangerouslySetInnerHTML/, msg: "injects raw HTML" },
];

// Apply hunks in sequence to base content. Each hunk: { originalText, replacementText } or a full
// { nextContent }. Returns { ok, content } or { ok:false, failedHunk, reason }.
function applyHunks(base, hunks) {
  let content = String(base);
  const applied = [];
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i] || {};
    if (h.nextContent != null && !h.originalText) { content = String(h.nextContent); applied.push(i); continue; }
    const orig = String(h.originalText || "");
    if (!orig) return { ok: false, failedHunk: i, reason: `hunk ${i + 1} has no original text to match` };
    if (!content.includes(orig)) return { ok: false, failedHunk: i, reason: `hunk ${i + 1} original text not found in file` };
    content = content.replace(orig, String(h.replacementText || ""));
    applied.push(i);
  }
  return { ok: true, content, applied };
}

function scanRisky(content) {
  const hits = [];
  for (const r of RISKY) if (r.re.test(String(content))) hits.push(r.msg);
  return hits;
}

// CI-lite in an isolated git worktree (--no-checkout is instant): syntax check (node --check for
// JS; the TypeScript compiler for TS/TSX) + risky-pattern scan. Falls back to a plain sandbox if
// the worktree can't be created. Returns { status:"passed"|"failed", checks[], risky[] }.
function ciLite({ rootDir, relPath, content, sandboxDir, timeoutMs = 8000 }) {
  const checks = [];
  const ext = path.extname(relPath).toLowerCase();
  let wt = null;
  let targetFile;
  try {
    wt = path.join(sandboxDir, "wt");
    fs.rmSync(wt, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "--no-checkout", "--detach", wt, "HEAD"], { cwd: rootDir, timeout: timeoutMs, stdio: ["ignore", "ignore", "pipe"] });
    targetFile = path.join(wt, relPath);
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, content, "utf8");
    checks.push({ name: "git-worktree", ok: true, detail: "isolated worktree at HEAD" });
  } catch {
    fs.mkdirSync(sandboxDir, { recursive: true });
    targetFile = path.join(sandboxDir, path.basename(relPath));
    fs.writeFileSync(targetFile, content, "utf8");
    checks.push({ name: "git-worktree", ok: false, detail: "worktree unavailable — used isolated sandbox" });
  }

  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    try { execFileSync(process.execPath, ["--check", targetFile], { encoding: "utf8", timeout: 5000 }); checks.push({ name: "node --check", ok: true }); }
    catch (e) { checks.push({ name: "node --check", ok: false, detail: String(e.stderr || e.message).slice(0, 240) }); }
  } else if ([".ts", ".tsx"].includes(ext)) {
    try {
      const ts = require("typescript");
      const out = ts.transpileModule(content, { reportDiagnostics: true, compilerOptions: { jsx: ext === ".tsx" ? ts.JsxEmit.Preserve : undefined, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
      const errs = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
      checks.push(errs.length ? { name: "tsc syntax", ok: false, detail: ts.flattenDiagnosticMessageText(errs[0].messageText, "\n").slice(0, 240) } : { name: "tsc syntax", ok: true });
    } catch (e) { checks.push({ name: "tsc syntax", ok: false, detail: `typescript check failed: ${e.message}` }); }
  } else {
    checks.push({ name: "syntax", ok: true, detail: `not-applicable for ${ext || "file"}` });
  }

  const risky = scanRisky(content);
  checks.push({ name: "red-team scan", ok: risky.length === 0, detail: risky.length ? risky.join("; ") : "no risky patterns" });

  if (wt) { try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: rootDir, timeout: timeoutMs, stdio: "ignore" }); } catch { /* orphan cleaned by git prune */ } }

  // Only syntax failures fail the build; risky patterns are warnings surfaced to the reviewer.
  const status = checks.some((c) => !c.ok && /check|syntax/.test(c.name)) ? "failed" : "passed";
  return { status, checks, risky };
}

// Deterministic adversarial review. A BLOCK verdict prevents apply; WARN surfaces objections but
// the host may still proceed; PASS is clean. Runs before a patch can be applied.
function redTeamReview({ patch, content, hasSecret, ciResult }) {
  const objections = [];
  if (hasSecret) objections.push({ severity: "block", message: "Patch introduces secret-like content." });
  const syntax = (ciResult?.checks || []).find((c) => /check|syntax/.test(c.name));
  if (syntax && !syntax.ok) objections.push({ severity: "block", message: `Syntax check failed: ${syntax.detail || ""}`.trim() });
  if (ciResult?.risky?.length) objections.push({ severity: "warn", message: `Risky patterns: ${ciResult.risky.join("; ")}` });
  const delta = Math.abs(String(content || "").length - (patch?.baseLength ?? String(content || "").length));
  if (delta > 4000) objections.push({ severity: "warn", message: `Large change (${delta} chars) — review carefully.` });
  if (!(patch?.testsToRun || []).length) objections.push({ severity: "warn", message: "No tests declared for this change." });
  const verdict = objections.some((o) => o.severity === "block") ? "block" : objections.some((o) => o.severity === "warn") ? "warn" : "pass";
  return { verdict, objections, reviewedAt: new Date().toISOString() };
}

module.exports = { applyHunks, scanRisky, ciLite, redTeamReview };
