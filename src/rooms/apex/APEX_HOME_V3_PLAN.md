# APEX Home v3 — "Command Deck" Upgrade Plan

Goal: take the Home screen from *a set of live panels* to a **cohesive, interactive intelligence terminal** — every element clickable and cross-linked, generated briefings, a deep stock dossier, a real quant layer, and a motion/HCI pass that makes it feel 10× more advanced and smooth.

Grounding rule: **every feature below is built on data we already have live** unless explicitly tagged `[NEW DEP]` (a library to add) or `[PAID]` (needs a paid feed — we stub/label it). No fake data. What we can't source real, we badge honestly (as we did with Portfolio/Bots "Demo").

Our live data assets (the raw material):
- Quotes/indices (Yahoo + Finnhub), crypto (Coinbase/Binance + CoinGecko global)
- History bars (Yahoo, Tiingo 30yr, **local `bt_cleaned_all_stocks.csv` = 231k daily bars w/ RV30/60, IV30 put+call, PutVol/CallVol, PC_OI, SPX, VIX since 2010**)
- Regime + breadth (advancers/decliners) + Fear&Greed (computed)
- 12 movers (stocks + crypto), sector-ETF changes
- News (Finnhub company + GDELT, ticker-tagged, sentiment), insider (Finnhub), macro (FRED)
- Fundamentals (Alpha Vantage), order book (Binance)
- Jarvis tools: `apex_market_snapshot`, `apex_ticker_report`, `apex_news`, `apex_catalog_search`, health bot

---

## Pillar 1 — The Briefing System (generated intelligence)

The single biggest "wow": APEX *tells you the story of the day*, cited to live data.

- **Morning Brief card** (pre-open / on first open of the day): overnight crypto + futures proxy, yesterday's US close recap, today's macro calendar (FRED releases), pre-market movers, top overnight news by impact, current regime read, and **"3 things to watch."** Rendered as a rich card, narrated by Jarvis via `apex_market_snapshot`.
- **Session Summary strip** (always-on, top of Overview): `Yesterday close 7,499 → Today open 7,485 (gap −0.19%) · Range 7,470–7,495 · now 7,482 (−0.22%)`. Computed from daily bars (prev-close = last completed daily bar; open/high/low = today's bar). Per index + a mini intraday spark with **prev-close and open reference lines**.
- **EOD Wrap card** (after close): what moved and why, sector winners/losers, final breadth, notable insider/news, tomorrow's setup (earnings + macro).
- **"Brief me" → structured card** (not just chat text): the Analyst chip returns a **BriefCard** component with sections + `[n]` citations that highlight the source panel (we already have `highlightPanel`). 
- **Delta digest — "Since you were away":** on return, a small card: "3 new high-impact stories, NVDA −2.1%, regime shifted NEUTRAL→RISK-OFF." Diffs a snapshot saved to localStorage.

## Pillar 2 — Ticker Dossier (click any ticker → deep briefing)

Replace the current drawer with a **full slide-over dossier**. The rule: **any ticker, anywhere (tape, movers, news, insider, heatmap) → opens the dossier.** Keyboard `←/→` cycles tickers, `Esc` closes, `f` focuses chart.

Sections:
- **Header:** price, change, **day-range bar** (low ─●─ high with prev-close + open ticks), **52-week position bar**, gap %, market-cap, session state.
- **Pro chart** `[NEW DEP: lightweight-charts (Apache-2.0)]`: candlesticks + volume, timeframe switch (1D/5D/1M/6M/1Y/5Y/MAX), MAs (20/50/200), crosshair readout. Data from Yahoo intraday + Tiingo/local daily (we have 231k bars). Optional: RV30/IV30 overlay from the local CSV.
- **Why it's moving:** one-liner from `apex_ticker_report` (news impact + movers + insider) — Jarvis-generated, cited.
- **Key stats grid:** P/E, EPS, beta, div yield, 52w hi/lo, avg vol, market cap (Alpha).
- **News timeline:** the ticker's Finnhub company news, chronological, sentiment-colored.
- **Insider table:** real transactions (name, buy/sell, shares, price, date) with buy/sell totals.
- **Vol & options context** (from local CSV history, labeled "historical"): IV30 put/call, RV30 vs IV (vol-risk-premium), put/call ratio trend. Live options flow = `[PAID]` (stub).
- **Peers / sector strip:** sector + comparable tickers with mini-changes.
- **Actions row:** ★ watchlist · 🔔 set alert · ▨ paper-trade (stub until engine) · ✦ "Ask Jarvis about {ticker}" (pipes to Jarvis with context).

## Pillar 3 — News Flow 2.0

- **Live river** with new items animating in (staggered), **clustered** (we already cluster server-side), each showing: impact badge (ticker + ↑/↓), sentiment stripe, **source-credibility pill**, lane tag, corroboration count.
- **Sort modes:** Impact (default) / Latest / Watchlist-only — impact uses our rank.
- **"Why it matters"** expandable micro-summary per cluster (hover or click).
- **Lane filter chips:** Macro · Finance · Commodities · Crypto · Geopolitics · Weather (+ Insider, +Econ).
- **Breaking pin:** high-rank items pin with a subtle pulse; decay animates them down.
- **Sentiment-of-the-day sparkline:** aggregate news sentiment over the session.
- **Econ calendar lane:** FRED releases as forward-looking items.
- **Hover preview card:** headline → expanded card (summary, affected tickers, source, published time). Click ticker → dossier.

## Pillar 4 — Jarvis Modes 2.0

Each mode reshapes the deck, biases tools, and returns richer output.

- **Mode-aware layout presets** — switching mode re-arranges panels (Analyst=briefings/regime/rotation; Trader=movers/orderbook/levels/alerts; Quant=correlation/vol/breadth/backtest; Research=dossier/filings/news/fundamentals).
- **Rich response cards** — Jarvis returns typed cards (BriefCard, TickerCard, CompareTable, AlertCard), not just text. NL-drives-panels ("show me energy" filters movers/news/heatmap to energy).
- **Live tool-trace** — show the tool calls as they run (`apex_market_snapshot → apex_news → …`) with timing.
- **Mode-specific chips + system prompts** (we have the scaffold; deepen each with real tool bias + persona).
- **Agentic confirm chips** — "Set alert NVDA < $200?" → confirm inline.
- Voice stays **OFF** unless explicitly enabled.

## Pillar 5 — UI / HCI / Motion (the "10× smoother" layer)

- **Design-system pass:** refined token set (spacing/type/radius scale), consistent notched-glass panels, semantic color separate from accent, tabular-nums everywhere numbers align.
- **Motion system:** spring easings, staggered panel reveals on load, value **flash + number-roll** on tick, skeleton loaders (no blank states), panel focus glow, drawer/river slide springs — all `prefers-reduced-motion` aware.
- **Density control:** Comfortable / Compact / Dense (padding + font scale) in the Views menu.
- **Theme system:** Cold-Steel (default), Midnight, High-Contrast, + accent picker; persisted.
- **Command Palette 2.0 (⌘K):** fuzzy search across tickers, panels, actions, Jarvis prompts, recent; grouped results; inline preview; "→ open dossier / run brief / go to panel."
- **Layout engine:** drag **+ resize** panels, snap grid, per-view saved layouts (extend existing Views), "reset layout."
- **Keyboard-first:** global hotkeys (`/` search, `g h` home, `j/k` nav panels, `t` trade, `a` alert, `b` brief, `?` cheatsheet), visible focus rings.
- **Explain-everything tooltips:** every metric hoverable with a plain-English definition + how it's computed (great for HCI/learning).
- **Responsive reflow** + polished empty/loading/error states.

## Pillar 6 — New Data Widgets (real, grounded)

Replace the remaining demo canvases with **real** computed widgets, plus new ones:

- **Correlation matrix (REAL)** — compute pairwise correlation of watchlist from daily bars (we have history) → heat-grid. Replaces the fake Correlation Web.
- **Sector Rotation RRG (REAL)** — relative-strength vs momentum of the 11 sector ETFs from their bars. Replaces the demo RRG.
- **Vol / IV-RV widget (REAL, historical)** — from the local CSV's RV30/60 + IV30 put/call: term structure, vol-risk-premium, put/call ratio. Honest "historical/seed" label; live options = `[PAID]`.
- **Breadth internals+** — advancers/decliners (have) + new-highs/lows + up/down count via TV scanner counts.
- **Macro rail** — yield curve (FRED DGS1..DGS30), rate + CPI + unemployment trend sparks.
- **Crypto dominance donut** — BTC/ETH/alt from CoinGecko global.
- **Watchlist heat-treemap** — tiles by market cap, colored by day change (real).
- **Global markets clock** — session open/close status for NYSE/LSE/TSE/crypto-24h.
- **Earnings calendar** — Finnhub earnings calendar (free tier) for watchlist.
- **Economic calendar** — FRED release schedule.

## Pillar 7 — Personalization & Real Alerts

- **Watchlists (CRUD)** — multiple named watchlists (replace the fixed set); drive quotes/news/movers/dossier. Persisted; syncs the backend watchlist used by pollers.
- **Real alert engine** — user-set rules (price cross, % move, new insider, news-impact on a ticker, regime change) evaluated against the live poll → **real toasts** (we removed the fake ones; these are genuine, user-created). An Alerts manager panel.
- **Smart persistence** — remember layout, mode, density, theme, watchlist, last view.
- **Proactive (grounded) nudges** — Jarvis surfaces a real, cited nudge ("NVDA: insider sell + −3% + 2 bearish stories") — only when data supports it, never fabricated.

---

## Build Roadmap (phased, each phase ships something usable)

**Phase A — Interactivity spine + polish foundation** *(biggest perceived jump, no new deps)*
- Design tokens + motion system + density + theme; value-flash/number-roll; skeletons.
- **Click-any-ticker-anywhere → dossier**; cross-panel linking (click sector → filter movers/news; click mover → dossier).
- Explain-everything tooltips; ⌘K 2.0; keyboard hotkeys + cheatsheet.

**Phase B — Ticker Dossier v2** + `lightweight-charts` install (pro candles/volume/MA/crosshair, multi-timeframe) + all dossier sections wired to `apex_ticker_report`.

**Phase C — Briefing System** — Session Summary strip (open/close/gap from bars), Morning Brief + EOD Wrap + "Brief me" BriefCard, "Since you were away" delta digest.

**Phase D — News Flow 2.0** — river animation, impact sort, lane chips, credibility pills, hover preview, sentiment-of-day, breaking pin, econ-calendar lane.

**Phase E — Real Quant layer** — Correlation matrix, RRG, and Vol/IV-RV widgets from real bars + local CSV (retire the demos); breadth+, macro rail, dominance donut, treemap, market clock.

**Phase F — Modes 2.0 + Personalization** — mode-aware layouts, rich Jarvis cards, NL-drives-panels, watchlists CRUD, real alert engine, proactive nudges.

## Dependencies & honest caveats
- `[NEW DEP]` **lightweight-charts** (Apache-2.0, Phase B) — the one library worth adding for pro charts. Small, self-contained.
- `[PAID]` live options flow / dealer GEX / dark-pool / per-print tape — stubbed + labeled. (Insider, historical IV/RV from the local CSV, fundamentals, news are all real & free.)
- **Paper-trade actions** in the dossier are stubs until the paper-trading engine exists (separate track) — button present, wired later.
- Performance: keep high-freq updates isolated in child components (already the pattern); throttle to ~1–4fps for live numbers; Web Workers for correlation/RRG math.

---

# PART II — Implementation Spec (the buildable detail)

## 8. Component & File Architecture

**New frontend files** (`src/rooms/apex/`):
- `apex-theme.ts` — design tokens + theme definitions (cold-steel/midnight/high-contrast) + density scales; exposes CSS vars.
- `apex-motion.ts` — spring/easing helpers, `useFlash`, `useNumberRoll`, `useStagger`, reduced-motion gate.
- `useHotkeys.ts` — global keyboard map + `?` cheatsheet registry.
- `CommandPalette.tsx` — ⌘K 2.0 (fuzzy across tickers/panels/actions/prompts/recent).
- `TickerDossier.tsx` — the slide-over dossier (replaces DrawerBody); sub-parts `DossierChart.tsx`, `DossierStats.tsx`, `DossierNews.tsx`, `DossierInsider.tsx`, `DossierVol.tsx`.
- `Tooltip.tsx` + `metric-glossary.ts` — explain-everything hoverlays.
- `SessionStrip.tsx` — open/prev-close/gap/range per index.
- `BriefCard.tsx` — Morning/EOD/on-demand briefing card (typed sections + citations).
- `NewsRiver.tsx` — News Flow 2.0 (animated, impact-sorted, filters, hover preview).
- Quant widgets: `CorrelationMatrix.tsx`, `SectorRRG.tsx`, `VolWidget.tsx`, `MacroRail.tsx`, `DominanceDonut.tsx`, `WatchlistTreemap.tsx`, `MarketClock.tsx`.
- `Watchlists.tsx` + `AlertsManager.tsx` — personalization.
- `JarvisCards.tsx` — typed response cards (BriefCard/TickerCard/CompareTable/AlertCard) renderer.

**Modified:** `ApexHome.tsx` (interaction spine, mode-aware layout host), `apex-data.ts` (new fetchers/types), `apex-home.css` (design-system rewrite → mostly token-driven).

**New backend files** (`server/providers/apex/`):
- `quant.js` — correlation, RRG (rel-strength/momentum), returns/vol math from bars.
- `vol-store.js` — extend the CSV seed to populate `apex_vol_history` (RV/IV/PC columns).
- keyed-adapters additions: `finnhubEarnings()`, `finnhubCompanyPeers()`.

## 9. Backend additions (endpoints + tables)

| Feature | Endpoint | Source / compute |
|---|---|---|
| Session summary | `GET /api/apex/session` | daily bars → prevClose, open, dayHi/Lo, gap%, per index |
| Correlation | `GET /api/apex/correlation?tickers&days` | Pearson corr from daily bars (`quant.js`) |
| Sector RRG | `GET /api/apex/rrg?days` | rel-strength vs momentum of 11 sector ETFs |
| Vol / IV-RV | `GET /api/apex/vol/:sym` | new `apex_vol_history` table (seeded from local CSV RV30/60, IV30_put/call, PC_OI, Put/CallVol) |
| Earnings cal | `GET /api/apex/earnings` | Finnhub `/calendar/earnings` (free) |
| Econ cal | `GET /api/apex/econ` | FRED release dates |
| Watchlists | `GET/POST/DELETE /api/apex/watchlists` | new `apex_watchlists` table; drives poller watchlist |
| Alerts | `GET/POST/DELETE /api/apex/alerts` + eval poller | new `apex_alerts` table; evaluated each poll → real toast events |
| Daily brief cache | `GET /api/apex/brief?type=morning|eod` | assembled from snapshot + bars; cached per day |

**New tables:** `apex_vol_history(ticker,date,rv30,rv60,iv30_put,iv30_call,pc_oi,put_vol,call_vol)`, `apex_watchlists(id,name,tickers_json,updated_at)`, `apex_alerts(id,ticker,kind,op,threshold,note,active,created_at,last_fired)`.

**New Jarvis tools:** `apex_brief(type)` (returns structured brief), `apex_compare(tickers[])` (side-by-side), `apex_set_alert(...)` (execute, confirm). Extend `apex_ticker_report` with peers + session + vol.

## 10. Design System & Interaction Spec

**Tokens** (in `apex-theme.ts`, emitted as CSS vars): color ramp (bg-0..bg-3, txt/mut/dim, accent + accent-dim, semantic pos/neg/warn/info), radius (sm/md/lg/panel), space scale (2/4/6/8/12/16/24), type scale (10/11/12/14/18/24/32 + weights), elevation (panel/hover/drawer), motion (dur-fast/base/slow, ease-spring/ease-out).

**Themes:** Cold-Steel `#05070d`/cyan (default) · Midnight (deeper, violet accent) · High-Contrast (AA+). Accent picker overrides `--ax-acc`. Density: Comfortable/Compact/Dense scale space + type tokens.

**Motion rules:** number ticks → flash(150ms)+roll; panel mount → stagger fade/rise 40ms apart; drawer/river → spring slide; hover → 2px lift + border-glow; all gated by `prefers-reduced-motion`.

**Interaction map (the spine):**
- **Click** any ticker (tape/movers/news/insider/heatmap/dossier-peers) → **open dossier**.
- **Click** a sector (heatmap/RRG) → **filter** movers + news + treemap to that sector.
- **Click** a news `[n]` citation → highlight source panel (exists).
- **Hover** any metric → glossary tooltip; **hover** a headline → preview card.
- **Keyboard:** `/` search · `⌘K` palette · `g h` home · `j/k` cycle panels · `←/→` cycle dossier tickers · `t` trade · `a` alert · `b` brief · `f` focus chart · `?` cheatsheet · `Esc` close top overlay.

## 11. Jarvis card contracts (typed responses)

`{ type: "brief", title, asOf, sections:[{h, body, cites:[panelId]}], watchItems:[] }`
`{ type: "ticker", ticker, price, change, why, stats:{}, news:[], insider:[] }`
`{ type: "compare", tickers:[], rows:[{metric, values:[]}] }`
`{ type: "alert", ticker, kind, op, threshold, confirm:true }`
The Jarvis stream detects a leading JSON card and renders via `JarvisCards.tsx`; falls back to markdown text otherwise.

## 12. Per-phase checklists & acceptance

**Phase A — Interactivity + polish** (no new deps)
- [ ] `apex-theme.ts` tokens + 3 themes + density; wire `apex-home.css` to vars.
- [ ] `apex-motion.ts`: flash, number-roll, stagger, reduced-motion gate; apply to live numbers + panel mount.
- [ ] Module-level `openSym` already exists → ensure **every** ticker across all panels calls it.
- [ ] Cross-link: sector click → shared `focusSector` state filters movers/news/treemap.
- [ ] `Tooltip.tsx` + `metric-glossary.ts`; attach to all metric labels.
- [ ] `CommandPalette.tsx` (⌘K 2.0) fuzzy + grouped + preview.
- [ ] `useHotkeys.ts` + `?` cheatsheet overlay.
- *Accept:* every ticker opens the dossier; theme+density switch persists; keyboard map works; no console errors; tsc clean.

**Phase B — Ticker Dossier v2**
- [ ] `npm i lightweight-charts`; `DossierChart.tsx` candles+volume+MA+crosshair, multi-timeframe.
- [ ] Dossier sections wired to `apex_ticker_report` (+ session + peers + vol).
- [ ] `GET /api/apex/session`; day-range + 52w bars.
- [ ] Arrow-key ticker cycling; actions row (watchlist/alert/ask-jarvis; trade stub).
- *Accept:* click NVDA anywhere → full dossier with real chart/stats/news/insider; `←/→` cycles.

**Phase C — Briefing System**
- [ ] `apex_brief` tool + `/api/apex/brief` cache; `BriefCard.tsx`.
- [ ] `SessionStrip.tsx` (open/prev-close/gap/range) in Overview.
- [ ] Morning + EOD triggers; "Brief me" → BriefCard; "Since you were away" delta (localStorage snapshot).
- *Accept:* session strip shows real open/close/gap; "Brief me" returns a cited card.

**Phase D — News Flow 2.0**
- [ ] `NewsRiver.tsx`: animation, impact sort, lane chips, credibility pills, hover preview, breaking pin, sentiment-of-day.
- [ ] Econ-calendar lane (FRED); per-ticker rail via dossier.
- *Accept:* river animates, sorts by impact, filters by lane; hover shows preview; click ticker → dossier.

**Phase E — Real Quant layer**
- [ ] `quant.js` + endpoints; `vol-store.js` + `apex_vol_history` seed from CSV.
- [ ] `CorrelationMatrix.tsx`, `SectorRRG.tsx`, `VolWidget.tsx` (retire fake corr/RRG); `MacroRail.tsx`, `DominanceDonut.tsx`, `WatchlistTreemap.tsx`, `MarketClock.tsx`; earnings calendar.
- *Accept:* correlation/RRG/vol are computed from real bars/CSV; no demo canvases remain (except `[PAID]`-labeled).

**Phase F — Modes 2.0 + Personalization**
- [ ] Mode-aware layout presets; `JarvisCards.tsx`; NL-drives-panels; live tool-trace.
- [ ] `apex_watchlists` + `Watchlists.tsx` (CRUD, drives pollers); `apex_alerts` + `AlertsManager.tsx` + eval poller → real toasts; `apex_set_alert`/`apex_compare` tools.
- [ ] Grounded proactive nudges.
- *Accept:* switching mode re-lays the deck; user alert fires a real toast; watchlist edits flow to news/movers.

## 13. Guardrails (unchanged, enforced)
- No fabricated data — real or badged. `[PAID]` widgets stubbed + labeled.
- CommonJS backend, atomic writes, safeDbJson; keys server-side only; secrets never exposed.
- NEVER restart the backend without authorization (Dev authorizes per-session).
- Voice OFF unless explicitly enabled; paper-trade actions inert until the trading engine exists.
- Every phase: `node --check` + `tsc --noEmit` clean + browser-verified (preview) with zero console errors before moving on.

**STATUS: PLAN LOCKED — awaiting Dev's go to start Phase A.**
