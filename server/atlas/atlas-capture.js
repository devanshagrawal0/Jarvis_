"use strict";

// ATLAS Wave 2 — natural-language quick capture. Turns one plain sentence into the right ATLAS
// row so the owner can *say* "remind me to call the bank at 5" / "add a task: file taxes" /
// "lunch with Priya tomorrow at 1" / "note: parking spot is B12" and have it land in Today.
//
// Deliberately DETERMINISTIC and model-free: this is the guaranteed path. The brain also exposes
// an `atlas_capture` tool that calls the very same parser, but capture never *depends* on the LLM
// choosing a tool — a plain sentence resolves here, instantly, offline. Pure + unit-testable:
// parseCapture() does no I/O; applyCapture() is the only part that touches the store.

const DEFAULT_TZ = "America/New_York";

// ── timezone math (wall-clock in an IANA zone <-> UTC instant), pure ─────────────
function tzParts(tz, atMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const p = dtf.formatToParts(new Date(atMs)).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: p.weekday };
}
function tzOffsetMs(tz, atMs) {
  const p = tzParts(tz, atMs);
  const asUTC = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return asUTC - atMs;
}
// A wall-clock time *in tz* -> the UTC ISO instant. Two-pass so a DST boundary resolves cleanly.
function zonedWallToIso(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ms = guess - tzOffsetMs(tz, guess);
  ms = guess - tzOffsetMs(tz, ms);
  return new Date(ms).toISOString();
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_SHORT = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// Add whole days to a wall date in tz (handles month rollover via UTC arithmetic on the date part).
function addDays(y, mo, d, n) {
  const t = new Date(Date.UTC(y, mo - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// ── time extraction ──────────────────────────────────────────────────────────────
// Returns { iso, hadDate, hadClock, consumed:[matched substrings] } or null when nothing time-like.
function extractWhen(text, tz, now) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const base = tzParts(tz, nowMs);            // owner's local "now"
  const consumed = [];
  let date = { y: base.y, mo: base.mo, d: base.d };
  let hadDate = false, hadClock = false;
  let hh = null, mm = 0;

  // relative "in N minutes / hours" — resolves to a full instant on its own
  const rel = text.match(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|hours?|hrs?|hr)\b/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = /h/i.test(rel[2]) ? "h" : "m";
    consumed.push(rel[0]);
    const iso = new Date(nowMs + n * (unit === "h" ? 3600 : 60) * 1000).toISOString();
    return { iso, hadDate: true, hadClock: true, consumed };
  }

  // day words
  if (/\btomorrow\b/i.test(text)) { const a = addDays(base.y, base.mo, base.d, 1); date = a; hadDate = true; consumed.push("tomorrow"); }
  else if (/\btonight\b/i.test(text)) { hadDate = true; hh = 20; consumed.push("tonight"); }
  else if (/\btoday\b/i.test(text)) { hadDate = true; consumed.push("today"); }
  else {
    const wd = text.match(/\b(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thur|thurs|thu|fri|sat)\b/i);
    if (wd) {
      const key = wd[1].toLowerCase();
      const target = WEEKDAYS.indexOf(key) >= 0 ? WEEKDAYS.indexOf(key) : WD_SHORT[key.slice(0, 3)];
      const curDow = WEEKDAYS.indexOf(base.weekday.toLowerCase()) >= 0 ? WEEKDAYS.indexOf(base.weekday.toLowerCase()) : new Date(nowMs).getUTCDay();
      let delta = (target - curDow + 7) % 7;
      if (delta === 0) delta = 7;                                  // "on friday" when today is friday => next friday
      if (/\bnext\s+/i.test(wd[0]) && delta < 7) delta += 0;       // "next friday" already the coming one; keep simple
      const a = addDays(base.y, base.mo, base.d, delta); date = a; hadDate = true; consumed.push(wd[0]);
    } else {
      // explicit month/day: "aug 12", "august 12th", "12 aug"
      const md = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
        || text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i);
      if (md) {
        const monToken = /[a-z]/i.test(md[1]) ? md[1] : md[2];
        const dayToken = /[a-z]/i.test(md[1]) ? md[2] : md[1];
        const mo = MONTHS.findIndex((m) => m.startsWith(monToken.toLowerCase().slice(0, 3))) + 1;
        let y = base.y;
        const d = parseInt(dayToken, 10);
        if (mo < base.mo || (mo === base.mo && d < base.d)) y += 1;  // a past date this year means next year
        if (mo >= 1 && d >= 1 && d <= 31) { date = { y, mo, d }; hadDate = true; consumed.push(md[0]); }
      }
    }
  }

  // clock: "at 5", "at 5:30pm", "5pm", "5:30 pm", "noon", "midnight"
  if (/\bnoon\b/i.test(text)) { hh = 12; mm = 0; hadClock = true; consumed.push("noon"); }
  else if (/\bmidnight\b/i.test(text)) { hh = 0; mm = 0; hadClock = true; consumed.push("midnight"); }
  else {
    const clk = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i) || text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (clk) {
      let h = parseInt(clk[1], 10);
      const min = clk[2] ? parseInt(clk[2], 10) : 0;
      const ap = (clk[3] || "").toLowerCase();
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        if (ap === "pm" && h < 12) h += 12;
        if (ap === "am" && h === 12) h = 0;
        if (!ap && h >= 1 && h <= 7) h += 12;                       // bare "at 5" -> daytime 5pm (owner assistant heuristic)
        hh = h; mm = min; hadClock = true; consumed.push(clk[0]);
      }
    }
  }

  // vague parts of day (only if no explicit clock)
  if (!hadClock) {
    if (/\bmorning\b/i.test(text)) { hh = 9; hadClock = true; consumed.push("morning"); }
    else if (/\bafternoon\b/i.test(text)) { hh = 14; hadClock = true; consumed.push("afternoon"); }
    else if (/\bevening\b/i.test(text)) { hh = 18; hadClock = true; consumed.push("evening"); }
  }

  if (!hadDate && !hadClock) return null;

  // If a clock landed but no date, and that time already passed today, roll to tomorrow.
  if (hadClock && !hadDate && hh != null) {
    const passed = hh < base.h || (hh === base.h && mm <= base.mi);
    if (passed) { const a = addDays(base.y, base.mo, base.d, 1); date = a; }
  }
  if (hh == null) hh = 9;                                           // date but no clock -> 9:00 local

  return { iso: zonedWallToIso(date.y, date.mo, date.d, hh, mm, tz), hadDate, hadClock, consumed };
}

// Strip the matched time phrases + leading verb noise so the title reads clean.
function cleanTitle(text, consumed = []) {
  let t = ` ${text} `;
  for (const c of consumed) {
    t = t.replace(new RegExp(`\\s*(?:on|at|by|this|next)?\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), " ");
  }
  return t
    .replace(/\b(please|pls)\b/gi, " ")
    // priority words drive the priority field, not the title text
    .replace(/,?\s*\b(urgent|asap|important|critical|high[- ]?priority|top priority)\b/gi, " ")
    .replace(/\s+([,.;:])/g, "$1")            // "reimbursement , urgent" -> "reimbursement,"
    .replace(/\s+/g, " ")
    .replace(/^[\s,–—-]+|[\s,.;:–—-]+$/g, "") // trim leading/trailing punctuation left behind
    .trim();
}
function titleCaseFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ── intent parse ───────────────────────────────────────────────────────────────
// Returns one of:
//   { kind:"reminder", title, fireAt, tz }
//   { kind:"task", title, dueAt?, waitingOn?, actor?, priority?, tz }
//   { kind:"event", title, startAt, endAt?, location?, tz }
//   { kind:"note", body }
//   { kind:null, reason }  -> not a capture; caller should route to the brain instead.
const EVENT_NOUNS = /\b(meeting|meet(?:ing)? with|call with|1[:\-]?1|sync|standup|stand-up|appointment|appt|lunch|dinner|coffee|interview|flight|class|lecture|session|demo|review|catch ?up|hangout|party|dentist|doctor)\b/i;

function parseCapture(rawText, opts = {}) {
  const tz = opts.tz || DEFAULT_TZ;
  const now = opts.now instanceof Date ? opts.now : (opts.now ? new Date(opts.now) : new Date());
  const text = String(rawText || "").trim();
  if (!text) return { kind: null, reason: "empty" };
  const lower = text.toLowerCase();

  // NOTE — only when explicitly a note ("note: x", "take a note x", "jot down x")
  const noteM = text.match(/^\s*(?:take (?:a|down) (?:quick )?note|jot(?: this)?(?: down)?|make a note|new note|note)\s*[:\-]?\s*(.+)$/i);
  if (noteM && noteM[1]) return { kind: "note", body: noteM[1].trim(), tz };

  // REMINDER — "remind me (to) x", "set a reminder to x", "nudge me to x"
  const remM = lower.match(/\b(remind me(?: to| that| about)?|set (?:a |up a )?reminder(?: to| for| about)?|nudge me(?: to)?|don'?t let me forget(?: to)?)\b/i);
  if (remM) {
    const after = text.slice(text.toLowerCase().indexOf(remM[0].toLowerCase()) + remM[0].length).trim();
    const when = extractWhen(after || text, tz, now);
    const title = titleCaseFirst(cleanTitle(after || text, when?.consumed).replace(/^(to|that|about)\s+/i, ""));
    if (when && when.iso) return { kind: "reminder", title: title || "Reminder", fireAt: when.iso, tz };
    // Reminder with no parseable time can't fire — make it an honest open task instead.
    return { kind: "task", title: title || "Follow up", waitingOn: "me", priority: 1, tz, note: "no time given — saved as a task" };
  }

  // WAITING-ON — "X said he'll send it", "waiting on Priya for the deck", "Y owes me"
  const waitM = text.match(/\b(waiting (?:on|for)|chasing|following up with)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)\b/i)
    || text.match(/\b([A-Z][\w.'-]+)\s+(?:said|promised|will|is going to|owes)\b/);
  if (waitM) {
    const actor = (waitM[2] || waitM[1] || "").trim();
    const when = extractWhen(text, tz, now);
    return { kind: "task", title: titleCaseFirst(cleanTitle(text, when?.consumed)), waitingOn: "them", actor, dueAt: when?.iso || null, priority: 1, tz };
  }

  // EVENT — an event noun + a time, or a clear "at TIME" with a day. Longer commitments with a slot.
  const when = extractWhen(text, tz, now);
  const eventLike = EVENT_NOUNS.test(text) || /\bschedule\b/i.test(lower) || /\badd (?:an? )?(?:event|meeting|appointment)\b/i.test(lower);
  if (when && when.hadClock && eventLike) {
    const locM = text.match(/\b(?:at|in)\s+(the\s+)?([A-Z][\w.'&-]+(?:\s+[A-Z][\w.'&-]+){0,3})\b/);
    let title = cleanTitle(text.replace(/^\s*(?:schedule|add (?:an? )?(?:event|meeting|appointment)(?: (?:for|with))?)\s*/i, ""), when.consumed);
    title = titleCaseFirst(title);
    const endAt = new Date(new Date(when.iso).getTime() + 60 * 60 * 1000).toISOString(); // default 1h
    return { kind: "event", title: title || "Event", startAt: when.iso, endAt, location: locM ? locM[2] : null, tz };
  }

  // TASK — explicit task phrasing, or an imperative to-do (optionally with a due time).
  const taskM = lower.match(/^\s*(?:add (?:a |an )?(?:task|todo|to-?do)|new task|task|todo|to-?do|i (?:need|have|want|got) to|i've got to|make sure to|don'?t forget to|add to (?:my )?(?:list|tasks))\b\s*[:\-]?\s*/i);
  if (taskM) {
    const after = text.slice(taskM[0].length).trim() || text;
    const title = titleCaseFirst(cleanTitle(after, when?.consumed));
    const priority = /\b(urgent|asap|important|critical|high priority)\b/i.test(lower) ? 3 : 1;
    return { kind: "task", title: title || "Task", dueAt: when?.iso || null, waitingOn: "me", priority, tz };
  }

  // A bare "<verb> ... at <time>" with a real clock still reads as a scheduled to-do.
  if (when && when.hadClock && /^(call|email|text|send|pay|submit|finish|book|buy|pick up|drop off|review|check|renew|cancel|schedule)\b/i.test(lower)) {
    const title = titleCaseFirst(cleanTitle(text, when.consumed));
    return { kind: "reminder", title: title || "Reminder", fireAt: when.iso, tz };
  }

  return { kind: null, reason: "not a capture intent" };
}

// ── apply (the only I/O) ─────────────────────────────────────────────────────────
function fmtClock(iso, tz) {
  try { return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz }); } catch { return iso; }
}
function applyCapture(store, parsed, ctx = {}) {
  if (!store || !parsed || !parsed.kind) return { ok: false, kind: null, message: parsed?.reason || "nothing to capture" };
  const source = { kind: ctx.sourceKind || "owner", ref: ctx.sourceRef || "capture" };
  const tz = parsed.tz || ctx.tz || DEFAULT_TZ;
  switch (parsed.kind) {
    case "reminder": {
      const item = store.createReminder({ title: parsed.title, fireAt: parsed.fireAt, tz, source });
      return { ok: true, kind: "reminder", item, message: `Reminder set — ${parsed.title} · ${fmtClock(parsed.fireAt, tz)}` };
    }
    case "event": {
      const item = store.createEvent({ title: parsed.title, startAt: parsed.startAt, endAt: parsed.endAt, location: parsed.location, tz, source });
      return { ok: true, kind: "event", item, message: `Added to today — ${parsed.title} · ${fmtClock(parsed.startAt, tz)}${parsed.location ? ` · ${parsed.location}` : ""}` };
    }
    case "note": {
      const item = store.addNote(parsed.body, ["capture"]);
      return { ok: true, kind: "note", item, message: `Noted — ${parsed.body}` };
    }
    case "task":
    default: {
      const item = store.createTask({ title: parsed.title, dueAt: parsed.dueAt || null, waitingOn: parsed.waitingOn || "me", actor: parsed.actor || null, priority: parsed.priority ?? 1, tz, source });
      const who = parsed.waitingOn === "them" && parsed.actor ? ` · waiting on ${parsed.actor}` : "";
      const due = parsed.dueAt ? ` · due ${fmtClock(parsed.dueAt, tz)}` : "";
      const note = parsed.note ? ` (${parsed.note})` : "";
      return { ok: true, kind: "task", item, message: `Task added — ${parsed.title}${who}${due}${note}` };
    }
  }
}

function capture(store, rawText, opts = {}) {
  const parsed = parseCapture(rawText, opts);
  return applyCapture(store, parsed, opts);
}

module.exports = { parseCapture, applyCapture, capture, zonedWallToIso, extractWhen, DEFAULT_TZ };
