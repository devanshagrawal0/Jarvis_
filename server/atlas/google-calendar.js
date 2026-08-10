"use strict";

// Wave 5 (read model, focused slice) — fetch the owner's real Google Calendar events for a window
// and normalize them into the ATLAS event shape so they merge straight into Today's timeline/agenda.
// Read-only. Uses singleEvents=true so recurring events arrive as concrete instances (already
// normalized by Google). A tiny TTL cache keeps /api/atlas/today from calling Google on every poll.

function normalizeEvent(ev) {
  if (!ev || ev.status === "cancelled") return null;
  const allDay = Boolean(ev.start && ev.start.date && !ev.start.dateTime);
  const startAt = ev.start && (ev.start.dateTime || ev.start.date) || null;
  const endAt = ev.end && (ev.end.dateTime || ev.end.date) || null;
  if (!startAt) return null;
  return {
    id: `gcal_${ev.id}`,
    title: ev.summary || "(no title)",
    startAt: allDay ? new Date(`${startAt}T00:00:00`).toISOString() : new Date(startAt).toISOString(),
    endAt: endAt ? (allDay ? new Date(`${endAt}T00:00:00`).toISOString() : new Date(endAt).toISOString()) : null,
    location: ev.location || null,
    kind: "event",
    movable: false,
    allDay,
    source: { kind: "google", ref: ev.htmlLink || ev.id },
  };
}

function createGoogleCalendar({ getAccessToken, isConnected, fetchImpl = fetch, ttlMs = 60_000, now = () => Date.now() }) {
  const cache = new Map(); // key: `${startIso}|${endIso}` -> { at, events }

  async function eventsBetween(startIso, endIso) {
    if (typeof isConnected === "function" && !isConnected()) return [];
    const key = `${startIso}|${endIso}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.events;

    const token = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events`
      + `?timeMin=${encodeURIComponent(startIso)}&timeMax=${encodeURIComponent(endIso)}`
      + `&singleEvents=true&orderBy=startTime&maxResults=50`;
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Google Calendar ${res.status}: ${body.slice(0, 200)}`);
      err.statusCode = res.status;
      throw err;
    }
    const data = await res.json();
    const events = (data.items || []).map(normalizeEvent).filter(Boolean);
    cache.set(key, { at: now(), events });
    return events;
  }

  function invalidate() { cache.clear(); }

  return { eventsBetween, invalidate };
}

module.exports = { createGoogleCalendar, normalizeEvent };
