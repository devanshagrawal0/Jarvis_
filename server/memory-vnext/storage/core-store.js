"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createKeyring } = require("./keyring");
const { MIGRATIONS } = require("./migrations");
const { ensureProtectedRuntimePath } = require("./paths");

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inspectSqliteSnapshot(filePath, { sampleLimit = 8 } = {}) {
  const verifier = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const schemaVersion = Number(verifier.pragma("user_version", { simple: true }));
    const samples = verifier.prepare("SELECT id,content_mac FROM encrypted_objects ORDER BY id LIMIT ?").all(Math.max(0, Math.min(64, Number(sampleLimit) || 0)));
    return {
      quickCheck: String(verifier.pragma("quick_check", { simple: true })),
      integrityCheck: String(verifier.pragma("integrity_check", { simple: true })),
      foreignKeyViolations: verifier.pragma("foreign_key_check").length,
      schemaVersion,
      canonicalSequence: Number(verifier.prepare("SELECT value FROM sequence_state WHERE name='canonical'").get()?.value || 0),
      sqliteVersion: verifier.prepare("SELECT sqlite_version() AS version").get().version,
      tableCount: Number(verifier.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count),
      migrationCount: Number(verifier.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count),
      ownerActor: Boolean(verifier.prepare("SELECT 1 FROM actors WHERE id='local-owner' AND status='active'").get()),
      ownerScope: Boolean(verifier.prepare("SELECT 1 FROM scopes WHERE id='owner:local' AND status='active'").get()),
      encryptedObjectSample: samples,
    };
  } finally { verifier.close(); }
}

function resolveClosedSnapshot(filePath, allowedRoots = []) {
  const requested = path.resolve(String(filePath || ""));
  if (!path.isAbsolute(requested) || /-(?:wal|shm)$/i.test(requested) || path.basename(requested).toLowerCase() === "memory-vnext.sqlite") {
    throw Object.assign(new Error("Only a closed legacy SQLite snapshot may be inspected."), { code: "LEGACY_SNAPSHOT_UNSAFE" });
  }
  const resolved = fs.realpathSync(requested);
  const roots = allowedRoots.map((root) => fs.realpathSync(path.resolve(String(root))));
  if (!roots.length || !roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    throw Object.assign(new Error("Legacy snapshot is outside the approved snapshot roots."), { code: "LEGACY_SNAPSHOT_ROOT_DENIED" });
  }
  if (!fs.statSync(resolved).isFile()) throw new Error("Legacy snapshot must be a regular file.");
  return resolved;
}

function legacySnapshotTableInfo(filePath, { allowedRoots = [] } = {}) {
  const resolved = resolveClosedSnapshot(filePath, allowedRoots);
  const snapshot = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = String(snapshot.pragma("quick_check", { simple: true }));
    if (quickCheck !== "ok") throw Object.assign(new Error("Legacy snapshot failed SQLite quick_check."), { code: "LEGACY_SNAPSHOT_CORRUPT" });
    const tables = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return {
      path: resolved,
      sha256: sha256File(resolved),
      quickCheck,
      tables: tables.map(({ name }) => ({
        name,
        rowCount: Number(snapshot.prepare(`SELECT COUNT(*) AS count FROM \"${String(name).replaceAll('"', '""')}\"`).get().count),
        columns: snapshot.prepare(`PRAGMA table_info(\"${String(name).replaceAll('"', '""')}\")`).all().map((column) => String(column.name)),
      })),
    };
  } finally { snapshot.close(); }
}

function readLegacySnapshotTable(filePath, { allowedRoots = [], table, columns = [], limit = 500, offset = 0 } = {}) {
  const resolved = resolveClosedSnapshot(filePath, allowedRoots);
  const snapshot = new Database(resolved, { readonly: true, fileMustExist: true });
  try {
    if (String(snapshot.pragma("quick_check", { simple: true })) !== "ok") throw Object.assign(new Error("Legacy snapshot failed SQLite quick_check."), { code: "LEGACY_SNAPSHOT_CORRUPT" });
    const tableName = String(table || "");
    const availableTable = snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    if (!availableTable) throw Object.assign(new Error("Legacy snapshot table is unavailable."), { code: "LEGACY_TABLE_UNAVAILABLE" });
    const availableColumns = new Set(snapshot.prepare(`PRAGMA table_info(\"${tableName.replaceAll('"', '""')}\")`).all().map((column) => String(column.name)));
    const selected = columns.length ? columns.map(String) : [...availableColumns];
    if (!selected.length || selected.some((column) => !availableColumns.has(column))) throw Object.assign(new Error("Legacy snapshot column selection is invalid."), { code: "LEGACY_COLUMN_DENIED" });
    const quote = (identifier) => `\"${identifier.replaceAll('"', '""')}\"`;
    const boundedLimit = Math.max(1, Math.min(5_000, Number(limit) || 500));
    const boundedOffset = Math.max(0, Number(offset) || 0);
    return {
      path: resolved,
      table: tableName,
      columns: selected,
      totalRows: Number(snapshot.prepare(`SELECT COUNT(*) AS count FROM ${quote(tableName)}`).get().count),
      rows: snapshot.prepare(`SELECT ${selected.map(quote).join(",")} FROM ${quote(tableName)} LIMIT ? OFFSET ?`).all(boundedLimit, boundedOffset),
    };
  } finally { snapshot.close(); }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

function acquireOwnership(rootDir, clock) {
  const lockPath = path.join(rootDir, "core-writer.lock.json");
  const token = crypto.randomUUID();
  const data = { pid: process.pid, token, acquiredAt: clock().toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return {
        lockPath,
        release() {
          try {
            const current = JSON.parse(fs.readFileSync(lockPath, "utf8"));
            if (current.token === token) fs.unlinkSync(lockPath);
          } catch {}
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch {}
      if (existing && isProcessAlive(Number(existing.pid))) throw new Error("Memory vNext core already has an active writer owner.");
      const stalePath = `${lockPath}.stale.${clock().toISOString().replace(/[:.]/g, "-")}`;
      fs.renameSync(lockPath, stalePath);
    }
  }
  throw new Error("Could not acquire Memory vNext writer ownership.");
}

function configureDatabase(db, { busyTimeoutMs, synchronous }) {
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${Math.max(100, Math.min(60_000, Number(busyTimeoutMs) || 5_000))}`);
  db.pragma("journal_mode = WAL");
  db.pragma(`synchronous = ${synchronous === "NORMAL" ? "NORMAL" : "FULL"}`);
  db.pragma("wal_autocheckpoint = 1000");
  db.pragma("trusted_schema = OFF");
}

async function backupBeforeMigration(db, rootDir, sourceVersion, targetVersion, clock) {
  const backupDir = path.join(rootDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const stamp = clock().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `pre-migration-v${sourceVersion}-to-v${targetVersion}-${stamp}.sqlite`);
  await db.backup(backupPath);
  const verifier = new Database(backupPath, { readonly: true, fileMustExist: true });
  let quickCheck;
  try { quickCheck = String(verifier.pragma("quick_check", { simple: true })); } finally { verifier.close(); }
  if (quickCheck !== "ok") throw new Error("Pre-migration backup failed SQLite quick_check.");
  return { id: crypto.randomUUID(), path: backupPath, sha256: sha256File(backupPath), quickCheck, sourceVersion, targetVersion, createdAt: clock().toISOString() };
}

function migrationChecksum(migration) {
  return crypto.createHash("sha256").update(`${migration.version}:${migration.wave}:${migration.name}:${migration.up.toString()}`).digest("hex");
}

async function openCoreStore(options = {}) {
  const profileEnabled = process.env.JARVIS_PROFILE_STARTUP === "1";
  const profileStartedAt = Date.now();
  let profileMark = profileStartedAt;
  const profile = (label) => {
    if (!profileEnabled) return;
    const current = Date.now();
    console.log(`[startup-profile] memory core ${label}: +${current - profileMark}ms (total ${current - profileStartedAt}ms)`);
    profileMark = current;
  };
  const clock = options.clock || (() => new Date());
  const rootDir = ensureProtectedRuntimePath(options.runtimeDir, options);
  const ownership = acquireOwnership(rootDir, clock);
  profile("path and ownership");
  const dbPath = path.join(rootDir, "memory-vnext.sqlite");
  const existed = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  let db;
  let keyring;
  try {
    db = new Database(dbPath);
    configureDatabase(db, { busyTimeoutMs: options.busyTimeoutMs, synchronous: options.synchronous });
    profile("database open and pragmas");
    const quickBefore = String(db.pragma("quick_check", { simple: true }));
    profile("pre-open quick_check");
    if (quickBefore !== "ok") throw new Error("Memory vNext core failed pre-open quick_check.");
    const currentVersion = Number(db.pragma("user_version", { simple: true })) || 0;
    const latestVersion = MIGRATIONS[MIGRATIONS.length - 1].version;
    const targetVersion = options.targetVersion == null ? latestVersion : Number(options.targetVersion);
    if (!Number.isInteger(targetVersion) || targetVersion < currentVersion || targetVersion > latestVersion) {
      throw new Error("Invalid Memory vNext migration target.");
    }
    const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion && migration.version <= targetVersion);
    let backup = null;
    if (existed && pending.length) backup = await backupBeforeMigration(db, rootDir, currentVersion, targetVersion, clock);
    for (const migration of pending) {
      const apply = db.transaction(() => {
        options.faultInjector?.(`migration.${migration.version}.before_up`);
        migration.up(db);
        db.prepare("INSERT INTO schema_migrations(version,wave,name,applied_at,checksum) VALUES(?,?,?,?,?)")
          .run(migration.version, migration.wave, migration.name, clock().toISOString(), migrationChecksum(migration));
        db.pragma(`user_version = ${migration.version}`);
        options.faultInjector?.(`migration.${migration.version}.before_commit`);
      });
      apply.immediate();
    }
    profile("migration checks");
    if (targetVersion >= 1) {
      const now = clock().toISOString();
      const bootstrap = db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO actors(id,actor_type,owner_id,status,metadata_json,created_at,updated_at) VALUES('local-owner','owner',NULL,'active','{}',?,?)").run(now, now);
        db.prepare("INSERT OR IGNORE INTO scopes(id,scope_type,name,owner_actor_id,status,created_at,updated_at) VALUES('owner:local','owner','Local owner','local-owner','active',?,?)").run(now, now);
        db.prepare("INSERT OR IGNORE INTO core_metadata(key,value,updated_at) VALUES('store_id',?,?)").run(crypto.randomUUID(), now);
        db.prepare("INSERT INTO core_metadata(key,value,updated_at) VALUES('schema_version',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
          .run(String(targetVersion), now);
      });
      bootstrap.immediate();
      if (backup) {
        db.prepare("INSERT INTO backup_history(id,source_version,target_version,path,sha256,quick_check,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(backup.id, backup.sourceVersion, backup.targetVersion, backup.path, backup.sha256, backup.quickCheck, backup.createdAt);
      }
    }
    profile("bootstrap metadata");
    // A second full scan of a large, unchanged database adds seconds to every
    // process start without checking a different state. Keep the mandatory
    // pre-open check on every boot and run the second check only after schema
    // creation/migration, where it can actually catch a newly introduced fault.
    if (!existed || pending.length) {
      const quickAfter = String(db.pragma("quick_check", { simple: true }));
      profile("post-migration quick_check");
      if (quickAfter !== "ok") throw new Error("Memory vNext core failed post-migration quick_check.");
    } else {
      profile("post-migration quick_check skipped (unchanged schema)");
    }
    keyring = createKeyring({ rootDir, protector: options.keyProtector, clock });
    profile("keyring");

    let closed = false;
    function assertOpen() { if (closed) throw new Error("Memory vNext core store is closed."); }

    function putEncryptedObject(record) {
      assertOpen();
      const id = String(record.id || crypto.randomUUID());
      const aad = {
        id,
        objectType: String(record.objectType || "generic"),
        schemaVersion: Number(record.schemaVersion || 1),
        scopeId: String(record.scopeId || "owner:local"),
        sensitivity: String(record.sensitivity || "private"),
      };
      const envelope = keyring.encrypt(record.payload, aad);
      const now = clock().toISOString();
      try {
        db.prepare(`INSERT INTO encrypted_objects
          (id,object_type,schema_version,scope_id,sensitivity,key_id,key_version,nonce,ciphertext,auth_tag,aad_json,content_mac,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, aad.objectType, aad.schemaVersion, aad.scopeId, aad.sensitivity, envelope.keyId, envelope.keyVersion,
            envelope.nonce, envelope.ciphertext, envelope.authTag, envelope.aadJson, envelope.contentMac, now);
      } catch (error) {
        if (String(error?.code || "").includes("CONSTRAINT_PRIMARYKEY")) {
          const existing = db.prepare("SELECT content_mac FROM encrypted_objects WHERE id=?").get(id);
          if (existing?.content_mac === envelope.contentMac) return { id, contentMac: existing.content_mac, replayed: true };
        }
        throw error;
      }
      return { id, contentMac: envelope.contentMac, replayed: false };
    }

    function getEncryptedObject(id) {
      assertOpen();
      const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(String(id));
      if (!row) return null;
      const aad = JSON.parse(row.aad_json);
      const plaintext = keyring.decrypt({
        keyId: row.key_id,
        keyVersion: row.key_version,
        nonce: row.nonce,
        ciphertext: row.ciphertext,
        authTag: row.auth_tag,
        aadJson: row.aad_json,
        contentMac: row.content_mac,
      }, aad);
      return { id: row.id, objectType: row.object_type, scopeId: row.scope_id, sensitivity: row.sensitivity, schemaVersion: row.schema_version, payload: JSON.parse(plaintext.toString("utf8")), contentMac: row.content_mac };
    }

    function attachRepository(factory) {
      assertOpen();
      if (typeof factory !== "function") throw new Error("Repository factory must be a function.");
      return factory({ db, keyring, clock, faultInjector: options.faultInjector || (() => {}) });
    }

    function health() {
      assertOpen();
      const counts = {};
      for (const table of ["encrypted_objects", "schema_migrations", "backup_history"]) {
        counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
      }
      return {
        ok: String(db.pragma("quick_check", { simple: true })) === "ok",
        dbPath,
        rootDir,
        schemaVersion: Number(db.pragma("user_version", { simple: true })),
        journalMode: String(db.pragma("journal_mode", { simple: true })),
        synchronous: Number(db.pragma("synchronous", { simple: true })),
        foreignKeys: Number(db.pragma("foreign_keys", { simple: true })) === 1,
        counts,
        key: keyring.metadata(),
        writerOwned: true,
      };
    }

    function checkpoint() {
      assertOpen();
      return db.pragma("wal_checkpoint(PASSIVE)");
    }

    function close() {
      if (closed) return;
      closed = true;
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
      try { keyring.close(); } catch {}
      db.close();
      ownership.release();
    }

    return Object.freeze({ attachRepository, checkpoint, close, getEncryptedObject, health, putEncryptedObject, paths: Object.freeze({ rootDir, dbPath }) });
  } catch (error) {
    try { keyring?.close?.(); } catch {}
    try { db?.close?.(); } catch {}
    ownership.release();
    throw error;
  }
}

module.exports = { acquireOwnership, configureDatabase, inspectSqliteSnapshot, legacySnapshotTableInfo, openCoreStore, readLegacySnapshotTable, resolveClosedSnapshot };
