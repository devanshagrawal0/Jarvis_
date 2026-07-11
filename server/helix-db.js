const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function isoNow() {
  return new Date().toISOString();
}

// Safe JSON.parse: returns fallback if input is invalid or contains prototype pollution keys
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function safeDbJson(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) { if (PROTO_KEYS.has(key)) return fallback; }
    }
    return parsed ?? fallback;
  } catch { return fallback; }
}

const STRAND_KEYWORDS = {
  evidence: /\b(find|research|evidence|source|study|data|fact|what is|who is|when did|how does|explain|cite|paper|article|prove|show me|look up|investigate)\b/,
  strategy: /\b(plan|strategy|option|approach|should|recommend|roadmap|decision|risk|tradeoff|goal|objective|how to|best way|which|prioritize|consider)\b/,
  construction: /\b(build|code|test|prototype|implement|develop|run|create|make|deploy|debug|function|class|script|write|generate|execute)\b/,
  memory: /\b(remember|save|note|store|recall|what have|summarize|history|context|log|what did|what was|review|capture)\b/,
  signal: /\b(market|kalshi|price|signal|news|live|rate|contract|position|trade|ticker|move|trend)\b/,
  synthesis: /\b(brief|compile|report|export|synthesize|output|generate brief|write up|draft|assemble|package)\b/,
};

function classifyStrand(text) {
  const t = text.toLowerCase();
  for (const [strand, re] of Object.entries(STRAND_KEYWORDS)) {
    if (re.test(t)) return strand;
  }
  return "evidence";
}

// Exponential decay: confidence(t) = c0 * e^(-k * days)  Half-life = ln(2)/k
const STRAND_DECAY_RATES = {
  evidence:     0.005,   // half-life ~139 days
  strategy:     0.001,   // half-life ~693 days
  construction: 0.02,    // half-life ~35 days
  memory:       0.0002,  // half-life ~9.5 years
  signal:       0.1,     // half-life ~7 days
  synthesis:    0,       // no decay
};

function computeDecayedValue(value, strand, createdAt) {
  const k = STRAND_DECAY_RATES[strand] ?? 0.005;
  if (k === 0) return value;
  const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0.05, value * Math.exp(-k * days));
}

function createHelixDb(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  const dbPath = path.join(runtimeDir, "helix.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS helix_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Untitled Project',
      objective TEXT DEFAULT '',
      mode TEXT DEFAULT 'research',
      helix_score INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_inquiries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      text TEXT NOT NULL,
      strand TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_entries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      inquiry_id TEXT,
      strand TEXT NOT NULL,
      query TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL DEFAULT 0.82,
      locked INTEGER DEFAULT 0,
      voided INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_vault (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT DEFAULT '',
      rejected_alternatives TEXT DEFAULT '[]',
      rollback_path TEXT DEFAULT '',
      strand TEXT NOT NULL,
      query TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_annotations (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      text TEXT NOT NULL,
      color TEXT DEFAULT 'blue',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_contradictions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_a_id TEXT NOT NULL,
      entry_b_id TEXT NOT NULL,
      contradiction_type TEXT DEFAULT 'factual',
      severity TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      resolution_type TEXT DEFAULT '',
      resolution_text TEXT DEFAULT '',
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_redteam_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      critiques_json TEXT DEFAULT '[]',
      verdict_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS helix_triangulations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      angle_a_json TEXT DEFAULT '{}',
      angle_b_json TEXT DEFAULT '{}',
      angle_c_json TEXT DEFAULT '{}',
      agree INTEGER DEFAULT 0,
      contested INTEGER DEFAULT 0,
      oppose INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS helix_entries_project ON helix_entries(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_vault_project ON helix_vault(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_inquiries_project ON helix_inquiries(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_contradictions_project ON helix_contradictions(project_id, status);
    CREATE TABLE IF NOT EXISTS helix_strategy_options (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      options_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_assumptions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      assumption_type TEXT DEFAULT 'implicit',
      status TEXT DEFAULT 'active',
      challenge_session_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_risks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      text TEXT NOT NULL,
      severity TEXT DEFAULT 'medium',
      likelihood TEXT DEFAULT 'medium',
      category TEXT DEFAULT 'execution',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_causal_chains (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      chain_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS helix_redteam_project ON helix_redteam_sessions(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_triangulations_entry ON helix_triangulations(entry_id);
    CREATE INDEX IF NOT EXISTS helix_strategy_options_entry ON helix_strategy_options(entry_id);
    CREATE INDEX IF NOT EXISTS helix_assumptions_project ON helix_assumptions(project_id, status);
    CREATE INDEX IF NOT EXISTS helix_risks_project ON helix_risks(project_id);
    CREATE INDEX IF NOT EXISTS helix_causal_chains_entry ON helix_causal_chains(entry_id);

    CREATE TABLE IF NOT EXISTS helix_scenarios (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      base_json TEXT DEFAULT '{}',
      scenario_type TEXT DEFAULT 'full',
      variables_json TEXT DEFAULT '[]',
      divergence_point TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_scenario_variants (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      label TEXT DEFAULT '',
      type TEXT DEFAULT 'optimistic',
      delta_json TEXT DEFAULT '[]',
      outcome_json TEXT DEFAULT '{}',
      probability REAL DEFAULT 0.5,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_prior_art (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entry_id TEXT NOT NULL UNIQUE,
      exists_json TEXT DEFAULT '{"items":[]}',
      failures_json TEXT DEFAULT '{"items":[]}',
      gaps_json TEXT DEFAULT '{"items":[]}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS helix_scenarios_project ON helix_scenarios(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_scenarios_entry ON helix_scenarios(entry_id);
    CREATE INDEX IF NOT EXISTS helix_scenario_variants_scenario ON helix_scenario_variants(scenario_id);
    CREATE INDEX IF NOT EXISTS helix_prior_art_project ON helix_prior_art(project_id);

    CREATE TABLE IF NOT EXISTS helix_living_brief (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      sections_json TEXT DEFAULT '{}',
      section_timestamps_json TEXT DEFAULT '{}',
      last_visited_at TEXT,
      version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_oracle_queries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_insights (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS helix_oracle_project ON helix_oracle_queries(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_insights_project ON helix_insights(project_id, status, created_at);

    -- Wave 7 — Knowledge Reservoir
    CREATE TABLE IF NOT EXISTS helix_files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      filetype TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      claim_count INTEGER DEFAULT 0,
      contradiction_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'processing',
      processed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_file_claims (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      chunk_index INTEGER DEFAULT 0,
      linked_entry_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS helix_files_project ON helix_files(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_file_claims_file ON helix_file_claims(file_id);
    CREATE INDEX IF NOT EXISTS helix_file_claims_project ON helix_file_claims(project_id);

    -- Wave 8 — The Forge
    CREATE TABLE IF NOT EXISTS forge_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      mode TEXT NOT NULL DEFAULT 'document',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forge_blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      confidence REAL DEFAULT 1.0,
      strand TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forge_agent_sessions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      messages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS forge_snapshots (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      blocks_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS forge_docs_project ON forge_documents(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS forge_blocks_doc ON forge_blocks(document_id, order_index);
    CREATE INDEX IF NOT EXISTS forge_snapshots_doc ON forge_snapshots(document_id, created_at);

    -- Wave 9 — Workflow Studio
    CREATE TABLE IF NOT EXISTS helix_workflows (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL DEFAULT 'Untitled Workflow',
      description TEXT NOT NULL DEFAULT '',
      graph_json TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helix_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      result_summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS helix_workflow_node_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_type TEXT NOT NULL DEFAULT '',
      node_label TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      input_json TEXT NOT NULL DEFAULT 'null',
      output_json TEXT NOT NULL DEFAULT 'null',
      error TEXT,
      started_at TEXT,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS helix_workflows_project ON helix_workflows(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS helix_workflow_runs_wf ON helix_workflow_runs(workflow_id, started_at);
    CREATE INDEX IF NOT EXISTS helix_workflow_node_runs_run ON helix_workflow_node_runs(run_id);

    -- Wave 10 — Relation Graph & Entity System
    CREATE TABLE IF NOT EXISTS helix_entities (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      entity_type TEXT NOT NULL DEFAULT 'concept',
      mention_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_entities_project ON helix_entities(project_id, entity_type);
    CREATE UNIQUE INDEX IF NOT EXISTS helix_entities_uniq ON helix_entities(project_id, canonical_name);

    CREATE TABLE IF NOT EXISTS helix_entity_relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      entity_a_id TEXT NOT NULL,
      entity_b_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL DEFAULT 'related',
      weight REAL NOT NULL DEFAULT 1.0,
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, entity_a_id, entity_b_id, relationship_type)
    );
    CREATE INDEX IF NOT EXISTS helix_entity_relations_project ON helix_entity_relations(project_id);

    -- Wave 10 — Agent Builder
    CREATE TABLE IF NOT EXISTS helix_custom_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      output_format TEXT NOT NULL DEFAULT 'text',
      run_count INTEGER NOT NULL DEFAULT 0,
      last_result TEXT DEFAULT '',
      last_run_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_custom_agents_project ON helix_custom_agents(project_id, created_at);

    -- Wave 10 — Session token tracking
    CREATE TABLE IF NOT EXISTS helix_session_tokens (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      route TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_session_tokens_project ON helix_session_tokens(project_id, created_at);
    CREATE INDEX IF NOT EXISTS helix_workflow_runs_project ON helix_workflow_runs(project_id, started_at);

    -- Wave 11 — Layout presets
    CREATE TABLE IF NOT EXISTS helix_layouts (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT NOT NULL,
      is_preset INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_layouts_project ON helix_layouts(project_id, created_at);

    -- Wave 12 — Signal Strand
    CREATE TABLE IF NOT EXISTS helix_signals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      signal_type TEXT NOT NULL DEFAULT 'price',
      title TEXT NOT NULL DEFAULT '',
      value_json TEXT NOT NULL DEFAULT 'null',
      ttl_seconds INTEGER NOT NULL DEFAULT 3600,
      expires_at TEXT NOT NULL,
      linked_evidence_id TEXT,
      alert_rule_id TEXT,
      strand TEXT NOT NULL DEFAULT 'signal',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_signals_project ON helix_signals(project_id, expires_at);
    CREATE INDEX IF NOT EXISTS helix_signals_expires ON helix_signals(expires_at);

    -- Wave 12 — Alert rules (threshold-based Wire alerts)
    CREATE TABLE IF NOT EXISTS helix_alert_rules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      signal_type TEXT NOT NULL DEFAULT 'price',
      source TEXT NOT NULL DEFAULT 'kalshi',
      condition TEXT NOT NULL DEFAULT 'above',
      threshold REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_alert_rules_project ON helix_alert_rules(project_id);

    -- Wave 13 — Sessions & Capsules
    CREATE TABLE IF NOT EXISTS helix_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      inquiry_count INTEGER NOT NULL DEFAULT 0,
      discoveries INTEGER NOT NULL DEFAULT 0,
      decisions_locked INTEGER NOT NULL DEFAULT 0,
      wire_snapshot TEXT NOT NULL DEFAULT '[]',
      panel_layout_json TEXT NOT NULL DEFAULT '{}',
      insights_json TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS helix_sessions_project ON helix_sessions(project_id, started_at);

    CREATE TABLE IF NOT EXISTS helix_capsules (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      data_json TEXT NOT NULL DEFAULT '{}',
      entry_count INTEGER NOT NULL DEFAULT 0,
      vault_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS helix_capsules_project ON helix_capsules(project_id, created_at);
  `);

  // Runtime migrations for existing DBs
  try {
    try {
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS helix_entity_relations_uniq ON helix_entity_relations(project_id, entity_a_id, entity_b_id, relationship_type)`);
    } catch (_e) {
      // Deduplicate then retry
      db.exec(`DELETE FROM helix_entity_relations WHERE id NOT IN (SELECT MIN(id) FROM helix_entity_relations GROUP BY project_id, entity_a_id, entity_b_id, relationship_type)`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS helix_entity_relations_uniq ON helix_entity_relations(project_id, entity_a_id, entity_b_id, relationship_type)`);
    }
  } catch (migErr) {
    console.warn("[helix-db] migration warning (non-fatal):", migErr.message);
  }

  // Wave 1-A — Tab classification columns on helix_entries (nullable, safe for existing rows)
  for (const col of ["tab_primary", "tab_secondary", "tab_meta", "structured_resp", "workflow_stage"]) {
    try { db.exec(`ALTER TABLE helix_entries ADD COLUMN ${col} TEXT`); } catch { /* already exists */ }
  }
  // Wave 1-A — New tables: tab corrections, action log, generated tab tracker
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS helix_tab_corrections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      original_type TEXT NOT NULL,
      corrected_type TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS helix_tab_corrections_project ON helix_tab_corrections(project_id, created_at)`);
    db.exec(`CREATE TABLE IF NOT EXISTS helix_action_log (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      action TEXT NOT NULL,
      delta_confidence REAL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_log_entry ON helix_action_log(entry_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_action_log_project ON helix_action_log(project_id, created_at)`);
    db.exec(`CREATE TABLE IF NOT EXISTS helix_generated_tabs (
      id TEXT PRIMARY KEY,
      original_type TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      sections_json TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 1,
      project_id TEXT,
      created_at TEXT NOT NULL
    )`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS helix_generated_tabs_type ON helix_generated_tabs(original_type)`);
  } catch (tabMigErr) {
    console.warn("[helix-db] tab-classifier table migration (non-fatal):", tabMigErr.message);
  }

  // Folder system — helix_folders table + folder_id on entries
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS helix_folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#4a9eff',
      icon TEXT DEFAULT '◈',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS helix_folders_project ON helix_folders(project_id, sort_order)`);
  } catch { /* non-fatal */ }
  try { db.exec(`ALTER TABLE helix_entries ADD COLUMN folder_id TEXT`); } catch { /* already exists */ }

  // Deep Brief table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS helix_deep_briefs (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      summary TEXT,
      deep_analysis TEXT,
      key_findings TEXT DEFAULT '[]',
      what_this_means TEXT,
      pros TEXT DEFAULT '[]',
      cons TEXT DEFAULT '[]',
      confidence_reasoning TEXT,
      recommended_actions TEXT DEFAULT '[]',
      how_to_proceed TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS helix_deep_briefs_entry ON helix_deep_briefs(entry_id)`);
  } catch { /* non-fatal */ }

  // Upgrade deep briefs table with drift + attribution columns (idempotent)
  for (const sql of [
    "ALTER TABLE helix_deep_briefs ADD COLUMN finding_sources TEXT DEFAULT '[]'",
    "ALTER TABLE helix_deep_briefs ADD COLUMN previous_summary TEXT DEFAULT ''",
    "ALTER TABLE helix_deep_briefs ADD COLUMN previous_analysis TEXT DEFAULT ''",
    "ALTER TABLE helix_deep_briefs ADD COLUMN regeneration_count INTEGER DEFAULT 0",
    "ALTER TABLE helix_deep_briefs ADD COLUMN last_regenerated_at TEXT DEFAULT ''",
    "ALTER TABLE helix_deep_briefs ADD COLUMN drift_score REAL DEFAULT 0",
  ]) { try { db.exec(sql); } catch { /* already exists */ } }

  // Pattern Scans table
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS helix_pattern_scans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      summary TEXT DEFAULT '',
      patterns TEXT DEFAULT '[]',
      convergences TEXT DEFAULT '[]',
      contradictions TEXT DEFAULT '[]',
      blind_spots TEXT DEFAULT '[]',
      entry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS helix_pattern_scans_project ON helix_pattern_scans(project_id, created_at DESC)`);
  } catch { /* non-fatal */ }

  const stmts = {
    createProject:  db.prepare(`INSERT INTO helix_projects (id, name, objective, mode, helix_score, created_at, updated_at) VALUES (?, ?, ?, 'research', 0, ?, ?)`),
    getProject:     db.prepare(`SELECT * FROM helix_projects WHERE id = ?`),
    listProjects:   db.prepare(`SELECT * FROM helix_projects ORDER BY updated_at DESC`),
    updateProject:  db.prepare(`UPDATE helix_projects SET name = ?, objective = ?, updated_at = ? WHERE id = ?`),
    updateScore:    db.prepare(`UPDATE helix_projects SET helix_score = ?, updated_at = ? WHERE id = ?`),

    createInquiry:  db.prepare(`INSERT INTO helix_inquiries (id, project_id, text, strand, created_at) VALUES (?, ?, ?, ?, ?)`),

    createEntry:    db.prepare(`INSERT INTO helix_entries (id, project_id, inquiry_id, strand, query, text, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    listEntries:    db.prepare(`SELECT * FROM helix_entries WHERE project_id = ? AND voided = 0 ORDER BY created_at ASC`),
    listRecent:     db.prepare(`SELECT * FROM helix_entries WHERE project_id = ? AND voided = 0 AND id != ? ORDER BY created_at DESC LIMIT 20`),
    getEntry:       db.prepare(`SELECT * FROM helix_entries WHERE id = ?`),
    lockEntry:      db.prepare(`UPDATE helix_entries SET locked = 1 WHERE id = ?`),
    voidEntry:      db.prepare(`UPDATE helix_entries SET voided = 1 WHERE id = ?`),
    countByStrand:  db.prepare(`SELECT strand, COUNT(*) as count FROM helix_entries WHERE project_id = ? AND voided = 0 GROUP BY strand`),

    createVaultEntry: db.prepare(`INSERT INTO helix_vault (id, project_id, entry_id, summary, rationale, rejected_alternatives, rollback_path, strand, query, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    listVault:      db.prepare(`SELECT * FROM helix_vault WHERE project_id = ? ORDER BY created_at DESC`),
    getVaultEntry:  db.prepare(`SELECT * FROM helix_vault WHERE id = ?`),
    vaultExists:    db.prepare(`SELECT id FROM helix_vault WHERE entry_id = ?`),

    createContradiction: db.prepare(`INSERT INTO helix_contradictions (id, project_id, entry_a_id, entry_b_id, contradiction_type, severity, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`),
    listContradictions:  db.prepare(`SELECT * FROM helix_contradictions WHERE project_id = ? ORDER BY created_at DESC`),
    countOpen:           db.prepare(`SELECT COUNT(*) as count FROM helix_contradictions WHERE project_id = ? AND status = 'open'`),
    resolveContradiction: db.prepare(`UPDATE helix_contradictions SET status = 'resolved', resolution_type = ?, resolution_text = ?, resolved_at = ? WHERE id = ?`),
    dupCheck:            db.prepare(`SELECT id FROM helix_contradictions WHERE ((entry_a_id = ? AND entry_b_id = ?) OR (entry_a_id = ? AND entry_b_id = ?)) AND status = 'open'`),
    contradictedIds:     db.prepare(`SELECT entry_a_id, entry_b_id FROM helix_contradictions WHERE project_id = ? AND status = 'open'`),

    createStrategyOptions: db.prepare(`INSERT INTO helix_strategy_options (id, project_id, entry_id, options_json, created_at) VALUES (?, ?, ?, ?, ?)`),
    updateStrategyOptions: db.prepare(`UPDATE helix_strategy_options SET options_json = ?, created_at = ? WHERE id = ?`),
    getStrategyOptions:    db.prepare(`SELECT * FROM helix_strategy_options WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`),
    listStrategyOptions:   db.prepare(`SELECT * FROM helix_strategy_options WHERE project_id = ? ORDER BY created_at DESC`),

    createAssumption:      db.prepare(`INSERT INTO helix_assumptions (id, project_id, entry_id, text, confidence, assumption_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`),
    listAssumptions:       db.prepare(`SELECT * FROM helix_assumptions WHERE project_id = ? ORDER BY created_at DESC`),
    challengeAssumption:   db.prepare(`UPDATE helix_assumptions SET status = 'challenged', challenge_session_id = ? WHERE id = ?`),

    createRisk:            db.prepare(`INSERT INTO helix_risks (id, project_id, entry_id, text, severity, likelihood, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    listRisks:             db.prepare(`SELECT * FROM helix_risks WHERE project_id = ? ORDER BY created_at DESC`),

    createCausalChain:     db.prepare(`INSERT INTO helix_causal_chains (id, project_id, entry_id, chain_json, created_at) VALUES (?, ?, ?, ?, ?)`),
    getLatestCausalChain:  db.prepare(`SELECT * FROM helix_causal_chains WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`),

    createRedteamSession:  db.prepare(`INSERT INTO helix_redteam_sessions (id, project_id, entry_id, status, critiques_json, verdict_json, created_at) VALUES (?, ?, ?, 'pending', '[]', '{}', ?)`),
    updateRedteamSession:  db.prepare(`UPDATE helix_redteam_sessions SET status = 'complete', critiques_json = ?, verdict_json = ?, completed_at = ? WHERE id = ?`),
    getRedteamSession:     db.prepare(`SELECT * FROM helix_redteam_sessions WHERE id = ?`),
    listRedteamSessions:   db.prepare(`SELECT * FROM helix_redteam_sessions WHERE project_id = ? ORDER BY created_at DESC`),
    latestRedteamForEntry: db.prepare(`SELECT * FROM helix_redteam_sessions WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`),

    createTriangulation:   db.prepare(`INSERT INTO helix_triangulations (id, project_id, entry_id, angle_a_json, angle_b_json, angle_c_json, agree, contested, oppose, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getTriangulation:      db.prepare(`SELECT * FROM helix_triangulations WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`),
    listTriangulations:    db.prepare(`SELECT * FROM helix_triangulations WHERE project_id = ? ORDER BY created_at DESC`),

    // Wave 5 — Scenarios & Prior Art
    createScenario:            db.prepare(`INSERT INTO helix_scenarios (id, project_id, entry_id, name, base_json, scenario_type, variables_json, divergence_point, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    createScenarioVariant:     db.prepare(`INSERT INTO helix_scenario_variants (id, scenario_id, project_id, label, type, delta_json, outcome_json, probability, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getLatestScenarioForEntry: db.prepare(`SELECT * FROM helix_scenarios WHERE entry_id = ? ORDER BY created_at DESC LIMIT 1`),
    listScenarioVariants:      db.prepare(`SELECT * FROM helix_scenario_variants WHERE scenario_id = ? ORDER BY probability DESC`),
    listScenarios:             db.prepare(`SELECT * FROM helix_scenarios WHERE project_id = ? ORDER BY created_at DESC`),
    upsertPriorArt:            db.prepare(`INSERT INTO helix_prior_art (id, project_id, entry_id, exists_json, failures_json, gaps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET exists_json=excluded.exists_json, failures_json=excluded.failures_json, gaps_json=excluded.gaps_json, updated_at=excluded.updated_at`),
    getPriorArt:               db.prepare(`SELECT * FROM helix_prior_art WHERE entry_id = ?`),
    listPriorArt:              db.prepare(`SELECT * FROM helix_prior_art WHERE project_id = ? ORDER BY created_at DESC`),

    // Wave 6 — Living Brief, Oracle, Insights
    createLivingBrief: db.prepare(`INSERT INTO helix_living_brief (id, project_id, sections_json, section_timestamps_json, created_at) VALUES (?, ?, '{}', '{}', ?)`),
    getLivingBrief:    db.prepare(`SELECT * FROM helix_living_brief WHERE project_id = ?`),
    updateLivingBrief: db.prepare(`UPDATE helix_living_brief SET sections_json = ?, section_timestamps_json = ?, version = ? WHERE project_id = ?`),
    markBriefVisited:  db.prepare(`UPDATE helix_living_brief SET last_visited_at = ? WHERE project_id = ?`),
    createOracleQuery: db.prepare(`INSERT INTO helix_oracle_queries (id, project_id, question, answer_json, created_at) VALUES (?, ?, ?, ?, ?)`),
    listOracleQueries: db.prepare(`SELECT * FROM helix_oracle_queries WHERE project_id = ? ORDER BY created_at DESC LIMIT 10`),
    createInsight:     db.prepare(`INSERT INTO helix_insights (id, project_id, type, title, content, confidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`),
    listInsights:      db.prepare(`SELECT * FROM helix_insights WHERE project_id = ? AND status = 'active' ORDER BY confidence DESC`),
    dismissInsight:    db.prepare(`UPDATE helix_insights SET status = 'dismissed' WHERE id = ?`),
    clearInsights:     db.prepare(`UPDATE helix_insights SET status = 'dismissed' WHERE project_id = ?`),

    // Wave 7 — Knowledge Reservoir
    // Wave 8 — The Forge
    createForgeDoc:       db.prepare(`INSERT INTO forge_documents (id, project_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`),
    getForgeDoc:          db.prepare(`SELECT * FROM forge_documents WHERE id = ?`),
    listForgeDocs:        db.prepare(`SELECT * FROM forge_documents WHERE project_id = ? ORDER BY updated_at DESC`),
    updateForgeDocTitle:  db.prepare(`UPDATE forge_documents SET title = ?, updated_at = ? WHERE id = ?`),
    updateForgeDocMode:   db.prepare(`UPDATE forge_documents SET mode = ?, updated_at = ? WHERE id = ?`),
    touchForgeDoc:        db.prepare(`UPDATE forge_documents SET updated_at = ? WHERE id = ?`),
    deleteForgeDoc:       db.prepare(`DELETE FROM forge_documents WHERE id = ?`),
    createForgeBlock:     db.prepare(`INSERT INTO forge_blocks (id, document_id, type, content, source_type, source_id, confidence, strand, order_index, locked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`),
    listForgeBlocks:      db.prepare(`SELECT * FROM forge_blocks WHERE document_id = ? ORDER BY order_index ASC`),
    updateForgeBlock:     db.prepare(`UPDATE forge_blocks SET content = ? WHERE id = ?`),
    updateForgeBlockOrder:db.prepare(`UPDATE forge_blocks SET order_index = ? WHERE id = ?`),
    deleteForgeBlock:     db.prepare(`DELETE FROM forge_blocks WHERE id = ?`),
    deleteForgeBlocks:    db.prepare(`DELETE FROM forge_blocks WHERE document_id = ?`),
    lockForgeBlock:       db.prepare(`UPDATE forge_blocks SET locked = 1 WHERE id = ?`),
    getForgeSession:      db.prepare(`SELECT * FROM forge_agent_sessions WHERE document_id = ?`),
    upsertForgeSession:   db.prepare(`INSERT INTO forge_agent_sessions (id, document_id, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(document_id) DO UPDATE SET messages_json=excluded.messages_json, updated_at=excluded.updated_at`),
    createForgeSnapshot:  db.prepare(`INSERT INTO forge_snapshots (id, document_id, blocks_json, created_at) VALUES (?, ?, ?, ?)`),
    listForgeSnapshots:   db.prepare(`SELECT id, document_id, created_at FROM forge_snapshots WHERE document_id = ? ORDER BY created_at DESC LIMIT 20`),
    getForgeSnapshot:     db.prepare(`SELECT * FROM forge_snapshots WHERE id = ?`),

    // Wave 7 — Knowledge Reservoir
    createFile:        db.prepare(`INSERT INTO helix_files (id, project_id, filename, filetype, file_hash, status, created_at) VALUES (?, ?, ?, ?, ?, 'processing', ?)`),
    getFile:           db.prepare(`SELECT * FROM helix_files WHERE id = ?`),
    listFiles:         db.prepare(`SELECT * FROM helix_files WHERE project_id = ? ORDER BY created_at DESC`),
    getFileByHash:     db.prepare(`SELECT * FROM helix_files WHERE project_id = ? AND file_hash = ? ORDER BY created_at DESC LIMIT 1`),
    updateFileReady:   db.prepare(`UPDATE helix_files SET status = 'ready', claim_count = ?, processed_at = ? WHERE id = ?`),
    updateFileFailed:  db.prepare(`UPDATE helix_files SET status = 'failed', processed_at = ? WHERE id = ?`),
    updateFileContradictions: db.prepare(`UPDATE helix_files SET contradiction_count = ? WHERE id = ?`),
    deleteFile:        db.prepare(`DELETE FROM helix_files WHERE id = ?`),
    createFileClaim:   db.prepare(`INSERT INTO helix_file_claims (id, file_id, project_id, text, confidence, chunk_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    listFileClaims:    db.prepare(`SELECT * FROM helix_file_claims WHERE file_id = ? ORDER BY chunk_index ASC`),
    listAllFileClaims: db.prepare(`SELECT * FROM helix_file_claims WHERE project_id = ? ORDER BY created_at DESC`),

    // Wave 10 — Relation Graph & Entity System
    upsertEntity:         db.prepare(`INSERT INTO helix_entities (id, project_id, canonical_name, aliases_json, entity_type, mention_count, created_at) VALUES (?, ?, ?, ?, ?, 1, ?) ON CONFLICT(project_id, canonical_name) DO UPDATE SET mention_count = mention_count + 1, aliases_json = excluded.aliases_json`),
    listEntities:         db.prepare(`SELECT * FROM helix_entities WHERE project_id = ? ORDER BY mention_count DESC`),
    getEntityByName:      db.prepare(`SELECT * FROM helix_entities WHERE project_id = ? AND canonical_name = ?`),
    upsertEntityRelation: db.prepare(`INSERT INTO helix_entity_relations (id, project_id, entity_a_id, entity_b_id, relationship_type, weight, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, entity_a_id, entity_b_id, relationship_type) DO UPDATE SET weight = excluded.weight`),
    listEntityRelations:  db.prepare(`SELECT * FROM helix_entity_relations WHERE project_id = ?`),
    deleteEntities:       db.prepare(`DELETE FROM helix_entities WHERE project_id = ?`),
    deleteEntityRelations:db.prepare(`DELETE FROM helix_entity_relations WHERE project_id = ?`),
    // Wave 10 — Agent Builder
    createCustomAgent:    db.prepare(`INSERT INTO helix_custom_agents (id, project_id, name, system_prompt, trigger_type, output_format, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    listCustomAgents:     db.prepare(`SELECT * FROM helix_custom_agents WHERE project_id = ? ORDER BY created_at DESC`),
    getCustomAgent:       db.prepare(`SELECT * FROM helix_custom_agents WHERE id = ?`),
    updateCustomAgentRun: db.prepare(`UPDATE helix_custom_agents SET run_count = run_count + 1, last_result = ?, last_run_at = ? WHERE id = ?`),
    deleteCustomAgent:    db.prepare(`DELETE FROM helix_custom_agents WHERE id = ?`),
    // Wave 10 — Token tracking
    logTokens:            db.prepare(`INSERT INTO helix_session_tokens (id, project_id, route, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
    sumTokens:            db.prepare(`SELECT SUM(input_tokens) as total_in, SUM(output_tokens) as total_out FROM helix_session_tokens WHERE project_id = ?`),
    sumAllTokens:         db.prepare(`SELECT SUM(input_tokens) as total_in, SUM(output_tokens) as total_out FROM helix_session_tokens WHERE created_at > ?`),

    // Wave 11 — Layout presets
    createLayout:  db.prepare(`INSERT INTO helix_layouts (id, project_id, name, is_preset, config_json, created_at) VALUES (?, ?, ?, 0, ?, ?)`),
    listLayouts:   db.prepare(`SELECT * FROM helix_layouts WHERE (project_id = ? OR project_id IS NULL) ORDER BY is_preset DESC, created_at DESC`),
    deleteLayout:  db.prepare(`DELETE FROM helix_layouts WHERE id = ? AND is_preset = 0`),

    // Wave 12 — Signal Strand
    createSignal:       db.prepare(`INSERT INTO helix_signals (id, project_id, source, signal_type, title, value_json, ttl_seconds, expires_at, linked_evidence_id, alert_rule_id, strand, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signal', ?)`),
    listSignals:        db.prepare(`SELECT * FROM helix_signals WHERE project_id = ? ORDER BY created_at DESC LIMIT 200`),
    listLiveSignals:    db.prepare(`SELECT * FROM helix_signals WHERE project_id = ? AND expires_at > ? ORDER BY created_at DESC`),
    getSignal:          db.prepare(`SELECT * FROM helix_signals WHERE id = ?`),
    deleteSignal:       db.prepare(`DELETE FROM helix_signals WHERE id = ?`),
    pruneExpiredSignals:db.prepare(`DELETE FROM helix_signals WHERE expires_at <= ?`),
    // Wave 12 — Alert rules
    createAlertRule:    db.prepare(`INSERT INTO helix_alert_rules (id, project_id, name, signal_type, source, condition, threshold, message, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`),
    listAlertRules:     db.prepare(`SELECT * FROM helix_alert_rules WHERE project_id = ? ORDER BY created_at DESC`),
    getAlertRule:       db.prepare(`SELECT * FROM helix_alert_rules WHERE id = ?`),
    updateAlertRule:    db.prepare(`UPDATE helix_alert_rules SET name = ?, condition = ?, threshold = ?, message = ?, active = ? WHERE id = ?`),
    deleteAlertRule:    db.prepare(`DELETE FROM helix_alert_rules WHERE id = ?`),
    touchAlertRule:     db.prepare(`UPDATE helix_alert_rules SET last_triggered_at = ? WHERE id = ?`),

    // Wave 13 — Sessions & Capsules
    createSession:      db.prepare(`INSERT INTO helix_sessions (id, project_id, summary, inquiry_count, discoveries, decisions_locked, wire_snapshot, panel_layout_json, insights_json, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    updateSession:      db.prepare(`UPDATE helix_sessions SET summary = ?, inquiry_count = ?, discoveries = ?, decisions_locked = ?, wire_snapshot = ?, panel_layout_json = ?, insights_json = ?, ended_at = ? WHERE id = ?`),
    listSessions:       db.prepare(`SELECT * FROM helix_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`),
    getSession:         db.prepare(`SELECT * FROM helix_sessions WHERE id = ?`),
    getLatestSession:   db.prepare(`SELECT * FROM helix_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`),
    deleteSession:      db.prepare(`DELETE FROM helix_sessions WHERE id = ?`),
    createCapsule:      db.prepare(`INSERT INTO helix_capsules (id, project_id, label, data_json, entry_count, vault_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    listCapsules:       db.prepare(`SELECT id, project_id, label, entry_count, vault_count, created_at FROM helix_capsules WHERE project_id = ? ORDER BY created_at DESC LIMIT 20`),
    getCapsule:         db.prepare(`SELECT * FROM helix_capsules WHERE id = ?`),
    deleteCapsule:      db.prepare(`DELETE FROM helix_capsules WHERE id = ?`),

    // Wave 9 — Workflow Studio
    createWorkflow:      db.prepare(`INSERT INTO helix_workflows (id, project_id, name, description, graph_json, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    getWorkflow:         db.prepare(`SELECT * FROM helix_workflows WHERE id = ?`),
    listWorkflows:       db.prepare(`SELECT * FROM helix_workflows WHERE (project_id = ? OR project_id IS NULL) ORDER BY is_builtin DESC, updated_at DESC`),
    updateWorkflow:      db.prepare(`UPDATE helix_workflows SET name = ?, description = ?, graph_json = ?, updated_at = ? WHERE id = ? AND is_builtin = 0`),
    deleteWorkflow:      db.prepare(`DELETE FROM helix_workflows WHERE id = ? AND is_builtin = 0`),
    countBuiltins:       db.prepare(`SELECT COUNT(*) as count FROM helix_workflows WHERE is_builtin = 1`),
    createWfRun:         db.prepare(`INSERT INTO helix_workflow_runs (id, workflow_id, project_id, status, started_at) VALUES (?, ?, ?, 'running', ?)`),
    getWfRun:            db.prepare(`SELECT * FROM helix_workflow_runs WHERE id = ?`),
    updateWfRun:         db.prepare(`UPDATE helix_workflow_runs SET status = ?, completed_at = ?, result_summary = ? WHERE id = ?`),
    listWfRuns:          db.prepare(`SELECT * FROM helix_workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20`),
    listProjectWfRuns:   db.prepare(`SELECT * FROM helix_workflow_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`),
    createNodeRun:       db.prepare(`INSERT INTO helix_workflow_node_runs (id, run_id, node_id, node_type, node_label, status) VALUES (?, ?, ?, ?, ?, 'pending')`),
    startNodeRun:        db.prepare(`UPDATE helix_workflow_node_runs SET status = 'running', started_at = ? WHERE id = ?`),
    completeNodeRun:     db.prepare(`UPDATE helix_workflow_node_runs SET status = 'complete', output_json = ?, completed_at = ? WHERE id = ?`),
    failNodeRun:         db.prepare(`UPDATE helix_workflow_node_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ?`),
    listNodeRuns:        db.prepare(`SELECT * FROM helix_workflow_node_runs WHERE run_id = ? ORDER BY rowid ASC`),
    deleteFileClaims:  db.prepare(`DELETE FROM helix_file_claims WHERE file_id = ?`),
    linkFileClaim:     db.prepare(`UPDATE helix_file_claims SET linked_entry_id = ? WHERE id = ?`),

    // Wave 1-A — Tab classification
    updateEntryTabData:  db.prepare(`UPDATE helix_entries SET tab_primary = ?, tab_secondary = ?, tab_meta = ?, structured_resp = ?, workflow_stage = ? WHERE id = ?`),
    getEntryTabMeta:     db.prepare(`SELECT tab_primary, tab_secondary, tab_meta, structured_resp, workflow_stage FROM helix_entries WHERE id = ?`),
    listByTabType:       db.prepare(`SELECT * FROM helix_entries WHERE project_id = ? AND tab_primary = ? AND voided = 0 ORDER BY created_at DESC LIMIT 10`),
    updateWorkflowStage: db.prepare(`UPDATE helix_entries SET workflow_stage = ? WHERE id = ?`),

    // Wave 1-C — Tab corrections
    logTabCorrection:    db.prepare(`INSERT INTO helix_tab_corrections (id, project_id, query_text, original_type, corrected_type, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())`),
    listTabCorrections:  db.prepare(`SELECT * FROM helix_tab_corrections WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`),
    countTabCorrections: db.prepare(`SELECT COUNT(*) as count FROM helix_tab_corrections WHERE project_id = ?`),

    // Wave 3-A — Action log
    logAction:           db.prepare(`INSERT INTO helix_action_log (id, entry_id, project_id, action, delta_confidence, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())`),
    listActionLog:       db.prepare(`SELECT * FROM helix_action_log WHERE entry_id = ? ORDER BY created_at DESC`),
    listProjectActions:  db.prepare(`SELECT * FROM helix_action_log WHERE project_id = ? ORDER BY created_at DESC LIMIT 200`),

    // Wave 2-C — Generated tab tracker
    upsertGeneratedTab:  db.prepare(`INSERT INTO helix_generated_tabs (id, original_type, label, sections_json, use_count, project_id, created_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(original_type) DO UPDATE SET use_count = use_count + 1, label = excluded.label, sections_json = excluded.sections_json`),
    listGeneratedTabs:   db.prepare(`SELECT * FROM helix_generated_tabs WHERE use_count >= 5 ORDER BY use_count DESC`),

    // Folder system
    createFolder:        db.prepare(`INSERT INTO helix_folders (id, project_id, name, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    listFolders:         db.prepare(`SELECT * FROM helix_folders WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC`),
    getFolder:           db.prepare(`SELECT * FROM helix_folders WHERE id = ?`),
    updateFolder:        db.prepare(`UPDATE helix_folders SET name = ?, color = ?, icon = ? WHERE id = ?`),
    deleteFolder:        db.prepare(`DELETE FROM helix_folders WHERE id = ?`),
    clearFolderEntries:  db.prepare(`UPDATE helix_entries SET folder_id = NULL WHERE folder_id = ?`),
    updateEntryFolder:   db.prepare(`UPDATE helix_entries SET folder_id = ? WHERE id = ?`),
    countFolders:        db.prepare(`SELECT COUNT(*) as n FROM helix_folders WHERE project_id = ?`),

    // Deep Brief
    upsertDeepBrief:     db.prepare(`INSERT INTO helix_deep_briefs (id, entry_id, project_id, summary, deep_analysis, key_findings, what_this_means, pros, cons, confidence_reasoning, recommended_actions, how_to_proceed, finding_sources, previous_summary, previous_analysis, regeneration_count, last_regenerated_at, drift_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET summary=excluded.summary, deep_analysis=excluded.deep_analysis, key_findings=excluded.key_findings, what_this_means=excluded.what_this_means, pros=excluded.pros, cons=excluded.cons, confidence_reasoning=excluded.confidence_reasoning, recommended_actions=excluded.recommended_actions, how_to_proceed=excluded.how_to_proceed, finding_sources=excluded.finding_sources, previous_summary=excluded.previous_summary, previous_analysis=excluded.previous_analysis, regeneration_count=excluded.regeneration_count, last_regenerated_at=excluded.last_regenerated_at, drift_score=excluded.drift_score, updated_at=excluded.updated_at`),
    getDeepBrief:        db.prepare(`SELECT * FROM helix_deep_briefs WHERE entry_id = ?`),
    listProjectBriefIds: db.prepare(`SELECT entry_id FROM helix_deep_briefs WHERE project_id = ?`),
    upsertPatternScan:   db.prepare(`INSERT INTO helix_pattern_scans (id, project_id, summary, patterns, convergences, contradictions, blind_spots, entry_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getLatestPatternScan: db.prepare(`SELECT * FROM helix_pattern_scans WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`),
  };

  function getContradictedSet(projectId) {
    const rows = stmts.contradictedIds.all(projectId);
    const ids = new Set();
    for (const r of rows) { ids.add(r.entry_a_id); ids.add(r.entry_b_id); }
    return ids;
  }

  function enrichEntries(rawEntries, contradictedSet) {
    return rawEntries.map(e => {
      const freshness = computeDecayedValue(1, e.strand, e.created_at);
      const confidence = computeDecayedValue(e.confidence, e.strand, e.created_at);
      return {
        ...e,
        confidence,
        original_confidence: e.confidence,
        freshness,
        contradicted: contradictedSet.has(e.id) ? 1 : 0,
        tab_meta: safeDbJson(e.tab_meta, null),
        structured_resp: safeDbJson(e.structured_resp, null),
      };
    });
  }

  function computeScore(projectId) {
    const raw = stmts.listEntries.all(projectId);
    const vault = stmts.listVault.all(projectId);
    const strandCounts = stmts.countByStrand.all(projectId);
    const openContradictions = stmts.countOpen.get(projectId)?.count ?? 0;

    const evidenceCount = raw.filter(e => e.strand === "evidence").length;
    const strategyCount = raw.filter(e => e.strand === "strategy").length;
    const vaultCount = vault.length;
    const avgConf = raw.length > 0
      ? raw.reduce((a, e) => a + computeDecayedValue(e.confidence || 0.82, e.strand, e.created_at), 0) / raw.length
      : 0;
    const uniqueStrands = new Set(strandCounts.map(s => s.strand)).size;

    let score = 0;
    score += Math.min(35, evidenceCount * 7);
    score += Math.min(20, vaultCount * 5);
    score += Math.min(20, Math.round(avgConf * 20));
    score += Math.min(10, uniqueStrands * 2);
    score += Math.min(15, strategyCount * 5);
    score -= openContradictions * 10;

    const final = Math.round(Math.max(0, Math.min(100, score)));
    stmts.updateScore.run(final, isoNow(), projectId);
    return final;
  }

  function getOrCreateDefaultProject() {
    const all = stmts.listProjects.all();
    if (all.length > 0) return all[0];
    const now = isoNow();
    const id = crypto.randomUUID();
    stmts.createProject.run(id, "Untitled Project", "", now, now);
    return stmts.getProject.get(id);
  }

  function getStrandHealth(projectId) {
    const counts = stmts.countByStrand.all(projectId);
    const map = {};
    for (const row of counts) map[row.strand] = row.count;
    const TARGETS = { evidence: 5, strategy: 3, construction: 3, memory: 4, signal: 5, synthesis: 2 };
    const health = {};
    for (const [strand, target] of Object.entries(TARGETS)) {
      health[strand] = Math.min(1, (map[strand] || 0) / target);
    }
    return health;
  }

  return {
    classifyStrand,
    STRAND_DECAY_RATES,

    // Projects
    listProjects: () => stmts.listProjects.all(),
    getProject: (id) => stmts.getProject.get(id),
    createProject: (name, objective = "") => {
      const now = isoNow();
      const id = crypto.randomUUID();
      stmts.createProject.run(id, name || "Untitled Project", objective, now, now);
      return stmts.getProject.get(id);
    },
    updateProject: (id, name, objective) => {
      stmts.updateProject.run(name, objective, isoNow(), id);
      return stmts.getProject.get(id);
    },
    getOrCreateDefaultProject,

    // Entries
    createEntry: db.transaction((projectId, queryText, strand, responseText, confidence = 0.82) => {
      const now = isoNow();
      const inquiryId = crypto.randomUUID();
      const entryId = crypto.randomUUID();
      stmts.createInquiry.run(inquiryId, projectId, queryText, strand, now);
      stmts.createEntry.run(entryId, projectId, inquiryId, strand, queryText, responseText, confidence, now);
      computeScore(projectId);
      return stmts.getEntry.get(entryId);
    }),
    listEntries: (projectId) => {
      const raw = stmts.listEntries.all(projectId);
      const contradictedSet = getContradictedSet(projectId);
      return enrichEntries(raw, contradictedSet);
    },
    listRecentEntries: (projectId, excludeId) => stmts.listRecent.all(projectId, excludeId),
    getEntry: (id) => stmts.getEntry.get(id),
    voidEntry: (id) => { stmts.voidEntry.run(id); },

    // Vault
    lockToVault: db.transaction((projectId, entryId, rationale = "") => {
      const entry = stmts.getEntry.get(entryId);
      if (!entry) throw new Error("Entry not found");
      if (stmts.vaultExists.get(entryId)) throw new Error("Already locked");
      stmts.lockEntry.run(entryId);
      const now = isoNow();
      const vaultId = crypto.randomUUID();
      // summary = truncated response text; query stored separately in the query column
      const summary = (entry.text || entry.query || "").slice(0, 500);
      stmts.createVaultEntry.run(vaultId, projectId, entryId, summary, rationale, "[]", "", entry.strand, entry.query, now);
      computeScore(projectId);
      return stmts.getVaultEntry.get(vaultId);
    }),
    listVault: (projectId) => stmts.listVault.all(projectId),

    // Contradictions
    createContradiction: db.transaction((projectId, entryAId, entryBId, type, severity) => {
      if (stmts.dupCheck.get(entryAId, entryBId, entryBId, entryAId)) return null;
      const id = crypto.randomUUID();
      stmts.createContradiction.run(id, projectId, entryAId, entryBId, type || "factual", severity || "medium", isoNow());
      computeScore(projectId);
      return id;
    }),
    listContradictions: (projectId) => stmts.listContradictions.all(projectId),
    countOpenContradictions: (projectId) => stmts.countOpen.get(projectId)?.count ?? 0,
    resolveContradiction: (id, type, text) => {
      stmts.resolveContradiction.run(type || "acknowledged", text || "", isoNow(), id);
    },

    // Strategy Options
    upsertStrategyOptions: (projectId, entryId, options) => {
      const existing = stmts.getStrategyOptions.get(entryId);
      if (existing) { stmts.updateStrategyOptions.run(JSON.stringify(options), isoNow(), existing.id); return existing.id; }
      const id = crypto.randomUUID();
      stmts.createStrategyOptions.run(id, projectId, entryId, JSON.stringify(options), isoNow());
      return id;
    },
    getStrategyOptions: (entryId) => {
      const r = stmts.getStrategyOptions.get(entryId);
      return r ? { ...r, options: safeDbJson(r.options_json, []) } : null;
    },
    listStrategyOptions: (projectId) => {
      return stmts.listStrategyOptions.all(projectId).map(r => ({ ...r, options: safeDbJson(r.options_json, []) }));
    },

    // Assumptions
    createAssumptions: (projectId, entryId, list) => {
      const ids = [];
      for (const a of (Array.isArray(list) ? list : [])) {
        const id = crypto.randomUUID();
        stmts.createAssumption.run(id, projectId, entryId, a.text || "", Math.max(0, Math.min(1, a.confidence ?? 0.7)), a.assumption_type || "implicit", isoNow());
        ids.push(id);
      }
      return ids;
    },
    listAssumptions: (projectId) => stmts.listAssumptions.all(projectId),
    challengeAssumption: (id, sessionId) => stmts.challengeAssumption.run(sessionId, id),

    // Risks
    createRisks: (projectId, entryId, list) => {
      for (const r of (Array.isArray(list) ? list : [])) {
        const id = crypto.randomUUID();
        stmts.createRisk.run(id, projectId, entryId, r.text || "", r.severity || "medium", r.likelihood || "medium", r.category || "execution", isoNow());
      }
    },
    listRisks: (projectId) => stmts.listRisks.all(projectId),

    // Causal Chains
    createCausalChain: (projectId, entryId, chain) => {
      const id = crypto.randomUUID();
      stmts.createCausalChain.run(id, projectId, entryId, JSON.stringify(chain), isoNow());
      return id;
    },
    getLatestCausalChain: (entryId) => {
      const r = stmts.getLatestCausalChain.get(entryId);
      return r ? { ...r, chain: JSON.parse(r.chain_json || "[]") } : null;
    },

    // Red Team
    createRedteamSession: (projectId, entryId) => {
      const id = crypto.randomUUID();
      stmts.createRedteamSession.run(id, projectId, entryId, isoNow());
      return id;
    },
    completeRedteamSession: (id, critiques, verdict) => {
      stmts.updateRedteamSession.run(JSON.stringify(critiques), JSON.stringify(verdict), isoNow(), id);
      const s = stmts.getRedteamSession.get(id);
      return s ? { ...s, critiques: JSON.parse(s.critiques_json || "[]"), verdict: JSON.parse(s.verdict_json || "{}") } : null;
    },
    getRedteamSession: (id) => {
      const s = stmts.getRedteamSession.get(id);
      if (!s) return null;
      return { ...s, critiques: JSON.parse(s.critiques_json || "[]"), verdict: JSON.parse(s.verdict_json || "{}") };
    },
    listRedteamSessions: (projectId) => {
      return stmts.listRedteamSessions.all(projectId).map(s => ({
        ...s, critiques: JSON.parse(s.critiques_json || "[]"), verdict: JSON.parse(s.verdict_json || "{}"),
      }));
    },
    latestRedteamForEntry: (entryId) => {
      const s = stmts.latestRedteamForEntry.get(entryId);
      if (!s) return null;
      return { ...s, critiques: JSON.parse(s.critiques_json || "[]"), verdict: JSON.parse(s.verdict_json || "{}") };
    },

    // Triangulation
    createTriangulation: (projectId, entryId, angleA, angleB, angleC, agree, contested, oppose, confidence) => {
      const id = crypto.randomUUID();
      stmts.createTriangulation.run(id, projectId, entryId, JSON.stringify(angleA), JSON.stringify(angleB), JSON.stringify(angleC), agree, contested, oppose, Math.max(0, Math.min(1, confidence)), isoNow());
      return id;
    },
    getTriangulation: (entryId) => {
      const t = stmts.getTriangulation.get(entryId);
      if (!t) return null;
      return { ...t, angle_a: JSON.parse(t.angle_a_json || "{}"), angle_b: JSON.parse(t.angle_b_json || "{}"), angle_c: JSON.parse(t.angle_c_json || "{}") };
    },
    listTriangulations: (projectId) => {
      return stmts.listTriangulations.all(projectId).map(t => ({
        ...t, angle_a: JSON.parse(t.angle_a_json || "{}"), angle_b: JSON.parse(t.angle_b_json || "{}"), angle_c: JSON.parse(t.angle_c_json || "{}"),
      }));
    },

    // Scenarios
    createScenario: (projectId, entryId, name, base, type, variables, divergencePoint, variants) => {
      const id = crypto.randomUUID();
      stmts.createScenario.run(id, projectId, entryId, name || "", JSON.stringify(base || {}), type || "full", JSON.stringify(variables || []), divergencePoint || "", isoNow());
      // Cap variant count to prevent runaway Gemini responses (MED-4)
      for (const v of (Array.isArray(variants) ? variants : []).slice(0, 10)) {
        const vid = crypto.randomUUID();
        stmts.createScenarioVariant.run(vid, id, projectId, v.label || "", v.type || "optimistic", JSON.stringify(v.delta || []), JSON.stringify(v.outcome || {}), Math.max(0, Math.min(1, v.probability ?? 0.5)), isoNow());
      }
      return id;
    },
    getLatestScenarioForEntry: (entryId) => {
      const s = stmts.getLatestScenarioForEntry.get(entryId);
      if (!s) return null;
      const variants = stmts.listScenarioVariants.all(s.id).map(v => ({
        ...v, delta: JSON.parse(v.delta_json || "[]"), outcome: JSON.parse(v.outcome_json || "{}"),
      }));
      return { ...s, base: JSON.parse(s.base_json || "{}"), variables: JSON.parse(s.variables_json || "[]"), variants };
    },
    listScenarios: (projectId) => {
      return stmts.listScenarios.all(projectId).map(s => {
        const variants = stmts.listScenarioVariants.all(s.id).map(v => ({
          ...v, delta: JSON.parse(v.delta_json || "[]"), outcome: JSON.parse(v.outcome_json || "{}"),
        }));
        return { ...s, base: JSON.parse(s.base_json || "{}"), variables: JSON.parse(s.variables_json || "[]"), variants };
      });
    },

    // Prior Art
    upsertPriorArt: (projectId, entryId, exists, failures, gaps) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      stmts.upsertPriorArt.run(id, projectId, entryId, JSON.stringify(exists || { items: [] }), JSON.stringify(failures || { items: [] }), JSON.stringify(gaps || { items: [] }), now, now);
      const r = stmts.getPriorArt.get(entryId);
      if (!r) return null;
      return { ...r, exists: JSON.parse(r.exists_json || '{"items":[]}'), failures: JSON.parse(r.failures_json || '{"items":[]}'), gaps: JSON.parse(r.gaps_json || '{"items":[]}') };
    },
    getPriorArt: (entryId) => {
      const r = stmts.getPriorArt.get(entryId);
      if (!r) return null;
      return { ...r, exists: JSON.parse(r.exists_json || '{"items":[]}'), failures: JSON.parse(r.failures_json || '{"items":[]}'), gaps: JSON.parse(r.gaps_json || '{"items":[]}') };
    },
    listPriorArt: (projectId) => {
      return stmts.listPriorArt.all(projectId).map(r => ({
        ...r, exists: JSON.parse(r.exists_json || '{"items":[]}'), failures: JSON.parse(r.failures_json || '{"items":[]}'), gaps: JSON.parse(r.gaps_json || '{"items":[]}'),
      }));
    },

    // Living Brief
    getOrCreateLivingBrief: (projectId) => {
      let b = stmts.getLivingBrief.get(projectId);
      if (!b) { stmts.createLivingBrief.run(crypto.randomUUID(), projectId, isoNow()); b = stmts.getLivingBrief.get(projectId); }
      return b ? { ...b, sections: JSON.parse(b.sections_json || '{}'), sectionTimestamps: JSON.parse(b.section_timestamps_json || '{}') } : null;
    },
    updateBriefSections: (projectId, newSections) => {
      let b = stmts.getLivingBrief.get(projectId);
      if (!b) { stmts.createLivingBrief.run(crypto.randomUUID(), projectId, isoNow()); b = stmts.getLivingBrief.get(projectId); }
      if (!b) return;
      const sections = JSON.parse(b.sections_json || '{}');
      const timestamps = JSON.parse(b.section_timestamps_json || '{}');
      const now = isoNow();
      for (const [k, v] of Object.entries(newSections)) { if (v !== null && v !== undefined) { sections[k] = String(v); timestamps[k] = now; } }
      stmts.updateLivingBrief.run(JSON.stringify(sections), JSON.stringify(timestamps), (b.version || 0) + 1, projectId);
    },
    markBriefVisited: (projectId) => { stmts.markBriefVisited.run(isoNow(), projectId); },

    // Oracle
    saveOracleQuery: (projectId, question, answer) => {
      stmts.createOracleQuery.run(crypto.randomUUID(), projectId, question, JSON.stringify(answer || {}), isoNow());
    },
    listOracleQueries: (projectId) => stmts.listOracleQueries.all(projectId).map(q => ({ ...q, answer: JSON.parse(q.answer_json || '{}') })),

    // Insights
    saveInsights: (projectId, insights) => {
      const insertAll = db.transaction(() => {
        stmts.clearInsights.run(projectId);
        const now = isoNow();
        for (const ins of (Array.isArray(insights) ? insights : [])) {
          stmts.createInsight.run(crypto.randomUUID(), projectId, ins.type || 'pattern', ins.title || '', ins.content || '', Math.max(0, Math.min(1, ins.confidence ?? 0.7)), now);
        }
      });
      insertAll();
    },
    listInsights: (projectId) => stmts.listInsights.all(projectId),
    dismissInsight: (id) => stmts.dismissInsight.run(id),

    // The Forge (Wave 8)
    createForgeDocument: (projectId, title, mode) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      stmts.createForgeDoc.run(id, projectId, title || 'Untitled', mode || 'document', now, now);
      return stmts.getForgeDoc.get(id);
    },
    getForgeDocument: (id) => stmts.getForgeDoc.get(id),
    listForgeDocuments: (projectId) => stmts.listForgeDocs.all(projectId),
    updateForgeDocument: (id, { title, mode }) => {
      const now = isoNow();
      if (title !== undefined) stmts.updateForgeDocTitle.run(title, now, id);
      if (mode !== undefined) stmts.updateForgeDocMode.run(mode, now, id);
      return stmts.getForgeDoc.get(id);
    },
    deleteForgeDocument: (id) => {
      const del = db.transaction(() => {
        stmts.deleteForgeBlocks.run(id);
        stmts.deleteForgeDoc.run(id);
      });
      del();
    },
    bulkSaveForgeBlocks: (documentId, blocks) => {
      const save = db.transaction(() => {
        stmts.deleteForgeBlocks.run(documentId);
        const now = isoNow();
        const safeBlocks = Array.isArray(blocks) ? blocks.filter(b => b && typeof b === "object") : [];
        for (const [i, b] of safeBlocks.entries()) {
          const VALID_TYPES = new Set(["heading","paragraph","list","quote","code","insight","claim","scenario","spatial-note","notes"]);
          const VALID_SOURCES = new Set(["manual","ai","pulled","synthesized"]);
          stmts.createForgeBlock.run(
            b.id || crypto.randomUUID(), documentId,
            VALID_TYPES.has(b.type) ? b.type : 'paragraph',
            typeof b.content === "string" ? b.content.slice(0, 10000) : '',
            VALID_SOURCES.has(b.source_type) ? b.source_type : 'manual',
            b.source_id || null,
            Math.max(0, Math.min(1, Number.isFinite(b.confidence) ? b.confidence : 1.0)),
            b.strand || null, Number.isInteger(b.order_index) ? b.order_index : i, now
          );
        }
        stmts.touchForgeDoc.run(now, documentId);
      });
      save();
      return stmts.listForgeBlocks.all(documentId);
    },
    listForgeBlocks: (documentId) => stmts.listForgeBlocks.all(documentId),
    getForgeAgentSession: (documentId) => {
      const s = stmts.getForgeSession.get(documentId);
      if (!s) return { messages: [] };
      return { ...s, messages: safeDbJson(s.messages_json, []) };
    },
    saveForgeAgentMessage: (documentId, messages) => {
      const now = isoNow();
      stmts.upsertForgeSession.run(crypto.randomUUID(), documentId, JSON.stringify(messages), now, now);
    },
    createForgeSnapshot: (documentId, blocks) => {
      stmts.createForgeSnapshot.run(crypto.randomUUID(), documentId, JSON.stringify(blocks), isoNow());
    },
    listForgeSnapshots: (documentId) => stmts.listForgeSnapshots.all(documentId),
    getForgeSnapshot: (id) => {
      const s = stmts.getForgeSnapshot.get(id);
      if (!s) return null;
      return { ...s, blocks: safeDbJson(s.blocks_json, []) };
    },

    // Knowledge Reservoir (Wave 7)
    createFile: (projectId, filename, filetype, fileHash) => {
      const id = crypto.randomUUID();
      stmts.createFile.run(id, projectId, filename, filetype, fileHash, isoNow());
      return id;
    },
    getFile: (id) => stmts.getFile.get(id),
    getFileByHash: (projectId, hash) => stmts.getFileByHash.get(projectId, hash),
    listFiles: (projectId) => stmts.listFiles.all(projectId),
    markFileReady: (id, claimCount) => stmts.updateFileReady.run(claimCount, isoNow(), id),
    markFileFailed: (id) => stmts.updateFileFailed.run(isoNow(), id),
    updateFileContradictions: (id, count) => stmts.updateFileContradictions.run(count, id),
    deleteFile: (id) => {
      const deleteAll = db.transaction(() => {
        stmts.deleteFileClaims.run(id);
        stmts.deleteFile.run(id);
      });
      deleteAll();
    },
    createFileClaim: (fileId, projectId, text, confidence, chunkIndex) => {
      const id = crypto.randomUUID();
      stmts.createFileClaim.run(id, fileId, projectId, text, Math.max(0, Math.min(1, confidence ?? 0.7)), chunkIndex ?? 0, isoNow());
      return id;
    },
    bulkCreateFileClaims: (fileId, projectId, claims) => {
      const insertAll = db.transaction(() => {
        stmts.deleteFileClaims.run(fileId);
        const now = isoNow();
        for (const [i, c] of (Array.isArray(claims) ? claims : []).entries()) {
          stmts.createFileClaim.run(crypto.randomUUID(), fileId, projectId, c.text || '', Math.max(0, Math.min(1, c.confidence ?? 0.7)), i, now);
        }
      });
      insertAll();
    },
    listFileClaims: (fileId) => stmts.listFileClaims.all(fileId),
    listAllFileClaims: (projectId) => stmts.listAllFileClaims.all(projectId),

    // Wave 10 — Relation Graph & Entity System
    replaceEntities: db.transaction((projectId, entityList, relationList) => {
      const now = isoNow();
      stmts.deleteEntityRelations.run(projectId);
      stmts.deleteEntities.run(projectId);
      for (const e of (Array.isArray(entityList) ? entityList : [])) {
        const name = (e.canonical_name || e.name || "").slice(0, 200);
        if (!name) continue;
        stmts.upsertEntity.run(crypto.randomUUID(), projectId, name, JSON.stringify(e.aliases || []), e.entity_type || "concept", now);
      }
      for (const r of (Array.isArray(relationList) ? relationList : [])) {
        const aRow = stmts.getEntityByName.get(projectId, r.a || "");
        const bRow = stmts.getEntityByName.get(projectId, r.b || "");
        if (!aRow || !bRow || aRow.id === bRow.id) continue;
        stmts.upsertEntityRelation.run(crypto.randomUUID(), projectId, aRow.id, bRow.id, r.type || "related", r.weight ?? 1.0, now);
      }
    }),
    saveEntities: (projectId, entityList, relationList) => {
      const now = isoNow();
      const save = db.transaction(() => {
        for (const e of (Array.isArray(entityList) ? entityList : [])) {
          const name = (e.canonical_name || e.name || "").slice(0, 200);
          if (!name) continue;
          const id = crypto.randomUUID();
          stmts.upsertEntity.run(id, projectId, name, JSON.stringify(e.aliases || []), e.entity_type || "concept", now);
        }
        for (const r of (Array.isArray(relationList) ? relationList : [])) {
          const aRow = stmts.getEntityByName.get(projectId, r.a || "");
          const bRow = stmts.getEntityByName.get(projectId, r.b || "");
          if (!aRow || !bRow) continue;
          stmts.upsertEntityRelation.run(crypto.randomUUID(), projectId, aRow.id, bRow.id, r.type || "related", r.weight ?? 1.0, now);
        }
      });
      save();
    },
    getRelationGraph: (projectId) => ({
      entities: stmts.listEntities.all(projectId).map(e => ({ ...e, aliases: safeDbJson(e.aliases_json, []) })),
      relations: stmts.listEntityRelations.all(projectId),
    }),
    clearEntities: (projectId) => {
      const del = db.transaction(() => {
        stmts.deleteEntityRelations.run(projectId);
        stmts.deleteEntities.run(projectId);
      });
      del();
    },

    // Wave 10 — Agent Builder
    createCustomAgent: (projectId, name, systemPrompt, triggerType, outputFormat) => {
      const id = crypto.randomUUID();
      stmts.createCustomAgent.run(id, projectId || null, (name || "Custom Agent").slice(0, 200), (systemPrompt || "").slice(0, 3000), triggerType || "manual", outputFormat || "text", isoNow());
      return stmts.getCustomAgent.get(id);
    },
    listCustomAgents: (projectId) => stmts.listCustomAgents.all(projectId),
    getCustomAgent: (id) => stmts.getCustomAgent.get(id),
    recordCustomAgentRun: (id, result) => {
      stmts.updateCustomAgentRun.run((result || "").slice(0, 1000), isoNow(), id);
    },
    deleteCustomAgent: (id) => stmts.deleteCustomAgent.run(id),

    // Wave 10 — Token tracking
    logTokenUsage: (projectId, route, inputTokens, outputTokens) => {
      stmts.logTokens.run(crypto.randomUUID(), projectId, route || "unknown", inputTokens | 0, outputTokens | 0, isoNow());
    },
    getTokenUsage: (projectId) => {
      const r = stmts.sumTokens.get(projectId);
      return { input: r?.total_in ?? 0, output: r?.total_out ?? 0, total: (r?.total_in ?? 0) + (r?.total_out ?? 0) };
    },
    getSessionTokenUsage: (sinceIso) => {
      const r = stmts.sumAllTokens.get(sinceIso || new Date(Date.now() - 3600000).toISOString());
      return { input: r?.total_in ?? 0, output: r?.total_out ?? 0, total: (r?.total_in ?? 0) + (r?.total_out ?? 0) };
    },

    // Wave 11 — Layout presets
    createLayout: (projectId, name, config) => {
      const id = crypto.randomUUID();
      stmts.createLayout.run(id, projectId || null, (name || "Layout").slice(0, 100), JSON.stringify(config || {}), isoNow());
      return id;
    },
    listLayouts: (projectId) => stmts.listLayouts.all(projectId).map(l => ({ ...l, config: safeDbJson(l.config_json, {}) })),
    deleteLayout: (id) => { const r = stmts.deleteLayout.run(id); return r.changes > 0; },

    // Wave 12 — Signal Strand
    createSignal: (projectId, source, signalType, title, value, ttlSeconds, linkedEvidenceId, alertRuleId) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      const ttl = Math.max(60, Math.min(86400, Number.isFinite(ttlSeconds) ? ttlSeconds : 3600));
      const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      stmts.createSignal.run(id, projectId, (source || "manual").slice(0, 100), (signalType || "price").slice(0, 50), (title || "").slice(0, 200), JSON.stringify(value ?? null).slice(0, 8000), ttl, expiresAt, linkedEvidenceId || null, alertRuleId || null, now);
      return stmts.getSignal.get(id);
    },
    listSignals: (projectId, liveOnly) => {
      const rows = liveOnly
        ? stmts.listLiveSignals.all(projectId, isoNow())
        : stmts.listSignals.all(projectId);
      return rows.map(s => ({ ...s, value: safeDbJson(s.value_json, null), expired: s.expires_at <= isoNow() }));
    },
    getSignal: (id) => {
      const s = stmts.getSignal.get(id);
      return s ? { ...s, value: safeDbJson(s.value_json, null) } : null;
    },
    deleteSignal: (id) => { stmts.deleteSignal.run(id); },
    pruneSignals: (projectId) => stmts.pruneExpiredSignals.run(isoNow()),
    // Alert rules
    createAlertRule: (projectId, name, signalType, source, condition, threshold, message) => {
      const id = crypto.randomUUID();
      const VALID_CONDITIONS = new Set(["above", "below", "equals", "change_pct"]);
      stmts.createAlertRule.run(id, projectId, (name || "Alert").slice(0, 200), (signalType || "price").slice(0, 50), (source || "kalshi").slice(0, 100), VALID_CONDITIONS.has(condition) ? condition : "above", Number.isFinite(threshold) ? threshold : 0, (message || "").slice(0, 500), isoNow());
      return stmts.getAlertRule.get(id);
    },
    listAlertRules: (projectId) => stmts.listAlertRules.all(projectId),
    getAlertRule: (id) => stmts.getAlertRule.get(id),
    updateAlertRule: (id, name, condition, threshold, message, active) => {
      const VALID_CONDITIONS = new Set(["above", "below", "equals", "change_pct"]);
      stmts.updateAlertRule.run((name || "Alert").slice(0, 200), VALID_CONDITIONS.has(condition) ? condition : "above", Number.isFinite(threshold) ? threshold : 0, (message || "").slice(0, 500), active ? 1 : 0, id);
    },
    deleteAlertRule: (id) => stmts.deleteAlertRule.run(id),
    triggerAlertRule: (id) => stmts.touchAlertRule.run(isoNow(), id),
    // Evaluate alert rules against new signal — returns list of triggered rule IDs
    evaluateAlertRules: (projectId, signalType, value) => {
      const rules = stmts.listAlertRules.all(projectId).filter(r => r.active && r.signal_type === signalType);
      const triggered = [];
      const num = Number.isFinite(value) ? value : null;
      if (num === null) return triggered;
      for (const rule of rules) {
        let fires = false;
        if (rule.condition === "above" && num > rule.threshold) fires = true;
        else if (rule.condition === "below" && num < rule.threshold) fires = true;
        else if (rule.condition === "equals" && Math.abs(num - rule.threshold) < 0.001) fires = true;
        if (fires) triggered.push(rule);
      }
      return triggered;
    },

    // Wave 13 — Sessions & Capsules
    createSession: (projectId, data) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      stmts.createSession.run(
        id, projectId,
        (data.summary || "").slice(0, 2000),
        data.inquiryCount || 0,
        data.discoveries || 0,
        data.decisionsLocked || 0,
        JSON.stringify((Array.isArray(data.wireSnapshot) ? data.wireSnapshot : []).slice(0, 100)),
        JSON.stringify(data.panelLayout || {}),
        JSON.stringify((Array.isArray(data.insights) ? data.insights : []).slice(0, 20)),
        now
      );
      return id;
    },
    closeSession: (id, data) => {
      const existing = stmts.getSession.get(id);
      if (!existing) return false;
      stmts.updateSession.run(
        (data.summary || existing.summary || "").slice(0, 2000),
        data.inquiryCount !== undefined ? data.inquiryCount : existing.inquiry_count,
        data.discoveries !== undefined ? data.discoveries : existing.discoveries,
        data.decisionsLocked !== undefined ? data.decisionsLocked : existing.decisions_locked,
        JSON.stringify((Array.isArray(data.wireSnapshot) ? data.wireSnapshot : []).slice(0, 100)),
        JSON.stringify(data.panelLayout || {}),
        JSON.stringify((Array.isArray(data.insights) ? data.insights : []).slice(0, 20)),
        isoNow(),
        id
      );
      return true;
    },
    listSessions: (projectId) => {
      const rows = stmts.listSessions.all(projectId);
      return rows.map(s => ({
        ...s,
        wire_snapshot: safeDbJson(s.wire_snapshot, []),
        panel_layout: safeDbJson(s.panel_layout_json, {}),
        insights: safeDbJson(s.insights_json, []),
      }));
    },
    getSession: (id) => {
      const s = stmts.getSession.get(id);
      if (!s) return null;
      return { ...s, wire_snapshot: safeDbJson(s.wire_snapshot, []), panel_layout: safeDbJson(s.panel_layout_json, {}), insights: safeDbJson(s.insights_json, []) };
    },
    getLatestSession: (projectId) => {
      const s = stmts.getLatestSession.get(projectId);
      if (!s) return null;
      return { ...s, wire_snapshot: safeDbJson(s.wire_snapshot, []), panel_layout: safeDbJson(s.panel_layout_json, {}), insights: safeDbJson(s.insights_json, []) };
    },
    deleteSession: (id) => { stmts.deleteSession.run(id); },
    createCapsule: (projectId, label, data) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      const json = JSON.stringify(data);
      if (json.length > 5_000_000) throw new Error("Capsule too large (>5MB)");
      stmts.createCapsule.run(id, projectId, (label || "Capsule").slice(0, 200), json, data.entries?.length || 0, data.vault?.length || 0, now);
      return id;
    },
    listCapsules: (projectId) => stmts.listCapsules.all(projectId),
    getCapsule: (id) => {
      const c = stmts.getCapsule.get(id);
      if (!c) return null;
      return { ...c, data: safeDbJson(c.data_json, {}) };
    },
    deleteCapsule: (id) => { const r = stmts.deleteCapsule.run(id); return r.changes > 0; },

    // Wave 9 — Workflow Studio
    createWorkflow: (projectId, name, desc, graph, isBuiltin) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      stmts.createWorkflow.run(id, projectId ?? null, (name || 'Untitled Workflow').slice(0, 200), (desc || '').slice(0, 500), JSON.stringify(graph || { nodes: [], edges: [] }), isBuiltin ? 1 : 0, now, now);
      return id;
    },
    getWorkflow: (id) => {
      const w = stmts.getWorkflow.get(id);
      if (!w) return null;
      return { ...w, graph: safeDbJson(w.graph_json, { nodes: [], edges: [] }) };
    },
    listWorkflows: (projectId) => stmts.listWorkflows.all(projectId),
    updateWorkflow: (id, name, desc, graph) => {
      stmts.updateWorkflow.run((name || 'Untitled Workflow').slice(0, 200), (desc || '').slice(0, 500), JSON.stringify(graph || { nodes: [], edges: [] }), isoNow(), id);
    },
    deleteWorkflow: (id) => { stmts.deleteWorkflow.run(id); },
    countBuiltins: () => stmts.countBuiltins.get()?.count ?? 0,
    createWorkflowRun: (workflowId, projectId) => {
      const id = crypto.randomUUID();
      stmts.createWfRun.run(id, workflowId, projectId, isoNow());
      return id;
    },
    getWorkflowRun: (id) => stmts.getWfRun.get(id),
    updateWorkflowRunStatus: (id, status, summary) => {
      stmts.updateWfRun.run(status, isoNow(), (summary || '').slice(0, 500), id);
    },
    listWorkflowRuns: (workflowId) => stmts.listWfRuns.all(workflowId),
    listWorkflowRunsForProject: (workflowId, projectId) => stmts.listWfRuns.all(workflowId).filter(r => r.project_id === projectId),
    listProjectWorkflowRuns: (projectId) => stmts.listProjectWfRuns.all(projectId),
    createNodeRun: (runId, nodeId, nodeType, nodeLabel) => {
      const id = crypto.randomUUID();
      stmts.createNodeRun.run(id, runId, nodeId, nodeType || '', (nodeLabel || '').slice(0, 200));
      return id;
    },
    startNodeRun: (id) => { stmts.startNodeRun.run(isoNow(), id); },
    completeNodeRun: (id, output) => {
      stmts.completeNodeRun.run(JSON.stringify(output ?? null), isoNow(), id);
    },
    failNodeRun: (id, error) => {
      stmts.failNodeRun.run(String(error || 'Execution error').slice(0, 500), isoNow(), id);
    },
    listNodeRuns: (runId) => stmts.listNodeRuns.all(runId),
    storeWorkflowResult: (projectId, runId, text, label) => {
      const id = crypto.randomUUID();
      const safeLabel = (label || "Workflow Result").slice(0, 200);
      const safeText = (text || "").slice(0, 3000);
      // Create a real synthesis entry so the vault entry_id is valid
      const entryId = crypto.randomUUID();
      stmts.createEntry.run(entryId, projectId, null, "synthesis", `Workflow: ${safeLabel}`, safeText, 0.8, isoNow());
      stmts.createVaultEntry.run(id, projectId, entryId, safeText.slice(0, 500), `Workflow output: ${safeLabel}`, "[]", "", "synthesis", `Workflow: ${safeLabel}`, isoNow());
      return id;
    },

    // Wave 1-A — Tab classification methods
    updateEntryTabData: (entryId, tabPrimary, tabSecondary, tabMeta, structuredResp, workflowStage) => {
      stmts.updateEntryTabData.run(
        tabPrimary || null,
        tabSecondary || null,
        tabMeta ? JSON.stringify(tabMeta) : null,
        structuredResp ? JSON.stringify(structuredResp) : null,
        workflowStage || "captured",
        entryId
      );
    },
    getEntryTabMeta: (entryId) => {
      const r = stmts.getEntryTabMeta.get(entryId);
      if (!r) return null;
      return {
        tab_primary: r.tab_primary,
        tab_secondary: r.tab_secondary,
        tab_meta: safeDbJson(r.tab_meta, null),
        structured_resp: safeDbJson(r.structured_resp, null),
        workflow_stage: r.workflow_stage,
      };
    },
    listEntriesByTabType: (projectId, tabType) => stmts.listByTabType.all(projectId, tabType),
    updateWorkflowStage: (entryId, stage) => stmts.updateWorkflowStage.run(stage, entryId),

    // Wave 1-C — Tab corrections
    logTabCorrection: (projectId, queryText, originalType, correctedType) => {
      stmts.logTabCorrection.run(crypto.randomUUID(), projectId, (queryText || "").slice(0, 200), originalType || "research", correctedType || "research");
      // Keep at most 100 corrections per project — delete oldest beyond that
      db.prepare(`DELETE FROM helix_tab_corrections WHERE project_id = ? AND id NOT IN (SELECT id FROM helix_tab_corrections WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)`).run(projectId, projectId);
    },
    listTabCorrections: (projectId) => stmts.listTabCorrections.all(projectId),
    getTabCorrectionCount: (projectId) => stmts.countTabCorrections.get(projectId)?.count ?? 0,

    // Wave 3-A — Action log
    logAction: (entryId, projectId, action, deltaConfidence, metadata) => {
      const VALID_ACTIONS = new Set(["triangulate","redteam","develop","prior-art","probe","lock","trade","fork","trace","void","deep-brief"]);
      stmts.logAction.run(
        crypto.randomUUID(),
        entryId,
        projectId,
        VALID_ACTIONS.has(action) ? action : "probe",
        Number.isFinite(deltaConfidence) ? deltaConfidence : 0,
        metadata ? JSON.stringify(metadata).slice(0, 2000) : null
      );
    },
    listActionLog: (entryId) => stmts.listActionLog.all(entryId).map(r => ({ ...r, metadata: safeDbJson(r.metadata, null) })),
    listProjectActions: (projectId) => stmts.listProjectActions.all(projectId).map(r => ({ ...r, metadata: safeDbJson(r.metadata, null) })),

    // Wave 2-C — Generated tab tracker (LRU eviction: max 200 rows, drop lowest use_count)
    trackGeneratedTab: (originalType, label, sections, projectId) => {
      stmts.upsertGeneratedTab.run(crypto.randomUUID(), (originalType || "unknown").slice(0, 50), (label || "").slice(0, 100), JSON.stringify(sections || []), projectId || null, isoNow());
      const count = db.prepare("SELECT COUNT(*) AS n FROM helix_generated_tabs").get().n;
      if (count > 200) {
        db.prepare("DELETE FROM helix_generated_tabs WHERE id IN (SELECT id FROM helix_generated_tabs ORDER BY use_count ASC, created_at ASC LIMIT ?)").run(count - 200);
      }
    },
    listHighUsageGeneratedTabs: () => stmts.listGeneratedTabs.all().map(r => ({ ...r, sections: safeDbJson(r.sections_json, []) })),

    // Wave 2-D — Synthesis entry creation
    createSynthesisEntry: (projectId, tabType, query, text) => {
      const id  = crypto.randomUUID();
      const now = isoNow();
      db.prepare(`INSERT INTO helix_entries (id, project_id, strand, query, text, confidence, original_confidence, freshness, contradicted, locked, voided, created_at, tab_primary, workflow_stage) VALUES (?, ?, 'synthesis', ?, ?, 0.9, 0.9, 1.0, 0, 0, 0, ?, ?, 'analyzed')`)
        .run(id, projectId, query, text, now, `synthesis-${tabType}`);
      const raw = db.prepare("SELECT * FROM helix_entries WHERE id = ?").get(id);
      return raw ? { ...raw, tab_meta: safeDbJson(raw.tab_meta, null), structured_resp: safeDbJson(raw.structured_resp, null) } : null;
    },

    // Score + health
    computeScore,
    getScore: (projectId) => computeScore(projectId),
    getStrandHealth,

    // Folder system
    listFolders: (projectId) => stmts.listFolders.all(projectId),
    getFolder: (id) => stmts.getFolder.get(id) || null,
    createFolder: (projectId, name, color, icon, sortOrder) => {
      const id = crypto.randomUUID();
      stmts.createFolder.run(id, projectId, (name || "New Folder").slice(0, 60), color || "#4a9eff", icon || "◈", sortOrder ?? 0, isoNow());
      return stmts.getFolder.get(id);
    },
    updateFolder: (id, name, color, icon) => {
      stmts.updateFolder.run((name || "").slice(0, 60), color || "#4a9eff", icon || "◈", id);
      return stmts.getFolder.get(id);
    },
    deleteFolder: (id) => {
      stmts.clearFolderEntries.run(id);
      stmts.deleteFolder.run(id);
    },
    updateEntryFolder: (entryId, folderId) => {
      stmts.updateEntryFolder.run(folderId || null, entryId);
    },
    seedDefaultFolders: (projectId) => {
      const n = stmts.countFolders.get(projectId)?.n ?? 0;
      if (n > 0) return;
      const defaults = [
        { name: "Inbox",    color: "#4a9eff", icon: "◈", order: 0 },
        { name: "Research", color: "#4affa0", icon: "⬡", order: 1 },
        { name: "Strategy", color: "#c4b5fd", icon: "⊛", order: 2 },
      ];
      for (const d of defaults) {
        stmts.createFolder.run(crypto.randomUUID(), projectId, d.name, d.color, d.icon, d.order, isoNow());
      }
    },

    getDeepBrief: (entryId) => {
      const row = stmts.getDeepBrief.get(entryId);
      if (!row) return null;
      return {
        ...row,
        key_findings: safeDbJson(row.key_findings, []),
        pros: safeDbJson(row.pros, []),
        cons: safeDbJson(row.cons, []),
        recommended_actions: safeDbJson(row.recommended_actions, []),
        finding_sources: safeDbJson(row.finding_sources, []),
        regeneration_count: row.regeneration_count || 0,
        drift_score: row.drift_score || 0,
        previous_summary: row.previous_summary || "",
        previous_analysis: row.previous_analysis || "",
        last_regenerated_at: row.last_regenerated_at || "",
      };
    },
    upsertDeepBrief: (entryId, projectId, data, opts = {}) => {
      const id = crypto.randomUUID();
      const now = isoNow();
      const existing = stmts.getDeepBrief.get(entryId);
      // Drift: compute word-overlap similarity between old and new summary
      let driftScore = 0;
      let prevSummary = "", prevAnalysis = "";
      let regenCount = 0;
      if (existing && opts.isRegenerate) {
        prevSummary  = existing.summary || "";
        prevAnalysis = existing.deep_analysis || "";
        regenCount   = (existing.regeneration_count || 0) + 1;
        const w1 = new Set((prevSummary).toLowerCase().split(/\W+/).filter(w => w.length > 4));
        const w2 = new Set((data.summary || "").toLowerCase().split(/\W+/).filter(w => w.length > 4));
        const inter = [...w1].filter(w => w2.has(w)).length;
        const union = new Set([...w1, ...w2]).size;
        driftScore = union > 0 ? Math.round((1 - inter / union) * 100) / 100 : 0;
      }
      stmts.upsertDeepBrief.run(
        id, entryId, projectId,
        data.summary || "",
        data.deep_analysis || "",
        JSON.stringify(data.key_findings || []),
        data.what_this_means || "",
        JSON.stringify(data.pros || []),
        JSON.stringify(data.cons || []),
        data.confidence_reasoning || "",
        JSON.stringify(data.recommended_actions || []),
        data.how_to_proceed || "",
        JSON.stringify(data.finding_sources || []),
        prevSummary, prevAnalysis, regenCount,
        opts.isRegenerate ? now : (existing?.last_regenerated_at || ""),
        driftScore,
        now, now
      );
      const row = stmts.getDeepBrief.get(entryId);
      if (!row) return null;
      return {
        ...row,
        key_findings: safeDbJson(row.key_findings, []),
        pros: safeDbJson(row.pros, []),
        cons: safeDbJson(row.cons, []),
        recommended_actions: safeDbJson(row.recommended_actions, []),
        finding_sources: safeDbJson(row.finding_sources, []),
        regeneration_count: row.regeneration_count || 0,
        drift_score: row.drift_score || 0,
        previous_summary: row.previous_summary || "",
        previous_analysis: row.previous_analysis || "",
        last_regenerated_at: row.last_regenerated_at || "",
      };
    },

    getProjectBriefIds: (projectId) => {
      const rows = stmts.listProjectBriefIds.all(projectId);
      return rows.map(r => r.entry_id);
    },

    upsertPatternScan: (projectId, data) => {
      const id = crypto.randomUUID();
      stmts.upsertPatternScan.run(
        id, projectId,
        data.summary || "",
        JSON.stringify(data.patterns || []),
        JSON.stringify(data.convergences || []),
        JSON.stringify(data.contradictions || []),
        JSON.stringify(data.blind_spots || []),
        data.entry_count || 0,
        isoNow()
      );
      return id;
    },

    getLatestPatternScan: (projectId) => {
      const row = stmts.getLatestPatternScan.get(projectId);
      if (!row) return null;
      return {
        ...row,
        patterns:       safeDbJson(row.patterns, []),
        convergences:   safeDbJson(row.convergences, []),
        contradictions: safeDbJson(row.contradictions, []),
        blind_spots:    safeDbJson(row.blind_spots, []),
      };
    },

    dbPath,
  };
}

module.exports = { createHelixDb, classifyStrand };
