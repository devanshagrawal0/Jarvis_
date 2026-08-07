// How long does a planner call ACTUALLY take, at the prompt size real runs produce?
//
// The budgets (router 4s, action 8s) were set when a measurement put the planner prompt at ~4.4 KB.
// Live runs now fail with prompts of 11-19 KB, every model in the chain timing out, so the budget
// is being compared against a payload it was never measured for. This times the real endpoint, with
// the real generationConfig and response schema, at a realistic size — no agent, no browser, so the
// only variable is planner latency.
//
//   node scripts/measure-planner-budget.mjs [samples] [promptKB]
//
// The key is read from the vault in-process and never printed. It costs a handful of Gemini calls.

import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = Math.max(1, Math.min(Number(process.argv[2] || 4), 10));
const PROMPT_KB = Math.max(1, Math.min(Number(process.argv[3] || 12), 40));

const { createSecretStore } = await import("../server/secret-store.js");
const { MODELS, candidatesFor } = await import("../server/gemini-models.js");
const { PLANNER_RESPONSE_SCHEMA, PLANNER_ROUTER_TIMEOUT_MS, PLANNER_ACTION_TIMEOUT_MS } = await import("../server/universal-browser-agent.js");

const key = createSecretStore(path.resolve(process.env.JARVIS_RUNTIME_DIR || path.join(ROOT, "runtime"))).load().geminiKey;
if (!key) { console.error("No geminiKey in the vault."); process.exit(1); }

// Shaped like the real planner prompt: an instruction, a long element list, and a page-text blob.
function buildPrompt(kb) {
  const controls = Array.from({ length: 70 }, (_, i) =>
    `  e${i} [button] ${JSON.stringify(`Control ${i} — some accessible name of realistic length`)}`).join("\n");
  const filler = "Page text. ".repeat(Math.max(0, Math.floor((kb * 1024 - controls.length - 600) / 11)));
  return `You are a web automation agent controlling a browser via Playwright.

TASK: Open the messaging site, open the conversation, type "hello" and stop before sending.
CURRENT PAGE: https://example.test/direct/t/1234567890
INTERACTIVE ELEMENTS (use ref field to target):
${controls}

PAGE TEXT EXCERPT: ${filler}

Decide the NEXT SINGLE action. Return ONLY valid JSON.`;
}

const prompt = buildPrompt(PROMPT_KB);
console.log(`prompt: ${prompt.length} bytes (${(prompt.length / 1024).toFixed(1)} KB), samples: ${SAMPLES}`);
console.log(`current budgets: router ${PLANNER_ROUTER_TIMEOUT_MS}ms, action ${PLANNER_ACTION_TIMEOUT_MS}ms\n`);

const models = [...new Set([MODELS.router, MODELS.main, ...candidatesFor(MODELS.main)])];

for (const model of models) {
  const times = [];
  let failure = "";
  for (let i = 0; i < SAMPLES; i += 1) {
    const started = Date.now();
    const controller = new AbortController();
    // 30s ceiling: we are measuring latency, not enforcing the budget under test.
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 700, responseMimeType: "application/json", responseSchema: PLANNER_RESPONSE_SCHEMA, temperature: 0.1 } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { failure = `HTTP ${res.status}: ${String(data?.error?.message || "").slice(0, 90)}`; break; }
      times.push(Date.now() - started);
    } catch (error) {
      failure = error?.name === "AbortError" ? "no answer within 30s" : String(error.message).slice(0, 90);
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!times.length) { console.log(`${model.padEnd(24)} UNUSABLE — ${failure}`); continue; }
  const sorted = [...times].sort((a, b) => a - b);
  const budget = model === MODELS.router ? PLANNER_ROUTER_TIMEOUT_MS : PLANNER_ACTION_TIMEOUT_MS;
  const overBudget = times.filter((t) => t > budget).length;
  console.log(`${model.padEnd(24)} min ${String(sorted[0]).padStart(5)}ms  median ${String(sorted[Math.floor(sorted.length / 2)]).padStart(5)}ms  max ${String(sorted[sorted.length - 1]).padStart(5)}ms   over its ${budget}ms budget: ${overBudget}/${times.length}${failure ? `  (then ${failure})` : ""}`);
}
