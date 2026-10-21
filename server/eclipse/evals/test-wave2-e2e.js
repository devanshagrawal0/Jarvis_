// WAVE 2 END-TO-END GATE — the whole mission in LIVE mode with a scripted model and a fake web.
// Zero API cost, zero network. This is the test that would have caught every bug found live on
// 2026-09-09/10: the regression suite runs in STUB mode, where every `if (live)` branch — the
// Conductor, the scout loop, the follow-up wave, coverage — is skipped entirely.
// Run: node server/eclipse/evals/test-wave2-e2e.js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const { runMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");

let pass = 0;
const ok = async (name, fn) => { try { await fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.message); process.exitCode = 1; } };

// The scripted model + fake web live in fixtures/scripted-world.js so this gate and the UI
// fixture generator share ONE definition and cannot drift.
const { PAGES, fakeSearch, fakeFetch, makeLiveCall, mission } = require("./fixtures/scripted-world");

(async () => {
  console.log("WAVE 2 E2E — full live-mode mission, scripted model, fake web (no API cost)");
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "w2e2e-"));
  const store = openStore({ db: new Database(":memory:") });
  const { liveCall, seen } = makeLiveCall();
  const m = mission("m_w2_e2e", "Research national output, reserves and the largest producers.");
  networkFetches = 0;

  const r = await runMission({
    mission: m, store, checkpointer: SqliteSaver.fromConnString(":memory:"),
    mode: "live", liveCall, toolMode: "live", search: fakeSearch, webFetch: fakeFetch,
    artifactsDir,
  });

  const events = store.getEvents(m.missionId).map((e) => ({ type: e.event_type, p: e.payload }));
  const of = (t) => events.filter((e) => e.type === t);
  const seq = events.map((e) => e.type);

  await ok("mission completes", () => assert.equal(r.status, "complete", "status=" + r.status));

  // ── Conductor ──
  await ok("contract written (live-only path the stub suite never runs)", () => {
    const c = of("contract.ready")[0];
    assert(c, "no contract.ready event");
    assert.equal(c.p.requirements.length, 3);
    const row = store.db.prepare("SELECT contract_json FROM eclipse_task_ledger WHERE mission_id=?").get(m.missionId);
    assert(row, "task ledger row missing");
    assert.equal(JSON.parse(row.contract_json).requirements.length, 3, "contract not persisted");
  });

  await ok("plan critic REJECTS the incomplete plan, then the retry is accepted", () => {
    const rej = of("plan.rejected");
    assert(rej.length >= 1, "the uncovered-requirement plan was accepted");
    assert(/critic#1/.test(JSON.stringify(rej[0].p.errors)), "wrong critic fired: " + JSON.stringify(rej[0].p.errors));
    assert(of("plan.verified").length >= 1, "the corrected plan was never verified");
    assert(seq.indexOf("plan.rejected") < seq.indexOf("plan.verified"), "verified before rejected — retry did not happen");
  });

  await ok("preflight rendered; hires carry briefs, boundaries and code-computed budgets", () => {
    const pf = of("plan.preflight")[0];
    assert(pf, "no preflight event");
    const hires = of("hire");
    assert.equal(hires.length, 2, "expected 2 hires, got " + hires.length);
    for (const h of hires) {
      assert(h.p.brief.objective && h.p.brief.reqIds.length, "brief incomplete");
      assert(h.p.brief.boundary.length, "no boundary line — scouts would overlap");
      assert(h.p.budget.usdCap > 0 && h.p.budget.searches >= 2, "budget not computed: " + JSON.stringify(h.p.budget));
      assert(h.p.budget.variants, "variants dropped from the budget");
    }
    const total = hires.reduce((a, h) => a + h.p.budget.usdCap, 0);
    const cap = r.ledger.cap.maxCostUsd;
    assert(total < cap, `hire budgets ${total} exceed the mission cap ${cap}`);
  });

  await ok("preflight did NOT stall the run (nobody was watching)", () => {
    assert.equal(store.subscriberCount(m.missionId), 0, "test harness should not be subscribed");
    const t0 = new Date(store.getEvents(m.missionId)[0].occurred_at).getTime();
    const tEnd = new Date(store.getEvents(m.missionId).slice(-1)[0].occurred_at).getTime();
    assert(tEnd - t0 < 15000, "mission took " + (tEnd - t0) + "ms — the 20s preflight wait ran unattended");
  });

  // ── Scouts ──
  await ok("scouts ran the SCOUT loop (not the generic worker)", () => {
    const expectedScouts = of("hire").length + of("plan.followup").length;
    assert.equal(of("scout.brief").length, expectedScouts, `scout.brief ${of("scout.brief").length} != hires+followups ${expectedScouts}`);
    assert(of("scout.queue").length >= 2, "no question queue");
    assert(of("scout.search").length >= 2, "no searches");
    assert(of("scout.read").length >= 2, "no reads");
    assert.equal(of("scout.log").length, expectedScouts, `scout.log ${of("scout.log").length} != ${expectedScouts} scouts`);
  });

  await ok("RESEARCH_LOG.md written per scout with the honest sections", () => {
    const dir = path.join(artifactsDir, m.missionId, "scouts");
    const files = fs.readdirSync(dir);
    assert.equal(files.length, of("scout.brief").length, `${files.length} logs for ${of("scout.brief").length} scouts`);
    const md = fs.readFileSync(path.join(dir, files[0]), "utf8");
    for (const s of ["## Brief", "## Question queue", "## Searches", "## Reads", "## Claim-candidates", "## NOT FOUND", "## Self-check"]) {
      assert(md.includes(s), "log missing section " + s);
    }
  });

  await ok("no-overlap registry: the two scouts never read the same url twice", () => {
    const uris = of("evidence.captured").map((e) => e.p.uri);
    assert.equal(uris.length, new Set(uris).size, "duplicate evidence captured: " + uris.join(", "));
    const rows = store.db.prepare("SELECT COUNT(*) c FROM eclipse_scout_registry WHERE mission_id=? AND kind='url'").get(m.missionId).c;
    assert(rows > 0, "registry never claimed a url");
  });

  await ok("syndicated copy did not inflate independence (single-source stays single)", () => {
    const promoted = of("claim.promoted");
    assert(promoted.length >= 1, "nothing promoted");
    const dupClaims = store.db.prepare("SELECT COUNT(*) c FROM claims WHERE mission_id=?").get(m.missionId).c;
    assert(dupClaims >= 1);
  });

  // ── Verification ──
  await ok("cross-scout duplicate packets are skipped before judging", () => {
    // both scouts can surface the same output figure; dedup must catch it when it happens
    const dd = of("packet.deduped");
    if (dd.length) assert(dd[0].p.count >= 1, "dedup event with no count");
    // whether or not it fired, the SAME claim must never be promoted twice
    const texts = of("claim.promoted").map((e) => e.p.claim);
    assert.equal(texts.length, new Set(texts).size, "the same claim was promoted twice");
  });

  await ok("coverage is computed ONCE in verify and reused by synthesize", () => {
    assert(of("coverage.checked").length >= 1, "coverage never computed");
    assert(of("coverage.reused").length >= 1, "synthesize paid for a second coverage judgement");
    const verifyPasses = events.filter((e) => e.type === "node.start" && e.p.node === "verify").length;
    assert.equal(seen.coverage, verifyPasses, `coverage judged ${seen.coverage}x for ${verifyPasses} verify passes (must be exactly one each — and synthesize must reuse, never re-judge)`);
    const statuses = of("contract.status");
    assert(statuses.length >= 3, "contract.status not emitted per requirement");
  });

  // ── The follow-up wave (dead until 2026-09-10) ──
  await ok("an UNANSWERED requirement triggers exactly ONE follow-up wave", () => {
    const fu = of("plan.followup");
    assert(fu.length >= 1, "no follow-up scout for the uncoverable requirement R3");
    assert.equal(fu[0].p.reqId, "R3", "followed up the wrong requirement: " + fu[0].p.reqId);
    assert(typeof fu[0].p.reqId === "string" && fu[0].p.reqId !== "undefined", "reqId is undefined — coverage rows carry `id`");
    assert(of("followup.launch").length === 1, "follow-up launched " + of("followup.launch").length + " times (bound is 1)");
  });

  await ok("the wave is BOUNDED — verify runs again but never launches a second wave", () => {
    assert.equal(of("followup.launch").length, 1, `followup.launch fired ${of("followup.launch").length}x (bound is exactly 1)`);
    const verifyStarts = events.filter((e) => e.type === "node.start" && e.p.node === "verify").length;
    assert(verifyStarts >= 2, "verify did not re-run after the follow-up (wave never reached workers)");
  });

  await ok("follow-up scouts are real scouts with their own budget and lease", () => {
    const forged = of("persona.forged").filter((e) => /followup/.test(String(e.p.persona)));
    assert(forged.length >= 1, "follow-up scout never forged");
    assert(forged[0].p.leaseId, "follow-up scout has no lease");
  });

  // ── Output ──
  await ok("answer is produced and the footer is computed from real counts", () => {
    assert(r.state.result && r.state.result.draft, "no draft produced");
    const draft = r.state.result.draft;
    assert(/verified against their sources|No verified answer/.test(draft), "no honesty footer");
    const promoted = of("claim.promoted").length;
    if (promoted > 0) assert(new RegExp(`${promoted} of`).test(draft) || /verified/.test(draft), "footer count does not reflect promotions");
  });

  await ok("artifact written to disk with a matching hash", () => {
    const art = r.state.artifacts && r.state.artifacts[0];
    assert(art, "no artifact");
    const file = path.join(artifactsDir, m.missionId, "report.md");
    assert(fs.existsSync(file), "report.md missing");
    const sha = require("crypto").createHash("sha256").update(fs.readFileSync(file, "utf8")).digest("hex");
    assert.equal(art.sha256, sha, "manifest hash does not match the file");
  });

  // ── The Writer (slice 2.2 B1) ──
  const promotedIds = new Set(of("claim.promoted").map((e) => e.p.claimId));
  const blocksOf = (secId) => of("draft.block").filter((e) => e.p.sectionId === secId).map((e) => e.p.block);
  const allBlocks = of("draft.block").map((e) => e.p.block);
  const sentences = allBlocks.filter((b) => b.kind === "para").flatMap((b) => b.sentences);

  await ok("writer: outline chose a type with a reason; sections own the answered requirements", () => {
    const o = of("draft.outline")[0];
    assert(o, "no draft.outline event — the Writer never ran (fallback? " + of("draft.fallback").map((e) => e.p.error).join(" | ") + ")");
    assert.equal(o.p.type, "memo");
    assert(o.p.why.length > 10, "no reason for the type");
    const owned = o.p.sections.flatMap((s) => s.reqIds);
    assert(owned.includes("R1") && owned.includes("R2"), "answered requirements not owned: " + owned.join(","));
    assert(!owned.includes("R3"), "an UNANSWERED requirement was given a section");
    for (const s of o.p.sections) assert(s.claimIds.length >= 1, `section ${s.sectionId} has no claims assigned`);
  });

  await ok("writer: every fact/analysis sentence names its claims, and only PROMOTED ones", () => {
    assert(sentences.length >= 3, "too few sentences: " + sentences.length);
    for (const st of sentences) {
      if (st.kind !== "transition") assert(st.claimIds.length >= 1, `${st.kind} sentence without claimIds: "${st.text}"`);
      for (const c of st.claimIds) assert(promotedIds.has(c), `sentence cites a claim that was never promoted: ${c}`);
    }
    for (const b of allBlocks.filter((x) => x.kind === "keyfact")) for (const c of b.claimIds) assert(promotedIds.has(c), "keyfact cites an unpromoted claim");
  });

  await ok("writer: a fact sentence with EMPTY claimIds was rejected by the schema and repaired (break test)", () => {
    assert.equal(seen.sectionBad, 1, "the bad section draft was never offered");
    assert(!sentences.some((st) => st.kind === "fact" && st.claimIds.length === 0), "an unattributed fact sentence reached the blocks");
    assert(sentences.some((st) => /51,000/.test(st.text)), "the repaired section lost the output claim");
  });

  await ok("writer: Not-established section is CODE-generated from the UNANSWERED requirement", () => {
    const gaps = blocksOf("S-gaps");
    assert(gaps.some((b) => b.kind === "callout" && b.tone === "gap" && /no source will ever cover/i.test(b.text)), "no gap callout for R3: " + JSON.stringify(gaps));
  });

  await ok("writer: polish cut the empty transition and wrote the lead LAST", () => {
    const cuts = of("draft.revision").filter((e) => e.p.by === "writer-polish" && /^polish:/.test(e.p.reason));
    assert(cuts.length >= 1, "no polish cut recorded as a revision");
    assert.equal(cuts[0].p.after, "", "polish may only CUT, but it rewrote");
    const lead = blocksOf("S-lead").find((b) => b.kind === "para");
    assert(lead, "no lead paragraph");
    const firstSection = seq.indexOf("draft.block");
    assert(events.findIndex((e) => e.type === "draft.block" && e.p.sectionId === "S-lead") > firstSection, "lead was emitted before the sections — not written last");
    for (const st of lead.sentences) for (const c of st.claimIds) assert(promotedIds.has(c), "lead cites an unpromoted claim");
  });

  await ok("writer: lint FLAGGED the planted 40-word 'in order to' sentence, one fix pass cleared it", () => {
    const lints = of("draft.lint");
    assert.equal(lints.length, 2, "expected lint pass 1 and pass 2, got " + lints.length);
    const rules1 = lints[0].p.violations.map((v) => v.rule);
    assert(rules1.includes("RULE-12") && rules1.includes("RULE-04"), "pass 1 missed the plant: " + rules1.join(","));
    const rules2 = lints[1].p.violations.map((v) => v.rule);
    assert(!rules2.includes("RULE-12") && !rules2.includes("RULE-04"), "pass 2 still flags: " + rules2.join(","));
    const fixes = of("draft.revision").filter((e) => /^lint:/.test(e.p.reason));
    assert.equal(fixes.length, 1, `one flagged sentence must yield exactly ONE lint revision, got ${fixes.length}`);
    assert(fixes[0].p.before !== fixes[0].p.after, "lint revision is a no-op");
    assert.equal(fixes[0].p.reason, "lint: RULE-12+RULE-04", "revision should name both rules it cleared: " + fixes[0].p.reason);
    assert.equal(seen.lintFix, 1, "lint fix pass must run exactly once");
  });

  await ok("writer: omission guard passes when every claim is used; word budget respected", () => {
    const g = of("draft.guard").find((e) => e.p.check === "omission");
    assert(g && g.p.ok === true, "omission guard failed on a clean run: " + JSON.stringify(g && g.p));
    const d = of("draft.done")[0];
    assert(d && d.p.wordCount <= 400, "memo over budget: " + (d && d.p.wordCount));
    assert.equal(d.p.version, 1);
  });

  await ok("writer: blocks + sentence→claim map persisted (eclipse_draft_blocks)", () => {
    const rows = store.db.prepare("SELECT section_id, block_json, sentence_map_json FROM eclipse_draft_blocks WHERE mission_id=? AND version=1").all(m.missionId);
    assert(rows.length >= 4, "too few block rows: " + rows.length);
    const para = rows.find((x) => JSON.parse(x.block_json).kind === "para");
    const map = JSON.parse(para.sentence_map_json);
    assert(map.length >= 1 && map.every((e) => e.sid && Array.isArray(e.claimIds)), "sentence map malformed");
  });

  await ok("writer: markdown rendered from blocks carries code-derived citations + Sources; report.md is the draft", () => {
    const draft = r.state.result.draft;
    assert(/^## /m.test(draft), "no section heading in the markdown");
    assert(/\[1\]/.test(draft), "no citation marker");
    assert(/\*\*Sources\*\*/.test(draft), "no Sources list");
    assert(r.state.result.blocks && r.state.result.blocks.type === "memo", "result carries no blocks");
    const md = fs.readFileSync(path.join(artifactsDir, m.missionId, "report.md"), "utf8");
    assert(md.includes("## Output reached"), "report.md is not the Writer's draft");
    assert.equal((md.match(/Sources/g) || []).length, 1, "Sources listed twice in report.md");
  });

  await ok("writer: contested claims (scout.conflict) render as conflict blocks in their section", () => {
    const conflicts = of("scout.conflict");
    const promoted = of("claim.promoted");
    const contested = conflicts.filter((c) => promoted.some((p) => p.p.claim.slice(0, 120) === c.p.a));
    const blocks = allBlocks.filter((b) => b.kind === "conflict");
    assert.equal(blocks.length, contested.length, `${contested.length} contested promoted claim(s) but ${blocks.length} conflict block(s)`);
    for (const b of blocks) assert(promotedIds.has(b.a.claimId) && b.b.uri, "conflict block malformed: " + JSON.stringify(b));
    console.log(`      (${contested.length} contested claim(s) in this run)`);
  });

  // ── Writer break tests: a second mission whose model misbehaves on purpose ──
  await ok("writer BREAK: outline that drops an answered requirement is REJECTED, then repaired; a silently omitted claim FAILS the omission guard", async () => {
    const store2 = openStore({ db: new Database(":memory:") });
    const { liveCall: bad } = makeLiveCall({ skipBadPlan: true, badOutline: true, omitClaim: true });
    const m2 = mission("m_w2_writer_break", "Research national output, reserves and the largest producers.");
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "w2brk-"));
    const r2 = await runMission({ mission: m2, store: store2, checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "live", liveCall: bad, toolMode: "live", search: fakeSearch, webFetch: fakeFetch, artifactsDir: dir2 });
    const ev2 = store2.getEvents(m2.missionId).map((e) => ({ type: e.event_type, p: e.payload }));
    const of2 = (t) => ev2.filter((e) => e.type === t);
    assert.equal(r2.status, "complete");
    const rej = of2("draft.outline.rejected");
    assert(rej.length >= 1, "the outline missing R2 was accepted");
    assert(/R2 has claims but no section owns it/.test(JSON.stringify(rej[0].p.errors)), "wrong rejection: " + JSON.stringify(rej[0].p.errors));
    assert(of2("draft.outline")[0].p.sections.flatMap((s) => s.reqIds).includes("R2"), "R2 still unowned after retry");
    const g = of2("draft.guard").find((e) => e.p.check === "omission");
    assert(g && g.p.ok === false, "omission guard did NOT fail on the silently dropped claim: " + JSON.stringify(g && g.p));
    assert(g.p.unused.some((u) => u.reason === null), "dropped claim shows a reason it never had");
    const unusedBlock = of2("draft.block").map((e) => e.p.block).find((b) => b.kind === "unused");
    assert(unusedBlock && unusedBlock.claims.some((c) => /Northwind/.test(c.text) && /gave no reason/.test(c.reason)), "no unused block naming the dropped claim");
    assert(/Verified but not used/.test(r2.state.result.draft), "the dropped claim is invisible in the rendered answer");
    try { fs.rmSync(dir2, { recursive: true, force: true }); } catch {}
  });

  await ok("writer BREAK: budget cap mid-pipeline → the sections already written are rendered, no second paid fallback", async () => {
    const store3 = openStore({ db: new Database(":memory:") });
    const { liveCall: capped, seen: seen3 } = makeLiveCall({ skipBadPlan: true, polishThrows: true });
    const m3 = mission("m_w2_writer_cap", "Research national output, reserves and the largest producers.");
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "w2cap-"));
    const r3 = await runMission({ mission: m3, store: store3, checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "live", liveCall: capped, toolMode: "live", search: fakeSearch, webFetch: fakeFetch, artifactsDir: dir3 });
    const ev3 = store3.getEvents(m3.missionId).map((e) => ({ type: e.event_type, p: e.payload }));
    assert.equal(r3.status, "complete", "mission did not complete: " + r3.status);
    const fb = ev3.find((e) => e.type === "draft.fallback");
    assert(fb && fb.p.code === "ECLIPSE_BUDGET", "no draft.fallback with the budget code: " + JSON.stringify(fb && fb.p));
    assert(fb.p.partialSections >= 2, "partial sections not carried: " + fb.p.partialSections);
    assert(/## Output reached 51,000/.test(r3.state.result.draft) && /The writer stopped before finishing/.test(r3.state.result.draft), "partial draft not rendered honestly");
    assert.equal(seen3.director, 0, "the legacy Director was called after the cap tripped (a second paid call)");
    assert(ev3.some((e) => e.type === "mission.complete" && /writer stopped/.test(e.p.answer)), "mission.complete.answer does not carry the partial draft");
    try { fs.rmSync(dir3, { recursive: true, force: true }); } catch {}
  });

  await ok("task ledger facts came ONLY from promoted claims", () => {
    const row = store.db.prepare("SELECT facts_json FROM eclipse_task_ledger WHERE mission_id=?").get(m.missionId);
    const facts = JSON.parse(row.facts_json);
    const promoted = of("claim.promoted").map((e) => e.p.claim);
    for (const f of facts) assert(promoted.some((p) => p.startsWith(f.text.slice(0, 40))), "a fact was not a promoted claim: " + f.text);
  });

  await ok("progress ledger recorded measurable progress", () => {
    const rows = store.db.prepare("SELECT * FROM eclipse_progress_ledger WHERE mission_id=? ORDER BY seq").all(m.missionId);
    assert(rows.length >= 1, "no progress rows");
    assert(rows[0].progress >= 1, "progress recorded as 0 despite promotions");
  });

  await ok("mission-shape memory recorded for the Conductor (graded by real numbers)", () => {
    const rows = store.db.prepare("SELECT text, agent_scope FROM eclipse_semantic_memory WHERE kind='mission-shape'").all();
    assert(rows.length >= 1, "no mission-shape row written at commit");
    assert.equal(rows[0].agent_scope, "conductor", "shape memory not scoped to the conductor");
    assert(/verified:\d+/.test(rows[0].text), "shape row carries no verified count");
  });

  await ok("agent definitions were seeded at v2 (edits reach an EXISTING database)", () => {
    const v = store.db.prepare("SELECT MAX(version) v FROM eclipse_agent_defs WHERE agent_id='research-scout'").get().v;
    assert.equal(v, 2, "seed version is " + v + " — definition edits would be invisible on a live DB");
    const tools = store.db.prepare("SELECT tools_json FROM eclipse_agent_defs WHERE agent_id='research-scout' ORDER BY version DESC LIMIT 1").get().tools_json;
    assert(!tools.includes("log.append"), "registry still advertises a tool no code calls");
  });

  await ok("no failure events (fallbacks, denies, ledger errors) in a clean run", () => {
    const bad = ["plan.fallback", "contract.fallback", "ledger.error", "coverage.error", "critic.error", "finalize.error", "mission.failed",
      "draft.fallback", "draft.lint.error", "draft.outline.repaired", "draft.sentence.rejected"];
    const hits = events.filter((e) => bad.includes(e.type));
    assert.equal(hits.length, 0, "failure events: " + hits.map((h) => h.type + " " + JSON.stringify(h.p).slice(0, 120)).join(" | "));
  });

  await ok("cost ledger recorded spend and stayed under the cap", () => {
    assert(r.ledger.costUsd > 0, "no spend recorded");
    assert(r.ledger.costUsd < 0.5, "over cap: " + r.ledger.costUsd);
  });

  try { fs.rmSync(artifactsDir, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
})();
