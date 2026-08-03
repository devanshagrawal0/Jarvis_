"use strict";

// C-04 — `cloudflared --url http://localhost:8799` runs with no `--http-host-header`, so every
// public request reaches this server FROM 127.0.0.1. The loopback term in `isDirectOwnerRequest`
// is therefore satisfied for internet traffic, and the entire separation between the public
// internet and full `local-owner` authority was the client-supplied `Host` string.

const test = require("node:test");
const assert = require("node:assert/strict");
const { isDirectOwnerRequest } = require("../../server/request-trust");

const req = (headers = {}, remoteAddress = "127.0.0.1") => ({ headers: { host: "localhost:8799", ...headers }, socket: { remoteAddress } });

test("C-04 — the owner's own browser is still trusted", () => {
  assert.equal(isDirectOwnerRequest(req()), true);
  assert.equal(isDirectOwnerRequest(req({ host: "127.0.0.1:8799" })), true);
  assert.equal(isDirectOwnerRequest(req({}, "::1")), true);
});

test("C-04 — a tunnelled request spoofing Host: localhost is no longer direct owner", () => {
  // This is the exact shape the finding measured: loopback source, forged Host, real traffic.
  assert.equal(isDirectOwnerRequest(req({ "cf-connecting-ip": "203.0.113.7" })), false);
  assert.equal(isDirectOwnerRequest(req({ "cf-ray": "8b2c1f0e4a9d0000-LHR" })), false);
  assert.equal(isDirectOwnerRequest(req({ "x-forwarded-for": "203.0.113.7" })), false);
  assert.equal(isDirectOwnerRequest(req({ via: "1.1 cloudflare" })), false);
});

test("C-04 — an empty forwarded header is not treated as a proxy marker", () => {
  // Otherwise a client could deny itself owner trust by sending a blank header, and more to the
  // point an accidental empty header on a local tool would lock the owner out of their own box.
  assert.equal(isDirectOwnerRequest(req({ "x-forwarded-for": "" })), true);
  assert.equal(isDirectOwnerRequest(req({ "x-forwarded-for": "   " })), true);
});

test("C-04 — the pre-existing terms still hold", () => {
  assert.equal(isDirectOwnerRequest(req({}, "203.0.113.7")), false, "non-loopback source");
  assert.equal(isDirectOwnerRequest(req({ host: "example.com" })), false, "non-loopback Host");
  assert.equal(isDirectOwnerRequest(req({ "x-jarvis-relay-signature": "sig" })), false, "relayed");
});
