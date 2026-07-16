// APEX Oracle — SQLite persistence (better-sqlite3). Stores every prediction, resolves them
// against realized bars, and maintains per-symbol/per-horizon calibration state.

const path = require("path");
const Database = require("better-sqlite3");

function createOracleStore(runtimeDir) {
  const db = new Database(path.join(runtimeDir, "apex-oracle.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL, horizon TEXT NOT NULL,
      made_at INTEGER NOT NULL, target_time INTEGER NOT NULL,
      spot_at_make REAL NOT NULL,
      regime TEXT, regime_conf REAL, direction TEXT, edge REAL, p_up REAL, size_frac REAL,
      pred_price REAL, p05 REAL, p25 REAL, p50 REAL, p75 REAL, p95 REAL,
      mu_bar REAL, sigma_bar REAL, tau REAL, sigma_h REAL, confidence REAL, cross_score REAL,
      inputs_json TEXT, option_json TEXT, model_ver TEXT, resolved INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS ix_pred_open ON predictions(resolved, target_time);
    CREATE INDEX IF NOT EXISTS ix_pred_sym ON predictions(symbol, horizon, made_at);
    CREATE TABLE IF NOT EXISTS outcomes (
      pred_id INTEGER PRIMARY KEY REFERENCES predictions(id),
      resolved_at INTEGER, realized_price REAL, realized_ret REAL,
      hit INTEGER, abs_pct_err REAL, signed_err REAL, brier REAL,
      pinball REAL, cov50 INTEGER, cov90 INTEGER, option_pnl REAL, crps REAL
    );
    CREATE TABLE IF NOT EXISTS calibration (
      symbol TEXT, horizon TEXT,
      bias_ewma REAL DEFAULT 0, drift_mult REAL DEFAULT 1, vol_mult REAL DEFAULT 1,
      hit_rate REAL DEFAULT 0.5, mean_brier REAL DEFAULT 0.25, mean_pinball REAL DEFAULT 0,
      cov90 REAL DEFAULT 0.9, platt_a REAL DEFAULT 1, platt_b REAL DEFAULT 0,
      n_samples INTEGER DEFAULT 0, updated_at INTEGER,
      PRIMARY KEY (symbol, horizon)
    );
    CREATE TABLE IF NOT EXISTS relations (
      symbol TEXT, related TEXT, kind TEXT,
      corr REAL, beta REAL, lead_lag INTEGER, source TEXT, updated_at INTEGER,
      PRIMARY KEY (symbol, related, kind)
    );
    CREATE TABLE IF NOT EXISTS feature_cache (symbol TEXT, key TEXT, val_json TEXT, ts INTEGER, PRIMARY KEY(symbol,key));
  `);

  const insPred = db.prepare(`INSERT INTO predictions
    (symbol,horizon,made_at,target_time,spot_at_make,regime,regime_conf,direction,edge,p_up,size_frac,
     pred_price,p05,p25,p50,p75,p95,mu_bar,sigma_bar,tau,sigma_h,confidence,cross_score,inputs_json,option_json,model_ver)
    VALUES (@symbol,@horizon,@made_at,@target_time,@spot_at_make,@regime,@regime_conf,@direction,@edge,@p_up,@size_frac,
     @pred_price,@p05,@p25,@p50,@p75,@p95,@mu_bar,@sigma_bar,@tau,@sigma_h,@confidence,@cross_score,@inputs_json,@option_json,@model_ver)`);
  const insOutcome = db.prepare(`INSERT OR REPLACE INTO outcomes
    (pred_id,resolved_at,realized_price,realized_ret,hit,abs_pct_err,signed_err,brier,pinball,cov50,cov90,option_pnl,crps)
    VALUES (@pred_id,@resolved_at,@realized_price,@realized_ret,@hit,@abs_pct_err,@signed_err,@brier,@pinball,@cov50,@cov90,@option_pnl,@crps)`);
  const markResolved = db.prepare(`UPDATE predictions SET resolved=1 WHERE id=?`);
  const getCal = db.prepare(`SELECT * FROM calibration WHERE symbol=? AND horizon=?`);
  const upsertCal = db.prepare(`INSERT INTO calibration (symbol,horizon,bias_ewma,drift_mult,vol_mult,hit_rate,mean_brier,mean_pinball,cov90,platt_a,platt_b,n_samples,updated_at)
    VALUES (@symbol,@horizon,@bias_ewma,@drift_mult,@vol_mult,@hit_rate,@mean_brier,@mean_pinball,@cov90,@platt_a,@platt_b,@n_samples,@updated_at)
    ON CONFLICT(symbol,horizon) DO UPDATE SET bias_ewma=@bias_ewma,drift_mult=@drift_mult,vol_mult=@vol_mult,hit_rate=@hit_rate,mean_brier=@mean_brier,mean_pinball=@mean_pinball,cov90=@cov90,platt_a=@platt_a,platt_b=@platt_b,n_samples=@n_samples,updated_at=@updated_at`);
  const dueQ = db.prepare(`SELECT * FROM predictions WHERE resolved=0 AND target_time<=? ORDER BY target_time ASC LIMIT 200`);
  const histQ = db.prepare(`SELECT p.*, o.realized_price, o.hit, o.abs_pct_err, o.brier, o.option_pnl, o.resolved_at
    FROM predictions p LEFT JOIN outcomes o ON o.pred_id=p.id WHERE p.symbol=? ORDER BY p.made_at DESC LIMIT ?`);
  const relQ = db.prepare(`SELECT * FROM relations WHERE symbol=? ORDER BY ABS(corr) DESC`);
  const upsertRel = db.prepare(`INSERT INTO relations (symbol,related,kind,corr,beta,lead_lag,source,updated_at)
    VALUES (@symbol,@related,@kind,@corr,@beta,@lead_lag,@source,@updated_at)
    ON CONFLICT(symbol,related,kind) DO UPDATE SET corr=@corr,beta=@beta,lead_lag=@lead_lag,source=@source,updated_at=@updated_at`);
  const cacheGet = db.prepare(`SELECT val_json,ts FROM feature_cache WHERE symbol=? AND key=?`);
  const cacheSet = db.prepare(`INSERT INTO feature_cache (symbol,key,val_json,ts) VALUES (?,?,?,?) ON CONFLICT(symbol,key) DO UPDATE SET val_json=excluded.val_json, ts=excluded.ts`);

  return {
    db,
    insertPrediction: (row) => insPred.run(row).lastInsertRowid,
    insertOutcome: (row) => insOutcome.run(row),
    resolve: (id) => markResolved.run(id),
    getCalibration: (symbol, horizon) => getCal.get(symbol, horizon) || null,
    saveCalibration: (row) => upsertCal.run(row),
    duePredictions: (now) => dueQ.all(now),
    history: (symbol, limit = 60) => histQ.all(symbol, limit),
    relations: (symbol) => relQ.all(symbol),
    saveRelation: (row) => upsertRel.run(row),
    cacheGet: (symbol, key, maxAgeMs) => { const r = cacheGet.get(symbol, key); if (!r) return null; if (maxAgeMs && Date.now() - r.ts > maxAgeMs) return null; try { return JSON.parse(r.val_json); } catch { return null; } },
    cacheSet: (symbol, key, val, ts) => cacheSet.run(symbol, key, JSON.stringify(val), ts || Date.now()),
    stats: () => ({ predictions: db.prepare("SELECT COUNT(*) n FROM predictions").get().n, resolved: db.prepare("SELECT COUNT(*) n FROM predictions WHERE resolved=1").get().n }),
  };
}

module.exports = { createOracleStore };
