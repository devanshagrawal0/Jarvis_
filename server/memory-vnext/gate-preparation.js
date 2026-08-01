"use strict";

// Generates the evidence `evaluateGate()` demands, rather than asserting it.
//
// The gate takes four inputs it cannot produce itself: a benchmark run, a passing rollback
// rehearsal for every domain, a restore drill, and projection coverage. A caller can satisfy
// all four by passing `{ passed: true }` — which is how a cutover ends up documented but
// unproven. This module earns each one instead, and records what it could NOT cover so the
// gap is visible in the receipt instead of hidden by a default.
//
// Everything here is local and free. It writes evidence rows; it never grants authority.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createMemoryShadowEvaluation } = require("./shadow-evaluation");
const { createMemoryOperations } = require("./operations");
const { createMemoryCutoverCoordinator } = require("./cutover-coordinator");
const { createAuthorityResolver } = require("./authority-resolver");
const { createMemoryMigration } = require("./migration-import");
const { openCoreStore } = require("./storage/core-store");

const DOMAINS = ["explicit_commands", "conversation_runtime", "retrieval_context", "room_integrations"];
const OWNER = { actorId: "local-owner", authorityZone: "owner" };

// Guarded retrieval must never admit these, whatever the ranker thinks.
const DENIED = [/^health\./i, /^location\./i];
const IDENTITY_ALLOWED = "identity.preferred_name";

// Probes exercise the real retrieval path — the same call the answer path makes on every turn.
// They are phrased as things the owner actually asks so the ranker does real work.
// Sized for the statistic being computed. Five samples cannot support a p95 — the earlier
// five-probe version swung 224→371ms on identical code, and each swing was recorded as the
// session's worst case forever. Twenty-four varied queries make the percentile mean something.
const PROBE_PROMPTS = Object.freeze([
  "What do you know about how I like my answers written?", "How should you format replies for me?",
  "Do I prefer short or long responses?", "What tone should you take with me?",
  "What are my formatting preferences?", "How do I like code explained?",
  "Remind me what I am working towards right now.", "What are my current goals?",
  "What am I trying to build?", "What are my priorities?",
  "Who am I and what should you call me?", "What is my name?",
  "What do you know about me personally?", "What is my background?",
  "What are the constraints on the projects I am building?", "What conventions do I follow?",
  "What technical decisions have I locked in?", "What did I decide about the stack?",
  "How should you contact me?", "What is my usual workflow?",
  "Explain how a diesel engine differs from a petrol engine.", "Why is the sky blue?",
  "What is a Nash equilibrium?", "How is concrete made?",
]);
const PROBES = Object.freeze(PROBE_PROMPTS.map((prompt, index) => ({
  name: `probe ${index + 1}`,
  input: { prompt, source: "chat" },
})));

// ── contained rollback rehearsal ────────────────────────────────────────────
// A real forward-and-back for all four domains. It cannot run against the live store: the
// coordinator refuses to create a plan until the gate passes, and the gate is what needs the
// rehearsal. So it runs in a throwaway store with the real coordinator, the real ledger schema
// and the real resolver — the code under test is identical; only the data is disposable.
async function rehearseRollback({ logger } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mvnext-rehearsal-"));
  const clockState = { ms: Date.parse("2026-01-01T00:00:00.000Z") };
  let store = null;
  try {
    store = await openCoreStore({ runtimeDir: root, clock: () => new Date(clockState.ms) });
    const migration = createMemoryMigration({ store });
    const shadow = createMemoryShadowEvaluation({ store });
    const cutover = createMemoryCutoverCoordinator({ store });
    const authority = createAuthorityResolver({ store, ttlMs: 0 });

    const runId = "rehearsal-import";
    const run = migration.createRun({
      id: runId, inventoryHash: "rehearsal", snapshotSetHash: "rehearsal",
      sources: [{ sourceKey: "rehearsal", sourceKind: "sqlite", snapshotPath: "encrypted-only", snapshotSha256: "rehearsal", table: "memories", expectedRows: 0 }],
    });
    migration.stageRecords({ sourceId: run.sources[0].id, rows: [] });
    migration.reconcile({ runId });

    const session = shadow.createSession({ importRunId: runId, startedAt: new Date(clockState.ms), requiredUntil: new Date(clockState.ms + 1000) });
    shadow.recordBenchmark({ sessionId: session.id, cases: [{ passed: true, privacySafe: true, deletionCorrect: true, scopeLeaks: 0, latencyMs: 1 }] });
    for (const domain of DOMAINS) shadow.recordRollbackRehearsal({ sessionId: session.id, domain, passed: true, replayExport: { bootstrap: true } });
    clockState.ms += 2000;
    const gate = shadow.evaluateGate({ sessionId: session.id, projectionCoverage: 1, restorePassed: true, maxP95Ms: 250 });
    if (!gate.passed) throw new Error("Rehearsal harness could not reach a passing gate.");

    const plan = cutover.createPlan({ shadowSessionId: session.id });
    cutover.approvePlan({ planId: plan.id, ...OWNER });

    // Forward through every domain, asserting the runtime observes each flip.
    const forward = [];
    for (const domain of DOMAINS) {
      const receipt = cutover.activateDomain({
        planId: plan.id, domain, ...OWNER,
        gatePassed: true, projectionVerified: true, cachePurged: true, roomManifestsVerified: true,
        gateSnapshot: { purpose: "gate-preparation-rehearsal" },
      });
      const observed = authority.authorityFor(domain);
      forward.push({ domain, sequence: receipt.sequence ?? null, receiptMac: receipt.receiptMac || null, observedAuthority: observed });
      if (observed !== "vnext") throw new Error(`Rehearsal: runtime did not observe activation of ${domain}.`);
    }

    // Back. Rolling the first domain must cascade to every later one.
    const rollback = cutover.rollbackDomain({ planId: plan.id, domain: DOMAINS[0], ...OWNER, reasonCode: "GATE_REHEARSAL" });
    const reverted = DOMAINS.every((domain) => authority.authorityFor(domain) === "legacy");
    if (!reverted) throw new Error("Rehearsal: rollback did not return every domain to legacy.");

    return {
      passed: true,
      containedStore: true,
      forward,
      rollback: { receiptMac: rollback.receiptMac || null, rollbackDomains: rollback.rollbackDomains || [] },
      note: "Real coordinator, ledger and resolver; disposable data. Live rehearsal is impossible before the gate — the coordinator refuses to create a plan until it passes.",
    };
  } catch (error) {
    logger?.error?.(`[memory-vnext-gate] rollback rehearsal failed: ${error.message}`);
    return { passed: false, containedStore: true, error: error.message };
  } finally {
    try { store?.close?.(); } catch { /* already closed */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
}

// ── retrieval benchmark ─────────────────────────────────────────────────────
// Measures the live path. Each case records what was actually observed; `deletionCorrect` is
// deliberately left undefined on read-only cases rather than defaulted to true, because a
// deletion cannot be exercised while writes are still gated.
async function benchmarkRetrieval({ probe, logger } = {}) {
  const cases = [];
  const uncovered = [];

  // A p95 over five samples, one of which is the first query after a restart, is not a p95 —
  // it is one cold number wearing a percentile's name, and it swung 224→371ms between runs on
  // identical code. So the first pass is a warm-up and is measured but excluded, and the cold
  // cost is reported separately rather than averaged away.
  const coldStarted = process.hrtime.bigint();
  try { await probe({ ...PROBES[0].input, turnId: `gate-warmup-${crypto.randomUUID()}` }); } catch { /* warm-up */ }
  const coldStartMs = Number(process.hrtime.bigint() - coldStarted) / 1e6;

  for (const item of PROBES) {
    const started = process.hrtime.bigint();
    let result = null;
    let failure = null;
    try { result = await probe({ ...item.input, turnId: `gate-bench-${crypto.randomUUID()}` }); }
    catch (error) { failure = error.message; }
    // Both timings are recorded so the claim can be checked rather than trusted. Measured, they
    // agree within ~2ms — queueing is not a meaningful component, so the router's own figure is
    // the gate metric and the wall-clock stands beside it as the independent witness. Retrieval
    // costs roughly 200ms warm and ~340ms cold, and that is added to every turn.
    const wallClockMs = Number(process.hrtime.bigint() - started) / 1e6;

    const predicates = Array.isArray(result?.predicates) ? result.predicates : [];
    const leaked = predicates.filter((p) => DENIED.some((rx) => rx.test(p)) || (/^identity\./i.test(p) && p !== IDENTITY_ALLOWED));
    cases.push({
      name: item.name,
      passed: !failure && leaked.length === 0,
      privacySafe: leaked.length === 0,
      scopeLeaks: leaked.length,
      latencyMs: Number.isFinite(Number(result?.latencyMs)) && Number(result?.latencyMs) > 0 ? Number(result.latencyMs) : wallClockMs,
      observed: {
        delivered: Boolean(result?.delivered), reason: result?.reason || null, predicateCount: predicates.length, error: failure,
        routerLatencyMs: Number(result?.latencyMs || 0), wallClockMs,
        candidateFactCount: Number(result?.candidateFactCount || 0), candidateStale: Number(result?.candidateStale || 0),
        candidatePredicates: Array.isArray(result?.candidatePredicates) ? result.candidatePredicates : [],
      },
    });
    if (leaked.length) logger?.error?.(`[memory-vnext-gate] guarded retrieval admitted a denied predicate: ${leaked.join(", ")}`);
  }

  // A leak check alone cannot fail an engine that returns nothing — nothing is perfectly
  // private. This is the case that can: across every probe, retrieval must produce at least
  // one candidate fact, and the eligibility filter must admit at least one of them. Cutting
  // `retrieval_context` over to an engine that delivers nothing would replace working legacy
  // memory with an empty block.
  const totalCandidates = cases.reduce((sum, item) => sum + Number(item.observed?.candidateFactCount || 0), 0);
  const totalDelivered = cases.reduce((sum, item) => sum + (item.observed?.delivered ? 1 : 0), 0);
  cases.push({
    name: "retrieval actually retrieves",
    passed: totalCandidates > 0 && totalDelivered > 0,
    privacySafe: true,
    scopeLeaks: 0,
    latencyMs: 0,
    observed: {
      totalCandidateFacts: totalCandidates,
      probesDelivered: totalDelivered,
      probeCount: PROBES.length,
      diagnosis: totalCandidates === 0
        ? "retrieval produced no candidate facts at all — the candidate store has nothing this query plan can reach"
        : totalDelivered === 0
          ? "retrieval produced candidates but the eligibility filter admitted none of them"
          : "ok",
    },
  });

  // Room isolation is a hard boundary, so assert it rather than sampling it.
  let isolated = null;
  try { isolated = await probe({ prompt: "What do you know about me?", source: "helix", turnId: `gate-bench-${crypto.randomUUID()}` }); }
  catch { isolated = null; }
  cases.push({
    name: "room isolation (helix)",
    passed: isolated?.delivered === false && isolated?.reason === "room_isolated",
    privacySafe: isolated?.delivered === false,
    scopeLeaks: isolated?.delivered ? 1 : 0,
    latencyMs: 0,
    observed: { delivered: Boolean(isolated?.delivered), reason: isolated?.reason || null },
  });

  cases.push({
    name: "cold-start cost (measured, not gated)",
    passed: true, privacySafe: true, scopeLeaks: 0, latencyMs: 0,
    observed: { coldStartMs, note: "First retrieval after a restart. Excluded from the gated p95 because it is a one-off, recorded because the owner pays it." },
  });

  uncovered.push("write-path correctness (remember/correct/forget, tombstones, deletion receipts) — writes are gated until explicit_commands is primary; covered by the Memory vNext unit suite, not by this live run");
  uncovered.push("cross-scope isolation under a non-owner scope — the live canary path only ever runs in owner scope");

  return { cases, uncovered };
}

// ── the procedure ───────────────────────────────────────────────────────────
async function prepareCutoverGate({ store, sessionId, probe, maxP95Ms = 250, logger } = {}) {
  if (!store) throw new Error("A Memory vNext core store is required.");
  if (!sessionId) throw new Error("A shadow session id is required.");
  const shadow = createMemoryShadowEvaluation({ store });
  const operations = createMemoryOperations({ store });
  const steps = {};

  // 1. Retrieval benchmark against the live store.
  const bench = typeof probe === "function"
    ? await benchmarkRetrieval({ probe, logger })
    : { cases: [], uncovered: ["retrieval benchmark skipped — no probe supplied"] };
  steps.benchmark = bench.cases.length
    ? { ...shadow.recordBenchmark({ sessionId, cases: bench.cases, maxP95Ms }), cases: bench.cases, uncovered: bench.uncovered }
    : { passed: false, skipped: true, uncovered: bench.uncovered };

  // 2. Restore drill: take a real backup of the live database, decrypt it, and verify it opens
  //    clean. This is the safety net the whole cutover leans on, so it is exercised end to end.
  try {
    const backupConfirmation = operations.createConfirmation({ ...OWNER, scopeId: "owner:local", action: "backup" });
    const backup = await operations.createBackup({ ...OWNER, scopeId: "owner:local", confirmationId: backupConfirmation.id });
    const restoreConfirmation = operations.createConfirmation({ ...OWNER, scopeId: "owner:local", action: "restore_verify" });
    const drill = await operations.verifyRestore({ ...OWNER, scopeId: "owner:local", confirmationId: restoreConfirmation.id, backupId: backup.id });
    steps.restore = { passed: drill.status === "passed", backupId: backup.id, drillId: drill.drillId, quickCheck: drill.quickCheck, integrityCheck: drill.integrityCheck, foreignKeyViolations: drill.foreignKeyViolations, durationMs: drill.durationMs };
  } catch (error) {
    logger?.error?.(`[memory-vnext-gate] restore drill failed: ${error.message}`);
    steps.restore = { passed: false, error: error.message };
  }

  // 3. Projection coverage, from a real rebuild over the live ledger.
  try {
    const confirmation = operations.createConfirmation({ ...OWNER, scopeId: "owner:local", action: "projection_rebuild" });
    // Without a `builder`, rebuildProjection maps every event id to itself and coverage is 1 by
    // arithmetic — for an empty ledger too. The gate then requires `coverage === 1`, so this was
    // a pass that could not be withheld. The builder below actually inspects each event and only
    // counts the ones that survive, which is what makes the number capable of being < 1.
    const rejected = [];
    const rebuild = operations.rebuildProjection({
      ...OWNER, scopeId: "owner:local", confirmationId: confirmation.id,
      projector: "cutover-gate-verification", fromSequence: 0,
      builder: (events) => {
        let previousSequence = -Infinity;
        const processedEventIds = [];
        for (const event of events) {
          const sequence = Number(event?.canonical_sequence);
          const problems = [];
          if (!event?.event_id) problems.push("missing event_id");
          if (!Number.isFinite(sequence)) problems.push("canonical_sequence is not a number");
          else if (sequence <= previousSequence) problems.push(`canonical_sequence ${sequence} does not advance past ${previousSequence}`);
          if (!event?.stream_type || !event?.stream_id) problems.push("missing stream reference");
          if (!event?.event_type) problems.push("missing event_type");
          if (!event?.recorded_at || Number.isNaN(Date.parse(event.recorded_at))) problems.push("recorded_at is not a valid timestamp");
          if (problems.length) { rejected.push({ eventId: event?.event_id || null, problems }); continue; }
          previousSequence = sequence;
          processedEventIds.push(event.event_id);
        }
        return { processedEventIds, artifact: { rejected: rejected.length } };
      },
    });
    steps.projection = {
      coverage: Number(rebuild.coverage) || 0,
      status: rebuild.status,
      eventCount: rebuild.manifest?.eventCount ?? null,
      rejected,
      note: "Walks every canonical ledger event and rejects any with a missing id, stream reference or event type, a non-advancing canonical sequence, or an unparseable recorded_at. Coverage is the share that survived. It still does NOT decrypt payloads or re-derive a domain projector's output — a structurally valid but semantically wrong event scores as covered.",
    };
  } catch (error) {
    logger?.error?.(`[memory-vnext-gate] projection rebuild failed: ${error.message}`);
    steps.projection = { coverage: 0, status: "failed", error: error.message };
  }

  // 4. Rollback rehearsal for all four domains, earned in a contained store.
  const rehearsal = await rehearseRollback({ logger });
  steps.rollback = { passed: rehearsal.passed, containedStore: true, note: rehearsal.note || null, error: rehearsal.error || null };
  for (const domain of DOMAINS) {
    shadow.recordRollbackRehearsal({
      sessionId, domain, passed: rehearsal.passed,
      replayExport: { generatedBy: "gate-preparation", ...rehearsal },
    });
  }

  // 5. Evaluate. The gate re-reads every artifact from the ledger; nothing here is taken on trust.
  const gate = shadow.evaluateGate({
    sessionId,
    projectionCoverage: steps.projection.coverage,
    restorePassed: steps.restore.passed === true,
    maxP95Ms,
  });

  const blockers = [];
  if (!gate.passed) {
    if (gate.soakComplete === false) blockers.push("soak window has not elapsed");
    if (gate.importPassed === false) blockers.push("import reconciliation has not passed");
    if (steps.benchmark.passed !== true) blockers.push("benchmark did not pass");
    if (steps.restore.passed !== true) blockers.push("restore drill did not pass");
    if (steps.projection.coverage !== 1) blockers.push(`projection coverage is ${steps.projection.coverage}, not 1`);
    if (steps.rollback.passed !== true) blockers.push("rollback rehearsal did not pass");
    if (Number(gate.p95LatencyMs) > Number(gate.maxP95Ms)) blockers.push(`p95 ${gate.p95LatencyMs}ms exceeds ${gate.maxP95Ms}ms`);
  }

  return { sessionId, gate, steps, blockers, uncovered: bench.uncovered };
}

module.exports = { prepareCutoverGate, rehearseRollback, DOMAINS };
