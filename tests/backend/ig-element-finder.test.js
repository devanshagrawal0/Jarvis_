"use strict";

// The finder must find by meaning and REFUSE when unsure. Two identical-looking controls must never
// be silently disambiguated — that is the class of bug that put a message in the wrong chat.

const test = require("node:test");
const assert = require("node:assert/strict");

const { findOne, findFirst, allMatches, TargetError } = require("../../server/instagram/element-finder");

// A fake page, in the element-metadata shape the real snapshot produces.
const PAGE = [
  { ref: "e1", tag: "button", role: "button", name: "Like", text: "" },
  { ref: "e2", tag: "button", role: "button", name: "Comment", text: "" },
  { ref: "e3", tag: "a", role: "link", name: "aj", href: "/aj.example/" },
  { ref: "e4", tag: "a", role: "link", name: "aj too", href: "/aj.other/" },
  { ref: "e5", tag: "textarea", role: "textbox", name: "Add a comment…" },
  { ref: "e6", tag: "button", role: "button", name: "Post", text: "Post", disabled: true },
];

test("finds a control by its accessible name", () => {
  assert.equal(findOne(PAGE, { name: "Like" }).ref, "e1");
});

test("finds a person's row by the username in the href, not display text", () => {
  // The href is the stable key; display names churn.
  assert.equal(findOne(PAGE, { href: "/aj.example/" }).ref, "e3");
});

test("refuses (does not guess) when two elements match", () => {
  // Both links start with /aj — a loose target hits two. It must throw ambiguous, never pick one.
  assert.throws(
    () => findOne(PAGE, { role: "link", hrefIncludes: "/aj" }),
    (err) => err instanceof TargetError && err.code === "ambiguous" && err.count === 2,
  );
});

test("reports not_found when nothing matches, with a zero count", () => {
  assert.throws(
    () => findOne(PAGE, { name: "Follow" }),
    (err) => err.code === "not_found" && err.count === 0,
  );
});

test("matching is case-insensitive and whitespace-tolerant", () => {
  assert.equal(findOne(PAGE, { name: "  LIKE " }).ref, "e1");
});

test("every present field must match (role AND name), not just one", () => {
  // A link named "Like" would exist only if BOTH matched; here nothing is a link named Like.
  assert.throws(() => findOne(PAGE, { role: "link", name: "Like" }), (err) => err.code === "not_found");
});

test("disabled state is matchable, so a greyed-out control can be told apart", () => {
  assert.equal(findOne(PAGE, { name: "Post", disabled: true }).ref, "e6");
  assert.throws(() => findOne(PAGE, { name: "Post", disabled: false }), (err) => err.code === "not_found");
});

test("findFirst takes the first target that resolves to exactly one", () => {
  // First target is ambiguous (two /aj links); it must skip to the specific one, not stop or guess.
  const found = findFirst(PAGE, [
    { role: "link", hrefIncludes: "/aj" },  // 2 matches — skipped
    { href: "/aj.example/" },               // 1 match — chosen
  ]);
  assert.equal(found.element.ref, "e3");
  assert.equal(found.index, 1, "it should record that the second target won");
});

test("findFirst fails loud when no target is clean, showing what each saw", () => {
  assert.throws(
    () => findFirst(PAGE, [{ role: "link", hrefIncludes: "/aj" }, { name: "Nope" }]),
    (err) => err.code === "no_clean_match" && /→2/.test(err.message) && /→0/.test(err.message),
  );
});

test("allMatches returns every match (used by the list reader), unlike findOne", () => {
  assert.equal(allMatches(PAGE, { role: "link" }).length, 2);
});
