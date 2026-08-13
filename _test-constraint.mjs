import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createSecretStore } = require("./server/secret-store");
const { GoogleGenAI } = require("@google/genai");

const secretStore = createSecretStore("./runtime");
const loaded = (typeof secretStore.load === "function" ? secretStore.load() : {}) || {};
const key = loaded.geminiKey || (typeof secretStore.get === "function" ? secretStore.get("GEMINI_API_KEY") : "") || process.env.GEMINI_API_KEY || "";
if (!key) { console.log("NO KEY"); process.exit(0); }
const ai = new GoogleGenAI({ apiKey: key });

const stageRender = { name: "stage_render", description: "Render blocks.", parameters: { type: "OBJECT", properties: { title: { type: "STRING" } }, required: ["title"] } };

for (const model of ["gemini-2.5-flash"]) {
  // Case 1: BOTH grounding + function tools in one request
  try {
    const r = await ai.models.generateContent({
      model, contents: "What is the latest S&P 500 level? Then render it.",
      config: { tools: [{ googleSearch: {} }, { functionDeclarations: [stageRender] }] },
    });
    console.log(`[${model}] BOTH tools -> OK (no error). text len=${(r.text || "").length}, functionCalls=${JSON.stringify(r.functionCalls || [])}`);
  } catch (e) {
    console.log(`[${model}] BOTH tools -> ERROR: ${String(e.message || e).slice(0, 300)}`);
  }
}
