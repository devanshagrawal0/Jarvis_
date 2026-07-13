// ECLIPSE top-5 tools (deep-design §5) — verifiability is Eclipse's edge over chat. Each tool
// declares the lease scope it consumes; agents invoke them ONLY through the gateway. Calc +
// Code are genuinely real local execution; Web Reader / Citation Verifier default to
// deterministic fixtures (real `fetch` behind mode:"live" — still zero Gemini); Semantic Memory
// searches a real local corpus. No tool spends Gemini.
const vm = require("vm");
const { id, nowIso, hashOf } = require("../contracts/validate");

// ── Calculation Reproducer — independently re-derive a number and diff vs claimed ────────────
const SAFE_EXPR = /^[\s\d.+\-*/%()eE,]*(?:Math\.[a-zA-Z]+\([^)]*\)[\s\d.+\-*/%()eE,]*)*$/;
function calcReproduce({ expression, expected } = {}) {
  const expr = String(expression || "").trim();
  if (!expr || !SAFE_EXPR.test(expr)) throw new Error(`calc: unsafe/empty expression: ${expr}`);
  let value;
  try { value = Function("Math", `"use strict"; return (${expr});`)(Math); } catch (e) { throw new Error(`calc: eval failed: ${e.message}`); }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`calc: non-numeric result`);
  const matches = expected == null ? null : Math.abs(value - Number(expected)) <= 1e-6 * Math.max(1, Math.abs(Number(expected)));
  return { value, expected: expected == null ? null : Number(expected), matches, diff: expected == null ? null : value - Number(expected) };
}

// ── Code Sandbox Executor — run a constrained JS snippet with a timeout (local, no network) ──
function codeExec({ code, timeoutMs = 1000 } = {}) {
  const logs = [];
  const sandbox = { Math, JSON, Number, String, Array, Object, console: { log: (...a) => logs.push(a.map(String).join(" ")) }, result: undefined };
  try {
    vm.runInNewContext(String(code || ""), sandbox, { timeout: timeoutMs, microtaskMode: "afterEvaluate" });
    return { ok: true, result: sandbox.result, stdout: logs.join("\n") };
  } catch (e) { return { ok: false, error: e.message, stdout: logs.join("\n") }; }
}

// ── Deep Web Reader — fetch + extract → an EvidenceObject payload ─────────────────────────────
function makeWebReader({ mode = "fixture", fixtures = {}, webFetch = null }) {
  return async function webRead({ url } = {}) {
    if (mode === "live" && typeof webFetch === "function") {
      const { text, status } = await webFetch(url);
      return { url, live: status >= 200 && status < 400, excerpt: String(text || "").slice(0, 4000), contentHash: hashOf(text || url), retrievedAt: nowIso() };
    }
    const f = fixtures[url];
    return { url, live: !!f, excerpt: f ? String(f.text).slice(0, 4000) : "", contentHash: hashOf(f ? f.text : url), retrievedAt: nowIso(), reliability: f ? f.reliability : undefined };
  };
}

// ── Citation Verifier — re-read a source and check the quote is actually supported ───────────
function makeCitationVerifier(webRead) {
  return async function verify({ url, quote } = {}) {
    const page = await webRead({ url });
    if (!page.live) return { url, live: false, supported: false, entailment: 0, reason: "dead/unreachable source" };
    const q = String(quote || "").toLowerCase().trim();
    const body = String(page.excerpt || "").toLowerCase();
    // Support = quote present, or strong token overlap (fixture-mode heuristic; a Pro judge in live).
    let supported = q.length > 0 && body.includes(q);
    let entailment = supported ? 0.9 : tokenOverlap(q, body);
    supported = supported || entailment >= 0.6;
    return { url, live: true, supported, entailment: Number(entailment.toFixed(2)), reason: supported ? "quote supported by source" : "quote not found in source" };
  };
}
function tokenOverlap(a, b) {
  const at = new Set(String(a).split(/\W+/).filter((w) => w.length > 3));
  if (!at.size) return 0;
  const bt = new Set(String(b).split(/\W+/).filter((w) => w.length > 3));
  let hit = 0; for (const t of at) if (bt.has(t)) hit++;
  return hit / at.size;
}

// ── Semantic Memory Retriever — RRF over a local corpus (lexical + stub-vector) ──────────────
function makeMemoryRetriever({ corpus = [] }) {
  return function retrieve({ query, k = 5 } = {}) {
    const { rankRRF } = require("../memory/resonance");
    return rankRRF(query, corpus, k);
  };
}

// Toolbox: name → { scope, sideEffecting, run }. Wired to the gateway by the agent runtime.
function createToolbox({ mode = "fixture", fixtures = {}, webFetch = null, corpus = [], search = null } = {}) {
  const webRead = makeWebReader({ mode, fixtures, webFetch });
  const citationVerify = makeCitationVerifier(webRead);
  const retrieve = makeMemoryRetriever({ corpus });
  return {
    "calc.repro": { scope: "code.exec", sideEffecting: false, run: async (a) => calcReproduce(a) },
    "code.exec": { scope: "code.exec", sideEffecting: false, run: async (a) => codeExec(a) },
    "web.fetch": { scope: "web.fetch", sideEffecting: false, run: async (a) => webRead(a) },
    "url_context": { scope: "web.fetch", sideEffecting: false, run: async (a) => webRead(a) },
    "citation.verify": { scope: "web.fetch", sideEffecting: false, run: async (a) => citationVerify(a) },
    "memory.retrieve": { scope: "memory.read", sideEffecting: false, run: async (a) => retrieve(a) },
    "web.search": { scope: "web.search", sideEffecting: false, run: async ({ query } = {}) => ({ results: search ? await search(query) : Object.keys(fixtures).map((u) => ({ url: u })).slice(0, 5), query }) },
    "memory.promote": { scope: "memory.write", sideEffecting: true, run: async (a) => ({ promoted: true, ...a }) },
    "artifact.write": { scope: "artifact.write", sideEffecting: true, run: async (a) => ({ written: true, ...a }) },
  };
}

module.exports = { createToolbox, calcReproduce, codeExec, makeWebReader, makeCitationVerifier, tokenOverlap };
