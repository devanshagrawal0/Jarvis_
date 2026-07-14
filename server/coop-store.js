// Synapse (Co-Op) durable store — W0 foundation substrate.
// Replaces the JSON-file persistence in coop-symbiote.js with a single better-sqlite3
// database (WAL). Each session is its OWN row (not an entry in a rewritten array), which
// removes the whole-array-rewrite lost-update bug and the hard 20-session cap. Adds a
// `version` column (optimistic concurrency), an atomic `mutateSession` read-modify-write,
// a DB-backed join-attempt limiter, an idempotency table, and events.jsonl rotation.
//
// CommonJS, synchronous (better-sqlite3), atomic single-statement upserts. On first open it
// migrates any legacy state.json + sessions/*.json into the DB so no existing session is lost.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

function openCoopStore({
  dbPath,
  legacyStatePath = "",
  legacySessionsDir = "",
  eventsPath = "",
  maxEventsBytes = 5 * 1024 * 1024,
} = {}) {
  if (!dbPath) throw new Error("openCoopStore requires dbPath");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS coop_sessions (
      id         TEXT PRIMARY KEY,
      status     TEXT,
      code_hash  TEXT,
      created_at TEXT,
      updated_at TEXT,
      expires_at TEXT,
      version    INTEGER NOT NULL DEFAULT 1,
      data       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_coop_sessions_updated ON coop_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_coop_sessions_code    ON coop_sessions(code_hash);

    CREATE TABLE IF NOT EXISTS coop_attempts (
      id        TEXT PRIMARY KEY,
      code_hash TEXT,
      at        TEXT,
      at_ms     INTEGER,
      peer_name TEXT,
      ip        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_coop_attempts_ms   ON coop_attempts(at_ms DESC);
    CREATE INDEX IF NOT EXISTS idx_coop_attempts_code ON coop_attempts(code_hash);
    CREATE INDEX IF NOT EXISTS idx_coop_attempts_ip   ON coop_attempts(ip);

    CREATE TABLE IF NOT EXISTS coop_idempotency (
      key        TEXT PRIMARY KEY,
      result     TEXT,
      created_at TEXT
    );
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO coop_sessions (id,status,code_hash,created_at,updated_at,expires_at,version,data)
      VALUES (@id,@status,@code_hash,@created_at,@updated_at,@expires_at,@version,@data)
      ON CONFLICT(id) DO UPDATE SET
        status=@status, code_hash=@code_hash, updated_at=@updated_at,
        expires_at=@expires_at, version=@version, data=@data`),
    get: db.prepare(`SELECT data FROM coop_sessions WHERE id=?`),
    list: db.prepare(`SELECT data FROM coop_sessions ORDER BY updated_at DESC LIMIT ?`),
    listAll: db.prepare(`SELECT data FROM coop_sessions ORDER BY updated_at DESC`),
    count: db.prepare(`SELECT COUNT(*) AS n FROM coop_sessions`),
    insertAttempt: db.prepare(`
      INSERT OR REPLACE INTO coop_attempts (id,code_hash,at,at_ms,peer_name,ip)
      VALUES (@id,@code_hash,@at,@at_ms,@peer_name,@ip)`),
    attemptsByCode: db.prepare(`SELECT COUNT(*) AS n FROM coop_attempts WHERE code_hash=? AND at_ms>?`),
    attemptsByIp: db.prepare(`SELECT COUNT(*) AS n FROM coop_attempts WHERE ip=? AND ip<>'' AND at_ms>?`),
    attemptsGlobal: db.prepare(`SELECT COUNT(*) AS n FROM coop_attempts WHERE at_ms>?`),
    pruneAttempts: db.prepare(`DELETE FROM coop_attempts WHERE at_ms<?`),
    idemGet: db.prepare(`SELECT result FROM coop_idempotency WHERE key=?`),
    idemPut: db.prepare(`INSERT OR REPLACE INTO coop_idempotency (key,result,created_at) VALUES (?,?,?)`),
  };

  function rowFrom(session) {
    return {
      id: session.id,
      status: session.status || "",
      code_hash: session.codeHash || "",
      created_at: session.createdAt || "",
      updated_at: session.updatedAt || session.createdAt || "",
      expires_at: session.expiresAt || "",
      version: session.version || 1,
      data: JSON.stringify(session),
    };
  }

  // Insert-or-update a whole session, bumping its version. Single statement → atomic.
  function saveSession(session) {
    const next = { ...session, version: (session.version || 0) + 1 };
    stmts.upsert.run(rowFrom(next));
    return next;
  }

  function getSession(id) {
    const row = stmts.get.get(id);
    return row ? JSON.parse(row.data) : null;
  }

  // Atomic read-modify-write inside a transaction: no lost updates even under concurrent
  // mutations of the same session. `updater` mutates the session in place. When the session
  // is missing: throw 404 if required, else return null (used by the event logger).
  const mutateSession = db.transaction((id, updater, required) => {
    const row = stmts.get.get(id);
    if (!row) {
      if (required) throw Object.assign(new Error("Co-op session not found."), { statusCode: 404 });
      return null;
    }
    const session = JSON.parse(row.data);
    updater(session);
    const next = { ...session, version: (session.version || 0) + 1 };
    stmts.upsert.run(rowFrom(next));
    return next;
  });

  function listSessions(limit) {
    const rows = limit ? stmts.list.all(limit) : stmts.listAll.all();
    return rows.map((r) => JSON.parse(r.data));
  }

  function countSessions() {
    return stmts.count.get().n;
  }

  // --- join-attempt limiter (DB-backed; per-code today, per-IP/global ready for W2) ---
  function recordAttempt(attempt) {
    stmts.insertAttempt.run({
      id: attempt.id || crypto.randomUUID(),
      code_hash: attempt.codeHash || "",
      at: attempt.at || new Date().toISOString(),
      at_ms: attempt.at ? (Date.parse(attempt.at) || Date.now()) : Date.now(),
      peer_name: attempt.peerName || "",
      ip: attempt.ip || "",
    });
    stmts.pruneAttempts.run(Date.now() - 24 * 60 * 60 * 1000);
  }

  function countAttempts({ codeHash = "", ip = "", windowMs = 60_000 } = {}) {
    const since = Date.now() - windowMs;
    return {
      byCode: codeHash ? stmts.attemptsByCode.get(codeHash, since).n : 0,
      byIp: ip ? stmts.attemptsByIp.get(ip, since).n : 0,
      global: stmts.attemptsGlobal.get(since).n,
    };
  }

  // --- idempotency: a retried mutation with the same key returns the first result ---
  function withIdempotency(key, fn) {
    if (!key) return fn();
    const existing = stmts.idemGet.get(key);
    if (existing) return JSON.parse(existing.result);
    const result = fn();
    stmts.idemPut.run(key, JSON.stringify(result === undefined ? null : result), new Date().toISOString());
    return result;
  }

  // --- append-only event log with size-based rotation ---
  function appendEvent(event) {
    if (!eventsPath) return;
    fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
    try {
      const st = fs.statSync(eventsPath);
      if (st.size > maxEventsBytes) {
        fs.renameSync(eventsPath, eventsPath.replace(/\.jsonl$/i, `-${Date.now()}.jsonl`));
      }
    } catch { /* no log file yet */ }
    fs.appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  // --- one-time migration from the legacy JSON store (no data loss on upgrade) ---
  function migrateLegacy() {
    if (countSessions() > 0) return;
    const imported = new Set();
    const readJsonSafe = (file) => {
      try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { return null; }
    };
    if (legacyStatePath && fs.existsSync(legacyStatePath)) {
      const st = readJsonSafe(legacyStatePath);
      if (st) {
        for (const s of st.sessions || []) if (s && s.id) { saveSession(s); imported.add(s.id); }
        for (const a of st.attempts || []) if (a && a.codeHash) recordAttempt(a);
      }
    }
    if (legacySessionsDir && fs.existsSync(legacySessionsDir)) {
      for (const file of fs.readdirSync(legacySessionsDir)) {
        if (!file.endsWith(".json")) continue;
        const s = readJsonSafe(path.join(legacySessionsDir, file));
        if (s && s.id && !imported.has(s.id)) { saveSession(s); imported.add(s.id); }
      }
    }
  }
  migrateLegacy();

  return {
    db,
    saveSession,
    getSession,
    mutateSession,
    listSessions,
    countSessions,
    recordAttempt,
    countAttempts,
    withIdempotency,
    appendEvent,
  };
}

module.exports = { openCoopStore };
