// Synapse W2 — cross-machine acceptance harness. Starts TWO independent server instances
// (separate ports + separate runtime dirs = separate stores) to model two machines, then proves
// a REMOTE guest (no local session cookie) can reach the host's session via the code-gated
// /session/join-remote route, that the old cookie-gated route rejects the same stranger, that
// wrong code / wrong proof / IP flooding are rejected, and that host approval connects the guest.
// Also unit-checks the transport primitives. Exit non-zero on any failure.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const transport = require(path.join(ROOT, "server", "coop-transport.js"));

let pass = 0;
const ok = (name, detail = "") => { pass++; console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); };

// ---- 1) transport primitive unit checks (no server needed) ----
{
  const salt = transport.makeCodeSalt();
  const proof = transport.codeProof(salt, "628-907");
  assert.equal(transport.verifyCodeProof(salt, "628907", proof), true, "code proof verifies (normalized)");
  assert.equal(transport.verifyCodeProof(salt, "000000", proof), false, "wrong code fails proof");
  assert.equal(transport.verifyCodeProof("other", "628907", proof), false, "wrong salt fails proof");
  ok("code proof HMAC verify/reject");

  assert.equal(transport.clientIp({ headers: { "cf-connecting-ip": "203.0.113.9" }, socket: { remoteAddress: "10.0.0.1" } }), "203.0.113.9", "prefers CF-Connecting-IP");
  assert.equal(transport.clientIp({ headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }, socket: {} }), "198.51.100.7", "first XFF hop");
  assert.equal(transport.clientIp({ headers: {}, socket: { remoteAddress: "::ffff:127.0.0.1" } }), "127.0.0.1", "normalizes v4-mapped");
  assert.equal(transport.clientIp({ headers: { "cf-connecting-ip": "203.0.113.9" }, socket: {} }, { trustProxy: false }), "", "ignores headers when proxy not trusted");
  ok("clientIp precedence + normalization");

  const cred = transport.mintTurnCredentials({ sessionId: "s1", ttlSec: 120 });
  assert.match(cred.username, /^\d+:s1$/, "TURN username = expiry:sessionId");
  assert.ok(cred.credential && cred.urls.length >= 1 && cred.ttl === 120, "TURN credential shape");
  ok("ephemeral TURN credential mint");

  assert.equal(transport.egressScan({ note: "hello", nested: { key: "fine" } }).ok, true, "clean payload passes egress");
  assert.equal(transport.egressScan({ leak: "api_key=sk-abcdefghijklmnopqrstuvwxyz012345" }).ok, false, "secret-like payload blocked");
  ok("egress secret scan");
}

// ---- 2) spin up two independent instances ----
function startServer(port, runtimeDir) {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir,
      GEMINI_API_KEY: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "",
      JARVIS_MOCK_SCREEN_CAPTURE: "1", JARVIS_DESKTOP_CONTROL_DRY_RUN: "1" },
    stdio: "ignore", windowsHide: true,
  });
  return server;
}
async function waitFor(port) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server ${port} did not start`);
}

const hostPort = Number(process.env.SYN_HOST_PORT || 8991);
const guestPort = Number(process.env.SYN_GUEST_PORT || 8992);
const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-host-"));
const guestDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-guest-"));
const hostBase = `http://127.0.0.1:${hostPort}`;
const guestBase = `http://127.0.0.1:${guestPort}`;
let hostSrv, guestSrv;

try {
  hostSrv = startServer(hostPort, hostDir);
  guestSrv = startServer(guestPort, guestDir);
  await Promise.all([waitFor(hostPort), waitFor(guestPort)]);
  ok("two independent instances up", `host:${hostPort} guest:${guestPort}`);

  // Host establishes a local session (cookie) and creates a co-op session.
  const boot = await fetch(`${hostBase}/api/capabilities`);
  const hostCookie = boot.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(hostCookie, "host got a local session cookie");

  const createRes = await fetch(`${hostBase}/api/coop-symbiote/session/create`, {
    method: "POST", headers: { "content-type": "application/json", cookie: hostCookie },
    body: JSON.stringify({ title: "Cross-machine test", mode: "Pair Build Mode" }),
  });
  assert.equal(createRes.status, 201);
  const session = (await createRes.json()).session;
  const code = session.code;
  assert.match(code, /^\d{3}-\d{3}$/, "host minted a code");
  const invite = session.inviteLinks?.[0] || "";
  assert.match(invite, /coop_code=/, "invite carries code");
  assert.match(invite, /coop_salt=/, "invite carries salt");
  assert.match(invite, /coop_fp=/, "invite carries host fingerprint");
  ok("host created session + hardened invite", code);

  // Cross-machine proof: the guest INSTANCE (separate store) does not know this code.
  const guestStatus = await (await fetch(`${guestBase}/api/coop-symbiote/status`, { headers: { cookie: (await fetch(`${guestBase}/api/capabilities`)).headers.get("set-cookie")?.split(";")[0] || "" } })).json();
  assert.notEqual(guestStatus.activeSession?.code, code, "guest instance store does NOT contain the host's session");
  ok("separate stores confirmed (code only exists on host)");

  // A remote stranger (NO cookie) is REJECTED by the old cookie-gated join route.
  const oldJoin = await fetch(`${hostBase}/api/coop-symbiote/session/join`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, displayName: "Stranger" }),
  });
  assert.ok(oldJoin.status >= 400, `old /session/join blocks a session-less stranger (got ${oldJoin.status})`);
  ok("old join route still rejects a session-less stranger", `HTTP ${oldJoin.status}`);

  const remoteJoin = (body) => fetch(`${hostBase}/api/coop-symbiote/session/join-remote`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  // Wrong code → 404; right code + wrong proof → 403.
  assert.equal((await remoteJoin({ code: "111-222", displayName: "x" })).status, 404, "wrong code → 404");
  const salt = new URL(invite).searchParams.get("coop_salt");
  const badProof = transport.codeProof("not-the-salt", code);
  assert.equal((await remoteJoin({ code, displayName: "x", codeProof: badProof })).status, 403, "bad code proof → 403");
  ok("remote join rejects wrong code / bad proof");

  // The real unblock: a stranger with NO local session joins via the code-gated remote route.
  const goodProof = transport.codeProof(salt, code);
  const joinRes = await remoteJoin({ code, displayName: "Aryan (remote)", deviceName: "Aryan laptop", codeProof: goodProof });
  assert.equal(joinRes.status, 200, "remote join accepted");
  const joinBody = await joinRes.json();
  assert.equal(joinBody.session.pendingJoin.displayName, "Aryan (remote)", "host now has the pending join");
  ok("REMOTE guest reached host session via code-gated route (cross-machine unblock)");

  // Host approves → guest connected.
  const approve = await fetch(`${hostBase}/api/coop-symbiote/session/${encodeURIComponent(session.id)}/approve-join`, {
    method: "POST", headers: { "content-type": "application/json", cookie: hostCookie }, body: "{}",
  });
  assert.equal(approve.status, 200);
  assert.equal((await approve.json()).session.peerName, "Aryan (remote)", "guest connected after approval");
  ok("host approved → remote guest connected");

  // Ephemeral TURN credentials for the active session.
  const turn = await fetch(`${hostBase}/api/coop-symbiote/session/${encodeURIComponent(session.id)}/turn-credentials`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(turn.status, 200);
  const turnBody = await turn.json();
  assert.match(turnBody.username, /:/, "TURN username minted");
  assert.ok(turnBody.credential && turnBody.urls?.length, "TURN credential + urls");
  ok("ephemeral TURN credentials issued");

  // IP flood: many bad codes from one IP eventually trip the per-IP limiter (429).
  let saw429 = false;
  for (let i = 0; i < 30 && !saw429; i++) {
    if ((await remoteJoin({ code: `${String(i).padStart(3, "0")}-000`, displayName: "flood" })).status === 429) saw429 = true;
  }
  assert.ok(saw429, "per-IP rate limiter tripped (429) under a join flood");
  ok("per-IP rate limiter blocks code-spray flooding");

  console.log(`\nSynapse cross-machine check passed: ${pass}/${pass}`);
} finally {
  for (const s of [hostSrv, guestSrv]) {
    if (s && !s.killed) { const exited = new Promise((r) => s.once("exit", r)); s.kill(); await exited; }
  }
  fs.rmSync(hostDir, { recursive: true, force: true });
  fs.rmSync(guestDir, { recursive: true, force: true });
}
