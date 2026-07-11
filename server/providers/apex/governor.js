"use strict";
/* APEX rate governor + poll scheduler.
   Each source has its own cadence; the governor runs its poller on that
   cadence, applies exponential backoff on failure, and reports health.
   hotReload() lets the data-health bot change cadences/enabled WITHOUT
   restarting the process (soft internal refresh). CommonJS. */

function createGovernor({ onHealth } = {}) {
  const pollers = new Map(); // id -> { fn, cadenceMs, backoff, running, timer, enabled }
  let started = false;

  function register(id, fn, cadenceSec, enabled = true) {
    pollers.set(id, { fn, cadenceMs: Math.max(1000, (cadenceSec || 300) * 1000), backoff: 1, running: false, timer: null, enabled: enabled !== false });
  }

  function schedule(id) {
    const p = pollers.get(id);
    if (!p || !started || !p.enabled) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => runOne(id), p.cadenceMs * p.backoff);
  }

  async function runOne(id) {
    const p = pollers.get(id);
    if (!p || p.running || !p.enabled) return;
    p.running = true;
    try {
      await p.fn();
      p.backoff = 1;
      onHealth && onHealth(id, "ok");
    } catch (e) {
      p.backoff = Math.min((p.backoff || 1) * 2, 8); // cap backoff at 8×
      onHealth && onHealth(id, "degraded", e && e.message);
    } finally {
      p.running = false;
      schedule(id);
    }
  }

  function start() {
    started = true;
    for (const [id, p] of pollers) if (p.enabled) runOne(id); // immediate first run, then self-schedules
  }
  function stop() {
    started = false;
    for (const p of pollers.values()) clearTimeout(p.timer);
  }

  // Soft reload — apply new cadence/enabled from the source registry live.
  function hotReload(sources = []) {
    for (const s of sources) {
      const p = pollers.get(s.id);
      if (!p) continue;
      p.cadenceMs = Math.max(1000, (s.cadence_sec || 300) * 1000);
      const wasEnabled = p.enabled;
      p.enabled = !!s.enabled;
      if (p.enabled && !wasEnabled && started) runOne(s.id);
      else if (!p.enabled) clearTimeout(p.timer);
      else schedule(s.id);
    }
  }

  return { register, start, stop, hotReload, runOne, has: (id) => pollers.has(id) };
}

module.exports = { createGovernor };
