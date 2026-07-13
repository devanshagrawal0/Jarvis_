// Cortex v4 · 2.3 — Embedding-2 semantic memory. Non-destructive: keeps its OWN
// SQLite file (runtime/memory-vectors.sqlite) and NEVER writes to the 704 MB Neural
// Vault. Vectors are computed lazily/on-backfill from vault memory text, so semantic
// recall ("my pet" → "husky named Pixel") augments the existing lexical/graph search.
const path = require("path");
const Database = require("better-sqlite3");

const EMBED_MODEL = "gemini-embedding-2";
const API_BASE = "https://generativelanguage.googleapis.com";

function toBuffer(floats) {
  return Buffer.from(new Float32Array(floats).buffer);
}
function fromBuffer(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function createMemoryVectors({ runtimeDir, getSettings, fetchImpl = fetch }) {
  const db = new Database(path.join(runtimeDir, "memory-vectors.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS vectors (
    memory_id TEXT PRIMARY KEY, text TEXT, vec BLOB, dim INTEGER, model TEXT, created_at TEXT
  );`);
  const upsertStmt = db.prepare(`INSERT INTO vectors (memory_id, text, vec, dim, model, created_at)
    VALUES (@memory_id, @text, @vec, @dim, @model, @created_at)
    ON CONFLICT(memory_id) DO UPDATE SET text=excluded.text, vec=excluded.vec, dim=excluded.dim, model=excluded.model, created_at=excluded.created_at`);
  const hasStmt = db.prepare("SELECT 1 FROM vectors WHERE memory_id=?");
  const allStmt = db.prepare("SELECT memory_id, text, vec FROM vectors");

  async function embed(text) {
    const key = getSettings().geminiKey;
    if (!key) throw new Error("no gemini key");
    const body = JSON.stringify({ content: { parts: [{ text: String(text || "").slice(0, 8000) }] } });
    const resp = await fetchImpl(`${API_BASE}/v1beta/models/${EMBED_MODEL}:embedContent?key=${key}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    if (!resp.ok) throw new Error(`embed ${resp.status}`);
    const j = await resp.json();
    const values = j.embedding?.values || j.embedding?.value || [];
    if (!values.length) throw new Error("empty embedding");
    return values;
  }

  async function remember(memoryId, text) {
    if (!memoryId || !String(text || "").trim()) return false;
    if (hasStmt.get(memoryId)) return false; // already vectorized
    const values = await embed(text);
    upsertStmt.run({ memory_id: memoryId, text: String(text).slice(0, 2000), vec: toBuffer(values), dim: values.length, model: EMBED_MODEL, created_at: new Date().toISOString() });
    return true;
  }

  async function search(queryText, { limit = 8, minScore = 0.35 } = {}) {
    const rows = allStmt.all();
    if (!rows.length) return [];
    const qv = new Float32Array(await embed(queryText));
    const scored = rows.map((r) => ({ memory_id: r.memory_id, text: r.text, score: cosine(qv, fromBuffer(r.vec)) }));
    return scored.filter((s) => s.score >= minScore).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // Backfill vectors for memories that don't have one yet. Throttled + capped so it
  // never hammers the embedding API or blocks startup.
  async function backfill(memories, { max = 40, delayMs = 120 } = {}) {
    let added = 0;
    for (const m of memories.slice(0, max)) {
      const id = m.id || m.memory_id;
      const text = m.summary || m.content || m.text || "";
      if (!id || !String(text).trim() || hasStmt.get(id)) continue;
      try { if (await remember(id, text)) added++; } catch { /* skip one, keep going */ }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    return added;
  }

  function count() { try { return db.prepare("SELECT COUNT(*) c FROM vectors").get().c; } catch { return 0; } }

  return { embed, remember, search, backfill, count, db };
}

module.exports = { createMemoryVectors, cosine };
