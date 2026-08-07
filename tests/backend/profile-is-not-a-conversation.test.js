"use strict";

// Starting a message on someone's PROFILE is why one contact never got fast.
//
// `routeFor` returns `threadUrl || profileUrl`, and the send treated either as "the place to start"
// while telling the run "the correct conversation is already open on screen". On a profile that
// sentence is false: the run lands on a page with no conversation, works from there, and never
// enters a chat — so no conversation URL ever exists to learn, and that person is searched from
// scratch on every future message.
//
// Measured across a day of live sends: the two contacts holding a stored conversation ran in 21s
// and 57s. The one holding only a profile stayed at roughly five minutes across four separate
// SUCCESSFUL sends, and learned nothing from any of them — the loop could never close, because
// closing it required a conversation the run never opened.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const os = require("node:os");
const { createContactStore } = require("../../server/contacts");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");

// The SHIPPED rule, called directly. An earlier version of this file re-implemented the regex here,
// and a mutation that made a profile count as a conversation sailed straight through it — the test
// was checking a copy while the real rule was broken. One rule, imported, or the test proves nothing.
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-conversation-url-"));
test.after(() => { try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch { /* best effort */ } });
const store = createContactStore({ runtimeDir });
const isSavedThread = (url) => store.isConversationUrl("instagram", url);

test("only a real conversation counts as a saved conversation", () => {
  assert.equal(isSavedThread("https://www.instagram.com/direct/t/17845000000000000/"), true);
  assert.equal(isSavedThread("https://instagram.com/direct/t/123456/"), true);
});

test("a profile is not a conversation", () => {
  // The exact value that was being used as a starting point.
  assert.equal(isSavedThread("https://www.instagram.com/someone.handle/"), false);
  assert.equal(isSavedThread("https://www.instagram.com/direct/inbox/"), false);
  assert.equal(isSavedThread(""), false);
});

test("a foreign host is never treated as a saved conversation", () => {
  // Same shape, wrong site — a redirected run must not hand future messages to it.
  assert.equal(isSavedThread("https://evil.example/direct/t/1234567890"), false);
});

test("the engine uses the shared rule, not its own copy of it", () => {
  // Two copies of "is this a conversation" is how the write-side and the start-side drift apart,
  // and drift here means starting on a profile while believing it is a chat.
  assert.match(SOURCE, /contacts\.isConversationUrl\(surfaceChannel, knownContact\?\.url\)/,
    "the start URL must be judged by the same rule that gates saving one");
  assert.doesNotMatch(SOURCE, /if \(knownContact\?\.url\) \{\s*\n\s*startUrl = knownContact\.url;/,
    "taking whatever routeFor returned is the bug this replaces");
});

test("with only a handle it opens the person's PROFILE, never a search", () => {
  // Three routes were tried for a known handle, and only one is both correct and proven live:
  //
  //   inbox search   — matched the owner's GROUP chat for a one-word name and sent to it 3x. Wrong.
  //   /direct/new/   — an untried theory; never proven, replaced before it ran successfully.
  //   the PROFILE    — instagram.com/<handle>, which IS that one account. Sent to the right person
  //                    on tests 10, 11 and 12, confirmed in the owner's real message history.
  //
  // A profile cannot be a group and has no candidate list, so there is nothing to rank and nothing
  // to disambiguate. The recipient is fixed by the URL.
  assert.match(SOURCE, /startUrl = `https:\/\/www\.instagram\.com\/\$\{knownContact\.handle\}\/`;/,
    "a known handle must open that account's profile, which is a single account by construction");
  assert.doesNotMatch(SOURCE, /startUrl = "https:\/\/www\.instagram\.com\/direct\/(?:inbox|new)\/"/,
    "neither the inbox nor the new-message search — both can surface a group");
  // The instruction that opens the chat must stay SHORT: a verbose one poisoned entity extraction,
  // scraping fake recipients and a second 'message' out of its own prose, which sent every step to
  // the planner. It quotes only the message.
  assert.match(SOURCE, /const openExactly = "Click the Message button on this profile";/,
    "the open-chat instruction must be short and must not quote anything but the message");
});

test("the run is never told a conversation is open when it is not", () => {
  // The false premise that made the run act as though it were in a chat while on a profile.
  const claim = "The correct conversation is already open on screen";
  const claimIndex = SOURCE.indexOf(claim);
  assert.ok(claimIndex > -1, "the sentence still exists for the genuine saved-conversation route");
  const branch = SOURCE.slice(SOURCE.indexOf("} else if (savedThread) {"), claimIndex);
  assert.ok(branch.length > 0 && branch.length < 1200,
    "that sentence must sit inside the savedThread branch, where it is actually true");
});
