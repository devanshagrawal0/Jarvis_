"use strict";

// The Instagram read dispatcher must NEVER throw (a failed read becomes a message, not an error) and
// must wire the tested parsers correctly. Driven by a FAKE page — no browser, no account.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runInstagramRead } = require("../../server/instagram/reads");

// A minimal stand-in for a Playwright page. evaluate() dispatches on the source of the passed
// function so the same fake serves the login check, the interstitial dismiss, and the row read.
function fakePage({ inboxRows = [], throwOnGoto = false, loggedOut = false } = {}) {
  return {
    async bringToFront() {},
    async goto() { if (throwOnGoto) throw new Error("nav failed"); },
    async waitForTimeout() {},
    url() { return "https://www.instagram.com/direct/inbox/"; },
    viewportSize() { return { width: 1440, height: 900 }; },
    mouse: { async move() {}, async click() {} },
    context() { return { pages: () => [] }; },
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('name="password"')) return loggedOut;   // isLoggedOut
      if (src.includes("not now")) return null;                // dismissInterstitials → nothing to close
      if (src.includes('role="button"')) return inboxRows;     // readInbox row scrape
      return null;
    },
  };
}

const REAL_ROWS = [
  { role: "button", name: "aj You: diagnostic timing test · 3h" },
  { role: "button", name: "Active Tg Tg sent an attachment. · 7h Unread" },
  { role: "button", name: "Raghav Mittal You: koi na · 22h" },
  { role: "button", name: "Your note" }, // a note carousel button — NOT a conversation
];

test("unknown action returns ok:false with guidance and never throws", async () => {
  const res = await runInstagramRead(fakePage(), { action: "bogus" });
  assert.equal(res.ok, false);
  assert.match(res.error, /Unknown Instagram read action/);
});

test("a page that throws mid-read is caught, not propagated", async () => {
  const res = await runInstagramRead(fakePage({ throwOnGoto: true }), { action: "inbox" });
  assert.equal(res.ok, false); // dispatcher swallowed the thrown nav error
  assert.equal(res.action, "inbox");
});

test("a signed-out page reports it instead of returning empty as if it worked", async () => {
  const res = await runInstagramRead(fakePage({ loggedOut: true }), { action: "inbox" });
  assert.equal(res.ok, false);
  assert.match(res.error, /signed out/i);
});

test("inbox parses only real conversations and counts unread correctly", async () => {
  const res = await runInstagramRead(fakePage({ inboxRows: REAL_ROWS }), { action: "inbox" });
  assert.equal(res.ok, true);
  assert.equal(res.count, 3);        // the "Your note" carousel row is excluded
  assert.equal(res.unreadCount, 1);  // exactly the "Unread" thread
  assert.ok(res.conversations.every((c) => !/Your note/.test(c.label)));
});

test("inbox honors the limit", async () => {
  const res = await runInstagramRead(fakePage({ inboxRows: REAL_ROWS }), { action: "inbox", limit: 1 });
  assert.equal(res.conversations.length, 1);
});
