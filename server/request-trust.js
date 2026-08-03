const crypto = require("crypto");

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const PUBLIC_API_RULES = [
  { method: "GET", path: "/api/health" },
  { method: "POST", path: "/api/pair" },
  { method: "GET", path: "/api/pair/status" },
  { method: "GET", path: "/api/mesh/push/vapid-public-key" },
];

function hostnameFromRequest(req) {
  const host = String(req.headers.host || "").trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

function normalizedRemoteAddress(req) {
  const address = String(req.socket?.remoteAddress || "").trim().toLowerCase();
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopbackAddress(address) {
  return LOOPBACK_HOSTS.has(address);
}

// C-04 — headers a proxy adds on the way in. `cloudflared --url http://localhost:8799` runs with
// no `--http-host-header`, so EVERY public request reaches this server from 127.0.0.1: the
// loopback term is satisfied for internet traffic, and the whole separation between the public
// internet and full `local-owner` authority was the client-supplied `Host` string. These are a
// second, independent signal — a genuine loopback request from the owner's own browser carries
// none of them; a request that arrives through the tunnel carries at least one.
//
// This is defence in depth, not a new primary boundary: a header the client controls cannot be
// trusted to be ABSENT any more than to be present. What it buys is that spoofing
// `Host: localhost` is no longer sufficient on its own — the attacker must also suppress headers
// the tunnel adds after their request has left them, which they do not control.
const FORWARDED_HEADERS = [
  "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cf-visitor", "cf-warp-tag-id",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
  "forwarded", "via",
];

function arrivedViaProxy(req) {
  return FORWARDED_HEADERS.some((name) => String(req?.headers?.[name] || "").trim());
}

function isDirectOwnerRequest(req) {
  return isLoopbackAddress(normalizedRemoteAddress(req))
    && LOOPBACK_HOSTS.has(hostnameFromRequest(req))
    && !req.headers["x-jarvis-relay-signature"]
    && !arrivedViaProxy(req);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function createRequestTrust({ relaySecret = "", deviceFromBearer, maxRelayAgeMs = 60_000 } = {}) {
  const usedRelayNonces = new Map();

  function pruneRelayNonces(now) {
    for (const [nonce, expiresAt] of usedRelayNonces) {
      if (expiresAt <= now) usedRelayNonces.delete(nonce);
    }
  }

  function verifyRelay(req, pathname, search = "") {
    if (!relaySecret) return null;
    const timestamp = String(req.headers["x-jarvis-relay-timestamp"] || "");
    const nonce = String(req.headers["x-jarvis-relay-nonce"] || "");
    const supplied = String(req.headers["x-jarvis-relay-signature"] || "");
    const timestampMs = Number(timestamp);
    const now = Date.now();
    if (!nonce || nonce.length > 160 || !Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxRelayAgeMs) return null;
    pruneRelayNonces(now);
    if (usedRelayNonces.has(nonce)) return null;
    const canonical = `${String(req.method || "GET").toUpperCase()}\n${pathname}${search}\n${timestamp}\n${nonce}`;
    const expected = crypto.createHmac("sha256", relaySecret).update(canonical).digest("base64url");
    if (!safeEqual(expected, supplied)) return null;
    usedRelayNonces.set(nonce, now + maxRelayAgeMs);
    return { kind: "relay", id: "cloudflare-owner-relay", trustLevel: "owner" };
  }

  function principalFor(req, pathname, search = "") {
    if (isDirectOwnerRequest(req)) return { kind: "local-owner", id: "local-owner", trustLevel: "owner" };
    const relay = verifyRelay(req, pathname, search);
    if (relay) return relay;
    const device = typeof deviceFromBearer === "function" ? deviceFromBearer(req) : null;
    if (device) return { kind: "paired-device", id: device.id, trustLevel: device.trustLevel || "paired", device };
    return null;
  }

  function isPublicApi(req, pathname) {
    if (req.method === "OPTIONS") return true;
    return PUBLIC_API_RULES.some((rule) => rule.method === req.method && rule.path === pathname);
  }

  return { hostnameFromRequest, normalizedRemoteAddress, isDirectOwnerRequest, principalFor, isPublicApi };
}

module.exports = { createRequestTrust, isDirectOwnerRequest, hostnameFromRequest, normalizedRemoteAddress };
