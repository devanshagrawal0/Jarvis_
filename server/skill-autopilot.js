const crypto = require("crypto");
const path = require("path");
const Database = require("better-sqlite3");

const AGENT_PROFILES = Object.freeze({
  coordinator: {
    title: "Coordinator Agent",
    purpose: "Break missions into agent work, track blockers, and synthesize verified outcomes.",
    defaultTools: ["jarvis_self_inspect", "artifact_status"],
  },
  browser: {
    title: "Browser Agent",
    purpose: "Operate websites through observe-act-verify browser workflows.",
    defaultTools: ["browser_status", "browser_page_brief", "browser_snapshot", "browser_act", "browser_commit", "browser_verify"],
  },
  kalshi: {
    title: "Kalshi Agent",
    purpose: "Read Kalshi account data, discover markets, explain positions, and attach public context.",
    defaultTools: ["kalshi_portfolio", "kalshi_positions", "kalshi_fills", "kalshi_market_discovery", "web_research_deep"],
  },
  canvas: {
    title: "Canvas Agent",
    purpose: "Inspect courses, assignments, due dates, rubrics, and browser login handoffs.",
    defaultTools: ["canvas_assignments", "canvas_courses", "canvas_browser_assignments", "browser_login_handoff", "browser_page_brief"],
  },
  pc: {
    title: "PC Agent",
    purpose: "Search files, projects, screenshots, downloads, and recent work on the laptop.",
    defaultTools: ["pc_graph_search", "pc_graph_timeline", "pc_graph_explain", "search_files", "browser_file_search"],
  },
  research: {
    title: "Research Agent",
    purpose: "Run source-backed public research and package evidence.",
    defaultTools: ["web_research_deep", "url_read", "compose_artifact"],
  },
  verifier: {
    title: "Verifier Agent",
    purpose: "Check claims against receipts, screenshots, sources, files, and tool outputs.",
    defaultTools: ["artifact_status", "jarvis_self_inspect", "pc_graph_inspect"],
  },
});

function cleanString(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function slug(value) {
  return cleanString(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function detectAgents(text) {
  const lower = String(text || "").toLowerCase();
  const agents = [];
  if (/\b(canvas|assignment|homework|course|rubric|submit)\b/.test(lower)) agents.push("canvas", "pc");
  if (/\b(kalshi|portfolio|bet|position|fills?|market|watchlist|trading)\b/.test(lower)) agents.push("kalshi", "research");
  if (/\b(browser|website|chrome|gmail|instagram|youtube|form|upload|download|click|open .*site)\b/.test(lower)) agents.push("browser");
  if (/\b(file|folder|download|project|screenshot|pdf|docx|last night|yesterday|recent)\b/.test(lower)) agents.push("pc");
  if (/\b(research|news|source|citation|brief|report|compare)\b/.test(lower)) agents.push("research");
  if (!agents.length) agents.push("pc", "research");
  agents.push("verifier");
  return [...new Set(agents)].filter((agent) => AGENT_PROFILES[agent]);
}

function stepsForObjective(objective) {
  const agents = detectAgents(objective);
  const steps = [];
  for (const agent of agents) {
    const profile = AGENT_PROFILES[agent];
    if (agent === "verifier") {
      steps.push({
        id: `verify-${steps.length + 1}`,
        agent,
        title: "Verify outcome",
        objective: `Verify that the skill objective was actually satisfied: ${objective}`,
        tools: profile.defaultTools,
        approvalRequired: false,
        verification: ["Check tool receipts", "Check sources/files/screenshots", "Block unsupported claims"],
      });
    } else {
      steps.push({
        id: `${agent}-${steps.length + 1}`,
        agent,
        title: `${profile.title}: ${cleanString(objective, 80)}`,
        objective: `${profile.purpose} Objective: ${objective}`,
        tools: profile.defaultTools,
        approvalRequired: /\b(submit|send|trade|buy|sell|delete|publish|pay|purchase)\b/i.test(objective),
        verification: ["Record tool outputs", "Return exact evidence paths/sources", "Report blockers instead of guessing"],
      });
    }
  }
  return steps;
}

function createSkillAutopilot({ runtimeDir, missionEngine }) {
  const dbPath = path.join(runtimeDir, "jarvis-skills.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      trigger TEXT NOT NULL,
      objective TEXT NOT NULL,
      version INTEGER NOT NULL,
      steps_json TEXT NOT NULL,
      tests_json TEXT NOT NULL,
      reliability_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_runs (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      status TEXT NOT NULL,
      mission_ids_json TEXT NOT NULL,
      input_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS skills_trigger_idx ON skills(trigger);
  `);

  function rowToSkill(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      trigger: row.trigger,
      objective: row.objective,
      version: row.version,
      steps: JSON.parse(row.steps_json || "[]"),
      tests: JSON.parse(row.tests_json || "[]"),
      reliability: JSON.parse(row.reliability_json || "{}"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function compile(args = {}) {
    const objective = cleanString(args.objective || args.prompt || args.description, 4000);
    if (!objective) throw Object.assign(new Error("Skill objective is required"), { statusCode: 400 });
    const name = slug(args.name || args.trigger || objective);
    const trigger = cleanString(args.trigger || args.name || name, 200);
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT * FROM skills WHERE name = ?").get(name);
    const steps = Array.isArray(args.steps) && args.steps.length ? args.steps : stepsForObjective(objective);
    const tests = [
      { name: "has-steps", assertion: "Skill has at least one executable agent step", expected: steps.length > 0 },
      { name: "has-verifier", assertion: "A verifier step exists", expected: steps.some((step) => step.agent === "verifier") },
      { name: "has-tools", assertion: "Each step declares tools", expected: steps.every((step) => Array.isArray(step.tools) && step.tools.length) },
    ];
    const reliability = {
      score: tests.every((test) => test.expected) ? 0.74 : 0.45,
      runs: 0,
      lastRunAt: null,
      notes: ["Compiled from natural-language objective", "Requires real mission execution to improve score"],
    };
    if (existing) {
      db.prepare(`
        UPDATE skills SET trigger=?, objective=?, version=?, steps_json=?, tests_json=?, reliability_json=?, updated_at=?
        WHERE id=?
      `).run(trigger, objective, existing.version + 1, JSON.stringify(steps), JSON.stringify(tests), JSON.stringify(reliability), now, existing.id);
      return { skill: rowToSkill(db.prepare("SELECT * FROM skills WHERE id=?").get(existing.id)), status: "updated" };
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO skills(id,name,trigger,objective,version,steps_json,tests_json,reliability_json,created_at,updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(id, name, trigger, objective, JSON.stringify(steps), JSON.stringify(tests), JSON.stringify(reliability), now, now);
    return { skill: rowToSkill(db.prepare("SELECT * FROM skills WHERE id=?").get(id)), status: "created" };
  }

  function findSkill(value) {
    const key = cleanString(value, 300);
    if (!key) return null;
    return rowToSkill(db.prepare("SELECT * FROM skills WHERE id=? OR name=? OR trigger=?").get(key, slug(key), key));
  }

  function list(args = {}) {
    const limit = Math.max(1, Math.min(100, Number(args.limit || 30)));
    return { skills: db.prepare("SELECT * FROM skills ORDER BY updated_at DESC LIMIT ?").all(limit).map(rowToSkill) };
  }

  function deployAgent(args = {}) {
    if (!missionEngine) throw Object.assign(new Error("Mission engine is not available"), { statusCode: 412 });
    const agent = cleanString(args.agent || args.role || "coordinator", 50).toLowerCase();
    const profile = AGENT_PROFILES[agent] || AGENT_PROFILES.coordinator;
    const objective = cleanString(args.objective || args.prompt || args.title, 4000);
    if (!objective) throw Object.assign(new Error("Agent objective is required"), { statusCode: 400 });
    const mission = missionEngine.create({
      title: cleanString(args.title || `${profile.title}: ${objective}`, 180),
      objective: `${profile.purpose}\n\nObjective: ${objective}\n\nPreferred tools: ${profile.defaultTools.join(", ")}`,
      role: agent,
      autonomyLevel: cleanString(args.autonomyLevel || "act", 40),
      parentId: args.parentId || null,
    });
    return {
      agent,
      profile,
      mission,
      plainEnglish: `${profile.title} deployed for: ${objective}`,
    };
  }

  function run(args = {}) {
    if (!missionEngine) throw Object.assign(new Error("Mission engine is not available"), { statusCode: 412 });
    const skill = findSkill(args.id || args.name || args.trigger);
    if (!skill) throw Object.assign(new Error("Compiled skill was not found"), { statusCode: 404 });
    const input = cleanString(args.input || args.objective || "", 4000);
    const coordinator = missionEngine.create({
      title: `Skill: ${skill.trigger}`,
      objective: `Coordinate compiled skill "${skill.name}". Base objective: ${skill.objective}. Input: ${input || "none"}`,
      role: "skill",
      autonomyLevel: cleanString(args.autonomyLevel || "act", 40),
    });
    const missions = [];
    for (const step of skill.steps) {
      const profile = AGENT_PROFILES[step.agent] || AGENT_PROFILES.research;
      missions.push(missionEngine.create({
        title: `${skill.trigger} - ${step.title}`,
        objective: [
          step.objective,
          input ? `Runtime input: ${input}` : "",
          `Tools expected: ${(step.tools || profile.defaultTools).join(", ")}`,
          `Verification: ${(step.verification || []).join("; ")}`,
        ].filter(Boolean).join("\n"),
        role: step.agent,
        autonomyLevel: cleanString(args.autonomyLevel || "act", 40),
        parentId: coordinator.id,
      }));
    }
    const runId = crypto.randomUUID();
    db.prepare("INSERT INTO skill_runs(id,skill_id,status,mission_ids_json,input_json,created_at) VALUES (?, ?, 'queued', ?, ?, ?)")
      .run(runId, skill.id, JSON.stringify([coordinator.id, ...missions.map((mission) => mission.id)]), JSON.stringify({ input }), new Date().toISOString());
    return {
      runId,
      skill,
      coordinator,
      missions,
      status: "queued",
      plainEnglish: `Skill "${skill.trigger}" deployed ${missions.length} agent mission(s) plus coordinator.`,
    };
  }

  function inspect() {
    const total = db.prepare("SELECT COUNT(*) AS count FROM skills").get().count;
    const runs = db.prepare("SELECT COUNT(*) AS count FROM skill_runs").get().count;
    return {
      dbPath,
      totalSkills: total,
      totalRuns: runs,
      agentProfiles: AGENT_PROFILES,
      recentSkills: list({ limit: 8 }).skills,
    };
  }

  return { compile, list, run, deployAgent, inspect, profiles: AGENT_PROFILES, close: () => db.close(), dbPath };
}

module.exports = { createSkillAutopilot, AGENT_PROFILES, stepsForObjective };
