const EXTRACT_PROMPT = `You are a memory extraction system for Jarvis, a personal AI assistant.

Given a conversation excerpt, extract 1-8 discrete, durable facts about the USER.

Rules:
- Extract ONLY facts explicitly stated by the user, not guesses or inferences
- Each fact must be self-contained and useful without surrounding context
- Focus on: preferences, corrections, personal details, behavioral rules, goals, decisions
- Skip filler turns ("okay", "thanks", "sounds good") and Jarvis's own statements
- Return valid JSON only, no prose

Return exactly this JSON shape:
{
  "facts": [
    {
      "text": "User prefers concise responses without bullet points",
      "kind": "procedural",
      "category": "interaction-rule",
      "confidence": 0.95,
      "importance": 0.85,
      "isCorrection": false
    }
  ]
}

kind values: "semantic" (facts/preferences about the world or user), "procedural" (behavioral rules like "always do X"), "episodic" (specific events or decisions)
category values: personal, preference, interaction-rule, goal, project, account, correction, fact`;

function createMemoryExtractor({ memoryStore, getSettings, turnThreshold = 5 }) {
  const buffers = new Map();
  const counters = new Map();

  function push(sessionId, userText, assistantText) {
    if (!memoryStore || !getSettings || !sessionId) return;
    const id = String(sessionId);
    const buf = buffers.get(id) || [];
    buf.push({
      user: String(userText || "").slice(0, 1500),
      assistant: String(assistantText || "").slice(0, 2000),
    });
    buffers.set(id, buf);

    const count = (counters.get(id) || 0) + 1;
    counters.set(id, count);

    if (count % turnThreshold === 0) {
      const snapshot = [...buf];
      buffers.set(id, []);
      runExtraction(id, snapshot).catch((err) => {
        console.warn(`[memory-extractor] Extraction failed for ${id}:`, err.message);
        // Restore snapshot so turns aren't silently lost on Gemini failure
        const current = buffers.get(id) || [];
        buffers.set(id, [...snapshot, ...current]);
      });
    }
  }

  async function runExtraction(sessionId, turns) {
    if (!turns.length) return;
    let apiKey;
    try {
      const settings = getSettings();
      apiKey = settings?.geminiApiKey || settings?.providers?.gemini?.apiKey;
    } catch {
      return;
    }
    if (!apiKey) return;

    const conversation = turns
      .map((t, i) => `Turn ${i + 1}:\nUser: ${t.user}\nJarvis: ${t.assistant}`)
      .join("\n\n---\n\n");

    let raw;
    try {
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: `${EXTRACT_PROMPT}\n\nConversation:\n${conversation}` }] }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 },
      });
      raw = result.candidates?.[0]?.content?.parts?.[0]?.text || result.text || "{}";
    } catch {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    for (const fact of facts.slice(0, 8)) {
      const text = String(fact.text || "").trim();
      if (!text || text.length < 10) continue;
      try {
        memoryStore.upsert({
          text: text.slice(0, 1200),
          kind: ["semantic", "procedural", "episodic"].includes(fact.kind) ? fact.kind : "semantic",
          category: String(fact.category || "personal").slice(0, 80),
          source: `extractor:session`,
          confidence: Math.max(0.5, Math.min(1, Number(fact.confidence ?? 0.85))),
          importance: Math.max(0.3, Math.min(1, Number(fact.importance ?? 0.7))),
          metadata: {
            extractedAt: new Date().toISOString(),
            sessionId,
            isCorrection: Boolean(fact.isCorrection),
            extractedByPipeline: true,
          },
        });
      } catch {
        // ignore individual fact write failures
      }
    }
  }

  function clearSession(sessionId) {
    const id = String(sessionId || "");
    buffers.delete(id);
    counters.delete(id);
  }

  function status() {
    return {
      activeSessions: buffers.size,
      sessionCounts: Object.fromEntries(counters),
      turnThreshold,
    };
  }

  return { push, clearSession, status };
}

module.exports = { createMemoryExtractor };
