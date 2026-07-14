// Synapse W3 — authenticated-authority acceptance. Unit-checks the E2E identity / safety number /
// triple-DH handshake / resume tokens and the capability-lease algebra, then drives one live server
// to prove: approval mints a guest lease + matching safety number + resume token; the guest lease
// grants collaborator scopes but NOT apply/fs.write; the host operator can apply; a resume token
// verifies (and a tampered one is rejected); ending the session revokes the lease. Exit non-zero on fail.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, "server", "coop-transport.js"));
const L = require(path.join(ROOT, "server", "coop-leases.js"));

let pass = 0;
const ok = (n, d = "") => { pass++; console.log(`PASS ${n}${d ? ` — ${d}` : ""}`); };

// ---- 1) E2E identity + safety number + handshake + resume token ----
{
  const host = T.newHostIdentity();
  const guest = T.newIdentity();
  assert.ok(host.publicKey.includes("PUBLIC KEY") && host.privateKey.includes("PRIVATE KEY"), "PEM keypair");
  assert.equal(host.fingerprint, T.keyFingerprint(host.publicKey), "fingerprint derives from public key");
  assert.notEqual(host.fingerprint, guest.fingerprint, "distinct identities");
  ok("X25519 identity + fingerprint");

  const snHost = T.safetyNumber(host.fingerprint, guest.fingerprint);
  const snGuest = T.safetyNumber(guest.fingerprint, host.fingerprint);
  assert.equal(snHost, snGuest, "safety number is order-independent (both read the same)");
  const mitm = T.newIdentity();
  assert.notEqual(T.safetyNumber(host.fingerprint, mitm.fingerprint), snHost, "MITM key → different safety number");
  ok("safety number matches for the pair, differs under MITM", snHost);

  // Triple-DH: both parties derive the SAME session key from their own private + peer public keys.
  const hostEph = T.newIdentity(), guestEph = T.newIdentity();
  const kHost = T.deriveSessionKey({ selfStaticPriv: host.privateKey, selfEphPriv: hostEph.privateKey, peerStaticPub: guest.publicKey, peerEphPub: guestEph.publicKey });
  const kGuest = T.deriveSessionKey({ selfStaticPriv: guest.privateKey, selfEphPriv: guestEph.privateKey, peerStaticPub: host.publicKey, peerEphPub: hostEph.publicKey });
  assert.equal(kHost, kGuest, "host and guest agree on the session key");
  const kMitm = T.deriveSessionKey({ selfStaticPriv: mitm.privateKey, selfEphPriv: hostEph.privateKey, peerStaticPub: guest.publicKey, peerEphPub: guestEph.publicKey });
  assert.notEqual(kMitm, kHost, "wrong static key → different session key (mutual auth)");
  ok("Noise-XX-style triple-DH key agreement");

  const secret = crypto.randomBytes(16).toString("hex");
  const tok = T.issueResumeToken({ secret, sessionId: "s1", guestFp: guest.fingerprint, ttlSec: 60 });
  assert.equal(T.verifyResumeToken(tok, { secret, sessionId: "s1", guestFp: guest.fingerprint }).ok, true, "valid token verifies");
  assert.equal(T.verifyResumeToken(tok + "x", { secret, sessionId: "s1", guestFp: guest.fingerprint }).ok, false, "tampered token rejected");
  assert.equal(T.verifyResumeToken(tok, { secret: "other", sessionId: "s1", guestFp: guest.fingerprint }).ok, false, "wrong secret rejected");
  const expired = T.issueResumeToken({ secret, sessionId: "s1", guestFp: guest.fingerprint, ttlSec: -1 });
  assert.equal(T.verifyResumeToken(expired, { secret, sessionId: "s1", guestFp: guest.fingerprint }).ok, false, "expired token rejected");
  ok("resume token issue/verify/reject");
}

// ---- 2) capability lease algebra ----
{
  const lease = L.mintGuestLease("sess-1");
  assert.equal(L.leaseAllows(lease, "coop.chat"), true, "guest may chat");
  assert.equal(L.leaseAllows(lease, "coop.patch.propose"), true, "guest may propose patches");
  assert.equal(L.leaseAllows(lease, "coop.chat", "coop:session/sess-1/x"), true, "scoped to this session");
  assert.equal(L.leaseAllows(lease, "coop.chat", "coop:session/OTHER/x"), false, "cannot touch another session");
  assert.equal(L.leaseAllows(lease, "fs.write"), false, "guest has NO fs.write");
  assert.equal(L.leaseAllows(lease, "coop.patch.apply"), false, "no apply scope exists for a guest");
  assert.equal(lease.sideEffecting, false, "guest lease is non-side-effecting");
  assert.equal(lease.mayDelegate, false, "guest lease cannot delegate");
  const narrowed = L.mintGuestLease("sess-1", { grantedScopes: ["coop.chat"] });
  assert.equal(L.leaseAllows(narrowed, "coop.chat"), true);
  assert.equal(L.leaseAllows(narrowed, "coop.patch.propose"), false, "narrowed lease drops unrequested scopes");
  assert.equal(L.leaseAllows(L.revokeLease(lease), "coop.chat"), false, "revoked lease denies everything");
  ok("guest lease: scoped, non-delegable, no apply, revocable");
}

// ---- 3) live flow: approval mints lease + safety number + resume token; host-only apply; resume ----
const port = Number(process.env.SYN_W3_PORT || 8993);
const base = `http://127.0.0.1:${port}`;
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "syn-w3-"));
let server;
try {
  server = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), JARVIS_HOST: "127.0.0.1", JARVIS_RUNTIME_DIR: runtimeDir,
      GEMINI_API_KEY: "", GOOGLE_ACCESS_TOKEN: "", GOOGLE_REFRESH_TOKEN: "",
      JARVIS_MOCK_SCREEN_CAPTURE: "1", JARVIS_DESKTOP_CONTROL_DRY_RUN: "1" },
    stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }

  const cookie = (await fetch(`${base}/api/capabilities`)).headers.get("set-cookie")?.split(";")[0] || "";
  const hostH = { "content-type": "application/json", cookie };

  const session = (await (await fetch(`${base}/api/coop-symbiote/session/create`, { method: "POST", headers: hostH, body: JSON.stringify({ title: "W3", mode: "Pair Build Mode" }) })).json()).session;
  assert.ok(session.hostPublicKey?.includes("PUBLIC KEY"), "session exposes host public key");
  assert.equal(session._secrets, undefined, "server secrets NEVER leak to the client");
  ok("session exposes host public key, hides private secrets");

  // Remote guest joins with its own X25519 identity.
  const guest = T.newIdentity();
  await fetch(`${base}/api/coop-symbiote/session/join-remote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: session.code, displayName: "Aryan", guestPublicKey: guest.publicKey }) });
  const approved = (await (await fetch(`${base}/api/coop-symbiote/session/${session.id}/approve-join`, { method: "POST", headers: hostH, body: "{}" })).json()).session;
  assert.ok(approved.guest?.lease?.signature, "approval minted a signed guest lease");
  assert.equal(L.leaseAllows(approved.guest.lease, "coop.chat"), true, "minted lease grants collaborator scopes");
  assert.equal(L.leaseAllows(approved.guest.lease, "fs.write"), false, "minted lease has no fs.write");
  const expectedSN = T.safetyNumber(session.hostFingerprint, T.keyFingerprint(guest.publicKey));
  assert.equal(approved.guest.safetyNumber, expectedSN, "host's safety number matches what the guest computes");
  assert.ok(approved.guest.resumeToken, "approval issued a resume token");
  ok("approve mints lease + matching safety number + resume token");

  // Host operator CAN apply (local-owner). Propose → ghost → approve → apply.
  const patch = (await (await fetch(`${base}/api/coop-symbiote/patches`, { method: "POST", headers: hostH, body: JSON.stringify({ sessionId: session.id, filePath: "docs/JARVIS_COOP_SYMBIOTE_MESH_GUIDE.md", originalText: "private two-person collaboration workspace", replacementText: "private two-person collaboration workspace (W3)", summary: "w3", author: "Aryan" }) })).json()).patch;
  await fetch(`${base}/api/coop-symbiote/patches/${patch.id}/ghost-test`, { method: "POST", headers: hostH, body: JSON.stringify({ sessionId: session.id }) });
  const applied = await fetch(`${base}/api/coop-symbiote/patches/${patch.id}/apply`, { method: "POST", headers: hostH, body: JSON.stringify({ sessionId: session.id, actor: "Dev" }) });
  assert.equal(applied.status, 200, "host operator (local-owner) can apply");
  ok("host operator can apply a patch (host authority)");

  // Resume: the guest's token re-establishes the channel; a tampered token is rejected.
  const good = await fetch(`${base}/api/coop-symbiote/session/${session.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resumeToken: approved.guest.resumeToken }) });
  assert.equal(good.status, 200, "valid resume token reconnects without re-approval");
  const bad = await fetch(`${base}/api/coop-symbiote/session/${session.id}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resumeToken: approved.guest.resumeToken + "tamper" }) });
  assert.equal(bad.status, 401, "tampered resume token rejected");
  ok("resume-token reconnect (valid accepted, tampered rejected)");

  // Ending the session revokes the guest lease.
  const ended = (await (await fetch(`${base}/api/coop-symbiote/session/${session.id}/end`, { method: "POST", headers: hostH, body: JSON.stringify({ reason: "done" }) })).json()).session;
  assert.equal(L.leaseAllows(ended.guest.lease, "coop.chat"), false, "ending the session revokes the guest lease");
  ok("session end revokes the guest lease");

  console.log(`\nSynapse W3 authenticated-authority check passed: ${pass}/${pass}`);
} finally {
  if (server && !server.killed) { const exited = new Promise((r) => server.once("exit", r)); server.kill(); await exited; }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
