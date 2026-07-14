// Synapse (Co-Op) W2 — transport & security primitives for cross-machine collaboration.
// Host-as-server model: a remote guest reaches the host over its public tunnel URL, so these
// helpers harden that path — real client IP (behind the tunnel), a code-proof HMAC, ephemeral
// TURN credentials, a rendezvous registry, and an egress secret scan. CommonJS, pure, testable.
// (The Noise XX E2E handshake that consumes code-proof + host fingerprint lands in W3.)

const crypto = require("crypto");

// Rate-limit budgets for join attempts (per 60s window).
const RATE = { perCodePerMin: 8, perIpPerMin: 20, globalPerMin: 100 };

// TURN config comes from env/secretStore; a per-process secret is the dev fallback so minted
// credentials are always well-formed even before a real TURN server is configured (W4).
const TURN_SECRET = process.env.COOP_TURN_SECRET || crypto.randomBytes(24).toString("hex");
const TURN_URLS = (process.env.COOP_TURN_URLS || "stun:stun.l.google.com:19302")
  .split(",").map((s) => s.trim()).filter(Boolean);

function cleanCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 6);
}

// Real client IP. Behind the Cloudflare tunnel the socket peer is the tunnel, so prefer the
// forwarded headers it sets; fall back to the raw socket address. Header trust is gated by
// trustProxy (true in production where the origin is only reachable via the tunnel/LAN).
function clientIp(req, { trustProxy = true } = {}) {
  const norm = (ip) => String(ip || "").replace(/^::ffff:/, "").trim();
  if (trustProxy && req && req.headers) {
    const cf = req.headers["cf-connecting-ip"];
    if (cf) return norm(Array.isArray(cf) ? cf[0] : cf);
    const xff = req.headers["x-forwarded-for"];
    if (xff) return norm(String(Array.isArray(xff) ? xff[0] : xff).split(",")[0]);
  }
  return norm(req?.socket?.remoteAddress || req?.connection?.remoteAddress || "");
}

// Non-secret per-session salt, published in the invite. The code proof is HMAC(salt, code) so
// the raw code need not appear in logs/handshake payloads (W3 confirms it inside Noise).
function makeCodeSalt() {
  return crypto.randomBytes(9).toString("hex");
}
function codeProof(salt, code) {
  return crypto.createHmac("sha256", String(salt || "")).update(cleanCode(code)).digest("hex");
}
function verifyCodeProof(salt, code, proof) {
  const expected = codeProof(salt, code);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(proof || ""), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Host identity fingerprint shown to the guest for out-of-band verification. In W2 this is a
// random per-session id; W3 replaces it with the real Noise X25519 static-key fingerprint.
function hostFingerprint() {
  return crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex").slice(0, 32);
}

// Ephemeral, time-limited TURN credentials (coturn/IETF REST convention:
// username = <unixExpiry>:<sessionId>, credential = base64(HMAC-SHA1(secret, username))).
function mintTurnCredentials({ sessionId, ttlSec = 3600, secret = TURN_SECRET, urls = TURN_URLS } = {}) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSec;
  const username = `${expiry}:${sessionId || "coop"}`;
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return { username, credential, ttl: ttlSec, urls, expiresAt: new Date(expiry * 1000).toISOString() };
}

// Deep egress scan: reject a payload leaving toward the peer if any string field looks like a
// secret. Pairs with the file/patch scanner so chat/skill/memory payloads can't leak a key.
const SECRET_PATTERNS = [
  /AIzaSy[0-9A-Za-z_-]{25,}/,
  /sk-[0-9A-Za-z_-]{25,}/,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----/,
  /\bAC[a-fA-F0-9]{32}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(?:access|refresh|auth|api|secret|private)[_-]?(?:token|key|secret)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{18,}/i,
];
function egressScan(value, depth = 0) {
  if (depth > 6 || value == null) return { ok: true, reason: "" };
  if (typeof value === "string") {
    const hit = SECRET_PATTERNS.find((p) => p.test(value));
    return hit ? { ok: false, reason: "Secret-like content blocked from co-op egress." } : { ok: true, reason: "" };
  }
  if (Array.isArray(value)) {
    for (const item of value) { const r = egressScan(item, depth + 1); if (!r.ok) return r; }
    return { ok: true, reason: "" };
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) { const r = egressScan(v, depth + 1); if (!r.ok) return r; }
    return { ok: true, reason: "" };
  }
  return { ok: true, reason: "" };
}

// ---- W3: real E2E identity (X25519) + safety numbers + authenticated key agreement ----
// Node has native X25519, so no new dependency. The browser handshake (W4) uses Web Crypto.

function newHostIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const pub = publicKey.export({ type: "spki", format: "pem" });
  const priv = privateKey.export({ type: "pkcs8", format: "pem" });
  return { publicKey: pub, privateKey: priv, fingerprint: keyFingerprint(pub) };
}
function newIdentity() { return newHostIdentity(); } // symmetric — guests use the same shape
// Fingerprint over the DER (SPKI) key bytes when given a real public key, so node and the browser
// (Web Crypto exportKey "spki") derive the SAME fingerprint. Non-key strings hash as-is (fallback).
function keyFingerprint(pubKey) {
  const s = String(pubKey || "");
  let material = s;
  if (s.includes("BEGIN")) { try { material = crypto.createPublicKey(s).export({ type: "spki", format: "der" }); } catch { material = s; } }
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 32);
}

// Signal-style safety number: deterministic from BOTH static-key fingerprints, order-independent,
// so the two humans read the same digits to confirm no MITM.
function safetyNumber(fpA, fpB) {
  const [a, b] = [String(fpA || ""), String(fpB || "")].sort();
  const h = crypto.createHash("sha256").update(`${a}:${b}`).digest();
  let digits = "";
  for (let i = 0; i < 12; i++) digits += (h[i] % 10).toString();
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

function dh(privPem, pubPem) {
  return crypto.diffieHellman({ privateKey: crypto.createPrivateKey(privPem), publicKey: crypto.createPublicKey(pubPem) });
}

// Noise-XX-style triple-DH: mixes both static keys (mutual auth) and both ephemeral keys (forward
// secrecy). Both parties derive the SAME key regardless of role — the two role-asymmetric cross
// terms are combined in canonical (sorted) order so host and guest agree.
function deriveSessionKey({ selfStaticPriv, selfEphPriv, peerStaticPub, peerEphPub }) {
  const ss = dh(selfStaticPriv, peerStaticPub);
  const ee = dh(selfEphPriv, peerEphPub);
  const x1 = dh(selfStaticPriv, peerEphPub).toString("hex");
  const x2 = dh(selfEphPriv, peerStaticPub).toString("hex");
  const [c1, c2] = [x1, x2].sort();
  return crypto.createHash("sha256")
    .update(Buffer.concat([ee, Buffer.from(c1, "hex"), Buffer.from(c2, "hex"), ss]))
    .digest("hex");
}

// Host-signed resume token (§2.5): lets a guest reconnect after a host restart / tunnel flap
// WITHOUT a second human approval, within a short window. Single-use rotation happens on the route.
function issueResumeToken({ secret, sessionId, guestFp = "", ttlSec = 1800 }) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${sessionId}.${guestFp}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}
function verifyResumeToken(token, { secret, sessionId, guestFp = "" }) {
  try {
    const [b64, sig] = String(token || "").split(".");
    // SHA-256 HMAC = exactly 64 hex chars. Enforce the format so trailing junk on the signature
    // can't be silently truncated by the hex decoder into a matching value.
    if (!/^[0-9a-f]{64}$/i.test(sig || "")) return { ok: false, reason: "bad signature" };
    const body = Buffer.from(b64 || "", "base64url").toString();
    const [sid, fp, expStr] = body.split(".");
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "bad signature" };
    if (sid !== sessionId) return { ok: false, reason: "session mismatch" };
    if (guestFp && fp !== guestFp) return { ok: false, reason: "peer mismatch" };
    if (Number(expStr) * 1000 < Date.now()) return { ok: false, reason: "expired" };
    return { ok: true };
  } catch { return { ok: false, reason: "malformed" }; }
}

// In-memory rendezvous registry: codeHash → { sessionId, baseUrl, hostFp }. For host-as-server
// this mirrors the session store; a third-party relay (fallback) would back it out-of-process.
function createRendezvous() {
  const map = new Map();
  return {
    publish(codeHash, entry) { map.set(codeHash, { ...entry, publishedAt: Date.now() }); },
    resolve(codeHash) { return map.get(codeHash) || null; },
    remove(codeHash) { map.delete(codeHash); },
    setBaseUrl(baseUrl) { for (const e of map.values()) e.baseUrl = baseUrl; },
    size() { return map.size; },
  };
}

module.exports = {
  RATE,
  cleanCode,
  clientIp,
  makeCodeSalt,
  codeProof,
  verifyCodeProof,
  hostFingerprint,
  mintTurnCredentials,
  egressScan,
  createRendezvous,
  newHostIdentity,
  newIdentity,
  keyFingerprint,
  safetyNumber,
  deriveSessionKey,
  issueResumeToken,
  verifyResumeToken,
};
