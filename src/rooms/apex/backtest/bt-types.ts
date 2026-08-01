/* APEX Backtest Engine — shared result types. One typed contract for the whole
   Backtest tab, produced by bt-engine.ts (which drives Forge Engine B: event-driven,
   no look-ahead, real commission/slippage/sizing). Everything here traces to a real
   computation on free-feed data — see bt-engine.ts for the honesty notes per field. */

import type { Trade, EquityPoint, Metrics } from "../forge/forge-engine";
export type { Trade, EquityPoint, Metrics };

export type Timeframe = "1d" | "1h" | "15m";
export type TradeMode = "long" | "short" | "both";

export interface BtConfig {
  strategyId: string | null;
  strategyName: string;
  symbol: string;
  assetClass: string;         // "stocks" | "crypto" | …
  timeframe: Timeframe;
  benchmark: string;          // e.g. "SPY"
  startCash: number;
  commissionPct: number;      // percent per side (0.05 = 5 bps)
  slippagePct: number;        // percent per fill
  mode: TradeMode;
}

export interface SeriesPoint { t: number; v: number }              // t = ms epoch

export interface MonthlyCell { year: number; month: number; ret: number } // month 0-11, ret = fraction
export interface DrawdownEpisode {
  depthPct: number;           // negative fraction ×100 (e.g. -14.82)
  startT: number; troughT: number; recoverT: number | null;
  days: number;               // peak → trough (calendar days)
  recoveryDays: number | null;// trough → new-high; null = never recovered in-sample
}
export interface EquityStats {
  bestDayPct: number; bestDayT: number;
  worstDayPct: number; worstDayT: number;
  bestMonthPct: number; bestMonthLabel: string;
  worstMonthPct: number; worstMonthLabel: string;
  winningMonthsPct: number; avgMonthlyPct: number;
}
export interface McResult {
  runs: number; seed: number; startCash: number;
  finals: number[];           // per-sim final equity (for the histogram)
  pProfit: number;            // fraction of sims ending > startCash
  p5: number; p50: number; p95: number; avgFinal: number;
}
export interface WfFold {
  i: number; oosFrom: string; oosTo: string;
  isSharpe: number; oosSharpe: number; oosRetPct: number; passed: boolean;
}
export interface WalkForward { folds: WfFold[]; oosSharpe: number; oosRetPct: number; wfe: number }

/** The full, typed backtest run consumed by every panel in the tab. */
export interface BacktestRun {
  config: BtConfig;
  synthetic: boolean;         // true if the underlying bars were a synthetic/GBM fallback (honesty badge)
  delayed: boolean;           // free feed → delayed/EOD (honesty badge)
  asOf: string;               // last bar date
  barsUsed: number;
  metrics: Metrics;           // incl. sqn, expectancy, avgWin/avgLoss/best/worst
  equity: EquityPoint[];      // {t, equity, drawdown} from Engine B
  trades: Trade[];
  strategyEquity: SeriesPoint[];
  buyHold: SeriesPoint[];
  benchmark: SeriesPoint[] | null;
  benchmarkSymbol: string;
  monthly: MonthlyCell[];
  drawdowns: DrawdownEpisode[];
  equityStats: EquityStats;
  mc: McResult | null;
  walkForward: WalkForward | null;
  error?: string;
}
