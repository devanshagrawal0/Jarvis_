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

// A DM inbox into threads. Each thread is a link to /direct/t/<id>/; the row's text carries the
// participant name(s) and the last-message snippet. Unread state on Instagram is only a visual dot
// with no clean attribute, so it is reported best-effort and flagged, never asserted.
const THREAD_HREF = /\/direct\/t\/(\d+)\/?/;

function parseInbox(snapshot) {
  const elements = (snapshot && snapshot.elements) || [];
  const threads = [];
  const seen = new Set();
  for (const el of elements) {
    const href = String(el.href || "");
    const m = THREAD_HREF.exec(href);
    if (!m) continue;
    const threadId = m[1];
    if (seen.has(threadId)) continue;
    seen.add(threadId);
    threads.push({
      threadId,
      href,
      // Solid: the thread id and its link. NOT guessed: the participant name and the snippet — in a
      // real inbox those are separate elements, and splitting the row text for them is fragile
      // guessing (it already broke on normalized whitespace). We surface the raw accessible label and
      // leave name/snippet for the live-read validation to wire against the real DOM. Honest beats a
      // pretty parse that's wrong.
      label: textOf(el),
      name: null,     // filled once the real inbox structure is confirmed (Wave 1 live read)
      snippet: null,
      unreadKnown: false, // no reliable unread signal from the snapshot alone
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
