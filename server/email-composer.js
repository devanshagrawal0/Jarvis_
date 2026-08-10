"use strict";

// Smart email composer. Turns the owner's spoken instruction into a real email, deciding first
// whether the instruction IS the message (direct speech — "saying hi") or DESCRIBES the message
// (reported speech — "tell him the automation works"). Direct speech → send the exact words, don't
// embellish. Reported speech → write a proper, concise email with a real subject.
//
// Research basis: direct vs reported speech is the reliable signal (say/quote = verbatim; tell / let
// know / ask / update / explain / remind = compose). Good composed email = descriptive subject under
// ~60 chars, body ≤ ~5 sentences / 50–125 words, courteous but brief, tone matched to the ask.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Fast, dependency-free fallback used when the model is unavailable or returns junk. Conservative:
// prefers verbatim so it never invents content the owner didn't ask for.
function heuristicCompose(instruction, recipientName) {
  const t = String(instruction || "").trim();
  // direct-speech marker → take the literal words after it
  const say = t.match(/\b(?:saying|that says?|to say|says?)\b[:,]?\s+(.+)$/i);
  if (say) return { mode: "verbatim", subject: "", body: say[1].trim().replace(/^["']|["']$/g, "") };
  // reported-speech / descriptive → we can't safely generate without the model; relay a short note
  const cleaned = t.replace(/^\s*(?:tell(?:ing)?|let(?:ting)?\s+(?:them|him|her)\s+know|ask(?:ing)?|remind(?:ing)?|update)\s+(?:them|him|her|[A-Z][\w.-]*)?\s*(?:that\s+)?/i, "").trim();
  return { mode: "verbatim", subject: "", body: (cleaned || t).replace(/^["']|["']$/g, "") };
}

function createEmailComposer({ getSettings, model } = {}) {
  async function compose({ instruction, recipientName = "", attachmentText = "", ownerName = "" } = {}) {
    const raw = String(instruction || "").trim();
    if (!raw) return { mode: "verbatim", subject: "", body: "" };
    const settings = (typeof getSettings === "function" ? getSettings() : {}) || {};
    const apiKey = settings.geminiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) return heuristicCompose(raw, recipientName);

    const sys = [
      "You compose emails on behalf of the owner. Return STRICT JSON only: {\"mode\":\"verbatim\"|\"compose\",\"subject\":string,\"body\":string}.",
      "Decide mode by grammar, not keywords:",
      "- VERBATIM: the instruction IS the message to relay word-for-word (direct speech), e.g. 'saying hi', 'say on my way', 'tell her: running late'. Put the EXACT words in body. Do NOT add greetings, sign-offs, or extra sentences. Subject may be empty or 2-4 words.",
      "- COMPOSE: the instruction DESCRIBES what to convey (reported speech), e.g. 'tell him the automation works', 'let her know I'll be late and to reschedule', 'ask about the invoice', or asks to use an attachment. Write a real, concise email.",
      "COMPOSE rules: subject descriptive and under 60 characters; body <= 5 sentences, roughly 50-125 words, courteous but brief (never abrupt/rude); open with a short greeting using the recipient's first name if given; match the tone of the instruction (casual stays casual); sign off simply" + (ownerName ? ` as ${ownerName}` : "") + ". Never pad a trivial message into paragraphs. If the owner asks to note that it was sent for them / by their assistant, add one short line for it.",
      "Never invent facts, names, links, times, or numbers that the owner did not provide.",
    ].join("\n");

    const user = [
      recipientName ? `Recipient: ${recipientName}` : "Recipient: (unknown)",
      attachmentText ? `Attached content to use:\n"""${String(attachmentText).slice(0, 6000)}"""` : "",
      `Owner's instruction: ${raw}`,
      "Return only the JSON object.",
    ].filter(Boolean).join("\n\n");

    try {
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: model || settings.geminiFastModel || settings.geminiModel || "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `${sys}\n\n${user}` }] }],
        config: { temperature: 0.4, responseMimeType: "application/json" },
      });
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || "";
      const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
      const mode = parsed.mode === "compose" ? "compose" : "verbatim";
      let subject = String(parsed.subject || "").trim().slice(0, 120);
      let body = String(parsed.body || "").trim();
      if (!body) return heuristicCompose(raw, recipientName);
      if (mode === "compose" && !subject) subject = body.split(/[.!?\n]/)[0].slice(0, 60);
      return { mode, subject, body };
    } catch {
      return heuristicCompose(raw, recipientName);
    }
  }

  return { compose };
}

module.exports = { createEmailComposer, heuristicCompose, EMAIL_RE };
