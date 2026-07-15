"use strict";
/* APEX — Paper Bots. Rule-based strategies that evaluate against live bars and
   trade automatically. Powers two rooms: Trading Bots (manage/deploy) and
   Live Testing (watch them run, forward-test).

   PAPER TRADE ONLY. Bots have no broker path of any kind — every order they
   place goes through the injected paper desk (apex-paper), which itself is a
   pure simulation. There is deliberately no code path from a bot to a venue.

   Strategies are long/flat only: a buy opens, a sell closes. Signals are
   derived from indicator crossovers computed on public bars (Yahoo).
   CommonJS, better-sqlite3. */

const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const { yahooChart } = require("../providers/apex/adapters");

const TICK_MS = 60000;        // evaluate running bots once a minute
const BARS_TTL = 55000;       // bar cache, just under the tick
// Every round trip pays slippage + commission. On 5-minute bars an unthrottled
// rule can flip dozens of times a day and bleed purely on costs, which is what
// made the demo bot look "active" while being guaranteed to lose. A cooldown
// makes the forward test measure the RULE rather than the churn.
const COOLDOWN_DEFAULT = { "5m": 15, "1d": 0 };
const id = () => crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

/* ── Indicators (return full arrays so callers can inspect prev vs current) ── */
function sma(v, p) {
  const out = new Array(v.length).fill(null);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= p) sum -= v[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}
function rsi(v, p) {
  const out = new Array(v.length).fill(null);
  if (v.length <= p) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; if (d >= 0) gain += d; else loss -= d; }
  let ag = gain / p, al = loss / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
const donchian = (v, p, hi) => {
  const out = new Array(v.length).fill(null);
  for (let i = p; i < v.length; i++) {
    const w = v.slice(i - p, i); // prior p bars, excludes the current one
    out[i] = hi ? Math.max(...w) : Math.min(...w);
  }
  return out;
};

// These are mechanical baselines for exercising the forward-test machinery —
// they are not alpha, and nothing here should be mistaken for one. What the
// guards below DO prevent is the configurations that are arithmetically
// guaranteed to lose: a "breakout" with a 1-bar lookback is just "price ticked
// up", fires constantly, and pays slippage + commission on every flip.
const KINDS = {
  sma_cross: {
    label: "SMA crossover",
    defaults: { fast: 10, slow: 30 },
    describe: (p) => `Buy when SMA${p.fast} crosses above SMA${p.slow}; sell on cross below`,
    validate: (p) => {
      if (!(p.fast >= 2)) return "fast must be at least 2";
      if (!(p.slow > p.fast)) return "slow must be greater than fast — otherwise the lines never cross meaningfully";
      if (p.slow > 400) return "slow must be 400 or less";
      return null;
    },
    evaluate(closes, p) {
      const f = sma(closes, p.fast), s = sma(closes, p.slow);
      const i = closes.length - 1;
      const fc = f[i], sc = s[i], fp = f[i - 1], sp = s[i - 1];
      if (fc == null || sc == null || fp == null || sp == null) return { action: null, values: { fast: fc, slow: sc }, note: "warming up" };
      const values = { fast: +fc.toFixed(4), slow: +sc.toFixed(4), spread: +(fc - sc).toFixed(4) };
      if (fp <= sp && fc > sc) return { action: "buy", values, note: `SMA${p.fast} crossed above SMA${p.slow}` };
      if (fp >= sp && fc < sc) return { action: "sell", values, note: `SMA${p.fast} crossed below SMA${p.slow}` };
      return { action: null, values, note: fc > sc ? "fast above slow — holding" : "fast below slow — flat" };
    },
  },
  rsi: {
    label: "RSI reversion",
    defaults: { period: 14, oversold: 30, overbought: 70 },
    describe: (p) => `Buy when RSI${p.period} drops below ${p.oversold}; sell when it rises above ${p.overbought}`,
    validate: (p) => {
      if (!(p.period >= 2)) return "period must be at least 2";
      if (!(p.oversold > 0 && p.oversold < 100)) return "oversold must be between 0 and 100";
      if (!(p.overbought > 0 && p.overbought < 100)) return "overbought must be between 0 and 100";
      if (!(p.overbought > p.oversold)) return "overbought must be above oversold";
      return null;
    },
    evaluate(closes, p) {
      const r = rsi(closes, p.period);
      const i = closes.length - 1;
      const cur = r[i], prev = r[i - 1];
      if (cur == null || prev == null) return { action: null, values: { rsi: cur }, note: "warming up" };
      const values = { rsi: +cur.toFixed(2) };
      if (prev >= p.oversold && cur < p.oversold) return { action: "buy", values, note: `RSI fell below ${p.oversold}` };
      if (prev <= p.overbought && cur > p.overbought) return { action: "sell", values, note: `RSI rose above ${p.overbought}` };
      return { action: null, values, note: `RSI ${cur.toFixed(1)} — between bands` };
    },
  },
  breakout: {
    label: "Donchian breakout",
    defaults: { period: 20 },
    describe: (p) => `Buy on a ${p.period}-bar high breakout; sell on a ${p.period}-bar low breakdown`,
    validate: (p) => {
      // The 1-bar version I demoed fires on ~any uptick and churns commission.
      if (!(p.period >= 5)) return "period must be at least 5 — a 1–4 bar breakout is noise, not a breakout, and just pays costs";
      if (p.period > 200) return "period must be 200 or less";
      return null;
    },
    evaluate(closes, p) {
      const hi = donchian(closes, p.period, true), lo = donchian(closes, p.period, false);
      const i = closes.length - 1;
      const h = hi[i], l = lo[i], c = closes[i];
      if (h == null || l == null) return { action: null, values: { close: c }, note: "warming up" };
      const values = { close: +c.toFixed(4), high: +h.toFixed(4), low: +l.toFixed(4) };
      if (c > h) return { action: "buy", values, note: `Broke above the ${p.period}-bar high` };
      if (c < l) return { action: "sell", values, note: `Broke below the ${p.period}-bar low` };
      return { action: null, values, note: "inside the channel" };
    },
  },
};

function createApexBots({ runtimeDir, paper }) {
  const db = new Database(path.join(runtimeDir, "apex.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS apex_bots (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, ticker TEXT NOT NULL, kind TEXT NOT NULL,
      params_json TEXT, qty REAL, interval TEXT, status TEXT, created_at TEXT NOT NULL,
      last_eval TEXT, last_signal TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_bot_events (
      id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, ts TEXT NOT NULL, kind TEXT, note TEXT, detail_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_events ON apex_bot_events (bot_id, ts DESC);
  `);
  // Non-destructive migration for bots created before cooldowns existed.
  try { db.exec(`ALTER TABLE apex_bots ADD COLUMN cooldown_min REAL`); } catch { /* already there */ }

  const S = {
    list: db.prepare(`SELECT * FROM apex_bots ORDER BY created_at DESC`),
    get: db.prepare(`SELECT * FROM apex_bots WHERE id = ?`),
    running: db.prepare(`SELECT * FROM apex_bots WHERE status = 'running'`),
    ins: db.prepare(`INSERT INTO apex_bots (id, name, ticker, kind, params_json, qty, interval, status, created_at, last_eval, last_signal, cooldown_min)
      VALUES (@id, @name, @ticker, @kind, @params_json, @qty, @interval, @status, @created_at, NULL, NULL, @cooldown_min)`),
    lastFill: db.prepare(`SELECT ts FROM apex_bot_events WHERE bot_id = ? AND kind = 'fill' ORDER BY ts DESC LIMIT 1`),
    setStatus: db.prepare(`UPDATE apex_bots SET status = ? WHERE id = ?`),
    setEval: db.prepare(`UPDATE apex_bots SET last_eval = ? WHERE id = ?`),
    setSignal: db.prepare(`UPDATE apex_bots SET last_signal = ? WHERE id = ?`),
    del: db.prepare(`DELETE FROM apex_bots WHERE id = ?`),
    delEvents: db.prepare(`DELETE FROM apex_bot_events WHERE bot_id = ?`),
    insEvent: db.prepare(`INSERT INTO apex_bot_events (id, bot_id, ts, kind, note, detail_json) VALUES (@id, @bot_id, @ts, @kind, @note, @detail_json)`),
    events: db.prepare(`SELECT * FROM apex_bot_events WHERE bot_id = ? ORDER BY ts DESC LIMIT ?`),
    allEvents: db.prepare(`SELECT * FROM apex_bot_events ORDER BY ts DESC LIMIT ?`),
    counts: db.prepare(`SELECT kind, COUNT(*) n FROM apex_bot_events WHERE bot_id = ? GROUP BY kind`),
  };

  const log = (botId, kind, note, detail) =>
    S.insEvent.run({ id: id(), bot_id: botId, ts: now(), kind, note: note || "", detail_json: detail ? JSON.stringify(detail) : null });

  // ── Bars, cached per (ticker, interval) so one cycle costs a single fetch per
  // pair even when several bots share a ticker. A manual check passes fresh so
  // the user sees current bars rather than up-to-a-minute-old ones. ──
  const barCache = new Map();
  async function closesFor(ticker, interval, fresh = false) {
    const key = `${ticker}|${interval}`;
    const c = barCache.get(key);
    if (!fresh && c && Date.now() - c.at < BARS_TTL) return c.closes;
    const range = interval === "1d" ? "6mo" : "5d";
    const chart = await yahooChart(ticker, range, interval);
    const closes = (chart.bars || []).map((b) => b.c).filter((x) => x != null);
    barCache.set(key, { closes, at: Date.now() });
    return closes;
  }

  const parse = (b) => ({
    id: b.id, name: b.name, ticker: b.ticker, kind: b.kind,
    params: JSON.parse(b.params_json || "{}"), qty: b.qty, interval: b.interval,
    status: b.status, createdAt: b.created_at, lastEval: b.last_eval, lastSignal: b.last_signal,
    cooldownMin: b.cooldown_min == null ? (COOLDOWN_DEFAULT[b.interval] ?? 0) : b.cooldown_min,
  });

  // ── Evaluate one bot; trade through the paper desk when a signal fires ──
  async function evaluateBot(row, positions, fresh = false) {
    const bot = parse(row);
    const spec = KINDS[bot.kind];
    if (!spec) { log(bot.id, "error", `Unknown strategy "${bot.kind}"`); return null; }
    let closes;
    try { closes = await closesFor(bot.ticker, bot.interval, fresh); }
    catch (e) { log(bot.id, "error", `Bar fetch failed: ${e.message}`); return null; }
    if (closes.length < 5) { log(bot.id, "error", `No bars for ${bot.ticker}`); return null; }

    const res = spec.evaluate(closes, { ...spec.defaults, ...bot.params });
    const held = positions?.[bot.ticker] ?? 0;
    const last = closes[closes.length - 1];
    S.setEval.run(now(), bot.id);

    let acted = null;
    // Long/flat only: buy opens when flat, sell closes when long.
    if (res.action === "buy" && held <= 0) acted = { side: "buy", qty: bot.qty };
    else if (res.action === "sell" && held > 0) acted = { side: "sell", qty: held };

    // Cooldown: a real signal too soon after the last fill is churn, not edge.
    if (acted && bot.cooldownMin > 0) {
      const lf = S.lastFill.get(bot.id);
      const sinceMin = lf ? (Date.now() - Date.parse(lf.ts)) / 60000 : Infinity;
      if (sinceMin < bot.cooldownMin) {
        log(bot.id, "signal", `${res.action.toUpperCase()} signal ignored — cooldown (${Math.ceil(bot.cooldownMin - sinceMin)}m left of ${bot.cooldownMin}m)`, { ...res.values, last });
        S.setSignal.run(now(), bot.id);
        return res;
      }
    }

    if (res.action && !acted) {
      log(bot.id, "signal", `${res.action.toUpperCase()} signal ignored — ${res.action === "buy" ? "already long" : "not long"}`, { ...res.values, last });
      S.setSignal.run(now(), bot.id);
    } else if (acted) {
      log(bot.id, "signal", `${res.action.toUpperCase()} — ${res.note}`, { ...res.values, last });
      S.setSignal.run(now(), bot.id);
      try {
        const r = await paper.place({ ticker: bot.ticker, side: acted.side, qty: acted.qty, type: "market" });
        // Keep the caller's position map current so a later bot on the same
        // ticker (or the next evaluation) sees this fill rather than stale state.
        if (positions) positions[bot.ticker] = held + (acted.side === "buy" ? acted.qty : -acted.qty);
        log(bot.id, "fill", `${acted.side.toUpperCase()} ${acted.qty} ${bot.ticker} @ $${r.fillPrice}`, { fillPrice: r.fillPrice, qty: acted.qty, side: acted.side });
      } catch (e) {
        log(bot.id, "error", `Order rejected: ${e.message}`);
      }
    } else {
      log(bot.id, "eval", res.note, { ...res.values, last });
    }
    return res;
  }

  // ── Runner ──
  // Every evaluation (scheduled tick OR manual check) runs through this queue.
  // Without it a manual check can interleave with a tick, both read a flat
  // position, and both open — double-filling the same signal.
  let queue = Promise.resolve();
  const serialize = (fn) => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };

  async function cycle() {
    const rows = S.running.all();
    if (!rows.length) return;
    const m = await paper.mark(true).catch(() => ({ positions: [] }));
    const positions = Object.fromEntries((m.positions || []).map((p) => [p.ticker, p.qty]));
    for (const row of rows) await evaluateBot(row, positions).catch(() => {});
  }

  let busy = false; // keeps slow cycles from piling up behind the timer
  function tick() {
    if (busy) return Promise.resolve();
    return serialize(async () => { busy = true; try { await cycle(); } finally { busy = false; } });
  }
  const timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  if (timer.unref) timer.unref();

  // ── Public API ──
  async function list() {
    const rows = S.list.all().map(parse);
    const m = await paper.mark().catch(() => ({ positions: [] }));
    const byTicker = Object.fromEntries((m.positions || []).map((p) => [p.ticker, p]));
    return {
      bots: rows.map((b) => {
        const counts = Object.fromEntries(S.counts.all(b.id).map((c) => [c.kind, c.n]));
        const pos = byTicker[b.ticker];
        return {
          ...b,
          describe: KINDS[b.kind] ? KINDS[b.kind].describe({ ...KINDS[b.kind].defaults, ...b.params }) : b.kind,
          signals: counts.signal || 0, fills: counts.fill || 0, errors: counts.error || 0,
          position: pos ? { qty: pos.qty, avgPrice: pos.avgPrice, last: pos.last, unrealized: pos.unrealized, unrealizedPct: pos.unrealizedPct } : null,
        };
      }),
      kinds: Object.entries(KINDS).map(([k, v]) => ({ kind: k, label: v.label, defaults: v.defaults })),
    };
  }

  function create(b) {
    const kind = String(b.kind || "");
    if (!KINDS[kind]) throw err(`Unknown strategy "${kind}"`, 400);
    const ticker = String(b.ticker || "").trim().toUpperCase();
    if (!ticker) throw err("Ticker required", 400);
    const qty = Number(b.qty);
    if (!(qty > 0)) throw err("Quantity must be positive", 400);
    const interval = b.interval === "1d" ? "1d" : "5m";
    const params = { ...KINDS[kind].defaults, ...(b.params || {}) };
    for (const [k, v] of Object.entries(params)) {
      if (!Number.isFinite(Number(v))) throw err(`Parameter ${k} must be a number`, 400);
      params[k] = Number(v);
    }
    // Reject configurations that can only lose, rather than letting them run and
    // quietly bleed costs.
    const bad = KINDS[kind].validate ? KINDS[kind].validate(params) : null;
    if (bad) throw err(bad, 400);
    const cooldownMin = b.cooldownMin == null ? COOLDOWN_DEFAULT[interval] : Number(b.cooldownMin);
    if (!Number.isFinite(cooldownMin) || cooldownMin < 0) throw err("Cooldown must be 0 or more minutes", 400);
    const row = {
      id: id(), name: String(b.name || `${ticker} ${KINDS[kind].label}`).slice(0, 60), ticker, kind,
      params_json: JSON.stringify(params), qty, interval, status: "paused", created_at: now(),
      cooldown_min: cooldownMin,
    };
    S.ins.run(row);
    log(row.id, "eval", `Bot created — ${KINDS[kind].describe(params)}`);
    return { ok: true, id: row.id };
  }

  function setStatus(botId, status) {
    const b = S.get.get(String(botId || ""));
    if (!b) throw err("Bot not found", 404);
    if (status !== "running" && status !== "paused") throw err("Bad status", 400);
    S.setStatus.run(status, b.id);
    log(b.id, "eval", status === "running" ? "Deployed — evaluating every minute" : "Paused");
    if (status === "running") tick().catch(() => {});   // evaluate immediately on deploy
    return { ok: true, status };
  }

  function remove(botId) {
    const b = S.get.get(String(botId || ""));
    if (!b) throw err("Bot not found", 404);
    S.del.run(b.id); S.delEvents.run(b.id);
    return { ok: true };
  }

  async function evaluateOnce(botId) {
    const b = S.get.get(String(botId || ""));
    if (!b) throw err("Bot not found", 404);
    return serialize(async () => {
      const m = await paper.mark(true).catch(() => ({ positions: [] }));
      const positions = Object.fromEntries((m.positions || []).map((p) => [p.ticker, p.qty]));
      const res = await evaluateBot(b, positions, true);
      return { ok: true, result: res };
    });
  }

  const events = (botId, limit = 60) =>
    ({ events: (botId ? S.events.all(String(botId), limit) : S.allEvents.all(limit)).map((e) => ({
      id: e.id, botId: e.bot_id, ts: e.ts, kind: e.kind, note: e.note,
      detail: e.detail_json ? JSON.parse(e.detail_json) : null,
    })) });

  return { list, create, setStatus, remove, evaluateOnce, events, tick, KINDS };
}

function err(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

module.exports = { createApexBots };
