# APEX — Data Sourcing & Ingestion Plan (Wave 1) v1
### Synthesized from 4 research streams (July 2026) + local data inventory.

> Assumption: **personal-use tool** (not a shipped commercial product) — several free tiers are "personal/non-commercial", which is fine for Dev's own trading cockpit. Re-verify exact rate limits at signup; free tiers drift. Companion to `APEX_MASTER_PLAN.md` + `APEX_BUILD_RULES.md`.

---

## 1. Architecture — 3 tiers + source registry + governor

Not two engines — **three tiers by cadence/cost**, one source registry, one rate governor.

```
TIER            WHAT                                     HOW
─────           ────                                     ───
HOT (stream)    crypto trades/order-book, equity quotes  WebSocket, always on
WARM (poll)     news sweep, macro, sentiment, gainers,   scheduled pollers, per-source
                TA signals, breadth                       token-bucket + key rotation
COLD (lazy)     fundamentals, filings, deep history,      on-demand when a stock is opened
                Kaggle/local datasets                     /asked, then cached in apex.sqlite
```

- **Source registry** (`apex_sources` table): every source = one config record — `id, name, category, lane, base_url, auth(env var names), rate_limit, cadence, tier, trust_weight, parse_rules_json, tos_note, enabled`. One place, streamlined.
- **Rate governor:** token-bucket per source; rotate across multiple keys to multiply effective limits; exponential backoff on 429; priority = tier (hot > warm > cold).
- **Backend = Node-native.** Almost everything is a `fetch`/WS adapter in `server/providers/apex/*` (CommonJS). `ccxt` and `yahoo-finance2` are JS-native (no Python needed). TradingView's screener + TA are public JSON endpoints we call directly from Node. **Only** if we later want Python-only libs (SimFin bulk, pytrends) do we add a small Python sidecar/MCP — not required for Wave 1.

---

## 2. The chosen stack (per category)

| Category | Primary (free) | Backup | Tier | Key? |
|---|---|---|---|---|
| **Equities real-time** | **Finnhub** (WS, 60/min, 50 symbols) | Tiingo (IEX WS), Twelve Data (WS 8) | HOT/WARM | Finnhub key |
| **Equities historical** | **Tiingo** (30+yr, 1000/day) | Alpha Vantage (deep, 25/day), yahoo-finance2, Stooq | COLD | Tiingo key |
| **Crypto real-time + order book** | **Binance WS + CCXT** (no key, full L2 depth) | CryptoCompare WS | HOT | none |
| **Crypto market / dominance** | **CoinGecko** (demo key, 10k/mo) | CoinMarketCap | WARM | CoinGecko demo |
| **News (engine)** | **GDELT** + **Finnhub** + **NWS** (see §3) | Marketaux/AV (enrichers) | WARM | mixed |
| **Macro / economic** | **FRED** (+ALFRED vintages) + **treasury.gov** yields | World Bank | WARM/COLD | FRED key |
| **Economic calendar** | **Trading Economics** `guest:guest` + FRED actuals | Finnhub calendar | WARM | none |
| **Fundamentals / filings** | **SEC EDGAR** (Form4/13F/10-K/XBRL) | Finnhub, SimFin bulk, FMP | COLD | none (UA header) |
| **Alt-data** | **FINRA** (short int + dark-pool ATS) + **SEC Form4/13F** | Capitol Trades (congress), yahoo options/IV | COLD | none |
| **TA signals / gainers** | **tradingview-screener** endpoint + **tradingview-ta** | compute locally | WARM | none |
| **Charts (rendering)** | **TradingView Lightweight Charts** (Apache-2.0) | — | — | none |
| **Reference (universe/sectors/calendar)** | SEC `company_tickers.json` + Nasdaq Trader files + `pandas-market-calendars` | Finnhub/yahoo sectors | COLD | none |
| **Account/execution** | own **virtual paper account** in apex.sqlite | — | HOT | none |

**GICS sectors are licensed (paid)** → use Finnhub/yahoo `sector`/`industry` free proxies or SIC codes from EDGAR.

---

## 3. News Intelligence Engine (the centerpiece)

**Sources are chosen per lane; then everything merges into one story graph and runs the 6-stage pipeline.**

### Lane → primary source → cadence
| Lane | Primary (free) | Backup | Refresh |
|---|---|---|---|
| Financial / markets | **Finnhub** news (ticker-native) | Marketaux, Alpha Vantage | 1–2 min |
| Economics / macro | **Trading Economics** calendar + **FRED** actuals | GDELT `ECON_` | calendar hourly; fire at release |
| Central-bank / policy | **GDELT** (theme + tone) | TE calendar | 15 min; live near meetings |
| Politics / geopolitics | **GDELT 2.0** (CAMEO events, geocoded, toned) | NewsData.io | 15 min |
| Commodities / energy | **GDELT** energy themes + **NWS** weather | Finnhub | 5 min; 1 min in active weather |
| Crypto | **Finnhub crypto** + **Reddit** r/CryptoCurrency | GDELT crypto filter | 2 min *(CryptoPanic free is dead)* |
| Business / company | **Finnhub** company-news | Marketaux, AV | 2 min; 30s around earnings |
| Weather / disaster | **NWS `alerts/active`** (free, keyless, 1-min) | OpenWeather (global) | 1–5 min; 1 min Severe/Extreme |
| Social / retail | **Reddit** (mention-velocity + own NLP) | StockTwits *(legacy key only)*, GDELT tone | 1–2 min |

- **GDELT is the backbone** (no key, 15-min, geocoded + themed + toned, widest coverage — powers geopolitics/macro/energy/policy).
- **Finnhub is the equities workhorse** (60/min, ticker-native, free).
- **Marketaux (100/day) + Alpha Vantage (25/day)** are **enrichers, not pollers** — run 2–4×/day to attach best-in-class per-ticker sentiment + relevance onto already-clustered stories.
- **NWS is the sleeper win** for weather→market (hurricane→energy, freeze→ags), free + keyless + 1-min alerts.

### The 6-stage pipeline
```
INGEST(per-lane) → DEDUPE+CLUSTER → VERIFY → IMPACT-MAP → RANK → PIN/DECAY/ROLL
```
1. **Ingest** — per-lane pollers → normalize to one `Event` record `{id,lane,source,url,title,snippet,published_at,entities[],sentiment,geo,importance}`; token-bucket + URL cache (15-min TTL).
2. **Dedupe + cluster** — MinHash/SimHash + embedding cosine (~0.82) within a 6h window → one **Story** node (`sources[], article_count, first_seen`); cashtag/entity overlap boosts confidence.
3. **Verify** — corroboration = distinct **independent** source count (GDELT's cross-outlet count is a free signal) × source-credibility prior; single-source low-credibility → flagged `unverified` (shown, marked, low rank). Retail lanes enter as *attention signal*, not fact.
4. **Impact-map** — entity→ticker resolution (prefer pre-tagged: Marketaux `entities`, AV `ticker_sentiment`, Finnhub `related`, cashtags; fall back to alias table for GDELT). **Non-equity rules table**: US CPI↑→USD/rates/SPX; Gulf hurricane→{CL,NG,insurers}; OPEC→energy; CB surprise→FX+rates. `impact = surprise × magnitude × sentiment_dir × credibility × freshness`.
5. **Rank** — `impact × verification`, then **watchlist boost** (×2.5 exact ticker, ×1.5 same sector) — this makes it *Dev's* feed. Retail-velocity kicker for sudden mention spikes on watchlist names ("crowd surge").
6. **Pin / decay / roll** — hard-threshold stories pin with a badge; rank × `e^(−Δt/τ)` with lane half-lives (markets ~30–60m, macro ~6–12h, geopolitics ~24h); late corroboration *refreshes* not duplicates; decayed stories roll into a searchable archive, feed stays a top-50 live window.

**Bridge:** top stories → Jarvis synthesis ("what this means for your book") → push to **Helix Signal strand** as reasoned evidence. This is the "connect & predict" layer.

---

## 4. TradingView — the legit way
- **"Crazy graphs"** → **Lightweight Charts** (`lightweight-charts` npm, **Apache-2.0**, embeddable in commercial apps, just needs a visible TradingView attribution link). Bring our own data. This is THE way to get the TradingView look.
- **Buy/Sell signal** → **`tradingview-ta`** rating (Strong Buy→Sell). Gray-area lib (hits their scanner endpoint, not page-scraping); fine for internal signals. Stale (2022) — we can call the same public scanner endpoint from Node directly.
- **Top gainers / screener** → **`tradingview-screener`** (safest of the unofficial libs — public `/screener` JSON endpoint, 3000+ fields). Replicable in Node with `fetch`.
- **Avoid** `tvdatafeed` (authenticates against TV's private feed — highest ToS risk) and never scrape TV pages.

---

## 5. OpenBB + MCP servers
- **OpenBB** (~35k★, 600+ data commands across every asset class + news + an MCP surface) is a powerful reference/backbone — but it's **Python + AGPL-3.0**. For a Node backend + potential distribution, we **don't embed it**; we mirror its source coverage with our own lightweight Node adapters. Keep OpenBB as a research reference / optional MCP later.
- **Vendor-official MCP servers** (clean ToS) to consider once Jarvis wants tool-access to live data: **Alpaca**, **Alpha Vantage**, **CoinGecko**, **Financial Datasets** MCPs. For Wave 1 we use direct Node adapters (simpler, no extra process); MCP wrapping is a later nicety.

---

## 6. Local + Kaggle data (COLD tier seed) — zero API cost
**Dev's local files — a PARTIAL seed only** (Dev: coverage is limited by past stock choices; treat as a starter, not the source of truth — we'll pull far more via the APIs + datasets below):
- `Desktop\CrashGuard\data\free_market.parquet` + `Maintry\data\free_market.parquet` — market dataset (candidate history/universe seed)
- `Desktop\New folder\bt_cleaned_all_stocks.csv` — cleaned all-stocks table (candidate universe/history seed)
- `…\tradingportfolio\data\markets_meta.parquet` — market metadata → candidate `apex_universe` seed
- `Desktop\PROJECT EVVF\data\prices.csv` — price history
- `btdata.xlsx` (several projects) — backtest data

> **DO NOT USE the regime-prediction CSVs** (`regime_web_stock_*`) — those are the OUTPUT of Dev's separate algorithm project and must not be pulled into APEX. APEX computes its own regime (HMM/Hurst) from raw prices.

**We still need MORE backtest/historical sources before building APEX's own algorithm.** Dedicated free history/backtest sources to ingest:
- **Binance `data.binance.vision`** bulk klines (crypto, minute-level, free bulk ZIPs)
- **Stooq** + **yahoo-finance2** long daily history (equities, free)
- **Tiingo** 30-yr adjusted EOD (equities, keyed)
- Kaggle **Huge Stock Market Dataset** (all US stocks/ETFs daily), **NYSE prices+fundamentals**
- HuggingFace **FNSPID** (15.7M news aligned to prices, 1999–2023 — backtest + news-NLP)
- HuggingFace **financial_phrasebank** (labeled finance sentiment — train/validate our NLP)

→ These seed the **cold tier + backtester + news-NLP** with no live API calls. `markets_meta.parquet`/`bt_cleaned_all_stocks.csv` seed `apex_universe`; history comes from the bulk sources above. **Regime is computed by APEX, never imported.**

---

## 7. GET-THESE-KEYS — Phase 1 (free, ~10 min total)
**Must-get (6 email-signup keys, no card):**
| Key | Powers | Signup |
|---|---|---|
| **Finnhub** | equities real-time WS + news + fundamentals | finnhub.io/register |
| **Tiingo** | equities historical (30+yr) + IEX WS | tiingo.com/account/api/token |
| **FRED** | all macro series (+ALFRED vintages) | fred.stlouisfed.org/docs/api/api_key.html |
| **Marketaux** | ticker-tagged news + per-entity sentiment (enricher) | marketaux.com |
| **Alpha Vantage** | news sentiment + per-ticker relevance + deep history | alphavantage.co/support/#api-key |
| **CoinGecko (demo)** | crypto market cap / BTC dominance / prices | coingecko.com/en/api/pricing |

**Keyless — nothing to sign up (already usable):** GDELT, **SEC EDGAR** (just set a `User-Agent`), **FINRA** files, **NWS/weather.gov**, **Binance** public + **CCXT**, **yahoo-finance2** + Stooq, treasury.gov, World Bank, Nasdaq Trader files, Trading Economics (`guest:guest`), TradingView scanner endpoints, Lightweight Charts.

**Optional later:** Twelve Data, FMP, SimFin, CryptoCompare, NewsData.io, OpenWeather, Reddit OAuth app. **Do NOT build on:** CryptoPanic free (killed Apr 2026), NewsAPI.org/GNews (24h delay + non-commercial), StockTwits new signups (closed).

---

## 8. Panel → real source (Home)
| Panel | Source |
|---|---|
| Market Pulse (regime) | Finnhub/Tiingo prices + VIX (CBOE/yahoo) + FRED → **APEX computes HMM/Hurst itself** (never imports Dev's regime CSVs) |
| Portfolio | virtual account (apex.sqlite) marked to Finnhub/Binance quotes |
| Market Overview | indices (Finnhub/yahoo), crypto+BTC dom (CoinGecko), VIX, Fear&Greed (compute / alt.me for crypto), status (calendar) |
| Sector Rotation / Internals / Heatmap | sector-ETF + constituent prices (Finnhub/yahoo) → RRG/breadth/treemap computed |
| Unusual Activity | volume anomaly (Finnhub/Binance) + `tradingview-screener` + options (yahoo) |
| Correlation Web | computed from price history |
| Order Book | **Binance WS via CCXT** (crypto) |
| News | the §3 news engine |
| AI Insights | Jarvis over the apex cache |
| Alerts | alert engine over all feeds |
| (new) Signals | `tradingview-ta` Strong Buy→Sell + gainers |

---

## 9. `apex.sqlite` additions (registry + news graph + catalog + health)
```sql
apex_sources        (id, name, category, lane, base_url, auth_json, rate_limit, cadence_sec, tier, trust_weight, parse_rules_json, tos_note, enabled, last_ok_at, last_error, health)
apex_news_events    (id, lane, source, url, title, snippet, published_at, ingested_at, entities_json, sentiment, geo_json, importance)
apex_news_stories   (id, cluster_key, title, sources_json, article_count, first_seen, verify_score, impact_json, rank, pinned, decayed_at)
apex_news_impact    (story_id, ticker, sector, impact, sentiment_dir, surprise, updated_at)
apex_alias_map      (name, ticker, sector)              -- entity→ticker resolution
apex_impact_rules   (id, trigger, affected_json, note)  -- non-equity mappings (CPI→…, hurricane→…)
-- Data catalog (so Jarvis can find + summarize what data we hold)
apex_catalog        (id, kind, name, path, source, columns_json, row_count, date_from, date_to, coverage_json, summary, updated_at)  -- kind = file|table|dataset
-- Data-health bot
apex_health_reports (id, ran_at, ok_count, degraded_count, down_count, report_json, analysis, fixes_json, status)
```
(plus market/price/account tables in `APEX_MASTER_PLAN.md §7`). All follow `helix-db.js` (WAL, prepared stmts, `safeDbJson`, transactions, idempotent).

---

## 10. Data Catalog + Jarvis file-search (make "what data do we have?" easy)
Because ingestion is extensive (many APIs + local files + datasets + DB tables), Jarvis needs to *know and summarize* what exists.
- **Cataloguer** scans (a) local data files (parse header → columns, row count, date range), (b) `apex.sqlite` tables (PRAGMA + COUNT + min/max date), (c) registered datasets → writes `apex_catalog` rows with a one-line **summary** each.
- **Jarvis tools:** `apex_catalog_search(query)` → matching files/tables/datasets; `apex_data_summary(name)` → columns + coverage + date range + row count + source. So "what stock history do we have?" or "do we have NVDA options?" returns a real, summarized answer.
- Runs on Wave-2 seed and after each new source/dataset lands; also on-demand.

---

## 11. Data Health Bot (on-demand, self-heal loop) — Dev's target design
A read-only APEX bot (file agent, strict convention) that audits the whole data layer and drives a fix loop **without ever restarting the backend**.
```
run → CHECK every apex_source (ping, latency, last_ok, error rate, coverage gaps, quota left)
    → REPORT (apex_health_reports: ok / degraded / down + details)
    → JARVIS reads report → ANALYSIS + proposed FIXES
        (disable dead source · rotate key · adjust cadence · switch to backup · re-enable recovered)
    → Dev approves ("go")
    → APPLY = config change to apex_sources (NOT code) 
    → governor HOT-RELOADS the registry (soft internal refresh; ingestion scheduler re-reads config — no process restart)
    → RE-CHECK → bot confirms green → resume where left off
```
- Bot: `runtime/neural_vault/agents/definitions/apex-datahealth.js` — `permissions.readOnly:true`, tool `apex_health_check` (observe). The APPLY step is a separate `apex_source_config` tool at risk `prepare`/`commit` → requires Dev's explicit approval (honors the strict bot rule: no autonomous mutation; every claim = tool receipt).
- "Restarts internally a little refresh" = the source registry + scheduler hot-reload from `apex_sources`, **not** `node server.js`. The rule *never restart the backend* is preserved.

---

## 12. WAVE-BY-WAVE BUILD PLAN

**Wave 1 — DB + registry + governor + keyless adapters** *(no keys needed — start here)*
- `server/apex-db.js` + `runtime/apex.sqlite` (all tables §9 + master §7), seed `apex_sources` (keyed ones `enabled=0` until keys arrive).
- Rate governor (token-bucket + key rotation + 429 backoff) + registry hot-reload.
- Keyless adapters: **GDELT, SEC EDGAR, NWS, Binance+CCXT, yahoo-finance2, treasury.gov, World Bank, SEC/Nasdaq ticker files, TradingView scanner/TA endpoints** (+ FRED once its instant key is in).
- `/api/apex/*` skeleton + `/ws/apex` relay (Binance). Wire into `server.js` startup.
- **Check:** server boots, `apex_sources` populated, keyless adapters return data, `/ws/apex` streams Binance depth.

**Wave 2 — Cold-tier seed + data catalog + Jarvis file-search**
- Ingest local `markets_meta`/`bt_cleaned_all_stocks` → `apex_universe`; pull deeper history from Binance bulk + yahoo/Stooq/Tiingo. **(Regime CSVs excluded.)**
- Build cataloguer → `apex_catalog` with summaries; register `apex_catalog_search` + `apex_data_summary` Jarvis tools.
- **Check:** catalog populated; Jarvis "what data do we have on X?" returns summaries.

**Wave 3 — Keyed adapters** *(after Dev drops the 6 keys)*
- Finnhub (WS quotes + news), Tiingo (history + IEX WS), CoinGecko, Marketaux + Alpha Vantage (enrichers). Governor enables them.
- **Check:** keyed sources green in health.

**Wave 4 — News Intelligence Engine**
- Per-lane pollers → Event → dedupe/cluster → verify → impact-map → rank → pin/decay/roll; seed `apex_alias_map` + `apex_impact_rules`; Helix Signal-strand bridge.
- **Check:** News panel shows clustered, verified, watchlist-ranked stories.

**Wave 5 — Wire Home panels to real data**
- Order Book (Binance) → Market Overview → Market Pulse (APEX-computed regime) → Sector Rotation/Internals/Heatmap → Unusual Activity → Correlation → Portfolio (virtual account) → Alerts → AI Insights → Signals (tradingview-ta/screener). **Lightweight Charts** in the drawer.
- **Check:** panels show real numbers + flash on live ticks.

**Wave 6 — Data Health Bot + self-heal loop** (§11)
- **Check:** run health → report → approve a fix → source recovers via hot-reload, no server restart.

**Wave 7 — Jarvis tools + on-demand deep-research + polish**
- `apex_*` tools over the cache + APEX mode; cold-tier deep-research fetcher; add more backtest sources to the registry as found.

**Legit/ToS stance:** APIs + official libs (Lightweight Charts) + keyless gov data; TradingView only via its own chart lib + public scanner endpoints; no page-scraping. Personal-use tier assumed. **Never restart the backend — fixes hot-reload config.**
