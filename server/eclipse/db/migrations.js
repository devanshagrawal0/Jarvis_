// ECLIPSE persistence — its OWN sqlite (runtime/eclipse.sqlite) so it never contends with the
// live jarvis-missions.sqlite the running server holds open. Task OS (mission-engine) stays the
// authority for mission STATUS; `mission_id` here soft-references missions.id. Idempotent:
// migrate() is CREATE TABLE IF NOT EXISTS + a versioned meta row. Safe to require() with the
// feature flag off (no connection opened until openEclipseDb/migrate is called).
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA_VERSION = 2;

const DDL = `
CREATE TABLE IF NOT EXISTS eclipse_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eclipse_graph_runs (
  graph_run_id TEXT PRIMARY KEY,
  mission_id   TEXT NOT NULL,              -- soft ref → Task OS missions.id
  graph_version TEXT NOT NULL,
  status       TEXT NOT NULL,              -- queued|running|paused|complete|failed|cancelled
  phase        TEXT,                        -- last EclipseState.phase mirrored for quick reads
  state_revision INTEGER NOT NULL DEFAULT 0,
  checkpoint_id TEXT,
  thread_id    TEXT,                        -- LangGraph thread_id (= graph_run_id)
  tokens       INTEGER NOT NULL DEFAULT 0,  -- mission-level ledger snapshot
  cost_usd     REAL NOT NULL DEFAULT 0,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_graph_runs_mission ON eclipse_graph_runs(mission_id);

-- Idempotency receipts: a side effect records its key here BEFORE (or as) it runs; on crash/
-- replay the guard sees the key and skips re-doing the effect. This is what makes "kill mid-node
-- → resume, no duplicate side effects" true rather than hoped-for.
CREATE TABLE IF NOT EXISTS eclipse_receipts (
  key        TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  node_id    TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_mission ON eclipse_receipts(mission_id);

CREATE TABLE IF NOT EXISTS eclipse_node_runs (
  node_run_id  TEXT PRIMARY KEY,
  graph_run_id TEXT NOT NULL,
  node_id      TEXT NOT NULL,
  attempt      INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL,
  lease_id     TEXT, model_id TEXT, interaction_id TEXT,
  input_hash   TEXT, output_hash TEXT, error_class TEXT,
  tokens       INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,
  started_at   TEXT, completed_at TEXT,
  UNIQUE(graph_run_id, node_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_node_runs_graph ON eclipse_node_runs(graph_run_id);

CREATE TABLE IF NOT EXISTS eclipse_events (
  event_id   TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  sequence   INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  UNIQUE(mission_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_events_mission ON eclipse_events(mission_id, sequence);

CREATE TABLE IF NOT EXISTS evidence_objects (
  evidence_id TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL,
  source_type TEXT NOT NULL,
  uri TEXT, local_path TEXT, locator_json TEXT,
  captured_at TEXT NOT NULL, published_at TEXT,
  content_hash TEXT NOT NULL,
  excerpt TEXT, metadata_json TEXT DEFAULT '{}',
  reliability_json TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_evidence_mission ON evidence_objects(mission_id);

CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  text TEXT NOT NULL, class TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0, status TEXT NOT NULL,
  quarantined INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_claims_mission ON claims(mission_id);

CREATE TABLE IF NOT EXISTS claim_evidence_edges (
  claim_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
  entailment REAL NOT NULL DEFAULT 0, quote_safe INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (claim_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS capability_leases (
  lease_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL, session_id TEXT NOT NULL, parent_lease_id TEXT,
  scopes_json TEXT DEFAULT '[]', resource_globs_json TEXT DEFAULT '[]',
  max_calls_json TEXT DEFAULT '{}', budget_tokens INTEGER DEFAULT 0, max_cost_usd REAL DEFAULT 0,
  expires_at TEXT NOT NULL, may_delegate INTEGER DEFAULT 0, side_effecting INTEGER DEFAULT 0,
  signature TEXT, revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leases_mission ON capability_leases(mission_id);

CREATE TABLE IF NOT EXISTS artifact_manifests (
  artifact_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL, version INTEGER DEFAULT 0,
  kind TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, sha256 TEXT, size_bytes INTEGER DEFAULT 0,
  source_claim_ids_json TEXT DEFAULT '[]', source_evidence_ids_json TEXT DEFAULT '[]',
  checks_json TEXT DEFAULT '[]', audience TEXT, style_profile TEXT,
  created_at TEXT NOT NULL, jarvis_visibility TEXT DEFAULT 'private'
);
CREATE INDEX IF NOT EXISTS idx_artifacts_mission ON artifact_manifests(mission_id);
`;

function openEclipseDb(runtimeDir) {
  const dbPath = path.join(runtimeDir || ".", "eclipse.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
}
function addColumnIfMissing(db, table, col, decl) {
  if (!hasColumn(db, table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

// Idempotent migration. Accepts a db instance (tests pass an in-memory/temp db). Creates
// missing tables (CREATE IF NOT EXISTS) and additively upgrades an older graph_runs table.
function migrate(db) {
  db.exec(DDL);
  // v1 → v2 additive columns on a pre-existing eclipse_graph_runs.
  addColumnIfMissing(db, "eclipse_graph_runs", "phase", "TEXT");
  addColumnIfMissing(db, "eclipse_graph_runs", "thread_id", "TEXT");
  addColumnIfMissing(db, "eclipse_graph_runs", "tokens", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "eclipse_graph_runs", "cost_usd", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "eclipse_graph_runs", "cancel_requested", "INTEGER NOT NULL DEFAULT 0");
  const cur = db.prepare("SELECT value FROM eclipse_meta WHERE key='schema_version'").get();
  if (!cur) db.prepare("INSERT INTO eclipse_meta(key, value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(cur.value) < SCHEMA_VERSION) db.prepare("UPDATE eclipse_meta SET value=? WHERE key='schema_version'").run(String(SCHEMA_VERSION));
  return { schemaVersion: SCHEMA_VERSION };
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
}

module.exports = { SCHEMA_VERSION, DDL, openEclipseDb, migrate, tableNames };
