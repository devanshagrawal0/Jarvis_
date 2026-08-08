"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAssistantProse } = require("../../server/jarvis-personality");

test("softens spaced and tight em-dashes in prose to commas", () => {
  assert.equal(
    normalizeAssistantProse("Coffee is fine — in moderation."),
    "Coffee is fine, in moderation.",
  );
  assert.equal(
    normalizeAssistantProse("compounding—whether daily or monthly—matters."),
    "compounding, whether daily or monthly, matters.",
  );
});

test("leaves numeric ranges (digit—digit) untouched", () => {
  assert.equal(normalizeAssistantProse("three to four cups, 3—4, is fine."), "three to four cups, 3—4, is fine.");
});

test("never rewrites em-dashes inside inline code or code blocks", () => {
  const inline = normalizeAssistantProse("Run `a — b` then done — really.");
  assert.ok(inline.includes("`a — b`"), "inline code em-dash preserved");
  assert.ok(inline.includes("done, really"), "prose em-dash still softened");

  const block = normalizeAssistantProse("Here:\n```js\nconst x = a — b;\n```\nThat — is it.");
  assert.ok(block.includes("a — b"), "code-block em-dash preserved");
  assert.ok(block.includes("That, is it"), "prose after block still softened");
});

test("strips eager openers and sign-off closers", () => {
  assert.equal(normalizeAssistantProse("Certainly! The answer is 42."), "The answer is 42.");
  assert.equal(normalizeAssistantProse("Sure, here it is."), "here it is.");
  assert.match(normalizeAssistantProse("The build works. I hope this helps!"), /^The build works\.\s*$/);
  assert.match(normalizeAssistantProse("Do X then Y. Let me know if you need anything else."), /^Do X then Y\.\s*$/);
  assert.match(normalizeAssistantProse("Try that. Feel free to reach out anytime."), /^Try that\.\s*$/);
  assert.match(normalizeAssistantProse("It's done. How can I assist you further?"), /^It's done\.\s*$/);
});

test("does not damage a normal clean answer", () => {
  const clean = "TCP guarantees ordered delivery. UDP does not, so it is faster.";
  assert.equal(normalizeAssistantProse(clean), clean);
});
