"use strict";
// Wave 4 correctness: the progressive scope model must let an owner connect ONE service without
// granting others, derive per-service health only from granted scopes, and migrate a legacy Gmail
// grant with zero re-consent. Run: node --test tests/backend/google-scopes.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const S = require("../../server/providers/google-scopes");

test("scopesForBundles always includes identity and only the requested capability", () => {
  const gmail = S.scopesForBundles(["gmail_send"]);
  assert.ok(gmail.includes("openid") && gmail.includes("email"), "identity always present");
  assert.ok(gmail.includes("https://www.googleapis.com/auth/gmail.send"));
  assert.ok(!gmail.some((s) => s.includes("calendar")), "Gmail bundle must NOT include calendar (the gate)");
});

test("connecting Calendar does not drag in Gmail scopes", () => {
  const cal = S.scopesForBundles(["calendar_read"]);
  assert.ok(cal.includes("https://www.googleapis.com/auth/calendar.readonly"));
  assert.ok(!cal.some((s) => s.includes("gmail")), "Calendar bundle must NOT include gmail");
});

test("serviceHealth derives per-service state from granted scopes only", () => {
  const gmailOnly = S.serviceHealth("openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send");
  assert.equal(gmailOnly.gmail.connected, true);
  assert.equal(gmailOnly.gmail.canSend, true);
  assert.equal(gmailOnly.calendar.connected, false, "no calendar scope => calendar not connected");

  const both = S.serviceHealth("openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.readonly");
  assert.equal(both.gmail.connected, true);
  assert.equal(both.calendar.connected, true);
  assert.equal(both.calendar.canWrite, false, "readonly grant is not write");
});

test("a revoked scope degrades only its own capability", () => {
  // had send+calendar; calendar scope revoked -> gmail still fine, calendar off
  const afterRevoke = S.serviceHealth("openid email https://www.googleapis.com/auth/gmail.send");
  assert.equal(afterRevoke.gmail.canSend, true);
  assert.equal(afterRevoke.calendar.connected, false);
});

test("grants() gates a capability by its exact bundle scopes", () => {
  const granted = "openid email https://www.googleapis.com/auth/calendar.readonly";
  assert.equal(S.grants(granted, "calendar_read"), true);
  assert.equal(S.grants(granted, "calendar_write"), false);
  assert.equal(S.grants(granted, "gmail_send"), false);
});

test("legacy Gmail grant migrates to the gmail_send bundle with no re-consent", () => {
  const legacy = "openid email https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send";
  assert.deepEqual(S.bundlesFromGranted(legacy), ["gmail_send"]);
});

test("explainScopes gives a plain-English reason for every scope", () => {
  const ex = S.explainScopes("openid https://www.googleapis.com/auth/calendar.readonly");
  assert.equal(ex.length, 2);
  assert.ok(ex.every((e) => e.title && typeof e.why === "string"));
  assert.ok(ex.find((e) => e.scope.includes("calendar")).title.length > 0);
});
