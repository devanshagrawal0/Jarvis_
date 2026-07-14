// Synapse (Co-Op Mesh v2) W9 — advanced differentiators (the self-contained, deterministic ones).
// Cross-user skill fusion, per-peer reputation scoring, "ghost pair-run" (two candidate patches
// raced in isolated git worktrees), and the Kalshi/Quant war-room advisory brief (ANALYSIS ONLY —
// never places trades, never gives personalized financial advice; surfaces divergences, user acts).
// NOTE: the model-driven pieces (real evidence-gated debate, shared Eclipse missions, second
// opinion) reuse the existing Eclipse/chat endpoints from the frontend — not here.

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ---- Cross-user skill fusion: merge two peers' skills into a superset neither had alone ----
function fuseSkills(a = {}, b = {}, { name } = {}) {
  const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
  const both = (k) => uniq([...(a[k] || []), ...(b[k] || [])]);
  return {
    skillId: `fused-${(a.skillId || "a").slice(0, 8)}-${(b.skillId || "b").slice(0, 8)}`,
    name: name || `${a.name || "Skill A"} × ${b.name || "Skill B"}`,
    description: `Fused workflow combining "${a.name || "A"}" and "${b.name || "B"}".`,
    triggerPhrases: both("triggerPhrases"),
    steps: uniq([...(a.steps || []), ...(b.steps || [])]), // superset step graph
    requiredTools: both("requiredTools"),
    permissions: both("permissions"),
    validators: both("validators"),
    failureModes: both("failureModes"),
    tests: both("tests"),
    version: "0.1.0-fused",
    provenance: [
      { skillId: a.skillId, name: a.name, source: a.sourceJarvis || "peer-a" },
      { skillId: b.skillId, name: b.name, source: b.sourceJarvis || "peer-b" },
    ],
    sourceJarvis: "skill-fusion",
  };
}

// ---- Per-peer reputation: trust weight that grows/shrinks with accepted/rejected contributions ----
const REP_WEIGHTS = { patch_applied: 3, patch_approved: 1, patch_rejected: -2, skill_accepted: 2, memory_accepted: 1, kicked: -5 };
function applyReputation(current = {}, event) {
  const rep = { patchesAccepted: 0, patchesRejected: 0, skillsAccepted: 0, events: 0, score: 50, ...current };
  rep.events += 1;
  if (event === "patch_applied" || event === "patch_approved") rep.patchesAccepted += 1;
  if (event === "patch_rejected") rep.patchesRejected += 1;
  if (event === "skill_accepted") rep.skillsAccepted += 1;
  rep.score = Math.max(0, Math.min(100, rep.score + (REP_WEIGHTS[event] || 0)));
  rep.tier = rep.score >= 75 ? "trusted" : rep.score >= 40 ? "established" : "new";
  rep.updatedAt = new Date().toISOString();
  return rep;
}

// ---- Ghost pair-run: race two candidate patches to the same file in isolated worktrees, pick the
// one whose syntax check passes (or both, or neither). Real, safe (no arbitrary command exec). ----
function pairRunCompare({ rootDir, relPath, baseContent, candidateA, candidateB, sandboxDir }) {
  const check = (label, content) => {
    const dir = path.join(sandboxDir, label);
    let wt = null, target;
    try {
      wt = path.join(dir, "wt");
      fs.rmSync(wt, { recursive: true, force: true });
      execFileSync("git", ["worktree", "add", "--no-checkout", "--detach", wt, "HEAD"], { cwd: rootDir, timeout: 8000, stdio: ["ignore", "ignore", "pipe"] });
      target = path.join(wt, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf8");
    } catch {
      fs.mkdirSync(dir, { recursive: true });
      target = path.join(dir, path.basename(relPath));
      fs.writeFileSync(target, content, "utf8");
    }
    let ok = true, detail = "syntax not-applicable";
    const ext = path.extname(relPath).toLowerCase();
    if ([".js", ".mjs", ".cjs"].includes(ext)) {
      try { execFileSync(process.execPath, ["--check", target], { encoding: "utf8", timeout: 5000 }); detail = "node --check passed"; }
      catch (e) { ok = false; detail = String(e.stderr || e.message).slice(0, 200); }
    } else if ([".ts", ".tsx"].includes(ext)) {
      try {
        const ts = require("typescript");
        const out = ts.transpileModule(content, { reportDiagnostics: true, compilerOptions: { jsx: ext === ".tsx" ? ts.JsxEmit.Preserve : undefined, target: ts.ScriptTarget.ESNext } });
        const errs = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
        ok = errs.length === 0; detail = ok ? "tsc syntax passed" : ts.flattenDiagnosticMessageText(errs[0].messageText, "\n").slice(0, 200);
      } catch (e) { ok = false; detail = e.message; }
    }
    if (wt) { try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: rootDir, timeout: 8000, stdio: "ignore" }); } catch { /* pruned later */ } }
    return { label, ok, detail, chars: content.length };
  };
  const a = check("A", candidateA);
  const b = check("B", candidateB);
  const winner = a.ok && !b.ok ? "A" : b.ok && !a.ok ? "B" : a.ok && b.ok ? (a.chars <= b.chars ? "A" : "B") : "none";
  return { a, b, winner, summary: winner === "none" ? "Neither candidate passed." : `Candidate ${winner} recommended.` };
}

// ---- Kalshi/Quant war-room: advisory divergence brief. ANALYSIS ONLY. ----
// Takes each side's positions/markets (whatever the caller can supply) and surfaces where the two
// collaborators (or Kalshi vs a reference) diverge. Never returns an order/trade/allocation.
function warRoomBrief({ hostPositions = [], guestPositions = [], markets = [] } = {}) {
  const byTicker = (list) => new Map(list.map((p) => [String(p.ticker || p.marketId || p.id || ""), p]));
  const h = byTicker(hostPositions), g = byTicker(guestPositions);
  const tickers = new Set([...h.keys(), ...g.keys()].filter(Boolean));
  const divergences = [];
  for (const t of tickers) {
    const hp = h.get(t), gp = g.get(t);
    const hSide = hp?.side || (hp ? (Number(hp.qty || hp.position || 0) >= 0 ? "yes" : "no") : "—");
    const gSide = gp?.side || (gp ? (Number(gp.qty || gp.position || 0) >= 0 ? "yes" : "no") : "—");
    if (!hp || !gp) divergences.push({ ticker: t, kind: "one-sided", note: `${hp ? "Host" : "Guest"} holds ${t}, the other does not.` });
    else if (hSide !== gSide) divergences.push({ ticker: t, kind: "opposed", note: `Opposed views on ${t}: host ${hSide} vs guest ${gSide}.` });
  }
  return {
    advisoryOnly: true,
    disclaimer: "Analysis only — not financial advice, and Synapse never places trades. Each collaborator acts on their own account.",
    positionsCompared: tickers.size,
    divergences,
    sharedMarkets: (markets || []).slice(0, 20).map((m) => ({ ticker: m.ticker || m.id, yes: m.yesBid ?? m.yes, no: m.noBid ?? m.no })),
    summary: `${tickers.size} position(s) compared · ${divergences.length} divergence(s) to discuss.`,
  };
}

module.exports = { fuseSkills, applyReputation, pairRunCompare, warRoomBrief };
