"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveEntity, scoreCandidate } = require("../../server/automation/entity-resolver");

test("resolves an exact Instagram handle from profile URL evidence", () => {
  const candidate = { ref: "profile-1", role: "link", name: "Open profile", href: "https://www.instagram.com/raghav.mittal/" };
  assert.equal(scoreCandidate("@raghav.mittal", candidate), 1);
  const result = resolveEntity("@raghav.mittal", [candidate]);
  assert.equal(result.status, "resolved");
  assert.equal(result.match.ref, "profile-1");
});

test("deduplicates repeated accessibility controls that point to the same profile", () => {
  const result = resolveEntity("Raghav Mittal", [
    { ref: "row", role: "link", name: "Raghav Mittal", href: "/raghav.mittal/" },
    { ref: "avatar", role: "link", ariaLabel: "Raghav Mittal", href: "/raghav.mittal/" },
    { ref: "text", role: "heading", text: "Raghav Mittal" },
  ]);
  assert.equal(result.status, "resolved");
  assert.match(result.match.ref, /row|avatar/);
});

test("blocks two different profiles with the same display name", () => {
  const result = resolveEntity("Raghav Mittal", [
    { ref: "one", role: "link", name: "Raghav Mittal", href: "/raghav.one/" },
    { ref: "two", role: "link", name: "Raghav Mittal", href: "/raghav.two/" },
  ]);
  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("does not treat the text typed into a search box as identity evidence", () => {
  const result = resolveEntity("Raghav Mittal", [
    { ref: "search", role: "searchbox", name: "Search", value: "Raghav Mittal" },
  ]);
  assert.equal(result.status, "not_found");
});

test("near-tied fuzzy names remain ambiguous before a consequential action", () => {
  const result = resolveEntity("Raghav Mittal", [
    { ref: "one", role: "link", name: "Raghav Mital", href: "/raghav.mital/" },
    { ref: "two", role: "link", name: "Raghav Mitt", href: "/raghav.mitt/" },
  ]);
  assert.equal(result.status, "ambiguous");
});
