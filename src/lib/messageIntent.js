"use strict";
// Client-side "send an email/message to someone" detector. It runs in JarvisUI before the brain so a
// clear send command goes straight to /api/email/smart (which resolves the recipient — known contact,
// raw address, or "me" — composes, and sends). This function's ONLY jobs are (1) be confident the
// utterance is a send-to-a-person intent and (2) hand back a recipient guess. It must NOT fire on
// report-writing, reminders, inbox reads, or messages meant for another channel (Instagram/WhatsApp/…)
// — those fall through to capture / the browser lane / the brain.
//
// Kept as a plain CommonJS module (not TSX) so it is unit-testable offline with node --test over a big
// matrix of varied phrasings, exactly like the server's execution-lane-router. A .d.ts alongside gives
// the TypeScript UI its types (tsconfig has allowJs:false, so tsc ignores this file and reads the .d.ts).

const ADDR = "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}";
const ADDR_RE = new RegExp(ADDR, "i");

// Recipient head-words that are never a person — common inanimate targets + non-person pronouns. We
// test this AFTER stripping a leading determiner, so "the list" / "my inbox" are judged by their head.
const NOT_A_PERSON =
  /^(?:it|this|that|these|those|there|here|myself|yourself|itself|printer|file|files|server|folder|inbox|outbox|list|address|link|url|page|pdf|doc|docs|document|report|group|channel|thread|screen|clipboard|everyone|everybody|team|weather|price|news|summary|update|task|todo|reminder|meeting)\b/i;

// Words that are a verb here, not a name — guards "...to email the team" (where "email" follows "to").
const VERB_NOT_NAME = new Set([
  "send", "write", "draft", "compose", "shoot", "forward", "reply", "respond", "drop", "mail", "email",
  "e-mail", "fire", "call", "text", "ping", "message", "dm", "do", "finish", "buy", "get", "make",
  "add", "remind", "schedule", "tell", "ask", "let", "check", "read", "show", "find",
]);

// A determiner we allow in front of a person ("my professor", "our lawyer"); stripped before judging.
const DET = "(?:my|our|the|a|an)\\s+";
// A recipient token: an address, OR "<det> word", OR a bare word that is NOT itself a determiner (so
// "send an email to …" doesn't capture "an" as the recipient). No capitalization reliance — the /i
// flag would defeat it anyway — a single token, or a determiner + single token.
const NAME = `${ADDR}|${DET}[A-Za-z][A-Za-z0-9._'-]*|(?!(?:a|an|the|my|our|your|his|her|their)\\b)[A-Za-z][A-Za-z0-9._'-]*`;

// Verbs meaning "put this in front of a person". Excludes bare "message/ping/text/dm" (chat channels).
const SEND =
  "send|write|draft|compose|shoot|forward|reply|respond|drop|mail|e-?mail|" +
  "fire\\s+(?:it|them|this|that|off)?\\s*off|send\\s+(?:it|them|this|that)?\\s*off";

// A "message object" noun for the direct pattern ("shoot AJ a note", "drop Bob a line").
const MSG_NOUN = "(?:note|message|msg|line|email|e-mail|mail|update|heads?\\s*up|reply|word)";

function isReadOnlyInbox(t) {
  return (
    /\b(read|check|show|see|any|summar(?:y|ise|ize)|go through|catch me up|unread|inbox|latest|new (?:mail|emails?|messages?))\b/i.test(t) &&
    !/\b(send|write|shoot|compose|draft|drop|reply|respond|forward|fire\s+\w*\s*off|e-?mail|mail)\b/i.test(t)
  );
}

function mentionsOtherChannel(t) {
  return /\b(instagram|insta|whats\s?app|telegram|\btg\b|slack|discord|\bdm\b|dms|sms|imessage|snapchat|snap|tweet|twitter)\b/i.test(t) ||
    /\btext\s+(?:him|her|them|message|mom|dad|\w+)\s+(?:that|saying|about)\b/i.test(t);
}

// A captured recipient is a real person target if, after dropping a leading determiner, its head word
// is neither an inanimate noun nor a verb-used-as-name.
function personOK(raw) {
  const bare = String(raw).trim().toLowerCase();
  if (/^(?:a|an|the|my|our|your|his|her|their|its)$/.test(bare)) return false; // bare determiner, not a name
  const head = String(raw).replace(/^(?:my|our|the|a|an|your)\s+/i, "").trim();
  if (!head) return false;
  if (NOT_A_PERSON.test(head)) return false;
  if (VERB_NOT_NAME.has(head.toLowerCase().split(/\s+/)[0])) return false;
  return true;
}

/**
 * @param {string} text
 * @returns {{recipient: string}|null}
 */
function detectMessageIntent(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (isReadOnlyInbox(t)) return null;
  if (mentionsOtherChannel(t)) return null;

  const hasEmailWord = /\b(e-?mail|mail|gmail)\b/i.test(t);
  const addr = t.match(ADDR_RE)?.[0] || null;
  const hasSend = new RegExp(`\\b(?:${SEND})\\b`, "i").test(t);

  // (A) A real address plus any send/email cue → unambiguously an email; the address IS the recipient.
  if (addr && (hasSend || hasEmailWord)) return { recipient: addr };

  // (E) Explicit "email/mail" word → resolve the recipient the way the original narrow path did.
  if (hasEmailWord) {
    let m = t.match(new RegExp(`\\bsend\\s+(${NAME})\\s+(?:an?\\s+)?(?:e-?mail|mail|note|message)\\b`, "i"));
    if (!m) m = t.match(new RegExp(`\\b(?:e-?mail|mail)\\s+(?:an?\\s+(?:e-?mail|mail|note|message)\\s+)?(?:to\\s+)?(${NAME})\\b`, "i"));
    if (!m) m = t.match(new RegExp(`\\bto\\s+(${NAME})\\b`, "i"));
    if (m && m[1] && personOK(m[1])) return { recipient: m[1].trim() };
    return null; // said "email" but named no one resolvable → let the brain handle it, don't guess
  }

  // (T1) "<sendverb> <recipient> a note/line/message … <content>" — no "email" word needed.
  //      "shoot AJ a note that the deploy passed", "drop Bob a line about the invoice".
  const direct = t.match(
    new RegExp(`\\b(?:${SEND})\\s+(${NAME})\\s+(?:(?:a|an|another|the|quick|short|brief)\\s+)*${MSG_NOUN}\\b`, "i"),
  );
  if (direct && personOK(direct[1])) return { recipient: direct[1].trim() };

  // (T2) "<sendverb> … to <recipient> <content>" — the "to" marks the person; content must follow.
  //      "fire off an update to Priya about the launch", "send this to mom saying I'll be late".
  const toM = t.match(new RegExp(`\\b(?:${SEND})\\b[\\s\\S]*?\\bto\\s+(${NAME})\\b([\\s\\S]*)$`, "i"));
  if (toM && personOK(toM[1]) && (toM[2] || "").trim().length > 0) return { recipient: toM[1].trim() };

  // (D) "tell/let/ask/remind <him|her|them> <content>" — pronoun recipient (needs prior context; the
  //     backend asks if it cannot resolve). Never "me/us", never bare with no content.
  const pro = t.match(/\b(?:tell|let|ask|remind|update)\s+(him|her|them)\b([\s\S]*)$/i);
  if (pro && (pro[2] || "").trim().length > 0) return { recipient: pro[1].toLowerCase() };

  return null;
}

module.exports = { detectMessageIntent };
