"use strict";
// Wave 4: prove the progressive-scope provider WITHOUT touching real Google — a mock OAuth client
// lets us assert exactly which scopes each connect requests, that services report health from the
// granted set, that a legacy grant migrates, and that a missing scope degrades only its capability.
// Run: node --test tests/backend/google-provider.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { createGoogleProvider } = require("../../server/providers/google-provider");

function makeProvider(initialSettings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwave4-"));
  let settings = { googleClientId: "cid", googleClientSecret: "secret", webhookBaseUrl: "https://example.test", ...initialSettings };
  const getSettings = () => settings;
  const saveSettings = (patch) => { settings = { ...settings, ...patch }; };
  const captured = { authUrls: [] };
  const oauthClientFactory = () => ({
    setCredentials() {}, on() {},
    generateAuthUrl(opts) { const u = `https://accounts.google.com/auth?scope=${encodeURIComponent((opts.scope || []).join(" "))}&state=${opts.state}`; captured.authUrls.push({ scope: opts.scope, url: u }); return u; },
    async getToken() { return { tokens: { access_token: "at", refresh_token: "rt", scope: settings.googleScopes } }; },
    async getAccessToken() { return { token: "at" }; },
    async revokeToken() { return {}; },
  });
  const provider = createGoogleProvider({ runtimeDir: dir, getSettings, saveSettings, localBaseUrl: "https://example.test", fetchImpl: async () => ({ ok: true, json: async () => ({}) }), oauthClientFactory });
  return { provider, getSettings, saveSettings, captured };
}

test("connecting Gmail requests gmail scopes and NOT calendar", () => {
  const { provider, captured } = makeProvider();
  provider.start({ sessionId: "s1", bundles: ["gmail_send"] });
  const scopes = captured.authUrls.at(-1).scope;
  assert.ok(scopes.includes("https://www.googleapis.com/auth/gmail.send"));
  assert.ok(scopes.includes("openid") && scopes.includes("email"));
  assert.ok(!scopes.some((s) => s.includes("calendar")), "the gate: Gmail connect must not request Calendar");
});

test("connecting Calendar requests calendar scopes and NOT gmail", () => {
  const { provider, captured } = makeProvider();
  const res = provider.start({ sessionId: "s2", bundles: ["calendar_read"] });
  const scopes = captured.authUrls.at(-1).scope;
  assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.readonly"));
  assert.ok(!scopes.some((s) => s.includes("gmail")), "the gate: Calendar connect must not request Gmail");
  assert.ok(Array.isArray(res.explanations) && res.explanations.length, "owner-facing scope explanations are returned");
});

test("no bundles => legacy Gmail-only behaviour (back-compat)", () => {
  const { provider, captured } = makeProvider();
  provider.start({ sessionId: "s3", bundles: [] });
  const scopes = captured.authUrls.at(-1).scope;
  assert.ok(scopes.some((s) => s.includes("gmail")));
  assert.ok(!scopes.some((s) => s.includes("calendar")));
});

test("status reports per-service health and migrates a legacy grant", () => {
  const granted = "openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send";
  const { provider } = makeProvider({ googleAccessToken: "at", googleScopes: granted });
  const st = provider.status();
  assert.equal(st.services.gmail.connected, true);
  assert.equal(st.services.calendar.connected, false);
  assert.deepEqual(st.grantedBundles, ["gmail_send"]);
  assert.ok(Array.isArray(st.catalog) && st.catalog.length >= 4, "catalog of connectable capabilities present");
});

test("a missing scope degrades only its capability (send blocked, others fine)", async () => {
  // connected, but only calendar.readonly granted -> Gmail send must fail cleanly (412), not 403
  const { provider } = makeProvider({ googleAccessToken: "at", googleScopes: "openid email https://www.googleapis.com/auth/calendar.readonly" });
  await assert.rejects(
    () => provider.sendEmail({ recipient: "a@b.com", subject: "hi", body: "x" }),
    (e) => e.statusCode === 412 && /email sending/i.test(e.message),
    "sending without the gmail scope degrades to a clean 412",
  );
  assert.equal(provider.status().services.calendar.connected, true, "calendar stays connected");
});
