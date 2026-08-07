"use strict";

// Why exactly one contact was fast, and everyone else was slow forever.
//
// A stored conversation URL lets the agent open the chat directly, where the composer and the send
// control are both found deterministically — no model call. Without one, the same send has to search
// for the person, disambiguate them, and open the chat first: slower, and the step where sending to
// the wrong person becomes possible.
//
// Only one contact had that URL, so only that contact was fast, and every test against them looked
// like the feature worked. Learning the URL from a send that actually succeeded means the second
// message to anybody is as fast as the first message to them.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createContactStore } = require("../../server/contacts");

const THREAD = "https://www.instagram.com/direct/t/17845000000000000/";
const cleanups = [];
test.after(() => cleanups.forEach((fn) => { try { fn(); } catch { /* best effort */ } }));

function storeWithContact() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-thread-learn-"));
  cleanups.push(() => fs.rmSync(runtimeDir, { recursive: true, force: true }));
  const store = createContactStore({ runtimeDir });
  const contact = store.save({ name: "Test Person", channels: { instagram: { handle: "test.person" } } });
  return { store, contact };
}

test("a delivered send teaches the contact where the conversation is", () => {
  const { store, contact } = storeWithContact();
  assert.ok(!store.routeFor("Test Person", "instagram").url.includes("/direct/t/"),
    "before learning there is no conversation to open, so the send must search for the person first");

  store.rememberThread(contact.id, "instagram", THREAD);
  assert.equal(store.routeFor("Test Person", "instagram").url, THREAD,
    "after one successful send the exact conversation is known, which is what makes it fast");
});

test("a known-good conversation is never overwritten", () => {
  // A wrong thread URL sends to the wrong person silently. Being slow is recoverable; that is not.
  const { store, contact } = storeWithContact();
  store.rememberThread(contact.id, "instagram", THREAD);
  store.rememberThread(contact.id, "instagram", "https://www.instagram.com/direct/t/99999999999999999/");
  assert.equal(store.routeFor("Test Person", "instagram").url, THREAD);
});

test("only a real conversation URL is learned", () => {
  const { store, contact } = storeWithContact();
  for (const junk of [
    "",
    "https://www.instagram.com/direct/inbox/",        // the inbox is not a conversation
    "https://www.instagram.com/test.person/",         // a profile is not a conversation
    "http://www.instagram.com/direct/t/1234567890/",  // not https
    "https://evil.example/direct/t/1234567890/x",     // right shape, wrong host is still not ours to trust blindly
    "javascript:alert(1)",
  ]) {
    assert.equal(store.rememberThread(contact.id, "instagram", junk), null, `learned junk: ${JSON.stringify(junk)}`);
  }
  assert.ok(!store.routeFor("Test Person", "instagram").url.includes("/direct/t/"));
});

test("learning does not disturb the rest of the contact", () => {
  const { store, contact } = storeWithContact();
  store.rememberThread(contact.id, "instagram", THREAD);
  const after = store.get(contact.id);
  assert.equal(after.name, "Test Person");
  assert.equal(after.channels.instagram.handle, "test.person", "the handle must survive — it is how the person is identified");
});

test("an unknown contact or channel is a no-op, not a crash", () => {
  const { store, contact } = storeWithContact();
  assert.equal(store.rememberThread("no-such-contact", "instagram", THREAD), null);
  assert.equal(store.rememberThread(contact.id, "not-a-channel", THREAD), null);
});

test("a contact created mid-run is still learned from", () => {
  // The case that was silently missed. When the owner is asked "which one?", the contact does not
  // exist yet — it is created by picking. The lookup captured at the START of the run is therefore
  // null for exactly the people who most need learning, so a newly picked contact kept its handle
  // but never got a conversation, and re-searched on every future message. Observed live: two
  // contacts had a conversation and were fast, a third did not and stayed slow, all three having
  // been messaged successfully.
  const engine = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");
  assert.match(engine, /const learnFor = knownContact\?\.contactId\s*\n?\s*\? knownContact\s*\n?\s*: contacts\.routeFor\(namedPerson, surfaceChannel\);/,
    "learning must re-resolve the contact after the run, not rely on the lookup from before it");
  assert.match(engine, /if \(result\.success && surfaceChannel && namedPerson\) \{/,
    "still gated on a delivered send");
});

test("the engine only learns from a send that actually succeeded", () => {
  // Guarding on `result.success` is the whole safety of this: a run that failed may well have ended
  // on the wrong page, and caching that URL would make every future message to that person wrong.
  const engine = fs.readFileSync(path.join(__dirname, "..", "..", "server", "capability-engine.js"), "utf8");
  // The property, not the exact wording: a run that FAILED may well have ended on the wrong page,
  // and caching that URL would make every future message to that person go to the wrong place.
  const gate = /if \(result\.success && [^)]*\) \{[\s\S]{0,400}?rememberThread\(/.exec(engine);
  assert.ok(gate, "thread learning must be gated on a verified success");
});
