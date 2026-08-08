"use strict";

// The runner's three promises, each proven on a fake page with no browser and no AI:
//   fast   — a matching recipe replays with ZERO model calls
//   honest — an action that didn't actually land is caught by verify, never reported as success
//   durable— a broken cached target is re-found via one heal call, and the new target is cached

const test = require("node:test");
const assert = require("node:assert/strict");

const { runRecipe } = require("../../server/instagram/recipe-runner");

// A fake page whose click handler can mutate the elements, so verify has something real to check.
function fakePage(elements, { onClick } = {}) {
  let state = elements.map((e) => ({ ...e }));
  return {
    typed: [],
    pressed: [],
    clicks: [],
    async snapshot() { return { elements: state.map((e) => ({ ...e })) }; },
    async click(ref) { this.clicks.push(ref); if (onClick) state = onClick(state, ref); },
    async type(ref, text) { this.typed.push({ ref, text }); },
    async press(ref, key) { this.pressed.push({ ref, key }); },
  };
}

// A "follow" recipe: click the Follow button, then verify a "Following" control now exists.
const FOLLOW_RECIPE = {
  name: "follow",
  steps: [
    { do: "click", find: { role: "button", name: "Follow" }, verify: { role: "button", name: "Following" } },
  ],
};

test("a matching recipe replays with ZERO AI calls (this is the speed property)", async () => {
  // Clicking Follow flips the button to Following → verify passes.
  const page = fakePage(
    [{ ref: "b1", role: "button", name: "Follow" }],
    { onClick: (s) => s.map((e) => (e.ref === "b1" ? { ...e, name: "Following" } : e)) },
  );
  const out = await runRecipe(FOLLOW_RECIPE, page);
  assert.equal(out.ok, true);
  assert.equal(out.aiCalls, 0, "replay must never call the model");
  assert.deepEqual(page.clicks, ["b1"]);
});

test("verify catches a soft-fail: the click happened but the effect did not", async () => {
  // Clicking does NOT flip the button (Instagram silently no-op'd) → verify must fail, not pass.
  const page = fakePage([{ ref: "b1", role: "button", name: "Follow" }], { onClick: (s) => s });
  const out = await runRecipe(FOLLOW_RECIPE, page);
  assert.equal(out.ok, false, "an unverified action must never be reported as success");
  assert.equal(out.steps[0].code, "verify_failed");
  assert.deepEqual(page.clicks, ["b1"], "the click still happened; it's the RESULT that failed");
});

test("a broken cached target is healed once, and the healed target is cached back", async () => {
  // The page renamed the button to "Follow back" — the cached {name:'Follow'} no longer matches.
  const page = fakePage(
    [{ ref: "b9", role: "button", name: "Follow back" }],
    { onClick: (s) => s.map((e) => (e.ref === "b9" ? { ...e, name: "Following" } : e)) },
  );
  let healArgs = null;
  const heal = async (ctx) => { healArgs = ctx; return { role: "button", nameIncludes: "follow" }; };

  const out = await runRecipe(FOLLOW_RECIPE, page, { heal });
  assert.equal(out.ok, true);
  assert.equal(out.aiCalls, 1, "heal is used exactly once, only because the cached target broke");
  assert.ok(healArgs && healArgs.error, "heal receives the find error for context");
  // The returned recipe carries the healed target so the NEXT run replays with zero AI again.
  assert.deepEqual(out.recipe.steps[0].find, { role: "button", nameIncludes: "follow" });
});

test("no heal available + broken target = honest failure, not a guess", async () => {
  const page = fakePage([{ ref: "b9", role: "button", name: "Follow back" }]);
  const out = await runRecipe(FOLLOW_RECIPE, page); // no heal supplied
  assert.equal(out.ok, false);
  assert.equal(out.steps[0].code, "not_found");
});

test("an ambiguous target refuses rather than clicking one of two", async () => {
  const page = fakePage([
    { ref: "b1", role: "button", name: "Follow" },
    { ref: "b2", role: "button", name: "Follow" },
  ]);
  const out = await runRecipe(FOLLOW_RECIPE, page);
  assert.equal(out.ok, false);
  assert.equal(out.steps[0].code, "ambiguous");
  assert.deepEqual(page.clicks, [], "nothing may be clicked when the target is ambiguous");
});

test("a type step types the exact value; a read step surfaces the element", async () => {
  const page = fakePage([
    { ref: "box", role: "textbox", name: "Add a comment…" },
    { ref: "hdr", role: "heading", name: "aj", text: "aj" },
  ]);
  const recipe = {
    name: "comment-and-read",
    steps: [
      { do: "type", find: { role: "textbox" }, value: "nice one" },
      { do: "read", find: { role: "heading" } },
    ],
  };
  const out = await runRecipe(recipe, page);
  assert.equal(out.ok, true);
  assert.deepEqual(page.typed, [{ ref: "box", text: "nice one" }]);
  assert.equal(out.steps[1].value.text, "aj", "a read step returns the element it resolved");
});

test("with a pacer, typing waits per character (human cadence) but stays deterministic in test", async () => {
  const page = fakePage([{ ref: "box", role: "textbox", name: "Add a comment…" }]);
  const sleeps = [];
  const pacer = { thinkPause: () => 5, typingDelays: (t) => Array.from(String(t), () => 7) };
  const out = await runRecipe(
    { name: "t", steps: [{ do: "type", find: { role: "textbox" }, value: "hi" }] },
    page,
    { pacer, sleep: async (ms) => { sleeps.push(ms); } },
  );
  assert.equal(out.ok, true);
  // one think-pause (5) + one delay per character of "hi" (7,7)
  assert.deepEqual(sleeps, [5, 7, 7]);
});
