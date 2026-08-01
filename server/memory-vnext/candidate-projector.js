"use strict";

const crypto = require("node:crypto");
const { createAssertionService } = require("./assertion-service");
const { createKnowledgeService } = require("./knowledge-service");
const { createPolicyEngine } = require("./policy-engine");
const { createRetrievalOracle } = require("./retrieval-oracle");
const { createTemporalGraph } = require("./temporal-graph");
const { predicateTopics, sensitivityFor, slug, topicsForText } = require("./topic-ontology");
const { createCandidateProjectionRepository } = require("./repositories/candidate-projection-repository");

function stableId(prefix, value) {
  return `${prefix}:${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32)}`;
}

function parseJson(value, fallback = null) {
  if (value == null || typeof value !== "string") return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback ?? value; }
}

function compact(value, depth = 0) {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => compact(item, depth + 1));
  if (typeof value !== "object") return typeof value === "string" ? value.slice(0, 20_000) : value;
  const blocked = new Set(["sourceKey", "legacyId", "legacyTable", "normalized_text", "metadata_json", "access_count", "effective_priority"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key)).map(([key, item]) => [key, compact(item, depth + 1)]));
}

function meaningfulText(payload) {
  const fields = ["text", "content", "summary", "title", "description", "value", "current_goal", "bio", "preferred_name", "legal_name", "path", "pointer"];
  const chunks = [];
  for (const key of fields) if (typeof payload?.[key] === "string" && payload[key].trim()) chunks.push(payload[key].trim());
  return [...new Set(chunks)].join("\n").slice(0, 40_000);
}

function personalFacts(candidate) {
  const payload = candidate.payload || {}; const table = candidate.legacyTable; const facts = [];
  if (table === "personal_profile_items" && payload.key && payload.value != null) {
    facts.push({ predicate: slug(`${payload.category || "profile"}.${payload.key}`, "profile.fact"), value: payload.value, statedAt: payload.updated_at || payload.created_at });
  } else if (table === "preferences" && payload.value != null) {
    facts.push({ predicate: slug(`preference.${payload.category || "general"}.${payload.subject || "owner"}`, "preference.general"), value: payload.value, statedAt: payload.updated_at });
  } else if (table === "identity") {
    for (const key of ["legal_name", "preferred_name", "pronouns", "birthdate", "bio", "primary_email", "primary_phone", "home_timezone", "locale"]) if (payload[key] != null && String(payload[key]).trim()) facts.push({ predicate: slug(`identity.${key}`, "identity.fact"), value: payload[key], statedAt: payload.updated_at });
  } else if (table === "locations") {
    facts.push({ predicate: slug(`location.${payload.label || "current"}`, "location.current"), value: compact({ address: payload.address, lat: payload.lat, lng: payload.lng, timezone: payload.timezone, isCurrent: Boolean(payload.is_current) }), statedAt: payload.last_seen_at || payload.valid_from });
  } else if (table === "core_memory_blocks" && payload.value != null) {
    facts.push({ predicate: slug(`profile.${payload.label || "core"}`, "profile.core"), value: payload.value, statedAt: payload.updated_at });
  }
  if (!facts.length && payload.value != null) {
    facts.push({ predicate: slug(`${payload.category || "profile"}.${payload.key || payload.attribute || payload.predicate || "fact"}`, "profile.fact"), value: payload.value, statedAt: payload.updated_at || payload.created_at });
  }
  return facts;
}

function createCandidateProjector({ store } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const reader = store.attachRepository(createCandidateProjectionRepository);
  const assertions = createAssertionService({ store });
  const knowledge = createKnowledgeService({ store });
  const policies = createPolicyEngine({ store }).repository;
  const oracle = createRetrievalOracle({ store });
  const graph = createTemporalGraph({ store });

  function ensureScope(scopeId) {
    if (policies.getScope(scopeId)) return;
    const prefix = String(scopeId).split(":")[0]; const allowed = new Set(["device", "workspace", "room", "project", "folder", "segment", "thread", "task", "agent_session", "coop_session"]);
    policies.createScope({ id: scopeId, scopeType: allowed.has(prefix) ? prefix : "project", name: scopeId, ownerActorId: "local-owner", parentScopeId: "owner:local" });
  }

  function graphRecord(scopeId, canonical, topics, label, sensitivity) {
    const recordNode = graph.createNode({ id: stableId("graph-record", `${canonical.type}:${canonical.id}`), scopeId, nodeType: canonical.type === "assertion" ? "assertion" : "source", nodeKey: `${canonical.type}:${canonical.id}`, label, sensitivity, canonicalRefType: canonical.type, canonicalRefId: canonical.id });
    for (const topic of topics) {
      // Topic identity is scoped. The same topic may legitimately exist in the
      // owner scope and in multiple project/room scopes without being one node.
      const topicNode = graph.createNode({ id: stableId("graph-topic", `${scopeId}:${topic}`), scopeId, nodeType: "topic", nodeKey: `topic:${topic}`, label: { topic }, sensitivity: "private" });
      graph.addEdge({ id: stableId("graph-edge", `${topicNode.id}:${recordNode.id}:REFERENCES`), scopeId, fromNodeId: topicNode.id, toNodeId: recordNode.id, relation: "REFERENCES", weight: 0.9, confidence: 0.9, originKind: "imported", sensitivity, sourceType: canonical.type, sourceId: canonical.id });
    }
    return recordNode;
  }

  function indexCanonical(projectionId, candidate, canonical, content, text, predicate, statedAt) {
    const inferredTopics = [...new Set([...topicsForText(`${candidate.legacyTable} ${text}`), ...predicateTopics(predicate, content)])];
    const topics = inferredTopics.length ? inferredTopics : [candidate.recordType === "artifact_pointer_candidate" ? "technology" : "work"];
    const sensitivity = sensitivityFor(`${predicate} ${text}`, candidate.sensitivity);
    const version = candidate.normalizedHash || "import-v1";
    const document = oracle.indexDocument({
      id: stableId("retrieval", `${projectionId}:${canonical.type}:${canonical.id}:${version}`), projectionId, scopeId: candidate.scopeId, recordType: canonical.type, recordId: canonical.id, recordVersion: version,
      sensitivity, validFrom: statedAt || undefined, content: { kind: canonical.type, predicate, value: content, text, topics, statedAt: statedAt || null, confidence: canonical.confidence ?? null, provenance: { importCandidateId: candidate.id, legacyTable: candidate.legacyTable, legacyId: candidate.legacyId } },
      searchableText: `${predicate} ${topics.join(" ")} ${text}`, exactKeys: [{ type: "id", value: `${canonical.type}:${canonical.id}` }, { type: "predicate", value: predicate }, ...topics.map((topic) => ({ type: "predicate", value: `topic:${topic}` }))],
      sourceType: canonical.type, sourceId: canonical.id,
    });
    graphRecord(candidate.scopeId, canonical, topics, { predicate, text: text.slice(0, 500) }, sensitivity);
    return document;
  }

  function materializeCandidate(projectionId, runId, candidate) {
    const provenance = { type: "accepted_legacy_import", runId, candidateId: candidate.id, legacyTable: candidate.legacyTable, legacyId: candidate.legacyId };
    const created = [];
    if (candidate.recordType === "protected_personal_candidate") {
      const facts = personalFacts(candidate); if (!facts.length) facts.push({ predicate: slug(`profile.${candidate.legacyTable}`, "profile.fact"), value: compact(candidate.payload || {}), statedAt: candidate.payload?.updated_at || candidate.payload?.created_at });
      for (const fact of facts) {
        const assertion = assertions.createAssertion({ id: stableId("assertion", `${candidate.id}:${fact.predicate}`), scopeId: candidate.scopeId, subjectType: "owner", subjectRef: "local-owner", predicate: fact.predicate, object: fact.value, objectType: typeof fact.value === "object" ? "json" : "literal", epistemicState: "owner_asserted", validFrom: fact.statedAt || undefined, provenance, sensitivity: candidate.sensitivity, createdBy: "local-owner", confidence: { extraction: 1, sourceReliability: 0.9, corroboration: 0.5, freshness: 0.7, userConfirmation: 1 } });
        created.push(indexCanonical(projectionId, candidate, { type: "assertion", id: assertion.id, confidence: assertion.currentVersion?.confidence?.computed }, fact.value, typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value), fact.predicate, fact.statedAt));
      }
    } else if (candidate.recordType === "memory_candidate" || candidate.recordType === "working_state_candidate") {
      const payload = compact(candidate.payload || {}); const text = meaningfulText(payload) || JSON.stringify(payload).slice(0, 20_000); const predicate = slug(`${candidate.recordType === "working_state_candidate" ? "continuity" : "memory"}.${payload.topic || payload.category || payload.kind || candidate.legacyTable}`, "memory.general");
      const assertion = assertions.createAssertion({ id: stableId("assertion", candidate.id), scopeId: candidate.scopeId, subjectType: "topic", subjectRef: `legacy:${candidate.legacyTable}:${candidate.legacyId}`, predicate, object: payload, objectType: "json", epistemicState: "inferred", validFrom: payload.updated_at || payload.created_at || undefined, validTo: payload.expires_at || undefined, provenance, sensitivity: candidate.sensitivity, createdBy: "local-owner", confidence: { extraction: 0.9, sourceReliability: Number(payload.confidence ?? 0.7), corroboration: 0.2, freshness: 0.6, userConfirmation: 0.35 } });
      created.push(indexCanonical(projectionId, candidate, { type: "assertion", id: assertion.id, confidence: assertion.currentVersion?.confidence?.computed }, payload, text, predicate, payload.updated_at || payload.created_at));
    } else if (candidate.recordType === "artifact_pointer_candidate" || candidate.recordType === "domain_manifest_candidate") {
      const payload = compact(candidate.payload || {}); const locator = candidate.recordType === "artifact_pointer_candidate"
        ? { kind: "local_artifact_pointer", path: payload.path || null, hash: payload.hash || null, mediaType: payload.mediaType || null, legacyTable: candidate.legacyTable, legacyId: candidate.legacyId }
        : { kind: "domain_manifest_pointer", domain: candidate.legacyTable, pointer: payload.pointer || candidate.legacyId, version: payload.version || null };
      const source = knowledge.createSource({ id: stableId("source", candidate.id), scopeId: candidate.scopeId, type: candidate.recordType === "artifact_pointer_candidate" ? "document" : "dataset", locator, title: `${candidate.legacyTable} ${candidate.legacyId}`, trustZone: "owner", reliability: 0.8, accessPolicy: "local_only", sensitivity: candidate.sensitivity });
      const text = [candidate.legacyTable, payload.path, payload.pointer, payload.mediaType].filter(Boolean).join(" "); const predicate = candidate.recordType === "artifact_pointer_candidate" ? "artifact.pointer" : "domain.manifest";
      created.push(indexCanonical(projectionId, candidate, { type: "source", id: source.id, confidence: source.reliability }, locator, text, predicate, null));
    }
    return created.length;
  }

  function project(input = {}) {
    const runId = String(input.runId || ""); const run = reader.run(runId);
    if (!run || run.status !== "reconciled" || Number(run.pending_review_rows) !== 0 || Number(run.conflict_rows) !== 0) throw new Error("Only a fully reconciled import can be projected.");
    const version = String(input.version || `accepted-import:${runId}`); const createdProjection = oracle.createProjection({ version, sourceSequence: Number(input.sourceSequence || 0), policyVersion: String(input.policyVersion || "candidate-projection:v1") });
    const projectionId = createdProjection.id; let after = ""; let candidates = 0; let documents = 0; const byType = {};
    while (true) {
      const page = reader.page(runId, after, input.batchSize || 200); if (!page.length) break;
      for (const candidate of page) { candidates += 1; ensureScope(candidate.scopeId); byType[candidate.recordType] = (byType[candidate.recordType] || 0) + 1; documents += materializeCandidate(projectionId, runId, candidate); after = candidate.id; }
      if (typeof input.onProgress === "function") input.onProgress({ candidates, documents, after });
    }
    const projection = reader.projection(version); const activation = projection.state === "building" ? oracle.activateProjection({ projectionId, expectedSelectedRecords: documents }) : { id: projectionId, state: projection.state, indexed: documents, expected: documents };
    return { runId, projectionId, version, candidates, documents, byType, activation, providerCalls: 0, legacyWrites: 0 };
  }

  return Object.freeze({ project });
}

module.exports = { compact, createCandidateProjector, meaningfulText, personalFacts, stableId };
