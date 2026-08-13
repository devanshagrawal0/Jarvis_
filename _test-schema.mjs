import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createSecretStore } = require("./server/secret-store");
const { GoogleGenAI } = require("@google/genai");

const secretStore = createSecretStore("./runtime");
const loaded = (typeof secretStore.load === "function" ? secretStore.load() : {}) || {};
const key = loaded.geminiKey || (typeof secretStore.get === "function" ? secretStore.get("GEMINI_API_KEY") : "") || process.env.GEMINI_API_KEY || "";
console.log("key present:", !!key, "len", (key || "").length);
if (!key) { console.log("NO KEY — cannot test"); process.exit(0); }

const stageRender = {
  name: "stage_render",
  description: "Render a structured surface from typed blocks.",
  parameters: { type: "OBJECT", properties: {
    title: { type: "STRING" },
    blocks: { type: "ARRAY", description: "Ordered blocks.", items: { type: "OBJECT", properties: {
      type: { type: "STRING", description: "heading, text, stat, list, or divider." },
      text: { type: "STRING" },
      label: { type: "STRING" },
      value: { type: "STRING" },
      delta: { type: "STRING" },
      items: { type: "ARRAY", items: { type: "STRING" } },
    } } },
  }, required: ["blocks"] },
};

const ai = new GoogleGenAI({ apiKey: key });
for (const model of ["gemini-2.5-flash", "gemini-3.1-flash", "gemini-2.0-flash"]) {
  try {
    const resp = await ai.models.generateContent({
      model,
      contents: "Render a panel with two stat blocks: Revenue $1800 (+14%) and Orders 214 (+18). Call stage_render.",
      config: {
        tools: [{ functionDeclarations: [stageRender] }],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
      },
    });
    const calls = resp.functionCalls || resp.candidates?.[0]?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall);
    console.log(`\n[${model}] OK. functionCalls:`, JSON.stringify(calls)?.slice(0, 400));
  } catch (e) {
    console.log(`\n[${model}] ERROR:`, String(e.message || e).slice(0, 400));
  }
}
