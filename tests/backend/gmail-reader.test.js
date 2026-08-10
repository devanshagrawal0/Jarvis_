"use strict";
// Fix 4: the Gmail message parser must pull sender/subject/date/body out of real Gmail API payloads —
// base64url plain-text bodies, nested multipart (plain preferred over html), html-only fallback — and
// the reader must fetch a bounded number of messages and summarize them offline-safely (no key ⇒
// heuristic, never a throw). Pure parser is fully unit-tested with fixtures; the live fetch/summary is
// exercised with a fake provider so no network is needed.
// Run: node --test tests/backend/gmail-reader.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { parseGmailMessage, extractBody, parseFrom, createGmailReader } = require("../../server/gmail-reader");

const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");

function msg({ id = "m1", from = "Priya Rao <priya@work.com>", subject = "Re: launch", date = "Mon, 11 Aug 2026 09:00:00 -0400", snippet = "quick question", unread = true, payload }) {
  return { id, threadId: `t-${id}`, snippet, labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"], payload };
}

test("parses a simple text/plain message", () => {
  const m = parseGmailMessage(msg({
    payload: { mimeType: "text/plain", headers: [
      { name: "From", value: "Priya Rao <priya@work.com>" },
      { name: "Subject", value: "Re: launch" },
      { name: "Date", value: "Mon, 11 Aug 2026 09:00:00 -0400" },
    ], body: { data: b64url("Hi — can you confirm the launch time?\n\nThanks,\nPriya") } },
  }));
  assert.equal(m.fromName, "Priya Rao");
  assert.equal(m.fromEmail, "priya@work.com");
  assert.equal(m.subject, "Re: launch");
  assert.equal(m.unread, true);
  assert.match(m.body, /confirm the launch time/);
});

test("prefers text/plain over text/html in a multipart/alternative", () => {
  const m = parseGmailMessage(msg({
    payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "hi" }], parts: [
      { mimeType: "text/plain", body: { data: b64url("PLAIN body wins") } },
      { mimeType: "text/html", body: { data: b64url("<p>HTML body loses</p>") } },
    ] },
  }));
  assert.equal(m.body, "PLAIN body wins");
  assert.equal(m.fromEmail, "a@b.com"); // bare address, no display name
  assert.equal(m.fromName, "");
});

test("falls back to stripped html when there is no plain part (nested multipart/mixed)", () => {
  const m = parseGmailMessage(msg({
    payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: "News <news@site.com>" }], parts: [
      { mimeType: "multipart/alternative", parts: [
        { mimeType: "text/html", body: { data: b64url("<div>Line one</div><div>Line two &amp; more</div><script>bad()</script>") } },
      ] },
      { mimeType: "application/pdf", filename: "a.pdf", body: { attachmentId: "x" } },
    ] },
  }));
  assert.match(m.body, /Line one/);
  assert.match(m.body, /Line two & more/);
  assert.doesNotMatch(m.body, /bad\(\)/);   // script stripped
  assert.doesNotMatch(m.body, /</);          // no tags survive
});

test("parseFrom handles the common address shapes", () => {
  assert.deepEqual(parseFrom('"Doe, John" <john@x.com>'), { name: "Doe, John", email: "john@x.com" });
  assert.deepEqual(parseFrom("bare@x.com"), { name: "", email: "bare@x.com" });
  assert.deepEqual(parseFrom("Just A Name"), { name: "Just A Name", email: "" });
});

test("empty / malformed payloads never throw", () => {
  assert.equal(extractBody(undefined), "");
  assert.equal(parseGmailMessage(null).body, "");
  assert.equal(parseGmailMessage({}).subject, "");
});

test("listRecent fetches a bounded set and summarizeInbox degrades to a heuristic with no key", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const store = {
      a: msg({ id: "a", from: "Priya <priya@work.com>", subject: "Re: launch", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Priya <priya@work.com>" }, { name: "Subject", value: "Re: launch" }], body: { data: b64url("confirm time?") } } }),
      b: msg({ id: "b", from: "Sam <sam@x.com>", subject: "invoice", payload: { mimeType: "text/plain", headers: [{ name: "From", value: "Sam <sam@x.com>" }, { name: "Subject", value: "invoice" }], body: { data: b64url("please pay") } } }),
    };
    let listCalledWith = null;
    const provider = {
      async listMessages(args) { listCalledWith = args; return { messages: [{ id: "a" }, { id: "b" }] }; },
      async getMessage(id) { return store[id]; },
    };
    const reader = createGmailReader({ provider, getSettings: () => ({}) });

    const recent = await reader.listRecent({ unreadOnly: true, max: 2 });
    assert.equal(recent.length, 2);
    assert.match(listCalledWith.query, /is:unread/);
    assert.equal(recent[0].fromEmail, "priya@work.com");

    const sum = await reader.summarizeInbox({ unreadOnly: true, max: 2 });
    assert.equal(sum.count, 2);
    assert.equal(sum.items.length, 2);
    assert.equal(sum.items.every((i) => i.needsReply === false), true); // heuristic never guesses "needs reply"
    assert.match(sum.overview, /2 messages/);
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test("summarizeInbox reports an empty inbox honestly", async () => {
  const provider = { async listMessages() { return { messages: [] }; }, async getMessage() { throw new Error("should not be called"); } };
  const reader = createGmailReader({ provider, getSettings: () => ({}) });
  const sum = await reader.summarizeInbox({ unreadOnly: true });
  assert.equal(sum.count, 0);
  assert.match(sum.overview, /No unread email/);
});
