# THE FORGE → Command Center Rebuild (LOCKED PLAN)

Goal: rebuild the Forge **content area** to match the command-center mockup pixel-for-pixel,
**keeping every existing feature/engine**, and add a new **Signal Upload Studio**.

## Key finding — the shell already exists
The APEX room (`ApexHome.tsx`) already renders the mockup's chrome:
- `.top` nav (APEX brand, tab strip, ⌘K, heartbeat, LIVE clock, views/theme, Exit)
- `.tape` live ticker ribbon
- `.aibar` bottom Jarvis bar (modes Analyst/Trader/Quant/Research, input, chips)
So this rebuild = **`ForgeView` + `forge.css` + `ForgeStudio` only**. Do NOT rebuild room chrome.
Reuse the existing `.aibar` as the mockup's bottom Jarvis bar (already matches).

## Design language (match the mockup — it is DARKER & FLATTER than current)
- Drop the city photo backdrop in Forge; use clean near-black navy with a faint dot/line grid.
- Bg base `#080a0f` → panels `rgba(16,19,26,.72)` with 1px `rgba(150,180,215,.12)` borders, radius 10px.
- Category accent colors for node types & sections (from mockup):
  Universe `#3b82f6` · Signal `#22d3a0` · Filters `#2dd4bf` · Risk `#a855f7` · Sizing `#3b82f6`
  · Entry `#84cc16` · Exit `#f59e0b` · Execution `#f97316` · Portfolio `#a855f7` · Analytics `#38bdf8`.
- Semantic: pos `#4ade80` / neg `#f87171` / warn `#fbbf24` / info `#38bdf8`. Deploy primary = cyan `#22d3ee`.
- Type: display Oxanium (headers/labels), mono JetBrains (numbers, tabular-nums), 12–14px body, 9–11px labels.
- Keep the existing UX upgrades already added (toasts, Esc/⌘Enter/⌘S keys, click-again delete, focus-visible).

## Layout (Forge content = header toolbar + 3 zones; bottom Jarvis is the room aibar)
### Header toolbar row
Left: `THE FORGE / Strategy & Bot Workshop ⓘ`.
Right (verb order = workflow): **Genesis · Variables · Signals · Datasets · Templates · | · Validate · ▶ Run Backtest · Compare · Save · ◈ Deploy▾**.
Hierarchy: Deploy = sole saturated primary (cyan). Run Backtest = strong secondary. Rest = quiet outline.

### Left column — Library (tabbed)
- Tabs: **Library / Projects / Blocks**.
- Search box + filter icon; chips: All · Favorites · Mine · Official.
- **Quick Start Templates**: cards (name, market·timeframe, ★rating). Wire to our `templateSpecs`.
- **Strategy Blocks** palette (drag-to-canvas): Universe(12) Signals(28) Filters(24) Risk(18)
  Position Sizing(14) Entries(20) Exits(16) Execution(15) Portfolio Constraints(10) Analytics(9).
  Counts from `SIGNALS`/`SIGNAL_GROUPS` + block registry. Drag → drop onto canvas adds node.
- Projects tab = saved strategies (our `useStrategies` list) + folders/signals/variables library.

### Center column — Builder (tabbed canvas)
- Tabs: **Visual Builder / Python / Transcript / Research**.
  - Visual Builder = upgraded `ForgeGraph` → multi-category node canvas (Universe→Signal→Filters→Risk→Sizing→Entry→Exit→Execution→Portfolio), orthogonal connectors, color-coded nodes w/ icon+subtitle+config summary, **minimap** bottom-left, left **tool rail** (select/pan/connect/box/text/snap/fit/lock), zoom controls + % + gear top-right.
  - Python = code view (existing python-flow / py brief).
  - Transcript = the Jarvis conversation about this strategy (room chat scoped).
  - Research = Prospector/alt-data + notes.
- **Docked bottom analysis dock** (tabs, NOT modals): **Backtest Results / Monte Carlo / Parameter Heatmap / Walk-Forward Matrix / Trade Distribution / Path Analysis**.
  Wire: Backtest→`runBacktest` metrics+equity; Monte Carlo→`monteCarlo`; Heatmap→`runTerraform` grid;
  Walk-Forward→`runSentinel().wf`; Trade Distribution→ledger from improver `buildRun`; Path→equity/dd paths.

### Right column — Strategy Health rail (always-on report card)
- **Strategy Health** gauge: single score (0–100) + label + checklist (Data Integrity / Logic Validation /
  Backtest Quality / Walk-Forward / Overfit Risk). Derive from Improver grade + Sentinel trust + Deep report.
- **Performance (Out of Sample)** grid: CAGR, Sharpe, Max DD, Win Rate, Profit Factor, Exposure, Turnover, Slippage.
- Mini **Equity (OOS)** + **Drawdown** sparklines (reuse EquityChart/DrawdownChart, compact).
- **Jarvis Analysis · AI**: Strengths / Considerations / Warnings / Recommendations + **Readiness to Deploy**.
  Wire to Improve (coach) + Adversary + Improver strengths/cards.
- **Experiment Queue**: running/queued jobs (Darwin/Terraform/Sentinel async runs) with progress %.

## Existing features → new home (NOTHING is lost)
- Improver → Strategy Health score + Jarvis Analysis + (deep view still openable).
- Sentinel → Walk-Forward dock tab + Health "Overfit Risk / Walk-Forward" checklist rows.
- Terraform → **Parameter Heatmap** dock tab (2D) + keep 3D as an optional "expand" takeover.
- Meta-Labeler → dock "Trade Distribution" adjunct or a Health sub-panel.
- Regime Radar → dock tab or Research tab section.
- Darwin/Genesis → header actions + Experiment Queue.
- Deep Analysis → feeds Performance grid + Health.
- Oracle (3D) → optional expand from Path Analysis.
- Portfolio (HRP) → header/Projects.
- Prospector → Research tab.
- DNA/Candles → node canvas + Trade Distribution.

## NEW: Signal Upload Studio (inside the Signals studio)
In `ForgeStudio` (kind="signal") add a third section/tab **"⬗ Upload & Derive"**:
1. **Dropzone** — upload .py/.ipynb/.csv/.json/.txt.
2. **Progress animation** (staged, this IS a wanted feature moment): Reading file → Parsing → Detecting
   inputs/indicators → Deriving signal → Ready. Animated stage rail with a scan effect.
3. **Analysis chatbot** below the dropzone: streams what the file does, then states **what the signal output
   will be** (name, what it computes, reading, output type, value range). User can ask follow-ups.
4. **Create custom signal** → persists:
   - the **code to run** (extracted/generated function body),
   - the **retrieval method** (how to compute the signal value at runtime; DSL expr + code path),
   - metadata (name, description, inputs, output type/range, source file).
   Stored **well-labeled & easy to fetch**: server writes code to `runtime/forge-signals/<slug>.<ext>` +
   DB `apex_signals` row {name, expr, description, codePath, codeBody, source:"upload", createdBy}.
   When a bot uses the signal, the engine resolves it by `codePath`/`expr` from the library.
- Backend: `POST /api/apex/forge-signal-analyze` {filename, code} → {summary, inputs, derived:{name,dsl,reading,outputType,range,code}, steps}; extend `saveSignal` to accept `codeBody` and write the labeled file.

## Wave plan
- **W1** — Design system: new command-center tokens + panel/tab/toolbar CSS (additive), drop city bg, grid backdrop.
- **W2** — Shell: rebuild `ForgeView` layout → header toolbar (new buttons + hierarchy) + 3-zone tabbed frame. Keep all handlers/state.
- **W3** — Left Library panel (tabs, search, filters, template cards, blocks palette w/ drag).
- **W4** — Center canvas: tabbed builder + upgraded multi-category node graph + tool rail + minimap + zoom.
- **W5** — Docked analysis dock (6 tabs) wired to existing engines; 2D parameter heatmap + walk-forward matrix + trade distribution + path.
- **W6** — Right Strategy Health rail (score gauge, checklist, perf grid, sparklines, Jarvis analysis, experiment queue).
- **W7** — Signal Upload Studio (dropzone + progress + analysis chat + custom-signal codegen + labeled storage + backend route).
- **W8** — Lifecycle actions: Validate, Compare, Deploy(▾ → paper trading), Datasets. Honest demo state where no engine.
- **W9** — Polish pass + full browser verification + typecheck.

Rules: reuse engines (forge-engine, improver/*, forge-data). No faked/proprietary data (public only, demo-badge unwired).
Keep it compiling every wave. Verify in browser (inspect computed styles; screenshots time out on r3f).
