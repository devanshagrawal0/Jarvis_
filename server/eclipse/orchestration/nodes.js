// ECLIPSE graph nodes — W4: real agents on a durable graph with Send fan-out + a typed
// blackboard. Pipeline:
//   intake → contract → context → plan(Architect) →[Send fan-out]→ worker×N → critic → verify(Prosecutor)
//          →[repair loop]→ synthesize(Director) → artifact(Director) → commit
// Authority: every tool call an agent makes is mediated by the gateway against its narrowed
// lease (deps.gateway/deps.rootLease). Blackboard: workers emit QUARANTINED packets; only the
// Prosecutor promotes to `validated`. Nodes stay small + idempotent (checkpointer saves between).
const { Send } = require("@langchain/langgraph");
const fs = require("fs");
const path = require("path");
const { classify } = require("../routing/eligibility");
const { id, hashOf } = require("../contracts/validate");
const { getBlueprint, WORKER_PERSONAS } = require("../agents/blueprints");
const { runAgent: runAgentImpl, leaseForAgent, fillTemplate } = require("../agents/runtime");
const conductor = require("../agents/conductor"); // S1.B2: schemas, budget code, plan critics, preflight
const { createScoutLoop } = require("../agents/scout-loop"); // S1.B3: the research-scout brain
const { narrow } = require("../capabilities/lease");
const { generatePersona, synthesizeWorkerBlueprint } = require("../agents/foundry");
const promotion = require("../evidence/promotion");
const { createClaimVerifier } = require("../evidence/verify-claim");
const { renderAbstain, coverageFooter, sourcesOf, renderBlocks } = require("../evidence/render-answer");
const { runWriterSafe: runWriter } = require("../agents/writer"); // S2.2 B1: the Writer pipeline (blocks, sentence→claim map)
const { composeReport } = require("../artifact/composer");
const { validate, ResultPacket } = require("../contracts");
const { z } = require("zod");
const PlanSchema = z.object({ subtasks: z.array(z.object({ goal: z.string() })).min(1).max(5) });
// Slice 1.1 — grounded worker output: a claim written FROM the fetched sources, with a verbatim
// supporting quote per source (sourceIndex points into the sources list the worker was handed).
const GroundedClaimSchema = z.object({
  claim: z.string().default(""),
  // C-3 lenient inbound: models drift between int/string index and sometimes omit the quote;
  // none of that should void the whole claim. Coerce and default, never reject.
  supports: z.array(z.object({
    sourceIndex: z.coerce.number().optional(),
    sourceId: z.string().optional(),
    quote: z.string().optional().default(""),
  })).default([]),
});
// Slice 1.1 — real entailment judge: does the SOURCE actually support the CLAIM? (a genuine reject path).
const EntailSchema = z.object({ supported: z.boolean(), entailment: z.number(), reason: z.string().optional() });

const MAX_WIDTH = 5; // ≤5 workers per wave (deep-design §4 width cap)

// What was said before the mission started.
//
// Switching the mode picker from Cortex to Eclipse sent the backend a prompt and an effort level
// and nothing else, so a mission began with no idea what the conversation had been about. Ask
// Cortex about something, switch to Eclipse, and follow up with "go deeper on that" — and "that"
// referred to nothing. The owner had to restate the whole thing.
//
// The turns are the assistant's own conversation record, not model output, so they are quoted as
// context and clearly labelled as prior dialogue. Two places need it: planning (so a follow-up
// resolves to the right subject) and synthesis (so the answer continues rather than restarts).
// Empty history yields an empty string — never a heading with nothing under it, which would invite
// the model to invent what was discussed.
function priorTurns(mission, max = 8) {
  const turns = Array.isArray(mission?.conversation) ? mission.conversation.slice(-max) : [];
  if (!turns.length) return "";
  const lines = turns
    .map((turn) => {
      const text = String(turn?.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!text) return "";
      return `${turn?.role === "model" ? "JARVIS" : "Owner"}: ${text}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return `Conversation before this mission (context only — the mission below is the task):\n${lines.join("\n")}\n\n`;
}

// Map the mission's task family → a Worker persona.
function personaFor(genome) {
  const fam = genome && genome.taskFamily;
  if (fam === "compute") return "data";
  if (fam === "build") return "code";
  if (fam === "extract") return "extract";
  return "research";
}

function createNodes(deps) {
  const { adapter, store, ledger, missionId, rootLease, gateway, toolbox = null, evidenceStore = null, artifactsDir = null, live = false, useFoundry = false, faults = {}, sideEffectSink = null, maxRepairs = 1, agentDefs = null, taskLedger = null, registryTools = null, knowledgeSearch = null } = deps;
  const w5 = !!(toolbox && evidenceStore); // W5 mode: real tools + evidence + cited artifact

  // ── Tool-using Worker (Slice 1.2) ─────────────────────────────────────────────────────────────
  // The worker is a REAL tool-using agent: each step the MODEL chooses a tool (web.search, web.fetch,
  // code.python, memory.retrieve) or finalizes — no hardcoded web-only path. A quantitative subtask
  // runs Python; a factual one searches + reads. Claims are grounded in whatever evidence it gathered
  // (fetched page text OR computed output), so verification (entailment vs the source/output) applies
  // uniformly. The tool choice is model-decided, not keyword-routed → LAW-0 clean.
  const WORKER_TOOLS = [
    { name: "web.search", desc: "Search the web. args {query}. Returns candidate {url,title}." },
    { name: "web.fetch", desc: "Fetch + read a URL's main content. args {url}. Use on the best 1-3 results from web.search." },
    { name: "http.get", desc: "Fetch raw data from ANY API/endpoint you choose — supply the full url; returns JSON or text. args {url, headers?}. Use for LIVE data (prices, stats, records, quotes) from any public API; then analyze with code.python." },
    { name: "code.python", desc: "Run Python 3 (pandas, numpy, scipy, matplotlib, sklearn, statsmodels available). args {code}. print() the answer. Use for ANY calculation, statistics, data analysis, modelling, or dataset processing." },
    { name: "file.read", desc: "Read a local file the owner referenced (CSV, Excel, PDF, Word, JSON, text). args {path}. Returns its text/preview; then analyze with code.python if needed. Use when the subtask names a file path." },
    { name: "memory.retrieve", desc: "Search the owner's saved memory. args {query}." },
  ];
  const WORKER_TOOL_NAMES = WORKER_TOOLS.map((t) => t.name);
  const MAX_WORKER_STEPS = 6;
  const GROUNDED_SEARCH_FEE_USD = 0.035;
  const PREFLIGHT_WAIT_MS = live ? 20000 : 0; // editable preflight window (0 in stub/eval) // per-request (HELIX-measured); verify vs billing before deep tier
  const WorkerStepSchema = z.object({
    thought: z.string().optional(),
    action: z.enum([...WORKER_TOOL_NAMES, "final"]),
    args: z.object({ query: z.string().optional(), url: z.string().optional(), code: z.string().optional(), path: z.string().optional(), headers: z.record(z.string(), z.string()).optional() }).partial().optional(),
    claim: z.string().optional(),
    supports: z.array(z.object({ sourceIndex: z.number().int(), quote: z.string() })).optional(),
  });

  // Forced grounded finalize over ALL gathered sources — the safety net so a worker that gathered real
  // evidence but never chose "final" in the loop still produces a grounded claim (no regression vs the
  // single-shot grounding). Returns {claim, supports} indexed into `sources` (1-based).
  // C-4/C-5: resolve a model-cited support to a source WITHOUT trusting index arithmetic.
  // Order: (1) if a quote is given, pick the merged source whose text actually contains the most
  // of the quote (resolve-by-matching, the Anthropic/LlamaIndex approach); (2) else use the id/index
  // interpreted as 1-based, then 0-based. Returns null only when nothing plausibly matches.
  function pickSource(sup, merged) {
    if (!merged || !merged.length) return null;
    const q = String((sup && sup.quote) || "").toLowerCase();
    if (q.length >= 12) {
      const words = q.replace(/[^a-z0-9. ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
      if (words.length) {
        let best = null, bestScore = 0;
        for (const src of merged) {
          const txt = String(src.excerpt || "").toLowerCase();
          let hit = 0;
          for (const w of words) if (txt.includes(w)) hit++;
          const score = hit / words.length;
          if (score > bestScore) { bestScore = score; best = src; }
        }
        if (best && bestScore >= 0.6) return best;   // strong textual match wins over any index
      }
    }
    // Index fallback: strip non-digits from sourceId, else sourceIndex.
    const raw = (sup && sup.sourceId != null) ? String(sup.sourceId).replace(/[^0-9]/g, "") : (sup && sup.sourceIndex);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      if (n >= 1 && n <= merged.length) return merged[n - 1];   // 1-based (what we present)
      if (n >= 0 && n < merged.length) return merged[n];        // 0-based fallback
    }
    return null;
  }

  async function forceFinalizeOverSources(st, wbp, sources, effort, corrective) {
    const persona = st.persona || "research";
    const focus = (WORKER_PERSONAS[persona] && WORKER_PERSONAS[persona].focus) || "gather and cite external evidence";
    const system = fillTemplate(wbp.systemInstructionTemplate, { persona, focus });
    // C-1: NO per-source truncation. The mirror-spec class of fact sits past char 3000; a byte
    // prefix hid it and the model correctly returned empty. Sources are already <=12000. Each is
    // labelled [S1].. so the model cites the id, resolved by lookup+fuzzy (C-4/C-5), never n-1.
    const srcBlock = sources.map((s, i) => `[S${i + 1}] (${s.kind}) ${s.uri}
${String(s.excerpt || "")}`).join(`

`);
    const input = `Subtask: ${st.goal}

Gathered sources:
${srcBlock}

`
      + (corrective ? `NOTE: your previous answer was empty, but the sources above DO contain relevant text - re-read them and answer.

` : "")
      + `Answer the subtask using ONLY these sources. Return JSON {"claim":"<specific factual answer>","supports":[{"sourceId":"S<n>","quote":"<verbatim quote>"}]}. `
      // C-2: graded, not "abstain on any doubt". Partial support still yields a claim.
      + `If the sources FULLY or PARTIALLY answer the subtask, give the claim and cite the sourceId(s) that support it. `
      + `Return {"claim":"","supports":[]} ONLY if the sources are entirely unrelated to the subtask.`;
    try {
      // C-2: finalize runs on the REASONING tier (Pro) via node:"verify" - grounding is the
      // correctness-critical step. Attribution stays on the worker lease; only the model changes.
      const r = await runAs(st.lease.leaseId, { node: "verify", agentRole: "worker", leaseId: st.lease.leaseId, effort, schema: GroundedClaimSchema, system, input });
      return r.json || { claim: "", supports: [] };
    } catch (e) {
      // B-3: an ERROR here is not the same as the model choosing empty - record which one happened.
      try { store.appendEvent(missionId, "finalize.error", { goal: String(st.goal).slice(0, 120), error: String(e.message).slice(0, 200) }); } catch {}
      return { claim: "", supports: [] };
    }
  }

  async function toolLoopWorkerPacket(st, wbp, effort) {
    const persona = st.persona || "research";
    const focus = (WORKER_PERSONAS[persona] && WORKER_PERSONAS[persona].focus) || "gather and cite external evidence";
    const toolDocs = WORKER_TOOLS.map((t) => `- ${t.name}: ${t.desc}`).join("\n");
    const system = fillTemplate(wbp.systemInstructionTemplate, { persona, focus })
      + `\n\nYou complete your subtask by CALLING TOOLS, one per step. Available tools:\n${toolDocs}\n`
      + `Decide the next action yourself from the subtask — never invent facts. For factual/research subtasks: web.search once, then web.fetch the best 1-2 URLs, then finalize. `
      + `For quantitative/data subtasks: write and run code.python to COMPUTE the answer, then finalize with the computed result. `
      + `CRITICAL: the MOMENT your gathered sources (or a computed result) contain enough to answer the subtask, you MUST choose action "final". Do NOT keep searching once you can answer — repeating web.search when you already have a usable source wastes the mission. You have only a few steps.`;
    const sources = [];              // indexed evidence: {kind, uri, excerpt, contentHash?, retrievedAt?}
    const transcript = [];
    const toolsUsed = new Set();
    const chartFiles = [];           // image files the agent's code produced, copied to the mission artifact dir
    let final = null;
    let searches = 0;                // web.search returns URLs, not sources — budget the CALLS

    for (let step = 0; step < MAX_WORKER_STEPS; step++) {
      throwIfCancelled(`worker:${st.id || "?"}:step${step}`);
      const srcList = sources.length ? sources.map((s, i) => `[${i + 1}] (${s.kind}) ${s.uri}`).join("\n") : "(none yet)";
      const log = transcript.length ? transcript.map((t, i) => `${i + 1}. ${t}`).join("\n") : "(no steps yet)";
      // Budget the step allowance explicitly. Measured: search-heavy missions spent ALL six
      // steps on tool calls and never emitted a claim, so the packet arrived with no supports
      // and verify discarded it in 0s. Two deterministic limits fix that, both keyed on
      // observed OUTCOMES (how many sources actually returned substantial text) — no text is
      // inspected and no keyword decides anything.
      const usable = sources.filter((x) => String(x.excerpt || "").length >= 400).length;
      const lastStep = step === MAX_WORKER_STEPS - 1;
      const gathered = usable >= 2 || searches >= 2;
      const avail = lastStep ? [] : WORKER_TOOLS.filter((t) => !(gathered && t.name === "web.search"));
      const actionLine = lastStep
        ? `This is your FINAL step — no tool call is available. Answer the subtask NOW from the sources above.`
        : `Available actions this step: ${avail.map((t) => t.name).join(", ")}, or "final".`
          + (gathered
              ? ` Searching again is unavailable (${searches} search(es) done, ${usable} source(s) with usable text) — fetch one of the URLs listed above, or finalize.`
              : "");
      const input = `Subtask: ${st.goal}\n\nSources gathered so far:\n${srcList}\n\nYour steps so far:\n${log}\n\n`
        + `${actionLine}

`
        + `Return JSON {"action":"<tool or 'final'>","args":{...}} to use a tool, `
        + `or {"action":"final","claim":"<specific answer to the subtask>","supports":[{"sourceIndex":<n>,"quote":"<verbatim quote from that source>"}]} when ready. `
        + `Only cite sourceIndex values listed above.`;
      let r;
      try { r = await runAs(st.lease.leaseId, { node: "worker", agentRole: "worker", leaseId: st.lease.leaseId, effort, schema: WorkerStepSchema, system, input }); }
      catch (e) { transcript.push(`model step failed: ${String(e.message).slice(0, 100)}`); break; }
      const act = r.json || {};
      if (act.action === "final") { final = act; break; }
      if (lastStep) { transcript.push("step budget spent — finalizing over gathered sources"); break; }
      if (gathered && act.action === "web.search") {
        transcript.push("search budget spent — use the sources already gathered");
        continue;
      }
      const args = act.args || {};
      try {
        if (act.action === "web.search") {
          const q = args.query || st.goal;
          searches += 1;
          const out = await gateway.mediate(st.lease, { tool: "web.search" }, () => toolbox["web.search"].run({ query: q }));
          const urls = (out.results || []).map((x) => x.url).slice(0, 5);
          toolsUsed.add("web.search");
          // S1.B1: grounded search bills PER REQUEST (~$0.035, HELIX-measured), not per token —
          // the ledger under-reported every search until this line. Constant verified against
          // Google billing before the deep tier unlocks.
          if (ledger && ledger.addFee && live) ledger.addFee({ node: "worker", agent: st.lease.sessionId, kind: "grounded-search", usd: GROUNDED_SEARCH_FEE_USD });
          transcript.push(`web.search "${String(q).slice(0, 80)}" → ${urls.length} results${urls.length ? ": " + urls.join("  |  ") : ""}`);
        } else if (act.action === "web.fetch") {
          if (!args.url) { transcript.push("web.fetch: no url given"); continue; }
          // K: never fetch a URI this WORKER already holds, and reuse what the MISSION already
          // captured (blackboard) instead of a duplicate network fetch. The transcript tells the
          // model why, so it stops proposing the same URL.
          {
            const wanted = String(args.url);
            const localIx = sources.findIndex((x) => x.uri === wanted);
            if (localIx >= 0) { transcript.push(`web.fetch ${wanted} → already gathered as [source ${localIx + 1}] — do not fetch it again`); continue; }
            let reused = null;
            try { reused = (evidenceStore.getEvidence(missionId) || []).find((e) => e.uri === wanted && String(e.excerpt || "").trim().length > 0); } catch {}
            if (reused) {
              sources.push({ kind: reused.sourceType === "calculation" ? "compute" : "web", uri: reused.uri, excerpt: String(reused.excerpt || ""), contentHash: reused.contentHash, retrievedAt: reused.capturedAt });
              store.appendEvent(missionId, "evidence.reused", { uri: reused.uri, evidenceId: reused.evidenceId });
              transcript.push(`web.fetch ${wanted} → reused from mission blackboard [source ${sources.length}] — no network fetch`);
              continue;
            }
          }
          const page = await gateway.mediate(st.lease, { tool: "web.fetch", resource: args.url }, () => toolbox["web.fetch"].run({ url: args.url }));
          const realUri = (page && page.url) || args.url;
          toolsUsed.add("web.fetch");
          if (page && page.live && String(page.excerpt || "").trim().length > 0) {
            const ev = evidenceStore.putEvidence({ missionId, uri: realUri, sourceType: "web", excerpt: page.excerpt, contentHash: page.contentHash, reliability: page.reliability });
            store.appendEvent(missionId, ev.deduped ? "evidence.reused" : "evidence.captured", { uri: realUri, evidenceId: ev.evidenceId });
            sources.push({ kind: "web", uri: realUri, excerpt: String(page.excerpt || ""), contentHash: page.contentHash, retrievedAt: page.retrievedAt });
            transcript.push(`web.fetch ${realUri} → ${String(page.excerpt || "").length} chars captured [source ${sources.length}]`);
          } else {
            // Record WHY, not just that it failed. web.fetch has produced zero evidence in
            // every mission while the same URL succeeds standalone, so the reason matters.
            store.appendEvent(missionId, "fetch.failed", {
              url: args.url,
              live: page ? page.live : null,
              status: page ? page.status : null,
              chars: page ? String(page.excerpt || "").length : 0,
              resolved: page ? page.url : null,
            });
            transcript.push(`web.fetch ${args.url} → no usable content`);
          }
        } else if (act.action === "http.get") {
          if (!args.url) { transcript.push("http.get: no url given"); continue; }
          const out = await gateway.mediate(st.lease, { tool: "http.get", resource: args.url }, () => (toolbox["http.get"] ? toolbox["http.get"].run({ url: args.url, headers: args.headers }) : { ok: false, error: "http.get unavailable" }));
          toolsUsed.add("http.get");
          const realUri = (out && out.finalUrl) || args.url;
          if (out && out.ok) {
            const payload = out.json !== undefined ? JSON.stringify(out.json) : String(out.text || "");
            const excerpt = `API ${realUri} (${out.status} ${out.contentType || ""}):\n${payload}`.slice(0, 12000); // cap unified with web (12000)
            const ev = evidenceStore.putEvidence({ missionId, uri: realUri, sourceType: "api", excerpt, contentHash: hashOf(excerpt) });
            store.appendEvent(missionId, ev.deduped ? "evidence.reused" : "evidence.captured", { uri: realUri, evidenceId: ev.evidenceId });
            sources.push({ kind: "api", uri: realUri, excerpt, contentHash: hashOf(excerpt), retrievedAt: new Date().toISOString() });
            transcript.push(`http.get ${realUri} → ${out.status}, ${payload.length} chars [source ${sources.length}]`);
          } else {
            transcript.push(`http.get ${args.url} → ${out && out.error ? out.error : "status " + (out && out.status)}`);
          }
        } else if (act.action === "code.python") {
          const code = args.code || "";
          const out = await gateway.mediate(st.lease, { tool: "code.python" }, () => toolbox["code.python"].run({ code }));
          toolsUsed.add("code.python");
          const body = out.ok ? out.stdout : (out.stderr || (out.timedOut ? "(timed out)" : "(error)"));
          // The computed OUTPUT is the evidence; the code is only provenance for how it was
          // obtained. Leading with the code meant a long script pushed the actual result out of
          // the 4000-char window, so the entailment judge was handed a program and asked whether
          // it supported a factual claim — it always, correctly, said no.
          const excerpt = `OUTPUT:
${String(body)}`.slice(0, 11000)
            + `

PRODUCED BY:
${String(code).slice(0, 800)}`;
          const uri = `compute://python/${sources.length + 1}`;
          const ev = evidenceStore.putEvidence({ missionId, uri, sourceType: "calculation", excerpt, contentHash: hashOf(excerpt), reliability: undefined });
          store.appendEvent(missionId, ev.deduped ? "evidence.reused" : "evidence.captured", { uri, evidenceId: ev.evidenceId });
          sources.push({ kind: "compute", uri, excerpt, contentHash: hashOf(excerpt), retrievedAt: new Date().toISOString() });
          transcript.push(`code.python → ${out.ok ? "ok" : "error"}: ${String(body).slice(0, 160).replace(/\s+/g, " ")} [source ${sources.length}]`);
          // Chart artifact: any image the code wrote (matplotlib savefig, etc.) is copied into the mission's
          // artifact dir and recorded, so a chart the agent produced is a real, surfaced deliverable.
          if (Array.isArray(out.artifacts) && out.artifacts.length && artifactsDir) {
            for (const srcFile of out.artifacts) {
              if (!/\.(png|jpg|jpeg|svg|pdf)$/i.test(srcFile)) continue;
              try {
                const chartDir = path.join(artifactsDir, missionId, "charts");
                fs.mkdirSync(chartDir, { recursive: true });
                const dest = path.join(chartDir, path.basename(srcFile));
                fs.copyFileSync(srcFile, dest);
                chartFiles.push(dest);
                store.appendEvent(missionId, "artifact.chart", { path: dest });
                transcript.push(`chart saved → ${dest}`);
              } catch { /* chart copy is best-effort */ }
            }
          }
        } else if (act.action === "memory.retrieve") {
          const out = await gateway.mediate(st.lease, { tool: "memory.retrieve", resource: `memory:${missionId}` }, () => (toolbox["memory.retrieve"] ? toolbox["memory.retrieve"].run({ query: args.query || st.goal }) : { memories: [] }));
          toolsUsed.add("memory.retrieve");
          const mems = out.memories || out.results || [];
          // N-7: retrieved memory was announced in the transcript but never stored, so it could
          // not be cited. Non-empty recall now becomes a real evidence source like any other.
          if (mems.length) {
            const memText = mems.map((m, i) => `[${i + 1}] ${String(m.text || "").slice(0, 600)}`).join("\n");
            const excerpt = `OWNER MEMORY (query: ${String(args.query || st.goal).slice(0, 120)}):\n${memText}`.slice(0, 12000);
            const uri = `memory://vault/${sources.length + 1}`;
            const ev = evidenceStore.putEvidence({ missionId, uri, sourceType: "dataset", excerpt, contentHash: hashOf(excerpt) });
            store.appendEvent(missionId, ev.deduped ? "evidence.reused" : "evidence.captured", { uri, evidenceId: ev.evidenceId });
            sources.push({ kind: "memory", uri, excerpt, contentHash: hashOf(excerpt), retrievedAt: new Date().toISOString() });
            transcript.push(`memory.retrieve → ${mems.length} hits, stored as [source ${sources.length}]`);
          } else {
            transcript.push(`memory.retrieve → 0 hits`);
          }
        } else if (act.action === "file.read") {
          if (!args.path) { transcript.push("file.read: no path given"); continue; }
          const out = await gateway.mediate(st.lease, { tool: "file.read" }, () => (toolbox["file.read"] ? toolbox["file.read"].run({ path: args.path }) : { ok: false, error: "file.read unavailable" }));
          toolsUsed.add("file.read");
          if (out && out.ok && String(out.text || "").trim().length >= 1) {
            const excerpt = `FILE ${args.path} (${out.kind}${out.pages ? ", " + out.pages + "p" : ""}):\n${out.text}`.slice(0, 12000); // cap unified with web (12000)
            const uri = `file://${args.path}`;
            const ev = evidenceStore.putEvidence({ missionId, uri, sourceType: "file", excerpt, contentHash: hashOf(excerpt) });
            store.appendEvent(missionId, ev.deduped ? "evidence.reused" : "evidence.captured", { uri, evidenceId: ev.evidenceId });
            sources.push({ kind: "file", uri, excerpt, contentHash: hashOf(excerpt), retrievedAt: new Date().toISOString() });
            transcript.push(`file.read ${args.path} → ${String(out.text || "").length} chars [source ${sources.length}]`);
          } else {
            transcript.push(`file.read ${args.path} → ${out && out.error ? out.error : "no content"}`);
          }
        } else {
          transcript.push(`unknown action "${act.action}"`);
        }
      } catch (e) {
        if (e && e.leaseCode === "DENIED") transcript.push(`${act.action} DENIED: ${String(e.message).slice(0, 100)}`);
        else transcript.push(`${act.action} error: ${String(e.message).slice(0, 100)}`);
      }
    }

    // Blackboard share ("blackboard is the glue"): finalize over the UNION of THIS worker's sources and
    // everything else gathered in the mission so far (the shared evidence store). A worker whose own fetch
    // missed a fact can then still cite a source a teammate fetched. Merged starts with the local sources,
    // so any loop-final indices (into `sources`) still align with `merged`.
    const merged = [...sources];
    const seenUris = new Set(sources.map((s) => s.uri));
    try {
      for (const e of (evidenceStore.getEvidence(missionId) || [])) {
        if (merged.length >= 8) break;
        if (e && e.uri && !seenUris.has(e.uri) && String(e.excerpt || "").trim().length >= 40) {
          seenUris.add(e.uri);
          merged.push({ kind: e.sourceType === "calculation" ? "compute" : "web", uri: e.uri, excerpt: String(e.excerpt || ""), contentHash: e.contentHash, retrievedAt: e.capturedAt });
        }
      }
    } catch { /* store read is best-effort */ }

    // The final claim is produced by a grounded finalize over the MERGED evidence — this both shares the
    // blackboard and removes reliance on the loop reliably emitting a good "final".
    let finalObj = merged.length ? await forceFinalizeOverSources(st, wbp, merged, effort) : null;
    // DEFECT E: a finalize that returns a claim with no supports throws away every source the
    // worker gathered, and the packet arrives unattributed. Retry once before giving up - the
    // sources are already in hand, so this costs one call rather than another gather round.
    if (merged.length && (!finalObj || !(finalObj.supports || []).length)) {
      finalObj = await forceFinalizeOverSources(st, wbp, merged, effort, true); // C-6: reflexion retry, not a replay
    }
    if ((!finalObj || !String(finalObj.claim || "").trim() || !(finalObj.supports || []).length)
        && final && final.claim && Array.isArray(final.supports) && final.supports.length) {
      finalObj = { claim: final.claim, supports: final.supports }; // loop indices align with the merged prefix
    }
    // The worker still names WHICH source supports the claim; the quote it writes is only a
    // hint. The verifier replaces it with text resolved from a sentence id, so nothing here
    // needs to string-match a model-written quote against the source.
    const evidence = [];
    if (finalObj && Array.isArray(finalObj.supports)) {
      for (const sup of finalObj.supports) {
        // C-4/C-5: resolve the cited source robustly. Accept sourceId ("S1"/"1") or sourceIndex,
        // interpret as 1-based OR 0-based, and fall back to matching the quote text against the
        // source pool - so a 0/1 off-by-one or a paraphrased id can never silently drop the claim.
        const src = pickSource(sup, merged);
        if (!src) continue;
        evidence.push({
          sourceUri: src.uri,
          quote: String(sup.quote || "").slice(0, 300),
          retrievedAt: src.retrievedAt || new Date(0).toISOString(),
          hash: src.contentHash || hashOf(src.uri),
        });
      }
    }
    const claimText = finalObj && finalObj.claim ? String(finalObj.claim).trim() : "";
    const grounded = Boolean(claimText && evidence.length);
    return validate(ResultPacket, {
      packetId: id("p"), missionId, agentSessionId: st.lease.sessionId, blueprint: wbp.blueprintId,
      claim: claimText ? claimText.slice(0, 900) : `No supported finding for: ${String(st.goal || "").slice(0, 100)}`,
      status: grounded ? "unverified" : "partial",
      confidence: grounded ? 0.6 : 0.3, evidence,
      provenance: { toolsUsed: [...toolsUsed], leaseId: st.lease.leaseId, tokens: 0 },
      quarantined: true,
      cost: { tokens: 0, wallclockMs: 0 },
    }, "packet");
  }

  // Per-agent accounting. The mission ledger is mission-wide and its byNode buckets cannot
  // separate fanned-out workers (they all run under node "worker"), so every model call is tagged
  // with the agent that made it and the running total is published as an event. `key` is the
  // stable agent identity: a worker's leaseId, or the fixed role name for the singleton agents.
  async function runAs(key, opts) {
    const r = await adapter.run({ ...opts, agent: key });
    if (ledger && ledger.forAgent) {
      const u = ledger.forAgent(key);
      store.appendEvent(missionId, "agent.usage", { agent: opts.agentRole || key, leaseId: opts.leaseId || null, tokens: u.tokens, costUsd: Number(u.costUsd.toFixed(6)) });
    }
    return r;
  }
  // Same attribution for the blueprint runner (critic / prosecutor / director / architect).
  async function agentRun(key, role, opts) {
    const r = await runAgentImpl({ ...opts, agent: key });
    if (ledger && ledger.forAgent) {
      const u = ledger.forAgent(key);
      store.appendEvent(missionId, "agent.usage", { agent: role, leaseId: opts.lease ? opts.lease.leaseId : null, tokens: u.tokens, costUsd: Number(u.costUsd.toFixed(6)) });
    }
    return r;
  }

  // A cooperative cancel is only as responsive as its checkpoints. Checking the flag at node
  // ENTRY alone left the worker's tool loop — the longest-running region in a mission, minutes of
  // model+tool steps inside ONE node — unable to observe a cancel at all. Throwing the same
  // control error from inside a body unwinds exactly like a boundary cancel.
  function throwIfCancelled(where) {
    if (!store.isCancelRequested(deps.graphRunId)) return;
    store.appendEvent(missionId, "mission.cancelled", { at: where });
    const e = new Error(`cancel at ${where}`); e.eclipseControl = "cancel"; e.atNode = where; throw e;
  }

  // S2.2: contested claims for the Writer. The only conflict producer today is the scout's
  // contradiction pass (scout.conflict {a: claim text ≤120 chars, b: url}); the Conductor does
  // not mark "contested" yet. Match by the same truncated text the scout emitted.
  function conflictsFor(validated) {
    const out = [];
    try {
      const evs = store.getEvents(missionId).filter((e) => e.event_type === "scout.conflict");
      for (const e of evs) {
        const p = e.payload || {};
        const hit = validated.find((v) => String(v.claim || "").slice(0, 120) === String(p.a || ""));
        if (hit) out.push({ claimId: String(hit.claimId || hit.packetId), counter: { text: `possible counter-evidence at ${p.b}`, uri: p.b || null } });
      }
    } catch { /* conflicts are best-effort input; the Writer runs without them */ }
    return out;
  }

  // One verifier per run; `run` is the same attributed model-call boundary the nodes use.
  const claimVerifier = createClaimVerifier({
    run: (opts) => runAs("prosecutor", { ...opts, node: "verify" }),
  });


  // S1.B2 — Conductor staffing. Lives at createNodes scope so plan-node code stays readable.
  async function conductorStaffing(s) {
    try {
      const row = taskLedger.read(missionId);
      if (!row || !row.contract || !row.contract.requirements) return null;   // no contract -> legacy
      const contract = row.contract;
      const cards = agentDefs.assembleCards().filter((c) => c.fanout === 0);  // only leaf agents are hireable
      if (!cards.length) {
        // Never build a staffing schema from an empty enum: it fails validation on every attempt
        // and looks like a model problem. Say what actually happened.
        store.appendEvent(missionId, "plan.fallback", { error: "registry has no hireable agents (definitions not seeded)" });
        return null;
      }
      const capUsd = (ledger && ledger.snapshot) ? (ledger.snapshot().cap.maxCostUsd || 0.5) : 0.5;

      const staffingInput = (errors) => `Today is ${new Date().toISOString().slice(0, 10)}.\nMission: ${s.mission?.prompt || ""}\n\n`
        + `CONTRACT (every requirement must be owned by exactly one hire):\n`
        + contract.requirements.map((r) => `${r.reqId} [${r.freshness}]: ${r.text}`).join("\n")
        + `\n\nAVAILABLE AGENTS (hire ONLY from these; writer/critic/screen-context run as fixed pipeline stages, not hires):\n`
        + cards.map((c) => `- agentId: "${c.agentId}" | model ${c.modelRole} (${c.costClass} cost) | reputation ${c.reputation.status}${c.reputation.validatedRatio != null ? " (verified-ratio " + c.reputation.validatedRatio + ")" : ""} | ${c.description}`).join("\n")
        + `\n\nEFFORT SCALING RULES: simple fact -> 1 hire. Snapshot/comparison -> 2-4. Deep research -> 4-5. Never more hires than independent threads.\n`
        + `Each hire needs: agentId (EXACTLY one of the quoted ids above), tier ("normal"; "deep" only if the owner asked), brief {objective, angle, outputHint, sourceHints[], boundary[] (what OTHER hires own - name them), reqIds[] (the contract requirements THIS hire owns), freshnessNote (REQUIRED when the hire owns a [today] requirement: state the exact recency the sources must have)}, difficultyRank (1=hardest), why.\n`
        + `Also notHired[]: every listed agent you did not hire, with why. Do NOT output budgets - they are computed for you.\n`
        + (errors ? `\nYOUR PREVIOUS PLAN FAILED VERIFICATION - fix exactly these errors:\n${errors.join("\n")}\n` : "")
        + `Return JSON per the schema.`;

      // critic#4 input: what has this fleet already verified about this mission's subject?
      let knownFacts = [];
      try { knownFacts = knowledgeSearch ? knowledgeSearch({ query: s.mission?.prompt || "", limit: 6 }) : []; } catch { knownFacts = []; }

      let plan = null;
      let verdict = { ok: false, errors: ["no plan produced"] };
      for (let attempt = 0; attempt < 2 && !verdict.ok; attempt++) {
        let r;
        try {
          r = await runAs("orchestrator", { node: "plan", agentRole: "conductor", effort: s.effort, schema: conductor.staffingSchemaFor(cards.map((x) => x.agentId)),
            system: agentDefs.systemPromptFor("conductor") || "You staff research missions.",
            input: staffingInput(attempt ? verdict.errors : null) });
        } catch (e) {
          // A schema failure must not abort the loop - feed the EXACT zod issues into attempt 2
          // (the throw used to escape to the outer catch, so the retry never ran - found live
          // on the first B3 mission, 2026-09-03).
          const issues = (e.issues || []).map((x) => `${x.path.join(".")}: ${x.message}`);
          verdict = { ok: false, errors: issues.length ? issues : [String(e.message)] };
          store.appendEvent(missionId, "plan.schemafail", { attempt: attempt + 1, issues: issues.slice(0, 10), raw: String(e.rawText || "").slice(0, 400) });
          continue;
        }
        if (!r.json) break;
        const scoutDef = agentDefs.getDef("research-scout");
        const budgeted = conductor.computeBudgets(r.json.hires, { capUsd, tierBudgets: (scoutDef && scoutDef.budgets) || {} });
        plan = { ...r.json, hires: budgeted.hires, reserveUsd: budgeted.reserveUsd };
        verdict = conductor.verifyPlan(plan, contract, cards, { capUsd, knownFacts });
        if (verdict.warnings && verdict.warnings.length) store.appendEvent(missionId, "plan.warnings", { warnings: verdict.warnings.slice(0, 5) });
        store.appendEvent(missionId, verdict.ok ? "plan.verified" : "plan.rejected", verdict.ok ? { checks: 7, hires: plan.hires.length } : { errors: verdict.errors });
      }
      if (!verdict.ok || !plan) return null;                                   // critics never satisfied -> legacy path

      // Editable preflight (Gemini DR pattern): render, wait for owner edit/approve or timeout.
      taskLedger.write({ missionId, contract, guesses: row.guesses, plan: { proposed: plan }, revision: row.revision });
      store.appendEvent(missionId, "plan.preflight", { plan: { complexityClass: plan.complexityClass, assumptions: plan.assumptions, hires: plan.hires.map((h) => ({ agentId: h.agentId, brief: h.brief, budget: h.budget, why: h.why })), notHired: plan.notHired, reserveUsd: plan.reserveUsd }, editableForMs: PREFLIGHT_WAIT_MS });
      // Only hold the mission when somebody is watching — an unattended run paid 20s for a
      // panel nobody could see.
      const watching = typeof store.subscriberCount === "function" ? store.subscriberCount(missionId) > 0 : true;
      if (PREFLIGHT_WAIT_MS > 0 && watching) {
        const pf = await conductor.waitForPreflight(taskLedger, missionId, { waitMs: PREFLIGHT_WAIT_MS });
        if (pf.edited && pf.plan) {
          const edited = conductor.StaffingPlanSchema.safeParse(pf.plan);
          if (edited.success) {
            const eBudgeted = conductor.computeBudgets(edited.data.hires, { capUsd, tierBudgets: (agentDefs.getDef("research-scout").budgets) || {} });
            const ePlan = { ...edited.data, hires: eBudgeted.hires, reserveUsd: eBudgeted.reserveUsd };
            const eVerdict = conductor.verifyPlan(ePlan, contract, cards, { capUsd, knownFacts });
            if (eVerdict.ok) { plan = ePlan; store.appendEvent(missionId, "plan.verified", { checks: 6, hires: plan.hires.length, edited: true }); }
            else store.appendEvent(missionId, "plan.rejected", { errors: eVerdict.errors, edited: true });
          } else store.appendEvent(missionId, "plan.rejected", { errors: ["edited plan failed schema"], edited: true });
        }
      }

      // Hire: subtasks with def-compiled lease scopes + code-computed budget caps on the lease.
      const subtasks = plan.hires.map((h) => {
        const hDef = agentDefs.getDef(h.agentId);
        const sid = id("sub");
        const scopes = agentDefs.compileLeaseScopes(hDef);
        const wLease = narrow(rootLease, { sessionId: id("sess-w"), scopes, maxCostUsd: h.budget.usdCap, maxCalls: { "web.search": h.budget.searches, "web.fetch": h.budget.reads } });
        const goal = `${h.brief.objective}\nAngle: ${h.brief.angle}\nOutput: ${h.brief.outputHint}`
          + (h.brief.sourceHints.length ? `\nPrefer sources: ${h.brief.sourceHints.join("; ")}` : "")
          + (h.brief.boundary.length ? `\nDo NOT cover (owned by other scouts): ${h.brief.boundary.join("; ")}` : "");
        store.appendEvent(missionId, "hire", { agentId: h.agentId, subtaskId: sid, leaseId: wLease.leaseId, brief: h.brief, budget: h.budget, why: h.why });
        // The console's fleet rail keys worker cards on persona.forged - emit it for hires too.
        store.appendEvent(missionId, "persona.forged", { persona: h.brief.angle.slice(0, 24) || h.agentId, capabilities: [h.agentId], modelRole: hDef.modelRole, leaseId: wLease.leaseId, subtaskId: sid, goal: String(h.brief.objective).slice(0, 160) });
        return { id: sid, goal, persona: "research", tools: hDef.tools, lease: wLease, agentId: h.agentId, brief: h.brief, budget: h.budget };
      });
      store.appendEvent(missionId, "plan.ready", { subtasks: subtasks.length, persona: "research", width: subtasks.length, foundry: false, conductor: true });
      return { graphPlan: { subtasks, persona: "research" } };
    } catch (e) {
      store.appendEvent(missionId, "plan.fallback", { error: "conductor: " + String(e.message).slice(0, 140) });
      return null;
    }
  }

  // Deterministic claim-text overlap (dedup + progress accounting).
  function claimOverlap(a, b) {
    const words = (t) => new Set(String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    const wa = words(a), wb = words(b);
    if (!wa.size || !wb.size) return 0;
    let n = 0; for (const w of wa) if (wb.has(w)) n++;
    return n / Math.min(wa.size, wb.size);
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
      const _snap = ledger ? ledger.snapshot() : null;
      store.appendEvent(missionId, "node.end", { node: name, phase, tokens: _snap ? _snap.tokens : undefined, costUsd: _snap ? _snap.costUsd : undefined });
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

    contract: node("contract", "contract", async (s) => {
      const tests = (s.mission?.acceptanceTests?.length ? s.mission.acceptanceTests : [{ id: id("t"), description: "Result addresses the prompt with validated, cited evidence", kind: "claim_supported", status: "pending" }]);
      // S1.B2 (Conductor call #1): restate the question as TESTABLE requirements with freshness
      // classes + explicit guesses. This contract IS the coverage checklist the mission is later
      // judged against (contract-to-footer spine). Live only; stub/eval path unchanged.
      if (live && agentDefs && taskLedger) {
        try {
          const r = await runAs("orchestrator", { node: "contract", agentRole: "conductor", effort: s.effort, schema: conductor.ContractSchema,
            system: agentDefs.systemPromptFor("conductor") || "You write testable requirement contracts for research missions.",
            input: `Today is ${new Date().toISOString().slice(0, 10)}.\nMission: ${s.mission?.prompt || ""}\n\n`
              + `Write the CONTRACT for this mission: the testable requirements a complete answer must satisfy. `
              + `1-8 requirements, each with reqId ("R1".."Rn"), text, and freshness: "today" (must come from sources published today - prices, current events), `
              + `"recent" (months matter), or "stable" (timeless facts). Add guesses[]: assumptions you are making (e.g. which country/market the owner means). `
              + `Return JSON {"requirements":[{"reqId","text","freshness"}],"guesses":["..."]}.` });
          if (r.json && r.json.requirements && r.json.requirements.length) {
            taskLedger.write({ missionId, contract: r.json, guesses: r.json.guesses || [] });
            store.appendEvent(missionId, "contract.ready", { requirements: r.json.requirements, guesses: r.json.guesses || [] });
          }
        } catch (e) { store.appendEvent(missionId, "contract.fallback", { error: String(e.message).slice(0, 140) }); }
      }
      return { mission: { ...s.mission, acceptanceTests: tests } };
    }),

    context: node("context", "context", () => ({})), // Memory Resonance capsule = W5

    // Mission Architect: decompose into ≤MAX_WIDTH subtasks, each with a persona + a narrowed
    // worker lease. Planner is read-only; it proposes, the orchestrator (root lease) issues.
    plan: node("plan", "plan", async (s) => {
      // S1.B2 (Conductor call #2): card-based staffing with code-computed budgets, six
      // deterministic plan critics, and the editable preflight gate. Falls back to the legacy
      // architect path on any failure and always in stub/eval mode.
      if (live && agentDefs && taskLedger) {
        const staffed = await conductorStaffing(s);
        if (staffed) return staffed;
      }
      const persona = personaFor(s.genome);
      const n = Math.min(MAX_WIDTH, s.effort === "totality" ? 3 : s.effort === "deep" ? 2 : 1);
      const archLease = leaseForAgent(rootLease, getBlueprint("architect"), id("sess-arch"));
      let goals = null;
      if (live) {
        // Real decomposition: the Architect returns a structured list of sub-questions.
        try {
          const r = await runAs("orchestrator", { node: "plan", effort: s.effort, schema: PlanSchema,
            system: getBlueprint("architect").systemInstructionTemplate,
            input: `${priorTurns(s.mission)}Mission: ${s.mission?.prompt || ""}\n\nReturn exactly ${n} independent sub-questions that together answer the mission. JSON: {"subtasks":[{"goal":"..."}]}` });
          goals = (r.json?.subtasks || []).map((x) => x.goal).filter(Boolean).slice(0, n);
        } catch (e) { store.appendEvent(missionId, "plan.fallback", { error: String(e.message).slice(0, 120) }); }
      } else {
        await agentRun("orchestrator", "orchestrator", { blueprint: getBlueprint("architect"), subtask: { goal: s.mission?.prompt || "" }, adapter, lease: archLease, gateway, missionId, effort: s.effort });
      }
      if (!goals || !goals.length) goals = Array.from({ length: n }, (_, i) => `${s.mission?.prompt || ""} — aspect ${i + 1}`);
      const subtasks = goals.map((goal) => {
        const sid = id("sub");
        if (useFoundry) {
          // Agent Foundry: generate an ephemeral persona + blueprint tailored to this subtask.
          const pr = generatePersona({ id: sid, goal }, { genome: s.genome });
          const bp = synthesizeWorkerBlueprint(pr);
          const wLease = leaseForAgent(rootLease, bp, id("sess-w"), { persona: pr.label });
          // leaseId is emitted so a live UI can attribute tool.grant (which carries leaseId) to the
          // worker that made the call — without it tools land on the wrong agent card.
          store.appendEvent(missionId, "persona.forged", { persona: pr.label, capabilities: pr.capabilities, modelRole: pr.modelRole, leaseId: wLease.leaseId, subtaskId: sid, goal: String(goal).slice(0, 160) });
          return { id: sid, goal, persona: pr.label, tools: pr.tools, blueprint: bp, lease: wLease };
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
      // S1.B3: research-scout hires run the specialized scout loop (blueprint pipeline);
      // every other subtask keeps the generic loop untouched (regression guarantee).
      if (w5 && live && st.agentId === "research-scout") {
        // Guard BEFORE the work: a guard written afterwards gives zero idempotency on replay
        // (the whole loop, and its spend, would run again).
        store.onceGuard(`${missionId}:worker:${st.id}`, { missionId, node: "worker" }, () => ({ started: true }));
        const scoutDef = agentDefs && agentDefs.getDef(st.agentId);
        const scoutLoop = createScoutLoop({ runAs, store, ledger, gateway, toolbox, evidenceStore, missionId, artifactsDir, registryTools, knowledgeSearch, live,
          systemPrompt: agentDefs && agentDefs.systemPromptFor(st.agentId), knowledgeScope: (scoutDef && scoutDef.knowledgeScope) || "research-scout" });
        const packets = await scoutLoop(st, s.effort);
        return { packets: packets.map((p) => validate(ResultPacket, p, "packet")) };
      }
      if (w5) {
        // Real tool-using worker (Slice 1.2): the model chooses tools (web/search/fetch, code.python,
        // memory) step by step and grounds its claim on what it gathered — web text OR computed output.
        packet = await toolLoopWorkerPacket(st, wbp, s.effort);
      } else {
        // Live-but-no-tools: answer from the model only, NO fabricated evidence (tools:[]).
        // Stub tests keep the persona tools (defaultToolStub supplies deterministic evidence).
        const stForRun = live ? { ...st, tools: [] } : st;
        ({ packet } = await agentRun(st.lease.leaseId, "worker", { blueprint: wbp, persona: st.persona, subtask: stForRun, adapter, lease: st.lease, gateway, missionId, effort: s.effort }));
      }
      // N-1: node.end{worker} is anonymous, so the UI flipped ALL running workers to DONE on
      // the FIRST completion. worker.done carries the leaseId, so only THIS card completes.
      store.appendEvent(missionId, "worker.done", { leaseId: st.lease.leaseId, subtaskId: st.id });
      return { packets: [packet] };
    }),

    // Adversarial Critic: challenge each quarantined packet (read-only, ≤3 verify searches).
    critic: node("critic", "critic", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("critic"), id("sess-crit"));
      await agentRun("critic", "critic", { blueprint: getBlueprint("critic"), subtask: { goal: "challenge the batch", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
      // N-5: the critic's judgement must be able to CHANGE the outcome. It reads each packet's
      // claim + cited quotes and returns per-packet verdicts; a "reject" blocks promotion in the
      // verify node (mapped to needs_more, with the critic's reason). It also scores each cited
      // source's credibility 0..1 (model-assessed, query-relative - NOT a domain blocklist), which
      // is written onto the evidence row and weights the promoted claim's confidence (3.4).
      const pkts = (s.packets || []).filter((p) => p.evidence.length);
      const CriticSchema = z.object({
        critiques: z.array(z.object({
          packetId: z.string(),
          verdict: z.enum(["accept", "reject"]).default("accept"),
          reason: z.string().optional().default(""),
        })).default([]),
        sources: z.array(z.object({ uri: z.string(), credibility: z.coerce.number().min(0).max(1) })).default([]),
      });
      let judged = { critiques: [], sources: [] };
      if (pkts.length) {
        try {
          const listing = pkts.map((p) => `PACKET ${p.packetId}\nCLAIM: ${String(p.claim).slice(0, 300)}\nSOURCES+QUOTES:\n${p.evidence.map((e) => `  ${e.sourceUri} :: \"${String(e.quote || "").slice(0, 200)}\"`).join("\n")}`).join("\n\n");
          const r = await runAs(lease.leaseId, {
            node: "worker", agentRole: "critic", leaseId: lease.leaseId, effort: s.effort, schema: CriticSchema,
            system: "You are an adversarial critic. You challenge claims before verification and assess source credibility for THIS question. You never invent packets.",
            input: `Mission question: ${String(s.mission?.prompt || "").slice(0, 300)}\n\n${listing}\n\n`
              + `For each packet: verdict \"reject\" ONLY if the quoted evidence plainly cannot support the claim (wrong subject, contradiction, quote about something else); otherwise \"accept\". Give a one-line reason for rejects.\n`
              + `For each distinct source uri: credibility 0..1 for THIS question (primary/official/academic high; anonymous forums, SEO farms, fan wikis low - unless the question is ABOUT that community's subject, then judge fitness for purpose).\n`
              + `Return JSON {\"critiques\":[{\"packetId\":\"...\",\"verdict\":\"accept|reject\",\"reason\":\"...\"}],\"sources\":[{\"uri\":\"...\",\"credibility\":0.9}]}.`,
          });
          if (r.json) judged = r.json;
        } catch (e) { store.appendEvent(missionId, "critic.error", { error: String(e.message).slice(0, 160) }); }
      }
      // 3.4: persist credibility onto the evidence rows so verify/promotion can weight by it.
      const cred = new Map(judged.sources.map((x) => [x.uri, x.credibility]));
      if (cred.size) { try { evidenceStore.setSourceCredibility(missionId, cred); } catch (e) { store.appendEvent(missionId, "critic.error", { error: "credibility write: " + String(e.message).slice(0, 120) }); } }
      const byId = new Map(judged.critiques.map((c) => [c.packetId, c]));
      const critiques = (s.packets || []).map((p) => {
        if (!p.evidence.length) return { packetId: p.packetId, verdict: "needs_more", reason: "no evidence attached" };
        const c = byId.get(p.packetId);
        if (c && c.verdict === "reject") return { packetId: p.packetId, verdict: "needs_more", reason: `critic: ${c.reason || "rejected"}` };
        return { packetId: p.packetId, verdict: "holds" };
      });
      store.appendEvent(missionId, "critic.done", { reviewed: critiques.length, rejected: critiques.filter((c) => c.verdict === "needs_more").length, sourcesScored: cred.size });
      return { critiques };
    }),

    // Evidence Prosecutor: the ONLY promotion authority. Re-verify + promote eligible packets.
    verify: node("verify", "verify", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("prosecutor"), id("sess-pros"));
      const already = new Set((s.validated || []).map((p) => p.packetId)); // don't re-promote on a repair re-entry
      const validated = [];
      // S1.B4 tuning: cross-scout dedup BEFORE judging. Two scouts often surface the same fact
      // from different sources; judging both doubled verify cost. Keep the higher-confidence
      // packet; the duplicate is SKIPPED (event, not a rejection - nothing wrong with it).
      const kept = [];
      const skippedDup = [];
      for (const p of s.packets || []) {
        if (already.has(p.packetId)) { kept.push(p); continue; }
        const dup = kept.find((k) => !already.has(k.packetId) && claimOverlap(k.claim, p.claim) > 0.75);
        if (dup) skippedDup.push({ packetId: p.packetId, dupOf: dup.packetId, claim: String(p.claim).slice(0, 120) });
        else kept.push(p);
      }
      if (skippedDup.length) store.appendEvent(missionId, "packet.deduped", { count: skippedDup.length, pairs: skippedDup.slice(0, 6) });
      const judgeQueue = kept.filter((p) => !already.has(p.packetId));
      const CHUNK = 3; // parallel packet judging: 30 sequential packets took 10+ min (measured)
      for (let ci = 0; ci < judgeQueue.length; ci += CHUNK) {
        await Promise.all(judgeQueue.slice(ci, ci + CHUNK).map((p) => judgePacket(p)));
      }
      async function judgePacket(p) {
        const holds = (s.critiques || []).find((c) => c.packetId === p.packetId)?.verdict !== "needs_more";
        if (!p.evidence.length || !holds) {
          // Never skip silently. A claim that cannot be judged has still failed, and the reason
          // is the most useful thing on the screen — it is how the operator learns the worker
          // produced an unattributed claim rather than that verification was merely strict.
          store.appendEvent(missionId, "claim.rejected", {
            packetId: p.packetId,
            claim: String(p.claim || "").slice(0, 400),
            status: "unattributed",
            reason: !p.evidence.length
              ? "worker produced a claim with no source attribution — nothing to verify against"
              : ((s.critiques || []).find((c) => c.packetId === p.packetId)?.reason || "critic returned needs_more"),
            reasons: [],
          });
          return;
        }

        if (w5) {
          // Slice 1.1 — REAL verification with a genuine reject path. For each cited source:
          //   (1) confirm it is live/reachable (mechanical, lease-mediated), then
          //   (2) a model entailment judge asks: does the SOURCE actually support the CLAIM?
          // (Not "is a quote we sliced from the page present in the page" — that could never fail.)
          const evByUri = new Map((evidenceStore.getEvidence(missionId) || []).map((e) => [e.uri, e]));
          // One entailment judgement per cited source. They are INDEPENDENT — judging source 2 does
          // not depend on the verdict for source 1 — so they run concurrently. Serially this was a
          // chain of reasoning-model calls (blackboard sharing gives a packet up to 8 sources), which
          // made verify the longest phase of the mission by an order of magnitude.
          // Verification runs through evidence/verify-claim.js: the claim is decomposed into
          // atoms, the WHOLE source is sentence-split and numbered, the judge emits sentence IDs,
          // and the ids are resolved to text here by index. Nothing string-matches a model-written
          // quote against the source any more — that approach rejected three true claims.
          // Verify each distinct SOURCE once. Packets routinely carry several refs to the same
          // uri, which meant the same document was decomposed and judged twice per claim -
          // duplicated cost, and two different decompositions of one claim in the same run.
          const seenUri = new Set();
          const distinctRefs = p.evidence.filter((r) => {
            const u = r && r.sourceUri;
            if (!u || seenUri.has(u)) return false;
            seenUri.add(u);
            return true;
          });
          // Cross-source union: decompose the claim ONCE so every source is judged against the
          // SAME atoms; verdicts can then be unioned per atom below.
          const sharedAtoms = await claimVerifier.decompose(p.claim, s.effort);
          const verifs = await Promise.all(distinctRefs.map(async (ref) => {
            const src = evByUri.get(ref.sourceUri);
            if (!src) return { evidenceRef: ref, supported: false, live: false, entailment: 0 };
            const out = await claimVerifier.verifyAgainstSource({
              claim: p.claim, sourceText: String(src.excerpt || ""), effort: s.effort, atoms: sharedAtoms,
            });
            // The displayed quote is now resolved from an id, so it is verbatim by construction.
            const cited = out.quotes.length ? out.quotes[0].text.slice(0, 300) : "";
            if (cited) ref.quote = cited;
            store.appendEvent(missionId, "claim.checked", {
              packetId: p.packetId, sourceUri: ref.sourceUri, verdict: out.verdict,
              atoms: out.atoms.map((x) => ({ text: String(x.atom.text).slice(0, 200), verdict: x.verdict, sentenceIds: x.ids })),
              reason: out.reason,
            });
            return {
              evidenceRef: ref, live: true, supported: out.supported,
              entailment: out.entailment, verdict: out.verdict, reason: out.reason,
              atoms: out.atoms, // cross-source union reads per-atom verdicts from here
            };
          }));
          // Union per atom across sources: an atom is SUPPORTED if ANY source supports it and
          // REFUTED if ANY refutes it (contradiction wins). The claim is jointly supported when
          // every atom is supported - even though no single source covers all of them. This is
          // what a comparison claim (\"A did X, B did Y\") structurally requires.
          const perAtom = new Map();
          for (const v of verifs) for (const a of (v.atoms || [])) {
            const key = a.atom && a.atom.id;
            if (key == null) continue;
            const cur = perAtom.get(key) || { verdict: "NOT_ENOUGH_INFO", confidence: 0 };
            if (a.verdict === "REFUTED") cur.verdict = "REFUTED";
            else if (a.verdict === "SUPPORTED" && cur.verdict !== "REFUTED") { cur.verdict = "SUPPORTED"; cur.confidence = Math.max(cur.confidence, Number(a.confidence) || 0.5); }
            perAtom.set(key, cur);
          }
          const atomStates = [...perAtom.values()];
          const joint = atomStates.length && atomStates.every((x) => x.verdict === "SUPPORTED")
            ? { supported: true, entailment: Math.min(...atomStates.map((x) => x.confidence || 0.5)) }
            : { supported: false, entailment: 0 };
          // N-2: the UI's weak-citation counter had NO producer. Weak = a source that only
          // PARTIALLY supports the claim, or supports it below 0.6 confidence.
          // Under a JOINT promotion each source is partial BY DESIGN - flag only low-confidence
          // full supports then, not the structural partials.
          const weak = verifs.filter((v) => (v.supported && v.entailment < 0.6) || (!joint.supported && !v.supported && v.entailment > 0 && v.entailment < 1));
          if (weak.length) store.appendEvent(missionId, "citation.weak", { packetId: p.packetId, count: weak.length, sources: weak.map((v) => (v.evidenceRef || {}).sourceUri).filter(Boolean) });
          const decision = promotion.evaluate(p, verifs, joint);
          // 3.4: weight confidence by the credibility of the sources that actually support the
          // claim (critic-assessed, stored on the evidence rows). Bounded [0.7..1.0]x so a low-
          // credibility source dents confidence visibly without silently killing a true claim.
          if (decision.status === "validated") {
            const evRows = evidenceStore.getEvidence(missionId) || [];
            const auths = p.evidence.map((ref) => { const eo = evRows.find((e) => e.uri === ref.sourceUri); return eo && eo.reliability ? Number(eo.reliability.authority) : null; }).filter((x) => x !== null && !Number.isNaN(x));
            if (auths.length) {
              const avg = auths.reduce((a, b) => a + b, 0) / auths.length;
              decision.confidence = Math.max(0, Math.min(1, decision.confidence * (0.7 + 0.3 * avg)));
            }
          }
          if (decision.status === "validated") {
            await gateway.mediate(lease, { tool: "memory.promote", resource: `memory:${missionId}` }, () => toolbox["memory.promote"].run({ claim: p.claim }));
            const evByUri = new Map((evidenceStore.getEvidence(missionId) || []).map((e) => [e.uri, e]));
            const supports = p.evidence.map((ref) => { const eo = evByUri.get(ref.sourceUri); return eo ? { evidenceId: eo.evidenceId, entailment: decision.entailment, quoteSafe: true } : null; }).filter(Boolean);
            const claim = evidenceStore.putClaim({ missionId, text: p.claim, class: "fact", confidence: decision.confidence, status: "supported" }, supports);
            evidenceStore.promoteClaim(claim.claimId, { confidence: decision.confidence });
            validated.push({ ...p, status: "validated", quarantined: false, confidence: decision.confidence, claimId: claim.claimId });
            // N-10: show the ref that actually SUPPORTED the claim (evidence[0] could be a
            // non-supporting source, putting a wrong quote on the console).
            const supRef = ((verifs.find((v) => v.supported) || {}).evidenceRef) || p.evidence[0] || {};
            store.appendEvent(missionId, "claim.promoted", {
              claimId: claim.claimId, packetId: p.packetId,
              claim: String(p.claim || "").slice(0, 400),
              confidence: decision.confidence, entailment: decision.entailment,
              sourceUri: supRef.sourceUri || null,
              quote: String(supRef.quote || "").slice(0, 300),
            });
          } else {
            // N-10: on a reject, surface the ref whose verification FAILED (the decisive one).
            const failRef = ((verifs.find((v) => !v.supported) || verifs[0] || {}).evidenceRef) || p.evidence[0] || {};
            store.appendEvent(missionId, "claim.rejected", {
              packetId: p.packetId,
              claim: String(p.claim || "").slice(0, 400),
              status: decision.status,
              reasons: decision.reasons,
              reason: (decision.reasons && decision.reasons[0]) || "source did not entail the claim",
              sourceUri: failRef.sourceUri || null,
              quote: String(failRef.quote || "").slice(0, 300),
            });
          }
        } else {
          // W4 fallback: structural promotion (no real verifier wired).
          await agentRun("prosecutor", "prosecutor", { blueprint: getBlueprint("prosecutor"), subtask: { goal: `verify ${p.claim}`, tools: ["citation.verify", "memory.promote"] }, adapter, lease, gateway, missionId, effort: s.effort });
          validated.push({ ...p, status: "validated", quarantined: false });
        }
      }
      store.appendEvent(missionId, "verify.done", { promoted: validated.length, ofQuarantined: (s.packets || []).length });

      // ── S1.B4: supervision. Facts (code-written from PROMOTED claims only), a progress-ledger
      // row (measurable deltas), and the bounded follow-up decision (1 wave, from reserve).
      let followupPlan = null;
      let coverageOut;                       // undefined = "no change" for the channel reducer
      // Bound the wave on our OWN counter (see state.js): `revision` auto-increments per node.
      const followupsSoFar = s.followupCount || 0;
      let followupCountOut = followupsSoFar;
      if (live && taskLedger && agentDefs) {
        try {
          const row = taskLedger.read(missionId);
          if (row && row.contract && row.contract.requirements) {
            const allValidated = [...(s.validated || []), ...validated];
            // Facts: the model cannot author these - only promoted claims land here.
            const facts = allValidated.map((p) => ({ text: String(p.claim).slice(0, 300), claimId: p.claimId || null }));
            // Progress ledger row: deterministic deltas.
            const seqRow = store.db.prepare("SELECT COALESCE(MAX(seq),0) m FROM eclipse_progress_ledger WHERE mission_id=?").get(missionId);
            const prev = store.db.prepare("SELECT progress FROM eclipse_progress_ledger WHERE mission_id=? AND seq=?").get(missionId, seqRow.m);
            const progressNow = allValidated.length;
            const stalled = prev && progressNow <= prev.progress ? 1 : 0;
            store.db.prepare("INSERT INTO eclipse_progress_ledger(mission_id,seq,trigger,satisfied,progress,stall_count,next_action_json,created_at) VALUES(?,?,?,?,?,?,?,datetime())")
              .run(missionId, seqRow.m + 1, "verify.done", 0, progressNow, stalled, "{}");
            store.appendEvent(missionId, "ledger.progress", { seq: seqRow.m + 1, progress: progressNow, stalled: !!stalled });

            // ONE coverage verdict for the whole mission: the same judge that writes the
            // honesty footer also decides the follow-up. (A cheap word-overlap test used to make
            // this call and disagreed with the footer — R3/R4 rendered UNANSWERED while the
            // follow-up decided they were covered, so no wave ever fired. Live, 2026-09-09.)
            if (allValidated.length > 0) {
              try {
                const cov = await claimVerifier.checkCoverage({
                  question: s.mission?.prompt || "", validatedClaims: allValidated, effort: s.effort,
                  requirements: row.contract.requirements.map((r) => ({ id: r.reqId, text: r.text })),
                });
                coverageOut = { requirements: cov.requirements, gaps: cov.gaps, at: allValidated.length };
                for (const r of cov.requirements) store.appendEvent(missionId, "contract.status", { reqId: r.id || null, ask: r.text, status: r.status });
                store.appendEvent(missionId, "coverage.checked", { requirements: cov.requirements.map((r) => ({ ask: r.text, status: r.status })) });
              } catch (e) {
                try { store.appendEvent(missionId, "coverage.error", { error: String(e.message).slice(0, 200) }); } catch {}
              }
            }

            if (followupsSoFar === 0 && coverageOut) {
              // A requirement the judge could not tie to ANY verified claim earns one scout.
              const unmet = coverageOut.requirements.filter((r) => r.status === "UNANSWERED");
              if (unmet.length > 0 && unmet.length < row.contract.requirements.length) {
                const scoutDef = agentDefs.getDef("research-scout");
                const subtasks = unmet.slice(0, 2).map((r) => {
                  const sid = id("sub");
                  const reqId = String(r.id);        // coverage rows carry `id`, not `reqId`
                  const scopes = agentDefs.compileLeaseScopes(scoutDef);
                  const wLease = narrow(rootLease, { sessionId: id("sess-w"), scopes, maxCostUsd: 0.06, maxCalls: { "web.search": 2, "web.fetch": 3 } });
                  store.appendEvent(missionId, "plan.followup", { reqId, objective: String(r.text).slice(0, 160), leaseId: wLease.leaseId });
                  store.appendEvent(missionId, "persona.forged", { persona: ("followup: " + reqId).slice(0, 24), capabilities: ["research-scout"], modelRole: scoutDef.modelRole, leaseId: wLease.leaseId, subtaskId: sid, goal: String(r.text).slice(0, 160) });
                  return { id: sid, goal: r.text, persona: "research", tools: scoutDef.tools, lease: wLease, agentId: "research-scout",
                    brief: { objective: r.text, angle: "follow-up gap: " + reqId, outputHint: "claims+quotes", sourceHints: [], boundary: [], reqIds: [reqId] },
                    budget: { searches: 2, reads: 3, tokens: 60000, variants: 2, contradiction: 0, usdCap: 0.06 } };
                });
                if (subtasks.length) { followupPlan = { subtasks }; followupCountOut = 1; }
              }
              // Stall/reflection (bounded, code-written lesson): a follow-up ran and nothing new
              // verified -> record the lesson and finish; never loop.
            } else if (followupsSoFar >= 1 && prev && progressNow <= prev.progress) {
              store.appendEvent(missionId, "plan.reflection", { lesson: "follow-up wave verified nothing new; finishing with current coverage" });
            }
            taskLedger.write({ missionId, contract: row.contract, facts, guesses: row.guesses, plan: row.plan, revision: followupCountOut });
          }
        } catch (e) { store.appendEvent(missionId, "ledger.error", { error: String(e.message).slice(0, 140) }); }
      }
      return { validated, verdict: { passed: validated.length > 0, promoted: validated.length }, followupPlan, followupCount: followupCountOut, coverage: coverageOut };
    }),

    repair: node("repair", "repair", async (s) => {
      // Recovery Engineer: smallest intervention. W4 = mark repaired so verify can pass on degrade.
      const lease = leaseForAgent(rootLease, getBlueprint("recovery"), id("sess-rec"));
      await agentRun("recovery", "recovery", { blueprint: getBlueprint("recovery"), subtask: { goal: "recover", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
      const rc = (s.repairCount || 0) + 1;
      // Degrade: if nothing could be validated, promote quarantined packets with evidence as low-confidence.
      // A-3: repair must NOT write un-entailment-checked packets into `validated`. The old salvage
      // marked quarantined packets validated@0.4 and the synthesiser then wrote them up as fact.
      // Repair now only re-routes to verify; a claim becomes validated ONLY through the prosecutor.
      store.appendEvent(missionId, "repair.pass", { repairCount: rc });
      return { repairCount: rc };
    }),

    // Artifact Director (synthesis): draft from VALIDATED packets only.
    synthesize: node("synthesize", "synthesize", async (s) => {
      const lease = leaseForAgent(rootLease, getBlueprint("director"), id("sess-dir"));
      // LAYER 0 - deterministic gate. No model involved, and the model is NEVER asked whether it
      // should answer. This line used to fall back to ALL packets when nothing validated, so
      // rejected claims were handed to the Director labelled "evidence-backed" and written up as
      // fact - that is how "Based on the validated evidence..." appeared over a 0-verified ledger.
      const validated = s.validated || [];
      const attempted = s.packets || [];
      if (live && validated.length === 0) {
        const tried = sourcesOf(attempted);
        store.appendEvent(missionId, "mission.abstained", { attempted: attempted.length, sources: tried.length });
        return { result: { draft: renderAbstain({ attempted, sourcesTried: tried }), fromValidated: 0, verified: false, abstained: true } };
      }
      const findings = validated;
      if (live) {
        // Coverage is a computable fact, checked against the parts of the QUESTION rather than
        // asserted by the writer. This is also what catches a multi-part question answered halfway.
        // S2.2: it runs BEFORE the Writer because its requirement→claim map is the Writer's spine.
        let gaps = [], coverage = null;
        const ledgerRow = taskLedger ? taskLedger.read(missionId) : null;
        const contract = ledgerRow && ledgerRow.contract && ledgerRow.contract.requirements ? ledgerRow.contract : null;
        // Verify already ran this exact judgement over this exact claim set — reuse it rather
        // than paying for (and risking a disagreement with) a second opinion.
        if (s.coverage && s.coverage.at === validated.length) {
          coverage = s.coverage;
          gaps = s.coverage.gaps || [];
          store.appendEvent(missionId, "coverage.reused", { requirements: s.coverage.requirements.length, gaps: gaps.length });
        } else try {
          // S1.B2: the coverage checklist IS the Conductor's contract when one exists
          // (contract-to-footer spine); post-hoc question decomposition stays as the fallback.
          const contractReqs = contract ? contract.requirements.map((r) => ({ id: r.reqId, text: r.text })) : null;
          const cov = await claimVerifier.checkCoverage({ question: s.mission?.prompt || "", validatedClaims: validated, effort: s.effort, requirements: contractReqs });
          if (contractReqs) for (const r of cov.requirements) store.appendEvent(missionId, "contract.status", { reqId: r.id || null, ask: r.text, status: r.status });
          coverage = cov;
          gaps = cov.gaps;
          store.appendEvent(missionId, "coverage.checked", { requirements: cov.requirements.map((r) => ({ ask: r.text, status: r.status })) });
        } catch (e) {
          // B-3: must not block the answer, but must be VISIBLE - a silent skip here hides a lying footer.
          try { store.appendEvent(missionId, "coverage.error", { error: String(e.message).slice(0, 200) }); } catch {}
        }
        // Appended to every answer from the real counts; the model is forbidden from writing it.
        const footer = coverageFooter({ verified: validated.length, attempted: attempted.length, gaps });

        // S2.2 B1 — the Writer: typed blocks, every fact sentence naming its claims (blueprint §4).
        let draftMd = null, blocks = null;
        try {
          const wdef = agentDefs ? agentDefs.getDef("writer") : null;
          const out = await runWriter({
            run: (o) => runAs("writer", o),
            systemPrompt: (agentDefs && agentDefs.systemPromptFor("writer")) || undefined,
            mission: s.mission, contract, coverage, validated, conflicts: conflictsFor(validated),
            effort: s.effort, priorTurns: priorTurns(s.mission),
            emit: (t, p) => store.appendEvent(missionId, t, p),
            budgets: (wdef && wdef.budgets) || {},
          });
          draftMd = renderBlocks({ sections: out.sections, claims: out.claims });
          // §6: persist the blocks + sentence→claim map (hover-citations read this, version 1).
          const ins = store.db.prepare(`INSERT OR REPLACE INTO eclipse_draft_blocks(mission_id,version,section_id,block_seq,block_json,sentence_map_json,created_at) VALUES(?,?,?,?,?,?,datetime())`);
          const tx = store.db.transaction(() => {
            for (const sec of out.sections) sec.blocks.forEach((b, i) => ins.run(missionId, out.done.version, sec.sectionId, i,
              JSON.stringify(b), JSON.stringify(b.kind === "para" ? b.sentences.map((st) => ({ sid: st.sid, claimIds: st.claimIds })) : [])));
          });
          tx();
          blocks = { type: out.type, version: out.done.version, sections: out.sections.map((sec) => ({ sectionId: sec.sectionId, title: sec.title, blocks: sec.blocks })) };
        } catch (e) {
          // The Writer failed (schema exhausted, budget cap, model error). Say so. If sections
          // were already written, render THOSE — a partial draft the reader can see beats a
          // fallback call that would trip the same budget cap. Otherwise the single-call Director.
          const partial = e.partial && e.partial.sections.length ? e.partial : null;
          store.appendEvent(missionId, "draft.fallback", { error: String(e.message).slice(0, 300), code: e.code || null, partialSections: partial ? partial.sections.length : 0 });
          if (partial) {
            draftMd = renderBlocks(partial) + "\n\n> _The writer stopped before finishing (" + String(e.message).slice(0, 120) + "). Sections above are complete; nothing below them was written._";
            blocks = { type: "partial", version: 0, sections: partial.sections.map((sec) => ({ sectionId: sec.sectionId, title: "", blocks: sec.blocks })) };
            return { result: { draft: draftMd + footer, fromValidated: validated.length, verified: validated.length > 0, blocks } };
          }
          const brief = findings.map((p, i) => {
            const srcs = [...new Set((p.evidence || []).map((e) => e.sourceUri).filter(Boolean))];
            const srcLine = srcs.length ? `\n  Sources: ${srcs.join(" ; ")}` : "";
            return `Finding ${i + 1}${srcs.length ? " (evidence-backed)" : ""}: ${p.claim}${srcLine}`;
          }).join("\n\n");
          const r = await runAs("director", { node: "synthesize", effort: s.effort,
            system: getBlueprint("director").systemInstructionTemplate,
            input: `${priorTurns(s.mission)}Mission: ${s.mission?.prompt || ""}\n\nAgent findings (with their sources):\n${brief}\n\n`
              + `Write the final answer using ONLY the findings above.\nRULES:\n`
              + `1. Do NOT state anything that is not in the findings — no dates, numbers, names or units from your own knowledge.\n`
              + `2. CITE the sources listed above by URL where relevant.\n`
              + `3. Do NOT write any sentence about coverage, completeness, or verification status, and never use the words "validated", "verified" or "no coverage gaps". That line is added by the system, which alone knows the real counts.\n`
              + `4. If the findings do not cover part of the question, simply do not discuss that part.` });
          draftMd = String(r.text || "");
        }
        return { result: { draft: draftMd + footer, fromValidated: validated.length, verified: validated.length > 0, blocks } };
      }
      const r = await agentRun("director", "director", { blueprint: getBlueprint("director"), subtask: { goal: "synthesize deliverable", tools: [] }, adapter, lease, gateway, missionId, effort: s.effort });
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
          // S2.2: report.md is the Writer's draft (blocks → markdown), not the bare claim list.
          const draft = s.result && s.result.blocks && !s.result.abstained ? String(s.result.draft || "") : null;
          const { manifest } = composeReport({ mission: s.mission, validated: s.validated || [], evidenceStore, outDir: artifactsDir, draft });
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
      // S1.B4: mission-shape memory — graded by the REAL verified ratio, written by code.
      if (taskLedger) {
        try {
          const row = taskLedger.read(missionId);
          if (row && row.contract && row.contract.requirements) {
            const cls = (row.plan && row.plan.proposed && row.plan.proposed.complexityClass) || "unknown";
            const reqTexts = row.contract.requirements.map((r) => r.text).slice(0, 4).join(" | ");
            const shape = `mission-shape [${cls}]: ${reqTexts}`.slice(0, 480);
            const verifiedPct = row.contract.requirements.length
              ? Math.round(100 * (s.validated || []).length / Math.max(1, (s.packets || []).length)) : 0;
            const text = `${shape} -> hires:${(row.plan && row.plan.proposed && row.plan.proposed.hires && row.plan.proposed.hires.length) || 0} verified:${(s.validated || []).length} of ${(s.packets || []).length} packets, cost $${snap.costUsd.toFixed(2)}`;
            const hash = hashOf("shape:" + shape);
            store.db.prepare(`INSERT OR IGNORE INTO eclipse_semantic_memory(mem_id,text,kind,confidence,support_count,content_hash,first_mission,last_mission,created_at,updated_at,agent_scope,provenance_json)
              VALUES(?,?,?,?,1,?,?,?,datetime(),datetime(),'conductor',?)`)
              .run(id("shape"), text, "mission-shape", Math.min(1, verifiedPct / 100), hash, missionId, missionId, JSON.stringify({ missionId }));
            store.appendEvent(missionId, "shape.recorded", { cls, verified: (s.validated || []).length });
          }
        } catch (e) { store.appendEvent(missionId, "ledger.error", { error: "shape: " + String(e.message).slice(0, 120) }); }
      }
      return { phase: "complete", budget: { tokens: snap.tokens, costUsd: snap.costUsd } };
    }),

    // S1.B4: consume the follow-up plan — hand its subtasks to the same Send fan-out, once.
    followup: node("followup", "worker", (s) => {
      const subs = s.followupPlan?.subtasks || [];
      store.appendEvent(missionId, "followup.launch", { subtasks: subs.length, reqIds: subs.map((x) => (x.brief?.reqIds || []).join(",")) });
      // followupPlan: null CLEARS the channel (reducer treats null as a real value), so the
      // next afterVerify routes to synthesize instead of looping back here.
      return { graphPlan: { subtasks: subs, persona: "research" }, followupPlan: null };
    }),

    // Fan-out edge: one Send per subtask → parallel Workers. Falls back to a single worker.
    fanOut: (s) => {
      const subs = s.graphPlan?.subtasks || [];
      if (!subs.length) return [new Send("worker", { subtask: null })];
      return subs.map((st) => new Send("worker", { subtask: st }));
    },

    // Router after verify: enough validated (or repairs exhausted) → synthesize; else repair.
    // Live-model-only: workers produced findings but no external evidence → synthesize directly.
    afterVerify: (s) => {
      if (s.followupPlan && s.followupPlan.subtasks && s.followupPlan.subtasks.length) return "followup"; // S1.B4: one bounded wave
      return ((s.validated || []).length > 0 || (s.repairCount || 0) >= maxRepairs || (live && (s.packets || []).length > 0) ? "synthesize" : "repair");
    },
  };
  return nodes;
}

module.exports = { createNodes, MAX_WIDTH, personaFor, priorTurns };
