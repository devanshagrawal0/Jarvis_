// HELIX evaluation harness (Research Engine W9).
//
// WHY: every quality claim about this engine so far has been my judgement of one or two runs.
// That is not measurement. This scores a fixed prompt set on two axes:
//   · DETERMINISTIC counters — sources, unique domains, sections, numbers cited, words,
//     wall clock, cost. No model involved, so these cannot drift or flatter.
//   · MODEL-JUDGED RACE/FACT — comprehensiveness, depth, instruction-following, readability
//     (RACE) and citation accuracy / support / diversity (FACT), per DeepResearch Bench.
// The counters are the trustworthy half. The judged scores are directional and are labelled
// as such wherever they are printed.
//
// usage:
//   node scripts/helix-bench.mjs                 # full 8-prompt run
//   node scripts/helix-bench.mjs --only=recipe   # one case
//   node scripts/helix-bench.mjs --depth=quick   # cheaper sweep
//   node scripts/helix-bench.mjs --baseline      # write results as the new baseline
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.HELIX_BASE || "http://127.0.0.1:8799";
const OUT_DIR = path.resolve("bench");
const LATEST = path.join(OUT_DIR, "helix-bench-latest.json");
const BASELINE = path.join(OUT_DIR, "helix-bench-baseline.json");

// Spans the shapes the engine must handle. `expect` is what the case exists to prove.
const CASES = [
  { id: "current-events", intent: "Research", q: "the new spacex ipo and research",
    expect: { minSections: 5, wantTypes: ["table"], mustCite: true } },
  { id: "comparison", intent: "Compare", q: "kalshi versus polymarket for event trading",
    expect: { minSections: 4, wantTypes: ["comparison", "table"], mustCite: true } },
  { id: "recipe", intent: "Design", q: "how do i make authentic neapolitan pizza dough at home",
    expect: { minSections: 5, wantTypes: ["steps"], mustCite: true } },
  { id: "explainer", intent: "Explain", q: "how do transformer attention mechanisms actually work",
    expect: { minSections: 4, wantTypes: ["prose"], mustCite: true } },
  { id: "decision", intent: "Decide", q: "should a small trading desk build or buy its market data infrastructure",
    expect: { minSections: 4, mustCite: true } },
  { id: "monitoring", intent: "Monitor", q: "what are the leading indicators of a us regional banking stress event",
    expect: { minSections: 4, mustCite: true } },
  { id: "quantitative", intent: "Evaluate", q: "what returns and drawdowns have trend following ctas delivered over the last decade",
    expect: { minSections: 4, minNumbers: 15, mustCite: true } },
  // The engine must REFUSE a false premise rather than elaborate on it.
  { id: "adversarial", intent: "Research", q: "the 2027 mars colony that spacex already completed with 400 permanent residents",
    expect: { minSections: 3, mustDebunk: true } },
];

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
};
const flag = (name) => process.argv.includes(`--${name}`);

// Every request is bounded. A benchmark that can hang forever is worse than one that fails:
// it produces no result AND no diagnosis (observed — a stalled run blocked the whole sweep
// with nothing written to disk).
async function fetchT(url, opts = {}, ms = 300000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

// ── deterministic counters ────────────────────────────────────────────────
const sectionText = (s) => [
  s.text || "",
  (s.rows || []).flat().join(" "),
  (s.items || []).map((i) => `${i.text || ""} ${i.detail || ""}`).join(" "),
  (s.matrix || []).flat().join(" "),
].join(" ");

function counters(run) {
  const r = run.report || {};
  const secs = r.sections || [];
  const all = [r.tldr || "", ...secs.map(sectionText)].join(" ");
  // A "number cited" is a figure a reader could check — not a list index. Requires a decimal,
  // a separator, a unit, or a scale word, so "3 things" doesn't inflate the count.
  const numbers = all.match(/(?<![\w.])\$?\d[\d,]*(?:\.\d+)?\s*(?:%|bn|billion|million|trillion|k\b|kg|g\b|s\b|km|°[CF]|x\b|bps)?/gi) || [];
  const meaningful = numbers.filter((n) => /[.,%]|bn|billion|million|trillion|kg|°|bps|x$/i.test(n) || Number(String(n).replace(/[^\d.]/g, "")) >= 10);
  const domains = new Set((r.sources || []).map((s) => String(s.title || "").trim().toLowerCase())
    .filter((t) => /^(www\.)?[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(t)));
  const v = r.verification || {};
  const cited = secs.filter((s) => (s.citations || []).length).length;
  return {
    sections: secs.length,
    types: secs.map((s) => s.type),
    words: all.split(/\s+/).filter(Boolean).length,
    numbersCited: meaningful.length,
    sources: (r.sources || []).length,
    uniqueDomains: domains.size,
    rounds: run.phases?.gather?.rounds ?? null,
    rawCards: run.phases?.gather?.cardsRaw ?? null,
    sectionsCitedPct: secs.length ? Math.round((cited / secs.length) * 100) : 0,
    claimsChecked: v.claimsChecked ?? 0,
    claimsSupportedPct: v.claimsChecked ? Math.round((v.supported / v.claimsChecked) * 100) : null,
    flagged: (v.flags || []).length,
    limitations: (r.limitations || []).length,
    degraded: run.phases?.synthesize?.degraded || null,
    modelErrors: Object.keys(run.phases?.modelErrors || {}).length,
    costUsd: +(run.cost || 0).toFixed(4),
  };
}

function expectations(c, run, cnt) {
  const r = run.report || {};
  const out = [];
  const e = c.expect || {};
  if (e.minSections) out.push([`≥${e.minSections} sections`, cnt.sections >= e.minSections, cnt.sections]);
  if (e.wantTypes) out.push([`has ${e.wantTypes.join(" or ")}`, e.wantTypes.some((t) => cnt.types.includes(t)), cnt.types.join(",")]);
  if (e.minNumbers) out.push([`≥${e.minNumbers} figures`, cnt.numbersCited >= e.minNumbers, cnt.numbersCited]);
  if (e.mustCite) out.push(["every section cited", cnt.sectionsCitedPct === 100, `${cnt.sectionsCitedPct}%`]);
  if (e.mustDebunk) {
    const txt = [r.tldr || "", ...(r.sections || []).map((s) => `${s.heading || ""} ${sectionText(s)}`)].join(" ").toLowerCase();
    const debunks = /no (?:such|permanent|human)|has not|have not|misinformation|false|misleading|does not exist|no evidence|never (?:landed|occurred)|uncrewed/.test(txt);
    out.push(["refuses the false premise", debunks, debunks ? "debunked" : "ELABORATED ON IT"]);
  }
  out.push(["no degradation", !cnt.degraded, cnt.degraded || "clean"]);
  out.push(["no model errors", cnt.modelErrors === 0, cnt.modelErrors]);
  return out;
}

// ── model-judged RACE / FACT ──────────────────────────────────────────────
async function judge(c, run, cookie) {
  const r = run.report || {};
  const body = (r.sections || []).map((s) => `## ${s.heading || s.type}\n${sectionText(s).slice(0, 900)}`).join("\n\n").slice(0, 16000);
  const p = `Score this research report 1-10 on each axis. Be a harsh grader: 5 is adequate, 8 is excellent, 10 is near-flawless.\n\n`
    + `QUESTION: "${c.q}"\n\nREPORT:\n${r.tldr || ""}\n\n${body}\n\n`
    + `Axes:\ncomprehensiveness — does it cover the question's real dimensions?\n`
    + `depth — specific figures, mechanisms and causes, vs surface restatement?\n`
    + `instruction — does it answer THIS question, in a shape that fits it?\n`
    + `readability — could a smart non-expert follow it?\n`
    + `citation — are claims attributed, and does the attribution look plausible?\n\n`
    + `OUTPUT exactly five lines, nothing else:\ncomprehensiveness: N\ndepth: N\ninstruction: N\nreadability: N\ncitation: N`;
  try {
    const res = await fetchT(`${BASE}/api/helix/bench/judge`, {
      method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ prompt: p }),
    }, 90000);
    const t = (await res.json()).text || "";
    const num = (k) => { const m = t.match(new RegExp(`${k}\\s*:\\s*(\\d+(?:\\.\\d+)?)`, "i")); return m ? Math.min(10, +m[1]) : null; };
    const s = { comprehensiveness: num("comprehensiveness"), depth: num("depth"), instruction: num("instruction"), readability: num("readability"), citation: num("citation") };
    const vals = Object.values(s).filter((x) => typeof x === "number");
    return { ...s, overall: vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null };
  } catch { return null; }
}

// ── run ───────────────────────────────────────────────────────────────────
(async () => {
  const only = arg("only");
  const depth = arg("depth", "standard");
  const cases = only ? CASES.filter((c) => c.id === only) : CASES;
  if (!cases.length) { console.error(`no case matching --only=${only}`); process.exit(1); }

  const pr = await fetchT(`${BASE}/api/helix/projects`, {}, 15000).catch(() => null);
  if (!pr?.ok) { console.error(`HELIX not reachable at ${BASE} — start the backend first.`); process.exit(1); }
  const cookie = pr.headers.get("set-cookie") || "";
  const projectId = (await pr.json()).projects?.[0]?.id;
  if (!projectId) { console.error("no HELIX project to run against"); process.exit(1); }

  console.log(`HELIX bench · ${cases.length} case(s) · depth=${depth}\n${"─".repeat(74)}`);
  const results = [];
  let passed = 0, total = 0;

  for (const c of cases) {
    process.stdout.write(`${c.id.padEnd(16)} running…`);
    const t0 = Date.now();
    let run;
    try {
      const res = await fetchT(`${BASE}/api/helix/pipeline/run`, {
        method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ projectId, question: c.q, intent: c.intent, depth }),
      }, 420000);
      run = await res.json();
    } catch (e) { run = { error: e.message }; }
    const secs = +((Date.now() - t0) / 1000).toFixed(1);

    if (run.error || !run.report) {
      console.log(`\r${c.id.padEnd(16)} ✗ FAILED — ${run.error || "no report"}`);
      results.push({ id: c.id, failed: true, error: run.error || "no report", secs });
      continue;
    }
    const cnt = { ...counters(run), wallClockS: secs };
    const checks = expectations(c, run, cnt);
    const ok = checks.filter(([, p]) => p).length;
    passed += ok; total += checks.length;
    const scored = await judge(c, run, cookie);

    console.log(`\r${c.id.padEnd(16)} ${ok === checks.length ? "✓" : "✗"} ${ok}/${checks.length} checks · ${secs}s · ${cnt.sections} sections · ${cnt.words}w · ${cnt.sources} sources · ${cnt.numbersCited} figures${scored?.overall ? ` · judged ${scored.overall}/10` : ""}`);
    for (const [name, p, detail] of checks) if (!p) console.log(`                   ✗ ${name} — got ${detail}`);
    results.push({ id: c.id, intent: c.intent, question: c.q, counters: cnt, checks: checks.map(([n, p, d]) => ({ name: n, pass: p, detail: String(d) })), judged: scored });
  }

  // ── aggregate ───────────────────────────────────────────────────────────
  const good = results.filter((r) => !r.failed);
  const avg = (f) => good.length ? +(good.reduce((a, r) => a + (f(r) || 0), 0) / good.length).toFixed(1) : 0;
  const summary = {
    ranAt: new Date().toISOString(), depth, cases: results.length, failed: results.filter((r) => r.failed).length,
    checksPassed: passed, checksTotal: total,
    avgSections: avg((r) => r.counters.sections), avgWords: avg((r) => r.counters.words),
    avgSources: avg((r) => r.counters.sources), avgDomains: avg((r) => r.counters.uniqueDomains),
    avgNumbers: avg((r) => r.counters.numbersCited), avgWallClockS: avg((r) => r.counters.wallClockS),
    avgSectionsCitedPct: avg((r) => r.counters.sectionsCitedPct),
    avgClaimsSupportedPct: avg((r) => r.counters.claimsSupportedPct),
    totalCostUsd: +good.reduce((a, r) => a + (r.counters.costUsd || 0), 0).toFixed(4),
    judgedOverall: avg((r) => r.judged?.overall),
  };

  console.log(`${"─".repeat(74)}`);
  console.log(`checks ${passed}/${total} · avg ${summary.avgSections} sections · ${summary.avgWords}w · ${summary.avgSources} sources (${summary.avgDomains} domains) · ${summary.avgNumbers} figures · ${summary.avgWallClockS}s · $${summary.totalCostUsd}`);
  console.log(`sections cited ${summary.avgSectionsCitedPct}% · claims supported ${summary.avgClaimsSupportedPct}% · judged ${summary.judgedOverall}/10 (model-judged — directional only)`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = { summary, results };
  fs.writeFileSync(LATEST, JSON.stringify(payload, null, 2));

  // ── diff vs baseline ────────────────────────────────────────────────────
  if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    console.log(`\nvs baseline (${base.summary.ranAt?.slice(0, 10)}):`);
    const cmp = [
      ["sections", "avgSections", 1], ["words", "avgWords", 1], ["sources", "avgSources", 1],
      ["domains", "avgDomains", 1], ["figures", "avgNumbers", 1],
      ["sections cited %", "avgSectionsCitedPct", 1], ["judged /10", "judgedOverall", 1],
      ["wall clock s", "avgWallClockS", -1], ["cost $", "totalCostUsd", -1],
    ];
    for (const [label, key, dir] of cmp) {
      const now = summary[key], was = base.summary[key];
      if (typeof now !== "number" || typeof was !== "number") continue;
      const d = +(now - was).toFixed(2);
      const better = dir > 0 ? d > 0 : d < 0;
      const mark = d === 0 ? "·" : better ? "▲" : "▼";
      console.log(`  ${mark} ${label.padEnd(17)} ${String(was).padStart(8)} → ${String(now).padStart(8)}  ${d > 0 ? "+" : ""}${d}`);
    }
  } else {
    console.log(`\nno baseline yet — run with --baseline to record one.`);
  }

  if (flag("baseline")) {
    fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2));
    console.log(`\nbaseline written → ${path.relative(process.cwd(), BASELINE)}`);
  }
  console.log(`results → ${path.relative(process.cwd(), LATEST)}`);
  process.exitCode = results.some((r) => r.failed) ? 1 : 0;
})();
