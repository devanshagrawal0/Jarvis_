"use strict";

// WHAT THE OWNER SAID, READ BY A MODEL INSTEAD OF BY EIGHT REGULAR EXPRESSIONS.
//
// `extractMutations()` in personal-context-router.js is the whole of Memory vNext's write path,
// and it is eight patterns: a forget list, weight, height, age, "my name is", "my goal is",
// "i prefer|i like", and "my <x> is <y>". Nothing else the owner says is ever written down.
//
// Measured on this machine 2026-09-03, against the live candidate store:
//
//     documents indexed on import day (2026-07-26) : 2,473
//     documents indexed in the four weeks after    :    35
//     owner turns in that same window              : 2,235
//
// Thirty-five records out of four and a half thousand turns. That is why the retrieval index is
// effectively frozen at the import, why every one of the twelve open high-severity comparisons is
// dated after 26 July, and why those twelve searches return in 11-20ms instead of the usual 40-70:
// there is nothing in the index to find. The gate is not wrong to block; the memory genuinely has
// almost nothing in it.
//
// A wider regex is not the fix — it is the same defect with more branches, and it is the pattern
// this project bans outright. Whether a sentence contains a durable fact about the owner is a
// judgement about meaning, so it is asked as one.
//
// THREE THINGS THIS DELIBERATELY DOES NOT DO:
//
//   1. It does not replace `extractMutations`. That stays exactly as it is and still runs first —
//      it is the deterministic floor, it is unit-tested, and a model outage must degrade to
//      today's behaviour rather than to no memory at all. This is strictly additive: the model can
//      only ever add facts the regexes missed, and a deterministic hit always wins a conflict.
//   2. It does not run on the answer path. It is called from the shadow runtime's background
//      queue, which already runs after the turn is answered, so it adds nothing to the latency the
//      owner feels. This is the same shape Hermes uses for its background memory review.
//   3. It does not write health, location, or identity beyond a preferred name. Those are denied
//      by the canary policy anyway, and a model inferring the owner's location or health from
//      conversation is precisely the failure this store exists to prevent.
//
// Facts it does write land in the namespaces the guarded canary actually admits — preference.*,
// goal.*, profile.*, owner.* — so an extracted fact can reach the prompt rather than sitting in a
// table nothing reads.

const { MODELS, candidatesFor, noteModelFailure, noteModelSuccess } = require("../gemini-models");

const TIMEOUT_MS = 6_000;
const MAX_FACTS = 6;
const MAX_INPUT_CHARS = 4_000;

// The canary admits these prefixes. Anything else is dropped rather than written, so the extractor
// cannot quietly widen what the store holds by inventing a new namespace.
const ALLOWED_PREFIX = ["preference.", "goal.", "profile.", "owner."];
const ALLOWED_EXACT = ["identity.preferred_name"];

// Denied whatever the model says. `sensitivityFor()` would mark these restricted and the canary
// would refuse to deliver them, so writing them only grows the store with things nothing can read.
const DENIED_PREFIX = ["health.", "location.", "identity."];

// A prefix check alone is bypassable by renaming, and the model did exactly that: blocked from
// `health.weight_kg`, it wrote `profile.weight` instead, which passed. Measured 2026-09-10 in the
// first backfill of 100 turns. So the LEAF is checked too — a health or location fact is denied
// whatever namespace it is dressed in.
//
// This is a safety denylist, not intent routing: it never decides what the owner meant, only
// refuses to store a class of fact this store is not allowed to hold. It is short and it will
// miss synonyms; the prefix rule above is still the primary guard and this closes the rename.
const DENIED_LEAF = new Set([
  "weight", "weight_kg", "weight_lb", "height", "height_cm", "bmi", "body_fat", "blood_pressure",
  "heart_rate", "medication", "medications", "diagnosis", "condition", "illness", "symptom", "allergy",
  "address", "home_address", "street", "city", "current_city", "postcode", "zip", "zipcode",
  "latitude", "longitude", "coordinates", "geo", "location", "current_location",
]);

function predicateAllowed(predicate) {
  const value = String(predicate || "").trim().toLowerCase();
  if (!value || value.length > 80) return false;
  if (ALLOWED_EXACT.includes(value)) return true;
  if (DENIED_PREFIX.some((prefix) => value.startsWith(prefix))) return false;
  if (DENIED_LEAF.has(value.slice(value.lastIndexOf(".") + 1))) return false;
  return ALLOWED_PREFIX.some((prefix) => value.startsWith(prefix));
}

const INSTRUCTION = [
  "You read one message the owner sent to his assistant and decide whether it states a DURABLE FACT ABOUT HIM that is worth remembering for future conversations.",
  "",
  "Write a fact down only when he is telling you something about himself that will still be true next week:",
  "  - a preference or a standing instruction about how he wants things done",
  "  - a goal, a project he is working on, or something he is trying to achieve",
  "  - a stable detail about his situation, tools, setup, or the people and things he works with",
  "  - a correction to something you previously had wrong",
  "",
  "Do NOT write a fact for:",
  "  - a question, a request, or an instruction for right now (\"open youtube\", \"what's the weather\")",
  "  - anything about the current moment that will be false tomorrow (times, prices, what is on screen)",
  "  - something he is quoting, pasting, or asking you to read",
  "  - your own suggestions, or anything he has not actually claimed about himself",
  "",
  "Most messages contain nothing worth keeping. Returning an empty list is the normal, correct answer.",
  "",
  "Use these predicate namespaces only:",
  "  preference.<thing>   how he wants things done      e.g. preference.communication, preference.code_style",
  "  goal.<thing>         something he is working toward e.g. goal.general, goal.career",
  "  profile.<thing>      a stable detail about him      e.g. profile.role, profile.tools",
  "  owner.<thing>        anything else durable about him",
  "  identity.preferred_name   only if he says what to call him",
  "",
  "Never emit a health, location, or identity predicate other than identity.preferred_name, even if he states one. Those are handled elsewhere.",
  "",
  "Use action \"forget\" only when he explicitly asks you to stop remembering something.",
  "Fill in `why` FIRST, in one short line, before choosing the predicate.",
].join("\n");

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        // The reasoning is generated before the label on purpose — the same trick `stage_render`'s
        // `plan` field and the presentation router already use in this codebase.
        propertyOrdering: ["why", "action", "predicate", "value"],
        properties: {
          why: { type: "string", description: "One short line: why this is durable and worth keeping. Fill this in first." },
          action: { type: "string", enum: ["set", "forget"] },
          predicate: { type: "string" },
          value: { type: "string" },
        },
        required: ["why", "action", "predicate", "value"],
      },
    },
  },
  required: ["facts"],
};

function createFactExtractor({ getSettings, logger = console } = {}) {
  if (typeof getSettings !== "function") throw new Error("A settings accessor is required.");

  // Returns mutations in exactly the shape `applyMutation` already consumes, so nothing downstream
  // has to learn a new object. `origin: "model"` is the one addition — it lowers the recorded
  // extraction confidence, because a model reading a sentence is not the same evidence as the
  // owner typing "my name is".
  // `known` is the owner's existing predicate vocabulary. Without it the model coins a fresh name
  // every time it sees the same idea — one backfill produced trading_mode_protocol AND
  // trading_mode_procedure, verification_protocol AND evidence_verification, exercise_time AND
  // exercise_schedule. Each pair is one preference split across two rows that then compete at
  // retrieval, so reuse is not tidiness, it is correctness.
  async function extract(text, { known = [] } = {}) {
    const settings = getSettings();
    const key = settings?.geminiKey;
    const body = String(text || "").trim();
    if (!key || !body) return [];
    const vocabulary = (Array.isArray(known) ? known : []).filter((item) => predicateAllowed(item)).slice(0, 120);
    const reuse = vocabulary.length
      ? `\n\nPREDICATES THIS OWNER ALREADY HAS. If the fact belongs to one of these, REUSE THE EXACT NAME — do not invent a near-synonym. Only coin a new predicate when nothing here fits:\n${vocabulary.map((item) => `  ${item}`).join("\n")}`
      : "";

    for (const model of candidatesFor(settings.geminiRouterModel || MODELS.router).slice(0, 2)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: `${INSTRUCTION}${reuse}` }] },
              contents: [{ role: "user", parts: [{ text: `The owner said:\n\n${body.slice(0, MAX_INPUT_CHARS)}` }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
            }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error?.message || `Gemini ${response.status}`);
        const raw = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
        const parsed = JSON.parse(raw || "{}");
        noteModelSuccess(model);

        const mutations = [];
        for (const fact of Array.isArray(parsed.facts) ? parsed.facts.slice(0, MAX_FACTS) : []) {
          const predicate = String(fact?.predicate || "").trim().toLowerCase();
          const value = String(fact?.value || "").trim();
          if (!predicateAllowed(predicate)) {
            if (predicate) logger.warn?.(`[memory-vnext-extract] dropped out-of-namespace predicate ${JSON.stringify(predicate)}`);
            continue;
          }
          if (fact?.action === "forget") { mutations.push({ action: "forget", predicate, reason: "model_read_owner_forget", origin: "model" }); continue; }
          if (!value || value.length > 400) continue;
          mutations.push({ action: "set", predicate, value, topics: ["personal"], origin: "model" });
        }
        if (mutations.length) logger.warn?.(`[memory-vnext-extract] read ${mutations.length} durable fact(s): ${mutations.map((item) => item.predicate).join(", ")}`);
        return mutations;
      } catch (error) {
        noteModelFailure(model);
        logger.warn?.(`[memory-vnext-extract] ${model} unavailable (${String(error?.message || error).slice(0, 90)})`);
      } finally {
        clearTimeout(timer);
      }
    }
    // Every failure path returns nothing extra. The deterministic extractor has already run, so a
    // model outage costs the turn its model-read facts and nothing else.
    return [];
  }

  return Object.freeze({ extract, predicateAllowed });
}

module.exports = { createFactExtractor, predicateAllowed };
