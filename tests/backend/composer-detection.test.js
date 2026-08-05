"use strict";

// The agent could not find Instagram's message box, so no send was ever possible.
//
// Three fills in a row were refused on the real site: "Refused to place the requested message into
// an unlabeled field; a semantic message composer is required." The guard was right to refuse — one
// of those attempts targeted the notes bar — but the composer was never identified, so the run
// stalled and the task died.
//
// Inspected live (scripts/inspect-composer.mjs), Instagram's composer is:
//
//     e75   tag=div   role=textbox   name=""   aria-label=""   placeholder=""   text=""
//
// No label of any kind. Every label-based test says "not a composer".
//
// The chat-harness fixture gave its composer aria-label="Message". That is why the harness passed
// while the real site could never work: the fixture was more generous than reality. These tests run
// against the ACTUAL captured structure of a real thread, scrubbed of personal content, so the
// thing being asserted is the thing that shipped.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { findMessageComposer, isComposerLabel } = require("../../server/universal-browser-agent");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "instagram", "thread-snapshot.json"), "utf8"));

test("the real Instagram composer carries no label at all", () => {
  // The precondition. If Instagram ever labels it, this test tells us the world changed rather
  // than letting the structural path quietly become dead code.
  const composer = REAL.elements.find((element) => element.ref === "e75");
  assert.ok(composer, "e75 must exist in the captured snapshot");
  assert.equal(composer.role, "textbox");
  assert.equal([composer.name, composer.ariaLabel, composer.placeholder, composer.text].filter(Boolean).length, 0,
    "no name, aria-label, placeholder or text");
  assert.equal(isComposerLabel([composer.name, composer.ariaLabel, composer.placeholder].join(" ")), false,
    "which is exactly why every label-based check failed");
});

test("it is found anyway, by the toolbar it sits in", () => {
  const found = findMessageComposer(REAL.elements);
  assert.ok(found, "the composer must be found on the real page");
  assert.equal(found.element.ref, "e75");
  assert.equal(found.basis, "compose-toolbar", "identified by its surroundings, not a label");
});

test("it is not the search box", () => {
  // The search input is the other typable on the page and it IS labelled. Picking it would type the
  // message into search — visible nonsense, and on some surfaces a search that navigates away.
  const found = findMessageComposer(REAL.elements);
  assert.notEqual(found.element.ref, "e17");
  const search = REAL.elements.find((element) => element.ref === "e17");
  assert.match(String(search.name), /search/i, "precondition: e17 is the search field");
});

test("a labelled composer still wins, and search never does", () => {
  // Ordinary messaging surfaces label their composer. That evidence is stronger and is preferred,
  // so this change cannot regress anything that already worked.
  const elements = [
    { ref: "s1", tag: "input", role: "textbox", name: "Search" },
    { ref: "c1", tag: "div", role: "textbox", ariaLabel: "Message" },
    { ref: "b1", tag: "button", role: "button", name: "Send" },
  ];
  const found = findMessageComposer(elements);
  assert.equal(found.element.ref, "c1");
  assert.equal(found.basis, "label");
});

test("an unlabelled field with no compose toolbar around it is refused", () => {
  // The guard must not become "any typable will do". A bare unlabelled input earns nothing.
  assert.equal(findMessageComposer([
    { ref: "x1", tag: "input", role: "textbox" },
    { ref: "x2", tag: "div", role: "button", name: "Follow" },
  ]), null);

  // One lone affordance is not enough either — a page-level "Send feedback" link must not promote
  // an unrelated input.
  assert.equal(findMessageComposer([
    { ref: "x1", tag: "input", role: "textbox" },
    { ref: "x2", tag: "a", role: "link", name: "Send feedback" },
  ]), null);
});

test("a labelled search field is never promoted, however many affordances surround it", () => {
  assert.equal(findMessageComposer([
    { ref: "e1", tag: "button", role: "button", name: "Choose an emoji" },
    { ref: "e2", tag: "input", role: "textbox", name: "Search", placeholder: "Search" },
    { ref: "e3", tag: "button", role: "button", name: "Add Photo or Video" },
    { ref: "e4", tag: "button", role: "button", name: "Voice Clip" },
  ]), null, "an identity field stays an identity field");
});
