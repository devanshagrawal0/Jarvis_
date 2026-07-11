# APEX v4 — "OVERDRIVE": from dashboard → living quant terminal

The v3 Home is a *good normal dashboard*. v4 makes it **over-the-top, PhD-grade, and unmistakably not-normal** — GPU visuals, research-level analytics, and a wall of free/alternative data no retail tool ships. This is a **research-grounded plan only** (libraries, math, data, endpoints named). No code until approved.

Two sections, each with **20 big advanced upgrades + 10 extreme new features** (60 items), plus a **new-data-sources** appendix and a **widget-redesign** mandate (the current widgets are mid — that's addressed head-on).

**Guardrails carried over:** public/free data only (no proprietary/Bloomberg/local); realized vol ✓, live options-IV ✗; heavy math → Web Workers/WASM; GPU render (Canvas/WebGL/WebGPU) once node/point counts pass a few hundred.

---

## §0 — WIDGET REDESIGN MANDATE (why they feel "mid" + the fix)
The current widgets hand-roll canvas and under-format. Fix by standardizing on real dataviz engines and a design system:
- **Charts:** [`lightweight-charts`](https://github.com/tradingview/lightweight-charts) (price, have it) · [`@visx`](https://airbnb.io/visx) + `d3` (precision analytics) · [`ECharts`](https://echarts.apache.org) (rich stat charts) · `deck.gl` v9 / `regl` / `PixiJS` (GPU heatmaps/point clouds) · `three.js`+`react-three-fiber` (3D).
- **Every widget gets:** a proper title/subtitle/asOf, axis labels + units, legend, empty/loading/error states, tooltips/crosshair, perceptual color (OKLCH via `culori`), tabular-nums, and a "why this matters" one-liner. No more raw canvas blobs.
- **Design system:** tokens (have) → glassmorphic depth, elevation, motion (`motion`/`framer-motion` FLIP), consistent 8pt spacing, one accent + semantic colors.

---

# SECTION 1 — UI / VISUAL / INTERACTION

## 20 UI Upgrades
1. **Flip-ticker number cells** — odometer/roll + flash on every quote (the #1 "it's alive" upgrade). *`motion` layout or GSAP flip-clock.*
2. **Live animated treemap** (sector→industry→ticker; size=cap, color=%chg, retiles on tick). *`d3.treemap`+canvas / `@visx/hierarchy`.*
3. **Voronoi "market cell" map** — organic tessellation instead of rectangles; rare and designed-looking. *[`d3-voronoi-map`](https://github.com/Kcnarf/d3-voronoi-map).*
4. **GPU sparkline density layer** — every row/card/tooltip carries a mini spark+range bar, all on one canvas (not 500 SVGs). *PixiJS/`regl`.*
5. **Glassmorphic layered HUD panels** — frosted depth, inner glow, 1px gradient borders over an ambient backdrop. *CSS `backdrop-filter` + layered shadows.*
6. **Dockable/resizable/tab-tear workspace** — real terminal layout: split, tear-off, save. *[`dockview`](https://dockview.dev) or `react-mosaic`.*
7. **WebGL history minimap/scrubber** — brushable full-history overview strip driving the detail chart, millions of points. *`deck.gl` v9 (WebGPU).*
8. **Virtualized live-flash data grid** — 100k rows, per-cell flash, pinned cols, heat-shaded (Bloomberg monitor). *TanStack Virtual + canvas flash overlay.*
9. **Perceptual color system** — OKLCH diverging scales, colorblind-safe, magnitude→intensity (not just sign). *`culori` + `d3-scale-chromatic`.*
10. **FLIP re-rank physics** — rows/cards slide to new positions on live re-sort (preserves "which ticker is which"). *`motion` `layout`/`layoutId`.*
11. **Synced multi-pane charts** — price/volume/RSI/funding with locked crosshair + shared zoom. *`lightweight-charts` multi-pane.*
12. **Radial ring/arc instrument gauges** — RSI, Fear&Greed, %-of-range, breadth sweep with trailing glow (sci-fi cluster). *SVG arcs + `motion`.*
13. **Data-reactive shader ambient background** — nebula/grid/aurora whose turbulence scales with VIX. *`react-three-fiber` fullscreen shader.*
14. **Boot choreography** — skeleton→shimmer→staggered data reveal + a "power-on" sweep across the deck. *`motion` stagger + GSAP timeline.*
15. **Command palette v2** — fuzzy + Bloomberg-style function grammar ("NVDA GP", "compare", "add wl"). *`cmdk` + `Fuse.js`.*
16. **DOM ladder w/ animated liquidity bars** — bid/ask size bars from center, resting orders animate in/out, breathing mid. *Canvas/PixiJS.*
17. **Live trade-tape waterfall** — prints flow upward, size/side-colored, whales flash+pin. *virtualized list / canvas at high rates.*
18. **Micro-interaction system** — hover lift, focus glow, magnetic buttons, explain-tooltips everywhere (extend v3). *`motion`.*
19. **Spatial focus/zoom** — double-click a panel → cinematic zoom with adjacent context dimmed; keyboard-driven. *`motion` shared layout.*
20. **Themeable "terminal skins"** — cold-steel / midnight / amber-CRT / high-contrast + accent picker + CRT scanline shader option. *CSS + optional shader.*

## 10 Extreme New UI Features
21. **3D "Market Weather" globe/terrain** — sectors rise as heightmapped peaks by momentum, glow by volume; zoom into a peak to drill in. *`r3f` displacement shader / `deck.gl` ColumnLayer.*
22. **GPGPU particle order-flow field** — 100k+ particles stream bid↔ask by real flow; buy pressure literally flows one way. *WebGPU compute / TSL in `r3f`.*
23. **Liquid-metal volatility blob** — a per-name metaball whose viscosity/ripple = realized vol (calm=mercury, chaos=boiling). *`r3f` raymarched SDF metaballs.*
24. **Time-machine full-app replay** — one scrubber rewinds *every* widget in sync at variable speed; scrub to the open and watch the day. *central Zustand clock + snapshot ring buffer.*
25. **Spatial depth-wall (2.5D parallax)** — background indices far, focus ticker forward, mouse parallax — a command-deck with real Z. *`r3f` CSS3D / layered transforms.*
26. **Voice + NL console that BUILDS the deck** — "overlay NVDA vs semis, show vol cone" → panels assemble; a HAL-style pulsing orb listens. *Web Speech API + LLM intent router → widget composer.*
27. **Ambient tape sonification** — market as generative audio: pitch=price, pan=venue, timbre=size; a rising tape sounds brighter. *Tone.js/Web Audio (off by default).*
28. **Breadth "heartbeat" EKG** — full-width oscilloscope whose rhythm/amplitude = advancers-vs-decliners (flatline dead, racing on panic). *WebGL oscilloscope shader.*
29. **Holographic 3D vol surface** — orbit/slice/scrub a live realized-vol surface with a glowing wireframe skin (built with ZERO options data, see §2-21). *`r3f` parametric mesh + `drei`.*
30. **Generative daily "market mandala"** — EOD art encoding the session (returns/breadth/vol) into a unique, shareable poster/PNG — a viral loop. *p5.js/canvas → PNG export.*

---

# SECTION 2 — FEATURES / ANALYTICS / DATA / INTELLIGENCE

## 20 Analytics Upgrades (all from PUBLIC price data)
1. **★ "Market Constellation" force-graph** — correlation network filtered to a **Minimum Spanning Tree** (Mantegna econophysics) + Louvain community detection so sectors self-organize; drag nodes, clusters emerge. *Fixes the mid corr widget.* *`react-force-graph`/`sigma.js`, `graphology-communities-louvain`.*
2. **Clustered dendrogram + seriated correlation heatmap** — Ward/average linkage → optimal-leaf-order reorders the heatmap so block structure pops. *`ml-hclust` + `d3-hierarchy`.*
3. **Realized-vol cone** — rolling annualized RV at 10/20/60/120d as percentile bands vs horizon; current point overlaid ("is vol cheap?"). *`@visx`/`d3-shape`.*
4. **GARCH(1,1) / EWMA vol forecaster** — σ²=ω+αr²+βσ²; forward conditional-vol path vs random walk; divergence is the signal. *MLE in a Web Worker.*
5. **Monte-Carlo GBM fan + P(touch)** — 10k GBM paths → density-shaded percentile cone + probability of hitting a target. *Worker MC + canvas fan.*
6. **Return-distribution / fat-tails lab** — histogram+KDE, QQ-plot vs normal & Student-t, skew/kurtosis, Jarque-Bera. *`d3` + manual KDE.*
7. **Underwater drawdown chart** — DD from running peak, max-DD, longest underwater, recovery time, ulcer index. *`d3-area`.*
8. **Rolling Sharpe/Sortino/Ulcer ribbon** — risk-adjusted perf *through time* (63/126/252d) — exposes regime decay a headline number hides.
9. **Seasonality heatmaps** — month×year + day-of-week mean returns; opacity = t-stat significance (no false hot cells).
10. **Hurst / autocorrelation classifier** — ACF w/ bands + Hurst (R/S or DFA) + variance-ratio → per-ticker "trending vs reverting" H-score badge.
11. **RRG w/ animated tails** — proper JdK RS-Ratio × RS-Momentum, trailing tails (length=momentum, angle=velocity) + time-scrubber. *upgrades v3 RRG.*
12. **Factor/beta decomposition** — OLS of returns on SPY/sector/size(IWM−SPY)/momentum → βs, R², rolling-beta ribbons, residual alpha. *`ml-regression-multivariate-linear`.*
13. **Pairs/cointegration cockpit** — Engle-Granger residual spread, ADF stationarity, z-score ±2σ bands, OU half-life → complete stat-arb view.
14. **Rolling correlation regime + mean-ρ crisis alarm** — average pairwise ρ time series; spikes = diversification collapse (leading risk-off signal).
15. **Market-breadth internals** — %>50/200-DMA, A/D line, new-highs−lows, McClellan Oscillator; breadth-vs-price divergence early warning.
16. **Cross-sectional z-score anomaly scanner** — universe-wide peer-relative z on return/vol/volume/gap/RSI; flag |z|>3 live. *sortable heat grid.*
17. **VaR / CVaR risk panel** — historical + parametric + MC VaR, CVaR (tail mean), GARCH-filtered historical sim; tail shaded on the histogram.
18. **Realized-vol term structure** — RV at {5,10,21,63,126,252}; slope = contango/backwardation of *risk* (reads like a vol-surface slice, no options).
19. **Yield-curve animation + risk-on/off gauge** — FRED tenors animated; composite "financial conditions index" from HYG/LQD, gold/copper, SPY/TLT, realized-VIX → 0–100 dial.
20. **Regime-detection ribbon** — 2–3-state Gaussian HMM (Baum-Welch/Viterbi) on returns+vol; paint state bands under price + a transition-matrix mini-view. *HMM in a WASM/JS worker.*

## 10 Extreme New Features
21. **3D realized-vol surface** — the iconic Bloomberg surface, from ZERO options data: RV grid over (lookback × horizon), GARCH-filled forward axis, orbitable mesh. *`three.js`/`regl`.*
22. **Correlation-network contagion playback** — scrub time; the market graph physically restructures — edges thicken, clusters collapse into one blob as a crisis hits (replay 2008/2020). *`react-force-graph` tweened layouts.*
23. **Order-book depth heatmap over time (Bookmap-style)** — scrolling price×time liquidity heat + trade bubbles + wall detection + CVD. *free L2 from Binance/Coinbase/Kraken WS — the "free-tick loophole."*
24. **Footprint / volume-profile / market-profile (TPO)** — bid×ask volume per price level, POC/value-area, TPO letters. *free crypto agg-trade streams.*
25. **Time-&-sales tape + DOM ladder** — live prints w/ aggressor-side + block flags beside a live liquidity ladder. *free exchange WS.*
26. **Monte-Carlo portfolio "multiverse"** — Cholesky-correlated multi-asset GBM (10k futures), P(ruin), terminal-wealth density, GPU spaghetti-fan. *Worker MC + `regl`.*
27. **Lead-lag / Granger-causality flow map** — directed arrows of information flow (does copper lead equities? crypto lead risk?) via lagged cross-corr / Granger F-tests / transfer entropy. *directed `sigma.js` w/ particle-flow edges.*
28. **Wavelet "market DNA" scalogram** — Morlet CWT of returns → power over (time,frequency); wavelet coherence between two assets shows co-movement by cycle band. *CWT in WASM.*
29. **Cross-asset regime cockpit** — multivariate HMM across stocks/bonds/crypto/FX/commodities → one animated regime state + transition Sankey + per-class radar. *HMM worker + `d3` Sankey/radar.*
30. **Extreme-Value "Black Swan" lab** — EVT Peaks-Over-Threshold fit of a Generalized Pareto to the loss tail → shape ξ, return-level curve ("1-in-100-year day"), tail-VaR, Hill index. *GPD/Hill in a worker.*

---

## §3 — NEW FREE DATA SOURCES (the "more data" half) — ranked by wow-per-effort
Each unlocks a novel panel; all keyless unless noted.
1. **SEC XBRL `frames` API** (keyless) — one metric across *every* company for a period → instant **sector fundamental screener** (rank any sector by margin/leverage/growth, no vendor data). `data.sec.gov/api/xbrl/frames/...`
2. **DefiLlama** (keyless) — TVL/stablecoins/bridges → **DeFi risk panel** (de-peg alerts, bridge-outflow risk-off). `api.llama.fi`
3. **Senate/House Stock Watcher** (keyless JSON) — **"Congress is trading this"** leaderboard + fresh-disclosure alerts.
4. **Reddit public JSON + StockTwits** (keyless) — **WSB/social hype heatmap** (cashtag mention-velocity + bull/bear).
5. **FINRA Reg SHO short-volume files** (keyless) — **squeeze meter** (daily short-vol % per ticker).
6. **SEC EDGAR Form 4** (keyless) — **live insider cluster-buy tape.**
7. **Open-Meteo** (keyless, global) — **commodity-weather signals** (corn-belt heat, EU cold→nat-gas, Gulf hurricanes→refineries).
8. **SEC full-text search** (keyless) — **keyword filing radar** ("going concern", "material weakness", product names) across all filings.
9. **alternative.me crypto Fear&Greed** (keyless) — contrarian gauge.
10. **Wikipedia Pageviews** (keyless) — **public-attention alt-data** (view spikes front-run volume).
11. **USAspending.gov** (keyless) — **"won a federal contract"** catalyst feed.
12. **World Bank / BLS / ECB / IMF / OECD** (keyless-ish) — **global macro atlas** + CPI components + OECD leading indicators.
13. **Frankfurter FX** (keyless, full history) — clean multi-currency + FX trends.
14. **Finnhub extras (have key) + FMP free** — unified **earnings/IPO/upgrade catalyst calendar** + analyst estimates.
15. **OpenSky (flights) / AISStream (ships)** — **physical-economy alt-data** (corporate-jet M&A proxy, tanker/port congestion).
- **Honorable:** mempool.space (BTC network stress), EIA (crude inventories, key), NASA EONET + USGS (disaster/supply-shock), Blockchair (unified on-chain search).
- **Microstructure loophole:** Binance/Coinbase/Kraken **L2 + trade WebSockets** are free → power features 23–25 (impossible from equity bars).
- **Caveats:** Google Trends (pytrends) unofficial/throttled; DefiLlama yields now Pro; always send a descriptive User-Agent+email to SEC (10 req/s) & Reddit.

---

## §4 — NEW TECH STACK (to add)
`three.js` + `@react-three/fiber` + `@react-three/drei` (3D/globe/particles/vol-surface/blobs) · `deck.gl` v9 (WebGPU point clouds/minimap) · `PixiJS`/`regl` (heatmaps/tape) · `d3` + `@visx` + `ECharts` (analytics charts) · `react-force-graph`/`sigma.js` + `graphology` (networks) · `dockview` (workspace) · `motion`/`gsap` (FLIP/timelines) · `cmdk`+`Fuse.js` (palette) · `Tone.js` (sonification) · `culori` (OKLCH) · **Web Workers + optional Pyodide/WASM** (GARCH/HMM/MC/wavelet/EVT). Bundle-size discipline: lazy-load 3D/WebGL panels.

---

## §5 — SUGGESTED BUILD WAVES (each ships something visibly "wow")
- **G1 — Flagships that fix "mid":** Market Constellation force-graph (§2-1), animated treemap (§1-2), Monte-Carlo fan (§2-5), realized-vol cone + surface (§2-3, §2-21), flip-tickers (§1-1). *Immediate, visible.*
- **G2 — Microstructure:** order-book heatmap + footprint/TPO + tape/DOM from free crypto WS (§2-23/24/25, §1-16/17). *Bookmap-grade, free.*
- **G3 — Intelligence & alt-data:** Congress trades, WSB heatmap, insider tape, short-squeeze meter, filing radar, XBRL screener, commodity-weather (§3). *Wall of novel data.*
- **G4 — Quant lab:** GARCH/HMM regime ribbon, factor/beta, pairs/cointegration, drawdown/Sharpe, seasonality, anomaly scanner, VaR/CVaR, EVT Black-Swan lab, wavelet, Granger flow (§2-4..20, 27-30).
- **G5 — Over-the-top show:** 3D globe, GPGPU particles, liquid-metal blob, time-machine replay, breadth-heartbeat, sonification, generative mandala, voice console (§1-21..30).
- **Cross-cutting G0:** widget-redesign mandate (§0) + dockable workspace + design-system pass — do first so everything after looks pro.

---

## §6 — HONEST CAVEATS
- **Options IV is not free per-ticker** — every "vol" feature uses *realized* vol / VIX proxy; the 3D "vol surface" is a realized-vol surface (still striking, and honest).
- **Microstructure (order book/footprint/tape) is only free for crypto** — equities would need paid L2. We'll label these crypto-native.
- **WebGPU** (particles, deck.gl v9) isn't in every browser yet — provide WebGL fallbacks or gate behind capability check.
- **Perf:** heavy math off-thread (Workers/WASM); GPU render for high cardinality; lazy-load 3D panels; throttle live redraws.
- **Unofficial sources** (Google Trends, some scrapers) are best-effort — never core.
- **Scope is huge** — 60 features is a multi-wave program; G1 alone transforms the feel.

**STATUS: RESEARCH-GROUNDED PLAN — awaiting Dev's go + pick of which wave/features to build first.**
