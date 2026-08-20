"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { createApexPortfolio } = require("../../server/apex/apex-portfolio");

function tempRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-portfolio-"));
}

test("portfolio service seeds a default paper portfolio and reconciled empty NAV", () => {
  const dir = tempRuntime();
  const portfolio = createApexPortfolio(dir);
  try {
    const rows = portfolio.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "paper-default");
    assert.equal(rows[0].kind, "paper");

    const acct = portfolio.account("paper-default");
    assert.equal(acct.summary.nav, 100000);
    assert.equal(acct.summary.cash, 100000);
    assert.equal(acct.summary.openPositions, 0);

    const rec = portfolio.reconciliation("paper-default");
    assert.equal(rec.ok, true);
    assert.equal(rec.difference, 0);
  } finally {
    portfolio.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("portfolio account marks positions, exposes stale status, and reconciles NAV", () => {
  const dir = tempRuntime();
  const portfolio = createApexPortfolio(dir);
  const db = new Database(path.join(dir, "apex.sqlite"));
  try {
    db.prepare("INSERT INTO apex_positions (id,ticker,qty,avg_price,side,opened_at,portfolio_id,account_id,owner_type,owner_id,strategy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("AAPL", "AAPL", 10, 100, "long", new Date().toISOString(), "paper-default", "paper-account", "manual", "", "");
    db.prepare("INSERT INTO apex_quotes_live (ticker,last,ts) VALUES (?,?,?)").run("AAPL", 110, new Date().toISOString());

    const acct = portfolio.account("paper-default");
    assert.equal(acct.summary.nav, 101100);
    assert.equal(acct.summary.marketValue, 1100);
    assert.equal(acct.summary.unrealized, 100);
    assert.equal(acct.positions[0].markSource, "apex_quotes_live");
    assert.equal(acct.dataStatus.ok, true);

    const rec = portfolio.reconciliation("paper-default");
    assert.equal(rec.ok, true);
    assert.equal(rec.components.markedPositions, 1100);
  } finally {
    db.close();
    portfolio.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("portfolio create produces isolated portfolio/account/cash records", () => {
  const dir = tempRuntime();
  const portfolio = createApexPortfolio(dir);
  try {
    const created = portfolio.create({ name: "Recovery Book", startCash: 2500, mandate: "Safe recovery test" });
    assert.equal(created.portfolio.name, "Recovery Book");
    assert.equal(created.account.startCash, 2500);

    const rows = portfolio.list();
    assert.equal(rows.some((p) => p.name === "Recovery Book"), true);
  } finally {
    portfolio.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sample portfolio cash and holdings stay isolated from default paper cash", () => {
  const dir = tempRuntime();
  const portfolio = createApexPortfolio(dir);
  const db = new Database(path.join(dir, "apex.sqlite"));
  try {
    const created = portfolio.create({ name: "Sample Book", startCash: 5000, mandate: "Manual test" });
    const id = created.portfolio.id;
    portfolio.adjustCash(id, { amount: 250 });
    portfolio.addHolding(id, { ticker: "MSFT", qty: 5, avgPrice: 200, ownerType: "strategy", strategyVersion: "v1" });
    db.prepare("INSERT INTO apex_quotes_live (ticker,last,ts) VALUES (?,?,?)").run("MSFT", 220, new Date().toISOString());

    const acct = portfolio.account(id);
    assert.equal(acct.summary.cash, 5250);
    assert.equal(acct.summary.marketValue, 1100);
    assert.equal(acct.summary.nav, 6350);
    assert.equal(acct.summary.unrealized, 100);
    assert.equal(acct.summary.totalPnl, 100);
    assert.equal(acct.summary.totalPnlPct, 10);
    assert.equal(acct.positions[0].ownerType, "strategy");

    const paper = portfolio.account("paper-default");
    assert.equal(paper.summary.cash, 100000);
    assert.equal(paper.summary.openPositions, 0);

    const perf = portfolio.performance(id);
    assert.equal(perf.contributionByInstrument[0].ticker, "MSFT");
    assert.equal(perf.contributionByInstrument[0].unrealized, 100);
    assert.equal(perf.contributionByOwner[0].ownerType, "strategy");
  } finally {
    db.close();
    portfolio.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("allocation risk and proposals are reconciled and read-only", () => {
  const dir = tempRuntime();
  const portfolio = createApexPortfolio(dir);
  const db = new Database(path.join(dir, "apex.sqlite"));
  try {
    const created = portfolio.create({ name: "Risk Book", startCash: 10000, mandate: "Wave 6-8 test" });
    const id = created.portfolio.id;
    portfolio.addHolding(id, { ticker: "AAPL", qty: 10, avgPrice: 100, ownerType: "manual" });
    portfolio.addHolding(id, { ticker: "NVDA", qty: 4, avgPrice: 200, ownerType: "bot", ownerId: "jarvis" });
    db.prepare("INSERT INTO apex_quotes_live (ticker,last,ts) VALUES (?,?,?)").run("AAPL", 120, new Date().toISOString());
    db.prepare("INSERT INTO apex_quotes_live (ticker,last,ts) VALUES (?,?,?)").run("NVDA", 250, new Date().toISOString());

    const before = {
      positions: db.prepare("SELECT COUNT(*) c FROM apex_positions").get().c,
      orders: db.prepare("SELECT COUNT(*) c FROM apex_orders").get().c,
      fills: db.prepare("SELECT COUNT(*) c FROM apex_fills").get().c,
      ledger: db.prepare("SELECT COUNT(*) c FROM apex_ledger_entries").get().c,
    };

    const allocation = portfolio.allocation(id);
    assert.equal(allocation.summary.grossExposure, 2200);
    assert.equal(allocation.groups.instrument.reduce((a, x) => +(a + x.absMarketValue).toFixed(2), 0), 2200);
    assert.equal(allocation.positions.some((p) => p.ticker === "NVDA" && p.sector === "Semiconductors"), true);

    const risk = portfolio.risk(id);
    assert.equal(risk.summary.cvar95 > 0, true);
    assert.equal(risk.contribution.reduce((a, x) => +(a + x.componentCvar).toFixed(2), 0), risk.summary.cvar95);

    const whatIf = portfolio.whatIf(id, { actions: [{ type: "add", ticker: "MSFT", qty: 2, price: 300 }] });
    assert.equal(whatIf.pure, true);
    assert.equal(whatIf.ledgerMutation, false);
    assert.equal(whatIf.proposed.grossExposure, 2800);
    const rebalance = portfolio.rebalanceProposal(id, { objective: "reduce concentration" });
    assert.equal(rebalance.pure, true);
    const hedge = portfolio.hedgeProposal(id, { hedgePct: 0.2 });
    assert.equal(hedge.pure, true);

    const after = {
      positions: db.prepare("SELECT COUNT(*) c FROM apex_positions").get().c,
      orders: db.prepare("SELECT COUNT(*) c FROM apex_orders").get().c,
      fills: db.prepare("SELECT COUNT(*) c FROM apex_fills").get().c,
      ledger: db.prepare("SELECT COUNT(*) c FROM apex_ledger_entries").get().c,
    };
    assert.deepEqual(after, before);
  } finally {
    db.close();
    portfolio.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
