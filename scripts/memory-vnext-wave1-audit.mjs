import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const reportRoot = path.join(repoRoot, 'docs', 'memory-vnext', 'wave1');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const localAppData = process.env.LOCALAPPDATA;

if (!localAppData) {
  throw new Error('LOCALAPPDATA is required; refusing to place live-memory snapshots inside the repository.');
}

const snapshotRoot = path.join(localAppData, 'Jarvis', 'memory-vNext', 'wave1-snapshots', stamp);

const stores = [
  ['runtime/jarvis-memory.sqlite', 'legacy personal/chat memory', 'jarvis', 'migrate_then_disable'],
  ['runtime/memory/jarvis_memory.sqlite', 'answer/debug memory-adjacent traces', 'jarvis', 'telemetry_archive'],
  ['runtime/neural_vault/db/neural_vault.sqlite', 'Neural Vault / MemoryOS', 'neural_vault', 'migrate_then_disable'],
  ['runtime/memory-vectors.sqlite', 'legacy vector projection', 'jarvis', 'rebuild_do_not_import'],
  ['runtime/user-context.sqlite', 'typed personal context', 'jarvis', 'migrate_then_disable'],
  ['runtime/jarvis-missions.sqlite', 'missions/tasks/events', 'missions', 'split_task_truth_from_telemetry'],
  ['runtime/jarvis-pc-graph.sqlite', 'local PC graph', 'pc_graph', 'manifest_and_pointer_migration'],
  ['runtime/jarvis-skills.sqlite', 'skills/procedures', 'skills', 'candidate_import'],
  ['runtime/helix.sqlite', 'HELIX domain store', 'helix', 'retain_domain_owner_publish_manifests'],
  ['runtime/apex.sqlite', 'APEX domain store', 'apex', 'retain_domain_owner_publish_manifests'],
  ['runtime/apex-oracle.sqlite', 'APEX Oracle domain store', 'apex', 'retain_domain_owner_publish_manifests'],
  ['runtime/eclipse.sqlite', 'Eclipse domain store', 'eclipse', 'retain_domain_owner_publish_manifests'],
  ['runtime/eclipse-checkpoints.sqlite', 'Eclipse checkpoints', 'eclipse', 'retain_domain_owner_publish_manifests'],
  ['runtime/coop_symbiote/coop.db', 'Device Mesh / co-op domain store', 'mesh', 'retain_domain_owner_publish_manifests'],
  ['runtime/arbiter.db', 'arbiter state', 'arbiter', 'inspect_then_classify'],
  ['runtime/old-brain-3/brain/memory/commands.db', 'archived command memory', 'legacy_archive', 'candidate_import_then_archive'],
  ['runtime/old-brain-3/brain/memory/habits.db', 'archived habit memory', 'legacy_archive', 'candidate_import_then_archive'],
].map(([relativePath, purpose, owner, decommission]) => ({ relativePath, purpose, owner, decommission }));

const ignoredRuntimeClasses = [
  'runtime/test-* (test databases)',
  'runtime/browser-profile/** (browser/cache databases)',
  'runtime/**/*.sqlite-wal and *.sqlite-shm (captured through SQLite online backup, never copied independently)',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function fileBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function safePragma(db, expression, fallback = null) {
  try {
    return db.pragma(expression, { simple: true });
  } catch {
    return fallback;
  }
}

async function snapshotStore(store) {
  const source = path.join(repoRoot, store.relativePath);
  const base = {
    ...store,
    exists: fs.existsSync(source),
    sourceBytes: fileBytes(source),
    sourceWalBytes: fileBytes(`${source}-wal`),
    sourceShmBytes: fileBytes(`${source}-shm`),
  };

  if (!base.exists) return { ...base, status: 'missing' };

  const safeName = store.relativePath.replace(/[\\/]+/g, '__');
  const destination = path.join(snapshotRoot, safeName);
  ensureDir(path.dirname(destination));

  let sourceDb;
  try {
    sourceDb = new Database(source, { readonly: true, fileMustExist: true });
    sourceDb.pragma('busy_timeout = 5000');
    await sourceDb.backup(destination, { progress: () => 200 });
  } catch (error) {
    return { ...base, status: 'backup_failed', error: String(error?.message || error) };
  } finally {
    sourceDb?.close();
  }

  let snapshotDb;
  try {
    snapshotDb = new Database(destination, { readonly: true, fileMustExist: true });
    snapshotDb.pragma('query_only = ON');
    const sqliteVersion = snapshotDb.prepare('SELECT sqlite_version() AS version').get()?.version ?? null;
    const quickCheckRows = snapshotDb.pragma('quick_check');
    const quickCheck = quickCheckRows.map((row) => Object.values(row)[0]);
    const tables = snapshotDb.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    const tableInventory = tables.map(({ name }) => {
      let rowCount = null;
      let countError = null;
      try {
        rowCount = snapshotDb.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(name)}`).get().count;
      } catch (error) {
        countError = String(error?.message || error);
      }

      let columns = [];
      let foreignKeyCount = 0;
      let indexCount = 0;
      try {
        columns = snapshotDb.pragma(`table_info(${quoteIdentifier(name)})`).map((column) => ({
          name: column.name,
          type: column.type,
          notNull: Boolean(column.notnull),
          primaryKeyOrder: column.pk,
        }));
        foreignKeyCount = snapshotDb.pragma(`foreign_key_list(${quoteIdentifier(name)})`).length;
        indexCount = snapshotDb.pragma(`index_list(${quoteIdentifier(name)})`).length;
      } catch {
        // The row-count error already preserves enough information for later review.
      }

      return { name, rowCount, countError, foreignKeyCount, indexCount, columns };
    });

    const objectCounts = snapshotDb.prepare(`
      SELECT type, COUNT(*) AS count
      FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'
      GROUP BY type
      ORDER BY type
    `).all();

    return {
      ...base,
      status: quickCheck.every((value) => value === 'ok') ? 'snapshotted_verified' : 'snapshotted_integrity_warning',
      snapshotFile: destination,
      snapshotBytes: fileBytes(destination),
      snapshotSha256: sha256(destination),
      sqliteVersion,
      quickCheck,
      journalMode: safePragma(snapshotDb, 'journal_mode'),
      synchronous: safePragma(snapshotDb, 'synchronous'),
      applicationId: safePragma(snapshotDb, 'application_id'),
      userVersion: safePragma(snapshotDb, 'user_version'),
      objectCounts,
      tableCount: tableInventory.length,
      declaredForeignKeys: tableInventory.reduce((sum, table) => sum + table.foreignKeyCount, 0),
      tables: tableInventory,
    };
  } catch (error) {
    return {
      ...base,
      status: 'snapshot_analysis_failed',
      snapshotFile: destination,
      snapshotBytes: fileBytes(destination),
      snapshotSha256: sha256(destination),
      error: String(error?.message || error),
    };
  } finally {
    snapshotDb?.close();
    // Opening a WAL-mode backup for read-only verification can create an empty
    // WAL and a disposable SHM file. The online-backup destination itself is the
    // complete snapshot, so remove only verification-generated sidecars after
    // the connection is closed. A non-empty WAL is retained as a hard warning.
    const walPath = `${destination}-wal`;
    const shmPath = `${destination}-shm`;
    if (fs.existsSync(walPath) && fileBytes(walPath) === 0) fs.unlinkSync(walPath);
    if ((!fs.existsSync(walPath) || fileBytes(walPath) === 0) && fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }
}

const sourceExtensions = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);
const ignoredDirs = new Set([
  '.git', 'node_modules', 'dist', 'dist-desktop', 'runtime', 'test-results',
  'tmp-test', 'runtime-test-manual', 'runtime-test-manual-debug', 'output',
]);

function sourceFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (sourceExtensions.has(path.extname(entry.name))) files.push(full);
    }
  }
  return files;
}

function scanCode() {
  const categories = {
    sqliteConnection: /better-sqlite3|new\s+Database\s*\(/i,
    schemaOrWriteSql: /\b(?:CREATE\s+TABLE|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+[A-Za-z_"`[]|DELETE\s+FROM|REPLACE\s+INTO)\b/i,
    legacyMemoryStore: /memory-store|MemoryStore|jarvis-memory\.sqlite/i,
    neuralVault: /neural-vault|neural_vault|NeuralVault/i,
    memoryExtractor: /memory-extractor|MemoryExtractor|extractMemor/i,
    memoryVectors: /memory-vectors|MemoryVector|embedding/i,
    userContext: /user-context|UserContext|user_context/i,
    conversationState: /conversation_state|referent|carryover|continuity/i,
    taskMissionState: /mission-engine|jarvis-missions|checkpoint/i,
    roomMemory: /helix\.sqlite|apex\.sqlite|eclipse\.sqlite|memory[_ -]?packet/i,
    directGemini: /GEMINI_API_KEY|callGemini|@google\/genai/i,
  };

  const matches = Object.fromEntries(Object.keys(categories).map((key) => [key, []]));
  const envReferences = new Map();

  for (const fullPath of sourceFiles(repoRoot)) {
    const relativePath = path.relative(repoRoot, fullPath).replaceAll('\\', '/');
    const text = fs.readFileSync(fullPath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const [category, pattern] of Object.entries(categories)) {
        if (pattern.test(line)) matches[category].push({ file: relativePath, line: index + 1 });
      }
      for (const match of line.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) {
        const name = match[1];
        if (!envReferences.has(name)) envReferences.set(name, new Set());
        envReferences.get(name).add(relativePath);
      }
    }
  }

  for (const category of Object.keys(matches)) {
    matches[category] = matches[category].slice(0, 5000);
  }

  return {
    note: 'Only file paths, line numbers, and environment-variable names are recorded. Source snippets and credential values are intentionally excluded.',
    categories: matches,
    environmentVariableNames: [...envReferences.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, files]) => ({ name, files: [...files].sort() })),
    protectedLocationsPresent: {
      dotEnv: fs.existsSync(path.join(repoRoot, '.env')),
      secretsDirectory: fs.existsSync(path.join(path.dirname(repoRoot), 'secrets')),
    },
  };
}

function mib(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function escapeMarkdown(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function buildSummary(inventory, codeMap) {
  const rows = inventory.stores.map((store) =>
    `| \`${escapeMarkdown(store.relativePath)}\` | ${escapeMarkdown(store.owner)} | ${escapeMarkdown(store.status)} | ${mib(store.sourceBytes)} | ${mib(store.sourceWalBytes)} | ${store.tableCount ?? '—'} | ${store.declaredForeignKeys ?? '—'} | \`${store.snapshotSha256 ?? '—'}\` | ${escapeMarkdown(store.decommission)} |`,
  );
  const totalSource = inventory.stores.reduce((sum, store) => sum + store.sourceBytes, 0);
  const totalWal = inventory.stores.reduce((sum, store) => sum + store.sourceWalBytes, 0);
  const verified = inventory.stores.filter((store) => store.status === 'snapshotted_verified').length;

  return `# Memory vNext Wave 1 — Snapshot and Structural Inventory\n\n` +
    `**Generated:** ${inventory.generatedAt}  \n` +
    `**Snapshot root:** \`${inventory.snapshotRoot}\`  \n` +
    `**Safety:** SQLite online backups; no live DB/WAL copied directly; no row contents or secret values emitted.  \n\n` +
    `## Summary\n\n` +
    `- Stores declared: ${inventory.stores.length}\n` +
    `- Verified snapshots: ${verified}\n` +
    `- Source DB size: ${mib(totalSource)} MiB\n` +
    `- Live WAL observed: ${mib(totalWal)} MiB\n` +
    `- Code files scanned without snippets: ${inventory.codeFilesScanned}\n` +
    `- Environment/API variable names found: ${codeMap.environmentVariableNames.length}; values were never read or written.\n\n` +
    `## Stores\n\n` +
    `| Store | Owner | Snapshot status | DB MiB | WAL MiB | Tables | Declared FKs | Snapshot SHA-256 | Decommission disposition |\n` +
    `|---|---|---|---:|---:|---:|---:|---|---|\n` + rows.join('\n') + `\n\n` +
    `## Restore rule\n\n` +
    `1. Stop only the target service after recording its process/port and current paths.\n` +
    `2. Never overwrite the sole live copy; restore into a new empty directory.\n` +
    `3. Verify the snapshot SHA-256 against \`database-inventory.json\`.\n` +
    `4. Open the restored copy read-only and require \`PRAGMA quick_check\` = \`ok\`.\n` +
    `5. Point a test-only adapter at the restored copy and run its baseline queries.\n` +
    `6. Production restoration/cutover requires an explicit rollback record and is not performed by this Wave 1 tool.\n\n` +
    `## Legacy-memory decommission invariant\n\n` +
    `Old personal-memory authorities are not deleted in Wave 1. They progress through: snapshotted → mapped → imported as candidates → reconciled → legacy writers disabled → legacy readers disabled → archived read-only → retention-approved destruction. Domain stores remain domain-owned and publish manifests. This prevents both data loss and two writable cognitive authorities.\n\n` +
    `## Credential invariant\n\n` +
    `The audit records environment-variable names and referencing files only. It does not read or copy \`.env\` values, API keys, tokens, secret files, credentials, browser profiles, or credential-bearing row content.\n`;
}

ensureDir(reportRoot);
ensureDir(snapshotRoot);

const results = [];
for (const store of stores) {
  results.push(await snapshotStore(store));
}

const codeMap = scanCode();
const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  repoRoot,
  snapshotRoot,
  snapshotMethod: 'better-sqlite3 online backup API',
  ignoredRuntimeClasses,
  codeFilesScanned: sourceFiles(repoRoot).length,
  stores: results,
};

fs.writeFileSync(path.join(reportRoot, 'database-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(reportRoot, 'memory-code-map.json'), `${JSON.stringify(codeMap, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(reportRoot, 'WAVE1_SNAPSHOT_REPORT.md'), buildSummary(inventory, codeMap), 'utf8');

const failed = results.filter((store) => !['snapshotted_verified', 'missing'].includes(store.status));
console.log(JSON.stringify({
  reportRoot,
  snapshotRoot,
  stores: results.length,
  verified: results.filter((store) => store.status === 'snapshotted_verified').length,
  missing: results.filter((store) => store.status === 'missing').map((store) => store.relativePath),
  failed: failed.map((store) => ({ path: store.relativePath, status: store.status, error: store.error })),
  sourceMiB: Number((results.reduce((sum, store) => sum + store.sourceBytes, 0) / 1024 / 1024).toFixed(2)),
  walMiB: Number((results.reduce((sum, store) => sum + store.sourceWalBytes, 0) / 1024 / 1024).toFixed(2)),
}, null, 2));

if (failed.length) process.exitCode = 1;
