"use strict";

const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_PORTFOLIO_ID = "paper-default";
const DEFAULT_ACCOUNT_ID = "paper-account";
const START_CASH = 100000;
const EPS = 1e-6;

const now = () => new Date().toISOString();
const j = (v) => JSON.stringify(v == null ? null : v);
const id = () => crypto.randomUUID();
const n = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const money = (v) => +n(v).toFixed(2);

const ETF_TICKERS = new Set(["SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC", "GLD", "SLV", "TLT", "IEF", "SHY"]);
const SECTOR_BY_TICKER = {
  AAPL: "Technology", MSFT: "Technology", NVDA: "Semiconductors", AMD: "Semiconductors", AVGO: "Semiconductors", QCOM: "Semiconductors", INTC: "Semiconductors",
  META: "Communication", GOOGL: "Communication", GOOG: "Communication", NFLX: "Communication", DIS: "Communication",
  AMZN: "Consumer Discretionary", TSLA: "Consumer Discretionary", HD: "Consumer Discretionary", NKE: "Consumer Discretionary",
  JPM: "Financials", BAC: "Financials", GS: "Financials", MS: "Financials", V: "Financials", MA: "Financials", COIN: "Financials",
  XOM: "Energy", CVX: "Energy", OXY: "Energy", CLF: "Materials", X: "Materials",
  JNJ: "Healthcare", UNH: "Healthcare", LLY: "Healthcare", ABBV: "Healthcare", PFE: "Healthcare",
  WMT: "Consumer Staples", COST: "Consumer Staples", PG: "Consumer Staples", KO: "Consumer Staples",
  PLTR: "High Vol Growth", HOOD: "High Vol Growth", AFRM: "High Vol Growth", ROKU: "High Vol Growth", CVNA: "High Vol Growth", UPST: "High Vol Growth",
  SPY: "Broad Market", QQQ: "Technology", IWM: "Small Cap", DIA: "Broad Market", GLD: "Precious Metals", SLV: "Precious Metals", TLT: "Rates", IEF: "Rates", SHY: "Rates",
  XLK: "Technology", XLF: "Financials", XLE: "Energy", XLV: "Healthcare", XLY: "Consumer Discretionary", XLP: "Consumer Staples", XLI: "Industrials", XLB: "Materials", XLU: "Utilities", XLRE: "Real Estate", XLC: "Communication",
};
const SECTOR_BETA_PROXY = {
  "Rates": -0.15, "Precious Metals": 0.15, "Consumer Staples": 0.65, "Utilities": 0.6, "Healthcare": 0.75,
  "Broad Market": 1, "Financials": 1.05, "Industrials": 1.05, "Materials": 1.1, "Energy": 1.15,
  "Technology": 1.2, "Communication": 1.15, "Semiconductors": 1.45, "High Vol Growth": 1.75, "Small Cap": 1.25,
};

function parseJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function createApexPortfolio(runtimeDir) {
  const db = new Database(path.join(runtimeDir, "apex.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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
    CREATE TABLE IF NOT EXISTS apex_quotes_live (
      ticker TEXT PRIMARY KEY, bid REAL, ask REAL, bid_sz REAL, ask_sz REAL, last REAL,
      day_o REAL, day_h REAL, day_l REAL, prev_c REAL, vol REAL, ts TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_paper_account (
      id INTEGER PRIMARY KEY CHECK (id = 1), cash REAL, realized REAL, start_cash REAL, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_portfolios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'paper',
      base_currency TEXT NOT NULL DEFAULT 'USD',
      mandate TEXT DEFAULT '',
      risk_profile TEXT DEFAULT 'balanced',
      status TEXT NOT NULL DEFAULT 'active',
      demo INTEGER NOT NULL DEFAULT 1,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_accounts (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'paper',
      base_currency TEXT NOT NULL DEFAULT 'USD',
      start_cash REAL NOT NULL DEFAULT 100000,
      margin_policy_json TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id)
    );
    CREATE TABLE IF NOT EXISTS apex_cash_balances (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      available REAL NOT NULL DEFAULT 0,
      settled REAL NOT NULL DEFAULT 0,
      restricted REAL NOT NULL DEFAULT 0,
      receivables REAL NOT NULL DEFAULT 0,
      payables REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, currency),
      FOREIGN KEY (account_id) REFERENCES apex_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS apex_ledger_entries (
      id TEXT PRIMARY KEY,
      journal_group_id TEXT NOT NULL,
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT,
      ledger_account TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      memo TEXT DEFAULT '',
      source_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id),
      FOREIGN KEY (account_id) REFERENCES apex_accounts(id)
    );
    CREATE INDEX IF NOT EXISTS apex_ledger_group_idx ON apex_ledger_entries(journal_group_id);
    CREATE INDEX IF NOT EXISTS apex_ledger_account_idx ON apex_ledger_entries(account_id, created_at);
    CREATE TABLE IF NOT EXISTS apex_positions_read_model (
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      owner_type TEXT NOT NULL DEFAULT 'manual',
      owner_id TEXT DEFAULT '',
      strategy_version TEXT DEFAULT '',
      qty REAL NOT NULL,
      avg_price REAL NOT NULL,
      mark_price REAL,
      mark_source TEXT DEFAULT 'unmarked',
      mark_ts TEXT,
      market_value REAL NOT NULL DEFAULT 0,
      unrealized REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (portfolio_id, account_id, ticker, owner_type, owner_id)
    );
    CREATE TABLE IF NOT EXISTS apex_order_reservations (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      reserved_cash REAL NOT NULL DEFAULT 0,
      reserved_exposure REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      released_at TEXT,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id),
      FOREIGN KEY (account_id) REFERENCES apex_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS apex_risk_snapshots (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id),
      FOREIGN KEY (account_id) REFERENCES apex_accounts(id)
    );
    CREATE TABLE IF NOT EXISTS apex_limit_policies (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      name TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id)
    );
    CREATE TABLE IF NOT EXISTS apex_limit_breaches (
      id TEXT PRIMARY KEY,
      portfolio_id TEXT NOT NULL,
      account_id TEXT,
      policy_id TEXT,
      severity TEXT NOT NULL DEFAULT 'warning',
      message TEXT NOT NULL,
      source_json TEXT DEFAULT '{}',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY (portfolio_id) REFERENCES apex_portfolios(id)
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
    getPortfolio: db.prepare("SELECT * FROM apex_portfolios WHERE id = ?"),
    listPortfolios: db.prepare("SELECT * FROM apex_portfolios ORDER BY updated_at DESC"),
    upsertPortfolio: db.prepare(`INSERT INTO apex_portfolios
      (id,name,description,kind,base_currency,mandate,risk_profile,status,demo,meta_json,created_at,updated_at)
      VALUES (@id,@name,@description,@kind,@base_currency,@mandate,@risk_profile,@status,@demo,@meta_json,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,description=@description,kind=@kind,base_currency=@base_currency,
        mandate=@mandate,risk_profile=@risk_profile,status=@status,demo=@demo,meta_json=@meta_json,updated_at=@updated_at`),
    getAccount: db.prepare("SELECT * FROM apex_accounts WHERE id = ?"),
    accountForPortfolio: db.prepare("SELECT * FROM apex_accounts WHERE portfolio_id = ? ORDER BY created_at LIMIT 1"),
    upsertAccount: db.prepare(`INSERT INTO apex_accounts
      (id,portfolio_id,name,account_type,base_currency,start_cash,margin_policy_json,status,created_at,updated_at)
      VALUES (@id,@portfolio_id,@name,@account_type,@base_currency,@start_cash,@margin_policy_json,@status,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,account_type=@account_type,base_currency=@base_currency,
        start_cash=@start_cash,margin_policy_json=@margin_policy_json,status=@status,updated_at=@updated_at`),
    upsertCash: db.prepare(`INSERT INTO apex_cash_balances
      (id,account_id,currency,available,settled,restricted,receivables,payables,updated_at)
      VALUES (@id,@account_id,@currency,@available,@settled,@restricted,@receivables,@payables,@updated_at)
      ON CONFLICT(account_id,currency) DO UPDATE SET available=@available,settled=@settled,restricted=@restricted,
        receivables=@receivables,payables=@payables,updated_at=@updated_at`),
    initPaperAcct: db.prepare("INSERT OR IGNORE INTO apex_paper_account (id, cash, realized, start_cash, created_at) VALUES (1, ?, 0, ?, ?)"),
    getPaperAcct: db.prepare("SELECT * FROM apex_paper_account WHERE id = 1"),
    getCash: db.prepare("SELECT * FROM apex_cash_balances WHERE account_id = ? AND currency = ?"),
    legacyPositions: db.prepare(`SELECT * FROM apex_positions WHERE COALESCE(portfolio_id, ?) = ? AND ABS(qty) > ${EPS} ORDER BY opened_at`),
    getLegacyPosition: db.prepare("SELECT * FROM apex_positions WHERE id = ?"),
    upsertLegacyPosition: db.prepare(`INSERT INTO apex_positions
      (id,ticker,qty,avg_price,side,opened_at,portfolio_id,account_id,owner_type,owner_id,strategy_version)
      VALUES (@id,@ticker,@qty,@avg_price,@side,@opened_at,@portfolio_id,@account_id,@owner_type,@owner_id,@strategy_version)
      ON CONFLICT(id) DO UPDATE SET qty=@qty, avg_price=@avg_price, side=@side, portfolio_id=@portfolio_id,
        account_id=@account_id, owner_type=@owner_type, owner_id=@owner_id, strategy_version=@strategy_version`),
    legacyOpenOrders: db.prepare("SELECT * FROM apex_orders WHERE COALESCE(portfolio_id, ?) = ? AND status = 'open' ORDER BY created_at DESC"),
    legacyOrders: db.prepare("SELECT * FROM apex_orders WHERE COALESCE(portfolio_id, ?) = ? ORDER BY created_at DESC LIMIT ?"),
    legacyFills: db.prepare("SELECT * FROM apex_fills WHERE COALESCE(portfolio_id, ?) = ? ORDER BY ts DESC LIMIT ?"),
    quote: db.prepare("SELECT * FROM apex_quotes_live WHERE ticker = ?"),
    equity: db.prepare("SELECT * FROM apex_equity_curve ORDER BY ts DESC LIMIT ?"),
    equityByPortfolio: db.prepare("SELECT * FROM apex_equity_curve ORDER BY ts DESC LIMIT ?"),
    reservationOpen: db.prepare("SELECT COALESCE(SUM(reserved_cash),0) cash, COALESCE(SUM(reserved_exposure),0) exposure FROM apex_order_reservations WHERE portfolio_id = ? AND status = 'open'"),
    ledgerBalanceGroups: db.prepare(`SELECT journal_group_id, ROUND(SUM(debit), 6) debit_total, ROUND(SUM(credit), 6) credit_total
      FROM apex_ledger_entries WHERE portfolio_id = ? GROUP BY journal_group_id HAVING ABS(SUM(debit) - SUM(credit)) > 0.01 LIMIT 20`),
    insLedger: db.prepare(`INSERT INTO apex_ledger_entries
      (id,journal_group_id,portfolio_id,account_id,event_type,event_id,ledger_account,currency,debit,credit,memo,source_json,created_at)
      VALUES (@id,@journal_group_id,@portfolio_id,@account_id,@event_type,@event_id,@ledger_account,@currency,@debit,@credit,@memo,@source_json,@created_at)`),
    positionReadDelete: db.prepare("DELETE FROM apex_positions_read_model WHERE portfolio_id = ? AND account_id = ?"),
    positionReadUpsert: db.prepare(`INSERT INTO apex_positions_read_model
      (portfolio_id,account_id,ticker,owner_type,owner_id,strategy_version,qty,avg_price,mark_price,mark_source,mark_ts,market_value,unrealized,updated_at)
      VALUES (@portfolio_id,@account_id,@ticker,@owner_type,@owner_id,@strategy_version,@qty,@avg_price,@mark_price,@mark_source,@mark_ts,@market_value,@unrealized,@updated_at)
      ON CONFLICT(portfolio_id,account_id,ticker,owner_type,owner_id) DO UPDATE SET qty=@qty,avg_price=@avg_price,
        strategy_version=@strategy_version,mark_price=@mark_price,mark_source=@mark_source,mark_ts=@mark_ts,
        market_value=@market_value,unrealized=@unrealized,updated_at=@updated_at`),
  };

  const seedDefault = db.transaction(() => {
    const t = now();
    S.initPaperAcct.run(START_CASH, START_CASH, t);
    S.upsertPortfolio.run({
      id: DEFAULT_PORTFOLIO_ID,
      name: "APEX Paper Portfolio",
      description: "Default virtual portfolio connected to the paper trading desk.",
      kind: "paper",
      base_currency: "USD",
      mandate: "Simulation only. No live broker.",
      risk_profile: "balanced",
      status: "active",
      demo: 1,
      meta_json: j({ source: "paper", wave: "0-2" }),
      created_at: t,
      updated_at: t,
    });
    S.upsertAccount.run({
      id: DEFAULT_ACCOUNT_ID,
      portfolio_id: DEFAULT_PORTFOLIO_ID,
      name: "Default Paper Account",
      account_type: "paper",
      base_currency: "USD",
      start_cash: START_CASH,
      margin_policy_json: j({ shortInitialMarginPct: 1.5, allowShort: true }),
      status: "active",
      created_at: t,
      updated_at: t,
    });
    const paper = S.getPaperAcct.get();
    const cash = paper ? n(paper.cash, START_CASH) : START_CASH;
    S.upsertCash.run({
      id: `${DEFAULT_ACCOUNT_ID}:USD`,
      account_id: DEFAULT_ACCOUNT_ID,
      currency: "USD",
      available: cash,
      settled: cash,
      restricted: 0,
      receivables: 0,
      payables: 0,
      updated_at: t,
    });
  });
  seedDefault();

  function mapPortfolio(r) {
    return r ? {
      id: r.id,
      name: r.name,
      description: r.description || "",
      kind: r.kind,
      baseCurrency: r.base_currency,
      mandate: r.mandate || "",
      riskProfile: r.risk_profile || "balanced",
      status: r.status,
      demo: !!r.demo,
      meta: parseJson(r.meta_json, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    } : null;
  }

  function mapAccount(r) {
    return r ? {
      id: r.id,
      portfolioId: r.portfolio_id,
      name: r.name,
      accountType: r.account_type,
      baseCurrency: r.base_currency,
      startCash: r.start_cash,
      marginPolicy: parseJson(r.margin_policy_json, {}),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    } : null;
  }

  function resolvePortfolio(portfolioId = DEFAULT_PORTFOLIO_ID) {
    let p = S.getPortfolio.get(portfolioId);
    if (!p && portfolioId !== DEFAULT_PORTFOLIO_ID) p = S.getPortfolio.get(DEFAULT_PORTFOLIO_ID);
    const account = S.accountForPortfolio.get(p?.id || DEFAULT_PORTFOLIO_ID) || S.getAccount.get(DEFAULT_ACCOUNT_ID);
    return { portfolio: mapPortfolio(p), account: mapAccount(account) };
  }

  function quoteFor(ticker) {
    const q = S.quote.get(ticker);
    if (!q || q.last == null) return null;
    return { price: n(q.last), source: "apex_quotes_live", ts: q.ts || null };
  }

  function positions(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const { account } = resolvePortfolio(portfolioId);
    const rows = S.legacyPositions.all(portfolioId, portfolioId);
    return rows.map((p) => {
      const q = quoteFor(p.ticker);
      const mark = q?.price ?? n(p.avg_price);
      const qty = n(p.qty);
      const avg = n(p.avg_price);
      const mv = qty * mark;
      const unrealized = qty * (mark - avg);
      return {
        portfolioId,
        accountId: account?.id || DEFAULT_ACCOUNT_ID,
        ticker: p.ticker,
        side: qty >= 0 ? "long" : "short",
        qty,
        avgPrice: +avg.toFixed(4),
        markPrice: +mark.toFixed(4),
        markSource: q?.source || "avg_price_fallback",
        markTs: q?.ts || null,
        quoteAgeSec: q?.ts ? Math.max(0, Math.round((Date.now() - new Date(q.ts).getTime()) / 1000)) : null,
        marketValue: money(mv),
        unrealized: money(unrealized),
        unrealizedPct: avg ? +(((mark - avg) / avg) * 100 * Math.sign(qty || 1)).toFixed(2) : 0,
        ownerType: p.owner_type || "manual",
        ownerId: p.owner_id || "",
        strategyVersion: p.strategy_version || "",
        openedAt: p.opened_at || null,
      };
    });
  }

  function syncPositionReadModel(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const { account } = resolvePortfolio(portfolioId);
    const accountId = account?.id || DEFAULT_ACCOUNT_ID;
    const rows = positions(portfolioId);
    const t = now();
    const tx = db.transaction(() => {
      S.positionReadDelete.run(portfolioId, accountId);
      for (const p of rows) {
        S.positionReadUpsert.run({
          portfolio_id: portfolioId,
          account_id: accountId,
          ticker: p.ticker,
          owner_type: p.ownerType,
          owner_id: p.ownerId,
          strategy_version: p.strategyVersion,
          qty: p.qty,
          avg_price: p.avgPrice,
          mark_price: p.markPrice,
          mark_source: p.markSource,
          mark_ts: p.markTs,
          market_value: p.marketValue,
          unrealized: p.unrealized,
          updated_at: t,
        });
      }
    });
    tx();
    return rows;
  }

  function accountSnapshot(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const { portfolio, account } = resolvePortfolio(portfolioId);
    const accountId = account?.id || DEFAULT_ACCOUNT_ID;
    const pos = syncPositionReadModel(portfolio?.id || portfolioId);
    const accountCurrency = account?.baseCurrency || "USD";
    const cashBalance = account ? S.getCash.get(account.id, accountCurrency) : null;
    const paper = portfolio?.id === DEFAULT_PORTFOLIO_ID ? S.getPaperAcct.get() : null;
    const cashRaw = paper ? n(paper.cash, START_CASH) : n(cashBalance?.settled, n(account?.startCash, START_CASH));
    const reservations = S.reservationOpen.get(portfolio?.id || portfolioId) || { cash: 0, exposure: 0 };
    const restricted = n(reservations.cash) + n(reservations.exposure);
    const longValue = pos.filter((p) => p.qty > 0).reduce((a, p) => a + Math.abs(p.marketValue), 0);
    const shortValue = pos.filter((p) => p.qty < 0).reduce((a, p) => a + Math.abs(p.marketValue), 0);
    const marketValue = pos.reduce((a, p) => a + p.marketValue, 0);
    const unrealized = pos.reduce((a, p) => a + p.unrealized, 0);
    const costBasis = pos.reduce((a, p) => a + Math.abs(p.qty * p.avgPrice), 0);
    const nav = cashRaw + marketValue;
    const realized = money(portfolio?.id === DEFAULT_PORTFOLIO_ID ? paper?.realized || 0 : 0);
    const totalPnl = portfolio?.id === DEFAULT_PORTFOLIO_ID ? money(nav - n(account?.startCash, START_CASH)) : money(realized + unrealized);
    const totalPnlPct = portfolio?.id === DEFAULT_PORTFOLIO_ID
      ? (account?.startCash ? +(((nav - account.startCash) / account.startCash) * 100).toFixed(2) : 0)
      : (costBasis ? +((totalPnl / costBasis) * 100).toFixed(2) : 0);
    const available = Math.max(0, cashRaw - restricted - shortValue * 1.5);
    const cash = {
      currency: account?.baseCurrency || "USD",
      available: money(available),
      settled: money(cashRaw),
      restricted: money(restricted),
      receivables: 0,
      payables: 0,
    };
    S.upsertCash.run({
      id: `${accountId}:${cash.currency}`,
      account_id: accountId,
      currency: cash.currency,
      available: cash.available,
      settled: cash.settled,
      restricted: cash.restricted,
      receivables: cash.receivables,
      payables: cash.payables,
      updated_at: now(),
    });
    return {
      portfolio,
      account,
      summary: {
        nav: money(nav),
        cash: money(cashRaw),
        availableCash: cash.available,
        restrictedCash: cash.restricted,
        buyingPower: cash.available,
        marketValue: money(marketValue),
        longExposure: money(longValue),
        shortExposure: money(shortValue),
        grossExposure: money(longValue + shortValue),
        netExposure: money(longValue - shortValue),
        unrealized: money(unrealized),
        realized,
        totalPnl,
        totalPnlPct,
        openPositions: pos.length,
        openOrders: S.legacyOpenOrders.all(portfolio?.id || portfolioId, portfolio?.id || portfolioId).length,
      },
      cash,
      positions: pos,
      dataStatus: dataStatus(pos),
      asOf: now(),
      mode: "paper",
      demo: portfolio?.demo ?? true,
    };
  }

  function dataStatus(pos) {
    const stale = pos.filter((p) => p.quoteAgeSec == null || p.quoteAgeSec > 900);
    return {
      ok: stale.length === 0,
      staleMarks: stale.length,
      warnings: stale.length ? [`${stale.length} position mark(s) use stale or fallback prices.`] : [],
    };
  }

  function reconciliation(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const snap = accountSnapshot(portfolioId);
    const s = snap.summary;
    const expectedNav = money(s.cash + s.marketValue + snap.cash.receivables - snap.cash.payables);
    const diff = money(s.nav - expectedNav);
    const badGroups = S.ledgerBalanceGroups.all(snap.portfolio?.id || portfolioId);
    return {
      portfolioId: snap.portfolio?.id || portfolioId,
      accountId: snap.account?.id || DEFAULT_ACCOUNT_ID,
      formula: "NAV = cash + marked positions + receivables - payables",
      components: {
        cash: s.cash,
        markedPositions: s.marketValue,
        receivables: snap.cash.receivables,
        payables: snap.cash.payables,
        nav: s.nav,
      },
      expectedNav,
      difference: diff,
      ok: Math.abs(diff) <= 0.01 && badGroups.length === 0,
      ledgerUnbalancedGroups: badGroups,
      dataStatus: snap.dataStatus,
      asOf: now(),
    };
  }

  function orders(portfolioId = DEFAULT_PORTFOLIO_ID, limit = 80) {
    const rows = S.legacyOrders.all(portfolioId, portfolioId, Math.max(1, Math.min(250, Number(limit) || 80)));
    return rows.map((o) => ({
      id: o.id,
      portfolioId: o.portfolio_id || portfolioId,
      accountId: o.account_id || DEFAULT_ACCOUNT_ID,
      ticker: o.ticker,
      side: o.side,
      type: o.type,
      qty: o.qty,
      price: o.price,
      status: o.status,
      ownerType: o.owner_type || "manual",
      ownerId: o.owner_id || "",
      reservedCash: n(o.reserved_cash),
      reservedExposure: n(o.reserved_exposure),
      createdAt: o.created_at,
      filledAt: o.filled_at,
    }));
  }

  function journal(portfolioId = DEFAULT_PORTFOLIO_ID, limit = 80) {
    return S.legacyFills.all(portfolioId, portfolioId, Math.max(1, Math.min(250, Number(limit) || 80))).map((f) => ({
      id: f.id,
      orderId: f.order_id,
      portfolioId: f.portfolio_id || portfolioId,
      accountId: f.account_id || DEFAULT_ACCOUNT_ID,
      ticker: f.ticker,
      qty: f.qty,
      side: f.qty > 0 ? "buy" : "sell",
      price: f.price,
      ownerType: f.owner_type || "manual",
      ownerId: f.owner_id || "",
      ts: f.ts,
    }));
  }

  function equityCurve(limit = 300) {
    return S.equity.all(Math.max(1, Math.min(1000, Number(limit) || 300))).reverse();
  }

  function createPortfolio(input = {}) {
    const t = now();
    const portfolioId = input.id || id();
    const accountId = input.accountId || id();
    const startCash = Math.max(0, n(input.startCash, START_CASH));
    const tx = db.transaction(() => {
      S.upsertPortfolio.run({
        id: portfolioId,
        name: String(input.name || "New Portfolio").slice(0, 80),
        description: String(input.description || "").slice(0, 500),
        kind: input.kind || "demo",
        base_currency: input.baseCurrency || "USD",
        mandate: String(input.mandate || "").slice(0, 500),
        risk_profile: input.riskProfile || "balanced",
        status: "active",
        demo: input.demo === false ? 0 : 1,
        meta_json: j(input.meta || {}),
        created_at: t,
        updated_at: t,
      });
      S.upsertAccount.run({
        id: accountId,
        portfolio_id: portfolioId,
        name: `${String(input.name || "New Portfolio").slice(0, 80)} Account`,
        account_type: input.kind || "demo",
        base_currency: input.baseCurrency || "USD",
        start_cash: startCash,
        margin_policy_json: j({ shortInitialMarginPct: 1.5, allowShort: false }),
        status: "active",
        created_at: t,
        updated_at: t,
      });
      S.upsertCash.run({
        id: `${accountId}:${input.baseCurrency || "USD"}`,
        account_id: accountId,
        currency: input.baseCurrency || "USD",
        available: startCash,
        settled: startCash,
        restricted: 0,
        receivables: 0,
        payables: 0,
        updated_at: t,
      });
    });
    tx();
    return { portfolio: mapPortfolio(S.getPortfolio.get(portfolioId)), account: mapAccount(S.getAccount.get(accountId)) };
  }

  function writeLedger(portfolioId, accountId, eventType, eventId, rows, memo, source = {}) {
    const group = id();
    const t = now();
    for (const row of rows) {
      S.insLedger.run({
        id: id(),
        journal_group_id: group,
        portfolio_id: portfolioId,
        account_id: accountId,
        event_type: eventType,
        event_id: eventId,
        ledger_account: row.account,
        currency: row.currency || "USD",
        debit: money(row.debit || 0),
        credit: money(row.credit || 0),
        memo,
        source_json: j(source),
        created_at: t,
      });
    }
    return group;
  }

  function adjustCash(portfolioId = DEFAULT_PORTFOLIO_ID, input = {}) {
    const resolved = resolvePortfolio(portfolioId);
    if (!resolved.portfolio || !resolved.account) throw Object.assign(new Error("portfolio not found"), { statusCode: 404 });
    const amount = n(input.amount);
    if (!amount) throw Object.assign(new Error("amount required"), { statusCode: 400 });
    const currency = input.currency || resolved.account.baseCurrency || "USD";
    const existing = S.getCash.get(resolved.account.id, currency);
    const settled = n(existing?.settled, n(resolved.account.startCash)) + amount;
    if (settled < -EPS) throw Object.assign(new Error("cash adjustment would make cash negative"), { statusCode: 400 });
    const t = now();
    S.upsertCash.run({
      id: `${resolved.account.id}:${currency}`,
      account_id: resolved.account.id,
      currency,
      available: settled,
      settled,
      restricted: n(existing?.restricted),
      receivables: n(existing?.receivables),
      payables: n(existing?.payables),
      updated_at: t,
    });
    const eventId = id();
    if (amount > 0) {
      writeLedger(resolved.portfolio.id, resolved.account.id, "cash_adjustment", eventId, [
        { account: "cash", debit: amount, currency },
        { account: "owner_contribution", credit: amount, currency },
      ], input.memo || "cash deposit", { actor: input.actor || "user" });
    } else {
      const abs = Math.abs(amount);
      writeLedger(resolved.portfolio.id, resolved.account.id, "cash_adjustment", eventId, [
        { account: "owner_withdrawal", debit: abs, currency },
        { account: "cash", credit: abs, currency },
      ], input.memo || "cash withdrawal", { actor: input.actor || "user" });
    }
    return accountSnapshot(resolved.portfolio.id);
  }

  function addHolding(portfolioId = DEFAULT_PORTFOLIO_ID, input = {}) {
    const resolved = resolvePortfolio(portfolioId);
    if (!resolved.portfolio || !resolved.account) throw Object.assign(new Error("portfolio not found"), { statusCode: 404 });
    const ticker = String(input.ticker || "").trim().toUpperCase();
    const qty = n(input.qty);
    const avgPrice = n(input.avgPrice);
    if (!ticker) throw Object.assign(new Error("ticker required"), { statusCode: 400 });
    if (!qty) throw Object.assign(new Error("quantity required"), { statusCode: 400 });
    if (!(avgPrice > 0)) throw Object.assign(new Error("avgPrice required"), { statusCode: 400 });
    const ownerType = String(input.ownerType || "manual").slice(0, 40);
    const ownerId = String(input.ownerId || "").slice(0, 80);
    const strategyVersion = String(input.strategyVersion || "").slice(0, 80);
    const positionId = `${resolved.portfolio.id}:${ticker}:${ownerType}:${ownerId || "manual"}`;
    const existing = S.getLegacyPosition.get(positionId);
    let nextQty = qty;
    let nextAvg = avgPrice;
    if (existing && Math.sign(n(existing.qty)) === Math.sign(qty)) {
      const oldQty = n(existing.qty);
      nextQty = oldQty + qty;
      nextAvg = (Math.abs(oldQty) * n(existing.avg_price) + Math.abs(qty) * avgPrice) / Math.abs(nextQty);
    }
    const openedAt = existing?.opened_at || input.openedAt || now();
    S.upsertLegacyPosition.run({
      id: positionId,
      ticker,
      qty: nextQty,
      avg_price: +nextAvg.toFixed(6),
      side: nextQty >= 0 ? "long" : "short",
      opened_at: openedAt,
      portfolio_id: resolved.portfolio.id,
      account_id: resolved.account.id,
      owner_type: ownerType,
      owner_id: ownerId,
      strategy_version: strategyVersion,
    });
    const notional = Math.abs(qty) * avgPrice;
    const eventId = id();
    writeLedger(resolved.portfolio.id, resolved.account.id, "holding_import", eventId, [
      { account: qty >= 0 ? "imported_long_position" : "imported_short_position", debit: notional },
      { account: "imported_capital_offset", credit: notional },
    ], input.memo || `${ticker} holding import`, { ticker, qty, avgPrice, ownerType, ownerId, strategyVersion });
    return accountSnapshot(resolved.portfolio.id);
  }

  function performance(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const snap = accountSnapshot(portfolioId);
    const curve = snap.portfolio?.id === DEFAULT_PORTFOLIO_ID ? equityCurve(500) : [];
    const values = curve.map((p) => n(p.equity)).filter((v) => Number.isFinite(v) && v > 0);
    let peak = values[0] || snap.account?.startCash || START_CASH;
    let maxDd = 0;
    for (const v of values) {
      peak = Math.max(peak, v);
      maxDd = Math.min(maxDd, peak ? (v / peak - 1) * 100 : 0);
    }
    const contrib = snap.positions.map((p) => ({
      ticker: p.ticker,
      ownerType: p.ownerType,
      marketValue: p.marketValue,
      unrealized: p.unrealized,
      weightPct: snap.summary.nav ? +(Math.abs(p.marketValue) / Math.abs(snap.summary.nav) * 100).toFixed(2) : 0,
    })).sort((a, b) => Math.abs(b.unrealized) - Math.abs(a.unrealized));
    const owner = {};
    for (const p of contrib) {
      owner[p.ownerType] = owner[p.ownerType] || { ownerType: p.ownerType, unrealized: 0, marketValue: 0 };
      owner[p.ownerType].unrealized = money(owner[p.ownerType].unrealized + p.unrealized);
      owner[p.ownerType].marketValue = money(owner[p.ownerType].marketValue + p.marketValue);
    }
    return {
      portfolio: snap.portfolio,
      summary: {
        nav: snap.summary.nav,
        startCash: snap.account?.startCash || START_CASH,
        totalPnl: snap.summary.totalPnl,
        totalPnlPct: snap.summary.totalPnlPct,
        realized: snap.summary.realized,
        unrealized: snap.summary.unrealized,
        maxDrawdownPct: +maxDd.toFixed(2),
        sampleSize: values.length,
        sampleWarning: values.length < 30 ? "Not enough equity history for stable Sharpe/Sortino/Calmar yet." : "",
      },
      curve,
      contributionByInstrument: contrib,
      contributionByOwner: Object.values(owner),
      asOf: now(),
    };
  }

  function classifyPosition(p) {
    const ticker = String(p.ticker || "").toUpperCase();
    const sector = SECTOR_BY_TICKER[ticker] || (ETF_TICKERS.has(ticker) ? "ETF / Multi-Asset" : "Unclassified Equity");
    const assetClass = ETF_TICKERS.has(ticker) ? "ETF" : "Equity";
    const absMv = Math.abs(n(p.marketValue));
    const quoteAge = p.quoteAgeSec == null ? Infinity : n(p.quoteAgeSec);
    const liquidityBucket = quoteAge > 900 ? "stale mark" : absMv < 25000 ? "small tracked" : absMv < 250000 ? "normal tracked" : "large tracked";
    return {
      assetClass,
      sector,
      industry: sector,
      geography: "United States",
      currency: "USD",
      venue: "US public market",
      liquidityBucket,
      strategy: p.strategyVersion || "unversioned",
      bot: p.ownerType === "bot" ? (p.ownerId || "bot") : p.ownerType,
      betaProxy: SECTOR_BETA_PROXY[sector] ?? 1,
      volProxy: sector === "High Vol Growth" ? 0.48 : sector === "Semiconductors" ? 0.38 : sector === "Rates" ? 0.16 : assetClass === "ETF" ? 0.2 : 0.28,
    };
  }

  function bucketRows(pos, keyFn, gross) {
    const map = new Map();
    for (const p of pos) {
      const key = keyFn(p);
      const row = map.get(key) || { key, marketValue: 0, absMarketValue: 0, long: 0, short: 0, count: 0, weightPct: 0 };
      const mv = n(p.marketValue);
      row.marketValue = money(row.marketValue + mv);
      row.absMarketValue = money(row.absMarketValue + Math.abs(mv));
      if (mv >= 0) row.long = money(row.long + Math.abs(mv)); else row.short = money(row.short + Math.abs(mv));
      row.count += 1;
      map.set(key, row);
    }
    return [...map.values()].map((r) => ({ ...r, weightPct: gross ? +((r.absMarketValue / gross) * 100).toFixed(2) : 0 }))
      .sort((a, b) => b.absMarketValue - a.absMarketValue);
  }

  function allocation(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const snap = accountSnapshot(portfolioId);
    const pos = snap.positions.map((p) => ({ ...p, classification: classifyPosition(p) }));
    const gross = snap.summary.grossExposure;
    const nav = Math.abs(snap.summary.nav) || 0;
    const weight = (v) => nav ? +((Math.abs(v) / nav) * 100).toFixed(2) : 0;
    const positionRows = pos.map((p) => ({
      ticker: p.ticker,
      side: p.side,
      ownerType: p.ownerType,
      sector: p.classification.sector,
      assetClass: p.classification.assetClass,
      marketValue: p.marketValue,
      absMarketValue: money(Math.abs(p.marketValue)),
      weightPct: weight(p.marketValue),
      betaProxy: p.classification.betaProxy,
      betaExposure: money(p.marketValue * p.classification.betaProxy),
      liquidityBucket: p.classification.liquidityBucket,
      quoteAgeSec: p.quoteAgeSec,
    })).sort((a, b) => b.absMarketValue - a.absMarketValue);
    const singleLimit = pos.length ? Math.max(12, Math.min(40, (100 / (Math.sqrt(pos.length) + 1)) * 1.8)) : 40;
    const sectorLimit = Math.max(25, Math.min(55, singleLimit * 1.8));
    const sectorRows = bucketRows(pos, (p) => p.classification.sector, gross);
    const breaches = [];
    for (const p of positionRows) {
      if (p.weightPct > singleLimit) breaches.push({ type: "single-name", severity: p.weightPct > singleLimit * 1.35 ? "high" : "warning", key: p.ticker, actualPct: p.weightPct, limitPct: +singleLimit.toFixed(2), message: `${p.ticker} is above the adaptive single-name concentration limit.` });
    }
    for (const s of sectorRows) {
      if (s.weightPct > sectorLimit) breaches.push({ type: "sector", severity: s.weightPct > sectorLimit * 1.25 ? "high" : "warning", key: s.key, actualPct: s.weightPct, limitPct: +sectorLimit.toFixed(2), message: `${s.key} is above the adaptive sector concentration limit.` });
    }
    const betaExposure = pos.reduce((a, p) => a + n(p.marketValue) * p.classification.betaProxy, 0);
    const volExposure = pos.reduce((a, p) => a + Math.abs(n(p.marketValue)) * p.classification.volProxy, 0);
    const stale = pos.filter((p) => p.quoteAgeSec == null || p.quoteAgeSec > 900).length;
    return {
      portfolio: snap.portfolio,
      summary: {
        nav: snap.summary.nav,
        grossExposure: snap.summary.grossExposure,
        netExposure: snap.summary.netExposure,
        longExposure: snap.summary.longExposure,
        shortExposure: snap.summary.shortExposure,
        betaExposure: money(betaExposure),
        betaToNav: nav ? +(betaExposure / nav).toFixed(3) : 0,
        volatilityExposure: money(volExposure),
        staleMarks: stale,
        breachCount: breaches.length,
      },
      groups: {
        assetClass: bucketRows(pos, (p) => p.classification.assetClass, gross),
        instrument: bucketRows(pos, (p) => p.ticker, gross),
        sector: sectorRows,
        industry: bucketRows(pos, (p) => p.classification.industry, gross),
        geography: bucketRows(pos, (p) => p.classification.geography, gross),
        currency: bucketRows(pos, (p) => p.classification.currency, gross),
        venue: bucketRows(pos, (p) => p.classification.venue, gross),
        liquidity: bucketRows(pos, (p) => p.classification.liquidityBucket, gross),
        strategy: bucketRows(pos, (p) => p.classification.strategy, gross),
        bot: bucketRows(pos, (p) => p.classification.bot, gross),
      },
      positions: positionRows,
      guardrails: {
        dynamicLimits: { singleNamePct: +singleLimit.toFixed(2), sectorPct: +sectorLimit.toFixed(2) },
        breaches,
      },
      warnings: [
        ...(stale ? [`${stale} position mark(s) are stale or fallback marks.`] : []),
        "Sector, beta, volatility and liquidity buckets are transparent portfolio proxies until deeper reference data is connected.",
      ],
      asOf: now(),
    };
  }

  function portfolioRisk(portfolioId = DEFAULT_PORTFOLIO_ID) {
    const snap = accountSnapshot(portfolioId);
    const alloc = allocation(portfolioId);
    const pos = snap.positions.map((p) => ({ ...p, classification: classifyPosition(p) }));
    const gross = Math.max(EPS, snap.summary.grossExposure);
    const equity = snap.portfolio?.id === DEFAULT_PORTFOLIO_ID ? equityCurve(500).map((x) => n(x.equity)).filter((v) => v > 0) : [];
    const returns = [];
    for (let i = 1; i < equity.length; i++) returns.push((equity[i] / equity[i - 1]) - 1);
    let histVar = null;
    let histCvar = null;
    if (returns.length >= 30) {
      const sorted = returns.slice().sort((a, b) => a - b);
      const idx = Math.max(0, Math.floor(sorted.length * 0.05));
      histVar = money(Math.abs(sorted[idx]) * Math.abs(snap.summary.nav));
      const tail = sorted.slice(0, idx + 1);
      histCvar = money(Math.abs(tail.reduce((a, v) => a + v, 0) / tail.length) * Math.abs(snap.summary.nav));
    }
    const weightedVol = pos.reduce((a, p) => a + (Math.abs(p.marketValue) / gross) * p.classification.volProxy, 0);
    const parametricVar = money(Math.abs(snap.summary.nav) * weightedVol * 1.65 / Math.sqrt(252));
    const var95 = histVar ?? parametricVar;
    const cvar95 = histCvar ?? money(parametricVar * 1.35);
    const component = pos.map((p) => {
      const absMv = Math.abs(n(p.marketValue));
      const rawRisk = absMv * p.classification.volProxy * p.classification.betaProxy;
      return { p, rawRisk };
    });
    const rawTotal = component.reduce((a, x) => a + Math.abs(x.rawRisk), 0) || 1;
    const contribution = component.map((x) => ({
      ticker: x.p.ticker,
      ownerType: x.p.ownerType,
      sector: x.p.classification.sector,
      componentCvar: money(cvar95 * Math.abs(x.rawRisk) / rawTotal),
      marginalRiskPct: +((Math.abs(x.rawRisk) / rawTotal) * 100).toFixed(2),
      liquidityBucket: x.p.classification.liquidityBucket,
      quoteAgeSec: x.p.quoteAgeSec,
    })).sort((a, b) => b.componentCvar - a.componentCvar);
    const hhi = alloc.positions.reduce((a, p) => a + Math.pow(p.weightPct / 100, 2), 0);
    const maxSector = alloc.groups.sector[0]?.weightPct || 0;
    const avgPairwiseProxy = +(Math.min(0.92, Math.max(0.12, 0.18 + hhi * 1.8 + maxSector / 180)).toFixed(3));
    const scenarios = [
      stressScenario("2008-style shock", pos, { Equity: -0.35, ETF: -0.3, Rates: 0.08, "Precious Metals": 0.05 }),
      stressScenario("COVID-style shock", pos, { Equity: -0.25, ETF: -0.22, "High Vol Growth": -0.35, Semiconductors: -0.3, Rates: 0.05 }),
      stressScenario("2022 rates shock", pos, { Technology: -0.28, Semiconductors: -0.35, "High Vol Growth": -0.45, Rates: -0.18, Equity: -0.18, ETF: -0.16 }),
    ];
    return {
      portfolio: snap.portfolio,
      summary: {
        nav: snap.summary.nav,
        var95,
        cvar95,
        method: returns.length >= 30 ? "historical daily equity returns" : "position proxy because equity history is insufficient",
        sampleSize: returns.length,
        concentrationHhi: +hhi.toFixed(4),
        avgPairwiseCorrelationProxy: avgPairwiseProxy,
        diversificationState: avgPairwiseProxy > 0.65 ? "fragile" : avgPairwiseProxy > 0.42 ? "watch" : "healthy",
        staleMarks: snap.dataStatus.staleMarks,
      },
      factorExposure: {
        spyBetaProxy: alloc.summary.betaToNav,
        sectorBetaDollars: alloc.summary.betaExposure,
        volatilityExposure: alloc.summary.volatilityExposure,
        downsideBetaProxy: +(alloc.summary.betaToNav * (1 + Math.max(0, maxSector - 35) / 100)).toFixed(3),
      },
      liquidity: alloc.groups.liquidity.map((x) => ({ bucket: x.key, marketValue: x.absMarketValue, weightPct: x.weightPct, count: x.count })),
      contribution,
      guardrails: alloc.guardrails,
      scenarios,
      warnings: [
        ...(returns.length < 30 ? ["Historical VaR is unavailable until at least 30 equity-return observations exist. Showing proxy risk instead."] : []),
        ...(snap.dataStatus.warnings || []),
      ],
      asOf: now(),
    };
  }

  function stressScenario(name, positions, shocks) {
    let pnl = 0;
    const contributors = [];
    for (const p of positions) {
      const cls = p.classification || classifyPosition(p);
      const shock = shocks[cls.sector] ?? shocks[cls.assetClass] ?? shocks.Equity ?? -0.2;
      const impact = money(n(p.marketValue) * shock);
      pnl += impact;
      contributors.push({ ticker: p.ticker, shockPct: +(shock * 100).toFixed(1), pnl: impact });
    }
    return { name, estimatedPnl: money(pnl), topContributors: contributors.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 5) };
  }

  function whatIf(portfolioId = DEFAULT_PORTFOLIO_ID, input = {}) {
    const snap = accountSnapshot(portfolioId);
    const currentRisk = portfolioRisk(portfolioId);
    const actions = Array.isArray(input.actions) ? input.actions : [];
    let cashDelta = 0;
    let grossDelta = 0;
    let netDelta = 0;
    const lines = [];
    for (const action of actions.slice(0, 50)) {
      const ticker = String(action.ticker || "").trim().toUpperCase();
      const type = String(action.type || "add").toLowerCase();
      const qty = n(action.qty);
      const price = Math.max(0, n(action.price || action.markPrice || 0));
      const notional = Math.abs(qty * price);
      if (!ticker || !qty || !price) continue;
      const sign = type === "trim" || type === "close" || type === "sell" ? -1 : 1;
      cashDelta -= sign * qty * price;
      grossDelta += sign * notional;
      netDelta += sign * qty * price;
      lines.push({ ticker, type, qty, price, notional: money(notional), estimatedCashDelta: money(-sign * qty * price) });
    }
    const proposedNav = money(snap.summary.nav + netDelta + cashDelta);
    const turnover = money(lines.reduce((a, x) => a + x.notional, 0));
    const transactionCost = money(turnover * 0.0005);
    const proposedGross = Math.max(0, money(snap.summary.grossExposure + grossDelta));
    const proposedNet = money(snap.summary.netExposure + netDelta);
    return {
      ok: true,
      pure: true,
      portfolioId: snap.portfolio?.id || portfolioId,
      proposalId: id(),
      objective: input.objective || "manual what-if",
      current: { nav: snap.summary.nav, cash: snap.summary.cash, grossExposure: snap.summary.grossExposure, netExposure: snap.summary.netExposure, cvar95: currentRisk.summary.cvar95 },
      proposed: { nav: money(proposedNav - transactionCost), cash: money(snap.summary.cash + cashDelta - transactionCost), grossExposure: proposedGross, netExposure: proposedNet, estimatedTransactionCost: transactionCost },
      delta: { nav: money(proposedNav - transactionCost - snap.summary.nav), cash: money(cashDelta - transactionCost), grossExposure: money(proposedGross - snap.summary.grossExposure), netExposure: money(proposedNet - snap.summary.netExposure) },
      lines,
      warnings: [
        "What-if is read-only and created no orders, fills, cash changes or ledger entries.",
        ...(snap.dataStatus.warnings || []),
      ],
      ledgerMutation: false,
      asOf: now(),
    };
  }

  function rebalanceProposal(portfolioId = DEFAULT_PORTFOLIO_ID, input = {}) {
    const alloc = allocation(portfolioId);
    const risk = portfolioRisk(portfolioId);
    const positions = alloc.positions;
    const gross = alloc.summary.grossExposure || 1;
    const target = input.objective || "reduce concentration and stale-mark risk";
    const maxName = alloc.guardrails.dynamicLimits.singleNamePct;
    const actions = [];
    for (const p of positions) {
      if (p.weightPct > maxName) {
        const targetValue = gross * maxName / 100;
        actions.push({ action: "trim", ticker: p.ticker, reason: "above adaptive single-name limit", estimatedNotional: money(Math.max(0, p.absMarketValue - targetValue)), currentWeightPct: p.weightPct, targetWeightPct: maxName });
      }
      if (p.quoteAgeSec == null || p.quoteAgeSec > 900) actions.push({ action: "review", ticker: p.ticker, reason: "stale mark before trading", estimatedNotional: 0, currentWeightPct: p.weightPct, targetWeightPct: p.weightPct });
    }
    const turnover = money(actions.reduce((a, x) => a + n(x.estimatedNotional), 0));
    return {
      ok: true,
      pure: true,
      portfolioId,
      proposalId: id(),
      objective: target,
      constraints: { maxSingleNamePct: maxName, currentBuyingPower: alloc.summary.nav ? allocation(portfolioId).summary.nav : 0, staleDataPolicy: "review before order draft" },
      current: { breachCount: alloc.guardrails.breaches.length, cvar95: risk.summary.cvar95, grossExposure: alloc.summary.grossExposure },
      proposal: {
        actions,
        turnover,
        estimatedTransactionCost: money(turnover * 0.0005),
        expectedRiskChange: actions.length ? "risk should fall if concentration trims are accepted" : "no forced rebalance needed",
      },
      warnings: ["Proposal creates review actions only. It does not place trades."],
      ledgerMutation: false,
      asOf: now(),
    };
  }

  function hedgeProposal(portfolioId = DEFAULT_PORTFOLIO_ID, input = {}) {
    const risk = portfolioRisk(portfolioId);
    const alloc = allocation(portfolioId);
    const nav = Math.abs(alloc.summary.nav) || START_CASH;
    const hedgePct = Math.max(0.05, Math.min(0.5, n(input.hedgePct, risk.summary.diversificationState === "fragile" ? 0.25 : 0.12)));
    const instrument = input.instrument || (alloc.summary.betaToNav > 0.8 ? "SPY put spread / inverse ETF review" : "cash buffer review");
    const notional = money(nav * hedgePct);
    return {
      ok: true,
      pure: true,
      portfolioId,
      proposalId: id(),
      instrument,
      expectedProtection: { notional, hedgePct: +(hedgePct * 100).toFixed(2), roughDownsideOffset: money(notional * 0.65) },
      basisRisk: alloc.groups.sector.length > 1 ? "medium: hedge may not match all sector exposures" : "high: book is concentrated",
      estimatedCost: money(notional * 0.0125),
      liquidity: "requires fresh quote check before any order draft",
      warnings: ["Hedge proposal is an estimate. Options/borrow/ETF execution must be checked before order drafting."],
      ledgerMutation: false,
      asOf: now(),
    };
  }

  return {
    close: () => db.close(),
    ids: { DEFAULT_PORTFOLIO_ID, DEFAULT_ACCOUNT_ID },
    list: () => S.listPortfolios.all().map(mapPortfolio),
    create: createPortfolio,
    get: (portfolioId) => resolvePortfolio(portfolioId),
    account: accountSnapshot,
    reconciliation,
    positions,
    orders,
    journal,
    equityCurve,
    adjustCash,
    addHolding,
    performance,
    allocation,
    risk: portfolioRisk,
    whatIf,
    rebalanceProposal,
    hedgeProposal,
  };
}

module.exports = { createApexPortfolio, DEFAULT_PORTFOLIO_ID, DEFAULT_ACCOUNT_ID };
