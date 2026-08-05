"use strict";

// Making a same-name choice answerable.
//
// The inbox gives one thing per row: a display name. When two rows carry the same one, offering
// both back is no better than refusing — the owner is asked to pick between "Tg" and "Tg", which
// is exactly the choice they already rejected as useless. What separates them is the account behind
// each, and none of that is on the row.
//
// Two things went wrong the first time this was attempted by hand, and both are asserted here
// because either one silently makes the picker look authoritative while being wrong:
//
//   1. taking the first profile-shaped link on the page returned the OWNER'S own handle for every
//      thread, so two different people appeared identical;
//   2. taking the first image on the page returned the same avatar for every thread, so the picker
//      would have shown two identical faces.

const test = require("node:test");
const assert = require("node:assert/strict");

const { avatarForHandle, counterpartHandles, enrichCandidates, handleFromHref, ownerHandleFrom } = require("../../server/automation/identity-enrichment");

// Shaped like a real Instagram DM thread: nav chrome carrying the owner's own account, then the
// other party's profile link with their avatar inside it.
const THREAD = (handle, avatar) => [
  { ref: "n1", role: "link", href: "https://www.instagram.com/", name: "Instagram" },
  { ref: "n2", role: "link", href: "https://www.instagram.com/explore/", name: "Explore" },
  { ref: "n3", role: "link", href: "https://www.instagram.com/direct/inbox/", name: "Messages" },
  { ref: "n4", role: "button", name: "accountowner", imageUrl: "https://cdn.invalid/owner-avatar.jpg" },
  { ref: "n5", role: "link", href: "https://www.instagram.com/accountowner/", name: "Profile", imageUrl: "https://cdn.invalid/owner-avatar.jpg" },
  { ref: "t1", role: "link", href: `https://www.instagram.com/${handle}/`, name: `Open the profile page of ${handle}`, imageUrl: avatar },
];

test("a profile URL yields its handle, and page furniture yields nothing", () => {
  assert.equal(handleFromHref("https://www.instagram.com/sam_main/"), "sam_main");
  assert.equal(handleFromHref("https://www.instagram.com/somebody"), "somebody");
  for (const furniture of [
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/explore/",
    "https://www.instagram.com/p/ABC123/",
    "https://www.instagram.com/",
    "",
  ]) {
    assert.equal(handleFromHref(furniture), "", `not a person: ${furniture}`);
  }
});

test("the counterpart is found, and it is never the owner", () => {
  // The whole failure mode in one assertion. Both threads below have the owner's account in the
  // nav; returning it would make two different people indistinguishable.
  const first = counterpartHandles(THREAD("sam_main", "https://cdn.invalid/a.jpg"), "accountowner");
  const second = counterpartHandles(THREAD("sam_alt", "https://cdn.invalid/b.jpg"), "accountowner");
  assert.deepEqual(first, ["sam_main"]);
  assert.deepEqual(second, ["sam_alt"]);
  assert.notDeepEqual(first, second, "two different threads must not report the same account");
});

test("the owner's own handle is read off the inbox chrome", () => {
  assert.equal(ownerHandleFrom(THREAD("sam_main", "")), "accountowner");
});

test("the avatar belongs to that account, not to whoever is first on the page", () => {
  // The owner's avatar appears earlier in the DOM than the counterpart's. Picking "the first image"
  // returns it every time, which is how a picker ends up showing one face for two people.
  const elements = THREAD("sam_main", "https://cdn.invalid/sam.jpg");
  assert.equal(avatarForHandle(elements, "sam_main"), "https://cdn.invalid/sam.jpg");
  assert.notEqual(avatarForHandle(elements, "sam_main"), "https://cdn.invalid/owner-avatar.jpg");
  assert.equal(avatarForHandle(elements, "nobody_here"), "", "an unknown account has no avatar to claim");
});

test("two same-named rows come back distinguishable", async () => {
  // Drives the real enrichment against a scripted browser: two inbox rows with identical labels,
  // opening to different threads and different accounts.
  const inbox = [
    { ref: "e1", role: "button", name: "accountowner" },
    { ref: "e34", role: "button", name: "Tg Active 5h ago" },
    { ref: "e35", role: "button", name: "Tg 2 new messages · 13h Unread" },
  ];
  const threads = {
    e34: { url: "https://www.instagram.com/direct/t/111/", elements: THREAD("sam_alt", "https://cdn.invalid/spvt.jpg") },
    e35: { url: "https://www.instagram.com/direct/t/222/", elements: THREAD("sam_main", "https://cdn.invalid/main.jpg") },
  };
  let opened = null;
  const browserService = {
    navigate: async () => { opened = null; },
    wait: async () => {},
    click: async ({ ref }) => { opened = ref; },
    snapshot: async () => (opened ? threads[opened] : { url: "https://www.instagram.com/direct/inbox/", elements: inbox }),
  };

  const enriched = await enrichCandidates({
    browserService,
    taskId: "t",
    inboxUrl: "https://www.instagram.com/direct/inbox/",
    candidates: [inbox[1], inbox[2]],
    waitMs: 0,
  });

  assert.equal(enriched.length, 2);
  assert.deepEqual(enriched.map((item) => item.handle), ["sam_alt", "sam_main"]);
  assert.deepEqual(enriched.map((item) => item.threadUrl), ["https://www.instagram.com/direct/t/111/", "https://www.instagram.com/direct/t/222/"]);
  assert.deepEqual(enriched.map((item) => item.avatarUrl), ["https://cdn.invalid/spvt.jpg", "https://cdn.invalid/main.jpg"]);
  assert.equal(new Set(enriched.map((item) => item.handle)).size, 2, "the two rows must not collapse to one account");
});

test("one unreadable candidate does not lose the question", async () => {
  // Losing a row's handle is a worse answer, not a reason to abandon the choice entirely.
  const inbox = [
    { ref: "e1", role: "button", name: "accountowner" },
    { ref: "e34", role: "button", name: "Tg one" },
    { ref: "e35", role: "button", name: "Tg two" },
  ];
  let opened = null;
  const browserService = {
    navigate: async () => { opened = null; },
    wait: async () => {},
    click: async ({ ref }) => { if (ref === "e34") throw new Error("row detached"); opened = ref; },
    snapshot: async () => (opened
      ? { url: "https://www.instagram.com/direct/t/222/", elements: THREAD("sam_main", "https://cdn.invalid/main.jpg") }
      : { url: "https://www.instagram.com/direct/inbox/", elements: inbox }),
  };
  const enriched = await enrichCandidates({ browserService, taskId: "t", inboxUrl: "https://www.instagram.com/direct/inbox/", candidates: [inbox[1], inbox[2]], waitMs: 0 });
  assert.equal(enriched.length, 2, "both candidates are still offered");
  assert.equal(enriched[0].handle, "", "the one that failed simply has less detail");
  assert.equal(enriched[1].handle, "sam_main");
});

test("a single candidate is not a question", async () => {
  const browserService = { navigate: async () => {}, wait: async () => {}, click: async () => {}, snapshot: async () => ({ url: "", elements: [] }) };
  const enriched = await enrichCandidates({ browserService, taskId: "t", inboxUrl: "https://x.invalid/", candidates: [{ ref: "e1", name: "Tg" }], waitMs: 0 });
  assert.deepEqual(enriched, [], "there is nothing to disambiguate, so nothing is opened");
});
