const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".js", ".mjs", ".cjs",
  ".ts", ".tsx", ".jsx", ".html", ".css", ".scss", ".py", ".ps1", ".bat", ".cmd", ".yml",
  ".yaml", ".toml", ".xml", ".sql", ".env", ".log",
]);

const INDEXED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ".pdf", ".docx", ".doc", ".pptx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".gif",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".vite", ".wrangler",
  "runtime", "test-results", "playwright-report", "__pycache__", ".cache",
]);

const MAX_TEXT_BYTES = 240_000;
const SECRET_LIKE_PATTERN = /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z_]{20,}|xox[baprs]-[0-9A-Za-z-]{20,}|[A-Za-z0-9_-]{40,})\b|(?:api[_-]?key|secret|password|private[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^"'\s]{12,}/i;

function cleanString(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function tokenize(value) {
  const separated = String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return [...new Set(separated.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])];
}

function hashId(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex");
}

function isProbablyText(filePath, size) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) && size <= MAX_TEXT_BYTES;
}

function readTextSample(filePath, size) {
  if (!isProbablyText(filePath, size)) return "";
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (SECRET_LIKE_PATTERN.test(text)) return "[secret-like content blocked from PC knowledge graph]";
    return text.replace(/\s+/g, " ").trim().slice(0, 24_000);
  } catch {
    return "";
  }
}

function projectSignals(directory) {
  const signals = [];
  for (const file of ["package.json", "pyproject.toml", "requirements.txt", "vite.config.ts", "vite.config.js", "wrangler.jsonc", "README.md"]) {
    if (fs.existsSync(path.join(directory, file))) signals.push(file);
  }
  return signals;
}

function classifyFile(filePath, root) {
  const relative = path.relative(root, filePath);
  const parts = relative.split(/[\\/]/).map((part) => part.toLowerCase());
  const ext = path.extname(filePath).toLowerCase();
  if (parts.some((part) => /canvas|course|class|assignment|homework|rubric/.test(part))) return "class-file";
  if (parts.some((part) => /screenshot|screen-captures|captures|images|photos/.test(part)) || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "visual-file";
  if ([".js", ".ts", ".tsx", ".jsx", ".py", ".css", ".html", ".json", ".md"].includes(ext)) return "project-file";
  if ([".pdf", ".docx", ".doc", ".pptx", ".xlsx"].includes(ext)) return "document";
  return "file";
}

function defaultRoots(workspaceRoot) {
  const home = os.homedir();
  return [
    workspaceRoot,
    path.join(home, "Downloads"),
    path.join(home, "Documents"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "Desktop"),
  ].filter((item, index, array) => item && array.indexOf(item) === index && fs.existsSync(item));
}

function createPcKnowledgeGraph({ runtimeDir, workspaceRoot }) {
  const dbPath = path.join(runtimeDir, "jarvis-pc-graph.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pc_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      root TEXT NOT NULL,
      ext TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pc_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      weight REAL NOT NULL,
      evidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pc_index_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      roots_json TEXT NOT NULL,
      scanned INTEGER NOT NULL,
      indexed INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pc_nodes_type_idx ON pc_nodes(type);
    CREATE INDEX IF NOT EXISTS pc_nodes_mtime_idx ON pc_nodes(mtime_ms DESC);
    CREATE INDEX IF NOT EXISTS pc_nodes_path_idx ON pc_nodes(path);
    CREATE INDEX IF NOT EXISTS pc_edges_source_idx ON pc_edges(source_id, kind);
  `);

  function upsertNode(node) {
    db.prepare(`
      INSERT INTO pc_nodes(id,type,name,path,root,ext,size,mtime_ms,created_at,updated_at,summary_json,text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,name=excluded.name,root=excluded.root,ext=excluded.ext,size=excluded.size,
        mtime_ms=excluded.mtime_ms,updated_at=excluded.updated_at,summary_json=excluded.summary_json,text=excluded.text
    `).run(
      node.id, node.type, node.name, node.path, node.root, node.ext, node.size, node.mtimeMs,
      node.createdAt, node.updatedAt, JSON.stringify(node.summary || {}), node.text || "",
    );
  }

  function insertEdge(sourceId, targetId, kind, weight, evidence) {
    const id = hashId(`${sourceId}:${targetId}:${kind}`);
    db.prepare(`
      INSERT OR REPLACE INTO pc_edges(id,source_id,target_id,kind,weight,evidence,created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sourceId, targetId, kind, weight, cleanString(evidence, 1000), new Date().toISOString());
  }

  function scanRoot(root, options, counters) {
    const resolvedRoot = path.resolve(root);
    const queue = [resolvedRoot];
    const limit = Math.max(1, Math.min(50_000, Number(options.limit || 1200)));
    while (queue.length && counters.scanned < limit) {
      const current = queue.shift();
      let entries = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      const signals = projectSignals(current);
      if (signals.length) {
        const stat = fs.statSync(current);
        const id = hashId(`project:${current}`);
        upsertNode({
          id,
          type: "project",
          name: path.basename(current),
          path: current,
          root: resolvedRoot,
          ext: "",
          size: 0,
          mtimeMs: stat.mtimeMs,
          createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
          updatedAt: new Date(stat.mtimeMs).toISOString(),
          summary: { signals, relativePath: path.relative(resolvedRoot, current), role: "detected-project" },
          text: signals.join(" "),
        });
        counters.indexed += 1;
      }
      for (const entry of entries) {
        if (counters.scanned >= limit) break;
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
          continue;
        }
        const filePath = path.join(current, entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (!INDEXED_EXTENSIONS.has(ext)) continue;
        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          continue;
        }
        counters.scanned += 1;
        const type = classifyFile(filePath, resolvedRoot);
        const text = readTextSample(filePath, stat.size);
        const id = hashId(`file:${filePath}`);
        const relativePath = path.relative(resolvedRoot, filePath);
        const parent = path.dirname(filePath);
        const parentProject = nearestProject(parent, resolvedRoot);
        upsertNode({
          id,
          type,
          name: entry.name,
          path: filePath,
          root: resolvedRoot,
          ext,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          createdAt: new Date(stat.birthtimeMs || stat.ctimeMs).toISOString(),
          updatedAt: new Date(stat.mtimeMs).toISOString(),
          summary: {
            relativePath,
            directory: parent,
            textIndexed: Boolean(text),
            tokens: tokenize(`${entry.name} ${relativePath} ${text}`).slice(0, 80),
          },
          text,
        });
        counters.indexed += 1;
        if (parentProject) insertEdge(hashId(`project:${parentProject}`), id, "contains", 1, `File is inside detected project ${parentProject}`);
      }
    }
  }

  function nearestProject(directory, root) {
    let current = directory;
    while (current && current.startsWith(root)) {
      if (projectSignals(current).length) return current;
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }
    return "";
  }

  function rebuild(args = {}) {
    const roots = (Array.isArray(args.roots) && args.roots.length ? args.roots : defaultRoots(workspaceRoot))
      .map((item) => path.resolve(String(item)))
      .filter((item, index, array) => fs.existsSync(item) && array.indexOf(item) === index)
      .slice(0, 8);
    const runId = crypto.randomUUID();
    const started = new Date().toISOString();
    db.prepare("INSERT INTO pc_index_runs(id,started_at,completed_at,roots_json,scanned,indexed,status,error) VALUES (?, ?, NULL, ?, 0, 0, 'running', '')")
      .run(runId, started, JSON.stringify(roots));
    const counters = { scanned: 0, indexed: 0 };
    try {
      for (const root of roots) scanRoot(root, args, counters);
      db.prepare("UPDATE pc_index_runs SET completed_at=?, scanned=?, indexed=?, status='complete' WHERE id=?")
        .run(new Date().toISOString(), counters.scanned, counters.indexed, runId);
      return {
        runId,
        roots,
        scanned: counters.scanned,
        indexed: counters.indexed,
        status: "complete",
        plainEnglish: `Indexed ${counters.indexed} PC graph nodes from ${roots.length} root(s).`,
      };
    } catch (error) {
      db.prepare("UPDATE pc_index_runs SET completed_at=?, scanned=?, indexed=?, status='failed', error=? WHERE id=?")
        .run(new Date().toISOString(), counters.scanned, counters.indexed, error.message, runId);
      throw error;
    }
  }

  function rowToNode(row, score = 0) {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      path: row.path,
      root: row.root,
      ext: row.ext,
      size: row.size,
      updatedAt: new Date(row.mtime_ms).toISOString(),
      summary: JSON.parse(row.summary_json || "{}"),
      score,
    };
  }

  function search(args = {}) {
    const query = cleanString(args.query, 500);
    if (!query) throw Object.assign(new Error("PC graph search query is required"), { statusCode: 400 });
    const limit = Math.max(1, Math.min(50, Number(args.limit || 12)));
    const terms = tokenize(query).slice(0, 20);
    const rows = db.prepare("SELECT * FROM pc_nodes ORDER BY mtime_ms DESC LIMIT 5000").all();
    const matches = rows.map((row) => {
      const haystack = `${row.name} ${row.path} ${row.ext} ${row.type} ${row.text} ${row.summary_json}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (row.name.toLowerCase().includes(term)) score += 8;
        if (row.path.toLowerCase().includes(term)) score += 4;
        if (haystack.includes(term)) score += 2;
      }
      const recency = Math.max(0, 1 - ((Date.now() - row.mtime_ms) / (1000 * 60 * 60 * 24 * 30)));
      return { row, score: score + recency };
    }).filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => rowToNode(item.row, Number(item.score.toFixed(3))));
    return {
      query,
      matches,
      evidence: matches.map((item) => ({ path: item.path, updatedAt: item.updatedAt, reason: `${item.type} matched the query` })),
      plainEnglish: matches.length
        ? `Found ${matches.length} PC graph match(es) for "${query}".`
        : `No PC graph matches found for "${query}". Rebuild the graph if this should exist.`,
    };
  }

  function timeline(args = {}) {
    const hours = Math.max(1, Math.min(24 * 30, Number(args.hours || 24)));
    const since = Date.now() - hours * 60 * 60 * 1000;
    const rows = db.prepare("SELECT * FROM pc_nodes WHERE mtime_ms >= ? ORDER BY mtime_ms DESC LIMIT ?")
      .all(since, Math.max(1, Math.min(100, Number(args.limit || 30))));
    const items = rows.map((row) => rowToNode(row));
    const byProject = new Map();
    for (const item of items) {
      const project = item.summary?.directory || path.dirname(item.path);
      byProject.set(project, (byProject.get(project) || 0) + 1);
    }
    return {
      hours,
      items,
      activeAreas: [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([directory, count]) => ({ directory, count })),
      plainEnglish: items.length
        ? `Recent work graph found ${items.length} changed item(s) across ${byProject.size} area(s).`
        : `No indexed file activity in the last ${hours} hour(s).`,
    };
  }

  function explain(args = {}) {
    const target = cleanString(args.target || args.query, 500);
    const result = search({ query: target, limit: 5 });
    const top = result.matches[0];
    if (!top) return { target, explanation: "No matching node was found in the PC graph.", evidence: [] };
    const edges = db.prepare(`
      SELECT e.kind,e.evidence,n.id,n.type,n.name,n.path,n.mtime_ms,n.summary_json
      FROM pc_edges e JOIN pc_nodes n ON n.id = e.source_id
      WHERE e.target_id = ?
      UNION ALL
      SELECT e.kind,e.evidence,n.id,n.type,n.name,n.path,n.mtime_ms,n.summary_json
      FROM pc_edges e JOIN pc_nodes n ON n.id = e.target_id
      WHERE e.source_id = ?
      LIMIT 12
    `).all(top.id, top.id);
    return {
      target,
      node: top,
      related: edges.map((row) => ({
        relation: row.kind,
        evidence: row.evidence,
        node: {
          id: row.id,
          type: row.type,
          name: row.name,
          path: row.path,
          updatedAt: new Date(row.mtime_ms).toISOString(),
          summary: JSON.parse(row.summary_json || "{}"),
        },
      })),
      explanation: edges.length
        ? `${top.name} is connected to ${edges.length} indexed node(s), mostly by project/file containment.`
        : `${top.name} matched the PC graph, but no related project edge is indexed yet.`,
      evidence: [{ path: top.path, updatedAt: top.updatedAt }, ...edges.map((row) => ({ path: row.path, updatedAt: new Date(row.mtime_ms).toISOString() }))],
    };
  }

  function inspect() {
    const counts = db.prepare("SELECT type, COUNT(*) AS count FROM pc_nodes GROUP BY type ORDER BY count DESC").all();
    const lastRun = db.prepare("SELECT * FROM pc_index_runs ORDER BY started_at DESC LIMIT 1").get();
    const recent = db.prepare("SELECT name,path,type,mtime_ms FROM pc_nodes ORDER BY mtime_ms DESC LIMIT 8").all();
    return {
      dbPath,
      counts,
      lastRun: lastRun ? {
        id: lastRun.id,
        startedAt: lastRun.started_at,
        completedAt: lastRun.completed_at,
        roots: JSON.parse(lastRun.roots_json || "[]"),
        scanned: lastRun.scanned,
        indexed: lastRun.indexed,
        status: lastRun.status,
        error: lastRun.error,
      } : null,
      recent: recent.map((row) => ({ name: row.name, path: row.path, type: row.type, updatedAt: new Date(row.mtime_ms).toISOString() })),
    };
  }

  return { rebuild, search, timeline, explain, inspect, close: () => db.close(), dbPath };
}

module.exports = { createPcKnowledgeGraph, defaultRoots, tokenize };
