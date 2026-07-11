"use strict";

/**
 * Mesh Hub — WebSocket backbone for the entire Device Mesh.
 *
 * Replaces all HTTP polling with a single persistent authenticated
 * WebSocket connection per device. Every real-time feature — pairing
 * notifications, screen share signaling, clipboard, camera frames,
 * control events, activity feed — flows through this hub.
 *
 * Architecture:
 *   - `noServer` mode: attaches to existing http.Server via the
 *     `upgrade` event, so no port conflicts with the HTTP server.
 *   - First message MUST be {type:"auth", token:"<device-access-token>"}
 *     within AUTH_TIMEOUT_MS or the socket is closed.
 *   - Binary frames (camera, screen JPEG fallback) land in onBinaryFrame.
 *   - Rooms support arbitrary groupings (co-op sessions, canvas sync).
 *   - Heartbeat ping/pong every HEARTBEAT_INTERVAL_MS drops stale clients.
 */

const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const AUTH_TIMEOUT_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 30000;
const MAX_TEXT_PAYLOAD_BYTES = 2 * 1024 * 1024;  // 2 MB
const MAX_BINARY_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB (camera JPEG)
const WS_PATH = "/mesh/ws";

class MeshHub {
  constructor() {
    this._wss = null;
    this._clients = new Map();        // deviceId → { ws, device, joinedAt, rooms: Set }
    this._rooms = new Map();          // roomId → Set<deviceId>
    this._pendingSockets = new Map(); // requestId → ws (pre-auth pairing page sockets)
    this._heartbeatTimer = null;
    this._deps = null;
    this._latestCameraFrames = new Map(); // deviceId → { buf, ts, mimeType }
    this._controlBatonHolder = null;      // deviceId currently holding control
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  /**
   * @param {import('http').Server} httpServer
   * @param {{
   *   verifyToken: (token: string) => object|null,
   *   publicDevice: (device: object) => object,
   *   recordMeshEvent: (type: string, summary: string, meta?: object) => void,
   *   getCapabilityEngine: () => object,
   *   getNeuralVault: () => object,
   * }} deps
   */
  init(httpServer, deps) {
    this._deps = deps;

    this._wss = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_BINARY_PAYLOAD_BYTES,
    });

    // Attach to HTTP server upgrade event — only handle /mesh/ws
    httpServer.on("upgrade", (req, socket, head) => {
      let pathname;
      try {
        pathname = new URL(req.url, "ws://localhost").pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== WS_PATH) return; // let other upgrade handlers (if any) deal with it

      // Host validation — reject non-local/non-tunnel origins
      try {
        const host = String(req.headers.host || "").split(":")[0].toLowerCase();
        const isLocal = ["127.0.0.1", "localhost", "::1"].includes(host);
        const isTunnel = host.endsWith(".trycloudflare.com");
        const isLan = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|\d+\.\d+\.\d+\.\d+$)/.test(host);
        if (!isLocal && !isTunnel && !isLan) {
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }

      this._wss.handleUpgrade(req, socket, head, (ws) => {
        this._wss.emit("connection", ws, req);
      });
    });

    this._wss.on("connection", (ws, req) => this._onConnect(ws, req));
    this._startHeartbeat();

    console.log(`[mesh-hub] WebSocket hub ready at ws://...${WS_PATH}`);
    return this;
  }

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  _onConnect(ws, req) {
    ws._isAlive = true;
    ws._deviceId = null;
    ws._pendingRequestId = null; // set for pre-auth pairing sockets
    ws._authTimer = setTimeout(() => {
      this._closeWs(ws, 4001, "auth_timeout");
    }, AUTH_TIMEOUT_MS);

    ws.on("pong", () => { ws._isAlive = true; });
    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          this._onBinaryFrame(ws, data);
        } else {
          const msg = JSON.parse(data.toString());
          this._onMessage(ws, msg);
        }
      } catch (err) {
        // malformed JSON or handler error — don't crash
      }
    });
    ws.on("close", () => this._onDisconnect(ws));
    ws.on("error", (err) => {
      // absorb — logged via disconnect
    });
  }

  _onDisconnect(ws) {
    // Clean up pre-auth pending pairing socket
    if (ws._pendingRequestId) {
      if (this._pendingSockets.get(ws._pendingRequestId) === ws) {
        this._pendingSockets.delete(ws._pendingRequestId);
      }
    }
    if (!ws._deviceId) return;
    const entry = this._clients.get(ws._deviceId);
    if (entry) {
      for (const roomId of entry.rooms) {
        const room = this._rooms.get(roomId);
        if (room) room.delete(ws._deviceId);
      }
      this._clients.delete(ws._deviceId);
    }
    if (this._controlBatonHolder === ws._deviceId) {
      this._controlBatonHolder = null;
    }
    this._deps?.recordMeshEvent?.("ws_disconnected", `Device ${ws._deviceId} WebSocket disconnected.`, {
      deviceId: ws._deviceId,
    });
    this.broadcast("device_ws_disconnected", { deviceId: ws._deviceId }, ws._deviceId);
  }

  // ─── Pre-auth pairing sockets ─────────────────────────────────────────────

  _handlePairPending(ws, msg) {
    const requestId = String(msg.requestId || "").trim();
    if (!requestId) { this._closeWs(ws, 4002, "missing_request_id"); return; }
    clearTimeout(ws._authTimer);
    // Extend liveness timeout — user may wait up to 10 min for approval
    ws._authTimer = setTimeout(() => this._closeWs(ws, 4001, "pair_timeout"), 600_000);
    ws._pendingRequestId = requestId;
    // Replace any existing pending socket for this requestId
    const existing = this._pendingSockets.get(requestId);
    if (existing?.readyState === 1) try { existing.close(4004, "superseded"); } catch {}
    this._pendingSockets.set(requestId, ws);
    this._send(ws, "pair_pending_ok", { requestId, message: "Waiting for Jarvis approval." });
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  _handleAuth(ws, msg) {
    clearTimeout(ws._authTimer);
    const token = String(msg.token || "").trim();
    if (!token) { this._closeWs(ws, 4002, "missing_token"); return; }

    const device = this._deps?.verifyToken(token);
    if (!device) { this._closeWs(ws, 4003, "invalid_token"); return; }

    // Clean up any previous connection for this device (tab refresh etc.)
    const existing = this._clients.get(device.id);
    if (existing?.ws?.readyState === 1) {
      this._closeWs(existing.ws, 4004, "superseded");
    }

    ws._deviceId = device.id;
    this._clients.set(device.id, {
      ws,
      device,
      joinedAt: Date.now(),
      rooms: new Set(),
    });

    this._send(ws, "auth_ok", {
      deviceId: device.id,
      name: device.name,
      role: device.role,
      trustLevel: device.trustLevel,
      ts: Date.now(),
    });

    this._deps?.recordMeshEvent?.("ws_connected", `Device ${device.name} connected via WebSocket.`, {
      deviceId: device.id,
      role: device.role,
    });

    // Notify all other connected devices (especially laptop browser)
    const pub = this._deps?.publicDevice?.(device) ?? { id: device.id, name: device.name };
    this.broadcast("device_ws_connected", { device: pub }, device.id);
  }

  // ─── Message routing ──────────────────────────────────────────────────────

  _onMessage(ws, msg) {
    if (msg.type === "auth") { this._handleAuth(ws, msg); return; }
    // pair_pending: phone is on the pairing page, not yet authenticated.
    // Registers the socket so deliverPairToken() can push the token directly.
    if (msg.type === "pair_pending") { this._handlePairPending(ws, msg); return; }
    if (!ws._deviceId && !ws._pendingRequestId) { this._closeWs(ws, 4001, "unauthenticated"); return; }
    if (!ws._deviceId) return; // pending-pair socket — only pair_approved will be sent to it

    switch (msg.type) {
      case "heartbeat":      this._send(ws, "pong", { ts: Date.now() }); break;
      case "rtc_signal":     this._handleRtcSignal(ws, msg); break;
      case "control_event":  this._handleControlEvent(ws, msg); break;
      case "clipboard":      this._handleClipboard(ws, msg); break;
      case "camera_meta":    this._handleCameraMetadata(ws, msg); break;
      case "join_room":      this._joinRoom(ws, msg.room); break;
      case "leave_room":     this._leaveRoom(ws, msg.room); break;
      case "room_message":   this._toRoom(msg.room, msg.payload, ws._deviceId); break;
      case "request_baton":  this._handleBatonRequest(ws, msg); break;
      case "release_baton":  this._handleBatonRelease(ws); break;
      case "get_peers": {
        const peers = [];
        for (const [deviceId, entry] of this._clients) {
          if (deviceId !== ws._deviceId) {
            peers.push({ deviceId, name: entry.device?.name, role: entry.device?.role, trustLevel: entry.device?.trustLevel });
          }
        }
        this._send(ws, "peers_list", { peers });
        break;
      }
      default: break;
    }
  }

  // ─── Binary frames (camera, JPEG screen fallback) ─────────────────────────

  _onBinaryFrame(ws, buf) {
    if (!ws._deviceId) return;
    if (buf.length > MAX_BINARY_PAYLOAD_BYTES) return;

    // Determine frame type from first byte tag (0x01 = camera, 0x02 = screen)
    // If no tag, assume camera (legacy/simple senders)
    const tag = buf[0];
    const isScreen = tag === 0x02;
    const payload = (tag === 0x01 || tag === 0x02) ? buf.slice(1) : buf;

    if (isScreen) {
      // JPEG screen fallback frame — forward to all subscribed viewers
      this._rooms.get(`screen:${ws._deviceId}`)?.forEach((viewerId) => {
        this.push(viewerId, "screen_frame_jpeg", {
          sourceDeviceId: ws._deviceId,
          jpeg: payload.toString("base64"),
          ts: Date.now(),
        });
      });
    } else {
      // Camera frame — store latest, forward to subscribers
      this._latestCameraFrames.set(ws._deviceId, {
        buf: payload,
        ts: Date.now(),
        deviceId: ws._deviceId,
      });
      this._rooms.get(`camera:${ws._deviceId}`)?.forEach((subscriberId) => {
        this.push(subscriberId, "camera_frame", {
          sourceDeviceId: ws._deviceId,
          jpeg: payload.toString("base64"),
          ts: Date.now(),
        });
      });
      // Always notify laptop so it can display camera indicator
      this.broadcast("camera_frame_available", {
        sourceDeviceId: ws._deviceId,
        ts: Date.now(),
      }, ws._deviceId);
    }
  }

  // ─── WebRTC signaling relay ───────────────────────────────────────────────

  _handleRtcSignal(ws, msg) {
    const { signal } = msg;
    if (!signal) return;
    let targetDeviceId = msg.targetDeviceId;
    if (targetDeviceId === "host") {
      for (const [deviceId, entry] of this._clients) {
        if (entry.device?.role === "host" || entry.device?.trustLevel >= 3) {
          targetDeviceId = deviceId;
          break;
        }
      }
    }
    if (!targetDeviceId) return;
    this.push(targetDeviceId, "rtc_signal", { fromDeviceId: ws._deviceId, signal });
  }

  // ─── Screen control ───────────────────────────────────────────────────────

  _handleControlEvent(ws, msg) {
    if (this._controlBatonHolder !== ws._deviceId) {
      this._send(ws, "control_denied", { reason: "no_baton" });
      return;
    }
    const engine = this._deps?.getCapabilityEngine?.();
    if (!engine) {
      this._send(ws, "control_denied", { reason: "engine_unavailable" });
      return;
    }
    engine.execute("screen_act", msg.payload ?? msg)
      .then((result) => this._send(ws, "control_result", { ok: true, result }))
      .catch((err) => this._send(ws, "control_result", { ok: false, error: err.message }));
  }

  _handleBatonRequest(ws, msg) {
    if (this._controlBatonHolder && this._controlBatonHolder !== ws._deviceId) {
      this._send(ws, "baton_denied", { reason: "held_by_another", holder: this._controlBatonHolder });
      return;
    }
    this._controlBatonHolder = ws._deviceId;
    this._send(ws, "baton_granted", { expiresIn: msg.durationSeconds ?? 120 });
    this.broadcast("baton_changed", { holder: ws._deviceId }, ws._deviceId);
    // Auto-expire
    const duration = Math.min(Number(msg.durationSeconds ?? 120), 600) * 1000;
    setTimeout(() => {
      if (this._controlBatonHolder === ws._deviceId) {
        this._controlBatonHolder = null;
        this.broadcast("baton_released", { holder: ws._deviceId });
      }
    }, duration);
  }

  _handleBatonRelease(ws) {
    if (this._controlBatonHolder === ws._deviceId) {
      this._controlBatonHolder = null;
      this.broadcast("baton_released", { holder: ws._deviceId });
    }
  }

  // ─── Clipboard relay ─────────────────────────────────────────────────────

  _handleClipboard(ws, msg) {
    const text = String(msg.text ?? "");
    if (!text || text.length > 1_000_000) return; // 1 MB cap

    // Store in neural vault as a mesh object (best-effort)
    try {
      this._deps?.getNeuralVault?.()?.recordMeshInboxItem?.({
        sourceDeviceId: ws._deviceId,
        itemType: "clipboard",
        textPreview: text.slice(0, 200),
        summary: `Clipboard from ${ws._deviceId}: ${text.slice(0, 120)}`,
        classification: "clipboard",
        storedLongTerm: false,
      });
    } catch {}

    // Relay to all other trusted connected devices
    for (const [deviceId] of this._clients) {
      if (deviceId !== ws._deviceId) {
        this.push(deviceId, "clipboard", {
          text,
          from: ws._deviceId,
          ts: Date.now(),
          preview: text.slice(0, 60),
        });
      }
    }
  }

  // ─── Camera metadata ─────────────────────────────────────────────────────

  _handleCameraMetadata(ws, msg) {
    // Phone signals camera state (started/stopped/resolution)
    this.broadcast("camera_state", {
      deviceId: ws._deviceId,
      state: msg.state,
      width: msg.width,
      height: msg.height,
    }, ws._deviceId);
  }

  // ─── Rooms ────────────────────────────────────────────────────────────────

  _joinRoom(ws, roomId) {
    if (!roomId || typeof roomId !== "string") return;
    if (!this._rooms.has(roomId)) this._rooms.set(roomId, new Set());
    this._rooms.get(roomId).add(ws._deviceId);
    this._clients.get(ws._deviceId)?.rooms.add(roomId);
    this._send(ws, "room_joined", { room: roomId });
  }

  _leaveRoom(ws, roomId) {
    this._rooms.get(roomId)?.delete(ws._deviceId);
    this._clients.get(ws._deviceId)?.rooms.delete(roomId);
  }

  _toRoom(roomId, payload, excludeDeviceId) {
    const members = this._rooms.get(roomId);
    if (!members) return;
    for (const deviceId of members) {
      if (deviceId !== excludeDeviceId) {
        this.push(deviceId, "room_message", { room: roomId, payload });
      }
    }
  }

  // ─── Pairing integration ─────────────────────────────────────────────────

  /**
   * Called by server.js when a phone submits a pair request.
   * Instantly notifies all connected laptop browsers.
   */
  notifyPairRequest(device) {
    const pub = this._deps?.publicDevice?.(device) ?? device;
    this.broadcast("pair_request_pending", { device: pub, ts: Date.now() });
  }

  /**
   * Called by server.js after approvePairingRequest().
   * Delivers the access token directly to the phone's WebSocket — no polling.
   * Handles both authenticated sockets AND pre-auth pending-pair sockets.
   */
  deliverPairToken(deviceId, accessToken) {
    const payload = {
      accessToken,
      deviceId,
      ts: Date.now(),
      message: "Pairing approved. You are now connected to Jarvis.",
    };
    // Try the already-authenticated channel first (tab refresh after prior pairing)
    this.push(deviceId, "pair_approved", payload);
    // Also push to the pre-auth pending socket (primary path for new pairings)
    const pendingWs = this._pendingSockets?.get(deviceId);
    if (pendingWs?.readyState === 1) {
      this._send(pendingWs, "pair_approved", payload);
      this._pendingSockets.delete(deviceId);
    }
  }

  /**
   * Called by server.js after denyPairingRequest().
   */
  notifyPairDenied(deviceId) {
    const payload = { ts: Date.now(), message: "Pairing request was denied." };
    this.push(deviceId, "pair_denied", payload);
    const pendingWs = this._pendingSockets?.get(deviceId);
    if (pendingWs?.readyState === 1) {
      this._send(pendingWs, "pair_denied", payload);
      this._pendingSockets.delete(deviceId);
    }
  }

  // ─── Public push API ─────────────────────────────────────────────────────

  /** Send a typed message to one specific device. */
  push(deviceId, type, payload) {
    const entry = this._clients.get(deviceId);
    if (!entry) return false;
    return this._send(entry.ws, type, payload);
  }

  /** Send to all connected devices, optionally excluding one. */
  broadcast(type, payload, excludeDeviceId) {
    let count = 0;
    for (const [deviceId, entry] of this._clients) {
      if (deviceId !== excludeDeviceId) {
        if (this._send(entry.ws, type, payload)) count++;
      }
    }
    return count;
  }

  /** Send to all devices in a room. */
  toRoom(roomId, type, payload, excludeDeviceId) {
    const members = this._rooms.get(roomId);
    if (!members) return 0;
    let count = 0;
    for (const deviceId of members) {
      if (deviceId !== excludeDeviceId) {
        if (this.push(deviceId, type, payload)) count++;
      }
    }
    return count;
  }

  /** Emit an activity feed event — reaches WS clients AND SSE subscribers. */
  emitFeedEvent(type, data) {
    const payload = { feedType: type, ...data, ts: Date.now() };
    this.broadcast("feed_event", payload);
    // Reach SSE clients (phone Feed tab)
    if (this._sseFeed) {
      for (const sendFn of this._sseFeed.values()) {
        try { sendFn(type, data); } catch {}
      }
    }
  }

  // ─── Camera API ──────────────────────────────────────────────────────────

  getLatestCameraFrame(deviceId) {
    if (deviceId) return this._latestCameraFrames.get(deviceId) ?? null;
    // No deviceId: return most recent across all devices
    let latest = null;
    for (const frame of this._latestCameraFrames.values()) {
      if (!latest || frame.ts > latest.ts) latest = frame;
    }
    return latest;
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  status() {
    const connected = [];
    for (const [deviceId, entry] of this._clients) {
      connected.push({
        deviceId,
        name: entry.device?.name,
        role: entry.device?.role,
        joinedAt: entry.joinedAt,
        rooms: [...entry.rooms],
      });
    }
    return {
      connectedCount: this._clients.size,
      connected,
      roomCount: this._rooms.size,
      controlBatonHolder: this._controlBatonHolder,
      cameraDevices: [...this._latestCameraFrames.keys()],
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _send(ws, type, payload) {
    if (!ws || ws.readyState !== 1 /* OPEN */) return false;
    try {
      ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  _closeWs(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }

  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      for (const [, entry] of this._clients) {
        const { ws } = entry;
        if (!ws._isAlive) {
          ws.terminate();
          continue;
        }
        ws._isAlive = false;
        try { ws.ping(); } catch {}
      }
    }, HEARTBEAT_INTERVAL_MS);
    this._heartbeatTimer.unref?.(); // don't keep process alive
  }

  close() {
    clearInterval(this._heartbeatTimer);
    for (const [, entry] of this._clients) {
      try { entry.ws.terminate(); } catch {}
    }
    for (const ws of (this._pendingSockets?.values() ?? [])) {
      try { ws.terminate(); } catch {}
    }
    this._clients.clear();
    this._rooms.clear();
    this._pendingSockets?.clear();
    this._sseFeed?.clear();
    this._wss?.close();
  }
}

const meshHub = new MeshHub();

module.exports = {
  meshHub,
  createMeshHub: () => meshHub,
  MeshHub,
};
