// T11: PC Activity Graph — semantic context memory from structured metadata.
// Watches file system, monitors processes, captures clipboard changes.
// Stores events in activity_events table in neural_vault.sqlite.
// No screenshots, no ambient recording. ~1MB/day at typical usage.

const crypto = require("crypto");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROCESS_POLL_MS = 30_000;
const CLIPBOARD_POLL_MS = 5_000;
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS activity_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    detail_json TEXT,
    project_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_events_time_idx ON activity_events(created_at, event_type);
  CREATE INDEX IF NOT EXISTS activity_events_project_idx ON activity_events(project_id, created_at);
  CREATE INDEX IF NOT EXISTS activity_events_type_idx ON activity_events(event_type, created_at);
`;

function inferProjectId(filePath) {
  const lower = String(filePath || "").toLowerCase();
  if (lower.includes("jarvis-ui") || lower.includes("kalshi")) return "jarvis";
  if (lower.includes("mangotrades")) return "mangotrades";
  if (lower.includes("documents\\kalshi")) return "kalshi";
  if (lower.includes("onedrive\\desktop")) return "desktop";
  return null;
}

function isoNow() { return new Date().toISOString(); }

function createActivityGraph({ runtimeDir, watchDirs = [], enableProcessMonitor = true }) {
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  let db;
  try {
    db = new Database(dbPath, { timeout: 5000 });
    db.pragma("journal_mode=WAL");
    db.exec(SCHEMA);
  } catch (e) {
    console.error("[activity-graph] DB init failed:", e.message);
    return { start: () => {}, stop: () => {}, query: () => [], status: () => ({ ok: false, error: e.message }) };
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO activity_events(id, event_type, subject, detail_json, project_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function record(type, subject, detail = null, projectId = null) {
    const id = crypto.randomUUID();
    try {
      insert.run(id, type, String(subject).slice(0, 500), detail ? JSON.stringify(detail) : null, projectId, isoNow());
    } catch {}
    return id;
  }

  // File watcher setup
  let watcher = null;
  function startFileWatcher() {
    let chokidar;
    try { chokidar = require("chokidar"); } catch { return; }

    const dirsToWatch = watchDirs.length ? watchDirs : [
      path.join(process.env.USERPROFILE || "C:\\Users\\devan", "OneDrive", "Documents"),
      path.join(process.env.USERPROFILE || "C:\\Users\\devan", "OneDrive", "Desktop"),
      path.join(process.env.USERPROFILE || "C:\\Users\\devan", "Downloads"),
    ].filter(fs.existsSync);

    if (!dirsToWatch.length) return;

    // Use polling for OneDrive paths (native watcher has delays on cloud-synced paths)
    watcher = chokidar.watch(dirsToWatch, {
      ignored: /(node_modules|\.git|runtime|dist|build|\.next|__pycache__|Temp|AppData\\Local\\Temp)/i,
      persistent: false,
      usePolling: true,
      interval: 2000,
      depth: 3,
      ignoreInitial: true,
    });

    watcher
      .on("change", (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const safeExts = new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".md", ".txt", ".json", ".html", ".css", ".sql"]);
        if (!safeExts.has(ext)) return;
        record("file_edit", filePath, { ext, action: "change" }, inferProjectId(filePath));
      })
      .on("add", (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        record("file_add", filePath, { ext }, inferProjectId(filePath));
      })
      .on("error", (err) => console.warn("[activity-graph] watcher error:", err.message));
  }

  // Process monitor
  let processTimer = null;
  let lastFocusedApp = null;
  function pollProcesses() {
    try {
      const ps = execSync(
        "powershell -NonInteractive -Command \"Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Sort-Object CPU -Descending | Select-Object -First 5 -ExpandProperty Name | ConvertTo-Json\"",
        { timeout: 5000, stdio: ["pipe", "pipe", "ignore"] },
      ).toString().trim();
      const names = JSON.parse(ps || "[]");
      const top = Array.isArray(names) ? names[0] : names;
      if (top && top !== lastFocusedApp) {
        record("app_focus", String(top), { apps: Array.isArray(names) ? names : [names] });
        lastFocusedApp = top;
      }
    } catch {}
  }

  // Clipboard watcher
  let clipboardTimer = null;
  let lastClipboard = "";
  function pollClipboard() {
    try {
      const clip = execSync(
        "powershell -NonInteractive -Command \"Get-Clipboard\"",
        { timeout: 3000, stdio: ["pipe", "pipe", "ignore"] },
      ).toString().trim();
      if (clip && clip !== lastClipboard && clip.length <= 5000 && clip.length > 5) {
        // Don't store clipboard content — only record that it changed and its length
        record("clipboard_change", `clipboard:${clip.length}chars`, {
          length: clip.length,
          previewHash: crypto.createHash("sha1").update(clip.slice(0, 64)).digest("hex").slice(0, 8),
        });
        lastClipboard = clip;
      }
    } catch {}
  }

  let running = false;

  function start() {
    if (running) return;
    running = true;
    startFileWatcher();
    if (enableProcessMonitor) {
      pollProcesses();
      processTimer = setInterval(pollProcesses, PROCESS_POLL_MS);
    }
    clipboardTimer = setInterval(pollClipboard, CLIPBOARD_POLL_MS);
    console.log("[activity-graph] Started — watching files, processes, clipboard");
  }

  function stop() {
    running = false;
    watcher?.close();
    clearInterval(processTimer);
    clearInterval(clipboardTimer);
  }

  function query({ eventType, since, until, projectId, limit = 50 } = {}) {
    let sql = "SELECT * FROM activity_events WHERE 1=1";
    const params = [];
    if (eventType) { sql += " AND event_type=?"; params.push(eventType); }
    if (since) { sql += " AND created_at >= ?"; params.push(since); }
    if (until) { sql += " AND created_at <= ?"; params.push(until); }
    if (projectId) { sql += " AND project_id=?"; params.push(projectId); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(Math.min(500, Number(limit) || 50));
    try { return db.prepare(sql).all(...params); } catch { return []; }
  }

  function status() {
    try {
      const counts = db.prepare("SELECT event_type, COUNT(*) as count FROM activity_events GROUP BY event_type").all();
      const total = db.prepare("SELECT COUNT(*) as c FROM activity_events").get().c;
      return { ok: true, running, total, byType: Object.fromEntries(counts.map(r => [r.event_type, r.count])) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  return { start, stop, query, record, status };
}

module.exports = { createActivityGraph };
