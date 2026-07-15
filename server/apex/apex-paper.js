"use strict";
/* APEX — Paper Trading engine. A fully LOCAL, virtual trading desk: simulated
   fills against live public quotes (Yahoo) with slippage + commission, signed
   positions (long/short), a fills journal, an equity curve, and P&L metrics.

   PAPER TRADE ONLY. This engine NEVER touches a live broker. It has no broker
   credentials and no network path to any order venue — it only READS public
   quotes to mark and fill a purely virtual account persisted in apex.sqlite.

   Accounting model (internally consistent for long AND short):
     position.qty is SIGNED (+long / −short); cash is pure cash-flow.
     equity      = cash + Σ(qty · last)
     unrealized  = Σ(qty · (last − avg))
     realized    accumulates as positions are reduced/closed.
   CommonJS, better-sqlite3. */

const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const { yahooQuotes } = require("../providers/apex/adapters");

const START_CASH = 100000;   // $100k virtual account
const SLIP_BPS = 3;          // 0.03% slippage on market/marketable fills
const COMM_BPS = 1;          // 0.01% commission per fill (a few $/trade)
const EPS = 1e-6;
const id = () => crypto.randomBytes(9).toString("hex");
const now = () => new Date().toISOString();

function createApexPaper(runtimeDir) {
  const db = new Database(path.join(runtimeDir, "apex.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS apex_positions (
      id TEXT PRIMARY KEY, ticker TEXT NOT NULL, qty REAL, avg_price REAL, side TEXT, opened_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_orders (
      id TEXT PRIMARY KEY, ticker TEXT NOT NULL, side TEXT, type TEXT, qty REAL, price REAL,
      status TEXT, algo TEXT, created_at TEXT NOT NULL, filled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_fills (
      id TEXT PRIMARY KEY, order_id TEXT, ticker TEXT, qty REAL, price REAL, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_equity_curve (
      ts TEXT PRIMARY KEY, equity REAL, cash REAL, buying_power REAL, unrealized REAL, realized REAL
    );
    CREATE TABLE IF NOT EXISTS apex_paper_account (
      id INTEGER PRIMARY KEY CHECK (id = 1), cash REAL, realized REAL, start_cash REAL, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_paper_closes (
      id TEXT PRIMARY KEY, ticker TEXT, qty REAL, pnl REAL, ts TEXT NOT NULL
    );
  `);

  const S = {
    getAcct: db.prepare(`SELECT * FROM apex_paper_account WHERE id = 1`),
    initAcct: db.prepare(`INSERT OR IGNORE INTO apex_paper_account (id, cash, realized, start_cash, created_at) VALUES (1, ?, 0, ?, ?)`),
    setAcct: db.prepare(`UPDATE apex_paper_account SET cash = ?, realized = ? WHERE id = 1`),
    getPos: db.prepare(`SELECT * FROM apex_positions WHERE id = ?`),
    listPos: db.prepare(`SELECT * FROM apex_positions WHERE ABS(qty) > ${EPS} ORDER BY opened_at`),
    upPos: db.prepare(`INSERT INTO apex_positions (id, ticker, qty, avg_price, side, opened_at)
      VALUES (@id, @ticker, @qty, @avg_price, @side, @opened_at)
      ON CONFLICT(id) DO UPDATE SET qty=@qty, avg_price=@avg_price, side=@side`),
    delPos: db.prepare(`DELETE FROM apex_positions WHERE id = ?`),
    insOrder: db.prepare(`INSERT INTO apex_orders (id, ticker, side, type, qty, price, status, algo, created_at, filled_at)
      VALUES (@id, @ticker, @side, @type, @qty, @price, @status, @algo, @created_at, @filled_at)`),
    setOrder: db.prepare(`UPDATE apex_orders SET status = ?, price = ?, filled_at = ? WHERE id = ?`),
    cancelOrder: db.prepare(`UPDATE apex_orders SET status = 'canceled', filled_at = ? WHERE id = ? AND status = 'open'`),
    getOrder: db.prepare(`SELECT * FROM apex_orders WHERE id = ?`),
    listOpen: db.prepare(`SELECT * FROM apex_orders WHERE status = 'open' ORDER BY created_at DESC`),
    listOrders: db.prepare(`SELECT * FROM apex_orders ORDER BY created_at DESC LIMIT ?`),
    insFill: db.prepare(`INSERT INTO apex_fills (id, order_id, ticker, qty, price, ts) VALUES (@id, @order_id, @ticker, @qty, @price, @ts)`),
    listFills: db.prepare(`SELECT * FROM apex_fills ORDER BY ts DESC LIMIT ?`),
    insClose: db.prepare(`INSERT INTO apex_paper_closes (id, ticker, qty, pnl, ts) VALUES (@id, @ticker, @qty, @pnl, @ts)`),
    listCloses: db.prepare(`SELECT * FROM apex_paper_closes ORDER BY ts DESC LIMIT ?`),
    closeStats: db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins,
      AVG(CASE WHEN pnl > 0 THEN pnl END) avgWin, AVG(CASE WHEN pnl < 0 THEN pnl END) avgLoss,
      SUM(pnl) sumPnl FROM apex_paper_closes`),
    insEquity: db.prepare(`INSERT OR REPLACE INTO apex_equity_curve (ts, equity, cash, buying_power, unrealized, realized) VALUES (?, ?, ?, ?, ?, ?)`),
    listEquity: db.prepare(`SELECT * FROM apex_equity_curve ORDER BY ts DESC LIMIT ?`),
    firstToday: db.prepare(`SELECT equity FROM apex_equity_curve WHERE ts >= ? ORDER BY ts LIMIT 1`),
    wipe: db.transaction(() => {
      db.exec(`DELETE FROM apex_positions; DELETE FROM apex_orders; DELETE FROM apex_fills; DELETE FROM apex_paper_closes; DELETE FROM apex_equity_curve;`);
    }),
  };

  S.initAcct.run(START_CASH, START_CASH, now());
  const acct = () => S.getAcct.get() || { cash: START_CASH, realized: 0, start_cash: START_CASH };

  // ── Live quote lookup (public Yahoo). A short 2.5s cache only dedupes rapid
  // refetches within one request; callers on the money/mark path pass fresh=true
  // so fills and position marks always reflect live prices.
  const qCache = new Map(); // sym -> { last, at }
  async function quotes(tickers, fresh = false) {
    const uniq = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean);
    const stale = uniq.filter((t) => { const c = qCache.get(t); return fresh || !c || Date.now() - c.at > 2500; });
    if (stale.length) {
      const rows = await yahooQuotes(stale).catch(() => []);
      for (const r of rows) if (r && r.last != null) qCache.set(r.ticker.toUpperCase(), { last: r.last, prev: r.prev, name: r.name, at: Date.now() });
    }
    const out = {};
    for (const t of uniq) { const c = qCache.get(t); if (c) out[t] = c; }
    return out;
  }

  // ── Apply a signed fill to the account (delta>0 buy, delta<0 sell) ──
  function applyFill(ticker, delta, price, orderId) {
    const a = acct();
    let cash = a.cash, realized = a.realized;
    const fee = Math.abs(delta) * price * (COMM_BPS / 10000);
    cash -= delta * price;   // buy (delta>0) reduces cash; sell (delta<0) adds cash
    cash -= fee;

    const pos = S.getPos.get(ticker) || { id: ticker, ticker, qty: 0, avg_price: 0, opened_at: now() };
    const q0 = pos.qty, avg0 = pos.avg_price;
    let qty = q0, avg = avg0;

    if (q0 === 0 || Math.sign(q0) === Math.sign(delta)) {
      // opening or adding in the same direction → weighted-average cost
      const mag = Math.abs(q0) + Math.abs(delta);
      avg = mag > EPS ? (avg0 * Math.abs(q0) + price * Math.abs(delta)) / mag : price;
      qty = q0 + delta;
    } else {
      // reducing / closing / flipping
      const closeQty = Math.min(Math.abs(delta), Math.abs(q0));
      const pnl = q0 > 0 ? closeQty * (price - avg0) : closeQty * (avg0 - price);
      realized += pnl;
      S.insClose.run({ id: id(), ticker, qty: closeQty, pnl: +pnl.toFixed(2), ts: now() });
      qty = q0 + delta;
      if (Math.abs(qty) < EPS) { qty = 0; avg = 0; }
      else if (Math.sign(qty) !== Math.sign(q0)) { avg = price; } // flipped through zero → new basis
      else { avg = avg0; } // partial close, basis unchanged
    }

    if (Math.abs(qty) < EPS) S.delPos.run(ticker);
    else S.upPos.run({ id: ticker, ticker, qty, avg_price: +avg.toFixed(6), side: qty > 0 ? "long" : "short", opened_at: pos.opened_at });
    S.setAcct.run(+cash.toFixed(2), +realized.toFixed(2));
    S.insFill.run({ id: id(), order_id: orderId, ticker, qty: delta, price: +price.toFixed(4), ts: now() });
  }

  function snapEquity(marked) {
    const a = acct();
    const equity = a.cash + (marked?.unrealizedBasis ?? 0);
    S.insEquity.run(now(), +equity.toFixed(2), +a.cash.toFixed(2), +a.cash.toFixed(2), +(marked?.unrealized ?? 0).toFixed(2), +a.realized.toFixed(2));
  }

  // ── Mark positions to market ──
  async function mark(fresh = false) {
    const positions = S.listPos.all();
    const qm = await quotes(positions.map((p) => p.ticker), fresh);
    let mv = 0, unrealized = 0;
    const rows = positions.map((p) => {
      const last = qm[p.ticker]?.last ?? p.avg_price;
      const marketValue = p.qty * last;
      const u = p.qty * (last - p.avg_price);
      mv += marketValue; unrealized += u;
      return {
        ticker: p.ticker, qty: p.qty, side: p.qty > 0 ? "long" : "short",
        avgPrice: +p.avg_price.toFixed(4), last: +last.toFixed(4),
        marketValue: +marketValue.toFixed(2), unrealized: +u.toFixed(2),
        unrealizedPct: p.avg_price ? +(((last - p.avg_price) / p.avg_price) * 100 * Math.sign(p.qty)).toFixed(2) : 0,
      };
    });
    const a = acct();
    return { positions: rows, cash: a.cash, marketValueLong: mv, unrealized, equity: a.cash + mv, unrealizedBasis: mv, quotes: qm };
  }

  // ── Fill open limit orders that have become marketable ──
  async function sync(fresh = false) {
    const open = S.listOpen.all();
    if (open.length) {
      const qm = await quotes(open.map((o) => o.ticker), fresh);
      for (const o of open) {
        const last = qm[o.ticker]?.last; if (last == null) continue;
        const marketable = o.side === "buy" ? last <= o.price : last >= o.price;
        if (!marketable) continue;
        try { applyFill(o.ticker, o.side === "buy" ? o.qty : -o.qty, o.price, o.id); S.setOrder.run("filled", o.price, now(), o.id); }
        catch { /* e.g. insufficient buying power now — leave resting */ }
      }
    }
    const m = await mark(fresh);
    snapEquity(m);
    return m;
  }

  // ── Place an order ──
  async function place({ ticker, side, qty, type = "market", limitPrice = null }) {
    ticker = String(ticker || "").trim().toUpperCase();
    side = String(side || "").toLowerCase();
    type = String(type || "market").toLowerCase();
    qty = Number(qty);
    if (!ticker) throw err("Ticker required", 400);
    if (side !== "buy" && side !== "sell") throw err("Side must be buy or sell", 400);
    if (!(qty > 0)) throw err("Quantity must be positive", 400);
    if (type !== "market" && type !== "limit") throw err("Type must be market or limit", 400);
    if (type === "limit" && !(Number(limitPrice) > 0)) throw err("Limit price required", 400);

    const qm = await quotes([ticker], true);
    const q = qm[ticker];
    if (!q || q.last == null) throw err(`No quote for ${ticker} — check the symbol`, 422);
    const last = q.last;
    const delta = side === "buy" ? qty : -qty;

    const orderRow = { id: id(), ticker, side, type, qty, price: type === "limit" ? Number(limitPrice) : null, status: "open", algo: null, created_at: now(), filled_at: null };

    if (type === "market") {
      const fill = side === "buy" ? last * (1 + SLIP_BPS / 10000) : last * (1 - SLIP_BPS / 10000);
      preflightBuyingPower(delta, fill);
      S.insOrder.run(orderRow);
      applyFill(ticker, delta, fill, orderRow.id);
      S.setOrder.run("filled", +fill.toFixed(4), now(), orderRow.id);
      const m = await mark(); snapEquity(m);
      return { ok: true, status: "filled", orderId: orderRow.id, ticker, side, qty, fillPrice: +fill.toFixed(4), account: await metrics(m) };
    }

    // limit
    const lp = Number(limitPrice);
    const marketable = side === "buy" ? last <= lp : last >= lp;
    if (marketable) {
      preflightBuyingPower(delta, lp);
      S.insOrder.run(orderRow);
      applyFill(ticker, delta, lp, orderRow.id);
      S.setOrder.run("filled", lp, now(), orderRow.id);
      const m = await mark(); snapEquity(m);
      return { ok: true, status: "filled", orderId: orderRow.id, ticker, side, qty, fillPrice: lp, account: await metrics(m) };
    }
    S.insOrder.run(orderRow);
    return { ok: true, status: "open", orderId: orderRow.id, ticker, side, qty, limitPrice: lp, last: +last.toFixed(4), account: await metrics() };
  }

  function preflightBuyingPower(delta, price) {
    if (delta <= 0) return; // sells/shorts receive cash
    const a = acct();
    const cost = delta * price * (1 + COMM_BPS / 10000);
    if (cost > a.cash + EPS) throw err(`Insufficient buying power — need $${cost.toFixed(2)}, have $${a.cash.toFixed(2)}`, 400);
  }

  function cancel(orderId) {
    const r = S.cancelOrder.run(now(), String(orderId || ""));
    if (!r.changes) throw err("Order not found or not open", 404);
    return { ok: true, canceled: orderId };
  }

  function reset() { S.wipe(); S.setAcct.run(START_CASH, 0); snapEquity({ unrealized: 0, unrealizedBasis: 0 }); return { ok: true }; }

  // ── Portfolio metrics ──
  async function metrics(pre) {
    const m = pre || await mark();
    const a = acct();
    const startCash = a.start_cash || START_CASH;
    const equity = m.equity;
    const cs = S.closeStats.get() || {};
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const openToday = S.firstToday.get(todayStart.toISOString());
    const dayBase = openToday?.equity ?? startCash;
    return {
      equity: +equity.toFixed(2),
      cash: +a.cash.toFixed(2),
      buyingPower: +a.cash.toFixed(2),
      marketValue: +m.marketValueLong.toFixed(2),
      unrealized: +m.unrealized.toFixed(2),
      realized: +a.realized.toFixed(2),
      totalPnl: +(equity - startCash).toFixed(2),
      totalPnlPct: +(((equity - startCash) / startCash) * 100).toFixed(2),
      dayPnl: +(equity - dayBase).toFixed(2),
      dayPnlPct: dayBase ? +(((equity - dayBase) / dayBase) * 100).toFixed(2) : 0,
      startCash,
      openPositions: m.positions.length,
      tradeCount: cs.n || 0,
      winRate: cs.n ? +((cs.wins / cs.n) * 100).toFixed(1) : null,
      avgWin: cs.avgWin != null ? +cs.avgWin.toFixed(2) : null,
      avgLoss: cs.avgLoss != null ? +cs.avgLoss.toFixed(2) : null,
    };
  }

  async function account() {
    const m = await sync(true);           // fresh quotes: fill resting limits + mark live + snapshot
    return { account: await metrics(m), positions: m.positions, quote: m.quotes };
  }

  function orders() {
    return { open: S.listOpen.all().map(fmtOrder), recent: S.listOrders.all(60).map(fmtOrder) };
  }
  function journal() {
    return { fills: S.listFills.all(80).map(fmtFill), closes: S.listCloses.all(60) };
  }
  function equityCurve(limit = 300) {
    return { curve: S.listEquity.all(limit).reverse() };
  }

  const fmtOrder = (o) => ({ id: o.id, ticker: o.ticker, side: o.side, type: o.type, qty: o.qty, price: o.price, status: o.status, createdAt: o.created_at, filledAt: o.filled_at });
  const fmtFill = (f) => ({ id: f.id, ticker: f.ticker, qty: f.qty, side: f.qty > 0 ? "buy" : "sell", price: f.price, ts: f.ts });

  return { account, place, cancel, reset, orders, journal, equityCurve, metrics, sync, mark, START_CASH };
}

function err(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

module.exports = { createApexPaper };
