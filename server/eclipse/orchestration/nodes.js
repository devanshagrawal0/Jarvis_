// ECLIPSE graph nodes — W4: real agents on a durable graph with Send fan-out + a typed
// blackboard. Pipeline:
//   intake → contract → context → plan(Architect) →[Send fan-out]→ worker×N → critic → verify(Prosecutor)
//          →[repair loop]→ synthesize(Director) → artifact(Director) → commit
// Authority: every tool call an agent makes is mediated by the gateway against its narrowed
// lease (deps.gateway/deps.rootLease). Blackboard: workers emit QUARANTINED packets; only the
// Prosecutor promotes to `validated`. Nodes stay small + idempotent (checkpointer saves between).
const { Send } = require("@langchain/langgraph");
const { classify } = require("../routing/eligibility");
const { id } = require("../contracts/validate");
const { getBlueprint, WORKER_PERSONAS } = require("../agents/blueprints");
const { runAgent, leaseForAgent } = require("../agents/runtime");
const { generatePersona, synthesizeWorkerBlueprint } = require("../agents/foundry");
const promotion = require("../evidence/promotion");
const { composeReport } = require("../artifact/composer");
const { z } = require("zod");
const PlanSchema = z.object({ subtasks: z.array(z.object({ goal: z.string() })).min(1).max(5) });

const MAX_WIDTH = 5; // ≤5 workers per wave (deep-design §4 width cap)

// Map the mission's task family → a Worker persona.
function personaFor(genome) {
  const fam = genome && genome.taskFamily;
  if (fam === "compute") return "data";
  if (fam === "build") return "code";
  if (fam === "extract") return "extract";
  return "research";
}

function createNodes(deps) {
  const { adapter, store, ledger, missionId, rootLease, gateway, toolbox = null, evidenceStore = null, artifactsDir = null, live = false, useFoundry = false, faults = {}, sideEffectSink = null, maxRepairs = 1 } = deps;
  const w5 = !!(toolbox && evidenceStore); // W5 mode: real tools + evidence + cited artifact

  // Gather real evidence for a Worker: lease-mediated web.search → web.fetch → EvidenceObject.
  async function gatherEvidence(lease, subtask) {
    const refs = [];
    const search = await gateway.mediate(lease, { tool: "web.search" }, () => toolbox["web.search"].run({ query: subtask.goal }));
    for (const { url } of (search.results || []).slice(0, 2)) {
      const page = await gateway.mediate(lease, { tool: "web.fetch", resource: url }, () => toolbox["web.fetch"].run({ url }));
      if (page && page.live) {
        const ev = evidenceStore.putEvidence({ missionId, uri: url, sourceType: "web", excerpt: page.excerpt, contentHash: page.contentHash, reliability: page.reliability });
        refs.push({ sourceUri: url, quote: String(page.excerpt).slice(0, 120), retrievedAt: page.retrievedAt, hash: page.contentHash });
        store.appendEvent(missionId, "evidence.captured", { uri: url, evidenceId: ev.evidenceId });
      }
    }
    return refs;
  }

  function node(name, phase, body) {
    return async (state, config) => {
      const ctrl = controlSignal(name);
      if (ctrl) {
        store.appendEvent(missionId, ctrl === "cancel" ? "mission.cancelled" : "mission.paused", { at: name });
        const e = new Error(`${ctrl} at ${name}`); e.eclipseControl = ctrl; e.atNode = name; throw e;
      }
      store.appendEvent(missionId, "node.start", { node: name, phase });
      const delta = (await body(state, config)) || {};
      maybeFault(name);
      store.recordNodeRun({ graph_run_id: deps.graphRunId, node_id: name, status: "complete" });
      store.appendEvent(missionId, "node.end", { node: name, phase });
      return { phase, trail: [name], revision: 1, ...delta };
    };
  }
  function controlSignal(name) {
    if (deps.cancelAt === name) return "cancel";
    if (deps.pauseAt === name) return "pause";
    if (store.isCancelRequested(deps.graphRunId)) return "cancel";
    return null;
  }
  function maybeFault(name) {
    if (faults[name] && faults[name] > 0) { faults[name] -= 1; const e = new Error(`injected fault at ${name}`); e.injected = true; throw e; }
  }

  const nodes = {
    intake: node("intake", "intake", (s) => {
      const genome = s.genome || classify(s.mission?.prompt || "").genome;
      return { genome, effort: s.mission?.effort || "deep" };
    }),

    contract: node("contract", "contract", (s) => {
      const tests = (s.mission?.acceptanceTests?.length ? s.mission.acceptanceTests : [{ id: id("t"), description: "Result addresses the prompt with validated, cited evidence", kind: "claim_supported", status: "pending" }]);
      return { mission: { ...s.mission, acceptanceTests: tests } };
    }),

    context: node("context", "context", () => ({})), // Memory Resonance capsule = W5

    // Mission Architect: decompose into ≤MAX_WIDTH subtasks, each with a persona + a narrowed
    // worker lease. Planner is read-only; it proposes, the orchestrator (root lease) issues.
    plan: node("plan", "plan", async (s) => {
      const persona = personaFor(s.genome);
      const n = Math.min(MAX_WIDTH, s.effort === "totality" ? 3 : s.effort === "deep" ? 2 : 1);
      const archLease = leaseForAgent(rootLease, getBlueprint("architect"), id("sess-arch"));
      let goals = null;
      if (live) {
        // Real decomposition: the Architect returns a structured list of sub-questions.
        try {
          const r = await adapter.run({ node: "plan", effort: s.effort, schema: PlanSchema,
            system: getBlueprint("architect").systemInstructionTemplate,
            input: `Mission: ${s.mission?.prompt || ""}\n\nReturn exactly ${n} independent sub-questions that together answer the mission. JSON: {"subtasks":[{"goal":"..."}]}` });
          goals = (r.json?.subtasks || []).map((x) => x.goal).filter(Boolean).slice(0, n);
        } catch (e) { store.appendEvent(missionId, "plan.fallback", { error: String(e.message).slice(0, 120) }); }
      } else {
        await runAgent({ blueprint: getBlueprint("architect"), subtask: { goal: s.mission?.prompt || "" }, adapter, lease: archLease, gateway, missionId, effort: s.effort });
      }
      if (!goals || !goals.length) goals = Array.from({ length: n }, (_, i) => `${s.mission?.prompt || ""} — aspect ${i + 1}`);
      const subtasks = goals.map((goal) => {
        const sid = id("sub");
        if (useFoundry) {
          // Agent Foundry: generate an ephemeral persona + blueprint tailored to this subtask.
          const pr = generatePersona({ id: sid, goal }, { genome: s.genome });
          const bp = synthesizeWorkerBlueprint(pr);
          store.appendEvent(missionId, "persona.forged", { persona: pr.label, capabilities: pr.capabilities, modelRole: pr.modelRole });
          return { id: sid, goal, persona: pr.label, tools: pr.tools, blueprint: bp, lease: leaseForAgent(rootLease, bp, id("sess-w"), { persona: pr.label }) };
        }
        return { id: sid, goal, persona, tools: WORKER_PERSONAS[persona].tools, lease: leaseForAgent(rootLease, getBlueprint("worker"), id("sess-w"), { persona }) };
      });
      store.appendEvent(missionId, "plan.ready", { subtasks: subtasks.length, persona, width: subtasks.length, foundry: !!useFoundry });
      return { graphPlan: { subtasks, persona } };
    }),

    // One Worker per subtask (spawned via Send). Idempotent per subtask for crash/replay.
    worker: node("worker", "worker", async (s) => {
      const st = s.subtask || { id: id("sub"), goal: s.mission?.prompt || "", persona: "research", tools: WORKER_PERSONAS.research.tools, lease: leaseForAgent(rootLease, getBlueprint("worker"), id("sess-w"), { persona: "research" }) };
      store.onceGuard(`${missionId}:worker:${st.id}`, { missionId, node: "worker" }, () => { if (sideEffectSink) sideEffectSink.push(st.id); return { done: true }; });
      const wbp = st.blueprint || getBlueprint("worker"); // ephemeral Foundry blueprint if present
      let packet;
      if (w5) {
        // Real tools: gather evidence under the worker's lease, then a model turn for the claim.
        const preEvidence = await gatherEvidence(st.lease, st);
        ({ packet } = await runAgent({ blueprint: wbp, persona: st.persona, subtask: { ...st, tools: [] }, adapter, lease: st.lease, gateway, missionId, effort: s.effort, preEvidence }));
      } else {
        // Live-but-no-tools: answer from the model only, NO fabricated evidence (tools:[]).
        // Stub tests keep the persona tools (defaultToolStub supplies deterministic evidence).
        const stForRun = live ? { ...st, tools: [] } : st;
        ({ packet } = await runAgent({ blueprint: wbp, persona: st.persona, subtask: stForRun, adapter, lease: st.lease, gateway, missionId, effort: s.effort }));
      }
      return { packets: [packet] };
    }),

    // Adversarial Critic: challenge each quarantined packet (read-only, ≤3 verify searches).
    critic: node("critic", "critic", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("critic"), id("sess-crit"));
      await runAgent({ blueprint: getBlueprint("critic"), subtask: { goal: "challenge the batch", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
      const critiques = (s.packets || []).map((p) => ({ packetId: p.packetId, verdict: p.evidence.length ? "holds" : "needs_more" }));
      store.appendEvent(missionId, "critic.done", { reviewed: critiques.length });
      return { critiques };
    }),

    // Evidence Prosecutor: the ONLY promotion authority. Re-verify + promote eligible packets.
    verify: node("verify", "verify", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("prosecutor"), id("sess-pros"));
      const already = new Set((s.validated || []).map((p) => p.packetId)); // don't re-promote on a repair re-entry
      const validated = [];
      for (const p of s.packets || []) {
        if (already.has(p.packetId)) continue;
        const holds = (s.critiques || []).find((c) => c.packetId === p.packetId)?.verdict !== "needs_more";
        if (!p.evidence.length || !holds) continue;

        if (w5) {
          // Re-verify each cited source through the gateway, then apply the promotion gate.
          const verifs = [];
          for (const ref of p.evidence) {
            const v = await gateway.mediate(lease, { tool: "citation.verify", resource: ref.sourceUri }, () => toolbox["citation.verify"].run({ url: ref.sourceUri, quote: ref.quote }));
            verifs.push({ evidenceRef: ref, supported: v.supported, live: v.live, entailment: v.entailment });
          }
          const decision = promotion.evaluate(p, verifs);
          if (decision.status === "validated") {
            await gateway.mediate(lease, { tool: "memory.promote", resource: `memory:${missionId}` }, () => toolbox["memory.promote"].run({ claim: p.claim }));
            const evByUri = new Map((evidenceStore.getEvidence(missionId) || []).map((e) => [e.uri, e]));
            const supports = p.evidence.map((ref) => { const eo = evByUri.get(ref.sourceUri); return eo ? { evidenceId: eo.evidenceId, entailment: decision.entailment, quoteSafe: true } : null; }).filter(Boolean);
            const claim = evidenceStore.putClaim({ missionId, text: p.claim, class: "fact", confidence: decision.confidence, status: "supported" }, supports);
            evidenceStore.promoteClaim(claim.claimId, { confidence: decision.confidence });
            validated.push({ ...p, status: "validated", quarantined: false, confidence: decision.confidence, claimId: claim.claimId });
            store.appendEvent(missionId, "claim.promoted", { claimId: claim.claimId, confidence: decision.confidence, entailment: decision.entailment });
          } else {
            store.appendEvent(missionId, "claim.rejected", { status: decision.status, reasons: decision.reasons });
          }
        } else {
          // W4 fallback: structural promotion (no real verifier wired).
          await runAgent({ blueprint: getBlueprint("prosecutor"), subtask: { goal: `verify ${p.claim}`, tools: ["citation.verify", "memory.promote"] }, adapter, lease, gateway, missionId, effort: s.effort });
          validated.push({ ...p, status: "validated", quarantined: false });
        }
      }
      store.appendEvent(missionId, "verify.done", { promoted: validated.length, ofQuarantined: (s.packets || []).length });
      return { validated, verdict: { passed: validated.length > 0, promoted: validated.length } };
    }),

    repair: node("repair", "repair", async (s) => {
      // Recovery Engineer: smallest intervention. W4 = mark repaired so verify can pass on degrade.
      const lease = leaseForAgent(rootLease, getBlueprint("recovery"), id("sess-rec"));
      await runAgent({ blueprint: getBlueprint("recovery"), subtask: { goal: "recover", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
      const rc = (s.repairCount || 0) + 1;
      // Degrade: if nothing could be validated, promote quarantined packets with evidence as low-confidence.
      const salvage = (s.packets || []).filter((p) => p.evidence.length).map((p) => ({ ...p, status: "partial", quarantined: false, confidence: 0.4 }));
      store.appendEvent(missionId, "repair.pass", { repairCount: rc, salvaged: salvage.length });
      return { repairCount: rc, validated: salvage };
    }),

    // Artifact Director (synthesis): draft from VALIDATED packets only.
    synthesize: node("synthesize", "synthesize", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("director"), id("sess-dir"));
      const findings = (s.validated && s.validated.length ? s.validated : s.packets || []);
      if (live) {
        // Director produces the actual answer from the workers' findings (full model text).
        const brief = findings.map((p, i) => `Finding ${i + 1}${p.evidence && p.evidence.length ? " (evidence-backed)" : ""}: ${p.claim}`).join("\n\n");
        const r = await adapter.run({ node: "synthesize", effort: s.effort,
          system: getBlueprint("director").systemInstructionTemplate,
          input: `Mission: ${s.mission?.prompt || ""}\n\nAgent findings:\n${brief}\n\nWrite the final answer: a clear recommendation with reasoning. Note where external verification was not available.` });
        return { result: { draft: r.text, fromValidated: (s.validated || []).length, verified: !!(s.validated && s.validated.length) } };
      }
      const r = await runAgent({ blueprint: getBlueprint("director"), subtask: { goal: "synthesize deliverable", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
      return { result: { draft: r.packet.claim, fromValidated: (s.validated || []).length } };
    }),

    // Artifact Director (write): produce the artifact manifest (mediated artifact.write).
    artifact: node("artifact", "artifact", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("director"), id("sess-dir2"));
      // Mediate the artifact.write through the gateway (proves Director authority + side-effect gate).
      await gateway.mediate(lease, { tool: "artifact.write", resource: `artifacts:${missionId}/report` }, () => (toolbox ? toolbox["artifact.write"].run({ missionId }) : { written: true }));
      if (w5) {
        // Real cited Markdown report to disk, once (idempotent), with a real manifest (sha256).
        const guard = store.onceGuard(`${missionId}:artifact`, { missionId, node: "artifact" }, () => {
          const { manifest } = composeReport({ mission: s.mission, validated: s.validated || [], evidenceStore, outDir: artifactsDir });
          store.appendEvent(missionId, "artifact.written", { path: manifest.path, sha256: manifest.sha256, cites: manifest.sourceEvidenceIds.length });
          return manifest;
        });
        return { artifacts: [guard.result] };
      }
      const artId = id("art");
      store.onceGuard(`${missionId}:artifact`, { missionId, node: "artifact" }, () => ({ artifactId: artId }));
      const manifest = { artifactId: artId, missionId, kind: "report", path: `artifacts/${missionId}/report.md`, sourcePacketIds: (s.validated || []).map((p) => p.packetId), createdAt: new Date(0).toISOString() };
      return { artifacts: [manifest] };
    }),

    commit: node("commit", "commit", (s) => {
      store.onceGuard(`${missionId}:commit`, { missionId, node: "commit" }, () => ({ committed: true }));
      const snap = ledger ? ledger.snapshot() : { tokens: 0, costUsd: 0 };
      store.mirrorCheckpoint(deps.graphRunId, { phase: "complete", tokens: snap.tokens, costUsd: snap.costUsd, revision: s.revision || 0 });
      store.appendEvent(missionId, "commit.done", { tokens: snap.tokens, costUsd: snap.costUsd, validated: (s.validated || []).length });
      return { phase: "complete", budget: { tokens: snap.tokens, costUsd: snap.costUsd } };
    }),

    // Fan-out edge: one Send per subtask → parallel Workers. Falls back to a single worker.
    fanOut: (s) => {
      const subs = s.graphPlan?.subtasks || [];
      if (!subs.length) return [new Send("worker", { subtask: null })];
      return subs.map((st) => new Send("worker", { subtask: st }));
    },

    // Router after verify: enough validated (or repairs exhausted) → synthesize; else repair.
    // Live-model-only: workers produced findings but no external evidence → synthesize directly.
    afterVerify: (s) => ((s.validated || []).length > 0 || (s.repairCount || 0) >= maxRepairs || (live && (s.packets || []).length > 0) ? "synthesize" : "repair"),
  };
  return nodes;
}

module.exports = { createNodes, MAX_WIDTH, personaFor };
