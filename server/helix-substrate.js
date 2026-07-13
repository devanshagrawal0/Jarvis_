// helix-substrate.js — HELIX rebuild H0: the 7-layer memory substrate.
//
// Additive foundation for the honest HELIX rebuild (see Desktop/HELIX_MASTER_PLAN.md).
// Creates the net-new canonical object model with REAL foreign keys on the backbone,
// an FTS5 full-text index, a vector index, an evidence ledger with source pointers,
// hypotheses (§14 Q2), computed confidence assessments (§14 Q7), runs/retrieval/tools
// for observability, and operations/artifacts/manifests/segments for Build.
//
// Design rules (from jarvis-coding-rules): CommonJS, better-sqlite3, crypto.randomUUID,
// ISO-8601 timestamps, safeDbJson on read, transactions for multi-step writes, manual
// FTS5 maintenance. Everything here is CREATE ... IF NOT EXISTS so it applies cleanly
// on the next server start with zero impact on existing tables/rows.

const crypto = require("crypto");

const SUBSTRATE_SCHEMA_VERSION = 1;
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isoNow() { return new Date().toISOString(); }
function uuid() { return crypto.randomUUID(); }

function safeDbJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) { if (PROTO_KEYS.has(key)) return fallback; }
    }
    return parsed ?? fallback;
  } catch { return fallback; }
}
function J(v) { return JSON.stringify(v ?? null); }

// Confidence is ordinal (§14 Q7) — never a bare percentage. A numeric may be computed
// internally to derive the label but the label is what surfaces.
const CONFIDENCE_CLASSES = ["strong", "moderate", "weak", "insufficient"];
function classifyConfidence(value) {
  if (value == null || Number.isNaN(value)) return "insufficient";
  if (value >= 0.75) return "strong";
  if (value >= 0.5) return "moderate";
  if (value > 0) return "weak";
  return "insufficient";
}

/**
 * Attach the substrate to an existing HELIX better-sqlite3 database.
 * Assumes helix_projects and helix_folders already exist (created by helix-db.js
 * before this runs) so backbone foreign keys resolve. Returns a namespaced API.
 */
function createSubstrate(db) {
  // ---- Schema (ordered so FK parents precede children within the batch) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS helix_substrate_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Layer 1: object store (raw immutable artifacts: files, fetched pages, generated docs)
    CREATE TABLE IF NOT EXISTS helix_objects (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      content_hash TEXT,
      mime TEXT,
      kind TEXT,
      version INTEGER DEFAULT 1,
      owner TEXT,
      storage_uri TEXT,
      byte_size INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_objects_project ON helix_objects(project_id);
    CREATE INDEX IF NOT EXISTS idx_helix_objects_hash ON helix_objects(content_hash);

    -- Layer 2: relational catalog — research sources (single reliability tag, §14 Q4)
    CREATE TABLE IF NOT EXISTS helix_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      object_id TEXT,
      title TEXT,
      source_type TEXT,
      author TEXT,
      publisher TEXT,
      original_locator TEXT,
      access_method TEXT,
      publication_date TEXT,
      captured_at TEXT,
      last_checked_at TEXT,
      language TEXT,
      jurisdiction TEXT,
      version_label TEXT,
      content_hash TEXT,
      mime_type TEXT,
      size INTEGER,
      access_status TEXT DEFAULT 'available',
      ingestion_status TEXT DEFAULT 'pending',
      reliability TEXT DEFAULT 'unrated',
      freshness_status TEXT DEFAULT 'fresh',
      withdrawn INTEGER DEFAULT 0,
      supersedes_source_id TEXT,
      external_identifiers TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_sources_project ON helix_sources(project_id);

    -- Layer 3a: source location pointers (page/span/bbox/table/figure/cell/commit)
    CREATE TABLE IF NOT EXISTS helix_source_pointers (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES helix_sources(id) ON DELETE CASCADE,
      source_version TEXT,
      location_type TEXT,
      page_number INTEGER,
      section_title TEXT,
      heading_path TEXT,
      paragraph_number INTEGER,
      line_start INTEGER,
      line_end INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      bbox TEXT,
      timestamp_start TEXT,
      timestamp_end TEXT,
      table_id TEXT,
      figure_id TEXT,
      sheet_name TEXT,
      cell_range TEXT,
      repository_path TEXT,
      commit_hash TEXT,
      record_identifier TEXT,
      tool_result_id TEXT,
      quote_or_passage TEXT,
      quote_hash TEXT,
      context_before TEXT,
      context_after TEXT,
      content_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_pointers_source ON helix_source_pointers(source_id);

    -- Relational catalog — questions / sub-questions / plans
    CREATE TABLE IF NOT EXISTS helix_questions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      title TEXT,
      request_text TEXT,
      normalized_question TEXT,
      intent TEXT,
      desired_outcome TEXT,
      scope TEXT,
      constraints TEXT DEFAULT '{}',
      assumptions TEXT DEFAULT '[]',
      time_range TEXT,
      jurisdiction TEXT,
      source_requirements TEXT DEFAULT '{}',
      excluded_sources TEXT DEFAULT '[]',
      tool_permissions TEXT DEFAULT '[]',
      cost_limit REAL,
      runtime_limit INTEGER,
      due_at TEXT,
      status TEXT DEFAULT 'draft',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      current_plan_id TEXT,
      parent_question_id TEXT,
      supersedes_question_id TEXT,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_questions_project ON helix_questions(project_id);

    CREATE TABLE IF NOT EXISTS helix_subquestions (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES helix_questions(id) ON DELETE CASCADE,
      parent_subquestion_id TEXT,
      text TEXT,
      purpose TEXT,
      priority INTEGER DEFAULT 0,
      scope TEXT,
      required_source_types TEXT DEFAULT '[]',
      completion_conditions TEXT DEFAULT '[]',
      dependencies TEXT DEFAULT '[]',
      status TEXT DEFAULT 'not_started',
      assigned_operation_ids TEXT DEFAULT '[]',
      coverage_state TEXT DEFAULT 'uncovered',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_subq_question ON helix_subquestions(question_id);

    CREATE TABLE IF NOT EXISTS helix_plans (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES helix_questions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft',
      interpreted_goal TEXT,
      assumptions TEXT DEFAULT '[]',
      subquestion_ids TEXT DEFAULT '[]',
      task_ids TEXT DEFAULT '[]',
      expected_outputs TEXT DEFAULT '[]',
      tool_requirements TEXT DEFAULT '[]',
      human_checkpoints TEXT DEFAULT '[]',
      estimated_cost REAL,
      estimated_duration INTEGER,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      supersedes_plan_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_helix_plans_question ON helix_plans(question_id);

    -- Confidence assessments (§14 Q7): ordinal + inputs, attached to object+version
    CREATE TABLE IF NOT EXISTS helix_confidence_assessments (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES helix_projects(id) ON DELETE CASCADE,
      object_type TEXT,
      object_id TEXT,
      object_version INTEGER,
      status TEXT DEFAULT 'not_assessed',
      value REAL,
      classification TEXT,
      method TEXT,
      method_version TEXT,
      input_values TEXT DEFAULT '{}',
      input_object_ids TEXT DEFAULT '[]',
      weights TEXT DEFAULT '{}',
      thresholds TEXT DEFAULT '{}',
      missing_inputs TEXT DEFAULT '[]',
      computed_at TEXT,
      expires_at TEXT,
      invalidated_at TEXT,
      invalidation_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_helix_conf_object ON helix_confidence_assessments(object_id);

    -- Layer 3b: evidence ledger — the trust backbone. Every item traces to a source
    -- (+pointer) or tool result, or is explicitly unsupported/promoted hypothesis.
    CREATE TABLE IF NOT EXISTS helix_evidence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      subquestion_ids TEXT DEFAULT '[]',
      evidence_type TEXT DEFAULT 'claim',
      claim_text TEXT NOT NULL,
      normalized_claim TEXT,
      claim_scope TEXT,
      claim_type TEXT,
      source_id TEXT,
      source_pointer_ids TEXT DEFAULT '[]',
      quote_hash TEXT,
      method TEXT,
      reviewer TEXT,
      tool_result_id TEXT,
      captured_at TEXT,
      publication_date TEXT,
      freshness_status TEXT DEFAULT 'fresh',
      support_status TEXT DEFAULT 'not_assessed',
      review_status TEXT DEFAULT 'unreviewed',
      materiality TEXT DEFAULT 'normal',
      topic_ids TEXT DEFAULT '[]',
      supporting_evidence_ids TEXT DEFAULT '[]',
      contradicting_evidence_ids TEXT DEFAULT '[]',
      independent_source_count INTEGER DEFAULT 0,
      confidence_assessment_id TEXT,
      extraction_run_id TEXT,
      derived_from_ids TEXT DEFAULT '[]',
      dependent_object_ids TEXT DEFAULT '[]',
      supersedes_evidence_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_evidence_project ON helix_evidence(project_id);
    CREATE INDEX IF NOT EXISTS idx_helix_evidence_source ON helix_evidence(source_id);
    CREATE INDEX IF NOT EXISTS idx_helix_evidence_support ON helix_evidence(support_status);

    -- Hypotheses (§14 Q2): user/model propositions that PROMOTE to evidence on source attach
    CREATE TABLE IF NOT EXISTS helix_hypotheses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      text TEXT NOT NULL,
      normalized_text TEXT,
      origin TEXT DEFAULT 'user',
      rationale TEXT,
      status TEXT DEFAULT 'open',
      promoted_evidence_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_hypotheses_project ON helix_hypotheses(project_id);

    -- Claim-level contradictions (evidence↔evidence), distinct from legacy entry-level
    CREATE TABLE IF NOT EXISTS helix_claim_contradictions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      claim_a_id TEXT NOT NULL,
      claim_b_id TEXT NOT NULL,
      contradiction_type TEXT,
      description TEXT,
      materiality TEXT DEFAULT 'normal',
      scope_difference TEXT,
      status TEXT DEFAULT 'open',
      resolution_type TEXT,
      resolution_rationale TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      affected TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_claimcon_project ON helix_claim_contradictions(project_id);

    -- Analysis / assertions (§14 Q9: assertions are the source of truth) / citations
    CREATE TABLE IF NOT EXISTS helix_analyses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      plan_id TEXT,
      evidence_snapshot_id TEXT,
      title TEXT,
      summary TEXT,
      assertion_ids TEXT DEFAULT '[]',
      method TEXT,
      included_folder_ids TEXT DEFAULT '[]',
      included_segment_ids TEXT DEFAULT '[]',
      excluded_evidence_ids TEXT DEFAULT '[]',
      open_question_ids TEXT DEFAULT '[]',
      coverage_metrics TEXT DEFAULT '{}',
      citation_metrics TEXT DEFAULT '{}',
      contradiction_metrics TEXT DEFAULT '{}',
      staleness_metrics TEXT DEFAULT '{}',
      status TEXT DEFAULT 'draft',
      run_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      supersedes_analysis_id TEXT,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_analyses_project ON helix_analyses(project_id);

    CREATE TABLE IF NOT EXISTS helix_assertions (
      id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES helix_analyses(id) ON DELETE CASCADE,
      text TEXT,
      assertion_type TEXT DEFAULT 'inference',
      scope TEXT,
      support_status TEXT DEFAULT 'not_assessed',
      evidence_ids TEXT DEFAULT '[]',
      citation_ids TEXT DEFAULT '[]',
      contradiction_ids TEXT DEFAULT '[]',
      assumption_ids TEXT DEFAULT '[]',
      derivation TEXT,
      confidence_assessment_id TEXT,
      dependent_decision_ids TEXT DEFAULT '[]',
      dependent_artifact_ids TEXT DEFAULT '[]',
      order_index INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_assertions_analysis ON helix_assertions(analysis_id);

    CREATE TABLE IF NOT EXISTS helix_citations (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES helix_projects(id) ON DELETE CASCADE,
      assertion_id TEXT REFERENCES helix_assertions(id) ON DELETE CASCADE,
      evidence_id TEXT,
      source_id TEXT,
      source_pointer_ids TEXT DEFAULT '[]',
      citation_format TEXT,
      validation_status TEXT DEFAULT 'unvalidated',
      validated_at TEXT,
      broken_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_citations_assertion ON helix_citations(assertion_id);

    -- Decisions (§14 Q1: solo override stamp) + integrity
    CREATE TABLE IF NOT EXISTS helix_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      analysis_id TEXT,
      title TEXT,
      statement TEXT,
      decision_type TEXT,
      status TEXT DEFAULT 'draft',
      owner_id TEXT,
      approver_ids TEXT DEFAULT '[]',
      decision_date TEXT,
      effective_date TEXT,
      review_date TEXT,
      alternatives TEXT DEFAULT '[]',
      selected_alternative TEXT,
      criteria TEXT DEFAULT '[]',
      supporting_evidence_ids TEXT DEFAULT '[]',
      supporting_assertion_ids TEXT DEFAULT '[]',
      contradiction_ids TEXT DEFAULT '[]',
      assumption_ids TEXT DEFAULT '[]',
      accepted_risks TEXT DEFAULT '[]',
      rejected_risks TEXT DEFAULT '[]',
      conditions TEXT DEFAULT '[]',
      reversal_conditions TEXT DEFAULT '[]',
      follow_up_actions TEXT DEFAULT '[]',
      rationale TEXT,
      integrity_check TEXT DEFAULT '{}',
      override TEXT,
      approval_records TEXT DEFAULT '[]',
      evidence_snapshot_id TEXT,
      supersedes_decision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_decisions_project ON helix_decisions(project_id);

    CREATE TABLE IF NOT EXISTS helix_evidence_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      evidence_object_versions TEXT DEFAULT '[]',
      source_versions TEXT DEFAULT '[]',
      contradiction_versions TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      created_by TEXT,
      purpose TEXT,
      run_id TEXT
    );

    -- Build: folder items (references, not copies), segments, operations, artifacts, manifests
    CREATE TABLE IF NOT EXISTS helix_folder_items (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL REFERENCES helix_folders(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      object_type TEXT,
      object_id TEXT,
      object_version INTEGER,
      added_by TEXT,
      added_at TEXT NOT NULL,
      inclusion_reason TEXT,
      sort_order INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_helix_folderitems_folder ON helix_folder_items(folder_id);

    CREATE TABLE IF NOT EXISTS helix_segments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      folder_id TEXT,
      name TEXT,
      description TEXT,
      segment_type TEXT DEFAULT 'dynamic',
      rules TEXT DEFAULT '{}',
      manual_include_ids TEXT DEFAULT '[]',
      manual_exclude_ids TEXT DEFAULT '[]',
      evaluated_member_ids TEXT DEFAULT '[]',
      evaluated_at TEXT,
      status TEXT DEFAULT 'active',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      supersedes_segment_id TEXT,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_segments_project ON helix_segments(project_id);

    CREATE TABLE IF NOT EXISTS helix_operations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      operation_type TEXT,
      name TEXT,
      status TEXT DEFAULT 'draft',
      input_folder_id TEXT,
      input_folder_version INTEGER,
      input_segment_id TEXT,
      input_segment_version INTEGER,
      evaluated_input_ids TEXT DEFAULT '[]',
      parameters TEXT DEFAULT '{}',
      output_artifact_ids TEXT DEFAULT '[]',
      tool_call_ids TEXT DEFAULT '[]',
      estimated_cost REAL,
      actual_cost REAL,
      estimated_duration INTEGER,
      actual_duration INTEGER,
      started_at TEXT,
      completed_at TEXT,
      created_by TEXT,
      errors TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_operations_project ON helix_operations(project_id);

    CREATE TABLE IF NOT EXISTS helix_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      title TEXT,
      artifact_type TEXT,
      status TEXT DEFAULT 'draft',
      content_location TEXT,
      preview_location TEXT,
      operation_id TEXT,
      folder_id TEXT,
      folder_version INTEGER,
      segment_id TEXT,
      segment_version INTEGER,
      evidence_snapshot_id TEXT,
      analysis_ids TEXT DEFAULT '[]',
      decision_ids TEXT DEFAULT '[]',
      source_ids TEXT DEFAULT '[]',
      evidence_ids TEXT DEFAULT '[]',
      claim_ids TEXT DEFAULT '[]',
      citation_ids TEXT DEFAULT '[]',
      manifest_id TEXT,
      validation_state TEXT DEFAULT 'unvalidated',
      published_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      supersedes_artifact_id TEXT,
      version INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_helix_artifacts_project ON helix_artifacts(project_id);

    CREATE TABLE IF NOT EXISTS helix_manifests (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES helix_artifacts(id) ON DELETE CASCADE,
      artifact_version INTEGER,
      project_id TEXT,
      operation_id TEXT,
      operation_version INTEGER,
      operation_parameters TEXT DEFAULT '{}',
      input_object_versions TEXT DEFAULT '[]',
      folder_version INTEGER,
      segment_version INTEGER,
      evaluated_segment_members TEXT DEFAULT '[]',
      source_versions TEXT DEFAULT '[]',
      source_pointer_ids TEXT DEFAULT '[]',
      evidence_versions TEXT DEFAULT '[]',
      claim_versions TEXT DEFAULT '[]',
      analysis_versions TEXT DEFAULT '[]',
      decision_versions TEXT DEFAULT '[]',
      tool_calls TEXT DEFAULT '[]',
      method_versions TEXT DEFAULT '[]',
      costs TEXT DEFAULT '{}',
      runtime INTEGER,
      excluded_objects TEXT DEFAULT '[]',
      failed_objects TEXT DEFAULT '[]',
      validation_warnings TEXT DEFAULT '[]',
      citation_completeness REAL,
      reproduction_instructions TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_manifests_artifact ON helix_manifests(artifact_id);

    -- Observability: runs / retrieval events / tool results / event log
    CREATE TABLE IF NOT EXISTS helix_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      question_id TEXT,
      plan_id TEXT,
      trigger TEXT,
      status TEXT DEFAULT 'pending',
      stage TEXT,
      input_object_versions TEXT DEFAULT '[]',
      operation_ids TEXT DEFAULT '[]',
      tool_call_ids TEXT DEFAULT '[]',
      retrieval_event_ids TEXT DEFAULT '[]',
      outputs TEXT DEFAULT '[]',
      errors TEXT DEFAULT '[]',
      warnings TEXT DEFAULT '[]',
      human_checkpoint_records TEXT DEFAULT '[]',
      started_at TEXT,
      completed_at TEXT,
      total_cost REAL DEFAULT 0,
      total_runtime INTEGER,
      initiated_by TEXT,
      parent_run_id TEXT,
      reproduces_run_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_runs_project ON helix_runs(project_id);

    CREATE TABLE IF NOT EXISTS helix_retrieval_events (
      id TEXT PRIMARY KEY,
      run_id TEXT REFERENCES helix_runs(id) ON DELETE CASCADE,
      project_id TEXT,
      query TEXT,
      query_version TEXT,
      providers TEXT DEFAULT '[]',
      filters TEXT DEFAULT '{}',
      results_returned INTEGER DEFAULT 0,
      results_opened INTEGER DEFAULT 0,
      results_ingested INTEGER DEFAULT 0,
      results_rejected INTEGER DEFAULT 0,
      rejection_reason TEXT,
      cost REAL DEFAULT 0,
      tool TEXT,
      subquestion_id TEXT,
      fused_result_ids TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_retrieval_run ON helix_retrieval_events(run_id);

    CREATE TABLE IF NOT EXISTS helix_tool_results (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES helix_projects(id) ON DELETE CASCADE,
      tool_name TEXT,
      tool_version TEXT,
      request TEXT,
      response TEXT,
      captured_at TEXT,
      expires_at TEXT,
      validity_status TEXT DEFAULT 'valid',
      cost REAL DEFAULT 0,
      run_id TEXT,
      source_pointer_equivalent TEXT,
      derived_evidence_ids TEXT DEFAULT '[]',
      error_state TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_toolresults_project ON helix_tool_results(project_id);

    -- Layer 7: event / context log (cross-room fabric + reproducibility)
    CREATE TABLE IF NOT EXISTS helix_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      event_type TEXT,
      object_type TEXT,
      object_id TEXT,
      before_state TEXT,
      after_state TEXT,
      summary TEXT,
      artifact_ids TEXT DEFAULT '[]',
      pointers TEXT DEFAULT '{}',
      retrieval_keys TEXT DEFAULT '{}',
      trust TEXT DEFAULT '{}',
      sensitivity TEXT DEFAULT 'normal',
      retention TEXT,
      memory_eligible INTEGER DEFAULT 0,
      actor TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_events_project ON helix_events(project_id);
    CREATE INDEX IF NOT EXISTS idx_helix_events_type ON helix_events(event_type);

    -- Layer 5: vector index (embedding-2), project-namespaced. Cosine done in JS.
    CREATE TABLE IF NOT EXISTS helix_vectors (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      ref_kind TEXT,
      ref_id TEXT,
      chunk_index INTEGER DEFAULT 0,
      embedding_model TEXT,
      embedding_version TEXT,
      dim INTEGER,
      vector BLOB,
      access_scope TEXT DEFAULT 'project',
      text_preview TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_helix_vectors_project ON helix_vectors(project_id);
    CREATE INDEX IF NOT EXISTS idx_helix_vectors_ref ON helix_vectors(ref_kind, ref_id);

    -- H14: local collaboration. Members are local people-profiles the owner manages
    -- (no external auth — this is a personal tool). Roles gate the UI; reviews record
    -- real approve/reject on decisions.
    CREATE TABLE IF NOT EXISTS helix_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'reviewer',
      avatar_seed TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS helix_reviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES helix_projects(id) ON DELETE CASCADE,
      decision_id TEXT,
      member_id TEXT,
      status TEXT DEFAULT 'pending',
      comment TEXT,
      requested_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_helix_reviews_decision ON helix_reviews(decision_id);
  `);

  // Layer 4: FTS5 full-text index (standalone; ref_id/kind/project_id UNINDEXED filters).
  // Regular FTS5 table → normal INSERT/DELETE with WHERE works (no external-content quirks).
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS helix_fts USING fts5(
      text,
      ref_id UNINDEXED,
      ref_kind UNINDEXED,
      project_id UNINDEXED,
      tokenize = 'porter unicode61'
    );
  `);

  // Record schema version (idempotent)
  db.prepare(
    `INSERT INTO helix_substrate_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(SUBSTRATE_SCHEMA_VERSION));

  // ---- Prepared statements ----
  const stmts = {
    // FTS
    ftsInsert: db.prepare(`INSERT INTO helix_fts (text, ref_id, ref_kind, project_id) VALUES (?, ?, ?, ?)`),
    ftsDelete: db.prepare(`DELETE FROM helix_fts WHERE ref_id = ?`),
    ftsSearch: db.prepare(
      `SELECT ref_id, ref_kind, project_id, bm25(helix_fts) AS score, snippet(helix_fts, 0, '[', ']', '…', 12) AS snippet
       FROM helix_fts WHERE helix_fts MATCH ? AND project_id = ? ORDER BY score LIMIT ?`
    ),
    // Vectors
    vecInsert: db.prepare(
      `INSERT INTO helix_vectors (id, project_id, ref_kind, ref_id, chunk_index, embedding_model, embedding_version, dim, vector, access_scope, text_preview, created_at)
       VALUES (@id,@project_id,@ref_kind,@ref_id,@chunk_index,@embedding_model,@embedding_version,@dim,@vector,@access_scope,@text_preview,@created_at)`
    ),
    vecByProject: db.prepare(`SELECT * FROM helix_vectors WHERE project_id = ?`),
    vecDeleteRef: db.prepare(`DELETE FROM helix_vectors WHERE ref_id = ?`),
    // Confidence
    confInsert: db.prepare(
      `INSERT INTO helix_confidence_assessments (id, project_id, object_type, object_id, object_version, status, value, classification, method, method_version, input_values, input_object_ids, weights, thresholds, missing_inputs, computed_at, expires_at)
       VALUES (@id,@project_id,@object_type,@object_id,@object_version,@status,@value,@classification,@method,@method_version,@input_values,@input_object_ids,@weights,@thresholds,@missing_inputs,@computed_at,@expires_at)`
    ),
    confGet: db.prepare(`SELECT * FROM helix_confidence_assessments WHERE id = ?`),
    confInvalidate: db.prepare(`UPDATE helix_confidence_assessments SET status='invalidated', invalidated_at=?, invalidation_reason=? WHERE id=?`),
    // Events
    eventInsert: db.prepare(
      `INSERT INTO helix_events (id, project_id, event_type, object_type, object_id, before_state, after_state, summary, artifact_ids, pointers, retrieval_keys, trust, sensitivity, retention, memory_eligible, actor, created_at)
       VALUES (@id,@project_id,@event_type,@object_type,@object_id,@before_state,@after_state,@summary,@artifact_ids,@pointers,@retrieval_keys,@trust,@sensitivity,@retention,@memory_eligible,@actor,@created_at)`
    ),
    eventsByProject: db.prepare(`SELECT * FROM helix_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`),
    eventLatest: db.prepare(`SELECT * FROM helix_events WHERE project_id = ? AND event_type = ? ORDER BY created_at DESC LIMIT 1`),
    // Runs
    runInsert: db.prepare(
      `INSERT INTO helix_runs (id, project_id, question_id, plan_id, trigger, status, stage, initiated_by, parent_run_id, reproduces_run_id, started_at, created_at)
       VALUES (@id,@project_id,@question_id,@plan_id,@trigger,@status,@stage,@initiated_by,@parent_run_id,@reproduces_run_id,@started_at,@created_at)`
    ),
    runUpdate: db.prepare(`UPDATE helix_runs SET status=@status, stage=@stage, outputs=@outputs, errors=@errors, warnings=@warnings, total_cost=@total_cost, total_runtime=@total_runtime, completed_at=@completed_at WHERE id=@id`),
    runGet: db.prepare(`SELECT * FROM helix_runs WHERE id = ?`),
    runsByProject: db.prepare(`SELECT * FROM helix_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`),
    retrievalInsert: db.prepare(
      `INSERT INTO helix_retrieval_events (id, run_id, project_id, query, query_version, providers, filters, results_returned, results_ingested, results_rejected, rejection_reason, cost, tool, subquestion_id, fused_result_ids, created_at)
       VALUES (@id,@run_id,@project_id,@query,@query_version,@providers,@filters,@results_returned,@results_ingested,@results_rejected,@rejection_reason,@cost,@tool,@subquestion_id,@fused_result_ids,@created_at)`
    ),
    toolResultInsert: db.prepare(
      `INSERT INTO helix_tool_results (id, project_id, tool_name, tool_version, request, response, captured_at, expires_at, validity_status, cost, run_id, source_pointer_equivalent, derived_evidence_ids, error_state, created_at)
       VALUES (@id,@project_id,@tool_name,@tool_version,@request,@response,@captured_at,@expires_at,@validity_status,@cost,@run_id,@source_pointer_equivalent,@derived_evidence_ids,@error_state,@created_at)`
    ),
    // Sources + pointers
    sourceInsert: db.prepare(
      `INSERT INTO helix_sources (id, project_id, object_id, title, source_type, author, publisher, original_locator, access_method, publication_date, captured_at, last_checked_at, language, jurisdiction, version_label, content_hash, mime_type, size, access_status, ingestion_status, reliability, freshness_status, created_by, created_at, updated_at)
       VALUES (@id,@project_id,@object_id,@title,@source_type,@author,@publisher,@original_locator,@access_method,@publication_date,@captured_at,@last_checked_at,@language,@jurisdiction,@version_label,@content_hash,@mime_type,@size,@access_status,@ingestion_status,@reliability,@freshness_status,@created_by,@created_at,@updated_at)`
    ),
    sourcesByProject: db.prepare(`SELECT * FROM helix_sources WHERE project_id = ? ORDER BY created_at DESC`),
    sourceGet: db.prepare(`SELECT * FROM helix_sources WHERE id = ?`),
    pointerInsert: db.prepare(
      `INSERT INTO helix_source_pointers (id, source_id, source_version, location_type, page_number, section_title, heading_path, paragraph_number, line_start, line_end, char_start, char_end, bbox, table_id, figure_id, sheet_name, cell_range, repository_path, commit_hash, record_identifier, tool_result_id, quote_or_passage, quote_hash, context_before, context_after, content_hash, created_at)
       VALUES (@id,@source_id,@source_version,@location_type,@page_number,@section_title,@heading_path,@paragraph_number,@line_start,@line_end,@char_start,@char_end,@bbox,@table_id,@figure_id,@sheet_name,@cell_range,@repository_path,@commit_hash,@record_identifier,@tool_result_id,@quote_or_passage,@quote_hash,@context_before,@context_after,@content_hash,@created_at)`
    ),
    pointersBySource: db.prepare(`SELECT * FROM helix_source_pointers WHERE source_id = ?`),
    pointerGet: db.prepare(`SELECT * FROM helix_source_pointers WHERE id = ?`),
    // Evidence
    evidenceInsert: db.prepare(
      `INSERT INTO helix_evidence (id, project_id, question_id, subquestion_ids, evidence_type, claim_text, normalized_claim, claim_scope, claim_type, source_id, source_pointer_ids, quote_hash, method, reviewer, tool_result_id, captured_at, publication_date, freshness_status, support_status, review_status, materiality, topic_ids, supporting_evidence_ids, contradicting_evidence_ids, independent_source_count, confidence_assessment_id, extraction_run_id, derived_from_ids, created_by, created_at, updated_at)
       VALUES (@id,@project_id,@question_id,@subquestion_ids,@evidence_type,@claim_text,@normalized_claim,@claim_scope,@claim_type,@source_id,@source_pointer_ids,@quote_hash,@method,@reviewer,@tool_result_id,@captured_at,@publication_date,@freshness_status,@support_status,@review_status,@materiality,@topic_ids,@supporting_evidence_ids,@contradicting_evidence_ids,@independent_source_count,@confidence_assessment_id,@extraction_run_id,@derived_from_ids,@created_by,@created_at,@updated_at)`
    ),
    evidenceByProject: db.prepare(`SELECT * FROM helix_evidence WHERE project_id = ? ORDER BY created_at DESC`),
    evidenceGet: db.prepare(`SELECT * FROM helix_evidence WHERE id = ?`),
    evidenceSetConfidence: db.prepare(`UPDATE helix_evidence SET confidence_assessment_id=?, support_status=?, updated_at=? WHERE id=?`),
    // Hypotheses
    hypInsert: db.prepare(
      `INSERT INTO helix_hypotheses (id, project_id, question_id, text, normalized_text, origin, rationale, status, created_by, created_at, updated_at)
       VALUES (@id,@project_id,@question_id,@text,@normalized_text,@origin,@rationale,@status,@created_by,@created_at,@updated_at)`
    ),
    hypByProject: db.prepare(`SELECT * FROM helix_hypotheses WHERE project_id = ? ORDER BY created_at DESC`),
    hypGet: db.prepare(`SELECT * FROM helix_hypotheses WHERE id = ?`),
    hypPromote: db.prepare(`UPDATE helix_hypotheses SET status='promoted', promoted_evidence_id=?, updated_at=? WHERE id=?`),
    // Operations / artifacts / manifests (Build)
    opInsert: db.prepare(`INSERT INTO helix_operations (id, project_id, operation_type, name, status, input_folder_id, input_segment_id, parameters, output_artifact_ids, estimated_cost, actual_cost, started_at, completed_at, created_by, created_at) VALUES (@id,@project_id,@operation_type,@name,@status,@input_folder_id,@input_segment_id,@parameters,@output_artifact_ids,@estimated_cost,@actual_cost,@started_at,@completed_at,@created_by,@created_at)`),
    artInsert: db.prepare(`INSERT INTO helix_artifacts (id, project_id, title, artifact_type, status, operation_id, folder_id, segment_id, source_ids, evidence_ids, claim_ids, manifest_id, validation_state, created_by, created_at, updated_at) VALUES (@id,@project_id,@title,@artifact_type,@status,@operation_id,@folder_id,@segment_id,@source_ids,@evidence_ids,@claim_ids,@manifest_id,@validation_state,@created_by,@created_at,@updated_at)`),
    artByProject: db.prepare(`SELECT * FROM helix_artifacts WHERE project_id = ? ORDER BY created_at DESC`),
    manInsert: db.prepare(`INSERT INTO helix_manifests (id, artifact_id, project_id, operation_id, operation_parameters, source_versions, evidence_versions, claim_versions, costs, citation_completeness, reproduction_instructions, created_at) VALUES (@id,@artifact_id,@project_id,@operation_id,@operation_parameters,@source_versions,@evidence_versions,@claim_versions,@costs,@citation_completeness,@reproduction_instructions,@created_at)`),
    manByArtifact: db.prepare(`SELECT * FROM helix_manifests WHERE artifact_id = ?`),
    // Decisions
    decInsert: db.prepare(`INSERT INTO helix_decisions (id, project_id, question_id, analysis_id, title, statement, decision_type, status, owner_id, decision_date, review_date, supporting_evidence_ids, rationale, integrity_check, override, created_at, updated_at) VALUES (@id,@project_id,@question_id,@analysis_id,@title,@statement,@decision_type,@status,@owner_id,@decision_date,@review_date,@supporting_evidence_ids,@rationale,@integrity_check,@override,@created_at,@updated_at)`),
    decByProject: db.prepare(`SELECT * FROM helix_decisions WHERE project_id = ? ORDER BY created_at DESC`),
    // Members / reviews (H14)
    memInsert: db.prepare(`INSERT INTO helix_members (id, name, email, role, avatar_seed, active, created_at) VALUES (@id,@name,@email,@role,@avatar_seed,1,@created_at)`),
    memList: db.prepare(`SELECT * FROM helix_members WHERE active = 1 ORDER BY created_at`),
    memGet: db.prepare(`SELECT * FROM helix_members WHERE id = ?`),
    memDeactivate: db.prepare(`UPDATE helix_members SET active = 0 WHERE id = ?`),
    revInsert: db.prepare(`INSERT INTO helix_reviews (id, project_id, decision_id, member_id, status, requested_at) VALUES (@id,@project_id,@decision_id,@member_id,'pending',@requested_at)`),
    revResolve: db.prepare(`UPDATE helix_reviews SET status=@status, comment=@comment, resolved_at=@resolved_at WHERE id=@id`),
    revByDecision: db.prepare(`SELECT * FROM helix_reviews WHERE decision_id = ? ORDER BY requested_at`),
    revByProject: db.prepare(`SELECT * FROM helix_reviews WHERE project_id = ? ORDER BY requested_at DESC`),
    revGet: db.prepare(`SELECT * FROM helix_reviews WHERE id = ?`),
  };

  const meta = () => ({ schema_version: SUBSTRATE_SCHEMA_VERSION });

  // ---- FTS helpers (manual maintenance per coding rules) ----
  const fts = {
    upsert(refKind, refId, projectId, text) {
      if (!refId || !text) return;
      const write = db.transaction(() => {
        stmts.ftsDelete.run(refId);
        stmts.ftsInsert.run(String(text), refId, refKind, projectId);
      });
      write();
    },
    remove(refId) { stmts.ftsDelete.run(refId); },
    search(projectId, query, limit = 20) {
      if (!query || !query.trim()) return [];
      try { return stmts.ftsSearch.all(query.trim(), projectId, limit); }
      catch { return []; } // malformed MATCH syntax → empty, never throw
    },
  };

  // ---- Vector helpers (store Float32 as BLOB; cosine in JS) ----
  const vectors = {
    add({ projectId, refKind, refId, chunkIndex = 0, model, modelVersion, vector, accessScope = "project", textPreview = "" }) {
      const arr = Float32Array.from(vector || []);
      const id = uuid();
      stmts.vecInsert.run({
        id, project_id: projectId, ref_kind: refKind, ref_id: refId, chunk_index: chunkIndex,
        embedding_model: model || "gemini-embedding-2", embedding_version: modelVersion || "2",
        dim: arr.length, vector: Buffer.from(arr.buffer), access_scope: accessScope,
        text_preview: (textPreview || "").slice(0, 300), created_at: isoNow(),
      });
      return id;
    },
    removeRef(refId) { stmts.vecDeleteRef.run(refId); },
    listByProject(projectId) {
      return stmts.vecByProject.all(projectId).map(r => ({
        ...r,
        vector: r.vector ? new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4) : new Float32Array(),
      }));
    },
  };

  // ---- Confidence (§14 Q7): compute ordinal + record inputs; never bare % ----
  const confidence = {
    classes: CONFIDENCE_CLASSES,
    classify: classifyConfidence,
    /**
     * Record a confidence assessment for an object. Pass either a computed numeric
     * `value` (→ classification derived) or status:'not_assessed'/'cannot_assess'.
     */
    record({ projectId, objectType, objectId, objectVersion = 1, value = null, method = "evidence-weighted-v1", methodVersion = "1", inputs = {}, inputObjectIds = [], weights = {}, thresholds = {}, missingInputs = [], expiresAt = null }) {
      const hasValue = typeof value === "number" && !Number.isNaN(value);
      const id = uuid();
      stmts.confInsert.run({
        id, project_id: projectId || null, object_type: objectType, object_id: objectId,
        object_version: objectVersion,
        status: hasValue ? "computed" : "not_assessed",
        value: hasValue ? value : null,
        classification: hasValue ? classifyConfidence(value) : null,
        method, method_version: methodVersion,
        input_values: J(inputs), input_object_ids: J(inputObjectIds),
        weights: J(weights), thresholds: J(thresholds), missing_inputs: J(missingInputs),
        computed_at: hasValue ? isoNow() : null, expires_at: expiresAt,
      });
      return id;
    },
    get(id) {
      const row = stmts.confGet.get(id);
      if (!row) return null;
      return { ...row,
        input_values: safeDbJson(row.input_values, {}),
        input_object_ids: safeDbJson(row.input_object_ids, []),
        weights: safeDbJson(row.weights, {}),
        thresholds: safeDbJson(row.thresholds, {}),
        missing_inputs: safeDbJson(row.missing_inputs, []),
      };
    },
    invalidate(id, reason) { stmts.confInvalidate.run(isoNow(), reason || "upstream change", id); },
  };

  // ---- Event log (cross-room fabric) ----
  const events = {
    append({ projectId, eventType, objectType = null, objectId = null, before = null, after = null, summary = "", artifactIds = [], pointers = {}, retrievalKeys = {}, trust = {}, sensitivity = "normal", retention = null, memoryEligible = false, actor = "system" }) {
      const id = uuid();
      stmts.eventInsert.run({
        id, project_id: projectId, event_type: eventType, object_type: objectType, object_id: objectId,
        before_state: before ? J(before) : null, after_state: after ? J(after) : null,
        summary, artifact_ids: J(artifactIds), pointers: J(pointers), retrieval_keys: J(retrievalKeys),
        trust: J(trust), sensitivity, retention, memory_eligible: memoryEligible ? 1 : 0,
        actor, created_at: isoNow(),
      });
      return id;
    },
    recent(projectId, limit = 50) { return stmts.eventsByProject.all(projectId, limit); },
    latestOfType(projectId, eventType) { return stmts.eventLatest.get(projectId, eventType) || null; },
  };

  // ---- Runs / retrieval / tools (observability) ----
  const runs = {
    start({ projectId, questionId = null, planId = null, trigger = "manual", stage = "planning", initiatedBy = "user", parentRunId = null, reproducesRunId = null }) {
      const id = uuid(); const now = isoNow();
      stmts.runInsert.run({ id, project_id: projectId, question_id: questionId, plan_id: planId, trigger, status: "running", stage, initiated_by: initiatedBy, parent_run_id: parentRunId, reproduces_run_id: reproducesRunId, started_at: now, created_at: now });
      return id;
    },
    update(id, { status, stage, outputs = [], errors = [], warnings = [], totalCost = 0, totalRuntime = null, completed = false }) {
      const cur = stmts.runGet.get(id); if (!cur) return;
      stmts.runUpdate.run({ id, status: status || cur.status, stage: stage || cur.stage, outputs: J(outputs), errors: J(errors), warnings: J(warnings), total_cost: totalCost, total_runtime: totalRuntime, completed_at: completed ? isoNow() : cur.completed_at });
    },
    get(id) { return stmts.runGet.get(id) || null; },
    listByProject(projectId, limit = 25) { return stmts.runsByProject.all(projectId, limit); },
    logRetrieval(ev) {
      const id = uuid();
      stmts.retrievalInsert.run({ id, run_id: ev.runId || null, project_id: ev.projectId || null, query: ev.query || "", query_version: ev.queryVersion || "1", providers: J(ev.providers || []), filters: J(ev.filters || {}), results_returned: ev.resultsReturned || 0, results_ingested: ev.resultsIngested || 0, results_rejected: ev.resultsRejected || 0, rejection_reason: ev.rejectionReason || null, cost: ev.cost || 0, tool: ev.tool || null, subquestion_id: ev.subquestionId || null, fused_result_ids: J(ev.fusedResultIds || []), created_at: isoNow() });
      return id;
    },
    logTool(tr) {
      const id = uuid();
      stmts.toolResultInsert.run({ id, project_id: tr.projectId || null, tool_name: tr.toolName, tool_version: tr.toolVersion || null, request: tr.request ? J(tr.request) : null, response: tr.response ? J(tr.response) : null, captured_at: isoNow(), expires_at: tr.expiresAt || null, validity_status: tr.validityStatus || "valid", cost: tr.cost || 0, run_id: tr.runId || null, source_pointer_equivalent: tr.sourcePointer ? J(tr.sourcePointer) : null, derived_evidence_ids: J(tr.derivedEvidenceIds || []), error_state: tr.errorState || null, created_at: isoNow() });
      return id;
    },
  };

  // ---- Sources + pointers (research catalog + provenance) ----
  const sources = {
    create(s) {
      const id = s.id || uuid(); const now = isoNow();
      stmts.sourceInsert.run({ id, project_id: s.projectId, object_id: s.objectId || null, title: s.title || "", source_type: s.sourceType || "document", author: s.author || null, publisher: s.publisher || null, original_locator: s.originalLocator || null, access_method: s.accessMethod || null, publication_date: s.publicationDate || null, captured_at: s.capturedAt || now, last_checked_at: s.lastCheckedAt || now, language: s.language || null, jurisdiction: s.jurisdiction || null, version_label: s.versionLabel || "v1", content_hash: s.contentHash || null, mime_type: s.mimeType || null, size: s.size || null, access_status: s.accessStatus || "available", ingestion_status: s.ingestionStatus || "pending", reliability: s.reliability || "unrated", freshness_status: s.freshnessStatus || "fresh", created_by: s.createdBy || "user", created_at: now, updated_at: now });
      return id;
    },
    listByProject(projectId) { return stmts.sourcesByProject.all(projectId); },
    get(id) { return stmts.sourceGet.get(id) || null; },
    addPointer(p) {
      const id = p.id || uuid();
      const quote = p.quoteOrPassage || null;
      const quoteHash = quote ? crypto.createHash("sha256").update(quote).digest("hex").slice(0, 32) : null;
      stmts.pointerInsert.run({ id, source_id: p.sourceId, source_version: p.sourceVersion || "v1", location_type: p.locationType || null, page_number: p.pageNumber ?? null, section_title: p.sectionTitle || null, heading_path: p.headingPath || null, paragraph_number: p.paragraphNumber ?? null, line_start: p.lineStart ?? null, line_end: p.lineEnd ?? null, char_start: p.charStart ?? null, char_end: p.charEnd ?? null, bbox: p.bbox ? J(p.bbox) : null, table_id: p.tableId || null, figure_id: p.figureId || null, sheet_name: p.sheetName || null, cell_range: p.cellRange || null, repository_path: p.repositoryPath || null, commit_hash: p.commitHash || null, record_identifier: p.recordIdentifier || null, tool_result_id: p.toolResultId || null, quote_or_passage: quote, quote_hash: quoteHash, context_before: p.contextBefore || null, context_after: p.contextAfter || null, content_hash: p.contentHash || null, created_at: isoNow() });
      return { id, quoteHash };
    },
    pointersFor(sourceId) { return stmts.pointersBySource.all(sourceId); },
    getPointer(id) { return stmts.pointerGet.get(id) || null; },
  };

  // ---- Evidence ledger (the anti-junk gate lives here) ----
  const evidence = {
    /**
     * Insert an evidence item. Enforces the validation rule: must trace to a
     * source(+pointer) OR a tool result OR be explicitly unsupported. Refusals,
     * chat, and system text can never become evidence.
     */
    create(e) {
      const hasSource = !!e.sourceId;
      const hasTool = !!e.toolResultId;
      const explicitUnsupported = e.supportStatus === "unsupported";
      const fromHypothesis = e.evidenceType === "promoted_hypothesis";
      if (!hasSource && !hasTool && !explicitUnsupported && !fromHypothesis) {
        throw new Error("evidence.create rejected: an evidence item must trace to a source, a tool result, or be explicitly unsupported");
      }
      const id = e.id || uuid(); const now = isoNow();
      stmts.evidenceInsert.run({
        id, project_id: e.projectId, question_id: e.questionId || null,
        subquestion_ids: J(e.subquestionIds || []), evidence_type: e.evidenceType || "claim",
        claim_text: e.claimText, normalized_claim: e.normalizedClaim || e.claimText, claim_scope: e.claimScope || null, claim_type: e.claimType || null,
        source_id: e.sourceId || null, source_pointer_ids: J(e.sourcePointerIds || []), quote_hash: e.quoteHash || null,
        method: e.method || null, reviewer: e.reviewer || null, tool_result_id: e.toolResultId || null,
        captured_at: e.capturedAt || now, publication_date: e.publicationDate || null, freshness_status: e.freshnessStatus || "fresh",
        support_status: e.supportStatus || (hasSource || hasTool ? "supported" : "not_assessed"),
        review_status: e.reviewStatus || "unreviewed", materiality: e.materiality || "normal",
        topic_ids: J(e.topicIds || []), supporting_evidence_ids: J(e.supportingEvidenceIds || []),
        contradicting_evidence_ids: J(e.contradictingEvidenceIds || []), independent_source_count: e.independentSourceCount || (hasSource ? 1 : 0),
        confidence_assessment_id: e.confidenceAssessmentId || null, extraction_run_id: e.extractionRunId || null,
        derived_from_ids: J(e.derivedFromIds || []), created_by: e.createdBy || "system", created_at: now, updated_at: now,
      });
      // index for retrieval
      fts.upsert("evidence", id, e.projectId, e.claimText);
      return id;
    },
    listByProject(projectId) {
      return stmts.evidenceByProject.all(projectId).map(hydrateEvidence);
    },
    get(id) { const r = stmts.evidenceGet.get(id); return r ? hydrateEvidence(r) : null; },
    setConfidence(id, confidenceAssessmentId, supportStatus) {
      stmts.evidenceSetConfidence.run(confidenceAssessmentId, supportStatus, isoNow(), id);
    },
  };
  function hydrateEvidence(r) {
    return { ...r,
      subquestion_ids: safeDbJson(r.subquestion_ids, []),
      source_pointer_ids: safeDbJson(r.source_pointer_ids, []),
      topic_ids: safeDbJson(r.topic_ids, []),
      supporting_evidence_ids: safeDbJson(r.supporting_evidence_ids, []),
      contradicting_evidence_ids: safeDbJson(r.contradicting_evidence_ids, []),
      derived_from_ids: safeDbJson(r.derived_from_ids, []),
    };
  }

  // ---- Hypotheses (§14 Q2) ----
  const hypotheses = {
    create(h) {
      const id = h.id || uuid(); const now = isoNow();
      stmts.hypInsert.run({ id, project_id: h.projectId, question_id: h.questionId || null, text: h.text, normalized_text: h.normalizedText || h.text, origin: h.origin || "user", rationale: h.rationale || null, status: "open", created_by: h.createdBy || "user", created_at: now, updated_at: now });
      fts.upsert("hypothesis", id, h.projectId, h.text);
      return id;
    },
    listByProject(projectId) { return stmts.hypByProject.all(projectId); },
    get(id) { return stmts.hypGet.get(id) || null; },
    /** Promote a hypothesis to a real evidence item once a qualifying source attaches. */
    promote(hypId, { sourceId, sourcePointerIds = [], quoteHash = null, method = "promoted", reviewer = null }) {
      const h = stmts.hypGet.get(hypId);
      if (!h) throw new Error("hypothesis not found");
      if (!sourceId) throw new Error("promotion requires a source");
      const evId = evidence.create({
        projectId: h.project_id, questionId: h.question_id, evidenceType: "promoted_hypothesis",
        claimText: h.text, sourceId, sourcePointerIds, quoteHash, method, reviewer,
        supportStatus: "supported", derivedFromIds: [hypId],
      });
      stmts.hypPromote.run(evId, isoNow(), hypId);
      return evId;
    },
  };

  // ── Build: operations → artifacts + manifests ──
  const artifacts = {
    /** Run a folder operation, producing an artifact + a citation manifest. */
    runOperation({ projectId, operationType = "combine", title, folderId = null, segmentId = null, sourceIds = [], evidenceIds = [], claimIds = [], parameters = {}, cost = 0, createdBy = "user" }) {
      const now = isoNow();
      const opId = uuid(), artId = uuid(), manId = uuid();
      const write = db.transaction(() => {
        stmts.opInsert.run({ id: opId, project_id: projectId, operation_type: operationType, name: title || operationType, status: "complete", input_folder_id: folderId, input_segment_id: segmentId, parameters: J(parameters), output_artifact_ids: J([artId]), estimated_cost: cost, actual_cost: cost, started_at: now, completed_at: now, created_by: createdBy, created_at: now });
        // artifact BEFORE manifest — the manifest has a FK to helix_artifacts(id).
        stmts.artInsert.run({ id: artId, project_id: projectId, title: title || `${operationType} result`, artifact_type: operationType, status: "needs_review", operation_id: opId, folder_id: folderId, segment_id: segmentId, source_ids: J(sourceIds), evidence_ids: J(evidenceIds), claim_ids: J(claimIds), manifest_id: manId, validation_state: "unvalidated", created_by: createdBy, created_at: now, updated_at: now });
        stmts.manInsert.run({ id: manId, artifact_id: artId, project_id: projectId, operation_id: opId, operation_parameters: J(parameters), source_versions: J(sourceIds), evidence_versions: J(evidenceIds), claim_versions: J(claimIds), costs: J({ usd: cost }), citation_completeness: claimIds.length ? 1 : 0, reproduction_instructions: `Re-run ${operationType} on folder ${folderId || "(none)"} / segment ${segmentId || "(none)"}.`, created_at: now });
      });
      write();
      events.append({ projectId, eventType: "artifact_generated", objectType: "artifact", objectId: artId, summary: `${operationType} → artifact "${title || operationType}"`, artifactIds: [artId], pointers: { manifestId: manId, sources: sourceIds.length } });
      return { operationId: opId, artifactId: artId, manifestId: manId };
    },
    listByProject(projectId) { return stmts.artByProject.all(projectId); },
    manifestFor(artifactId) { return stmts.manByArtifact.get(artifactId) || null; },
  };

  // ── Decisions (§14 Q1: solo override stamp) + integrity check ──
  const decisions = {
    create({ projectId, questionId = null, analysisId = null, title, statement, decisionType = "go_no_go", ownerId = "user", reviewDate = null, supportingEvidenceIds = [], rationale = "", integrity = {}, override = null }) {
      const id = uuid(); const now = isoNow();
      stmts.decInsert.run({
        id, project_id: projectId, question_id: questionId, analysis_id: analysisId,
        title: title || "Decision", statement: statement || "", decision_type: decisionType,
        status: override ? "approved_with_override" : (integrity.blockers ? "blocked" : "approved"),
        owner_id: ownerId, decision_date: now, review_date: reviewDate,
        supporting_evidence_ids: J(supportingEvidenceIds), rationale, integrity_check: J(integrity),
        override: override ? J(override) : null, created_at: now, updated_at: now,
      });
      events.append({ projectId, eventType: "decision_recorded", objectType: "decision", objectId: id, summary: `decision: ${title}`, trust: { blockers: integrity.blockers || 0, override: !!override } });
      return id;
    },
    listByProject(projectId) { return stmts.decByProject.all(projectId); },
  };

  // ── H14: members + reviews (local collaboration, honest identity) ──
  const ROLES = ["owner", "reviewer", "contributor", "viewer"];
  const collab = {
    roles: ROLES,
    addMember({ name, email = null, role = "reviewer" }) {
      if (!name) throw new Error("member name required");
      const id = uuid();
      stmts.memInsert.run({ id, name: String(name).slice(0, 80), email: email && String(email).slice(0, 120), role: ROLES.includes(role) ? role : "reviewer", avatar_seed: name.slice(0, 2).toUpperCase(), created_at: isoNow() });
      return id;
    },
    listMembers() { return stmts.memList.all(); },
    removeMember(id) { stmts.memDeactivate.run(id); },
    requestReview({ projectId, decisionId, memberId }) {
      const id = uuid();
      stmts.revInsert.run({ id, project_id: projectId, decision_id: decisionId, member_id: memberId, requested_at: isoNow() });
      events.append({ projectId, eventType: "review_requested", objectType: "decision", objectId: decisionId, summary: `review requested from member ${memberId}` });
      return id;
    },
    resolveReview({ reviewId, status, comment = "" }) {
      const r = stmts.revGet.get(reviewId); if (!r) throw new Error("review not found");
      stmts.revResolve.run({ id: reviewId, status: status === "approved" ? "approved" : "rejected", comment, resolved_at: isoNow() });
      events.append({ projectId: r.project_id, eventType: "review_resolved", objectType: "decision", objectId: r.decision_id, summary: `review ${status}` });
      return true;
    },
    reviewsForDecision(decisionId) { return stmts.revByDecision.all(decisionId); },
    reviewsForProject(projectId) { return stmts.revByProject.all(projectId); },
  };

  return {
    SUBSTRATE_SCHEMA_VERSION,
    meta,
    fts,
    vectors,
    confidence,
    events,
    runs,
    sources,
    evidence,
    hypotheses,
    artifacts,
    decisions,
    collab,
    // raw handle for later waves that add their own prepared statements
    _db: db,
  };
}

module.exports = { createSubstrate, SUBSTRATE_SCHEMA_VERSION, classifyConfidence };
