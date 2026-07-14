// ECLIPSE mission event stream (ADR-004). The durable log is eclipse_events; this exposes it
// as SSE: replay from a cursor (Last-Event-ID / ?since), then tail live via store.subscribe.
// The UI reconstructs the whole mission from persisted events → no fabricated activity.
//
// Framework-agnostic: streamMission(req, res, {store, missionId}) works with Express-style
// req/res. It is NOT registered on the live server here (isolation); the flagged wiring step
// mounts GET /api/eclipse/missions/:id/stream. sseFrame() is pure and unit-tested.

// Serialize one event to an SSE frame. `id:` carries the sequence so reconnects resume exactly.
// NOTE: no `event:` line on purpose — every frame is the default "message" type so a single
// EventSource.onmessage handler receives them all (the event type lives in the JSON `type`).
function sseFrame(evt) {
  const data = JSON.stringify({ type: evt.type || evt.event_type, sequence: evt.sequence, payload: evt.payload, occurredAt: evt.occurredAt || evt.occurred_at });
  return `id: ${evt.sequence}\ndata: ${data}\n\n`;
}

function cursorFrom(req) {
  const lastId = req.headers && (req.headers["last-event-id"] || req.headers["Last-Event-ID"]);
  const q = req.query && req.query.since;
  const n = Number(lastId != null ? lastId : q);
  return Number.isFinite(n) ? n : -1; // -1 → from the beginning
}

// Attach an SSE stream for one mission. Returns a cleanup fn.
function streamMission(req, res, { store, missionId }) {
  res.writeHead ? res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  }) : (res.setHeader && (res.setHeader("Content-Type", "text/event-stream"), res.setHeader("Cache-Control", "no-cache")));

  let cursor = cursorFrom(req);
  // 1) Replay everything already persisted past the cursor.
  for (const evt of store.getEvents(missionId, cursor)) { res.write(sseFrame(evt)); cursor = evt.sequence; }

  // 2) Tail live. De-dupe against the replay cursor (an event may land between replay and subscribe).
  const unsub = store.subscribe(missionId, (evt) => {
    if (evt.sequence > cursor) { res.write(sseFrame(evt)); cursor = evt.sequence; }
  });

  // 3) Heartbeat so proxies don't kill an idle connection.
  const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch { /* closed */ } }, 15000);
  if (hb.unref) hb.unref();

  const cleanup = () => { clearInterval(hb); unsub(); };
  if (req.on) req.on("close", cleanup);
  return cleanup;
}

// Express mount helper — used by the FLAGGED wiring step, not here.
function mountEclipseStream(router, getStore) {
  router.get("/api/eclipse/missions/:id/stream", (req, res) => {
    const store = getStore();
    if (!store) return res.status ? res.status(503).end() : res.end();
    streamMission(req, res, { store, missionId: req.params.id });
  });
}

module.exports = { sseFrame, streamMission, mountEclipseStream, cursorFrom };
