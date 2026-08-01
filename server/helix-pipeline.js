// helix-pipeline.js — HELIX rebuild H10: the honest research pipeline.
// A durable, staged run: plan → gather (retrieval) → check → synthesize, each phase
// persisted to the substrate (runs, retrieval events, analysis, assertions, citations,
// events). Every synthesized assertion is cited back to retrieved evidence. No claim is
// asserted without a card behind it — the difference between "activity" and intelligence.
//
// CommonJS. Deps injected so this stays testable and gateway-governed.

function parseJsonLoose(text, fallback) {
  const raw = String(text || "");
  // 1) strict: the first complete {...} / [...] block
  try {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
  } catch { /* fall through to recovery */ }
  // 2) recovery: strip code fences and retry
  try {
    const fenced = raw.replace(/```(?:json)?/gi, "").trim();
    const m2 = fenced.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m2) return JSON.parse(m2[0]);
  } catch { /* fall through */ }
  // 3) TRUNCATED JSON (the common failure: the model hit its output cap mid-object, so the
  //    closing braces are missing). Pull the "answer" string out directly rather than
  //    discarding a real synthesis — silently returning the fallback here is what made the
  //    pipeline claim "Insufficient evidence" while holding 12 good sources.
  const am = raw.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (am && am[1]) {
    try { return { ...fallback, answer: JSON.parse(`"${am[1].replace(/"$/, "")}"`) }; }
    catch { return { ...fallback, answer: am[1] }; }
  }
  return fallback;
}

// Model-call diagnostics. Every model call in this file used `.catch(() => ({ response: "" }))`,
// so an API failure, a quota exhaustion or an empty grounded search looked EXACTLY like a
// successful call that happened to return nothing — two runs came back with 0 web sources and
// the backend log was clean. Failures now land on the run trace (bump.errors) instead of
// vanishing. `bump` is constructed per run, so this is per-run state, not global.
function noteModelError(bump, where, err) {
  if (typeof bump !== "function") return;
  const msg = String((err && (err.message || err)) || "unknown").slice(0, 300);
  (bump.errors = bump.errors || []).push({ where, error: msg });
}
// Provider failures that arrive IN BAND — the call succeeds and the "answer" is the error
// text ("Your prepayment credits are depleted", a 429, a safety block). These are the worst
// kind: nothing throws, the response is non-empty, so every phase reports success while the
// whole run quietly researches nothing. Detect them and treat them as hard failures.
const PROVIDER_ERROR_PATTERNS = [
  /prepayment credits are depleted/i,
  /could not complete that request/i,
  /quota|resource[_ ]exhausted|rate limit|too many requests/i,
  /billing|payment required/i,
  /api key (?:not valid|invalid|expired)/i,
  /permission denied|unauthenticated/i,
  /service unavailable|internal error|try again later/i,
];
// AGENT-LOOP HIJACK: the brain treats HELIX's internal structured sub-prompt as a *user*
// research request, runs its own tool, and returns a tool-execution summary
// ("Done, sir. The verified result is: - research_v2 completed: id: …, query: <our prompt>").
// Non-empty, no error, so it cleared every check while the planner, architect and web-gather
// all silently received zero usable content. These are matched at any length, because the
// tool report is long — unlike a billing message, its own size was hiding it.
const AGENT_HIJACK_PATTERNS = [
  /\bresearch_v2 (?:completed|failed)\b/i,
  /^\s*done,?\s+sir\b[\s\S]{0,120}\bverified result\b/i,
  /^\s*done,?\s+sir\b[\s\S]{0,120}\bcompleted:\s*id:/i,
];
function providerErrorIn(text) {
  const t = String(text || "");
  const hijack = AGENT_HIJACK_PATTERNS.find((re) => re.test(t));
  if (hijack) return `agent tool-loop hijack (brain returned a tool report, not an answer): ${t.replace(/\s+/g, " ").trim().slice(0, 160)}`;
  if (t.length > 600) return null;              // a real report can mention "quota" in passing
  const hit = PROVIDER_ERROR_PATTERNS.find((re) => re.test(t));
  return hit ? t.replace(/\s+/g, " ").trim().slice(0, 240) : null;
}

// ─────────────────────────────────────────────────────────────────────────
//  HELIX's OWN model path (direct generateContent — no agent loop, no tools)
//
//  WHY: HELIX's internal calls (plan a decomposition, grade evidence, design an
//  outline, write one section) are STRUCTURED SUB-TASKS, not conversations. Routing
//  them through the conversational brain meant they inherited its agentic tool loop,
//  which answered "Decompose this research question into 5-7 sub-questions" by running
//  its own research_v2 tool and returning a tool report — non-empty, no error, zero
//  usable content, every phase reporting success. See CHECKPOINT 2 in the plan doc.
//
//  This path talks to generateContent directly with NO tool declarations, so there is
//  nothing for a tool loop to latch onto. The only call that gets a tool is the web
//  gather, which needs google_search for real grounded sources.
//
//  It reads the same key and the same model registry as the brain, but owns no brain
//  files — so Codex's in-flight work cannot break HELIX again, and vice versa.
// ─────────────────────────────────────────────────────────────────────────
const { MODELS, candidatesFor } = require("./gemini-models");
const GEMINI_BASE = String(process.env.JARVIS_GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");

let _keyCache = null;
function helixApiKey() {
  if (_keyCache !== null) return _keyCache;
  let key = process.env.GEMINI_API_KEY || "";
  if (!key) {
    // Same resolution order as the server: env, then the local DPAPI vault.
    try {
      const path = require("path");
      const { createSecretStore } = require("./secret-store");
      const runtimeDir = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(path.resolve(__dirname, ".."), "runtime"));
      key = createSecretStore(runtimeDir).load().geminiKey || "";
    } catch { key = ""; }
  }
  _keyCache = key;
  return key;
}

/** One generateContent attempt. Returns {response, sources} or throws. */
// Grounded calls run a search before generating, so they legitimately take far longer than a
// plain completion. A flat 90 s abort was killing ~3 gather calls per run with "fetch failed"
// — reported honestly, but still lost research.
async function generateOnce({ key, model, prompt, grounded, timeoutMs = grounded ? 170000 : 90000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
      ...(grounded ? { tools: [{ google_search: {} }] } : {}),
    };
    const res = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const err = new Error(`${res.status} ${detail.replace(/\s+/g, " ").slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const cand = (data.candidates || [])[0] || {};
    const text = (cand.content?.parts || []).map((p) => p.text || "").join("").trim();
    // Grounded replies carry their real sources here — the same shape the brain uses.
    const chunks = cand.groundingMetadata?.groundingChunks || [];
    const sources = chunks.map((c) => ({ url: c.web?.uri || "", title: c.web?.title || "" })).filter((s) => s.url);
    // W6: per-SEGMENT grounding. `groundingSupports` maps a byte range of the generated text
    // to the chunks that support it, with a confidence per chunk. This is what makes a
    // citation sentence-level instead of "this whole passage came from these 6 URLs".
    const supports = (cand.groundingMetadata?.groundingSupports || []).map((g) => ({
      start: g.segment?.startIndex ?? 0,
      end: g.segment?.endIndex ?? 0,
      text: g.segment?.text || "",
      chunks: g.groundingChunkIndices || [],
      confidence: Array.isArray(g.confidenceScores) && g.confidenceScores.length
        ? Math.max(...g.confidenceScores) : null,
    })).filter((g) => g.end > g.start);
    return { response: text, sources, supports, model };
  } finally { clearTimeout(timer); }
}

// A network blip is not a model failure — retrying the SAME rung once is far more likely to
// succeed than dropping to a weaker model. Only genuinely transient shapes qualify.
const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|aborted|503|502|504/i;

/** Direct call with the registry's failover ladder. Returns null if every rung fails. */
async function directGemini({ key, prompt, grounded, strength, bump, where }) {
  const base = strength === "cost-guarded" ? MODELS.router : MODELS.main;
  // flash-lite returns no groundingMetadata, so it must never serve a grounded call.
  const ladder = candidatesFor(base).filter((m) => !grounded || !/flash-lite/.test(m));
  let lastErr = "no candidate models";
  for (const model of (ladder.length ? ladder : [base])) {
    try {
      let r;
      try { r = await generateOnce({ key, model, prompt, grounded }); }
      catch (e1) {
        if (!TRANSIENT.test(String(e1.message || ""))) throw e1;
        // Recorded SEPARATELY from modelErrors: a blip the retry absorbed is not a degraded
        // run, and filing it as an error makes a clean run look broken. Still recorded, because
        // silent retries would hide a provider that is quietly struggling.
        if (typeof bump === "function") (bump.retries = bump.retries || []).push({ where, model, error: String(e1.message || "").slice(0, 160) });
        r = await generateOnce({ key, model, prompt, grounded });
      }
      if (String(r.response || "").trim()) return r;
      lastErr = `empty response from ${model}`;
    } catch (e) {
      lastErr = `${model}: ${e.message}`;
      // ACCOUNT-level failures (depleted credits, disabled key, denied project) apply to
      // every model on the key — walking the ladder just fires N more doomed requests.
      if (/prepayment credits|billing|API key not valid|PERMISSION_DENIED|disabled/i.test(e.message)) {
        lastErr = `account-level failure, ladder skipped — ${lastErr}`;
        break;
      }
      // Other 4xx that isn't rate-limiting won't be fixed by another model either.
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) break;
    }
  }
  noteModelError(bump, where, `direct: ${lastErr}`);
  return null;
}

// ── Grounded-search cache (W7) ────────────────────────────────────────────
// Gather is the single largest phase (~40 s of a ~110 s run) and the follow-up round often
// re-asks something close to a round-1 query. Keyed on the exact prompt, so a cache hit is
// the same question — never a near-miss served as if it were exact. Short TTL because the
// whole point of a grounded search is freshness: a stale hit would silently make the report
// less current, which is the opposite of what this pipeline is for.
// TTL is long because grounded search is billed PER REQUEST (~$0.035): re-running the same
// search 20 minutes later costs real money for almost certainly identical results. 6h is a
// deliberate trade of some freshness for a large cost reduction; a monitoring re-run that
// genuinely needs fresh data can bypass with HELIX_SEARCH_TTL_MIN=0.
const SEARCH_TTL_MS = Number(process.env.HELIX_SEARCH_TTL_MIN ?? 360) * 60 * 1000;
const SEARCH_CACHE_MAX = 400;
const searchCache = new Map();                      // prompt → { at, value }

// PERSISTED TO DISK. The cache used to be memory-only, so every server restart wiped it —
// and during a day of development the backend restarts constantly. It therefore never
// prevented a single repeat search, while looking like it was working. A cache that does not
// survive the process is not a cache for this workload.
const CACHE_FILE = (() => {
  try {
    const path = require("path");
    const dir = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(path.resolve(__dirname, ".."), "runtime"));
    require("fs").mkdirSync(dir, { recursive: true });
    return path.join(dir, "helix-search-cache.json");
  } catch { return null; }
})();

function loadSearchCache() {
  if (!CACHE_FILE) return;
  try {
    const raw = JSON.parse(require("fs").readFileSync(CACHE_FILE, "utf8"));
    let live = 0;
    for (const [k, v] of raw) {
      if (!v || Date.now() - v.at > SEARCH_TTL_MS) continue;
      searchCache.set(k, v); live++;
    }
    if (live) console.log(`[helix] search cache restored — ${live} entries (saves ~$${(live * 0.035).toFixed(2)} of repeat searches)`);
  } catch { /* absent or corrupt: start empty, never fail boot over a cache */ }
}
let cacheDirty = false;
function persistSearchCache() {
  if (!CACHE_FILE || !cacheDirty) return;
  try {
    require("fs").writeFileSync(CACHE_FILE, JSON.stringify([...searchCache.entries()]));
    cacheDirty = false;
  } catch { /* disk full / locked — losing the cache is not worth failing a run */ }
}
loadSearchCache();
// Flush periodically and on exit, so a crash costs at most one interval of cached searches.
const cacheFlush = setInterval(persistSearchCache, 60000);
if (cacheFlush.unref) cacheFlush.unref();
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, persistSearchCache);

function searchCacheGet(prompt) {
  const hit = searchCache.get(prompt);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_TTL_MS) { searchCache.delete(prompt); cacheDirty = true; return null; }
  // Refresh recency so hot queries survive eviction.
  searchCache.delete(prompt); searchCache.set(prompt, hit);
  return hit.value;
}
function searchCachePut(prompt, value) {
  searchCache.set(prompt, { at: Date.now(), value });
  while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  cacheDirty = true;
}

/** Model call + diagnostics. Prefers HELIX's own path; falls back to the injected
 *  brain only when no API key is available locally. Returns {response} always. */
// ── SPEND CAPS ────────────────────────────────────────────────────────────
// Hard ceilings, not warnings. Nothing in this pipeline previously stopped it from spending:
// a runaway loop, an over-eager depth setting, or a benchmark sweep could bill indefinitely
// and the only feedback was a token-only cost figure that under-reported grounded search ~8x.
// Both limits are env-overridable but default to values that make a surprise bill impossible.
const RUN_BUDGET_USD = Number(process.env.HELIX_RUN_BUDGET_USD || 0.60);
const DAY_BUDGET_USD = Number(process.env.HELIX_DAY_BUDGET_USD || 5.00);

const daySpend = { day: "", usd: 0 };
function todayKey() { return new Date().toISOString().slice(0, 10); }
function recordSpend(usd) {
  const d = todayKey();
  if (daySpend.day !== d) { daySpend.day = d; daySpend.usd = 0; }
  daySpend.usd += usd;
  return daySpend.usd;
}
function spendState() { return { day: daySpend.day || todayKey(), usd: +daySpend.usd.toFixed(4), dayBudget: DAY_BUDGET_USD, runBudget: RUN_BUDGET_USD }; }

/** Why a call must not proceed, or null if it may. Checked BEFORE every model call. */
function budgetBlock(bump) {
  if (daySpend.day === todayKey() && daySpend.usd >= DAY_BUDGET_USD) {
    return `daily budget reached ($${daySpend.usd.toFixed(2)} of $${DAY_BUDGET_USD.toFixed(2)}) — set HELIX_DAY_BUDGET_USD to raise it`;
  }
  const runSpend = typeof bump === "function" ? (bump.runUsd || 0) : 0;
  if (runSpend >= RUN_BUDGET_USD) {
    return `run budget reached ($${runSpend.toFixed(2)} of $${RUN_BUDGET_USD.toFixed(2)}) — set HELIX_RUN_BUDGET_USD to raise it`;
  }
  return null;
}

async function askModel(callGemini, bump, where, opts) {
  // Refuse BEFORE spending, not after. A cap that only reports the overspend is not a cap.
  const blocked = budgetBlock(bump);
  if (blocked) {
    noteModelError(bump, where, `budget: ${blocked}`);
    if (typeof bump === "function") bump.budgetStopped = blocked;
    return { response: "" };
  }
  if (typeof bump === "function") bump.calls = (bump.calls || 0) + 1;   // W7 per-phase call count
  // Only grounded searches are cached: they are the slow ones, and they are the only calls
  // whose result depends on nothing but the prompt. Synthesis calls must stay uncached — the
  // same section prompt against different evidence must never reuse an earlier answer.
  const cacheable = !!opts.deepResearch;
  if (cacheable) {
    const hit = searchCacheGet(opts.prompt);
    if (hit) { if (typeof bump === "function") bump.cacheHits = (bump.cacheHits || 0) + 1; return { ...hit, fromCache: true }; }
  }
  const key = helixApiKey();
  if (key) {
    const direct = await directGemini({
      key, prompt: opts.prompt, grounded: !!opts.deepResearch, strength: opts.strength, bump, where,
    });
    if (direct) {
      if (cacheable) searchCachePut(opts.prompt, direct);
      if (process.env.HELIX_DEBUG_RAW) {
        try { require("fs").appendFileSync("helix-raw.log", `\n===== ${where} (direct/${direct.model}) =====\n${direct.response.slice(0, 1200)}\n`); } catch {}
      }
      return direct;
    }
    // Direct path failed. Do NOT fall through to the brain. It runs an agentic tool loop that
    // corrupts structured prompts — observed under rate limiting: a 429 on the direct path
    // fell back to the brain, which answered a report-outline request with a `research_v2`
    // tool dump. Falling back to a path known to produce garbage turns a recoverable
    // rate-limit into unusable output AND buries the real cause. Fail honestly instead: the
    // 429 is already in modelErrors, and every caller has a degrade path.
    return { response: "" };
  }
  let r;
  try { r = await callGemini(opts); }
  catch (e) { noteModelError(bump, where, e); return { response: "" }; }
  const text = String((r && r.response) || "");
  if (!text.trim()) { noteModelError(bump, where, "empty response from model"); return r || { response: "" }; }
  if (process.env.HELIX_DEBUG_RAW) {
    try { require("fs").appendFileSync("helix-raw.log", `\n===== ${where} =====\n${text.slice(0, 1200)}\n`); } catch {}
  }
  const provErr = providerErrorIn(text);
  // Blank it out: passing a billing message downstream would get it parsed as evidence,
  // graded, and written into a report as if it were a finding.
  if (provErr) { noteModelError(bump, where, `provider error: ${provErr}`); return { ...r, response: "", providerError: provErr }; }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
//  W1 — EVIDENCE QUALITY (CRAG-style, arXiv 2401.15884)
//  Before this, retrieval fed everything into the evidence set: prior-conversation
//  chatter ("hi" → "Good morning, sir") and the brain's own refusals ("I have not
//  verified that, sir") scored 0.64 — as high as a real source — and eight web
//  results repeating one sentence counted as eight pieces of evidence.
//  Three defenses, cheapest first: hard filter → content dedupe → LLM grader.
// ═══════════════════════════════════════════════════════════════════════════

// (1) Hard pre-filter — zero LLM cost. These are never evidence, in any context.
const JUNK_PATTERNS = [
  /^\s*(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|test)\s*[.!?]*\s*$/i,
  /i have not verified/i,
  /i cannot verify|i can't verify|i'm not able to verify/i,
  /i have not executed a tool/i,
  /no response|not available yet|i will not guess/i,
  /^good (morning|afternoon|evening), (sir|dev)/i,
  /how can i assist you/i,
  /available relevant tools:/i,
];
function isJunkEvidence(card) {
  const text = `${card?.title || ""} ${card?.excerpt || ""}`.trim();
  if (text.length < 25) return true;                       // too thin to support anything
  return JUNK_PATTERNS.some((re) => re.test(text));
}

// (2) Content dedupe — the "8 sources, one sentence" problem. Grounded calls often return
// the SAME synthesized passage attributed to several URLs. Keep one card, record the rest
// as corroboration (which is real signal: N independent outlets carrying it).
function normalizeForHash(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
function dedupeByContent(cards) {
  const byHash = new Map();
  for (const c of cards) {
    const h = normalizeForHash(c.excerpt);
    if (!h) { byHash.set(Symbol("empty"), c); continue; }
    const prev = byHash.get(h);
    if (!prev) { byHash.set(h, { ...c, corroborations: [] }); continue; }
    // Prefer a web card (has a real URL) over an internal one as the representative.
    const keepNew = prev.refKind !== "web" && c.refKind === "web";
    const rep = keepNew ? { ...c, corroborations: prev.corroborations || [] } : prev;
    const other = keepNew ? prev : c;
    rep.corroborations = [...(rep.corroborations || []), { title: other.title, source: other.source }].slice(0, 8);
    byHash.set(h, rep);
  }
  return [...byHash.values()];
}

// (3) CRAG evaluator — one batched call grades every card correct/ambiguous/incorrect
// against the question. Batching keeps this ~1 call instead of N, so it costs seconds.
// Chunked so the grader's JSON can always complete. Grading 50 items in one call made the
// model truncate its array, so most cards silently fell back to "ambiguous" — the same
// output-cap failure that once produced the bogus "Insufficient evidence". Chunks of 15 run
// in parallel: bounded output per call, still ~one round-trip of wall clock.
const GRADE_CHUNK = 15;
async function gradeCards({ cards, question, callGemini, gateway, bump }) {
  if (!cards.length) return cards;
  const chunks = [];
  for (let i = 0; i < cards.length; i += GRADE_CHUNK) chunks.push({ offset: i, items: cards.slice(i, i + GRADE_CHUNK) });

  const graded = await Promise.all(chunks.map(async ({ offset, items }) => {
    const list = items.map((c, i) =>
      `[${i + 1}] ${String(c.title || "").slice(0, 80)} :: ${String(c.excerpt || "").slice(0, 180)}`).join("\n");
    // ULTRA-COMPACT OUTPUT: one letter per item, in order — "ccaicc…".
    // A JSON array of {i,g} objects truncates at the model's output cap, and a truncated
    // array parses to NOTHING, silently defaulting every card to "ambiguous" (observed:
    // 65/65 ambiguous). ~15 characters cannot truncate.
    const p = `You are a retrieval evaluator. Judge each numbered item as evidence for the question.\n`
      + `c = correct (directly relevant, informative)\n`
      + `a = ambiguous (related but weak or tangential)\n`
      + `i = incorrect (irrelevant, chat filler, an assistant refusal, or no factual content)\n`
      + `Be decisive — prefer c or i over a.\n\n`
      + `Question: "${question}"\n\nItems:\n${list}\n\n`
      + `Reply with EXACTLY ${items.length} letters, one per item in order, no spaces, no other text. Example: ${"c".repeat(Math.min(items.length, 5))}`;
    const r = await askModel(callGemini, bump, "grader", {
      prompt: p, mode: "chat", strength: "cost-guarded",
      sessionId: `helix-grade-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: "helix-pipeline", source: "helix-pipeline", history: [],
    });
    bump(gateway.estimateTokens(p), gateway.estimateTokens(r.response));
    // Take the longest run of grade letters in the reply (robust to any preamble).
    const letters = (String(r.response || "").match(/[cai]{2,}/gi) || []).sort((a, b) => b.length - a.length)[0] || "";
    const MAP = { c: "correct", a: "ambiguous", i: "incorrect" };
    return items.map((c, idx) => ({
      ...c,
      grade: MAP[(letters[idx] || "").toLowerCase()] || "ambiguous",
      _gi: offset + idx,
    }));
  }));
  return graded.flat().sort((a, b) => a._gi - b._gi).map(({ _gi, ...c }) => c);
}

/** Full evidence-quality pass. Returns { cards, stats } — stats feed the run trace so the
 *  UI can show honestly how much was filtered and why. Grading failure degrades to
 *  keep-everything rather than silently emptying the evidence set. */
async function refineEvidence({ cards, question, callGemini, gateway, bump }) {
  const stats = { input: cards.length, junk: 0, duplicates: 0, incorrect: 0, kept: 0, ambiguous: 0 };
  const notJunk = cards.filter((c) => !isJunkEvidence(c));
  stats.junk = cards.length - notJunk.length;
  const deduped = dedupeByContent(notJunk);
  stats.duplicates = notJunk.length - deduped.length;
  let graded;
  try { graded = await gradeCards({ cards: deduped, question, callGemini, gateway, bump }); }
  catch { graded = deduped.map((c) => ({ ...c, grade: "ambiguous" })); }
  let kept = graded.filter((c) => c.grade !== "incorrect");
  stats.incorrect = graded.length - kept.length;
  // Adaptive strictness — but the bar was far too low. At `strong >= 8` a 56-card gather
  // collapsed to 11 kept, and the report writer then had almost nothing to work from
  // (~350 words off 29 sources). `incorrect` is the junk grade; `ambiguous` still carries
  // real, citable content. Only discard ambiguous when strong evidence is genuinely
  // abundant, and always rank strong first so sections cite the best material.
  const strong = kept.filter((c) => c.grade === "correct");
  if (strong.length >= 24) { stats.droppedAmbiguous = kept.length - strong.length; kept = strong; }
  else kept = [...strong, ...kept.filter((c) => c.grade !== "correct")];
  stats.strong = strong.length;
  stats.ambiguous = kept.filter((c) => c.grade === "ambiguous").length;
  stats.kept = kept.length;
  // Never let filtering wipe the evidence set out entirely — if grading was overzealous,
  // fall back to the deduped set so the run still has something honest to work with.
  if (!kept.length && deduped.length) return { cards: deduped.map((c) => ({ ...c, grade: "ambiguous" })), stats: { ...stats, kept: deduped.length, incorrect: 0, note: "grader rejected all; kept deduped set" } };
  return { cards: kept, stats };
}

// ═══════════════════════════════════════════════════════════════════════════
//  W2 — RESEARCH DEPTH: diversity planning · atomic claims · gap loop
// ═══════════════════════════════════════════════════════════════════════════

// (1) Diversity-constrained planner. The old prompt ("decompose into 3-5 sub-questions")
// produced four rephrasings of one question — hence 8 sources all answering the same thing.
// This forces each sub-question at a DIFFERENT document class and mandates an adversarial
// angle, which is how a real analyst gets non-overlapping coverage.
const PLAN_EXEMPLAR =
  `Example of GOOD decomposition (note: each targets a different document class, and one is adversarial):\n` +
  `Q: "the new SpaceX IPO"\n` +
  `1. IPO event — offer price, size, first-day move  [news wires]\n` +
  `2. Performance since listing + near-term catalysts (lock-up, first earnings)  [market data / analyst notes]\n` +
  `3. Revenue, margins, cash flow, valuation multiple  [S-1 / filings]\n` +
  `4. Starlink unit economics — subscribers, ARPU  [sector research]\n` +
  `5. Starship program status and execution risk  [program milestones]\n` +
  `6. Bear case: overvaluation, governance, competition  [adversarial / skeptical commentary]`;

async function planResearch({ question, callGemini, gateway, bump, target = 6, intentHint = "" }) {
  const p = `Decompose this research question into ${Math.max(2, target - 1)}-${target} sub-questions for a thorough report.\n\n`
    + `HARD RULES:\n`
    + `- Each sub-question must seek a DIFFERENT KIND of information from a DIFFERENT source type. Never rephrase the same question.\n`
    + `- Cover the subject's real dimensions (what happened / how it works / the numbers / the mechanism / what could go wrong / what's next) as appropriate to the topic.\n`
    + `- EXACTLY ONE sub-question must be adversarial: actively seek disconfirming evidence, criticism, failure modes, or the counter-case.\n`
    + `- Each must be independently answerable by a web search.\n\n`
    + (intentHint ? `${intentHint}\n\n` : "")
    + `${PLAN_EXEMPLAR}\n\n`
    + `Question: "${question}"\n\n`
    + `OUTPUT FORMAT — one sub-question per line, exactly:\n`
    + `sourceType|the sub-question|A or -\n`
    + `("A" marks the single adversarial one.) No numbering, no JSON, no other text.`;

  // NOT JSON. A 5-7 element JSON array is long enough to hit the model's output cap; when it
  // truncated, parse returned [] and we silently fell back to ONE sub-question — collapsing
  // research breadth ~6x while every phase still reported success. One line per item cannot
  // truncate to nothing: a cut-off response still yields the lines that did arrive.
  const parsePlan = (text) => {
    const out = [];
    for (const line of String(text || "").split("\n")) {
      const parts = line.split("|").map((x) => x.trim());
      if (parts.length < 2) continue;
      const q = parts[1].replace(/^\d+[.)]\s*/, "");
      if (q.length < 12 || !/[a-z]/i.test(q)) continue;                // headers / separators
      out.push({ q: q.slice(0, 220), sourceType: parts[0].slice(0, 40), adversarial: /^a/i.test(parts[2] || "") });
      if (out.length >= 7) break;
    }
    if (out.length) return out;
    const j = parseJsonLoose(text, {});                                 // tolerate JSON anyway
    return (Array.isArray(j.subquestions) ? j.subquestions : [])
      .map((s) => (typeof s === "string" ? { q: s, sourceType: "", adversarial: false } : s))
      .filter((s) => s && s.q).slice(0, 7);
  };

  let out = [];
  for (let attempt = 0; attempt < 2 && out.length < 3; attempt++) {
    const prompt = attempt === 0 ? p
      : `${p}\n\nYour previous reply was unusable. Output ONLY the pipe-delimited lines, one per sub-question.`;
    const r = await askModel(callGemini, bump, "plan", { prompt, mode: "chat", sessionId: `helix-plan-${Math.random().toString(36).slice(2, 8)}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] });
    bump(gateway.estimateTokens(prompt), gateway.estimateTokens(r.response));
    const got = parsePlan(r.response);
    if (got.length > out.length) out = got;
  }
  if (!out.length) return [{ q: question, sourceType: "", adversarial: false, planDegraded: true }];
  if (out.length > 1 && !out.some((s) => s.adversarial)) out[out.length - 1].adversarial = true;
  return out;
}

// (2) Atomic-claim extraction (FActScore/SAFE-style, done deterministically = free).
// A grounded call returns ONE synthesized passage containing many distinct facts, plus N
// source URLs. Previously we stored that whole passage as the excerpt for every source —
// so 8 "sources" carried 1 identical blob. Splitting the passage into atomic claims turns
// one call into many genuine evidence items, each independently checkable and citable.
function splitIntoClaims(text) {
  const raw = String(text || "").replace(/\r/g, "");
  if (!raw.trim()) return [];
  const out = [];
  // Markdown bullets are the dominant shape of these responses ("* **IPO Completion:** …").
  const bullets = raw.split(/\n\s*(?:[-*•]|\d+\.)\s+/).slice(1);
  const pool = bullets.length >= 2 ? bullets : raw.split(/(?<=[.!?])\s+(?=[A-Z*])/);
  for (let s of pool) {
    s = s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    if (s.length < 40) continue;                       // fragments aren't claims
    if (/^(sir|here are|the following|below)/i.test(s) && s.length < 80) continue;  // preamble
    out.push(s.slice(0, 300));
    if (out.length >= 8) break;                        // cap per call
  }
  return out;
}

// (3) Coverage assessor — the gap-analysis step that turns one-shot research into a loop.
// Asks, per sub-question, whether the evidence actually answers it, and what to search next.
async function assessCoverage({ question, subquestions, cards, callGemini, gateway, bump }) {
  const ev = cards.map((c, i) => `[E${i + 1}] ${String(c.excerpt || c.title || "").slice(0, 160)}`).join("\n").slice(0, 5000) || "(none)";
  const sqs = subquestions.map((s, i) => `${i + 1}. ${s.q || s}`).join("\n");
  const p = `Assess research coverage. For each sub-question, is it ADEQUATELY answered by the evidence?\n\n`
    + `Overall question: "${question}"\n\nSub-questions:\n${sqs}\n\nEvidence:\n${ev}\n\n`
    + `For anything not adequately covered, write a NEW, MORE SPECIFIC web search query that would close the gap `
    + `(do not repeat the original sub-question wording).\n\n`
    + `OUTPUT FORMAT — one line per gap, exactly:\n`
    + `GAP|what is still unknown|the specific search query\n`
    + `If every sub-question is adequately covered, reply with the single word ADEQUATE. No JSON.`;
  // W7: coverage is a TRIAGE decision ("is anything missing, and what should we search?"),
  // not a reasoning task — but on the main model one call cost 12.5 s of a 130 s run, because
  // per-call latency there is ~10-12 s regardless of the work. Try the cheap router first; it
  // was only moved off the cheap tier when the output was JSON, and the format is now
  // line-based. If the cheap reply is unusable, redo it on the main model — correctness is
  // still non-negotiable, we just stop paying for it on every run.
  const ask = (strength) => askModel(callGemini, bump, "coverage", {
    prompt: p, mode: "chat", ...(strength ? { strength } : {}),
    sessionId: `helix-cov-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: "helix-pipeline", source: "helix-pipeline", history: [],
  });
  const usable = (t) => /gap\s*\|/i.test(t) || /adequat|fully covered|no gaps/i.test(t);
  let r = await ask("cost-guarded");
  if (!usable(String(r.response || ""))) r = await ask(null);
  bump(gateway.estimateTokens(p), gateway.estimateTokens(r.response), "gemini-3.1-flash-lite");

  // Line output for the same reason as the planner — but the failure mode here was worse:
  // truncated JSON parsed to the `{adequate:true}` default, so a *parse failure* was
  // indistinguishable from "research is complete" and the gap loop never ran a second round.
  const text = String(r.response || "");
  const gaps = [];
  for (const line of text.split("\n")) {
    const parts = line.split("|").map((x) => x.trim());
    if (parts.length < 3 || !/gap/i.test(parts[0])) continue;
    if (parts[2].length < 8) continue;
    gaps.push({ missing: parts[1].slice(0, 200), query: parts[2].slice(0, 200) });
    if (gaps.length >= 5) break;
  }
  if (gaps.length) return { adequate: false, gaps: gaps.slice(0, 3) };   // each gap = one billable search
  // Matches "ADEQUATE", but also the prose all-clear the model actually tends to write
  // ("all sub-questions are adequately covered") — `\bADEQUATE\b` missed "adequately" and
  // every clean run was being logged as unparsed.
  if (/adequat|fully covered|no gaps|all .{0,24}covered/i.test(text)) return { adequate: true, gaps: [] };
  const j = parseJsonLoose(text, {});                                   // tolerate JSON anyway
  const jg = (Array.isArray(j.gaps) ? j.gaps : []).filter((g) => g && g.query).slice(0, 5);
  if (jg.length) return { adequate: false, gaps: jg };
  // Neither gaps nor an explicit all-clear: unparseable. Say so rather than claiming adequacy.
  return { adequate: true, gaps: [], unparsed: !!text.trim() };
}

// ═══════════════════════════════════════════════════════════════════════════
//  W3/W4 — STRUCTURED REPORTS: architect designs the shape, sections written in parallel
//  Replaces `{answer: "<one capped paragraph>"}`. The old contract was the ceiling on the
//  whole product: a recipe, a comparison and an investment thesis all came out as the same
//  flat blob, and one over-long JSON blew the output cap and produced a false
//  "Insufficient evidence". Small per-section calls cannot truncate, and run in parallel so
//  a LONGER report costs no extra wall clock.
// ═══════════════════════════════════════════════════════════════════════════

const SECTION_TYPES = ["summary", "prose", "table", "ranked", "steps", "comparison", "risks", "nextSteps", "futureScope", "openQuestions"];

/** Planner B — designs the report outline AFTER seeing the evidence, so structure is derived
 *  from what was actually found (recipe → Ingredients/Steps; comparison → matrix). */
async function designReport({ question, cards, callGemini, gateway, bump, intentHint = "", sectionBudget = "6-8" }) {
  const digest = cards.map((c, i) => `[E${i + 1}] ${String(c.excerpt || c.title || "").slice(0, 130)}`).join("\n").slice(0, 7000);
  // LINE-BASED OUTPUT, not JSON. A JSON outline with per-section `brief` text overflows the
  // model's output cap and truncates → parses to nothing → we silently fall back to a generic
  // 2-section structure (observed). One short line per section cannot truncate.
  const p = `You are a report architect. Design the STRUCTURE of a report answering the question, based on the evidence actually gathered.\n\n`
    + `Choose sections that fit THIS subject — never a generic template. Examples:\n`
    + `- recipe → Ingredients (ranked), Steps (steps), Tips (ranked)\n`
    + `- investment → What happened (prose), Key figures (table), Bull vs bear (prose), Risks (risks)\n`
    + `- comparison → Criteria matrix (comparison), per-option prose, Recommendation (prose)\n`
    + `- how-to → Overview (prose), Steps (steps), Pitfalls (risks)\n\n`
    + `Section types allowed: ${SECTION_TYPES.join(", ")}\n`
    + `Rules: ${sectionBudget} sections — this is a THOROUGH report, so cover every distinct dimension the `
    + `evidence supports rather than collapsing them into one. First is always a summary.\n`
    + `MIX IS MANDATORY: at least 3 "prose" sections (that is where the explanation and reasoning `
    + `lives), and AT MOST 2 "table" sections. A report made mostly of tables is a fact sheet, not `
    + `a report — use a table only for a genuine set of comparable figures, and explain those `
    + `figures in prose elsewhere. Use "steps" for procedures. Finish with risks/openQuestions when warranted. `
    + `Mark inference=y for sections that draw conclusions rather than report sourced fact.\n\n`
    // The intent is a BIAS, not a template — the outline must still follow the evidence.
    + (intentHint ? `${intentHint}\nTreat this as a preference, not a requirement: if the evidence does not support that shape, design what the evidence does support.\n\n` : "")
    + `Question: "${question}"\n\nEvidence:\n${digest}\n\n`
    + `Reply with ONE LINE PER SECTION, pipe-delimited, no other text:\n`
    + `type|Heading|evidence numbers comma-separated|inference y or n\n`
    + `Example:\nsummary|Bottom line|1,2,3|n\ntable|Key figures|4,5,6|n\nrisks|Key risks|7,8|y`;
  // The model doesn't always honour the pipe format (observed: works one run, returns prose
  // or JSON the next). Parse tolerantly across all three shapes, then retry once before
  // falling back — an architect that silently degrades makes the whole report generic.
  const parseOutline = (text) => {
    const secs = [];
    // (a) pipe lines: `type|Heading|1,2,3|n`
    for (const line of String(text || "").split("\n")) {
      const parts = line.split("|").map((x) => x.trim());
      if (parts.length < 2) continue;
      const match = SECTION_TYPES.find((t) => t.toLowerCase() === parts[0].replace(/[^a-zA-Z]/g, "").toLowerCase());
      if (!match) continue;
      secs.push({ type: match, heading: parts[1].slice(0, 60) || match, brief: parts[1].slice(0, 60),
        evidence: (parts[2] || "").split(/[,\s]+/).map((n) => parseInt(n, 10)).filter((n) => n > 0),
        inference: /^y/i.test(parts[3] || "") });
      if (secs.length >= 8) break;
    }
    if (secs.length) return secs;
    // (b) JSON, if it decided to return that instead
    const j = parseJsonLoose(text, {});
    if (Array.isArray(j.sections)) {
      for (const s of j.sections) {
        const match = SECTION_TYPES.find((t) => t.toLowerCase() === String(s?.type || "").toLowerCase());
        if (!match) continue;
        secs.push({ type: match, heading: String(s.heading || match).slice(0, 60), brief: String(s.heading || "").slice(0, 60),
          evidence: Array.isArray(s.evidence) ? s.evidence.map(Number).filter(Boolean) : [],
          inference: s.inference === true || /^y/i.test(String(s.inference || "")) });
        if (secs.length >= 8) break;
      }
      if (secs.length) return secs;
    }
    // (c) loose lines: `summary: Bottom line` / `- table — Key figures`
    for (const line of String(text || "").split("\n")) {
      const m = line.match(/^[\s\-*\d.]*([a-zA-Z]+)\s*[:—-]\s*(.+)$/);
      if (!m) continue;
      const match = SECTION_TYPES.find((t) => t.toLowerCase() === m[1].toLowerCase());
      if (!match) continue;
      secs.push({ type: match, heading: m[2].trim().slice(0, 60), brief: m[2].trim().slice(0, 60), evidence: [], inference: false });
      if (secs.length >= 8) break;
    }
    return secs;
  };

  let sections = [];
  for (let attempt = 0; attempt < 2 && !sections.length; attempt++) {
    const prompt = attempt === 0 ? p
      : `${p}\n\nYour previous reply was not in the required format. Reply with ONLY the pipe-delimited lines, nothing else.`;
    const r = await askModel(callGemini, bump, "architect", { prompt, mode: "chat", sessionId: `helix-arch-${Math.random().toString(36).slice(2, 8)}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] });
    bump(gateway.estimateTokens(prompt), gateway.estimateTokens(r.response));
    sections = parseOutline(r.response);
  }
  return { title: question.slice(0, 90), sections };
}

/** Write one section from ONLY its assigned evidence. Small prompt, small output → cannot
 *  hit the output cap. Every type has a deterministic fallback so a section is never blank. */
async function writeSection({ section, cards, question, callGemini, gateway, bump }) {
  // The architect typically assigns only 2-4 evidence ids per section. Combined with the
  // (correct, non-negotiable) "use ONLY this evidence, never invent" rule, that capped prose
  // sections at ~25 words no matter how many words we asked for — the writer was starved, not
  // lazy. Assigned ids lead (they're the best match); the rest of the evidence set tops the
  // section up so there is genuinely enough sourced material to write depth from.
  const MIN_EVIDENCE = 12, MAX_EVIDENCE = 18;
  const assigned = (Array.isArray(section.evidence) ? section.evidence : []).filter((n) => n >= 1 && n <= cards.length);
  const ids = [...new Set(assigned)];
  for (let n = 1; n <= cards.length && ids.length < MIN_EVIDENCE; n++) if (!ids.includes(n)) ids.push(n);
  ids.splice(MAX_EVIDENCE);
  const ev = ids.map((n) => { const c = cards[n - 1]; return c ? `[E${n}] ${String(c.excerpt || c.title || "").slice(0, 320)}` : null; })
    .filter(Boolean).join("\n").slice(0, 9000) || "(no evidence assigned)";
  const common = `Question: "${question}"\nSection: "${section.heading || section.type}" — ${section.brief || ""}\n\nEvidence:\n${ev}\n\n`
    + `Use ONLY this evidence. Cite as [E#] inline. Never invent facts.\n`
    // The brain's assistant persona ("Sir, based on the provided research data, here are…")
    // leaks into report sections and reads as chat, not a document. Suppress it at the source.
    + `Write as a REPORT SECTION: no salutations, no "Sir", no "here are", no meta-commentary `
    + `about the evidence or the request. Start directly with the substance.`;
  // NO JSON anywhere in the report path. Every remaining unevenness traced back to the JSON
  // wrapper: a 200-word paragraph inside a `{"text":"…"}` string, or a 6-element `items` array,
  // reliably hit the output cap — producing 15-word sections next to 195-word ones, and a
  // `risks` list with 1 item where 6 were asked for. Plain text and one-item-per-line degrade
  // gracefully: a truncated reply still yields every line that arrived.
  let ask;
  switch (section.type) {
    case "table":
      ask = `${common}\nBuild a table of the concrete values — include every distinct figure the evidence supports.\n`
        + `OUTPUT: first line = column headers separated by " | " (2-5 columns). Each following line = one row, same separator. 4-10 rows. No JSON, no markdown pipes-and-dashes rule line, no other text.`; break;
    case "steps":
      ask = `${common}\nGive the ordered steps (4-8 of them).\n`
        + `OUTPUT: one step per line, exactly: step name :: one full sentence explaining how and why. No numbering, no JSON.`; break;
    case "ranked": case "risks": case "nextSteps": case "futureScope": case "openQuestions":
      ask = `${common}\nGive 4-6 items, most important first.\n`
        + `OUTPUT: one item per line, exactly: short label :: 1-2 full sentences of specifics with figures. A bare label with no detail is not acceptable. No numbering, no JSON.`; break;
    case "comparison":
      ask = `${common}\nBuild a comparison matrix.\n`
        + `OUTPUT: first line = "Criteria | Option A | Option B | …". Each following line = one criterion row, same separator. No JSON.`; break;
    case "summary":
      ask = `${common}\nWrite 110-160 words: the bottom line, carrying the three most important specific figures.\n`
        + `OUTPUT: plain prose only. No heading, no bullet points, no JSON, no quotes around it.`; break;
    default:
      // Prose was asking for 80-160 words, which capped a 33-source report at ~350 words total.
      // Depth is the whole point of the rebuild — ask for it, and remove the wrapper that
      // was truncating it.
      ask = `${common}\nWrite 200-280 words of substantive prose in 2-3 paragraphs. Pack in the specific numbers, `
        + `names, dates and mechanisms from the evidence — a reader should learn things they could not get from `
        + `a headline. Do not hedge or pad; every sentence must carry information.\n`
        + `OUTPUT: plain prose only. No heading, no bullet points, no JSON, no quotes around it.`;
  }
  const r = await askModel(callGemini, bump, `section:${section.type}`, { prompt: ask, mode: "chat", sessionId: `helix-sec-${Math.random().toString(36).slice(2, 8)}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] });
  bump(gateway.estimateTokens(ask), gateway.estimateTokens(r.response));
  const raw = String(r.response || "").trim();
  const j = parseJsonLoose(raw, {});
  const base = { type: section.type, heading: section.heading, citations: ids, inference: !!section.inference };
  // LaTeX de-mathification. The model emits inline TeX for anything chemical or formulaic
  // ($CH_4$, $LOX$, $N \times 5.7$). Nothing in this pipeline renders TeX, so it reaches the
  // reader as literal dollar signs and backslashes — exactly the "weird symbols" that made
  // earlier output look broken. Convert the handful of constructs that actually show up.
  // DANGER, and the reason this is written so conservatively: a naive /\$([^$]+)\$/ unwrap
  // spans two currency amounts. "priced at $135 per share, raising $75 billion" became
  // "priced at 135 per share, raising 75 billion" — silently deleting the dollar signs from
  // every figure in a finance report. So: only unwrap a $…$ span that actually contains a TeX
  // marker (a backslash command, subscript or superscript), and never one that opens on a digit.
  // Decide by CONTENT, not by the first character. A leading-digit veto also blocked real
  // math ("$250 \leq W \leq 320$"), while a bare symbol span ("$LOX$") carries no TeX marker
  // at all. Two positive signals instead: a TeX command/sub/superscript, or a single short
  // word token. Neither can match a currency run like "$135 per share, raising $".
  const TEX_SPAN = /\$\$?([^$\n]{1,120}?)\$\$?/g;
  const hasTexMarker = (s) => /\\[a-zA-Z]|[_^]/.test(s) || /^[A-Za-z][A-Za-z0-9]{0,9}$/.test(s);
  const symbols = (s) => s
    .replace(/\^\{?\\circ\}?\s*/g, "°")                   // 20^{\circ}C → 20°C
    .replace(/\\(?:times|cdot)\b/g, "×")
    .replace(/\\(?:approx|sim)\b/g, "≈")
    .replace(/\\(?:leq|le)\b/g, "≤").replace(/\\(?:geq|ge)\b/g, "≥")
    .replace(/\\(?:pm)\b/g, "±").replace(/\\(?:degree|deg|circ)\b/g, "°")
    .replace(/\\(?:text|mathrm|mathit|mathbf)\{([^}]*)\}/g, "$1")
    .replace(/([A-Za-z0-9])_\{?(\d+)\}?/g, "$1$2")        // CH_4 → CH4
    .replace(/\\[a-zA-Z]+/g, "")                          // drop remaining commands
    .replace(/\{\s*\}/g, "");                             // and the braces they leave
  const deTex = (t) => symbols(String(t || "")
      .replace(TEX_SPAN, (m, inner) => (hasTexMarker(inner) ? inner : m)))
    .replace(/[ \t]{2,}/g, " ");

  // Belt-and-braces: strip any persona preamble that survives the instruction above.
  const clean = (t) => deTex(t)
    .replace(/^\s*(sir|dear (?:sir|user))\s*[,:—-]\s*/i, "")
    .replace(/^\s*(here (?:are|is)|based on (?:the )?(?:provided |available )?(?:research |evidence |data)[^,.:]*|regarding your (?:inquiry|question|request)[^,.:]*)\s*[,:—-]?\s*/i, "")
    .trim();

  // Pipe-separated rows, one per line. Skips markdown rule lines (`--- | ---`) and any
  // preamble line that doesn't actually contain a separator.
  const pipeRows = () => String(raw).split("\n")
    .map((l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").trim())
    .filter((l) => l.includes("|") && !/^[\s|:-]+$/.test(l))
    .map((l) => l.split("|").map((x) => clean(x).replace(/^\*+|\*+$/g, "").trim()))
    .filter((r) => r.length >= 2 && r.some(Boolean));

  if (section.type === "table") {
    const rows = pipeRows();
    if (rows.length >= 2) {
      const width = Math.max(...rows.map((r) => r.length));
      const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
      return { ...base, columns: norm[0], rows: norm.slice(1, 12) };
    }
    if (Array.isArray(j.columns) && Array.isArray(j.rows) && j.rows.length) {
      return { ...base, columns: j.columns.map(String), rows: j.rows.map((row) => (Array.isArray(row) ? row.map((x) => (x == null ? "" : String(x))) : [String(row)])) };
    }
  }
  if (section.type === "comparison") {
    const rows = pipeRows();
    if (rows.length >= 2) {
      const width = Math.max(...rows.map((r) => r.length));
      const norm = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
      return { ...base, options: norm[0].slice(1), criteria: norm.slice(1).map((r) => r[0]), matrix: norm.slice(1).map((r) => r.slice(1)) };
    }
    if (Array.isArray(j.options) && Array.isArray(j.matrix) && j.matrix.length) {
      return { ...base, options: j.options.map(String), criteria: (j.criteria || []).map(String), matrix: j.matrix.map((row) => (Array.isArray(row) ? row.map(String) : [String(row)])) };
    }
  }
  if (["steps", "ranked", "risks", "nextSteps", "futureScope", "openQuestions"].includes(section.type)) {
    // One item per line. Requiring a literal `::` was too brittle — the model freely
    // substitutes `—`, `-` or `:`, and demanding one exact token cost us 5 of 6 items. Accept
    // any label/detail separator, and fall back to treating a whole line as the item text.
    const lineItems = String(raw).split(/\n+/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/^\*{1,2}|\*{1,2}$/g, "").trim())
      .filter((l) => l.length >= 20 && !/^(?:here|the following|below|output)\b/i.test(l) && !/^#{1,6}\s/.test(l))
      .map((l) => {
        const m = l.match(/^(.{3,90}?)\s*(?:::|—|–|\s-\s|:)\s*(.{10,})$/s);
        return m ? { text: clean(m[1]).replace(/\*/g, "").trim(), detail: clean(m[2]) } : { text: clean(l) };
      })
      .filter((it) => it.text)
      .slice(0, 8);
    if (lineItems.length) return { ...base, items: lineItems };
    const items = (Array.isArray(j.items) ? j.items : [])
      .map((x) => (typeof x === "string" ? { text: x } : x)).filter((x) => x && x.text).slice(0, 8);
    if (items.length) return { ...base, items: items.map((it) => ({ ...it, text: clean(it.text) })) };
    // Fallback: recover list items from a non-JSON / truncated reply. Must strip JSON
    // scaffolding first — naively splitting left artifacts like `text : SpaceX listed…`.
    const lines = raw
      .replace(/```(?:json)?/gi, " ")
      .replace(/[{}\[\]"]/g, " ")
      .split(/\n|(?:^|\s)[-*•]\s|\d+\.\s/)
      .map((s) => s.replace(/^\s*(text|detail|items)\s*:\s*/i, "").replace(/,\s*$/, "").trim())
      .filter((s) => s.length > 25)
      .slice(0, 6);
    return { ...base, items: lines.map((text) => ({ text: clean(text) })), degraded: !lines.length };
  }
  // Prose now arrives as plain text; the JSON shapes stay supported for safety. Strip any
  // markdown heading the model prepended (the renderer supplies the heading) and stray
  // wrapping quotes.
  const text = ((j.text && String(j.text).trim())
    || raw.replace(/```(?:json)?/gi, "").replace(/^\s*\{[\s\S]*?"text"\s*:\s*"?/i, "").replace(/"\s*\}\s*$/, "").trim())
    .replace(/^\s*#{1,6}\s+.*\n+/, "")
    .replace(/^\s*\*{0,2}(?:section|heading)\s*:.*\n+/i, "")
    .replace(/^"(.*)"$/s, "$1")
    .trim();
  return { ...base, type: section.type === "summary" ? "summary" : "prose", text: clean(text).slice(0, 2000) };
}

/** What the FINISHED report does not establish.
 *
 *  Limitations used to be the coverage assessor's gaps, but that assessor judges evidence
 *  against sub-questions and runs BEFORE any section is written — so it flagged the bear
 *  case, the regulatory picture and the valuation comparison as unverified while the report
 *  carried a dedicated section on each. Claiming you failed to verify something you did
 *  verify is as dishonest as the reverse, so this reads the finished sections instead. */
async function assessLimitations({ question, sections, callGemini, gateway, bump }) {
  // Send the report's FULL content, untruncated. Two bugs came from not doing so:
  //   1. Passing only a table's column names made the assessor declare figures missing from a
  //      table that contained them ("does not provide the baker's percentages" — printed
  //      directly beneath a Baker's Percentages table).
  //   2. Slicing prose at 600 chars made it report the *report* as truncated ("cuts off
  //      before detailing…", "unestablished due to truncated text") when what was cut was my
  //      excerpt. It can only judge what it is shown, so show all of it.
  // A whole report is ~1,500 words (~10 KB) — comfortably within one prompt.
  const render = (s) => s.text ? s.text
    : s.rows ? [(s.columns || []).join(" | "), ...s.rows.map((r) => r.join(" | "))].join("\n")
    : s.items ? s.items.map((i) => `- ${i.text}${i.detail ? `: ${i.detail}` : ""}`).join("\n")
    : s.options ? [`options: ${(s.options || []).join(" | ")}`, ...(s.matrix || []).map((r, i) => `${s.criteria?.[i] ?? ""}: ${r.join(" | ")}`)].join("\n")
    : "";
  const body = sections.map((s) => `## ${s.heading || s.type}\n${render(s)}`).join("\n\n");

  const p = `Below is a finished research report. Identify what it genuinely does NOT establish.\n\n`
    + `Question: "${question}"\n\n${body}\n\n`
    + `RULES:\n`
    + `- BEFORE listing anything, scan every section above for it. If ANY section states it — `
    + `including inside a table row — it is NOT a limitation. Claiming the report omits something `
    + `it contains is a serious error.\n`
    + `- Do not list a topic merely because a section is brief. Only list what is genuinely absent.\n`
    + `- Prefer concrete missing specifics (an undisclosed figure, an unquantified effect, a date not `
    + `yet knowable) over vague topics.\n`
    + `- Fewer, correct limitations beat a full list. If the report is comprehensive, reply NONE.\n`
    + `- Never describe the report as truncated, cut off or incomplete. You are shown it in full; `
    + `judge only what a reader would find missing from the finished text.\n\n`
    + `OUTPUT: one limitation per line, each a complete sentence. No numbering, no JSON. Maximum 4 lines.`;
  // Deliberately on the main model, not the cheap one: this judgement decides what the report
  // confesses it could not do, and a lite model follows careful checking rules poorly.
  const r = await askModel(callGemini, bump, "limitations", {
    prompt: p, mode: "chat",
    sessionId: `helix-lim-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: "helix-pipeline", source: "helix-pipeline", history: [],
  });
  const text = String(r.response || "");
  if (/^\s*NONE\b/i.test(text.trim())) return [];
  return text.split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length > 25 && !/^(here|the following|limitations|output)\b/i.test(l))
    .slice(0, 4);
}

// ═══════════════════════════════════════════════════════════════════════════
//  W6 — VERIFICATION THAT ACTUALLY WORKS
//
//  What this replaces: five "red-team" roles that critiqued the evidence with NO new
//  information. "LLMs Cannot Self-Correct Reasoning Yet" (arXiv 2310.01798) is direct on
//  this — intrinsic self-critique without fresh evidence does not improve factuality. Those
//  five calls produced adjectives, never a caught error, and nothing downstream consumed
//  their verdicts.
//
//  What replaces it, in two stages so cost scales with RISK rather than with report size:
//    1. ISSUP scoring (Self-RAG, arXiv 2310.11511) — batched, cheap, covers every claim.
//       Each checkable claim is scored against the evidence it was written from.
//    2. CoVe (Chain-of-Verification) — only for claims stage 1 could not support. Each gets
//       an independent verification question answered against a FRESH grounded search, which
//       is the part that supplies new information and can actually overturn a claim.
// ═══════════════════════════════════════════════════════════════════════════

/** Pull the checkable factual claims out of a finished report. Deterministic = free.
 *  A claim worth verifying carries a number, a date, a proportion or a named entity. */
const CLAIM_BUDGET = 40;
function extractClaims(sections, budget = CLAIM_BUDGET) {
  // Collect per section first, then take round-robin. Filling a flat list in document order
  // and returning early at the cap meant the budget was always exhausted by the opening
  // sections — the risks and open-questions at the END of every report were never verified,
  // silently. Round-robin guarantees every section is represented before any is deepened.
  const perSection = sections.map((s, i) => {
    const texts = s.text ? s.text.split(/(?<=[.!?])\s+(?=[A-Z(])/)
      : s.items ? s.items.map((it) => `${it.text}${it.detail ? `: ${it.detail}` : ""}`)
      : s.rows ? s.rows.map((r) => r.join(" — "))
      : [];
    return texts
      .map((t) => String(t).replace(/\s+/g, " ").trim())
      // 30, not 40: "Revenue reached $18.67 billion in 2025." is 39 characters and is exactly
      // the kind of claim most worth verifying. The floor skips fragments, not facts.
      .filter((t) => t.length >= 30 && t.length <= 400)
      // Must assert something checkable, not merely narrate.
      .filter((t) => /\d/.test(t) || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(t))
      .map((text) => ({ section: i, heading: s.heading || s.type, text }));
  });

  const out = [];
  const total = perSection.reduce((a, l) => a + l.length, 0);
  for (let round = 0; out.length < budget; round++) {
    let added = false;
    for (const list of perSection) {
      if (round >= list.length) continue;
      out.push(list[round]);
      added = true;
      if (out.length >= budget) break;
    }
    if (!added) break;                                  // every section exhausted
  }
  out.totalAvailable = total;                           // so truncation can be reported, not hidden
  return out;
}

/** Stage 1 — Self-RAG ISSUP. One batched, one-letter-per-claim call (the only output shape
 *  in this file that has never truncated). s = supported, u = unsupported, c = contradicted. */
const ISSUP_CHUNK = 14;
async function scoreSupport({ claims, cards, callGemini, gateway, bump }) {
  if (!claims.length) return [];
  const ev = cards.map((c, i) => `[E${i + 1}] ${String(c.excerpt || c.title || "").slice(0, 200)}`).join("\n").slice(0, 12000);
  const chunks = [];
  for (let i = 0; i < claims.length; i += ISSUP_CHUNK) chunks.push({ offset: i, items: claims.slice(i, i + ISSUP_CHUNK) });

  const scored = await Promise.all(chunks.map(async ({ offset, items }) => {
    const list = items.map((c, i) => `[${i + 1}] ${c.text}`).join("\n");
    const p = `You verify claims against evidence. For each numbered claim decide:\n`
      + `s = SUPPORTED (the evidence states it, or states figures it follows directly from)\n`
      + `u = UNSUPPORTED (the evidence neither states nor implies it)\n`
      + `c = CONTRADICTED (the evidence states something incompatible with it)\n\n`
      + `Evidence:\n${ev}\n\nClaims:\n${list}\n\n`
      + `Reply with EXACTLY ${items.length} letters, one per claim in order, no spaces, no other text.`;
    const r = await askModel(callGemini, bump, "issup", {
      prompt: p, mode: "chat", strength: "cost-guarded",
      sessionId: `helix-issup-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: "helix-pipeline", source: "helix-pipeline", history: [],
    });
    const letters = (String(r.response || "").match(/[suc]{2,}/gi) || []).sort((a, b) => b.length - a.length)[0] || "";
    const MAP = { s: "supported", u: "unsupported", c: "contradicted" };
    return items.map((c, i) => ({ ...c, verdict: MAP[(letters[i] || "").toLowerCase()] || "unscored", _i: offset + i }));
  }));
  return scored.flat().sort((a, b) => a._i - b._i).map(({ _i, ...c }) => c);
}

/** Stage 2 — CoVe. For each claim stage 1 could not support, ask an independent verification
 *  question against a FRESH grounded search. This is the step that brings in new information,
 *  which is precisely what the old red-team lacked. Capped and run in parallel. */
// Each CoVe check is a billable grounded search (~$0.035). Six of them cost more than the
// entire rest of a run. Every real catch so far came from the first few flagged claims, so
// the tail was paying full price for negligible yield.
const COVE_MAX = Number(process.env.HELIX_COVE_MAX || 3);
async function verifyClaims({ claims, callGemini, gateway, bump }) {
  const targets = claims.filter((c) => c.verdict === "unsupported" || c.verdict === "contradicted").slice(0, COVE_MAX);
  if (!targets.length) return [];
  return Promise.all(targets.map(async (c) => {
    const p = `Verify this single factual claim against current sources. Search for it.\n\n`
      + `CLAIM: "${c.text}"\n\n`
      + `Decide one verdict:\n`
      + `CONFIRMED — sources state this.\n`
      + `REFUTED — sources state something incompatible.\n`
      + `UNVERIFIABLE — no source establishes it either way.\n\n`
      + `OUTPUT exactly two lines:\nVERDICT: <one word>\nNOTE: <one sentence with the specific figure or fact found>`;
    const r = await askModel(callGemini, bump, "cove", {
      prompt: p, mode: "chat", strength: "balanced", deepResearch: true,
      sessionId: `helix-cove-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: "helix-pipeline", source: "helix-pipeline", history: [],
    });
    // CoVe searches too, so every check is a billable grounding request. It was never
    // metered at all — up to 6 free-looking searches per run.
    bump(gateway.estimateTokens(p), gateway.estimateTokens(r.response), "gemini-3.5-flash", { grounded: !r.fromCache });
    const text = String(r.response || "");
    const v = (text.match(/VERDICT:\s*(\w+)/i) || [])[1] || "";
    const note = (text.match(/NOTE:\s*([\s\S]{0,300})/i) || [])[1] || "";
    const verdict = /confirm/i.test(v) ? "confirmed" : /refut/i.test(v) ? "refuted"
      : /unverif/i.test(v) ? "unverifiable" : "unverifiable";
    return { ...c, cove: verdict, note: note.replace(/\s+/g, " ").trim().slice(0, 260) };
  }));
}

/** Cross-source contradiction detection. Deterministic and free: find claims that quote a
 *  DIFFERENT figure for the same metric. Catches the "two outlets, two numbers" case that a
 *  single-source read silently averages away. */
function findContradictions(cards, opts = {}) {
  const byMetric = new Map();
  for (const c of cards) {
    const text = String(c.excerpt || "");
    // A metric mention: a number (with optional unit/scale) plus the words around it.
    const m = text.match(/([\d][\d,.]*)\s*(%|percent|billion|million|trillion|bn|m\b|k\b)?/i);
    if (!m) continue;
    const key = text.toLowerCase()
      .replace(/[\d][\d,.]*\s*(%|percent|billion|million|trillion|bn|m\b|k\b)?/gi, "#")
      .replace(/[^a-z# ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
    if (key.length < 25) continue;
    const value = `${m[1]}${m[2] ? " " + m[2].toLowerCase() : ""}`;
    if (!byMetric.has(key)) byMetric.set(key, []);
    byMetric.get(key).push({ value, title: c.title, excerpt: text.slice(0, 180), recalled: !!c.recalled, at: c.createdAt || null });
  }
  const out = [];
  for (const [key, hits] of byMetric) {
    const distinct = [...new Set(hits.map((h) => h.value))];
    if (distinct.length < 2) continue;
    // W10 CROSS-RUN ALERT: a disagreement between something recalled from a previous run and
    // something found today is materially different from two of today's sources differing —
    // it means a fact you already accepted has since changed, or was wrong. Flag it as such.
    const old = hits.filter((h) => h.recalled), fresh = hits.filter((h) => !h.recalled);
    const crossRun = old.length > 0 && fresh.length > 0
      && new Set(old.map((h) => h.value)).size > 0
      && !old.every((o) => fresh.some((f) => f.value === o.value));
    out.push({
      topic: key,
      values: distinct.slice(0, 4),
      sources: [...new Set(hits.map((h) => h.title))].slice(0, 4),
      sample: hits[0].excerpt,
      ...(crossRun ? {
        crossRun: true,
        previously: [...new Set(old.map((h) => h.value))].slice(0, 2),
        now: [...new Set(fresh.map((h) => h.value))].slice(0, 2),
        previouslyAt: old.map((h) => h.at).filter(Boolean).sort()[0] || null,
      } : {}),
    });
    if (out.length >= 8) break;
  }
  // Cross-run conflicts first — they are the ones that need a decision.
  return out.sort((a, b) => (b.crossRun ? 1 : 0) - (a.crossRun ? 1 : 0));
}

/** Orchestrate: architect → parallel section writes → assemble the HelixReport. */
async function buildReport({ question, cards, coverage, callGemini, gateway, bump, meta, intentHint, sectionBudget }) {
  const outline = await designReport({ question, cards, callGemini, gateway, bump, intentHint, sectionBudget });
  let sections = outline.sections;
  let degraded;
  if (!sections.length) {
    // Architect failed → still produce a readable report, and SAY that we degraded.
    degraded = "architect returned no outline; used a default structure";
    sections = [
      { type: "summary", heading: "Summary", brief: "the direct answer", evidence: cards.map((_, i) => i + 1).slice(0, 10) },
      { type: "ranked", heading: "Key findings", brief: "the most important specific facts", evidence: cards.map((_, i) => i + 1).slice(0, 14) },
    ];
  }
  const written = await Promise.all(sections.map((s) =>
    writeSection({ section: s, cards, question, callGemini, gateway, bump })
      .catch(() => ({ type: "prose", heading: s.heading, text: "", degraded: true }))));
  const usable = written.filter((s) => (s.text && s.text.length > 20) || (s.items && s.items.length) || (s.rows && s.rows.length) || (s.matrix && s.matrix.length));

  const sources = cards.map((c, i) => ({
    n: i + 1, title: String(c.title || "source").slice(0, 120),
    url: c.source, corroborations: (c.corroborations || []).length,
  }));
  // The TL;DR slot IS the executive summary — rendering both duplicated the identical
  // paragraph at the top of every report. Promote the summary section into `tldr` and drop
  // it from `sections` so it appears exactly once.
  const summarySection = usable.find((s) => s.type === "summary" && s.text);
  const tldr = summarySection?.text
    || (usable.find((s) => s.type === "prose")?.text || "").slice(0, 400)
    || "See sections below.";
  const body = summarySection ? usable.filter((s) => s !== summarySection) : usable;

  // W7: `limitations` is NOT computed here any more. It only needs the finished sections —
  // exactly like verification does — so the caller runs both concurrently instead of paying
  // for two sequential main-model calls (~10 s each) back to back.
  return {
    title: outline.title || question.slice(0, 90),
    tldr,
    sections: body,
    sources,
    limitations: [],                                   // filled by the caller, concurrently
    meta: { ...(meta || {}), evidenceCount: cards.length, generatedAt: new Date().toISOString(), ...(degraded ? { degraded } : {}) },
  };
}

/** Flatten a report to plain text — keeps the legacy `answer` field working for the existing
 *  UI, the Evidence/Artifacts surfaces and any consumer not yet report-aware. */
function reportToText(report) {
  if (!report) return "";
  const out = [];
  if (report.tldr) out.push(report.tldr);
  for (const s of report.sections || []) {
    if (s.type === "summary") continue;                 // already in tldr
    if (s.heading) out.push(`\n## ${s.heading}`);
    if (s.text) out.push(s.text);
    if (s.items) out.push(s.items.map((it, i) => `${s.type === "steps" ? `${i + 1}.` : "-"} ${it.text}${it.detail ? ` — ${it.detail}` : ""}`).join("\n"));
    if (s.columns && s.rows) { out.push(s.columns.join(" | ")); out.push(s.rows.map((r) => r.join(" | ")).join("\n")); }
    if (s.matrix) out.push([["", ...(s.options || [])].join(" | "), ...s.matrix.map((r) => r.join(" | "))].join("\n"));
  }
  if (report.limitations?.length) out.push(`\n## Not verified\n` + report.limitations.map((l) => `- ${l}`).join("\n"));
  return out.join("\n").trim();
}

/**
 * Run the pipeline for a question against a project's knowledge base.
 * @param deps { substrate, callGemini, retrieve, gateway, listEntries }
 * @returns { runId, subquestions, cards, analysisId, answer, report, assertions, cost }
 */
// ── W8: depth presets ─────────────────────────────────────────────────────
// Effort is the user's call, so it must be a real lever, not a label. Each preset changes
// what the pipeline actually does; the stated seconds come from measured runs (W7), not
// from wishful rounding.
const DEPTH = {
  quick:      { subquestions: 3, extraRounds: 0, claimBudget: 16, cove: false, sourcesPerCall: 4, sections: "4-5", label: "~75s" },
  standard:   { subquestions: 6, extraRounds: 1, claimBudget: 40, cove: true,  sourcesPerCall: 6, sections: "6-8", label: "~110s" },
  exhaustive: { subquestions: 8, extraRounds: 2, claimBudget: 60, cove: true,  sourcesPerCall: 8, sections: "7-9", label: "~3min" },
};
// A hint that biases the planner and the architect. Deliberately NOT a template: the
// architect still designs the report from the evidence it actually found, so an intent can
// never force a shape the evidence does not support.
const INTENT_HINTS = {
  Research: "",
  Compare:  "The user wants a COMPARISON. Favour sub-questions that isolate each option on shared criteria, and a comparison matrix in the report.",
  Evaluate: "The user wants an EVALUATION against criteria. Favour sub-questions that surface measurable criteria and evidence of performance against them.",
  Design:   "The user wants a DESIGN/how-to. Favour sub-questions about method, constraints, materials and failure modes; a steps section is likely warranted.",
  Monitor:  "The user wants to MONITOR something over time. Favour sub-questions about current state, recent changes, leading indicators and what to watch next.",
  Decide:   "The user wants to DECIDE. Favour sub-questions that sharpen the trade-off, and finish with a clearly-labelled recommendation the evidence supports.",
  Explain:  "The user wants an EXPLANATION. Favour sub-questions about mechanism and causation over headline facts; prefer prose over tables.",
};

async function runPipeline({ substrate, projectId, question, callGemini, retrieve, gateway, listEntries, onStage, depth, intent, sourceScope }) {
  const cfg = DEPTH[String(depth || "standard").toLowerCase()] || DEPTH.standard;
  const intentHint = INTENT_HINTS[intent] || "";
  // W7: real stage reporting. The UI previously guessed the phase from elapsed seconds
  // ("<45 s ⇒ Synthesizing"), which the timing instrumentation proved wrong — at 45 s a run
  // is still gathering. Emitting actual transitions makes the progress bar truthful.
  const stage = (name, detail) => { try { onStage?.(name, detail || {}); } catch { /* never let UI reporting break a run */ } };
  const runId = substrate.runs.start({ projectId, trigger: "research", stage: "planning" });
  const trace = { runId, subquestions: [], cards: [], answer: "", assertions: [], analysisId: null, cost: 0, phases: {} };
  // Every charge flows through here, so this is where run + day spend are tracked and where
  // the caps read their numbers. opts.grounded adds the per-REQUEST search fee — the charge
  // the old token-only meter missed entirely.
  const bump = (usdIn = 0, usdOut = 0, model = "gemini-3.5-flash", opts = {}) => {
    const usd = gateway.helixCostUsd(model, usdIn, usdOut, opts);
    trace.cost += usd;
    bump.runUsd = (bump.runUsd || 0) + usd;
    if (opts.grounded) bump.groundedCalls = (bump.groundedCalls || 0) + 1;
    recordSpend(usd);
  };

  // W7: per-phase wall clock. Parallelising the gather loops did NOT move total time, which
  // means the assumed bottleneck was wrong — so measure every phase before optimising
  // anything. `calls` matters as much as `ms`: a phase can be slow because it makes many
  // calls or because it makes one slow call, and those need opposite fixes.
  const t0 = Date.now();
  trace.timing = {};
  bump.calls = 0;
  const time = async (name, fn) => {
    const start = Date.now(), before = bump.calls;
    try { return await fn(); }
    finally { trace.timing[name] = { ms: Date.now() - start, atMs: start - t0, calls: bump.calls - before }; }
  };

  try {
    // ── Phase 1: plan — W2 diversity-constrained decomposition ──
    substrate.runs.update(runId, { status: "running", stage: "planning" });
    stage("planning");
    const planned = await time("plan", () => planResearch({ question, callGemini, gateway, bump, target: cfg.subquestions, intentHint }));
    trace.plan = planned;                                  // [{q, sourceType, adversarial}]
    trace.subquestions = planned.map((s) => s.q);          // back-compat: API still returns strings
    trace.phases.plan = {
      subquestions: planned.length,
      sourceTypes: [...new Set(planned.map((s) => s.sourceType).filter(Boolean))],
      adversarial: planned.filter((s) => s.adversarial).length,
      // A one-subquestion plan means decomposition failed and we're about to do shallow
      // research. It used to look identical to success in the trace — never again.
      degraded: planned.some((s) => s.planDegraded) ? "planner returned nothing; searching the raw question only"
        : planned.length < 3 ? `planner returned only ${planned.length} sub-question(s)` : undefined,
    };

    // ── Phase 2: gather — internal retrieval + LIVE web source acquisition ──
    substrate.runs.update(runId, { status: "running", stage: "gathering" });
    stage("gathering", { subquestions: trace.subquestions.length });
    const entries = listEntries(projectId);
    const entryById = new Map(entries.map(e => [e.id, e]));
    for (const e of entries) substrate.fts.upsert("entry", e.id, projectId, `${e.query}\n${e.text}`);

    // ── W10: CORPUS COMPOUNDING ───────────────────────────────────────────
    // Prior runs' evidence was written to the ledger but never INDEXED, so retrieval could
    // not see it: report #10 knew exactly as much as report #1. That is the one thing a
    // project-scoped research tool should beat a stateless assistant at. Index it here and
    // hydrate it in the retrieval leg below.
    let priorEvidence = [];
    try { priorEvidence = substrate.evidence.listByProject(projectId) || []; } catch { /* first run */ }
    const priorById = new Map();
    for (const ev of priorEvidence) {
      const text = String(ev.claim_text || ev.claimText || "").trim();
      if (text.length < 25) continue;                       // fragments aren't worth recalling
      priorById.set(ev.id, { ...ev, claimText: text });
      substrate.fts.upsert("evidence", ev.id, projectId, text);
    }
    trace.priorCorpus = priorById.size;

    // Recency decay. Research goes stale, so a fact recalled from three months ago must not
    // outrank one retrieved today — but it should still be reachable. Half-life ~45 days,
    // floored at 0.35 so genuinely old-but-relevant evidence never drops out entirely.
    const HALF_LIFE_DAYS = 45;
    const decayFor = (createdAt) => {
      const t = Date.parse(createdAt || "");
      if (!t) return 0.6;
      const days = Math.max(0, (Date.now() - t) / 86400000);
      return Math.max(0.35, Math.pow(0.5, days / HALF_LIFE_DAYS));
    };

    const seen = new Set();
    trace.webSources = [];
    // PERF (2026-07-23): the per-subquestion retrieval + grounded web call used to run in a
    // sequential `for…of await` loop — 5 subquestions × a slow grounded call, strictly
    // one-at-a-time. Combined with the sequential red-team below that made ~12 serial LLM
    // round-trips and a ~142s wall-clock run, which reads as "stuck on synthesis" in the UI.
    // The subquestions are independent, so fan them out and await once.
    // One gather round over a list of queries. Reusable so the W2 gap loop can run it again
    // with follow-up queries. Fans out in parallel; DB writes serialized after.
    const runGatherRound = async (queries) => {
      const gathered = await Promise.all(queries.map(async (sq) => {
        const out = { sq, cards: [], web: null };
        // (a) internal retrieval over the project's knowledge base
        try {
          const r = await retrieve(substrate, projectId, sq, {
            runId, subquestionId: null, limit: 8,
            // W10: hydrate BOTH project entries and prior runs' evidence. Without the second
            // branch the newly-indexed evidence would match in FTS and then hydrate to null.
            hydrate: (kind, id) => {
              const e = entryById.get(id);
              if (e) return { title: e.query, text: e.text, createdAt: e.created_at, source: e.strand };
              const ev = priorById.get(id);
              if (ev) return { title: `prior research · ${String(ev.method || "evidence")}`, text: ev.claimText, createdAt: ev.created_at, source: "prior-run" };
              void kind;
              return null;
            },
          });
          // Recalled evidence is real but older than a fresh search, so it is scored lower
          // and labelled — a reader must be able to tell "we found this today" from
          // "we knew this already".
          out.cards = (r.cards || []).map((c) => {
            if (!priorById.has(c.refId)) return c;
            const ev = priorById.get(c.refId);
            return { ...c, recalled: true, priorRun: true, createdAt: ev.created_at,
              score: +((c.score ?? 0.5) * decayFor(ev.created_at)).toFixed(3) };
          });
        } catch { /* retrieval is best-effort */ }
        // (b) LIVE web acquisition — grounded call returns sourced facts + real URLs.
        try {
          const wp = `Find current, sourced facts answering: "${sq}". Use up-to-date web sources. `
            + `List each distinct fact as its own bullet point, with concrete numbers, dates and names where available.`;
          const wr = await askModel(callGemini, bump, "web-gather", { prompt: wp, mode: "chat", strength: "balanced", deepResearch: true, sessionId: `helix-gather-${projectId}-${Math.random().toString(36).slice(2, 8)}`, deviceId: "helix-pipeline", source: "helix-pipeline", history: [] });
          // Grounded search is billed per REQUEST. A cache hit costs nothing, so only a real
          // search is charged — otherwise the cache would look free while the meter kept billing.
          bump(gateway.estimateTokens(wp), gateway.estimateTokens(wr.response), "gemini-3.5-flash", { grounded: !wr.fromCache });
          out.web = { response: wr.response || "", sources: Array.isArray(wr.sources) ? wr.sources : [] };
        } catch { /* web leg is best-effort; internal retrieval still stands */ }
        return out;
      }));

      // Serialize the DB writes after the parallel fan-out (SQLite writes stay ordered).
      for (const g of gathered) {
        for (const c of g.cards) if (!seen.has(c.refId)) { seen.add(c.refId); trace.cards.push({ ...c, subquestion: g.sq }); }
        const wr = g.web; if (!wr) continue;
        const srcs = (wr.sources || []).filter((s) => s && s.url).slice(0, cfg.sourcesPerCall);
        // Register the call's sources once (they back every claim from this response).
        const srcRefs = [];
        for (const s of srcs) {
          const sourceId = substrate.sources.create({ projectId, title: (s.title || s.url).slice(0, 200), sourceType: "web", originalLocator: s.url, ingestionStatus: "ingested", reliability: "unrated" });
          srcRefs.push({ sourceId, url: s.url, title: s.title || s.url });
          if (!seen.has(s.url)) {
            seen.add(s.url);
            trace.webSources.push({ url: s.url, title: s.title });
            // Sources arriving one by one is the most honest progress signal there is: it is
            // the research actually happening, not a timer pretending to be one.
            stage("source", { title: s.title || s.url, total: trace.webSources.length });
          }
        }
        // W2 FIX: split the grounded response into ATOMIC CLAIMS and store each as its own
        // evidence item. Previously every source got the identical whole-response blob as its
        // excerpt, so N sources carried 1 fact — real information was thrown away.
        const claims = splitIntoClaims(wr.response);
        // W6: resolve each claim to the grounding segment that actually covers it, so the
        // claim inherits ITS source and ITS confidence rather than the call's first URL and a
        // flat 0.72. `groundingSupports` gives byte ranges over the response text.
        const supports = Array.isArray(wr.supports) ? wr.supports : [];
        const attribute = (claimText) => {
          if (!supports.length) return null;
          const at = wr.response.indexOf(claimText.slice(0, 60));
          if (at < 0) return null;
          const end = at + claimText.length;
          const hits = supports.filter((s) => s.start < end && s.end > at);
          if (!hits.length) return null;
          const idxs = [...new Set(hits.flatMap((h) => h.chunks))].filter((i) => srcRefs[i]);
          const confs = hits.map((h) => h.confidence).filter((c) => typeof c === "number");
          return {
            refs: idxs.map((i) => srcRefs[i]),
            confidence: confs.length ? Math.max(...confs) : null,
          };
        };
        const primary = srcRefs[0];
        for (const claimText of claims) {
          if (!primary) break;
          const attr = attribute(claimText);
          const owner = attr?.refs?.[0] || primary;                  // the segment's own source
          const others = (attr?.refs?.length ? attr.refs.slice(1) : srcRefs.filter((r) => r !== owner));
          const { id: ptrId, quoteHash } = substrate.sources.addPointer({ sourceId: owner.sourceId, locationType: "web", quoteOrPassage: claimText.slice(0, 400) });
          const evId = substrate.evidence.create({ projectId, questionId: null, evidenceType: "claim", claimText: claimText.slice(0, 400), sourceId: owner.sourceId, sourcePointerIds: [ptrId], quoteHash, method: "web-grounded", supportStatus: "supported" });
          trace.cards.push({
            refId: evId, refKind: "web",
            // Real per-segment grounding confidence when Google gave us one; the old flat
            // 0.72 was a made-up constant applied to every claim equally.
            score: attr?.confidence ?? 0.72,
            grounded: attr?.confidence != null,
            title: owner.title, excerpt: claimText, source: owner.url,
            matchedBy: "web", subquestion: g.sq,
            corroborations: others.slice(0, 8).map((r) => ({ title: r.title, source: r.url })),
          });
        }
      }
      return gathered.length;
    };

    // Round 1 — the planned sub-questions.
    await time("gather:round1", () => runGatherRound(trace.subquestions));
    trace.rounds = 1;

    // ── W2: gap-analysis loop — assess coverage, then research what's MISSING ──
    // This is what turns one-shot search into real research. Capped at MAX_EXTRA_ROUNDS.
    const MAX_EXTRA_ROUNDS = cfg.extraRounds;      // W8: depth controls how many gap rounds run
    trace.coverage = [];
    for (let round = 0; round < MAX_EXTRA_ROUNDS; round++) {
      const cov = await time("coverage", () => assessCoverage({ question, subquestions: trace.plan || trace.subquestions, cards: trace.cards, callGemini, gateway, bump }));
      const entry = { round: round + 1, adequate: cov.adequate, gaps: cov.gaps.map((g) => g.missing), unparsed: cov.unparsed || undefined };
      trace.coverage.push(entry);
      if (cov.adequate || !cov.gaps.length) { entry.final = true; break; }
      const followUps = cov.gaps.map((g) => g.query);
      trace.followUpQueries = [...(trace.followUpQueries || []), ...followUps];
      await time("gather:round2", () => runGatherRound(followUps));
      trace.rounds += 1;
      // These gaps were dispatched and researched — they are NOT limitations of the finished
      // report, so they must not be presented as things we failed to verify.
      entry.followedUp = true;
    }
    // No second coverage assessment: limitations are now derived from the finished report
    // (assessLimitations), so a re-assessment here would cost a call and ~8s that nothing reads.
    // ── W1: evidence-quality pass — hard filter → content dedupe → CRAG grade ──
    // Everything downstream (quant, verification, synthesis) sees only refined evidence,
    // so junk can't dilute the answer or inflate the "N sources" count.
    const rawCardCount = trace.cards.length;
    const refined = await time("refine", () => refineEvidence({ cards: trace.cards, question, callGemini, gateway, bump }));
    trace.cards = refined.cards;
    trace.evidenceQuality = refined.stats;
    trace.phases.gather = {
      cardsRaw: rawCardCount, cards: trace.cards.length,
      webSources: trace.webSources.length, subquestions: trace.subquestions.length,
      rounds: trace.rounds, followUps: (trace.followUpQueries || []).length,
      // Source URLs are Google grounding REDIRECTS (vertexaisearch.cloud.google.com), so the
      // URL hostname is identical for every source and useless as a diversity metric. The
      // card TITLE carries the real publisher ("investing.com", "theguardian.com").
      // Must match an actual domain shape — `/\./` alone counted any claim sentence
      // containing a full stop as a "domain" and inflated the diversity metric.
      uniqueDomains: [...new Set((trace.cards || []).flatMap((c) => [c.title, ...(c.corroborations || []).map((x) => x.title)])
        .map((t) => String(t || "").trim().toLowerCase())
        .filter((t) => /^(www\.)?[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(t) && t.length < 60))].length,
      filtered: refined.stats,
      // W10: how much of this run stood on what the project already knew.
      priorCorpus: trace.priorCorpus || 0,
      recalled: (trace.cards || []).filter((c) => c.recalled).length,
      // A gather that produced no web sources is a FAILED gather, not a quiet one. Say so
      // loudly rather than letting synthesis build a confident report on internal scraps.
      degraded: !trace.webSources.length ? "no web sources acquired — search returned nothing (see modelErrors)"
        : trace.webSources.length < 5 ? `only ${trace.webSources.length} web source(s) acquired` : undefined,
    };

    // ── Phase 3: quant (deterministic, when the question is quantitative) ──
    substrate.runs.update(runId, { status: "running", stage: "checking" });
    stage("checking", { evidence: trace.cards.length, sources: trace.webSources.length });
    trace.quant = quantAnalyze(question, trace.cards);

    // ── Phase 3b: cross-source contradiction detection (deterministic, no LLM call) ──
    // The 5-role red-team that used to live here is GONE (W6). It critiqued the evidence with
    // no new information — intrinsic self-critique does not improve factuality — and in
    // practice produced adjectives, never a caught error. Nothing consumed its verdicts.
    // Real verification now happens AFTER synthesis, against the claims the report makes.
    trace.contradictions = findContradictions(trace.cards);
    trace.phases.check = {
      cardsChecked: trace.cards.length,
      contradictions: trace.contradictions.length,
      quant: !!trace.quant,
    };

    // ── Phase 4: synthesize — W3/W4 STRUCTURED REPORT ──
    // Was: one capped ~130-word JSON blob (which truncated, and truncation once became the
    // false "Insufficient evidence"). Now: the architect designs a shape from the evidence
    // and each section is written by its own small, parallel call.
    substrate.runs.update(runId, { status: "running", stage: "synthesizing" });
    stage("synthesizing", { evidence: trace.cards.length });
    if (trace.cards.length) {
      trace.report = await time("synthesize", () => buildReport({
        question, cards: trace.cards, coverage: trace.coverage,
        callGemini, gateway, bump, intentHint, sectionBudget: cfg.sections,
        meta: { rounds: trace.rounds, subquestions: trace.subquestions.length, depth: cfg === DEPTH.quick ? "quick" : cfg === DEPTH.exhaustive ? "exhaustive" : "standard", intent: intent || null },
      }));
      trace.answer = reportToText(trace.report);          // legacy consumers keep working
      trace.assertions = (trace.report.sections || [])
        .filter((s) => !s.inference)
        .flatMap((s) => (s.items || []).map((it) => ({ text: it.text, evidence: s.citations || [], confidence: s.confidence || "moderate" })))
        .slice(0, 40);
      trace.phases.synthesize = {
        sections: (trace.report.sections || []).length,
        types: (trace.report.sections || []).map((s) => s.type),
        words: String(trace.answer || "").split(/\s+/).filter(Boolean).length,
        limitations: (trace.report.limitations || []).length,
        degraded: trace.report.meta?.degraded || null,
      };

      // ── Phase 5: VERIFY (W6) — against the claims the report actually makes ──
      // Ordering matters: this runs AFTER synthesis because you cannot verify a report you
      // have not written. The old red-team ran before, against raw evidence, which is why it
      // could never catch a synthesis error.
      substrate.runs.update(runId, { status: "running", stage: "verifying" });
      stage("verifying", { sections: (trace.report.sections||[]).length });
      const claims = extractClaims(trace.report.sections || [], cfg.claimBudget);
      // W7: `limitations` and ISSUP both read only the finished sections, so they overlap
      // instead of costing two sequential main-model round-trips.
      const [limitations, scored] = await time("verify:issup+limits", () => Promise.all([
        assessLimitations({ question, sections: trace.report.sections || [], callGemini, gateway, bump }).catch(() => []),
        scoreSupport({ claims, cards: trace.cards, callGemini, gateway, bump }).catch(() => []),
      ]));
      trace.report.limitations = [...new Set(limitations)].slice(0, 6);
      trace.phases.synthesize.limitations = trace.report.limitations.length;
      // Quick depth skips CoVe: it is the expensive half of verification (fresh grounded
      // searches), and a ~45s budget cannot absorb it. ISSUP still runs, so claims are still scored.
      const cove = cfg.cove
        ? await time("verify:cove", () => verifyClaims({ claims: scored, callGemini, gateway, bump }).catch(() => []))
        : [];

      // CoVe searched fresh sources, so its verdict supersedes the evidence-only ISSUP score.
      const coveBy = new Map(cove.map((c) => [c.text, c]));
      const merged = scored.map((c) => {
        const v = coveBy.get(c.text);
        if (!v) return c;
        return { ...c, cove: v.cove, note: v.note,
          verdict: v.cove === "confirmed" ? "supported" : v.cove === "refuted" ? "contradicted" : c.verdict };
      });

      const count = (v) => merged.filter((c) => c.verdict === v).length;
      // Only surface what a reader must act on: claims we could NOT stand behind.
      const flags = merged
        .filter((c) => c.verdict === "unsupported" || c.verdict === "contradicted")
        .map((c) => ({ claim: c.text, heading: c.heading, verdict: c.verdict, checked: c.cove || "evidence-only", note: c.note || "" }))
        .slice(0, 8);

      trace.verification = {
        claimsChecked: merged.length,
        // When the budget truncates, say so — "28/28 supported" reads as full coverage.
        claimsAvailable: claims.totalAvailable ?? merged.length,
        supported: count("supported"),
        unsupported: count("unsupported"),
        contradicted: count("contradicted"),
        coveChecked: cove.length,
        // A claim the evidence could not support that a FRESH search then confirmed is the
        // system working at its best. Reported as 28/28 it looked like nothing happened.
        coveConfirmed: cove.filter((c) => c.cove === "confirmed").length,
        coveRefuted: cove.filter((c) => c.cove === "refuted").length,
        coveUnverifiable: cove.filter((c) => c.cove === "unverifiable").length,
        flags,
      };
      trace.report.verification = trace.verification;
      trace.report.contradictions = trace.contradictions;
      // An unsupported claim that stays silent is the failure mode this wave exists to kill.
      if (flags.length) {
        trace.report.limitations = [
          ...(trace.report.limitations || []),
          ...flags.slice(0, 3).map((f) => `Unverified claim in "${f.heading}": ${f.claim.slice(0, 150)}${f.note ? ` — check found: ${f.note}` : ""}`),
        ];
      }
      trace.phases.verify = {
        claims: merged.length, ofAvailable: trace.verification.claimsAvailable,
        supported: count("supported"),
        unsupported: count("unsupported"), contradicted: count("contradicted"),
        coveChecked: cove.length, coveConfirmed: trace.verification.coveConfirmed, coveRefuted: trace.verification.coveRefuted,
        citedPct: merged.length ? Math.round((count("supported") / merged.length) * 100) : null,
      };
    } else {
      // Genuinely no evidence — say exactly that, and nothing more.
      trace.report = null;
      trace.answer = "No evidence could be retrieved for this question.";
      trace.assertions = [];
      trace.phases.synthesize = { sections: 0, words: 0, noEvidence: true };
    }

    // ── Persist: analysis + assertions + citations ──
    if (substrate.analyses?.create) {
      // (analysis writers land in a later wave; for now record via event ledger)
    }
    substrate.events.append({
      projectId, eventType: "pipeline_completed", objectType: "run", objectId: runId,
      summary: `research: ${trace.subquestions.length} sub-questions, ${trace.cards.length} evidence cards (${trace.webSources.length} web sources), `
        + `${trace.verification ? `${trace.verification.supported}/${trace.verification.claimsChecked} claims supported` : "unverified"}, `
        + `${(trace.contradictions || []).length} cross-source contradictions, ${trace.assertions.length} assertions`,
      trust: {
        cited: trace.assertions.length,
        method: "retrieval+web-grounded+issup+cove",
        claimsChecked: trace.verification?.claimsChecked ?? 0,
        supported: trace.verification?.supported ?? 0,
        unsupported: (trace.verification?.unsupported ?? 0) + (trace.verification?.contradicted ?? 0),
        contradictions: (trace.contradictions || []).length,
      },
      pointers: { cost: +trace.cost.toFixed(6), subquestions: trace.subquestions, webSources: trace.webSources.length },
    });

    // W7: total + the phase breakdown, sorted so the dominant phase is unmissable.
    trace.timing.total = { ms: Date.now() - t0, calls: bump.calls };
    // Cost breakdown, itemised. A single blended figure is what let grounded search hide.
    trace.spend = {
      totalUsd: +(bump.runUsd || 0).toFixed(4),
      groundedCalls: bump.groundedCalls || 0,
      groundingUsd: +((bump.groundedCalls || 0) * gateway.GROUNDING_USD_PER_REQUEST).toFixed(4),
      tokenUsd: +((bump.runUsd || 0) - (bump.groundedCalls || 0) * gateway.GROUNDING_USD_PER_REQUEST).toFixed(4),
      cacheHits: bump.cacheHits || 0,
      today: spendState(),
      ...(bump.budgetStopped ? { stoppedBy: bump.budgetStopped } : {}),
    };
    trace.phases.spend = `$${trace.spend.totalUsd} (${trace.spend.groundedCalls} searches = $${trace.spend.groundingUsd}`
      + `${trace.spend.cacheHits ? `, ${trace.spend.cacheHits} cached` : ""}) · today $${trace.spend.today.usd}/$${trace.spend.today.dayBudget}`;
    trace.phases.timing = Object.fromEntries(
      Object.entries(trace.timing)
        .sort((a, b) => (b[1].ms || 0) - (a[1].ms || 0))
        .map(([k, v]) => [k, `${(v.ms / 1000).toFixed(1)}s${v.calls ? ` · ${v.calls} calls` : ""}`]));

    // Surface every swallowed model failure. Without this a run that lost its searches to a
    // quota error reported "success" with a clean log — indistinguishable from a good run.
    if (bump.retries && bump.retries.length) {
      trace.recoveredRetries = bump.retries.slice(0, 20);
      trace.phases.retries = bump.retries.length;   // recovered, not failed
    }
    if (bump.errors && bump.errors.length) {
      trace.modelErrors = bump.errors.slice(0, 40);
      const byWhere = {};
      for (const e of bump.errors) byWhere[e.where] = (byWhere[e.where] || 0) + 1;
      trace.phases.modelErrors = byWhere;
    }
    substrate.runs.update(runId, {
      status: "success", stage: "complete", completed: true, totalCost: +trace.cost.toFixed(6),
      // W10: persist the FULL report, not a 200-char snippet. Re-run & diff needs a previous
      // version to compare against, and monitoring needs to know what changed since last time.
      outputs: [{
        question,
        answer: trace.answer.slice(0, 200),
        assertions: trace.assertions.length,
        cards: trace.cards.length,
        report: trace.report || null,
      }],
      ...(trace.modelErrors ? { errors: trace.modelErrors.map((e) => `${e.where}: ${e.error}`) } : {}),
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

// ═══════════════════════════════════════════════════════════════════════════
//  W10 — RE-RUN & DIFF
//  Re-running a question only helps if you can see what CHANGED. A text diff would drown the
//  reader in rewording, so this compares what carries meaning: figures, sections, sources and
//  the verification verdict. Deterministic — no model call, so the diff cannot invent a
//  change that did not happen.
// ═══════════════════════════════════════════════════════════════════════════
const FIGURE_RE = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?\s*(?:%|bn|billion|million|trillion|k\b|kg|km|x\b|bps)?/gi;

function reportProse(report) {
  return [report?.tldr || "", ...(report?.sections || []).map((s) => [
    s.text || "",
    (s.rows || []).flat().join(" "),
    (s.items || []).map((i) => `${i.text || ""} ${i.detail || ""}`).join(" "),
  ].join(" "))].join(" ").replace(/\s+/g, " ");
}

/** Figures keyed by the words preceding them, so "$135" in two places stays two facts.
 *  Values are NORMALISED — trailing punctuation and thousands separators are not changes.
 *  Without this, "2023," vs "2023" was reported as a figure that moved (observed live). */
function normFigure(v) {
  return String(v).trim()
    .replace(/[.,;:)\]]+$/, "")            // "2023," → "2023"
    .replace(/,(?=\d{3}\b)/g, "")          // "1,600" → "1600"
    .replace(/\s+/g, " ");
}
function reportFigures(report) {
  const text = reportProse(report);
  const out = new Map();
  let m;
  FIGURE_RE.lastIndex = 0;
  while ((m = FIGURE_RE.exec(text))) {
    const value = normFigure(m[0]);
    if (!/\d/.test(value)) continue;
    const ctx = text.slice(Math.max(0, m.index - 60), m.index).trim().split(" ").slice(-6).join(" ")
      .toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (ctx.length < 8) continue;
    if (!out.has(ctx)) out.set(ctx, value);
  }
  return out;
}

// ── Section identity by CONTENT, not heading ──────────────────────────────
// The architect rewords headings freely between runs ("Historical Subscriber Growth and
// Global ARPU Benchmarks" → "Subscriber Growth Timeline (2020-2025)"). Matching on heading
// text reported that as a section DROPPED and a section ADDED — a monitoring alert screaming
// that four sections vanished when the report was substantively identical. That false alarm
// is exactly what makes people stop reading alerts.
const STOP = new Set("the a an and or of to in for on with by from at as is are was were this that its it their which while have has been will can".split(" "));
function sectionFingerprint(s) {
  const body = [
    s.text || "",
    (s.rows || []).flat().join(" "),
    (s.items || []).map((i) => `${i.text || ""} ${i.detail || ""}`).join(" "),
    (s.matrix || []).flat().join(" "),
  ].join(" ").toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  return new Set(body.split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
}
function jaccardish(a, b) {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / Math.min(a.size, b.size);
}

/** Diff two HelixReports. Returns MATERIAL changes only — reworded prose is not a change. */
function diffReports(prev, next) {
  if (!prev || !next) return { comparable: false, reason: "no previous version to compare against" };

  const pFig = reportFigures(prev), nFig = reportFigures(next);
  const changedFigures = [];
  for (const [ctx, now] of nFig) {
    const was = pFig.get(ctx);
    if (was && was !== now) changedFigures.push({ context: ctx, was, now });
  }

  // Pair sections by body overlap, not by heading, so a reworded heading is a RENAME rather
  // than a deletion plus an addition. 0.4 is deliberately permissive: sections get partly
  // rewritten between runs, and calling a mostly-similar section "new" is the failure mode
  // that matters here.
  const pSecs = (prev.sections || []).map((s) => ({ s, head: String(s.heading || s.type).toLowerCase(), fp: sectionFingerprint(s) }));
  const nSecs = (next.sections || []).map((s) => ({ s, head: String(s.heading || s.type).toLowerCase(), fp: sectionFingerprint(s) }));
  const takenPrev = new Set();
  const renamedSections = [];
  const addedSections = [];
  for (const n of nSecs) {
    let best = null, bestScore = 0;
    for (let i = 0; i < pSecs.length; i++) {
      if (takenPrev.has(i)) continue;
      const score = n.head === pSecs[i].head ? 1 : jaccardish(n.fp, pSecs[i].fp);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best !== null && bestScore >= 0.4) {
      takenPrev.add(best);
      if (pSecs[best].head !== n.head) renamedSections.push({ was: pSecs[best].head, now: n.head });
    } else {
      addedSections.push(n.head);
    }
  }
  const removedSections = pSecs.filter((_, i) => !takenPrev.has(i)).map((p) => p.head);

  const srcs = (r) => new Set((r.sources || []).map((s) => String(s.title || "").toLowerCase()).filter(Boolean));
  const pSrc = srcs(prev), nSrc = srcs(next);
  const pct = (v) => (v?.claimsChecked ? Math.round((v.supported / v.claimsChecked) * 100) : null);

  const newSources = [...nSrc].filter((x) => !pSrc.has(x));
  const droppedSources = [...pSrc].filter((x) => !nSrc.has(x));
  // A rename is NOT material — that is the whole point of matching on content.
  const material = changedFigures.length + addedSections.length + removedSections.length;

  return {
    comparable: true,
    material: material > 0,
    changedFigures: changedFigures.slice(0, 12),
    addedSections, removedSections,
    renamedSections: renamedSections.slice(0, 8),   // reported, but never counted as material
    newSources: newSources.slice(0, 12),
    newSourceCount: newSources.length,
    droppedSourceCount: droppedSources.length,
    verification: { was: pct(prev.verification), now: pct(next.verification) },
    // Readable without opening the diff — this is what a monitoring alert would say.
    summary: material === 0
      ? "No material change — the figures, sections and conclusions all still hold."
      : [
        changedFigures.length ? `${changedFigures.length} figure${changedFigures.length === 1 ? "" : "s"} changed` : "",
        addedSections.length ? `${addedSections.length} new section${addedSections.length === 1 ? "" : "s"}` : "",
        removedSections.length ? `${removedSections.length} section${removedSections.length === 1 ? "" : "s"} dropped` : "",
        newSources.length ? `${newSources.length} new source${newSources.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
  };
}

// The W6 verification pieces are exported so they can be tested directly. A verifier that
// always answers "supported" is worse than none, and that cannot be proven from a normal run
// (whose claims are usually true) — it needs known-false claims fed in deliberately.
/** Plain completion over HELIX's own no-tools path. Exists for the eval harness: routing the
 *  judge through the conversational brain let its agent loop hijack the prompt — asked to
 *  "Score 1-10" it ran a web search about sports scoring scales. Structured tasks must not
 *  go through a tool-calling agent. Returns "" if no local key is available. */
async function directComplete(prompt, { strength } = {}) {
  const key = helixApiKey();
  if (!key) return "";
  const noop = () => {};
  const r = await directGemini({ key, prompt, grounded: false, strength, bump: noop, where: "bench" });
  return String(r?.response || "");
}

module.exports = {
  runPipeline, parseJsonLoose, quantAnalyze, directComplete, diffReports,
  extractClaims, scoreSupport, verifyClaims, findContradictions,
};
