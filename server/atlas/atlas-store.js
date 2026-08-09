"use strict";

// ATLAS — the operational "reality" store for the owner's DAY: tasks, events, reminders,
// people refs, and notes. This is deliberately SEPARATE from:
//   • Memory vNext / user-context  → long-term facts & who the owner is (the blueprint's #1
//     anti-goal is a second memory authority; we do NOT store durable memories here).
//   • Action Fabric (action-fabric/store.js) → AGENT execution tasks, receipts, automations.
//     Those are machine tasks; ATLAS tasks are the human's to-dos and commitments.
// Every row carries provenance (source) + an IANA timezone so we never guess wall-clock intent.
// Pure data layer: no scheduling, no model calls. Deterministic and unit-testable.

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const nowIso = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const j = (v, fallback = null) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

function createAtlasStore({ runtimeDir, file } = {}) {
  const dir = path.resolve(runtimeDir || path.join(process.cwd(), "runtime"));
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file === ":memory:" ? ":memory:" : path.resolve(file || path.join(dir, "atlas.sqlite")));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS atlas_tasks(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'open',           -- open | done | dropped
      priority INTEGER NOT NULL DEFAULT 1,            -- 0 low .. 3 urgent
      due_at TEXT, tz TEXT NOT NULL DEFAULT 'America/New_York',
      project TEXT,
      parent_id TEXT,
      -- commitment fields: who owes what to whom (so "AJ said he'll send it" is never MY task)
      waiting_on TEXT,                                -- NULL | 'me' | 'them'
      actor TEXT, beneficiary TEXT,
      source_kind TEXT NOT NULL DEFAULT 'owner',      -- owner | chat | email | meeting | system
      source_ref TEXT,                                -- id/url/span the task came from
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_atlas_tasks_status_due ON atlas_tasks(status, due_at);

    CREATE TABLE IF NOT EXISTS atlas_events(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL, end_at TEXT, tz TEXT NOT NULL DEFAULT 'America/New_York',
      location TEXT,
      kind TEXT NOT NULL DEFAULT 'event',             -- event | block | travel | routine | prep
      movable INTEGER NOT NULL DEFAULT 0,             -- 0 = hard/immovable, 1 = movable block
      task_id TEXT,                                   -- if this block is timeboxing a task
      source_kind TEXT NOT NULL DEFAULT 'owner', source_ref TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atlas_events_start ON atlas_events(start_at);

    -- Durable reminders. fired_at is the idempotency guard: a reminder fires exactly once even
    -- across restarts, because firing is a single UPDATE ... WHERE fired_at IS NULL transaction.
    CREATE TABLE IF NOT EXISTS atlas_reminders(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      fire_at TEXT NOT NULL, tz TEXT NOT NULL DEFAULT 'America/New_York',
      task_id TEXT,                                   -- optional link to a task
      recurrence TEXT,                                -- JSON rule (Wave 2 expands this); NULL = one-shot
      source_kind TEXT NOT NULL DEFAULT 'owner', source_ref TEXT,
      fired_at TEXT,                                  -- set once when delivered (the fire-once guard)
      cancelled_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atlas_reminders_due ON atlas_reminders(fired_at, cancelled_at, fire_at);

    CREATE TABLE IF NOT EXISTS atlas_people(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      aliases TEXT,                                   -- JSON array
      emails TEXT,                                    -- JSON array
      notes TEXT,
      birthday TEXT,
      cadence_days INTEGER,                           -- keep-in-touch cadence
      last_contact_at TEXT,
      source_kind TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS atlas_notes(
      id TEXT PRIMARY KEY, body TEXT NOT NULL, tags TEXT, created_at TEXT NOT NULL
    );
  `);

  // ── Tasks ────────────────────────────────────────────────────────────────
  const taskRow = (r) => r && ({
    id: r.id, title: r.title, notes: r.notes, status: r.status, priority: r.priority,
    dueAt: r.due_at, tz: r.tz, project: r.project, parentId: r.parent_id,
    waitingOn: r.waiting_on, actor: r.actor, beneficiary: r.beneficiary,
    source: { kind: r.source_kind, ref: r.source_ref },
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at,
  });
  function createTask(input = {}) {
    const stamp = nowIso();
    const row = {
      id: input.id || uid("task"), title: String(input.title || "").trim() || "Untitled task",
      notes: input.notes || null, status: input.status || "open",
      priority: Number.isFinite(input.priority) ? Math.max(0, Math.min(3, input.priority)) : 1,
      due_at: input.dueAt || null, tz: input.tz || "America/New_York", project: input.project || null,
      parent_id: input.parentId || null, waiting_on: input.waitingOn || null,
      actor: input.actor || null, beneficiary: input.beneficiary || null,
      source_kind: input.source?.kind || "owner", source_ref: input.source?.ref || null,
      created_at: stamp, updated_at: stamp,
    };
    db.prepare(`INSERT INTO atlas_tasks(id,title,notes,status,priority,due_at,tz,project,parent_id,waiting_on,actor,beneficiary,source_kind,source_ref,created_at,updated_at)
      VALUES(@id,@title,@notes,@status,@priority,@due_at,@tz,@project,@parent_id,@waiting_on,@actor,@beneficiary,@source_kind,@source_ref,@created_at,@updated_at)`).run(row);
    return getTask(row.id);
  }
  function getTask(id) { return taskRow(db.prepare("SELECT * FROM atlas_tasks WHERE id=?").get(id)); }
  function updateTask(id, patch = {}) {
    const cur = getTask(id);
    if (!cur) throw new Error("Task not found");
    const done = patch.status === "done" && cur.status !== "done";
    const next = { ...cur, ...patch };
    db.prepare(`UPDATE atlas_tasks SET title=?,notes=?,status=?,priority=?,due_at=?,tz=?,project=?,parent_id=?,waiting_on=?,actor=?,beneficiary=?,updated_at=?,completed_at=? WHERE id=?`)
      .run(next.title, next.notes ?? null, next.status, next.priority, next.dueAt ?? null, next.tz, next.project ?? null,
           next.parentId ?? null, next.waitingOn ?? null, next.actor ?? null, next.beneficiary ?? null, nowIso(),
           done ? nowIso() : cur.completedAt || null, id);
    return getTask(id);
  }
  function listTasks({ status = "open", limit = 200 } = {}) {
    const rows = status === "all"
      ? db.prepare("SELECT * FROM atlas_tasks ORDER BY (due_at IS NULL), due_at, priority DESC, created_at DESC LIMIT ?").all(limit)
      : db.prepare("SELECT * FROM atlas_tasks WHERE status=? ORDER BY (due_at IS NULL), due_at, priority DESC, created_at DESC LIMIT ?").all(status, limit);
    return rows.map(taskRow);
  }
  // The two ledgers that make it an assistant, not a list: what I owe vs what others owe me.
  function waitingOnMe(limit = 100) { return db.prepare("SELECT * FROM atlas_tasks WHERE status='open' AND (waiting_on='me' OR waiting_on IS NULL) ORDER BY (due_at IS NULL), due_at LIMIT ?").all(limit).map(taskRow); }
  function waitingOnThem(limit = 100) { return db.prepare("SELECT * FROM atlas_tasks WHERE status='open' AND waiting_on='them' ORDER BY (due_at IS NULL), due_at LIMIT ?").all(limit).map(taskRow); }

  // ── Events ───────────────────────────────────────────────────────────────
  const eventRow = (r) => r && ({ id: r.id, title: r.title, startAt: r.start_at, endAt: r.end_at, tz: r.tz, location: r.location, kind: r.kind, movable: !!r.movable, taskId: r.task_id, source: { kind: r.source_kind, ref: r.source_ref }, createdAt: r.created_at, updatedAt: r.updated_at });
  function createEvent(input = {}) {
    const stamp = nowIso();
    const row = { id: input.id || uid("evt"), title: String(input.title || "Untitled").trim(), start_at: input.startAt, end_at: input.endAt || null, tz: input.tz || "America/New_York", location: input.location || null, kind: input.kind || "event", movable: input.movable ? 1 : 0, task_id: input.taskId || null, source_kind: input.source?.kind || "owner", source_ref: input.source?.ref || null, created_at: stamp, updated_at: stamp };
    db.prepare(`INSERT INTO atlas_events(id,title,start_at,end_at,tz,location,kind,movable,task_id,source_kind,source_ref,created_at,updated_at)
      VALUES(@id,@title,@start_at,@end_at,@tz,@location,@kind,@movable,@task_id,@source_kind,@source_ref,@created_at,@updated_at)`).run(row);
    return eventRow(db.prepare("SELECT * FROM atlas_events WHERE id=?").get(row.id));
  }
  function eventsBetween(startIso, endIso) {
    return db.prepare("SELECT * FROM atlas_events WHERE start_at < ? AND (end_at IS NULL OR end_at > ?) OR (start_at >= ? AND start_at <= ?) ORDER BY start_at")
      .all(endIso, startIso, startIso, endIso).map(eventRow);
  }
  function deleteEvent(id) { return db.prepare("DELETE FROM atlas_events WHERE id=?").run(id).changes > 0; }
  function updateEvent(id, patch = {}) {
    const cur = eventRow(db.prepare("SELECT * FROM atlas_events WHERE id=?").get(id));
    if (!cur) throw new Error("Event not found");
    const next = { ...cur, ...patch };
    db.prepare("UPDATE atlas_events SET title=?,start_at=?,end_at=?,tz=?,location=?,kind=?,movable=?,updated_at=? WHERE id=?")
      .run(String(next.title || cur.title).trim(), next.startAt, next.endAt ?? null, next.tz, next.location ?? null, next.kind, next.movable ? 1 : 0, nowIso(), id);
    return eventRow(db.prepare("SELECT * FROM atlas_events WHERE id=?").get(id));
  }

  // ── Reminders (durable, fire-exactly-once) ────────────────────────────────
  const remRow = (r) => r && ({ id: r.id, title: r.title, fireAt: r.fire_at, tz: r.tz, taskId: r.task_id, recurrence: j(r.recurrence), source: { kind: r.source_kind, ref: r.source_ref }, firedAt: r.fired_at, cancelledAt: r.cancelled_at, createdAt: r.created_at });
  function createReminder(input = {}) {
    const row = { id: input.id || uid("rem"), title: String(input.title || "Reminder").trim(), fire_at: input.fireAt, tz: input.tz || "America/New_York", task_id: input.taskId || null, recurrence: input.recurrence ? JSON.stringify(input.recurrence) : null, source_kind: input.source?.kind || "owner", source_ref: input.source?.ref || null, created_at: nowIso() };
    if (!row.fire_at) throw new Error("Reminder needs fireAt (ISO)");
    db.prepare(`INSERT INTO atlas_reminders(id,title,fire_at,tz,task_id,recurrence,source_kind,source_ref,created_at)
      VALUES(@id,@title,@fire_at,@tz,@task_id,@recurrence,@source_kind,@source_ref,@created_at)`).run(row);
    return remRow(db.prepare("SELECT * FROM atlas_reminders WHERE id=?").get(row.id));
  }
  function cancelReminder(id) { db.prepare("UPDATE atlas_reminders SET cancelled_at=? WHERE id=? AND fired_at IS NULL AND cancelled_at IS NULL").run(nowIso(), id); return remRow(db.prepare("SELECT * FROM atlas_reminders WHERE id=?").get(id)); }
  function updateReminder(id, patch = {}) {
    const cur = remRow(db.prepare("SELECT * FROM atlas_reminders WHERE id=?").get(id));
    if (!cur) throw new Error("Reminder not found");
    const next = { ...cur, ...patch };
    db.prepare("UPDATE atlas_reminders SET title=?,fire_at=?,tz=? WHERE id=? AND fired_at IS NULL")
      .run(String(next.title || cur.title).trim(), next.fireAt, next.tz, id);
    return remRow(db.prepare("SELECT * FROM atlas_reminders WHERE id=?").get(id));
  }
  function pendingReminders() { return db.prepare("SELECT * FROM atlas_reminders WHERE fired_at IS NULL AND cancelled_at IS NULL ORDER BY fire_at").all().map(remRow); }
  // Atomically claim every reminder due at/before `asOfIso` that hasn't fired. The UPDATE is the
  // idempotency guard: a second scheduler tick (or a post-restart catch-up) can't re-fire a row
  // whose fired_at is already set. Returns the rows this call actually claimed.
  function claimDueReminders(asOfIso = nowIso()) {
    const claim = db.transaction((asOf) => {
      const due = db.prepare("SELECT id FROM atlas_reminders WHERE fired_at IS NULL AND cancelled_at IS NULL AND fire_at <= ?").all(asOf).map((r) => r.id);
      const stamp = nowIso();
      const upd = db.prepare("UPDATE atlas_reminders SET fired_at=? WHERE id=? AND fired_at IS NULL");
      const claimed = [];
      for (const id of due) { if (upd.run(stamp, id).changes === 1) claimed.push(id); }
      return claimed;
    });
    const ids = claim(asOfIso);
    return ids.map((id) => remRow(db.prepare("SELECT * FROM atlas_reminders WHERE id=?").get(id)));
  }

  // ── People (basic; the People wave deepens this) ──────────────────────────
  const personRow = (r) => r && ({ id: r.id, name: r.name, aliases: j(r.aliases, []), emails: j(r.emails, []), notes: r.notes, birthday: r.birthday, cadenceDays: r.cadence_days, lastContactAt: r.last_contact_at, createdAt: r.created_at, updatedAt: r.updated_at });
  function upsertPerson(input = {}) {
    const stamp = nowIso();
    const row = { id: input.id || uid("person"), name: String(input.name || "").trim(), aliases: JSON.stringify(input.aliases || []), emails: JSON.stringify(input.emails || []), notes: input.notes || null, birthday: input.birthday || null, cadence_days: input.cadenceDays || null, last_contact_at: input.lastContactAt || null, source_kind: input.source?.kind || "owner", created_at: stamp, updated_at: stamp };
    db.prepare(`INSERT INTO atlas_people(id,name,aliases,emails,notes,birthday,cadence_days,last_contact_at,source_kind,created_at,updated_at)
      VALUES(@id,@name,@aliases,@emails,@notes,@birthday,@cadence_days,@last_contact_at,@source_kind,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,emails=excluded.emails,notes=excluded.notes,birthday=excluded.birthday,cadence_days=excluded.cadence_days,last_contact_at=excluded.last_contact_at,updated_at=excluded.updated_at`).run(row);
    return personRow(db.prepare("SELECT * FROM atlas_people WHERE id=?").get(row.id));
  }
  function listPeople(limit = 200) { return db.prepare("SELECT * FROM atlas_people ORDER BY name LIMIT ?").all(limit).map(personRow); }

  // ── Notes (basic) ─────────────────────────────────────────────────────────
  function addNote(body, tags = []) { const row = { id: uid("note"), body: String(body || "").trim(), tags: JSON.stringify(tags), created_at: nowIso() }; db.prepare("INSERT INTO atlas_notes(id,body,tags,created_at) VALUES(@id,@body,@tags,@created_at)").run(row); return { id: row.id, body: row.body, tags, createdAt: row.created_at }; }
  function listNotes(limit = 100) { return db.prepare("SELECT * FROM atlas_notes ORDER BY created_at DESC LIMIT ?").all(limit).map((r) => ({ id: r.id, body: r.body, tags: j(r.tags, []), createdAt: r.created_at })); }

  return {
    db,
    createTask, getTask, updateTask, listTasks, waitingOnMe, waitingOnThem,
    createEvent, eventsBetween, deleteEvent, updateEvent,
    createReminder, cancelReminder, updateReminder, pendingReminders, claimDueReminders,
    upsertPerson, listPeople,
    addNote, listNotes,
    close: () => db.close(),
  };
}

module.exports = { createAtlasStore };
