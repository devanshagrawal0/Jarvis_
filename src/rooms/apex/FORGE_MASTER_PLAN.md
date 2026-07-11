# THE FORGE — Master Plan v2 (research-complete)

> **Status: PLAN ONLY.** Tab exists (Home · **Forge** · …). This supersedes FORGE_PLAN.md (v1).
> Built from: 13 platform research briefs (QuantConnect/LEAN, Backtrader, VectorBT, Zipline, Nautilus, Composer, TradingView, Numerai, QuantRocket, Blankly, Lumibot, Backtesting.py, Hummingbot) + dedicated research on composition/portfolio, metrics/robustness, Python static-analysis, Python→JS bridging, sandboxing (WASM/Windows/RestrictedPython/cloud), AI code-explanation, AI control models, node editors, 3D/WebGL dataviz, charts, layout libs, strategy-library UX, and "complexity-made-easy" UX.
> **Locked decisions (Dev):** forms-first builder + node-graph later (same spec) · stocks+crypto public data v1 · genuinely-built UI (WebGL/3D, not just CSS) · complex capability but easy to use · drop-a-`.py` → Jarvis briefs it · embedded Jarvis that can drive manually / AI / hybrid.

---

## 0. The pitch
**The Forge is an AI-native quant strategy cockpit.** You bring strategies three ways — **drop a Python file**, **wire a visual node graph**, or **fill guided forms** — all compiling to one spec. An embedded **Jarvis** reads, briefs, backtests, stress-tests, and helps you **pair strategies into layered portfolios**, with you in manual, assisted, or agent-driven control. One engine backtests → paper → live. The UI is a cinematic WebGL workspace that stays easy because complexity is progressively disclosed.

---

## 1. Core model
- **Block** — typed, pure, testable unit: Signal · Filter · Entry · Exit · Sizer · Risk. (Reuses existing quant.js: realizedVol, correlation, anomalies.)
- **BotSpec** — the serializable JSON truth: `{meta, universe, signals[], entry-tree, exit, sizing, risk, schedule}`. UI edits spec; engine reads spec; three build modes are just views over it.
- **Strategy** = a BotSpec (logic). **Bot** = Strategy + runtime config (capital, mode, instruments) + state.
- **Strategy Evaluator** — `evaluate(spec, bars) → {trades, equityCurve, positions, metrics}`, deterministic, **no look-ahead**. One engine powers Backtest / Paper / Live (the Nautilus & Blankly "write-once-run-anywhere" principle — the #1 architecture serious tools converge on).

---

## 2. Three ways to build (all → one BotSpec)
1. **Python drop** (§3) — bring your own `.py`; Jarvis parses + wraps it to the spec interface.
2. **Visual node graph** — wire Signal→Entry→Exit→Sizing→Risk on a canvas (React Flow). Cinematic (animated data-flow edges, minimap). Later wave; same spec as forms.
3. **Forms** — guided section cards with human-readable summaries ("Buy when 20-EMA crosses 50-EMA and RSI<30"). Ships first.

---

## 3. Python drop → Jarvis Brief pipeline (the killer feature)
**Flow:** drop `.py` → static analysis → safe trial run → **auto-generated Strategy Brief** → integrate/pair.
- **Static analysis (no execution):** parse with Python `ast` (+ tree-sitter / Jedi / radon for structure & complexity) to auto-extract: strategy type, indicators used, parameters + defaults, entry/exit logic, risk controls, data dependencies, imports. → fills a **Strategy Brief** (what it does, inputs/outputs, params, risk, look-ahead flags).
- **Safe execution (tiers):** (a) **Pyodide / WASM in-browser** for pure-Python/numpy strategies — zero backend, fully sandboxed; (b) **local subprocess + Windows Job Object** (CPU/mem/time caps, no network) for full-CPython strategies; (c) **RestrictedPython** for a curated DSL; (d) **cloud sandbox** (E2B Firecracker / Modal) as the isolation fallback. Recommend Pyodide-first, subprocess-with-Job-Object for heavy CPython.
- **Bridge:** the user's file implements a small **Strategy ABC** (like Backtrader/Lumibot/Jesse's `should_long`/`next()`); Node ↔ Python talk over subprocess + JSON (or Arrow/msgpack for bars). 
- **Brief output (Jarvis):** plain-English summary + extracted params (editable) + detected indicators + **honesty badges** (look-ahead ✓/✗, repaint ✓/✗) + a quick backtest preview. Trustworthy-explanation patterns from Cursor/Aider/Cody (grounded, cites the code, shows confidence).

---

## 4. Embedded Jarvis control model
Three modes, user-switchable (levels-of-autonomy pattern):
- **Manual** — you build; Jarvis only answers when asked.
- **Copilot** — inline suggestions (param tweaks, pairings, overfit warnings), you approve each.
- **Agent** — Jarvis drives the canvas via a **tool/function-calling action registry** (add block, set param, run backtest, add strategy to portfolio), with **preview/diff + undo** before anything commits.
Backed by the existing Jarvis brain (now on `gemini-2.5-pro`, reliable tool-calling). Human-in-the-loop safety: every side-effect is previewed; nothing auto-executes trades.

---

## 5. Strategy Library & organization
- **Folders + tags + naming + versioning + clone** (TradingView "My Scripts" + QuantConnect projects + Numerai model-slots patterns).
- Cards show mini equity sparkline + key metrics; **starter templates** (EMA trend, RSI mean-reversion, vol breakout).
- Each strategy is a versioned, migration-safe BotSpec (JSON). Stored in a backend `apex_strategies` store.
- **Orthogonality surfaced:** when adding a strategy to a portfolio, show its **correlation to the current book** (Numerai's "reward diversification not correlation" idea).

---

## 6. Backtest engine + Report Card
Report card (grouped for UI): **Sharpe · Sortino · Calmar · Max Drawdown + duration · Profit Factor · Expectancy · SQN** headline; **VaR/CVaR · Tail Ratio** risk sub-panel; **trade histogram · MAE/MFE scatter** trades tab; **CAGR · exposure · win rate · alpha/beta**. 
- **Plots:** monthly-returns heatmap (QuantConnect/QuantStats), underwater/drawdown plot + top-5 drawdown table, rolling-Sharpe line.
- **Honesty badges:** look-ahead + recursive/repaint checks (port Freqtrade's logic), survivorship flag, snooping-adjusted Sharpe.
- **Reuse:** QuantStats / quantstats-lumi (Apache-2.0) as the tearsheet engine; empyrical/ffn for à-la-carte metrics.
- **Steal:** TradingView's **chart↔trade-list "scroll to bar"** linking; Lumibot's `add_line`/`add_marker` indicator-overlay (see *why* each trade fired).

---

## 7. Robustness Lab (anti-overfitting) — build in this order
1. **OOS holdout** (trivial, ★★★★★) → 2. **Monte Carlo** on equity (trade shuffle + bootstrap → fan chart + drawdown distribution, easy, ★★★★★) → 3. **Parameter-sensitivity heatmap** (plateau vs spike — VectorBT/Backtesting.py signature, ★★★★★) → 4. **Walk-forward analysis** (★★★★★) → 5. **Deflated Sharpe + Minimum Backtest Length** → 6. **PBO/CSCV** (Bailey & López de Prado, advanced) → 7. **White's RC / Hansen's SPA** (expert).
- **Reuse:** mlfinlab (older BSD commit) for Deflated Sharpe / MinBTL / PBO-CSCV; DIY numpy for Monte Carlo + heatmaps. First four = ~80% of the protection for ~20% of effort.

---

## 8. Composition / Layers / Portfolio
**"Layers" taxonomy** (the user's "what layers to make"): **signal/base → blending/stacking → allocation → regime → overlay.**
- **Allocation methods** (dropdown, each with tooltip + required-inputs badge): equal-weight · inverse-vol · vol-targeting · **risk parity** · **HRP** (best for 10+ strategies) · min-variance · max-diversification · mean-variance · **Black-Litterman** (treats each strategy signal as a "view") · fractional-Kelly.
- **Regime layer:** HMM / Markov-switching / jump-model → allocate by market state.
- **Overlays:** tail hedges, trend/CTA overlay, vol-target overlay, filters — judged on **Cost, Correlation, Convexity**.
- **Portfolio rules** (the builder's rule panel): position caps · sector/asset/factor exposure caps · gross/net leverage · **correlation caps** · rebalance cadence/drift-band · risk budgeting · portfolio vol targeting · **drawdown kill-switch ladder** (>2%→80%, 4-6%→40%, >6%→flat+cooldown) · turnover/cost caps.
- **Reuse:** **skfolio** #1 (sklearn API + Stacking for meta-strategies + cross-validation, BSD, ~2k★), Riskfolio-Lib (drawdown/CVaR measures, ~4.3k★), PyPortfolioOpt (simplest MVP, MIT, ~5.8k★).
- **"Elements to trade off":** return↔drawdown, diversification↔conviction, responsiveness↔stability, hedge-drag↔tail-protection, estimation-risk↔robustness. Surface these as live diagnostics.
- **UX template:** Composer "symphonies" — drag-drop tree of blocks (assets/weights/conditionals/groups) + Historical Allocation Graph. Each block = a layer.

---

## 9. The advanced UI (WebGL/3D, not just CSS)
- **Node editor:** **React Flow / xyflow** (best styling control + minimap + perf) — cinematic edges (animated data-flow, glow), for the visual builder. (Rete.js / LiteGraph as alternates.)
- **Charts:** **lightweight-charts** (TradingView, candlesticks + crosshair) for price/backtest; **uPlot** for huge fast series; **visx** for custom (heatmaps, MAE/MFE scatter, fan charts). Cinematic dark: gradient area fills, glow strokes, glowing endpoints.
- **WebGL/3D wow (react-three-fiber / deck.gl):** 3D **parameter-optimization landscape** (returns surface over 2 params — the robustness plateau you can fly over), portfolio-as-3D correlation constellation, Monte-Carlo path "fan" in 3D, GPU order-flow. Used surgically, not everywhere.
- **Workspace layout:** **Dockview** (MIT, zero-dep, tabs/groups/grids/**floating panels + popout windows + serialization**) for the IDE-style dockable forge; react-resizable-panels for simple splits.
- **Aesthetic:** inherits the APEX Observatory look (cyan/amber HUD, glass, corner brackets), but the Forge is its own full workspace.

---

## 10. UX — complexity made easy
Progressive disclosure everywhere: **presets/templates** first, advanced knobs behind disclosures. **Command palette** (⌘K) to do anything. **Human-readable summaries** of every block. **Live preview** (mini-backtest re-runs as you edit). **AI copilot** side-panel that can build/critique on request. Empty states that teach. Guided "first strategy" flow. (Patterns from n8n, Blender nodes, Linear, Retool, Composer.)

---

## 11. Tech stack & free tools (shopping list, licenses)
- **Compose/optimize:** skfolio (BSD), Riskfolio-Lib (BSD), PyPortfolioOpt (MIT).
- **Metrics/tearsheet:** QuantStats / quantstats-lumi (Apache-2.0), empyrical-reloaded (Apache-2.0), ffn (MIT).
- **Robustness:** mlfinlab (BSD, older), DIY numpy.
- **Backtest reference/reuse:** Backtesting.py (AGPL — reference only), VectorBT (Apache+CommonsClause — check license), Nautilus (LGPL) as architecture reference.
- **Python analysis:** `ast` (stdlib), tree-sitter, Jedi, radon.
- **Sandbox:** Pyodide (WASM), Windows Job Objects (native), RestrictedPython (ZPL); cloud fallback E2B/Modal.
- **UI:** React Flow (MIT), lightweight-charts (Apache-2.0), uPlot (MIT), visx (MIT), react-three-fiber/three.js (MIT), deck.gl (MIT), Dockview (MIT), react-resizable-panels (MIT).
- **Data:** existing free stocks+crypto (Yahoo/Coinbase); Alpha Vantage free tier now 25 req/day.

---

## 12. Architecture
- **Storage:** `apex_strategies` (BotSpec JSON, versioned) + backtest results cache.
- **API:** `GET/POST/DELETE /api/apex/strategies`, `POST /api/apex/backtest`, `POST /api/apex/analyze-python` (returns Strategy Brief), `POST /api/apex/portfolio/optimize`.
- **Python bridge:** Node spawns sandboxed Python (subprocess+JSON / Pyodide) implementing a Strategy ABC; bars passed as JSON/Arrow.
- **Evaluator** shared across Backtest/Paper/Live. **Paper engine** = evaluator + simulated broker (cash, fills at next-bar-open, modeled slippage/commission, P&L) — the big functional gap, reuses the evaluator.
- **Pipeline:** Forge (build) → Backtesting → Paper Trading → Trading Bots (deploy/monitor) → Live Testing.

---

## 13. Build waves
- **F0 — Foundation:** BotSpec schema + block registry + core blocks (pure, tested). No UI.
- **F1 — Evaluator + Report Card:** backtest engine (no look-ahead) + QuantStats metrics + core plots.
- **F2 — Forge UI shell:** Dockview workspace, forms builder, human-readable summaries, spec state, Library (save/clone/folders/templates).
- **F3 — Live preview + charts:** inline mini-backtest, lightweight-charts price+trades, monthly heatmap, underwater plot.
- **F4 — Python drop + Jarvis Brief:** static analysis → brief; Pyodide execution; honesty badges.
- **F5 — Robustness Lab:** OOS → Monte Carlo → param heatmap → walk-forward.
- **F6 — Composition/Portfolio:** layer canvas + allocation methods (skfolio) + portfolio rules + correlation/orthogonality diagnostics.
- **F7 — Embedded Jarvis control:** copilot suggestions → agent action-registry with preview/diff/undo.
- **F8 — Node-graph builder:** React Flow view over the same spec.
- **F9 — 3D/WebGL wow:** parameter-landscape surface, correlation constellation, MC fan.
- **F10 — Paper-trading engine:** simulated broker; wire Forge→Backtest→Paper.
- **(Later)** advanced sandbox (subprocess/Job Object/cloud), deep robustness (PBO/CPCV/SPA), live deployment.

---

## 14. What-to-steal shortlist (from the 13 platforms)
- **TradingView:** chart↔trade-list "scroll to bar"; All/Long/Short metric columns.
- **QuantConnect:** monthly-returns heatmap + top-5 color-coded drawdowns; Alpha→Portfolio-Construction framework.
- **VectorBT / Backtesting.py:** parameter-sensitivity heatmap.
- **Nautilus / Blankly:** one engine, backtest=live parity (write once).
- **Lumibot:** `add_line`/`add_marker` indicator-overlay tearsheet.
- **Composer:** AI natural-language → editable visual strategy; symphony block tree.
- **Numerai:** contribution/orthogonality-based evaluation (reward diversification, not correlation).
- **QuantRocket:** live-vs-backtest overlay (implementation shortfall).
- **Hummingbot:** unified research→backtest→optimize→paper→live→monitor loop.

---

## 15. Open decisions
- Single-symbol-per-bot vs multi-symbol portfolio in v1 (lean: small symbol list, one position each).
- Backtest fill model assumptions (next-bar-open + modeled slippage/commission — state honestly).
- Python execution default (Pyodide-first vs subprocess) — depends on whether strategies need full CPython libs.
- Where heavy backtests run (client vs server route).
- Node-graph now vs after the engine is proven (locked: after).
