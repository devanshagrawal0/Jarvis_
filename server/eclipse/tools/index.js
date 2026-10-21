// ECLIPSE top-5 tools (deep-design §5) — verifiability is Eclipse's edge over chat. Each tool
// declares the lease scope it consumes; agents invoke them ONLY through the gateway. Calc +
// Code are genuinely real local execution; Web Reader / Citation Verifier default to
// deterministic fixtures (real `fetch` behind mode:"live" — still zero Gemini); Semantic Memory
// searches a real local corpus. No tool spends Gemini.
const vm = require("vm");
const { spawnSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const nodePath = require("path");
const dns = require("dns").promises;
const net = require("net");
const { id, nowIso, hashOf } = require("../contracts/validate");

// ── Python data-science sandbox — REAL local execution with the full stack (pandas, numpy, scipy,
// matplotlib, sklearn, statsmodels, openpyxl). This is the fleet's quantitative muscle: an agent
// writes Python, we run it in a fresh scratch dir with a timeout, and capture stdout/stderr + any
// files it produced (e.g. a chart PNG). Local single-user analysis on the owner's machine — it is
// real code execution (no OS sandbox), bounded by a timeout + output cap. Python bin is overridable
// via ECLIPSE_PYTHON.
function pythonExec({ code, timeoutMs = 25000, workDir = null } = {}) {
  const pybin = process.env.ECLIPSE_PYTHON || "python";
  let dir = workDir;
  try { if (!dir) dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "eclipse-py-")); } catch (e) { return { ok: false, stdout: "", stderr: `sandbox dir failed: ${e.message}`, artifacts: [] }; }
  const file = nodePath.join(dir, "cell.py");
  try { fs.writeFileSync(file, String(code || ""), "utf8"); } catch (e) { return { ok: false, stdout: "", stderr: `write failed: ${e.message}`, artifacts: [] }; }
  // MPLBACKEND=Agg → matplotlib renders to a file headlessly (no display), so savefig() works on a server.
  const res = spawnSync(pybin, [file], { cwd: dir, timeout: timeoutMs, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, MPLBACKEND: "Agg" } });
  const stdout = String(res.stdout || "").slice(0, 12000);
  const stderr = String(res.stderr || "").slice(0, 4000);
  let artifacts = [];
  try { artifacts = fs.readdirSync(dir).filter((f) => f !== "cell.py").map((f) => nodePath.join(dir, f)); } catch { /* none */ }
  const timedOut = !!(res.error && (res.error.code === "ETIMEDOUT" || /ETIMEDOUT/.test(String(res.error.message))));
  const spawnErr = res.error && !timedOut ? `spawn failed: ${res.error.message}` : "";
  return {
    ok: !res.error && res.status === 0,
    exitCode: res.status,
    timedOut,
    stdout,
    stderr: spawnErr || stderr,
    artifacts,
    workDir: dir,
  };
}

// ── File ingestion — read a local file the OWNER referenced (CSV, Excel, PDF, Word, JSON, text).
// Dispatch by extension: text/csv/json read directly; PDF via pdf-parse; Word via mammoth; Excel via
// pandas (read_excel → CSV preview). SAFETY: only files UNDER an allowed root are readable, so an
// instruction injected by a fetched web page cannot make an agent read arbitrary system files. Roots
// default to the owner's home dir; override with ECLIPSE_DATA_DIRS (a path-list). A dedicated data dir
// is the tighter hardening.
function fileReadRoots() {
  const raw = process.env.ECLIPSE_DATA_DIRS;
  if (raw) return raw.split(nodePath.delimiter).map((s) => s.trim()).filter(Boolean).map((p) => nodePath.resolve(p));
  try { return [nodePath.resolve(os.homedir())]; } catch { return []; }
}
function pathUnderAllowedRoot(p) {
  const rp = nodePath.resolve(p);
  return fileReadRoots().some((root) => {
    const rel = nodePath.relative(root, rp);
    return rel === "" || (rel && !rel.startsWith("..") && !nodePath.isAbsolute(rel));
  });
}
async function fileRead({ path: fp } = {}) {
  const p = String(fp || "").trim();
  if (!p) return { ok: false, error: "no path given" };
  const abs = nodePath.resolve(p);
  if (!pathUnderAllowedRoot(abs)) return { ok: false, error: `path not under an allowed data directory (set ECLIPSE_DATA_DIRS): ${abs}` };
  let stat; try { stat = fs.statSync(abs); } catch { return { ok: false, error: `file not found: ${abs}` }; }
  if (!stat.isFile()) return { ok: false, error: "not a file" };
  if (stat.size > 25 * 1024 * 1024) return { ok: false, error: `file too large (${Math.round(stat.size / 1e6)}MB > 25MB)` };
  const ext = nodePath.extname(abs).toLowerCase();
  const CAP = 20000;
  try {
    if ([".csv", ".tsv", ".txt", ".md", ".json", ".log", ".yaml", ".yml"].includes(ext)) {
      const text = fs.readFileSync(abs, "utf8");
      return { ok: true, kind: ext.slice(1), path: abs, bytes: stat.size, text: text.slice(0, CAP), truncated: text.length > CAP };
    }
    if (ext === ".pdf") {
      const { PDFParse } = require("pdf-parse"); // v2 exposes a PDFParse class, not a callable
      const parser = new PDFParse({ data: fs.readFileSync(abs) });
      const data = await parser.getText();
      const text = String(data.text || "");
      return { ok: true, kind: "pdf", path: abs, pages: data.total || data.pages || undefined, text: text.slice(0, CAP), truncated: text.length > CAP };
    }
    if (ext === ".docx") {
      const mammoth = require("mammoth");
      const r = await mammoth.extractRawText({ buffer: fs.readFileSync(abs) }); // buffer is robust vs OneDrive path reads
      const text = String(r.value || "");
      return { ok: true, kind: "docx", path: abs, text: text.slice(0, CAP), truncated: text.length > CAP };
    }
    if ([".xlsx", ".xls", ".xlsm"].includes(ext)) {
      // G: failure = stderr + exit(1) (never 'ERROR' on stdout with exit 0, which used to be
      // stored as evidence); the path travels base64-encoded so no quoting in it can escape.
      const pb64 = Buffer.from(abs, "utf-8").toString("base64");
      const script = `import sys, base64\nimport pandas as pd\np = base64.b64decode('${pb64}').decode('utf-8')\ntry:\n    df = pd.read_excel(p, sheet_name=0)\n    print('SHAPE', df.shape[0], 'rows x', df.shape[1], 'cols')\n    print(df.head(50).to_csv(index=False))\nexcept Exception as e:\n    print(str(e), file=sys.stderr)\n    sys.exit(1)`;
      const out = pythonExec({ code: script, timeoutMs: 25000 });
      const text = (out.ok ? out.stdout : (out.stderr || "read failed"));
      return { ok: out.ok, kind: "xlsx", path: abs, text: String(text).slice(0, CAP) };
    }
    return { ok: false, error: `unsupported file type "${ext}"` };
  } catch (e) { return { ok: false, error: `read failed: ${String(e.message).slice(0, 200)}` }; }
}

// ── Generic HTTP GET — the fleet's ONE data-access tool (Slice 1.3). The model supplies ANY url; we
// return JSON/text. NO service is ever named in code — this reaches an exchange, a data portal, any API
// equally. Read-only (GET). SAFETY: resolve the host and REFUSE private/loopback/link-local targets
// (SSRF) — re-checked on every redirect hop — so a url injected by a fetched page cannot reach Jarvis
// itself, the local network, or cloud metadata. Timeout + size cap.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;         // link-local / cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true; // unknown → unsafe
}
async function assertPublicHost(hostname) {
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length) throw new Error(`host does not resolve: ${hostname}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error(`blocked: ${hostname} resolves to a private/loopback address`);
}
async function httpGet({ url, headers = {}, timeoutMs = 15000, maxBytes = 2 * 1024 * 1024 } = {}) {
  const u0 = String(url || "").trim();
  if (!u0) return { ok: false, error: "no url given" };
  const safeHeaders = { "User-Agent": "EclipseResearch/1.0", Accept: "application/json, text/*;q=0.9, */*;q=0.5" };
  for (const [k, v] of Object.entries(headers || {})) { if (typeof v === "string" && v.length < 2000) safeHeaders[k] = v; }
  try {
    let current = u0, res = null;
    for (let hop = 0; hop <= 3; hop++) {
      const parsed = new URL(current);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: `scheme not allowed: ${parsed.protocol}` };
      await assertPublicHost(parsed.hostname);                     // re-checked on every redirect hop
      res = await fetch(current, { method: "GET", redirect: "manual", headers: safeHeaders, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { current = new URL(res.headers.get("location"), current).toString(); continue; }
      break;
    }
    const ct = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.length > maxBytes;
    const bodyText = buf.slice(0, maxBytes).toString("utf8");
    let json; if (/json|\+json/i.test(ct)) { try { json = JSON.parse(bodyText); } catch { /* keep as text */ } }
    return { ok: res.ok, status: res.status, finalUrl: current, contentType: ct, json, text: json ? undefined : bodyText.slice(0, 16000), bytes: buf.length, truncated };
  } catch (e) { return { ok: false, error: `fetch failed: ${String(e.message).slice(0, 200)}` }; }
}

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
  const inflight = new Map(); // K: parallel workers awaiting the same URL share ONE fetch
  return async function webRead({ url } = {}) {
    if (mode === "live" && typeof webFetch === "function") {
      if (inflight.has(url)) return inflight.get(url);
      const p = (async () => {
      const r = (await webFetch(url)) || {};
      const text = r.text || "";
      // Honor the fetcher's explicit liveness flag — a headless-render success may carry status 0.
      const live = typeof r.live === "boolean" ? r.live : (r.status >= 200 && r.status < 400);
      // Prefer the resolved final URL (redirect followed) so the evidence points at the real page.
      const kept = String(text).slice(0, 12000); // B-2: hash the STORED excerpt, not the pre-truncation text
      return { url: r.finalUrl || url, requestedUrl: url, live, excerpt: kept, contentHash: hashOf(kept || url), retrievedAt: nowIso() };
      })();
      inflight.set(url, p);
      try { return await p; } finally { inflight.delete(url); }
    }
    const f = fixtures[url];
    const keptF = f ? String(f.text).slice(0, 12000) : "";
    return { url, live: !!f, excerpt: keptF, contentHash: hashOf(keptF || url), retrievedAt: nowIso(), reliability: f ? f.reliability : undefined };
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
    "code.python": { scope: "code.exec", sideEffecting: false, run: async (a) => pythonExec(a) },
    "file.read": { scope: "fs.read", sideEffecting: false, run: async (a) => fileRead(a) },
    "http.get": { scope: "web.fetch", sideEffecting: false, run: async (a) => httpGet(a) },
    "web.fetch": { scope: "web.fetch", sideEffecting: false, run: async (a) => webRead(a) },
    "url_context": { scope: "web.fetch", sideEffecting: false, run: async (a) => webRead(a) },
    "citation.verify": { scope: "web.fetch", sideEffecting: false, run: async (a) => citationVerify(a) },
    "memory.retrieve": { scope: "memory.read", sideEffecting: false, run: async (a) => retrieve(a) },
    "web.search": { scope: "web.search", sideEffecting: false, run: async ({ query } = {}) => ({ results: search ? await search(query) : Object.keys(fixtures).map((u) => ({ url: u })).slice(0, 5), query }) },
    "memory.promote": { scope: "memory.write", sideEffecting: true, run: async (a) => ({ promoted: true, ...a }) },
    "artifact.write": { scope: "artifact.write", sideEffecting: true, run: async (a) => ({ written: true, ...a }) },
  };
}

module.exports = { createToolbox, calcReproduce, codeExec, pythonExec, fileRead, httpGet, makeWebReader, makeCitationVerifier, tokenOverlap };
