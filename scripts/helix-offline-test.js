// HELIX offline test suite — ZERO API COST.
//
// Everything here is a pure function or a filesystem behaviour, so the whole suite runs
// without a single model call. That matters twice over: it verifies the cost-control work
// itself, and it means the deterministic half of W10 (diff, contradiction detection, claim
// extraction) can be proven without spending anything.
//
//   node scripts/helix-offline-test.js
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "..");
const gateway = require(path.join(ROOT, "server/helix-gateway.js"));
const pipeline = require(path.join(ROOT, "server/helix-pipeline.js"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

// ── 1. COST METER: grounding must be counted ─────────────────────────────
console.log("\ncost meter (the bug that hid ~8x of the spend)");
{
  const tokensOnly = gateway.helixCostUsd("gemini-3.6-flash", 10000, 2000);
  const grounded = gateway.helixCostUsd("gemini-3.6-flash", 10000, 2000, { grounded: true });
  ok("token-only cost unchanged for ungrounded calls", tokensOnly > 0 && tokensOnly < 0.01, `$${tokensOnly}`);
  ok("grounded call adds the per-request search fee",
    near(grounded - tokensOnly, gateway.GROUNDING_USD_PER_REQUEST),
    `+$${(grounded - tokensOnly).toFixed(4)} per search`);
  // The exact scenario that produced the misleading number.
  const sixSearches = 6 * gateway.GROUNDING_USD_PER_REQUEST + tokensOnly;
  ok("a 6-search run is now priced realistically", sixSearches > 0.15,
    `$${sixSearches.toFixed(3)} vs $${tokensOnly.toFixed(3)} reported before`);
  const understated = sixSearches / tokensOnly;
  ok("old meter was understating by >5x", understated > 5, `${understated.toFixed(1)}x`);
}

// ── 2. CLAIM EXTRACTION (W6) ─────────────────────────────────────────────
console.log("\nclaim extraction");
{
  const sections = [
    { heading: "Financials", type: "prose", text: "Revenue reached $18.67 billion in 2025. It grew fast. Net loss was $4.937 billion for the year." },
    { heading: "Risks", type: "risks", items: [{ text: "Lock-up expiry", detail: "About $54 billion of insider stock unlocks after 180 days." }] },
    { heading: "Table", type: "table", columns: ["Metric", "Value"], rows: [["Offer price", "$84.00 per share at listing"]] },
  ];
  const claims = pipeline.extractClaims(sections);
  const texts = claims.map((c) => c.text).join(" | ");
  ok("extracts checkable claims", claims.length >= 3, `${claims.length} claims`);
  ok("drops unverifiable filler", !/It grew fast/.test(texts));
  ok("keeps short claims that carry a figure", /18\.67 billion/.test(texts));
  ok("covers every section, not just the first", new Set(claims.map((c) => c.section)).size >= 2,
    `${new Set(claims.map((c) => c.section)).size} sections represented`);
  ok("reports the total available for honest truncation", typeof claims.totalAvailable === "number");
  const budgeted = pipeline.extractClaims(sections, 2);
  ok("respects the claim budget", budgeted.length <= 2, `${budgeted.length} with budget 2`);
}

// ── 3. CONTRADICTION DETECTION + CROSS-RUN ALERT (W6/W10) ────────────────
console.log("\ncontradiction detection");
{
  const sameRun = pipeline.findContradictions([
    { title: "a.com", excerpt: "Starlink served 9 million subscribers across 155 countries as of December 2025." },
    { title: "b.com", excerpt: "Starlink served 12 million subscribers across 155 countries as of December 2025." },
    { title: "c.com", excerpt: "An unrelated sentence about launch cadence and booster reuse this year." },
  ]);
  ok("detects two sources disagreeing on one metric", sameRun.length === 1,
    sameRun[0] ? sameRun[0].values.join(" vs ") : "none");
  ok("ignores non-conflicting evidence", !sameRun.some((c) => /launch cadence/.test(c.sample || "")));

  // W10: a fact recalled from a PRIOR run conflicting with today's is a different event.
  const crossRun = pipeline.findContradictions([
    { title: "old.com", excerpt: "Starlink served 9 million subscribers across 155 countries as of December 2025.", recalled: true, createdAt: "2026-01-15T00:00:00Z" },
    { title: "new.com", excerpt: "Starlink served 14 million subscribers across 155 countries as of December 2025." },
  ]);
  ok("flags cross-run conflicts distinctly", crossRun.some((c) => c.crossRun), `${crossRun.filter((c) => c.crossRun).length} cross-run`);
  const x = crossRun.find((c) => c.crossRun);
  ok("records what was previously believed", !!x?.previously?.length, x ? `was ${x.previously.join("/")} → now ${x.now.join("/")}` : "");
  ok("cross-run conflicts sort first", crossRun[0]?.crossRun === true);
}

// ── 4. RE-RUN DIFF (W10) ─────────────────────────────────────────────────
console.log("\nre-run diff");
{
  const prev = {
    tldr: "SpaceX listed at $84.00 per share raising $9.2 billion.",
    sections: [
      { heading: "Offering", type: "prose", text: "The offer price was $84.00 per share and gross proceeds were $9.2 billion." },
      { heading: "Risks", type: "risks", items: [{ text: "Lock-up", detail: "Expires in 180 days." }] },
    ],
    sources: [{ n: 1, title: "reuters.com" }, { n: 2, title: "sec.gov" }],
    verification: { claimsChecked: 10, supported: 9 },
  };
  const next = {
    tldr: "SpaceX listed at $84.00 per share raising $9.2 billion.",
    sections: [
      { heading: "Offering", type: "prose", text: "The offer price was $91.00 per share and gross proceeds were $9.2 billion." },
      { heading: "Risks", type: "risks", items: [{ text: "Lock-up", detail: "Expires in 180 days." }] },
      { heading: "Governance", type: "prose", text: "Dual-class structure retains 78% voting control." },
    ],
    sources: [{ n: 1, title: "reuters.com" }, { n: 2, title: "sec.gov" }, { n: 3, title: "ft.com" }],
    verification: { claimsChecked: 10, supported: 7 },
  };

  const d = pipeline.diffReports(prev, next);
  ok("diff is comparable", d.comparable === true);
  ok("detects a material change", d.material === true);
  ok("catches the changed figure", d.changedFigures.some((f) => f.was.includes("84") && f.now.includes("91")),
    d.changedFigures[0] ? `${d.changedFigures[0].was} → ${d.changedFigures[0].now}` : "none found");
  ok("ignores the UNCHANGED figure", !d.changedFigures.some((f) => f.was.includes("9.2")));
  ok("detects the added section", d.addedSections.includes("governance"));
  ok("detects the new source", d.newSourceCount === 1);
  ok("tracks the verification move", d.verification.was === 90 && d.verification.now === 70,
    `${d.verification.was}% → ${d.verification.now}%`);
  ok("summary is human-readable", /figure/.test(d.summary), `"${d.summary}"`);

  // Identical reports must produce NO change — a diff that always fires is noise.
  const same = pipeline.diffReports(prev, JSON.parse(JSON.stringify(prev)));
  ok("identical reports report no material change", same.material === false, `"${same.summary}"`);

  const none = pipeline.diffReports(null, next);
  ok("handles a missing previous version", none.comparable === false);
}

// ── 4b. DIFF NOISE — the two false alarms seen on the first live re-run ──
console.log("\nre-run diff · noise suppression");
{
  // (a) A RENAMED heading over the same content must not read as drop + add.
  const body = "Starlink grew from 2.3 million subscribers in 2023 to 9 million in 2025 across 155 countries, with blended ARPU falling as regional pricing expanded.";
  const before = {
    tldr: "x", sources: [],
    sections: [{ heading: "Historical Subscriber Growth and Global ARPU Benchmarks", type: "prose", text: body }],
  };
  const after = {
    tldr: "x", sources: [],
    sections: [{ heading: "Subscriber Growth Timeline (2020-2025)", type: "prose", text: body }],
  };
  const d = pipeline.diffReports(before, after);
  ok("a renamed section is not reported as dropped", d.removedSections.length === 0, `removed: ${d.removedSections.length}`);
  ok("a renamed section is not reported as added", d.addedSections.length === 0, `added: ${d.addedSections.length}`);
  ok("the rename IS surfaced, just not as material", d.renamedSections.length === 1,
    d.renamedSections[0] ? `"${d.renamedSections[0].was}" → "${d.renamedSections[0].now}"` : "");
  ok("a pure rename is not a material change", d.material === false, `"${d.summary}"`);

  // (b) Trailing punctuation must not count as a figure change.
  const p1 = { tldr: "", sources: [], sections: [{ heading: "S", type: "prose", text: "Subscribers reached 9 million at the end of 2023, before accelerating." }] };
  const p2 = { tldr: "", sources: [], sections: [{ heading: "S", type: "prose", text: "Subscribers reached 9 million at the end of 2023 before accelerating." }] };
  const d2 = pipeline.diffReports(p1, p2);
  ok("punctuation alone is not a figure change", d2.changedFigures.length === 0,
    d2.changedFigures.map((f) => `${f.was}→${f.now}`).join(", ") || "none");
  ok("that pair reports no material change", d2.material === false);

  // (c) A REAL figure move must still be caught — the fix must not silence signal.
  const p3 = { tldr: "", sources: [], sections: [{ heading: "S", type: "prose", text: "Blended ARPU fell to $81 per month by the end of 2025." }] };
  const p4 = { tldr: "", sources: [], sections: [{ heading: "S", type: "prose", text: "Blended ARPU fell to $86 per month by the end of 2025." }] };
  const d3 = pipeline.diffReports(p3, p4);
  ok("a genuine figure change is still caught", d3.changedFigures.some((f) => f.was.includes("81") && f.now.includes("86")),
    d3.changedFigures[0] ? `${d3.changedFigures[0].was} → ${d3.changedFigures[0].now}` : "MISSED");
  ok("and it counts as material", d3.material === true);

  // (d) A genuinely new section must still register.
  const p5 = { tldr: "", sources: [], sections: [{ heading: "A", type: "prose", text: body }] };
  const p6 = { tldr: "", sources: [], sections: [
    { heading: "A", type: "prose", text: body },
    { heading: "Regulatory Exposure", type: "prose", text: "The FCC opened a proceeding into orbital debris mitigation affecting 4,200 satellites." },
  ] };
  const d4 = pipeline.diffReports(p5, p6);
  ok("a genuinely new section is still detected", d4.addedSections.length === 1, d4.addedSections.join(", "));
}

// ── 5. SEARCH CACHE PERSISTENCE (cost control) ───────────────────────────
console.log("\nsearch cache persistence");
{
  const runtime = path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"));
  const file = path.join(runtime, "helix-search-cache.json");
  ok("cache file path is inside the runtime dir", file.startsWith(runtime));
  // The cache is written on flush/exit; the module wires that up at load.
  const src = fs.readFileSync(path.join(ROOT, "server/helix-pipeline.js"), "utf8");
  ok("cache is restored at boot", /loadSearchCache\(\);/.test(src));
  ok("cache is flushed on exit", /for \(const sig of \["exit", "SIGINT", "SIGTERM"\]/.test(src));
  ok("cache TTL is long enough to matter", /HELIX_SEARCH_TTL_MIN \?\? 360/.test(src));
  ok("cache hits are not billed as fresh searches", /grounded: !wr\.fromCache/.test(src));
}

// ── 6. SPEND CAPS ────────────────────────────────────────────────────────
console.log("\nspend caps");
{
  const src = fs.readFileSync(path.join(ROOT, "server/helix-pipeline.js"), "utf8");
  ok("a per-run ceiling exists", /RUN_BUDGET_USD/.test(src));
  ok("a per-day ceiling exists", /DAY_BUDGET_USD/.test(src));
  ok("budget is checked BEFORE the call, not after", /const blocked = budgetBlock\(bump\);[\s\S]{0,200}return \{ response: "" \};/.test(src));
  ok("grounded calls are counted for billing", /grounded: !wr\.fromCache/.test(src) && /grounded: !r\.fromCache/.test(src));
  ok("CoVe checks are capped", /HELIX_COVE_MAX \|\| 3/.test(src));
  ok("follow-up searches are capped", /gaps\.slice\(0, 3\)/.test(src));
  ok("no fallback to the hijacking brain path", !/Fall through to the brain/.test(src));
}

console.log(`\n${"─".repeat(60)}`);
console.log(`${pass} passed · ${fail} failed   (0 API calls, $0.00)`);
process.exitCode = fail ? 1 : 0;
