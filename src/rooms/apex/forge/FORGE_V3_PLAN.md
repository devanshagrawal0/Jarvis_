# THE FORGE — Master Plan v3 (research-complete, "Ice / Platinum" redesign)

> Supersedes FORGE_MASTER_PLAN.md. Built from 2 deep research briefs (AI signal/variable/analysis system + cinematic 3D UI). Dev: current UI (purple/blue slabs, then rejected orange) is out — go full 3D/4K/interactive. Build everything fully EXCEPT the deep-analysis engine, which is designed carefully as its own spec (§7).
>
> **PALETTE LOCKED: Ice / Platinum** — monochrome silver-white (`#EAF5FF` ice / `#C3D4E6` platinum / `#93A8B8` steel) on gunmetal black `#0A0A0C`. Semantic P&L only: green `#4DFFB0` / red `#FF7285`. NO orange, NO purple, NO blue accents.
> **BACKGROUND LOCKED:** the city skyline (`/apex/room-bg.png`), identical treatment to the APEX home room — NOT particles (killed: laggy), NOT a tinted variant. The Forge lives in the same world as home.

## 0. The new mental model — three composable layers
- **Variable** — a named scalar/boolean expression over market data. DSL string, e.g. `RSI(SPX,14) < 30`. Parsed to AST (jsep), whitelist-validated, walked by our own evaluator (NO eval). Extracts inputs + dependencies.
- **Signal** — a reusable, named, versioned condition/indicator that wraps variables + metadata. Other bots subscribe to it (Numerai/Pine-library idea).
- **Bot** — a Composer-style **tree** (nodes: `asset`/`weight`/`if`/`filter`/`group`) whose conditions reference signals/variables by id (or inline expr).
- **Strategy = a FOLDER** that holds many bots + its signals/variables + its analysis reports.
- Both **AI and manual** paths emit the SAME validated JSON object → same parse pipeline. Version everything; bots pin signal versions; edits fan out "dirty" via a reverse index; cycle-detect on save.

## 1. DSL engine (§dependency-free, build first)
- `forge-dsl.ts`: jsep-style parser → AST; whitelist (BinaryExpr/LogicalExpr/UnaryExpr/CallExpression to indicator registry/Identifier=symbol|variable|fn/Literal/MemberExpr symbol.field); `evalExpr(ast, ctx, bars, i)` walks AST → number/bool per bar using the existing block indicators (RSI/SMA/EMA/MACD/ATR/price + VIX/SPX as symbols); `extractDeps(ast)` → {symbols, indicators, variableRefs}. Reuse in variables, signals, and bot conditions.
- Ship our own jsep-mini (tiny, no dep) OR add `jsep` (~5KB MIT). Lean: write a compact Pratt parser to avoid a dep.

## 2. Data model + storage (backend)
- New tables: `apex_variables`, `apex_signals`, `apex_folders` (strategy folders), extend `apex_strategies`→bots with `folder_id`. Each stores JSON spec + version + created_by(user|ai) + depends_on/used_by.
- CRUD routes `/api/apex/{variables,signals,folders,bots}`. Jarvis tools: `apex_variables`, `apex_signals`, `apex_folders` (list/inspect) + extend `apex_strategies`. Reverse-index for dirty-propagation.

## 3. AI generation (Jarvis → variable/signal/bot from NL)
- Backend `/api/apex/ai-compose` → sends description + universe + existing-signals to the brain with a forced structured-output JSON schema (one schema, `kind: variable|signal|bot`). Validate with a JS validator → semantic check (symbols/indicators exist) → retry-with-error (≤2) → return parsed spec + `needs_clarification`. Frontend shows "Here's what I understood…" → confirm → save. Also a Jarvis tool `apex_create_from_text` so the command bar can do it.
- Manual path: forms + the DSL editor produce the identical object.

## 4. UI REDESIGN — "Ice / Platinum HUD" (the big visible one) — DONE (V2)
- **Aesthetic:** gunmetal base `#0A0A0C`, brushed-steel translucent panels over the city skyline; ice `#EAF5FF` / platinum `#C3D4E6` / steel `#93A8B8` monochrome accents; semantic green `#4DFFB0` / red `#FF7285` for P&L only. Mono numerics (JetBrains Mono), condensed technical headers (Oxanium). Thin bright HUD edges, crisp polished-chrome glows. City-skyline backdrop matching home. (Alt themes still user-selectable later: keep the aliased-token trick so a whole reskin is one block.)
- **Stack (npm i --legacy-peer-deps):** `three` + `@react-three/fiber@9` + `@react-three/drei` + `@react-three/postprocessing` (Bloom/ChromaticAberration/Vignette/Noise) + `@xyflow/react` (node canvas) + `gsap` (now free; ScrambleText on numerics, magnetic cursor) + keep `motion`. Author shaders in TSL where possible for future WebGPU. Lazy-load rapier/deck.gl.
- **Layout:** raymarched WebGL background (SDF forge-fog) behind everything, parallax on pan. Top **Signals bar** (open big centered widget: drop code → save as signal). Left: strategy **folders** tree. Center: **node-graph builder** (@xyflow) with 3D-tilt metal node cards + glowing animated data-flow edges (SVG animateMotion packets) + minimap-as-radar. Right: live report HUD (holographic dials/gauges).
- **Signature moment:** Run Backtest = the node **forges** — core glows white-hot, emits GPGPU sparks, heat-shimmer, then cools revealing engraved results. ScrambleText settles every metric.
- **Perf:** DPR≤2, one bloom pass, prefers-reduced-motion static fallback, KTX2 if textures, lazy heavy libs. Target 60fps.

## 5. Signals section (top) + big drop widget
- Top "◈ Signals" opens a centered modal: paste/drop code or write a DSL expr, name it, save → `apex_signals`. Selectable from a picker when building a bot. Custom Python-derived signals: the code path is stored; the signal pulls its series from it (via the Python microservice, §7 infra) or a DSL wrapper.

## 6. Folders + Python→Strategy flow
- Drop `.py` → **full analysis first** (loading state, wait), brief shown. Then "Make this a strategy" (button or tell Jarvis) → creates a **folder**, stores the code-path, extracts/creates a **custom variable/signal** from the analysis, seeds a bot. Manual equivalent everywhere.
- Folder **Actions** menu → triggers the deep-analysis engine (§7).

## 7. DEEP ANALYSIS ENGINE (design carefully — separate spec, build last)
- **Trigger:** folder/bot "Actions" → a spawned analyst pass.
- **Compute:** small **Python microservice** (quantstats-lumi + empyrical) over the return series → the full **31-metric** report (Sharpe/Sortino/Calmar/MAR/Sterling/Omega/Kappa/MaxDD/Ulcer/UPI/Recovery/VaR/CVaR95-97.5/TailRatio/Skew/Kurtosis/Win/PF/Payoff/Expectancy/GainToPain/Kelly/RoR + benchmark: Beta/Alpha/Corr/R²/IR/Treynor/Up-Down-Capture). (If Python unavailable, JS fallback for the core ~15.)
- **$100 / 5-yr / 6-month-window** capital path + Monte Carlo p5/p50/p95 cone; backtest of chosen year (default latest).
- **Overlap/issue check** across a folder's bots (correlation, redundant signals, conflicts).
- **Narrative:** rule-engine findings (threshold table → pro/con/lacking/risk) → LLM narrator (grounded, no invented numbers) → "what's working / weaknesses / what to improve."
- **Saved as a report JSON** (flat metric keys) so Jarvis answers "what's my Sortino?" by lookup (`apex_report` tool). Versioned (engine_version, schema_version).

## 8. Build waves (v3)
- **V0** DSL engine (parser+eval+deps, dep-free) + unit tests.
- **V1** data model: variables/signals/folders tables + CRUD + Jarvis tools + dirty-propagation.
- **V2** install 3D stack; new Molten-Metal shell (raymarched bg, metal panels, HUD type/colors) replacing forge.css look.
- **V3** @xyflow node-graph builder (metal nodes, glowing edges) editing the bot tree.
- **V4** Signals section + big drop widget; variable/signal editors (DSL + forms).
- **V5** AI compose (NL→spec structured output) + confirm flow + Jarvis tool.
- **V6** folders + Python→strategy flow + manual equivalents.
- **V7** signature "forge" backtest animation + holographic dials + ScrambleText.
- **V8 (careful)** deep-analysis engine + Python microservice + report storage + report Jarvis tool.
- **V9** 10 over-the-top new features + 10 upgrades (below).
- **Test every 2–3 waves.**

## 9. 10 new features + 10 upgrades (V9 shortlist)
NEW: (1) 3D parameter-landscape you orbit to find robust peaks, (2) portfolio-as-constellation, (3) AI "improve this strategy" suggestions, (4) strategy DNA/fingerprint + similarity, (5) regime ribbon overlay, (6) walk-forward lab, (7) live paper-trading forge, (8) sound-reactive alerts, (9) strategy marketplace/share, (10) voice: "Jarvis build me…".
UPGRADES: (1) real candlestick+trade-marker chart (lightweight-charts), (2) multi-symbol universes, (3) full boolean-tree entry editor, (4) walk-forward + PBO in robustness, (5) more sizing/risk blocks, (6) template gallery, (7) folder drag-org, (8) diff/version history, (9) keyboard-first + cmdk, (10) themes (Molten/Blueprint/Obsidian).

## 11. HERO UI FEATURES (locked with Dev — build these fully)
Two tiers of "crazy UI", both real & functional (not decoration):

> BUILD NOTE (V3 done): the node graph is **self-rendered (SVG + foreignObject)**, NOT @xyflow. xyflow's store kept resetting (error #002 / measurement never completed inside the animating room → edges never rendered). The custom SVG renderer mounts reliably, needs no measurement, and gives full control of the ice-metal look + glowing flow edges. @xyflow left installed but unused.

### 11a. THE LIVING BLUEPRINT — the everyday builder (folds into V3)
- The center builder IS a **node-graph canvas** (`@xyflow/react`, installed). Variables → Signals → Entry/Exit logic render as **glowing ice-metal node cards wired together**; edges carry **animated data pulses flowing in evaluation order**.
- On **Run**, pulses accelerate and the path that fired the entry **lights up hot-white**; nodes that gated the trade pulse. The strategy visibly "comes alive."
- Replaces the plain forms as the primary editor (forms remain as a node's expanded inspector). Minimap-as-radar. This is the constant wow + the biggest UX upgrade.

### 11b. THE ORACLE — the takeover payoff (folds into V7)
- A **Predict** action on any strategy/bot → room dims, panels slide away, a **full 3D holographic projection** rises (r3f, lazy-mounted only for this view so it never costs idle frames).
- Equity curve **extruded into a glowing ribbon** flying forward through time; **Monte Carlo = a translucent probability cone** (fan of futures) with the **median path as a bright spine**; drawdowns carve valleys; **benchmark ghosts alongside**.
- **Orbit + scrub the timeline**; Jarvis narrates grounded stats ("87% of paths stay above water; worst 5% draw down 22%"). Esc / "collapse" returns to the builder.
- Signature moment — it earns the WebGL, and only mounts on demand (perf-safe given particles were killed for lag).

## 10. Load-bearing decisions
1. One validated JSON object, two entry paths (AI + manual), one parse pipeline.
2. Parse to AST + walk yourself (safe eval + free dependency extraction + storable form).
3. Version everything; pin references; fan-out dirty via reverse index.
4. Metrics in Python (don't reimplement 31 formulas in JS); report = keyed artifact for AI lookup.
5. Narrative = rules for facts + LLM for prose.
6. Molten-Metal HUD; true-black; fresnel + tight bloom; one hero effect per view.
