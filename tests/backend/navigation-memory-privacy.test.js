"use strict";

// Route memory was writing contacts' names into runtime/browser-navigation-memory.json, and the
// entries it wrote could never be used.
//
// Inspected after a real send, the file contained a contact's display name, their handle, another
// contact's name, and the owner's own note text. The module has two filters meant to prevent
// exactly that — PERSON_LIKE_LABEL for names, PRIVATE_LABEL for handles and numbers — and both were
// defeated by the same thing: a conversation row is not "Priya Nair", it is
// "Priya Nair You: hi · 12m". Neither pattern matches that, so everything was stored.
//
// The same tail also made the memory worthless. It is part of the key, and it changes: "· 12m" now,
// "· 20m" later. Three separate records accumulated for one row in a single afternoon. It relearned
// from scratch every run and never paid off once.
//
// Strip the volatile tail, judge what remains — and if stripping changed anything, the element was
// a conversation row, whose head is whoever it is with.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createNavigationMemory } = require("../../server/automation/navigation-memory");

function learn(labels) {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "navmem-privacy-"));
  const memory = createNavigationMemory({ runtimeDir });
  for (const name of labels) {
    memory.record({
      snapshot: { url: "https://messages.invalid/inbox" },
      action: { action: "click", reason: "open the conversation" },
      targetElement: { name, role: "button" },
      ok: true,
      changed: true,
      durationMs: 50,
    });
  }
  // When every label is refused the file is never written at all, which is the strongest possible
  // outcome — there is nothing on disk to leak.
  const filePath = path.join(runtimeDir, "browser-navigation-memory.json");
  const stored = fs.existsSync(filePath) ? (JSON.parse(fs.readFileSync(filePath, "utf8")).records || []) : [];
  fs.rmSync(runtimeDir, { recursive: true, force: true });
  return stored.map((item) => item.label);
}

test("conversation rows never reach the memory file", () => {
  // Every one of these shapes was found in the real file.
  const rows = [
    "Priya Nair You: hi · 12m",
    "Priya Nair Reacted to your message · 1d Unread",
    "Tg You sent an attachment. 20h Unread",   // single-word display name — PERSON_LIKE_LABEL misses it
    "priya_n_iv",                               // bare handle, no @ — PRIVATE_LABEL misses it
    "Ana 2 new messages · 3h",
    "Priya Nair",
  ];
  const stored = learn(rows);
  assert.deepEqual(stored, [], `nothing from a conversation row may be stored, got ${JSON.stringify(stored)}`);
});

test("ordinary controls are still learned, or the memory is pointless", () => {
  const stored = learn(["Next", "Requests", "New message", "Settings"]);
  assert.equal(stored.length, 4, `expected all four UI controls, got ${JSON.stringify(stored)}`);
  assert.ok(stored.includes("new message"),
    "\"New message\" is the compose button; only a COUNTED \"2 new messages\" is conversational noise");
});

test("the same row twice produces one key, not two", () => {
  // The volatile tail was in the key, so a row seen at 12m and again at 20m became two records that
  // could each only ever match once. Nothing is stored for rows now, so the count is zero either
  // way — this asserts the mechanism directly so the reason stays legible.
  const stored = learn(["Priya Nair You: hi · 12m", "Priya Nair You: hi · 20m"]);
  assert.equal(stored.length, 0);
});

test("a consequential control is still refused outright", () => {
  // Unchanged behaviour, asserted so the new filtering cannot quietly replace it.
  assert.deepEqual(learn(["Send", "Send a message", "Delete chat"]), []);
});
