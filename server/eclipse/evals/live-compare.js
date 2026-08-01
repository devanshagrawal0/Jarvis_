// LIVE 3-way comparison: Cortex Balanced vs Cortex Max vs Eclipse.
// Reads GEMINI_API_KEY from the environment (never printed). Eclipse is capped at $0.75.
// Run:  GEMINI_API_KEY=... node server/eclipse/evals/live-compare.js
const { GoogleGenAI } = require("@google/genai");
const registry = require("../../gemini-models");
const { createInteractionsClient } = require("../model/interactions-client");
const { runMission } = require("../orchestration/run-graph");
const { openStore } = require("../orchestration/store");
const Database = require("better-sqlite3");
const { SqliteSaver } = require("@langchain/langgraph-checkpoint-sqlite");
const path = require("path");
const { createSecretStore } = require("../../secret-store");
const { createLiveWebTools } = require("../tools/web-live");

// Same key path Cortex uses: the DPAPI-encrypted local vault, decrypted for the current user.
// Value stays in-process; never printed.
const root = path.resolve(__dirname, "../../..");
const KEY = process.env.GEMINI_API_KEY || (() => { try { return createSecretStore(path.join(root, "runtime")).load().geminiKey; } catch (e) { console.error("vault load failed:", e.message); return null; } })();
const ONLY = process.env.ONLY || null; // "cortex" | "max" | "eclipse" — run a single section to save credits
const PROMPT = process.argv[2] || "Compare LangGraph and CrewAI for durable multi-agent execution and recommend one, with evidence.";
if (!KEY) { console.error("NO GEMINI_API_KEY in env"); process.exit(1); }

const FLASH_CANDS = [registry.MODELS.main, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
const PRO_CANDS = [registry.MODELS.reasoning, "gemini-2.5-pro", "gemini-1.5-pro", "gemini-2.0-flash"];
const uniq = (a) => a.filter((v, i) => v && a.indexOf(v) === i);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tryGen(ai, models, contents, config) {
  let lastErr;
  for (const model of uniq(models)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await ai.models.generateContent({ model, contents, ...(config ? { config } : {}) });
        return { model, text: r.text || "", usage: r.usageMetadata || {} };
      } catch (e) {
        lastErr = e; const msg = String(e.message || e);
        if (/503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|high demand|overloaded|deadline/i.test(msg)) { await sleep(1500 * (attempt + 1)); continue; } // transient → retry same model
        break; // 404/400/not-found → next model
      }
    }
  }
  throw lastErr;
}

(async () => {
  const ai = new GoogleGenAI({ apiKey: KEY });
  console.log("PROMPT:", PROMPT, "\n" + "=".repeat(80));

  // 1) CORTEX — everyday chat model, direct answer.
  let cortex = null;
  if (!ONLY || ONLY === "cortex") {
    console.log("\n### 1. CORTEX (chat · flash) ###");
    try { cortex = await tryGen(ai, FLASH_CANDS, PROMPT); console.log(`[model ${cortex.model} · ~${cortex.usage.totalTokenCount || "?"} tok]\n`); console.log(cortex.text.trim()); }
    catch (e) { console.log("CORTEX FAILED:", String(e.message).slice(0, 200)); }
  }

  // 2) CORTEX MAX — Pro reasoning, high thinking, single agent.
  let cortexMax = null;
  if (!ONLY || ONLY === "max") {
    console.log("\n" + "=".repeat(80) + "\n### 2. CORTEX MAX (reasoning · pro · high thinking) ###");
    try {
      try { cortexMax = await tryGen(ai, PRO_CANDS, PROMPT, { thinkingConfig: { thinkingLevel: "high" }, temperature: 1.0 }); }
      catch { cortexMax = await tryGen(ai, PRO_CANDS, PROMPT); }
      console.log(`[model ${cortexMax.model} · ~${cortexMax.usage.totalTokenCount || "?"} tok]\n`); console.log(cortexMax.text.trim());
    } catch (e) { console.log("CORTEX MAX FAILED:", String(e.message).slice(0, 200)); }
  }

  // 3) ECLIPSE — full multi-agent mission, live, capped. Point the registry at the working models.
  if (ONLY && ONLY !== "eclipse") { console.log("\nDONE (ONLY=" + ONLY + ")."); return; }
  console.log("\n" + "=".repeat(80) + "\n### 3. ECLIPSE (multi-agent mission · totality · live + REAL web verification) ###");
  const flashModel = (cortex && cortex.model) || "gemini-2.5-flash", proModel = (cortexMax && cortexMax.model) || "gemini-3.1-pro-preview";
  registry.MODELS.main = flashModel; registry.MODELS.reasoning = proModel; registry.MODELS.router = flashModel;
  const { liveCall } = createInteractionsClient({ getApiKey: () => KEY });
  const web = createLiveWebTools({ ai, searchModel: flashModel }); // real Google-Search grounding + fetch
  const store = openStore({ db: new Database(":memory:") });
  const mission = { schemaVersion: "eclipse.mission.v1", missionId: "m_live_cmp", userId: "dev", prompt: PROMPT, effort: "totality", createdAt: new Date(0).toISOString(), constraints: { maxCostUsd: 0.75, maxTokens: 250000, allowedPaths: [], privacy: "provider" } };
  const t0 = Date.now();
  try {
    const r = await runMission({ mission, store, checkpointer: SqliteSaver.fromConnString(":memory:"), mode: "live", liveCall, toolMode: "live", search: web.search, webFetch: web.fetchUrl });
    const ev = r.run.evidenceStore.getEvidence(mission.missionId);
    const claims = r.run.evidenceStore.getClaims(mission.missionId);
    console.log(`[status ${r.status} · ${r.state?.trail?.length || 0} nodes · ${(r.ledger?.tokens || 0)} tok · $${(r.ledger?.costUsd || 0).toFixed(4)} · ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
    console.log(`[evidence captured: ${ev.length} · claims promoted (validated): ${claims.filter((c) => c.status === "supported").length}/${claims.length} · packets: ${r.state?.packets?.length || 0}]\n`);
    console.log((r.state?.result?.draft || "(no synthesis produced)").trim());
    console.log("\n— Verified sources (re-fetched + citation-checked):");
    for (const e of ev.slice(0, 8)) console.log(`   • ${e.uri}`);
    console.log("\n— Eclipse plan (Architect decomposition):" + (r.state?.graphPlan?.subtasks || []).map((s, i) => `\n   worker ${i + 1}: ${String(s.goal).slice(0, 100)}`).join(""));
  } catch (e) {
    console.log("ECLIPSE FAILED:", e.message);
  }
  console.log("\n" + "=".repeat(80) + "\nDONE.");
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
