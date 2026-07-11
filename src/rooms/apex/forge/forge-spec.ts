/* THE FORGE — BotSpec: the single serializable source of truth for a strategy.
   Forms, node-graph, and imported Python all compile to this shape. The engine
   (forge-engine.ts) reads it; the UI edits it. Versioned + migration-safe. */

export const FORGE_SPEC_VERSION = 1;

/* ── Blocks ───────────────────────────────────────────────────────────────
   Every block is { id, type, params }. `type` keys into the block registry
   (forge-blocks.ts) which owns the params schema + a pure evaluate(). ── */
export type BlockKind = "signal" | "filter" | "entry" | "exit" | "sizer" | "risk";

export interface SignalBlock { id: string; type: string; params: Record<string, number | string | boolean> }

/* Entry logic is a boolean tree over signal conditions, so users can express
   "(A crosses up B) AND (RSI < 30)" without code. */
export type Cmp = "cross_up" | "cross_dn" | "gt" | "lt" | "gte" | "lte" | "true" | "false";
export interface SignalCond { signal: string; cmp: Cmp; value?: number; vsSignal?: string } // compare a signal to a constant or another signal
export interface LogicNode { op: "AND" | "OR" | "NOT"; operands: EntryNode[] }
export type EntryNode = SignalCond | LogicNode;
export const isLogic = (n: EntryNode): n is LogicNode => (n as LogicNode).op !== undefined;

export interface ExitRules {
  stopLossPct?: number;        // e.g. 3 = -3% hard stop
  takeProfitPct?: number;      // e.g. 6 = +6% target
  trailingPct?: number;        // trailing stop distance %
  atrStopMult?: number;        // stop = entry - mult*ATR
  timeBars?: number;           // exit after N bars in trade
  signalExit?: EntryNode;      // exit when this condition is true
}

export type SizingMethod = "fixed_cash" | "pct_equity" | "vol_target" | "kelly_frac";
export interface Sizing { method: SizingMethod; value: number } // value = $ / % / target-vol% / kelly-fraction

export interface RiskRules {
  maxPositions?: number;       // max concurrent open positions
  maxDrawdownPct?: number;     // kill-switch: flatten if equity DD exceeds this
  perTradeRiskPct?: number;    // cap risk per trade as % of equity
  maxExposurePct?: number;     // cap total deployed % of equity
}

export interface Universe {
  assetClass: "stocks" | "crypto" | "mixed";
  symbols: string[];
  bar: "1d" | "1h" | "15m";
  maxConcurrent: number;
}

export interface BotSpec {
  meta: { id: string; name: string; description: string; tags: string[]; version: number; createdAt: number; updatedAt: number; source: "forms" | "nodes" | "python" };
  universe: Universe;
  signals: SignalBlock[];
  entry: EntryNode;
  exit: ExitRules;
  sizing: Sizing;
  risk: RiskRules;
}

/* Deterministic id without Date.now()/Math.random() dependence at module load —
   callers pass a seed (timestamp) so specs stay reproducible/testable. */
export function newId(prefix: string, seed: number): string {
  return `${prefix}_${seed.toString(36)}${(seed % 997).toString(36)}`;
}

/* Default backtest universe — a strategy trades a ~30-name liquid US large-cap
   basket out of the box (not a single ticker). Users can trim it, swap presets,
   or click "All" for the wider list. */
export const DEFAULT_UNIVERSE: string[] = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "JPM", "V",
  "UNH", "XOM", "MA", "HD", "PG", "COST", "JNJ", "ABBV", "WMT", "MRK",
  "CVX", "KO", "PEP", "BAC", "CRM", "AMD", "NFLX", "ADBE", "DIS", "INTC",
];

export function blankSpec(seed: number): BotSpec {
  return {
    meta: { id: newId("strat", seed), name: "Untitled Strategy", description: "", tags: [], version: FORGE_SPEC_VERSION, createdAt: seed, updatedAt: seed, source: "forms" },
    universe: { assetClass: "stocks", symbols: [...DEFAULT_UNIVERSE], bar: "1d", maxConcurrent: 10 },
    signals: [
      { id: "fast", type: "ema", params: { period: 20 } },
      { id: "slow", type: "ema", params: { period: 50 } },
    ],
    entry: { op: "AND", operands: [{ signal: "fast", cmp: "cross_up", vsSignal: "slow" }] },
    exit: { stopLossPct: 5, takeProfitPct: 10 },
    sizing: { method: "pct_equity", value: 100 },
    risk: { maxPositions: 1, maxDrawdownPct: 25 },
  };
}

/* A couple of starter templates so the Library is never empty. */
export function templateSpecs(seed: number): BotSpec[] {
  const trend = blankSpec(seed);
  trend.meta = { ...trend.meta, id: newId("strat", seed + 1), name: "EMA Trend", description: "Buy when the fast EMA crosses above the slow EMA; ride with a trailing stop.", tags: ["trend", "template"] };
  trend.exit = { trailingPct: 8, stopLossPct: 6 };

  const meanRev = blankSpec(seed + 2);
  meanRev.meta = { ...meanRev.meta, id: newId("strat", seed + 2), name: "RSI Mean-Reversion", description: "Buy oversold (RSI < 30), exit on target or when RSI recovers.", tags: ["mean-reversion", "template"] };
  meanRev.signals = [{ id: "rsi", type: "rsi", params: { period: 14 } }];
  meanRev.entry = { op: "AND", operands: [{ signal: "rsi", cmp: "lt", value: 30 }] };
  meanRev.exit = { takeProfitPct: 5, signalExit: { op: "AND", operands: [{ signal: "rsi", cmp: "gt", value: 55 }] } };

  const breakout = blankSpec(seed + 3);
  breakout.meta = { ...breakout.meta, id: newId("strat", seed + 3), name: "Volatility Breakout", description: "Buy N-day breakout, stop under recent ATR.", tags: ["breakout", "template"] };
  breakout.signals = [{ id: "px", type: "price", params: {} }, { id: "hi", type: "donchian_hi", params: { period: 20 } }, { id: "atr", type: "atr", params: { period: 14 } }];
  breakout.entry = { op: "AND", operands: [{ signal: "px", cmp: "cross_up", vsSignal: "hi" }] };
  breakout.exit = { atrStopMult: 2.5, takeProfitPct: 15 };

  const golden = blankSpec(seed + 4);
  golden.meta = { ...golden.meta, id: newId("strat", seed + 4), name: "Golden Cross", description: "Classic 50/200 SMA trend filter — buy the cross up, exit on the cross down.", tags: ["trend", "template"] };
  golden.signals = [{ id: "fast", type: "sma", params: { period: 50 } }, { id: "slow", type: "sma", params: { period: 200 } }];
  golden.entry = { op: "AND", operands: [{ signal: "fast", cmp: "cross_up", vsSignal: "slow" }] };
  golden.exit = { signalExit: { op: "AND", operands: [{ signal: "fast", cmp: "cross_dn", vsSignal: "slow" }] }, stopLossPct: 12 };

  const bollBounce = blankSpec(seed + 5);
  bollBounce.meta = { ...bollBounce.meta, id: newId("strat", seed + 5), name: "Bollinger Bounce", description: "Buy when price tags the lower Bollinger band; take profit at the middle.", tags: ["mean-reversion", "template"] };
  bollBounce.signals = [{ id: "px", type: "price", params: {} }, { id: "lb", type: "boll_dn", params: { period: 20, mult: 2 } }];
  bollBounce.entry = { op: "AND", operands: [{ signal: "px", cmp: "lt", vsSignal: "lb" }] };
  bollBounce.exit = { takeProfitPct: 4, stopLossPct: 6 };

  const momentum = blankSpec(seed + 6);
  momentum.meta = { ...momentum.meta, id: newId("strat", seed + 6), name: "Momentum (ROC)", description: "Ride strength — buy when 20-day rate-of-change turns strongly positive.", tags: ["momentum", "template"] };
  momentum.signals = [{ id: "roc", type: "roc", params: { period: 20 } }];
  momentum.entry = { op: "AND", operands: [{ signal: "roc", cmp: "gt", value: 5 }] };
  momentum.exit = { trailingPct: 10, signalExit: { op: "AND", operands: [{ signal: "roc", cmp: "lt", value: 0 }] } };

  return [trend, meanRev, breakout, golden, bollBounce, momentum];
}

/* Human-readable one-liner for a spec (used in the UI + Jarvis briefs). */
export function summarizeEntry(node: EntryNode, signals: SignalBlock[]): string {
  const nameOf = (id: string) => { const s = signals.find(x => x.id === id); return s ? `${s.type.toUpperCase()}(${Object.values(s.params).join(",")})` : id; };
  if (isLogic(node)) {
    if (node.op === "NOT") return `NOT ${summarizeEntry(node.operands[0], signals)}`;
    return node.operands.map(o => summarizeEntry(o, signals)).join(node.op === "AND" ? " and " : " or ");
  }
  const c = node as SignalCond;
  const rhs = c.vsSignal ? nameOf(c.vsSignal) : String(c.value ?? "");
  const verb = { cross_up: "crosses above", cross_dn: "crosses below", gt: ">", lt: "<", gte: "≥", lte: "≤", true: "is true", false: "is false" }[c.cmp];
  return `${nameOf(c.signal)} ${verb} ${rhs}`.trim();
}
