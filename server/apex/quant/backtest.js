// APEX native quant — the backtest engine (Node port of Vibe-Trading's event-driven engine).
// Weight-driven: a strategy emits a target position weight per bar (-1..1, short..long); the engine
// applies slippage + commission on turnover, marks equity to market each bar, and records round-trip
// trades (pnl, holding_bars, exit_reason). Produces the equity_curve + trade_log + metrics contract.

const { calcMetrics } = require("./metrics");

// bars: [{ date, open, high, low, close, volume }]. weights: number[] (target weight per bar).
// config: { initialCash, commission (per-turnover rate), slippage (rate), barsPerYear, benchClose }.
function runBacktest(bars, weights, config = {}) {
  const initialCash = config.initialCash ?? 1_000_000;
  const commission = config.commission ?? 0.0005;   // 5 bps per side
  const slippage = config.slippage ?? 0.0005;        // 5 bps
  const barsPerYear = config.barsPerYear ?? 252;
  const n = bars.length;
  if (n < 2) return { equity_curve: [], trade_log: [], metrics: calcMetrics([], [], initialCash, barsPerYear), bars: n };

  const clamp = (w) => Math.max(-1, Math.min(1, Number.isFinite(w) ? w : 0));
  const w = bars.map((_, i) => clamp(weights[i]));

  const equity = new Array(n).fill(initialCash);
  const trades = [];
  // open holding: { entryEquity, entryBar, dir }
  let holding = null;

  const openTrade = (i, dir) => { holding = { entryEquity: equity[i], entryBar: i, dir, entryPrice: bars[i].close }; };
  const closeTrade = (i, reason) => {
    if (!holding) return;
    const pnl = equity[i] - holding.entryEquity;
    trades.push({
      symbol: config.symbol || "ASSET",
      direction: holding.dir,
      entry_price: round(holding.entryPrice, 4),
      exit_price: round(bars[i].close, 4),
      entry_time: bars[holding.entryBar].date,
      exit_time: bars[i].date,
      pnl: round(pnl, 2),
      pnl_pct: round(holding.entryEquity ? pnl / holding.entryEquity : 0, 6),
      holdingBars: i - holding.entryBar,
      holding_bars: i - holding.entryBar,
      exit_reason: reason,
    });
    holding = null;
  };

  for (let i = 1; i < n; i++) {
    const r = bars[i - 1].close ? bars[i].close / bars[i - 1].close - 1 : 0;
    const wPrev = w[i - 1];
    const wPrevPrev = i >= 2 ? w[i - 2] : 0;
    const turnover = Math.abs(wPrev - wPrevPrev);
    const cost = turnover * (commission + slippage);
    const barRet = wPrev * r - cost;
    equity[i] = equity[i - 1] * (1 + barRet);

    // trade bookkeeping on position change
    const dirPrev = Math.sign(wPrevPrev);
    const dirNow = Math.sign(wPrev);
    if (dirNow !== dirPrev) {
      if (holding) closeTrade(i - 1, "signal");
      if (dirNow !== 0) openTrade(i - 1, dirNow);
    }
  }
  if (holding) closeTrade(n - 1, "end_of_backtest");

  // benchmark per-bar returns (buy & hold of benchClose, or the asset itself)
  const benchClose = config.benchClose && config.benchClose.length === n ? config.benchClose : bars.map((b) => b.close);
  const benchRet = benchClose.map((c, i) => (i && benchClose[i - 1] ? c / benchClose[i - 1] - 1 : 0));

  const metrics = calcMetrics(equity, trades, initialCash, barsPerYear, benchRet);
  const equity_curve = bars.map((b, i) => ({ date: b.date, equity: round(equity[i], 2), ret: round(equity[i] / initialCash - 1, 6) }));

  return { equity_curve, trade_log: trades, metrics, bars: n };
}

function round(x, d) { const p = 10 ** d; return Number.isFinite(x) ? Math.round(x * p) / p : 0; }

module.exports = { runBacktest };
