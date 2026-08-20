# APEX Portfolio Build Waves

This file rewrites everything known about the APEX Portfolio tab into one build plan. It is intentionally separate from the full audit because Portfolio is the first major area to build.

## Sources Rechecked

- `src/rooms/apex/portfolio/PortfolioView.tsx`
- `src/rooms/apex/paper/PaperTradingView.tsx`
- `server/apex/apex-paper.js`
- `server/providers/apex/quant.js`
- `server/apex-ingest.js`
- `server.js`
- `src/rooms/apex/apex-data.ts`
- `src/rooms/apex/APEX_EXTREME_MASTER_AUDIT_2026.md`
- `src/rooms/apex/APEX_MASTER_PLAN.md`
- `src/rooms/apex/APEX_DATA_SOURCING.md`
- `src/rooms/apex/APEX_V4_OVERDRIVE_PLAN.md`

## Current Truth

The current Portfolio tab is not really a portfolio yet.

Right now it is mostly a Market Structure screen:

- Regime strip: regime score, label, VIX, breadth, advance/decline, fear/greed.
- Correlation matrix: 90-day daily-return correlation over the network universe.
- Sector Rotation RRG: sector ETF relative strength and momentum against SPY.
- Sector Performance heatmap: sector ETFs.
- Anomaly scan: current move versus trailing 60-day z-score.
- Macro/alt panels: Cboe volatility/options stress, Ken French factors, BLS/Fed macro tape, CFTC positioning, Nasdaq directory, DefiLlama liquidity.

Current endpoints feeding this screen:

- `/api/apex/regime`
- `/api/apex/sectors`
- `/api/apex/correlation`
- `/api/apex/rrg`
- `/api/apex/anomalies`
- `/api/apex/macro-alt`

That information is valuable, but it belongs inside a Portfolio subview called **Market Structure**. The main Portfolio tab must become account truth: cash, NAV, positions, lots, orders, fills, risk, attribution, limits and reports.

Paper Trading already has some usable pieces:

- Paper account KPIs: equity, cash, buying power, P&L, realized/unrealized, win rate.
- Positions table.
- Open orders.
- Fill journal.
- Equity curve.
- Order ticket.

But the paper engine is not professional enough yet:

- It is not a double-entry ledger.
- Open orders do not reserve cash/exposure.
- Shorts can create unrealistic buying power.
- There is no real portfolio/account ownership model.
- Bot/manual ownership is not reliable.
- Corporate actions, borrow, funding, currencies, margin, partial fills and deterministic replay are missing.

So Portfolio must be built on top of a corrected paper ledger, not just copied from the current paper UI.

## Final Shape

Portfolio becomes the page where a user can answer:

- How much money do I have?
- What do I own?
- What orders are open?
- What made or lost money?
- Which bot or strategy caused each position?
- How risky is the book?
- What would happen if I rebalance, hedge, add, trim or close?
- Is any data stale or untrustworthy?
- Can I export a clear report?

Market Structure becomes a subview inside Portfolio:

- Correlation matrix.
- Correlation network.
- RRG sector rotation.
- Sector heatmap.
- Regime strip.
- Internals.
- Anomalies.
- Macro/alt stress panels.

## Core Rule

Portfolio is not allowed to invent money or positions.

Every number must trace back to:

- A portfolio ID.
- An account ID.
- A position/lot/order/fill/ledger ID.
- A quote/mark source with timestamp.
- A strategy, bot, manual user or import owner.

If a number cannot be traced, it is shown as unavailable, stale or demo. It must not be silently blended with real portfolio values.

## Wave 0 - Freeze Current Portfolio And Split Market Structure

Goal: keep the useful current screen, but stop pretending it is the portfolio.

Build:

- Rename the current Portfolio content internally as `Market Structure`.
- Keep the current correlation/RRG/regime/anomaly/macro-alt panels.
- Add top-level Portfolio subtabs:
  - `Account`
  - `Positions`
  - `Orders`
  - `Performance`
  - `Allocation`
  - `Risk`
  - `What If`
  - `Market Structure`
  - `Reports`
- Add clear empty/demo state labels.

Acceptance:

- Existing Portfolio visuals still work under `Market Structure`.
- The main `Account` subtab does not show fake NAV or fake holdings.
- Failed or stale data sources are visibly labeled.

## Wave 1 - Canonical Portfolio Domain

Goal: define what a portfolio is before adding more UI.

Build backend domain objects:

- `apex_portfolios`: portfolio name, base currency, mandate, owner, mode.
- `apex_accounts`: account type, portfolio ID, starting cash, margin policy.
- `apex_cash_balances`: available, settled, restricted, receivables, payables, currency.
- `apex_orders`: order intent, status, account, portfolio, owner, idempotency key.
- `apex_order_events`: submitted, accepted, rejected, amended, cancelled, expired.
- `apex_fills`: fill receipt, source quote, slippage, commission, simulator version.
- `apex_lots`: tax/accounting lots opened and reduced by fills.
- `apex_ledger_entries`: balanced journal entries.
- `apex_positions_read_model`: fast display table derived from ledger/lots.
- `apex_risk_snapshots`: portfolio risk snapshots.
- `apex_limit_policies` and `apex_limit_breaches`: limits and violations.

Rules:

- Every order references account, portfolio, owner and order intent.
- Every fill references one eligible quote/observation.
- Every ledger entry belongs to a balanced journal group.
- Every lot references its opening fill.
- Every bot decision references deployment, strategy version and feature snapshot.
- Repositories are the only modules that issue SQL.
- HTTP routes validate and delegate; they do not contain portfolio math.

Acceptance:

- Empty portfolio can be created.
- Schema migration backs up the database first.
- `PRAGMA integrity_check` passes.
- No populated financial table is changed without row-count, nullability, foreign-key and reconciliation checks.

## Wave 2 - Fix Paper Ledger So Portfolio Has Truth

Goal: make Paper Trading produce financially valid events that Portfolio can trust.

Build:

- Double-entry ledger for cash, restricted cash, positions, fees and realized P&L.
- Transactional fill application.
- Idempotent order-intent and fill IDs.
- Explicit portfolio/account/bot/manual ownership.
- Buying-power reservations for open orders.
- Margin policy by account type.
- Short borrow availability and fee simulation.
- Quote-age and market-session gates.
- Marketable limit price improvement.
- Bid/ask/depth-aware fills where data exists.
- Partial fills and participation caps.
- DAY/GTC/IOC/FOK time-in-force.
- Market, limit, stop, stop-limit, trailing, bracket and OCO order states.
- Deterministic simulation clock.
- Historical replay mode.
- Order preview with cost, margin, exposure and risk impact.
- Reset workflow that exports/archives before clearing.

Important fixes:

- Repeated naked shorts cannot increase available buying power beyond policy.
- Open orders reserve capital/exposure before fills.
- Preview/check routes never mutate the ledger.
- Terminal liquidation uses the same fill/ledger path as normal exits.

Acceptance:

- `NAV = cash + restricted_cash + sum(position_mark_value) + receivables - payables`.
- No negative available buying power unless policy explicitly allows it.
- Reapplying the same command/event does not duplicate a fill.
- All state transitions are complete or absent.
- Portfolio reconciles to Paper after every fixture event.

## Wave 3 - Build The Real Account Screen

Goal: the first usable Portfolio screen.

Build UI:

- Multi-portfolio selector with base currency and mandate.
- Account/NAV summary from ledger.
- Cash panel:
  - available cash
  - settled cash
  - restricted cash
  - receivables
  - payables
  - currency balances
- Buying power and gross/net exposure.
- Daily P&L and total P&L.
- Quote freshness and mark source.
- Empty/new portfolio onboarding.
- Demo isolation banner when using virtual data.

Backend/API:

- `GET /api/apex/portfolios`
- `GET /api/apex/portfolios/:id`
- `GET /api/apex/portfolios/:id/account`
- `GET /api/apex/portfolios/:id/reconciliation`
- Later portfolio routes:
  - `GET /api/apex/portfolios/:id/positions`
  - `GET /api/apex/portfolios/:id/orders`
  - `GET /api/apex/portfolios/:id/journal`
  - `GET /api/apex/portfolios/:id/performance`
  - `GET /api/apex/portfolios/:id/allocation`
  - `GET /api/apex/portfolios/:id/exposure`
  - `GET /api/apex/portfolios/:id/risk`
  - `POST /api/apex/portfolios/:id/what-if`
  - `POST /api/apex/portfolios/:id/rebalance-proposal`
  - `POST /api/apex/portfolios/:id/hedge-proposal`
  - `POST /api/apex/portfolios/:id/report`

Acceptance:

- Cash plus marked positions reconciles to NAV.
- Every NAV component is clickable to its source.
- Stale quote marks are visible.
- Demo/simulated data is never presented as live broker money.

## Wave 4 - Positions, Lots, Orders And Journal

Goal: show exactly what is owned and why.

Build UI:

- Position table:
  - symbol
  - canonical instrument ID
  - side
  - quantity
  - lots
  - average cost
  - mark
  - market value
  - unrealized P&L
  - realized P&L
  - owner
  - strategy version
  - bot/manual source
  - quote age
- Position detail drawer:
  - fills
  - lots
  - reductions
  - fees
  - borrow/funding
  - dividends
  - corporate actions
  - decision lineage
- Open orders and reservations.
- Transaction journal:
  - orders
  - fills
  - fees
  - dividends
  - borrow
  - funding
  - transfers
  - manual adjustments
- Tax-lot view:
  - FIFO
  - LIFO
  - specific-lot simulation where appropriate.

Actions:

- Close, trim and add create reviewed order drafts.
- No direct mutation from the position table.

Acceptance:

- Same bot-owned position is not counted more than once.
- Realized plus unrealized P&L reconciles to ledger change.
- Open orders reserve cash/exposure.
- Manual adjustment requires reason, actor and approval.

## Wave 5 - Performance And Attribution

Goal: explain what happened, not just the ending value.

Build:

- Daily performance.
- Cumulative performance.
- Time-weighted return.
- Money-weighted return/XIRR.
- Equity curve.
- Drawdown/underwater chart.
- Drawdown episodes:
  - depth
  - duration
  - recovery
  - contributors
- Rolling Sharpe, Sortino and Ulcer index.
- Calmar, max drawdown and longest underwater duration.
- Benchmark-relative attribution with timestamp and currency alignment.
- Contribution by:
  - instrument
  - sector
  - factor
  - strategy
  - bot
  - manual trades
- Attribution waterfall.
- Performance confidence:
  - sample size
  - uncertainty warning
  - unstable metric warning.

Acceptance:

- Position contributions sum to total portfolio P&L within tolerance.
- Benchmark timestamps align with portfolio marks.
- Return definitions are named correctly.
- Sharpe/Sortino/Calmar definitions are centralized and versioned.
- No chart shows NaN, Infinity or silently dropped periods.

## Wave 6 - Allocation And Exposure

Goal: show how the portfolio is divided and where hidden concentration exists.

Build:

- Allocation views by:
  - asset class
  - instrument
  - sector
  - industry
  - geography
  - currency
  - venue
  - liquidity bucket
  - strategy
  - bot
- Allocation donut/sunburst.
- Treemap/heatmap with per-position flash on mark change.
- Gross exposure.
- Net exposure.
- Beta exposure.
- Downside beta.
- Delta exposure.
- Duration exposure.
- FX exposure.
- Volatility exposure.
- Concentration guardrails:
  - single-name
  - sector
  - factor
  - strategy
  - bot
  - liquidity
- Exposure change timeline.

Acceptance:

- Allocation totals reconcile to market value.
- Gross and net exposure reconcile to positions.
- Concentration breaches generate limit events.
- Every exposure card drills into the exact positions creating it.

## Wave 7 - Portfolio Risk Engine

Goal: make Risk portfolio-aware, not only single-symbol.

Build:

- Scope selector:
  - instrument
  - position
  - portfolio
  - strategy
  - bot
  - proposal
- Historical VaR.
- Parametric VaR.
- Monte Carlo VaR.
- CVaR/expected shortfall.
- Marginal risk contribution.
- Component expected shortfall.
- Factor exposure:
  - SPY beta
  - sector ETF beta
  - size proxy
  - momentum proxy
  - Ken French factors where available
- Liquidity risk:
  - average dollar volume
  - exit time
  - participation cap
  - stale quote warning
- Correlation crisis alarm:
  - average pairwise correlation
  - diversification collapse warning
  - clustered heatmap
  - minimum spanning tree network
- Scenario/stress:
  - 2008-style shock
  - COVID-style shock
  - 2022 rates/inflation shock
  - custom factor shocks
- Options aggregation later:
  - delta
  - gamma
  - vega
  - theta
  - assignment/expiry risk.

Acceptance:

- Risk contributions sum to portfolio totals within tolerance.
- Invalid samples never display as real risk.
- Component risk can be traced back to positions.
- What-if risk uses read-only state and cannot mutate the ledger.

## Wave 8 - What If, Rebalance And Hedge Proposals

Goal: let the user test changes before placing orders.

Build:

- What-if basket:
  - add position
  - trim position
  - close position
  - replace position
  - change hedge
  - change cash target
- Rebalance proposal:
  - objective
  - constraints
  - turnover estimate
  - transaction-cost estimate
  - expected risk change
  - expected exposure change
- Hedge proposal:
  - instrument
  - expected protection
  - basis risk
  - cost
  - liquidity
  - expiry if derivative
- Optimizers:
  - minimum variance
  - risk parity
  - hierarchical risk parity
  - efficient frontier/CML
  - Black-Litterman views
  - user constraints
- Proposal comparison table:
  - current
  - proposed
  - delta
  - warnings

Rules:

- What-if is pure/read-only.
- Accepted proposal creates reviewed order drafts, not instant fills.
- Rebalance cannot exceed turnover, concentration, buying power or stale-data policy.

Acceptance:

- What-if operations cannot mutate orders, fills, lots, cash or ledger.
- Proposal risk changes match Risk tab calculations.
- Order drafts keep proposal ID and decision lineage.

## Wave 9 - Corporate Actions, Income, Imports And Adjustments

Goal: stop portfolio math from breaking when real-world events happen.

Build:

- Corporate actions:
  - splits
  - dividends
  - symbol changes
  - mergers
  - delistings
  - spin-offs later
- Income/expense calendar:
  - dividends
  - coupons
  - borrow
  - funding
  - fees
- External imports:
  - CSV import
  - broker adapter slots
  - reconciliation report
  - no silent overwrite
- Manual adjustment workflow:
  - reason
  - actor
  - approval
  - audit event

Acceptance:

- Corporate actions adjust lots/orders/positions through audited events.
- Imported broker/csv state reconciles instead of replacing local truth.
- Every manual adjustment is visible in the transaction journal.

## Wave 10 - Policy Breach Inbox, Jarvis Briefing And Reports

Goal: make Portfolio understandable and reportable.

Build:

- Policy breach inbox:
  - concentration breach
  - stale quote breach
  - liquidity breach
  - max drawdown breach
  - bot mandate breach
  - buying-power breach
  - data-quality breach
- Jarvis portfolio briefing:
  - account summary
  - top contributors
  - top detractors
  - risk changes
  - policy breaches
  - stale data
  - suggested next reviews
  - citations to IDs and source data
- Reports:
  - HTML
  - PDF
  - CSV bundle
- Snapshot comparison:
  - compare two dates
  - compare two workspaces
  - compare current versus what-if proposal

Acceptance:

- Jarvis uses structured portfolio facts, not guesses.
- Every report number links back to ledger/risk/quote sources.
- Snapshot deltas reconcile to transactions and marks.

## Wave 10B - Jarvis Portfolio Brain

Goal: Jarvis must know the portfolio like a real portfolio analyst, risk manager and trading assistant. It should not just summarize widgets. It must understand current state, history, decisions, ownership, risk, and what changed.

Jarvis must know:

- Every portfolio the user created.
- Portfolio purpose, mandate, risk profile and base currency.
- Starting cash and every deposit/withdrawal.
- Current NAV, cash, buying power and reserved cash.
- Every current holding.
- Every closed holding.
- When each position was bought.
- Why each position was bought.
- Who bought it: user, bot or strategy.
- Strategy version used at entry.
- CrashGuard/regime state at entry.
- Market structure state at entry.
- News/evidence available at entry, if captured.
- Current price, mark source and quote age.
- Realized and unrealized P&L.
- Fees, slippage, borrow, funding and dividends.
- Long, short and hedged exposure.
- Options positions if free/delayed chain data is available.
- Open orders and reserved buying power.
- Bot decisions and rejected decisions.
- What-if proposals and whether they were accepted or ignored.
- Policy breaches and how long they stayed open.
- User notes and manual overrides.

Jarvis memory:

- Portfolio memory is structured, not chat-only.
- Important facts are stored as portfolio events, not buried in conversation.
- Jarvis can answer from exact IDs:
  - portfolio ID
  - account ID
  - order ID
  - fill ID
  - lot ID
  - strategy version
  - bot deployment
  - quote snapshot
  - risk snapshot
  - report snapshot
- Jarvis remembers the timeline:
  - before trade
  - during trade
  - after fill
  - current state
  - exit/rebalance decision
- Jarvis can compare its old reasoning to the final result.
- Jarvis can say when it does not know because data was missing.

Jarvis actions:

- "Review my portfolio."
- "What changed today?"
- "Why am I down?"
- "What is my biggest risk?"
- "Which position should I inspect first?"
- "Which bot is hurting me?"
- "Which strategy is carrying the book?"
- "What happens if I sell this?"
- "What happens if I hedge?"
- "What would you rebalance?"
- "What is stale or unreliable?"
- "What is the cleanest next action?"

Rules:

- Jarvis cannot invent portfolio state.
- Jarvis cannot place orders directly.
- Jarvis can create reviewed order drafts.
- Jarvis must cite the exact source behind each claim.
- Jarvis must separate facts, estimates and opinions.
- Jarvis must label paper, demo, imported and live data differently.

Acceptance:

- Jarvis can explain every open position from entry to current state.
- Jarvis can trace every P&L number back to ledger/fill/mark data.
- Jarvis can identify stale data and refuse false certainty.
- Jarvis can generate a portfolio report that matches screen values.

## Wave 10C - Ten Advanced Portfolio Intelligence Features

These are the top-level "crazy" features that make Portfolio feel world-class, but each one must still be built on account truth.

1. **Portfolio Memory Graph**
   - Graph of positions, orders, fills, bots, strategies, regimes, news, risks and user decisions.
   - Lets Jarvis answer "what caused this?" instead of only "what is this?"

2. **Decision Replay**
   - Replay the portfolio day by day.
   - Shows what Jarvis knew, what bots knew, what the regime was, what orders fired and how NAV changed.

3. **Bad Trade Autopsy**
   - Groups losing trades by cause:
     - late entry
     - early exit
     - oversized position
     - regime mismatch
     - liquidity issue
     - volatility shock
     - bot rule failure
     - user override

4. **Missed Edge Detector**
   - Finds cases where CrashGuard/regime/market structure warned correctly but the portfolio action was weak.
   - Shows missed buys, missed trims, missed hedges and missed exits.

5. **Portfolio Regime Atlas**
   - Maps each position into regime sheets:
     - stable growth
     - high-vol growth
     - liquidity stress
     - sector rotation
     - crash-risk branch
     - recovery branch
   - Shows whether the portfolio is sitting on one dangerous sheet or diversified across regimes.

6. **3D Risk Surface**
   - 3D/canvas view with axes like return contribution, crash probability, liquidity stress, volatility and regime distance.
   - Used for insight, not decoration.
   - Clicking a point opens the exact position and risk source.

7. **Correlation Collapse Radar**
   - Detects when diversification is failing because positions start moving together.
   - Shows normal correlation, stressed correlation and current correlation.

8. **Bot vs Human Attribution**
   - Separates human trades, bot trades and strategy trades.
   - Shows who added return, who added drawdown, who added turnover and who violated risk rules.

9. **Adaptive Rebalance Engine**
   - Rebalance targets are not fixed percentages.
   - Targets adapt using portfolio risk, regime, liquidity, conviction, volatility, trend, CrashGuard probability and drawdown state.
   - Produces proposals, not automatic trades.

10. **Forward Stability Lab**
   - Runs many possible next-month/next-quarter paths.
   - Shows probability of drawdown, probability of recovery, expected risk contribution and which positions dominate downside.

Options support:

- Free/delayed options data can be used when available.
- Options must always show quote age and data source.
- Portfolio can track options positions manually even before full chain support.
- Greeks are shown only when the chain/price inputs are good enough.
- Covered calls, protective puts and collars can be supported first.
- Complex multi-leg optimization waits until basic options accounting is correct.

Short support:

- Shorts require borrow/margin rules in paper mode.
- Short exposure is separate from long exposure.
- Borrow cost and hard-to-borrow warnings must be shown.
- Shorts cannot create fake buying power.

## Wave 10D - Jarvis-Managed Portfolio Framework

This is not the first build. This starts only after the normal Portfolio, Paper ledger, attribution and risk systems are trustworthy.

Goal: create a new portfolio type that runs on Jarvis decisions with strict safety.

Portfolio type:

- `Jarvis Managed`

Inputs:

- Portfolio mandate.
- Allowed universe.
- Allowed asset types:
  - stocks
  - ETFs
  - cash
  - shorts if enabled
  - options if enabled and data quality passes
- Max gross exposure.
- Max net exposure.
- Max single-name exposure.
- Max sector exposure.
- Max bot/strategy exposure.
- Max daily loss.
- Max drawdown.
- Max turnover.
- Required cash buffer.
- Allowed order types.
- Human approval requirement.

Jarvis decision loop:

1. Read current portfolio state.
2. Read market structure.
3. Read CrashGuard/regime state.
4. Read position-level risk.
5. Read bot/strategy proposals.
6. Read news/evidence if available.
7. Generate candidate actions.
8. Score each action:
   - expected return
   - downside risk
   - crash risk
   - liquidity risk
   - cost
   - concentration impact
   - regime fit
   - portfolio fit
   - confidence
9. Reject weak or unsafe actions.
10. Create reviewed order drafts.
11. Wait for human approval unless explicit paper-auto mode is enabled.
12. After fill, write memory event.
13. Later, compare outcome versus original reasoning.

Safety:

- Jarvis cannot bypass portfolio policy.
- Jarvis cannot trade stale data.
- Jarvis cannot exceed exposure limits.
- Jarvis cannot trade another bot's lots without permission.
- Jarvis cannot hide bad decisions.
- Every action has a reason, rejected alternatives and risk note.

Acceptance:

- Jarvis Managed can run in paper mode only at first.
- Every decision has a full receipt.
- Every decision can be replayed.
- Every trade is connected to portfolio memory.
- Human can pause/kill Jarvis Managed instantly.
- Performance is measured against simple benchmarks and against manual/bot portfolios.

## Wave 11 - Data Sources Used By Portfolio

Portfolio uses these sources:

- Paper ledger from `apex.sqlite`.
- Public quotes for marking positions.
- Cboe volatility/options market stress.
- Ken French factor data.
- BLS macro releases.
- Fed H15 rates.
- CFTC positioning.
- Nasdaq directory/reference files.
- SEC company ticker/reference data.
- Sector ETFs for sector/factor mapping.
- DefiLlama liquidity/risk signals.
- Future broker import adapters when connected.

Data-source rules:

- Every mark needs source, timestamp and age.
- Quote failures do not become zero prices.
- Source disagreement creates a warning.
- Public/free data can power simulation and research, but live broker money must be clearly separated.

## Wave 12 - Test Gates Before Portfolio Is Considered Built

Required tests:

- Schema migration backup and integrity check.
- No hardcoded account/portfolio IDs.
- No duplicate portfolio rows.
- No duplicate bot-owned position counting.
- Ledger debits equal credits for every journal group.
- NAV reconciliation after every event prefix.
- Open order reservation invariant.
- Buying power cannot be inflated by naked shorts.
- Replayed idempotency keys do not duplicate events.
- GET/preview/check/what-if endpoints are read-only.
- Position P&L reconciles to fills, fees, borrow/funding and marks.
- Allocation totals reconcile to market value.
- Exposure totals reconcile to positions.
- Attribution totals reconcile to portfolio P&L.
- Risk contribution totals reconcile to portfolio risk.
- Stale data is visible and cannot be silently used as fresh.
- Corporate-action fixture updates lots and positions correctly.
- Import fixture produces reconciliation differences instead of overwriting.
- Report export matches screen values.
- No NaN or Infinity in UI/API payloads.
- 1024px to 4K visual checks pass.

## First Build Sprint

Build this first:

1. Move current Portfolio content into `Market Structure`.
2. Add Portfolio subtabs and empty account shell.
3. Add portfolio/account schema and read APIs.
4. Connect Portfolio account screen to the current paper account as a temporary source.
5. Add quote freshness/source labels.
6. Add reconciliation endpoint:
   - cash
   - positions
   - market value
   - receivables/payables
   - NAV
   - difference
7. Add tests for read-only what-if/check routes and NAV reconciliation.

Do not build optimizers, hedge proposals or advanced reports until the account truth works.

## Audit Coverage Map

Every original Portfolio audit requirement is covered here:

| Audit ID | Requirement | Build wave |
|---|---|---|
| P-001 | Multi-portfolio selector with base currency and mandate | Wave 3 |
| P-002 | Account/NAV summary reconciled from ledger | Wave 3 |
| P-003 | Cash ledger: available, settled, restricted and currency balances | Waves 1-3 |
| P-004 | Position table: quantity, lots, average cost, mark, value, P&L and owner | Wave 4 |
| P-005 | Open orders and reservations | Waves 2 and 4 |
| P-006 | Transaction journal: orders, fills, fees, dividends, borrow, funding and transfers | Wave 4 |
| P-007 | Tax-lot view: FIFO/LIFO/specific-lot simulation | Wave 4 |
| P-008 | Realized/unrealized reconciliation | Waves 4-5 |
| P-009 | Daily and cumulative performance, time-weighted and money-weighted | Wave 5 |
| P-010 | Benchmark-relative attribution with timestamp/currency alignment | Wave 5 |
| P-011 | Contribution by instrument, sector, factor, strategy and bot | Wave 5 |
| P-012 | Allocation views by asset, sector, geography, currency, venue and liquidity | Wave 6 |
| P-013 | Exposure views: gross/net, beta, delta, duration, FX and vol | Wave 6 |
| P-014 | Risk contribution: marginal/component expected shortfall | Wave 7 |
| P-015 | Concentration and liquidity limits | Waves 6-7 |
| P-016 | Corporate-action processing and audit | Wave 9 |
| P-017 | External import CSV/broker adapters with reconciliation | Wave 9 |
| P-018 | Manual adjustment with reason, actor and approval | Waves 4 and 9 |
| P-019 | Bot/manual ownership decomposition | Waves 1, 4 and 5 |
| P-020 | Strategy-version attribution | Waves 4-5 |
| P-021 | What-if basket without placing orders | Wave 8 |
| P-022 | Rebalance proposal with objectives, constraints, turnover and costs | Wave 8 |
| P-023 | Hedge proposal with instrument, protection, basis and cost | Wave 8 |
| P-024 | Income/expense calendar: dividends, coupons, funding and borrow | Wave 9 |
| P-025 | Exposure change timeline | Wave 6 |
| P-026 | Drawdown episodes: depth, duration, recovery and contributors | Wave 5 |
| P-027 | Performance confidence: sample sufficiency and uncertainty | Wave 5 |
| P-028 | Data reconciliation status: quote age and source per mark | Waves 3 and 11 |
| P-029 | Close/trim/add actions create reviewed order drafts | Wave 4 |
| P-030 | Portfolio report: cited HTML/PDF/CSV bundle | Wave 10 |
| P-031 | Snapshot comparison between dates/workspaces | Wave 10 |
| P-032 | Policy breach inbox | Wave 10 |
| P-033 | JARVIS portfolio briefing using reconciled positions and attribution | Wave 10 |
| P-034 | Market Structure subview retains current RRG/correlation/regime | Wave 0 |
| P-035 | Empty/new portfolio onboarding with explicit demo isolation | Wave 3 |

## Do Not Do

- Do not call correlation/RRG/regime panels the portfolio.
- Do not show synthetic/demo values as real money.
- Do not mutate the ledger from what-if.
- Do not let a bot own untagged positions.
- Do not let open orders exist without reservations.
- Do not let quote failure become a zero mark.
- Do not hide stale data.
- Do not count one position twice because two bots touched it.
- Do not add business logic directly into `server.js`.
- Do not let React components compute financial truth.

## Completion Definition

Portfolio is complete only when:

- Cash, positions, lots, orders, fills and NAV reconcile.
- Every position has owner and lineage.
- Every displayed mark has source and timestamp.
- P&L, attribution, allocation, exposure and risk add back to portfolio totals.
- Market Structure remains available as a subview.
- What-if/rebalance/hedge proposals are pure until accepted as order drafts.
- Jarvis can explain the portfolio using exact IDs and cited facts.
