const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const ROLES = Object.freeze({
  coordinator: "Break the objective into concrete steps, delegate appropriate work, and synthesize verified results.",
  research: "Gather current evidence using read-only tools and clearly distinguish evidence from inference.",
  operator: "Execute bounded local actions only when policy permits and verify postconditions.",
  browser: "Operate browser tasks through observe-act-verify loops, stopping for consequential approvals.",
  kalshi: "Read Kalshi account/market evidence, explain positions plainly, and attach public context without financial advice.",
  canvas: "Inspect Canvas courses, assignments, rubrics, files, and login blockers with exact evidence.",
  pc: "Search and explain local files, projects, screenshots, downloads, and recent work from the PC knowledge graph.",
  skill: "Execute compiled reusable procedures with declared tools, approval gates, and verification criteria.",
  analyst: "Analyze structured data, compare alternatives, and produce calculations with assumptions.",
  verifier: "Check claims, tool evidence, failures, and completion criteria independently.",
});

function taskBlueprint(objective = "") {
  const text = String(objective || "").toLowerCase();
  const browser = /\b(browser|website|web page|chrome|canvas|instagram|gmail|form|upload|download|submit|click|login|log in|portal|url|site)\b/.test(text);
  const account = /\b(kalshi|portfolio|positions?|bets?|fills?|balance|canvas|gmail|email|instagram|account)\b/.test(text);
  const file = /\b(file|pdf|docx|xlsx|download|upload|submit|assignment|folder)\b/.test(text);
  const local = /\b(screen|desktop|window|app|computer|process|camera|microphone|folder)\b/.test(text);
  const pcGraph = /\b(file|folder|download|project|screenshot|pdf|docx|last night|yesterday|recent|what was i working)\b/.test(text);
  const plan = [
    "Clarify objective and identify required tools",
    browser ? "Open or inspect the relevant browser page" : "Gather required local/provider evidence",
    account ? "Verify provider/login state before using account data" : "Check available evidence and constraints",
    file ? "Locate or prepare required files without guessing filenames" : "Execute bounded read or prepare actions",
    "Record tool evidence, blockers, and approval requirements",
    "Summarize outcome in plain language with unresolved next steps",
  ];
  const evidenceRequirements = [
    account ? "Private/account claims require provider or browser tool output" : "",
    browser ? "Website claims require browser_snapshot, browser_page_brief, or screenshot evidence" : "",
    file ? "File claims require browser_file_search, search_files, or upload result evidence" : "",
    local ? "Local computer claims require system/window/browser/camera tool evidence" : "",
  ].filter(Boolean);
  return {
    plan,
    evidenceRequirements,
    suggestedTools: [
      browser ? "browser_status" : "",
      browser ? "browser_login_handoff" : "",
      browser ? "browser_page_brief" : "",
      account && text.includes("kalshi") ? "kalshi_portfolio" : "",
      account && text.includes("canvas") ? "canvas_browser_assignments" : "",
      file ? "browser_file_search" : "",
      pcGraph ? "pc_graph_search" : "",
      pcGraph ? "pc_graph_timeline" : "",
      local ? "system_status" : "",
    ].filter(Boolean),
  };
}

function createMissionEngine(runtimeDir, options = {}) {
  const dbPath = path.join(runtimeDir, "jarvis-missions.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL,
      autonomy_level TEXT NOT NULL,
      current_step INTEGER NOT NULL,
      checkpoint_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      error TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT
      ,parent_id TEXT
    );
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mission_status_idx ON missions(status, updated_at);
    CREATE INDEX IF NOT EXISTS mission_events_idx ON mission_events(mission_id, created_at);
  `);
  const columns = db.prepare("PRAGMA table_info(missions)").all().map((row) => row.name);
  if (!columns.includes("parent_id")) db.exec("ALTER TABLE missions ADD COLUMN parent_id TEXT");

  let executor = options.executor || null;
  let running = false;
  let timer = null;

  function event(missionId, type, message, data = {}) {
    db.prepare("INSERT INTO mission_events(id, mission_id, type, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), missionId, type, String(message).slice(0, 4000), JSON.stringify(data), new Date().toISOString());
  }

  function hydrate(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      objective: row.objective,
      role: row.role,
      roleInstruction: ROLES[row.role] || ROLES.coordinator,
      status: row.status,
      progress: row.progress,
      autonomyLevel: row.autonomy_level,
      currentStep: row.current_step,
      checkpoint: JSON.parse(row.checkpoint_json || "{}"),
      result: JSON.parse(row.result_json || "{}"),
      error: row.error,
      attempts: row.attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      parentId: row.parent_id || null,
      events: db.prepare("SELECT * FROM mission_events WHERE mission_id = ? ORDER BY created_at DESC LIMIT 100")
        .all(row.id).map((item) => ({
          id: item.id,
          type: item.type,
          message: item.message,
          data: JSON.parse(item.data_json || "{}"),
          at: item.created_at,
        })),
    };
  }

  function create(data = {}) {
    const objective = String(data.objective || data.title || "").trim().slice(0, 8000);
    if (!objective) throw Object.assign(new Error("Mission objective is required"), { statusCode: 400 });
    const now = new Date().toISOString();
    const blueprint = taskBlueprint(objective);
    const mission = {
      id: crypto.randomUUID(),
      title: String(data.title || objective).slice(0, 180),
      objective,
      role: Object.hasOwn(ROLES, data.role) ? data.role : "coordinator",
      status: "queued",
      progress: 0,
      autonomyLevel: String(data.autonomyLevel || "act"),
      currentStep: 0,
      checkpoint: {
        phase: "queued",
        plan: blueprint.plan,
        evidenceRequirements: blueprint.evidenceRequirements,
        suggestedTools: blueprint.suggestedTools,
        completedTools: [],
        pendingConfirmations: [],
      },
      result: {},
      error: "",
      attempts: 0,
      parentId: data.parentId ? String(data.parentId) : null,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(`
      INSERT INTO missions (
        id,title,objective,role,status,progress,autonomy_level,current_step,checkpoint_json,
        result_json,error,attempts,created_at,updated_at,started_at,completed_at,cancelled_at,parent_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(
      mission.id, mission.title, mission.objective, mission.role, mission.status, mission.progress,
      mission.autonomyLevel, mission.currentStep, JSON.stringify(mission.checkpoint), JSON.stringify({}),
      "", 0, now, now, mission.parentId,
    );
    event(mission.id, "created", `Mission created for ${mission.role} agent.`, { objective });
    event(mission.id, "planned", "Task OS generated an evidence-first execution plan.", blueprint);
    schedule();
    return get(mission.id);
  }

  function get(id) {
    return hydrate(db.prepare("SELECT * FROM missions WHERE id = ?").get(id));
  }

  function list(limit = 50) {
    return db.prepare("SELECT * FROM missions ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(200, limit))).map(hydrate);
  }

  function updateState(id, patch) {
    const current = get(id);
    if (!current) throw Object.assign(new Error("Mission not found"), { statusCode: 404 });
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    db.prepare(`
      UPDATE missions SET status=?, progress=?, current_step=?, checkpoint_json=?, result_json=?,
        error=?, attempts=?, updated_at=?, started_at=?, completed_at=?, cancelled_at=? WHERE id=?
    `).run(
      next.status, next.progress, next.currentStep, JSON.stringify(next.checkpoint || {}),
      JSON.stringify(next.result || {}), next.error || "", next.attempts, next.updatedAt,
      next.startedAt || null, next.completedAt || null, next.cancelledAt || null, id,
    );
    return get(id);
  }

  function control(id, action) {
    const mission = get(id);
    if (!mission) throw Object.assign(new Error("Mission not found"), { statusCode: 404 });
    const now = new Date().toISOString();
    if (action === "pause" && ["queued", "running", "retrying"].includes(mission.status)) {
      event(id, "paused", "Mission paused by user.");
      return updateState(id, { status: "paused" });
    }
    if (action === "resume" && ["paused", "awaiting-confirmation", "failed"].includes(mission.status)) {
      event(id, "resumed", "Mission resumed from its durable checkpoint.");
      const next = updateState(id, { status: "queued", error: "" });
      schedule();
      return next;
    }
    if (action === "cancel" && !["complete", "cancelled"].includes(mission.status)) {
      event(id, "cancelled", "Mission cancelled by user.");
      return updateState(id, { status: "cancelled", cancelledAt: now });
    }
    throw Object.assign(new Error(`Cannot ${action} a ${mission.status} mission`), { statusCode: 409 });
  }

  async function processOne() {
    if (!executor) return;
    const row = db.prepare("SELECT * FROM missions WHERE status IN ('queued','retrying') ORDER BY created_at LIMIT 1").get();
    if (!row) return;
    let mission = hydrate(row);
    if (mission.role === "coordinator" && !mission.checkpoint.children?.length) {
      const children = [
        create({
          title: `${mission.title} - research`,
          objective: `Research the evidence needed for this objective: ${mission.objective}`,
          role: "research",
          autonomyLevel: mission.autonomyLevel,
          parentId: mission.id,
        }),
        create({
          title: `${mission.title} - analysis`,
          objective: `Analyze approaches, dependencies, and risks for this objective: ${mission.objective}`,
          role: "analyst",
          autonomyLevel: mission.autonomyLevel,
          parentId: mission.id,
        }),
        create({
          title: `${mission.title} - verification`,
          objective: `Define and execute verification criteria for this objective using available read-only evidence: ${mission.objective}`,
          role: "verifier",
          autonomyLevel: mission.autonomyLevel,
          parentId: mission.id,
        }),
      ];
      updateState(mission.id, {
        status: "waiting-children",
        progress: 15,
        checkpoint: { phase: "delegated", children: children.map((child) => child.id), completedTools: [], pendingConfirmations: [] },
      });
      event(mission.id, "delegated", "Coordinator deployed research, analysis, and verification agents.", { children: children.map((child) => child.id) });
      return;
    }
    const now = new Date().toISOString();
    mission = updateState(mission.id, {
      status: "running",
      progress: Math.max(5, mission.progress),
      startedAt: mission.startedAt || now,
      attempts: mission.attempts + 1,
      checkpoint: { ...mission.checkpoint, phase: "executing" },
    });
    event(mission.id, "started", `Attempt ${mission.attempts} started.`, { checkpoint: mission.checkpoint });
    try {
      const result = await executor(mission);
      const fresh = get(mission.id);
      if (fresh.status === "cancelled" || fresh.status === "paused") return;
      if (result.pendingConfirmations?.length) {
        updateState(mission.id, {
          status: "awaiting-confirmation",
          progress: Math.max(60, fresh.progress),
          result,
          checkpoint: { phase: "approval", pendingConfirmations: result.pendingConfirmations, completedTools: result.toolResults || [] },
        });
        event(mission.id, "approval-required", "Mission is waiting for explicit confirmation.", { confirmations: result.pendingConfirmations });
      } else if (result.error) {
        throw new Error(result.error);
      } else {
        updateState(mission.id, {
          status: "complete",
          progress: 100,
          completedAt: new Date().toISOString(),
          result,
          checkpoint: { phase: "complete", completedTools: result.toolResults || [], pendingConfirmations: [] },
        });
        event(mission.id, "completed", "Mission completed with persisted evidence.", { toolCount: result.toolResults?.length || 0 });
      }
    } catch (error) {
      const fresh = get(mission.id);
      if (fresh.status === "cancelled" || fresh.status === "paused") return;
      const retry = fresh.attempts < 3;
      updateState(mission.id, {
        status: retry ? "retrying" : "failed",
        error: error.message,
        progress: Math.max(10, fresh.progress),
        checkpoint: { ...fresh.checkpoint, phase: retry ? "retrying" : "failed", lastError: error.message },
      });
      event(mission.id, retry ? "retrying" : "failed", error.message, { attempt: fresh.attempts });
      if (retry) setTimeout(schedule, Math.min(5000, 500 * (2 ** fresh.attempts)));
    }
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      let iterations = 0;
      while (iterations++ < 200) {
        promoteCoordinators();
        const pending = db.prepare("SELECT COUNT(*) AS count FROM missions WHERE status IN ('queued','retrying')").get().count;
        if (pending === 0) break;
        await processOne();
      }
    } finally {
      running = false;
    }
  }

  function promoteCoordinators() {
    const waiting = db.prepare("SELECT * FROM missions WHERE status='waiting-children'").all().map(hydrate);
    for (const coordinator of waiting) {
      const childIds = coordinator.checkpoint.children || [];
      if (!childIds.length) continue;
      const children = childIds.map(get).filter(Boolean);
      if (children.some((child) => !["complete", "failed", "cancelled"].includes(child.status))) continue;
      const results = children.map((child) => ({
        id: child.id,
        role: child.role,
        status: child.status,
        response: child.result?.response || child.error || "",
        toolResults: child.result?.toolResults || [],
      }));
      updateState(coordinator.id, {
        status: "queued",
        progress: 75,
        checkpoint: {
          ...coordinator.checkpoint,
          phase: "synthesis",
          childResults: results,
        },
      });
      event(coordinator.id, "children-complete", "All delegated agents returned; coordinator queued for synthesis.", { results });
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => drain().catch(() => {}), 10);
  }

  function recover() {
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE missions SET status='queued', updated_at=?, checkpoint_json=json_set(checkpoint_json, '$.phase', 'recovered')
      WHERE status='running'
    `).run(now);
    if (result.changes) {
      for (const row of db.prepare("SELECT id FROM missions WHERE checkpoint_json->>'$.phase'='recovered' AND status='queued' AND updated_at=?").all(now)) {
        event(row.id, "recovered", "Mission recovered after process restart.");
      }
    }
    schedule();
    return { recovered: result.changes };
  }

  return {
    roles: ROLES,
    setExecutor(next) { executor = next; },
    create,
    get,
    list,
    control,
    recover,
    drain,
    promoteCoordinators,
    close() { clearTimeout(timer); db.close(); },
    dbPath,
  };
}

module.exports = { createMissionEngine, MISSION_ROLES: ROLES };
