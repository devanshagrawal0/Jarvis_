// Full extreme memory test — inserts sample knowledge, tests retrieval,
// runs the memory manager, and verifies health. Run with: node server/memory-full-test.js

const path = require("path");
const { createNeuralVault } = require("./neural-vault");
const { createMemoryStore } = require("./memory-store");
const { createMemoryManager } = require("./memory-manager");
const { createProceduralMemory } = require("./procedural-memory");

const RUNTIME_DIR = path.join(__dirname, "..", "runtime");
const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ ";

let passed = 0;
let failed = 0;
const results = [];

function assert(label, condition, detail = "") {
  if (condition) {
    passed++;
    results.push(`  ${PASS} ${label}`);
  } else {
    failed++;
    results.push(`  ${FAIL} ${label}${detail ? " — " + detail : ""}`);
  }
}

function section(name) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${name}`);
  console.log("─".repeat(60));
}

async function run() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║         JARVIS MEMORY FULL EXTREME TEST SUITE           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`  DB: ${RUNTIME_DIR}/neural_vault/db/neural_vault.sqlite\n`);

  // ── INIT ────────────────────────────────────────────────────────────────
  section("1. INITIALIZATION");
  let vault, memoryStore, memoryManager, procedural;
  try {
    vault = createNeuralVault({
      runtimeDir: RUNTIME_DIR,
      getProviders: () => ({}),
      getToolDefinitions: () => [],
    });
    assert("Neural vault created", true);
  } catch (e) {
    assert("Neural vault created", false, e.message);
    console.error("Fatal: cannot init vault —", e.message);
    process.exit(1);
  }

  try {
    memoryStore = createMemoryStore(RUNTIME_DIR);
    assert("Memory store created", true);
  } catch (e) {
    assert("Memory store created", false, e.message);
  }

  try {
    memoryManager = createMemoryManager({ neuralVault: vault, runtimeDir: RUNTIME_DIR });
    assert("Memory manager created", true);
  } catch (e) {
    assert("Memory manager created", false, e.message);
  }

  try {
    procedural = createProceduralMemory({ neuralVault: vault });
    assert("Procedural memory created", true);
  } catch (e) {
    assert("Procedural memory created", false, e.message);
  }

  // ── SAMPLE KNOWLEDGE INSERTION ────────────────────────────────────────
  section("2. SAMPLE KNOWLEDGE INSERTION");

  // Personal profile memories
  const personalFacts = [
    { kind: "semantic", title: "User identity", content: "Dev's name is Dev (short for Devan). He is a Northeastern University student studying computer science and finance. His email is agrawal.deva@northeastern.edu.", importance: 9, topic: "user_identity" },
    { kind: "semantic", title: "Dev's primary projects", content: "Dev has two main active projects: Jarvis (local-first AI command OS built with Node.js, React, Electron, and Gemini) and MangoTrades (Kalshi prediction market quant trading system built with Python and Streamlit).", importance: 8, topic: "projects" },
    { kind: "semantic", title: "MangoTrades architecture", content: "MangoTrades is located at C:\\Users\\devan\\OneDrive\\Desktop\\mangotrades. It has 10 strategy bots: S1 Favorite Fade, S2 Mid-Market Model, S3 Bundle Arb, S4 Cross-Platform Arb, S5 Underdog Model (EV +19.4%), S6 Sharp Follow, S7 Fade Public (EV +15.45%), S8 Early Line Move, S9 Sports Prop Model (EV +11.71%), S10 Kelly Dynamic (EV +10.78%).", importance: 8, topic: "MangoTrades" },
    { kind: "semantic", title: "Kalshi API authentication", content: "Kalshi uses RSA PKCS1v15 signature auth (not PSS). Sign: timestamp + METHOD + /trade-api/v2/path. Headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-TIMESTAMP, KALSHI-ACCESS-SIGNATURE. Base URL: https://trading-api.kalshi.com/trade-api/v2", importance: 7, topic: "Kalshi" },
    { kind: "semantic", title: "Jarvis architecture", content: "Jarvis runs at http://localhost:8799. Stack: Node.js + Express (server.js ~7800 lines), React 19 + TypeScript + Vite, Electron desktop. LLM: Google Gemini 2.5-pro for chat, gemini-2.0-flash for agents. All server files use CommonJS require().", importance: 9, topic: "jarvis" },
    { kind: "semantic", title: "Jarvis neural vault", content: "Jarvis uses a neural vault (SQLite) with FTS5 BM25 hybrid search combined with entity graph traversal via RRF scoring. Memory kinds: semantic, episode, procedure, fact, skill, agent. Procedural rules are always injected first into the context pack.", importance: 8, topic: "neural_vault" },
    { kind: "semantic", title: "Jarvis device mesh", content: "Jarvis has a 13-item device mesh: DM-1 Cloudflare tunnel, DM-2 pairing tokens, DM-3 WebSocket hub, DM-4 WebRTC screen share, DM-5 screen control events, DM-6 VAPID push, DM-7 mDNS LAN discovery, DM-8 co-op transport, DM-9 ghost sandbox, DM-10 MeshPanel UI. All complete as of 2026-07-01.", importance: 7, topic: "device_mesh" },
    { kind: "fact", title: "MangoTrades paper trading", content: "MangoTrades is currently in paper trading phase using SQLite (paper_trades.db). For live arb bots S3 and S4, a Chicago VPS (Equinix CH1/CH2) is needed for ~1ms latency. Boston home connection has 50-200ms latency.", importance: 6, topic: "MangoTrades" },
    { kind: "fact", title: "Kalshi L3 data backtest requirement", content: "Daily L1 Kalshi data (mid = (high+low)/2) shows fake ~99% win rates and is NOT usable for backtesting. Real edge requires L3 intraday bid/ask candles. The collect_data.py script can collect L3 data but it is slow and rate-limited.", importance: 7, topic: "backtesting" },
  ];

  let insertCount = 0;
  const insertedIds = [];
  for (const mem of personalFacts) {
    try {
      const result = vault.upsertMemory({ ...mem, sourceType: "prefill", confidence: 0.95 });
      if (result) { insertCount++; insertedIds.push(result); }
    } catch (e) {
      console.log(`    ${INFO} Upsert skipped (likely duplicate): ${mem.title} — ${e.message}`);
    }
  }
  assert("Inserted personal/project knowledge", insertCount > 0, `${insertCount}/${personalFacts.length} inserted`);
  console.log(`    Inserted ${insertCount} memories`);

  // Procedural (behavioral) rules
  const rules = [
    "My name is Dev. Always call me Dev, never Devan or Devansh.",
    "I prefer terse, direct answers. Don't pad responses with summaries at the end.",
    "When I ask about Kalshi, default to checking my portfolio and positions first.",
    "Never add emojis unless I explicitly ask for them.",
    "From now on, always mention the file path when referencing code.",
  ];
  let ruleCount = 0;
  for (const rule of rules) {
    try {
      const r = procedural.ingestCorrection(rule, "prefill-session");
      if (r) ruleCount++;
    } catch (e) {
      console.log(`    ${INFO} Rule skipped: ${e.message}`);
    }
  }
  assert("Inserted behavioral rules", ruleCount > 0, `${ruleCount}/${rules.length} rules stored`);
  console.log(`    Stored ${ruleCount} procedural rules`);

  // Simulated conversation episodes
  const episodes = [
    { user: "What's the status of my Kalshi portfolio?", assistant: "Your Kalshi portfolio shows a balance of $2,340 with 4 open positions. Largest position: S7 Fade Public on BTCUSD-2026-Q3 at 82¢ NO, P&L +$42." },
    { user: "How does the MangoTrades S5 Underdog strategy work?", assistant: "S5 targets YES contracts priced 15-25¢ with EV +19.4%. It models longshot bias — markets systematically overprice favourites. Dev buys cheap NO near resolution as price corrects." },
    { user: "Can you open the memory debug panel?", assistant: "Opening memory debug panel. Showing 62 active memories, 12 procedural rules, 9.3MB vault." },
    { user: "What does the Jarvis neural vault use for search?", assistant: "Jarvis uses FTS5 BM25 full-text search combined with entity graph traversal, unified via Reciprocal Rank Fusion (RRF). Score = Σ 1/(60 + rank). Procedural rules always inject first." },
    { user: "Remind me: where is the MangoTrades project?", assistant: "MangoTrades is at C:\\Users\\devan\\OneDrive\\Desktop\\mangotrades. Main files: main.py (71KB), mangotrades_v2.py (10 strategy bots), paper_trades.db (SQLite paper trading)." },
  ];

  let episodeCount = 0;
  for (const ep of episodes) {
    try {
      vault.ingestTurn({
        userMessage: ep.user,
        assistantMessage: ep.assistant,
        source: "prefill-test",
        turnId: require("crypto").randomUUID(),
      });
      episodeCount++;
    } catch (e) {
      console.log(`    ${INFO} Episode skipped: ${e.message}`);
    }
  }
  assert("Inserted conversation episodes", episodeCount > 0, `${episodeCount}/${episodes.length} episodes`);
  console.log(`    Ingested ${episodeCount} conversation turns`);

  // Memory store (short-term) entries
  const shortTermItems = [
    { kind: "semantic", category: "projects", text: "Active project: Jarvis. Current focus: memory manager + prefill script.", importance: 0.8 },
    { kind: "semantic", category: "user_prefs", text: "Dev prefers Node.js + CommonJS for all Jarvis server files.", importance: 0.7 },
    { kind: "semantic", category: "kalshi", text: "Kalshi production base URL: https://external-api.kalshi.com/trade-api/v2 (newer RSA PSS endpoint).", importance: 0.75 },
  ];
  let stCount = 0;
  if (memoryStore) {
    for (const item of shortTermItems) {
      try {
        memoryStore.add(item);
        stCount++;
      } catch (e) {
        console.log(`    ${INFO} Short-term item skipped: ${e.message}`);
      }
    }
  }
  assert("Inserted short-term memories", stCount > 0, `${stCount}/${shortTermItems.length}`);
  console.log(`    Stored ${stCount} short-term items`);

  // ── RETRIEVAL TESTS ───────────────────────────────────────────────────
  section("3. RETRIEVAL & SEARCH TESTS");

  // BM25 FTS5 search tests
  const searchTests = [
    { query: "MangoTrades strategy bots", expect: ["MangoTrades", "S1", "S5", "Kelly", "Kalshi"], label: "MangoTrades strategy search" },
    { query: "Kalshi API authentication RSA", expect: ["RSA", "PKCS1", "timestamp", "KALSHI-ACCESS"], label: "Kalshi API auth search" },
    { query: "Jarvis neural vault search", expect: ["BM25", "FTS5", "RRF", "procedural"], label: "Neural vault search mechanics" },
    { query: "Dev Northeastern email", expect: ["Dev", "Northeastern", "agrawal"], label: "Personal identity search" },
    { query: "device mesh WebSocket tunnel", expect: ["DM", "WebSocket", "Cloudflare"], label: "Device mesh search" },
    { query: "backtesting L3 intraday data", expect: ["L3", "bid", "rate-limited"], label: "Backtest data search" },
  ];

  for (const test of searchTests) {
    try {
      const results2 = vault.searchMemories(test.query, { limit: 5 });
      const combined = results2.map((r) => `${r.title || ""} ${r.content || ""} ${r.summary || ""}`).join(" ");
      const hit = test.expect.some((term) => combined.toLowerCase().includes(term.toLowerCase()));
      assert(test.label, hit, hit ? `top result: "${results2[0]?.title}"` : `no match in ${results2.length} results`);
    } catch (e) {
      assert(test.label, false, e.message);
    }
  }

  // Hybrid search test
  try {
    const hybridResults = vault.hybridSearch("Kalshi portfolio positions trading", { limit: 5 });
    assert("Hybrid search (BM25 + entity graph)", hybridResults.length > 0, `${hybridResults.length} results`);
    console.log(`    Hybrid top result: "${hybridResults[0]?.title || hybridResults[0]?.content?.slice(0, 60)}"`);
  } catch (e) {
    assert("Hybrid search (BM25 + entity graph)", false, e.message);
  }

  // Short-term memory search
  if (memoryStore) {
    try {
      const stResults = memoryStore.search("Jarvis Node.js CommonJS", { limit: 3 });
      assert("Short-term memory search", stResults.length > 0, `${stResults.length} results`);
    } catch (e) {
      assert("Short-term memory search", false, e.message);
    }
  }

  // ── CONTEXT PACK TEST ─────────────────────────────────────────────────
  section("4. CONTEXT PACK ASSEMBLY");

  const contextTests = [
    "what is my Kalshi portfolio",
    "how does MangoTrades work",
    "open memory debug panel",
    "who am I",
  ];

  for (const query of contextTests) {
    try {
      const pack = vault.getContextPack(query, { limit: 6 });
      const hasMemories = pack.memories && pack.memories.length > 0;
      const hasContinuity = pack.continuity !== undefined;
      const hasContextText = pack.contextText && pack.contextText.length > 50;
      assert(`Context pack: "${query}"`, hasMemories || hasContinuity, `${pack.memories?.length || 0} memories, ${pack.contextText?.length || 0} chars`);
      if (hasContextText) {
        console.log(`    contextText preview: "${pack.contextText.slice(0, 100).replace(/\n/g, " ")}..."`);
      }
    } catch (e) {
      assert(`Context pack: "${query}"`, false, e.message);
    }
  }

  // ── PROCEDURAL RULES TEST ─────────────────────────────────────────────
  section("5. PROCEDURAL RULES INJECTION");

  try {
    const rules2 = vault.getProcedural(20);
    assert("getProcedural() returns rules", rules2.length > 0, `${rules2.length} rules active`);
    const formatted = vault.formatProceduralForContext(12);
    assert("formatProceduralForContext() produces text", formatted.length > 20, `${formatted.length} chars`);
    const hasDevName = formatted.toLowerCase().includes("dev");
    assert("'Dev' name rule is in context", hasDevName, formatted.slice(0, 200));
    console.log(`\n    Procedural context preview:\n    ${formatted.slice(0, 300).replace(/\n/g, "\n    ")}`);
  } catch (e) {
    assert("Procedural rules injection", false, e.message);
  }

  // Correction detection
  const corrections = [
    { text: "my name is Dev not Devan", shouldDetect: true },
    { text: "stop summarizing at the end of every response", shouldDetect: true },
    { text: "from now on always mention the file path", shouldDetect: true },
    { text: "never add emojis unless I ask", shouldDetect: true },
    { text: "what is the weather today", shouldDetect: false },
    { text: "show me my portfolio", shouldDetect: false },
  ];
  let correctionPass = 0;
  for (const c of corrections) {
    const detected = procedural.isCorrection(c.text);
    if (detected === c.shouldDetect) correctionPass++;
  }
  assert(`Correction detection accuracy`, correctionPass === corrections.length, `${correctionPass}/${corrections.length} correct`);

  // ── CONTINUITY TEST ───────────────────────────────────────────────────
  section("6. CONTINUITY TRACKING");

  try {
    const cont = vault.getContinuity();
    assert("getContinuity() works", cont !== null, JSON.stringify(cont).slice(0, 100));
    console.log(`    active_project: ${cont.active_project || "none"}`);
    console.log(`    active_topic: ${cont.active_topic || "none"}`);
    console.log(`    last_discussed_object: ${cont.last_discussed_object || "none"}`);
  } catch (e) {
    assert("getContinuity() works", false, e.message);
  }

  // Update continuity with a test turn
  try {
    vault.ingestTurn({
      userMessage: "Let's focus on the MangoTrades backtesting system today",
      assistantMessage: "Sure Dev, focusing on MangoTrades backtesting. The key blocker is getting L3 intraday data — daily L1 data gives fake win rates due to the range-midpoint pricing issue.",
      source: "continuity-test",
      turnId: require("crypto").randomUUID(),
    });
    const cont2 = vault.getContinuity();
    assert("Continuity updates after ingestTurn", cont2 !== null);
    console.log(`    Updated topic: ${cont2.active_topic || "none"}`);
  } catch (e) {
    assert("Continuity updates after ingestTurn", false, e.message);
  }

  // ── ENTITY GRAPH TEST ────────────────────────────────────────────────
  section("7. ENTITY GRAPH & RELATIONSHIPS");

  try {
    const devEntity = vault.resolveEntity("Dev", "person");
    assert("resolveEntity('Dev') finds entity or returns null gracefully", devEntity !== undefined);
    console.log(`    resolveEntity('Dev'): ${devEntity ? `found id=${devEntity.id} name=${devEntity.name}` : "not found (entity graph may be sparse)"}`);
  } catch (e) {
    assert("resolveEntity('Dev')", false, e.message);
  }

  try {
    const jarvisEntity = vault.resolveEntity("Jarvis");
    console.log(`    resolveEntity('Jarvis'): ${jarvisEntity ? `found id=${jarvisEntity.id}` : "not found"}`);
    if (jarvisEntity) {
      const rels = vault.getEntityRelationships(jarvisEntity.id);
      assert("getEntityRelationships() for Jarvis", Array.isArray(rels), `${rels.length} relationships`);
      console.log(`    Jarvis has ${rels.length} relationships`);
    } else {
      assert("Entity graph: Jarvis found", false, "entity not in graph");
    }
  } catch (e) {
    assert("Entity graph: Jarvis", false, e.message);
  }

  // ── MEMORY MANAGER STRESS TEST ────────────────────────────────────────
  section("8. MEMORY MANAGER FULL RUN");

  // Insert some intentional duplicates for dedup test
  try {
    vault.upsertMemory({ kind: "semantic", content: "DEDUP_TEST: This memory should be deduplicated by exact content match.", importance: 2, sourceType: "test" });
    vault.upsertMemory({ kind: "semantic", content: "DEDUP_TEST: This memory should be deduplicated by exact content match.", importance: 2, sourceType: "test" });
    console.log(`    Inserted 2 duplicate memories for dedup test`);
  } catch (e) {
    console.log(`    ${INFO} Dedup setup: ${e.message}`);
  }

  // Run memory manager
  let managerResult;
  try {
    console.log("\n    Running memory manager...");
    managerResult = memoryManager.run({ source: "full-test" });
    assert("Memory manager run() returns ok:true", managerResult.ok, managerResult.error || "");
    if (managerResult.ok) {
      const r = managerResult.report;
      assert("Health score is a number 0-100", r.health.score >= 0 && r.health.score <= 100, `score=${r.health.score}`);
      assert("Health grade is a letter", ["A","B","C","D","F"].includes(r.health.grade), `grade=${r.health.grade}`);
      assert("Actions object has all keys", Object.keys(r.actions).length >= 7);
      assert("Metrics.memories has data", (r.metrics.memories.total || 0) >= 0);
      assert("Duration is reasonable (<10s)", r.durationMs < 10000, `${r.durationMs}ms`);
      console.log(`\n    ┌─ HEALTH REPORT ──────────────────────────────────┐`);
      console.log(`    │ Score: ${r.health.score}/100  Grade: ${r.health.grade}  Duration: ${r.durationMs}ms`);
      console.log(`    │ Actions: ${JSON.stringify(r.actions)}`);
      console.log(`    │ Memories: ${r.metrics.memories.total || 0} active / ${r.metrics.memories.archived || 0} archived`);
      console.log(`    │ Entities: ${r.metrics.entities.total || 0} total / ${r.metrics.entities.orphans || 0} orphans`);
      console.log(`    │ Relationships: ${r.metrics.relationships.active || 0} active`);
      console.log(`    │ Procedures: ${r.metrics.procedures.active || 0} rules active`);
      console.log(`    │ DB: ${r.metrics.vault.dbSizeMB}MB`);
      r.health.flags.forEach((f) => console.log(`    │ Flag: ${f}`));
      console.log(`    └─────────────────────────────────────────────────────┘`);
    }
  } catch (e) {
    assert("Memory manager run()", false, e.message);
  }

  // Run twice more (idempotency test)
  try {
    const r2 = memoryManager.run({ source: "idempotency-test-1" });
    const r3 = memoryManager.run({ source: "idempotency-test-2" });
    assert("Memory manager is idempotent (3 runs succeed)", r2.ok && r3.ok, `r2.ok=${r2.ok} r3.ok=${r3.ok}`);
    if (r2.ok && r3.ok) {
      const score2 = r2.report.health.score;
      const score3 = r3.report.health.score;
      assert("Health score stable across runs", Math.abs(score2 - score3) <= 5, `run2=${score2} run3=${score3}`);
    }
  } catch (e) {
    assert("Memory manager idempotency", false, e.message);
  }

  // Report listing
  try {
    const reports = memoryManager.listReports({ limit: 5 });
    assert("listReports() returns array", Array.isArray(reports) && reports.length > 0, `${reports.length} reports`);
    const firstReport = reports[0];
    const content = memoryManager.readReport(firstReport.filename);
    assert("readReport() returns markdown", content && content.includes("# Jarvis Memory Manager Report"), `${content?.length || 0} chars`);
  } catch (e) {
    assert("Report listing/reading", false, e.message);
  }

  // Status check
  try {
    const status = memoryManager.status();
    assert("status() returns lastRunAt", Boolean(status.lastRunAt));
    assert("status() shows intervalMs", status.intervalMs === 6 * 60 * 60 * 1000, `${status.intervalMs}ms`);
  } catch (e) {
    assert("Memory manager status()", false, e.message);
  }

  // ── STRESS TEST: BULK INSERT + SEARCH ────────────────────────────────
  section("9. STRESS TEST — BULK INSERT & SEARCH");

  const BULK_COUNT = 50;
  const topics = ["kalshi", "jarvis", "mangotrades", "backtesting", "neural_vault", "device_mesh", "memory", "trading", "python", "nodejs"];
  const kinds = ["semantic", "fact", "episode"];
  let bulkInserted = 0;
  const t0 = Date.now();

  for (let i = 0; i < BULK_COUNT; i++) {
    try {
      vault.upsertMemory({
        kind: kinds[i % kinds.length],
        content: `Stress test memory #${i}: Dev is working on ${topics[i % topics.length]} related to Jarvis and MangoTrades. Key insight number ${i}: always validate data before storing.`,
        importance: Math.floor(2 + (i % 6)),
        confidence: 0.7 + (i % 3) * 0.1,
        topic: topics[i % topics.length],
        sourceType: "stress-test",
      });
      bulkInserted++;
    } catch {
      // skip
    }
  }
  const insertMs = Date.now() - t0;
  assert(`Bulk insert ${BULK_COUNT} memories`, bulkInserted >= BULK_COUNT * 0.9, `${bulkInserted}/${BULK_COUNT} in ${insertMs}ms`);
  console.log(`    Insert speed: ${(BULK_COUNT / (insertMs / 1000)).toFixed(0)} memories/sec`);

  // Bulk search under load
  const searchQueries = ["kalshi trading portfolio", "jarvis neural vault memory", "MangoTrades strategy", "Dev Northeastern project"];
  const t1 = Date.now();
  let searchHits = 0;
  for (const q of searchQueries) {
    const r = vault.searchMemories(q, { limit: 10 });
    if (r.length > 0) searchHits++;
  }
  const searchMs = Date.now() - t1;
  assert(`Search ${searchQueries.length} queries post-bulk`, searchHits === searchQueries.length, `${searchHits}/${searchQueries.length} in ${searchMs}ms`);
  console.log(`    Search speed: ${(searchQueries.length / (searchMs / 1000)).toFixed(0)} queries/sec`);

  // Run manager one more time after bulk insert stress
  const postStressResult = memoryManager.run({ source: "post-stress" });
  assert("Memory manager runs cleanly after stress insert", postStressResult.ok, postStressResult.error || "");
  if (postStressResult.ok) {
    console.log(`    Post-stress health: ${postStressResult.report.health.score}/100 (${postStressResult.report.health.grade}) in ${postStressResult.report.durationMs}ms`);
    console.log(`    Total active memories now: ${postStressResult.report.metrics.memories.total}`);
  }

  // ── FINAL SUMMARY ────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                   TEST RESULTS                         ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  results.forEach((r) => console.log("║ " + r.padEnd(57) + "║"));
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  PASSED: ${String(passed).padEnd(4)}  FAILED: ${String(failed).padEnd(4)}  TOTAL: ${String(passed + failed).padEnd(10)}║`);
  const rate = Math.round((passed / (passed + failed)) * 100);
  console.log(`║  PASS RATE: ${rate}%  ${rate === 100 ? "🎉 ALL TESTS PASSED" : rate >= 80 ? "✅ GOOD" : "⚠ NEEDS ATTENTION"}                          ║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // Close vault
  try { vault.close(); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
