const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");

function isoNow() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(value, fallback = "file") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function shortId() {
  return crypto.randomBytes(4).toString("hex");
}

function checksumFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const defaultJarvisFileAccessPolicy = {
  allowedOperations: ["search", "find", "list", "open", "close", "read", "inspect", "summarize", "index", "watch"],
  allowedRoots: ["project_root", "runtime", "uploads", "artifacts"],
  blockedRoots: ["runtime/secrets", "runtime/neural_vault/raw/private", ".git/objects", "node_modules", "dist", "build"],
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".py", ".sql", ".yaml", ".yml"],
  blockedExtensions: [".env", ".pem", ".key", ".p12", ".pfx"],
  maxReadBytes: 500000,
  maxSearchResults: 100,
  requiresApprovalFor: ["write", "edit", "patch", "copy", "move", "delete"],
  alwaysBlockedPatterns: [".env", ".env.*", "*secret*", "*token*", "*credential*", "*.pem", "*.key"],
  secretScanRequired: true,
  patchPreviewRequired: true,
  logEveryOperation: true,
  writeMemoryTrace: true,
};

function createLocalFileAccess({ runtimeDir, rootDir, neuralVault, policy = defaultJarvisFileAccessPolicy } = {}) {
  const root = path.join(runtimeDir, "local_file_access");
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  const db = new Database(dbPath);
  const allowedRootMap = {
    project_root: rootDir,
    runtime: runtimeDir,
    uploads: path.join(runtimeDir, "uploads"),
    artifacts: path.join(runtimeDir, "artifacts"),
  };

  const dirs = ["sessions", "operations", "patches", "previews", "search_results", "indexes", "reports", "temp", "temp/trash"];

  function ensureStructure() {
    for (const dir of dirs) ensureDir(path.join(root, dir));
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_file_registry (
        id TEXT PRIMARY KEY,
        file_path TEXT UNIQUE NOT NULL,
        memory_uri TEXT,
        project_id TEXT,
        owner_domain TEXT,
        file_type TEXT,
        extension TEXT,
        size_bytes INTEGER,
        checksum TEXT,
        purpose_summary TEXT,
        indexed INTEGER DEFAULT 0,
        last_indexed_at TEXT,
        last_opened_at TEXT,
        last_modified_at TEXT,
        status TEXT DEFAULT 'active',
        tags_json TEXT,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS local_file_sessions (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        memory_uri TEXT,
        opened_by TEXT,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        mode TEXT,
        status TEXT,
        checksum_at_open TEXT,
        checksum_current TEXT,
        related_task_id TEXT,
        related_skill_id TEXT,
        related_agent_id TEXT,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS local_file_operations (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        file_path TEXT NOT NULL,
        actor TEXT,
        task_id TEXT,
        command_id TEXT,
        skill_id TEXT,
        agent_id TEXT,
        module_id TEXT,
        project_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT,
        approval_id TEXT,
        checksum_before TEXT,
        checksum_after TEXT,
        bytes_read INTEGER,
        bytes_written INTEGER,
        search_query TEXT,
        result_count INTEGER,
        error TEXT,
        memory_uri TEXT,
        storage_trace_id TEXT,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS local_file_patches (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        patch_file_path TEXT,
        diff_preview TEXT,
        requested_by TEXT,
        approval_id TEXT,
        status TEXT DEFAULT 'candidate',
        checksum_before TEXT,
        checksum_after TEXT,
        created_at TEXT NOT NULL,
        applied_at TEXT,
        metadata_json TEXT
      );
    `);
  }

  function resolvePath(inputPath) {
    const raw = String(inputPath || "").trim();
    const resolved = path.resolve(raw.startsWith(".") ? path.join(rootDir, raw) : raw);
    const allowedRoots = policy.allowedRoots.map((key) => allowedRootMap[key]).filter(Boolean).map((value) => path.resolve(value).toLowerCase());
    const lower = resolved.toLowerCase();
    if (!allowedRoots.some((allowed) => lower === allowed || lower.startsWith(`${allowed}${path.sep}`))) {
      throw Object.assign(new Error("File path is outside allowed Jarvis roots."), { statusCode: 403 });
    }
    for (const blocked of policy.blockedRoots) {
      const blockedPath = path.resolve(path.join(rootDir, blocked)).toLowerCase();
      if (lower === blockedPath || lower.startsWith(`${blockedPath}${path.sep}`)) {
        throw Object.assign(new Error(`Blocked file root: ${blocked}`), { statusCode: 403 });
      }
    }
    const ext = path.extname(resolved).toLowerCase();
    if (policy.blockedExtensions.includes(ext)) {
      throw Object.assign(new Error(`Blocked file extension: ${ext}`), { statusCode: 403 });
    }
    if (ext && policy.allowedExtensions.length && !policy.allowedExtensions.includes(ext)) {
      throw Object.assign(new Error(`File extension is not in the safe read list: ${ext}`), { statusCode: 403 });
    }
    const basename = path.basename(resolved).toLowerCase();
    if (/(^\.env|secret|token|credential|password|\.pem$|\.key$)/i.test(basename)) {
      throw Object.assign(new Error("Blocked by secret-file pattern."), { statusCode: 403 });
    }
    return resolved;
  }

  function memoryUriFor(filePath) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
    return `memory://projects/jarvis/source/${rel}`;
  }

  function logOperation(entry) {
    ensureStructure();
    const now = isoNow();
    const id = entry.id || `fileop_${Date.now()}_${shortId()}`;
    const log = {
      id,
      operation: entry.operation,
      filePath: entry.filePath || "",
      actor: entry.actor || "jarvis",
      taskId: entry.taskId || "",
      commandId: entry.commandId || "",
      skillId: entry.skillId || "",
      agentId: entry.agentId || "",
      moduleId: entry.moduleId || "",
      projectId: entry.projectId || "jarvis",
      startedAt: entry.startedAt || now,
      endedAt: entry.endedAt || now,
      status: entry.status || "success",
      approvalId: entry.approvalId || "",
      checksumBefore: entry.checksumBefore || "",
      checksumAfter: entry.checksumAfter || "",
      bytesRead: entry.bytesRead || 0,
      bytesWritten: entry.bytesWritten || 0,
      searchQuery: entry.searchQuery || "",
      resultCount: entry.resultCount || 0,
      error: entry.error || "",
      memoryUri: entry.memoryUri || (entry.filePath ? memoryUriFor(entry.filePath) : ""),
      storageTraceId: entry.storageTraceId || `trace_${id}`,
      metadata: entry.metadata || {},
    };
    const filePath = path.join(root, "operations", `${log.startedAt.replace(/[:.]/g, "-")}-${log.operation}-${slugify(path.basename(log.filePath || "query"))}.json`);
    fs.writeFileSync(filePath, json(log), "utf8");
    db.prepare(`
      INSERT OR REPLACE INTO local_file_operations
      (id,operation,file_path,actor,task_id,command_id,skill_id,agent_id,module_id,project_id,started_at,ended_at,status,approval_id,checksum_before,checksum_after,bytes_read,bytes_written,search_query,result_count,error,memory_uri,storage_trace_id,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(log.id, log.operation, log.filePath, log.actor, log.taskId, log.commandId, log.skillId, log.agentId, log.moduleId, log.projectId, log.startedAt, log.endedAt, log.status, log.approvalId, log.checksumBefore, log.checksumAfter, log.bytesRead, log.bytesWritten, log.searchQuery, log.resultCount, log.error, log.memoryUri, log.storageTraceId, json(log.metadata));
    if (neuralVault?.createMemoryObject && policy.writeMemoryTrace) {
      neuralVault.createMemoryObject({
        type: "file_operation",
        title: `${log.operation} ${path.basename(log.filePath || log.searchQuery || "files")}`,
        summary: `Local file operation ${log.operation} finished with status ${log.status}.`,
        content: JSON.stringify(log, null, 2),
        uri: `memory://projects/jarvis/file-operations/${log.id}`,
        projectIds: ["jarvis"],
        tags: ["local-file-access", log.operation, log.status],
        sourceRefs: [filePath],
      });
    }
    return log;
  }

  function registerFile(filePath, purpose = "") {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const sum = stat.isFile() ? checksumFile(filePath) : "";
    const uri = memoryUriFor(filePath);
    const id = `file_${checksum(filePath).slice(0, 16)}`;
    db.prepare(`
      INSERT OR REPLACE INTO local_file_registry
      (id,file_path,memory_uri,project_id,owner_domain,file_type,extension,size_bytes,checksum,purpose_summary,indexed,last_indexed_at,last_opened_at,last_modified_at,status,tags_json,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, filePath, uri, "jarvis", inferOwner(filePath), ext.replace(".", "") || "directory", ext, stat.size, sum, purpose || inferPurpose(filePath), 1, isoNow(), null, stat.mtime.toISOString(), "active", json([ext.replace(".", ""), inferOwner(filePath)]), json({ relativePath: path.relative(rootDir, filePath) }));
    if (neuralVault?.createMemoryObject) {
      neuralVault.createMemoryObject({
        type: "source_file_memory",
        title: path.basename(filePath),
        summary: purpose || inferPurpose(filePath),
        content: sourceFileMemory(filePath, uri, purpose || inferPurpose(filePath)),
        uri,
        projectIds: ["jarvis"],
        tags: ["source-file", ext.replace(".", "") || "file", inferOwner(filePath)],
        sourceRefs: [filePath],
      });
    }
    return { id, filePath, memoryUri: uri, checksum: sum, purposeSummary: purpose || inferPurpose(filePath) };
  }

  function checksum(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
  }

  function inferOwner(filePath) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
    if (rel.startsWith("server/")) return "backend";
    if (rel.startsWith("src/")) return "frontend";
    if (rel.startsWith("tests/")) return "testing";
    if (rel.startsWith("runtime/")) return "runtime";
    return "project";
  }

  function inferPurpose(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    if (ext === ".tsx") return `${name} defines React UI or client-side behavior.`;
    if (ext === ".ts") return `${name} defines TypeScript runtime types, tests, or browser code.`;
    if (ext === ".js") return `${name} defines Node/CommonJS server or tooling logic.`;
    if (ext === ".md") return `${name} is documentation or a protocol/report.`;
    if (ext === ".json") return `${name} is structured configuration or runtime data.`;
    return `${name} is a Jarvis project file.`;
  }

  function sourceFileMemory(filePath, uri, purpose) {
    return [
      "---",
      `id: file_${checksum(filePath).slice(0, 16)}`,
      "type: source_file_memory",
      `name: ${path.basename(filePath)}`,
      `file_path: ${filePath}`,
      `memory_uri: ${uri}`,
      `owner_module: ${inferOwner(filePath)}`,
      `extension: ${path.extname(filePath).toLowerCase()}`,
      `last_checksum: ${fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? checksumFile(filePath) : ""}`,
      "---",
      "",
      `# ${path.basename(filePath)}`,
      "",
      purpose,
    ].join("\n");
  }

  function searchFiles(query, options = {}) {
    ensureStructure();
    const q = String(query || "").trim();
    if (!q) return { query: q, results: [] };
    const max = Math.min(Number(options.limit || policy.maxSearchResults || 100), policy.maxSearchResults || 100);
    let results = [];
    try {
      const output = execFileSync("rg", ["--json", "--hidden", "--glob", "!node_modules/**", "--glob", "!dist/**", "--glob", "!runtime/secrets/**", "--glob", "!*.env", q, rootDir], { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 });
      for (const line of output.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const item = parseJson(line, null);
        if (item?.type === "match") {
          const filePath = resolvePath(item.data.path.text);
          const snippet = item.data.lines.text.trim();
          results.push({ filePath, line: item.data.line_number, snippet, memoryUri: memoryUriFor(filePath), ownerModule: inferOwner(filePath) });
          if (results.length >= max) break;
        }
      }
    } catch {
      const rows = db.prepare("SELECT * FROM local_file_registry WHERE file_path LIKE ? OR purpose_summary LIKE ? LIMIT ?").all(`%${q}%`, `%${q}%`, max);
      results = rows.map((row) => ({ filePath: row.file_path, line: 0, snippet: row.purpose_summary, memoryUri: row.memory_uri, ownerModule: row.owner_domain }));
    }
    fs.writeFileSync(path.join(root, "search_results", `${Date.now()}-${slugify(q)}.json`), json({ query: q, results }), "utf8");
    logOperation({ operation: "search", filePath: rootDir, searchQuery: q, resultCount: results.length, metadata: { max } });
    return { query: q, results };
  }

  function findFile(name, options = {}) {
    ensureStructure();
    const q = slugify(name, "");
    const limit = Number(options.limit || 25);
    const found = [];
    function walk(dir) {
      if (found.length >= limit) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        const rel = path.relative(rootDir, p);
        if (/node_modules|\\dist\\|\\\.git\\|runtime\\secrets/i.test(p)) continue;
        if (slugify(entry.name, "").includes(q) || slugify(rel, "").includes(q)) found.push({ filePath: p, name: entry.name, isDirectory: entry.isDirectory(), memoryUri: memoryUriFor(p) });
        if (entry.isDirectory()) walk(p);
        if (found.length >= limit) break;
      }
    }
    walk(rootDir);
    logOperation({ operation: "find", filePath: rootDir, searchQuery: name, resultCount: found.length });
    return { query: name, results: found };
  }

  function listFolder(folderPath, options = {}) {
    ensureStructure();
    const resolved = resolvePath(folderPath || rootDir);
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter((entry) => !["node_modules", ".git", "dist"].includes(entry.name))
      .slice(0, Number(options.limit || 100))
      .map((entry) => {
        const filePath = path.join(resolved, entry.name);
        return { name: entry.name, filePath, isDirectory: entry.isDirectory(), extension: path.extname(entry.name), memoryUri: memoryUriFor(filePath) };
      });
    logOperation({ operation: "list", filePath: resolved, resultCount: entries.length });
    return { folderPath: resolved, entries };
  }

  function openFile(filePath, options = {}) {
    ensureStructure();
    const resolved = resolvePath(filePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error("File does not exist or is not a file.");
    const session = {
      id: `filesession_${Date.now()}_${shortId()}`,
      filePath: resolved,
      memoryUri: memoryUriFor(resolved),
      openedBy: options.actor || "jarvis",
      openedAt: isoNow(),
      mode: options.mode || "read_only",
      status: "open",
      checksumAtOpen: checksumFile(resolved),
      checksumCurrent: checksumFile(resolved),
      metadata: options.metadata || {},
    };
    db.prepare(`
      INSERT INTO local_file_sessions
      (id,file_path,memory_uri,opened_by,opened_at,mode,status,checksum_at_open,checksum_current,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(session.id, session.filePath, session.memoryUri, session.openedBy, session.openedAt, session.mode, session.status, session.checksumAtOpen, session.checksumCurrent, json(session.metadata));
    registerFile(resolved);
    logOperation({ operation: "open", filePath: resolved, checksumBefore: session.checksumAtOpen, memoryUri: session.memoryUri });
    return session;
  }

  function closeFile(filePathOrSessionId) {
    ensureStructure();
    const row = db.prepare("SELECT * FROM local_file_sessions WHERE id=? OR file_path=? ORDER BY opened_at DESC LIMIT 1").get(filePathOrSessionId, filePathOrSessionId);
    if (!row) throw new Error("Open file session not found.");
    const checksumCurrent = fs.existsSync(row.file_path) ? checksumFile(row.file_path) : "";
    db.prepare("UPDATE local_file_sessions SET closed_at=?, status='closed', checksum_current=? WHERE id=?").run(isoNow(), checksumCurrent, row.id);
    logOperation({ operation: "close", filePath: row.file_path, checksumBefore: row.checksum_at_open, checksumAfter: checksumCurrent, memoryUri: row.memory_uri });
    return { ...row, closedAt: isoNow(), status: "closed", checksumCurrent };
  }

  function readFile(filePath, options = {}) {
    ensureStructure();
    const resolved = resolvePath(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error("Path is not a file.");
    const max = Number(options.maxBytes || policy.maxReadBytes || 500000);
    if (stat.size > max) throw Object.assign(new Error(`File is too large for safe read (${stat.size} bytes).`), { statusCode: 413 });
    const content = fs.readFileSync(resolved, "utf8");
    const reg = registerFile(resolved);
    logOperation({ operation: "read", filePath: resolved, bytesRead: Buffer.byteLength(content), checksumBefore: reg.checksum, memoryUri: reg.memoryUri });
    return { filePath: resolved, content, bytesRead: Buffer.byteLength(content), checksum: reg.checksum, memoryUri: reg.memoryUri };
  }

  function summarizeFile(filePath) {
    const read = readFile(filePath);
    const lines = read.content.split(/\r?\n/).filter(Boolean);
    const summary = [
      `${path.basename(read.filePath)} has ${lines.length} non-empty lines and ${read.bytesRead} bytes.`,
      `Purpose: ${inferPurpose(read.filePath)}`,
      `Opening lines: ${lines.slice(0, 5).join(" ").slice(0, 500)}`,
    ].join("\n");
    registerFile(read.filePath, summary);
    logOperation({ operation: "summarize", filePath: read.filePath, bytesRead: read.bytesRead, memoryUri: read.memoryUri });
    return { filePath: read.filePath, summary, memoryUri: read.memoryUri };
  }

  function previewPatch(filePath, nextContent, options = {}) {
    ensureStructure();
    const resolved = resolvePath(filePath);
    const current = fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : "";
    const patchId = `patch_${Date.now()}_${shortId()}`;
    const before = current.split(/\r?\n/);
    const after = String(nextContent || "").split(/\r?\n/);
    const diffPreview = [
      `--- ${resolved}`,
      `+++ proposed`,
      ...simpleDiff(before, after).slice(0, 400),
    ].join("\n");
    const patchPath = path.join(root, "patches", `${patchId}.json`);
    const approvalId = `file_approval_${patchId}`;
    fs.writeFileSync(patchPath, json({ id: patchId, filePath: resolved, nextContent, diffPreview, approvalId, createdAt: isoNow() }), "utf8");
    db.prepare(`
      INSERT INTO local_file_patches
      (id,file_path,patch_file_path,diff_preview,requested_by,approval_id,status,checksum_before,created_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(patchId, resolved, patchPath, diffPreview, options.actor || "jarvis", approvalId, "pending_approval", fs.existsSync(resolved) ? checksumFile(resolved) : "", isoNow(), json(options));
    logOperation({ operation: "patch", filePath: resolved, status: "pending_approval", approvalId, checksumBefore: fs.existsSync(resolved) ? checksumFile(resolved) : "" });
    return { id: patchId, filePath: resolved, patchPath, diffPreview, approvalId, status: "pending_approval" };
  }

  function simpleDiff(before, after) {
    const rows = [];
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
      if (before[i] === after[i]) continue;
      if (before[i] !== undefined) rows.push(`- ${before[i]}`);
      if (after[i] !== undefined) rows.push(`+ ${after[i]}`);
    }
    return rows.length ? rows : [" no content changes"];
  }

  function applyPatch(patchId, approval = {}) {
    ensureStructure();
    if (!approval.approved) throw Object.assign(new Error("Patch requires explicit approval."), { statusCode: 403 });
    const row = db.prepare("SELECT * FROM local_file_patches WHERE id=?").get(patchId);
    if (!row) throw new Error("Patch not found.");
    const packet = parseJson(fs.readFileSync(row.patch_file_path, "utf8"), {});
    const before = fs.existsSync(row.file_path) ? checksumFile(row.file_path) : "";
    if (row.checksum_before && before !== row.checksum_before) throw new Error("File changed since patch preview. Re-read before applying.");
    fs.writeFileSync(row.file_path, String(packet.nextContent || ""), "utf8");
    const after = checksumFile(row.file_path);
    db.prepare("UPDATE local_file_patches SET status='applied', checksum_after=?, applied_at=? WHERE id=?").run(after, isoNow(), patchId);
    registerFile(row.file_path, inferPurpose(row.file_path));
    logOperation({ operation: "patch", filePath: row.file_path, status: "success", approvalId: row.approval_id, checksumBefore: before, checksumAfter: after, bytesWritten: Buffer.byteLength(String(packet.nextContent || "")) });
    return { ok: true, patchId, filePath: row.file_path, checksumBefore: before, checksumAfter: after };
  }

  function deleteFile(filePath, approval = {}) {
    ensureStructure();
    const resolved = resolvePath(filePath);
    if (!approval.approved) {
      return { ok: false, status: "pending_approval", approvalRequired: true, operation: "delete", filePath: resolved };
    }
    const target = path.join(root, "temp", "trash", `${Date.now()}-${path.basename(resolved)}`);
    fs.renameSync(resolved, target);
    db.prepare("UPDATE local_file_registry SET status='trashed', metadata_json=? WHERE file_path=?").run(json({ trashPath: target, deletedAt: isoNow() }), resolved);
    logOperation({ operation: "delete", filePath: resolved, status: "success", approvalId: approval.approvalId || "manual", metadata: { trashPath: target } });
    return { ok: true, filePath: resolved, trashPath: target };
  }

  function indexFiles(options = {}) {
    ensureStructure();
    const limit = Number(options.limit || 300);
    const indexed = [];
    function walk(dir) {
      if (indexed.length >= limit) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else {
          try {
            resolvePath(p);
            indexed.push(registerFile(p));
          } catch {
            // Ignore blocked or unsupported files during indexing.
          }
        }
        if (indexed.length >= limit) break;
      }
    }
    walk(rootDir);
    logOperation({ operation: "index", filePath: rootDir, resultCount: indexed.length });
    return { indexed: indexed.length, files: indexed };
  }

  function sessions(limit = 50) {
    ensureStructure();
    return db.prepare("SELECT * FROM local_file_sessions ORDER BY opened_at DESC LIMIT ?").all(Number(limit));
  }

  function operations(limit = 80) {
    ensureStructure();
    return db.prepare("SELECT * FROM local_file_operations ORDER BY started_at DESC LIMIT ?").all(Number(limit)).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
  }

  function registry(limit = 120) {
    ensureStructure();
    return db.prepare("SELECT * FROM local_file_registry ORDER BY last_indexed_at DESC LIMIT ?").all(Number(limit)).map((row) => ({ ...row, tags: parseJson(row.tags_json, []), metadata: parseJson(row.metadata_json, {}) }));
  }

  function status() {
    ensureStructure();
    return {
      ok: true,
      version: "local-file-access-v2",
      root,
      policy,
      counts: {
        registry: db.prepare("SELECT COUNT(*) count FROM local_file_registry").get().count,
        openSessions: db.prepare("SELECT COUNT(*) count FROM local_file_sessions WHERE status='open'").get().count,
        operations: db.prepare("SELECT COUNT(*) count FROM local_file_operations").get().count,
        patches: db.prepare("SELECT COUNT(*) count FROM local_file_patches").get().count,
      },
    };
  }

  function writeReports() {
    ensureStructure();
    const build = [
      "# Jarvis Universal Schema Local File Access Build Report",
      "",
      "Local File Access v2 is installed with safe roots, blocked secret patterns, managed sessions, operation logs, source file memory, patch previews, approval-required writes, and SQLite registry tables.",
    ].join("\n");
    const guide = [
      "# Jarvis Local File Access User Guide",
      "",
      "- Search: `/api/local-file-access/search?q=<query>`",
      "- Find: `/api/local-file-access/find?name=<name>`",
      "- Read: `POST /api/local-file-access/read` with `{ \"path\": \"...\" }`",
      "- Open/close sessions: `/api/local-file-access/open` and `/api/local-file-access/close`",
      "- Patch: preview first, then apply only with explicit approval.",
    ].join("\n");
    const test = [
      "# Jarvis Universal Schema Local File Access Test Report",
      "",
      "Run `npm run test:local-file-access-protocols` for operation, registry, protocol, task-to-skill, and safety checks.",
    ].join("\n");
    const reportDir = path.join(runtimeDir, "reports");
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, "JARVIS_UNIVERSAL_SCHEMA_LOCAL_FILE_ACCESS_BUILD_REPORT.md"), build, "utf8");
    fs.writeFileSync(path.join(reportDir, "JARVIS_LOCAL_FILE_ACCESS_USER_GUIDE.md"), guide, "utf8");
    fs.writeFileSync(path.join(reportDir, "JARVIS_UNIVERSAL_SCHEMA_LOCAL_FILE_ACCESS_TEST_REPORT.md"), test, "utf8");
  }

  ensureStructure();
  writeReports();

  return {
    policy,
    status,
    searchFiles,
    findFile,
    listFolder,
    openFile,
    closeFile,
    readFile,
    summarizeFile,
    previewPatch,
    applyPatch,
    deleteFile,
    indexFiles,
    sessions,
    operations,
    registry,
    registerFile,
    logOperation,
    close: () => db.close(),
  };
}

module.exports = { createLocalFileAccess, defaultJarvisFileAccessPolicy };
