"use strict";
/* APEX data catalog. Catalogs the app's own (public) sqlite tables so Jarvis
   can find/summarize them (apex_catalog_search / apex_data_summary). No local
   or proprietary files are read or shipped — APEX uses only public data. CommonJS. */

const fs = require("fs");

// No local/proprietary files — APEX is a shareable app and must use only
// public data sources. (Historical data comes from public APIs: Yahoo, Tiingo,
// Stooq, Binance, etc.) Cold-tier seeds from public datasets can be added here.
const LOCAL_FILES = [];

function readFirstLine(p) {
  const fd = fs.openSync(p, "r");
  try { const buf = Buffer.alloc(4096); const n = fs.readSync(fd, buf, 0, 4096, 0); return buf.slice(0, n).toString("utf8").split(/\r?\n/)[0]; }
  finally { fs.closeSync(fd); }
}

function createDataCatalog({ apexDb }) {
  function catalogFile(f) {
    try {
      const st = fs.statSync(f.path);
      if (!st.isFile()) return;
      let columns = [], kind = "dataset", rowGuess = null;
      if (/\.csv$/i.test(f.path)) {
        const head = readFirstLine(f.path);
        columns = head ? head.split(",").map((s) => s.trim()) : [];
        rowGuess = Math.round(st.size / Math.max(1, (head || "").length + 1));
      }
      apexDb.upsertCatalog({ id: "file:" + f.name, kind, name: f.name, path: f.path, source: f.source || "local", columns, row_count: rowGuess, summary: `${f.summary} · ${(st.size / 1e6).toFixed(1)}MB` });
    } catch { /* file missing — skip */ }
  }

  function catalogLocal() { for (const f of LOCAL_FILES) catalogFile(f); }
  function snapshotTables() { try { apexDb.pruneFileCatalog(LOCAL_FILES.map((f) => f.name)); apexDb.pruneCatalog(); apexDb.snapshotCatalog(); } catch { /* noop */ } }

  return { catalogLocal, snapshotTables, LOCAL_FILES };
}

module.exports = { createDataCatalog, LOCAL_FILES };
