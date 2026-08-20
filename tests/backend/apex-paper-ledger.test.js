"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const adapters = require("../../server/providers/apex/adapters");
adapters.yahooQuotes = async (symbols = []) => symbols.map((ticker) => ({ ticker: String(ticker).toUpperCase(), last: 100, prev: 99, name: ticker }));

const { createApexPaper } = require("../../server/apex/apex-paper");

function tempRuntime() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-paper-"));
}

test("paper limit order reserves buying power and cancel releases it", async () => {
  const dir = tempRuntime();
  const paper = createApexPaper(dir);
  try {
    const opened = await paper.place({ ticker: "AAPL", side: "buy", qty: 10, type: "limit", limitPrice: 90 });
    assert.equal(opened.status, "open");

    const orders = paper.orders();
    assert.equal(orders.open.length, 1);
    assert.equal(orders.open[0].reservedCash, 900.09);

    const acctWithReserve = await paper.account();
    assert.equal(acctWithReserve.account.buyingPower, 99099.91);

    paper.cancel(opened.orderId);
    const acctAfterCancel = await paper.account();
    assert.equal(acctAfterCancel.account.buyingPower, 100000);
  } finally {
    paper.reset();
    paper.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paper short sale does not inflate buying power and writes balanced ledger groups", async () => {
  const dir = tempRuntime();
  const paper = createApexPaper(dir);
  const db = new Database(path.join(dir, "apex.sqlite"));
  try {
    const filled = await paper.place({ ticker: "MSFT", side: "sell", qty: 10, type: "market" });
    assert.equal(filled.status, "filled");

    const acct = await paper.account();
    assert.equal(acct.positions[0].side, "short");
    assert.ok(acct.account.cash > 100000, "short proceeds increase cash");
    assert.ok(acct.account.buyingPower < 100000, "margin-aware buying power must not be inflated by short proceeds");

    const bad = db.prepare(`SELECT journal_group_id, ROUND(SUM(debit), 6) debit_total, ROUND(SUM(credit), 6) credit_total
      FROM apex_ledger_entries GROUP BY journal_group_id HAVING ABS(SUM(debit) - SUM(credit)) > 0.01`).all();
    assert.deepEqual(bad, []);
  } finally {
    db.close();
    paper.reset();
    paper.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("paper desk ignores positions owned by other portfolios", async () => {
  const dir = tempRuntime();
  const paper = createApexPaper(dir);
  const db = new Database(path.join(dir, "apex.sqlite"));
  try {
    db.prepare("INSERT INTO apex_positions (id,ticker,qty,avg_price,side,opened_at,portfolio_id,account_id,owner_type,owner_id,strategy_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("demo:AAPL", "AAPL", 10, 100, "long", new Date().toISOString(), "demo-portfolio", "demo-account", "manual", "", "");
    const acct = await paper.account();
    assert.equal(acct.positions.length, 0);
    assert.equal(acct.account.equity, 100000);
  } finally {
    db.close();
    paper.reset();
    paper.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
