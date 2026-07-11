// Arbiter persistence — logs every edge the scanner surfaces and grades them
// when the underlying market resolves, so the room can show a real track record
// (hit rate / calibration), not just live signals.
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

let db = null;

function initArbiterDB(runtimeDir) {
  if (db) return db;
  fs.mkdirSync(runtimeDir, { recursive: true });
  db = new DatabaseSync(path.join(runtimeDir, "arbiter.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS arbiter_edges (
      id            TEXT PRIMARY KEY,      -- category-polyMarketId
      category      TEXT,
      question      TEXT,
      first_seen    TEXT,
      last_seen     TEXT,
      entry_poly    INTEGER,               -- Polymarket YES cents at first sighting
      entry_edge    REAL,                  -- edge score at first sighting
      predicted_yes INTEGER,               -- 1 if JARVIS/edge favored YES over the market
      confidence    TEXT,
      signals       TEXT,
      times_seen    INTEGER DEFAULT 1,
      status        TEXT DEFAULT 'open',   -- open | resolved
      outcome       TEXT,                  -- YES | NO (when resolved)
      correct       INTEGER,               -- 1/0 once graded
      resolved_at   TEXT
    );
  `);
  ensureColumns();
  return db;
}

// Non-destructive migration: add the predicted-probability columns to DBs
// created before calibration tracking existed. Without the stored estimate you
// can grade win/loss but not calibration (predicted prob vs realized rate).
function ensureColumns() {
  const cols = new Set(db.prepare("PRAGMA table_info(arbiter_edges)").all().map((r) => r.name));
  const additions = [
    ["model_prob", "INTEGER"],      // JARVIS's YES estimate at first sighting
    ["sentiment_prob", "INTEGER"],  // news/social-implied YES prob
    ["vegas_prob", "INTEGER"],      // Vegas-implied YES prob (sports)
  ];
  for (const [name, type] of additions) {
    if (!cols.has(name)) db.exec(`ALTER TABLE arbiter_edges ADD COLUMN ${name} ${type}`);
  }
}

// Upsert edges from a scan. New edges are logged with entry prices; repeat
// sightings just bump last_seen / times_seen (entry snapshot is preserved).
function recordEdges(edges, nowIso) {
  if (!db || !edges?.length) return { insertedIds: [] };
  const exists = db.prepare("SELECT 1 FROM arbiter_edges WHERE id = ?");
  const insert = db.prepare(`
    INSERT INTO arbiter_edges (id, category, question, first_seen, last_seen, entry_poly, entry_edge, predicted_yes, confidence, signals, model_prob, sentiment_prob, vegas_prob)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, times_seen = times_seen + 1
  `);
  const insertedIds = [];
  const toProb = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  for (const e of edges) {
    const isNew = !exists.get(e.id);
    const predictedYes = e.modelProb != null
      ? (e.modelProb > e.polymarket ? 1 : 0)
      : (e.kalshi != null && e.kalshi < e.polymarket ? 1 : 0);
    insert.run(e.id, e.category, e.question, nowIso, nowIso, e.polymarket,
      e.edgeScore, predictedYes, e.confidence, (e.signals || []).join(","),
      toProb(e.modelProb), toProb(e.sentiment), toProb(e.vegas));
    if (isNew) insertedIds.push(e.id);
  }
  return { insertedIds };
}

function countRows() {
  return db.prepare("SELECT COUNT(*) c FROM arbiter_edges").get().c;
}

function markResolved(id, outcome, nowIso) {
  if (!db) return;
  const row = db.prepare("SELECT predicted_yes FROM arbiter_edges WHERE id = ?").get(id);
  if (!row) return;
  const outcomeYes = String(outcome).toUpperCase() === "YES";
  const correct = (row.predicted_yes === 1) === outcomeYes ? 1 : 0;
  db.prepare(`UPDATE arbiter_edges SET status='resolved', outcome=?, correct=?, resolved_at=? WHERE id=?`)
    .run(outcomeYes ? "YES" : "NO", correct, nowIso, id);
}

// Open edges (for the grader to check whether their markets have resolved).
function openEdges() {
  if (!db) return [];
  return db.prepare("SELECT id, question FROM arbiter_edges WHERE status='open'").all();
}

// Reliability data: bucket resolved edges by JARVIS's predicted YES probability
// and compare the average prediction in each band to how often those markets
// actually resolved YES. A well-calibrated model has predicted ≈ realized.
function calibration() {
  if (!db) return [];
  const rows = db.prepare(
    "SELECT model_prob AS p, outcome FROM arbiter_edges WHERE status='resolved' AND model_prob IS NOT NULL"
  ).all();
  const bands = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
  return bands.map(([lo, hi]) => {
    const inBand = rows.filter((r) => r.p >= lo && (hi === 100 ? r.p <= hi : r.p < hi));
    const n = inBand.length;
    if (!n) return { range: `${lo}-${hi}`, lo, hi, n: 0, predicted: null, realized: null };
    const predicted = Math.round(inBand.reduce((s, r) => s + r.p, 0) / n);
    const yes = inBand.filter((r) => String(r.outcome).toUpperCase() === "YES").length;
    return { range: `${lo}-${hi}`, lo, hi, n, predicted, realized: Math.round((yes / n) * 100) };
  }).filter((b) => b.n > 0);
}

// Per-category base rates for the LLM feedback loop: how the model's own past
// YES estimates compare to realized outcomes, so it can correct its bias.
// Only returns categories with at least `minN` resolved calls (below that the
// signal is noise, and the loop stays silent).
function baseRates({ minN = 15 } = {}) {
  if (!db) return {};
  const rows = db.prepare(
    "SELECT category, model_prob AS p, outcome FROM arbiter_edges WHERE status='resolved' AND model_prob IS NOT NULL"
  ).all();
  const byCat = {};
  for (const r of rows) (byCat[r.category || "other"] ||= []).push(r);
  const out = {};
  for (const [cat, arr] of Object.entries(byCat)) {
    if (arr.length < minN) continue;
    const avgPredicted = Math.round(arr.reduce((s, r) => s + r.p, 0) / arr.length);
    const realizedYesRate = Math.round(
      (arr.filter((r) => String(r.outcome).toUpperCase() === "YES").length / arr.length) * 100
    );
    out[cat] = { n: arr.length, avgPredicted, realizedYesRate, biasPoints: avgPredicted - realizedYesRate };
  }
  return out;
}

function scorecard() {
  if (!db) return { summary: {}, recent: [], calibration: [] };
  const total = countRows();
  const open = db.prepare("SELECT COUNT(*) c FROM arbiter_edges WHERE status='open'").get().c;
  const resolved = db.prepare("SELECT COUNT(*) c FROM arbiter_edges WHERE status='resolved'").get().c;
  const wins = db.prepare("SELECT COUNT(*) c FROM arbiter_edges WHERE correct=1").get().c;
  const avgEdge = db.prepare("SELECT AVG(entry_edge) a FROM arbiter_edges").get().a || 0;
  const byConf = db.prepare("SELECT confidence, COUNT(*) c FROM arbiter_edges GROUP BY confidence").all();
  const recent = db.prepare(`
    SELECT id, category, question, entry_poly, entry_edge, confidence, signals, status, outcome, correct, first_seen
    FROM arbiter_edges ORDER BY first_seen DESC LIMIT 40
  `).all();
  return {
    summary: {
      logged: total, open, resolved,
      hitRate: resolved ? Math.round((wins / resolved) * 100) : null,
      avgEdge: Math.round(avgEdge * 10) / 10,
      byConfidence: Object.fromEntries(byConf.map((r) => [r.confidence || "?", r.c])),
    },
    recent,
    calibration: calibration(),
  };
}

module.exports = { initArbiterDB, recordEdges, markResolved, openEdges, scorecard, calibration, baseRates };
