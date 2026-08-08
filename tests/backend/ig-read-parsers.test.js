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

// The REAL inbox, captured live (Wave 1 validation): thread rows are role=button divs whose name is
// the whole row; the notes carousel at the top are also buttons but have no timestamp. These exact
// strings came off the live page.
const REAL_INBOX = { elements: [
  // notes carousel + controls — must be EXCLUDED
  { role: "button", name: "What's on your mind? Your note" },
  { role: "button", name: "I’ve a yoshi Yashi" },
  { role: "button", name: "Happy Birthday @maryamzaafrann!! Miss you!! 🥳 Cyrus Maram" },
  { role: "button", name: "New message" },
  { role: "button", name: "Next" },
  { role: "link", name: "Requests", href: "https://www.instagram.com/direct/requests/" },
  // real conversation rows
  { role: "button", name: "aj You: diagnostic timing test · 2h" },
  { role: "button", name: "Tg Tg sent an attachment. · 6h Unread" },
  { role: "button", name: "Raghav Mittal You: koi na · 20h" },
  { role: "button", name: "Vaishant Reddy Vaishant sent an attachment. · 23h Unread" },
  { role: "button", name: "Tg 2 new messages · 2d Unread" },
  { role: "button", name: "chetas_privvv and Vaishant Reddy 2 new messages · 4d Unread" },
  { role: "button", name: "Active Yash Active now" },
  { role: "button", name: "Ignacio Ignacio sent an attachment. · 1w Unread" },
  { role: "button", name: "Mayan Agrawal Mayan sent an attachment. · 1w Unread" },
] };

test("parseInbox finds the real conversation rows and excludes notes/controls", () => {
  const out = parseInbox(REAL_INBOX);
  assert.equal(out.count, 9, "9 real threads, not the notes carousel or the New-message button");
  // The exact note/control labels must not appear among the parsed threads. (Checked as full-string
  // equality, not substring — "New message" is a substring of the real thread "2 new messages".)
  const noteLabels = new Set([
    "What’s on your mind? Your note", "I’ve a yoshi Yashi",
    "Happy Birthday @maryamzaafrann!! Miss you!! 🥳 Cyrus Maram", "New message", "Next", "Requests",
  ]);
  for (const t of out.threads) assert.ok(!noteLabels.has(t.label), `note leaked: ${t.label}`);
});

test("parseInbox reads unread reliably (it IS in the row text)", () => {
  const byLabel = Object.fromEntries(parseInbox(REAL_INBOX).threads.map((t) => [t.label, t]));
  assert.equal(byLabel["Tg Tg sent an attachment. · 6h Unread"].unread, true);
  assert.equal(byLabel["aj You: diagnostic timing test · 2h"].unread, false);
});

test("parseInbox extracts a best-effort name for the clear cases", () => {
  const names = parseInbox(REAL_INBOX).threads.map((t) => t.name);
  assert.ok(names.includes("aj"));
  assert.ok(names.includes("Raghav Mittal"));
  assert.ok(names.includes("Yash"));      // from "Active Yash Active now"
  assert.ok(names.includes("Tg"));        // from "Tg 2 new messages" (dupe leading word collapsed)
});

test("parseInbox flags a group conversation", () => {
  const group = parseInbox(REAL_INBOX).threads.find((t) => /chetas_privvv/.test(t.label));
  assert.equal(group.isGroup, true);
});

test("parseInbox surfaces the full row label as the source of truth", () => {
  const aj = parseInbox(REAL_INBOX).threads.find((t) => t.name === "aj");
  assert.equal(aj.label, "aj You: diagnostic timing test · 2h");
  assert.equal(aj.time, "2h");
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
