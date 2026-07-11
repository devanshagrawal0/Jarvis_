# THE FORGE — 8 Big Features (research-synthesized, 2026-07-10)

From 2 parallel research agents (advanced quant methodology + AI-native/interactive) synthesized against our free-data/client-side stack. Both agents independently converged on overfitting-defense, regime-conditioning, and portfolio-theory — those are locked. All 8 are real (no fake magic), buildable in JS/Node + r3f + Gemini on FREE data + the local seed, and chain into each other.

Substrate everything reuses: the existing `forge-engine.ts` backtest (trades + per-bar equity + 12 metrics), Monte Carlo, the BotSpec AST, the DSL parser/evaluator, `callGemini`, and the seeded 2010–2026 daily bars (+ RV/IV/put-call columns).

## The 8

### F1 · REGIME RADAR  *(foundational + visual — build first)*
Auto-segment history into regimes (calm-bull / choppy / crisis) from returns + realized vol + VIX, show the strategy's performance **conditioned on regime**, and let a bot **gate itself to favorable regimes**. Timeline heat-strip + per-regime scorecard + "your edge only lives in low-vol bull markets" verdict. Feeds F5/F2/F6. Vol-band/change-point classifier (robust) with optional Gaussian-HMM upgrade. **L**

### F2 · OVERFITTING SENTINEL  *(the credibility flagship)*
After a backtest: Combinatorial Purged Cross-Validation → **Probability of Backtest Overfitting (PBO)**, **Deflated Sharpe Ratio** (corrects for #trials + skew/kurtosis + sample length), parameter-sensitivity. A traffic-light "trust score" + a **session trial-counter** so the more you fish, the more the Sharpe deflates. López de Prado / Bailey-Borwein. **L**

### F3 · DARWIN — Evolutionary Strategy Discovery  *(the signature wow)*
Seed a population of BotSpecs, **mutate** (perturb thresholds, swap signals, flip tree operators) + **crossbreed** (splice entry subtrees), fitness = risk-adjusted objective from the existing backtest, evolve over generations in a Web Worker. Live **family-tree** viz (nodes glow by fitness, edges = lineage). Train/held-out split so it's not just overfitting. **L**

### F4 · TERRAFORM — 3D Parameter Landscape + Bayesian Optimization  *(the r3f showpiece)*
Pick 2–3 params; sweep (grid / Bayesian GP surrogate); render an orbitable 3D terrain where height = risk-adjusted return, vertex-colored by a **robustness score** (local variance). Hunt **robust plateaus, not spiky peaks**. Draggable optimum writes params back to the BotSpec. **L**

### F5 · META-LABELER — Triple-Barrier "Should I take this trade?"  *(AFML crown jewel)*
Relabel every entry with the **triple-barrier method** (PT/SL/time in ATR units), train a lightweight in-browser classifier (logistic / gradient-boosted stumps) on the signal values at entry to predict **P(win)**, then filter/size trades by confidence. Show before/after Sharpe lift. **L**

### F6 · PROSPECTOR — Alt-Data Signal Mining  *(our free-data moat)*
Turn free alt-data into ready-to-use DSL signals: GDELT news sentiment, **SEC EDGAR insider-buy clusters**, FRED macro-regime flags, put-call flow — each mined, univariate-backtested for standalone edge, surfaced as e.g. `INSIDER_CLUSTER(AAPL) > 3` you drop into any bot. **L**

### F7 · PORTFOLIO FORGE — HRP + Risk-Parity + Black-Litterman  *(the portfolio endgame)*
Combine several bots/assets into a book; allocate via **Hierarchical Risk Parity** (clustering + recursive bisection), risk parity, min-variance, Black-Litterman. Correlation dendrogram + weight donut + blended equity vs best single bot. **L**

### F8 · GENESIS — Goal-to-Strategy Generator  *(the AI-native headline)*
Type a goal → Gemini emits a full valid BotSpec (constrained to our schema/DSL) → auto-backtest → feed metrics + goal back → iterate until constraints met or explain why not. A **closed generate→evaluate→critique→regenerate loop** held accountable to real backtest numbers. **M**

## THE ANALYSIS PANEL  *(new section — the home for all diagnostics)*
A dedicated **Analysis** surface in the Forge (a mode/tab on a strategy) that unifies every diagnostic feature in one place instead of scattered buttons: Deep-Analysis metric sheet + grade, **Regime Radar** (F1), **Overfitting Sentinel** (F2), **Meta-Labeler** lift (F5), factor/alpha attribution, exit-reason + drawdown attribution, and — at the top — **THE IMPROVER** verdict (the special algo below). One screen that tells you the complete truth about a strategy and what to do about it. Everything reads from the single backtest run already produced.

## THE IMPROVER — the shared diagnostic KERNEL  *(full spec: FORGE_IMPROVER_SPEC.md)*
The "special algo that analyses an algorithm and makes it better based off a run" — designed in depth by 3 research streams (our quant library + 2 agents). It's a **bounded recursive diagnosis-tree engine**: it shatters a `(BotSpec, run)` into problem-chunks, builds a branching tree where each weakness is a claim, each claim is tested against the backtest oracle, each confirmed claim decomposes into root causes with justification sub-trees — best-first frontier priced by **dollar-impact × uncertainty** (MCTS-flavored), Bayesian confidence, hard budget/termination + a separate never-dead-end guarantee. Substrate: a per-trade **Ledger** (incl. synthesized mistrades/missed-entries), a compute-on-demand **Metric Registry** (~40 metrics, never says "no"), **11 testers**, a **5-axis error index** ("show all Calmar-hurting errors"), a **Knowledge Layer** (our 53-file quant library → reason → web, cited), a **scoped never-say-no Agent**, and a report of **action cards stamped by target metric** with adaptive staging + one-click apply→re-backtest.
**This is the crown jewel and the shared kernel** — the 8 features below become consumers of its ledger/oracle-harness/registry/index (see spec §15), so they get faster + more advanced. Build order: **kernel K0–K6 first (spec §16), then the 8 features fold in.**

## Synergy map
F1 Regime feeds F5 (features), F2 (regime folds), F6 (macro signal). F5 meta-labels feed importance + confidence sizing. F2 Sentinel consumes F3/F4 trial counts (deflated Sharpe). F6 feeds new DSL signals into F3/F8. F7 consumes every bot's return vector.

## MASTER BUILD ORDER (build ALL)
**THE IMPROVER kernel first** (shared substrate — FORGE_IMPROVER_SPEC.md §16):
K0 Substrate (Run artifact + Ledger + Metric Registry + sensitivity) → K1 Testers (11) → K2 Diagnosis-tree engine → K3 Grouping + Strengths + Synthesis + Action Cards → K4 Knowledge Layer → K5 Analysis Agent → K6 Analysis Panel UI.
**Then the 8 features fold in as consumers:**
F1 Regime Radar → F2 Overfitting Sentinel → F5 Meta-Labeler → F3 Darwin → F4 Terraform → F6 Prospector → F7 Portfolio Forge → F8 Genesis.

## Runners-up (documented for later)
The Adversary (LLM red-team), Glass Box (per-trade explainability + counterfactuals), Stress Chamber (crisis replay + EVT tail), Strategy DNA galaxy, The Colosseum (tournaments), Kelly/vol-target sizing, Factor Attribution, Execution Realism (impact/capacity), Synthetic Market Generator (block-bootstrap/GARCH), Time Machine (version diff), Voice building.
