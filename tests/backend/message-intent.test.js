"use strict";
// Fix 2: the client-side "send a message/email to someone" detector must fire on many phrasings that
// never say the word "email", and must NOT fire on report-writing, reminders, inbox reads, or other
// channels. Tested over a wide, adversarial matrix — no cherry-picked single example.
// Run: node --test tests/backend/message-intent.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { detectMessageIntent, detectInboxRead, detectCalendarCommand } = require("../../src/lib/messageIntent");

function fires(text, expectRecipient) {
  const r = detectMessageIntent(text);
  assert.ok(r, `expected FIRE for: ${text}`);
  if (expectRecipient !== undefined) {
    assert.equal(r.recipient.toLowerCase(), expectRecipient.toLowerCase(), `wrong recipient for: ${text}`);
  }
}
function silent(text) {
  assert.equal(detectMessageIntent(text), null, `expected NO fire for: ${text}`);
}

test("fires without the word 'email' — direct 'verb <name> a note/line' form", () => {
  fires("shoot AJ a note that the deploy passed", "AJ");
  fires("drop Bob a line about the invoice", "Bob");
  fires("send priya a quick update on the launch", "priya");
  fires("write mom a message saying I'll be late", "mom");
  fires("fire off Dad a note that I landed safe", "Dad");
});

test("fires on 'verb ... to <name> <content>'", () => {
  fires("send this to mom saying I'll be late", "mom");
  fires("fire off an update to Priya about the launch", "Priya");
  fires("forward that to john@work.com", "john@work.com");
  fires("drop a line to Sam about tomorrow", "Sam");
});

test("fires on a raw address + any send cue", () => {
  fires("send hi to a@b.com", "a@b.com");
  fires("shoot a note to bob@corp.com about the invoice", "bob@corp.com");
  fires("mail sarah.k@example.org the agenda", "sarah.k@example.org");
});

test("still fires on the explicit 'email' phrasings (regression)", () => {
  fires("email AJ saying hi", "AJ");
  fires("send AJ an email telling him the automation works", "AJ");
  fires("send an email to my professor", "my professor"); // recipient guess passed to backend to resolve
  fires("email me the summary", "me");
});

test("fires on pronoun direct 'tell him/her/them <content>'", () => {
  fires("tell him the automation works", "him");
  fires("let her know I'll be 10 minutes late", "her");
  fires("remind them the meeting moved to 3", "them");
});

test("does NOT fire on report-writing / non-message 'send'/'write'", () => {
  silent("write a report about sales");
  silent("write a function that sorts the list");
  silent("send me the weather");
  silent("can you send me the current price of AAPL");
  silent("compose a poem about autumn");
  silent("draft a plan for the migration");
});

test("does NOT fire on inanimate 'to <thing>' targets", () => {
  silent("send the file to the printer");
  silent("send the report to the list");
  silent("write the results to the server");
  silent("forward the request to the inbox");
});

test("does NOT fire on reminders / captures", () => {
  silent("remind me to call mom");
  silent("remind me to send the report tomorrow");
  silent("add a task to email the team later"); // capture-shaped; no direct recipient/verb pattern
});

test("does NOT fire on inbox reads", () => {
  silent("check my inbox");
  silent("summarize my unread emails");
  silent("what's new in my mail");
  silent("read my latest emails");
});

test("does NOT fire on other channels", () => {
  silent("message tg hi");
  silent("send AJ a DM on instagram");
  silent("shoot Bob a whatsapp");
  silent("text mom that I'm on my way");
  silent("post a tweet about the launch");
});

test("empty / junk input is silent", () => {
  silent("");
  silent("   ");
  silent("hello there");
  silent("what is 17 times 23");
});

test("detectInboxRead fires on inbox-triage phrasings", () => {
  for (const t of [
    "check my inbox",
    "summarize my unread emails",
    "what's new in my mail",
    "read my latest emails",
    "go through my inbox",
    "what do I need to reply to",
    "which emails need a reply",
    "any replies I owe",
  ]) {
    assert.ok(detectInboxRead(t), `should read inbox: ${t}`);
  }
});

test("detectInboxRead stays silent on sends and unrelated asks", () => {
  for (const t of [
    "email Bob the agenda",
    "shoot AJ a note that it works",
    "reply to Priya saying hi",   // an actual send, not triage
    "what is the weather",
    "remind me to call mom",
    "send this to mom saying I'll be late",
  ]) {
    assert.equal(detectInboxRead(t), null, `should NOT read inbox: ${t}`);
  }
});

test("inbox-read requests are not mistaken for sends (detectMessageIntent stays silent)", () => {
  for (const t of ["check my inbox", "summarize my unread emails", "what do I need to reply to"]) {
    assert.equal(detectMessageIntent(t), null, `send-detector must ignore inbox read: ${t}`);
  }
});

test("detectCalendarCommand gates create / move / cancel", () => {
  for (const t of [
    "schedule lunch tomorrow at 1",
    "book dentist friday 2pm",
    "move my 3pm to 4pm",
    "reschedule standup to tomorrow 10am",
    "cancel my 3pm meeting",
    "delete the standup",
    "add a meeting monday at 9",
    "lunch with Sam tomorrow at noon",
  ]) {
    assert.ok(detectCalendarCommand(t), `should gate as calendar write: ${t}`);
  }
});

test("detectCalendarCommand ignores reminders, reads, and non-calendar commands", () => {
  for (const t of [
    "remind me to call mom at 5",
    "add a task to email Bob",
    "what's on my calendar",
    "when is my next meeting",
    "cancel my subscription",
    "send AJ a note that it works",
    "what is the weather",
  ]) {
    assert.equal(detectCalendarCommand(t), null, `should NOT gate as calendar write: ${t}`);
  }
});
