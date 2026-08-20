// Semantic tool retrieval — the index behind tool selection.
//
// WHY THIS EXISTS
// `selectTools` picked tools by lexical keyword score plus 57 hand-written regex rules. Measured
// over 45 prompts: 76% intent hit-rate on wording that happens to match the hardcoded vocabulary,
// but only 40% on ordinary paraphrases of the same requests ("do I need an umbrella this
// afternoon" retrieved atlas/ui/stage tools and never weather_forecast). The rules only work for
// phrasings someone already anticipated.
//
// This module embeds every capability once and ranks them against the turn by meaning, so wording
// the author never imagined still finds the right tool. It is deliberately NOT a replacement for
// the lexical scorer — dense embeddings miss exact tokens ("kalshi", "instagram", "canvas") that
// lexical matching nails, so the caller fuses both rankings. See IMPLEMENTATION_SPEC.md.
//
// DESIGN NOTES
// - Own SQLite file. It never touches runtime/memory-vectors.sqlite (different key semantics, and
//   that file's backfill would treat tool rows as memories).
// - Rows are keyed by tool name and carry a content hash of name+description, so editing one
//   description re-embeds exactly one row instead of the whole catalog.
// - Batched: 158 tools is ~8 HTTP calls via :batchEmbedContents, not 158.
// - `gemini-embedding-2` does NOT support the taskType parameter (that was gemini-embedding-001);
//   task framing goes in the text itself.
// - 768 dimensions: Matryoshka-truncatable and auto-normalised by the model at this size.
// - Everything fails soft. If the key is missing, the API blinks, or the index is cold, retrieve()
//   returns [] and the caller keeps using the lexical path. Tool selection must never hard-fail
//   because an embedding call failed.
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

// Cosine is inlined rather than imported from memory-vectors. Importing it tripped the Memory
// vNext boundary guard (scripts/memory-vnext-boundary-guard.mjs) — "imports a legacy memory
// constructor outside the approved composition root" — because requiring that module pulls in its
// factory as well. Six lines of arithmetic is a smaller price than a boundary violation.
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const EMBED_MODEL = "gemini-embedding-2";
const API_BASE = "https://generativelanguage.googleapis.com";
const DIMS = 768;
const BATCH = 20;

const toBuffer = (floats) => Buffer.from(new Float32Array(floats).buffer);
const fromBuffer = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

// What actually gets embedded for a tool. Name is included with underscores split out so
// "pc_graph_search" contributes the words "pc graph search".
const docText = (def) => `${String(def.name || "").replace(/_/g, " ")}: ${def.description || ""}`;
const contentHash = (def) => crypto.createHash("sha1").update(docText(def)).digest("hex").slice(0, 16);

function createToolRetrieval({ runtimeDir, getSettings, definitions = [], fetchImpl = fetch }) {
  const db = new Database(path.join(runtimeDir, "tool-vectors.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS tool_vectors (
    name TEXT PRIMARY KEY, hash TEXT, text TEXT, vec BLOB, dim INTEGER, model TEXT, created_at TEXT
  );`);
  const upsertStmt = db.prepare(`INSERT INTO tool_vectors (name, hash, text, vec, dim, model, created_at)
    VALUES (@name, @hash, @text, @vec, @dim, @model, @created_at)
    ON CONFLICT(name) DO UPDATE SET hash=excluded.hash, text=excluded.text, vec=excluded.vec,
      dim=excluded.dim, model=excluded.model, created_at=excluded.created_at`);
  const allStmt = db.prepare("SELECT name, vec FROM tool_vectors");
  const hashStmt = db.prepare("SELECT hash FROM tool_vectors WHERE name=?");
  const countStmt = db.prepare("SELECT COUNT(*) c FROM tool_vectors");

  let lastError = "";
  let warming = false;
  // ready() and the row set are consulted on EVERY tool turn, so neither may re-query the whole
  // catalog each time: ready() would otherwise run 158 SELECTs + 158 SHA-1 hashes per turn, and
  // retrieve() would re-read and re-decode 158 BLOBs. Both are cached and invalidated by warm().
  let readyCache = null;
  let rowCache = null;
  const invalidateCaches = () => { readyCache = null; rowCache = null; };

  async function embedBatch(texts) {
    const key = getSettings()?.geminiKey;
    if (!key) throw new Error("no gemini key");
    const body = JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: String(text || "").slice(0, 8000) }] },
        outputDimensionality: DIMS,
      })),
    });
    const resp = await fetchImpl(`${API_BASE}/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${key}`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    if (!resp.ok) throw new Error(`batchEmbed ${resp.status}`);
    const json = await resp.json();
    const out = (json.embeddings || []).map((e) => e.values || []);
    if (out.length !== texts.length) throw new Error(`batchEmbed returned ${out.length}/${texts.length}`);
    return out;
  }

  // Embed only the tools whose text is new or changed. Returns how many rows were written.
  async function warm() {
    if (warming) return 0;
    warming = true;
    try {
      const stale = definitions.filter((def) => {
        if (!def?.name) return false;
        const row = hashStmt.get(def.name);
        return !row || row.hash !== contentHash(def);
      });
      let written = 0;
      for (let i = 0; i < stale.length; i += BATCH) {
        const slice = stale.slice(i, i + BATCH);
        let vectors;
        try {
          vectors = await embedBatch(slice.map(docText));
        } catch (error) {
          lastError = error.message;
          break; // leave the rest for the next warm(); never throw into the caller
        }
        const now = new Date().toISOString();
        for (let k = 0; k < slice.length; k++) {
          const values = vectors[k] || [];
          if (!values.length) continue;
          upsertStmt.run({
            name: slice[k].name, hash: contentHash(slice[k]), text: docText(slice[k]).slice(0, 1000),
            vec: toBuffer(values), dim: values.length, model: EMBED_MODEL, created_at: now,
          });
          written++;
        }
      }
      if (written) { lastError = ""; invalidateCaches(); }
      return written;
    } finally {
      warming = false;
    }
  }

  // True once every current definition has an up-to-date vector. The caller uses this as a
  // cold-start guard so the first turn after a restart is not silently degraded.
  function ready() {
    if (readyCache !== null) return readyCache;
    try {
      readyCache = definitions.every((def) => {
        const row = hashStmt.get(def.name);
        return row && row.hash === contentHash(def);
      });
    } catch { readyCache = false; }
    return readyCache;
  }

  async function retrieve(query, { limit = 8, minScore = 0.3 } = {}) {
    const text = String(query || "").trim();
    if (!text) return [];
    if (!rowCache) {
      try { rowCache = allStmt.all().map((row) => ({ name: row.name, vec: fromBuffer(row.vec) })); }
      catch { return []; }
    }
    const rows = rowCache;
    if (!rows.length) return [];
    let qv;
    try {
      const [values] = await embedBatch([text]);
      if (!values?.length) return [];
      qv = new Float32Array(values);
    } catch (error) {
      lastError = error.message;
      return []; // soft-fail: caller falls back to lexical
    }
    return rows
      .map((row) => ({ name: row.name, score: cosine(qv, row.vec) }))
      .filter((hit) => hit.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function count() { try { return countStmt.get().c; } catch { return 0; } }
  function status() {
    return { model: EMBED_MODEL, dims: DIMS, indexed: count(), total: definitions.length, ready: ready(), lastError };
  }

  return { retrieve, warm, ready, count, status, db };
}

module.exports = { createToolRetrieval, docText, contentHash };
