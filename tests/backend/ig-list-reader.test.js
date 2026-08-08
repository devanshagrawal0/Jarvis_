"use strict";

// The list reader must get EVERYONE out of a virtualized list where rows are destroyed as you
// scroll — the exact thing a naive "read once at the bottom" gets wrong.

const test = require("node:test");
const assert = require("node:assert/strict");

const { harvestList } = require("../../server/instagram/list-reader");

// A fake virtualized list: `total` people, but only a sliding WINDOW of them is ever "rendered".
// Scrolling advances the window and grows the height until the end — exactly Instagram's behaviour,
// including that early rows vanish once you've scrolled past them.
function fakeVirtualList(total, windowSize = 12, step = 6) {
  let top = 0;
  return {
    rows() {
      const rows = [];
      for (let i = top; i < Math.min(top + windowSize, total); i += 1) {
        rows.push({ key: `user${i}`, username: `user${i}` });
      }
      return rows;
    },
    scrollHeight() {
      // Height grows with how far down the loaded content reaches, and stops once fully loaded.
      return Math.min(top + windowSize, total);
    },
    async scrollStep() { top = Math.min(top + step, Math.max(0, total - windowSize)); },
  };
}

test("harvests every person from a virtualized list, none missed, none duplicated", async () => {
  const result = await harvestList(fakeVirtualList(500), { stallLimit: 2 });
  assert.equal(result.count, 500, `expected 500, got ${result.count}`);
  assert.equal(new Set(result.items.map((i) => i.key)).size, 500, "no duplicates");
  // spot check the ends
  assert.ok(result.items.some((i) => i.key === "user0"));
  assert.ok(result.items.some((i) => i.key === "user499"));
  assert.equal(result.complete, true, "a fully-read list must report complete");
});

test("a tiny list that fits on screen is read without needing to scroll to the end falsely", async () => {
  const result = await harvestList(fakeVirtualList(5), { stallLimit: 2 });
  assert.equal(result.count, 5);
  assert.equal(result.complete, true);
});

test("the item cap stops early and marks the read as NOT complete", async () => {
  const result = await harvestList(fakeVirtualList(500), { maxItems: 50, stallLimit: 2 });
  assert.ok(result.count >= 50 && result.count < 500);
  assert.equal(result.cappedOut, true);
  assert.equal(result.complete, false, "a capped read must never claim to be the whole list");
});

test("a single slow (no-growth) step does not fool it into stopping early", async () => {
  // Inject one stall in the middle; with stallLimit 3 it must keep going and still get everyone.
  const base = fakeVirtualList(300);
  let stallOnce = true;
  const driver = {
    rows: () => base.rows(),
    scrollHeight: () => base.scrollHeight(),
    async scrollStep() {
      if (stallOnce && base.scrollHeight() > 100) { stallOnce = false; return; } // one no-op step
      await base.scrollStep();
    },
  };
  const result = await harvestList(driver, { stallLimit: 3 });
  assert.equal(result.count, 300, "one transient stall must not cut the read short");
});

test("the safety scroll ceiling prevents an infinite loop on a misbehaving page", async () => {
  // A page that grows forever and never stalls must still terminate (and admit it's incomplete).
  let h = 0;
  const driver = {
    rows: () => [{ key: `k${h}` }],
    scrollHeight: () => h,
    async scrollStep() { h += 1; }, // always grows → never stalls
  };
  const result = await harvestList(driver, { maxScrolls: 20, stallLimit: 3 });
  assert.ok(result.scrolls <= 21, "must stop at the safety ceiling");
  assert.equal(result.complete, false, "hitting the ceiling is not a complete read");
});
