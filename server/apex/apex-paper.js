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
const DEFAULT_PORTFOLIO_ID = "paper-default";
const DEFAULT_ACCOUNT_ID = "paper-account";
const SHORT_INITIAL_MARGIN = 1.5;
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
    CREATE TABLE IF NOT EXISTS apex_portfolios (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', kind TEXT NOT NULL DEFAULT 'paper',
      base_currency TEXT NOT NULL DEFAULT 'USD', mandate TEXT DEFAULT '', risk_profile TEXT DEFAULT 'balanced',
      status TEXT NOT NULL DEFAULT 'active', demo INTEGER NOT NULL DEFAULT 1, meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_accounts (
      id TEXT PRIMARY KEY, portfolio_id TEXT NOT NULL, name TEXT NOT NULL, account_type TEXT NOT NULL DEFAULT 'paper',
      base_currency TEXT NOT NULL DEFAULT 'USD', start_cash REAL NOT NULL DEFAULT 100000, margin_policy_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_order_reservations (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, portfolio_id TEXT NOT NULL, account_id TEXT NOT NULL,
      ticker TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', reserved_cash REAL NOT NULL DEFAULT 0,
      reserved_exposure REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, released_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_ledger_entries (
      id TEXT PRIMARY KEY, journal_group_id TEXT NOT NULL, portfolio_id TEXT NOT NULL, account_id TEXT NOT NULL,
      event_type TEXT NOT NULL, event_id TEXT, ledger_account TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
      debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, memo TEXT DEFAULT '', source_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  for (const sql of [
    "ALTER TABLE apex_orders ADD COLUMN portfolio_id TEXT DEFAULT 'paper-default'",
    "ALTER TABLE apex_orders ADD COLUMN account_id TEXT DEFAULT 'paper-account'",
    "ALTER TABLE apex_orders ADD COLUMN owner_type TEXT DEFAULT 'manual'",
    "ALTER TABLE apex_orders ADD COLUMN owner_id TEXT DEFAULT ''",
    "ALTER TABLE apex_orders ADD COLUMN idempotency_key TEXT DEFAULT ''",
    "ALTER TABLE apex_orders ADD COLUMN reserved_cash REAL DEFAULT 0",
    "ALTER TABLE apex_orders ADD COLUMN reserved_exposure REAL DEFAULT 0",
    "ALTER TABLE apex_fills ADD COLUMN portfolio_id TEXT DEFAULT 'paper-default'",
    "ALTER TABLE apex_fills ADD COLUMN account_id TEXT DEFAULT 'paper-account'",
    "ALTER TABLE apex_fills ADD COLUMN owner_type TEXT DEFAULT 'manual'",
    "ALTER TABLE apex_fills ADD COLUMN owner_id TEXT DEFAULT ''",
    "ALTER TABLE apex_positions ADD COLUMN portfolio_id TEXT DEFAULT 'paper-default'",
    "ALTER TABLE apex_positions ADD COLUMN account_id TEXT DEFAULT 'paper-account'",
    "ALTER TABLE apex_positions ADD COLUMN owner_type TEXT DEFAULT 'manual'",
    "ALTER TABLE apex_positions ADD COLUMN owner_id TEXT DEFAULT ''",
    "ALTER TABLE apex_positions ADD COLUMN strategy_version TEXT DEFAULT ''",
  ]) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  const S = {
    getAcct: db.prepare(`SELECT * FROM apex_paper_account WHERE id = 1`),
    initAcct: db.prepare(`INSERT OR IGNORE INTO apex_paper_account (id, cash, realized, start_cash, created_at) VALUES (1, ?, 0, ?, ?)`),
    setAcct: db.prepare(`UPDATE apex_paper_account SET cash = ?, realized = ? WHERE id = 1`),
    getPos: db.prepare(`SELECT * FROM apex_positions WHERE id = ? AND COALESCE(portfolio_id, '${DEFAULT_PORTFOLIO_ID}') = '${DEFAULT_PORTFOLIO_ID}'`),
    listPos: db.prepare(`SELECT * FROM apex_positions WHERE COALESCE(portfolio_id, '${DEFAULT_PORTFOLIO_ID}') = '${DEFAULT_PORTFOLIO_ID}' AND ABS(qty) > ${EPS} ORDER BY opened_at`),
    upPos: db.prepare(`INSERT INTO apex_positions (id, ticker, qty, avg_price, side, opened_at, portfolio_id, account_id, owner_type, owner_id, strategy_version)
      VALUES (@id, @ticker, @qty, @avg_price, @side, @opened_at, @portfolio_id, @account_id, @owner_type, @owner_id, @strategy_version)
      ON CONFLICT(id) DO UPDATE SET qty=@qty, avg_price=@avg_price, side=@side, portfolio_id=@portfolio_id, account_id=@account_id,
        owner_type=@owner_type, owner_id=@owner_id, strategy_version=@strategy_version`),
    delPos: db.prepare(`DELETE FROM apex_positions WHERE id = ?`),
    insOrder: db.prepare(`INSERT INTO apex_orders (id, ticker, side, type, qty, price, status, algo, created_at, filled_at, portfolio_id, account_id, owner_type, owner_id, idempotency_key, reserved_cash, reserved_exposure)
      VALUES (@id, @ticker, @side, @type, @qty, @price, @status, @algo, @created_at, @filled_at, @portfolio_id, @account_id, @owner_type, @owner_id, @idempotency_key, @reserved_cash, @reserved_exposure)`),
    setOrder: db.prepare(`UPDATE apex_orders SET status = ?, price = ?, filled_at = ? WHERE id = ?`),
    cancelOrder: db.prepare(`UPDATE apex_orders SET status = 'canceled', filled_at = ?, reserved_cash = 0, reserved_exposure = 0 WHERE id = ? AND status = 'open'`),
    getOrder: db.prepare(`SELECT * FROM apex_orders WHERE id = ?`),
    listOpen: db.prepare(`SELECT * FROM apex_orders WHERE status = 'open' ORDER BY created_at DESC`),
    listOrders: db.prepare(`SELECT * FROM apex_orders ORDER BY created_at DESC LIMIT ?`),
    insFill: db.prepare(`INSERT INTO apex_fills (id, order_id, ticker, qty, price, ts, portfolio_id, account_id, owner_type, owner_id)
      VALUES (@id, @order_id, @ticker, @qty, @price, @ts, @portfolio_id, @account_id, @owner_type, @owner_id)`),
    listFills: db.prepare(`SELECT * FROM apex_fills ORDER BY ts DESC LIMIT ?`),
    insClose: db.prepare(`INSERT INTO apex_paper_closes (id, ticker, qty, pnl, ts) VALUES (@id, @ticker, @qty, @pnl, @ts)`),
    listCloses: db.prepare(`SELECT * FROM apex_paper_closes ORDER BY ts DESC LIMIT ?`),
    closeStats: db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins,
      AVG(CASE WHEN pnl > 0 THEN pnl END) avgWin, AVG(CASE WHEN pnl < 0 THEN pnl END) avgLoss,
      SUM(pnl) sumPnl FROM apex_paper_closes`),
    insEquity: db.prepare(`INSERT OR REPLACE INTO apex_equity_curve (ts, equity, cash, buying_power, unrealized, realized) VALUES (?, ?, ?, ?, ?, ?)`),
    listEquity: db.prepare(`SELECT * FROM apex_equity_curve ORDER BY ts DESC LIMIT ?`),
    firstToday: db.prepare(`SELECT equity FROM apex_equity_curve WHERE ts >= ? ORDER BY ts LIMIT 1`),
    insReservation: db.prepare(`INSERT INTO apex_order_reservations (id, order_id, portfolio_id, account_id, ticker, currency, reserved_cash, reserved_exposure, status, created_at, released_at)
      VALUES (@id, @order_id, @portfolio_id, @account_id, @ticker, 'USD', @reserved_cash, @reserved_exposure, @status, @created_at, @released_at)
      ON CONFLICT(order_id) DO UPDATE SET reserved_cash=@reserved_cash, reserved_exposure=@reserved_exposure, status=@status, released_at=@released_at`),
    releaseReservation: db.prepare(`UPDATE apex_order_reservations SET status = 'released', reserved_cash = 0, reserved_exposure = 0, released_at = ? WHERE order_id = ? AND status = 'open'`),
    openReservations: db.prepare(`SELECT COALESCE(SUM(reserved_cash),0) cash, COALESCE(SUM(reserved_exposure),0) exposure FROM apex_order_reservations WHERE status = 'open'`),
    insLedger: db.prepare(`INSERT INTO apex_ledger_entries (id, journal_group_id, portfolio_id, account_id, event_type, event_id, ledger_account, currency, debit, credit, memo, source_json, created_at)
      VALUES (@id, @journal_group_id, @portfolio_id, @account_id, @event_type, @event_id, @ledger_account, 'USD', @debit, @credit, @memo, @source_json, @created_at)`),
    seedPortfolio: db.prepare(`INSERT OR IGNORE INTO apex_portfolios (id,name,description,kind,base_currency,mandate,risk_profile,status,demo,meta_json,created_at,updated_at)
      VALUES (?, 'APEX Paper Portfolio', 'Default virtual portfolio connected to the paper trading desk.', 'paper', 'USD', 'Simulation only. No live broker.', 'balanced', 'active', 1, '{}', ?, ?)`),
    seedAccount: db.prepare(`INSERT OR IGNORE INTO apex_accounts (id,portfolio_id,name,account_type,base_currency,start_cash,margin_policy_json,status,created_at,updated_at)
      VALUES (?, ?, 'Default Paper Account', 'paper', 'USD', ?, '{"shortInitialMarginPct":1.5,"allowShort":true}', 'active', ?, ?)`),
    wipe: db.transaction(() => {
      db.exec(`DELETE FROM apex_positions; DELETE FROM apex_orders; DELETE FROM apex_fills; DELETE FROM apex_paper_closes; DELETE FROM apex_equity_curve; DELETE FROM apex_order_reservations; DELETE FROM apex_ledger_entries;`);
    }),
  };

  S.initAcct.run(START_CASH, START_CASH, now());
  S.seedPortfolio.run(DEFAULT_PORTFOLIO_ID, now(), now());
  S.seedAccount.run(DEFAULT_ACCOUNT_ID, DEFAULT_PORTFOLIO_ID, START_CASH, now(), now());
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
  const applyFillTx = db.transaction((ticker, delta, price, orderId) => {
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
    else S.upPos.run({
      id: ticker,
      ticker,
      qty,
      avg_price: +avg.toFixed(6),
      side: qty > 0 ? "long" : "short",
      opened_at: pos.opened_at,
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      account_id: DEFAULT_ACCOUNT_ID,
      owner_type: "manual",
      owner_id: "",
      strategy_version: "",
    });
    S.setAcct.run(+cash.toFixed(2), +realized.toFixed(2));
    const fillId = id();
    S.insFill.run({
      id: fillId,
      order_id: orderId,
      ticker,
      qty: delta,
      price: +price.toFixed(4),
      ts: now(),
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      account_id: DEFAULT_ACCOUNT_ID,
      owner_type: "manual",
      owner_id: "",
    });
    S.releaseReservation.run(now(), orderId);
    writeBalancedFillLedger(fillId, ticker, delta, price, fee);
  });

  function writeBalancedFillLedger(fillId, ticker, delta, price, fee) {
    const group = id();
    const gross = Math.abs(delta) * price;
    const t = now();
    const rows = delta > 0
      ? [
          ["position_cost", gross, 0, `${ticker} buy notional`],
          ["fees", fee, 0, `${ticker} commission`],
          ["cash", 0, gross + fee, `${ticker} cash paid`],
        ]
      : [
          ["cash", gross - fee, 0, `${ticker} cash received after fee`],
          ["fees", fee, 0, `${ticker} commission`],
          ["position_proceeds", 0, gross, `${ticker} sell/short proceeds`],
        ];
    for (const [ledgerAccount, debit, credit, memo] of rows) {
      S.insLedger.run({
        id: id(),
        journal_group_id: group,
        portfolio_id: DEFAULT_PORTFOLIO_ID,
        account_id: DEFAULT_ACCOUNT_ID,
        event_type: "fill",
        event_id: fillId,
        ledger_account: ledgerAccount,
        debit: +debit.toFixed(6),
        credit: +credit.toFixed(6),
        memo,
        source_json: JSON.stringify({ ticker, delta, price, fee }),
        created_at: t,
      });
    }
  }

  function applyFill(ticker, delta, price, orderId) {
    applyFillTx(ticker, delta, price, orderId);
  }

  function snapEquity(marked) {
    const a = acct();
    const equity = a.cash + (marked?.unrealizedBasis ?? 0);
    S.insEquity.run(now(), +equity.toFixed(2), +a.cash.toFixed(2), +availableBuyingPower(marked).toFixed(2), +(marked?.unrealized ?? 0).toFixed(2), +a.realized.toFixed(2));
  }

  function reservationTotals() {
    const r = S.openReservations.get() || {};
    return { cash: Number(r.cash) || 0, exposure: Number(r.exposure) || 0 };
  }

  function shortMarginRequirement(marked) {
    const rows = marked?.positions || [];
    return rows.filter((p) => p.qty < 0).reduce((sum, p) => sum + Math.abs(p.marketValue) * SHORT_INITIAL_MARGIN, 0);
  }

  function availableBuyingPower(marked = null) {
    const a = acct();
    const r = reservationTotals();
    return Math.max(0, a.cash - r.cash - r.exposure - shortMarginRequirement(marked));
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

    const orderRow = {
      id: id(),
      ticker,
      side,
      type,
      qty,
      price: type === "limit" ? Number(limitPrice) : null,
      status: "open",
      algo: null,
      created_at: now(),
      filled_at: null,
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      account_id: DEFAULT_ACCOUNT_ID,
      owner_type: "manual",
      owner_id: "",
      idempotency_key: "",
      reserved_cash: 0,
      reserved_exposure: 0,
    };

    if (type === "market") {
      const fill = side === "buy" ? last * (1 + SLIP_BPS / 10000) : last * (1 - SLIP_BPS / 10000);
      preflightOrderBuyingPower(ticker, delta, fill);
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
      preflightOrderBuyingPower(ticker, delta, lp);
      S.insOrder.run(orderRow);
      applyFill(ticker, delta, lp, orderRow.id);
      S.setOrder.run("filled", lp, now(), orderRow.id);
      const m = await mark(); snapEquity(m);
      return { ok: true, status: "filled", orderId: orderRow.id, ticker, side, qty, fillPrice: lp, account: await metrics(m) };
    }
    const reservation = reserveForOrder(ticker, delta, lp);
    orderRow.reserved_cash = +reservation.cash.toFixed(2);
    orderRow.reserved_exposure = +reservation.exposure.toFixed(2);
    S.insOrder.run(orderRow);
    if (reservation.cash || reservation.exposure) S.insReservation.run({
      id: id(),
      order_id: orderRow.id,
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      account_id: DEFAULT_ACCOUNT_ID,
      ticker,
      reserved_cash: +reservation.cash.toFixed(2),
      reserved_exposure: +reservation.exposure.toFixed(2),
      status: "open",
      created_at: now(),
      released_at: null,
    });
    return { ok: true, status: "open", orderId: orderRow.id, ticker, side, qty, limitPrice: lp, last: +last.toFixed(4), account: await metrics() };
  }

  function preflightBuyingPower(delta, price) {
    if (delta <= 0) return; // sells/shorts receive cash
    const a = acct();
    const cost = delta * price * (1 + COMM_BPS / 10000);
    if (cost > a.cash + EPS) throw err(`Insufficient buying power — need $${cost.toFixed(2)}, have $${a.cash.toFixed(2)}`, 400);
  }

  function preflightOrderBuyingPower(ticker, delta, price) {
    const need = reserveForOrder(ticker, delta, price);
    const required = need.cash + need.exposure;
    const available = availableBuyingPower();
    if (required > available + EPS) throw err(`Insufficient buying power - need $${required.toFixed(2)}, have $${available.toFixed(2)}`, 400);
  }

  function reserveForOrder(ticker, delta, price) {
    if (delta > 0) return { cash: delta * price * (1 + COMM_BPS / 10000), exposure: 0 };
    const sym = ticker ? String(ticker).toUpperCase() : null;
    const pos = sym ? (S.getPos.get(sym) || { qty: 0 }) : { qty: 0 };
    const currentLong = Math.max(0, Number(pos.qty) || 0);
    const shortQty = Math.max(0, Math.abs(delta) - currentLong);
    return { cash: 0, exposure: shortQty * price * SHORT_INITIAL_MARGIN };
  }

  function cancel(orderId) {
    const r = S.cancelOrder.run(now(), String(orderId || ""));
    if (!r.changes) throw err("Order not found or not open", 404);
    S.releaseReservation.run(now(), String(orderId || ""));
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
      buyingPower: +availableBuyingPower(m).toFixed(2),
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

  const fmtOrder = (o) => ({ id: o.id, portfolioId: o.portfolio_id || DEFAULT_PORTFOLIO_ID, accountId: o.account_id || DEFAULT_ACCOUNT_ID, ticker: o.ticker, side: o.side, type: o.type, qty: o.qty, price: o.price, status: o.status, reservedCash: o.reserved_cash || 0, reservedExposure: o.reserved_exposure || 0, ownerType: o.owner_type || "manual", ownerId: o.owner_id || "", createdAt: o.created_at, filledAt: o.filled_at });
  const fmtFill = (f) => ({ id: f.id, portfolioId: f.portfolio_id || DEFAULT_PORTFOLIO_ID, accountId: f.account_id || DEFAULT_ACCOUNT_ID, ticker: f.ticker, qty: f.qty, side: f.qty > 0 ? "buy" : "sell", price: f.price, ownerType: f.owner_type || "manual", ownerId: f.owner_id || "", ts: f.ts });

  return { account, place, cancel, reset, orders, journal, equityCurve, metrics, sync, mark, close: () => db.close(), START_CASH };
}

function err(message, statusCode) { return Object.assign(new Error(message), { statusCode }); }

module.exports = { createApexPaper };
