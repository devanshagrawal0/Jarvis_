// Contained proof of the Wave 32 RUNTIME half (the authority wiring).
//
// Runs entirely in a throwaway store in the OS temp dir. It never opens, reads or writes the
// live candidate database, so it cannot affect the owner's memory and needs no gate.
//
// What it proves, which nothing else did: that `activateDomain()` is now OBSERVABLE. Before
// this wiring the coordinator wrote a signed receipt and the runtime carried on unchanged.
// Here we drive a domain forward, assert the resolver reports vNext, roll it back, and assert
// it reverts — the full loop the real cutover depends on.
//
//   node scripts/memory-vnext-authority-proof.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { openCoreStore } = require(path.join(ROOT, "server/memory-vnext/storage/core-store.js"));
const { createMemoryShadowEvaluation } = require(path.join(ROOT, "server/memory-vnext/shadow-evaluation.js"));
const { createMemoryCutoverCoordinator } = require(path.join(ROOT, "server/memory-vnext/cutover-coordinator.js"));
const { createMemoryMigration } = require(path.join(ROOT, "server/memory-vnext/migration-import.js"));
const { createAuthorityResolver } = require(path.join(ROOT, "server/memory-vnext/authority-resolver.js"));

const DOMAINS = ["explicit_commands", "conversation_runtime", "retrieval_context", "room_integrations"];
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), "mvnext-authority-"));
let store;

try {
  // A controllable clock so the soak window can elapse in milliseconds instead of days.
  const clockState = { ms: Date.parse("2026-07-28T00:00:00.000Z") };
  store = await openCoreStore({ runtimeDir: root, clock: () => new Date(clockState.ms) });

  const migration = createMemoryMigration({ store });
  const shadow = createMemoryShadowEvaluation({ store });
  const cutover = createMemoryCutoverCoordinator({ store });
  const authority = createAuthorityResolver({ store, ttlMs: 0 });   // no cache: read every time

  console.log("── an empty ledger must read as legacy ──");
  ok("no plan → every domain legacy", DOMAINS.every((d) => authority.authorityFor(d) === "legacy"));
  ok("isVNextPrimary false for retrieval_context", authority.isVNextPrimary("retrieval_context") === false);
  ok("status reports no plan", authority.status().planId === null && authority.status().anyVNext === false);
  ok("an empty ledger is NOT degraded", authority.status().degraded === false, "absence of a plan is a valid state, not a failure");

  // ── minimum viable reconciled import + passing gate ────────────────────
  // An EMPTY declared import reconciles cleanly with no review queue — this proof is about
  // the authority wiring, not about import content, so the smallest valid import is correct.
  const runId = "authority-proof-import";
  const run = migration.createRun({
    id: runId, inventoryHash: "proof", snapshotSetHash: "proof",
    sources: [{ sourceKey: "proof", sourceKind: "sqlite", snapshotPath: "encrypted-only", snapshotSha256: "proof", table: "memories", expectedRows: 0 }],
  });
  migration.stageRecords({ sourceId: run.sources[0].id, rows: [] });
  const receipt = migration.reconcile({ runId });
  ok("import reconciles", receipt.passed === true);

  const session = shadow.createSession({ importRunId: runId, startedAt: new Date(clockState.ms), requiredUntil: new Date(clockState.ms + 1000) });
  shadow.recordBenchmark({ sessionId: session.id, cases: [{ passed: true, privacySafe: true, deletionCorrect: true, scopeLeaks: 0, latencyMs: 12 }] });
  for (const domain of DOMAINS) shadow.recordRollbackRehearsal({ sessionId: session.id, domain, passed: true, replayExport: { eventRefs: [] } });
  clockState.ms += 2000;                                            // soak elapses
  const gate = shadow.evaluateGate({ sessionId: session.id, projectionCoverage: 1, restorePassed: true, maxP95Ms: 250 });
  ok("shadow gate passes once artifacts + soak are satisfied", gate.passed === true);

  console.log("\n── plan lifecycle must not leak authority ──");
  const plan = cutover.createPlan({ shadowSessionId: session.id });
  ok("plan created as draft", plan.status === "draft", plan.id);
  ok("a DRAFT plan confers no authority", DOMAINS.every((d) => authority.authorityFor(d) === "legacy"));

  cutover.approvePlan({ planId: plan.id, actorId: "local-owner", authorityZone: "owner" });
  ok("an APPROVED plan still confers no authority", DOMAINS.every((d) => authority.authorityFor(d) === "legacy"), "only activation flips a domain");

  console.log("\n── forward ──");
  cutover.activateDomain({
    planId: plan.id, domain: "explicit_commands", actorId: "local-owner", authorityZone: "owner",
    gatePassed: true, projectionVerified: true, cachePurged: true, gateSnapshot: { proof: true },
  });
  ok("RUNTIME OBSERVES THE FLIP", authority.authorityFor("explicit_commands") === "vnext", "the wiring that did not exist before");
  ok("un-activated domains stay legacy", authority.authorityFor("retrieval_context") === "legacy" && authority.authorityFor("conversation_runtime") === "legacy");
  ok("status surfaces the live plan", authority.status().planId === plan.id && authority.status().anyVNext === true);

  console.log("\n── order is enforced ──");
  let ordered = false;
  try {
    cutover.activateDomain({ planId: plan.id, domain: "retrieval_context", actorId: "local-owner", authorityZone: "owner", gatePassed: true, gateSnapshot: {} });
  } catch (error) { ordered = error.code === "CUTOVER_ORDER_VIOLATION"; }
  ok("cannot skip a domain", ordered, "retrieval_context refused while conversation_runtime is still legacy");

  console.log("\n── the real switch: retrieval_context ──");
  cutover.activateDomain({ planId: plan.id, domain: "conversation_runtime", actorId: "local-owner", authorityZone: "owner", gatePassed: true, projectionVerified: true, cachePurged: true, gateSnapshot: {} });

  // retrieval_context carries an EXTRA per-domain gate, and rightly so: it is the domain where
  // a stale cache or an unverified projection could serve memory the owner already deleted.
  let retrievalGuarded = false;
  try {
    cutover.activateDomain({ planId: plan.id, domain: "retrieval_context", actorId: "local-owner", authorityZone: "owner", gatePassed: true, gateSnapshot: {} });
  } catch (error) { retrievalGuarded = /cache purge and projection verification/i.test(error.message); }
  ok("retrieval refuses activation without cache purge + projection proof", retrievalGuarded, "the deleted-memory-resurfacing guard");

  cutover.activateDomain({ planId: plan.id, domain: "retrieval_context", actorId: "local-owner", authorityZone: "owner", gatePassed: true, projectionVerified: true, cachePurged: true, gateSnapshot: {} });
  ok("retrieval_context is primary once proven", authority.isVNextPrimary("retrieval_context") === true, "this is what inverts the prompt order");
  ok("room_integrations still legacy", authority.authorityFor("room_integrations") === "legacy");

  console.log("\n── back ──");
  const rolled = cutover.rollbackDomain({ planId: plan.id, domain: "explicit_commands", actorId: "local-owner", authorityZone: "owner", reasonCode: "PROOF" });
  ok("rollback cascades to later domains", (rolled.rollbackDomains || []).length >= 3, (rolled.rollbackDomains || []).join(", "));
  ok("RUNTIME REVERTS", DOMAINS.every((d) => authority.authorityFor(d) === "legacy"), "no restart, no data movement");
  ok("a rolled-back plan confers no authority", authority.status().anyVNext === false);

  console.log("\n── fail-safe behaviour ──");
  const orphan = createAuthorityResolver({ store: null, ttlMs: 0 });
  ok("no store → legacy, not a crash", orphan.authorityFor("retrieval_context") === "legacy");
  ok("no store → reported as degraded", orphan.status().degraded === true, "safe, but visibly so");
  store.close();
  ok("closed store → legacy, not a throw", authority.authorityFor("retrieval_context") === "legacy");
  store = null;
} catch (error) {
  fail++;
  console.error("\nPROOF ABORTED:", error.message);
} finally {
  try { store?.close?.(); } catch { /* already closed */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ }
}

console.log(`\n${"─".repeat(58)}`);
console.log(`${pass} passed · ${fail} failed   (contained store, live memory untouched)`);
process.exitCode = fail ? 1 : 0;
