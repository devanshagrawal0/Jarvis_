"use strict";

// The phone's Files tab: browse THIS PC's real filesystem, open files on the PC, and pull them to
// the phone. Owner-surface only (server.js gates every route with isOwnerSurface). This is the
// owner's own machine over their own tailnet, so browsing is the point — but downloads still refuse
// obvious secret files by name, and everything degrades gracefully on a permission error.

const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const SECRET_RE = /(^\.env|\.env$|secret|credential|\.pem$|\.key$|\.pfx$|id_rsa|\.ppk$)/i;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".svg", ".ico"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"]);
const DOC_EXT = new Set([".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".odt", ".pages"]);
const SHEET_EXT = new Set([".xls", ".xlsx", ".csv", ".numbers"]);
const CODE_EXT = new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".c", ".cpp", ".cs", ".java", ".go", ".rs", ".html", ".css", ".json", ".xml", ".yml", ".yaml", ".sh", ".ps1"]);
const ARCHIVE_EXT = new Set([".zip", ".rar", ".7z", ".tar", ".gz"]);

function kindOf(name, isDir) {
  if (isDir) return "folder";
  const e = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  if (DOC_EXT.has(e)) return "doc";
  if (SHEET_EXT.has(e)) return "sheet";
  if (CODE_EXT.has(e)) return "code";
  if (ARCHIVE_EXT.has(e)) return "archive";
  if (e === ".exe" || e === ".msi" || e === ".lnk" || e === ".bat") return "app";
  return "file";
}

function createPcFiles({ log = () => {} } = {}) {
  const home = os.homedir();
  const q = (p) => path.join(home, p);

  // Quick-access roots the owner actually uses. Only the ones that exist on this PC are returned.
  function roots() {
    const list = [
      { id: "home", name: "Home", path: home, icon: "home" },
      { id: "desktop", name: "Desktop", path: q("Desktop"), icon: "desktop" },
      { id: "downloads", name: "Downloads", path: q("Downloads"), icon: "download" },
      { id: "documents", name: "Documents", path: q("Documents"), icon: "doc" },
      { id: "pictures", name: "Pictures", path: q("Pictures"), icon: "image" },
      { id: "videos", name: "Videos", path: q("Videos"), icon: "video" },
      { id: "music", name: "Music", path: q("Music"), icon: "audio" },
    ].filter((r) => { try { return fs.existsSync(r.path); } catch { return false; } });
    // drives (C:, D:, …)
    if (process.platform === "win32") {
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const drive = `${letter}:\\`;
        try { if (fs.existsSync(drive)) list.push({ id: `drive-${letter}`, name: `${letter}: drive`, path: drive, icon: "drive" }); } catch { /* not present */ }
      }
    }
    return list;
  }

  async function list(dir, { limit = 500 } = {}) {
    const resolved = path.resolve(dir || home);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const out = [];
    for (const ent of entries) {
      if (ent.name.startsWith(".") && ent.name !== "..") continue;                 // hidden
      const full = path.join(resolved, ent.name);
      let isDir = ent.isDirectory();
      let size = 0, mtime = 0;
      try { const st = await fsp.stat(full); isDir = st.isDirectory(); size = st.size; mtime = st.mtimeMs; }
      catch { continue; }                                                          // no permission / gone
      out.push({ name: ent.name, path: full, dir: isDir, kind: kindOf(ent.name, isDir), size, mtime: Math.round(mtime) });
      if (out.length >= limit) break;
    }
    // folders first, then by name
    out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
    const parent = path.dirname(resolved);
    return { path: resolved, parent: parent === resolved ? "" : parent, name: path.basename(resolved) || resolved, entries: out };
  }

  // Recursive-ish search under a base folder (bounded), newest-matching first.
  async function search(base, query, { limit = 60, maxScan = 6000 } = {}) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return { query, results: [] };
    const root = path.resolve(base || home);
    const results = [];
    let scanned = 0;
    const queue = [root];
    while (queue.length && scanned < maxScan && results.length < limit) {
      const dir = queue.shift();
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        scanned += 1;
        const full = path.join(dir, ent.name);
        if (ent.name.toLowerCase().includes(needle)) {
          let size = 0, mtime = 0; try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { /* skip */ }
          results.push({ name: ent.name, path: full, dir: ent.isDirectory(), kind: kindOf(ent.name, ent.isDirectory()), size, mtime: Math.round(mtime) });
          if (results.length >= limit) break;
        }
        if (ent.isDirectory() && queue.length < 400) queue.push(full);
      }
    }
    results.sort((a, b) => b.mtime - a.mtime);
    return { query, results };
  }

  function statOne(p) {
    const resolved = path.resolve(p);
    const st = fs.statSync(resolved);
    return { path: resolved, name: path.basename(resolved), dir: st.isDirectory(), kind: kindOf(resolved, st.isDirectory()), size: st.size, mtime: Math.round(st.mtimeMs) };
  }

  // Open a file or folder on the PC with its default handler.
  function openOnPc(p) {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved)) throw Object.assign(new Error("That file no longer exists."), { statusCode: 404 });
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", resolved], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn("xdg-open", [resolved], { detached: true, stdio: "ignore" }).unref();
    return { opened: resolved, name: path.basename(resolved) };
  }

  // Reveal a file in Explorer (select it).
  function revealOnPc(p) {
    const resolved = path.resolve(p);
    if (process.platform === "win32") spawn("explorer.exe", ["/select,", resolved], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn("xdg-open", [path.dirname(resolved)], { detached: true, stdio: "ignore" }).unref();
    return { revealed: resolved };
  }

  // A file to stream to the phone (download or inline preview). Refuse obvious secrets and huge files.
  function fileForServe(p, { maxBytes = 512 * 1024 * 1024 } = {}) {
    const resolved = path.resolve(p);
    const st = fs.statSync(resolved);
    if (st.isDirectory()) throw Object.assign(new Error("That is a folder."), { statusCode: 400 });
    if (SECRET_RE.test(path.basename(resolved))) throw Object.assign(new Error("That file is blocked for safety."), { statusCode: 403 });
    if (st.size > maxBytes) throw Object.assign(new Error("That file is too large to send to the phone."), { statusCode: 413 });
    return { path: resolved, name: path.basename(resolved), size: st.size, kind: kindOf(resolved, false) };
  }

  // Phone → PC: pick a destination path inside `dir` for an uploaded file, never overwriting an
  // existing one (adds " (1)", " (2)", …). Returns the path to stream the request body into.
  function uploadTarget(dir, name) {
    const destDir = path.resolve(dir || home);
    if (!fs.existsSync(destDir) || !fs.statSync(destDir).isDirectory()) throw Object.assign(new Error("Destination folder does not exist."), { statusCode: 400 });
    const clean = path.basename(String(name || "upload").replace(/[\\/:*?"<>|]/g, "_")).slice(0, 180) || "upload";
    const ext = path.extname(clean), stem = clean.slice(0, clean.length - ext.length);
    let candidate = path.join(destDir, clean), n = 1;
    while (fs.existsSync(candidate)) { candidate = path.join(destDir, `${stem} (${n})${ext}`); n += 1; }
    return { path: candidate, name: path.basename(candidate), dir: destDir };
  }

  async function thumbnail(p, { size = 240 } = {}) {
    const resolved = path.resolve(p);
    if (!IMAGE_EXT.has(path.extname(resolved).toLowerCase()) || path.extname(resolved).toLowerCase() === ".svg") return null;
    try {
      const sharp = require("sharp");
      return await sharp(resolved).rotate().resize(size, size, { fit: "cover" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    } catch (e) { log(`thumb failed ${path.basename(resolved)}: ${e.message}`); return null; }
  }

  return { roots, list, search, statOne, openOnPc, revealOnPc, fileForServe, thumbnail, uploadTarget };
}

module.exports = { createPcFiles };
