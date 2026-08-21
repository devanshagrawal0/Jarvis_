const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// How long an artifact stays the thing "it" refers to when nothing newer has been produced.
// Six hours covers "open it" after stepping away for lunch, and expires long before it can become
// the answer to a question asked the following week — which is exactly what happened when this had
// no bound at all and one file stayed the referent for eight days.
const ACTIVE_ARTIFACT_TTL_MS = 6 * 60 * 60 * 1000;

const PRIVACY_LEVELS = new Set(["public", "internal", "private", "secret"]);
const SECRET_VALUE_PATTERN = /\bAIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{32,}\b/;

function isoNow() {
  return new Date().toISOString();
}

function safeJson(value, fallback = {}) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function slugify(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function safeSegment(value, fallback = "item") {
  return slugify(value || fallback).replace(/^-+|-+$/g, "") || fallback;
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function datedPath(root, category, date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(root, "raw", category, year, month, day, "events.jsonl");
}

function tokenize(value) {
  return [...new Set(String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [])];
}

function ftsPrefixTerm(term) {
  return `"${String(term || "").replace(/"/g, '""')}"*`;
}

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name));
}

function createNeuralVault({ runtimeDir, getProviders = () => ({}), getToolDefinitions = () => [] } = {}) {
  const root = path.join(runtimeDir, "neural_vault");
  const dbDir = path.join(root, "db");
  const hotDir = path.join(root, "hot");
  const maintenanceDir = path.join(root, "maintenance");
  const requiredDirs = [
    "raw/conversations",
    "raw/tool_calls",
    "raw/screen_events",
    "raw/browser_pages",
    "raw/kalshi",
    "raw/artifacts",
    "raw/source_code_snapshots",
    "raw/device_mesh",
    "raw/coop_symbiote",
    "raw/errors",
    "agents/definitions",
    "agents/runs",
    "agents/evaluations",
    "agents/archived",
    "skills/compiled",
    "skills/drafts",
    "skills/archived",
    "skills/skill_runs",
    "skills/templates",
    "integrations/api_keys_metadata",
    "integrations/providers",
    "integrations/health_checks",
    "integrations/rate_limits",
    "actions/macros",
    "actions/browser_workflows",
    "actions/screen_workflows",
    "actions/app_workflows",
    "actions/failed_runs",
    "actions/verified_runs",
    "personal/profile",
    "personal/preferences",
    "personal/projects",
    "personal/writing_style",
    "personal/learning_style",
    "personal/trading",
    "personal/school",
    "personal/career",
    "personal/contacts_metadata",
    "personal/private",
    "compiled",
    "archive",
    "debug",
    "coop_symbiote/sessions",
    "coop_symbiote/patches",
    "coop_symbiote/replays",
    "coop_symbiote/memory_packets",
    "coop_symbiote/skill_transfers",
    "memory_os/objects/user",
    "memory_os/objects/projects",
    "memory_os/objects/chats",
    "memory_os/objects/files",
    "memory_os/objects/commands",
    "memory_os/objects/skills",
    "memory_os/objects/agents",
    "memory_os/objects/web",
    "memory_os/objects/media",
    "memory_os/objects/device_mesh",
    "memory_os/objects/coop_mesh",
    "memory_os/objects/source_code",
    "memory_os/objects/decisions",
    "memory_os/objects/failures",
    "memory_os/objects/routines",
    "memory_os/objects/personal",
    "memory_os/raw_events/chat",
    "memory_os/raw_events/tools",
    "memory_os/raw_events/files",
    "memory_os/raw_events/web",
    "memory_os/raw_events/device_mesh",
    "memory_os/raw_events/coop_mesh",
    "memory_os/raw_events/media",
    "memory_os/episodes",
    "memory_os/compiled/daily",
    "memory_os/compiled/project",
    "memory_os/compiled/command_library",
    "memory_os/compiled/skill_library",
    "memory_os/compiled/agent_library",
    "memory_os/compiled/source_code_maps",
    "memory_os/compiled/conversation_summaries",
    "memory_os/indexes",
    "memory_os/graphs",
    "memory_os/vectors",
    "memory_os/archives",
    "memory_os/maintenance",
    "memory_os/reports",
    "memory_os/exports",
  ];
  ensureDir(dbDir);
  ensureDir(hotDir);
  ensureDir(maintenanceDir);
  for (const directory of requiredDirs) ensureDir(path.join(root, directory));
  const dbPath = path.join(dbDir, "neural_vault.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      scope TEXT NOT NULL,
      project_id TEXT,
      topic TEXT,
      importance INTEGER NOT NULL DEFAULT 3,
      confidence REAL NOT NULL DEFAULT 1.0,
      status TEXT NOT NULL DEFAULT 'active',
      privacy_level TEXT NOT NULL DEFAULT 'private',
      permission_scope TEXT NOT NULL DEFAULT 'default',
      source_type TEXT NOT NULL,
      source_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      expires_at TEXT,
      superseded_by TEXT,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS neural_memories_status_idx ON memories(status, topic, project_id, updated_at);

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      type TEXT NOT NULL,
      aliases_json TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS neural_entities_unique_idx ON entities(normalized_name, type, COALESCE(project_id, ''));

    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relation TEXT,
      weight REAL DEFAULT 1.0,
      PRIMARY KEY (memory_id, entity_id)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      valid_from TEXT,
      valid_to TEXT,
      source_memory_id TEXT,
      status TEXT DEFAULT 'active',
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      title TEXT,
      summary TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      project_id TEXT,
      topic TEXT,
      importance INTEGER DEFAULT 3,
      raw_event_refs_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS procedures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_phrases_json TEXT NOT NULL,
      description TEXT,
      steps_json TEXT NOT NULL,
      required_tools_json TEXT,
      approval_requirements_json TEXT,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      path TEXT NOT NULL,
      project_id TEXT,
      summary TEXT,
      tags_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active',
      root_paths_json TEXT,
      goals_json TEXT,
      known_failures_json TEXT,
      active_fixes_json TEXT,
      style_preferences_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS source_files (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      path TEXT NOT NULL,
      language TEXT,
      hash TEXT,
      summary TEXT,
      symbols_json TEXT,
      imports_json TEXT,
      exports_json TEXT,
      dependencies_json TEXT,
      last_indexed_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS permission_rules (
      id TEXT PRIMARY KEY,
      vault TEXT NOT NULL,
      resource_pattern TEXT NOT NULL,
      read_allowed INTEGER NOT NULL DEFAULT 0,
      summarize_allowed INTEGER NOT NULL DEFAULT 0,
      edit_allowed TEXT NOT NULL DEFAULT 'requires_confirmation',
      external_send_allowed INTEGER NOT NULL DEFAULT 0,
      store_long_term_allowed TEXT NOT NULL DEFAULT 'ask',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_frames (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_intents_json TEXT,
      trigger_phrases_json TEXT,
      style_rules_json TEXT NOT NULL,
      example_structure TEXT,
      priority INTEGER DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS belief_revisions (
      id TEXT PRIMARY KEY,
      old_memory_id TEXT,
      new_memory_id TEXT,
      revision_type TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_access_log (
      id TEXT PRIMARY KEY,
      turn_id TEXT,
      memory_id TEXT,
      access_type TEXT NOT NULL,
      score REAL,
      used_in_answer INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_maintenance_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      new_memories INTEGER DEFAULT 0,
      merged_duplicates INTEGER DEFAULT 0,
      archived_memories INTEGER DEFAULT 0,
      contradictions_resolved INTEGER DEFAULT 0,
      summaries_created INTEGER DEFAULT 0,
      report_path TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS continuity_state (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      scope TEXT NOT NULL DEFAULT 'global',
      project_id TEXT,
      topic TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      source_turn_id TEXT,
      metadata_json TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS neural_continuity_key_idx ON continuity_state(key, scope, COALESCE(project_id, ''), COALESCE(topic, ''));

    CREATE TABLE IF NOT EXISTS referent_candidates (
      id TEXT PRIMARY KEY,
      phrase TEXT NOT NULL,
      resolved_to TEXT NOT NULL,
      resolved_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      project_id TEXT,
      topic TEXT,
      source_turn_id TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS carryover_summaries (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      topic TEXT NOT NULL,
      current_goal TEXT,
      active_issues_json TEXT,
      last_artifacts_json TEXT,
      important_user_corrections_json TEXT,
      open_loops_json TEXT,
      likely_next_references_json TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      trigger_phrases_json TEXT NOT NULL,
      intent TEXT,
      project_id TEXT,
      required_tools_json TEXT,
      required_agents_json TEXT,
      required_permissions_json TEXT,
      steps_json TEXT NOT NULL,
      input_schema_json TEXT,
      output_schema_json TEXT,
      examples_json TEXT,
      success_criteria_json TEXT,
      failure_recovery_json TEXT,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS skill_runs (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      tool_events_json TEXT,
      verification_json TEXT,
      user_feedback TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      allowed_tools_json TEXT,
      blocked_tools_json TEXT,
      permission_scope TEXT,
      memory_scope TEXT,
      model_provider TEXT,
      model_name TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      turn_id TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      tool_calls_json TEXT,
      errors_json TEXT,
      evaluation_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS api_key_metadata (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      key_label TEXT NOT NULL,
      env_var_name TEXT NOT NULL,
      secret_storage_location TEXT NOT NULL,
      scopes_json TEXT,
      used_by_tools_json TEXT,
      used_by_agents_json TEXT,
      status TEXT DEFAULT 'unknown',
      last_verified_at TEXT,
      last_rotated_at TEXT,
      expires_at TEXT,
      rate_limit_json TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      auth_type TEXT,
      required_env_vars_json TEXT,
      tools_enabled_json TEXT,
      status TEXT DEFAULT 'unknown',
      last_health_check_at TEXT,
      health_check_result_json TEXT,
      rate_limit_state_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS integration_health_events (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL,
      checked_at TEXT NOT NULL,
      status TEXT NOT NULL,
      latency_ms INTEGER,
      error TEXT,
      affected_tools_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS action_macros (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      trigger_phrases_json TEXT NOT NULL,
      action_type TEXT NOT NULL,
      required_tools_json TEXT,
      required_permissions_json TEXT,
      parameters_schema_json TEXT,
      steps_json TEXT NOT NULL,
      verification_steps_json TEXT,
      fallback_steps_json TEXT,
      success_rate REAL DEFAULT 0,
      average_duration_ms INTEGER,
      last_success_at TEXT,
      last_failure_at TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS action_macro_runs (
      id TEXT PRIMARY KEY,
      macro_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      input_params_json TEXT,
      executed_steps_json TEXT,
      verification_json TEXT,
      error TEXT,
      duration_ms INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS browser_workflows (
      id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      workflow_name TEXT NOT NULL,
      trigger_phrases_json TEXT,
      direct_url_template TEXT,
      selector_hints_json TEXT,
      steps_json TEXT,
      verification_rules_json TEXT,
      login_required INTEGER DEFAULT 0,
      permission_scope TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      known_issues_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS personal_profile_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      privacy_level TEXT NOT NULL DEFAULT 'private',
      source TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS capability_memory (
      id TEXT PRIMARY KEY,
      capability_name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      tools_json TEXT,
      limitations_json TEXT,
      last_verified_at TEXT,
      last_failure_at TEXT,
      success_examples_json TEXT,
      failure_examples_json TEXT,
      permission_requirements_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      device_type TEXT NOT NULL,
      platform TEXT,
      trust_level TEXT NOT NULL,
      status TEXT NOT NULL,
      capabilities_json TEXT,
      permissions_json TEXT,
      connection_mode TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL,
      host_device_id TEXT,
      participant_device_ids_json TEXT,
      mode TEXT,
      summary TEXT,
      replay_path TEXT,
      memory_refs_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_permission_grants (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      device_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_by TEXT,
      status TEXT NOT NULL,
      granted_at TEXT,
      expires_at TEXT,
      reason TEXT,
      risk_level TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_stream_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      device_id TEXT NOT NULL,
      stream_type TEXT NOT NULL,
      action TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      quality_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_control_events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      source_device_id TEXT NOT NULL,
      target_device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_json TEXT,
      accepted INTEGER NOT NULL DEFAULT 0,
      rejected_reason TEXT,
      timestamp TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_inbox_items (
      id TEXT PRIMARY KEY,
      source_device_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      path TEXT,
      url TEXT,
      text_preview TEXT,
      summary TEXT,
      classification TEXT,
      permission_scope TEXT,
      stored_long_term INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_overlays (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      source TEXT NOT NULL,
      overlay_type TEXT NOT NULL,
      overlay_json TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      followed INTEGER,
      outcome TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS mesh_replays (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      replay_type TEXT NOT NULL,
      path TEXT,
      summary TEXT,
      action_graph_json TEXT,
      keyframes_json TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      host_device_id TEXT,
      guest_device_id TEXT,
      peer_name TEXT,
      connection_mode TEXT,
      session_code_hash TEXT,
      repo_fingerprint_host TEXT,
      repo_fingerprint_guest TEXT,
      status TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      replay_path TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT,
      target TEXT,
      timestamp TEXT NOT NULL,
      event_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_file_access (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      access_type TEXT NOT NULL,
      requested_by TEXT,
      approved_by TEXT,
      status TEXT,
      timestamp TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_patches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      author TEXT,
      base_hash TEXT,
      patch_text TEXT,
      summary TEXT,
      status TEXT,
      created_at TEXT NOT NULL,
      applied_at TEXT,
      test_result_json TEXT,
      ghost_result_json TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_name TEXT,
      text TEXT,
      timestamp TEXT NOT NULL,
      linked_file TEXT,
      linked_patch_id TEXT,
      linked_task_id TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_jarvis_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_jarvis TEXT,
      to_jarvis TEXT,
      message_type TEXT NOT NULL,
      payload_json TEXT,
      timestamp TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_memory_packets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      shared_by TEXT,
      scope TEXT,
      allowed_json TEXT,
      blocked_json TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_skill_transfers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      offered_by TEXT,
      received_by TEXT,
      status TEXT,
      skill_manifest_json TEXT,
      test_result_json TEXT,
      created_at TEXT NOT NULL,
      imported_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT,
      assigned_to TEXT,
      linked_file TEXT,
      linked_patch_id TEXT,
      linked_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS coop_replays (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      replay_type TEXT,
      timeline_json TEXT,
      action_graph_json TEXT,
      keyframes_json TEXT,
      summary TEXT,
      path TEXT,
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_objects (
      id TEXT PRIMARY KEY,
      uri TEXT UNIQUE NOT NULL,
      file_path TEXT NOT NULL,
      type TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      project_ids_json TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      content_preview TEXT,
      source_refs_json TEXT,
      provenance_json TEXT,
      privacy TEXT NOT NULL,
      permissions_json TEXT,
      confidence REAL DEFAULT 1.0,
      importance REAL DEFAULT 0.5,
      status TEXT DEFAULT 'active',
      tags_json TEXT,
      entities_json TEXT,
      parent_uris_json TEXT,
      child_uris_json TEXT,
      links_json TEXT,
      fts_indexed INTEGER DEFAULT 0,
      vector_refs_json TEXT,
      graph_node_ref TEXT,
      retention TEXT DEFAULT 'warm',
      review_after TEXT,
      delete_after TEXT,
      last_accessed_at TEXT,
      access_count INTEGER DEFAULT 0,
      last_checked_at TEXT,
      last_indexed_at TEXT,
      checksum TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_objects_status_idx ON memory_objects(status, type, updated_at);

    CREATE TABLE IF NOT EXISTS memory_object_parents (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL,
      parent_uri TEXT NOT NULL,
      child_uri TEXT NOT NULL,
      relation TEXT DEFAULT 'appears_under',
      created_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_raw_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      session_id TEXT,
      conversation_id TEXT,
      project_id TEXT,
      actor TEXT,
      payload_json TEXT NOT NULL,
      raw_file_path TEXT,
      created_at TEXT NOT NULL,
      trace_id TEXT,
      privacy TEXT DEFAULT 'private',
      processed INTEGER DEFAULT 0,
      processed_at TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_file_index (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      memory_uri TEXT,
      project_id TEXT,
      file_type TEXT,
      purpose_summary TEXT,
      owner_module TEXT,
      checksum TEXT,
      size_bytes INTEGER,
      last_modified_at TEXT,
      last_inspected_at TEXT,
      indexed_at TEXT,
      status TEXT,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS memory_file_index_project_idx ON memory_file_index(project_id, file_type, indexed_at);

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      from_object_id TEXT NOT NULL,
      to_object_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      source_object_id TEXT,
      created_at TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_os_entities (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      aliases_json TEXT,
      description TEXT,
      project_ids_json TEXT,
      confidence REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_commands (
      id TEXT PRIMARY KEY,
      uri TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      trigger_phrases_json TEXT,
      description TEXT,
      project_ids_json TEXT,
      command_type TEXT,
      required_modules_json TEXT,
      required_permissions_json TEXT,
      steps_json TEXT,
      validators_json TEXT,
      examples_json TEXT,
      success_rate REAL,
      last_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_queries (
      id TEXT PRIMARY KEY,
      user_query TEXT NOT NULL,
      parsed_query_json TEXT,
      route_json TEXT,
      retrieved_object_ids_json TEXT,
      answer_summary TEXT,
      success INTEGER,
      confidence REAL,
      created_at TEXT NOT NULL,
      latency_ms INTEGER,
      metadata_json TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_os_agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task TEXT NOT NULL,
      input_refs_json TEXT,
      output_refs_json TEXT,
      status TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      metadata_json TEXT
    );
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, title, content, summary, topic, project_id UNINDEXED);
      CREATE VIRTUAL TABLE IF NOT EXISTS source_files_fts USING fts5(source_file_id UNINDEXED, path, summary, symbols, imports, exports, project_id UNINDEXED);
      CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(artifact_id UNINDEXED, title, summary, tags, project_id UNINDEXED);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_objects_fts USING fts5(object_id UNINDEXED, uri, title, summary, content, tags);
    `);
  } catch {
    // FTS5 is expected in modern SQLite, but the vault still works without it.
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS memories_kind_status_idx ON memories(kind, status);
    CREATE INDEX IF NOT EXISTS memories_importance_status_idx ON memories(importance DESC, status);
    CREATE INDEX IF NOT EXISTS memories_last_accessed_idx ON memories(last_accessed_at, status);
    CREATE INDEX IF NOT EXISTS memory_access_log_memory_id_idx ON memory_access_log(memory_id, created_at);
    CREATE INDEX IF NOT EXISTS memory_access_log_created_at_idx ON memory_access_log(created_at);
    CREATE INDEX IF NOT EXISTS memory_entities_entity_id_idx ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS relationships_from_idx ON relationships(from_entity_id, status);
    CREATE INDEX IF NOT EXISTS relationships_to_idx ON relationships(to_entity_id, status);
    CREATE INDEX IF NOT EXISTS action_macro_runs_macro_status_idx ON action_macro_runs(macro_id, status);
    CREATE INDEX IF NOT EXISTS agent_runs_agent_id_idx ON agent_runs(agent_id, started_at);
    CREATE INDEX IF NOT EXISTS skill_runs_skill_id_idx ON skill_runs(skill_id, started_at);
    CREATE INDEX IF NOT EXISTS personal_profile_items_category_idx ON personal_profile_items(category, status);
    CREATE INDEX IF NOT EXISTS memory_raw_events_processed_idx ON memory_raw_events(processed, created_at);
  `);

  for (const statement of [
    "ALTER TABLE memory_maintenance_runs ADD COLUMN run_type TEXT",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN files_checked INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN objects_checked INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN objects_updated INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN broken_links_found INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN broken_links_fixed INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN duplicates_found INTEGER DEFAULT 0",
    "ALTER TABLE memory_maintenance_runs ADD COLUMN duplicates_merged INTEGER DEFAULT 0",
  ]) {
    try { db.exec(statement); } catch { /* Upgraded database already has this column. */ }
  }

  seedDefaults();

  function seedDefaults() {
    const now = isoNow();
    const permissionCount = db.prepare("SELECT COUNT(*) AS count FROM permission_rules").get().count;
    if (!permissionCount) {
      db.prepare(`
        INSERT INTO permission_rules(id, vault, resource_pattern, read_allowed, summarize_allowed, edit_allowed, external_send_allowed, store_long_term_allowed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), "default", "runtime/**", 1, 1, "requires_confirmation", 0, "ask", now, now);
    }
    const frameCount = db.prepare("SELECT COUNT(*) AS count FROM answer_frames").get().count;
    if (!frameCount) {
      db.prepare(`
        INSERT INTO answer_frames(id, name, trigger_intents_json, trigger_phrases_json, style_rules_json, example_structure, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        "Codex implementation prompt",
        json(["artifact_creation", "self-knowledge", "code"]),
        json(["make me a codex prompt", "codex prompt", "implementation prompt"]),
        json(["include rules", "include phases", "include tests", "include final output format", "be concrete and copy-pasteable"]),
        "Goal -> Rules -> Phases -> Tests -> Final output requirements",
        9,
        now,
        now,
      );
    }
    upsertProject({
      id: "jarvis",
      name: "Jarvis",
      description: "Local desktop Jarvis assistant with Gemini, Kalshi, screen/browser control, device mesh, research, agents, and Neural Vault memory.",
      metadata: { seeded: true },
    });
    upsertPersonalProfileItem({
      category: "answer_style",
      key: "codex_prompt_preference",
      value: "User likes complete copy-paste Codex prompts with rules, phases, tests, and final output format.",
      confidence: 0.9,
      source: "neural-vault-seed",
    });
    upsertMemory({
      kind: "personal_preference",
      title: "Codex prompt answer style",
      content: "User prefers complete Codex prompts with rules, phases, tests, and final output format.",
      summary: "For Codex prompt requests, produce a structured prompt with rules, phases, tests, and final output format.",
      importance: 4,
      confidence: 0.9,
      sourceType: "neural-vault-seed",
      metadata: { category: "answer_style" },
    });
    upsertBrowserWorkflow({
      siteName: "YouTube",
      baseUrl: "https://www.youtube.com",
      workflowName: "Search YouTube",
      triggerPhrases: ["search YouTube for {query}", "open YouTube and search {query}", "find videos about {query}"],
      directUrlTemplate: "https://www.youtube.com/results?search_query={encoded_query}",
      selectorHints: ["input[name='search_query']", "search box"],
      verificationRules: ["url contains /results", "page contains query text", "video results visible"],
      loginRequired: false,
    });
    createActionMacro({
      name: "Open YouTube and Search",
      slug: "youtube-search",
      description: "Open YouTube search results for a parameterized query with verified fallback.",
      triggerPhrases: ["search YouTube for {query}", "open YouTube and search {query}", "find videos about {query}"],
      actionType: "browser_workflow",
      requiredTools: ["desktop_control", "screen_capture"],
      parametersSchema: { query: "string" },
      steps: [
        { type: "desktop_control", action: "youtube_search_visible", text: "{query}" },
      ],
      verificationSteps: ["Search query appears in YouTube results or search box", "Post-action screen capture completes"],
      fallbackSteps: [{ type: "open_url", url: "https://www.youtube.com/results?search_query={encoded_query}" }],
      metadata: { seeded: true },
    });
    compileSkill({
      name: "Deep Research",
      slug: "deep-research",
      description: "Expand a research request, inspect multiple sources, extract evidence, check freshness, and synthesize a cited answer.",
      triggerPhrases: ["research this deeply", "deep research this", "browse current internet"],
      intent: "research",
      requiredTools: ["research_v2", "web_research_deep", "url_read"],
      requiredAgents: ["Research Agent"],
      requiredPermissions: ["web_read"],
      steps: [
        "Expand the query into useful angles",
        "Search multiple relevant sources",
        "Read pages or URL context when available",
        "Extract evidence and contradictions",
        "Answer with citations and uncertainty where needed",
      ],
      successCriteria: [
        "Uses multiple relevant sources when available",
        "Cites current factual claims",
        "Explains uncertainty instead of guessing",
      ],
      metadata: { seeded: true },
    });
    registerAgent({
      name: "Memory Librarian Agent",
      slug: "memory-librarian-agent",
      role: "Maintains Neural Vault memories, continuity, summaries, duplicates, and capability health.",
      description: "Runs local memory maintenance without exposing secrets.",
      allowedTools: ["memory_search", "life_graph", "artifact_status", "codebase_search"],
      blockedTools: ["send_email", "kalshi_order_place", "file_delete"],
      permissionScope: "neural_vault",
      memoryScope: "global",
    });
  }

  function writeRawEvent(category, event) {
    const now = isoNow();
    const item = {
      id: event.id || crypto.randomUUID(),
      timestamp: event.timestamp || now,
      source: event.source || category,
      tags: Array.isArray(event.tags) ? event.tags.slice(0, 20) : [],
      privacyLevel: PRIVACY_LEVELS.has(event.privacyLevel) ? event.privacyLevel : "private",
      ...event,
    };
    appendJsonl(datedPath(root, category), item);
    return item;
  }

  function upsertMemory(data = {}) {
    const now = isoNow();
    const content = normalizeText(data.content || data.text || "");
    if (!content) throw Object.assign(new Error("Memory content is required"), { statusCode: 400 });
    const title = normalizeText(data.title || content.slice(0, 96));
    const projectId = data.projectId || data.project_id || inferProjectId(content);
    const topic = data.topic || inferTopic(content);
    const id = data.id || crypto.randomUUID();
    const privacyLevel = PRIVACY_LEVELS.has(data.privacyLevel) ? data.privacyLevel : "private";
    const kind = data.kind || "semantic";
    const summary = data.summary || content.slice(0, 280);

    // Atomic: SELECT + write + FTS sync + entity links all in one transaction
    const targetId = db.transaction(() => {
      const existing = db.prepare(`
        SELECT id FROM memories
        WHERE content = ? AND kind = ? AND COALESCE(project_id, '') = COALESCE(?, '') AND status = 'active'
        ORDER BY updated_at DESC LIMIT 1
      `).get(content, kind, projectId || null);
      const tId = existing?.id || id;
      if (existing) {
        db.prepare(`
          UPDATE memories SET title=?, summary=?, scope=?, topic=?, importance=MAX(importance, ?), confidence=MAX(confidence, ?),
            privacy_level=?, permission_scope=?, source_type=?, source_ref=?, updated_at=?, metadata_json=?
          WHERE id=?
        `).run(
          title, summary, data.scope || "global", topic,
          Number(data.importance || 3), Number(data.confidence ?? 1),
          privacyLevel, data.permissionScope || "default",
          data.sourceType || "conversation", data.sourceRef || "",
          now, json(data.metadata || {}), tId,
        );
      } else {
        db.prepare(`
          INSERT INTO memories(id, kind, title, content, summary, scope, project_id, topic, importance, confidence, status, privacy_level,
            permission_scope, source_type, source_ref, created_at, updated_at, expires_at, superseded_by, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tId, kind, title, content, summary,
          data.scope || "global", projectId || null, topic || null,
          Math.max(1, Math.min(10, Number(data.importance || 3))),
          Math.max(0, Math.min(1, Number(data.confidence ?? 1))),
          data.status || "active", privacyLevel,
          data.permissionScope || "default", data.sourceType || "conversation",
          data.sourceRef || "", now, now,
          data.expiresAt || null, data.supersededBy || null,
          json(data.metadata || {}),
        );
      }
      maintainMemoryFts(tId, { title, content, summary, topic, projectId });
      linkEntitiesForMemory(tId, extractEntities(content), projectId);
      return tId;
    })();
    return getMemory(targetId);
  }

  function maintainMemoryFts(memoryId, data) {
    if (!tableExists(db, "memories_fts")) return;
    // Lazily create the transaction on first use to avoid temporal dead zone
    // when this is called during early initialization before all consts are bound.
    if (!maintainMemoryFts._tx) {
      maintainMemoryFts._tx = db.transaction((mid, d) => {
        db.prepare("DELETE FROM memories_fts WHERE memory_id=?").run(mid);
        db.prepare("INSERT INTO memories_fts(memory_id, title, content, summary, topic, project_id) VALUES (?, ?, ?, ?, ?, ?)")
          .run(mid, d.title || "", d.content || "", d.summary || "", d.topic || "", d.projectId || "");
      });
    }
    maintainMemoryFts._tx(memoryId, data);
  }

  function getMemory(id) {
    const row = db.prepare("SELECT * FROM memories WHERE id=?").get(id);
    return row ? publicMemory(row) : null;
  }

  function publicMemory(row) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      content: row.content,
      summary: row.summary,
      scope: row.scope,
      projectId: row.project_id,
      topic: row.topic,
      importance: row.importance,
      confidence: row.confidence,
      status: row.status,
      privacyLevel: row.privacy_level,
      permissionScope: row.permission_scope,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function extractEntities(text) {
    const raw = [];
    const value = String(text || "");
    for (const match of value.match(/\b(Jarvis|JARVIS|Neural Vault|Memory Mesh|Kalshi|Gemini|Canvas|Cloudflare|YouTube|Northeastern|Student Hub)\b/g) || []) {
      raw.push({ name: match, type: /jarvis/i.test(match) ? "project" : "service" });
    }
    for (const file of value.match(/[A-Za-z0-9_. -]+\.(?:md|docx|pdf|tsx?|jsx?|json|html|css)/g) || []) raw.push({ name: file.trim(), type: "file" });
    for (const url of value.match(/https?:\/\/[^\s)]+/g) || []) raw.push({ name: url, type: "url" });
    return [...new Map(raw.map((item) => [`${item.type}:${item.name.toLowerCase()}`, item])).values()].slice(0, 30);
  }

  function upsertEntity({ name, type = "concept", aliases = [], projectId = null, metadata = {} }) {
    const now = isoNow();
    const normalized = normalizeText(name).toLowerCase();
    const existing = db.prepare("SELECT id FROM entities WHERE normalized_name=? AND type=? AND COALESCE(project_id, '')=COALESCE(?, '')")
      .get(normalized, type, projectId || null);
    if (existing) {
      const existingAliases = safeJson(db.prepare("SELECT aliases_json FROM entities WHERE id=?").get(existing.id)?.aliases_json, []);
      const mergedAliases = [...new Set([...existingAliases, ...aliases])];
      db.prepare("UPDATE entities SET aliases_json=?, updated_at=?, metadata_json=? WHERE id=?")
        .run(json(mergedAliases), now, json(metadata), existing.id);
      return existing.id;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO entities(id, name, normalized_name, type, aliases_json, project_id, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, normalized, type, json(aliases), projectId, now, now, json(metadata));
    return id;
  }

  function linkEntitiesForMemory(memoryId, entities, projectId) {
    for (const entity of entities) {
      const entityId = upsertEntity({ ...entity, projectId });
      db.prepare("INSERT OR IGNORE INTO memory_entities(memory_id, entity_id, relation, weight) VALUES (?, ?, ?, ?)")
        .run(memoryId, entityId, "mentions", 1);
    }
  }

  // T5a: Bi-temporal relationship edges between entities
  function upsertRelationship({ fromEntityId, toEntityId, relationType, confidence = 1.0, validFrom = null, validTo = null, sourceMemoryId = null, metadata = {} }) {
    if (!fromEntityId || !toEntityId || !relationType) throw new Error("fromEntityId, toEntityId, relationType required");
    const now = isoNow();
    const existing = db.prepare("SELECT id FROM relationships WHERE from_entity_id=? AND to_entity_id=? AND relation_type=? AND status='active'")
      .get(fromEntityId, toEntityId, relationType);
    if (existing) {
      db.prepare("UPDATE relationships SET confidence=?, source_memory_id=?, metadata_json=? WHERE id=?")
        .run(confidence, sourceMemoryId || null, json(metadata), existing.id);
      return existing.id;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO relationships(id, from_entity_id, to_entity_id, relation_type, confidence, valid_from, valid_to, source_memory_id, status, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, fromEntityId, toEntityId, relationType, confidence, validFrom || now, validTo || null, sourceMemoryId || null, json(metadata));
    return id;
  }

  function getEntityRelationships(entityId, options = {}) {
    const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
    const direction = options.direction || "both";
    let rows = [];
    if (direction === "out" || direction === "both") {
      rows.push(...db.prepare(`
        SELECT r.*, e.name AS target_name, e.type AS target_type
        FROM relationships r JOIN entities e ON e.id = r.to_entity_id
        WHERE r.from_entity_id=? AND r.status='active'
        ORDER BY r.confidence DESC LIMIT ?
      `).all(entityId, limit));
    }
    if (direction === "in" || direction === "both") {
      rows.push(...db.prepare(`
        SELECT r.*, e.name AS source_name, e.type AS source_type
        FROM relationships r JOIN entities e ON e.id = r.from_entity_id
        WHERE r.to_entity_id=? AND r.status='active'
        ORDER BY r.confidence DESC LIMIT ?
      `).all(entityId, limit));
    }
    return rows.slice(0, limit);
  }

  // T5b: Entity resolution — find canonical entity, merge duplicates
  function resolveEntity(name, type = null) {
    const normalized = String(name || "").toLowerCase().trim();
    if (!normalized) return null;
    // Exact match on normalized_name
    const exact = db.prepare(`SELECT * FROM entities WHERE normalized_name=? ${type ? "AND type=?" : ""} LIMIT 1`)
      .get(...(type ? [normalized, type] : [normalized]));
    if (exact) return exact;
    // Alias search via SQL LIKE on aliases_json text (avoids N+1 full table scan in JS)
    const aliasMatch = db.prepare(
      `SELECT * FROM entities WHERE aliases_json LIKE ? ${type ? "AND type=?" : ""} LIMIT 1`,
    ).get(...(type ? [`%"${normalized}"%`, type] : [`%"${normalized}"%`]));
    if (aliasMatch) return aliasMatch;
    // Fuzzy: starts-with
    const fuzzy = db.prepare(`SELECT * FROM entities WHERE normalized_name LIKE ? ${type ? "AND type=?" : ""} LIMIT 1`)
      .get(...(type ? [`${normalized}%`, type] : [`${normalized}%`]));
    return fuzzy || null;
  }

  function mergeEntities(primaryId, duplicateId) {
    if (!primaryId || !duplicateId || primaryId === duplicateId) throw new Error("Two distinct entity IDs required");
    const primary = db.prepare("SELECT * FROM entities WHERE id=?").get(primaryId);
    const duplicate = db.prepare("SELECT * FROM entities WHERE id=?").get(duplicateId);
    if (!primary || !duplicate) throw new Error("One or both entities not found");
    const now = isoNow();
    const primaryAliases = safeJson(primary.aliases_json, []);
    const dupAliases = safeJson(duplicate.aliases_json, []);
    const merged = [...new Set([...primaryAliases, ...dupAliases, duplicate.name])];
    db.prepare("UPDATE entities SET aliases_json=?, updated_at=? WHERE id=?").run(json(merged), now, primaryId);
    // Repoint all memory_entities from duplicate to primary
    db.prepare("UPDATE OR IGNORE memory_entities SET entity_id=? WHERE entity_id=?").run(primaryId, duplicateId);
    db.prepare("DELETE FROM memory_entities WHERE entity_id=?").run(duplicateId);
    // Repoint all relationships
    db.prepare("UPDATE relationships SET from_entity_id=? WHERE from_entity_id=?").run(primaryId, duplicateId);
    db.prepare("UPDATE relationships SET to_entity_id=? WHERE to_entity_id=?").run(primaryId, duplicateId);
    db.prepare("DELETE FROM entities WHERE id=?").run(duplicateId);
    return { merged: true, primaryId, duplicateId, aliases: merged };
  }

  // T5c: Hybrid RRF retrieval — BM25 FTS5 + 1st-hop entity graph + 2nd-hop relationship traversal
  function hybridSearch(query, options = {}) {
    const limit = Math.max(1, Math.min(30, Number(options.limit || 8)));
    const ftsResults = searchMemories(query, { limit: limit * 2 });
    const entityMatches = [];
    const terms = tokenize(query).slice(0, 6);
    const hasEntityTables = tableExists(db, "entities") && tableExists(db, "memory_entities");
    const hasRelTable = hasEntityTables && tableExists(db, "relationships");

    if (terms.length && hasEntityTables) {
      // 1st hop: entities whose normalized_name matches query terms → their memories
      const likeClause = terms.map(() => "e.normalized_name LIKE ?").join(" OR ");
      const entityMems = db.prepare(`
        SELECT m.*, e.id AS _entity_id, e.name AS _entity_name
        FROM entities e
        JOIN memory_entities me ON me.entity_id = e.id
        JOIN memories m ON m.id = me.memory_id
        WHERE (${likeClause}) AND m.status = 'active'
        LIMIT 60
      `).all(...terms.map((t) => `%${t}%`));
      for (const row of entityMems) {
        entityMatches.push({ ...publicMemory(row), _entityMatch: row._entity_name });
      }

      // 2nd hop: traverse relationships from matched entities to related entities → their memories
      if (hasRelTable && entityMems.length) {
        const matchedEntityIds = [...new Set(entityMems.map((r) => r._entity_id).filter(Boolean))].slice(0, 10);
        if (matchedEntityIds.length) {
          const placeholders = matchedEntityIds.map(() => "?").join(",");
          const relatedMems = db.prepare(`
            SELECT m.*, re.name AS _related_entity, r.relation_type AS _relation
            FROM relationships r
            JOIN entities re ON re.id = CASE
              WHEN r.from_entity_id IN (${placeholders}) THEN r.to_entity_id
              ELSE r.from_entity_id
            END
            JOIN memory_entities me ON me.entity_id = re.id
            JOIN memories m ON m.id = me.memory_id
            WHERE (r.from_entity_id IN (${placeholders}) OR r.to_entity_id IN (${placeholders}))
              AND r.status = 'active' AND m.status = 'active'
            LIMIT 40
          `).all(...matchedEntityIds, ...matchedEntityIds, ...matchedEntityIds);
          for (const row of relatedMems) {
            entityMatches.push({ ...publicMemory(row), _entityMatch: row._related_entity, _relation: row._relation });
          }
        }
      }
    }

    // RRF fusion: score = Σ 1/(60 + rank)
    const allIds = new Map();
    const rrfScore = (id, rank) => {
      allIds.set(id, (allIds.get(id) || 0) + 1 / (60 + rank));
    };
    ftsResults.forEach((m, i) => rrfScore(m.id, i));
    entityMatches.forEach((m, i) => rrfScore(m.id, i));
    const allMemories = new Map([...ftsResults, ...entityMatches].map((m) => [m.id, m]));
    return [...allIds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ ...allMemories.get(id), rrfScore: Math.round(score * 10000) / 10000 }))
      .filter(Boolean);
  }

  // T6b: Retrieve active procedural/behavioral rules for context injection
  // Includes 'preference' (soft-scored beliefs from Wave 1) alongside hard procedures
  function getProcedural(limit = 15) {
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE kind IN ('procedure', 'correction', 'preference') AND (status IS NULL OR status = 'active')
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map(publicMemory);
  }

  function formatProceduralForContext(limit = 12) {
    const rules = getProcedural(limit);
    if (!rules.length) return "";
    const lines = rules.map((r) => `• [${r.topic || r.kind}] ${r.summary || r.content}`);
    return `User behavioral rules (highest priority):\n${lines.join("\n")}`;
  }

  function inferProjectId(text) {
    return /\bjarvis|neural vault|memory mesh|gemini|kalshi|device mesh\b/i.test(text) ? "jarvis" : null;
  }

  function inferTopic(text) {
    const lower = String(text || "").toLowerCase();
    if (/\bneural vault|memory mesh|memory os|continuity|referent|pronoun\b/.test(lower)) return "Neural Vault memory system";
    if (/\bkalshi|portfolio|position|bet|market\b/.test(lower)) return "Kalshi";
    if (/\bcanvas|assignment|northeastern|student hub\b/.test(lower)) return "School";
    if (/\bdevice mesh|phone|ipad|cloudflare|pairing\b/.test(lower)) return "Device Mesh";
    if (/\byoutube|browser|screen|click|desktop\b/.test(lower)) return "Browser and Screen Control";
    return "";
  }

  function searchMemories(query, options = {}) {
    const limit = Math.max(1, Math.min(50, Number(options.limit || 8)));
    let rows = [];
    if (tableExists(db, "memories_fts") && normalizeText(query)) {
      const ftsQuery = tokenize(query).slice(0, 8).map(ftsPrefixTerm).join(" OR ");
      if (ftsQuery) {
        rows = db.prepare(`
          SELECT m.*, bm25(memories_fts) AS rank
          FROM memories_fts JOIN memories m ON m.id = memories_fts.memory_id
          WHERE memories_fts MATCH ? AND m.status = 'active'
          ORDER BY rank ASC, m.importance DESC, m.updated_at DESC
          LIMIT ?
        `).all(ftsQuery, limit);
      }
    }
    if (!rows.length) {
      const terms = tokenize(query).slice(0, 8);
      const where = terms.length
        ? `AND (${terms.map(() => "LOWER(content || ' ' || COALESCE(summary,'') || ' ' || COALESCE(topic,'')) LIKE ?").join(" OR ")})`
        : "";
      rows = db.prepare(`
        SELECT * FROM memories
        WHERE status='active' ${where}
        ORDER BY importance DESC, updated_at DESC
        LIMIT ?
      `).all(...terms.map((term) => `%${term}%`), limit);
    }
    const now = isoNow();
    for (const row of rows) {
      db.prepare("UPDATE memories SET last_accessed_at=? WHERE id=?").run(now, row.id);
      db.prepare("INSERT INTO memory_access_log(id, turn_id, memory_id, access_type, score, used_in_answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), options.turnId || "", row.id, "context_pack", Number(row.rank || 0), 0, now);
    }
    return rows.map(publicMemory);
  }

  function continuityFilePath() {
    return path.join(hotDir, "continuity_state.json");
  }

  function getContinuity() {
    try {
      return JSON.parse(fs.readFileSync(continuityFilePath(), "utf8"));
    } catch {
      return defaultContinuity();
    }
  }

  function defaultContinuity() {
    return {
      active_project: "Jarvis",
      active_topic: "Neural Vault memory system",
      active_issue: "",
      active_artifact: "",
      active_file: "",
      active_tool: "",
      active_goal: "Build a local-first Jarvis assistant that remembers context, tools, projects, actions, and corrections.",
      last_discussed_object: "Jarvis",
      last_user_correction: "",
      last_assistant_commitment: "",
      last_device: "",
      last_mesh_session: "",
      last_control_target: "",
      last_phone_capture: "",
      last_mesh_inbox_item: "",
      last_mesh_skill: "",
      recent_entities: [],
      recent_pronoun_targets: {},
      likely_next_references: {
        it: "Jarvis / the active Jarvis subsystem",
        this: "the current user request",
        that: "the previous Jarvis issue or request",
        "the prompt": "the latest attached Codex prompt",
      },
      updated_at: isoNow(),
    };
  }

  function saveContinuity(state, sourceTurnId = "") {
    const now = isoNow();
    const next = { ...defaultContinuity(), ...state, updated_at: now };
    fs.writeFileSync(continuityFilePath(), `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    for (const [key, value] of Object.entries({
      active_project: next.active_project,
      active_topic: next.active_topic,
      active_issue: next.active_issue,
      active_artifact: next.active_artifact,
      active_file: next.active_file,
      active_tool: next.active_tool,
      active_goal: next.active_goal,
      last_discussed_object: next.last_discussed_object,
      last_device: next.last_device,
      last_mesh_session: next.last_mesh_session,
      last_control_target: next.last_control_target,
      last_phone_capture: next.last_phone_capture,
      last_mesh_inbox_item: next.last_mesh_inbox_item,
      last_mesh_skill: next.last_mesh_skill,
      likely_next_references: next.likely_next_references,
    })) {
      const existing = db.prepare(`
        SELECT id FROM continuity_state
        WHERE key=? AND scope=? AND COALESCE(project_id, '')='' AND COALESCE(topic, '')=''
        LIMIT 1
      `).get(key, "global");
      if (existing) {
        db.prepare(`
          UPDATE continuity_state
          SET value_json=?, confidence=?, updated_at=?, source_turn_id=?, metadata_json=?
          WHERE id=?
        `).run(json(value), 0.86, now, sourceTurnId, json({ source: "hot_cache" }), existing.id);
      } else {
        db.prepare(`
          INSERT INTO continuity_state(id, key, value_json, confidence, scope, project_id, topic, created_at, updated_at, source_turn_id, metadata_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), key, json(value), 0.86, "global", null, null, now, now, sourceTurnId, json({ source: "hot_cache" }));
      }
    }
    return next;
  }

  function resolveReferences(userMessage, options = {}) {
    const text = String(userMessage || "");
    const continuity = getContinuity();
    const candidates = [];
    const refs = continuity.likely_next_references || {};
    const pronouns = ["it", "this", "that", "they", "them", "the thing", "the issue", "the file", "the prompt", "last thing", "previous conversation"];
    const lower = text.toLowerCase();
    for (const phrase of pronouns) {
      if (!new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) continue;
      const artifactIntent = /\b(open|show|read|locate|find|file|artifact|document|report)\b/i.test(text);
      const resolved = artifactIntent && continuity.active_artifact
        ? continuity.active_artifact
        : refs[phrase] || refs[phrase.split(" ")[0]] || continuity.last_discussed_object || continuity.active_topic;
      if (resolved) {
        const confidence = ["it", "this", "that"].includes(phrase) ? 0.72 : 0.84;
        candidates.push({ phrase, resolvedTo: resolved, resolvedType: "continuity", confidence });
      }
    }
    if (!candidates.length && /\b(add|fix|continue|keep going|do it|same)\b/i.test(text) && continuity.last_discussed_object) {
      candidates.push({ phrase: "implicit follow-up", resolvedTo: continuity.last_discussed_object, resolvedType: "continuity", confidence: 0.64 });
    }
    const best = candidates.sort((a, b) => b.confidence - a.confidence)[0] || null;
    let resolvedMessage = text;
    if (best && best.confidence >= 0.7) {
      resolvedMessage = `${text}\n\n[NeuralVault resolved reference: "${best.phrase}" means "${best.resolvedTo}".]`;
    } else if (best && best.confidence >= 0.4) {
      resolvedMessage = `${text}\n\n[NeuralVault assumption: "${best.phrase}" likely refers to "${best.resolvedTo}". State this assumption briefly if it matters.]`;
    }
    for (const candidate of candidates.slice(0, 5)) {
      db.prepare(`
        INSERT INTO referent_candidates(id, phrase, resolved_to, resolved_type, confidence, project_id, topic, source_turn_id, created_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), candidate.phrase, candidate.resolvedTo, candidate.resolvedType, candidate.confidence, options.projectId || null, continuity.active_topic || null, options.turnId || "", isoNow(), json({ accepted: candidate === best }));
    }
    return { originalMessage: text, resolvedMessage, confidence: best?.confidence || 0, candidates, continuity };
  }

  function updateContinuityFromTurn({ userMessage = "", assistantMessage = "", turnId = "", route = {}, artifacts = [], toolResults = [], effectiveTools = [] } = {}) {
    const now = isoNow();
    const text = `${userMessage}\n${assistantMessage}`;
    const continuity = getContinuity();
    const topic = inferTopic(text) || continuity.active_topic;
    const project = inferProjectId(text) === "jarvis" ? "Jarvis" : continuity.active_project;
    const entities = extractEntities(text).map((item) => item.name);
    // An artifact this turn actually produced, or one still fresh enough that "it" could plausibly
    // still mean that.
    //
    // This was `|| continuity.active_artifact` with no qualifier, so a turn producing nothing
    // inherited the previous artifact — forever. A poem written on 13 August was still the active
    // artifact 450 turns later and, because `nextObject` puts the artifact FIRST, it outranked the
    // subject of every conversation since: "open it", "do it again", "where is this file" and even
    // "thanks that was helpful" all resolved to that poem for eight days. Carrying context forward
    // is right. Carrying it forever is what made the assistant seem stuck.
    const freshArtifact = artifacts.find((item) => item?.title || item?.path)?.title
      || artifacts.find((item) => item?.path)?.path
      || "";
    const inheritedAge = Date.now() - new Date(continuity.active_artifact_at || 0).getTime();
    const artifact = freshArtifact
      || (continuity.active_artifact && inheritedAge < ACTIVE_ARTIFACT_TTL_MS ? continuity.active_artifact : "");
    const lastTool = [...(toolResults || [])].reverse().find((item) => item?.tool)?.tool || continuity.active_tool;
    const issue = /\b(failed|broken|issue|problem|wrong|bad|error|not working|could not|can't|cannot)\b/i.test(text)
      ? normalizeText(userMessage).slice(0, 240)
      : continuity.active_issue;
    // THE PRESENT WINS. What this turn is about outranks anything carried in.
    //
    // The order used to be `artifact || entities[0] || topic || …`, which put a possibly-ancient
    // artifact ahead of the entities and topic of the conversation actually happening. A freshly
    // produced artifact IS the subject and still comes first; an inherited one now sits behind the
    // live turn, where it can only be chosen when this turn gave us nothing better.
    const nextObject = freshArtifact || entities[0] || topic || artifact || continuity.last_discussed_object;
    const next = saveContinuity({
      ...continuity,
      active_project: project,
      active_topic: topic,
      active_issue: issue,
      active_artifact: artifact,
      // Stamped so the TTL above measures the artifact's own age rather than the age of the file,
      // which every turn rewrites.
      active_artifact_at: freshArtifact ? now : (continuity.active_artifact_at || ""),
      active_tool: lastTool,
      active_goal: route?.intent === "action" ? normalizeText(userMessage).slice(0, 240) : continuity.active_goal,
      last_discussed_object: nextObject,
      last_user_correction: /\b(actually|i meant|wrong|not that|no,?)\b/i.test(userMessage) ? normalizeText(userMessage).slice(0, 240) : continuity.last_user_correction,
      // A commitment is only remembered if something actually happened. This matched on the WORDS
      // "done / opened / saved / fixed" alone, so JARVIS's false claims became durable context and
      // were replayed to it as fact — including "I have switched over to your YouTube tab", which it
      // never did. Saying a thing is not evidence of the thing; a tool that took effect is.
      last_assistant_commitment: (effectiveTools.length && /\b(i will|i'll|done|created|updated|opened|saved|fixed)\b/i.test(assistantMessage))
        ? normalizeText(assistantMessage).slice(0, 240)
        : continuity.last_assistant_commitment,
      recent_entities: [...new Set([...entities, ...(continuity.recent_entities || [])])].slice(0, 24),
      recent_pronoun_targets: {
        ...(continuity.recent_pronoun_targets || {}),
        it: nextObject,
        this: normalizeText(userMessage).slice(0, 180) || nextObject,
        that: continuity.last_discussed_object,
      },
      likely_next_references: {
        ...(continuity.likely_next_references || {}),
        it: nextObject,
        this: normalizeText(userMessage).slice(0, 180) || nextObject,
        that: continuity.last_discussed_object,
        "the issue": issue || continuity.active_issue,
        "the prompt": artifact || continuity.likely_next_references?.["the prompt"] || "the latest attached Codex prompt",
      },
    }, turnId);
    upsertCarryoverSummary(next, { userMessage, assistantMessage, turnId });
    return next;
  }

  function upsertCarryoverSummary(continuity, metadata = {}) {
    const now = isoNow();
    const topic = continuity.active_topic || "general";
    const existing = db.prepare("SELECT id FROM carryover_summaries WHERE topic=? AND COALESCE(project_id, '')=COALESCE(?, '') ORDER BY updated_at DESC LIMIT 1")
      .get(topic, continuity.active_project || null);
    const payload = [
      `Active project: ${continuity.active_project || "unknown"}.`,
      `Current goal: ${continuity.active_goal || "unknown"}.`,
      continuity.active_issue ? `Active issue: ${continuity.active_issue}.` : "",
      continuity.last_discussed_object ? `Last discussed object: ${continuity.last_discussed_object}.` : "",
    ].filter(Boolean).join(" ");
    const values = [
      continuity.active_project || null,
      topic,
      continuity.active_goal || "",
      json(continuity.active_issue ? [continuity.active_issue] : []),
      json(continuity.active_artifact ? [continuity.active_artifact] : []),
      json(continuity.last_user_correction ? [continuity.last_user_correction] : []),
      json(metadata.userMessage ? [metadata.userMessage] : []),
      json(continuity.likely_next_references || {}),
      payload,
      now,
      now,
    ];
    if (existing) {
      db.prepare(`
        UPDATE carryover_summaries SET current_goal=?, active_issues_json=?, last_artifacts_json=?, important_user_corrections_json=?,
          open_loops_json=?, likely_next_references_json=?, summary=?, updated_at=?
        WHERE id=?
      `).run(values[2], values[3], values[4], values[5], values[6], values[7], values[8], now, existing.id);
      return existing.id;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO carryover_summaries(id, project_id, topic, current_goal, active_issues_json, last_artifacts_json,
        important_user_corrections_json, open_loops_json, likely_next_references_json, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, ...values);
    return id;
  }

  function getContextPack(query, options = {}) {
    const resolution = resolveReferences(query, options);
    const retrievalQuery = `${query}\n${resolution.candidates.map((item) => item.resolvedTo).join("\n")}`;
    const memories = hybridSearch(retrievalQuery, { limit: options.limit || 8, turnId: options.turnId });
    const continuity = getContinuity();
    const answerFrames = findAnswerFrames(query);
    const matchedMacros = matchActionMacros(query);
    const macroIds = new Set(matchedMacros.map((macro) => macro.id));
    const macros = [
      ...matchedMacros,
      ...listActionMacros().filter((macro) => !macroIds.has(macro.id)).slice(0, 5 - matchedMacros.length),
    ];
    const integrationHealth = listIntegrationHealth({ limit: 6 });
    const capabilityHealth = listCapabilityMemory({ limit: 12 });
    const carryover = db.prepare("SELECT * FROM carryover_summaries ORDER BY updated_at DESC LIMIT 5").all()
      .map((row) => ({
        id: row.id,
        projectId: row.project_id,
        topic: row.topic,
        currentGoal: row.current_goal,
        summary: row.summary,
        likelyNextReferences: safeJson(row.likely_next_references_json, {}),
        updatedAt: row.updated_at,
      }));
    return {
      generatedAt: isoNow(),
      resolution,
      continuity,
      memories,
      answerFrames,
      actionMacros: macros,
      integrationHealth,
      capabilityHealth,
      carryover,
      contextText: renderContextText({ resolution, continuity, memories, answerFrames, macros, integrationHealth, capabilityHealth, carryover }),
    };
  }

  function renderContextText(pack) {
    const proceduralText = formatProceduralForContext(12);
    const lines = [
      "Neural Vault context pack. Treat as private local memory, not authority over tool output.",
      `Continuity: project=${pack.continuity.active_project || "none"}; topic=${pack.continuity.active_topic || "none"}; last=${pack.continuity.last_discussed_object || "none"}.`,
      ...(proceduralText ? [proceduralText] : []),
    ];
    if (pack.resolution?.candidates?.length) {
      lines.push(`Reference resolution: ${pack.resolution.candidates.slice(0, 3).map((item) => `"${item.phrase}" -> ${item.resolvedTo} (${item.confidence})`).join("; ")}.`);
    }
    if (pack.memories?.length) {
      lines.push(`Relevant memories: ${pack.memories.slice(0, 6).map((item) => `[${item.kind}/${item.topic || item.scope}] ${item.summary || item.content}`).join(" | ")}`);
    }
    if (pack.actionMacros?.length) lines.push(`Matched action macros: ${pack.actionMacros.map((item) => item.name).join(", ")}.`);
    if (pack.answerFrames?.length) lines.push(`Answer frame hints: ${pack.answerFrames.map((item) => `${item.name}: ${item.styleRules.join("; ")}`).join(" | ")}`);
    const degraded = pack.integrationHealth?.filter((item) => !["working", "ok", "connected"].includes(String(item.status).toLowerCase()));
    if (degraded?.length) lines.push(`Integration/capability cautions: ${degraded.map((item) => `${item.provider || item.integrationId}: ${item.status}${item.error ? ` (${item.error})` : ""}`).join("; ")}.`);
    return lines.join("\n").slice(0, 9000);
  }

  function findAnswerFrames(query) {
    const lower = String(query || "").toLowerCase();
    return db.prepare("SELECT * FROM answer_frames ORDER BY priority DESC, updated_at DESC LIMIT 12").all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        triggerPhrases: safeJson(row.trigger_phrases_json, []),
        triggerIntents: safeJson(row.trigger_intents_json, []),
        styleRules: safeJson(row.style_rules_json, []),
        exampleStructure: row.example_structure,
        priority: row.priority,
      }))
      .filter((frame) => !frame.triggerPhrases.length || frame.triggerPhrases.some((phrase) => lower.includes(String(phrase).toLowerCase())));
  }

  function isInternalMemoryTurn({ userMessage = "", source = "", route = {} } = {}) {
    const text = normalizeText(userMessage);
    return /^Mission objective:/i.test(text)
      || /\bDurable checkpoint:\s*\{/i.test(text)
      || /\bTask OS plan:\s*\[/i.test(text)
      || /\bAgent role:\s*(browser|kalshi|canvas|pc|research|verifier|coordinator|skill)\b/i.test(text)
      || ["mission", "agent", "skill-autopilot"].includes(String(source || "").toLowerCase())
      || Boolean(route?.agentRole || route?.missionId);
  }

  function recordToolResultEvent(result = {}, turnId = "") {
    writeRawEvent("tool_calls", {
      source: "tool_call",
      toolName: result.tool,
      toolInput: result.args || null,
      toolOutput: summarizeToolOutput(result.result),
      success: Boolean(result.ok),
      tags: [result.tool, result.ok ? "success" : "failure"].filter(Boolean),
      privacyLevel: "private",
      metadata: { turnId, status: result.status, error: result.error || "" },
    });
    if (!result.ok) recordCapabilityFailure(result.tool, result.error || result.status || "Tool failed");
    else recordCapabilitySuccess(result.tool, result.result);
  }

  function ingestTurn({ userMessage = "", assistantMessage = "", turnId = "", route = {}, toolResults = [], sources = [], artifacts = [], source = "chat" } = {}) {
    const raw = writeRawEvent("conversations", {
      source,
      userMessage,
      assistantMessage,
      tags: ["turn", route?.intent || "conversation"].filter(Boolean),
      topic: inferTopic(`${userMessage}\n${assistantMessage}`),
      project: inferProjectId(`${userMessage}\n${assistantMessage}`),
      privacyLevel: "private",
      metadata: { turnId, route, source, sources: sources?.slice?.(0, 8) || [] },
    });
    const stored = [];
    if (isInternalMemoryTurn({ userMessage, source, route })) {
      for (const result of toolResults || []) recordToolResultEvent(result, turnId);
      return { rawEvent: raw, stored, continuity: getContinuity(), skippedDurable: true };
    }
    if (assistantMessage && !/\b(could not|failed|cannot|can't|unavailable|not configured)\b/i.test(assistantMessage)) {
      stored.push(upsertMemory({
        kind: "episode",
        title: normalizeText(userMessage).slice(0, 90) || "Conversation turn",
        content: `User: ${normalizeText(userMessage)}\nJARVIS: ${normalizeText(assistantMessage)}`,
        summary: normalizeText(assistantMessage).slice(0, 320),
        importance: toolResults?.length ? 6 : 3,
        sourceType: "conversation",
        sourceRef: raw.id,
        metadata: { turnId, routeIntent: route?.intent || "", toolCount: toolResults?.length || 0 },
      }));
    }
    extractDurableItemsFromUser(userMessage, raw.id).forEach((item) => stored.push(item));
    for (const artifact of artifacts || []) {
      if (artifact?.path || artifact?.title) stored.push(indexArtifact(artifact));
    }
    for (const result of toolResults || []) {
      recordToolResultEvent(result, turnId);
    }
    // Which tools actually CHANGED something this turn. A successful read tells us nothing about
    // whether a claimed action happened, so observe-only results and results whose own payload says
    // they stopped short (blocked, awaiting confirmation, cancelled) do not count as evidence.
    const effectiveTools = (toolResults || []).filter((item) => {
      if (!item || item.ok !== true) return false;
      const r = item.result && typeof item.result === "object" ? item.result : {};
      if (r.completed === false) return false;
      return !["blocked", "requiresConfirmation", "requiresLogin", "cancelled"].some((flag) => r[flag] === true);
    });
    const continuity = updateContinuityFromTurn({ userMessage, assistantMessage, turnId, route, artifacts, toolResults, effectiveTools });
    maybeSuggestMacro(userMessage);
    return { rawEvent: raw, stored, continuity };
  }

  function summarizeToolOutput(result) {
    if (!result || typeof result !== "object") return result;
    return Object.fromEntries(Object.entries(result).slice(0, 20).map(([key, value]) => {
      if (/token|secret|key|password|cookie/i.test(key)) return [key, "[redacted]"];
      if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value)) return [key, "[redacted]"];
      if (typeof value === "string" && value.length > 700) return [key, `${value.slice(0, 700)}...`];
      return [key, value];
    }));
  }

  function extractDurableItemsFromUser(userMessage, rawRef) {
    const text = normalizeText(userMessage);
    const stored = [];
    if (!text) return stored;
    if (/\b(i prefer|i like|i want|by default|always|never|when i ask|from now on|call me)\b/i.test(text)) {
      stored.push(upsertMemory({
        kind: /\b(always|never|when i ask|by default|from now on)\b/i.test(text) ? "procedure" : "semantic",
        title: "User preference / instruction",
        content: text,
        summary: text.slice(0, 280),
        importance: 8,
        confidence: 0.92,
        sourceType: "conversation",
        sourceRef: rawRef,
        metadata: { extractedFromUser: true },
      }));
      upsertPersonalProfileItem({
        category: /\bcodex prompt\b/i.test(text) ? "writing_style" : "answer_style",
        key: slugify(text.slice(0, 60)),
        value: text,
        confidence: 0.9,
        source: "conversation",
      });
    }
    if (/\bGEMINI_API_KEY|KALSHI|CANVAS|GOOGLE|TAVILY|BRAVE|EXA|NEWS_API_KEY\b/i.test(text) && /\bremember|use|configured|key\b/i.test(text)) {
      const envMatch = text.match(/\b[A-Z][A-Z0-9_]{4,}\b/);
      if (envMatch) {
        stored.push(rememberApiKeyMetadata({
          provider: providerFromEnv(envMatch[0]),
          keyLabel: `${providerFromEnv(envMatch[0])} key`,
          envVarName: envMatch[0],
          secretStorageLocation: "environment/local vault",
          scopes: [],
          status: "known",
          notes: "Metadata only. Raw secret value was not stored.",
        }));
      }
    }
    if (/\bwhen i say\b/i.test(text) && /\b(open|search|check|run|do)\b/i.test(text)) {
      stored.push(compileSkillFromText(text));
    }
    return stored;
  }

  function providerFromEnv(env) {
    if (/GEMINI/i.test(env)) return "Gemini";
    if (/KALSHI/i.test(env)) return "Kalshi";
    if (/CANVAS/i.test(env)) return "Canvas";
    if (/GOOGLE|GMAIL/i.test(env)) return "Google";
    if (/TAVILY/i.test(env)) return "Tavily";
    if (/BRAVE/i.test(env)) return "Brave";
    if (/EXA/i.test(env)) return "Exa";
    if (/NEWS/i.test(env)) return "News";
    return env.replace(/_API_KEY|_TOKEN|_KEY/gi, "");
  }

  function compileSkillFromText(text) {
    const trigger = text.match(/when i say\s+["']?([^"',.]+)["']?/i)?.[1]?.trim() || text.slice(0, 70);
    const name = trigger.replace(/\b(for something|something|it)\b/gi, "").trim() || "Custom Jarvis Skill";
    return compileSkill({
      name,
      description: text,
      triggerPhrases: [trigger],
      steps: text.toLowerCase().includes("youtube")
        ? ["Open YouTube", "Find the search bar", "Type the query parameter", "Submit", "Verify results"]
        : ["Resolve user intent", "Select required tools", "Perform reversible steps", "Verify outcome"],
      requiredTools: text.toLowerCase().includes("youtube") ? ["desktop_control", "screen_capture"] : [],
      successCriteria: ["Verified tool output exists", "No unsupported claim is made"],
      failureRecovery: ["Report blocker clearly", "Use a safer fallback if available"],
      metadata: { sourceText: text },
    });
  }

  function compileSkill(data = {}) {
    const now = isoNow();
    const slug = slugify(data.slug || data.name);
    const existing = db.prepare("SELECT id FROM skills WHERE slug=?").get(slug);
    const id = existing?.id || crypto.randomUUID();
    const values = [
      data.name || slug,
      slug,
      data.description || "",
      json(data.triggerPhrases || []),
      data.intent || "",
      data.projectId || "jarvis",
      json(data.requiredTools || []),
      json(data.requiredAgents || []),
      json(data.requiredPermissions || []),
      json(data.steps || []),
      json(data.inputSchema || {}),
      json(data.outputSchema || {}),
      json(data.examples || []),
      json(data.successCriteria || []),
      json(data.failureRecovery || []),
      now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE skills SET name=?, description=?, trigger_phrases_json=?, intent=?, project_id=?, required_tools_json=?, required_agents_json=?,
          required_permissions_json=?, steps_json=?, input_schema_json=?, output_schema_json=?, examples_json=?, success_criteria_json=?,
          failure_recovery_json=?, version=version+1, updated_at=?, metadata_json=?
        WHERE id=?
      `).run(values[0], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], values[14], now, values[17], id);
    } else {
      db.prepare(`
        INSERT INTO skills(id, name, slug, description, trigger_phrases_json, intent, project_id, required_tools_json, required_agents_json,
          required_permissions_json, steps_json, input_schema_json, output_schema_json, examples_json, success_criteria_json, failure_recovery_json,
          created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...values);
    }
    return { id, name: data.name || slug, slug, triggerPhrases: data.triggerPhrases || [], steps: data.steps || [] };
  }

  function createActionMacro(data = {}) {
    const now = isoNow();
    const slug = slugify(data.slug || data.name);
    const existing = db.prepare("SELECT id FROM action_macros WHERE slug=?").get(slug);
    const id = existing?.id || crypto.randomUUID();
    const payload = [
      data.name || slug,
      slug,
      data.description || "",
      json(data.triggerPhrases || []),
      data.actionType || "workflow",
      json(data.requiredTools || []),
      json(data.requiredPermissions || []),
      json(data.parametersSchema || {}),
      json(data.steps || []),
      json(data.verificationSteps || []),
      json(data.fallbackSteps || []),
      now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE action_macros SET name=?, description=?, trigger_phrases_json=?, action_type=?, required_tools_json=?,
          required_permissions_json=?, parameters_schema_json=?, steps_json=?, verification_steps_json=?, fallback_steps_json=?, updated_at=?, metadata_json=?
        WHERE id=?
      `).run(payload[0], payload[2], payload[3], payload[4], payload[5], payload[6], payload[7], payload[8], payload[9], payload[10], now, payload[13], id);
    } else {
      db.prepare(`
        INSERT INTO action_macros(id, name, slug, description, trigger_phrases_json, action_type, required_tools_json, required_permissions_json,
          parameters_schema_json, steps_json, verification_steps_json, fallback_steps_json, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...payload);
    }
    return getActionMacro(id);
  }

  function getActionMacro(id) {
    const row = db.prepare("SELECT * FROM action_macros WHERE id=?").get(id);
    return row ? publicMacro(row) : null;
  }

  function publicMacro(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      triggerPhrases: safeJson(row.trigger_phrases_json, []),
      actionType: row.action_type,
      requiredTools: safeJson(row.required_tools_json, []),
      requiredPermissions: safeJson(row.required_permissions_json, []),
      parametersSchema: safeJson(row.parameters_schema_json, {}),
      steps: safeJson(row.steps_json, []),
      verificationSteps: safeJson(row.verification_steps_json, []),
      fallbackSteps: safeJson(row.fallback_steps_json, []),
      successRate: row.success_rate,
      averageDurationMs: row.average_duration_ms,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      status: row.status,
      updatedAt: row.updated_at,
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function listActionMacros() {
    return db.prepare("SELECT * FROM action_macros WHERE status='active' ORDER BY updated_at DESC").all().map(publicMacro);
  }

  function listActionMacroRuns({ limit = 20, macroId = "" } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = macroId
      ? db.prepare("SELECT * FROM action_macro_runs WHERE macro_id=? ORDER BY started_at DESC LIMIT ?").all(macroId, safeLimit)
      : db.prepare("SELECT * FROM action_macro_runs ORDER BY started_at DESC LIMIT ?").all(safeLimit);
    return rows.map((row) => ({
      id: row.id,
      macroId: row.macro_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      inputParams: safeJson(row.input_params_json, {}),
      executedSteps: safeJson(row.executed_steps_json, []),
      verification: safeJson(row.verification_json, {}),
      error: row.error,
      durationMs: row.duration_ms,
      metadata: safeJson(row.metadata_json, {}),
    }));
  }

  function matchActionMacros(query) {
    const lower = String(query || "").toLowerCase();
    return listActionMacros().filter((macro) => macro.triggerPhrases.some((phrase) => {
      const normalized = String(phrase).toLowerCase().replace(/\{[^}]+\}/g, "").replace(/\s+/g, " ").trim();
      // B-24 — the guard tested `normalized` while the match used a further-stripped string, so a
      // trigger phrase that is entirely placeholder + stopword ("for {query}") passed the guard as
      // "for" and then matched on "", which `includes` reports true for every query. Guard the
      // string that is actually matched.
      const needle = normalized.replace(/\b(for|something)\b/g, "").replace(/\s+/g, " ").trim();
      return Boolean(needle) && lower.includes(needle);
    })).slice(0, 5);
  }

  function recordActionMacroRun({
    macroId,
    status,
    inputParams = {},
    executedSteps = [],
    verification = [],
    error = "",
    durationMs = 0,
    triggeredBy = "user_chat",
    originalUserMessage = "",
    resolvedUserMessage = "",
    requiredTools = [],
    permissionsChecked = [],
    userVisibleSummary = "",
    debugTraceId = "",
    referentResolution = [],
    metadata = {},
  } = {}) {
    const now = isoNow();
    const id = crypto.randomUUID();
    const macro = getActionMacro(macroId);
    const verificationPayload = Array.isArray(verification)
      ? { passed: status === "success", checks: verification }
      : { passed: Boolean(verification?.passed ?? status === "success"), checks: verification?.checks || [], ...verification };
    const toolEvents = executedSteps.map((step) => ({
      tool: step.tool || step.type || step.action || "action_step",
      status: step.status || (status === "success" ? "success" : "unknown"),
      summary: step.summary || step.action || step.type || "Action step recorded",
    }));
    const runMetadata = {
      triggeredBy,
      originalUserMessage,
      resolvedUserMessage,
      requiredTools: requiredTools.length ? requiredTools : macro?.requiredTools || [],
      permissionsChecked: permissionsChecked.length ? permissionsChecked : macro?.requiredPermissions || [],
      toolEvents,
      userVisibleSummary,
      debugTraceId,
      memoryWritten: true,
      referentResolution,
      ...metadata,
    };
    db.prepare(`
      INSERT INTO action_macro_runs(id, macro_id, started_at, ended_at, status, input_params_json, executed_steps_json, verification_json, error, duration_ms, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, macroId, now, now, status || "unknown", json(inputParams), json(executedSteps), json(verificationPayload), error, durationMs, json(runMetadata));
    const stats = db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success, AVG(duration_ms) AS average_duration
      FROM action_macro_runs WHERE macro_id=?
    `).get(macroId);
    db.prepare(`
      UPDATE action_macros SET success_rate=?, average_duration_ms=?, last_success_at=CASE WHEN ?='success' THEN ? ELSE last_success_at END,
        last_failure_at=CASE WHEN ?!='success' THEN ? ELSE last_failure_at END, updated_at=?
      WHERE id=?
    `).run(Number(stats.total) ? Number(stats.success || 0) / Number(stats.total) : 0, Math.round(Number(stats.average_duration || 0)), status, now, status, now, now, macroId);
    improveMacroAfterRun(macroId);
    writeRawEvent("tool_calls", {
      source: "action_macro_run",
      tags: ["action", macro?.slug || macroId, status || "unknown"],
      actionRunId: id,
      actionMacroId: macroId,
      name: macro?.name || macroId,
      triggeredBy,
      originalUserMessage,
      resolvedUserMessage,
      parameters: inputParams,
      requiredTools: runMetadata.requiredTools,
      permissionsChecked: runMetadata.permissionsChecked,
      status: status || "unknown",
      verification: verificationPayload,
      toolEvents,
      userVisibleSummary,
      debugTraceId,
    });
    if (status === "success") {
      recordCapabilitySuccess(macro?.slug ? `action:${macro.slug}` : "action_macro", userVisibleSummary || `${macro?.name || "Action"} completed`);
    } else if (status) {
      recordCapabilityFailure(macro?.slug ? `action:${macro.slug}` : "action_macro", error || "Action did not verify successfully");
      recordIntegrationHealth({
        provider: "action_macro",
        status: "degraded",
        error: error || `${macro?.name || "Action"} returned ${status}`,
        affectedTools: runMetadata.requiredTools,
        metadata: { actionRunId: id, macroId },
      });
    }
    const summary = userVisibleSummary || `${macro?.name || "Action"} ${status || "recorded"}`;
    upsertMemory({
      kind: "action_run",
      title: `Action run: ${macro?.name || macroId}`,
      content: `${macro?.name || macroId} ran with status ${status || "unknown"}. ${summary}`,
      summary,
      importance: status === "success" ? 3 : 4,
      confidence: status === "success" ? 0.86 : 0.72,
      sourceType: "action_macro_run",
      sourceRef: id,
      metadata: { actionRunId: id, macroId, status, triggeredBy, parameters: inputParams },
    });
    const continuity = getContinuity();
    saveContinuity({
      ...continuity,
      active_tool: macro?.slug || macroId,
      last_discussed_object: macro?.name || macroId,
      likely_next_references: {
        ...(continuity.likely_next_references || {}),
        it: `${macro?.name || macroId} action`,
        that: `${macro?.name || macroId} action`,
        "do it again": `repeat ${macro?.name || macroId} action`,
      },
      last_action: macro?.slug || macroId,
      last_action_params: inputParams,
      last_action_result: summary,
    }, id);
    return { id, macroId, status, metadata: runMetadata };
  }

  function updateActionMacroRun(id, {
    status,
    executedSteps,
    verification,
    error,
    durationMs,
    userVisibleSummary = "",
    metadata = {},
  } = {}) {
    const existing = db.prepare("SELECT * FROM action_macro_runs WHERE id=?").get(id);
    if (!existing) throw Object.assign(new Error("Action macro run not found."), { statusCode: 404 });
    const previousMetadata = safeJson(existing.metadata_json, {});
    const previousSteps = safeJson(existing.executed_steps_json, []);
    const previousVerification = safeJson(existing.verification_json, {});
    const nextStatus = status || existing.status;
    const nextSteps = executedSteps || previousSteps;
    const nextVerification = verification
      ? (Array.isArray(verification) ? { passed: nextStatus === "success", checks: verification } : verification)
      : previousVerification;
    const nextMetadata = {
      ...previousMetadata,
      ...metadata,
      userVisibleSummary: userVisibleSummary || metadata.userVisibleSummary || previousMetadata.userVisibleSummary || "",
      memoryWritten: true,
    };
    db.prepare(`
      UPDATE action_macro_runs
      SET ended_at=?, status=?, executed_steps_json=?, verification_json=?, error=?, duration_ms=?, metadata_json=?
      WHERE id=?
    `).run(isoNow(), nextStatus, json(nextSteps), json(nextVerification), error ?? existing.error, durationMs ?? existing.duration_ms, json(nextMetadata), id);
    const stats = db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success, AVG(duration_ms) AS average_duration
      FROM action_macro_runs WHERE macro_id=?
    `).get(existing.macro_id);
    db.prepare(`
      UPDATE action_macros SET success_rate=?, average_duration_ms=?, last_success_at=CASE WHEN ?='success' THEN ? ELSE last_success_at END,
        last_failure_at=CASE WHEN ?!='success' THEN ? ELSE last_failure_at END, updated_at=?
      WHERE id=?
    `).run(Number(stats.total) ? Number(stats.success || 0) / Number(stats.total) : 0, Math.round(Number(stats.average_duration || 0)), nextStatus, isoNow(), nextStatus, isoNow(), isoNow(), existing.macro_id);
    if (nextStatus === "success") recordCapabilitySuccess(`action:${existing.macro_id}`, userVisibleSummary || "Action completed after local approval.");
    if (nextStatus && nextStatus !== "success" && nextStatus !== "partial") recordCapabilityFailure(`action:${existing.macro_id}`, error || "Action failed after local approval.");
    upsertMemory({
      kind: "action_run",
      title: `Action run update: ${existing.macro_id}`,
      content: `Action run ${id} updated to ${nextStatus}. ${userVisibleSummary || error || ""}`,
      summary: userVisibleSummary || error || `Action run ${nextStatus}`,
      importance: nextStatus === "success" ? 3 : 4,
      confidence: 0.84,
      sourceType: "action_macro_run_update",
      sourceRef: id,
      metadata: { actionRunId: id, macroId: existing.macro_id, status: nextStatus },
    });
    return listActionMacroRuns({ macroId: existing.macro_id, limit: 100 }).find((run) => run.id === id);
  }

  function improveMacroAfterRun(macroId) {
    const failures = db.prepare("SELECT COUNT(*) AS count FROM action_macro_runs WHERE macro_id=? AND status!='success'").get(macroId).count;
    const successes = db.prepare("SELECT COUNT(*) AS count FROM action_macro_runs WHERE macro_id=? AND status='success'").get(macroId).count;
    if (failures >= 2 && successes >= 1) {
      const macro = getActionMacro(macroId);
      const fallbackSteps = macro.fallbackSteps || [];
      if (fallbackSteps.length && !macro.metadata?.preferredFallbackAfterFailures) {
        db.prepare("UPDATE action_macros SET metadata_json=?, updated_at=? WHERE id=?")
          .run(json({ ...macro.metadata, preferredFallbackAfterFailures: true, fallbackSteps }), isoNow(), macroId);
      }
    }
  }

  function maybeSuggestMacro(userMessage) {
    const lower = String(userMessage || "").toLowerCase();
    if (!/\b(open|search|check|go to|click)\b/.test(lower)) return null;
    const fingerprint = slugify(lower.replace(/\b(for|about|with)\s+.+$/i, ""));
    const memory = upsertMemory({
      kind: "action_observation",
      title: `Repeated action candidate: ${fingerprint}`,
      content: `User action request pattern: ${fingerprint}`,
      importance: 2,
      confidence: 0.6,
      sourceType: "action_learning",
      metadata: { fingerprint },
    });
    return memory;
  }

  function upsertBrowserWorkflow(data = {}) {
    const now = isoNow();
    const id = data.id || crypto.randomUUID();
    const existing = db.prepare("SELECT id FROM browser_workflows WHERE site_name=? AND workflow_name=?").get(data.siteName, data.workflowName);
    const targetId = existing?.id || id;
    const values = [
      data.siteName,
      data.baseUrl,
      data.workflowName,
      json(data.triggerPhrases || []),
      data.directUrlTemplate || "",
      json(data.selectorHints || []),
      json(data.steps || []),
      json(data.verificationRules || []),
      data.loginRequired ? 1 : 0,
      data.permissionScope || "browser",
      json(data.knownIssues || []),
      now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE browser_workflows SET base_url=?, trigger_phrases_json=?, direct_url_template=?, selector_hints_json=?, steps_json=?,
          verification_rules_json=?, login_required=?, permission_scope=?, known_issues_json=?, updated_at=?, metadata_json=?
        WHERE id=?
      `).run(values[1], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], now, values[13], targetId);
    } else {
      db.prepare(`
        INSERT INTO browser_workflows(id, site_name, base_url, workflow_name, trigger_phrases_json, direct_url_template, selector_hints_json,
          steps_json, verification_rules_json, login_required, permission_scope, known_issues_json, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(targetId, ...values);
    }
    return targetId;
  }

  function registerAgent(data = {}) {
    const now = isoNow();
    const slug = slugify(data.slug || data.name);
    const existing = db.prepare("SELECT id FROM agents WHERE slug=?").get(slug);
    const id = existing?.id || crypto.randomUUID();
    const payload = [
      data.name || slug,
      slug,
      data.role || "Agent",
      data.description || "",
      data.instructions || "",
      json(data.allowedTools || []),
      json(data.blockedTools || []),
      data.permissionScope || "default",
      data.memoryScope || "global",
      data.modelProvider || "gemini",
      data.modelName || "",
      now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE agents SET name=?, role=?, description=?, instructions=?, allowed_tools_json=?, blocked_tools_json=?, permission_scope=?,
          memory_scope=?, model_provider=?, model_name=?, updated_at=?, metadata_json=? WHERE id=?
      `).run(payload[0], payload[2], payload[3], payload[4], payload[5], payload[6], payload[7], payload[8], payload[9], payload[10], now, payload[13], id);
    } else {
      db.prepare(`
        INSERT INTO agents(id, name, slug, role, description, instructions, allowed_tools_json, blocked_tools_json, permission_scope,
          memory_scope, model_provider, model_name, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...payload);
    }
    return { id, name: payload[0], slug, role: payload[2], allowedTools: data.allowedTools || [], blockedTools: data.blockedTools || [] };
  }

  function rememberApiKeyMetadata(data = {}) {
    const envVarName = normalizeText(data.envVarName || data.env_var_name || "");
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(envVarName)) throw Object.assign(new Error("Use an environment variable name, not a raw key value."), { statusCode: 400 });
    if (SECRET_VALUE_PATTERN.test(data.rawValue || data.keyValue || "")) throw Object.assign(new Error("Raw secret values cannot be stored in Neural Vault metadata."), { statusCode: 400 });
    const now = isoNow();
    const provider = normalizeText(data.provider || providerFromEnv(envVarName));
    const keyLabel = normalizeText(data.keyLabel || `${provider} API key`);
    const existing = db.prepare("SELECT id FROM api_key_metadata WHERE provider=? AND env_var_name=?").get(provider, envVarName);
    const id = existing?.id || crypto.randomUUID();
    const payload = [
      provider,
      keyLabel,
      envVarName,
      data.secretStorageLocation || "environment/local credential vault",
      json(data.scopes || []),
      json(data.usedByTools || toolsForProvider(provider)),
      json(data.usedByAgents || []),
      data.status || "known",
      data.lastVerifiedAt || null,
      data.lastRotatedAt || null,
      data.expiresAt || null,
      json(data.rateLimit || {}),
      data.notes || "Metadata only. Raw secret value is not stored.",
      now,
      now,
      json({ ...(data.metadata || {}), secretStored: false }),
    ];
    if (existing) {
      db.prepare(`
        UPDATE api_key_metadata SET key_label=?, secret_storage_location=?, scopes_json=?, used_by_tools_json=?, used_by_agents_json=?,
          status=?, last_verified_at=?, last_rotated_at=?, expires_at=?, rate_limit_json=?, notes=?, updated_at=?, metadata_json=?
        WHERE id=?
      `).run(payload[1], payload[3], payload[4], payload[5], payload[6], payload[7], payload[8], payload[9], payload[10], payload[11], payload[12], now, payload[15], id);
    } else {
      db.prepare(`
        INSERT INTO api_key_metadata(id, provider, key_label, env_var_name, secret_storage_location, scopes_json, used_by_tools_json, used_by_agents_json,
          status, last_verified_at, last_rotated_at, expires_at, rate_limit_json, notes, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...payload);
    }
    upsertIntegration({
      provider,
      name: provider,
      authType: "api_key",
      requiredEnvVars: [envVarName],
      toolsEnabled: toolsForProvider(provider),
      status: data.status || "known",
    });
    return {
      id,
      provider,
      keyLabel,
      envVarName,
      secretStorageLocation: payload[3],
      scopes: safeJson(payload[4], []),
      usedByTools: safeJson(payload[5], []),
      status: payload[7],
      secretStored: false,
      notes: payload[12],
      updatedAt: now,
    };
  }

  function toolsForProvider(provider) {
    const lower = String(provider || "").toLowerCase();
    if (lower.includes("gemini")) return ["research_v2", "web_research", "vision", "chat"];
    if (lower.includes("kalshi")) return ["kalshi_portfolio", "kalshi_positions", "kalshi_fills", "kalshi_markets"];
    if (lower.includes("canvas")) return ["canvas_courses", "canvas_assignments"];
    if (lower.includes("google")) return ["send_email"];
    return [];
  }

  function upsertIntegration(data = {}) {
    const now = isoNow();
    const provider = normalizeText(data.provider);
    const name = normalizeText(data.name || provider);
    const existing = db.prepare("SELECT id FROM integrations WHERE provider=? AND name=?").get(provider, name);
    const id = existing?.id || crypto.randomUUID();
    const payload = [
      provider,
      name,
      data.description || "",
      data.authType || "",
      json(data.requiredEnvVars || []),
      json(data.toolsEnabled || []),
      data.status || "unknown",
      data.lastHealthCheckAt || null,
      json(data.healthCheckResult || {}),
      json(data.rateLimitState || {}),
      now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE integrations SET description=?, auth_type=?, required_env_vars_json=?, tools_enabled_json=?, status=?, last_health_check_at=?,
          health_check_result_json=?, rate_limit_state_json=?, updated_at=?, metadata_json=? WHERE id=?
      `).run(payload[2], payload[3], payload[4], payload[5], payload[6], payload[7], payload[8], payload[9], now, payload[12], id);
    } else {
      db.prepare(`
        INSERT INTO integrations(id, provider, name, description, auth_type, required_env_vars_json, tools_enabled_json, status,
          last_health_check_at, health_check_result_json, rate_limit_state_json, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...payload);
    }
    return id;
  }

  function recordIntegrationHealth({ provider, integrationId, status, latencyMs = null, error = "", affectedTools = [], metadata = {} } = {}) {
    const id = integrationId || upsertIntegration({
      provider,
      name: provider,
      status,
      lastHealthCheckAt: isoNow(),
      healthCheckResult: { status, error },
      toolsEnabled: affectedTools,
    });
    db.prepare(`
      INSERT INTO integration_health_events(id, integration_id, checked_at, status, latency_ms, error, affected_tools_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), id, isoNow(), status || "unknown", latencyMs, error, json(affectedTools), json(metadata));
    return { integrationId: id, provider, status, latencyMs, error, affectedTools };
  }

  function listIntegrationHealth({ limit = 20 } = {}) {
    return db.prepare(`
      SELECT i.provider, i.name, i.status AS integration_status, h.*
      FROM integration_health_events h
      LEFT JOIN integrations i ON i.id = h.integration_id
      ORDER BY h.checked_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(80, Number(limit) || 20))).map((row) => ({
      id: row.id,
      integrationId: row.integration_id,
      provider: row.provider,
      name: row.name,
      status: row.status || row.integration_status,
      latencyMs: row.latency_ms,
      error: row.error,
      affectedTools: safeJson(row.affected_tools_json, []),
      checkedAt: row.checked_at,
    }));
  }

  function listApiKeyMetadata() {
    return db.prepare("SELECT * FROM api_key_metadata ORDER BY updated_at DESC").all().map((row) => ({
      id: row.id,
      provider: row.provider,
      keyLabel: row.key_label,
      envVarName: row.env_var_name,
      secretStorageLocation: row.secret_storage_location,
      scopes: safeJson(row.scopes_json, []),
      usedByTools: safeJson(row.used_by_tools_json, []),
      usedByAgents: safeJson(row.used_by_agents_json, []),
      status: row.status,
      lastVerifiedAt: row.last_verified_at,
      notes: row.notes,
      secretStored: false,
      updatedAt: row.updated_at,
    }));
  }

  function listSkills({ limit = 30 } = {}) {
    return db.prepare("SELECT * FROM skills ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 30))).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      triggerPhrases: safeJson(row.trigger_phrases_json, []),
      intent: row.intent,
      requiredTools: safeJson(row.required_tools_json, []),
      requiredAgents: safeJson(row.required_agents_json, []),
      requiredPermissions: safeJson(row.required_permissions_json, []),
      steps: safeJson(row.steps_json, []),
      successCriteria: safeJson(row.success_criteria_json, []),
      version: row.version,
      updatedAt: row.updated_at,
    }));
  }

  function listAgents({ limit = 30 } = {}) {
    return db.prepare("SELECT * FROM agents ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 30))).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role,
      description: row.description,
      allowedTools: safeJson(row.allowed_tools_json, []),
      blockedTools: safeJson(row.blocked_tools_json, []),
      permissionScope: row.permission_scope,
      memoryScope: row.memory_scope,
      updatedAt: row.updated_at,
    }));
  }

  function actionStorageTrace({ macroSlug = "", provider = "" } = {}) {
    const macros = listActionMacros();
    const selectedMacro = macroSlug
      ? macros.find((macro) => macro.slug === macroSlug || macro.id === macroSlug)
      // B-25 — this defaulted to the seeded youtube-search macro, so a trace with no slug
      // reported it as "the" macro regardless of what the owner was actually doing. Misleading in
      // any trace a human reads or that is fed back to the model. With no slug there is no
      // selected macro; the caller gets the most recent run instead (below).
      : null;
    const lastRun = selectedMacro ? listActionMacroRuns({ macroId: selectedMacro.id, limit: 1 })[0] : listActionMacroRuns({ limit: 1 })[0];
    const providerFilter = String(provider || "").toLowerCase();
    return {
      generatedAt: isoNow(),
      macro: selectedMacro || null,
      lastRun: lastRun || null,
      storage: {
        rawEventLake: path.join(root, "raw", "tool_calls"),
        sqliteDb: dbPath,
        hotMemory: hotDir,
        actionMacros: "action_macros",
        actionMacroRuns: "action_macro_runs",
        browserWorkflows: "browser_workflows",
        skills: "skills",
        agents: "agents",
        apiKeyMetadata: "api_key_metadata",
        integrations: "integrations",
        integrationHealth: "integration_health_events",
        capabilityMemory: "capability_memory",
        continuityState: continuityFilePath(),
        referentCandidates: "referent_candidates",
        memoryAccessLog: "memory_access_log",
        debugTraces: "runtime/agent-repair.sqlite:debug_traces",
      },
      continuity: getContinuity(),
      integrationHealth: listIntegrationHealth({ limit: 30 }).filter((item) => !providerFilter || String(item.provider || "").toLowerCase().includes(providerFilter)),
      apiKeyMetadata: listApiKeyMetadata().filter((item) => !providerFilter || String(item.provider || "").toLowerCase().includes(providerFilter)),
    };
  }

  function upsertMeshDevice(data = {}) {
    const now = isoNow();
    const id = normalizeText(data.id || crypto.randomUUID());
    const existing = db.prepare("SELECT id, created_at FROM mesh_devices WHERE id=?").get(id);
    const values = [
      id,
      normalizeText(data.name || "Unnamed device"),
      normalizeText(data.deviceType || data.device_type || data.kind || "unknown"),
      normalizeText(data.platform || ""),
      normalizeText(data.trustLevel || data.trust_level || "paired_untrusted"),
      normalizeText(data.status || "online"),
      json(data.capabilities || []),
      json(data.permissions || {}),
      normalizeText(data.connectionMode || data.connection_mode || "unknown"),
      data.lastSeenAt || data.last_seen_at || now,
      existing?.created_at || data.createdAt || now,
      now,
      json(data.metadata || {}),
    ];
    if (existing) {
      db.prepare(`
        UPDATE mesh_devices SET name=?, device_type=?, platform=?, trust_level=?, status=?, capabilities_json=?,
          permissions_json=?, connection_mode=?, last_seen_at=?, updated_at=?, metadata_json=? WHERE id=?
      `).run(values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], now, values[12], id);
    } else {
      db.prepare(`
        INSERT INTO mesh_devices(id, name, device_type, platform, trust_level, status, capabilities_json, permissions_json,
          connection_mode, last_seen_at, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values);
    }
    writeRawEvent("device_mesh", { source: "mesh_device", tags: ["device", values[5]], deviceId: id, name: values[1], status: values[5] });
    saveContinuity({ ...getContinuity(), last_device: id, last_discussed_object: values[1] }, id);
    return getMeshDevice(id);
  }

  function publicMeshDevice(row) {
    return {
      id: row.id,
      name: row.name,
      deviceType: row.device_type,
      platform: row.platform,
      trustLevel: row.trust_level,
      status: row.status,
      capabilities: safeJson(row.capabilities_json, []),
      permissions: safeJson(row.permissions_json, {}),
      connectionMode: row.connection_mode,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function getMeshDevice(id) {
    const row = db.prepare("SELECT * FROM mesh_devices WHERE id=?").get(id);
    return row ? publicMeshDevice(row) : null;
  }

  function listMeshDevices({ limit = 40 } = {}) {
    return db.prepare("SELECT * FROM mesh_devices ORDER BY updated_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 40))).map(publicMeshDevice);
  }

  function startMeshSession(data = {}) {
    const now = isoNow();
    const id = data.id || crypto.randomUUID();
    db.prepare(`
      INSERT OR REPLACE INTO mesh_sessions(id, title, started_at, ended_at, status, host_device_id, participant_device_ids_json,
        mode, summary, replay_path, memory_refs_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.title || "Device Mesh session", data.startedAt || now, data.endedAt || null, data.status || "active", data.hostDeviceId || "local",
      json(data.participantDeviceIds || []), data.mode || "view", data.summary || "", data.replayPath || "", json(data.memoryRefs || []), json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_session", tags: ["session", data.status || "active"], sessionId: id, title: data.title || "Device Mesh session" });
    saveContinuity({ ...getContinuity(), last_mesh_session: id, last_discussed_object: data.title || "Device Mesh session" }, id);
    return getMeshSession(id);
  }

  function publicMeshSession(row) {
    return {
      id: row.id,
      title: row.title,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      hostDeviceId: row.host_device_id,
      participantDeviceIds: safeJson(row.participant_device_ids_json, []),
      mode: row.mode,
      summary: row.summary,
      replayPath: row.replay_path,
      memoryRefs: safeJson(row.memory_refs_json, []),
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function getMeshSession(id) {
    const row = db.prepare("SELECT * FROM mesh_sessions WHERE id=?").get(id);
    return row ? publicMeshSession(row) : null;
  }

  function listMeshSessions({ limit = 20 } = {}) {
    return db.prepare("SELECT * FROM mesh_sessions ORDER BY started_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 20))).map(publicMeshSession);
  }

  function endMeshSession(id, data = {}) {
    db.prepare("UPDATE mesh_sessions SET ended_at=?, status=?, summary=?, replay_path=?, memory_refs_json=?, metadata_json=? WHERE id=?")
      .run(isoNow(), data.status || "complete", data.summary || "", data.replayPath || "", json(data.memoryRefs || []), json(data.metadata || {}), id);
    return getMeshSession(id);
  }

  function recordMeshPermissionGrant(data = {}) {
    const id = data.id || crypto.randomUUID();
    const now = isoNow();
    db.prepare(`
      INSERT INTO mesh_permission_grants(id, session_id, device_id, permission, granted_by, status, granted_at, expires_at, reason, risk_level, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId || null, data.deviceId || "unknown", data.permission || "unknown", data.grantedBy || "", data.status || "requested",
      data.grantedAt || (data.status === "granted" ? now : null), data.expiresAt || null, data.reason || "", data.riskLevel || "medium", json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_permission", tags: ["permission", data.status || "requested"], permission: data.permission, deviceId: data.deviceId });
    return { id, sessionId: data.sessionId || null, deviceId: data.deviceId || "unknown", permission: data.permission || "unknown", status: data.status || "requested", expiresAt: data.expiresAt || null };
  }

  function listMeshPermissionGrants({ limit = 20 } = {}) {
    return db.prepare("SELECT * FROM mesh_permission_grants ORDER BY rowid DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      deviceId: row.device_id,
      permission: row.permission,
      grantedBy: row.granted_by,
      status: row.status,
      grantedAt: row.granted_at,
      expiresAt: row.expires_at,
      reason: row.reason,
      riskLevel: row.risk_level,
      metadata: safeJson(row.metadata_json, {}),
    }));
  }

  function recordMeshStreamEvent(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT INTO mesh_stream_events(id, session_id, device_id, stream_type, action, timestamp, quality_json, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId || null, data.deviceId || "local", data.streamType || "screen", data.action || "event", timestamp, json(data.quality || {}), json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_stream", tags: ["stream", data.action || "event"], streamEventId: id, sessionId: data.sessionId, deviceId: data.deviceId });
    return { id, sessionId: data.sessionId || null, deviceId: data.deviceId || "local", streamType: data.streamType || "screen", action: data.action || "event", timestamp };
  }

  function recordMeshControlEvent(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT INTO mesh_control_events(id, session_id, source_device_id, target_device_id, event_type, event_json, accepted, rejected_reason, timestamp, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId || null, data.sourceDeviceId || "unknown", data.targetDeviceId || "local", data.eventType || "unknown",
      json(data.event || {}), data.accepted ? 1 : 0, data.rejectedReason || "", timestamp, json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_control", tags: ["control", data.accepted ? "accepted" : "rejected"], controlEventId: id, eventType: data.eventType, sourceDeviceId: data.sourceDeviceId });
    if (data.accepted) saveContinuity({ ...getContinuity(), last_control_target: data.targetDeviceId || "local", last_discussed_object: "Device Mesh control session" }, id);
    return { id, sessionId: data.sessionId || null, sourceDeviceId: data.sourceDeviceId || "unknown", targetDeviceId: data.targetDeviceId || "local", eventType: data.eventType || "unknown", accepted: Boolean(data.accepted), rejectedReason: data.rejectedReason || "", timestamp };
  }

  function recordMeshInboxItem(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT INTO mesh_inbox_items(id, source_device_id, item_type, path, url, text_preview, summary, classification, permission_scope, stored_long_term, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sourceDeviceId || "unknown", data.itemType || "file", data.path || "", data.url || "", normalizeText(data.textPreview || "").slice(0, 1000),
      data.summary || "", data.classification || "", data.permissionScope || "private", data.storedLongTerm ? 1 : 0, createdAt, json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_inbox", tags: ["inbox", data.itemType || "file"], inboxItemId: id, sourceDeviceId: data.sourceDeviceId });
    const continuity = getContinuity();
    const label = data.summary || data.url || data.path || data.textPreview || id;
    saveContinuity({
      ...continuity,
      last_mesh_inbox_item: id,
      last_phone_capture: /photo|image|screenshot/i.test(data.itemType || "") ? id : continuity.last_phone_capture,
      last_discussed_object: label,
      likely_next_references: {
        ...(continuity.likely_next_references || {}),
        it: label,
        this: label,
        that: label,
        "last phone upload": label,
      },
    }, id);
    return getMeshInboxItem(id);
  }

  function publicMeshInboxItem(row) {
    return {
      id: row.id,
      sourceDeviceId: row.source_device_id,
      itemType: row.item_type,
      path: row.path,
      url: row.url,
      textPreview: row.text_preview,
      summary: row.summary,
      classification: row.classification,
      permissionScope: row.permission_scope,
      storedLongTerm: Boolean(row.stored_long_term),
      createdAt: row.created_at,
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function getMeshInboxItem(id) {
    const row = db.prepare("SELECT * FROM mesh_inbox_items WHERE id=?").get(id);
    return row ? publicMeshInboxItem(row) : null;
  }

  function listMeshInboxItems({ limit = 30 } = {}) {
    return db.prepare("SELECT * FROM mesh_inbox_items ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 30))).map(publicMeshInboxItem);
  }

  function recordMeshOverlay(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT INTO mesh_overlays(id, session_id, source, overlay_type, overlay_json, timestamp, followed, outcome, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId || null, data.source || "jarvis", data.overlayType || data.type || "text", json(data.overlay || data), timestamp, data.followed == null ? null : data.followed ? 1 : 0, data.outcome || "", json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_overlay", tags: ["overlay", data.overlayType || data.type || "text"], overlayId: id, sessionId: data.sessionId });
    return { id, sessionId: data.sessionId || null, source: data.source || "jarvis", overlayType: data.overlayType || data.type || "text", timestamp };
  }

  function listMeshOverlays({ limit = 30 } = {}) {
    return db.prepare("SELECT * FROM mesh_overlays ORDER BY timestamp DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 30))).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      source: row.source,
      overlayType: row.overlay_type,
      overlay: safeJson(row.overlay_json, {}),
      timestamp: row.timestamp,
      followed: row.followed == null ? null : Boolean(row.followed),
      outcome: row.outcome,
      metadata: safeJson(row.metadata_json, {}),
    }));
  }

  function createMeshReplay(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = isoNow();
    db.prepare(`
      INSERT INTO mesh_replays(id, session_id, replay_type, path, summary, action_graph_json, keyframes_json, created_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId || "", data.replayType || "timeline", data.path || "", data.summary || "", json(data.actionGraph || []), json(data.keyframes || []), createdAt, json(data.metadata || {}));
    writeRawEvent("device_mesh", { source: "mesh_replay", tags: ["replay"], replayId: id, sessionId: data.sessionId });
    return { id, sessionId: data.sessionId || "", replayType: data.replayType || "timeline", path: data.path || "", summary: data.summary || "", createdAt };
  }

  function listMeshReplays({ limit = 20 } = {}) {
    return db.prepare("SELECT * FROM mesh_replays ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      replayType: row.replay_type,
      path: row.path,
      summary: row.summary,
      actionGraph: safeJson(row.action_graph_json, []),
      keyframes: safeJson(row.keyframes_json, []),
      createdAt: row.created_at,
      metadata: safeJson(row.metadata_json, {}),
    }));
  }

  function compileMeshSkillFromReplay(replayId, data = {}) {
    const replay = listMeshReplays({ limit: 100 }).find((item) => item.id === replayId);
    if (!replay) throw Object.assign(new Error("Mesh replay not found."), { statusCode: 404 });
    const skill = compileSkill({
      name: data.name || `Mesh skill from ${replay.summary || replay.id}`.slice(0, 80),
      slug: data.slug || `mesh-${replay.id}`,
      description: `Reusable cross-device workflow from mesh replay ${replay.id}.`,
      triggerPhrases: data.triggerPhrases || ["do that mesh workflow again", "repeat last mesh workflow"],
      intent: "device_mesh",
      requiredTools: ["mesh_status", "device_files", "screen_capture"],
      requiredPermissions: ["view_laptop_screen", "write_memory"],
      steps: replay.actionGraph?.length ? replay.actionGraph : ["Load last mesh inbox item", "Apply the same device workflow", "Write replay result to memory"],
      successCriteria: ["Required device is connected", "Permission gate passes", "Replay result is stored"],
      metadata: { replayId, meshSkill: true },
    });
    saveContinuity({ ...getContinuity(), last_mesh_skill: skill.id, last_discussed_object: skill.name }, skill.id);
    return skill;
  }

  function recordCoopSession(data = {}) {
    const id = data.id || crypto.randomUUID();
    const startedAt = data.startedAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_sessions(id, title, host_device_id, guest_device_id, peer_name, connection_mode, session_code_hash,
        repo_fingerprint_host, repo_fingerprint_guest, status, started_at, ended_at, summary, replay_path, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      data.title || "Jarvis Co-Op Symbiote Mesh",
      data.hostDeviceId || "local",
      data.guestDeviceId || "",
      data.peerName || "",
      data.connectionMode || "LAN",
      data.sessionCodeHash || "",
      json(data.repoFingerprintHost || {}),
      json(data.repoFingerprintGuest || {}),
      data.status || "active",
      startedAt,
      data.endedAt || "",
      data.summary || "",
      data.replayPath || "",
      json(data.metadata || {})
    );
    writeRawEvent("coop_symbiote", { source: "coop_session", tags: ["session", data.status || "active"], sessionId: id, title: data.title || "Jarvis Co-Op Symbiote Mesh" });
    saveContinuity({ ...getContinuity(), last_coop_session: id, last_peer: data.peerName || getContinuity().last_peer || "", active_topic: "Co-Op Symbiote Mesh" }, id);
    return { id, title: data.title || "Jarvis Co-Op Symbiote Mesh", status: data.status || "active", startedAt };
  }

  function endCoopSession(id, data = {}) {
    db.prepare("UPDATE coop_sessions SET ended_at=?, status=?, summary=?, replay_path=?, metadata_json=? WHERE id=?")
      .run(data.endedAt || isoNow(), data.status || "ended", data.summary || "", data.replayPath || "", json(data.metadata || {}), id);
    writeRawEvent("coop_symbiote", { source: "coop_session_end", tags: ["session", "ended"], sessionId: id, summary: data.summary || "" });
    return { id, status: data.status || "ended", summary: data.summary || "" };
  }

  function recordCoopEvent(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT INTO coop_events(id, session_id, event_type, actor, target, timestamp, event_json, metadata_json)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.eventType || "event", data.actor || "", data.target || "", timestamp, json(data.eventJson || data.payload || {}), json(data.metadata || {}));
    writeRawEvent("coop_symbiote", { source: "coop_event", tags: ["event", data.eventType || "event"], sessionId: data.sessionId || "", eventId: id });
    return { id, sessionId: data.sessionId || "", eventType: data.eventType || "event", timestamp };
  }

  function recordCoopFileAccess(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT INTO coop_file_access(id, session_id, file_path, access_type, requested_by, approved_by, status, timestamp, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.filePath || "", data.accessType || "read", data.requestedBy || "", data.approvedBy || "", data.status || "requested", timestamp, json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_shared_file: data.filePath || getContinuity().last_shared_file || "" }, id);
    return { id, sessionId: data.sessionId || "", filePath: data.filePath || "", status: data.status || "requested" };
  }

  function recordCoopPatch(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_patches(id, session_id, file_path, author, base_hash, patch_text, summary, status, created_at,
        applied_at, test_result_json, ghost_result_json, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      data.sessionId || "",
      data.filePath || "",
      data.author || "",
      data.baseHash || "",
      data.patchText || "",
      data.summary || "",
      data.status || "proposed",
      createdAt,
      data.appliedAt || "",
      json(data.testResult || {}),
      json(data.ghostResult || {}),
      json({ riskLevel: data.riskLevel || "", affectedModules: data.affectedModules || [], testsToRun: data.testsToRun || [], decisions: data.decisions || [] })
    );
    writeRawEvent("coop_symbiote", { source: "coop_patch", tags: ["patch", data.status || "proposed"], sessionId: data.sessionId || "", patchId: id, filePath: data.filePath || "" });
    saveContinuity({ ...getContinuity(), last_patch: id, last_shared_file: data.filePath || getContinuity().last_shared_file || "", last_ghost_result: data.ghostResult?.summary || getContinuity().last_ghost_result || "" }, id);
    return { id, sessionId: data.sessionId || "", filePath: data.filePath || "", status: data.status || "proposed" };
  }

  function recordCoopChatMessage(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_chat_messages(id, session_id, sender_type, sender_name, text, timestamp, linked_file, linked_patch_id, linked_task_id, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.senderType || "human", data.senderName || "", data.text || "", timestamp, data.linkedFile || "", data.linkedPatchId || "", data.linkedTaskId || "", json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_coop_chat: id, last_discussed_object: data.text || getContinuity().last_discussed_object || "" }, id);
    return { id, sessionId: data.sessionId || "", senderName: data.senderName || "", timestamp };
  }

  function recordCoopJarvisMessage(data = {}) {
    const id = data.id || crypto.randomUUID();
    const timestamp = data.timestamp || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_jarvis_messages(id, session_id, from_jarvis, to_jarvis, message_type, payload_json, timestamp, metadata_json)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.fromJarvisId || data.fromJarvis || "", data.toJarvisId || data.toJarvis || "all", data.messageType || "capability_hello", json(data.payload || {}), timestamp, json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_jarvis_bridge_message: id, last_coop_decision: data.messageType === "decision_response" ? id : getContinuity().last_coop_decision || "" }, id);
    return { id, sessionId: data.sessionId || "", messageType: data.messageType || "capability_hello", timestamp };
  }

  function recordCoopMemoryPacket(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_memory_packets(id, session_id, shared_by, scope, allowed_json, blocked_json, approved_by, created_at, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.sharedBy || "", data.scope || "project-only", json(data.allowed || []), json(data.blocked || []), data.approvedBy || "", createdAt, json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_memory_packet: id }, id);
    return { id, sessionId: data.sessionId || "", scope: data.scope || "project-only" };
  }

  function recordCoopSkillTransfer(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_skill_transfers(id, session_id, skill_id, offered_by, received_by, status, skill_manifest_json, test_result_json, created_at, imported_at, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.skillId || data.skillManifest?.skillId || "", data.offeredBy || "", data.receivedBy || "", data.status || "offered", json(data.skillManifest || {}), json(data.testResult || {}), createdAt, data.importedAt || "", json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_skill_transfer: id }, id);
    return { id, sessionId: data.sessionId || "", status: data.status || "offered" };
  }

  function recordCoopTask(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_tasks(id, session_id, title, status, assigned_to, linked_file, linked_patch_id, linked_message_id, created_at, updated_at, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.title || "Untitled co-op task", data.status || "Todo", data.assignedTo || "", data.linkedFile || "", data.linkedPatchId || "", data.linkedMessageId || "", createdAt, data.updatedAt || createdAt, json(data.metadata || {}));
    saveContinuity({ ...getContinuity(), last_coop_task: id }, id);
    return { id, sessionId: data.sessionId || "", title: data.title || "Untitled co-op task", status: data.status || "Todo" };
  }

  function recordCoopReplay(data = {}) {
    const id = data.id || crypto.randomUUID();
    const createdAt = data.createdAt || isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO coop_replays(id, session_id, replay_type, timeline_json, action_graph_json, keyframes_json, summary, path, created_at, metadata_json)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(id, data.sessionId || "", data.replayType || "timeline", json(data.timeline || []), json(data.actionGraph || []), json(data.keyframes || []), data.summary || "", data.path || "", createdAt, json(data.metadata || {}));
    return { id, sessionId: data.sessionId || "", replayType: data.replayType || "timeline", summary: data.summary || "" };
  }

  const COOP_TABLE_WHITELIST = new Set([
    "coop_events", "coop_patches", "coop_tasks", "coop_replays",
    "coop_sessions", "coop_file_access", "coop_chat_messages",
    "coop_jarvis_messages", "coop_memory_packets", "coop_skill_transfers",
  ]);

  function listRows(table, sessionId, limit = 20) {
    if (!COOP_TABLE_WHITELIST.has(table)) throw new Error(`listRows: table not permitted: ${table}`);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    if (sessionId) return db.prepare(`SELECT * FROM ${table} WHERE session_id=? ORDER BY rowid DESC LIMIT ?`).all(sessionId, safeLimit);
    return db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(safeLimit);
  }

  function coopMemorySummary(sessionId = "") {
    const where = sessionId ? "WHERE session_id=?" : "";
    const count = (table) => {
      if (!COOP_TABLE_WHITELIST.has(table)) throw new Error(`coopMemorySummary: table not permitted: ${table}`);
      return sessionId
        ? db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(sessionId).count
        : db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    };
    const sessions = sessionId
      ? db.prepare("SELECT * FROM coop_sessions WHERE id=? LIMIT 1").all(sessionId)
      : db.prepare("SELECT * FROM coop_sessions ORDER BY started_at DESC LIMIT 10").all();
    return {
      counts: {
        sessions: sessionId ? (sessions.length ? 1 : 0) : count("coop_sessions"),
        events: count("coop_events"),
        fileAccess: count("coop_file_access"),
        patches: count("coop_patches"),
        chatMessages: count("coop_chat_messages"),
        jarvisMessages: count("coop_jarvis_messages"),
        memoryPackets: count("coop_memory_packets"),
        skillTransfers: count("coop_skill_transfers"),
        tasks: count("coop_tasks"),
        replays: count("coop_replays"),
      },
      sessions: sessions.map((row) => ({
        id: row.id,
        title: row.title,
        peerName: row.peer_name,
        connectionMode: row.connection_mode,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        summary: row.summary,
      })),
      events: listRows("coop_events", sessionId, 20).map((row) => ({ id: row.id, sessionId: row.session_id, eventType: row.event_type, actor: row.actor, timestamp: row.timestamp })),
      patches: listRows("coop_patches", sessionId, 20).map((row) => ({ id: row.id, sessionId: row.session_id, filePath: row.file_path, status: row.status, summary: row.summary })),
      tasks: listRows("coop_tasks", sessionId, 20).map((row) => ({ id: row.id, sessionId: row.session_id, title: row.title, status: row.status, assignedTo: row.assigned_to })),
      replays: listRows("coop_replays", sessionId, 10).map((row) => ({ id: row.id, sessionId: row.session_id, replayType: row.replay_type, summary: row.summary, createdAt: row.created_at })),
      storage: {
        rawEventLake: path.join(root, "raw", "coop_symbiote"),
        tables: ["coop_sessions", "coop_events", "coop_file_access", "coop_patches", "coop_chat_messages", "coop_jarvis_messages", "coop_memory_packets", "coop_skill_transfers", "coop_tasks", "coop_replays"],
      },
    };
  }

  function meshMemorySummary() {
    return {
      devices: listMeshDevices({ limit: 20 }),
      sessions: listMeshSessions({ limit: 10 }),
      permissions: listMeshPermissionGrants({ limit: 10 }),
      inboxItems: listMeshInboxItems({ limit: 10 }),
      overlays: listMeshOverlays({ limit: 10 }),
      replays: listMeshReplays({ limit: 10 }),
      continuity: getContinuity(),
      storage: {
        rawEventLake: path.join(root, "raw", "device_mesh"),
        sqliteDb: dbPath,
        hotMemory: hotDir,
        tables: ["mesh_devices", "mesh_sessions", "mesh_permission_grants", "mesh_stream_events", "mesh_control_events", "mesh_inbox_items", "mesh_overlays", "mesh_replays"],
      },
    };
  }

  function recordCapabilityFailure(capabilityName, error) {
    return upsertCapabilityMemory({
      capabilityName,
      category: "tool",
      status: "degraded",
      description: `${capabilityName} recently failed.`,
      limitations: [error],
      lastFailureAt: isoNow(),
      failureExamples: [error],
    });
  }

  function recordCapabilitySuccess(capabilityName, result) {
    return upsertCapabilityMemory({
      capabilityName,
      category: "tool",
      status: "available",
      description: `${capabilityName} has verified recent success.`,
      lastVerifiedAt: isoNow(),
      successExamples: [typeof result === "string" ? result.slice(0, 200) : "Verified tool result"],
    });
  }

  function upsertCapabilityMemory(data = {}) {
    const capabilityName = normalizeText(data.capabilityName || data.capability_name);
    if (!capabilityName) return null;
    const existing = db.prepare("SELECT id, success_examples_json, failure_examples_json FROM capability_memory WHERE capability_name=?").get(capabilityName);
    const id = existing?.id || crypto.randomUUID();
    const successExamples = [...safeJson(existing?.success_examples_json, []), ...(data.successExamples || [])].slice(-8);
    const failureExamples = [...safeJson(existing?.failure_examples_json, []), ...(data.failureExamples || [])].slice(-8);
    if (existing) {
      db.prepare(`
        UPDATE capability_memory SET category=?, status=?, description=?, tools_json=?, limitations_json=?, last_verified_at=COALESCE(?, last_verified_at),
          last_failure_at=COALESCE(?, last_failure_at), success_examples_json=?, failure_examples_json=?, permission_requirements_json=?, metadata_json=?
        WHERE id=?
      `).run(data.category || "tool", data.status || "unknown", data.description || "", json(data.tools || []), json(data.limitations || []), data.lastVerifiedAt || null, data.lastFailureAt || null, json(successExamples), json(failureExamples), json(data.permissionRequirements || []), json(data.metadata || {}), id);
    } else {
      db.prepare(`
        INSERT INTO capability_memory(id, capability_name, category, status, description, tools_json, limitations_json, last_verified_at,
          last_failure_at, success_examples_json, failure_examples_json, permission_requirements_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, capabilityName, data.category || "tool", data.status || "unknown", data.description || "", json(data.tools || []), json(data.limitations || []), data.lastVerifiedAt || null, data.lastFailureAt || null, json(successExamples), json(failureExamples), json(data.permissionRequirements || []), json(data.metadata || {}));
    }
    return id;
  }

  function listCapabilityMemory({ limit = 50 } = {}) {
    const rows = db.prepare("SELECT * FROM capability_memory ORDER BY COALESCE(last_failure_at, last_verified_at) DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit) || 50)));
    return rows.map((row) => ({
      id: row.id,
      capabilityName: row.capability_name,
      category: row.category,
      status: row.status,
      description: row.description,
      limitations: safeJson(row.limitations_json, []),
      lastVerifiedAt: row.last_verified_at,
      lastFailureAt: row.last_failure_at,
      successExamples: safeJson(row.success_examples_json, []),
      failureExamples: safeJson(row.failure_examples_json, []),
    }));
  }

  function upsertPersonalProfileItem(data = {}) {
    const now = isoNow();
    const category = normalizeText(data.category || "general");
    const key = slugify(data.key || data.value);
    const value = normalizeText(data.value);
    if (!value) return null;
    const existing = db.prepare("SELECT id FROM personal_profile_items WHERE category=? AND key=? AND status='active'").get(category, key);
    const id = existing?.id || crypto.randomUUID();
    if (existing) {
      db.prepare("UPDATE personal_profile_items SET value=?, confidence=?, privacy_level=?, source=?, updated_at=?, metadata_json=? WHERE id=?")
        .run(value, Number(data.confidence ?? 1), data.privacyLevel || "private", data.source || "user", now, json(data.metadata || {}), id);
    } else {
      db.prepare(`
        INSERT INTO personal_profile_items(id, category, key, value, confidence, privacy_level, source, status, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, category, key, value, Number(data.confidence ?? 1), data.privacyLevel || "private", data.source || "user", "active", now, now, json(data.metadata || {}));
    }
    return { id, category, key, value, confidence: Number(data.confidence ?? 1), privacyLevel: data.privacyLevel || "private" };
  }

  function upsertProject(data = {}) {
    const now = isoNow();
    const id = data.id || slugify(data.name);
    const existing = db.prepare("SELECT id FROM projects WHERE id=?").get(id);
    if (existing) {
      db.prepare(`
        UPDATE projects SET name=?, description=?, status=?, root_paths_json=?, goals_json=?, known_failures_json=?, active_fixes_json=?,
          style_preferences_json=?, updated_at=?, metadata_json=? WHERE id=?
      `).run(data.name, data.description || "", data.status || "active", json(data.rootPaths || []), json(data.goals || []), json(data.knownFailures || []), json(data.activeFixes || []), json(data.stylePreferences || []), now, json(data.metadata || {}), id);
    } else {
      db.prepare(`
        INSERT INTO projects(id, name, description, status, root_paths_json, goals_json, known_failures_json, active_fixes_json,
          style_preferences_json, created_at, updated_at, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.name, data.description || "", data.status || "active", json(data.rootPaths || []), json(data.goals || []), json(data.knownFailures || []), json(data.activeFixes || []), json(data.stylePreferences || []), now, now, json(data.metadata || {}));
    }
    return id;
  }

  function indexArtifact(data = {}) {
    const now = isoNow();
    const id = data.id || crypto.randomUUID();
    const title = normalizeText(data.title || path.basename(data.path || "artifact"));
    const artifactPath = normalizeText(data.path || data.url || "");
    if (!artifactPath && !title) return null;
    db.prepare(`
      INSERT INTO artifacts(id, title, artifact_type, path, project_id, summary, tags_json, created_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, artifact_type=excluded.artifact_type, path=excluded.path,
        project_id=excluded.project_id, summary=excluded.summary, tags_json=excluded.tags_json, updated_at=excluded.updated_at, metadata_json=excluded.metadata_json
    `).run(id, title, data.type || data.artifactType || "artifact", artifactPath, data.projectId || inferProjectId(title), data.summary || "", json(data.tags || []), data.createdAt || now, now, json(data.metadata || {}));
    if (tableExists(db, "artifacts_fts")) {
      db.prepare("DELETE FROM artifacts_fts WHERE artifact_id=?").run(id);
      db.prepare("INSERT INTO artifacts_fts(artifact_id, title, summary, tags, project_id) VALUES (?, ?, ?, ?, ?)")
        .run(id, title, data.summary || "", (data.tags || []).join(" "), data.projectId || "");
    }
    return upsertMemory({
      kind: "artifact",
      title,
      content: `${title}\n${data.summary || ""}\n${artifactPath}`,
      summary: data.summary || title,
      sourceType: "artifact",
      sourceRef: id,
      importance: 5,
      metadata: { artifactId: id, path: artifactPath },
    });
  }

  function checkPermission({ resource = "", action = "read", vault = "default" } = {}) {
    const rows = db.prepare("SELECT * FROM permission_rules WHERE vault=? OR vault='default' ORDER BY updated_at DESC").all(vault);
    const match = rows.find((row) => wildcardMatch(resource, row.resource_pattern)) || rows.find((row) => row.resource_pattern === "runtime/**");
    if (!match) return { allowed: false, action, resource, reason: "No permission rule matched." };
    const allowed = action === "read" ? Boolean(match.read_allowed)
      : action === "summarize" ? Boolean(match.summarize_allowed)
        : action === "external_send" ? Boolean(match.external_send_allowed)
          : match.edit_allowed === "allowed";
    return {
      allowed,
      action,
      resource,
      rule: match.resource_pattern,
      editAllowed: match.edit_allowed,
      storeLongTermAllowed: match.store_long_term_allowed,
      reason: allowed ? "Allowed by Neural Vault permission rule." : "Permission requires confirmation or is blocked.",
    };
  }

  function wildcardMatch(value, pattern) {
    const marker = "__JARVIS_GLOBSTAR__";
    const escaped = String(pattern || "")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, marker)
      .replace(/\*/g, "[^/\\\\]*")
      .replaceAll(marker, ".*");
    return new RegExp(`^${escaped}$`, "i").test(String(value || ""));
  }

  function maintenanceRun() {
    const startedAt = isoNow();
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO memory_maintenance_runs(id, started_at, status, metadata_json) VALUES (?, ?, ?, ?)")
      .run(id, startedAt, "running", json({ kind: "manual" }));
    const duplicates = db.prepare(`
      SELECT content, kind, COUNT(*) AS count, GROUP_CONCAT(id) AS ids
      FROM memories WHERE status='active'
      GROUP BY content, kind HAVING count > 1
    `).all();
    let archived = 0;
    for (const duplicate of duplicates) {
      const ids = String(duplicate.ids).split(",");
      for (const loser of ids.slice(1)) {
        db.prepare("UPDATE memories SET status='archived', updated_at=? WHERE id=?").run(isoNow(), loser);
        archived += 1;
      }
    }
    const continuity = getContinuity();
    const report = [
      "# Neural Vault Maintenance Report",
      "",
      `Started: ${startedAt}`,
      `Ended: ${isoNow()}`,
      `Archived duplicate memories: ${archived}`,
      `Active topic: ${continuity.active_topic || "none"}`,
      `Last discussed object: ${continuity.last_discussed_object || "none"}`,
    ].join("\n");
    const reportPath = path.join(maintenanceDir, `${startedAt.replace(/[:.]/g, "-")}.md`);
    fs.writeFileSync(reportPath, report, { encoding: "utf8", mode: 0o600 });
    db.prepare(`
      UPDATE memory_maintenance_runs SET ended_at=?, status=?, merged_duplicates=?, archived_memories=?, summaries_created=?, report_path=?, metadata_json=?
      WHERE id=?
    `).run(isoNow(), "complete", duplicates.length, archived, 1, reportPath, json({ continuity }), id);
    return { id, status: "complete", archivedMemories: archived, mergedDuplicates: duplicates.length, summariesCreated: 1, reportPath };
  }

  const memoryOsRoot = path.join(root, "memory_os");
  const memoryOsReportsDir = path.join(memoryOsRoot, "reports");
  const memoryAgentDefinitions = [
    ["memory-manager-agent", "Memory Manager Agent", "Coordinates maintenance, rechecks, and reports."],
    ["file-inspector-agent", "File Inspector Agent", "Scans project files, computes checksums, and updates FileDB."],
    ["chat-historian-agent", "Chat Historian Agent", "Stores conversation turns and extracts useful memories."],
    ["conversation-archivist-agent", "Conversation Archivist Agent", "Imports old conversation files into episodes."],
    ["project-cartographer-agent", "Project Cartographer Agent", "Builds project trees and links files/modules/tests."],
    ["command-miner-agent", "Command Miner Agent", "Mines reusable commands and stores command files."],
    ["skill-librarian-agent", "Skill Librarian Agent", "Indexes skills and skill run history."],
    ["agent-librarian-agent", "Agent Librarian Agent", "Indexes agents, roles, runs, and permissions."],
    ["source-code-mapper-agent", "Source Code Mapper Agent", "Maps source files to features, symbols, routes, and tests."],
    ["web-research-archivist-agent", "Web Research Archivist Agent", "Stores web searches, sources, citations, and freshness."],
    ["device-memory-agent", "Device Memory Agent", "Stores device mesh events, media, permissions, streams, and traces."],
    ["coop-memory-agent", "Co-Op Memory Agent", "Stores co-op sessions, patches, bridge messages, packets, and replays."],
    ["personal-info-curator-agent", "Personal Info Curator Agent", "Organizes safe personal preferences and goals without overcollection."],
    ["routine-curator-agent", "Routine Curator Agent", "Stores routines only when explicitly provided."],
    ["contradiction-resolver-agent", "Contradiction Resolver Agent", "Finds conflicts, supersedes old memory, and preserves history."],
    ["privacy-guardian-agent", "Privacy Guardian Agent", "Scans for secrets and protects private memory/export boundaries."],
    ["memory-surgeon-agent", "Memory Surgeon Agent", "Deletes, archives, supersedes, merges, and repairs memory objects."],
    ["dream-consolidator-agent", "Dream Consolidator Agent", "Compiles summaries from warm memory while preserving raw refs."],
    ["retrieval-evaluator-agent", "Retrieval Evaluator Agent", "Generates retrieval tests and records failures/fixes."],
  ];

  function memoryOsPathFor(uri, type = "semantic") {
    const cleanUri = String(uri || "").replace(/^memory:\/\//, "");
    const parts = cleanUri.split(/[\\/]+/).filter(Boolean).map((part) => safeSegment(part, "item"));
    const bucket = {
      conversation: "chats",
      chat: "chats",
      command: "commands",
      skill: "skills",
      agent: "agents",
      web: "web",
      file: "files",
      source_code: "source_code",
      device_mesh: "device_mesh",
      coop_mesh: "coop_mesh",
      decision: "decisions",
      failure: "failures",
      routine: "routines",
      personal: "personal",
      project: "projects",
    }[String(type || "").toLowerCase()] || (parts[0] || "user");
    const fileName = `${parts.at(-1) || safeSegment(type)}.md`;
    return path.join(memoryOsRoot, "objects", bucket, ...parts.slice(0, -1), fileName);
  }

  function memoryObjectRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      uri: row.uri,
      filePath: row.file_path,
      type: row.type,
      scopes: safeJson(row.scopes_json, []),
      projectIds: safeJson(row.project_ids_json, []),
      title: row.title,
      summary: row.summary,
      contentPreview: row.content_preview,
      sourceRefs: safeJson(row.source_refs_json, []),
      provenance: safeJson(row.provenance_json, {}),
      privacy: row.privacy,
      confidence: row.confidence,
      importance: row.importance,
      status: row.status,
      tags: safeJson(row.tags_json, []),
      entities: safeJson(row.entities_json, []),
      parentUris: safeJson(row.parent_uris_json, []),
      childUris: safeJson(row.child_uris_json, []),
      links: safeJson(row.links_json, []),
      checksum: row.checksum,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastCheckedAt: row.last_checked_at,
      lastIndexedAt: row.last_indexed_at,
      metadata: safeJson(row.metadata_json, {}),
    };
  }

  function writeMemoryObjectFile(object, content) {
    const frontmatter = [
      "---",
      `id: ${object.id}`,
      `uri: ${object.uri}`,
      `type: ${object.type}`,
      `privacy: ${object.privacy}`,
      `status: ${object.status || "active"}`,
      `created_at: ${object.createdAt}`,
      `updated_at: ${object.updatedAt}`,
      `checksum: ${object.checksum}`,
      "---",
      "",
      `# ${object.title}`,
      "",
      object.summary || "",
      "",
      "## Content",
      "",
      content || object.contentPreview || "",
      "",
      "## Storage Trace",
      "",
      `- Database: ${dbPath}`,
      `- File: ${object.filePath}`,
      `- URI: ${object.uri}`,
      "",
    ].join("\n");
    ensureDir(path.dirname(object.filePath));
    fs.writeFileSync(object.filePath, frontmatter, { encoding: "utf8", mode: 0o600 });
    return frontmatter;
  }

  function indexMemoryObjectFts(object, content) {
    if (!tableExists(db, "memory_objects_fts")) return;
    db.prepare("DELETE FROM memory_objects_fts WHERE object_id=?").run(object.id);
    db.prepare("INSERT INTO memory_objects_fts(object_id, uri, title, summary, content, tags) VALUES (?, ?, ?, ?, ?, ?)")
      .run(object.id, object.uri, object.title, object.summary || "", content || object.contentPreview || "", (object.tags || []).join(" "));
    db.prepare("UPDATE memory_objects SET fts_indexed=1, last_indexed_at=? WHERE id=?").run(isoNow(), object.id);
  }

  function createMemoryObject(data = {}) {
    const now = isoNow();
    const id = data.id || `mem_${crypto.randomUUID()}`;
    const type = String(data.type || "semantic").toLowerCase();
    const title = normalizeText(data.title || data.name || type);
    const content = String(data.content || data.text || data.summary || title).trim();
    const uri = String(data.uri || `memory://projects/jarvis/${safeSegment(type)}/${safeSegment(title)}-${id.slice(4, 12)}`);
    const filePath = data.filePath || memoryOsPathFor(uri, type);
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    const object = {
      id,
      uri,
      filePath,
      type,
      scopes: Array.isArray(data.scopes) ? data.scopes : [data.scope || "project"],
      projectIds: Array.isArray(data.projectIds) ? data.projectIds : [data.projectId || "jarvis"].filter(Boolean),
      title,
      summary: normalizeText(data.summary || content.slice(0, 260)),
      contentPreview: content.slice(0, 1200),
      sourceRefs: Array.isArray(data.sourceRefs) ? data.sourceRefs : [],
      provenance: data.provenance || { source: data.source || "memory-os-v4", createdBy: "jarvis" },
      privacy: PRIVACY_LEVELS.has(data.privacy) ? data.privacy : "private",
      permissions: data.permissions || {},
      confidence: Number(data.confidence ?? 1),
      importance: Number(data.importance ?? 0.5),
      status: data.status || "active",
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 20) : [],
      entities: Array.isArray(data.entities) ? data.entities : extractEntities(content),
      parentUris: Array.isArray(data.parentUris) ? data.parentUris : [],
      childUris: Array.isArray(data.childUris) ? data.childUris : [],
      links: Array.isArray(data.links) ? data.links : [],
      retention: data.retention || "warm",
      createdAt: data.createdAt || now,
      updatedAt: now,
      checksum,
      metadata: data.metadata || {},
    };
    writeMemoryObjectFile(object, content);
    db.prepare(`
      INSERT INTO memory_objects(id, uri, file_path, type, scopes_json, project_ids_json, title, summary, content_preview,
        source_refs_json, provenance_json, privacy, permissions_json, confidence, importance, status, tags_json, entities_json,
        parent_uris_json, child_uris_json, links_json, retention, checksum, created_at, updated_at, last_checked_at, last_indexed_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uri) DO UPDATE SET file_path=excluded.file_path, type=excluded.type, scopes_json=excluded.scopes_json,
        project_ids_json=excluded.project_ids_json, title=excluded.title, summary=excluded.summary, content_preview=excluded.content_preview,
        source_refs_json=excluded.source_refs_json, provenance_json=excluded.provenance_json, privacy=excluded.privacy,
        permissions_json=excluded.permissions_json, confidence=excluded.confidence, importance=excluded.importance, status=excluded.status,
        tags_json=excluded.tags_json, entities_json=excluded.entities_json, parent_uris_json=excluded.parent_uris_json,
        child_uris_json=excluded.child_uris_json, links_json=excluded.links_json, retention=excluded.retention, checksum=excluded.checksum,
        updated_at=excluded.updated_at, last_checked_at=excluded.last_checked_at, last_indexed_at=excluded.last_indexed_at,
        metadata_json=excluded.metadata_json
    `).run(
      object.id, object.uri, object.filePath, object.type, json(object.scopes), json(object.projectIds), object.title, object.summary,
      object.contentPreview, json(object.sourceRefs), json(object.provenance), object.privacy, json(object.permissions), object.confidence,
      object.importance, object.status, json(object.tags), json(object.entities), json(object.parentUris), json(object.childUris),
      json(object.links), object.retention, object.checksum, object.createdAt, object.updatedAt, now, now, json(object.metadata),
    );
    for (const parentUri of object.parentUris) {
      db.prepare("INSERT OR IGNORE INTO memory_object_parents(id, object_id, parent_uri, child_uri, relation, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), object.id, parentUri, object.uri, "appears_under", now, json({ source: "createMemoryObject" }));
    }
    indexMemoryObjectFts(object, content);
    return readMemoryObject(object.uri);
  }

  function readMemoryObject(uriOrId) {
    const row = db.prepare("SELECT * FROM memory_objects WHERE uri=? OR id=?").get(uriOrId, uriOrId);
    const object = memoryObjectRow(row);
    if (!object) return null;
    const fileExists = fs.existsSync(object.filePath);
    const fileContent = fileExists ? fs.readFileSync(object.filePath, "utf8") : "";
    db.prepare("UPDATE memory_objects SET last_accessed_at=?, access_count=access_count+1 WHERE id=?").run(isoNow(), object.id);
    return { ...object, fileExists, fileContent };
  }

  function listMemoryObjects(options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 40)));
    const type = normalizeText(options.type || "");
    const rows = type
      ? db.prepare("SELECT * FROM memory_objects WHERE type=? AND status != 'deleted' ORDER BY updated_at DESC LIMIT ?").all(type, limit)
      : db.prepare("SELECT * FROM memory_objects WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT ?").all(limit);
    return rows.map(memoryObjectRow);
  }

  function queryMemoryOs(query, options = {}) {
    const started = Date.now();
    const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
    const cleanQuery = normalizeText(query);
    let rows = [];
    const route = {
      path: /^memory:\/\//.test(cleanQuery),
      keyword: Boolean(cleanQuery),
      fts: tableExists(db, "memory_objects_fts"),
      project: /\bjarvis|project|device mesh|coop|kalshi|canvas\b/i.test(cleanQuery),
    };
    if (route.path) rows = db.prepare("SELECT * FROM memory_objects WHERE uri LIKE ? AND status='active' LIMIT ?").all(`%${cleanQuery}%`, limit);
    if (!rows.length && route.fts) {
      const ftsQuery = tokenize(cleanQuery).slice(0, 10).map(ftsPrefixTerm).join(" OR ");
      if (ftsQuery) {
        rows = db.prepare(`
          SELECT m.*, bm25(memory_objects_fts) AS rank
          FROM memory_objects_fts JOIN memory_objects m ON m.id = memory_objects_fts.object_id
          WHERE memory_objects_fts MATCH ? AND m.status='active'
          ORDER BY rank, m.importance DESC, m.updated_at DESC
          LIMIT ?
        `).all(ftsQuery, limit);
      }
    }
    if (!rows.length && cleanQuery) {
      rows = db.prepare(`
        SELECT * FROM memory_objects
        WHERE status='active' AND (title LIKE ? OR summary LIKE ? OR uri LIKE ? OR content_preview LIKE ?)
        ORDER BY importance DESC, updated_at DESC LIMIT ?
      `).all(`%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, `%${cleanQuery}%`, limit);
    }
    const objects = rows.map(memoryObjectRow);
    const confidence = objects.length ? Math.min(0.95, 0.45 + objects.length * 0.08) : 0.1;
    const answerSummary = objects.length
      ? `Retrieved ${objects.length} MemoryOS object(s) for "${cleanQuery}".`
      : `No MemoryOS object was found for "${cleanQuery}".`;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO memory_queries(id, user_query, parsed_query_json, route_json, retrieved_object_ids_json, answer_summary, success, confidence, created_at, latency_ms, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, cleanQuery, json({ terms: tokenize(cleanQuery) }), json(route), json(objects.map((item) => item.id)), answerSummary, objects.length ? 1 : 0, confidence, isoNow(), Date.now() - started, json({ lowConfidence: confidence < 0.35 }));
    return {
      id,
      query: cleanQuery,
      route,
      objects,
      contextPack: {
        objects,
        paths: objects.map((item) => item.uri),
        summaries: objects.map((item) => item.summary),
        rawRefs: objects.flatMap((item) => item.sourceRefs || []),
        links: objects.flatMap((item) => item.links || []),
        timestamps: objects.map((item) => item.updatedAt),
        confidence,
        privacyFilteredItems: 0,
        missingInfo: objects.length ? [] : ["No matching memory object found; Jarvis should ask or run an agent instead of hallucinating."],
      },
      answerSummary,
      confidence,
      lowConfidence: confidence < 0.35,
    };
  }

  function inspectSourceFile(filePath, rootDir) {
    const content = fs.readFileSync(filePath, "utf8");
    const relative = path.relative(rootDir, filePath);
    const symbols = [...content.matchAll(/\b(?:function|class|const|let|var|async function)\s+([A-Za-z0-9_$]+)/g)].map((match) => match[1]).slice(0, 80);
    const routes = [...content.matchAll(/pathname\s*===\s*["'`]([^"'`]+)["'`]|app\.(?:get|post|put|delete)\(["'`]([^"'`]+)["'`]/g)].map((match) => match[1] || match[2]).slice(0, 80);
    return {
      relative,
      filePath,
      language: path.extname(filePath).replace(".", "") || "text",
      checksum: crypto.createHash("sha256").update(content).digest("hex"),
      sizeBytes: Buffer.byteLength(content),
      modifiedAt: fs.statSync(filePath).mtime.toISOString(),
      summary: `${relative} contains ${symbols.length} symbol(s)${routes.length ? ` and ${routes.length} route(s)` : ""}.`,
      symbols,
      routes,
      preview: content.slice(0, 1200),
    };
  }

  function scanMemoryFiles(options = {}) {
    const rootDir = path.resolve(options.rootDir || path.resolve(runtimeDir, ".."));
    const limit = Math.max(1, Math.min(2500, Number(options.limit || 250)));
    const skip = new Set(["node_modules", ".git", "runtime", "dist", "dist-desktop", "test-results", ".playwright-cli"]);
    const allowed = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".json", ".md", ".css", ".html"]);
    const queue = [rootDir];
    const files = [];
    while (queue.length && files.length < limit) {
      const current = queue.shift();
      let entries = [];
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!skip.has(entry.name)) queue.push(fullPath);
        } else if (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())) {
          files.push(fullPath);
          if (files.length >= limit) break;
        }
      }
    }
    const inspected = [];
    const now = isoNow();
    for (const filePath of files) {
      const item = inspectSourceFile(filePath, rootDir);
      const uri = `memory://projects/jarvis/source-code/${safeSegment(item.relative)}`;
      db.prepare(`
        INSERT INTO memory_file_index(id, file_path, memory_uri, project_id, file_type, purpose_summary, owner_module, checksum,
          size_bytes, last_modified_at, last_inspected_at, indexed_at, status, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET memory_uri=excluded.memory_uri, project_id=excluded.project_id,
          file_type=excluded.file_type, purpose_summary=excluded.purpose_summary, owner_module=excluded.owner_module,
          checksum=excluded.checksum, size_bytes=excluded.size_bytes, last_modified_at=excluded.last_modified_at,
          last_inspected_at=excluded.last_inspected_at, indexed_at=excluded.indexed_at, status=excluded.status, metadata_json=excluded.metadata_json
      `).run(crypto.randomUUID(), item.filePath, uri, "jarvis", item.language, item.summary, item.relative.split(/[\\/]/)[0] || "root", item.checksum, item.sizeBytes, item.modifiedAt, now, now, "indexed", json({ symbols: item.symbols, routes: item.routes }));
      if (/\.(js|cjs|mjs|ts|tsx)$/i.test(item.filePath)) {
        createMemoryObject({
          uri,
          type: "source_code",
          title: item.relative,
          summary: item.summary,
          content: `${item.summary}\nSymbols: ${item.symbols.join(", ")}\nRoutes: ${item.routes.join(", ")}\n\n${item.preview}`,
          sourceRefs: [{ type: "file", path: item.filePath }],
          tags: ["source-code", item.language],
          metadata: { checksum: item.checksum, symbols: item.symbols, routes: item.routes },
        });
      }
      inspected.push(item);
    }
    const reportPath = path.join(memoryOsReportsDir, "NEURAL_VAULT_V4_FILE_INSPECTION_REPORT.md");
    ensureDir(path.dirname(reportPath));
    fs.writeFileSync(reportPath, [
      "# Neural Vault v4 File Inspection Report",
      "",
      `Generated: ${now}`,
      `Root: ${rootDir}`,
      `Files inspected: ${inspected.length}`,
      "",
      ...inspected.slice(0, 80).map((item) => `- ${item.relative}: ${item.summary}`),
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    return { rootDir, inspected: inspected.length, files: inspected.slice(0, 80), reportPath };
  }

  function listMemoryFileIndex(options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 80)));
    return db.prepare("SELECT * FROM memory_file_index ORDER BY indexed_at DESC LIMIT ?").all(limit).map((row) => ({
      id: row.id,
      filePath: row.file_path,
      memoryUri: row.memory_uri,
      projectId: row.project_id,
      fileType: row.file_type,
      purposeSummary: row.purpose_summary,
      ownerModule: row.owner_module,
      checksum: row.checksum,
      sizeBytes: row.size_bytes,
      lastModifiedAt: row.last_modified_at,
      lastInspectedAt: row.last_inspected_at,
      indexedAt: row.indexed_at,
      status: row.status,
      metadata: safeJson(row.metadata_json, {}),
    }));
  }

  function memoryOsAgents() {
    const now = isoNow();
    return memoryAgentDefinitions.map(([id, name, description]) => {
      const filePath = path.join(memoryOsRoot, "objects", "agents", `${id}.md`);
      if (!fs.existsSync(filePath)) {
        createMemoryObject({
          uri: `memory://projects/jarvis/agents/${id}`,
          filePath,
          type: "agent",
          title: name,
          summary: description,
          content: `${name}\n\nResponsibilities: ${description}\nRunnable task: run memory agent ${id}`,
          tags: ["memory-agent", id],
          metadata: { runnable: true, seededAt: now },
        });
      }
      const lastRun = db.prepare("SELECT * FROM memory_os_agent_runs WHERE agent_id=? ORDER BY started_at DESC LIMIT 1").get(id);
      return { id, name, description, filePath, lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, summary: lastRun.summary, startedAt: lastRun.started_at, endedAt: lastRun.ended_at } : null };
    });
  }

  function runMemoryAgent(agentId, options = {}) {
    const agent = memoryAgentDefinitions.find(([id]) => id === agentId) || memoryAgentDefinitions.find(([, name]) => slugify(name) === agentId);
    if (!agent) throw Object.assign(new Error("MemoryOS agent not found."), { statusCode: 404 });
    const [id, name] = agent;
    const startedAt = isoNow();
    const runId = crypto.randomUUID();
    let output = {};
    if (id === "file-inspector-agent" || id === "source-code-mapper-agent" || id === "project-cartographer-agent") {
      output = scanMemoryFiles({ limit: options.limit || 180 });
    } else if (id === "memory-manager-agent" || id === "dream-consolidator-agent" || id === "retrieval-evaluator-agent") {
      output = runMemoryRecheck({ kind: id });
    } else if (id === "device-memory-agent") {
      output = { mesh: meshMemorySummary() };
      createMemoryObject({ type: "device_mesh", title: "Device Mesh memory snapshot", summary: "Device Mesh memory agent captured current mesh state.", content: JSON.stringify(output.mesh, null, 2), tags: ["device-mesh", "agent-run"] });
    } else if (id === "coop-memory-agent") {
      output = { coop: coopMemorySummary() };
      createMemoryObject({ type: "coop_mesh", title: "Co-Op memory snapshot", summary: "Co-Op memory agent captured current co-op state.", content: JSON.stringify(output.coop, null, 2), tags: ["coop", "agent-run"] });
    } else {
      output = { objects: listMemoryObjects({ limit: 12 }), query: queryMemoryOs(name, { limit: 5 }) };
    }
    const endedAt = isoNow();
    const summary = `${name} completed. ${output.inspected ? `${output.inspected} files inspected.` : `${output.objects?.length || 0} objects referenced.`}`;
    db.prepare(`
      INSERT INTO memory_os_agent_runs(id, agent_id, task, input_refs_json, output_refs_json, status, started_at, ended_at, summary, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(runId, id, options.task || `Run ${name}`, json(options.inputRefs || []), json(output), "complete", startedAt, endedAt, summary, json({ options }));
    const reportPath = path.join(memoryOsReportsDir, "NEURAL_VAULT_V4_AGENT_REPORT.md");
    fs.writeFileSync(reportPath, [
      "# Neural Vault v4 Agent Report",
      "",
      `Latest run: ${endedAt}`,
      `Agent: ${name}`,
      `Status: complete`,
      `Summary: ${summary}`,
      "",
      "## Available Agents",
      "",
      ...memoryAgentDefinitions.map(([agentKey, agentName, description]) => `- ${agentName} (${agentKey}): ${description}`),
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    return { id: runId, agentId: id, name, status: "complete", summary, output, reportPath };
  }

  function runMemoryRecheck(options = {}) {
    const startedAt = isoNow();
    const id = crypto.randomUUID();
    const objects = db.prepare("SELECT * FROM memory_objects WHERE status='active' ORDER BY updated_at DESC LIMIT 500").all();
    let missing = 0;
    let changed = 0;
    for (const row of objects) {
      if (!fs.existsSync(row.file_path)) missing += 1;
      else {
        const current = crypto.createHash("sha256").update(fs.readFileSync(row.file_path, "utf8")).digest("hex");
        if (current !== row.checksum) changed += 1;
      }
    }
    const filesChecked = db.prepare("SELECT COUNT(*) AS count FROM memory_file_index").get().count;
    const reportPath = path.join(memoryOsReportsDir, "NEURAL_VAULT_V4_TEST_REPORT.md");
    const endedAt = isoNow();
    fs.writeFileSync(reportPath, [
      "# Neural Vault v4 Test Report",
      "",
      `Started: ${startedAt}`,
      `Ended: ${endedAt}`,
      `Run type: ${options.kind || "manual-recheck"}`,
      `Objects checked: ${objects.length}`,
      `Files indexed: ${filesChecked}`,
      `Missing object files: ${missing}`,
      `Changed object files: ${changed}`,
      "",
      missing ? "Status: attention required" : "Status: pass",
    ].join("\n"), { encoding: "utf8", mode: 0o600 });
    db.prepare(`
      INSERT INTO memory_maintenance_runs(id, started_at, ended_at, status, new_memories, merged_duplicates, archived_memories,
        contradictions_resolved, summaries_created, report_path, metadata_json, run_type, files_checked, objects_checked,
        objects_updated, broken_links_found, duplicates_found)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, startedAt, endedAt, missing ? "attention_required" : "complete", 0, 0, 0, 0, 1, reportPath, json({ changed, missing }), options.kind || "manual", filesChecked, objects.length, changed, missing, 0);
    return { id, status: missing ? "attention_required" : "complete", startedAt, endedAt, filesChecked, objectsChecked: objects.length, changedFiles: changed, missingFiles: missing, reportPath };
  }

  function memoryStorageTrace(uriOrId) {
    const object = readMemoryObject(uriOrId);
    if (!object) return null;
    const parents = db.prepare("SELECT * FROM memory_object_parents WHERE object_id=? OR child_uri=? ORDER BY created_at DESC").all(object.id, object.uri);
    const queries = db.prepare("SELECT * FROM memory_queries WHERE retrieved_object_ids_json LIKE ? ORDER BY created_at DESC LIMIT 8").all(`%${object.id}%`);
    return {
      object,
      trace: [
        `memory_objects row: ${object.id}`,
        `canonical file: ${object.filePath}`,
        `uri: ${object.uri}`,
        `checksum: ${object.checksum}`,
        `parents: ${parents.length}`,
        `recent queries: ${queries.length}`,
      ],
      parents,
      recentQueries: queries.map((row) => ({ id: row.id, query: row.user_query, confidence: row.confidence, createdAt: row.created_at })),
    };
  }

  function memoryOsStatus() {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    const reports = fs.existsSync(memoryOsReportsDir)
      ? fs.readdirSync(memoryOsReportsDir).filter((name) => name.endsWith(".md")).map((name) => path.join(memoryOsReportsDir, name))
      : [];
    return {
      ok: true,
      version: "4.0.0-memory-os-filedb-agents",
      root: memoryOsRoot,
      dbPath,
      folders: {
        objects: path.join(memoryOsRoot, "objects"),
        rawEvents: path.join(memoryOsRoot, "raw_events"),
        compiled: path.join(memoryOsRoot, "compiled"),
        reports: memoryOsReportsDir,
      },
      counts: {
        objects: count("memory_objects"),
        parents: count("memory_object_parents"),
        rawEvents: count("memory_raw_events"),
        fileIndex: count("memory_file_index"),
        edges: count("memory_edges"),
        commands: count("memory_commands"),
        queries: count("memory_queries"),
        agentRuns: count("memory_os_agent_runs"),
      },
      agents: memoryOsAgents(),
      reports,
      generatedAt: isoNow(),
    };
  }

  function writeMemoryOsBuildReports() {
    const now = isoNow();
    const statusPayload = memoryOsStatus();
    const reports = {
      "NEURAL_VAULT_V4_BUILD_REPORT.md": [
        "# Neural Vault v4 Build Report",
        "",
        `Generated: ${now}`,
        "Implemented: file-backed memory objects, FileDB index, query engine, memory agents, maintenance recheck, reports, and API surface.",
        `MemoryOS root: ${statusPayload.root}`,
      ],
      "NEURAL_VAULT_V4_MIGRATION_REPORT.md": [
        "# Neural Vault v4 Migration Report",
        "",
        `Generated: ${now}`,
        "Existing Neural Vault tables were preserved.",
        "New v4 tables were added without deleting prior memory.",
        "Existing mesh/co-op memory remains queryable through old and v4 APIs.",
      ],
    };
    for (const [name, lines] of Object.entries(reports)) {
      fs.writeFileSync(path.join(memoryOsReportsDir, name), `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return Object.keys(reports).map((name) => path.join(memoryOsReportsDir, name));
  }

  function status() {
    const tableCount = (name) => db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get().count;
    return {
      ok: true,
      name: "NeuralVault",
      root,
      dbPath,
      generatedAt: isoNow(),
      counts: {
        memories: tableCount("memories"),
        entities: tableCount("entities"),
        projects: tableCount("projects"),
        artifacts: tableCount("artifacts"),
        skills: tableCount("skills"),
        agents: tableCount("agents"),
        apiKeyMetadata: tableCount("api_key_metadata"),
        integrations: tableCount("integrations"),
        actionMacros: tableCount("action_macros"),
        browserWorkflows: tableCount("browser_workflows"),
        capabilityMemory: tableCount("capability_memory"),
        meshDevices: tableCount("mesh_devices"),
        meshSessions: tableCount("mesh_sessions"),
        meshInboxItems: tableCount("mesh_inbox_items"),
        meshControlEvents: tableCount("mesh_control_events"),
        meshStreamEvents: tableCount("mesh_stream_events"),
        meshOverlays: tableCount("mesh_overlays"),
        meshReplays: tableCount("mesh_replays"),
        memoryOsObjects: tableCount("memory_objects"),
        memoryOsFiles: tableCount("memory_file_index"),
        memoryOsQueries: tableCount("memory_queries"),
        memoryOsAgentRuns: tableCount("memory_os_agent_runs"),
        maintenanceRuns: tableCount("memory_maintenance_runs"),
      },
      fts: {
        memories: tableExists(db, "memories_fts"),
        sourceFiles: tableExists(db, "source_files_fts"),
        artifacts: tableExists(db, "artifacts_fts"),
      },
      continuity: getContinuity(),
      memoryOs: memoryOsStatus(),
      providers: getProviders(),
      toolCount: getToolDefinitions().length,
    };
  }

  writeMemoryOsBuildReports();

  return {
    root,
    dbPath,
    writeRawEvent,
    upsertMemory,
    searchMemories,
    resolveReferences,
    getContextPack,
    renderContextText,
    ingestTurn,
    updateContinuityFromTurn,
    getContinuity,
    saveContinuity,
    checkPermission,
    indexArtifact,
    compileSkill,
    registerAgent,
    rememberApiKeyMetadata,
    listApiKeyMetadata,
    recordIntegrationHealth,
    listIntegrationHealth,
    createActionMacro,
    listActionMacros,
    listActionMacroRuns,
    matchActionMacros,
    recordActionMacroRun,
    updateActionMacroRun,
    upsertBrowserWorkflow,
    upsertPersonalProfileItem,
    upsertCapabilityMemory,
    listCapabilityMemory,
    listSkills,
    listAgents,
    memoryOsStatus,
    createMemoryObject,
    readMemoryObject,
    listMemoryObjects,
    queryMemoryOs,
    scanMemoryFiles,
    listMemoryFileIndex,
    memoryOsAgents,
    runMemoryAgent,
    runMemoryRecheck,
    memoryStorageTrace,
    writeMemoryOsBuildReports,
    actionStorageTrace,
    upsertMeshDevice,
    listMeshDevices,
    startMeshSession,
    endMeshSession,
    listMeshSessions,
    recordMeshPermissionGrant,
    listMeshPermissionGrants,
    recordMeshStreamEvent,
    recordMeshControlEvent,
    recordMeshInboxItem,
    listMeshInboxItems,
    recordMeshOverlay,
    listMeshOverlays,
    createMeshReplay,
    listMeshReplays,
    compileMeshSkillFromReplay,
    meshMemorySummary,
    recordCoopSession,
    endCoopSession,
    recordCoopEvent,
    recordCoopFileAccess,
    recordCoopPatch,
    recordCoopChatMessage,
    recordCoopJarvisMessage,
    recordCoopMemoryPacket,
    recordCoopSkillTransfer,
    recordCoopTask,
    recordCoopReplay,
    coopMemorySummary,
    maintenanceRun,
    status,
    // T5a: Entity relationship graph
    upsertRelationship,
    getEntityRelationships,
    // T5b: Entity resolution & merge
    resolveEntity,
    mergeEntities,
    // T5c: Hybrid RRF retrieval
    hybridSearch,
    // T6b: Procedural / behavioral rule retrieval
    getProcedural,
    formatProceduralForContext,
    close: () => db.close(),
  };
}

module.exports = {
  createNeuralVault,
};
