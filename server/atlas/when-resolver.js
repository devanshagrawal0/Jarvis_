"use strict";
// Deterministic natural-language date/time resolver for the owner's day-model + calendar.
//
// The LLM is an unreliable calendar calculator — it miscomputes "next Tuesday", "in 2 weeks", and
// especially "tomorrow" when its sense of "today" drifts. This module resolves a phrase to concrete
// owner-local wall-clock components from a KNOWN owner-local "now", with zero model math. The caller
// turns the components into an ISO-8601-with-offset via a zoned-wall-to-ISO primitive.
//
// resolveWhen(phrase, nowParts) -> { y, mo, d, h, mi, hadDate, hadTime, confident } | null
//   nowParts = { y, mo, d, h, mi, dow }  (owner-local; dow 0=Sun..6=Sat)
// Returns null when the phrase carries no resolvable date/time signal at all.

const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, weds: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };

// Days in a month, honoring leap years — needed so "the 31st" / month rollover never overflow.
function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

// Add N days to a Y/M/D triple using UTC math (calendar-only; no tz involved here).
function addDays(y, mo, d, n) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: dt.getUTCDay() };
}
function dowOf(y, mo, d) { return new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); }

// Parse an explicit clock time ("3pm", "3:30 pm", "at 15:00", "9", "noon", "midnight").
// Returns { h, mi } or null. `partOfDayDefault` supplies morning/afternoon/evening/night hours.
function parseTime(text) {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return { h: 12, mi: 0, hadMeridiem: true };
  if (/\bmidnight\b/.test(t)) return { h: 0, mi: 0, hadMeridiem: true };
  // 1) Prefer an explicit meridiem time anywhere ("5pm", "3:30 pm", "9.30am") — this wins over a bare
  //    number so "august 20 at 5pm" reads 17:00, not 20:00.
  let m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (m) {
    let h = parseInt(m[1], 10); const mi = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3].replace(/\./g, "");
    if (h > 23 || mi > 59) return null;
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { h, mi, hadMeridiem: true };
  }
  // 2) 24h clock ("15:00", "at 15:30").
  m = t.match(/\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return { h: parseInt(m[1], 10), mi: parseInt(m[2], 10), hadMeridiem: true };
  // 3) "at H" with a bare hour ("at 9", "at 5") — meridiem unknown, inferred from context by caller.
  m = t.match(/\bat\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (m) {
    const h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0;
    if (h > 23 || mi > 59) return null;
    return { h, mi, hadMeridiem: false };
  }
  return null;
}

function partOfDay(text) {
  const t = text.toLowerCase();
  if (/\bmorning\b/.test(t)) return { h: 9, mi: 0 };
  if (/\bafternoon\b/.test(t)) return { h: 14, mi: 0 };
  if (/\bevening\b/.test(t)) return { h: 18, mi: 0 };
  if (/\b(night|tonight)\b/.test(t)) return { h: 20, mi: 0 };
  return null;
}

function resolveWhen(phrase, now) {
  const t = String(phrase || "").toLowerCase();
  if (!t.trim()) return null;
  let y = null, mo = null, d = null, hadDate = false, confident = true;

  // ── relative day anchors ──────────────────────────────────────────────
  const dayAfter = /\bday after tomorrow\b/.test(t);
  const tomorrow = !dayAfter && /\btomorrow\b|\btmrw\b|\btmr\b/.test(t);
  const today = /\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b|\blater today\b/.test(t);
  if (dayAfter) { const a = addDays(now.y, now.mo, now.d, 2); ({ y, mo, d } = a); hadDate = true; }
  else if (tomorrow) { const a = addDays(now.y, now.mo, now.d, 1); ({ y, mo, d } = a); hadDate = true; }
  else if (today) { y = now.y; mo = now.mo; d = now.d; hadDate = true; }

  // "in N days/weeks/months"
  let m = t.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);
  if (!hadDate && m) {
    const n = parseInt(m[1], 10);
    if (/day/.test(m[2])) { const a = addDays(now.y, now.mo, now.d, n); ({ y, mo, d } = a); }
    else if (/week/.test(m[2])) { const a = addDays(now.y, now.mo, now.d, n * 7); ({ y, mo, d } = a); }
    else { let ny = now.y, nm = now.mo + n; while (nm > 12) { nm -= 12; ny += 1; } y = ny; mo = nm; d = Math.min(now.d, daysInMonth(ny, nm)); }
    hadDate = true;
  }
  // "in a week" / "in a month" / "a week from today"
  if (!hadDate && /\b(in a week|a week from (?:today|now)|next week)\b/.test(t)) { const a = addDays(now.y, now.mo, now.d, 7); ({ y, mo, d } = a); hadDate = true; confident = !/next week/.test(t); }
  if (!hadDate && /\b(in a fortnight|two weeks from (?:today|now))\b/.test(t)) { const a = addDays(now.y, now.mo, now.d, 14); ({ y, mo, d } = a); hadDate = true; }

  // "next <weekday>" / "this <weekday>" / bare "<weekday>"
  if (!hadDate) {
    const wm = t.match(/\b(next|this|coming)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
    if (wm) {
      const target = WEEKDAYS[wm[2]];
      const isNext = wm[1] === "next";
      let delta = (target - now.dow + 7) % 7;
      if (delta === 0) delta = 7;          // a bare weekday name means the NEXT occurrence, not today
      if (isNext && delta <= 7) {
        // "next Friday" = the Friday of next week. If the plain next occurrence is still this week
        // (before Sunday), push a week; if today IS that weekday, delta is already 7.
        const plain = addDays(now.y, now.mo, now.d, delta);
        // Is `plain` in the same ISO week span as today? Approximate: if delta < (7 - now.dow) it's this week.
        if (delta < (7 - now.dow) || (now.dow === 0)) delta += 7;
      }
      const a = addDays(now.y, now.mo, now.d, delta);
      ({ y, mo, d } = a); hadDate = true;
    }
  }

  // "end of the month" / "beginning of next month" / "end of next month"
  if (!hadDate && /\bend of (the )?month\b/.test(t)) { y = now.y; mo = now.mo; d = daysInMonth(now.y, now.mo); hadDate = true; }
  if (!hadDate && /\b(beginning|start) of (the )?next month\b/.test(t)) { let ny = now.y, nm = now.mo + 1; if (nm > 12) { nm = 1; ny += 1; } y = ny; mo = nm; d = 1; hadDate = true; }
  if (!hadDate && /\bend of next month\b/.test(t)) { let ny = now.y, nm = now.mo + 1; if (nm > 12) { nm = 1; ny += 1; } y = ny; mo = nm; d = daysInMonth(ny, nm); hadDate = true; }
  if (!hadDate && /\b(beginning|start) of (the )?month\b/.test(t)) { y = now.y; mo = now.mo; d = 1; hadDate = true; }

  // Explicit "<month> <day>" (e.g. "august 20", "dec 25", "on the 25th")
  if (!hadDate) {
    const mm = t.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
      || t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/);
    if (mm) {
      const mon = MONTHS[mm[1]] || MONTHS[mm[2]];
      const day = parseInt(/\d/.test(mm[1]) ? mm[1] : mm[2], 10);
      if (mon && day >= 1 && day <= 31) {
        let yy = now.y;
        // If that date already passed this year, roll to next year (forwardDate).
        if (mon < now.mo || (mon === now.mo && day < now.d)) yy += 1;
        y = yy; mo = mon; d = Math.min(day, daysInMonth(yy, mon)); hadDate = true;
      }
    }
  }
  // "on the Nth" (this month, future)
  if (!hadDate) {
    const dm = t.match(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/);
    if (dm) {
      const day = parseInt(dm[1], 10);
      if (day >= 1 && day <= 31) {
        let yy = now.y, mm2 = now.mo;
        if (day < now.d) { mm2 += 1; if (mm2 > 12) { mm2 = 1; yy += 1; } }
        y = yy; mo = mm2; d = Math.min(day, daysInMonth(yy, mm2)); hadDate = true;
      }
    }
  }

  // ── time of day ───────────────────────────────────────────────────────
  let time = parseTime(t) || partOfDay(t);
  // A bare "at 9" with an evening/night/afternoon context ("tonight at 9", "at 5 this evening")
  // means PM — infer the meridiem the owner clearly intended.
  if (time && time.hadMeridiem === false && time.h >= 1 && time.h <= 11 && /\b(tonight|evening|night|afternoon|dinner|drinks|pm)\b/.test(t)) {
    time = { h: time.h + 12, mi: time.mi, hadMeridiem: true };
  }
  let hadTime = Boolean(time);

  // "in N minutes/hours" — a pure relative offset from now (carries its own date).
  const rel = t.match(/\bin\s+(\d+)\s*(min|mins|minute|minutes|hour|hours|hr|hrs)\b/) || (/\bin\s+an?\s+hour\b/.test(t) ? [null, "1", "hour"] : null);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const mins = /hour|hr/.test(rel[2]) ? n * 60 : n;
    const base = new Date(Date.UTC(now.y, now.mo - 1, now.d, now.h, now.mi));
    base.setUTCMinutes(base.getUTCMinutes() + mins);
    return { y: base.getUTCFullYear(), mo: base.getUTCMonth() + 1, d: base.getUTCDate(), h: base.getUTCHours(), mi: base.getUTCMinutes(), hadDate: true, hadTime: true, confident: true };
  }

  if (!hadDate && !hadTime) return null;

  // A time with no date: today if still in the future, else tomorrow (forwardDate).
  if (!hadDate && hadTime) {
    y = now.y; mo = now.mo; d = now.d;
    const nowMins = now.h * 60 + now.mi;
    const tgtMins = time.h * 60 + time.mi;
    if (tgtMins <= nowMins) { const a = addDays(now.y, now.mo, now.d, 1); ({ y, mo, d } = a); }
    hadDate = true;
  }

  // A date with no explicit time: leave time null so the caller can treat it as an all-day/whole-day
  // item (a task due date), not fabricate a clock time.
  const h = hadTime ? time.h : null;
  const mi = hadTime ? time.mi : null;
  return { y, mo, d, h, mi, hadDate, hadTime, confident, dow: dowOf(y, mo, d) };
}

module.exports = { resolveWhen, WEEKDAYS, MONTHS, daysInMonth };
