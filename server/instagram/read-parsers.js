"use strict";

// Turn a page snapshot into a structured answer. Pure functions — snapshot in, data out — so they
// are proven against fixture snapshots with no browser and no account.
//
// The stable key everywhere is the username taken from a link's href (/username/). Display names,
// avatars, and Instagram's class names all churn; the username in the URL does not. So we read
// people by their hrefs, exactly as the working scrapers do.

const { handleFromHref } = require("../automation/recipient-guard");

function textOf(el) {
  return String((el && (el.name || el.text)) || "").replace(/\s+/g, " ").trim();
}

// People out of a modal or list (followers, following, likers, story viewers). Every profile link
// becomes one person; de-duplicated by username, first-seen order preserved. Reserved Instagram
// paths (/explore/, /direct/, /p/…) are not people and handleFromHref already rejects them.
function parsePeople(elements) {
  const seen = new Map();
  for (const el of Array.isArray(elements) ? elements : []) {
    const role = String(el.role || "").toLowerCase();
    const tag = String(el.tag || "").toLowerCase();
    if (role !== "link" && tag !== "a") continue;
    const username = handleFromHref(el.href);
    if (!username) continue;
    if (!seen.has(username)) {
      seen.set(username, { username, name: textOf(el) || username, href: el.href });
    }
  }
  return [...seen.values()];
}

// A DM inbox into threads — rewritten against the REAL Instagram DOM (validated live, Wave 1).
//
// Confirmed reality: a thread row is NOT an anchor with a /direct/t/ href (there is none). It is a
// `div[role="button"]` whose accessible NAME is the whole row, e.g.
//   "aj You: diagnostic timing test · 2h"
//   "Tg Tg sent an attachment. · 6h Unread"
//   "Active Yash Active now"
// The notes carousel at the top (song lyrics, birthday notes) are ALSO role=button divs, so we tell
// conversations apart by the markers only a conversation row has: a "· <time>" stamp, the word
// "Unread", "Active now", or "N new messages". And — correcting an earlier wrong assumption — the
// unread state IS in the text ("Unread"), so we can report it reliably after all.
//
// The participant name and the message snippet are concatenated into that one string with no clean
// separator, so a precise split is not reliable. The full row LABEL is the source of truth (and is
// exactly what a person sees in the app); `name` is a clearly best-effort leading extraction.

const THREAD_SIGNAL = /(·\s*\d+\s*[smhdwy])|(\bUnread\b)|(\bActive\s+now\b)|(\bActive\s+\d+\s*[a-z]+ ago\b)|(\b\d+\s+new messages?\b)/i;
const TIME_STAMP = /·\s*(\d+\s*[smhdwy])\b/i;

function bestEffortName(label) {
  let s = String(label || "");
  s = s.replace(/·\s*\d+\s*[smhdwy].*/i, "");         // drop "· 2h ..." and everything after
  s = s.replace(/\bUnread\b/gi, "");
  s = s.replace(/\bActive\s+(now|\d+\s*[a-z]+ ago)\b/gi, ""); // drop presence status
  s = s.replace(/^\s*Active\s+/i, "");                // drop a leading "Active " presence prefix
  s = s.trim();
  // Cut at the snippet markers: your reply, an attachment note, or "N new messages".
  s = s.split(/\s+(?:You:|sent\b|\d+\s+new messages?\b)/i)[0].trim();
  // Instagram often repeats the sender name at the snippet start ("Tg Tg sent…"); drop an immediate
  // duplicate leading word.
  s = s.replace(/^(\S+)\s+\1\b/, "$1");
  return s || null;
}

function parseInbox(snapshot) {
  const elements = (snapshot && snapshot.elements) || [];
  const threads = [];
  const seen = new Set();
  for (const el of elements) {
    const role = String(el.role || "").toLowerCase();
    if (role !== "button") continue;
    const label = textOf(el);
    if (!THREAD_SIGNAL.test(label)) continue; // a real conversation row, not a note or a control
    if (seen.has(label)) continue;
    seen.add(label);
    const timeMatch = TIME_STAMP.exec(label);
    threads.push({
      label,                                   // the whole row — the reliable source of truth
      name: bestEffortName(label),             // best-effort leading name (not guaranteed exact)
      unread: /\bUnread\b/i.test(label),       // reliable: the word is in the row
      isGroup: /\band\b/i.test(bestEffortName(label) || ""),
      time: timeMatch ? timeMatch[1].replace(/\s+/g, "") : (/\bActive\s+now\b/i.test(label) ? "now" : null),
    });
  }
  return { count: threads.length, threads };
}

// The activity/notifications feed into typed events. Each row mixes a username link with a verb
// ("liked", "started following you", "commented", "mentioned"). We classify by the verb text.
const NOTIF_VERBS = [
  { type: "follow", re: /\bstarted following you\b/i },
  { type: "follow_request", re: /\brequested to follow you\b/i },
  { type: "like", re: /\bliked your\b/i },
  { type: "comment", re: /\bcommented\b|\breplied\b/i },
  { type: "mention", re: /\bmentioned you\b|\btagged you\b/i },
];

function classifyNotification(text) {
  const t = String(text || "");
  for (const v of NOTIF_VERBS) if (v.re.test(t)) return v.type;
  return "other";
}

function parseNotifications(snapshot) {
  const elements = (snapshot && snapshot.elements) || [];
  const events = [];
  for (const el of elements) {
    const text = textOf(el);
    if (!text) continue;
    const type = classifyNotification(text);
    if (type === "other") continue; // only rows we can actually classify
    const username = handleFromHref(el.href) || null;
    events.push({ type, username, text });
  }
  return { count: events.length, events };
}

module.exports = { parsePeople, parseInbox, parseNotifications, classifyNotification };
