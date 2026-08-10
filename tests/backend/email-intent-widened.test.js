"use strict";
// A real recipient address is an unambiguous email signal, so "fire off a note to sam@x.com" routes
// to the deterministic gmail lane (which is what forcing keys on) even without the word "email".
// A bare "message/ping <name>" is NOT email (ambiguous channel) and must not route here.
// Run: node --test tests/backend/email-intent-widened.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { emailIntent, routeExecutionLane } = require("../../server/automation/execution-lane-router");
const CONNECTED = { googleRefreshToken: "tok" };

test("an address + send verb is email intent even without the word 'email'", () => {
  const e = emailIntent("fire off a note to sam@x.com saying hi");
  assert.equal(e?.requested, true);
  assert.equal(e.recipientEmail, "sam@x.com");
  assert.equal(e.commit, true);
});

test("'fire it off' / 'send it off' (with pronoun) still counts as a commit send", () => {
  assert.equal(emailIntent("compose a note to a@b.com and fire it off").commit, true);
  assert.equal(emailIntent("draft to a@b.com then send it off").commit, true);
});

test("address-recipient email routes to the connector-google lane with gmail tools", () => {
  const lane = routeExecutionLane("shoot a quick note to bob@corp.com about the invoice", CONNECTED);
  assert.equal(lane.lane, "connector-google");
  assert.deepEqual(lane.tools, ["gmail_prepare_email", "gmail_send_prepared"]);
});

test("does NOT misfire on non-email commands", () => {
  assert.equal(emailIntent("write a report about sales"), null);
  assert.equal(emailIntent("message tg hi"), null);       // bare message + name = ambiguous channel, not email
  assert.equal(emailIntent("remind me to call mom"), null);
  assert.equal(emailIntent("what is the weather today"), null);
});

test("the explicit 'email' word still works with no address (name recipient)", () => {
  // has the word 'email' + a send verb → requested; no address so the connector lane needs a name resolve
  const e = emailIntent("send an email to my professor");
  assert.equal(e?.requested, true);
  assert.equal(e.recipientEmail, null);
});
