"use strict";

// Human pacing and daily budgets — the part that actually keeps the account safe.
//
// The research is unanimous: for one real personal account, bans come from RHYTHM, not from which
// client you use. Bursts, robotic-even intervals, instant replies, and repeatedly scrolling huge
// lists are what trip Instagram. So every action is spaced with jittered human timing, typing is
// per-character, and each action type has a conservative daily cap far below Instagram's limits.
//
// Randomness and the clock are injected so this is fully testable without waiting or flaking: tests
// pass a fixed `random`/`now` and assert exact behaviour.

// Conservative daily caps — a personal assistant should never be near these. Well under the
// reported safe ceilings (~300 likes, ~80 follows/comments a day for an established account).
const DEFAULT_CAPS = Object.freeze({
  like: 60,
  follow: 20,
  unfollow: 20,
  comment: 20,
  reply: 20,
  dm: 40,
  story_view: 100,
  story_reply: 20,
  default: 40,
});

// Timing ranges in milliseconds. A think-pause before acting, jitter between actions, and per-key
// typing so text never appears instantly.
const DEFAULT_TIMING = Object.freeze({
  thinkMinMs: 1_500,
  thinkMaxMs: 4_000,
  gapMinMs: 30_000,   // between mutating actions — variance matters more than the exact number
  gapMaxMs: 90_000,
  typeMinMs: 30,      // per character
  typeMaxMs: 100,
  warmupScrollsMin: 3, // scroll the feed a few times before doing anything, like a human arriving
  warmupScrollsMax: 5,
});

// A number in [min, max], drawn from the injected random. Integer milliseconds.
function jitter(min, max, random) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(lo + (hi - lo) * random());
}

// One delay per character, each independently jittered, so typing has a human cadence.
function typingDelays(text, timing, random) {
  const { typeMinMs, typeMaxMs } = timing;
  return Array.from(String(text || ""), () => jitter(typeMinMs, typeMaxMs, random));
}

// The local day key (YYYY-MM-DD in the machine's timezone) used to roll budgets over at midnight.
function dayKey(now) {
  const d = new Date(now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Tracks how many of each action type happened today and refuses over the cap. In-memory here; a
// later wave can hand it a persistent store. Day rollover is driven by the injected clock.
class ActionBudget {
  constructor({ caps = DEFAULT_CAPS, now = Date.now, counts = {} } = {}) {
    this.caps = { ...DEFAULT_CAPS, ...caps };
    this.now = now;
    this.day = dayKey(now);
    this.counts = { ...counts };
  }

  _rollover() {
    const today = dayKey(this.now);
    if (today !== this.day) {
      this.day = today;
      this.counts = {};
    }
  }

  capFor(type) {
    return this.caps[type] != null ? this.caps[type] : this.caps.default;
  }

  used(type) {
    this._rollover();
    return this.counts[type] || 0;
  }

  remaining(type) {
    return Math.max(0, this.capFor(type) - this.used(type));
  }

  // Would one more of this type be allowed? Does NOT record it.
  allow(type) {
    return this.remaining(type) > 0;
  }

  // Record one action of this type. Throws if it would exceed the cap — a caller must check allow()
  // first; the throw is a backstop so the cap can never be silently blown past.
  record(type) {
    this._rollover();
    if (this.remaining(type) <= 0) {
      const err = new Error(`Daily budget reached for "${type}" (${this.capFor(type)}/day) — backing off until tomorrow.`);
      err.code = "budget_exceeded";
      throw err;
    }
    this.counts[type] = (this.counts[type] || 0) + 1;
    return this.counts[type];
  }
}

// The pacer bundles timing decisions. Sleeping is the caller's job (it holds the real clock); the
// pacer only decides HOW LONG, so it stays pure and testable.
function createPacer({ timing = {}, random = Math.random } = {}) {
  const t = { ...DEFAULT_TIMING, ...timing };
  return {
    timing: t,
    thinkPause: () => jitter(t.thinkMinMs, t.thinkMaxMs, random),
    actionGap: () => jitter(t.gapMinMs, t.gapMaxMs, random),
    typingDelays: (text) => typingDelays(text, t, random),
    warmupScrolls: () => jitter(t.warmupScrollsMin, t.warmupScrollsMax, random),
  };
}

module.exports = { DEFAULT_CAPS, DEFAULT_TIMING, jitter, typingDelays, dayKey, ActionBudget, createPacer };
