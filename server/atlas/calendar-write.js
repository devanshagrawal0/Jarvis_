"use strict";

// W6 — turn a spoken calendar command into a STRUCTURED PROPOSAL (no side effects here). The route
// layer resolves move/cancel targets against the real calendar and previews the change for approval
// before anything is written. Pure + dependency-light (reuses atlas-capture's time parser) so the
// whole surface is unit-tested offline against many phrasings.
//
//   parseCalendarCommand(text, { tz, now }) → one of:
//     { action: "create", title, startAt, endAt, location }
//     { action: "move",   targetQuery, targetWhen, newStartAt, newHH, newMM }
//     { action: "cancel", targetQuery, targetWhen }
//   …or null when it isn't a calendar command.

const { extractWhen, DEFAULT_TZ } = require("./atlas-capture");

const CREATE = /\b(schedule|book|set\s?up|pencil\s+in|block\s+off|block\s+out|put\s+.*\bon\b.*\bcalendar|add\s+(?:an?\s+)?(?:event|meeting|appointment|appt|call|invite|reminder\s+event))|new\s+(?:event|meeting|appointment)\b/i;
const MOVE = /\b(move|reschedule|resched|push|shift|bump|change)\b/i;
const CANCEL = /\b(cancel|delete|remove|clear|call\s+off|drop)\b/i;
// Any of these makes an utterance "about the calendar" enough to treat a bare "add lunch tomorrow" as
// an event rather than a to-do.
const EVENT_NOUN = /\b(meeting|appointment|appt|call|invite|event|lunch|dinner|coffee|breakfast|interview|standup|stand-up|sync|1:1|one\s*on\s*one|catch\s*up|review|session|class|flight|reservation|dentist|doctor|gym)\b/i;
const CAL_WORD = /\b(calendar|cal|schedule|invite|event)\b/i;

// Strip the leading command verb, articles/possessives, and calendar filler so what remains is a query
// we can match an existing event against. Keeps time-ish tokens (they help matching) — the caller also
// gets a parsed targetWhen for time matching.
function cleanTarget(text) {
  let s = String(text || "").trim();
  s = s.replace(/^(?:can you|could you|please|pls)\s+/i, "");
  s = s.replace(/^(?:move|reschedule|resched|push|shift|bump|change|cancel|delete|remove|clear|call\s+off|drop)\s+/i, "");
  s = s.replace(/\b(?:from|on|in)\s+(?:my|the)\s+calendar\b/gi, "");
  s = s.replace(/\bmy\s+calendar\b/gi, "");
  s = s.replace(/^(?:my|the|a|an|that|this)\s+/i, "");
  s = s.replace(/\b(?:meeting|event|appointment|appt)\b\s*$/i, "").trim();
  s = s.replace(/[.?!,]+$/g, "").trim();
  return s;
}

// Split a "move X to Y" command at the LAST " to " that is followed by something time-like, so
// "move my talk to sam to friday" splits after "sam", not after "talk".
function splitMoveOnTo(text) {
  const re = /\bto\b/gi;
  let m, last = -1;
  while ((m = re.exec(text))) last = m.index;
  if (last < 0) return null;
  return { before: text.slice(0, last).trim(), after: text.slice(last + 2).trim() };
}

function titleFromCreate(text, consumed) {
  let s = String(text || "");
  s = s.replace(/^\s*(?:can you|could you|please|pls)\s+/i, "");
  // drop the leading command verb ("add/schedule/book/put/set up/block/pencil in/new/make")
  s = s.replace(/^\s*(?:add|create|put|schedule|book|set\s?up|block(?:\s+off|\s+out)?|pencil\s+in|new|make)\s+/i, "");
  s = s.replace(/\bon\s+my\s+calendar\b/gi, " ");
  // drop each time token the parser consumed
  for (const c of consumed || []) s = s.replace(c, " ");
  // drop leftover articles/connectors left around the removed time
  s = s.replace(/\b(a|an|the|for|this|next)\b/gi, " ")
    .replace(/\s+(?:at|on|in)\s*$/i, " ")
    .replace(/\s+/g, " ").trim();
  s = s.replace(/[.?!,]+$/g, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function parseCalendarCommand(text, { tz = DEFAULT_TZ, now } = {}) {
  const t = String(text || "").trim();
  if (!t) return null;

  // CANCEL — "cancel my 3pm", "delete the standup", "cancel lunch tomorrow". Needs an event reference:
  // a time, an event noun, or an explicit calendar word — so "cancel the order" doesn't match.
  if (CANCEL.test(t) && !CREATE.test(t) && !MOVE.test(t)) {
    const when = extractWhen(t, tz, now);
    const targetQuery = cleanTarget(t);
    const referencesEvent = Boolean(when) || EVENT_NOUN.test(t) || CAL_WORD.test(t);
    if (referencesEvent) return { action: "cancel", targetQuery, targetWhen: when ? when.iso : null, tz };
    return null;
  }

  // MOVE — "move my 3pm to 4", "reschedule standup to tomorrow 10am", "push the review to friday".
  if (MOVE.test(t)) {
    const split = splitMoveOnTo(t);
    if (split && split.after) {
      const newWhen = extractWhen(split.after, tz, now);
      if (newWhen) {
        const targetWhen = extractWhen(split.before, tz, now);
        return {
          action: "move",
          targetQuery: cleanTarget(split.before),
          targetWhen: targetWhen ? targetWhen.iso : null,
          newStartAt: newWhen.iso,
          newHH: newWhen.hh,
          newMM: newWhen.mm,
          tz,
        };
      }
    }
    return null; // "move" with no resolvable new time isn't actionable
  }

  // CREATE — an explicit create verb OR (a calendar/event word AND a parseable time). A "remind me…"
  // or "add a task…" is a reminder/to-do (handled by atlas capture), not a calendar event — skip those
  // unless the owner used an explicit calendar verb (e.g. "schedule a reminder call").
  const isReminderOrTask = /\bremind me\b|\bset (?:a |up a )?reminder\b|\bdon'?t let me forget\b|\badd (?:a |an )?(?:task|to-?do)\b/i.test(t);
  const when = extractWhen(t, tz, now);
  if (when && (CREATE.test(t) || ((EVENT_NOUN.test(t) || CAL_WORD.test(t)) && !isReminderOrTask))) {
    const locM = t.match(/\b(?:at|in)\s+((?:the\s+)?[A-Z][\w'&.\-]*(?:\s+[A-Z][\w'&.\-]*)*)\s*$/);
    const location = locM && !/^\d/.test(locM[1]) ? locM[1].replace(/^the\s+/i, "").trim() : null;
    const title = titleFromCreate(t, when.consumed);
    const endAt = new Date(new Date(when.iso).getTime() + 60 * 60 * 1000).toISOString(); // default 1h
    return { action: "create", title: title || "Event", startAt: when.iso, endAt, location, tz };
  }

  return null;
}

// Human-readable one-liner for the preview card / confirmation prompt.
function describeProposal(p, fmtClock) {
  const clock = typeof fmtClock === "function" ? fmtClock : (iso) => iso;
  if (!p) return "";
  if (p.action === "create") return `Create “${p.title}”${p.location ? ` at ${p.location}` : ""} on ${clock(p.startAt)}`;
  if (p.action === "move") return `Move “${p.targetQuery || "the event"}” to ${clock(p.newStartAt)}`;
  if (p.action === "cancel") return `Cancel “${p.targetQuery || "the event"}”`;
  return "";
}

// Rank existing events against a move/cancel target (title text + optional time hint). Returns the
// scored matches best-first (score > 0 only). The route picks the top one and previews it; if two are
// close it can ask which. Pure so it's unit-testable with event fixtures.
//   events: [{ id, title, startAt }]  (as produced by the calendar read model)
function matchCalendarTarget(events, targetQuery, targetWhenIso) {
  const q = String(targetQuery || "").toLowerCase().trim();
  const qTokens = q.split(/\s+/).filter((w) => w.length > 2);
  const whenMs = targetWhenIso ? Date.parse(targetWhenIso) : NaN;
  const scored = (events || []).map((ev) => {
    const title = String(ev.title || "").toLowerCase();
    let score = 0;
    if (q && title.includes(q)) score += 4;
    score += qTokens.filter((w) => title.includes(w)).length;
    if (!Number.isNaN(whenMs) && ev.startAt) {
      const dt = Math.abs(Date.parse(ev.startAt) - whenMs);
      if (dt <= 30 * 60 * 1000) score += 4;
      else if (dt <= 2 * 3600 * 1000) score += 1;
    }
    return { event: ev, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored;
}

module.exports = { parseCalendarCommand, describeProposal, matchCalendarTarget, cleanTarget, splitMoveOnTo };
