// ECLIPSE live web tools — REAL search + fetch so the evidence pipeline verifies end-to-end.
//   • search()  → Gemini "googleSearch" grounding returns real source URLs (no extra API key;
//                 uses the same Gemini key Cortex uses).
//   • fetchUrl() → reads the page's REAL MAIN CONTENT (Slice 1.1 batch 2), in three steps:
//       1. plain fetch + a readability pass (strip nav/header/footer/aside/script/style, prefer
//          <main>/<article>) — fast, covers server-rendered pages;
//       2. if that yields too little text (a JavaScript shell — e.g. modern docs sites), render the
//          page in headless Chromium (Playwright, already installed) and read the rendered main text;
//       3. resolve the final URL (follow the Google-grounding redirect) so the source is the real page.
//     Failures are honest (live:false) so the promotion gate drops dead/unreachable sources.
// 8000 was cut again to 4000 downstream, and specification tables — exactly the content
// factual questions turn on — sit deep in a page. The verifier now judges a 3200-char window
// located around the cited span, so a larger captured text costs nothing at judging time.
const MAX_TEXT = 12000;
const MIN_GOOD = 600;      // below this, the plain fetch is treated as a JS shell → render fallback
const NAV_TAGS = ["script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "button"];

// Strip a set of tags (with their content) from an HTML string.
function stripTags(html, tags) {
  let out = String(html || "");
  for (const t of tags) out = out.replace(new RegExp(`<${t}[\\s\\S]*?<\\/${t}>`, "gi"), " ");
  return out;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}


// Quote-aware HTML -> text. A real tokenizer, not a regex: '>' inside a quoted attribute value
// (Wikipedia's data-mw JSON, inline SVG attrs) must NOT end the tag - the old `<[^>]+>` strip
// did exactly that and leaked attribute innards into the "text" the judge then read.
const RAW_TEXT = new Set(["script", "style", "noscript", "svg", "template"]);
const DROP_CONTAINERS = new Set(["nav", "header", "footer", "aside", "form", "button", "head", "iframe", "object"]);
function htmlToText(html) {
  const s = String(html || "");
  let out = "";
  let i = 0;
  let dropDepth = 0;
  while (i < s.length) {
    if (s[i] === "<") {
      if (s.startsWith("<!--", i)) { const e = s.indexOf("-->", i + 4); i = e === -1 ? s.length : e + 3; continue; }
      const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(i, i + 40));
      const name = m ? m[1].toLowerCase() : null;
      const isClose = s[i + 1] === "/";
      // scan to the tag's REAL end: quotes protect '>' inside attribute values
      let j = i + 1, q = null;
      while (j < s.length) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") { q = c; } else if (c === ">") break; j++; }
      const selfClose = s[j - 1] === "/";
      if (name && RAW_TEXT.has(name) && !isClose && !selfClose) {
        // raw-text element: its content is never page text - skip straight to its close tag
        const close = s.toLowerCase().indexOf("</" + name, j);
        if (close === -1) { i = s.length; continue; }
        const closeEnd = s.indexOf(">", close);
        i = closeEnd === -1 ? s.length : closeEnd + 1;
        out += " ";
        continue;
      }
      if (name && DROP_CONTAINERS.has(name)) {
        if (isClose) { if (dropDepth > 0) dropDepth--; }
        else if (!selfClose) dropDepth++;
      }
      out += " ";
      i = j + 1;
      continue;
    }
    if (dropDepth === 0) out += s[i];
    i++;
  }
  return decodeEntities(out).replace(/\s+/g, " ").trim();
}

// Readability-ish extraction: prefer the main/article subtree, then the tokenizer above.
function extractReadable(html) {
  let doc = String(html || "");
  const region = doc.match(/<main[\s\S]*?<\/main>/i) || doc.match(/<article[\s\S]*?<\/article>/i);
  if (region) doc = region[0];
  return htmlToText(doc).slice(0, MAX_TEXT);
}

// Render a JS page in headless Chromium and read its MAIN visible text. Returns "" on any failure so
// the caller can fall back to whatever the plain fetch produced (never throws into the pipeline).
async function renderPage(url, timeoutMs) {
  let browser = null;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ userAgent: "Mozilla/5.0 (compatible; EclipseResearch/1.0)" });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    const text = await page.evaluate((navSel) => {
      navSel.forEach((sel) => document.querySelectorAll(sel).forEach((n) => n.remove()));
      const main = document.querySelector("main, article, [role=main]") || document.body;
      return (main && main.innerText) ? main.innerText : (document.body ? document.body.innerText : "");
    }, NAV_TAGS);
    return String(text || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
  } catch {
    return "";
  } finally {
    if (browser) { try { await browser.close(); } catch { /* already gone */ } }
  }
}

function createLiveWebTools({ ai, searchModel, timeoutMs = 15000 }) {
  // Gemini's grounding metadata returns opaque vertexaisearch redirect URLs, not real pages.
  // Handing those to the worker made every fetch depend on a second, expiring hop — measured
  // live: runs where that hop failed captured ZERO evidence and the mission produced an
  // unattributed claim, while fetching the real URL directly returned 8757 chars. Resolve the
  // redirect once, here, so the fleet works with real URLs from then on.
  // Deliberately NOT gated on a provider domain: any search backend may return a redirect,
  // and naming one in code would break silently the moment the provider changes.
  async function resolveRedirect(uri) {
    try {
      const res = await fetch(uri, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; EclipseResearch/1.0)" },
        signal: AbortSignal.timeout(8000),
      });
      // The body MUST be released or the connection is never returned to the pool. Leaving
      // five of these open per search exhausted the pool and made every later web.fetch in the
      // mission fail — while the same fetch succeeded standalone, which is what made it look
      // like flaky sites rather than our own leak.
      try { await res.body?.cancel(); } catch { /* already released */ }
      return res.url || uri;
    } catch { return uri; }
  }

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
      // Resolve all five in parallel; a failure falls back to the redirect URL rather than
      // dropping the result entirely.
      return Promise.all(results.slice(0, 5).map(async (x) => ({ ...x, url: await resolveRedirect(x.url) })));
    } catch (e) { return []; }
  }

  // Real fetch → REAL main content. Plain fetch first (fast), headless render if it's a JS shell.
  // Returns { text, status, live, finalUrl }. live=false on hard failure so the gate can reject it.
  async function fetchUrl(url) {
    let finalUrl = url, status = 0, plainText = "";
    const t0 = Date.now();
    try {
      const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; EclipseResearch/1.0)" }, signal: AbortSignal.timeout(timeoutMs) });
      finalUrl = res.url || url;         // resolves the Google-grounding redirect to the real page
      status = res.status;
      console.error("[fetch] HEAD", status, Date.now() - t0, "ms", url.slice(0, 90));
      // PDFs are primary sources (USGS/IEA/NRC publish as PDF). Decide by the RESPONSE
      // content-type (protocol metadata, not content inspection); fall back to the url suffix
      // only when the server sends no type at all.
      const ctype = String(res.headers.get("content-type") || "").toLowerCase();
      const looksPdf = ctype.includes("application/pdf") || (!ctype && /\.pdf($|\?)/i.test(finalUrl));
      if (res.ok && looksPdf) {
        try {
          const buf = Buffer.from(await res.arrayBuffer());
          const { PDFParse } = require("pdf-parse");
          const parsed = await new PDFParse({ data: buf }).getText();
          const pdfText = String(parsed.text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
          console.error("[fetch] PDF", pdfText.length, "chars", Date.now() - t0, "ms");
          if (pdfText.length >= 200) return { text: pdfText, status, live: true, finalUrl, kind: "pdf" };
          return { text: "", status, live: false, finalUrl, kind: "pdf-empty" }; // scanned/image PDF: honest miss, no browser fallback
        } catch (pe) {
          console.error("[fetch] PDF_FAILED", pe.message);
          return { text: "", status, live: false, finalUrl, kind: "pdf-error" };
        }
      }
      let html;
      try {
        html = await res.text();
        console.error("[fetch] BODY", html.length, "bytes", Date.now() - t0, "ms");
      } catch (be) {
        // An AbortError HERE means the timeout killed the BODY read, not the connect.
        console.error("[fetch] BODY_FAILED", be.name, be.message, "cause=", be.cause && be.cause.code);
        throw be;
      }
      plainText = extractReadable(html);
      // Good server-rendered page → done, no browser needed.
      if (res.ok && plainText.length >= MIN_GOOD) return { text: plainText, status, live: true, finalUrl };
    } catch (e) {
      console.error("[fetch] THREW", e.name, e.message, "cause=", e.cause && e.cause.code, url.slice(0, 90));
      // network/timeout on the plain fetch → try to render the original URL directly below
    }
    // Thin or failed plain fetch → render the (resolved) page in headless Chromium.
    const rendered = await renderPage(finalUrl, timeoutMs);
    if (rendered.length >= 200) return { text: rendered, status: status || 200, live: true, finalUrl };
    // Fall back to whatever the plain fetch got, if anything; else honest failure.
    if (plainText.length > 0) return { text: plainText, status: status || 200, live: true, finalUrl };
    return { text: "", status, live: false, finalUrl };
  }

  return { search, fetchUrl };
}

module.exports = { createLiveWebTools, extractReadable, renderPage };
