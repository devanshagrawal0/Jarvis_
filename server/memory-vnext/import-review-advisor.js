"use strict";

const CONTAMINATION = ["mission objective:", "agent role:", "task os plan:", "durable checkpoint:", "tools expected:", "execute available steps now", "respond with json only", "never complete a mission by inventing facts", "this model is currently experiencing high demand", "gemini exceeded the", "you are the forge's", "you are the improver's", "you are jarvis inside the"];
function allText(value, parts = []) { if (value == null) return parts; if (typeof value === "string") parts.push(value); else if (Array.isArray(value)) for (const item of value) allText(item, parts); else if (typeof value === "object") for (const item of Object.values(value)) allText(item, parts); return parts; }
function scopeFor(candidate, text) { const source = text.toLocaleLowerCase(); if (source.includes("helix")) return "room:helix"; if (source.includes("apex")) return "room:apex"; if (source.includes("eclipse")) return "room:eclipse"; if (source.includes("mesh")) return "room:device-mesh"; if (source.includes("coop")) return "room:coop"; return candidate.proposedScope === "unscoped-review" ? "owner:local" : candidate.proposedScope; }

function adviseImportCandidate(candidate = {}) {
  const payload = candidate.payload || {}; const joined = allText(payload).join(" \n "); const lower = joined.toLocaleLowerCase(); const status = String(payload.status || "").toLocaleLowerCase();
  if (payload.deleted_at || ["deleted", "expired", "superseded", "archived", "inactive", "revoked"].includes(status)) return { action: "reject", confidence: 0.99, reason: "LEGACY_RECORD_INACTIVE", scopeId: null, requiresOwner: false };
  const contaminationHits = CONTAMINATION.filter((phrase) => lower.includes(phrase));
  if (contaminationHits.length >= 2 || (joined.length > 1800 && contaminationHits.length) || /(?:^|[-_])mission-objective(?:[-_]|$)/i.test(String(payload.key || ""))) return { action: "reject", confidence: 0.99, reason: "PROMPT_OR_EXECUTION_CONTAMINATION", scopeId: null, requiresOwner: false };
  if (candidate.recordType === "domain_manifest_candidate") return { action: "accept", confidence: 0.96, reason: "DOMAIN_POINTER_ONLY", scopeId: scopeFor(candidate, joined), requiresOwner: true };
  if (candidate.recordType === "artifact_pointer_candidate") { const hasLocator = Boolean(payload.path || payload.hash || payload.pointer || payload.legacyId); return { action: hasLocator ? "accept" : "quarantine", confidence: hasLocator ? 0.92 : 0.9, reason: hasLocator ? "STRUCTURAL_ARTIFACT_POINTER" : "ARTIFACT_POINTER_INCOMPLETE", scopeId: scopeFor(candidate, joined), requiresOwner: false }; }
  if (candidate.recordType === "procedure_candidate") return { action: "quarantine", confidence: 0.95, reason: "PROCEDURE_REQUIRES_OUTCOME_VALIDATION", scopeId: "owner:local", requiresOwner: true };
  if (candidate.recordType === "protected_personal_candidate") {
    if (["identity", "preferences", "locations", "core_memory_blocks"].includes(candidate.legacyTable)) return { action: "accept", confidence: 0.96, reason: "STRUCTURED_OWNER_PROFILE", scopeId: "owner:local", requiresOwner: true };
    if (joined.length <= 800 && !contaminationHits.length) return { action: "accept", confidence: 0.86, reason: "BOUNDED_PERSONAL_CANDIDATE", scopeId: "owner:local", requiresOwner: true };
    return { action: "quarantine", confidence: 0.9, reason: "PERSONAL_CANDIDATE_NEEDS_INTERPRETATION", scopeId: "owner:local", requiresOwner: true };
  }
  if (candidate.recordType === "working_state_candidate") return { action: "quarantine", confidence: 0.9, reason: "WORKING_STATE_MUST_BE_FRESH", scopeId: scopeFor(candidate, joined), requiresOwner: false };
  if (candidate.recordType === "memory_candidate") {
    if (!joined.trim() || lower === "hi" || lower === "hello") return { action: "reject", confidence: 0.98, reason: "LOW_INFORMATION_MEMORY", scopeId: null, requiresOwner: false };
    return { action: "accept", confidence: 0.82, reason: "LEGACY_MEMORY_CANDIDATE", scopeId: scopeFor(candidate, joined), requiresOwner: false };
  }
  return { action: "quarantine", confidence: 0.7, reason: "UNMAPPED_REVIEW_REQUIRED", scopeId: scopeFor(candidate, joined), requiresOwner: true };
}

module.exports = { adviseImportCandidate };
