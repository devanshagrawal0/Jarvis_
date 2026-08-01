"use strict";

const crypto = require("node:crypto");

const EXCLUDED_TABLE = /(?:_fts(?:_|$)|vector|embedding|access_log|debug|trace|telemetry|token_usage|provider_cache|raw_(?:news|response|payload|document|events?)|api_(?:key|secret)|secret|activity_events|memory_queries|memory_temp_|integration_health_events|(?:action_macro|skill|agent|memory_os_agent)_runs|local_file_(?:operations|patches|sessions)|coop_(?:chat_messages|events|file_access|jarvis_messages|memory_packets|patches|replays|skill_transfers)|mesh_(?:control_events|inbox_items|overlays|replays|stream_events)|helix_(?:action_log|events|retrieval_events|session_tokens|tool_results|workflow_node_runs)|forge_agent_sessions|apex_(?:bars|bot_events|equity_curve|fills|news_events|news_impact|news_stories|orders|paper_closes|positions|quotes_live|signals)|(?:feature_cache|news_log)|eclipse_(?:events|graph_runs|node_runs)|(?:checkpoints|writes)|command_log|habits|sessions$)/i;
const GENERATED_SOURCE = /(?:debug|test|fixture|synthetic|generated|telemetry)/i;
const PROTECTED_TABLE = /(?:personal_(?:profile|context)|owner_profile|protected_profile|identity|preferences?|goals?|routines?|health_(?:profile|metrics)|contact_methods?|contacts?|locations?|subscriptions?|trips?|core_memory_blocks?)/i;
const PROCEDURE_TABLE = /(?:skill|macro|procedure|habit|command_pattern|task_pattern|browser_workflow|answer_frame|task_to_skill)/i;
const CONTINUITY_TABLE = /(?:continuity|referent|conversation_state|session_state|working_(?:state|memory)|carryover_summaries?)/i;
const ARTIFACT_TABLE = /(?:artifact|file_registry|memory_file_index|memory_objects?|source_files?|documents?)/i;
const DOMAIN_TABLE = /(?:helix|apex|forge|eclipse|mesh|coop|project|agents?|missions?)/i;
const MEMORY_TABLE = /^(?:memories|ms_memories|facts?|patterns?|capability_memory|belief_revisions|episodes)$/i;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(canonical(value)); }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function textOf(row) { return String(row.text ?? row.content ?? row.value ?? row.summary ?? row.description ?? row.name ?? "").trim(); }
function metadataOf(row) { try { return typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : (row.metadata || {}); } catch { return {}; } }

function reconstructScope({ row = {}, table = "", sourceKey = "" } = {}) {
  const metadata = metadataOf(row);
  const project = row.project_id || row.projectId || metadata.projectId || metadata.project_id;
  if (project && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(String(project))) {
    return { scope: `project:${project}`, confidence: 0.98, reason: "explicit_project", review: false };
  }
  if (PROTECTED_TABLE.test(table) || /user-context/i.test(sourceKey) || row.protected === 1 || metadata.protected === true) {
    return { scope: "owner:local", confidence: 0.96, reason: "protected_owner_seed", review: true };
  }
  const explicit = row.scope_id || row.scopeId || metadata.scopeId || metadata.scope_id;
  if (explicit && String(explicit) !== "global" && /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(String(explicit))) {
    return { scope: String(explicit), confidence: 0.92, reason: "explicit_legacy_scope", review: false };
  }
  const source = `${sourceKey} ${row.source || ""} ${metadata.source || ""}`;
  if (GENERATED_SOURCE.test(source)) return { scope: "unscoped-review", confidence: 1, reason: "generated_or_debug", review: true, reject: true };
  return { scope: "unscoped-review", confidence: 0.35, reason: "ambiguous_global_scope", review: true };
}

function containsSecretMaterial(row) {
  return Object.keys(row || {}).some((key) => /(?:api[_-]?key|secret|password|token|credential|private[_-]?key)/i.test(key) && row[key] != null && String(row[key]).trim());
}

function adaptLegacyRecord({ sourceKey, sourceKind = "sqlite", table, row, legacyId } = {}) {
  const record = row && typeof row === "object" ? { ...row } : {};
  const id = String(legacyId ?? record.id ?? record.memory_id ?? record.key ?? sha256(stableJson(record)).slice(0, 24));
  const sourceRecordHash = sha256(stableJson(record));
  if (EXCLUDED_TABLE.test(String(table)) || containsSecretMaterial(record)) {
    return { legacyId: id, sourceRecordHash, decision: "rejected", exclusionReason: containsSecretMaterial(record) ? "secret_material" : "rebuildable_projection_or_telemetry", recordType: "excluded", scope: reconstructScope({ row: record, table, sourceKey }) };
  }
  const scope = reconstructScope({ row: record, table, sourceKey });
  if (scope.reject) return { legacyId: id, sourceRecordHash, decision: "rejected", exclusionReason: scope.reason, recordType: "excluded", scope };
  let recordType = "quarantine";
  if (PROTECTED_TABLE.test(table) || /user-context/i.test(sourceKey)) recordType = "protected_personal_candidate";
  else if (PROCEDURE_TABLE.test(table)) recordType = "procedure_candidate";
  else if (CONTINUITY_TABLE.test(table)) recordType = "working_state_candidate";
  else if (ARTIFACT_TABLE.test(table)) recordType = "artifact_pointer_candidate";
  else if (DOMAIN_TABLE.test(table) || /(?:helix|apex|forge|eclipse|mesh|coop|missions?)/i.test(sourceKey)) recordType = "domain_manifest_candidate";
  else if (MEMORY_TABLE.test(table)) recordType = "memory_candidate";
  const text = textOf(record);
  const normalizedText = text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const typedKey = record.key || record.predicate || (record.kind && record.name ? `${record.kind}:${record.name}` : null);
  const payload = recordType === "domain_manifest_candidate"
    ? { sourceKey, sourceKind, table, legacyId: id, pointer: record.path || record.file_path || record.project_id || record.id || id, version: record.version || record.updated_at || null }
    : recordType === "artifact_pointer_candidate"
      ? { sourceKey, table, legacyId: id, path: record.path || record.file_path || null, hash: record.sha256 || record.content_hash || null, mediaType: record.mime_type || record.media_type || null }
      : { ...record, legacyId: id, sourceKey, legacyTable: table };
  const sensitivity = recordType === "protected_personal_candidate" ? "restricted" : "private";
  const requiresOwnerReview = scope.review || ["protected_personal_candidate", "procedure_candidate", "domain_manifest_candidate", "quarantine"].includes(recordType);
  return {
    legacyId: id,
    sourceRecordHash,
    recordType,
    scope,
    sensitivity,
    payload,
    provenance: { sourceKey, sourceKind, table, legacyId: id, sourceRecordHash },
    normalizedHash: normalizedText ? sha256(normalizedText) : null,
    typedKeyHash: typedKey ? sha256(`${recordType}:${String(typedKey).toLocaleLowerCase().trim()}`) : null,
    decision: recordType === "quarantine" ? "quarantined" : "pending",
    exclusionReason: recordType === "quarantine" ? "unmapped_legacy_shape" : null,
    requiresOwnerReview,
  };
}

module.exports = { adaptLegacyRecord, canonical, containsSecretMaterial, reconstructScope, sha256, stableJson };
