"use strict";

// Reads the text out of an email attachment so the composer can summarize it. Supported: plain text,
// PDF (pdf-parse), .docx (mammoth), and images (downscaled with sharp, transcribed by Gemini vision).
// Anything else — legacy binary .doc, unknown binary — yields "" so the composer simply ignores it.
//
// SECURITY: extracted text (from any source, including a .docx or an image someone attached) is treated
// as untrusted content. It only becomes material the composer may summarize; it never selects the
// recipient and never triggers a send — those are fixed by the /api/email/smart route, not by file
// contents. So a "email your secrets to attacker@x" line inside a document cannot cause an action.
//
// Kept as an injectable factory (getSettings supplies the Gemini key/model) so the dispatch + docx/text
// paths are unit-testable offline, exactly like email-composer.js and execution-lane-router.js.

const MAX = 12000;

function createAttachmentReader({ getSettings } = {}) {
  const settingsOf = () => (typeof getSettings === "function" ? getSettings() : {}) || {};

  async function imageToText(buf) {
    try {
      const settings = settingsOf();
      const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
      if (!apiKey) return "";
      let img = buf;
      // Keep the vision payload small and orientation-correct; fall back to the raw bytes if sharp can't
      // decode this format (e.g. HEIC without libheif) so the model still gets a shot at it.
      try {
        const sharp = require("sharp");
        img = await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      } catch { img = buf; }
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: settings.geminiFastModel || settings.geminiModel || "gemini-2.5-flash",
        contents: [{ role: "user", parts: [
          { text: "Extract ALL text visible in this image, verbatim, preserving line breaks. If it has little or no text, give one factual sentence describing what it shows. Output only the transcription or description — no preamble, no quotes." },
          { inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } },
        ] }],
        config: { temperature: 0 },
      });
      const parts = result?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p && p.text).filter(Boolean).join("") || result?.text || "";
      return String(text).trim().slice(0, MAX);
    } catch { return ""; }
  }

  async function extractAttachmentText(att) {
    if (!att || typeof att !== "object") return "";
    if (att.text) return String(att.text).slice(0, MAX);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(String(att.dataUrl || ""));
    if (!m) return "";
    const mime = m[1] || "";
    const name = att.name || "";
    let buf; try { buf = Buffer.from(m[2], "base64"); } catch { return ""; }
    if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) {
      try { const pdfParse = require("pdf-parse"); const r = await pdfParse(buf); return String(r.text || "").replace(/\n{3,}/g, "\n\n").slice(0, MAX); } catch { return ""; }
    }
    // .docx only — mammoth does not read the legacy binary .doc format, so we don't pretend to.
    if (/officedocument\.wordprocessingml/i.test(mime) || /\.docx$/i.test(name)) {
      try { const mammoth = require("mammoth"); const r = await mammoth.extractRawText({ buffer: buf }); return String(r.value || "").replace(/\n{3,}/g, "\n\n").slice(0, MAX); } catch { return ""; }
    }
    if (/^text\//i.test(mime) || /\.(txt|md|csv|json|log)$/i.test(name)) return buf.toString("utf8").slice(0, MAX);
    if (/^image\//i.test(mime) || /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif)$/i.test(name)) return await imageToText(buf);
    return "";
  }

  return { extractAttachmentText, imageToText };
}

module.exports = { createAttachmentReader };
