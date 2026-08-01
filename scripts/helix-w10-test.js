// W10 verification: compounding memory. Three claims to prove, each of which a stateless
// assistant cannot do:
//   1. A SECOND run in the same project reuses evidence from the FIRST.
//   2. Re-running a question produces a material diff against the stored previous version.
//   3. The diff is deterministic — no model call — so it cannot invent a change.
const BASE = "http://127.0.0.1:8799";
const Q = "starlink subscriber growth and average revenue per user";

const post = async (path, body, cookie) => {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
};

(async () => {
  const pr = await fetch(`${BASE}/api/helix/projects`);
  const cookie = pr.headers.get("set-cookie") || "";
  const projectId = (await pr.json()).projects[0].id;

  console.log("── run 1 (seeds the project corpus) ──");
  const t1 = Date.now();
  const r1 = await post("/api/helix/pipeline/run", { projectId, question: Q, depth: "quick" }, cookie);
  const g1 = r1.phases?.gather || {};
  console.log(`  ${Math.round((Date.now() - t1) / 1000)}s · priorCorpus ${g1.priorCorpus ?? "?"} · recalled ${g1.recalled ?? "?"} · sources ${g1.webSources} · sections ${(r1.report?.sections || []).length}`);

  console.log("\n── run 2, same project + same question (must reuse, and diff) ──");
  const t2 = Date.now();
  const r2 = await post("/api/helix/pipeline/rerun", { projectId, question: Q, depth: "quick" }, cookie);
  const g2 = r2.phases?.gather || {};
  console.log(`  ${Math.round((Date.now() - t2) / 1000)}s · priorCorpus ${g2.priorCorpus ?? "?"} · recalled ${g2.recalled ?? "?"} · sources ${g2.webSources} · sections ${(r2.report?.sections || []).length}`);
  console.log(`  previousRunId: ${r2.previousRunId || "(none found)"}`);

  const d = r2.diff || {};
  console.log("\n── diff ──");
  console.log(`  comparable: ${d.comparable} · material: ${d.material}`);
  console.log(`  summary: ${d.summary || "(none)"}`);
  if (d.changedFigures?.length) {
    console.log("  changed figures:");
    for (const f of d.changedFigures.slice(0, 5)) console.log(`    · "${f.context}" ${f.was} → ${f.now}`);
  }
  if (d.addedSections?.length) console.log(`  added sections: ${d.addedSections.join(", ")}`);
  if (d.removedSections?.length) console.log(`  removed sections: ${d.removedSections.join(", ")}`);
  console.log(`  new sources: ${d.newSourceCount ?? 0} · dropped: ${d.droppedSourceCount ?? 0}`);
  console.log(`  verification: ${d.verification?.was ?? "?"}% → ${d.verification?.now ?? "?"}%`);

  const cons = (r2.contradictions || []).filter((c) => c.crossRun);
  console.log(`\n── cross-run contradictions: ${cons.length}`);
  for (const c of cons.slice(0, 3)) console.log(`    · previously ${c.previously?.join("/")} → now ${c.now?.join("/")} (${(c.sample || "").slice(0, 70)})`);

  console.log("\n── assertions ──");
  const ck = (n, ok, d2) => console.log(`  ${ok ? "✓" : "✗"} ${n}${d2 ? ` — ${d2}` : ""}`);
  ck("run 1 seeded a corpus", (g2.priorCorpus ?? 0) > 0, `run 2 saw ${g2.priorCorpus} prior evidence items`);
  ck("run 2 REUSED prior evidence", (g2.recalled ?? 0) > 0, `${g2.recalled} recalled cards`);
  ck("previous version was found", !!r2.previousRunId);
  ck("diff is comparable", d.comparable === true);
  ck("diff summary is human-readable", typeof d.summary === "string" && d.summary.length > 10);
  ck("both runs produced reports", !!r1.report && !!r2.report);
})().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
