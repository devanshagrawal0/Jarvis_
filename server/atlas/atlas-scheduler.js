"use strict";

// ATLAS durable reminder scheduler. Guarantees the Wave-1 promise: a reminder fires ON TIME,
// SURVIVES A RESTART, and fires EXACTLY ONCE.
//   • On time  — a short tick (default 20s) claims anything now due.
//   • Survives restart — reminders live in SQLite, not in memory; on boot we immediately run a
//     catch-up pass so anything that came due while the process was down fires once, now.
//   • Exactly once — claiming is a single atomic UPDATE ... WHERE fired_at IS NULL (see
//     atlas-store.claimDueReminders); a duplicate tick or a crash mid-delivery cannot re-fire.
// Delivery is injected (deliver callback) so this module has no dependency on push/notification
// internals and stays unit-testable. Recurrence is intentionally NOT expanded here — that is the
// Wave-2 temporal engine's job; Wave-1 reminders are one-shot.

const { nextOccurrence, DEFAULT_TZ } = require("./atlas-capture");

function createAtlasScheduler({ store, deliver, intervalMs = 20_000, logger = console } = {}) {
  if (!store) throw new Error("atlas-scheduler needs a store");
  let timer = null;
  let running = false;
  let ticks = 0;
  let fired = 0;

  async function fire(reminder) {
    try {
      await Promise.resolve(deliver ? deliver(reminder) : null);
    } catch (e) {
      // Delivery failed AFTER the row was claimed. We do NOT un-claim: re-firing risks duplicate
      // notifications, which is the worse failure for a personal assistant. Surface it instead.
      logger?.warn?.(`[atlas] reminder ${reminder.id} claimed but delivery failed: ${e?.message || e}`);
    }
    // Re-arming a recurring reminder is the DELIVERY callback's job, and only its job — see the
    // `deliver` handler in server.js, which schedules the next occurrence from max(scheduled, now).
    //
    // A second re-arm used to live here, running immediately after that one, so every fire of a
    // repeating reminder created TWO next occurrences instead of one. That is a doubling, and it
    // compounds: a single "Stretch, every 2 hours" grew to 524,288 pending rows — 2^19, one
    // doubling per fire — and 1,048,633 rows in the table. Every read of the day-model then pulled
    // half a million rows, and each generation was queued to fire, notify and re-arm together.
    //
    // It is left out rather than deduplicated because this module's contract (see the header) is
    // claim-and-fire-exactly-once; expanding recurrence here contradicts it and is what allowed two
    // owners of the same job to exist without either knowing about the other.
  }

  async function tick(asOfIso) {
    if (running) return { skipped: true }; // never overlap ticks
    running = true;
    try {
      ticks += 1;
      const due = store.claimDueReminders(asOfIso); // atomic claim — each row returned is ours alone
      for (const r of due) { await fire(r); fired += 1; }
      return { fired: due.length };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    // Catch-up pass first: fire anything that came due while we were down, exactly once.
    tick().catch((e) => logger?.warn?.(`[atlas] catch-up tick failed: ${e?.message || e}`));
    timer = setInterval(() => { tick().catch((e) => logger?.warn?.(`[atlas] tick failed: ${e?.message || e}`)); }, intervalMs);
    if (timer.unref) timer.unref();
    logger?.log?.(`[atlas] reminder scheduler started (tick ${Math.round(intervalMs / 1000)}s)`);
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function stats() { return { ticks, fired, running, intervalMs }; }

  return { start, stop, tick, stats };
}

module.exports = { createAtlasScheduler };
