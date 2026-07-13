// ECLIPSE live provider — the `liveCall` the adapter uses in mode:"live". Implements the
// ADR-006 Interactions backbone: prefers the Interactions API (background=true + store,
// previous_interaction_id for continuity/implicit caching, thought-signature passthrough,
// thinking_level XOR budget, temperature left at 1.0), and falls back to the well-known
// models.generateContent path when Interactions isn't exposed by the installed SDK.
//
// NOTE: this is the ONLY module that spends real Gemini credits, and ONLY when the adapter is
// created with mode:"live". It is intentionally NOT exercised by any test (zero-credit policy);
// it will be validated against the real API in a later, minimal, credit-budgeted checkout.
const { GoogleGenAI } = require("@google/genai");

// Map our thinking policy → SDK thinkingConfig. Gemini 3 uses thinking levels; never send both
// a level and a budget (ADR-006). "none" disables thinking.
function thinkingConfig(thinking) {
  if (!thinking || thinking === "none") return undefined;
  return { thinkingLevel: thinking }; // "minimal" | "low" | "medium" | "high"
}

// deps: { getApiKey(): string }  — resolves the key lazily so we never capture/store it.
function createInteractionsClient({ getApiKey }) {
  if (typeof getApiKey !== "function") throw new Error("[eclipse] interactions client needs getApiKey()");

  // call: { node, modelId, role, thinking, system, input, tools?, schema?, previousInteractionId?, thoughtSignature? }
  async function liveCall(call) {
    const apiKey = getApiKey();
    if (!apiKey) { const e = new Error("Gemini API key not configured"); e.status = 412; throw e; }
    const ai = new GoogleGenAI({ apiKey });

    const wantsJson = !!call.schema;
    const genConfig = {
      systemInstruction: call.system || undefined,
      temperature: 1.0, // ADR-006: do NOT lower on Gemini 3
      thinkingConfig: thinkingConfig(call.thinking),
      ...(wantsJson ? { responseMimeType: "application/json" } : {}),
      ...(call.tools && call.tools.length ? { tools: call.tools.slice(0, 20) } : {}),
    };

    // Preferred path: Interactions API (durable/observable). Feature-detected AND opt-in — the
    // experimental Interactions schema differs from generation_config (rejects systemInstruction),
    // so until parity is proven we default to the reliable generateContent path (ADR-006).
    if (process.env.ECLIPSE_USE_INTERACTIONS === "1" && ai.interactions && typeof ai.interactions.create === "function") {
      const res = await ai.interactions.create({
        model: call.modelId,
        input: call.input,
        store: true,
        background: true,
        previous_interaction_id: call.previousInteractionId || undefined,
        thought_signature: call.thoughtSignature || undefined,
        generation_config: genConfig,
      });
      return normalize(res, wantsJson, { interactionId: res.id || res.interaction_id, thoughtSignature: res.thought_signature });
    }

    // Fallback path: generateContent (no server-side durability; adapter+checkpointer still cover us).
    // Some models (e.g. 2.5-flash) reject thinkingConfig → strip it and retry.
    let res;
    try {
      res = await ai.models.generateContent({ model: call.modelId, contents: call.input, config: genConfig });
    } catch (e) {
      if (/thinking.?level|thinking_config|thinking.*not supported/i.test(String(e.message))) {
        const { thinkingConfig, ...noThink } = genConfig;
        res = await ai.models.generateContent({ model: call.modelId, contents: call.input, config: noThink });
      } else throw e;
    }
    return normalize(res, wantsJson, { interactionId: null, thoughtSignature: null });
  }

  return { liveCall };
}

function normalize(res, wantsJson, extra) {
  const text = (typeof res.text === "string" ? res.text : null) ?? extractText(res) ?? "";
  const usageMeta = res.usageMetadata || res.usage_metadata || {};
  const usage = {
    tokensIn: usageMeta.promptTokenCount || usageMeta.prompt_token_count || 0,
    tokensOut: (usageMeta.candidatesTokenCount || usageMeta.candidates_token_count || 0) + (usageMeta.thoughtsTokenCount || usageMeta.thoughts_token_count || 0),
  };
  let json;
  if (wantsJson) { try { json = JSON.parse(text); } catch { json = undefined; } } // adapter's repair loop handles invalid JSON
  return { text, json, usage, ...extra };
}

function extractText(res) {
  const parts = res?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p) => p.text || "").join("");
  return null;
}

module.exports = { createInteractionsClient, thinkingConfig };
