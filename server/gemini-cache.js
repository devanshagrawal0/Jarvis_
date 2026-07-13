// Cortex v4 · 2.4 — explicit context caching. Gemini has no implicit caching for us
// (verified cached=0 on repeats), so we cache the LARGE STABLE system preamble
// (personality + capabilities + security rules — the parts that don't change per
// turn) as a cachedContent and reference it, cutting repeated input-token cost.
// Dynamic per-turn context (time, memories) is sent in `contents`, not the cache.
// Fails safe: any error → returns null and the caller uses the normal path.
const crypto = require("crypto");

function createGeminiCache({ getSettings, apiBase = "https://generativelanguage.googleapis.com", fetchImpl = fetch, ttlSec = 900 }) {
  // key(hash) → { name, model, expiresAt }
  const cache = new Map();

  function hash(model, text) {
    return crypto.createHash("sha1").update(`${model}\n${text}`).digest("hex").slice(0, 16);
  }

  async function getOrCreate({ model, systemText }) {
    const key = getSettings().geminiKey;
    if (!key || !systemText || systemText.length < 3000) return null; // ~<1024 tokens: not worth caching
    const h = hash(model, systemText);
    const now = Date.now();
    const hit = cache.get(h);
    if (hit && hit.expiresAt > now + 20_000) return hit.name; // reuse if comfortably unexpired
    try {
      const body = JSON.stringify({
        model: `models/${model}`,
        systemInstruction: { parts: [{ text: systemText }] },
        ttl: `${ttlSec}s`,
      });
      const resp = await fetchImpl(`${apiBase}/v1beta/cachedContents?key=${key}`, {
        method: "POST", headers: { "content-type": "application/json" }, body,
      });
      if (!resp.ok) return null;
      const j = await resp.json();
      if (!j.name) return null;
      cache.set(h, { name: j.name, model, expiresAt: now + ttlSec * 1000 });
      return j.name;
    } catch { return null; }
  }

  function stats() { return { entries: cache.size, names: [...cache.values()].map((v) => v.name) }; }

  return { getOrCreate, stats };
}

module.exports = { createGeminiCache };
