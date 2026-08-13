// The Stage presentation router (W3.1).
//
// One cheap, dedicated Gemini call that DECIDES a turn's presentation — with the model's
// own judgment, steered by explicit positive/negative criteria, NOT keyword regex. It renders
// nothing; it only returns a typed decision the rest of the pipeline dispatches on:
//   form: "text" | "stage_render" | "open_widget"
//   lane: "LIVE" | "STABLE" | "FICTION"   (only meaningful when form=stage_render)
//   widget_id?  (when form=open_widget)
//
// Reasoning-first schema (constrained decoding degrades judgment if the answer precedes the
// rationale). Structured output (responseSchema) guarantees a parseable decision.

const { GoogleGenAI } = require("@google/genai");
const { MODELS, fallbacksFor } = require("./gemini-models");

const ROUTER_SCHEMA = {
  type: "OBJECT",
  properties: {
    reasoning: { type: "STRING", description: "1-2 short sentences: why this form and lane." },
    form: { type: "STRING", enum: ["text", "stage_render", "open_widget"], description: "How to present the answer." },
    lane: { type: "STRING", enum: ["LIVE", "STABLE", "FICTION"], description: "Where the DATA comes from (only used when form=stage_render)." },
    widget_id: { type: "STRING", description: "When form=open_widget: the existing widget id that already covers this." },
    confidence: { type: "NUMBER", description: "0..1 confidence in this decision." },
  },
  required: ["reasoning", "form", "lane", "confidence"],
};

// Known on-screen widgets the router may route to instead of rendering a bespoke surface.
const WIDGET_MENU = [
  ["today", "the owner's calendar / schedule / tasks / reminders for the day"],
  ["kalshi", "the owner's Kalshi markets, positions, portfolio, orders, fills"],
  ["weather", "current weather for the owner's location"],
  ["connections", "provider / integration health and connection status"],
  ["agents", "running agent missions and specialists"],
  ["memory", "the owner's stored memories / neural vault"],
  ["projects", "the owner's projects and their health"],
  ["vitals", "system CPU / memory / health"],
  ["contacts", "the owner's contacts"],
];

const SYSTEM = `You are the presentation router for JARVIS's "Stage". For ONE user turn, decide how the answer should be presented. You do NOT answer the question or produce any content — you only classify. Return JSON matching the schema.

FORM — pick exactly one:
- "text": short factual answers, single values, explanations, conversation, opinions, how/why questions, or anything that reads fine as prose. This is the DEFAULT — most turns are text.
- "stage_render": the answer is genuinely better SHOWN than written — multiple metrics/numbers to compare, a ranked or grouped list, a multi-section breakdown, a schedule/timeline, a dashboard-style summary. Prefer this when the owner explicitly asks for a "panel / dashboard / surface / stage / breakdown / rundown", OR when the content is inherently tabular/quantitative/multi-entity.
- "open_widget": an EXISTING on-screen widget already covers this intent better than a fresh render. Set widget_id. Widgets available:
${WIDGET_MENU.map(([id, desc]) => `    ${id} — ${desc}`).join("\n")}
  Example: "what's on my calendar" -> open_widget today; "show my kalshi positions" -> open_widget kalshi.

Do NOT use stage_render for: greetings, single-fact answers, yes/no, definitions, short explanations, or anything a sentence answers well.

LANE — where the DATA behind a render would come from (only matters when form=stage_render; otherwise pick the best guess):
- "LIVE": the data is time-sensitive, current, or private — prices, news, scores, "latest/current/today", or anything possessive ("my ...", "our ..."). These MUST be fetched from a real source, never invented.
- "STABLE": durable general facts the model reliably knows (historical facts, geography, definitions, well-known figures).
- "FICTION": explicitly hypothetical or made-up ("a fictional coffee shop", "an example dashboard", "imagine/pretend/sample"). Inventing values is allowed here.

If you are unsure of the lane, choose "LIVE" (fail safe: better to fetch/abstain than to invent).

Base LANE on the nature of the referent (volatility, recency, ownership, explicit fiction), NOT on specific keywords.`;

function createStageRouter({ getSettings }) {
  async function route(prompt, ctx = {}) {
    const settings = getSettings ? getSettings() : {};
    const key = settings.geminiKey;
    const fallback = { reasoning: "router unavailable", form: "text", lane: "LIVE", confidence: 0, classifier: "fallback" };
    if (!key || !String(prompt || "").trim()) return fallback;
    const ai = new GoogleGenAI({ apiKey: key });
    const recent = Array.isArray(ctx.history)
      ? ctx.history.slice(-6).map((h) => `${h.role || "user"}: ${String(h.text || "").slice(0, 300)}`).join("\n")
      : "";
    const contents = [
      SYSTEM,
      recent ? `Recent conversation:\n${recent}` : "",
      `User turn to classify:\n${String(prompt).slice(0, 2000)}`,
    ].filter(Boolean).join("\n\n");
    // Walk the same model ladder the rest of the app uses; some pinned models 404/503.
    const candidates = [settings.geminiRouterModel, MODELS.router, ...fallbacksFor("router"), MODELS.main]
      .filter((m, i, a) => m && a.indexOf(m) === i);
    let lastError = null;
    for (const model of candidates) {
      try {
        const resp = await ai.models.generateContent({
          model,
          contents,
          config: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: ROUTER_SCHEMA,
            thinkingConfig: { thinkingBudget: 0 }, // classification only — keep it fast
          },
        });
        const parsed = JSON.parse(resp.text || "{}");
        return normalize(parsed);
      } catch (error) {
        lastError = error;
      }
    }
    return { ...fallback, reasoning: `router error: ${String(lastError && lastError.message || lastError).slice(0, 160)}` };
  }
  function normalize(parsed) {
    const form = ["text", "stage_render", "open_widget"].includes(parsed.form) ? parsed.form : "text";
    const lane = ["LIVE", "STABLE", "FICTION"].includes(parsed.lane) ? parsed.lane : "LIVE";
    return {
      reasoning: String(parsed.reasoning || "").slice(0, 400),
      form,
      lane,
      widget_id: form === "open_widget" ? String(parsed.widget_id || "").slice(0, 40) : "",
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      classifier: "gemini",
    };
  }
  return { route };
}

module.exports = { createStageRouter, ROUTER_SCHEMA, WIDGET_MENU };
