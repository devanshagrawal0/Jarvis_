"use strict";

const crypto = require("node:crypto");

const ECLIPSE_GROUPS = Object.freeze({
  missions: "mission", branches: "branch", nodes: "node", claims: "claim", evidence: "evidence",
  artifacts: "artifact", agents: "agent", agentOutcomes: "outcome", tasks: "task", operations: "operation",
});
const VISIBILITY = new Set(["owner", "mission", "agent_private", "quarantined"]);
const TRUST = new Set(["trusted", "untrusted", "agent_private"]);
const FORBIDDEN = new Set(["reasoning", "reasoningTrace", "reasoning_trace", "chainOfThought", "chain_of_thought", "scratchpad", "rawPrompt", "rawResponse", "messages"]);

function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function structural(value, label) { const text = String(value ?? "").trim(); if (!/^[A-Za-z0-9][A-Za-z0-9:._/@-]{0,255}$/.test(text)) throw new Error(`${label} must be a bounded structural identifier.`); return text; }
function assertNoReasoning(value) { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value)) { if (FORBIDDEN.has(key)) throw Object.assign(new Error("Eclipse memory cannot publish raw reasoning or private scratch state."), { code: "ECLIPSE_REASONING_TRACE_REJECTED", key }); assertNoReasoning(child); } }
function refKey(item) { return `${item.kind}:${item.id}:${item.version}`; }

function createEclipseIntegrationRepository({ db, keyring, clock, faultInjector, rooms }) {
  if (Number(db.pragma("user_version", { simple: true })) < 25) throw new Error("Eclipse memory integration requires schema version 25.");
  function digest(value, purpose) { return keyring.sign(JSON.stringify(canonical(value)), purpose); }
  function authorize(scopeId, allowed) { if (!(allowed || []).map(String).includes(String(scopeId))) throw Object.assign(new Error("Eclipse memory scope is denied."), { code: "ECLIPSE_SCOPE_DENIED" }); }
  function collect(input) {
    const refs = [];
    for (const [field, kind] of Object.entries(ECLIPSE_GROUPS)) {
      for (const source of input[field] || []) {
        assertNoReasoning(source);
        const { recall = {}, ...item } = source;
        refs.push({ ...item, kind, domainOwner: "eclipse", recall });
      }
    }
    return refs;
  }
  function normalizePolicy(item, missionId) {
    const visibility = String(item.recall.visibility || (item.kind === "claim" && item.recall.trustZone === "untrusted" ? "quarantined" : "mission"));
    const trustZone = String(item.recall.trustZone || (visibility === "agent_private" ? "agent_private" : "trusted"));
    if (!VISIBILITY.has(visibility) || !TRUST.has(trustZone)) throw new Error("Eclipse recall policy is invalid.");
    if (visibility === "owner" && trustZone !== "trusted") throw Object.assign(new Error("Untrusted or agent-private state cannot enter owner-wide recall."), { code: "ECLIPSE_OWNER_WIDE_LEAK_REJECTED" });
    const subjectId = item.recall.subjectId ? structural(item.recall.subjectId, "Eclipse recall subject") : visibility === "mission" ? missionId : null;
    if (visibility === "agent_private" && !subjectId) throw new Error("Agent-private recall requires an agent subject.");
    let expiresAt = null;
    if (item.recall.expiresAt) { const parsed = new Date(item.recall.expiresAt); if (!Number.isFinite(parsed.getTime())) throw new Error("Eclipse recall expiry is invalid."); expiresAt = parsed.toISOString(); }
    return { visibility, trustZone, subjectId, capability: structural(item.recall.capability || "eclipse.recall", "Eclipse recall capability"), leaseId: item.recall.leaseId ? structural(item.recall.leaseId, "Eclipse recall lease") : null, expiresAt };
  }

  function publishMissionSnapshot(input = {}) {
    const scopeId = structural(input.scopeId, "Eclipse scope"); authorize(scopeId, input.allowedScopeIds || [scopeId]);
    const missionId = structural(input.missionId, "Eclipse mission"); const collected = collect(input);
    const policies = collected.map((item) => ({ ref: { kind: item.kind, id: structural(item.id, "Eclipse reference ID"), version: structural(item.version, "Eclipse reference version") }, policy: normalizePolicy(item, missionId) }));
    const refs = collected.map(({ recall, ...item }) => item);
    const exclusions = [
      ...(input.reasoningTraceRefs || []).map((item) => ({ domainRef: String(item.id), kind: "raw_body", reasonCode: "ECLIPSE_REASONING_TRACE_NOT_MEMORY" })),
      ...(input.privateAgentStateRefs || []).map((item) => ({ domainRef: String(item.id), kind: "private_agent", reasonCode: "ECLIPSE_AGENT_PRIVATE_STATE_NOT_GLOBAL" })),
      ...(input.telemetryRefs || []).map((item) => ({ domainRef: String(item.id), kind: "telemetry", reasonCode: "ECLIPSE_TELEMETRY_DOMAIN_OWNED" })),
    ];
    const run = db.transaction(() => {
      const room = rooms.publish({ ...input, room: "eclipse", projectId: missionId, runId: input.runId || missionId, refs, exclusions });
      const existing = db.prepare("SELECT COUNT(*) AS count FROM eclipse_manifest_policies WHERE manifest_id=?").get(room.id).count;
      if (room.replayed && Number(existing) !== policies.length) throw Object.assign(new Error("Replayed Eclipse manifest policy coverage differs."), { code: "ECLIPSE_POLICY_REPLAY_MISMATCH" });
      if (!room.replayed) for (const item of policies) db.prepare(`INSERT INTO eclipse_manifest_policies
        (id,manifest_id,ref_kind,ref_id,ref_version,visibility,capability,subject_id,lease_id,trust_zone,expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), room.id, item.ref.kind, item.ref.id, item.ref.version, item.policy.visibility, item.policy.capability, item.policy.subjectId, item.policy.leaseId, item.policy.trustZone, item.policy.expiresAt, clock().toISOString());
      faultInjector("eclipse.publish.before_commit");
      return { ...room, policyCount: policies.length };
    });
    return run.immediate();
  }

  function recall(input = {}) {
    const missionId = structural(input.missionId, "Eclipse mission");
    const manifest = rooms.current({ room: "eclipse", projectId: missionId, allowedScopeIds: input.allowedScopeIds || [] });
    if (!manifest) return null;
    const capabilities = new Set((input.capabilities || []).map(String)); const requesterId = String(input.requesterId || ""); const at = input.at ? new Date(input.at) : clock();
    if (!Number.isFinite(at.getTime())) throw new Error("Eclipse recall time is invalid.");
    const policies = db.prepare("SELECT * FROM eclipse_manifest_policies WHERE manifest_id=?").all(manifest.id);
    const visible = new Set(policies.filter((row) => {
      if (row.expires_at && new Date(row.expires_at) < at) return false;
      if (!capabilities.has(row.capability)) return false;
      if (row.visibility === "agent_private") return requesterId === row.subject_id;
      if (row.visibility === "mission") return requesterId === row.subject_id || capabilities.has("eclipse.recall.mission:any");
      if (row.visibility === "quarantined") return input.includeQuarantined === true && capabilities.has("eclipse.recall.quarantine");
      return row.visibility === "owner" && requesterId === "local-owner";
    }).map((row) => `${row.ref_kind}:${row.ref_id}:${row.ref_version}`));
    const refs = manifest.refs.filter((item) => visible.has(refKey(item)));
    const packages = manifest.packages.filter((item) => item.refs.every((ref) => visible.has(refKey(ref))));
    return { ...manifest, refs, packages, filteredRefCount: manifest.refs.length - refs.length };
  }

  function recordAgentOutcome(input = {}) {
    const scopeId = structural(input.scopeId, "Agent outcome scope"); authorize(scopeId, input.allowedScopeIds || [scopeId]);
    const manifest = db.prepare("SELECT scope_id,room,project_id FROM room_manifests WHERE id=?").get(String(input.manifestId));
    if (!manifest || manifest.room !== "eclipse" || manifest.scope_id !== scopeId) throw new Error("Agent outcome requires a scope-matched Eclipse manifest.");
    const verification = db.prepare("SELECT scope_id,success FROM outcome_verifications WHERE id=?").get(String(input.verificationId));
    if (!verification || verification.scope_id !== scopeId) throw new Error("Agent outcome requires a scope-matched verification receipt.");
    let caseRow = null;
    if (input.experienceCaseId) { caseRow = db.prepare("SELECT scope_id,verification_id FROM experience_cases WHERE id=?").get(String(input.experienceCaseId)); if (!caseRow || caseRow.scope_id !== scopeId || caseRow.verification_id !== String(input.verificationId)) throw new Error("Agent experience case must derive from the supplied verification."); }
    const result = verification.success ? "success" : "failure"; const id = String(input.id || crypto.randomUUID());
    const receipt = { id, scopeId, manifestId: String(input.manifestId), missionId: structural(input.missionId || manifest.project_id, "Agent mission"), agentId: structural(input.agentId, "Agent ID"), verificationId: String(input.verificationId), experienceCaseId: input.experienceCaseId || null, result, promotable: false };
    const receiptMac = digest(receipt, "eclipse-agent-experience:v1");
    const run = db.transaction(() => { db.prepare(`INSERT INTO eclipse_agent_experience
      (id,scope_id,manifest_id,mission_id,agent_id,outcome_verification_id,experience_case_id,result,trust_zone,promotable,receipt_mac,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,0,?,?)`).run(id, scopeId, receipt.manifestId, receipt.missionId, receipt.agentId, receipt.verificationId, receipt.experienceCaseId, result, String(input.trustZone || "trusted"), receiptMac, clock().toISOString()); faultInjector("eclipse.agent_outcome.before_commit"); return { ...receipt, receiptMac }; });
    return run.immediate();
  }

  function readAgentExperience(input = {}) {
    const rows = db.prepare("SELECT * FROM eclipse_agent_experience WHERE mission_id=? ORDER BY created_at,id").all(String(input.missionId));
    if (!rows.length) return [];
    authorize(rows[0].scope_id, input.allowedScopeIds || []);
    if (!(input.capabilities || []).map(String).includes("eclipse.recall.agent_outcome")) throw Object.assign(new Error("Agent-outcome recall capability is required."), { code: "ECLIPSE_CAPABILITY_DENIED" });
    return rows.filter((row) => row.trust_zone !== "agent_private" || row.agent_id === String(input.requesterId)).map((row) => ({ id: row.id, agentId: row.agent_id, result: row.result, verificationId: row.outcome_verification_id, experienceCaseId: row.experience_case_id, promotable: false, createdAt: row.created_at }));
  }

  return Object.freeze({ publishMissionSnapshot, readAgentExperience, recall, recordAgentOutcome });
}

module.exports = { createEclipseIntegrationRepository };
