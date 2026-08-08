"use strict";

// Parsers turn a fake page into structured answers. No browser, no account — fixture snapshots only.

const test = require("node:test");
const assert = require("node:assert/strict");

const { parsePeople, parseInbox, parseNotifications, classifyNotification } = require("../../server/instagram/read-parsers");

test("parsePeople reads usernames from profile links, deduped and in order", () => {
  const els = [
    { role: "link", href: "/aj.one/", name: "AJ One" },
    { role: "link", href: "/bee.two/", name: "Bee" },
    { role: "link", href: "/aj.one/", name: "AJ One" }, // recycled duplicate row
    { role: "link", href: "/explore/", name: "Explore" }, // reserved path — not a person
    { role: "button", name: "Follow" },                   // not a link
  ];
  const people = parsePeople(els);
  assert.deepEqual(people.map((p) => p.username), ["aj.one", "bee.two"]);
  assert.equal(people[0].name, "AJ One");
});

test("parsePeople ignores Instagram's own paths, not just some of them", () => {
  const els = ["/explore/", "/direct/inbox/", "/reels/", "/p/abc123/", "/accounts/edit/"].map((href) => ({ role: "link", href }));
  assert.deepEqual(parsePeople(els), []);
});

test("parseInbox extracts threads by their /direct/t/<id> link, deduped", () => {
  const snap = { elements: [
    { role: "link", href: "/direct/t/111/", name: "aj  hey there · 40m" },
    { role: "link", href: "/direct/t/222/", name: "group chat  ok · 2h" },
    { role: "link", href: "/direct/t/111/", name: "aj  hey there · 40m" }, // dup
    { role: "link", href: "/aj/", name: "aj" }, // profile link, not a thread
  ] };
  const out = parseInbox(snap);
  assert.equal(out.count, 2);
  assert.deepEqual(out.threads.map((t) => t.threadId), ["111", "222"]);
  assert.ok(out.threads[0].label.includes("aj"), "the raw label is surfaced as-is");
});

test("parseInbox does NOT fake a participant name it cannot reliably extract", () => {
  // Name/snippet live in separate elements on the real page; guessing them from row text is the
  // kind of over-fitting that produces confident-but-wrong output. Honest until the live read wires
  // the real structure.
  const snap = { elements: [{ role: "link", href: "/direct/t/1/", name: "aj hey there · 40m" }] };
  const t = parseInbox(snap).threads[0];
  assert.equal(t.name, null);
  assert.equal(t.unreadKnown, false);
});

test("classifyNotification labels each row by its verb", () => {
  assert.equal(classifyNotification("aj started following you"), "follow");
  assert.equal(classifyNotification("bee requested to follow you"), "follow_request");
  assert.equal(classifyNotification("cee liked your photo"), "like");
  assert.equal(classifyNotification("dee commented: nice"), "comment");
  assert.equal(classifyNotification("eff mentioned you in a comment"), "mention");
  assert.equal(classifyNotification("random unrelated text"), "other");
});

test("parseNotifications keeps only classifiable rows, with the username", () => {
  const snap = { elements: [
    { role: "link", href: "/aj/", name: "aj started following you" },
    { role: "link", href: "/bee/", name: "bee liked your photo" },
    { role: "link", href: "/cee/", name: "just a name" }, // unclassifiable → dropped
  ] };
  const out = parseNotifications(snap);
  assert.equal(out.count, 2);
  assert.deepEqual(out.events.map((e) => [e.type, e.username]), [["follow", "aj"], ["like", "bee"]]);
});

test("a follow request is NOT miscounted as a plain follow", () => {
  // The two are different actions to the owner — the parser must keep them distinct.
  assert.notEqual(classifyNotification("x requested to follow you"), classifyNotification("x started following you"));
});
