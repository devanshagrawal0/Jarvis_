// ECLIPSE live web tools — REAL search + fetch so the evidence pipeline verifies end-to-end.
//   • search()  → Gemini "googleSearch" grounding returns real source URLs (no extra API key;
//                 uses the same Gemini key Cortex uses).
//   • fetchUrl() → Node global fetch (follows redirects) → cleaned page text for evidence +
//                 for the Citation Verifier to re-read. Bounded + timeout'd; failures are honest
//                 (live:false) so the promotion gate drops dead/unreachable sources.
const MAX_TEXT = 6000;

function htmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function createLiveWebTools({ ai, searchModel, timeoutMs = 15000 }) {
  // Real search via Gemini Google-Search grounding → [{url,title}] from grounding metadata.
  async function search(query) {
    try {
      const r = await ai.models.generateContent({ model: searchModel, contents: `Find authoritative sources for: ${query}`, config: { tools: [{ googleSearch: {} }] } });
      const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const seen = new Set();
      const results = [];
      for (const c of chunks) {
        const uri = c.web && c.web.uri;
        if (uri && !seen.has(uri)) { seen.add(uri); results.push({ url: uri, title: (c.web.title || "").slice(0, 120) }); }
      }
      return results.slice(0, 5);
    } catch (e) { return []; }
  }

  // Real fetch → cleaned text. live=false on any failure/non-2xx so the gate can reject it.
  async function fetchUrl(url) {
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; EclipseResearch/1.0)" }, signal: AbortSignal.timeout(timeoutMs) });
      const html = await res.text();
      return { text: htmlToText(html), status: res.status, live: res.ok };
    } catch (e) { return { text: "", status: 0, live: false, error: String(e.message).slice(0, 120) }; }
  }

  return { search, fetchUrl };
}

module.exports = { createLiveWebTools, htmlToText };
