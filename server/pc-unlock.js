"use strict";

// Step 1 of Face-ID PC unlock: the phone proves it's the owner with a real platform-authenticator
// (Face ID / Touch ID via WebAuthn), and on success the server raises a short-lived "unlock
// approved" flag. The lock-screen Credential Provider (step 2, not built yet) will poll that flag.
// This module holds NO Windows password and touches nothing on the lock screen — it is fully
// reversible. Enrolled credentials persist to runtime/pc-unlock.json.

const fs = require("fs");
const path = require("path");

// rpID/origin are derived from each request (via ctx) so enrollment and unlock work on whatever
// host the phone actually uses (tailnet name, etc.); the credential is bound to the host it was
// enrolled on, which WebAuthn requires to stay constant.
function createPcUnlock({ runtimeDir, log = () => {} } = {}) {
  const storePath = path.join(runtimeDir, "pc-unlock.json");
  let store = { credentials: [] };
  try { store = JSON.parse(fs.readFileSync(storePath, "utf8")); } catch { /* first run */ }
  const save = () => { try { fs.writeFileSync(storePath, JSON.stringify(store, null, 2)); } catch (e) { log(`save failed: ${e.message}`); } };

  const challenges = new Map();                        // id -> { challenge, kind, at }
  const APPROVAL_MS = 45_000;                          // the flag the Credential Provider will poll
  let approvedUntil = 0;
  let lastApprovedAt = 0;

  const newId = () => require("crypto").randomBytes(16).toString("hex");
  const putChallenge = (kind, challenge) => { const id = newId(); challenges.set(id, { challenge, kind, at: Date.now() }); for (const [k, v] of challenges) if (Date.now() - v.at > 300_000) challenges.delete(k); return id; };

  async function lib() { return import("@simplewebauthn/server"); }

  function state() {
    return { enrolled: store.credentials.length > 0, count: store.credentials.length, pending: Date.now() < approvedUntil, expiresInMs: Math.max(0, approvedUntil - Date.now()), lastApprovedAt: lastApprovedAt || null };
  }

  // ── enrollment (one-time: "set up Face ID unlock") ──
  async function enrollOptions(ctx) {
    const { rpID } = ctx;
    const { generateRegistrationOptions } = await lib();
    const opts = await generateRegistrationOptions({
      rpName: "JARVIS", rpID,
      userName: "owner", userDisplayName: "Owner",
      attestationType: "none",
      excludeCredentials: store.credentials.map((c) => ({ id: c.id })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
    });
    const challengeId = putChallenge("reg", opts.challenge);
    return { challengeId, options: opts };
  }
  async function enrollVerify(challengeId, response, ctx) {
    const { rpID, origin } = ctx;
    const { verifyRegistrationResponse } = await lib();
    const rec = challenges.get(challengeId);
    if (!rec || rec.kind !== "reg") throw Object.assign(new Error("Enrollment session expired — try again."), { statusCode: 400 });
    challenges.delete(challengeId);
    const verification = await verifyRegistrationResponse({ response, expectedChallenge: rec.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    if (!verification.verified || !verification.registrationInfo) throw Object.assign(new Error("Face ID enrollment could not be verified."), { statusCode: 400 });
    const { credential } = verification.registrationInfo;
    const id = credential.id;                                                       // base64url string
    const publicKey = Buffer.from(credential.publicKey).toString("base64");
    if (!store.credentials.some((c) => c.id === id)) { store.credentials.push({ id, publicKey, counter: credential.counter, enrolledAt: new Date().toISOString() }); save(); }
    log(`enrolled credential ${id.slice(0, 10)}… (${store.credentials.length} total)`);
    return { enrolled: true, count: store.credentials.length };
  }

  // ── unlock (every time: tap → Face ID → raise the flag) ──
  async function authOptions(ctx) {
    const { rpID } = ctx;
    if (!store.credentials.length) throw Object.assign(new Error("Set up Face ID unlock first."), { statusCode: 409 });
    const { generateAuthenticationOptions } = await lib();
    const opts = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: store.credentials.map((c) => ({ id: c.id })) });
    const challengeId = putChallenge("auth", opts.challenge);
    return { challengeId, options: opts };
  }
  async function authVerify(challengeId, response, ctx) {
    const { rpID, origin } = ctx;
    const { verifyAuthenticationResponse } = await lib();
    const rec = challenges.get(challengeId);
    if (!rec || rec.kind !== "auth") throw Object.assign(new Error("Unlock session expired — try again."), { statusCode: 400 });
    challenges.delete(challengeId);
    const cred = store.credentials.find((c) => c.id === response.id || c.id === response.rawId);
    if (!cred) throw Object.assign(new Error("This phone is not enrolled for unlock."), { statusCode: 403 });
    const verification = await verifyAuthenticationResponse({
      response, expectedChallenge: rec.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, "base64"), counter: cred.counter },
    });
    if (!verification.verified) throw Object.assign(new Error("Face ID did not match — unlock denied."), { statusCode: 403 });
    cred.counter = verification.authenticationInfo.newCounter; save();
    approvedUntil = Date.now() + APPROVAL_MS; lastApprovedAt = Date.now();
    log(`unlock APPROVED via Face ID (flag up for ${APPROVAL_MS / 1000}s)`);
    return { approved: true, expiresInMs: APPROVAL_MS };
  }

  // What the Credential Provider (step 2) will poll from the lock screen.
  function pending() { return { approved: Date.now() < approvedUntil, expiresInMs: Math.max(0, approvedUntil - Date.now()) }; }
  function consume() { const was = Date.now() < approvedUntil; approvedUntil = 0; return { consumed: was }; }
  function reset() { store = { credentials: [] }; save(); approvedUntil = 0; return { enrolled: false }; }

  return { state, enrollOptions, enrollVerify, authOptions, authVerify, pending, consume, reset };
}

module.exports = { createPcUnlock };
