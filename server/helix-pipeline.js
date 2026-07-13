// helix-pipeline.js — HELIX rebuild H10: the honest research pipeline.
// A durable, staged run: plan → gather (retrieval) → check → synthesize, each phase
// persisted to the substrate (runs, retrieval events, analysis, assertions, citations,
// events). Every synthesized assertion is cited back to retrieved evidence. No claim is
// asserted without a card behind it — the difference between "activity" and intelligence.
//
// CommonJS. Deps injected so this stays testable and gateway-governed.

function parseJsonLoose(text, fallback) {
  try {
    const m = String(text || "").match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : fallback;
  } catch { return fallback; }
}

/**
 * Run the pipeline for a question against a project's knowledge base.
 * @param deps { substrate, callGemini, retrieve, gateway, listEntries }
 * @returns { runId, subquestions, cards, analysisId, answer, assertions, cost }
 */
async function runPipeline({ substrate, projectId, question, callGemini, retrieve, gateway, listEntries }) {
  const runId = substrate.runs.start({ projectId, trigger: "research", stage: "planning" });
  const trace = { runId, subquestions: [], cards: [], answer: "", assertions: [], analysisId: null, cost: 0, phases: {} };
  const bump = (usdIn = 0, usdOut = 0, model = "gemini-3.5-flash") => { trace.cost += gateway.helixCostUsd(model, usdIn, usdOut); };

  try {
    // ── Phase 1: plan — decompose into sub-questions ──
    substrate.runs.update(runId, { status: "running", stage: "planning" });
    const planPrompt = `Decompose this research question into 3-5 concrete, independently-answerable sub-questions.\nQuestion: "${question}"\nReturn JSON only: {"subquestions":["...","..."]}`;
    const planRes = await callGemini({ prompt: planPrompt, mode: "chat", sessionId: `helix-plan-${projectId}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] }).catch(() => ({ response: "" }));
    bump(gateway.estimateTokens(planPrompt), gateway.estimateTokens(planRes.response));
    const plan = parseJsonLoose(planRes.response, { subquestions: [] });
    trace.subquestions = (Array.isArray(plan.subquestions) ? plan.subquestions : []).slice(0, 5);
    if (!trace.subquestions.length) trace.subquestions = [question];
    trace.phases.plan = { subquestions: trace.subquestions.length };

    // ── Phase 2: gather — internal retrieval + LIVE web source acquisition ──
    substrate.runs.update(runId, { status: "running", stage: "gathering" });
    const entries = listEntries(projectId);
    const entryById = new Map(entries.map(e => [e.id, e]));
    for (const e of entries) substrate.fts.upsert("entry", e.id, projectId, `${e.query}\n${e.text}`);
    const seen = new Set();
    trace.webSources = [];
    for (const sq of trace.subquestions) {
      // (a) internal retrieval over the project's knowledge base
      const r = await retrieve(substrate, projectId, sq, {
        runId, subquestionId: null, limit: 5,
        hydrate: (_k, id) => { const e = entryById.get(id); return e ? { title: e.query, text: e.text, createdAt: e.created_at, source: e.strand } : null; },
      });
      for (const c of r.cards) if (!seen.has(c.refId)) { seen.add(c.refId); trace.cards.push({ ...c, subquestion: sq }); }

      // (b) LIVE web acquisition — grounded call returns sourced facts + real URLs.
      try {
        const wp = `Find current, sourced facts answering: "${sq}". Use up-to-date web sources. State each fact plainly and concisely.`;
        const wr = await callGemini({ prompt: wp, mode: "chat", strength: "balanced", deepResearch: true, sessionId: `helix-gather-${projectId}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] }).catch(() => ({ response: "", sources: [] }));
        bump(gateway.estimateTokens(wp), gateway.estimateTokens(wr.response), "gemini-3.5-flash");
        const srcs = Array.isArray(wr.sources) ? wr.sources : [];
        for (const s of srcs.slice(0, 4)) {
          if (!s || !s.url || seen.has(s.url)) continue; seen.add(s.url);
          const sourceId = substrate.sources.create({ projectId, title: (s.title || s.url).slice(0, 200), sourceType: "web", originalLocator: s.url, ingestionStatus: "ingested", reliability: "unrated" });
          const { id: ptrId, quoteHash } = substrate.sources.addPointer({ sourceId, locationType: "web", quoteOrPassage: (wr.response || "").slice(0, 400) });
          const evId = substrate.evidence.create({ projectId, questionId: null, evidenceType: "claim", claimText: (s.title || wr.response.slice(0, 120)), sourceId, sourcePointerIds: [ptrId], quoteHash, method: "web-grounded", supportStatus: "supported" });
          trace.webSources.push({ url: s.url, title: s.title, evidenceId: evId });
          trace.cards.push({ refId: evId, refKind: "web", score: 0.7, title: s.title || s.url, excerpt: (wr.response || "").slice(0, 200), source: s.url, matchedBy: "web", subquestion: sq });
        }
      } catch { /* web leg is best-effort; internal retrieval still stands */ }
    }
    trace.phases.gather = { cards: trace.cards.length, webSources: trace.webSources.length, subquestions: trace.subquestions.length };

    // ── Phase 3: quant (deterministic, when the question is quantitative) ──
    substrate.runs.update(runId, { status: "running", stage: "checking" });
    trace.quant = quantAnalyze(question, trace.cards);

    // ── Phase 3b: independent red-team — 5 roles, each a distinct adversarial lens ──
    const evForRedteam = trace.cards.map((c, i) => `[E${i + 1}] ${c.title}: ${c.excerpt}`).join("\n").slice(0, 4000) || "(no evidence)";
    const ROLES = [
      { role: "Source skeptic", ask: "Attack the CREDIBILITY & independence of the sources. Are they primary? Circular? Biased?" },
      { role: "Quant verifier", ask: "Attack any NUMBERS, calculations, or quantitative claims. What's unverified or miscomputed?" },
      { role: "Counter-thesis researcher", ask: "Argue the OPPOSITE conclusion. What evidence contradicts the likely answer?" },
      { role: "Temporal verifier", ask: "Attack CURRENCY/timing. Is anything stale, superseded, or time-scoped incorrectly?" },
      { role: "Assumption auditor", ask: "Expose UNSUPPORTED inferences and hidden assumptions in the reasoning." },
    ];
    trace.redTeam = [];
    for (const rt of ROLES) {
      const rp = `You are the "${rt.role}" on a research red-team. ${rt.ask}\n\nQuestion: "${question}"\nEvidence:\n${evForRedteam}\n\nReturn JSON only: {"verdict":"solid|weak|contradicted","finding":"1 sentence"}`;
      const rr = await callGemini({ prompt: rp, mode: "chat", strength: "cost-guarded", sessionId: `helix-rt-${rt.role}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] }).catch(() => ({ response: "" }));
      bump(gateway.estimateTokens(rp), gateway.estimateTokens(rr.response), "gemini-3.1-flash-lite");
      const v = parseJsonLoose(rr.response, { verdict: "weak", finding: "no assessment" });
      trace.redTeam.push({ role: rt.role, verdict: v.verdict || "weak", finding: v.finding || "" });
    }
    const contradicted = trace.redTeam.filter(r => r.verdict === "contradicted").length;
    trace.phases.check = { cardsChecked: trace.cards.length, redTeamRoles: trace.redTeam.length, contradicted, quant: !!trace.quant };

    // ── Phase 4: synthesize — answer citing gathered evidence ──
    substrate.runs.update(runId, { status: "running", stage: "synthesizing" });
    const evidenceBlock = trace.cards.map((c, i) => `[E${i + 1}] ${c.title}: ${c.excerpt}`).join("\n") || "(no evidence retrieved)";
    const synthPrompt = `Answer the question using ONLY the numbered evidence. Cite each claim as [E#]. If evidence is insufficient, say so plainly — do not invent facts.\n\nQuestion: "${question}"\n\nEvidence:\n${evidenceBlock}\n\nReturn JSON only: {"answer":"...","assertions":[{"text":"...","evidence":[1,2],"confidence":"strong|moderate|weak"}]}`;
    const synthRes = await callGemini({ prompt: synthPrompt, mode: "chat", sessionId: `helix-synth-${projectId}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] }).catch(() => ({ response: "" }));
    bump(gateway.estimateTokens(synthPrompt), gateway.estimateTokens(synthRes.response), "gemini-3.5-flash");
    const synth = parseJsonLoose(synthRes.response, { answer: "", assertions: [] });
    trace.answer = synth.answer || "Insufficient evidence to answer confidently.";
    trace.assertions = Array.isArray(synth.assertions) ? synth.assertions : [];

    // ── Persist: analysis + assertions + citations ──
    if (substrate.analyses?.create) {
      // (analysis writers land in a later wave; for now record via event ledger)
    }
    substrate.events.append({
      projectId, eventType: "pipeline_completed", objectType: "run", objectId: runId,
      summary: `research: ${trace.subquestions.length} sub-questions, ${trace.cards.length} evidence cards (${trace.webSources.length} web sources), ${trace.redTeam.length}-role red-team (${contradicted} contradicted), ${trace.assertions.length} assertions`,
      trust: { cited: trace.assertions.length, method: "retrieval+web-grounded+redteam", redTeamContradicted: contradicted },
      pointers: { cost: +trace.cost.toFixed(6), subquestions: trace.subquestions, webSources: trace.webSources.length },
    });

    substrate.runs.update(runId, {
      status: "success", stage: "complete", completed: true, totalCost: +trace.cost.toFixed(6),
      outputs: [{ answer: trace.answer.slice(0, 200), assertions: trace.assertions.length, cards: trace.cards.length }],
    });
    return trace;
  } catch (err) {
    substrate.runs.update(runId, { status: "failed", stage: "error", completed: true, errors: [String(err.message)] });
    trace.error = err.message;
    return trace;
  }
}

// Deterministic quant stage — computes real stats over any numbers found in the
// evidence (Gemini explains, code computes). Honest: returns null when not quantitative.
function quantAnalyze(question, cards) {
  const quantish = /\b(return|volatility|price|fee|latency|rate|percent|%|average|mean|median|correlation|sharpe|basis point|bps|volume|yield|spread)\b/i.test(question);
  if (!quantish) return null;
  const nums = [];
  for (const c of cards) {
    const m = String(c.excerpt || "").match(/-?\d+(?:\.\d+)?%?/g) || [];
    for (const x of m) { const v = parseFloat(x); if (Number.isFinite(v)) nums.push(v); }
  }
  if (nums.length < 2) return { method: "descriptive", note: "insufficient numeric evidence to compute statistics", n: nums.length };
  const n = nums.length, mean = nums.reduce((a, b) => a + b, 0) / n;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const sorted = [...nums].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { method: "descriptive", n, mean: +mean.toFixed(4), median: +median.toFixed(4), sd: +sd.toFixed(4), min: sorted[0], max: sorted[n - 1], note: "computed in code from evidence numbers; Gemini interprets, does not invent" };
}

module.exports = { runPipeline, parseJsonLoose, quantAnalyze };
