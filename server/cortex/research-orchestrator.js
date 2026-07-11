const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

function cleanString(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function errorWithStatus(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function htmlTitle(html = "") {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] || "");
}

function hostnameLooksPrivate(hostname = "") {
  const lower = String(hostname || "").toLowerCase();
  return lower === "localhost"
    || lower.endsWith(".local")
    || lower.endsWith(".internal")
    || lower === "127.0.0.1"
    || lower === "::1"
    || /^10\./.test(lower)
    || /^192\.168\./.test(lower)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)
    || /^169\.254\./.test(lower);
}

async function assertPublicUrl(rawUrl) {
  const url = new URL(cleanString(rawUrl, 2000));
  if (!["http:", "https:"].includes(url.protocol)) throw errorWithStatus("Only HTTP and HTTPS URLs can be read", 400);
  if (url.username || url.password) throw errorWithStatus("URLs containing credentials are not allowed", 400);
  if (hostnameLooksPrivate(url.hostname)) throw errorWithStatus("Private, local, or reserved URLs are not allowed for public URL reading", 403);
  const addresses = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  for (const address of addresses) {
    if (hostnameLooksPrivate(address.address) || net.isIP(address.address) && (
      address.address.startsWith("10.")
      || address.address.startsWith("192.168.")
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address.address)
      || address.address.startsWith("127.")
      || address.address === "::1"
    )) {
      throw errorWithStatus("Resolved URL points to a private or reserved address", 403);
    }
  }
  return url;
}

function createResearchOrchestrator({ getSettings, fetchImpl = fetch }) {
  async function urlRead(args = {}) {
    const url = await assertPublicUrl(args.url);
    const maxChars = Math.max(500, Math.min(60000, Number(args.maxChars || 18000)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "JARVIS-Cortex/2.0 public-research-reader",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.3",
        },
      });
      const contentType = String(response.headers.get("content-type") || "");
      const raw = await response.text();
      if (!response.ok) throw errorWithStatus(`URL read failed (${response.status})`, 502);
      const text = contentType.includes("html") ? stripHtml(raw) : raw.replace(/\s+/g, " ").trim();
      return {
        url: url.toString(),
        finalUrl: response.url || url.toString(),
        title: contentType.includes("html") ? htmlTitle(raw) : "",
        contentType,
        text: text.slice(0, maxChars),
        textLength: text.length,
        truncated: text.length > maxChars,
        fetchedAt: new Date().toISOString(),
        evidence: {
          source: "url_read",
          confidence: response.ok ? 0.8 : 0,
          verification: ["HTTP response succeeded", "Content was extracted into readable text"],
        },
      };
    } catch (error) {
      if (error.name === "AbortError") throw errorWithStatus("URL read timed out", 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function groundedSearch(query, context = "") {
    const settings = getSettings();
    const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) throw errorWithStatus("Gemini is not configured, so Cortex research is unavailable.", 412);
    const model = settings.geminiFastModel || settings.geminiModel || "gemini-2.5-flash";
    const apiBase = String(settings.geminiApiBaseUrl || process.env.JARVIS_GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const response = await fetchImpl(`${apiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "You are JARVIS Cortex v2. Build a concise, source-backed research answer.",
              "Return the answer, key facts, caveats, and cite sources from Google Search grounding.",
              `Current timestamp: ${new Date().toISOString()}. User timezone: America/New_York.`,
              context ? `Context:\n${context}` : "",
              `Question:\n${query}`,
            ].filter(Boolean).join("\n\n"),
          }],
        }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw errorWithStatus(data?.error?.message || `Grounded search failed (${response.status})`, 502);
    const candidate = data.candidates?.[0] || {};
    const answer = (candidate.content?.parts || []).map((part) => part.text).filter(Boolean).join("\n").trim();
    const sources = (candidate.groundingMetadata?.groundingChunks || [])
      .map((chunk) => chunk.web)
      .filter((item) => item?.uri)
      .map((item) => ({ title: item.title || item.uri, url: item.uri }))
      .filter((item, index, array) => array.findIndex((other) => other.url === item.url) === index)
      .slice(0, 8);
    return { answer, sources, raw: data };
  }

  async function deepResearch(args = {}) {
    const query = cleanString(args.query, 1200);
    if (!query) throw errorWithStatus("Research query is required", 400);
    const context = cleanString(args.context, 4000);
    const search = await groundedSearch(query, context);
    const readLimit = Math.max(0, Math.min(5, Number(args.readTopSources ?? 2)));
    const readSources = [];
    for (const source of search.sources.slice(0, readLimit)) {
      try {
        const read = await urlRead({ url: source.url, maxChars: 6000 });
        readSources.push({
          title: read.title || source.title,
          url: read.finalUrl || source.url,
          excerpt: read.text.slice(0, 1200),
          textLength: read.textLength,
        });
      } catch (error) {
        readSources.push({ title: source.title, url: source.url, error: error.message });
      }
    }
    const confidence = search.sources.length >= 2 ? 0.82 : search.sources.length === 1 ? 0.68 : 0.2;
    return {
      query,
      answer: search.answer,
      sources: search.sources,
      readSources,
      evidence: {
        id: crypto.randomUUID(),
        claim: query,
        confidence,
        freshness: "live",
        verification: [
          search.sources.length ? "Grounded search returned source citations" : "No grounded citations returned",
          readSources.length ? "Top source URL extraction attempted" : "Full-page source reading was skipped",
        ],
        limits: search.sources.length ? [] : ["No source URLs were returned, so the answer must be treated as unverified."],
      },
      fetchedAt: new Date().toISOString(),
      plainEnglish: search.answer || "Cortex research returned no answer text.",
    };
  }

  return { deepResearch, urlRead };
}

module.exports = { createResearchOrchestrator, stripHtml };
