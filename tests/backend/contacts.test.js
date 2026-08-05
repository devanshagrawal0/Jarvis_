"use strict";

// The store that answers "who does the owner mean".
//
// It exists because the automation's only two answers were guess or refuse. Asked to message "tg",
// it searched, got back a group thread containing Tg, correctly refused to send a private message to
// a group, and told the owner to supply an exact handle for someone they message every day.
//
// The identity was not unknowable. It was unasked.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createContactStore } = require("../../server/contacts");

function store() {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "contacts-"));
  return { store: createContactStore({ runtimeDir }), runtimeDir, cleanup: () => fs.rmSync(runtimeDir, { recursive: true, force: true }) };
}

test("a saved contact is found by every name it has", () => {
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({
      name: "Priya Nair",
      aliases: ["tg"],
      channels: { instagram: { handle: "@priya_n_iv", threadUrl: "https://www.instagram.com/direct/t/123/" } },
    });
    for (const query of ["tg", "TG", " Tg ", "Priya Nair", "priya nair", "priya_n_iv"]) {
      assert.ok(contacts.find(query), `must resolve "${query}"`);
    }
  } finally { cleanup(); }
});

test("the stored thread is what the automation navigates to", () => {
  // The whole point. A known thread means no inbox load, no search, no ranking, no ambiguity.
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({ name: "Priya Nair", aliases: ["tg"], channels: { instagram: { handle: "priya_n_iv", threadUrl: "https://www.instagram.com/direct/t/123/" } } });
    const route = contacts.routeFor("tg", "instagram");
    assert.equal(route.url, "https://www.instagram.com/direct/t/123/");
    assert.equal(route.handle, "priya_n_iv");
    assert.equal(route.name, "Priya Nair");
  } finally { cleanup(); }
});

test("a contact with no account on that surface is not a match for it", () => {
  // Knowing someone's email says nothing about where their Instagram messages go.
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({ name: "Yash", channels: { email: { address: "yash@example.invalid" } } });
    assert.ok(contacts.find("Yash"));
    assert.equal(contacts.find("Yash", { channel: "instagram" }), null);
    assert.equal(contacts.routeFor("Yash", "instagram"), null);
  } finally { cleanup(); }
});

test("matching is exact, so a near miss asks instead of guessing", () => {
  // Fuzzy matching here would reintroduce the confident-guess failure this store exists to remove.
  // "Priy" is not "Priya Nair"; falling through to a question is cheap, resolving to the wrong
  // person is not.
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({ name: "Priya Nair", channels: { instagram: { handle: "priya_n_iv" } } });
    for (const near of ["priy", "priya n", "nair priya", "priyanka"]) {
      assert.equal(contacts.find(near), null, `"${near}" must not resolve`);
    }
  } finally { cleanup(); }
});

test("two people sharing a name are both returned, never collapsed", () => {
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({ name: "Tg", channels: { instagram: { handle: "tg_one" } } });
    contacts.save({ name: "Tg", channels: { instagram: { handle: "tg_two" } } });
    const all = contacts.findAll("tg");
    assert.equal(all.length, 2, "the owner gets to decide which, so both must survive");
  } finally { cleanup(); }
});

test("the most recently used wins when a name really is shared", () => {
  const { store: contacts, cleanup } = store();
  try {
    const first = contacts.save({ name: "Tg", channels: { instagram: { handle: "tg_one" } } });
    contacts.save({ name: "Tg", channels: { instagram: { handle: "tg_two" } } });
    contacts.touch(first.id);
    assert.equal(contacts.find("tg", { channel: "instagram" }).channels.instagram.handle, "tg_one");
  } finally { cleanup(); }
});

test("saving again merges rather than duplicating", () => {
  // Learning a WhatsApp number for someone must not create a second person.
  const { store: contacts, cleanup } = store();
  try {
    const saved = contacts.save({ name: "Priya Nair", aliases: ["tg"], channels: { instagram: { handle: "priya_n_iv" } } });
    contacts.save({ id: saved.id, name: "Priya Nair", aliases: ["p"], channels: { whatsapp: { address: "+10000000000" } } });
    const all = contacts.list();
    assert.equal(all.length, 1);
    assert.deepEqual(Object.keys(all[0].channels).sort(), ["instagram", "whatsapp"]);
    assert.deepEqual(all[0].aliases.sort(), ["p", "tg"]);
    assert.equal(all[0].channels.instagram.handle, "priya_n_iv", "the earlier channel survives");
  } finally { cleanup(); }
});

test("contacts live in the runtime directory, which is not in the repository", () => {
  // This is a list of the owner's real contacts. It must never be committable.
  const { store: contacts, runtimeDir, cleanup } = store();
  try {
    contacts.save({ name: "Priya Nair" });
    assert.equal(contacts.filePath, path.join(runtimeDir, "contacts.json"));
    const ignore = fs.readFileSync(path.join(__dirname, "..", "..", ".gitignore"), "utf8");
    assert.match(ignore, /^\/runtime\/$/m, "runtime/ must be gitignored for this to be safe");
  } finally { cleanup(); }
});

test("a handle is stored without its @, so both spellings resolve", () => {
  const { store: contacts, cleanup } = store();
  try {
    contacts.save({ name: "Priya Nair", channels: { instagram: { handle: "@priya_n_iv" } } });
    assert.equal(contacts.list()[0].channels.instagram.handle, "priya_n_iv");
    assert.ok(contacts.find("priya_n_iv"));
  } finally { cleanup(); }
});

// ── editing, not just accumulating ────────────────────────────────────────────
// The store was written for one job: record the answer to "who is tg" once. An address book the
// owner edits by hand is a different job, and the original shape quietly could not do it — every
// save unioned the alias list, so a typo could be added and never taken back out.

test("an alias can be removed, not only added", () => {
  const { store: contacts, cleanup } = store();
  try {
    const saved = contacts.save({ name: "Priya Nair", aliases: ["tg", "typo"] });
    const edited = contacts.save({ id: saved.id, name: "Priya Nair", aliases: ["tg"], replaceAliases: true });
    assert.deepEqual(edited.aliases, ["tg"], "the removed alias must be gone");
    assert.equal(contacts.find("typo"), null, "and must no longer resolve anyone");
  } finally { cleanup(); }
});

test("omitting aliases leaves them alone; sending them replaces them", () => {
  // Two different intents that must not be conflated: an edit form that only touches notes should
  // not wipe the aliases it never showed.
  const { store: contacts, cleanup } = store();
  try {
    const saved = contacts.save({ name: "Priya Nair", aliases: ["tg"] });
    const untouched = contacts.save({ id: saved.id, name: "Priya Nair", notes: "roommate" });
    assert.deepEqual(untouched.aliases, ["tg"]);
    assert.equal(untouched.notes, "roommate");
  } finally { cleanup(); }
});

test("a channel can be removed by sending null", () => {
  const { store: contacts, cleanup } = store();
  try {
    const saved = contacts.save({ name: "Priya Nair", channels: { instagram: { handle: "priya_n_iv" }, email: { address: "p@example.com" } } });
    assert.equal(Object.keys(saved.channels).length, 2);
    const edited = contacts.save({ id: saved.id, name: "Priya Nair", channels: { email: null } });
    assert.deepEqual(Object.keys(edited.channels), ["instagram"]);
  } finally { cleanup(); }
});

test("a value that does not fit its channel is refused, with a reason", () => {
  // A wrong entry is worse than a missing one: it is what gets used to contact someone, and the
  // mistake surfaces as a failed send days later rather than as a message at the keyboard.
  const { store: contacts, cleanup } = store();
  try {
    assert.throws(() => contacts.save({ name: "P", channels: { email: { address: "not-an-email" } } }), /not an email address/);
    assert.throws(() => contacts.save({ name: "P", channels: { whatsapp: { handle: "12" } } }), /too short to be a phone number/);
    assert.throws(() => contacts.save({ name: "P", channels: { instagram: { handle: "has spaces" } } }), /not a valid Instagram handle/);
    assert.throws(() => contacts.save({ name: "P", channels: { pigeon: { handle: "x" } } }), /not a channel Jarvis knows/);
    assert.equal(contacts.list().length, 0, "nothing partial may be written when a value is refused");
  } finally { cleanup(); }
});

test("every channel in the catalogue can actually be saved", () => {
  // The catalogue is what the editor builds its form from. A channel it offers that the store drops
  // is a field the owner types into and silently loses.
  const { store: contacts, cleanup } = store();
  try {
    const samples = { handle: "sam_main", address: "sam@example.com", phone: "+15550001111" };
    for (const channel of contacts.channelCatalogue()) {
      const value = samples[channel.kind === "address" ? "address" : channel.kind === "phone" ? "phone" : "handle"];
      const saved = contacts.save({ name: `Person ${channel.key}`, channels: { [channel.key]: { handle: value } } });
      assert.ok(saved.channels[channel.key], `${channel.key} must survive a save`);
    }
    assert.equal(contacts.list().length, contacts.channelCatalogue().length);
  } finally { cleanup(); }
});

test("notes, tags and pinning round-trip", () => {
  const { store: contacts, cleanup } = store();
  try {
    const saved = contacts.save({ name: "Priya Nair", notes: "met at the rowing club", tags: ["family", "family", "close"], pinned: true });
    assert.equal(saved.notes, "met at the rowing club");
    assert.deepEqual(saved.tags, ["family", "close"], "duplicate tags collapse");
    assert.equal(saved.pinned, true);
    assert.equal(contacts.get(saved.id).pinned, true);
  } finally { cleanup(); }
});

test("editing an id that does not exist fails instead of creating a stranger", () => {
  // Otherwise a stale editor tab silently resurrects a contact the owner just deleted.
  const { store: contacts, cleanup } = store();
  try {
    assert.throws(() => contacts.save({ id: "nope", name: "Ghost" }), /No contact with that id/);
    assert.equal(contacts.list().length, 0);
  } finally { cleanup(); }
});

test("a channel link prefers what was observed over what can be generated", () => {
  // A stored thread URL is a fact. A profile URL built from a template is a guess that happens to
  // be right most of the time — and navigating to the guess is what walked a run out of the thread.
  const { store: contacts, cleanup } = store();
  try {
    assert.equal(
      contacts.linkForChannel("instagram", { handle: "sam_main", threadUrl: "https://www.instagram.com/direct/t/1/" }),
      "https://www.instagram.com/direct/t/1/",
    );
    assert.equal(contacts.linkForChannel("instagram", { handle: "sam_main" }), "https://www.instagram.com/sam_main/");
    assert.equal(contacts.linkForChannel("email", { address: "sam@example.com" }), "mailto:sam@example.com");
    assert.equal(contacts.linkForChannel("instagram", {}), "", "no value means no link to offer");
  } finally { cleanup(); }
});
