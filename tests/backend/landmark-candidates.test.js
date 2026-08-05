"use strict";

// The resolver refused a completely unambiguous page.
//
// Asked for "Priya Nair" on a real Instagram inbox, ranking produced a three-way tie at 0.940:
//
//   e12  role=main        the whole page container
//   e13  role=navigation  "Thread list", the container of every conversation
//   e37  role=button      the actual conversation row
//
// Margin 0.000, so the run died with "Top match margin 0.000 is insufficient for a consequential
// action." The margin guard was working exactly as designed; it was being fed nonsense candidates.
//
// An ARIA landmark's accessible text is the concatenation of everything inside it, so a query for a
// name matches the container that HOLDS the row precisely as well as the row itself. Landmarks are
// page structure. They are never a person, and they were never a legitimate answer.
//
// This is the failure that made the same task succeed and fail on alternate attempts, which is what
// made it look like a race rather than a scoring bug.

const test = require("node:test");
const assert = require("node:assert/strict");

const { rankCandidates, resolveEntity } = require("../../server/automation/entity-resolver");

// The three tied elements, as captured live.
const REAL_INBOX = [
  { ref: "e12", tag: "main", role: "main", name: "accountname Add a note... Your note ... Priya Nair You: hi · 9m ... Requests" },
  { ref: "e13", tag: "div", role: "navigation", name: "Thread list", text: "Priya Nair You: hi · 9m" },
  { ref: "e17", tag: "input", role: "textbox", name: "Search" },
  { ref: "e37", tag: "div", role: "button", name: "Priya Nair You: hi · 9m" },
];

test("page containers are not candidates for being a person", () => {
  const ranked = rankCandidates("Priya Nair", REAL_INBOX, {});
  assert.equal(ranked.length, 1, `expected only the conversation row, got ${JSON.stringify(ranked.map((r) => `${r.ref}:${r.role}`))}`);
  assert.equal(ranked[0].ref, "e37");
  assert.equal(ranked[0].role, "button");
});

test("and the recipient therefore resolves instead of being refused", () => {
  const result = resolveEntity("Priya Nair", REAL_INBOX, { singleRecipient: true });
  assert.equal(result.status, "resolved",
    `the page is unambiguous to a human; it must be unambiguous here (${result.reason || ""})`);
  assert.equal(result.match.ref, "e37");
});

test("without the filter this is a tie, which is why the run died", () => {
  // Demonstrates the mechanism rather than asserting on the fix, so the reason this filter exists
  // stays legible if someone later wonders whether it is still needed.
  const landmarks = REAL_INBOX.filter((element) => ["main", "navigation"].includes(element.role));
  assert.equal(landmarks.length, 2, "precondition: two containers carry the name in their text");
  for (const landmark of landmarks) {
    assert.match([landmark.name, landmark.text].filter(Boolean).join(" "), /Priya Nair/,
      "each container's accessible text contains the row's name, which is what made them score alike");
  }
});

test("ordinary controls are unaffected", () => {
  // The filter must remove page furniture only. Buttons, links, options and list items are how
  // people and things are actually presented.
  const elements = [
    { ref: "a1", tag: "a", role: "link", name: "Priya Nair" },
    { ref: "b1", tag: "div", role: "option", name: "Priya Nair" },
    { ref: "c1", tag: "li", role: "listitem", name: "Priya Nair" },
    { ref: "d1", tag: "div", role: "menuitem", name: "Priya Nair" },
  ];
  assert.equal(rankCandidates("Priya Nair", elements, {}).length, 4);
});

test("a genuine ambiguity is still refused", () => {
  // Removing the containers must not turn the margin guard into a rubber stamp: two different
  // people who really do both match still stop the run.
  const result = resolveEntity("Priya", [
    { ref: "e1", tag: "div", role: "button", name: "Priya Nair" },
    { ref: "e2", tag: "div", role: "button", name: "Priya Sharma" },
  ], { singleRecipient: true });
  assert.notEqual(result.status, "resolved", "two different people named Priya is a real ambiguity");
});
