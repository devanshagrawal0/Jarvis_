// Synapse W4 — signaling room + Yjs-over-relay acceptance. Starts one server, opens two WS clients
// to /mesh/coop/ws, and proves: code-gated auth (wrong code rejected), room join + presence,
// chat/signal relay between peers, and that two Yjs docs syncing ONLY over the relay converge
// (the "never dies" fallback path). Exit non-zero on failure.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const Y = require("yjs");

let pass = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS ${n}${d ? ` — ${d}` : ""}`); };

const port = Number(process.env.SYN_W4_PORT || 8990);
const base = `http://127.0.0.1:${port}`;
const wsBase = `ws://127.0.0.1:${port}/mesh/coop/ws`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-w4-"));
let server;

// Wait for the next message of a given type on a socket.
function next(ws, type, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeout);
    const on = (raw) => { let m; try { m = JSON.parse(raw); } catch { return; } if (!type || m.type === type) { clearTimeout(t); ws.off("message", on); resolve(m); } };
    ws.on("message", on);
  });
}
const open = (ws) => new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
const b64 = (u) => Buffer.from(u).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

try {
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir,
      GEMINI_API_KEY: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "", JARVIS_MOCK_SCREEN_CAPTURE: "1", JARVIS_DESKTOP_CONTROL_DRY_RUN: "1" },
    stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }

  const cookie = (await fetch(`${base}/api/capabilities`)).headers.get("set-cookie")?.split(";")[0] || "";
  const session = (await (await fetch(`${base}/api/coop-symbiote/session/create`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ title: "W4", mode: "Pair Build Mode" }) })).json()).session;
  const code = session.code;
  ok("session created for signaling", code);

  // Wrong code → error + close.
  const badWs = new WebSocket(wsBase); await open(badWs);
  badWs.send(JSON.stringify({ type: "hello", code: "000000", role: "guest" }));
  const err = await next(badWs, "error");
  assert.match(err.error, /invalid|expired/i, "bad code rejected");
  ok("code-gated: wrong code rejected");

  // Host + guest join the same room.
  const hostWs = new WebSocket(wsBase); await open(hostWs);
  hostWs.send(JSON.stringify({ type: "hello", code, role: "host", name: "Host" }));
  const hw = await next(hostWs, "welcome");
  assert.equal(hw.sessionId, session.id, "host joined the right room");

  const guestWs = new WebSocket(wsBase); await open(guestWs);
  const hostSeesJoin = next(hostWs, "presence");
  guestWs.send(JSON.stringify({ type: "hello", code, role: "guest", name: "Aryan" }));
  const gw = await next(guestWs, "welcome");
  assert.equal(gw.role, "guest");
  const pj = await hostSeesJoin;
  assert.equal(pj.event, "join"); assert.equal(pj.name, "Aryan");
  ok("host + guest in room; presence join pushed to host");

  // Chat relay guest → host.
  const hostGetsChat = next(hostWs, "chat");
  guestWs.send(JSON.stringify({ type: "chat", text: "hello over the relay" }));
  const chat = await hostGetsChat;
  assert.equal(chat.text, "hello over the relay"); assert.equal(chat.from, "guest");
  ok("chat relayed peer→peer");

  // WebRTC signaling relay (SDP/ICE ride the same channel).
  const hostGetsSignal = next(hostWs, "signal");
  guestWs.send(JSON.stringify({ type: "signal", kind: "offer", sdp: "v=0..." }));
  const sig = await hostGetsSignal;
  assert.equal(sig.kind, "offer"); assert.equal(sig.from, "guest");
  ok("WebRTC signaling relayed (SDP/ICE path)");

  // Yjs CRDT sync ONLY over the relay → both docs converge.
  const hostDoc = new Y.Doc(), guestDoc = new Y.Doc();
  hostWs.on("message", (raw) => { const m = JSON.parse(raw); if (m.type === "sync" && m.update) Y.applyUpdate(hostDoc, unb64(m.update)); });
  guestWs.on("message", (raw) => { const m = JSON.parse(raw); if (m.type === "sync" && m.update) Y.applyUpdate(guestDoc, unb64(m.update)); });
  hostDoc.on("update", (u) => hostWs.send(JSON.stringify({ type: "sync", update: b64(u) })));
  guestDoc.on("update", (u) => guestWs.send(JSON.stringify({ type: "sync", update: b64(u) })));

  hostDoc.getArray("chat").push(["from-host"]);
  guestDoc.getArray("chat").push(["from-guest"]);
  await new Promise((r) => setTimeout(r, 400));
  const hostArr = hostDoc.getArray("chat").toArray().sort();
  const guestArr = guestDoc.getArray("chat").toArray().sort();
  assert.deepEqual(hostArr, ["from-guest", "from-host"], "host doc has both entries");
  assert.deepEqual(guestArr, ["from-guest", "from-host"], "guest doc has both entries");
  ok("Yjs CRDT converges over the relay (both directions)");

  // Presence leave on disconnect.
  const hostSeesLeave = next(hostWs, "presence");
  guestWs.close();
  const leave = await hostSeesLeave;
  assert.equal(leave.event, "leave");
  ok("presence leave pushed on disconnect");

  hostWs.close(); badWs.close();
  console.log(`\nSynapse W4 signaling + CRDT check passed: ${pass}/${pass}`);
} finally {
  if (server && !server.killed) { const exited = new Promise((r) => server.once("exit", r)); server.kill(); await exited; }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
