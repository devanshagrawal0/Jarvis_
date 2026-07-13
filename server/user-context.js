// ─────────────────────────────────────────────────────────────────────────
//  Personal Vault — the single "everything about me" store  (Cortex v3)
//
//  One SQLite DB holding all durable knowledge about the owner, split into an
//  ALWAYS-IN-CONTEXT core (identity + top preferences + active goals + resolved
//  location/time) and RETRIEVED-ON-DEMAND detail (contacts, health, finance
//  refs, documents, facts…). Pattern: Letta core-memory-blocks + ChatGPT
//  "Model Set Context" + Apple on-device semantic index.
//
//  Trust: everything here is AUTHORITATIVE first-person truth about the owner
//  (instruction hierarchy: System > user_profile > user msg > memory > web).
//  Secrets are NEVER stored — only references (last4, keychain pointers).
//
//  NOTE (Wave E): wrap with SQLCipher + Windows Credential Manager/DPAPI key
//  before storing sensitive health/finance rows. Schema is ready for it.
// ─────────────────────────────────────────────────────────────────────────
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

function createUserContext({ runtimeDir, owner = "Dev" }) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const db = new Database(path.join(runtimeDir, "user-context.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- ===== always-in-context core =====
    CREATE TABLE IF NOT EXISTS identity (
      id INTEGER PRIMARY KEY CHECK (id=1),
      legal_name TEXT, preferred_name TEXT, pronouns TEXT, birthdate TEXT,
      bio TEXT, primary_email TEXT, primary_phone TEXT,
      home_timezone TEXT, locale TEXT, photo_path TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS core_memory_blocks (
      label TEXT PRIMARY KEY, value TEXT NOT NULL,
      char_limit INTEGER DEFAULT 1500, updated_at TEXT, updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT, subject TEXT, value TEXT,
      strength REAL DEFAULT 1.0, source TEXT DEFAULT 'user_stated', updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pref_cat ON preferences(category);
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT, kind TEXT DEFAULT 'goal', status TEXT DEFAULT 'active',
      priority INTEGER DEFAULT 3, target_date TEXT, description TEXT, updated_at TEXT
    );
    -- ===== identity detail =====
    CREATE TABLE IF NOT EXISTS contact_methods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, label TEXT, value TEXT, is_primary INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, address TEXT,
      lat REAL, lng REAL, timezone TEXT, is_current INTEGER DEFAULT 0,
      source TEXT, valid_from TEXT, valid_to TEXT, confidence REAL DEFAULT 1.0, last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, os TEXT,
      last_active_at TEXT, is_current INTEGER DEFAULT 0
    );
    -- ===== people / CRM =====
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, relation TEXT, company TEXT, role TEXT,
      birthday TEXT, how_we_met TEXT, met_date TEXT, last_contact_at TEXT,
      strength TEXT, notes TEXT, contact_json TEXT
    );
    -- ===== schedule / routines =====
    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, rrule TEXT,
      start_local TEXT, duration_min INTEGER, location_id INTEGER, active INTEGER DEFAULT 1
    );
    -- ===== health (sensitive; gate + encrypt in Wave E) =====
    CREATE TABLE IF NOT EXISTS health_profile (
      id INTEGER PRIMARY KEY CHECK(id=1), height_cm REAL, weight_kg REAL, blood_type TEXT,
      allergies TEXT, conditions TEXT, medications TEXT, emergency_contact_id INTEGER, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS health_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, metric TEXT, value REAL, recorded_at TEXT
    );
    -- ===== finance (REFERENCES ONLY, never secrets) =====
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, institution TEXT, nickname TEXT,
      last4 TEXT, plaid_item_ref TEXT, balance_cached REAL, balance_at TEXT
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, amount REAL, cycle TEXT,
      renews_on TEXT, account_id INTEGER, active INTEGER DEFAULT 1
    );
    -- ===== travel / documents / vault pointers =====
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, destination TEXT,
      start_date TEXT, end_date TEXT, status TEXT, details_json TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, kind TEXT, path TEXT,
      expires_on TEXT, tags TEXT, added_at TEXT
    );
    CREATE TABLE IF NOT EXISTS vault_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, service TEXT, username TEXT, vault_key TEXT, notes TEXT, updated_at TEXT
    );
    -- ===== inferred patterns + catch-all semantic facts =====
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, observation TEXT, confidence REAL, evidence_count INTEGER DEFAULT 1, last_seen_at TEXT
    );
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, predicate TEXT, object TEXT,
      importance REAL DEFAULT 0.5, source TEXT, created_at TEXT, last_used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY, location_json TEXT, active_topic TEXT, last_intent TEXT, updated_at TEXT
    );
  `);

  const nowIso = () => new Date().toISOString();

  // ── One-time seed from known owner facts ───────────────────────────────
  if (!db.prepare("SELECT 1 FROM identity WHERE id=1").get()) {
    db.prepare(`INSERT INTO identity (id,legal_name,preferred_name,primary_email,home_timezone,locale,bio,updated_at)
                VALUES (1,?,?,?,?,?,?,?)`)
      .run("Devansh Agrawal", owner, "devanshhagrawal@gmail.com", "America/New_York", "en-US",
           "Northeastern University student; builds Jarvis Command OS + APEX/Arbiter trading tools.", nowIso());
    db.prepare("INSERT INTO locations (label,address,lat,lng,timezone,is_current,source,valid_from,confidence) VALUES ('home',?,?,?,?,1,'seed',?,1.0)")
      .run("Boston, MA", 42.3601, -71.0589, "America/New_York", nowIso());
    const pref = db.prepare("INSERT INTO preferences (category,subject,value,strength,source,updated_at) VALUES (?,?,?,?,?,?)");
    pref.run("comms", "reply_tone", "concise, direct, no filler", 1.0, "seed", nowIso());
    pref.run("comms", "address_style", "call me Dev", 1.0, "seed", nowIso());
    db.prepare("INSERT INTO core_memory_blocks (label,value,char_limit,updated_at,updated_by) VALUES (?,?,?,?,?)")
      .run("assistant_persona", "You are JARVIS — the owner's calm, sharp, capable operating intelligence. You act, not just answer.", 800, nowIso(), "seed");
  }

  // ── Identity / facts ───────────────────────────────────────────────────
  function getIdentity() { return db.prepare("SELECT * FROM identity WHERE id=1").get() || {}; }
  function updateIdentity(patch = {}) {
    const cols = ["legal_name", "preferred_name", "pronouns", "birthdate", "bio", "primary_email", "primary_phone", "home_timezone", "locale"];
    const sets = cols.filter((c) => c in patch);
    if (!sets.length) return;
    db.prepare(`UPDATE identity SET ${sets.map((c) => `${c}=?`).join(", ")}, updated_at=? WHERE id=1`)
      .run(...sets.map((c) => patch[c]), nowIso());
  }
  function addFact(subject, predicate, object, { importance = 0.5, source = "user_stated" } = {}) {
    db.prepare("INSERT INTO facts (subject,predicate,object,importance,source,created_at) VALUES (?,?,?,?,?,?)")
      .run(String(subject), String(predicate), String(object), importance, source, nowIso());
  }
  function searchFacts(q, limit = 8) {
    const like = `%${String(q || "").slice(0, 60)}%`;
    return db.prepare("SELECT subject,predicate,object FROM facts WHERE subject LIKE ? OR predicate LIKE ? OR object LIKE ? ORDER BY importance DESC, last_used_at DESC LIMIT ?")
      .all(like, like, like, limit);
  }

  // ── Preferences ────────────────────────────────────────────────────────
  function setPreference(category, subject, value, { strength = 1.0, source = "user_stated" } = {}) {
    const existing = db.prepare("SELECT id FROM preferences WHERE category=? AND subject=?").get(category, subject);
    if (existing) db.prepare("UPDATE preferences SET value=?,strength=?,source=?,updated_at=? WHERE id=?").run(value, strength, source, nowIso(), existing.id);
    else db.prepare("INSERT INTO preferences (category,subject,value,strength,source,updated_at) VALUES (?,?,?,?,?,?)").run(category, subject, value, strength, source, nowIso());
  }
  function getPreferences({ category = null, limit = 12 } = {}) {
    return category
      ? db.prepare("SELECT category,subject,value FROM preferences WHERE category=? ORDER BY strength DESC LIMIT ?").all(category, limit)
      : db.prepare("SELECT category,subject,value FROM preferences ORDER BY strength DESC LIMIT ?").all(limit);
  }

  // ── Goals ──────────────────────────────────────────────────────────────
  function addGoal({ title, kind = "goal", priority = 3, target_date = null, description = null }) {
    db.prepare("INSERT INTO goals (title,kind,status,priority,target_date,description,updated_at) VALUES (?,?,'active',?,?,?,?)")
      .run(title, kind, priority, target_date, description, nowIso());
  }
  function activeGoals(limit = 6) { return db.prepare("SELECT title,kind,priority FROM goals WHERE status='active' ORDER BY priority ASC LIMIT ?").all(limit); }

  // ── Location model + resolver ──────────────────────────────────────────
  function homeLocation() { return db.prepare("SELECT * FROM locations WHERE label='home' AND valid_to IS NULL ORDER BY id DESC LIMIT 1").get() || null; }
  function setHome({ place_name, iana_tz, lat = null, lng = null, source = "user_stated" }) {
    db.prepare("UPDATE locations SET valid_to=? WHERE label='home' AND valid_to IS NULL").run(nowIso());
    db.prepare("INSERT INTO locations (label,address,lat,lng,timezone,is_current,source,valid_from,confidence) VALUES ('home',?,?,?,?,0,?,?,1.0)")
      .run(place_name, lat, lng, iana_tz, source, nowIso());
  }
  function noteMention({ place_name, iana_tz = null, lat = null, lng = null }) {
    db.prepare("INSERT INTO locations (label,address,lat,lng,timezone,is_current,source,valid_from,confidence) VALUES ('mentioned',?,?,?,?,0,'user_stated',?,0.9)")
      .run(place_name, lat, lng, iana_tz, nowIso());
  }
  // Resolution order: explicit session mention → browser tz → home → default.
  function resolveLocation({ sessionMention = null, browserTz = null } = {}) {
    if (sessionMention?.place_name) {
      return { placeName: sessionMention.place_name, ianaTz: sessionMention.iana_tz || browserTz || homeLocation()?.timezone || "America/New_York", lat: sessionMention.lat ?? null, lon: sessionMention.lng ?? null, source: "session" };
    }
    const home = homeLocation();
    if (browserTz && (!home || home.timezone !== browserTz)) {
      return { placeName: home?.address || "(unknown)", ianaTz: browserTz, lat: home?.lat ?? null, lon: home?.lng ?? null, source: "browser" };
    }
    if (home) return { placeName: home.address, ianaTz: home.timezone, lat: home.lat, lon: home.lng, source: "home" };
    return { placeName: "(unknown)", ianaTz: "America/New_York", lat: null, lon: null, source: "default" };
  }

  // ── The always-in-context block ("Model Set Context", authoritative) ───
  function renderProfileBlock({ resolved = null, situational = null } = {}) {
    const id = getIdentity();
    const loc = resolved || resolveLocation();
    const prefs = getPreferences({ limit: 6 });
    const goals = activeGoals(4);
    const lines = [`<user_profile authoritative="true">`];
    lines.push(`You are assisting ${id.preferred_name || owner}${id.legal_name && id.legal_name !== id.preferred_name ? ` (${id.legal_name})` : ""}${id.primary_email ? `, ${id.primary_email}` : ""}.`);
    if (id.bio) lines.push(id.bio);
    lines.push(`Home base: ${homeLocation()?.address || "(unknown)"} (timezone ${loc.ianaTz}). Unless the owner names another place or a live location signal says otherwise, treat the owner as currently at their home base, ${loc.placeName}. Answer "where am I", "what city", and "what time is it" DIRECTLY with ${loc.placeName} / ${loc.ianaTz} — this is known context, so do not demand GPS or IP, and never substitute the city embedded in the timezone id (e.g. never say "New York" for America/New_York).`);
    if (prefs.length) lines.push(`Preferences: ${prefs.map((p) => `${p.subject}=${p.value}`).join("; ")}.`);
    if (goals.length) lines.push(`Active goals/projects: ${goals.map((g) => g.title).join("; ")}.`);
    if (situational) lines.push(`Situational context: ${situational}`);
    lines.push(`These are verified facts about the owner — treat them as ground truth unless the owner corrects them.`);
    lines.push(`</user_profile>`);
    return lines.join("\n");
  }

  function localTime(ianaTz) {
    const tz = ianaTz || resolveLocation().ianaTz;
    return new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  }

  // Cortex v4 · 2.5 — Situational Context object. Always-fresh awareness of the
  // owner's time-of-day, weekday/weekend, and place, so greetings and framing fit
  // the moment. Computed per-call (freshness-stamped by construction).
  function situationalContext() {
    const loc = resolveLocation();
    const tz = loc.ianaTz;
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", hour: "numeric", hour12: false });
    const parts = fmt.formatToParts(now).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const hour = Number(parts.hour ?? 12);
    const weekday = parts.weekday || "";
    const partOfDay = hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 21 ? "evening" : "night";
    const isWeekend = weekday === "Saturday" || weekday === "Sunday";
    return `It is ${partOfDay} on ${weekday} (a ${isWeekend ? "weekend" : "weekday"}) for the owner in ${loc.placeName}. Local time: ${localTime(tz)}. Match greetings and framing to this time of day.`;
  }

  return {
    db,
    getIdentity, updateIdentity, addFact, searchFacts,
    setPreference, getPreferences,
    addGoal, activeGoals,
    homeLocation, setHome, noteMention, resolveLocation,
    renderProfileBlock, localTime, situationalContext,
  };
}

module.exports = { createUserContext };
