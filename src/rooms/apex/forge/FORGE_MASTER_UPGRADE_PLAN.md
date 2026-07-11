# THE FORGE — Master Upgrade Plan (4-agent synthesis)

Synthesis of 4 deep agents: Frontend code audit · Engine/quant correctness audit · Product architecture · Web research (LEAN/Nautilus/vectorbt/López de Prado). Ranked into tiers. Tier 0 first — some displayed numbers are currently WRONG and some actions freeze the UI.

## Guiding verdict
- The Forge is **excellent at Idea→Build→Backtest→Validate→Optimize** and **stops dead at Paper→Deploy→Monitor→Iterate**.
- But first: **the engine's headline metrics are corrupted (C1)** and **the overfitting gate is effectively off (DSR nTrials=1)** — so "validate" is over-optimistic. Fix correctness before building more on top.
- The moat is the **validation layer** (Deflated Sharpe + PBO + CPCV + purge/embargo + realistic costs) + **AI as scaffolder/adversary**, not "more buttons."

---
## TIER 0 — CORRECTNESS & STABILITY (fix now; everything sits on this)

### Engine correctness (numbers are wrong)
- **C1 [CRITICAL] Per-bar return series is wrong** (`forge-engine.ts:116`): denominator uses post-transaction cash/shares, not `equity[i]/equity[i-1]-1`. Corrupts Sharpe/Sortino/vol/VaR/skew/kurtosis. The Improver computes a *different, correct* Sharpe from the equity curve → app shows two disagreeing Sharpes, headline is wrong. **Fix: track `prevEquity`, push `eq/prevEquity-1`.**
- **C10 [CRITICAL] Meta-Labeler reports fictitious lift**: trains + scores in-sample AND feeds MAE (computed over the trade's whole life) as an entry feature = target leakage. **Fix: purged/embargoed CV; remove post-entry features; report OOS AUC.**
- **C6/H10 [CRITICAL] DSR fed nTrials=1** → deflation term goes negative → *raises* DSR → blesses overfit. Terraform tries 121, Darwin ~192, WF dozens. **Fix: thread real trial count; guard N≥2.**
- **C7 [HIGH] Walk-forward leakage**: IS window = 50% of series, overlaps later OOS; no purge/embargo; only the stop is re-optimized. **Fix: rolling IS + embargo; non-overlapping OOS.**
- **C8 [HIGH] Monte-Carlo**: trade-shuffle destroys serial dependence → DD biased low; permutation keeps multiset so return dist is meaningless; `ddP95` is really the 5th percentile (mislabeled). **Fix: block bootstrap; fix naming; clamp percentile index (testers.ts:127).**
- **M5/M6 [MED] Regime look-ahead**: SMA100 warmup mislabels first 100 bars bearish; realized-vol median over whole sample = hindsight; leaks into meta features. **Fix: rolling median; mark warmup unknown.**
- **H1/H3 [MED] Sortino & std inconsistent** between engine and registry (÷n vs ÷n-1; downside-count vs total-N). **Fix: standardize (total-N Sortino, sample std) everywhere.**
- **H8/H9 [MED]** PF magic `99`, breakeven counted as loss, SQN uses %-not-R. **L11** Ulcer double-scaled. **L2** kill-switch equity off-by-one. **L1** maxDDbars mislabeled (depth not duration).
- Wire the **defined-but-unused `perTradeRiskPct`**; fix `kelly_frac` (it's fixed-fraction mislabeled) and `vol_target` sizing.

### Performance (UI freezes)
- **P1 Darwin = 192 sync backtests** on main thread → tab hangs. **P2 Terraform = 121 sync backtests**, auto-fires on opening the Heatmap dock tab. **P3 Sentinel** blocking WF + 4 serial *network* re-backtests, auto-fires on Walk-Forward tab. **Fix: Web Worker or time-slice; reuse already-fetched `bars` (don't re-`runBacktest`).**
- **P4** compose/compare re-fetch legs serially → `Promise.all`.

### Frontend bugs / memory / vuln
- **B3** signal-id collision after delete→add (`s3` twice) corrupts graph + edits both. **Fix: monotonic/UUID id.**
- **B2** form handlers read stale `spec` → clobber concurrent edits. **Fix: functional `setSpec(s=>…)` everywhere.**
- **B7/B8** boot + run result-vs-spec races (wrong metrics attach to wrong strategy). **Fix: spec-id/sequence guard.**
- **B6** graph refits and **wipes pan/zoom on every edit**. **Fix: refit only on node-count/layout change.**
- **B1/M3** depless global keydown re-binds every render + fires from inside inputs. **Fix: register once via refs; ignore input targets.**
- **M1/M2** toast/delete timers never cleared → setState-after-unmount. **M5** `forge-signal-code` localStorage unbounded + silent quota fail. **V1** uploaded files have no size cap (50MB read into memory+LS). **Fix: clear timers on unmount; cap+LRU-evict LS; 1MB file cap; validate parsed shapes.**
- **R9** complex entries are uneditable (forms can't, graph read-only) — dead end.

---
## TIER 1 — CLOSE THE LIFECYCLE (highest product ROI)
1. **Strategy Versioning + History + Diff** (M) — snapshot BotSpec+metrics on save/adopt; History dock-tab; pick 2 → visual diff + metric delta. Wire the unused `meta.version`. Every optimize action is currently a one-way door.
2. **Real Paper-Trading Execution Engine** (L) — scheduled runner re-fetches bars on the bar interval, runs the SAME `backtest()` in forward mode vs a virtual $100k, streams fills. Activate the Deploy menu.
3. **Bot Monitor + kill-switch** (L) — per bot: live equity vs backtest-expected (divergence tracker), open positions, today's fills, drawdown, pause/kill. Fill the "Trading Bots" tab.
4. **Multi-symbol universe backtest** (L) — engine only runs `symbols[0]`; add universe run + aggregation + `maxConcurrent`. Universe manager modal.
5. **Proactive Jarvis** (M) — every backtest auto-runs light Sentinel+Improver and surfaces ONE actionable line in the Health rail (not 11 manual buttons).
6. **Activate Python / Transcript / Research canvas tabs** (M) — Python = codegen BotSpec→backtrader/pandas; Transcript = provenance log of every AI action/adopt; Research = thesis pad + Prospector findings.

---
## TIER 2 — VALIDATION MOAT + ENGINE DEPTH (credibility → world-class)
7. **Deflated Sharpe + PBO gate on every backtest** (M) — trial-count-aware; red/amber/green before Deploy. (Bailey/LdP)
8. **CPCV + purge/embargo as a Validation node** (L) — distribution of OOS paths, not one; modes: WF / K-Fold / Purged-KFold / CPCV.
9. **Almgren-Chriss cost layer + cost stress test** (M) — temp/permanent impact + spread + commission; re-run at 1x/2x/3x cost → show the profitability cliff.
10. **Triple-barrier labeling** (M) + **meta-labeling done right** (OOS) — vol-scaled TP/SL/time barriers.
11. **HMM regime node** (M) — fit states, route sub-graphs / scale exposure by regime; per-regime breakdown (no look-ahead).
12. **Fractional differentiation node** (S) — stationary-but-memory-preserving ML features.
13. **Shorting + position sizing models** (L) — long/short P&L; vol-targeting + fractional-Kelly (real edge estimate); wire `perTradeRiskPct`.
14. **Benchmark-relative metrics** (S) — alpha/beta/IR vs buy-and-hold (a SPY-tracker shouldn't look "great").
15. **General Parameter-Sweep UI** (M) — sweep ANY param (RSI period, EMA length…), not just Terraform's 2 exit params; sortable results + heatmap.
16. **Experiment Board / N-run leaderboard** (M) — persist every run (params, Sharpe, DD, trust, time), pinnable/sortable. (replaces the demo "Experiment Queue")
17. **Scenario / Stress testing + event overlay** (M) — synthetic shocks (−20% crash, 2x vol) + historical slices (2008/2020/2022) + FOMC/earnings/CPI P&L attribution.

---
## TIER 3 — ARCHITECTURE + STRATEGIES + COMMUNITY
18. **LEAN 5-stage typed pipeline** as the node-graph backbone (L) — Universe → Alpha(Insight) → Portfolio(Target) → Risk → Execution; swappable typed nodes. This is the structural upgrade that makes everything else composable.
19. **13 strategy templates** (M total) — Dual-MA trend, Cross-sectional 12-1 momentum, TS-momentum/managed-futures, Bollinger mean-reversion, Cointegration pairs (ADF/half-life), Kalman dynamic-hedge pairs, ETF stat-arb, Short-vol carry, Vol term-structure, Donchian breakout, Seasonality overlay, Multi-factor equity, Risk-parity multi-asset.
20. **Portfolio of Bots / fleet view** (L) — HRP over LIVE bots; aggregate book, correlations, master kill-switch.
21. **Alerts + notifications** (M) — DD>x, no-trade-in-N-days, diverged-from-backtest, entry-fired → toasts/email.
22. **Fundamentals + multi-timeframe** (L) — P/E, earnings, sector as DSL vars; daily-trend filter on 15m entry.
23. **Marketplace / community library** (L) — publish strategy (spec+card, public data only); real ratings; the "Official" filter is already a stub. APEX is shareable — this is the moat.
24. **Onboarding tour** (S) — narrate the auto-booted seed strategy: run→read health→deploy.

---
## TIER 4 — MOONSHOTS
25. **Autopilot** — Genesis→Sentinel→Improver→Darwin in a governed overnight loop; only adopt changes that pass DSR/PBO on held-out data; hand back a diffed, versioned "what I improved & why."
26. **Natural-language spec editing** — the room Jarvis bar mutates the open spec: "tighten the stop," "add an RSI<30 filter," "deploy at half size." `aiCompose` exists; wire it to spec edits.
27. **Explain-on-hover** — hover any node/metric/health-check → grounded AI explanation for THIS run.
28. **Live-vs-Backtest Reality Score** — after N live days, score how honestly the backtest predicted reality; feed back into Sentinel trust.
29. **Closed-loop AI alpha-miner** (AlphaAgent pattern) — idea→factor→eval agents, every candidate forced through the DSR/PBO/CPCV gate. Guardrail: copilot PROPOSES, the validation engine DECIDES.
30. **Collaboration + gamification** — share links, comments-on-nodes (like a PR); quant-XP / paper-return leaderboard.

---
## Recommended execution order
1. **Tier 0 correctness pack** (C1, DSR trials, meta leakage, WF, MC naming, regime look-ahead, Sortino/std unify) — the app must show TRUE numbers.
2. **Tier 0 perf pack** (Darwin/Terraform/Sentinel → workers/time-slice + bar reuse) — stop the freezes.
3. **Tier 0 bug pack** (signal-id, stale-spec, races, graph refit, timers, file cap).
4. **Tier 1** lifecycle (versioning → paper → monitor) — turns analysis sandbox into a real pipeline.
5. **Tier 2** validation moat (DSR/PBO/CPCV/costs) — makes it credible.
6. **Tier 3/4** breadth + moonshots.

Sources: QuantConnect/LEAN, NautilusTrader, vectorbt PRO, Composer/Tradetron, López de Prado (Advances in Financial ML), Bailey (DSR/PBO), Ernie Chan, Almgren-Chriss, mlfinlab, Riskfolio-Lib. (Full citations in the research agent output.)
