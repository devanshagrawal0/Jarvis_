"use strict";

// Who is actually on the other end of the conversation we are about to send into.
//
// Four test messages went into the owner's GROUP chat while the system believed it was messaging
// one person. Nothing anywhere read the open conversation and asked "is this one person, and is it
// them?" — not the agent, not the commit gate, and not the approval card, which described the
// action ("Type X into the message input, then send it") without ever naming a recipient. The owner
// had nothing to catch it with.
//
// The page says it plainly. A group thread's header carries a participant count — "ngas but on ig
// 3 active today" — where a one-to-one carries a single presence line — "Active now", "Active 19m
// ago". That is read from the live page, not from our own contact store, because the store is
// exactly what was wrong: a thread URL saved against the wrong conversation looks perfectly valid.
//
// The asymmetry is deliberate:
//   * positive evidence of a group, on a send addressed to one person  -> REFUSE, never ask
//   * confirmed the intended person                                    -> proceed to normal approval
//   * cannot tell                                                      -> proceed, but the card must
//                                                                         say it could not confirm
// Refusing everything unconfirmable would break the two contacts that work today. Sending into a
// confirmed group is the failure that actually happened, so that one is not a prompt.

// Instagram reserves these first path segments; they are not people.
const RESERVED_HANDLES = new Set([
  "direct", "explore", "reels", "reel", "stories", "accounts", "p", "tv", "about", "legal",
  "privacy", "terms", "emails", "challenge", "api", "developer", "developers", "press", "jobs",
  "hashtag", "settings", "archive", "create", "notifications", "your_activity", "session",
]);

const PROFILE_LINK = /^(?:https?:\/\/(?:www\.)?instagram\.com)?\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/;

// "3 active today", "5 active now" — a count only exists when there is more than one participant.
const GROUP_ACTIVITY = /\b(\d+)\s+active\s+(?:today|now)\b/i;
// "N members", "N participants" — the explicit form, seen on group info surfaces.
const GROUP_MEMBERS = /\b(\d+)\s+(?:members?|participants?)\b/i;
// A single presence line, which only a one-to-one thread has.
const SOLO_ACTIVITY = /\bActive\s+(?:now|\d+\s*[a-z]{1,7}(?:\s+ago)?)\b/i;

function handleFromHref(href) {
  const match = PROFILE_LINK.exec(String(href || "").trim());
  if (!match) return "";
  const handle = match[1];
  if (RESERVED_HANDLES.has(handle.toLowerCase())) return "";
  return handle;
}

function normalizeHandle(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

// The conversation's own name, taken from the text that immediately precedes the presence line.
// The same name also appears in the inbox list down the side; only the open thread is followed by
// presence, which is what makes this the OPEN conversation rather than a neighbouring row.
// The page arrives as one flat run of text with single spaces, so there is no whitespace boundary
// marking where the conversation's name begins — reading back from the presence line picked up the
// tail of the inbox list too ("· 3h Contact Three Active 19m ago group name here"). What DOES mark
// the boundary is the vocabulary of an inbox row: a separator dot, a relative timestamp, "ago",
// "You:". Walking back word by word and stopping at the first of those leaves exactly the name.
const ROW_BOUNDARY = /^(?:·|ago|Unread|You:|Active|\d+[smhdw]|\d{1,2}:\d{2}|[AP]M|Messages|Requests)$/i;
const MAX_TITLE_WORDS = 8;

function titleBeforePresence(text) {
  const source = String(text || "");
  for (const pattern of [GROUP_ACTIVITY, SOLO_ACTIVITY]) {
    const match = pattern.exec(source);
    if (!match) continue;
    const words = source.slice(Math.max(0, match.index - 120), match.index).trim().split(/\s+/);
    const title = [];
    while (words.length && title.length < MAX_TITLE_WORDS) {
      const word = words.pop();
      if (ROW_BOUNDARY.test(word)) break;
      title.unshift(word);
    }
    if (title.length) return title.join(" ").slice(0, 80);
  }
  return "";
}

/**
 * Classify the conversation currently on screen.
 *
 * @param {object} reading  what the page reported: { headerText, headerLinks[], pageText, url }
 * @returns {{ kind: "group"|"direct"|"unknown", title: string, handles: string[], participantCount: number|null, evidence: string }}
 */
function readAudience(reading = {}) {
  const headerText = String(reading.headerText || "");
  const pageText = String(reading.pageText || "");
  // The header is authoritative when we have it; the whole page is a fallback and is noisier,
  // because it also contains every other conversation in the inbox list.
  const scope = headerText || pageText;

  const handles = [...new Set(
    (Array.isArray(reading.headerLinks) ? reading.headerLinks : [])
      .map(handleFromHref)
      .filter(Boolean)
  )];

  const groupActivity = GROUP_ACTIVITY.exec(scope);
  const groupMembers = GROUP_MEMBERS.exec(scope);
  const title = titleBeforePresence(scope) || String(reading.title || "").trim();

  if (groupActivity || groupMembers) {
    const count = Number((groupActivity || groupMembers)[1]) || null;
    return {
      kind: "group",
      title,
      handles,
      participantCount: count,
      evidence: (groupActivity || groupMembers)[0],
    };
  }
  // More than one distinct person linked from the thread header is a group even without a count.
  if (handles.length > 1) {
    return { kind: "group", title, handles, participantCount: handles.length, evidence: `${handles.length} people linked in the conversation header` };
  }
  if (SOLO_ACTIVITY.test(scope) || handles.length === 1) {
    return { kind: "direct", title, handles, participantCount: 1, evidence: SOLO_ACTIVITY.exec(scope)?.[0] || `one person linked: @${handles[0]}` };
  }
  return { kind: "unknown", title, handles, participantCount: null, evidence: "" };
}

/**
 * Should this send be blocked outright?
 *
 * @returns {string} a plain-English refusal, or "" to proceed.
 */
function refusalFor({ audience, intendedHandle = "", intendedName = "" } = {}) {
  if (!audience) return "";
  const wanted = normalizeHandle(intendedHandle);
  const person = intendedHandle ? `@${normalizeHandle(intendedHandle)}` : (intendedName || "one person");

  if (audience.kind === "group") {
    const who = audience.title ? `"${audience.title}"` : "a group conversation";
    const size = audience.participantCount ? ` (${audience.participantCount} people)` : "";
    return `This message is addressed to ${person}, but the open conversation is ${who}${size}. Sending here would post it to everyone in it.`;
  }
  // A named recipient that the page contradicts is the same failure wearing a different hat.
  if (wanted && audience.kind === "direct" && audience.handles.length === 1
    && normalizeHandle(audience.handles[0]) !== wanted) {
    return `This message is addressed to ${person}, but the open conversation is with @${audience.handles[0]}.`;
  }
  return "";
}

/**
 * What the approval card should say about the recipient. Never guesses; says so when it cannot tell.
 */
function recipientSummary({ audience, intendedHandle = "" } = {}) {
  if (!audience || audience.kind === "unknown") {
    return { confirmed: false, text: "Could not confirm who this conversation is with — check before approving." };
  }
  if (audience.kind === "group") {
    const size = audience.participantCount ? `, ${audience.participantCount} people` : "";
    return { confirmed: true, text: `Group conversation${audience.title ? ` "${audience.title}"` : ""}${size}` };
  }
  const named = audience.handles[0] ? `@${audience.handles[0]}` : audience.title;
  if (!named) return { confirmed: false, text: "One-to-one conversation, but the page did not name the person." };
  const matches = !intendedHandle || normalizeHandle(named) === normalizeHandle(intendedHandle);
  return { confirmed: matches, text: matches ? `${named} (one-to-one)` : `${named} — NOT the ${intendedHandle} you asked for` };
}

module.exports = { GROUP_ACTIVITY, GROUP_MEMBERS, SOLO_ACTIVITY, handleFromHref, normalizeHandle, readAudience, recipientSummary, refusalFor, titleBeforePresence };
