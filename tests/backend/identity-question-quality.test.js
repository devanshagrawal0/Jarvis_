"use strict";

// Being shown one stranger to confirm is worse than being shown the four it found.
//
// Measured live, searching for a friend by first name:
//
//   [auto:resolver] ambiguous  candidateCount: 4
//   topScores: ["0.940","0.940","0.940","0.900"]
//   reason: "Top match margin 0.000 is insufficient for a consequential action."
//
// Four accounts, three tied at the top — and the owner was offered exactly ONE, because a candidate
// only survived if its label STARTED with the typed name. The owner recognises a person at a
// glance; that only works if they are shown the people that were actually found.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ENRICHMENT = path.join(__dirname, "..", "..", "server", "automation", "identity-enrichment.js");
const SOURCE = fs.readFileSync(ENRICHMENT, "utf8");

// `namesTheQuery` is module-private, so exercise it through the shipped source rather than a copy —
// a re-implementation here would pass while the real rule stayed broken.
const namesTheQuery = (() => {
  const start = SOURCE.indexOf("function namesTheQuery");
  const end = SOURCE.indexOf("\nfunction ", start + 1);
  // eslint-disable-next-line no-new-func -- evaluating the real function is the point
  return new Function(`${SOURCE.slice(start, end)}; return namesTheQuery;`)();
})();

test("the person is found however their name is arranged", () => {
  // All of these are the same human. Only the first used to match.
  for (const label of [
    "lr lr.vasquez88",
    "LR Vasquez",
    "Vasquez, LR",
    "L.R. Vasquez",
    "vasquez lr",
  ]) {
    assert.equal(namesTheQuery(label, "lr"), true, `"${label}" should be offered for "lr"`);
  }
});

test("a full name still matches the account that has both parts", () => {
  assert.equal(namesTheQuery("LR Vasquez", "lr vasquez"), true);
  assert.equal(namesTheQuery("Vasquez, LR", "lr vasquez"), true);
});

test("a full name does NOT match someone who only shares one part", () => {
  // The guard against the loosening going too far: asking for "lr vasquez" must not surface a
  // different LR, because the whole point of the card is that the owner picks the right person.
  assert.equal(namesTheQuery("LR Rodriguez", "lr vasquez"), false);
  assert.equal(namesTheQuery("Sam Vasquez", "lr vasquez"), false);
});

test("a message that merely quotes the name is still not a person", () => {
  // The rule this loosening had to keep. Instagram search returns message bodies, and a year-old
  // message containing the word is not a candidate for who that person is — offering one as a face
  // to pick is worse than offering none.
  assert.equal(namesTheQuery("Casey i will tg not to · 1y", "tg"), false);
  assert.equal(namesTheQuery("Instagram User ... club tg once · 1y", "tg"), false);
});

test("letters buried inside a word are not a match", () => {
  // Anchored at word starts, so a name that merely contains the letters is not dragged in.
  assert.equal(namesTheQuery("majid khan", "lr"), false);
  assert.equal(namesTheQuery("rajesh", "lr"), false);
});

test("empty input never matches", () => {
  assert.equal(namesTheQuery("", "lr"), false);
  assert.equal(namesTheQuery("LR Vasquez", ""), false);
});

test("the inbox is not re-loaded for every candidate", () => {
  // A navigate + fixed 2.2s wait + 240-element snapshot per candidate was most of the 99 seconds
  // the question took to appear. Only needed when the previous candidate navigated into a thread.
  assert.match(SOURCE, /const alreadyOnInbox = Boolean\(current\) && String\(current\?\.activePage\?\.url \|\| ""\)\.startsWith\(inboxUrl\);/,
    "it must check where the browser already is before paying to go back");
  assert.match(SOURCE, /if \(!alreadyOnInbox\) \{/, "the trip back to the inbox must be conditional");
  assert.match(SOURCE, /typeof browserService\.status === "function"/,
    "a missing status method throws synchronously and .catch cannot save it — that lost every handle");
});

test("the cap still bounds how many people are opened", () => {
  // Loosening the filter must not turn one question into twenty page loads.
  const cap = /const MAX_CANDIDATES = (\d+);/.exec(SOURCE);
  assert.ok(cap, "MAX_CANDIDATES must still exist");
  assert.ok(Number(cap[1]) >= 2 && Number(cap[1]) <= 6, `${cap[1]} candidates is outside a sane range`);
});
