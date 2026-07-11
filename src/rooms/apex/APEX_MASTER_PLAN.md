# APEX — Master Plan v1
### Intelligent Trading Command Center (stocks + crypto, paper trading)

> Room lives in `jarvis-ui` as a sibling to Helix. Boot sequence + cityscape room already built and wired into `JarvisUI.tsx` (trigger: type `apex`). This document is the plan for the **UI, Home screen, and data layer** — the current focus. Synthesized from research across 8 pro platforms (Bloomberg, Refinitiv, TradingView, thinkorswim, Koyfin, TrendSpider, Atom, IBKR, Trade Ideas), advanced dashboard UX, and the user's own 53-file quant library (~330 features total, each tagged free-tier vs. paid).

---

## 0. Vision — what APEX is

A dark, HUD/J.A.R.V.I.S.-style command center rendered on the cityscape backdrop. It fuses a **live market cockpit**, a **paper-trading + bot engine**, **PhD-grade quant analytics**, and an **embedded Jarvis AI copilot** — all fed by one server-side data layer running on **free-tier data only**. The reference mockup is the correct *style* but a *basic* starting point; this plan takes it to institutional grade.

**Design principle:** free-tier-first. Everything ships on Alpaca (equities + crypto + paper account), CCXT (crypto L2/tape), FRED (macro), SEC EDGAR (filings/insider/13F), FINRA (short interest, dark-pool aggregates), Finnhub (fundamentals/news/calendar), and self-hosted NLP. Paid-only features (real-time options tape, dealer-signed GEX, per-print dark pool, NYSE TICK, equity L2) are **built as UI with a "connect data" stub** and a later paid slot.

---

## 1. Design Language (locked from mockup + research)

**Palette** (continuous with the boot lockup — cold steel/cyan):
- Ground: `#05070d` over the cityscape photo, heavy dark overlay
- Panel fill: `rgba(8,14,26,0.72)` translucent
- Panel border: `rgba(0,180,255,0.28)` thin, with soft outer glow
- Accent: cyan `#22d3ee` / `#5ec8ff`
- Positive `#34d399`, Negative `#ef4444`, Warning `#f59e0b`
- Text: `#d8eeff` primary, `rgba(140,185,225,0.6)` muted

**Panels:** notched/beveled HUD corners (`clip-path: polygon()`), animated cyan edge-glow, small cyan icon + uppercase letter-spaced label header. Skeleton loaders, never spinners.

**Type:** clean sans (Inter/SF), **tabular-nums** for every figure, tiny uppercase labels (`.13em` tracking), category pills.

**Data viz:** radial ring gauges, thin green/red sparklines under every metric, donut allocation, canvas treemaps/heatmaps, force-directed graphs. Flash-on-update cells (green/red 300ms fade). All motion respects `prefers-reduced-motion`.

**Rendering rule:** SVG/Canvas for a handful of elements (gauges, sparklines); **WebGL for anything with thousands of cells** (treemap, order-book heatmap, correlation matrix, globe). Heavy math (correlations, backtests, Greeks) → **Web Workers**. Live updates → **throttled 250–500ms rAF-batched paints + virtualized rows** to hold 60fps.

---

## 2. Room Shell & Global Systems

**Tabs (11, from mockup — source of truth):**
`Home · Overview · Live Markets · Portfolio · Paper Trading · Backtesting · Trading Bots · Live Testing · News · Scanner · Risk`
Top-right: **Views** (saved layouts) · 🔔 notifications · ⚙️ settings · profile.

- **Home** — personalized command center (the focus of this plan).
- **Overview** — LATER: heavily customizable preset layouts, max info density, full trade module.
- **Live Markets** — quote/chart/order-book explorer.
- **Live Testing** — bots vs. live data in real time (paper).

**Where Jarvis lives in APEX:** the **AI Assistant bar, bottom-center** — "Ask anything about markets…" + mic + quick-action chips (Market Brief · Top Opportunities · Risk Scan · Portfolio Review · Strategy Plan). Same brain as the globe-room Jarvis and the Helix side-panel, room-specific skin, wired to the APEX data cache.

**Global systems (shared across all tabs):**
1. **Command palette (⌘K)** — fuzzy index of every action, ticker, panel, layout.
2. **Mnemonic command line (Bloomberg-style)** — type `AAPL CHART`, `SPY OPTIONS`, `>vol scan`; `TICKER + verb` grammar with persistent symbol context.
3. **Saved Workspaces / Views** — named layout snapshots ("Pre-Market", "Options Flow", "Earnings Night").
4. **Draggable/resizable widget grid** — 12-col bento, snap-to-cell, keyboard-accessible move mode, persisted to DB.
5. **Time-scrub / replay** — global scrubber rewinds the entire dashboard state (ring-buffer of snapshots); "LIVE" snaps back.
6. **Focus mode** — hotkey dims chrome to spotlight one decision (vignette).
7. **Market heartbeat** — ambient pulse/waveform in the shell reflecting live market tempo (EMA of tick rate; glow tied to volatility).
8. **Data freshness / connection state** — live/stale/paused, "as of HH:MM:SS", auto-reconnect w/ exponential backoff, `aria-live` status.
9. **Voice control** — Web Speech API into the same command parser.

---

## 3. The HOME Screen — full upgraded spec

Three-column command center on the cityscape. Every panel from the mockup is **upgraded** and several **new panels** added. Each panel names the data feed(s) it reads (feeds defined in §6).

### LEFT column
- **Market Pulse** (upgrade) → a real **composite regime engine**, not a static number: strength score fused from breadth + VIX percentile + put/call + Hurst + **HMM regime state**. Ring gauge + BULLISH/BEARISH/CHOP label + regime-colored background tint. Click → model breakdown. *Feeds: 1 Market, 6 Macro; local HMM/Hurst.*
- **Portfolio Snapshot** (upgrade) → live P&L scoreboard: animated equity curve, allocation donut, buying power, **+ risk overlay chips** (VaR 95, portfolio beta, concentration). Per-position rows flash/reorder on tick. *Feeds: 8 Account, 1 Market.*
- **Bot Status** (upgrade) → live bot telemetry: connected/active/success + per-bot equity sparkline, win rate, drawdown, and a **battle leaderboard**. *Feeds: bots, 8 Account.*

### CENTER column
- **Market Overview** (upgrade) → geographic market map with live index nodes, indices (S&P/NASDAQ/DOW) with sparklines + after-hours, VIX, market cap, 24h volume, **BTC dominance** (crypto in scope), **Fear & Greed composite gauge** (7 sub-signals), market status w/ countdown. Ambient **heartbeat** overlay. *Feeds: 1 Market, 6 Macro; crypto via Alpaca/CCXT.*
- **Quick-action launcher** (keep) → Paper Trading · Backtesting · Portfolio · Deploy Bot · Live Testing tiles.
- **AI Assistant bar** (upgrade) → Jarvis copilot: **NL query that drives the panels** ("show tech names down >3% w/ unusual volume" → applies filters), **agentic actions** (create alert / add watch / schedule brief with a confirm chip), **streaming answer + tool-call trace**, voice. Quick chips. *Feeds: all, via cache.*

### RIGHT column
- **Market News** (upgrade) → **sentiment-scored, ticker-linked**, deduped, category-filterable headlines; per-item NLP polarity; click → drawer. *Feeds: 2 News; local FinBERT/VADER.*
- **AI Insights** (upgrade) → real Jarvis-generated market brief **grounded in the data cache with citations back to panels** + confidence gauge; Market Outlook / Key Opportunity / Risk Watch. *Feeds: Jarvis over 1–7.*
- **Alerts & Actions** (upgrade) → real **alert engine**: price / indicator / news / filing / economic-event triggers, inbox rail with typed chips + countdowns, position-linked (FYI-style). *Feeds: alert engine over 1,2,4,7.*

### NEW Home panels (added beyond the mockup)
- **Sector Rotation strip** → RRG-style quadrant (Leading/Weakening/Lagging/Improving) with trajectory tails. *Feeds: 1 Market.*
- **Market Internals** → A-D line, McClellan, %>200MA, new highs/lows breadth gauges. *Feeds: 1 Market (constituents).*
- **Unusual Activity** → volume/options anomaly scanner (Sizzle-style) surfacing "something's happening here." *Feeds: 1 Market (+ options where free).*

---

## 4. The 15 HUGE UPGRADES (to the basic mockup)

1. **Live everything** — WS-driven flash-on-update cells + real tick-by-tick sparklines (mockup is static).
2. **Market Pulse → regime engine** (HMM + VIX percentile + breadth + Hurst), clickable model.
3. **Market Overview → live geo map + heartbeat + Fear&Greed composite + crypto (BTC dominance)**.
4. **Portfolio → live P&L scoreboard** w/ animated equity curve, per-position flash/reorder, risk overlay.
5. **Bot Status → live telemetry + battle leaderboard**.
6. **News → sentiment-scored, ticker-linked, filterable, drawer detail**.
7. **AI Insights → grounded Jarvis brief with citations + confidence**.
8. **Alerts → real multi-trigger alert engine + inbox rail + countdowns**.
9. **AI bar → NL-drives-panels + agentic actions + streaming tool-trace + voice**.
10. **Views → real saved workspace snapshots**.
11. **Draggable/resizable widget grid** with persistence.
12. **Command palette (⌘K) + Bloomberg mnemonic command line**.
13. **Data freshness / connection state everywhere**.
14. **Real HUD radial gauges** (threshold zones, animated needles, glow) for all bounded metrics.
15. **Focus mode + global time-scrub replay**.

---

## 5. The 15 NEW FEATURES (curated best of ~330; free-tier-first)

1. **Market Regime Detector** — HMM + VIX percentile + trend/chop (ADX/Efficiency Ratio); drives strategy routing. *Free.*
2. **Sector Rotation RRG quadrant** — leading/weakening/lagging/improving with tails. *Free.*
3. **Treemap Market Heatmap** — canvas, sector-grouped, size = cap, color = %; drill-down. *Free.*
4. **Correlation Matrix + Force-Directed Correlation Network (MST)** — diversification-breakdown warning, sector clusters, hub/contagion nodes. *Free.*
5. **Order-Book Depth Heatmap / Liquidity Map** — time-scrolling L2 heatmap. *Free (crypto via CCXT), paid (equities L2).*
6. **Options Analytics Suite** — payoff-curve builder (multi-leg), **probability cone**, Greeks gauges, **IV Rank/Percentile**, skew, term structure. Black-Scholes engine → free-computable. *Free / partial.*
7. **GEX / Gamma Wall panel** — strike-ladder gamma histogram + **zero-gamma flip line** + vanna/charm. *Free approximation from delayed chains; real-time signed = paid.*
8. **Unusual Activity / Sizzle Scanner** — volume-vs-norm anomaly detection. *Free.*
9. **Smart-Money Tracker** — insider **cluster buys** (Form 4 code P), **13F** change waterfall, **short-interest squeeze score**, **DIX** dark-pool proxy. *Free (SEC EDGAR + FINRA, with lag); real-time = paid.*
10. **No-Code Backtester (OddsMaker-style)** — visual rule builder, equity curve, profit factor/win%/max-DD, **walk-forward + Deflated Sharpe overfitting guard**, transaction-cost realism. *Free.*
11. **Seasonality & Statistical-Edge Scanner** — month×year hit-rate heatmap + conditional-setup expectancy w/ t-stat + **Hurst** MR/momentum classifier. *Free.*
12. **Sentiment Engine** — news FinBERT/VADER + **social velocity** (2nd-derivative buzz) + put/call + **34-dim emotion radar** (MarketPsych-style, scaled). *Free / partial.*
13. **Economic Calendar + Fed-NLP + Expected-Move** — release schedule w/ surprise %, Fed-speak sentiment gauge, earnings expected-move flags on positions. *Free.*
14. **Risk Dashboard** — VaR/CVaR (hist/parametric/MC), **Monte Carlo fan chart**, drawdown/underwater, Sharpe/Sortino/Calmar, **Kelly sizing**, concentration heatmap, **stress-scenario tornado** (2008/COVID/2022/hypothetical shocks). *Free.*
15. **3D Market Globe hero + Stock Races** — Three.js globe (reuse existing globe stack) w/ live event arcs/bloom; animated %-change bar-race. *Free (decorative).*

*(Signature "wow" interactive widgets to prioritize for the HUD look: probability-distribution drag (IBKR Probability Lab), payoff curve, GEX strike ladder, order-book heatmap, correlation network, treemap, sector-rotation RRG, market heartbeat.)*

---

## 5b. UI v2 — advanced features (mockup: apex-home-v2)

The basic mockup was leveled up. **10 new UI features + 10 advanced upgrades**, all in the HUD language.

**10 NEW UI features (shell + global):**
1. **⌘K Command Palette** — fuzzy overlay indexing tickers, actions, panels, tools; arrow/enter nav.
2. **Bloomberg mnemonic command line** — `TICKER + verb` grammar in the Jarvis bar (`NVDA CHART`, `>vol scan`).
3. **Ticker tape marquee** — infinite scroll, flash-on-tick, tabular-nums.
4. **Symbol detail drawer** — click any ticker anywhere → slide-in drawer: chart + key stats + options snapshot (max pain, GEX flip, put/call, skew). Symbol-linking across panels.
5. **Sector Heatmap treemap** — canvas, size=weight, color=%.
6. **Correlation Web** — force-directed node graph (edge = correlation, red = negative).
7. **Order-Book Depth heatmap** — live crypto liquidity map (CCXT free).
8. **Focus mode** — double-click a panel → spotlight, dim rest (ESC exits).
9. **Toast notifications** — alerts fire live as toasts, feed the alert rail.
10. **Time-scrub replay bar** — global scrubber rewinds dashboard state; LIVE snaps back.

**10 advanced UPGRADES (to existing panels):**
1. Market Pulse → hoverable HMM regime path + probability.
2. Portfolio → live-streaming P&L flash + clickable risk chips (VaR→Monte Carlo, β→downside β, concentration guardrail).
3. Market Overview map → animated trade-flow arcs between nodes.
4. Fear & Greed → click reveals 7 sub-component breakdown.
5. News → NLP emotion tooltip per item + sentiment filter tabs (All/Bullish/Bearish/My Tickers).
6. AI Insights → hovering a citation `[n]` highlights the exact source panel (pulse).
7. Alerts → live-firing engine with countdowns, new alerts slide in.
8. Sector Rotation → animated moving RRG tails.
9. Unusual Activity → live-streaming rows push in with flash.
10. Jarvis bar → mode switcher + streaming typewriter response + tool-trace + slash commands.

**Jarvis in APEX — modes + expanded services (the copilot upgrade):**
Jarvis gains **4 room modes** (accent-colored), each with its own chips, placeholder, tool bias, and system instruction:
- **Analyst** (default, cyan) — briefs, "why is X up?", grounded market read.
- **Trader** (green) — paper order entry, stops, brackets, close — always staged for confirmation.
- **Quant** (purple) — backtests, VaR/Monte Carlo, correlation, regime, Kelly sizing.
- **Research** (amber) — deep-dive fundamentals, 13F/insider, filings, sector theses.

Expanded services Jarvis offers in-room: NL-query-drives-panels, agentic actions (create alert / add watch / deploy bot / schedule brief — each with a confirm chip), grounded briefs with citations back to panels, inline "why?" explanations, streaming tool-trace, voice. This is the "another mode / expand our services" the room needed.

---

## 5c. Integration Architecture — VERIFIED (how to build without breaking anything)

Mapped directly from the live codebase (Kalshi + Helix as templates). This is the load-bearing "don't break it" reference; the full non-negotiables live in **`APEX_BUILD_RULES.md`** (companion doc) and the `apex-build-rules` memory.

**Data ingestion — multi-adapter (NOT a single Kalshi-style provider).** APEX pulls from many free providers, so instead of one `apex-provider.js` it uses an ingestion layer of small adapters (`server/providers/apex/alpaca.js`, `ccxt.js`, `fred.js`, `edgar.js`, `finra.js`, `finnhub.js`) all built on the `createXyzProvider({getSettings, fetchImpl})` factory + `provider-utils` (`errorWithStatus`, `cleanString`, `fetchJson` 15s timeout, `writeJsonAtomic`). Alpaca auth = API key/secret headers (not Kalshi's RSA-PSS). Secrets (`alpacaKeyId`, `alpacaSecret`, `finnhubKey`, `fredKey`) go in `secret-store.js` `SECRET_FIELDS`, resolved env→settings→"", never exposed to the client.

**Routes** — if-blocks in `server.js`, exact-before-pattern, guard `if (!apexDb) return 503`, `sendJson`/`parseRequestData` helpers, `crypto.randomUUID()` IDs, `isoNow()` timestamps. `/api/apex/*` per §8.

**WebSocket** — `new WebSocketServer({ noServer:true })` for `/api/apex/ws`, bidirectional relay to Alpaca/CCXT upstreams, added to `server.on("upgrade")`. Keys stay server-side.

**DB** — `server/apex-db.js` via `createApexDb(runtimeDir)` → `runtime/apex.sqlite`, mirroring `helix-db.js`: `pragma journal_mode=WAL; foreign_keys=ON`, `CREATE TABLE IF NOT EXISTS`, prepared `stmts`, `db.transaction()` for multi-step writes, `safeDbJson()` on every JSON read, idempotent `try/catch ALTER` migrations. Schema per §7. Shadow-write notable signals to Neural Vault via the bridge.

**Jarvis tools + APEX mode** — add APEX tools with the 3-step in `capability-engine.js` (definitions ~171 / declarations ~288 / handlers ~1425), `apex_` prefix, risk levels observe/prepare/execute/**commit** (commit = trades, `confirmationRequired:true`). Add `mode:"apex"` in `agent-runtime.js` classify + a `brainSystemInstruction()` case; the ApexRoom Jarvis bar sends `{prompt, mode:"apex"}` to `/api/chat/stream` with a room-context prefix (Helix's `JarvisPanel` pattern). **Never hardcode Gemini model names — use `settings`/`selectModel`.**

**Bots (LATER — strict pattern locked).** APEX paper bots follow the file-agent convention: `runtime/neural_vault/agents/definitions/apex-*.js` exporting `{meta, triggers, permissions, character, behavior, steps}`, auto-discovered by `agent-loader.js`, executed via mission-engine, gated by autonomy-policy. **Non-negotiable: any bot that trades is `permissions.readOnly:true`, runs at autonomy `prepare`, builds an order template, and waits for explicit user approval before any `execute`/`commit` tool. Bots never guess — every claim needs a tool receipt.** Full spec in `APEX_BUILD_RULES.md`. Do NOT build bots until the data layer + Home ship.

---

## 6. Data Architecture — 8 feeds, free-tier

All feeds flow through **one always-on ingestion layer in the existing `server.js` (:8799)** — never the browser (keys stay server-side; avoids CORS + rate limits). New `apex.sqlite`.

```
External APIs ──▶ APEX ingestion (server.js, :8799)
  Provider adapters (one file each, keys server-side):
    alpaca · alpaca-crypto · ccxt · finnhub · fred · edgar · finra · stocktwits · reddit · gdelt
        │  NORMALIZER → one internal shape per data type
        ▼
  3 CACHE TIERS
    HOT  (in-memory)     live WS: quotes, trades, bars, news, crypto L2
    WARM (apex.sqlite+TTL) social, fundamentals, filings, macro, sentiment
    COLD (apex.sqlite)   historical bars, event calendars, factor series
        │  SCHEDULER: staggered pollers, each sized to its rate limit
        ▼
  API SURFACE
    REST  /api/apex/*     (room + bots pull normalized data)
    WS    /ws/apex        (relay live ticks to browser — no creds out)
        │
   Room widgets   ·   Paper bots   ·   Jarvis/Helix bridge
```

**The 8 feeds and their FREE providers:**

| # | Feed | Contents | Free provider(s) | Latency |
|---|------|----------|------------------|---------|
| 1 | **Market Data** | quotes, trades, OHLCV bars, VWAP, day range; **crypto L2/tape** | **Alpaca** (equities IEX WS + paper), **Alpaca Crypto** / **CCXT** (crypto WS, full L2) | real-time WS |
| 2 | **News** | headlines, ticker-tagged, sentiment | **Alpaca News** WS (Benzinga), Finnhub, **GDELT** (no key, 15-min) | real-time / 15m |
| 3 | **Fundamentals & Filings** | financials, earnings, ratings, 10-K/Q/8-K | **Finnhub** (60/min), **SEC EDGAR** (10/s, XBRL) | daily / on-demand |
| 4 | **Alt / Hidden** | insider Form 4, 13F, short interest, DIX proxy | **SEC EDGAR** (Form 4, 13F), **FINRA** (short int. + ATS dark-pool aggregates) | daily / lagged |
| 5 | **Social Sentiment** | Reddit/StockTwits buzz + velocity, NLP polarity | **StockTwits**, **Reddit API**, self-hosted **FinBERT/VADER** | poll (min) |
| 6 | **Macro** | rates, CPI, yields, DXY, VIX + term structure | **FRED** (120/min), **CBOE** (VIX, put/call — free) | daily / real-time |
| 7 | **Events Calendar** | earnings + expected move, ex-div, econ releases, IPOs | **Finnhub** | daily |
| 8 | **Account/Execution** | positions, orders, fills, P&L, buying power | **Alpaca paper** account API | real-time |

Plus **Kenneth French Data Library** (free) for factor return series (feeds factor-exposure analytics).

**Binding constraint = rate limits.** One server-side fetch fans out to all consumers; WS where it exists (Alpaca market+news, CCXT crypto); staggered poll + TTL cache for metered REST (social ~1min, fundamentals hours, filings daily). Web Workers for correlation/backtest/Greeks math.

**Honest free-tier gaps** (build UI, stub data, paid slot later): real-time **unusual options flow**, **dealer-signed GEX/vanna/charm** (compute approximation from free delayed chains instead), **per-print dark pool** & real-time **NYSE TICK**, real-time **borrow fees**, equity **Level 2** (crypto L2 is free via CCXT).

---

## 7. Database Design — `apex.sqlite` (WAL mode)

```sql
-- Reference
apex_universe        (ticker PK, name, asset_class, sector, industry, exchange, is_crypto, updated_at)

-- Market data
apex_bars            (id, ticker, tf, t, o, h, l, c, v, vwap)             -- historical OHLCV (COLD)
apex_quotes_live     (ticker PK, bid, ask, bid_sz, ask_sz, last, day_o, day_h, day_l, prev_c, vol, ts)  -- hot mirror

-- News & sentiment
apex_news            (id, ts, ticker, headline, source, url, category, sentiment, summary)
apex_social          (id, ts, ticker, source, mentions, bull_ratio, velocity, sentiment)

-- Fundamentals & filings
apex_fundamentals    (ticker PK, mktcap, pe, eps, revenue, margins_json, ratios_json, updated_at)
apex_filings         (id, ticker, form_type, filed_at, url, summary, parsed_json)   -- 10-K/Q/8-K/Form4/13F
apex_insider         (id, ticker, insider, role, code, shares, price, value, filed_at, cluster_id)
apex_short_interest  (ticker, si_pct_float, days_to_cover, settle_date, source)

-- Macro & events
apex_macro           (series_id, t, value)                                -- FRED series
apex_events          (id, ticker, type, scheduled_at, consensus, prior, actual, expected_move, impact)

-- Analytics cache (computed, TTL)
apex_regime          (scope, ts, regime, prob_json, vix_pct, hurst)
apex_correlations    (window, computed_at, matrix_json)
apex_gex             (ticker, expiry, computed_at, flip_level, ladder_json)   -- from free chains
apex_iv              (ticker, computed_at, iv_rank, iv_pct, skew, term_json)

-- Account (paper) — mostly live from Alpaca; local mirror for history/analytics
apex_positions       (id, ticker, qty, avg_price, side, opened_at)         -- snapshot/history
apex_orders          (id, ticker, side, type, qty, price, status, algo, created_at, filled_at)
apex_fills           (id, order_id, ticker, qty, price, ts)
apex_equity_curve    (ts, equity, cash, buying_power, unrealized, realized)

-- Bots & backtests
apex_bots            (id, name, strategy, status, config_json, created_at)
apex_bot_trades      (id, bot_id, ticker, side, qty, price, pnl, ts)
apex_backtests       (id, name, rules_json, range, metrics_json, equity_json, deflated_sharpe, created_at)

-- Alerts & UI
apex_alerts          (id, name, type, condition_json, ticker, status, last_fired, created_at)
apex_workspaces      (id, name, layout_json, is_default, created_at)       -- saved Views
apex_watchlists      (id, name, tickers_json, created_at)
```

---

## 8. Backend API Surface (new routes on :8799)

```
GET  /api/apex/quote/:ticker            GET  /api/apex/bars/:ticker?tf=&range=
GET  /api/apex/news?tickers=            GET  /api/apex/overview        (indices, cap, vix, fear&greed)
GET  /api/apex/regime                   GET  /api/apex/heatmap?group=sector
GET  /api/apex/correlations?window=     GET  /api/apex/rotation
GET  /api/apex/fundamentals/:ticker     GET  /api/apex/filings/:ticker
GET  /api/apex/insider?cluster=1        GET  /api/apex/13f/:ticker      GET /api/apex/short/:ticker
GET  /api/apex/options/:ticker          GET  /api/apex/gex/:ticker      GET /api/apex/iv/:ticker
GET  /api/apex/macro?series=            GET  /api/apex/calendar
GET  /api/apex/account                  GET  /api/apex/positions        GET /api/apex/equity-curve
POST /api/apex/order  (paper)           POST /api/apex/backtest         GET /api/apex/backtest/:id
GET/POST /api/apex/bots                 GET/POST /api/apex/alerts
GET/POST /api/apex/workspaces           GET/POST /api/apex/watchlists
POST /api/apex/ask   (Jarvis NL → filter spec / agentic action)
WS   /ws/apex        (subscribe tickers → live quotes/trades/news/crypto-L2)
```

---

## 9. APEX ↔ Helix ↔ Jarvis workflow

- **APEX → Helix:** any signal (news item, unusual filing, insider cluster, sentiment spike, regime flip) pushes into Helix's **Signal strand** (`helix_signals`) as evidence Helix reasons over. APEX is a *source*; Helix is the reasoning chamber.
- **Jarvis → APEX:** Jarvis queries the APEX cache via `/api/apex/*` (a tool over the same endpoints) — "what's NVDA doing", "any insider buys this week", "brief me on tech".
- **APEX → Jarvis:** alerts (price/sentiment/filing/event) surface through Jarvis's existing notification path.
- **Jarvis is one brain, three skins:** globe (main room), side-panel (Helix), bottom command bar (APEX).

---

## 10. Full Feature Catalog (for later tabs) — categorized, free/paid

*Curated Home/UI set is §3–5. This is the deferred backlog for the other 10 tabs, from the ~330 researched. `F` = free-tier, `P` = needs-paid data, `~` = partial/approximation.*

**Charting (Live Markets / Charts tab):** streaming candlesticks `F` · multi-chart synced grid `F` · **bar replay** `F` · drawing tools + **drawing-based alerts** `F` · **auto-trendline detection** `F` · **S/R confluence heatmap** `F` · auto-Fibonacci `F` · multi-timeframe overlay (MTFA) `F` · Picture-in-Picture `F` · candlestick pattern recognition `F` · **raindrop charts** `P` · volume profile / VPOC / value area `~` · footprint / cluster charts `P` (crypto `F`) · overlay engine (VWAP/bands/etc.) `F`.

**Scanner tab:** multi-filter screener `F` · **NL/agentic scanner** `~` · Sizzle unusual-options scan `~` · preset "Channel Bar" workspaces `F` · streaming alert-window `~` · stock races / heatmap `F`.

**Options (Options tab):** options chain + Greeks `~` · **Analyze-tab payoff curve** `F` · **probability cone** `F` · **IV rank/percentile** `F` · **IV surface (3D)** `~` · vol term structure `F` · put/call skew `F` · **GEX / vanna / charm / max-pain** `~` · Probability Lab (drag distribution) `~` · Volatility Lab (IV/HV/peer) `~` · Option Strategy Lab (view→strategy) `~` · variance/vol swaps, dispersion, gamma-scalping P&L `~` · vol models (Heston/SABR/rough-vol/Dupire) `F` (compute).

**Microstructure (Live Markets):** order-book depth heatmap `F`(crypto)/`P`(eq) · OFI `F`(crypto) · CVD `F`(crypto) · bid/ask pressure & absorption `F`(crypto) · Kyle's lambda `~` · VPIN toxicity `~` · micro-price / order-book imbalance `F`(crypto) · effective/quoted spread `~` · DOM/BookTrader ladder `F`(L1)/`P`(L2).

**Quant analytics (Risk / Backtesting):** HMM/GARCH/ADX **regime detection** `F` · Kalman state estimation `F` · **cointegration + pairs z-score** `F` · Hurst/half-life `F` · **factor exposure (Fama-French + Ken French)** `F` · rolling/downside beta `F` · **correlation matrix + MST network** `F` · **VaR/CVaR + Monte Carlo** `F` · Sharpe/Sortino/Calmar/Information ratio `F` · **Deflated/Probabilistic Sharpe (overfit guard)** `F` · drawdown/underwater `F` · **Kelly sizing** `F` · **stress/scenario shocks** `F` · seasonality `F` · statistical-edge scanner `F`.

**Portfolio (Portfolio tab):** live P&L scoreboard `F` · allocation donut/sunburst `F` · **efficient frontier / CML** `F` · **risk parity / HRP** `F` · **Black-Litterman (views)** `F` · min-variance `F` · Portfolio Builder (factor rank + optimizer + rebalance) `~` · concentration & Greeks aggregation `F` · attribution waterfall `F`.

**Breadth/internals (Home/Overview):** A-D line `F` · McClellan osc + summation `F` · %>50/200MA `F` · new highs/lows + instability flag `F` · NYSE TICK `P`.

**Sentiment/alt-data (News / Home):** news NLP (FinBERT) `~` · social velocity `~` · put/call `F` · **Fear & Greed composite** `F` · 34-dim emotion radar `~` · **insider cluster buys** `F` · **13F change tracker** `F` · **short-interest squeeze score** `~` · **DIX dark-pool proxy** `~` · unusual options flow `P` · smart-money-vs-retail `~`.

**Execution/bots (Paper Trading / Trading Bots / Live Testing):** paper order entry `F` · **Chart Trader (drag-to-order)** `F` · TWAP/VWAP/Adaptive algo fills (simulated) `F` · implementation shortfall / TCA `~` · **no-code backtester + OddsMaker** `F` · **Holly-style AI signals** `~` · **bot battle mode + leaderboard** `F` · 8 paper bots (momentum, mean-reversion, sentiment, pairs, breakout, scalper, trend, volatility).

**Research/AI (global):** NL data querying `F` · grounded AI brief w/ citations `F` · inline "why?" explanations `F` · agentic actions `F` · streaming tool-trace `F` · **X-Ray filing/transcript search** `~`(EDGAR `F`) · financial-model sandbox `P` · in-app scripting console `F` · supply-chain graph `P`.

**Fixed income / advanced (later):** yield analytics `P` · StarMine SmartEstimates `P` · MarketPsych model `P`.

---

## 11. Build Roadmap (waves)

- **Wave 0 — DONE:** boot sequence + cityscape room, wired into `JarvisUI.tsx` (`apex` trigger).
- **Wave 1 — Data layer:** provider adapters (Alpaca, CCXT, FRED, EDGAR, FINRA, Finnhub), normalizer, `apex.sqlite`, cache tiers, scheduler, `/api/apex/*` + `/ws/apex`. Feeds 1, 2, 8 first (market, news, account).
- **Wave 2 — Home shell:** design tokens, panel component (notched HUD), tab bar, widget grid, workspaces, command palette + mnemonic bar, freshness/heartbeat, Jarvis AI bar.
- **Wave 3 — Home panels:** upgraded Market Pulse (regime), Market Overview (map + Fear&Greed + crypto), Portfolio scoreboard, Bot Status, News (sentiment), AI Insights, Alerts engine + new panels (rotation, internals, unusual activity).
- **Wave 4 — Analytics core:** regime engine, heatmap, correlation matrix/network, options suite + IV/GEX, risk dashboard, sentiment engine, seasonality (Web Workers).
- **Wave 5 — Trade + bots:** paper order flow, backtester, 8 bots, live testing, battle mode.
- **Wave 6 — Helix/Jarvis bridge + other tabs** (Live Markets, Scanner, Options, Overview power layouts).

---

## 12. Sources (research provenance)

Bloomberg/Refinitiv, TradingView/thinkorswim (Pine/thinkScript, replay, heatmaps, analyze tab, DOM, Sizzle), Koyfin/TrendSpider/Atom (macro dashboards, auto-TA, raindrop, confluence, backtester, model sandbox), IBKR/Trade Ideas (Mosaic, Probability/Vol/Strategy Labs, algos, BookTrader, Holly, OddsMaker), advanced dashboard UX (command palette, widget grid, treemap, RRG, Sankey, network graph, heartbeat, time-scrub, voice, spatial depth), GEX/dark-pool tooling (SpotGamma, Unusual Whales, QuantData), and the user's 53-file quant library (microstructure, regime, stat-arb, options/vol models, factor, portfolio optimization, risk, backtesting, free-data stack). Free-data providers confirmed across streams: Alpaca, CCXT, FRED, SEC EDGAR, FINRA, Finnhub, CBOE, GDELT, StockTwits/Reddit, Kenneth French.
