// Synapse (Co-Op) W4 — the live signaling + relay room. A dedicated, ISOLATED WebSocket endpoint
// (/mesh/coop/ws) that does NOT touch the device-mesh auth path: it authenticates by the session
// code (host-as-server resolves it), groups peers into coop:<sessionId> rooms, and relays
// presence, WebRTC SDP/ICE signaling, Yjs CRDT sync frames, chat and cursors between peers. This
// is the "never dies" transport (host-relayed) that the WebRTC DataChannel optimizes on top of.

const { WebSocketServer } = require("ws");

const RELAYABLE = new Set(["signal", "presence", "sync", "chat", "cursor"]);
const AUTH_TIMEOUT_MS = 8000;

function createCoopSignal({ getSessionByCode }) {
  if (typeof getSessionByCode !== "function") throw new Error("createCoopSignal requires getSessionByCode(code)");
  const wss = new WebSocketServer({ noServer: true });
  const rooms = new Map(); // sessionId → Set<ws>

  const roomOf = (sid) => rooms.get(sid);
  function join(ws, sessionId, role, name) {
    ws._coopSession = sessionId; ws._coopRole = role; ws._coopName = name;
    if (!rooms.has(sessionId)) rooms.set(sessionId, new Set());
    rooms.get(sessionId).add(ws);
  }
  function leave(ws) {
    const set = roomOf(ws._coopSession);
    if (set) { set.delete(ws); if (!set.size) rooms.delete(ws._coopSession); }
  }
  function roster(sid) {
    return [...(roomOf(sid) || [])].map((w) => ({ role: w._coopRole, name: w._coopName }));
  }
  function broadcast(sid, msg, exclude) {
    const set = roomOf(sid); if (!set) return;
    const data = JSON.stringify(msg);
    for (const peer of set) if (peer !== exclude && peer.readyState === 1) { try { peer.send(data); } catch { /* closed */ } }
  }

  wss.on("connection", (ws) => {
    ws._authed = false;
    const authTimer = setTimeout(() => { if (!ws._authed) { try { ws.close(4001, "auth timeout"); } catch {} } }, AUTH_TIMEOUT_MS);

    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      if (!ws._authed) {
        if (msg.type !== "hello") { try { ws.close(4002, "expected hello"); } catch {} return; }
        const session = getSessionByCode(String(msg.code || ""));
        if (!session || session.status === "ended") {
          try { ws.send(JSON.stringify({ type: "error", error: "invalid or expired session code" })); ws.close(4003, "bad code"); } catch {}
          return;
        }
        clearTimeout(authTimer);
        ws._authed = true;
        const role = msg.role === "host" ? "host" : "guest";
        const name = String(msg.name || "peer").slice(0, 60);
        join(ws, session.id, role, name);
        ws.send(JSON.stringify({ type: "welcome", sessionId: session.id, role, roster: roster(session.id) }));
        broadcast(session.id, { type: "presence", event: "join", role, name, roster: roster(session.id) }, ws);
        return;
      }

      // Authenticated: relay only whitelisted frames to the rest of this session's room.
      if (RELAYABLE.has(msg.type)) broadcast(ws._coopSession, { ...msg, from: ws._coopRole, name: ws._coopName }, ws);
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      const sid = ws._coopSession, role = ws._coopRole, name = ws._coopName;
      leave(ws);
      if (sid) broadcast(sid, { type: "presence", event: "leave", role, name, roster: roster(sid) }, ws);
    });
    ws.on("error", () => { /* surfaced via close */ });
  });

  return {
    handleUpgrade(req, socket, head) { wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)); },
    roomCount: () => rooms.size,
    peerCount: (sid) => (roomOf(sid) ? roomOf(sid).size : 0),
    wss,
  };
}

module.exports = { createCoopSignal };
