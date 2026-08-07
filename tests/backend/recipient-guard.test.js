"use strict";

// The four messages that went to the wrong conversation.
//
// The owner asked for a message to one person. The agent opened a GROUP thread and sent into it
// four times across three runs, and the fourth time it did so from a thread URL that had been saved
// against that person's contact. Every layer agreed the send succeeded, because every layer was
// checking that the message appeared on the page — not who was going to read it.
//
// The page text below is not invented. It is the observation the agent itself recorded on the run
// that sent "jarvis fast test", lifted verbatim from the run record, with the owner's contacts and
// group renamed. If the guard passes on this text, it would have stopped the send that happened.

const test = require("node:test");
const assert = require("node:assert/strict");

const { readAudience, recipientSummary, refusalFor, handleFromHref, titleBeforePresence } = require("../../server/automation/recipient-guard");

// Verbatim shape of the recorded observation: the inbox list down the side, then the OPEN
// conversation followed by its presence line. The open one is the group.
const GROUP_THREAD_PAGE = [
  "Messages Requests",
  "group name here You: jarvis test fifteen · 26m",
  "aj You: uncle it's important automation is really improving · 40m",
  "Contact One You: jarvis test eight · 2h",
  "Contact Two You: koi na · 3h",
  "Contact Three Active 19m ago",
  "group name here 3 active today",
  "Jan 23, 2026, 8:30 PM jarvis test thirteen jarvis test fourteen jarvis test fifteen jarvis fast test",
].join(" ");

const DIRECT_THREAD_PAGE = [
  "Messages Requests",
  "group name here You: jarvis test fifteen · 26m",
  "aj You: uncle it's important automation is really improving · 40m",
  "aj Active now",
  "Jan 23, 2026, 8:30 PM hey",
].join(" ");

test("the group that was actually messaged is recognised as a group", () => {
  const audience = readAudience({ pageText: GROUP_THREAD_PAGE });
  assert.equal(audience.kind, "group");
  assert.equal(audience.participantCount, 3, "the page states the participant count outright");
});

test("and a send addressed to one person is refused on it", () => {
  // The whole point. This exact call, on this exact page text, is the send that happened.
  const audience = readAudience({ pageText: GROUP_THREAD_PAGE });
  const refusal = refusalFor({ audience, intendedHandle: "aj.example" });
  assert.ok(refusal, "a one-person message must not be sendable into a group");
  assert.match(refusal, /group/i);
  assert.match(refusal, /everyone/i, "the owner must be told what sending here would actually do");
});

test("a real one-to-one thread still sends", () => {
  // The guard must not break the two contacts that work today.
  const audience = readAudience({ pageText: DIRECT_THREAD_PAGE, headerLinks: ["/aj.example/"] });
  assert.equal(audience.kind, "direct");
  assert.equal(refusalFor({ audience, intendedHandle: "aj.example" }), "");
});

test("a one-to-one with the WRONG person is refused too", () => {
  const audience = readAudience({ pageText: DIRECT_THREAD_PAGE, headerLinks: ["/someone.else/"] });
  assert.match(refusalFor({ audience, intendedHandle: "aj.example" }), /someone\.else/);
});

test("two people linked in the header is a group even with no count on the page", () => {
  const audience = readAudience({ headerText: "A chat", headerLinks: ["/one.person/", "/other.person/"] });
  assert.equal(audience.kind, "group");
  assert.ok(refusalFor({ audience, intendedHandle: "one.person" }), "being one of the members does not make it a private chat");
});

test("the header wins over the rest of the page", () => {
  // The page text contains every conversation in the inbox list, including other people's presence
  // lines. When the header is readable it is the only thing that describes the OPEN conversation.
  const audience = readAudience({ headerText: "team chat 4 active today", pageText: DIRECT_THREAD_PAGE });
  assert.equal(audience.kind, "group", "a group header must not be overruled by inbox chatter");
});

test("what cannot be read is reported as unknown, never as safe", () => {
  const audience = readAudience({ pageText: "Instagram" });
  assert.equal(audience.kind, "unknown");
  assert.equal(recipientSummary({ audience }).confirmed, false);
  assert.match(recipientSummary({ audience }).text, /could not confirm/i);
});

test("the approval card names the group instead of describing an action", () => {
  // The card the owner clicked said only: "Type X into the message input, then send it."
  const audience = readAudience({ pageText: GROUP_THREAD_PAGE });
  const summary = recipientSummary({ audience, intendedHandle: "aj.example" });
  assert.match(summary.text, /group/i);
  assert.match(summary.text, /3 people/, "the count is the fact that makes it obviously wrong at a glance");
});

test("the card names the person on a one-to-one", () => {
  const audience = readAudience({ pageText: DIRECT_THREAD_PAGE, headerLinks: ["/aj.example/"] });
  const summary = recipientSummary({ audience, intendedHandle: "aj.example" });
  assert.equal(summary.confirmed, true);
  assert.match(summary.text, /@aj\.example/);
});

test("Instagram's own paths are never mistaken for people", () => {
  for (const href of ["/direct/", "/explore/", "/reels/", "/accounts/login/", "/p/abc123/", ""]) {
    assert.equal(handleFromHref(href), "", `treated ${JSON.stringify(href)} as a person`);
  }
  assert.equal(handleFromHref("/aj.example/"), "aj.example");
  assert.equal(handleFromHref("https://www.instagram.com/aj.example/"), "aj.example");
});

test("the conversation name is taken from the open thread, not the inbox list", () => {
  // "group name here" appears twice in the page: once as an inbox row, once as the open thread.
  // Only the open one is followed by presence, and that is the one that must be reported.
  assert.equal(titleBeforePresence(GROUP_THREAD_PAGE), "group name here");
});

test("no recipient is confirmed without evidence from the page", () => {
  // Guards against the tempting shortcut of trusting the contact store, which is what was wrong.
  const audience = readAudience({ pageText: "" });
  assert.deepEqual(audience.handles, []);
  assert.equal(audience.evidence, "");
});
