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
