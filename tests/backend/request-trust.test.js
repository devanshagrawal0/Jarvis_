const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createRequestTrust } = require("../../server/request-trust");

function request({ address = "127.0.0.1", host = "localhost:8799", method = "GET", headers = {} } = {}) {
  return { method, socket: { remoteAddress: address }, headers: { host, ...headers } };
}

test("remote socket cannot become owner by spoofing Host localhost", () => {
  const trust = createRequestTrust();
  const req = request({ address: "192.168.1.44", host: "localhost:8799" });
  assert.equal(trust.isDirectOwnerRequest(req), false);
  assert.equal(trust.principalFor(req, "/api/settings", ""), null);
});

test("direct loopback socket and host are recognized as owner", () => {
  const trust = createRequestTrust();
  const principal = trust.principalFor(request(), "/api/settings", "");
  assert.deepEqual(principal, { kind: "local-owner", id: "local-owner", trustLevel: "owner" });
});

test("signed relay assertion is method/path bound and single use", () => {
  const secret = "test-relay-secret";
  const trust = createRequestTrust({ relaySecret: secret });
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const canonical = `POST\n/api/chat/stream?mode=deep\n${timestamp}\n${nonce}`;
  const signature = crypto.createHmac("sha256", secret).update(canonical).digest("base64url");
  const req = request({
    address: "127.0.0.1",
    host: "relay.trycloudflare.com",
    method: "POST",
    headers: {
      "x-jarvis-relay-timestamp": timestamp,
      "x-jarvis-relay-nonce": nonce,
      "x-jarvis-relay-signature": signature,
    },
  });
  assert.equal(trust.principalFor(req, "/api/chat/stream", "?mode=deep")?.kind, "relay");
  assert.equal(trust.principalFor(req, "/api/chat/stream", "?mode=deep"), null);
});

test("only health and pairing bootstrap routes are public", () => {
  const trust = createRequestTrust();
  assert.equal(trust.isPublicApi(request(), "/api/health"), true);
  assert.equal(trust.isPublicApi(request({ method: "POST" }), "/api/pair"), true);
  assert.equal(trust.isPublicApi(request(), "/api/pair/status"), true);
  assert.equal(trust.isPublicApi(request(), "/api/chat/stream"), false);
  assert.equal(trust.isPublicApi(request({ method: "POST" }), "/api/capabilities/execute"), false);
});
