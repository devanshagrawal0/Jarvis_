const path = require("path");
const Database = require("better-sqlite3");

// Ebbinghaus decay: effective_priority = importance × e^(−days_since_access / half_life)
const HALF_LIFE_BY_KIND = {
  episodic: 14,
  conversation: 14,
  working_memory: 2,
  observation: 30,
  semantic: 90,
  fact: 90,
  entity_fact: 90,
  project_context: 60,
  decision: 45,
  correction: 120,
  user_preference: 180,
  procedural: 999999,
};

const DEFAULT_HALF_LIFE = 60;

// Contradiction detection threshold — ms_memories with normalized_text overlap above this are checked
const CONTRADICTION_SIMILARITY_TERMS = 3;

function daysSince(isoDate) {
  if (!isoDate) return 30;
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24));
}

const ALLOWED_TABLES = new Set(["ms_memories", "ms_memory_terms", "ms_memory_events", "ms_memory_entities", "ms_working_memory", "memories", "entities", "relationships", "memory_entities"]);
const ALLOWED_COLUMNS = /^[a-z_][a-z0-9_]{0,59}$/;

function addColumnIfMissing(db, table, column, definition) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`addColumnIfMissing: unknown table "${table}"`);
  if (!ALLOWED_COLUMNS.test(column)) throw new Error(`addColumnIfMissing: invalid column "${column}"`);
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!exists) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // table may not exist yet; skip silently
    }
  }
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function createMemoryDecayEngine({ runtimeDir, intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  let timer = null;
  let lastRunAt = null;

  function ensureColumns(db) {
    // ms_memories (from memory-store.js)
    if (tableExists(db, "ms_memories")) {
      addColumnIfMissing(db, "ms_memories", "effective_priority", "REAL DEFAULT 1.0");
      addColumnIfMissing(db, "ms_memories", "last_accessed_at", "TEXT");
    }
    // memories (from neural-vault.js)
    if (tableExists(db, "memories")) {
      addColumnIfMissing(db, "memories", "effective_priority", "REAL DEFAULT 1.0");
      addColumnIfMissing(db, "memories", "access_count", "INTEGER DEFAULT 0");
    }
  }

  // scale: "1-10" for memories table (importance 1–10), "0-1" for ms_memories (importance 0–1)
  function runDecayOnTable(db, table, importanceCol, kindCol, accessedCol, updatedCol, activeClause = "1=1", scale = "auto") {
    if (!tableExists(db, table)) return { updated: 0 };
    const rows = db.prepare(`
      SELECT id, ${kindCol} AS kind, ${importanceCol} AS importance,
             ${accessedCol} AS accessed_at, ${updatedCol} AS updated_at
      FROM ${table}
      WHERE ${activeClause}
    `).all();

    const updateStmt = db.prepare(`UPDATE ${table} SET effective_priority = ? WHERE id = ?`);
    const now = new Date().toISOString();
    let updated = 0;
    const doUpdates = db.transaction(() => {
      for (const row of rows) {
        const halfLife = HALF_LIFE_BY_KIND[row.kind] ?? DEFAULT_HALF_LIFE;
        const lastAccess = row.accessed_at || row.updated_at;
        const days = daysSince(lastAccess);
        const importance = Number(row.importance ?? 1);
        // Normalize to 0–1: memories table uses 1–10 integers, ms_memories uses 0–1 floats.
        // Previously `importance > 1` was used but failed for importance=1 (minimum on 1–10 scale).
        let normalizedImportance;
        if (scale === "1-10") {
          normalizedImportance = Math.max(0, Math.min(10, importance)) / 10;
        } else if (scale === "0-1") {
          normalizedImportance = Math.max(0, Math.min(1, importance));
        } else {
          // auto: treat any value > 1.0 as 1–10 scale; 0–1 otherwise
          normalizedImportance = importance > 1 ? Math.min(10, importance) / 10 : Math.max(0, Math.min(1, importance));
        }
        const effectivePriority = normalizedImportance * Math.exp(-days / halfLife);
        updateStmt.run(Math.round(effectivePriority * 10000) / 10000, row.id);
        updated++;
      }
    });
    doUpdates();
    return { updated };
  }

  function detectContradictions(db) {
    if (!tableExists(db, "ms_memories")) return { flagged: 0 };
    // Find pairs within same kind+category where one supersedes another but is newer with high confidence
    // Simple approach: find active memories in same category that have very similar term overlap
    const candidates = db.prepare(`
      SELECT id, kind, category, normalized_text, importance, confidence, created_at
      FROM ms_memories
      WHERE deleted_at IS NULL AND kind IN ('semantic', 'procedural')
      ORDER BY category, kind, updated_at DESC
    `).all();

    const byGroup = new Map();
    for (const row of candidates) {
      const key = `${row.kind}::${row.category}`;
      const group = byGroup.get(key) || [];
      group.push(row);
      byGroup.set(key, group);
    }

    let flagged = 0;
    const flagStmt = db.prepare(`
      UPDATE ms_memories SET metadata_json = json_set(COALESCE(metadata_json, '{}'), '$.possibleContradiction', 1, '$.contradictionCheckedAt', ?)
      WHERE id = ?
    `);
    const doFlag = db.transaction(() => {
      for (const [, group] of byGroup) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length && j < i + 5; j++) {
            const a = group[i];
            const b = group[j];
            if (a.id === b.id) continue;
            // Check term overlap between normalized texts
            const termsA = new Set(String(a.normalized_text || "").split(" ").filter((t) => t.length > 3));
            const termsB = new Set(String(b.normalized_text || "").split(" ").filter((t) => t.length > 3));
            let overlap = 0;
            for (const term of termsA) if (termsB.has(term)) overlap++;
            if (overlap >= CONTRADICTION_SIMILARITY_TERMS && a.normalized_text !== b.normalized_text) {
              // The older one with lower confidence may be contradicted by the newer higher-confidence one
              const older = a.created_at < b.created_at ? a : b;
              flagStmt.run(new Date().toISOString(), older.id);
              flagged++;
            }
          }
        }
      }
    });
    doFlag();
    return { flagged };
  }

  function run() {
    let db;
    try {
      db = new Database(dbPath);
      ensureColumns(db);
      const msResult = runDecayOnTable(db, "ms_memories", "importance", "kind", "last_accessed_at", "updated_at", "deleted_at IS NULL", "0-1");
      const nvResult = runDecayOnTable(db, "memories", "importance", "kind", "last_accessed_at", "updated_at", "status IS NULL OR status = 'active'", "1-10");
      const contResult = detectContradictions(db);
      lastRunAt = new Date().toISOString();
      return {
        ok: true,
        ranAt: lastRunAt,
        ms_memories: msResult,
        memories: nvResult,
        contradictions: contResult,
      };
    } catch (err) {
      return { ok: false, error: err.message, ranAt: new Date().toISOString() };
    } finally {
      try { db?.close(); } catch {}
    }
  }

  function start() {
    // Run once on startup (deferred by 30s to let DB settle)
    const startupTimer = setTimeout(() => run(), 30_000);
    startupTimer.unref?.();
    timer = setInterval(() => run(), intervalMs);
    timer.unref?.();
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { run, start, stop, status: () => ({ lastRunAt, intervalMs, dbPath }) };
}

module.exports = { createMemoryDecayEngine };
