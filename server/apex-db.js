"use strict";
/* ═══════════════════════════════════════════════════════════
   APEX — room database. Mirrors helix-db.js conventions:
   CommonJS, better-sqlite3, WAL, prepared statements,
   db.transaction() for multi-step writes, safeDbJson() on reads,
   crypto.randomUUID() ids, ISO timestamps, idempotent tables.
   Holds market/price/account data, the data-source registry,
   the news story graph, a data catalog, and health reports.
   ═══════════════════════════════════════════════════════════ */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const isoNow = () => new Date().toISOString();

// Prototype-pollution-safe JSON parse (same guard as helix-db.js).
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function safeDbJson(raw, fallback) {
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const k of Object.keys(parsed)) if (PROTO_KEYS.has(k)) return fallback;
    }
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}
const j = (v) => JSON.stringify(v == null ? null : v);

// THE FORGE v3 — row mappers for the composable primitives.
const rowToVar = (r) => ({ id: r.id, name: r.name, expr: r.expr, kind: r.kind, description: r.description, deps: safeDbJson(r.deps_json, {}), usedBy: safeDbJson(r.used_by_json, []), folderId: r.folder_id, createdBy: r.created_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });
const rowToSignal = (r) => ({ id: r.id, name: r.name, expr: r.expr, description: r.description, codePath: r.code_path, deps: safeDbJson(r.deps_json, {}), usedBy: safeDbJson(r.used_by_json, []), folderId: r.folder_id, createdBy: r.created_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });

/* ── Seed source registry (idempotent by id). Keyed sources start
   disabled (enabled=0) until Dev drops the key into settings. ─── */
const SEED_SOURCES = [
  // id, name, category, lane, base_url, authEnv[], rate_limit, cadence_sec, tier, trust, enabled, tos
  ["gdelt", "GDELT 2.0", "news", "geopolitics", "https://api.gdeltproject.org/api/v2", [], "1/s", 900, "warm", 0.7, 1, "open/free metadata"],
  ["sec-edgar", "SEC EDGAR", "fundamentals", "filings", "https://data.sec.gov", [], "10/s", 3600, "cold", 1.0, 1, "free; User-Agent required"],
  ["sec-companyfacts", "SEC CompanyFacts", "fundamentals", "xbrl-facts", "https://data.sec.gov/api/xbrl/companyfacts", [], "10/s", 3600, "cold", 1.0, 1, "free; User-Agent required"],
  ["sec-submissions", "SEC Submissions", "fundamentals", "filing-history", "https://data.sec.gov/submissions", [], "10/s", 3600, "cold", 1.0, 1, "free; User-Agent required"],
  ["finra", "FINRA", "altdata", "short-interest", "https://api.finra.org", [], "n/a", 86400, "cold", 1.0, 1, "free files/API"],
  ["finra-short-volume", "FINRA Short Sale Volume", "altdata", "short-pressure", "https://cdn.finra.org/equity/regsho/daily", [], "daily", 86400, "cold", 1.0, 1, "free daily files"],
  ["cftc-cot", "CFTC Commitments of Traders", "macro", "positioning", "https://publicreporting.cftc.gov", [], "polite", 86400, "cold", 1.0, 1, "free public reporting"],
  ["cboe-market", "Cboe Market Statistics", "macro", "vol-options", "https://cdn.cboe.com", [], "polite", 3600, "warm", 0.95, 1, "free public CSVs"],
  ["nasdaq-trader", "Nasdaq Trader Symbol Directory", "reference", "universe", "https://www.nasdaqtrader.com/dynamic/SymDir", [], "daily", 86400, "cold", 0.95, 1, "free symbol directory"],
  ["ken-french", "Ken French Data Library", "factors", "academic-factors", "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french", [], "polite", 86400, "cold", 1.0, 1, "free academic research data"],
  ["bls", "BLS Public API", "macro", "labor-inflation", "https://api.bls.gov/publicAPI/v2", [], "limited no-key", 86400, "cold", 1.0, 1, "free public API"],
  ["federal-reserve", "Federal Reserve H.15", "macro", "rates", "https://www.federalreserve.gov/releases/h15", [], "polite", 86400, "cold", 1.0, 1, "free public release"],
  ["defillama", "DefiLlama", "crypto", "liquidity", "https://api.llama.fi", [], "polite", 1800, "warm", 0.8, 1, "free public API"],
  ["yahoo-options", "Yahoo Options Chain", "options", "derivatives", "https://query2.finance.yahoo.com/v7/finance/options", [], "soft", 900, "warm", 0.6, 1, "unofficial; personal use"],
  ["nws", "NWS weather.gov", "news", "weather", "https://api.weather.gov", [], "n/a", 300, "warm", 1.0, 1, "free, keyless, US"],
  ["binance", "Binance (public)", "crypto", "price", "https://api.binance.com", [], "6000w/min", 0, "hot", 0.9, 1, "public market data keyless"],
  ["ccxt", "CCXT (multi-exchange)", "crypto", "price", "", [], "per-exchange", 0, "hot", 0.9, 1, "public data keyless"],
  ["yahoo", "yahoo-finance2", "equities", "price", "https://query1.finance.yahoo.com", [], "soft", 900, "cold", 0.6, 1, "unofficial; personal use"],
  ["stooq", "Stooq", "equities", "price", "https://stooq.com", [], "polite", 86400, "cold", 0.6, 1, "free CSV EOD"],
  ["treasury", "treasury.gov", "macro", "rates", "https://api.fiscaldata.treasury.gov", [], "n/a", 86400, "warm", 1.0, 1, "free, keyless"],
  ["worldbank", "World Bank", "macro", "macro", "https://api.worldbank.org/v2", [], "n/a", 86400, "cold", 1.0, 1, "free, keyless"],
  ["tv-screener", "TradingView Screener", "signals", "screener", "https://scanner.tradingview.com", [], "polite", 300, "warm", 0.6, 1, "public scanner endpoint (gray-area)"],
  ["tv-ta", "TradingView TA", "signals", "rating", "https://scanner.tradingview.com", [], "polite", 300, "warm", 0.6, 1, "public scanner endpoint (gray-area)"],
  // Keyed sources — enabled=0 until key present
  ["fred", "FRED", "macro", "macro", "https://api.stlouisfed.org/fred", ["FRED_API_KEY"], "120/min", 3600, "warm", 1.0, 0, "free key"],
  ["finnhub", "Finnhub", "equities", "price", "https://finnhub.io/api/v1", ["FINNHUB_API_KEY"], "60/min", 0, "hot", 0.85, 0, "free key; personal use"],
  ["tiingo", "Tiingo", "equities", "price", "https://api.tiingo.com", ["TIINGO_API_KEY"], "1000/day", 3600, "cold", 0.85, 0, "free key"],
  ["coingecko", "CoinGecko (demo)", "crypto", "market", "https://api.coingecko.com/api/v3", ["COINGECKO_API_KEY"], "30/min", 120, "warm", 0.8, 0, "demo key"],
  ["marketaux", "Marketaux", "news", "markets", "https://api.marketaux.com/v1", ["MARKETAUX_API_KEY"], "100/day", 0, "warm", 0.8, 0, "enricher"],
  ["alphavantage", "Alpha Vantage", "news", "markets", "https://www.alphavantage.co", ["ALPHAVANTAGE_API_KEY"], "25/day", 0, "warm", 0.8, 0, "enricher + deep history"],
];

function createApexDb(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const dbPath = path.join(runtimeDir, "apex.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    /* ── Reference ─────────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_universe (
      ticker TEXT PRIMARY KEY, name TEXT, asset_class TEXT, sector TEXT, industry TEXT,
      exchange TEXT, is_crypto INTEGER DEFAULT 0, cik TEXT, updated_at TEXT NOT NULL
    );

    /* ── Market data ───────────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_bars (
      ticker TEXT NOT NULL, tf TEXT NOT NULL, t TEXT NOT NULL,
      o REAL, h REAL, l REAL, c REAL, v REAL, vwap REAL,
      PRIMARY KEY (ticker, tf, t)
    );
    CREATE INDEX IF NOT EXISTS apex_bars_idx ON apex_bars(ticker, tf, t);
    CREATE TABLE IF NOT EXISTS apex_quotes_live (
      ticker TEXT PRIMARY KEY, bid REAL, ask REAL, bid_sz REAL, ask_sz REAL, last REAL,
      day_o REAL, day_h REAL, day_l REAL, prev_c REAL, vol REAL, ts TEXT
    );

    /* ── Account (virtual paper) ───────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_positions (
      id TEXT PRIMARY KEY, ticker TEXT NOT NULL, qty REAL, avg_price REAL, side TEXT, opened_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_orders (
      id TEXT PRIMARY KEY, ticker TEXT NOT NULL, side TEXT, type TEXT, qty REAL, price REAL,
      status TEXT, algo TEXT, created_at TEXT NOT NULL, filled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_fills (
      id TEXT PRIMARY KEY, order_id TEXT, ticker TEXT, qty REAL, price REAL, ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_equity_curve (
      ts TEXT PRIMARY KEY, equity REAL, cash REAL, buying_power REAL, unrealized REAL, realized REAL
    );

    /* ── Source registry ───────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, lane TEXT, base_url TEXT,
      auth_json TEXT DEFAULT '[]', rate_limit TEXT, cadence_sec INTEGER DEFAULT 0, tier TEXT,
      trust_weight REAL DEFAULT 0.7, parse_rules_json TEXT DEFAULT '{}', tos_note TEXT,
      enabled INTEGER DEFAULT 1, last_ok_at TEXT, last_error TEXT, health TEXT DEFAULT 'unknown',
      updated_at TEXT NOT NULL
    );

    /* ── News story graph ──────────────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_news_events (
      id TEXT PRIMARY KEY, lane TEXT, source TEXT, url TEXT, title TEXT, snippet TEXT,
      published_at TEXT, ingested_at TEXT NOT NULL, entities_json TEXT DEFAULT '[]',
      sentiment REAL, geo_json TEXT, importance REAL, story_id TEXT
    );
    CREATE INDEX IF NOT EXISTS apex_news_events_idx ON apex_news_events(ingested_at);
    CREATE TABLE IF NOT EXISTS apex_news_stories (
      id TEXT PRIMARY KEY, cluster_key TEXT, title TEXT, sources_json TEXT DEFAULT '[]',
      article_count INTEGER DEFAULT 1, first_seen TEXT, verify_score REAL DEFAULT 0,
      impact_json TEXT DEFAULT '{}', rank REAL DEFAULT 0, pinned INTEGER DEFAULT 0, decayed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS apex_news_stories_rank ON apex_news_stories(rank DESC);
    CREATE TABLE IF NOT EXISTS apex_news_impact (
      id TEXT PRIMARY KEY, story_id TEXT, ticker TEXT, sector TEXT, impact REAL,
      sentiment_dir INTEGER, surprise REAL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apex_alias_map (
      name TEXT PRIMARY KEY, ticker TEXT, sector TEXT
    );
    CREATE TABLE IF NOT EXISTS apex_impact_rules (
      id TEXT PRIMARY KEY, trigger TEXT, affected_json TEXT DEFAULT '[]', note TEXT
    );

    /* ── Data catalog (Jarvis file/table search + summaries) ── */
    CREATE TABLE IF NOT EXISTS apex_catalog (
      id TEXT PRIMARY KEY, kind TEXT, name TEXT, path TEXT, source TEXT,
      columns_json TEXT DEFAULT '[]', row_count INTEGER, date_from TEXT, date_to TEXT,
      coverage_json TEXT DEFAULT '{}', summary TEXT, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_catalog_name ON apex_catalog(name);

    /* ── Data-health bot reports ───────────────────────────── */
    CREATE TABLE IF NOT EXISTS apex_health_reports (
      id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, ok_count INTEGER, degraded_count INTEGER,
      down_count INTEGER, report_json TEXT DEFAULT '[]', analysis TEXT, fixes_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'reported'
    );

    /* ── THE FORGE: strategy/bot specs (serializable BotSpec JSON) ── */
    CREATE TABLE IF NOT EXISTS apex_strategies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]', folder TEXT DEFAULT '', source TEXT DEFAULT 'forms',
      spec_json TEXT NOT NULL, summary TEXT DEFAULT '', metrics_json TEXT DEFAULT '{}',
      version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_strategies_updated ON apex_strategies(updated_at DESC);
    CREATE INDEX IF NOT EXISTS apex_strategies_folder ON apex_strategies(folder);

    -- THE FORGE v3: composable primitives. A strategy is a FOLDER holding bots;
    -- folders own variables + signals. Everything stores a validated DSL/spec +
    -- dependency lists so edits fan out "dirty" via a reverse index (used_by).
    CREATE TABLE IF NOT EXISTS apex_folders (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
      kind TEXT DEFAULT 'strategy', code_path TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}', created_by TEXT DEFAULT 'user',
      version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_folders_updated ON apex_folders(updated_at DESC);

    CREATE TABLE IF NOT EXISTS apex_variables (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, expr TEXT NOT NULL,
      kind TEXT DEFAULT 'scalar', description TEXT DEFAULT '',
      deps_json TEXT DEFAULT '{}', used_by_json TEXT DEFAULT '[]',
      folder_id TEXT DEFAULT '', created_by TEXT DEFAULT 'user',
      version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_variables_updated ON apex_variables(updated_at DESC);
    CREATE INDEX IF NOT EXISTS apex_variables_folder ON apex_variables(folder_id);

    CREATE TABLE IF NOT EXISTS apex_signals (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, expr TEXT DEFAULT '',
      description TEXT DEFAULT '', code_path TEXT DEFAULT '',
      deps_json TEXT DEFAULT '{}', used_by_json TEXT DEFAULT '[]',
      folder_id TEXT DEFAULT '', created_by TEXT DEFAULT 'user',
      version INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_signals_updated ON apex_signals(updated_at DESC);
    CREATE INDEX IF NOT EXISTS apex_signals_folder ON apex_signals(folder_id);

    -- Deep-analysis reports (V8) keyed for AI lookup ("what's my Sortino?").
    CREATE TABLE IF NOT EXISTS apex_reports (
      id TEXT PRIMARY KEY, target_id TEXT NOT NULL, target_kind TEXT DEFAULT 'strategy',
      name TEXT DEFAULT '', metrics_json TEXT DEFAULT '{}', report_json TEXT NOT NULL,
      engine_version TEXT DEFAULT '1', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS apex_reports_target ON apex_reports(target_id, created_at DESC);
  `);

  // Idempotent runtime migrations go here (try/catch ALTER) as the schema evolves.

  const stmts = {
    // sources
    seedSource: db.prepare(`INSERT OR IGNORE INTO apex_sources
      (id,name,category,lane,base_url,auth_json,rate_limit,cadence_sec,tier,trust_weight,tos_note,enabled,updated_at)
      VALUES (@id,@name,@category,@lane,@base_url,@auth_json,@rate_limit,@cadence_sec,@tier,@trust_weight,@tos_note,@enabled,@updated_at)`),
    listSources: db.prepare(`SELECT * FROM apex_sources ORDER BY tier, category, name`),
    getSource: db.prepare(`SELECT * FROM apex_sources WHERE id = ?`),
    setSourceEnabled: db.prepare(`UPDATE apex_sources SET enabled = ?, updated_at = ? WHERE id = ?`),
    // THE FORGE — strategies
    upsertStrategy: db.prepare(`INSERT INTO apex_strategies
      (id,name,description,tags_json,folder,source,spec_json,summary,metrics_json,version,created_at,updated_at)
      VALUES (@id,@name,@description,@tags_json,@folder,@source,@spec_json,@summary,@metrics_json,@version,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,description=@description,tags_json=@tags_json,folder=@folder,
        source=@source,spec_json=@spec_json,summary=@summary,metrics_json=@metrics_json,version=@version,updated_at=@updated_at`),
    listStrategies: db.prepare(`SELECT id,name,description,tags_json,folder,source,summary,metrics_json,version,created_at,updated_at FROM apex_strategies ORDER BY updated_at DESC`),
    getStrategy: db.prepare(`SELECT * FROM apex_strategies WHERE id = ?`),
    deleteStrategy: db.prepare(`DELETE FROM apex_strategies WHERE id = ?`),
    listStrategiesByFolder: db.prepare(`SELECT id,name,description,tags_json,folder,source,summary,metrics_json,version,created_at,updated_at FROM apex_strategies WHERE folder = ? ORDER BY updated_at DESC`),
    // THE FORGE v3 — folders
    upsertFolder: db.prepare(`INSERT INTO apex_folders
      (id,name,description,kind,code_path,meta_json,created_by,version,created_at,updated_at)
      VALUES (@id,@name,@description,@kind,@code_path,@meta_json,@created_by,@version,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,description=@description,kind=@kind,code_path=@code_path,
        meta_json=@meta_json,version=@version,updated_at=@updated_at`),
    listFolders: db.prepare(`SELECT * FROM apex_folders ORDER BY updated_at DESC`),
    getFolder: db.prepare(`SELECT * FROM apex_folders WHERE id = ?`),
    deleteFolder: db.prepare(`DELETE FROM apex_folders WHERE id = ?`),
    // variables
    upsertVariable: db.prepare(`INSERT INTO apex_variables
      (id,name,expr,kind,description,deps_json,used_by_json,folder_id,created_by,version,created_at,updated_at)
      VALUES (@id,@name,@expr,@kind,@description,@deps_json,@used_by_json,@folder_id,@created_by,@version,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,expr=@expr,kind=@kind,description=@description,deps_json=@deps_json,
        used_by_json=@used_by_json,folder_id=@folder_id,version=@version,updated_at=@updated_at`),
    listVariables: db.prepare(`SELECT * FROM apex_variables ORDER BY updated_at DESC`),
    getVariable: db.prepare(`SELECT * FROM apex_variables WHERE id = ?`),
    getVariableByName: db.prepare(`SELECT * FROM apex_variables WHERE name = ? COLLATE NOCASE LIMIT 1`),
    deleteVariable: db.prepare(`DELETE FROM apex_variables WHERE id = ?`),
    // signals
    upsertSignal: db.prepare(`INSERT INTO apex_signals
      (id,name,expr,description,code_path,deps_json,used_by_json,folder_id,created_by,version,created_at,updated_at)
      VALUES (@id,@name,@expr,@description,@code_path,@deps_json,@used_by_json,@folder_id,@created_by,@version,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=@name,expr=@expr,description=@description,code_path=@code_path,deps_json=@deps_json,
        used_by_json=@used_by_json,folder_id=@folder_id,version=@version,updated_at=@updated_at`),
    listSignals: db.prepare(`SELECT * FROM apex_signals ORDER BY updated_at DESC`),
    getSignal: db.prepare(`SELECT * FROM apex_signals WHERE id = ?`),
    getSignalByName: db.prepare(`SELECT * FROM apex_signals WHERE name = ? COLLATE NOCASE LIMIT 1`),
    deleteSignal: db.prepare(`DELETE FROM apex_signals WHERE id = ?`),
    // reports (V8)
    insertReport: db.prepare(`INSERT INTO apex_reports (id,target_id,target_kind,name,metrics_json,report_json,engine_version,created_at)
      VALUES (@id,@target_id,@target_kind,@name,@metrics_json,@report_json,@engine_version,@created_at)`),
    latestReport: db.prepare(`SELECT * FROM apex_reports WHERE target_id = ? ORDER BY created_at DESC LIMIT 1`),
    listReports: db.prepare(`SELECT id,target_id,target_kind,name,metrics_json,engine_version,created_at FROM apex_reports ORDER BY created_at DESC LIMIT ?`),
    setSourceHealth: db.prepare(`UPDATE apex_sources SET health = ?, last_ok_at = ?, last_error = ?, updated_at = ? WHERE id = ?`),
    setSourceConfig: db.prepare(`UPDATE apex_sources SET cadence_sec = ?, rate_limit = ?, enabled = ?, updated_at = ? WHERE id = ?`),
    // universe
    upsertUniverse: db.prepare(`INSERT INTO apex_universe (ticker,name,asset_class,sector,industry,exchange,is_crypto,cik,updated_at)
      VALUES (@ticker,@name,@asset_class,@sector,@industry,@exchange,@is_crypto,@cik,@updated_at)
      ON CONFLICT(ticker) DO UPDATE SET name=excluded.name, asset_class=excluded.asset_class, sector=excluded.sector,
        industry=excluded.industry, exchange=excluded.exchange, is_crypto=excluded.is_crypto, cik=excluded.cik, updated_at=excluded.updated_at`),
    countUniverse: db.prepare(`SELECT COUNT(*) AS n FROM apex_universe`),
    // bars
    insertBar: db.prepare(`INSERT OR REPLACE INTO apex_bars (ticker,tf,t,o,h,l,c,v,vwap) VALUES (@ticker,@tf,@t,@o,@h,@l,@c,@v,@vwap)`),
    getBars: db.prepare(`SELECT t,o,h,l,c,v,vwap FROM apex_bars WHERE ticker = ? AND tf = ? ORDER BY t DESC LIMIT ?`),
    // quotes
    upsertQuote: db.prepare(`INSERT INTO apex_quotes_live (ticker,bid,ask,bid_sz,ask_sz,last,day_o,day_h,day_l,prev_c,vol,ts)
      VALUES (@ticker,@bid,@ask,@bid_sz,@ask_sz,@last,@day_o,@day_h,@day_l,@prev_c,@vol,@ts)
      ON CONFLICT(ticker) DO UPDATE SET bid=excluded.bid, ask=excluded.ask, bid_sz=excluded.bid_sz, ask_sz=excluded.ask_sz,
        last=excluded.last, day_o=excluded.day_o, day_h=excluded.day_h, day_l=excluded.day_l, prev_c=excluded.prev_c, vol=excluded.vol, ts=excluded.ts`),
    getQuote: db.prepare(`SELECT * FROM apex_quotes_live WHERE ticker = ?`),
    // news
    insertEvent: db.prepare(`INSERT OR IGNORE INTO apex_news_events (id,lane,source,url,title,snippet,published_at,ingested_at,entities_json,sentiment,geo_json,importance,story_id)
      VALUES (@id,@lane,@source,@url,@title,@snippet,@published_at,@ingested_at,@entities_json,@sentiment,@geo_json,@importance,@story_id)`),
    upsertStory: db.prepare(`INSERT INTO apex_news_stories (id,cluster_key,title,sources_json,article_count,first_seen,verify_score,impact_json,rank,pinned,decayed_at)
      VALUES (@id,@cluster_key,@title,@sources_json,@article_count,@first_seen,@verify_score,@impact_json,@rank,@pinned,@decayed_at)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, sources_json=excluded.sources_json, article_count=excluded.article_count,
        verify_score=excluded.verify_score, impact_json=excluded.impact_json, rank=excluded.rank, pinned=excluded.pinned, decayed_at=excluded.decayed_at`),
    listStories: db.prepare(`SELECT * FROM apex_news_stories WHERE decayed_at IS NULL ORDER BY pinned DESC, rank DESC LIMIT ?`),
    upsertAlias: db.prepare(`INSERT OR REPLACE INTO apex_alias_map (name,ticker,sector) VALUES (?,?,?)`),
    upsertRule: db.prepare(`INSERT OR REPLACE INTO apex_impact_rules (id,trigger,affected_json,note) VALUES (@id,@trigger,@affected_json,@note)`),
    listAliases: db.prepare(`SELECT name,ticker,sector FROM apex_alias_map`),
    listRules: db.prepare(`SELECT id,trigger,affected_json,note FROM apex_impact_rules`),
    countAliases: db.prepare(`SELECT COUNT(*) AS n FROM apex_alias_map`),
    countRules: db.prepare(`SELECT COUNT(*) AS n FROM apex_impact_rules`),
    insertImpact: db.prepare(`INSERT INTO apex_news_impact (id,story_id,ticker,sector,impact,sentiment_dir,surprise,updated_at)
      VALUES (@id,@story_id,@ticker,@sector,@impact,@sentiment_dir,@surprise,@updated_at)
      ON CONFLICT(id) DO UPDATE SET impact=excluded.impact, sentiment_dir=excluded.sentiment_dir, surprise=excluded.surprise, updated_at=excluded.updated_at`),
    impactByTicker: db.prepare(`SELECT i.*, s.title, s.rank FROM apex_news_impact i JOIN apex_news_stories s ON s.id=i.story_id
      WHERE i.ticker=? AND s.decayed_at IS NULL ORDER BY s.rank DESC LIMIT ?`),
    decayOldStories: db.prepare(`UPDATE apex_news_stories SET decayed_at=@now WHERE decayed_at IS NULL AND pinned=0 AND first_seen < @cutoff`),
    pruneNoiseStories: db.prepare(`DELETE FROM apex_news_stories WHERE pinned=0 AND rank < 0.1 AND article_count < 2`),
    clearStories: db.prepare(`DELETE FROM apex_news_stories`),
    clearImpact: db.prepare(`DELETE FROM apex_news_impact`),
    countActiveStories: db.prepare(`SELECT COUNT(*) AS n FROM apex_news_stories WHERE decayed_at IS NULL`),
    // catalog
    upsertCatalog: db.prepare(`INSERT INTO apex_catalog (id,kind,name,path,source,columns_json,row_count,date_from,date_to,coverage_json,summary,updated_at)
      VALUES (@id,@kind,@name,@path,@source,@columns_json,@row_count,@date_from,@date_to,@coverage_json,@summary,@updated_at)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, path=excluded.path, source=excluded.source,
        columns_json=excluded.columns_json, row_count=excluded.row_count, date_from=excluded.date_from, date_to=excluded.date_to,
        coverage_json=excluded.coverage_json, summary=excluded.summary, updated_at=excluded.updated_at`),
    searchCatalog: db.prepare(`SELECT * FROM apex_catalog WHERE name LIKE ? OR summary LIKE ? OR source LIKE ? ORDER BY updated_at DESC LIMIT ?`),
    getCatalog: db.prepare(`SELECT * FROM apex_catalog WHERE name = ? OR id = ? LIMIT 1`),
    // health
    insertHealth: db.prepare(`INSERT INTO apex_health_reports (id,ran_at,ok_count,degraded_count,down_count,report_json,analysis,fixes_json,status)
      VALUES (@id,@ran_at,@ok_count,@degraded_count,@down_count,@report_json,@analysis,@fixes_json,@status)`),
    latestHealth: db.prepare(`SELECT * FROM apex_health_reports ORDER BY ran_at DESC LIMIT 1`),
  };

  // Seed the source registry once (idempotent — INSERT OR IGNORE).
  const seedSources = db.transaction(() => {
    const now = isoNow();
    for (const s of SEED_SOURCES) {
      stmts.seedSource.run({
        id: s[0], name: s[1], category: s[2], lane: s[3], base_url: s[4],
        auth_json: j(s[5]), rate_limit: s[6], cadence_sec: s[7], tier: s[8],
        trust_weight: s[9], enabled: s[10], tos_note: s[11], updated_at: now,
      });
    }
  });
  seedSources();

  // ── Public API ─────────────────────────────────────────────
  return {
    dbPath,
    close: () => db.close(),

    // sources / registry (governor reads these; health bot writes health)
    listSources: () => stmts.listSources.all().map((r) => ({ ...r, auth: safeDbJson(r.auth_json, []), parse_rules: safeDbJson(r.parse_rules_json, {}) })),
    getSource: (id) => { const r = stmts.getSource.get(id); return r ? { ...r, auth: safeDbJson(r.auth_json, []) } : null; },
    setSourceEnabled: (id, enabled) => stmts.setSourceEnabled.run(enabled ? 1 : 0, isoNow(), id),
    setSourceHealth: (id, health, lastError = null) => stmts.setSourceHealth.run(health, health === "ok" ? isoNow() : null, lastError, isoNow(), id),
    setSourceConfig: (id, { cadence_sec, rate_limit, enabled }) => stmts.setSourceConfig.run(cadence_sec, rate_limit, enabled ? 1 : 0, isoNow(), id),

    // THE FORGE — strategy/bot specs
    listStrategies: () => stmts.listStrategies.all().map((r) => ({ id: r.id, name: r.name, description: r.description, tags: safeDbJson(r.tags_json, []), folder: r.folder, source: r.source, summary: r.summary, metrics: safeDbJson(r.metrics_json, {}), version: r.version, createdAt: r.created_at, updatedAt: r.updated_at })),
    getStrategy: (id) => { const r = stmts.getStrategy.get(id); return r ? { id: r.id, name: r.name, description: r.description, tags: safeDbJson(r.tags_json, []), folder: r.folder, source: r.source, spec: safeDbJson(r.spec_json, null), summary: r.summary, metrics: safeDbJson(r.metrics_json, {}), version: r.version, createdAt: r.created_at, updatedAt: r.updated_at } : null; },
    saveStrategy: (s) => { const now = isoNow(); const existing = s.id ? stmts.getStrategy.get(s.id) : null; stmts.upsertStrategy.run({ id: s.id, name: s.name || "Untitled Strategy", description: s.description || "", tags_json: j(s.tags || []), folder: s.folder || "", source: s.source || "forms", spec_json: j(s.spec || {}), summary: s.summary || "", metrics_json: j(s.metrics || {}), version: s.version || 1, created_at: existing ? existing.created_at : now, updated_at: now }); return { id: s.id, updatedAt: now }; },
    deleteStrategy: (id) => stmts.deleteStrategy.run(id).changes > 0,
    countStrategies: () => stmts.listStrategies.all().length,
    listStrategiesByFolder: (folderId) => stmts.listStrategiesByFolder.all(folderId).map((r) => ({ id: r.id, name: r.name, description: r.description, tags: safeDbJson(r.tags_json, []), folder: r.folder, source: r.source, summary: r.summary, metrics: safeDbJson(r.metrics_json, {}), version: r.version, createdAt: r.created_at, updatedAt: r.updated_at })),

    // THE FORGE v3 — folders (a strategy = a folder of bots)
    listFolders: () => stmts.listFolders.all().map((r) => ({ id: r.id, name: r.name, description: r.description, kind: r.kind, codePath: r.code_path, meta: safeDbJson(r.meta_json, {}), createdBy: r.created_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at })),
    getFolder: (id) => { const r = stmts.getFolder.get(id); return r ? { id: r.id, name: r.name, description: r.description, kind: r.kind, codePath: r.code_path, meta: safeDbJson(r.meta_json, {}), createdBy: r.created_by, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at } : null; },
    saveFolder: (f) => { const now = isoNow(); const id = f.id || crypto.randomUUID(); const existing = stmts.getFolder.get(id); stmts.upsertFolder.run({ id, name: f.name || "Untitled Strategy", description: f.description || "", kind: f.kind || "strategy", code_path: f.codePath || "", meta_json: j(f.meta || {}), created_by: f.createdBy || "user", version: f.version || 1, created_at: existing ? existing.created_at : now, updated_at: now }); return { id, updatedAt: now }; },
    deleteFolder: (id) => stmts.deleteFolder.run(id).changes > 0,

    // variables (named DSL expressions)
    listVariables: () => stmts.listVariables.all().map(rowToVar),
    getVariable: (id) => { const r = stmts.getVariable.get(id); return r ? rowToVar(r) : null; },
    getVariableByName: (name) => { const r = stmts.getVariableByName.get(name); return r ? rowToVar(r) : null; },
    saveVariable: (v) => { const now = isoNow(); const id = v.id || crypto.randomUUID(); const existing = stmts.getVariable.get(id); stmts.upsertVariable.run({ id, name: v.name || "unnamed", expr: v.expr || "", kind: v.kind || "scalar", description: v.description || "", deps_json: j(v.deps || {}), used_by_json: j(v.usedBy || []), folder_id: v.folderId || "", created_by: v.createdBy || "user", version: v.version || 1, created_at: existing ? existing.created_at : now, updated_at: now }); return { id, updatedAt: now }; },
    deleteVariable: (id) => stmts.deleteVariable.run(id).changes > 0,

    // signals (reusable named conditions/indicators)
    listSignals: () => stmts.listSignals.all().map(rowToSignal),
    getSignal: (id) => { const r = stmts.getSignal.get(id); return r ? rowToSignal(r) : null; },
    getSignalByName: (name) => { const r = stmts.getSignalByName.get(name); return r ? rowToSignal(r) : null; },
    saveSignal: (s) => { const now = isoNow(); const id = s.id || crypto.randomUUID(); const existing = stmts.getSignal.get(id); stmts.upsertSignal.run({ id, name: s.name || "unnamed", expr: s.expr || "", description: s.description || "", code_path: s.codePath || "", deps_json: j(s.deps || {}), used_by_json: j(s.usedBy || []), folder_id: s.folderId || "", created_by: s.createdBy || "user", version: s.version || 1, created_at: existing ? existing.created_at : now, updated_at: now }); return { id, updatedAt: now }; },
    deleteSignal: (id) => stmts.deleteSignal.run(id).changes > 0,

    // deep-analysis reports (V8)
    saveReport: (r) => { const now = isoNow(); const id = r.id || crypto.randomUUID(); stmts.insertReport.run({ id, target_id: r.targetId, target_kind: r.targetKind || "strategy", name: r.name || "", metrics_json: j(r.metrics || {}), report_json: j(r.report || {}), engine_version: String(r.engineVersion || "1"), created_at: now }); return { id, createdAt: now }; },
    latestReport: (targetId) => { const r = stmts.latestReport.get(targetId); return r ? { id: r.id, targetId: r.target_id, targetKind: r.target_kind, name: r.name, metrics: safeDbJson(r.metrics_json, {}), report: safeDbJson(r.report_json, {}), engineVersion: r.engine_version, createdAt: r.created_at } : null; },
    listReports: (limit = 50) => stmts.listReports.all(limit).map((r) => ({ id: r.id, targetId: r.target_id, targetKind: r.target_kind, name: r.name, metrics: safeDbJson(r.metrics_json, {}), engineVersion: r.engine_version, createdAt: r.created_at })),

    // universe
    upsertUniverse: db.transaction((rows) => { const now = isoNow(); for (const r of rows) stmts.upsertUniverse.run({ ticker: r.ticker, name: r.name || "", asset_class: r.asset_class || "equity", sector: r.sector || "", industry: r.industry || "", exchange: r.exchange || "", is_crypto: r.is_crypto ? 1 : 0, cik: r.cik || "", updated_at: now }); return rows.length; }),
    countUniverse: () => stmts.countUniverse.get().n,

    // bars / quotes
    insertBars: db.transaction((ticker, tf, rows) => { for (const b of rows) stmts.insertBar.run({ ticker, tf, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? null, vwap: b.vwap ?? null }); return rows.length; }),
    getBars: (ticker, tf, limit = 200) => stmts.getBars.all(ticker, tf, limit).reverse(),
    upsertQuote: (q) => stmts.upsertQuote.run({ ticker: q.ticker, bid: q.bid ?? null, ask: q.ask ?? null, bid_sz: q.bid_sz ?? null, ask_sz: q.ask_sz ?? null, last: q.last ?? null, day_o: q.day_o ?? null, day_h: q.day_h ?? null, day_l: q.day_l ?? null, prev_c: q.prev_c ?? null, vol: q.vol ?? null, ts: q.ts || isoNow() }),
    getQuote: (ticker) => stmts.getQuote.get(ticker) || null,

    // news
    insertEvent: (e) => stmts.insertEvent.run({ id: e.id || crypto.randomUUID(), lane: e.lane, source: e.source, url: e.url, title: e.title, snippet: e.snippet || "", published_at: e.published_at || null, ingested_at: isoNow(), entities_json: j(e.entities || []), sentiment: e.sentiment ?? null, geo_json: j(e.geo || null), importance: e.importance ?? null, story_id: e.story_id || null }),
    upsertStory: (s) => stmts.upsertStory.run({ id: s.id || crypto.randomUUID(), cluster_key: s.cluster_key || "", title: s.title, sources_json: j(s.sources || []), article_count: s.article_count || 1, first_seen: s.first_seen || isoNow(), verify_score: s.verify_score || 0, impact_json: j(s.impact || {}), rank: s.rank || 0, pinned: s.pinned ? 1 : 0, decayed_at: s.decayed_at || null }),
    listStories: (limit = 50) => stmts.listStories.all(limit).map((r) => ({ ...r, sources: safeDbJson(r.sources_json, []), impact: safeDbJson(r.impact_json, {}) })),
    seedAlias: db.transaction((rows) => { for (const r of rows) stmts.upsertAlias.run(r.name, r.ticker, r.sector || ""); }),
    seedRules: db.transaction((rows) => { for (const r of rows) stmts.upsertRule.run({ id: r.id || crypto.randomUUID(), trigger: r.trigger, affected_json: j(r.affected || []), note: r.note || "" }); }),
    listAliases: () => stmts.listAliases.all(),
    listRules: () => stmts.listRules.all().map((r) => ({ ...r, affected: safeDbJson(r.affected_json, []) })),
    countAliases: () => { try { return stmts.countAliases.get().n; } catch { return 0; } },
    countRules: () => { try { return stmts.countRules.get().n; } catch { return 0; } },
    insertImpact: (i) => stmts.insertImpact.run({ id: i.id || crypto.randomUUID(), story_id: i.story_id, ticker: i.ticker || null, sector: i.sector || null, impact: i.impact ?? 0, sentiment_dir: i.sentiment_dir ?? 0, surprise: i.surprise ?? null, updated_at: isoNow() }),
    impactByTicker: (ticker, limit = 10) => stmts.impactByTicker.all(String(ticker || "").toUpperCase(), limit),
    decayOldStories: (ttlMinutes = 1440) => { try { const cutoff = new Date(Date.now() - ttlMinutes * 60000).toISOString(); return stmts.decayOldStories.run({ now: isoNow(), cutoff }).changes; } catch { return 0; } },
    pruneNoiseStories: () => { try { return stmts.pruneNoiseStories.run().changes; } catch { return 0; } },
    clearStories: () => { try { const a = stmts.clearStories.run().changes; stmts.clearImpact.run(); return a; } catch { return 0; } },
    countActiveStories: () => { try { return stmts.countActiveStories.get().n; } catch { return 0; } },

    // catalog (Jarvis file/table search)
    upsertCatalog: (c) => stmts.upsertCatalog.run({ id: c.id || crypto.randomUUID(), kind: c.kind, name: c.name, path: c.path || "", source: c.source || "", columns_json: j(c.columns || []), row_count: c.row_count ?? null, date_from: c.date_from || null, date_to: c.date_to || null, coverage_json: j(c.coverage || {}), summary: c.summary || "", updated_at: isoNow() }),
    searchCatalog: (query, limit = 20) => { const q = `%${query}%`; return stmts.searchCatalog.all(q, q, q, limit).map((r) => ({ ...r, columns: safeDbJson(r.columns_json, []), coverage: safeDbJson(r.coverage_json, {}) })); },
    getCatalog: (name) => { const r = stmts.getCatalog.get(name, name); return r ? { ...r, columns: safeDbJson(r.columns_json, []), coverage: safeDbJson(r.coverage_json, {}) } : null; },
    countBars: () => { try { return db.prepare("SELECT COUNT(*) AS n FROM apex_bars").get().n; } catch { return 0; } },
    clearBars: () => { try { return db.prepare("DELETE FROM apex_bars").run().changes; } catch { return 0; } },
    // Remove legacy/duplicate catalog rows that lack a stable id prefix (tbl:/file:).
    pruneCatalog: () => { try { db.prepare("DELETE FROM apex_catalog WHERE id NOT LIKE 'tbl:%' AND id NOT LIKE 'file:%'").run(); } catch { /* noop */ } },
    // Remove file: catalog rows not in the current keep-list (drops stale/removed local files).
    pruneFileCatalog: (keepNames = []) => { try { const keep = new Set(keepNames.map((n) => "file:" + n)); for (const r of db.prepare("SELECT id FROM apex_catalog WHERE id LIKE 'file:%'").all()) if (!keep.has(r.id)) db.prepare("DELETE FROM apex_catalog WHERE id=?").run(r.id); } catch { /* noop */ } },
    // Catalog APEX's own tables so Jarvis can discover + summarize them.
    snapshotCatalog: () => {
      const tables = [
        ["apex_universe", "US ticker universe (ticker · name · CIK) from SEC EDGAR"],
        ["apex_bars", "Historical OHLCV bars per ticker/timeframe (live + local CSV seed back to 2010)"],
        ["apex_quotes_live", "Latest quote per ticker (equities via Yahoo, crypto via Coinbase/Binance)"],
        ["apex_news_stories", "Clustered/ranked news stories from the news engine (GDELT + lanes)"],
        ["apex_sources", "Data-source registry — keys, cadence, tier, health"],
        ["apex_positions", "Virtual paper-trading positions"],
        ["apex_health_reports", "Data-health bot audit reports"],
      ];
      for (const [t, summary] of tables) {
        let n = 0, dfrom = null, dto = null;
        try { n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { /* table may be empty */ }
        if (t === "apex_bars") { try { const r = db.prepare("SELECT MIN(t) AS a, MAX(t) AS b FROM apex_bars").get(); dfrom = r.a; dto = r.b; } catch { /* noop */ } }
        stmts.upsertCatalog.run({ id: "tbl:" + t, kind: "table", name: t, path: "apex.sqlite", source: "apex", columns_json: "[]", row_count: n, date_from: dfrom, date_to: dto, coverage_json: "{}", summary, updated_at: isoNow() });
      }
    },

    // health bot
    insertHealthReport: (h) => { const id = crypto.randomUUID(); stmts.insertHealth.run({ id, ran_at: isoNow(), ok_count: h.ok_count || 0, degraded_count: h.degraded_count || 0, down_count: h.down_count || 0, report_json: j(h.report || []), analysis: h.analysis || "", fixes_json: j(h.fixes || []), status: h.status || "reported" }); return id; },
    latestHealthReport: () => { const r = stmts.latestHealth.get(); return r ? { ...r, report: safeDbJson(r.report_json, []), fixes: safeDbJson(r.fixes_json, []) } : null; },
  };
}

module.exports = { createApexDb, safeDbJson, SEED_SOURCES };
