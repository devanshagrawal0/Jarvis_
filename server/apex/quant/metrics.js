// APEX native quant — performance metrics. A faithful Node port of Vibe-Trading's
// agent/backtest/metrics.py (MIT, HKUDS/Vibe-Trading), so the native engine returns the SAME
// metric contract the Vibe sidecar did — no Python. Formulas: total/annual return, Sharpe,
// Sortino, Calmar, max drawdown, win rate, profit factor, information ratio.

// Sample standard deviation (ddof=1, matching pandas Series.std()).
function std(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (a.length < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}
function mean(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
// Per-bar simple returns from an equity series (returns[0] = 0, like pct_change().fillna(0)).
function pctChange(equity) {
  const out = new Array(equity.length).fill(0);
  for (let i = 1; i < equity.length; i++) out[i] = equity[i - 1] ? equity[i] / equity[i - 1] - 1 : 0;
  return out;
}

// trades: [{ pnl, holdingBars }]
function winRateAndStats(trades) {
  if (!trades || !trades.length) return { winRate: 0, profitLossRatio: 0, maxConsecutiveLoss: 0, avgHoldingBars: 0, profitFactor: 0 };
  const wins = trades.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const losses = trades.filter((t) => t.pnl < 0).map((t) => t.pnl);
  const winRate = wins.length / trades.length;
  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 1e-10;
  const profitLossRatio = avgLoss > 1e-10 ? avgWin / avgLoss : 0;
  const grossProfit = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0)) || 1e-10;
  const profitFactor = grossLoss > 1e-10 ? grossProfit / grossLoss : 0;
  let maxConsec = 0, cur = 0;
  for (const t of trades) { if (t.pnl < 0) { cur += 1; maxConsec = Math.max(maxConsec, cur); } else cur = 0; }
  const holdBars = trades.filter((t) => t.holdingBars > 0).map((t) => t.holdingBars);
  return {
    winRate,
    profitLossRatio: round(profitLossRatio, 4),
    maxConsecutiveLoss: maxConsec,
    avgHoldingBars: round(holdBars.length ? mean(holdBars) : 0, 1),
    profitFactor: round(profitFactor, 4),
  };
}

// equity: number[] (equity per bar). trades: [{pnl, holdingBars}]. benchRet: number[]|null (per-bar).
function calcMetrics(equity, trades, initialCash, barsPerYear = 252, benchRet = null) {
  if (!equity || !equity.length) return emptyMetrics(initialCash);
  const n = equity.length;
  const bpy = barsPerYear || 252;
  const portRet = pctChange(equity);

  const totalRet = equity[n - 1] / initialCash - 1;
  const growth = 1 + totalRet;
  const annRet = growth <= 0 ? -1 : Math.pow(growth, bpy / Math.max(n, 1)) - 1;
  const vol = std(portRet);
  const sharpe = (mean(portRet) / (vol + 1e-10)) * Math.sqrt(bpy);

  // max drawdown
  let peak = -Infinity, maxDd = 0;
  for (const e of equity) { if (e > peak) peak = e; const dd = peak ? (e - peak) / peak : 0; if (dd < maxDd) maxDd = dd; }
  const calmar = Math.abs(maxDd) > 1e-10 ? annRet / Math.abs(maxDd) : 0;

  const downside = portRet.filter((r) => r < 0);
  const downsideStd = downside.length > 1 ? std(downside) : 1e-10;
  const sortino = (mean(portRet) / (downsideStd + 1e-10)) * Math.sqrt(bpy);

  const ts = winRateAndStats(trades);

  let benchReturn = 0, excess = 0, ir = 0;
  if (benchRet && benchRet.length) {
    benchReturn = benchRet.reduce((p, r) => p * (1 + r), 1) - 1;
    excess = totalRet - benchReturn;
    const active = portRet.map((r, i) => r - (Number.isFinite(benchRet[i]) ? benchRet[i] : 0));
    const activeStd = std(active);
    ir = (mean(active) / (activeStd + 1e-10)) * Math.sqrt(bpy);
  }

  return {
    final_value: equity[n - 1],
    total_return: totalRet,
    annual_return: annRet,
    max_drawdown: maxDd,
    sharpe,
    calmar: round(calmar, 4),
    sortino: round(sortino, 4),
    win_rate: ts.winRate,
    profit_loss_ratio: ts.profitLossRatio,
    profit_factor: ts.profitFactor,
    max_consecutive_loss: ts.maxConsecutiveLoss,
    avg_holding_days: ts.avgHoldingBars,
    trade_count: trades ? trades.length : 0,
    benchmark_return: round(benchReturn, 6),
    excess_return: round(excess, 6),
    information_ratio: round(ir, 4),
  };
}

function emptyMetrics(initialCash) {
  return {
    final_value: initialCash, total_return: 0, annual_return: 0, max_drawdown: 0, sharpe: 0, calmar: 0, sortino: 0,
    win_rate: 0, profit_loss_ratio: 0, profit_factor: 0, max_consecutive_loss: 0, avg_holding_days: 0, trade_count: 0,
    benchmark_return: 0, excess_return: 0, information_ratio: 0,
  };
}
function round(x, d) { const p = 10 ** d; return Number.isFinite(x) ? Math.round(x * p) / p : 0; }

module.exports = { calcMetrics, winRateAndStats, emptyMetrics, std, mean, pctChange };
