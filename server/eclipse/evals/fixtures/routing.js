// Worked-example routing cases → expected tier. Deterministic; no Gemini.
// These encode the router's contract: normal prompts stay cheap, only strong+corroborated
// signal escalates to a mission. Each: {prompt, expect, why}.
module.exports = [
  // Allowlist → cortex (cheapest, no tools/mission)
  { prompt: "hi", expect: "cortex", why: "greeting" },
  { prompt: "thanks!", expect: "cortex", why: "social" },
  { prompt: "what's 2+2", expect: "cortex", why: "trivial arithmetic" },
  { prompt: "calculate 15*(3+4)", expect: "cortex", why: "arithmetic" },
  { prompt: "what time is it", expect: "cortex", why: "time lookup" },
  { prompt: "turn on the desk light", expect: "cortex", why: "device command" },

  // Pulse → single agent, no fan-out
  { prompt: "what is the capital of France", expect: "pulse", why: "single low-depth fact" },
  { prompt: "summarize this PDF I uploaded", expect: "pulse", why: "bounded extract, no external breadth" },
  { prompt: "email the board my Q3 summary", expect: "pulse", why: "high-consequence single action → approval, not a mission" },
  { prompt: "explain how RSA encryption works", expect: "pulse", why: "explanatory answer, no live tools" },

  // Deep → bounded mission, ≥1 tool Worker
  { prompt: "what's the current BTC price", expect: "deep", why: "freshness override needs a tool" },
  { prompt: "compare LangGraph vs CrewAI vs AutoGen for our runtime and recommend one", expect: "deep", why: "3-way compare, bounded, single-signal" },

  // Totality → full multi-agent mission
  { prompt: "research the competitive landscape for AI trading copilots and draft a brief", expect: "totality", why: "research family + breadth + artifact" },
  { prompt: "do a deep dive on quantum error correction", expect: "totality", why: "explicit deep-dive intent" },

  // Ambiguity → clarify, never a mission
  { prompt: "what should I do about the thing", expect: "cortex", why: "too vague → clarify" },
];
