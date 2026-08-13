import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createSecretStore } = require("./server/secret-store");
const { createStageRouter } = require("./server/stage-router");

const secretStore = createSecretStore("./runtime");
const loaded = (typeof secretStore.load === "function" ? secretStore.load() : {}) || {};
const key = loaded.geminiKey || (typeof secretStore.get === "function" ? secretStore.get("GEMINI_API_KEY") : "") || process.env.GEMINI_API_KEY || "";
if (!key) { console.log("NO KEY"); process.exit(0); }

const router = createStageRouter({ getSettings: () => ({ geminiKey: key }) });

// [prompt, expected form, expected lane (only checked for stage_render)]
const CASES = [
  ["what's the capital of France?", "text", "-"],
  ["hey jarvis", "text", "-"],
  ["explain how a transformer neural net works", "text", "-"],
  ["what is 12 times 8", "text", "-"],
  ["what's on my calendar today", "open_widget", "-"],
  ["show my kalshi positions", "open_widget", "-"],
  ["what's the weather right now", "open_widget", "-"],
  ["open a panel with the latest S&P 500 and Nasdaq levels", "stage_render", "LIVE"],
  ["give me a dashboard of today's top market movers", "stage_render", "LIVE"],
  ["make a panel summarizing my week: tasks and events", "stage_render", "LIVE"],
  ["make a coffee shop dashboard: revenue, orders, avg ticket", "stage_render", "FICTION"],
  ["build an example dashboard for a fictional gym", "stage_render", "FICTION"],
  ["make a panel comparing the 3 tallest mountains with their heights", "stage_render", "STABLE"],
  ["give me a rundown panel of the roman empire: key stats and 3 emperors", "stage_render", "STABLE"],
  ["latest news headlines on a panel", "stage_render", "LIVE"],
];

let ok = 0;
for (const [prompt, expForm, expLane] of CASES) {
  const d = await router.route(prompt);
  const formHit = d.form === expForm;
  const laneHit = expLane === "-" || d.lane === expLane;
  const good = formHit && laneHit;
  if (good) ok += 1;
  console.log(`${good ? "OK " : "XX "} form=${d.form}${d.widget_id ? "(" + d.widget_id + ")" : ""} lane=${d.lane} conf=${d.confidence}  [exp ${expForm}/${expLane}]  "${prompt.slice(0, 46)}"`);
  if (!good) console.log(`      reason: ${d.reasoning}`);
}
console.log(`\n${ok}/${CASES.length} matched expectations`);
