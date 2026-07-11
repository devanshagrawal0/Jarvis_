const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function tokenize(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])];
}

const TEST_SOURCE_PATTERN = /(^|[-_/])(test|spec|fixture|benchmark|eval)([-_/]|$)/i;
const FAILURE_PATTERN = /\b(could not|couldn't|cannot|can't|failed|failure|timed out|unavailable|not connected|not configured|no successful result|invalid command|unable to)\b/i;
const LOW_VALUE_ASSISTANT_PATTERN = /^(understood|okay|ok|noted|sure|done|on it|i have it|how can i assist you)[,.! ]*$/i;
const CORRECTION_PATTERN = /\b(actually|correction|i meant|rather than|not .+ but|from now on|no longer|instead)\b/i;

function createMemoryStore(runtimeDir, { neuralVaultBridge } = {}) {
  // Unified DB: all short-term memories live in neural_vault.sqlite alongside long-term memories
  const dbDir = path.join(runtimeDir, "neural_vault", "db");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "neural_vault.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS ms_memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      category TEXT NOT NULL,
      text TEXT NOT NULL,
      normalized_text TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      supersedes_id TEXT,
      deleted_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS ms_memories_active_idx ON ms_memories(deleted_at, category, updated_at);
    CREATE TABLE IF NOT EXISTS ms_memory_terms (
      memory_id TEXT NOT NULL REFERENCES ms_memories(id) ON DELETE CASCADE,
      term TEXT NOT NULL,
      PRIMARY KEY(memory_id, term)
    );
    CREATE INDEX IF NOT EXISTS ms_memory_terms_term_idx ON ms_memory_terms(term);
    CREATE TABLE IF NOT EXISTS ms_memory_events (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ms_memory_entities (
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      memory_id TEXT NOT NULL REFERENCES ms_memories(id) ON DELETE CASCADE,
      PRIMARY KEY(name, type, memory_id)
    );
    CREATE INDEX IF NOT EXISTS ms_memory_entities_name_idx ON ms_memory_entities(name, type);
    CREATE TABLE IF NOT EXISTS ms_working_memory (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      PRIMARY KEY(namespace, key)
    );
  `);

  const insertMemory = db.prepare(`
    INSERT INTO ms_memories (
      id, kind, category, text, normalized_text, source, confidence, importance,
      created_at, updated_at, expires_at, supersedes_id, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertTerm = db.prepare("INSERT OR IGNORE INTO ms_memory_terms(memory_id, term) VALUES (?, ?)");
  const insertEvent = db.prepare("INSERT INTO ms_memory_events(id, memory_id, action, detail_json, created_at) VALUES (?, ?, ?, ?, ?)");
  const insertEntity = db.prepare("INSERT OR IGNORE INTO ms_memory_entities(name, type, memory_id) VALUES (?, ?, ?)");

  function extractEntities(text) {
    const values = [];
    for (const email of String(text).match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) || []) values.push({ name: email.toLowerCase(), type: "email" });
    for (const handle of String(text).match(/@[A-Za-z0-9_.]{2,}/g) || []) values.push({ name: handle.toLowerCase(), type: "handle" });
    for (const url of String(text).match(/https?:\/\/[^\s)]+/g) || []) values.push({ name: url, type: "url" });
    for (const name of String(text).match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || []) {
      if (!["User", "Jarvis", "JARVIS"].includes(name)) values.push({ name, type: "named-entity" });
    }
    return [...new Map(values.map((item) => [`${item.type}:${item.name}`, item])).values()].slice(0, 30);
  }

  function add(data = {}) {
    const text = String(data.text || "").trim().slice(0, 8000);
    if (!text) throw Object.assign(new Error("Memory text is required"), { statusCode: 400 });
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      kind: String(data.kind || "semantic").slice(0, 40),
      category: String(data.category || "personal").slice(0, 80),
      text,
      normalizedText: text.toLowerCase().replace(/\s+/g, " "),
      source: String(data.source || "user").slice(0, 160),
      confidence: Math.max(0, Math.min(1, Number(data.confidence ?? 1))),
      importance: Math.max(0, Math.min(1, Number(data.importance ?? 0.5))),
      createdAt: now,
      updatedAt: now,
      expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
      supersedesId: data.supersedesId ? String(data.supersedesId) : null,
      metadata: data.metadata && typeof data.metadata === "object" ? data.metadata : {},
    };
    const doInsert = db.transaction(() => {
      insertMemory.run(
        item.id, item.kind, item.category, item.text, item.normalizedText, item.source,
        item.confidence, item.importance, item.createdAt, item.updatedAt, item.expiresAt,
        item.supersedesId, JSON.stringify(item.metadata),
      );
      for (const term of tokenize(`${item.category} ${item.text}`)) insertTerm.run(item.id, term);
      for (const entity of extractEntities(item.text)) insertEntity.run(entity.name, entity.type, item.id);
      if (item.supersedesId) {
        db.prepare("UPDATE ms_memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
          .run(now, now, item.supersedesId);
      }
      insertEvent.run(crypto.randomUUID(), item.id, "created", JSON.stringify({ source: item.source }), now);
    });
    doInsert();
    // Shadow write to neural vault so it appears in hybrid context pack searches
    if (neuralVaultBridge) {
      try {
        neuralVaultBridge.upsertMemory({
          kind: item.kind || "semantic",
          content: item.text,
          summary: item.text.slice(0, 280),
          topic: item.category || null,
          importance: Math.round(item.importance * 10),
          confidence: item.confidence,
          sourceType: item.source || "conversation",
          metadata: item.metadata,
        });
      } catch {}
    }
    return item;
  }

  function search(query, options = {}) {
    const terms = tokenize(query).slice(0, 12);
    const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
    const kinds = Array.isArray(options.kinds) ? options.kinds.map(String).filter(Boolean) : [];
    const now = new Date().toISOString();
    const kindClause = kinds.length ? ` AND m.kind IN (${kinds.map(() => "?").join(",")})` : "";
    const kindArgs = kinds.length ? kinds : [];
    const candidates = terms.length
      ? db.prepare(`
          SELECT m.*, COUNT(mt.term) AS term_hits
          FROM ms_memories m
          JOIN ms_memory_terms mt ON mt.memory_id = m.id
          WHERE mt.term IN (${terms.map(() => "?").join(",")})
            AND m.deleted_at IS NULL
            AND (m.expires_at IS NULL OR m.expires_at > ?)
            ${kindClause}
          GROUP BY m.id
          ORDER BY term_hits DESC, m.importance DESC, m.updated_at DESC
          LIMIT ?
        `).all(...terms, now, ...kindArgs, limit * 4)
      : db.prepare(`
          SELECT m.*, 0 AS term_hits FROM ms_memories m
          WHERE m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?)
          ${kindClause}
          ORDER BY m.importance DESC, m.updated_at DESC LIMIT ?
        `).all(now, ...kindArgs, limit);
    return candidates.map((row) => {
      const exact = row.normalized_text.includes(String(query || "").toLowerCase()) ? 1 : 0;
      const score = Number(row.term_hits || 0) * 0.2 + Number(row.importance) * 0.35 + Number(row.confidence) * 0.25 + exact * 0.2;
      return {
        id: row.id,
        kind: row.kind,
        category: row.category,
        text: row.text,
        source: row.source,
        confidence: row.confidence,
        importance: row.importance,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        metadata: JSON.parse(row.metadata_json || "{}"),
        score: Number(score.toFixed(4)),
      };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  function forget(id, reason = "user request") {
    const now = new Date().toISOString();
    const result = db.prepare("UPDATE ms_memories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, now, id);
    if (!result.changes) throw Object.assign(new Error("Memory not found"), { statusCode: 404 });
    insertEvent.run(crypto.randomUUID(), id, "forgotten", JSON.stringify({ reason }), now);
    return { forgotten: true, id, reason };
  }

  function correct(id, data) {
    const existing = db.prepare("SELECT * FROM ms_memories WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!existing) throw Object.assign(new Error("Memory not found"), { statusCode: 404 });
    return add({
      text: data.text,
      kind: data.kind || existing.kind,
      category: data.category || existing.category,
      source: data.source || "user-correction",
      confidence: data.confidence ?? 1,
      importance: data.importance ?? existing.importance,
      expiresAt: data.expiresAt ?? existing.expires_at,
      metadata: { ...(JSON.parse(existing.metadata_json || "{}")), ...(data.metadata || {}), correctedFrom: id },
      supersedesId: id,
    });
  }

  function stats() {
    const row = db.prepare(`
      SELECT COUNT(*) AS active,
        SUM(CASE WHEN kind = 'episodic' THEN 1 ELSE 0 END) AS episodic,
        SUM(CASE WHEN kind = 'semantic' THEN 1 ELSE 0 END) AS semantic,
        SUM(CASE WHEN kind = 'procedural' THEN 1 ELSE 0 END) AS procedural
      FROM ms_memories WHERE deleted_at IS NULL
    `).get();
    return { ...row, dbPath };
  }

  function upsert(data = {}) {
    const normalized = String(data.text || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!normalized) throw Object.assign(new Error("Memory text is required"), { statusCode: 400 });
    const existing = db.prepare(`
      SELECT * FROM ms_memories
      WHERE normalized_text = ? AND kind = ? AND category = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 1
    `).get(normalized, String(data.kind || "semantic"), String(data.category || "personal"));
    if (!existing) return add(data);
    const now = new Date().toISOString();
    db.prepare("UPDATE ms_memories SET confidence=?, importance=?, updated_at=?, metadata_json=? WHERE id=?")
      .run(
        Math.max(Number(existing.confidence), Number(data.confidence ?? existing.confidence)),
        Math.max(Number(existing.importance), Number(data.importance ?? existing.importance)),
        now,
        JSON.stringify({ ...(JSON.parse(existing.metadata_json || "{}")), ...(data.metadata || {}), reinforcedAt: now }),
        existing.id,
      );
    insertEvent.run(crypto.randomUUID(), existing.id, "reinforced", JSON.stringify({ source: data.source || "conversation" }), now);
    return { ...data, id: existing.id, reinforced: true, updatedAt: now };
  }

  function setWorking(namespace, key, value, ttlMs = 2 * 60 * 60 * 1000) {
    const now = new Date();
    const expiresAt = ttlMs ? new Date(now.getTime() + ttlMs).toISOString() : null;
    db.prepare(`
      INSERT INTO ms_working_memory(namespace, key, value_json, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        value_json=excluded.value_json, updated_at=excluded.updated_at, expires_at=excluded.expires_at
    `).run(String(namespace), String(key), JSON.stringify(value), now.toISOString(), expiresAt);
    return { namespace, key, value, updatedAt: now.toISOString(), expiresAt };
  }

  function getWorking(namespace) {
    const now = new Date().toISOString();
    db.prepare("DELETE FROM ms_working_memory WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
    return Object.fromEntries(
      db.prepare("SELECT key, value_json FROM ms_working_memory WHERE namespace = ? ORDER BY updated_at").all(String(namespace))
        .map((row) => [row.key, JSON.parse(row.value_json)]),
    );
  }

  function latestActive(kind, category) {
    return db.prepare(`
      SELECT * FROM ms_memories
      WHERE kind = ? AND category = ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 1
    `).get(kind, category);
  }

  function storeExtractedMemory(data, correction) {
    if (!correction) return upsert(data);
    const previous = latestActive(data.kind, data.category);
    if (!previous) return upsert(data);
    if (previous.normalized_text === String(data.text).toLowerCase().replace(/\s+/g, " ")) return upsert(data);
    return correct(previous.id, {
      ...data,
      source: `${data.source}:correction`,
      metadata: { ...(data.metadata || {}), explicitCorrection: true },
    });
  }

  function isSuccessfulEpisode(user, assistant, metadata) {
    const source = String(metadata.source || "");
    if (TEST_SOURCE_PATTERN.test(source)) return false;
    if (!user || !assistant || LOW_VALUE_ASSISTANT_PATTERN.test(assistant) || FAILURE_PATTERN.test(assistant)) return false;
    if (metadata.outcome && !["success", "partial_success", "recovery"].includes(metadata.outcome)) return false;
    const toolEvidence = Array.isArray(metadata.tools) && metadata.tools.length > 0;
    const durableEvent = /\b(completed|finished|sent|scheduled|booked|opened|created|updated|deployed|decided|agreed|deadline|appointment|meeting|commitment|milestone)\b/i.test(`${user} ${assistant}`);
    return toolEvidence || durableEvent || ["success", "partial_success", "recovery"].includes(metadata.outcome);
  }

  function splitUserStatements(user) {
    return user
      .split(/(?<=[.!?])\s+|\n+|;\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function ingestTurn({ userText, assistantText, source = "chat", metadata = {} }) {
    const user = String(userText || "").trim();
    const assistant = String(assistantText || "").trim();
    const stored = [];
    const enrichedMetadata = { ...metadata, source };
    if (isSuccessfulEpisode(user, assistant, enrichedMetadata)) {
      stored.push(upsert({
        kind: "episodic",
        category: "conversation",
        text: `User: ${user.slice(0, 3000)}\nJARVIS: ${assistant.slice(0, 5000)}`,
        source,
        confidence: 0.85,
        importance: metadata.tools?.length ? 0.65 : 0.35,
        expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
        metadata,
      }));
    }
    const sentences = splitUserStatements(user);
    for (const sentence of sentences) {
      const correction = CORRECTION_PATTERN.test(sentence);
      if (/\b(i prefer|i'd prefer|i would prefer|i like|i love|i hate|i dislike|my favorite|my favourite|my name is|i am studying|i study|i work at|i live in|call me|address me|my timezone is|my pronouns are)\b/i.test(sentence)) {
        stored.push(storeExtractedMemory({
          kind: "semantic",
          category: /\bprefer|like|love|hate|dislike|favou?rite\b/i.test(sentence) ? "preference" : "personal",
          text: sentence.slice(0, 1200),
          source,
          confidence: correction ? 1 : 0.94,
          importance: correction ? 0.95 : 0.82,
          metadata: { extractedFromTurn: true, explicitCorrection: correction },
        }, correction));
      }
      if (/\b(always|never|when i ask|whenever i|from now on|please make sure|do not|don't|before you|after you|by default|unless i|stop doing|start doing)\b/i.test(sentence)) {
        stored.push(storeExtractedMemory({
          kind: "procedural",
          category: "interaction-rule",
          text: sentence.slice(0, 1200),
          source,
          confidence: correction ? 1 : 0.92,
          importance: 0.94,
          metadata: { extractedFromTurn: true, explicitCorrection: correction },
        }, correction));
      }
    }
    setWorking(source, "lastTurn", { user, assistant, at: new Date().toISOString() });
    return stored;
  }

  function profile(limit = 40) {
    return {
      semantic: search("", { limit, kinds: ["semantic"] }),
      procedural: search("", { limit, kinds: ["procedural"] }),
      recentEpisodes: search("", { limit: Math.min(12, limit), kinds: ["episodic"] }),
    };
  }

  function bucketForMemory(memory) {
    const text = `${memory.category} ${memory.text}`.toLowerCase();
    if (/\b(class|course|canvas|assignment|homework|exam|quiz|northeastern|neu)\b/.test(text)) return "classes";
    if (/\b(project|repo|codex|github|build|app|website|jarvis)\b/.test(text)) return "projects";
    if (/\b(prefers?|preferred|favorite|like|likes|love|loves|hate|hates|dislike|dislikes|style|tone|ui|design)\b/.test(text)) return "preferences";
    if (/\b(always|never|when i ask|by default|routine|every day|morning|night)\b/.test(text)) return "routines";
    if (/\b(goal|need to|want to|plan|deadline|finish|prepare)\b/.test(text)) return "goals";
    if (/\b(kalshi|google|gmail|canvas|instagram|twilio|cloudflare|phone|device)\b/.test(text)) return "accounts";
    if (/\b(friend|professor|teacher|classmate|manager|mom|dad|email|@)\b/.test(text)) return "people";
    return memory.kind === "procedural" ? "routines" : "facts";
  }

  function lifeGraph(options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 120)));
    const allMemories = [
      ...search("", { limit, kinds: ["semantic"] }),
      ...search("", { limit, kinds: ["procedural"] }),
      ...search("", { limit: Math.min(40, limit), kinds: ["episodic"] }),
    ];
    const unique = [...new Map(allMemories.map((memory) => [memory.id, memory])).values()];
    const buckets = {
      people: [],
      classes: [],
      projects: [],
      preferences: [],
      routines: [],
      goals: [],
      accounts: [],
      facts: [],
    };
    for (const memory of unique) {
      const bucket = bucketForMemory(memory);
      buckets[bucket].push({
        id: memory.id,
        kind: memory.kind,
        category: memory.category,
        text: memory.text,
        source: memory.source,
        confidence: memory.confidence,
        importance: memory.importance,
        updatedAt: memory.updatedAt,
        metadata: memory.metadata,
      });
    }
    const entities = db.prepare(`
      SELECT type, name, COUNT(*) AS count
      FROM ms_memory_entities
      GROUP BY type, name
      ORDER BY count DESC, name
      LIMIT 80
    `).all();
    return {
      generatedAt: new Date().toISOString(),
      stats: stats(),
      buckets,
      entities,
      summary: Object.fromEntries(Object.entries(buckets).map(([key, values]) => [key, values.length])),
    };
  }

  return {
    add,
    upsert,
    search,
    forget,
    correct,
    stats,
    ingestTurn,
    setWorking,
    getWorking,
    profile,
    lifeGraph,
    close: () => db.close(),
    dbPath,
  };
}

module.exports = { createMemoryStore };
