// Deployable Agents — subject/task-specialist agents callable from the UI.
// Uses the existing `agents` and `agent_missions` tables in the neural vault SQLite DB.
// Separate from System Workers (the 7 internal routing workers).

const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");

const AGENT_KINDS = new Set([
  "research",     // finds information across multiple APIs/tools on a topic
  "quant",        // statistical analysis, Kalshi market math
  "math",         // symbolic/numerical computation
  "architecture", // system design, code structure review
  "code",         // code generation, debugging, refactoring
  "data",         // data analysis, transforms, visualization
  "writing",      // drafting documents, emails, reports
  "personal",     // scheduling, reminders, prep, personal tasks
]);

const MISSION_STATUSES = new Set(["queued", "running", "paused", "done", "failed", "cancelled"]);

function createDeployableAgents({ runtimeDir }) {
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  const db = new Database(dbPath, { timeout: 5000 });
  db.pragma("journal_mode=WAL");
  db.pragma("foreign_keys=ON");

  // agent_missions may not exist yet — create if needed (agents table already exists)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_missions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      objective TEXT,
      status TEXT DEFAULT 'queued',
      inputs_json TEXT DEFAULT '{}',
      outputs_json TEXT DEFAULT '{}',
      events_json TEXT DEFAULT '[]',
      error TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_missions_agent ON agent_missions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_missions_status ON agent_missions(status);
  `);

  // Seed deployable agents if none with role=deployable exist
  const count = db.prepare("SELECT COUNT(*) as c FROM agents WHERE role LIKE 'deployable:%'").get().c;
  if (count === 0) {
    const now = new Date().toISOString();
    const seeds = [
      { kind: "research",     name: "Research Specialist",    desc: "Deep multi-source research on any topic. Uses web search, document analysis, and synthesis.",             tools: ["web_search", "web_research", "document_read", "summarize"] },
      { kind: "quant",        name: "Quant Specialist",       desc: "Kalshi market analysis, probability math, statistical modeling, and EV calculations.",                   tools: ["kalshi_markets", "calculator", "web_research"] },
      { kind: "math",         name: "Math Specialist",        desc: "Symbolic computation, numerical analysis, proofs, and formula derivation.",                              tools: ["calculator", "wolfram"] },
      { kind: "architecture", name: "Architecture Specialist",desc: "System design, code structure review, API design, scalability analysis.",                                tools: ["code_read", "diagram_gen"] },
      { kind: "code",         name: "Code Specialist",        desc: "Code generation, debugging, refactoring, and test writing across any language.",                         tools: ["code_execute", "code_read", "file_write"] },
      { kind: "data",         name: "Data Analyst",           desc: "Data analysis, transforms, CSV/JSON processing, and visualization.",                                    tools: ["calculator", "file_read", "chart_gen"] },
      { kind: "writing",      name: "Writing Specialist",     desc: "Drafting documents, emails, reports, and creative content with full review passes.",                    tools: ["web_research", "summarize"] },
      { kind: "personal",     name: "Personal Assistant",     desc: "Scheduling, reminders, prep packets, briefings, and personal task management.",                         tools: ["calendar_read", "email_draft", "summarize"] },
    ];
    const insert = db.prepare(`
      INSERT INTO agents(id, name, slug, role, description, instructions, allowed_tools_json, blocked_tools_json,
        permission_scope, memory_scope, model_provider, model_name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', ?, '[]', 'user', 'session', 'gemini', 'gemini-2.0-flash', 'active', ?, ?)
    `);
    const insertAll = db.transaction(() => {
      for (const s of seeds) {
        insert.run(
          crypto.randomUUID(), s.name,
          s.kind + "-specialist",
          "deployable:" + s.kind,
          s.desc,
          JSON.stringify(s.tools),
          now, now,
        );
      }
    });
    insertAll();
  }

  function listAgents({ kind, status = "active" } = {}) {
    let sql = "SELECT * FROM agents WHERE status=? AND role LIKE 'deployable:%'";
    const params = [status];
    if (kind && AGENT_KINDS.has(kind)) { sql += " AND role=?"; params.push("deployable:" + kind); }
    sql += " ORDER BY role ASC";
    return db.prepare(sql).all(...params).map(row2agent);
  }

  function getAgent(id) {
    const row = db.prepare("SELECT * FROM agents WHERE id=?").get(id);
    return row ? row2agent(row) : null;
  }

  function deployMission({ agentId, title, objective, inputs = {} }) {
    const agent = getAgent(agentId);
    if (!agent) throw Object.assign(new Error("Agent not found"), { statusCode: 404 });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO agent_missions(id, agent_id, title, objective, status, inputs_json, outputs_json, events_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, '{}', '[]', ?, ?)")
      .run(id, agentId, String(title || objective || "Mission").slice(0, 200), String(objective || title || ""), JSON.stringify(inputs), now, now);
    return getMission(id);
  }

  function getMission(id) {
    const row = db.prepare("SELECT * FROM agent_missions WHERE id=?").get(id);
    return row ? row2mission(row) : null;
  }

  function listMissions({ agentId, status, limit = 20 } = {}) {
    let sql = "SELECT * FROM agent_missions WHERE 1=1";
    const params = [];
    if (agentId) { sql += " AND agent_id=?"; params.push(agentId); }
    if (status && MISSION_STATUSES.has(status)) { sql += " AND status=?"; params.push(status); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(Math.min(100, Number(limit) || 20));
    return db.prepare(sql).all(...params).map(row2mission);
  }

  function updateMissionStatus(id, status, { outputs, error, events } = {}) {
    if (!MISSION_STATUSES.has(status)) throw Object.assign(new Error("Invalid status"), { statusCode: 400 });
    const now = new Date().toISOString();
    const existing = getMission(id);
    if (!existing) throw Object.assign(new Error("Mission not found"), { statusCode: 404 });
    db.prepare(`UPDATE agent_missions SET status=?, outputs_json=?, error=?, events_json=?,
      started_at=COALESCE(started_at, CASE WHEN ? = 'running' THEN ? ELSE NULL END),
      completed_at=CASE WHEN ? IN ('done','failed','cancelled') THEN ? ELSE completed_at END,
      updated_at=? WHERE id=?`)
      .run(
        status,
        outputs ? JSON.stringify(outputs) : existing.outputs_json || "{}",
        error || null,
        events ? JSON.stringify(events) : existing.events_json || "[]",
        status, now,
        status, now,
        now, id,
      );
    return getMission(id);
  }

  function row2agent(row) {
    const kind = String(row.role || "").replace("deployable:", "") || row.slug || "unknown";
    return {
      id: row.id,
      kind,
      name: row.name,
      description: row.description,
      tools: safeJson(row.allowed_tools_json, []),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function row2mission(row) {
    return {
      id: row.id,
      agentId: row.agent_id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      inputs: safeJson(row.inputs_json, {}),
      outputs: safeJson(row.outputs_json, {}),
      events: safeJson(row.events_json, []),
      error: row.error,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function safeJson(str, fallback) {
    try { return JSON.parse(str || "null") ?? fallback; } catch { return fallback; }
  }

  return { listAgents, getAgent, deployMission, getMission, listMissions, updateMissionStatus };
}

module.exports = { createDeployableAgents, AGENT_KINDS: [...AGENT_KINDS] };
