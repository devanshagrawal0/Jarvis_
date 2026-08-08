"use strict";

// Harvest a virtualized, infinite-scroll list (followers, following, likers, story viewers).
//
// Instagram renders these as a modal where only the ~10-20 rows near the viewport exist in the DOM
// at once — scroll down and earlier rows are DESTROYED as new ones are created. So "scroll to the
// bottom then read everything" misses almost everyone. The proven pattern (used across the working
// open-source scrapers): read the rows that exist on EVERY step, accumulate into a set keyed by a
// stable id (the username from the row's href — the one datum that never changes), scroll a step,
// and stop when the scroll height stops growing for a few steps in a row.
//
// The driver is injected, so this is proven against a fake virtualized list with zero browser.
// The driver contract:
//   rows()          -> the rows currently rendered, each an object with a stable `key`
//   scrollHeight()  -> the container's current scroll height (grows as more loads; stalls at the end)
//   scrollStep()    -> scroll down one increment (async; may load the next batch)
//   settle?()       -> optional async wait for the batch to render

async function harvestList(driver, options = {}) {
  const {
    maxItems = 0,        // 0 = no cap, read the whole list
    stallLimit = 3,      // consecutive no-growth steps that mean "we've reached the end"
    maxScrolls = 1000,   // hard safety cap so a misbehaving page can never loop forever
  } = options;

  const collected = new Map(); // key -> row; the Map both de-duplicates recycled rows and preserves
                               // first-seen order, so nobody is counted twice and nobody is lost.
  let stalls = 0;
  let scrolls = 0;
  let cappedOut = false;

  for (; scrolls <= maxScrolls; scrolls += 1) {
    // Read what is on screen RIGHT NOW, before scrolling destroys it. Every driver method is awaited
    // so the SAME reader works with a synchronous fake driver in tests and a real (async) browser
    // driver in production — awaiting a plain value is a no-op.
    for (const row of (await driver.rows()) || []) {
      if (row && row.key != null && !collected.has(row.key)) collected.set(row.key, row);
    }

    if (maxItems > 0 && collected.size >= maxItems) {
      cappedOut = true; // stopped because the caller asked for only N, not because the list ended
      break;
    }

    const before = await driver.scrollHeight();
    await driver.scrollStep();
    if (driver.settle) await driver.settle();
    const after = await driver.scrollHeight();

    // Stall = the list stopped growing. A COUNTER, not a single equality, so one slow network batch
    // does not fool us into stopping early.
    if (after <= before) {
      stalls += 1;
      if (stalls >= stallLimit) break;
    } else {
      stalls = 0;
    }
  }

  const items = [...collected.values()];
  return {
    items,
    count: items.length,
    // complete only when the list genuinely ended (stall), not when we hit the item cap or the
    // safety scroll ceiling. An honest flag so a partial read is never mistaken for the full list.
    complete: !cappedOut && scrolls <= maxScrolls && stalls >= stallLimit,
    cappedOut,
    scrolls,
  };
}

module.exports = { harvestList };
