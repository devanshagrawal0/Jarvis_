# APEX — THE FORGE: Strategy & Bot Builder (Master Plan)

> Status: **PLAN ONLY — not yet built.** Tab created (Home · **Forge** · …), Overview tab removed.
> Locked decisions (Dev, 2026-07-09):
> 1. **Builder style:** Forms-first, node-graph later — ship a clean panel/form builder on a proven spec+engine, then layer a visual node canvas on the *same* spec.
> 2. **Scope v1:** Stocks + crypto, **public data only** (Yahoo bars + Coinbase) — shareable, no keys.

---

## 0. Guiding principle
A **bot is composed from typed, reusable blocks**, never hardcoded. Every bot is a **serializable spec (JSON)** that can be saved, cloned, versioned, backtested, paper-traded, and deployed **without rewriting logic**. One evaluator engine runs the spec everywhere (backtest = historical bars, paper = live bars + simulated broker, live = same). That single-engine reuse is the whole payoff.

---

## 1. Data model — the reusable components

**Block** — the atomic reusable unit. Typed, parameterized, with a *pure* `evaluate()`. Categories:
- **Signal** — indicator/feature (produces a value/series per bar)
- **Filter** — a gate (boolean per bar: time, regime, liquidity)
- **Entry** — boolean logic over signals → open a position
- **Exit** — conditions to close (stop/target/trailing/time/signal)
- **Sizer** — how many shares/contracts/$ to trade
- **Risk** — portfolio guardrails (max positions/DD/exposure)

**BotSpec** — the serializable bot definition (single source of truth):
```
BotSpec {
  meta:     { id, name, description, tags[], version, createdAt }
  universe: { assetClass: "stocks"|"crypto"|"mixed", symbols[], maxConcurrent, bar }
  signals:  [ { id, type, params, inputRef? } ]        // reusable signal instances
  entry:    { tree: BooleanTree<SignalCondition> }      // AND/OR/NOT over signal refs
  exit:     { stopLoss?, takeProfit?, trailing?, atrStop?, timeExit?, signalExit? }
  sizing:   { method: "fixed"|"pct_equity"|"vol_target"|"kelly", params }
  risk:     { maxPositions, maxDrawdownPct, perTradeRiskPct, maxExposurePct }
  schedule: { frequency: "eod"|"intraday", bar: "1d"|"1h"|"15m" }
}
```

**Strategy vs Bot:**
- **Strategy** = the `BotSpec` (the logic/recipe).
- **Bot** = a Strategy + runtime config (starting capital, mode: backtest/paper/live, instruments override) + live state (positions, equity, trade log).

---

## 2. Block catalog (v1) — reuses existing `quant.js` where possible
- **Signals:** SMA/EMA cross · RSI · breakout (N-day hi/lo) · MACD · Bollinger · momentum (ROC) · realized-vol regime · z-score anomaly · ATR · correlation filter *(quant.js already computes realizedVol, correlation, anomalies)*.
- **Filters:** time-of-day window · VIX/regime gate · liquidity (min volume/mcap) · trend filter (price vs MA) · day-of-week.
- **Entry:** boolean tree of signal conditions (cross_up/down, gt/lt threshold, in-range).
- **Exit:** fixed stop/target (%), ATR-multiple stop, trailing stop, time-based, opposite-signal.
- **Sizing:** fixed $/shares · % of equity · volatility-target (size to ATR) · Kelly-lite (capped).
- **Risk:** max concurrent positions · max-drawdown kill-switch · per-trade risk % · gross-exposure cap.

---

## 3. Strategy Evaluator (the heart — one engine, three uses)
Pure, deterministic function:
```
evaluate(spec, bars, opts) -> { trades[], equityCurve[], positions[], metrics }
```
- Per-bar loop: compute signals → apply filters → check entry tree → check exits → apply sizing + risk → update positions/equity.
- **No look-ahead bias:** at bar *t*, only data ≤ *t* is visible (backtest honesty).
- **Metrics:** total return, CAGR, Sharpe, Sortino, max drawdown, win rate, profit factor, avg trade, exposure, # trades.
- Same engine consumed by: **Backtesting** (historical `fetchBars`), **Paper Trading** (live bars + simulated broker), **Live** (later).

---

## 4. Forge UI (forms-first) — full tab, not a panel
- **Left rail — Strategy tree / palette:** the sections (Universe, Signals, Entry, Exit, Sizing, Risk, Schedule); add blocks from a categorized palette.
- **Center — Builder:** stacked section cards; each block configured via a **form with inline validation + human-readable summary** ("Buy when 20-EMA crosses above 50-EMA and RSI < 30").
- **Right — Inspector + Live Preview:** selected block's params; a **live mini-backtest** (equity sparkline + key metrics) that re-runs as you edit — instant feedback.
- **Top bar:** strategy name, Save, Clone, Run Backtest, Deploy → Paper.
- **Library view:** saved strategies as cards (open, clone, delete, deploy); starter templates (e.g., "EMA trend", "RSI mean-reversion", "vol breakout").

Node-graph (later) is a *second view* over the identical spec — forms and nodes stay in sync because both edit the same `BotSpec`.

---

## 5. Persistence & API
- `BotSpec` stored as JSON. Backend store (new `apex_strategies` table or JSON files under runtime) — strategies are user config, fully shareable.
- Routes: `GET/POST/DELETE /api/apex/strategies`, `POST /api/apex/backtest` (run evaluator server-side for heavier history).
- Client keeps a working draft; explicit Save persists.

---

## 6. Pipeline integration (how the tabs connect)
**Forge** (build spec) → **Backtesting** (evaluator on history + metrics/report) → **Paper Trading** (evaluator on live data + simulated broker: cash, fills, slippage, P&L) → **Trading Bots** (deploy + monitor running bots) → **Live Testing**.
- The **paper-trading engine** (the big functional gap) = evaluator running live + a **simulated broker**. Separate build, but it *reuses the Forge evaluator* — no duplicate logic.

---

## 7. Build waves (F1–F6) — proposed
- **F1 — Foundation:** `BotSpec` schema (types) + block registry + core Signal/Exit/Sizer blocks (pure functions, unit-testable). No UI.
- **F2 — Evaluator:** backtest engine + metrics; verify against known cases (no look-ahead).
- **F3 — Forge UI shell:** the tab, section cards, forms, spec state management, human-readable summaries.
- **F4 — Live preview:** inline mini-backtest in the inspector as you edit.
- **F5 — Persistence:** save/load/clone library + starter templates + backend store.
- **F6 — Handoff:** wire Backtesting tab to the evaluator; define the paper-trading engine interface (separate build).
- **Later — Nodes:** visual node-graph view over the same spec.

---

## 8. Careful-engineering rules
- Spec is the single source of truth; UI edits spec, engine reads spec — never diverge.
- Blocks are **pure and independently testable**.
- **One evaluator** for backtest/paper/live (zero logic drift).
- **Public data only**, deterministic, **no look-ahead / survivorship dishonesty** — surface these caveats in the UI.
- Specs are **versioned + migration-safe** so saved bots don't break as blocks evolve.

---

## 9. Open questions (decide before/at that wave)
- Single-symbol-per-bot vs multi-symbol portfolio in v1? (lean: allow a small symbol list, one position each.)
- Node-graph library when we get there (react-flow vs custom canvas).
- Backtest fidelity: fills at next-bar-open, slippage/commission model assumptions (state them honestly).
- Where compute runs for heavy backtests (client vs server route).
