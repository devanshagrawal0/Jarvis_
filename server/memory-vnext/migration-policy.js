"use strict";

const crypto = require("node:crypto");
const { canonical } = require("./import-adapters");

const LEGACY_MEMORY = new Set(["memories", "ms_memories"]);
const CONTINUITY = new Set(["working_memory", "ms_working_memory", "conversation_state", "continuity_state", "carryover_summaries", "session_state"]);
const PERSONAL = new Set(["personal_profile_items", "accounts", "contact_methods", "contacts", "core_memory_blocks", "devices", "documents", "facts", "goals", "health_metrics", "health_profile", "identity", "locations", "patterns", "preferences", "routines", "subscriptions", "trips", "vault_refs"]);
const PROCEDURES = new Set(["action_macros", "answer_frames", "browser_workflows", "memory_task_patterns", "procedures", "skills", "task_to_skill_candidates"]);
const ARTIFACTS = new Set(["artifacts", "local_file_registry", "memory_file_index", "memory_objects", "projects", "source_files"]);
const KNOWLEDGE = new Set(["belief_revisions", "capability_memory", "episodes"]);
const AGENT_POINTERS = new Set(["agents", "agent_missions"]);
const HELIX_POINTERS = new Set(["helix_analyses", "helix_artifacts", "helix_citations", "helix_claim_contradictions", "helix_custom_agents", "helix_decisions", "helix_deep_briefs", "helix_evidence", "helix_files", "helix_folders", "helix_inquiries", "helix_living_brief", "helix_manifests", "helix_projects", "helix_segments", "helix_sources", "helix_workflows"]);
const APEX_POINTERS = new Set(["apex_folders", "apex_reports", "apex_strategies", "apex_variables"]);
const ECLIPSE_POINTERS = new Set(["artifact_manifests", "claims", "claim_evidence_edges", "eclipse_personas", "eclipse_semantic_memory", "evidence_objects"]);
const COOP_POINTERS = new Set(["coop_sessions", "coop_tasks", "mesh_devices", "mesh_permission_grants", "mesh_sessions"]);

function exclusionReason(table, store) {
  if (/(?:_fts(?:_|$)|vector|embedding|terms$|entities$|edges$|pc_nodes|pc_index_runs|arbiter_edges)/i.test(table)) return "REBUILDABLE_PROJECTION";
  if (/(?:debug|trace|access_log|activity_events|retrieval_events|tool_results|workflow_node_runs|runs$|events$|receipts$|operations$|commands$|queries$|attempts$|idempotency$|replays$|writes$|checkpoints$)/i.test(table)) return "TELEMETRY_OR_EXECUTION_LOG";
  if (/(?:raw|temp|cache|news|bars|quotes|fills|orders|positions|universe|catalog|signals|predictions|outcomes|calibration)/i.test(table)) return "DOMAIN_RAW_OR_REBUILDABLE";
  if (/(?:api_key|token|secret|permission_rules|capability_leases|integration|control|approval|governance|maintenance)/i.test(table)) return "SECURITY_OR_OPERATIONAL_METADATA";
  if (/(?:old-brain|commands\.db|habits\.db)/i.test(store)) return "LEGACY_ARCHIVE_ONLY";
  return "UNMAPPED_ARCHIVE_ONLY";
}

function classifyInventoryTable({ store, table } = {}) {
  const source = String(store || "").replaceAll("\\", "/").toLocaleLowerCase(); const name = String(table || "");
  if (source.endsWith("runtime/jarvis-memory.sqlite")) return LEGACY_MEMORY.has(name) || name === "working_memory" ? { action: "import", family: name === "working_memory" ? "continuity" : "memory" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/memory/jarvis_memory.sqlite")) return name === "conversation_state" ? { action: "import", family: "continuity" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.includes("neural_vault.sqlite")) {
    if (LEGACY_MEMORY.has(name)) return { action: "import", family: "memory" };
    if (CONTINUITY.has(name)) return { action: "import", family: "continuity" };
    if (PERSONAL.has(name)) return { action: "import", family: "protected_personal" };
    if (PROCEDURES.has(name)) return { action: "import", family: "procedure" };
    if (ARTIFACTS.has(name)) return { action: "import", family: "artifact_pointer" };
    if (KNOWLEDGE.has(name)) return { action: "import", family: "knowledge" };
    if (AGENT_POINTERS.has(name) || COOP_POINTERS.has(name)) return { action: "import", family: "domain_pointer" };
    return { action: "exclude", reason: exclusionReason(name, source) };
  }
  if (source.endsWith("runtime/user-context.sqlite")) return PERSONAL.has(name) ? { action: "import", family: "protected_personal" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/jarvis-missions.sqlite")) return { action: "exclude", reason: "TELEMETRY_OR_EXECUTION_LOG" };
  if (source.endsWith("runtime/jarvis-skills.sqlite")) return name === "skills" ? { action: "import", family: "procedure" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/helix.sqlite")) return HELIX_POINTERS.has(name) ? { action: "import", family: "helix_pointer" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/apex.sqlite")) return APEX_POINTERS.has(name) ? { action: "import", family: "apex_pointer" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/eclipse.sqlite")) return ECLIPSE_POINTERS.has(name) ? { action: "import", family: "eclipse_pointer" } : { action: "exclude", reason: exclusionReason(name, source) };
  if (source.endsWith("runtime/coop_symbiote/coop.db")) return name === "coop_sessions" ? { action: "import", family: "coop_pointer" } : { action: "exclude", reason: exclusionReason(name, source) };
  return { action: "exclude", reason: exclusionReason(name, source) };
}

function buildMigrationPolicy(inventory = {}) {
  const sources = [];
  for (const store of (inventory.stores || []).filter((item) => item.status === "snapshotted_verified")) {
    for (const table of store.tables || []) {
      const policy = classifyInventoryTable({ store: store.relativePath, table: table.name });
      sources.push({ sourceKey: store.relativePath, sourceKind: "sqlite", snapshotPath: store.snapshotFile, snapshotSha256: store.snapshotSha256, table: table.name, columns: (table.columns || []).map((column) => column.name), expectedRows: Number(table.rowCount || 0), action: policy.action, family: policy.family || null, exclusionReason: policy.reason || null, policyVersion: "candidate-trial-v1" });
    }
  }
  const summary = { stores: new Set(sources.map((source) => source.sourceKey)).size, tables: sources.length, totalRows: sources.reduce((sum, source) => sum + source.expectedRows, 0), importedTables: sources.filter((source) => source.action === "import").length, importedRows: sources.filter((source) => source.action === "import").reduce((sum, source) => sum + source.expectedRows, 0), excludedTables: sources.filter((source) => source.action === "exclude").length, excludedRows: sources.filter((source) => source.action === "exclude").reduce((sum, source) => sum + source.expectedRows, 0) };
  const policyHash = crypto.createHash("sha256").update(JSON.stringify(canonical(sources.map(({ snapshotPath, ...source }) => source)))).digest("hex");
  return { policyVersion: "candidate-trial-v1", policyHash, snapshotRoot: inventory.snapshotRoot, sources, summary };
}

module.exports = { buildMigrationPolicy, classifyInventoryTable };
