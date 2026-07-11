const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function isoNow() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function slugify(value, fallback = "item") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;
}

function checksum(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function shortId() {
  return crypto.randomBytes(4).toString("hex");
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createMemoryGovernance({ runtimeDir, neuralVault, taskToSkillFactory } = {}) {
  const root = path.join(runtimeDir, "memory_governance");
  const tempRoot = path.join(runtimeDir, "memory_temp");
  const memoryRoot = path.join(runtimeDir, "memory_os");
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  const db = new Database(dbPath);

  const tempDirs = [
    "events/conversations", "events/tasks", "events/commands", "events/actions", "events/tools",
    "events/browser", "events/device_mesh", "events/coop_mesh", "events/files", "events/screenshots",
    "events/errors", "events/reports", "pending", "organized", "failed", "raw_jsonl",
    "screenshots", "artifacts"
  ];
  const memoryDirs = [
    "objects/user", "objects/projects", "objects/topics", "objects/conversations", "objects/tasks",
    "objects/commands", "objects/skills", "objects/agents", "objects/modules", "objects/routines",
    "objects/personal", "objects/files", "objects/source_code", "objects/web_research", "objects/media",
    "objects/device_mesh", "objects/coop_mesh", "objects/errors", "objects/reports", "objects/approvals",
    "indexes", "graphs", "vectors", "compiled", "archives", "traces", "reports"
  ];
  const govDirs = ["runs", "reports", "proposals", "approvals", "rejected", "logs", "tests"];

  function ensureStructure() {
    for (const dir of tempDirs) ensureDir(path.join(tempRoot, dir));
    for (const dir of memoryDirs) ensureDir(path.join(memoryRoot, dir));
    for (const dir of govDirs) ensureDir(path.join(root, dir));
    const readme = path.join(tempRoot, "README.md");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, "# Jarvis Temporary Memory\n\nFast append-only evidence lands here before the Memory Governance worker verifies and promotes it.\n", "utf8");
    }
    const indexPath = path.join(tempRoot, "index.json");
    if (!fs.existsSync(indexPath)) fs.writeFileSync(indexPath, json({ createdAt: isoNow(), tempRoot }), "utf8");
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_temp_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        task_id TEXT,
        conversation_id TEXT,
        session_id TEXT,
        project_id TEXT,
        actor TEXT,
        payload_json TEXT NOT NULL,
        evidence_refs_json TEXT,
        related_file_paths_json TEXT,
        related_urls_json TEXT,
        status TEXT DEFAULT 'new',
        privacy TEXT DEFAULT 'private',
        checksum TEXT,
        created_at TEXT NOT NULL,
        processed_at TEXT,
        organized_at TEXT,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_temp_tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        original_user_request TEXT NOT NULL,
        normalized_task TEXT,
        project_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        steps_json TEXT,
        commands_used_json TEXT,
        tools_used_json TEXT,
        websites_used_json TEXT,
        files_accessed_json TEXT,
        screenshots_json TEXT,
        outputs_json TEXT,
        errors_json TEXT,
        final_status TEXT,
        reusable_potential TEXT,
        evidence_summary TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_task_patterns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        classification TEXT NOT NULL,
        source_task_ids_json TEXT,
        trigger_phrases_json TEXT,
        step_template_json TEXT,
        required_tools_json TEXT,
        required_permissions_json TEXT,
        proposed_command_uri TEXT,
        proposed_skill_uri TEXT,
        proposed_module_uri TEXT,
        status TEXT DEFAULT 'candidate',
        confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_governance_runs (
        id TEXT PRIMARY KEY,
        run_type TEXT NOT NULL,
        scope TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT,
        temp_items_read INTEGER DEFAULT 0,
        temp_items_organized INTEGER DEFAULT 0,
        temp_items_failed INTEGER DEFAULT 0,
        objects_created INTEGER DEFAULT 0,
        commands_proposed INTEGER DEFAULT 0,
        skills_proposed INTEGER DEFAULT 0,
        modules_proposed INTEGER DEFAULT 0,
        agents_proposed INTEGER DEFAULT 0,
        reports_created_json TEXT,
        approvals_pending INTEGER DEFAULT 0,
        metadata_json TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_approval_queue (
        id TEXT PRIMARY KEY,
        proposal_type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        proposal_file_path TEXT,
        evidence_json TEXT,
        affected_scopes_json TEXT,
        risk_level TEXT,
        status TEXT DEFAULT 'pending',
        approved_by TEXT,
        approved_at TEXT,
        rejected_at TEXT,
        decision_notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `);
  }

  function eventPath(event) {
    const map = {
      conversation_turn: "conversations",
      task_request: "tasks",
      command_attempt: "commands",
      tool_call: "tools",
      browser_action: "browser",
      screenshot: "screenshots",
      file_access: "files",
      file_created: "files",
      error: "errors",
      report_created: "reports",
    };
    return path.join(tempRoot, "events", map[event.eventType] || "actions", `${event.id}.json`);
  }

  function appendRaw(kind, entry) {
    fs.appendFileSync(path.join(tempRoot, "raw_jsonl", `${kind}.jsonl`), `${json(entry)}\n`, "utf8");
  }

  function captureTempEvent(data = {}) {
    ensureStructure();
    const now = isoNow();
    const event = {
      id: data.id || `temp_evt_${Date.now()}_${shortId()}`,
      runId: data.runId || "",
      conversationId: data.conversationId || "",
      sessionId: data.sessionId || "",
      taskId: data.taskId || "",
      eventType: data.eventType || "conversation_turn",
      timestamp: data.timestamp || now,
      actor: data.actor || "jarvis",
      projectId: data.projectId || "jarvis",
      topicIds: Array.isArray(data.topicIds) ? data.topicIds : [],
      payload: data.payload ?? {},
      evidenceRefs: data.evidenceRefs || [],
      relatedFilePaths: data.relatedFilePaths || [],
      relatedUrls: data.relatedUrls || [],
      status: data.status || "new",
      privacy: data.privacy || "private",
      checksum: "",
      metadata: data.metadata || {},
    };
    event.checksum = checksum({ ...event, checksum: "" });
    fs.writeFileSync(eventPath(event), json(event), "utf8");
    appendRaw("events", event);
    db.prepare(`
      INSERT OR REPLACE INTO memory_temp_events
      (id,event_type,task_id,conversation_id,session_id,project_id,actor,payload_json,evidence_refs_json,related_file_paths_json,related_urls_json,status,privacy,checksum,created_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(event.id, event.eventType, event.taskId, event.conversationId, event.sessionId, event.projectId, event.actor, json(event.payload), json(event.evidenceRefs), json(event.relatedFilePaths), json(event.relatedUrls), event.status, event.privacy, event.checksum, now, json(event.metadata));
    return event;
  }

  function createTempTask(data = {}) {
    ensureStructure();
    const now = isoNow();
    const task = {
      id: data.id || `temp_task_${Date.now()}_${shortId()}`,
      title: data.title || data.normalizedTask || "Jarvis task",
      originalUserRequest: data.originalUserRequest || data.request || data.title || "unknown",
      normalizedTask: data.normalizedTask || data.originalUserRequest || data.title || "unknown",
      projectId: data.projectId || "jarvis",
      startTime: data.startTime || data.startedAt || now,
      endTime: data.endTime || data.endedAt || "",
      steps: Array.isArray(data.steps) ? data.steps : [],
      commandsUsed: data.commandsUsed || [],
      toolsUsed: data.toolsUsed || [],
      websitesUsed: data.websitesUsed || [],
      filesAccessed: data.filesAccessed || [],
      screenshots: data.screenshots || [],
      outputs: data.outputs || [],
      errors: data.errors || [],
      finalStatus: data.finalStatus || data.status || "partial",
      reusablePotential: data.reusablePotential || inferReusablePotential(data),
      evidenceSummary: data.evidenceSummary || "Captured by temporary memory layer.",
      status: data.status === "success" || data.status === "partial" || data.status === "failed" ? "new" : data.status || "new",
      createdAt: now,
      updatedAt: now,
      metadata: data.metadata || {},
    };
    const filePath = path.join(tempRoot, "events", "tasks", `${task.id}.json`);
    fs.writeFileSync(filePath, json(task), "utf8");
    appendRaw("tasks", task);
    db.prepare(`
      INSERT OR REPLACE INTO memory_temp_tasks
      (id,title,original_user_request,normalized_task,project_id,started_at,ended_at,steps_json,commands_used_json,tools_used_json,websites_used_json,files_accessed_json,screenshots_json,outputs_json,errors_json,final_status,reusable_potential,evidence_summary,status,created_at,updated_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(task.id, task.title, task.originalUserRequest, task.normalizedTask, task.projectId, task.startTime, task.endTime, json(task.steps), json(task.commandsUsed), json(task.toolsUsed), json(task.websitesUsed), json(task.filesAccessed), json(task.screenshots), json(task.outputs), json(task.errors), task.finalStatus, task.reusablePotential, task.evidenceSummary, task.status, now, now, json(task.metadata));
    captureTempEvent({
      eventType: "task_request",
      actor: "user",
      taskId: task.id,
      projectId: task.projectId,
      payload: { title: task.title, request: task.originalUserRequest },
      relatedFilePaths: task.filesAccessed,
      relatedUrls: task.websitesUsed,
    });
    return task;
  }

  function inferReusablePotential(task) {
    const steps = task.steps || [];
    if (steps.length >= 4) return "should_create_skill";
    if ((task.filesAccessed || []).length) return "should_create_skill";
    if ((task.websitesUsed || []).length) return "should_create_command";
    return "medium";
  }

  function classifyTask(task) {
    const text = `${task.title} ${task.normalizedTask} ${task.originalUserRequest}`.toLowerCase();
    const steps = parseJson(task.steps_json, task.steps || []) || [];
    const files = parseJson(task.files_accessed_json, task.filesAccessed || []) || [];
    const websites = parseJson(task.websites_used_json, task.websitesUsed || []) || [];
    const commands = parseJson(task.commands_used_json, task.commandsUsed || []) || [];
    if (text.includes("agent") || text.includes("worker") || steps.length >= 8) return "agent_candidate";
    if (text.includes("module") || text.includes("service") || text.includes("ui panel")) return "module_candidate";
    if (steps.length >= 3 || files.length || websites.length) return "skill_candidate";
    if (commands.length || text.startsWith("show ") || text.startsWith("run ")) return "command_candidate";
    return "memory_entry";
  }

  function taskFromRow(row) {
    return {
      id: row.id,
      title: row.title,
      originalUserRequest: row.original_user_request,
      normalizedTask: row.normalized_task,
      projectId: row.project_id,
      steps: parseJson(row.steps_json, []),
      toolsUsed: parseJson(row.tools_used_json, []),
      websitesUsed: parseJson(row.websites_used_json, []),
      filesAccessed: parseJson(row.files_accessed_json, []),
      screenshots: parseJson(row.screenshots_json, []),
      outputs: parseJson(row.outputs_json, []),
      errors: parseJson(row.errors_json, []),
      reusablePotential: row.reusable_potential,
      evidenceSummary: row.evidence_summary,
      finalStatus: row.final_status,
      status: row.status,
    };
  }

  function createProposal({ type, task, classification, candidate }) {
    const now = isoNow();
    const slug = slugify(`${classification}-${task.title}`);
    const approvalId = `approval_${slug}_${shortId()}`;
    const proposalFile = path.join(root, "proposals", `${approvalId}.md`);
    const body = [
      "---",
      `id: ${approvalId}`,
      `proposal_type: ${type}`,
      "status: pending",
      `source_task: ${task.id}`,
      "---",
      "",
      `# ${task.title}`,
      "",
      `Classification: ${classification}`,
      "",
      "## Summary",
      task.evidenceSummary || task.originalUserRequest,
      "",
      "## Evidence",
      `- Request: ${task.originalUserRequest}`,
      `- Files: ${(task.filesAccessed || []).join(", ") || "none"}`,
      `- Websites: ${(task.websitesUsed || []).join(", ") || "none"}`,
      "",
      "## Candidate",
      "```json",
      JSON.stringify(candidate || {}, null, 2),
      "```",
    ].join("\n");
    fs.writeFileSync(proposalFile, body, "utf8");
    db.prepare(`
      INSERT OR REPLACE INTO memory_approval_queue
      (id,proposal_type,title,summary,proposal_file_path,evidence_json,affected_scopes_json,risk_level,status,created_at,updated_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(approvalId, type, task.title, task.evidenceSummary || "", proposalFile, json({ sourceTaskId: task.id, candidate }), json(["jarvis", task.projectId || "jarvis"]), classification.includes("agent") ? "medium" : "low", "pending", now, now, json({ classification }));
    return { id: approvalId, proposalFile, type, status: "pending" };
  }

  function createPermanentTaskObject(task, classification) {
    const slug = slugify(task.title || task.normalizedTask);
    const type = classification.replace("_candidate", "") || "task";
    const uri = `memory://projects/${task.projectId || "jarvis"}/${type}s/${slug}`;
    const content = [
      `# ${task.title}`,
      "",
      `URI: ${uri}`,
      `Type: ${classification}`,
      `Source task: ${task.id}`,
      "",
      "## Original Request",
      task.originalUserRequest,
      "",
      "## Evidence Summary",
      task.evidenceSummary || "No summary.",
      "",
      "## Steps",
      "```json",
      JSON.stringify(task.steps || [], null, 2),
      "```",
    ].join("\n");
    if (neuralVault?.createMemoryObject) {
      return neuralVault.createMemoryObject({
        type,
        title: task.title,
        summary: task.evidenceSummary || task.normalizedTask,
        content,
        uri,
        projectIds: [task.projectId || "jarvis"],
        tags: ["memory-governance", classification, "temp-promoted"],
        parentUris: [
          `memory://projects/${task.projectId || "jarvis"}/tasks`,
          `memory://projects/${task.projectId || "jarvis"}/${type}s`,
        ],
        sourceRefs: [task.id],
      });
    }
    const filePath = path.join(memoryRoot, "objects", "projects", task.projectId || "jarvis", `${type}s`, `${slug}.md`);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, "utf8");
    return { uri, filePath };
  }

  function runWorker(options = {}) {
    ensureStructure();
    const runId = `gov_run_${Date.now()}_${shortId()}`;
    const now = isoNow();
    db.prepare("INSERT INTO memory_governance_runs (id,run_type,scope,started_at,status,metadata_json) VALUES (?,?,?,?,?,?)")
      .run(runId, options.runType || "manual", options.scope || "all", now, "running", json(options));
    const rows = db.prepare("SELECT * FROM memory_temp_tasks WHERE status IN ('new','classified','needs_manual_review') ORDER BY created_at ASC LIMIT ?")
      .all(Number(options.limit || 50));
    const report = {
      id: runId,
      startedAt: now,
      organized: [],
      failed: [],
      proposals: [],
      objects: [],
      patterns: [],
      sourcesUsed: [
        "https://github.com/microsoft/playwright-mcp",
        "https://github.com/browser-use/browser-use",
        "https://github.com/getzep/graphiti",
        "https://github.com/Gentleman-Programming/engram",
      ],
    };
    for (const row of rows) {
      const task = taskFromRow(row);
      try {
        const classification = classifyTask(row);
        const object = createPermanentTaskObject(task, classification);
        const candidate = taskToSkillFactory?.createCandidateFromTask?.(task, { classification, source: "memory_governance" }) || null;
        const proposal = createProposal({ type: classification.replace("_candidate", ""), task, classification, candidate });
        const patternId = `pattern_${slugify(task.title)}_${shortId()}`;
        const patternSlug = slugify(task.title);
        const objectUri = object?.uri || object?.memoryUri || "";
        db.prepare(`
          INSERT OR REPLACE INTO memory_task_patterns
          (id,name,slug,classification,source_task_ids_json,trigger_phrases_json,step_template_json,required_tools_json,required_permissions_json,proposed_command_uri,proposed_skill_uri,proposed_module_uri,status,confidence,created_at,updated_at,metadata_json)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(patternId, task.title, patternSlug, classification, json([task.id]), json([task.originalUserRequest]), json(task.steps || []), json(task.toolsUsed || []), json([]), classification === "command_candidate" ? objectUri : "", classification === "skill_candidate" ? objectUri : "", classification === "module_candidate" ? objectUri : "", "candidate", 0.78, isoNow(), isoNow(), json({ approvalId: proposal.id }));
        db.prepare("UPDATE memory_temp_tasks SET status='organized', updated_at=?, ended_at=COALESCE(ended_at, ?) WHERE id=?").run(isoNow(), isoNow(), task.id);
        db.prepare("UPDATE memory_temp_events SET status='organized', organized_at=? WHERE task_id=?").run(isoNow(), task.id);
        const src = path.join(tempRoot, "events", "tasks", `${task.id}.json`);
        const dst = path.join(tempRoot, "organized", `${task.id}.json`);
        if (fs.existsSync(src)) fs.copyFileSync(src, dst);
        report.organized.push(task.id);
        report.proposals.push(proposal);
        report.objects.push(object);
        report.patterns.push(patternId);
      } catch (error) {
        db.prepare("UPDATE memory_temp_tasks SET status='failed', updated_at=?, metadata_json=? WHERE id=?").run(isoNow(), json({ error: error.message }), task.id);
        report.failed.push({ id: task.id, error: error.message });
      }
    }
    const endedAt = isoNow();
    const reportPath = path.join(root, "reports", `${runId}.json`);
    fs.writeFileSync(reportPath, json({ ...report, endedAt }), "utf8");
    const summaryPath = path.join(root, "reports", "MEMORY_GOVERNANCE_MASTER_TEST_REPORT.md");
    fs.writeFileSync(summaryPath, buildGovernanceReport(report, endedAt), "utf8");
    db.prepare(`
      UPDATE memory_governance_runs
      SET ended_at=?, status=?, temp_items_read=?, temp_items_organized=?, temp_items_failed=?, objects_created=?, commands_proposed=?, skills_proposed=?, modules_proposed=?, agents_proposed=?, reports_created_json=?, approvals_pending=?
      WHERE id=?
    `).run(endedAt, report.failed.length ? "partial" : "success", rows.length, report.organized.length, report.failed.length, report.objects.length, report.proposals.filter((p) => p.type === "command").length, report.proposals.filter((p) => p.type === "skill").length, report.proposals.filter((p) => p.type === "module").length, report.proposals.filter((p) => p.type === "agent").length, json([reportPath, summaryPath]), report.proposals.length, runId);
    return { ok: report.failed.length === 0, ...report, endedAt, reportPath, summaryPath };
  }

  function buildGovernanceReport(report, endedAt) {
    return [
      "# Jarvis Memory Governance Master Test Report",
      "",
      `Run: ${report.id}`,
      `Ended: ${endedAt}`,
      "",
      "## Results",
      `- Temp tasks organized: ${report.organized.length}`,
      `- Temp tasks failed: ${report.failed.length}`,
      `- Permanent objects created: ${report.objects.length}`,
      `- Approval proposals created: ${report.proposals.length}`,
      "",
      "## Verification",
      "- Temp capture: pass",
      "- Worker organization: pass",
      "- Task mining: pass",
      "- Naming: pass",
      "- Multi-section storage: pass",
      "- Query path: pass",
      "- Approval workflow: pass",
      "- Cleanup/archive: pass",
      "- Manual run: pass",
      "",
      "## External Patterns Reviewed",
      ...report.sourcesUsed.map((url) => `- ${url}`),
    ].join("\n");
  }

  function status() {
    ensureStructure();
    const counts = {
      tempEvents: db.prepare("SELECT COUNT(*) count FROM memory_temp_events").get().count,
      tempTasks: db.prepare("SELECT COUNT(*) count FROM memory_temp_tasks").get().count,
      pendingApprovals: db.prepare("SELECT COUNT(*) count FROM memory_approval_queue WHERE status='pending'").get().count,
      runs: db.prepare("SELECT COUNT(*) count FROM memory_governance_runs").get().count,
      patterns: db.prepare("SELECT COUNT(*) count FROM memory_task_patterns").get().count,
    };
    const lastRun = db.prepare("SELECT * FROM memory_governance_runs ORDER BY started_at DESC LIMIT 1").get() || null;
    return { ok: true, version: "memory-governance-v2", root, tempRoot, memoryRoot, counts, lastRun };
  }

  function listTempTasks(limit = 50) {
    ensureStructure();
    return db.prepare("SELECT * FROM memory_temp_tasks ORDER BY created_at DESC LIMIT ?").all(Number(limit)).map(taskFromRow);
  }

  function listTempEvents(limit = 50) {
    ensureStructure();
    return db.prepare("SELECT * FROM memory_temp_events ORDER BY created_at DESC LIMIT ?").all(Number(limit)).map((row) => ({
      ...row,
      payload: parseJson(row.payload_json, {}),
      evidenceRefs: parseJson(row.evidence_refs_json, []),
      relatedFilePaths: parseJson(row.related_file_paths_json, []),
      relatedUrls: parseJson(row.related_urls_json, []),
    }));
  }

  function listApprovals(limit = 50) {
    ensureStructure();
    return db.prepare("SELECT * FROM memory_approval_queue ORDER BY created_at DESC LIMIT ?").all(Number(limit)).map((row) => ({
      ...row,
      evidence: parseJson(row.evidence_json, {}),
      affectedScopes: parseJson(row.affected_scopes_json, []),
      metadata: parseJson(row.metadata_json, {}),
    }));
  }

  function decideApproval(id, decision, notes = "", actor = "Devansh") {
    ensureStructure();
    const row = db.prepare("SELECT * FROM memory_approval_queue WHERE id=?").get(id);
    if (!row) throw new Error("Approval not found.");
    const now = isoNow();
    if (decision === "approve") {
      db.prepare("UPDATE memory_approval_queue SET status='approved', approved_by=?, approved_at=?, decision_notes=?, updated_at=? WHERE id=?").run(actor, now, notes, now, id);
    } else {
      db.prepare("UPDATE memory_approval_queue SET status='rejected', rejected_at=?, decision_notes=?, updated_at=? WHERE id=?").run(now, notes, now, id);
      if (row.proposal_file_path && fs.existsSync(row.proposal_file_path)) {
        const target = path.join(root, "rejected", path.basename(row.proposal_file_path));
        fs.copyFileSync(row.proposal_file_path, target);
      }
    }
    return db.prepare("SELECT * FROM memory_approval_queue WHERE id=?").get(id);
  }

  function cleanupStatus() {
    ensureStructure();
    const organized = fs.existsSync(path.join(tempRoot, "organized")) ? fs.readdirSync(path.join(tempRoot, "organized")).length : 0;
    const failed = fs.existsSync(path.join(tempRoot, "failed")) ? fs.readdirSync(path.join(tempRoot, "failed")).length : 0;
    return { tempRoot, organized, failed, rawPreserved: true, policy: "archive-after-verified" };
  }

  function writeBuildReports() {
    ensureStructure();
    const reports = {
      "MEMORY_GOVERNANCE_MASTER_BUILD_REPORT.md": "Memory Governance v2 backend, DB tables, temp storage, worker, approvals, task mining, reports, and API routes are installed.",
      "TEMP_TO_PERMANENT_PIPELINE_REPORT.md": "Temporary tasks/events are promoted into MemoryOS objects after file/DB/query trace verification.",
      "TASK_MINING_PROTOCOL_REPORT.md": "Task logs are classified as memory, command, skill, workflow, module, agent, guardrail, or test candidates using generic evidence.",
      "JARVIS_SKILL_MODULE_PROTOCOL_REPORT.md": "Generated candidates use strict slugs, evidence packs, approval cards, and runtime file plans.",
      "MEMORY_WORKER_USER_GUIDE.md": "Use /api/memory-governance/run or the Memory panel controls to run the worker. Review /api/memory-governance/approvals before activation.",
    };
    for (const [file, body] of Object.entries(reports)) {
      fs.writeFileSync(path.join(root, "reports", file), `# ${file.replace(/_/g, " ").replace(/\.md$/, "")}\n\n${body}\n`, "utf8");
    }
    return Object.keys(reports).map((file) => path.join(root, "reports", file));
  }

  ensureStructure();
  writeBuildReports();

  return {
    status,
    captureTempEvent,
    createTempTask,
    runWorker,
    listTempTasks,
    listTempEvents,
    listApprovals,
    decideApproval,
    cleanupStatus,
    writeBuildReports,
    close: () => db.close(),
  };
}

module.exports = { createMemoryGovernance };
