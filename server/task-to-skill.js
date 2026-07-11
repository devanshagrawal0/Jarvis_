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

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(value, fallback = "task") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;
}

function shortId() {
  return crypto.randomBytes(4).toString("hex");
}

function createTaskToSkillFactory({ runtimeDir, rootDir, neuralVault } = {}) {
  const root = path.join(runtimeDir, "task_to_skill");
  const dbPath = path.join(runtimeDir, "neural_vault", "db", "neural_vault.sqlite");
  const db = new Database(dbPath);

  const dirs = [
    "candidates/commands", "candidates/skills", "candidates/workflows", "candidates/modules",
    "candidates/agents", "candidates/guardrails", "candidates/tests", "generated/commands",
    "generated/skills", "generated/workflows", "generated/modules", "generated/agents",
    "generated/tests", "evidence/screenshots", "evidence/logs", "evidence/traces",
    "approvals", "rejected", "reports"
  ];

  function ensureStructure() {
    for (const dir of dirs) ensureDir(path.join(root, dir));
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_to_skill_candidates (
        id TEXT PRIMARY KEY,
        candidate_type TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        source_task_id TEXT NOT NULL,
        project_id TEXT,
        domain TEXT,
        parameters_json TEXT,
        triggers_json TEXT,
        files_json TEXT,
        evidence_json TEXT,
        status TEXT DEFAULT 'candidate',
        approval_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata_json TEXT
      );
    `);
  }

  function classifyDomain(task = {}) {
    const text = `${task.title || ""} ${task.originalUserRequest || ""} ${task.normalizedTask || ""}`.toLowerCase();
    const steps = task.steps || [];
    if ((task.filesAccessed || []).length || steps.some((step) => String(step.actionType).includes("file"))) return "file";
    if ((task.websitesUsed || []).length || steps.some((step) => ["open_url", "click", "type", "search"].includes(step.actionType))) return "browser";
    if (text.includes("test") || text.includes("debug") || text.includes("fix") || text.includes("code")) return "coding";
    if (text.includes("research") || text.includes("source") || text.includes("news")) return "research";
    if (text.includes("phone") || text.includes("device") || text.includes("mesh")) return "device_mesh";
    if (text.includes("memory") || text.includes("vault")) return "memory";
    if (text.includes("canvas") || text.includes("assignment") || text.includes("class")) return "school";
    if (text.includes("kalshi") || text.includes("market") || text.includes("portfolio")) return "quant";
    return "system";
  }

  function candidateType(task = {}, classification = "") {
    if (classification.includes("agent")) return "agent";
    if (classification.includes("module")) return "module";
    if (classification.includes("command")) return "command";
    const steps = task.steps || [];
    if (steps.length >= 6) return "workflow";
    if (steps.length >= 2 || (task.filesAccessed || []).length || (task.websitesUsed || []).length) return "skill";
    return "memory_object";
  }

  function extractParameters(task = {}) {
    const params = [];
    const add = (name, value, inferredType, sourceStepIndex = undefined, privacy = "safe") => {
      if (!value) return;
      if (/(api[_-]?key|token|password|secret|AIza|sk-)/i.test(String(value))) {
        params.push({ name, value: "[secret_blocked]", inferredType, sourceStepIndex, generalizable: false, exampleValues: [], privacy: "secret_blocked" });
        return;
      }
      if (!params.some((param) => param.name === name && param.value === value)) {
        params.push({ name, value: String(value), inferredType, sourceStepIndex, generalizable: true, exampleValues: [String(value)], privacy });
      }
    };
    for (const url of task.websitesUsed || []) add("site_url", url, "url");
    for (const file of task.filesAccessed || []) add("file_path", file, "file_path", undefined, "private");
    (task.steps || []).forEach((step, index) => {
      if (step.url) add("url", step.url, "url", index);
      if (step.target) add("target", step.target, "string", index);
      if (step.selector) add("selector", step.selector, "selector", index);
      if (step.text) add(/search|query/i.test(step.actionType || step.description || "") ? "query" : "text", step.text, "query", index);
      if (typeof step.input === "string") add("input", step.input, "string", index);
    });
    const text = `${task.originalUserRequest || ""} ${task.normalizedTask || ""}`;
    for (const match of text.matchAll(/\bhttps?:\/\/[^\s)]+/g)) add("url", match[0], "url");
    for (const match of text.matchAll(/[A-Z]:\\[^\n\r"']+/g)) add("file_path", match[0], "file_path", undefined, "private");
    return params;
  }

  function deriveSlug(domain, type, task) {
    const text = `${task.normalizedTask || task.title || ""}`.toLowerCase();
    let object = "task";
    let action = "run";
    if (domain === "browser") {
      object = "site";
      action = text.includes("search") ? "search" : text.includes("click") ? "navigate" : "operate";
    } else if (domain === "file") {
      object = "file";
      action = text.includes("summar") ? "summarize" : text.includes("find") ? "find" : text.includes("edit") ? "edit" : "inspect";
    } else if (domain === "coding") {
      object = "code";
      action = text.includes("test") ? "test-report" : "repair";
    } else if (domain === "device_mesh") {
      object = "device";
      action = text.includes("file") ? "file-transfer" : "connect";
    } else if (domain === "memory") {
      object = "memory";
      action = text.includes("trace") ? "trace-show" : "organize";
    } else if (domain === "quant") {
      object = "market";
      action = "analyze";
    }
    return slugify(`${domain}-${object}-${action}`);
  }

  function duplicateStatus(slug) {
    const existing = db.prepare("SELECT id,status FROM task_to_skill_candidates WHERE slug=? ORDER BY created_at DESC LIMIT 1").get(slug);
    if (existing) return { status: "duplicate_candidate", duplicateOf: existing.id };
    return { status: "candidate" };
  }

  function candidateMarkdown(candidate) {
    return [
      "---",
      `id: ${candidate.id}`,
      `uri: ${candidate.memoryUri}`,
      `type: ${candidate.candidateType}`,
      `status: ${candidate.status}`,
      `source_task_log: ${candidate.sourceTaskId}`,
      "approval_status: pending",
      "---",
      "",
      `# ${candidate.name}`,
      "",
      "## Purpose",
      candidate.description,
      "",
      "## Parameters",
      "```json",
      JSON.stringify(candidate.parameters, null, 2),
      "```",
      "",
      "## Triggers",
      candidate.triggers.map((trigger) => `- ${trigger}`).join("\n"),
      "",
      "## Evidence",
      `- Source task: ${candidate.sourceTaskId}`,
      `- User request: ${candidate.evidence.originalUserRequest}`,
      `- Steps observed: ${candidate.evidence.steps.length}`,
      "",
      "## Generalized Pattern",
      "```json",
      JSON.stringify(candidate.steps, null, 2),
      "```",
      "",
      "## Verification",
      candidate.verification.successCriteria.map((item) => `- ${item}`).join("\n"),
      "",
      "## Safety",
      `Requires approval: ${candidate.safety.requiresApproval}`,
    ].join("\n");
  }

  function createCandidateFromTask(task = {}, options = {}) {
    ensureStructure();
    const domain = classifyDomain(task);
    const type = candidateType(task, options.classification || "");
    const slug = deriveSlug(domain, type, task);
    const duplicate = duplicateStatus(slug);
    const id = `tts_${type}_${slug}_${shortId()}`;
    const now = isoNow();
    const parameters = extractParameters(task);
    const files = {
      candidate: path.join(root, "candidates", `${type}s`, `${slug}.candidate.md`),
      runtime: runtimeFileFor(type, domain, slug),
      test: path.join(rootDir || process.cwd(), "tests", domain, `${slug}.test.ts`),
    };
    ensureDir(path.dirname(files.candidate));
    const candidate = {
      id,
      candidateType: type,
      slug,
      name: humanize(slug),
      description: `Reusable ${type} candidate mined from task evidence without website-specific overfitting.`,
      sourceTaskId: task.id || "unknown",
      projectId: task.projectId || "jarvis",
      domain,
      parameters,
      triggers: [
        `${humanize(slug)} with {input}`,
        task.originalUserRequest || task.normalizedTask || task.title || slug,
      ],
      steps: generalizeSteps(task.steps || []),
      files,
      evidence: {
        originalUserRequest: task.originalUserRequest || "",
        evidenceSummary: task.evidenceSummary || "",
        filesAccessed: task.filesAccessed || [],
        websitesUsed: task.websitesUsed || [],
        steps: task.steps || [],
      },
      safety: {
        requiresApproval: true,
        blockedIf: ["secret parameter detected", "unsafe file root", "destructive operation without approval"],
        notes: ["Generated from generic task evidence and must be approved before activation."],
      },
      verification: {
        screenshotRequired: domain === "browser" || domain === "device_mesh",
        successCriteria: [
          "candidate has a stable slug",
          "parameters are explicit",
          "source evidence is linked",
          "approval card exists",
          "runtime file plan is registered",
        ],
      },
      status: duplicate.status,
      memoryUri: `memory://projects/${task.projectId || "jarvis"}/${type}s/${slug}`,
      createdAt: now,
      updatedAt: now,
      metadata: { duplicateOf: duplicate.duplicateOf || "", source: options.source || "task_to_skill" },
    };
    fs.writeFileSync(files.candidate, candidateMarkdown(candidate), "utf8");
    const approvalId = `approval_${id}`;
    fs.writeFileSync(path.join(root, "approvals", `${approvalId}.json`), json({
      id: approvalId,
      candidateId: id,
      candidateType: type,
      slug,
      status: "pending",
      riskLevel: candidate.safety.requiresApproval ? "medium" : "low",
      createdAt: now,
    }), "utf8");
    db.prepare(`
      INSERT OR REPLACE INTO task_to_skill_candidates
      (id,candidate_type,slug,name,source_task_id,project_id,domain,parameters_json,triggers_json,files_json,evidence_json,status,approval_id,created_at,updated_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, type, slug, candidate.name, candidate.sourceTaskId, candidate.projectId, domain, json(parameters), json(candidate.triggers), json(files), json(candidate.evidence), candidate.status, approvalId, now, now, json(candidate.metadata));
    if (neuralVault?.createMemoryObject) {
      neuralVault.createMemoryObject({
        type: "task_pattern",
        title: candidate.name,
        summary: candidate.description,
        content: candidateMarkdown(candidate),
        uri: candidate.memoryUri,
        projectIds: [candidate.projectId],
        tags: ["task-to-skill", domain, type, candidate.status],
        sourceRefs: [candidate.sourceTaskId],
      });
    }
    writeReports();
    return candidate;
  }

  function runtimeFileFor(type, domain, slug) {
    const base = rootDir || process.cwd();
    if (type === "command") return path.join(base, "src", "features", "commands", domain, `${slug}.command.ts`);
    if (type === "workflow") return path.join(base, "src", "features", "workflows", domain, `${slug}.workflow.ts`);
    if (type === "module") return path.join(base, "src", "features", domain, slug, "index.ts");
    if (type === "agent") return path.join(base, "src", "features", "agents", "agents", domain, `${slug}.agent.ts`);
    return path.join(base, "src", "features", "skills", "skills", domain, `${slug}.skill.ts`);
  }

  function generalizeSteps(steps) {
    return steps.map((step, index) => ({
      index: step.index ?? index,
      actionType: step.actionType || "other",
      target: step.target ? "{target}" : undefined,
      selector: step.selector ? "{selector}" : undefined,
      text: step.text ? "{text}" : undefined,
      url: step.url ? "{url}" : undefined,
      requiresVerification: step.actionType === "verify" || index === steps.length - 1,
    }));
  }

  function humanize(slug) {
    return slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  function listCandidates(limit = 80) {
    ensureStructure();
    return db.prepare("SELECT * FROM task_to_skill_candidates ORDER BY created_at DESC LIMIT ?").all(Number(limit)).map((row) => ({
      ...row,
      parameters: parseJson(row.parameters_json, []),
      triggers: parseJson(row.triggers_json, []),
      files: parseJson(row.files_json, {}),
      evidence: parseJson(row.evidence_json, {}),
      metadata: parseJson(row.metadata_json, {}),
    }));
  }

  function decideCandidate(id, decision, notes = "") {
    ensureStructure();
    const candidate = db.prepare("SELECT * FROM task_to_skill_candidates WHERE id=?").get(id);
    if (!candidate) throw new Error("Candidate not found.");
    const status = decision === "approve" ? "active" : decision === "test" ? "candidate_tested" : "rejected";
    db.prepare("UPDATE task_to_skill_candidates SET status=?, updated_at=?, metadata_json=? WHERE id=?")
      .run(status, isoNow(), json({ notes }), id);
    return listCandidates(1).find((item) => item.id === id) || db.prepare("SELECT * FROM task_to_skill_candidates WHERE id=?").get(id);
  }

  function status() {
    ensureStructure();
    const counts = {
      candidates: db.prepare("SELECT COUNT(*) count FROM task_to_skill_candidates").get().count,
      active: db.prepare("SELECT COUNT(*) count FROM task_to_skill_candidates WHERE status='active'").get().count,
      needsReview: db.prepare("SELECT COUNT(*) count FROM task_to_skill_candidates WHERE status IN ('candidate','needs_review','duplicate_candidate')").get().count,
    };
    return { ok: true, version: "task-to-skill-generic-v1", root, counts };
  }

  function writeReports() {
    ensureStructure();
    const report = [
      "# Generic Task-to-Skill Factory Report",
      "",
      "The factory classifies generic tasks across browser, file, coding, research, device mesh, memory, school, quant, and system domains.",
      "",
      "## Anti-overfit checks",
      "- No YouTube-only logic.",
      "- Website values are parameters, not hardcoded skill names unless repetition proves it.",
      "- File tasks receive file access metadata and approval requirements.",
      "- Every candidate has evidence, parameters, files, approval, status, and MemoryOS URI.",
    ].join("\n");
    fs.writeFileSync(path.join(root, "reports", "TASK_TO_SKILL_FACTORY_BUILD_REPORT.md"), report, "utf8");
    return path.join(root, "reports", "TASK_TO_SKILL_FACTORY_BUILD_REPORT.md");
  }

  ensureStructure();
  writeReports();

  return {
    status,
    createCandidateFromTask,
    listCandidates,
    decideCandidate,
    classifyDomain,
    extractParameters,
    close: () => db.close(),
  };
}

module.exports = { createTaskToSkillFactory };
