/* Jarvis brain — SINGLE SOURCE OF TRUTH for turn classification.
   The recurring "weather works but stocks refuse / a bare 'hi' gets a refusal" bugs came from
   THREE places each re-deriving "is this a live-info question?" from their own regex, on a
   `context`-contaminated prompt. This module centralizes those decisions so the grounding
   trigger and the evidence gate can never disagree, and so they can be unit-tested (see
   tests/backend/brain-classify.test.js). Pure, dependency-free, deterministic. */

// Room framing is sent as a prefix: "<context>\n\nUser: <message>". Every classifier must see
// ONLY the user's actual message — otherwise leftover context words ("today", "stock") make a
// plain "hi" look like a live-info question and it gets hard-refused.
function rawUserMessage(prompt) {
  const s = String(prompt || "");
  const i = s.lastIndexOf("\nUser: ");
  return (i >= 0 ? s.slice(i + 7) : s).trim();
}

// The ONE predicate for "this needs live/current information." Used by BOTH the grounding
// decision (so retrieval actually runs) AND the evidence gate (so the requirement matches what
// ran). Keep this the only definition — never re-inline a copy.
function needsFreshInfo(text) {
  // Require genuine LIVE intent — a bare "market"/"stock"/"shares" is often definitional
  // ("what is prediction market arbitrage"), so those alone must NOT trigger retrieval.
  // Bare time words (today/currently/current/right now/this week) are NOT live intent on their own —
  // "im tired today" is conversation, not a live-data request. Every topical signal below is kept;
  // only the standalone time words were removed.
  return /\b(latest|live|online|breaking|news|headline|weather|forecast|temperature|score|standings|schedule|fixture|price|quote|fell|fall|falling|rose|rising|rally|crash|surge|surged|plunge|plunged|jumped|slump|earnings|results|dividend|recent|new video)\b/i.test(String(text || ""));
}

module.exports = { rawUserMessage, needsFreshInfo };
