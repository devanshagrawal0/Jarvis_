"use strict";

const crypto = require("node:crypto");
const { createAssertionService } = require("./assertion-service");
const { createContextRuntime } = require("./context-runtime");
const { createConversationJournal } = require("./conversation-journal");
const { createPersonalMemoryService } = require("./personal-memory-service");
const { createRetrievalOracle } = require("./retrieval-oracle");
const { createRetrievalPlanner } = require("./retrieval-planner");
const { createTemporalGraph } = require("./temporal-graph");
const { createTruthMaintenance } = require("./truth-maintenance");
const { expandQuery, normalizeText, predicateTopics, sensitivityFor, slug, topicsForText } = require("./topic-ontology");
const { stableId } = require("./candidate-projector");
const { createPersonalContextRegistryRepository } = require("./repositories/personal-context-registry-repository");

const OWNER = Object.freeze({ actorId: "local-owner", authorityZone: "owner", scopeId: "owner:local", subjectRef: "local-owner" });
const FACT_ALIASES = Object.freeze({
  weight: "health.weight_kg", height: "health.height_cm", age: "identity.age_years", name: "identity.preferred_name",
  city: "location.current_city", location: "location.current_city", timezone: "identity.home_timezone", goal: "goal.general",
});

function round(value, places = 2) { const scale = 10 ** places; return Math.round(Number(value) * scale) / scale; }
function unique(items) { return [...new Set(items.filter(Boolean))]; }

// A-08 — the injection screen was one regex carrying the `i` flag, which made its
// `BEGIN [A-Z_]+` alternative (meant for PEM/armoured blocks: "BEGIN RSA PRIVATE KEY") collapse
// into "the word *begin* followed by any word". "I prefer to begin my day early" and "my goal is
// to begin the marathon" therefore aborted extraction and silently wrote nothing. The armoured
// -block pattern has to be case-SENSITIVE, so it cannot share a regex with the prose patterns.
const INJECTION_PROSE_RE = /(?:system prompt|developer message|ignore previous|stack trace)/i;
const ARMOURED_BLOCK_RE = /\bBEGIN [A-Z][A-Z_ ]*(?:KEY|CERTIFICATE|MESSAGE|BLOCK)\b/;   // no `i`

function injectionScreenReason(text) {
  if (!text) return "empty";
  if (text.length > 2_000) return "too_long";
  if (INJECTION_PROSE_RE.test(text)) return "injection_phrase";
  if (ARMOURED_BLOCK_RE.test(text)) return "armoured_block";
  return null;
}

function extractMutations(input) {
  const text = normalizeText(input); const lower = text.toLocaleLowerCase();
  const screened = injectionScreenReason(text);
  if (screened) {
    // Silently returning [] made a discarded memory write indistinguishable from "nothing to
    // remember". Anything other than an empty turn is worth surfacing.
    if (screened !== "empty") console.warn(`[memory-vnext] owner-fact extraction skipped: ${screened}`);
    return [];
  }
  const mutations = [];
  const forget = lower.match(/\bforget(?: that)?(?: my)?\s+(?:fitness\s+)?(weight|height|age|name|city|location|timezone|goal)\b/i);
  if (forget) {
    const alias = forget[1].toLocaleLowerCase();
    if (alias === "goal") return ["goal.fitness", "goal.general"].map((predicate) => ({ action: "forget", predicate, reason: "explicit_owner_forget" }));
    return [{ action: "forget", predicate: FACT_ALIASES[alias], reason: "explicit_owner_forget" }];
  }

  const weight = lower.match(/\b(?:i\s+(?:now\s+)?weigh|my\s+weight\s+is|weight\s*[:=])\s*(\d{2,3}(?:\.\d+)?)\s*(kg|kgs|kilograms?|lb|lbs|pounds?)\b/i);
  if (weight) { const amount = Number(weight[1]); const kg = /^k/i.test(weight[2]) ? amount : amount * 0.45359237; mutations.push({ action: "set", predicate: "health.weight_kg", value: round(kg, 2), unit: "kg", topics: ["fitness", "health"], sensitivity: "restricted" }); }
  const height = lower.match(/\b(?:my\s+height\s+is|height\s*[:=]|i\s+am)\s*(\d{2,3}(?:\.\d+)?)\s*(cm|centimeters?)\b/i);
  if (height) mutations.push({ action: "set", predicate: "health.height_cm", value: round(height[1], 1), unit: "cm", topics: ["fitness", "health"], sensitivity: "restricted" });
  const age = lower.match(/\b(?:i\s+am|my\s+age\s+is)\s*(\d{1,3})\s*(?:years?\s+old|yo)\b/i);
  if (age && Number(age[1]) > 0 && Number(age[1]) < 130) mutations.push({ action: "set", predicate: "identity.age_years", value: Number(age[1]), unit: "years", topics: ["health"], sensitivity: "restricted" });
  const name = text.match(/\b(?:my name is|call me)\s+([\p{L}][\p{L} .'-]{0,80})/iu);
  if (name) mutations.push({ action: "set", predicate: "identity.preferred_name", value: name[1].trim().replace(/[.!?]+$/, ""), topics: ["personal"], sensitivity: "restricted" });
  const goal = text.match(/\bmy\s+(?:fitness\s+)?goal\s+is\s+(.{3,240})/i);
  if (goal) { const value = goal[1].trim().replace(/[.!?]+$/, ""); mutations.push({ action: "set", predicate: topicsForText(value).includes("fitness") || /muscle|strength|fat|weight|run/i.test(value) ? "goal.fitness" : "goal.general", value, topics: unique(["work", ...topicsForText(value)]), sensitivity: sensitivityFor(value) }); }
  const preference = text.match(/\b(?:i prefer|i like)\s+(.{3,240})/i);
  if (preference) { const value = preference[1].trim().replace(/[.!?]+$/, ""); const topics = topicsForText(value); mutations.push({ action: "set", predicate: topics.includes("fitness") ? "preference.fitness" : topics.includes("communication") ? "preference.communication" : "preference.general", value, topics: unique(["personal", ...topics]), sensitivity: sensitivityFor(value) }); }
  const generic = text.match(/\b(?:remember that\s+)?my\s+([a-z][a-z0-9 _-]{1,48})\s+is\s+(.{1,240})/i);
  if (generic && !mutations.length) { const key = slug(generic[1], "fact"); const value = generic[2].trim().replace(/[.!?]+$/, ""); mutations.push({ action: "set", predicate: `owner.${key}`, value, topics: unique(["personal", ...topicsForText(`${key} ${value}`)]), sensitivity: sensitivityFor(`${key} ${value}`) }); }
  return mutations;
}

function createPersonalContextRouter({ store, trustedOwnerCloud = false } = {}) {
  if (!store?.attachRepository) throw new Error("A Memory vNext core store is required.");
  const assertions = createAssertionService({ store }); const personal = createPersonalMemoryService({ store }); const oracle = createRetrievalOracle({ store });
  const truth = createTruthMaintenance({ store }); const planner = createRetrievalPlanner({ store }); const context = createContextRuntime({ store }); const graph = createTemporalGraph({ store }); const journal = createConversationJournal({ store }); const registry = store.attachRepository(createPersonalContextRegistryRepository);

  function ensureProjection() { const projection = registry.activeProjection(); if (!projection) throw Object.assign(new Error("An active retrieval projection is required."), { code: "RETRIEVAL_PROJECTION_UNAVAILABLE" }); return projection; }
  function graphFact(assertion, mutation) {
    registry.retireFactEdges(assertion.id); const version = assertion.currentVersion?.id || assertion.versionId || "v1"; const factNode = graph.createNode({ id: stableId("graph-record", `assertion:${assertion.id}`), scopeId: OWNER.scopeId, nodeType: "assertion", nodeKey: `assertion:${assertion.id}`, label: { predicate: mutation.predicate }, sensitivity: mutation.sensitivity, canonicalRefType: "assertion", canonicalRefId: assertion.id });
    for (const topic of unique(mutation.topics?.length ? mutation.topics : predicateTopics(mutation.predicate, mutation.value))) { const topicNode = graph.createNode({ id: stableId("graph-topic", `${OWNER.scopeId}:${topic}`), scopeId: OWNER.scopeId, nodeType: "topic", nodeKey: `topic:${topic}`, label: { topic }, sensitivity: "private" }); graph.addEdge({ id: stableId("graph-edge", `${topicNode.id}:${factNode.id}:REFERENCES:${version}`), scopeId: OWNER.scopeId, fromNodeId: topicNode.id, toNodeId: factNode.id, relation: "REFERENCES", weight: 1, confidence: 1, originKind: "canonical", sensitivity: mutation.sensitivity, sourceType: "assertion", sourceId: assertion.id }); }
  }
  function indexFact(assertion, mutation, statedAt) {
    const projection = ensureProjection(); for (const document of registry.retrievalDocuments("assertion", assertion.id)) oracle.removeDocument(document.id);
    const version = assertion.currentVersion?.id || assertion.versionId; const topics = unique(mutation.topics?.length ? mutation.topics : predicateTopics(mutation.predicate, mutation.value)); const valueText = typeof mutation.value === "string" ? mutation.value : JSON.stringify(mutation.value);
    oracle.indexDocument({ id: stableId("retrieval", `${projection.id}:assertion:${assertion.id}:${version}`), projectionId: projection.id, scopeId: OWNER.scopeId, recordType: "assertion", recordId: assertion.id, recordVersion: version, sensitivity: mutation.sensitivity,
      validFrom: statedAt, content: { kind: "owner_fact", predicate: mutation.predicate, value: mutation.value, unit: mutation.unit || null, topics, statedAt, confidence: 1, epistemicState: "owner_asserted", provenance: { sourceTurnId: mutation.sourceTurnId } },
      searchableText: `${mutation.predicate} ${topics.join(" ")} ${valueText}`, exactKeys: [{ type: "predicate", value: mutation.predicate }, { type: "id", value: `assertion:${assertion.id}` }, ...topics.map((topic) => ({ type: "predicate", value: `topic:${topic}` }))], sourceType: "assertion", sourceId: assertion.id });
    graphFact(assertion, mutation);
  }

  // "Forget my weight" used to revise the assertion to `retracted`, drop the retrieval documents
  // and stop — which reads as deleted and is not. `identity_attributes` (written by the remember
  // branch below via personal.setIdentity) stayed `status='active'` with its encrypted value
  // intact, and the superseded assertion version still decrypted to the old number. The owner
  // was told `changed: true` over a value that was still fully readable.
  //
  // The store already had the correct pipeline — previewForget → authorizeForget → executeForget
  // scrubs the identity rows, deletes the encrypted payloads, invalidates the derived closure and
  // writes a signed deletion receipt. It was defined once and called from nowhere. This routes the
  // conversational path through it instead of reimplementing a second, weaker deletion.
  function forgetOwnerFact(mutation, current, sourceTurnId, at) {
    const predicate = mutation.predicate;
    const outcome = { action: "forget", predicate, assertionId: current.id, changed: false };

    // Identity is the right forget target: previewForget expands it to every sibling row for the
    // same predicate AND the assertion it derives from. Targeting the assertion alone does not
    // expand back to identity, which is precisely how the old path left the value behind.
    let identityId = null;
    try {
      identityId = (personal.activeIdentity(OWNER.scopeId) || [])
        .find((row) => row.predicate === predicate)?.id || null;
    } catch { identityId = null; }

    let receipt = null;
    if (identityId) {
      const job = truth.previewForget({ scopeId: OWNER.scopeId, targetType: "identity", targetId: identityId, requestedBy: OWNER.actorId, sensitivity: "restricted" });
      if (job.requiresClarification) {
        // Ambiguous selector — refusing is correct, but it must be reported as a refusal rather
        // than swallowed into a success.
        return { ...outcome, reason: "forget_requires_clarification", targetCount: job.targetCount };
      }
      truth.authorizeForget({ jobId: job.id, actorId: OWNER.actorId, authorityZone: OWNER.authorityZone });
      receipt = truth.executeForget({ jobId: job.id, actorId: OWNER.actorId, authorityZone: OWNER.authorityZone });
    }

    // The assertion is retracted regardless, so a fact recorded before identity projection still
    // stops being current.
    assertions.reviseAssertion(current.id, { object: null, epistemicState: "retracted", validFrom: at, provenance: { type: "explicit_owner_forget", sourceTurnId }, sensitivity: "restricted", createdBy: "local-owner", confidence: { userConfirmation: 1, sourceReliability: 1, freshness: 1 } });
    for (const document of registry.retrievalDocuments("assertion", current.id)) oracle.removeDocument(document.id);
    registry.retireFactEdges(current.id);

    // The check that has to be able to fail. Everything above claims the value is gone; this
    // asks. If any active identity row for the predicate still decrypts, the owner is told the
    // forget did NOT complete rather than being handed a false confirmation.
    let residual = null;
    try {
      residual = (personal.activeIdentity(OWNER.scopeId) || []).find((row) => row.predicate === predicate) || null;
    } catch { residual = null; }
    if (residual) {
      return { ...outcome, reason: "forget_incomplete_value_still_readable", identityId: residual.id };
    }
    return { ...outcome, changed: true, deletionReceiptId: receipt?.id || null, scrubbedIdentity: Boolean(identityId) };
  }

  function applyMutation(mutation, sourceTurnId, at) {
    const current = registry.currentAssertion(mutation.predicate);
    if (mutation.action === "forget") {
      if (!current) return { action: "forget", predicate: mutation.predicate, changed: false };
      return forgetOwnerFact(mutation, current, sourceTurnId, at);
    }
    const enriched = { ...mutation, sourceTurnId, sensitivity: mutation.sensitivity || sensitivityFor(mutation.predicate) }; let assertion;
    const existing = current || registry.latestAssertion(mutation.predicate);
    if (existing) assertion = assertions.reviseAssertion(existing.id, { object: mutation.value, objectType: typeof mutation.value === "object" ? "json" : "literal", epistemicState: "owner_asserted", validFrom: at, provenance: { type: current ? "direct_owner_correction" : "direct_owner_reinstatement", sourceTurnId }, sensitivity: enriched.sensitivity, createdBy: "local-owner", confidence: { extraction: 1, sourceReliability: 1, corroboration: 0.5, freshness: 1, userConfirmation: 1 } });
    else assertion = assertions.createAssertion({ id: stableId("assertion", `owner:${mutation.predicate}`), scopeId: OWNER.scopeId, subjectType: "owner", subjectRef: OWNER.subjectRef, predicate: mutation.predicate, object: mutation.value, objectType: typeof mutation.value === "object" ? "json" : "literal", epistemicState: "owner_asserted", validFrom: at, provenance: { type: "direct_owner_statement", sourceTurnId }, sensitivity: enriched.sensitivity, createdBy: "local-owner", confidence: { extraction: 1, sourceReliability: 1, corroboration: 0.5, freshness: 1, userConfirmation: 1 } });
    personal.setIdentity({ scopeId: OWNER.scopeId, predicate: mutation.predicate, value: mutation.value, assertionId: assertion.id, actorId: OWNER.actorId, authorityZone: OWNER.authorityZone, sensitivity: enriched.sensitivity });
    indexFact(assertion, enriched, at); return { action: current ? "correct" : "remember", predicate: mutation.predicate, assertionId: assertion.id, value: mutation.value, changed: true };
  }

  function ingestOwnerTurn(input = {}) {
    const conversationId = String(input.conversationId || "contained-owner-conversation"); const branchId = String(input.branchId || `${conversationId}:main`);
    journal.openConversation({ id: conversationId, branchId, scopeId: OWNER.scopeId, roomType: "jarvis", createdBy: OWNER.actorId, sensitivity: "private" });
    const at = String(input.occurredAt || new Date().toISOString()); const turn = journal.ingestTurn({ conversationId, branchId, clientEventId: String(input.clientEventId || crypto.randomUUID()), clientSequence: input.clientSequence, role: "user", content: String(input.content), actorId: OWNER.actorId, occurredAt: at, sensitivity: "private", admissionStatus: "admitted" });
    const mutations = extractMutations(input.content).map((mutation) => applyMutation(mutation, turn.turnId, at));
    return { conversationId, branchId, turnId: turn.turnId, mutations, providerCalls: 0 };
  }

  function ingestAssistantTurn(input = {}) {
    const conversationId = String(input.conversationId || "contained-owner-conversation"); const branchId = String(input.branchId || `${conversationId}:main`);
    journal.openConversation({ id: conversationId, branchId, scopeId: OWNER.scopeId, roomType: "jarvis", createdBy: OWNER.actorId, sensitivity: "private" });
    const at = String(input.occurredAt || new Date().toISOString()); const turn = journal.ingestTurn({ conversationId, branchId, clientEventId: String(input.clientEventId || crypto.randomUUID()), clientSequence: input.clientSequence, role: "assistant", content: String(input.content), actorId: "local-system", occurredAt: at, sensitivity: "private", admissionStatus: "admitted" });
    return { conversationId, branchId, turnId: turn.turnId, mutations: [], providerCalls: 0 };
  }

  function freshness(hit, now = Date.now()) {
    const stated = Date.parse(hit.content?.statedAt || ""); if (!Number.isFinite(stated)) return { state: "unknown", requiresConfirmation: false };
    const days = Math.max(0, (now - stated) / 86_400_000); const threshold = /^health\./.test(hit.content?.predicate || "") ? 90 : /^identity\./.test(hit.content?.predicate || "") ? 365 : 730;
    return { state: days > threshold ? "stale" : "fresh", ageDays: round(days, 1), requiresConfirmation: days > threshold };
  }

  function route(input = {}) {
    const started = process.hrtime.bigint(); const timings = {}; const mark = (name, prior) => { const now = process.hrtime.bigint(); timings[name] = Number(now - prior) / 1e6; return now; };
    const query = normalizeText(input.query); if (!query) throw new Error("A context query is required."); const projection = ensureProjection(); const expanded = expandQuery(query); const latencyBudgetMs = Math.max(15, Number(input.latencyBudgetMs || 180)); let tick = process.hrtime.bigint();
    const plan = planner.plan({ scopeId: OWNER.scopeId, query, threadId: input.threadId, branchId: input.branchId, taskId: input.taskId, workingSetSufficient: Boolean(input.workingSetSufficient), uncertainty: Number(input.uncertainty ?? 0.45), taskRisk: Number(input.taskRisk ?? 0.35), deepRequested: Boolean(input.deepRequested), latencyBudgetMs, costBudgetUsd: 0, baselineCalls: 0 });
    tick = mark("planMs", tick);
    if (plan.decision === "none") return { query, topics: expanded.topics, plan, retrieval: { first: { exact: 0, lexical: 0 }, graph: { skipped: true, hits: 0 }, second: { exact: 0, lexical: 0 }, selected: 0 }, pack: null, facts: [], contextText: "", privacy: { trustedOwnerCloud: false, eligibleSensitivities: [] }, providerCalls: 0, costUsd: 0 };
    const topicKeys = expanded.topics.map((topic) => ({ type: "predicate", value: `topic:${topic}` }));
    let first = oracle.retrieve({ projectionId: projection.id, scopeIds: [OWNER.scopeId], allowedScopeIds: [OWNER.scopeId], text: topicKeys.length ? undefined : expanded.text, exactKeys: topicKeys, intent: plan.intent, expectedValue: plan.expectedValue, limit: Math.max(8, Number(input.limit || 16)) });
    if (topicKeys.length && first.hits.length === 0) first = oracle.retrieve({ projectionId: projection.id, scopeIds: [OWNER.scopeId], allowedScopeIds: [OWNER.scopeId], text: expanded.text, intent: `${plan.intent}_lexical_fallback`, expectedValue: plan.expectedValue, limit: Math.max(8, Number(input.limit || 16)) });
    tick = mark("firstRetrievalMs", tick);
    let graphResult = { skipped: true, mode: "none", hits: [] }; let graphRefs = []; const seeds = registry.topicNodeIds(expanded.topics); const deepGraph = Boolean(input.deepRequested) || plan.decision === "deep";
    if (seeds.length && deepGraph) { graphResult = { ...graph.traverse({ scopeIds: [OWNER.scopeId], allowedScopeIds: [OWNER.scopeId], seedNodeIds: seeds, planDecision: plan.decision, relationshipNeed: 1, baselineConfidence: first.hits.length ? 0.55 : 0.1, maxHops: 1, limit: 30 }), mode: "traversal" }; graphRefs = graphResult.skipped ? [] : registry.graphRefs(graphResult.hits.map((item) => item.nodeId)); }
    else if (seeds.length) { graphRefs = registry.topicGraphRefs(expanded.topics, 30); graphResult = { skipped: false, mode: "adjacency", hits: graphRefs }; }
    tick = mark("graphMs", tick);
    const priorityGraphRefs = deepGraph ? graphRefs : graphRefs.slice(0, 8); const second = priorityGraphRefs.length ? oracle.retrieve({ projectionId: projection.id, scopeIds: [OWNER.scopeId], allowedScopeIds: [OWNER.scopeId], exactKeys: priorityGraphRefs.map((ref) => ({ type: "id", value: `${ref.type}:${ref.id}` })), intent: deepGraph ? "graph_expansion" : "owner_fact_priority", expectedValue: 0.8, limit: deepGraph ? 30 : 8 }) : { hits: [], channels: { exact: 0, lexical: 0 } };
    tick = mark("secondRetrievalMs", tick);
    const byDocument = new Map([...first.hits, ...second.hits].map((hit) => [hit.documentId, hit])); const cloudAllowed = Boolean(input.trustedOwnerCloud ?? trustedOwnerCloud); const allowed = cloudAllowed ? new Set(["public", "internal", "private", "restricted"]) : new Set(input.providerClass === "local" ? ["public", "internal", "private", "restricted"] : ["public", "internal"]);
    const queryTopics = new Set(expanded.topics); const contextualRank = (hit) => {
      const contentTopics = Array.isArray(hit.content?.topics) ? hit.content.topics : []; const overlap = contentTopics.filter((topic) => queryTopics.has(topic)).length;
      return (hit.content?.kind === "owner_fact" ? 8 : 0) + (hit.content?.epistemicState === "owner_asserted" ? 4 : 0) + overlap * 2 + (hit.channel === "exact" ? 1 : 0) + Math.min(1, Math.max(0, Number(hit.score || 0) / 100));
    };
    const hits = [...byDocument.values()].filter((hit) => allowed.has(hit.sensitivity)).sort((a, b) => contextualRank(b) - contextualRank(a) || String(a.documentId).localeCompare(String(b.documentId))).slice(0, Math.max(1, Number(input.limit || 12))).map((hit, index) => ({ ...hit, freshness: freshness(hit), priority: Math.max(0.1, 1 - index * 0.05) }));
    const items = hits.map((hit) => ({ itemId: `retrieval:${hit.documentId}`, recordType: hit.recordType, recordId: hit.recordId, recordVersion: hit.recordVersion, blockType: hit.recordType === "source" ? "manifests" : "personal", trustZone: hit.content?.epistemicState === "owner_asserted" ? "trusted" : "untrusted", sensitivity: hit.sensitivity, authority: hit.content?.epistemicState === "owner_asserted" ? "evidence" : "context_only", content: { ...hit.content, freshness: hit.freshness }, sourceRefs: [{ id: hit.recordId, version: hit.recordVersion }], priority: hit.priority, scopeId: hit.scopeId }));
    const pack = context.compile({ scopeId: OWNER.scopeId, product: String(input.product || "cortex"), effort: String(input.effort || "balanced"), threadId: input.threadId, branchId: input.branchId, taskId: input.taskId, retrievalPlanId: plan.id, providerClass: input.providerClass || "cloud", providerAllowedSensitivities: [...allowed], allowedScopeIds: [OWNER.scopeId], items, watermark: input.watermark || {}, evidenceRequired: false });
    tick = mark("contextCompileMs", tick); timings.totalMs = Number(tick - started) / 1e6;
    // The pack exposes `blocks`, each carrying its own `items` — there is no top-level `items`.
    // Reading `pack.items` yields undefined, which silently delivers nothing at all.
    const admitted = new Set((pack?.blocks || []).flatMap((block) => (block.items || []).map((item) => item.itemId)));
        // A pack that admitted nothing while hits exist is a real signal (budget exhausted by
        // directives, or every item filtered), not a reason to quietly bypass the pack. It is
        // reported so the gate can see it rather than being papered over with a fallback.
        const packBypassed = hits.length > 0 && admitted.size === 0;
        const facts = hits.filter((hit) => hit.content?.predicate && admitted.has(`retrieval:${hit.documentId}`)).map((hit) => ({ predicate: hit.content.predicate, value: hit.content.value, unit: hit.content.unit || null, freshness: hit.freshness, source: { recordType: hit.recordType, recordId: hit.recordId, recordVersion: hit.recordVersion } }));
    const contextText = facts.length ? ["Relevant verified owner context:", ...facts.map((fact) => `- ${fact.predicate}: ${typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}${fact.unit ? ` ${fact.unit}` : ""} [${fact.freshness.state}${fact.freshness.requiresConfirmation ? "; reconfirm before relying on it" : ""}]`)].join("\n") : "";
    return { query, topics: expanded.topics, plan, retrieval: { first: first.channels, graph: { skipped: graphResult.skipped, mode: graphResult.mode, hits: graphResult.hits.length }, second: second.channels, selected: hits.length }, pack, facts, contextText, privacy: { trustedOwnerCloud: cloudAllowed, eligibleSensitivities: [...allowed] }, packAdmitted: admitted.size, packBypassed, providerCalls: 0, costUsd: 0, ...(input.includeDiagnostics ? { diagnostics: timings } : {}) };
  }

  return Object.freeze({ extractMutations, ingestAssistantTurn, ingestOwnerTurn, route });
}

module.exports = { FACT_ALIASES, createPersonalContextRouter, extractMutations };
