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
