"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

const DECISIONS = new Set(["none", "working_only", "exact", "hybrid", "live_domain", "deep"]);
const MIDTASK_TRIGGERS = new Set(["unresolved_entity", "missing_procedure", "tool_failure", "low_confidence"]);
const DEFAULT_WEIGHTS = Object.freeze({ rrf: 0.22, exact: 0.15, task: 0.13, semantic: 0.10, lexical: 0.09, temporal: 0.08, provenance: 0.07, confirmation: 0.06, freshness: 0.05, graph: 0.05, utility: 0.03, contradiction: -0.18, weakDerivation: -0.12, redundancy: -0.10 });

function clamp(value, minimum = 0, maximum = 1) { return Math.max(minimum, Math.min(maximum, Number(value) || 0)); }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function normalizeQuery(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim(); }

function createRetrievalPlannerRepository({ db, keyring, clock, faultInjector }) {
  if (Number(db.pragma("user_version", { simple: true })) < 16) throw new Error("Adaptive retrieval planner requires schema version 16.");
  function encrypt(scopeId, type, payload, sensitivity = "private") { return insertEncrypted(db, keyring, clock, { objectType: type, scopeId, sensitivity, payload }).id; }
  function digest(value, domain) { return keyring.sign(JSON.stringify(canonical(value)), domain); }
  function activePlanner() { return db.prepare("SELECT * FROM retrieval_planner_versions WHERE state='active'").get(); }

  function registerPlanner(input = {}) {
    const version = String(input.version || "retrieval-planner:v1"); const prior = db.prepare("SELECT * FROM retrieval_planner_versions WHERE planner_version=?").get(version);
    if (prior) return { id: prior.id, version: prior.planner_version, replayed: true };
    const id = String(input.id || crypto.randomUUID()); const run = db.transaction(() => {
      db.prepare("UPDATE retrieval_planner_versions SET state='retired' WHERE state='active'").run();
      db.prepare("INSERT INTO retrieval_planner_versions(id,planner_version,weights_json,state,created_at) VALUES(?,?,?,'active',?)").run(id, version, JSON.stringify({ ...DEFAULT_WEIGHTS, ...(input.weights || {}) }), clock().toISOString());
      return { id, version, replayed: false };
    }); return run.immediate();
  }
  function ensurePlanner() { return activePlanner() || (registerPlanner(), activePlanner()); }

  function classify(input = {}) {
    const query = normalizeQuery(input.query); const words = query ? query.split(" ").length : 0;
    const greeting = /^(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|great|nice|good morning|good evening)[!. ]*$/.test(query);
    const acknowledgement = /^(yes|no|sure|done|got it|sounds good|continue|next)[!. ]*$/.test(query);
    const management = /\b(remember|forget|correct|update my|delete that memory|what is my|my preferred|my preference)\b/.test(query); const rawQuery = String(input.query || "");
    const exactSignal = management || /[a-z]:[\\/]/i.test(rawQuery) || /\/[^ ]+\/[^ ]+/.test(rawQuery) || /\b[A-Z]{2,8}\b/.test(rawQuery) || /\b(?:id|path|ticker|error|predicate)\s*[:#]/i.test(rawQuery);
    const continuity = /\b(continue|resume|what were we|where were we|that one|it again)\b/.test(query);
    const liveSignal = Boolean(input.liveDomain) || /\b(latest|right now|live price|today(?:'s)? (?:price|weather|score|news)|current market|what changed today)\b/.test(query);
    const relationship = /\b(relationship|connected|depends on|used the|derived from|across (?:the|this)|multi[- ]?hop|main themes|community|global research)\b/.test(query);
    const research = /\b(research|investigate|compare sources|deep dive|synthesize|evidence across|literature)\b/.test(query);
    const risk = clamp(input.taskRisk); const uncertainty = clamp(input.uncertainty); const working = Boolean(input.workingSetSufficient); const latencyBudgetMs = Math.max(0, Number(input.latencyBudgetMs ?? 120)); const costBudgetUsd = Math.max(0, Number(input.costBudgetUsd || 0));
    let decision;
    if (!query || greeting || acknowledgement) decision = "none";
    else if (liveSignal) decision = "live_domain";
    else if (input.deepRequested || relationship || research || (risk >= 0.75 && uncertainty >= 0.55)) decision = "deep";
    else if (management || exactSignal) decision = "exact";
    else if (working && (continuity || words <= 12) && uncertainty < 0.55) decision = "working_only";
    else if (continuity && working) decision = "working_only";
    else decision = "hybrid";
    if (latencyBudgetMs < 15 && !["none", "working_only", "exact", "live_domain"].includes(decision)) decision = working ? "working_only" : "exact";
    const expectedValue = decision === "none" ? 0 : clamp(0.20 + uncertainty * 0.32 + risk * 0.25 + (relationship || research ? 0.20 : 0) + (exactSignal ? 0.12 : 0) - (working ? 0.12 : 0));
    return { decision, intent: management ? "memory_management" : liveSignal ? "domain_live" : relationship ? "multi_hop" : research ? "research" : continuity ? "continuity" : exactSignal ? "exact_recall" : "semantic_recall",
      features: { greeting: greeting ? 1 : 0, acknowledgement: acknowledgement ? 1 : 0, management: management ? 1 : 0, exactSignal: exactSignal ? 1 : 0, continuity: continuity ? 1 : 0, liveSignal: liveSignal ? 1 : 0, relationship: relationship ? 1 : 0, research: research ? 1 : 0, taskRisk: risk, uncertainty, workingSetSufficient: working ? 1 : 0, queryWords: words }, expectedValue, latencyBudgetMs, costBudgetUsd };
  }

  function routeFor(classification, input = {}) {
    const definitions = {
      working: [1, 0, "ACTIVE_STATE"], exact: [4, 0, "IDENTIFIER_OR_TYPED_LOOKUP"], lexical: [12, 0, "LEXICAL_RECALL"], dense: [24, 0, "SEMANTIC_RECALL"], temporal: [8, 0, "TIME_LENS"], graph: [35, 0, "RELATIONSHIP_EXPANSION"], task: [6, 0, "TASK_CONTINUITY"], artifact: [12, 0, "ARTIFACT_LOCATOR"], procedure: [10, 0, "PROCEDURE_MATCH"], room: [18, 0, "ROOM_MANIFEST"], live_domain: [Math.max(20, Number(input.liveEstimatedLatencyMs || 80)), Math.max(0, Number(input.liveEstimatedCostUsd || 0)), "FRESH_DOMAIN_REQUIRED"], rerank: [80, Math.max(0, Number(input.rerankEstimatedCostUsd || 0.01)), "AMBIGUOUS_DEEP_RESULTS"],
    };
    const requested = classification.decision === "none" ? [] : classification.decision === "working_only" ? ["working"] : classification.decision === "exact" ? ["working", "exact", "temporal"] : classification.decision === "hybrid" ? ["working", "exact", "lexical", "dense", "temporal", "task", "artifact"] : classification.decision === "live_domain" ? ["working", "live_domain", "exact"] : ["working", "exact", "lexical", "dense", "temporal", "graph", "task", "artifact", "procedure", "room", "rerank"];
    let latency = 0; let cost = 0; const routes = [];
    for (const channel of requested) { const [estimatedLatencyMs, estimatedCostUsd, reasonCode] = definitions[channel];
      if (latency + estimatedLatencyMs > classification.latencyBudgetMs && !["working", "exact", "live_domain"].includes(channel)) continue;
      if (cost + estimatedCostUsd > classification.costBudgetUsd && estimatedCostUsd > 0) continue;
      latency += estimatedLatencyMs; cost += estimatedCostUsd; routes.push({ channel, reasonCode, estimatedLatencyMs, estimatedCostUsd });
    }
    return routes;
  }

  function expandTimeLens(query, explicit = {}, now = clock()) {
    if (explicit.validAt || explicit.recordedAt || explicit.validFrom || explicit.validTo) return canonical(explicit); const text = normalizeQuery(query); const day = 86_400_000;
    if (/\byesterday\b/.test(text)) { const end = new Date(now.getTime()); end.setUTCHours(0, 0, 0, 0); return { validFrom: new Date(end.getTime() - day).toISOString(), validTo: end.toISOString(), expansion: "yesterday" }; }
    if (/\blast (?:week|7 days)\b/.test(text)) return { validFrom: new Date(now.getTime() - 7 * day).toISOString(), validTo: now.toISOString(), expansion: "last_7_days" };
    if (/\b(before|previous|historical|used to|back then)\b/.test(text)) return { validAt: now.toISOString(), recordedAt: now.toISOString(), historicalRequested: true };
    return {};
  }

  function plan(input = {}) {
    if (!input.scopeId || !input.query) throw new Error("Retrieval planning requires a query and scope."); const planner = ensurePlanner(); const classification = classify(input); const routes = routeFor(classification, input); const id = String(input.id || crypto.randomUUID()); const now = clock().toISOString();
    const watermark = input.watermark || {}; const timeLens = expandTimeLens(input.query, input.timeLens || {}); const querySignature = digest({ query: normalizeQuery(input.query), scopeId: input.scopeId, threadId: input.threadId || null, branchId: input.branchId || null, taskId: input.taskId || null, features: classification.features, timeLens }, "retrieval-plan-query:v1");
    const run = db.transaction(() => { const queryId = encrypt(String(input.scopeId), "retrieval-plan-query", { query: input.query, threadId: input.threadId || null, branchId: input.branchId || null, taskId: input.taskId || null }, String(input.sensitivity || "private"));
      db.prepare(`INSERT INTO retrieval_plans(id,planner_id,scope_id,query_encrypted_id,query_signature,intent,need_decision,consistency_mode,features_json,route_json,time_lens_json,canonical_sequence,working_set_sequence,projection_epochs_json,policy_version,latency_budget_ms,cost_budget_usd,expected_value,avoided_calls,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?)`).run(id, planner.id, String(input.scopeId), queryId, querySignature, classification.intent, classification.decision,
        classification.decision === "live_domain" ? "live_domain" : String(input.consistencyMode || "strict"), JSON.stringify(classification.features), JSON.stringify(routes.map((item) => item.channel)), JSON.stringify(timeLens),
        Math.max(0, Number(watermark.canonicalSequence || 0)), Math.max(0, Number(watermark.workingSetSequence || 0)), JSON.stringify(watermark.projectionEpochs || {}), String(watermark.policyVersion || input.policyVersion || "policy:v1"),
        classification.latencyBudgetMs, classification.costBudgetUsd, classification.expectedValue, classification.decision === "none" ? Math.max(1, Number(input.baselineCalls || 3)) : Math.max(0, Number(input.baselineCalls || 3) - routes.length), now);
      routes.forEach((route, ordinal) => db.prepare("INSERT INTO retrieval_plan_channels(plan_id,channel,ordinal,reason_code,estimated_latency_ms,estimated_cost_usd) VALUES(?,?,?,?,?,?)").run(id, route.channel, ordinal, route.reasonCode, route.estimatedLatencyMs, route.estimatedCostUsd));
      faultInjector("planner.plan.before_commit"); return { id, plannerVersion: planner.planner_version, ...classification, routes, timeLens, consistencyMode: classification.decision === "live_domain" ? "live_domain" : String(input.consistencyMode || "strict"), providerCalls: 0 };
    }); return run.immediate();
  }

  function fuse(input = {}) {
    const planRow = db.prepare("SELECT * FROM retrieval_plans WHERE id=?").get(String(input.planId)); if (!planRow) throw new Error("Retrieval plan is unavailable."); const planner = db.prepare("SELECT * FROM retrieval_planner_versions WHERE id=?").get(planRow.planner_id); const weights = JSON.parse(planner.weights_json); const byRecord = new Map(); const k = Math.max(1, Number(input.rrfK || 60)); const allowedScopes = new Set((input.allowedScopeIds || [planRow.scope_id]).map(String));
    for (const [channel, candidates] of Object.entries(input.channels || {})) (candidates || []).forEach((candidate, index) => { const scopeId = String(candidate.scopeId || planRow.scope_id); if (!allowedScopes.has(scopeId)) throw Object.assign(new Error("Fusion candidate scope is not authorized."), { code: "RETRIEVAL_SCOPE_DENIED" }); const key = `${candidate.recordType}:${candidate.recordId}:${candidate.recordVersion}`; const item = byRecord.get(key) || { scopeId, recordType: String(candidate.recordType), recordId: String(candidate.recordId), recordVersion: String(candidate.recordVersion), clusterKey: String(candidate.clusterKey || key), channels: [], rawRanks: {}, features: {} }; if (item.scopeId !== scopeId) throw new Error("One record version cannot span scopes.");
      item.channels.push(channel); item.rawRanks[channel] = Math.max(1, Number(candidate.rank || index + 1)); item.features = { ...item.features, ...(candidate.features || {}) }; byRecord.set(key, item); });
    const scored = [...byRecord.values()].map((item) => { const rrf = Object.values(item.rawRanks).reduce((sum, rank) => sum + 1 / (k + rank), 0); const f = item.features; const exact = item.channels.includes("exact") ? 1 : clamp(f.exact); const utility = Math.max(-1, Math.min(1, Number(f.utility || 0))); const final = weights.rrf * rrf + weights.exact * exact + weights.task * clamp(f.task) + weights.semantic * clamp(f.semantic) + weights.lexical * clamp(f.lexical) + weights.temporal * clamp(f.temporal) + weights.provenance * clamp(f.provenance) + weights.confirmation * clamp(f.confirmation) + weights.freshness * clamp(f.freshness) + weights.graph * clamp(f.graph) + weights.utility * utility + weights.contradiction * clamp(f.contradiction) + weights.weakDerivation * clamp(f.weakDerivation) + weights.redundancy * clamp(f.redundancy);
      return { ...item, rrfScore: rrf, finalScore: final, exact }; }).sort((a, b) => b.exact - a.exact || b.finalScore - a.finalScore || a.recordId.localeCompare(b.recordId));
    const quota = Math.max(1, Number(input.maxPerCluster || 2)); const limit = Math.max(1, Math.min(100, Number(input.limit || 20))); const clusters = new Map(); let ordinal = 0;
    const run = db.transaction(() => { db.prepare("DELETE FROM retrieval_fusion_candidates WHERE plan_id=?").run(planRow.id); const results = scored.map((item) => { const used = clusters.get(item.clusterKey) || 0; const selected = used < quota && ordinal < limit; if (selected) { clusters.set(item.clusterKey, used + 1); ordinal += 1; }
        const decision = selected ? "selected" : used >= quota ? "diversity_filtered" : "below_cutoff"; const reasonCode = selected ? (item.exact ? "EXACT_PRIORITY" : "RRF_FEATURE_SCORE") : decision === "diversity_filtered" ? "CLUSTER_QUOTA" : "TOP_K_CUTOFF";
        db.prepare("INSERT INTO retrieval_fusion_candidates(plan_id,scope_id,record_type,record_id,record_version,cluster_key,channels_json,raw_ranks_json,features_json,rrf_score,final_score,decision,ordinal,reason_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(planRow.id, item.scopeId, item.recordType, item.recordId, item.recordVersion, item.clusterKey, JSON.stringify(item.channels), JSON.stringify(item.rawRanks), JSON.stringify(item.features), item.rrfScore, item.finalScore, decision, selected ? ordinal : null, reasonCode);
        return { ...item, decision, ordinal: selected ? ordinal : null, reasonCode }; }); faultInjector("planner.fuse.before_commit"); return results; });
    const all = run.immediate(); db.prepare("UPDATE retrieval_plans SET status='executed' WHERE id=?").run(planRow.id); return { planId: planRow.id, selected: all.filter((item) => item.decision === "selected"), filtered: all.filter((item) => item.decision !== "selected") };
  }

  function requestMidtask(input = {}) {
    if (!MIDTASK_TRIGGERS.has(String(input.triggerType))) throw new Error("Mid-task retrieval trigger is not allowed."); const max = Math.max(0, Math.min(5, Number(input.maxRetrievals ?? 2))); const used = Number(db.prepare("SELECT COUNT(*) AS count FROM midtask_retrieval_checkpoints WHERE task_id=? AND status IN ('allowed','consumed')").get(String(input.taskId)).count); const allowed = used < max && Number(input.remainingLatencyMs || 0) >= 5 && Number(input.remainingCostUsd || 0) >= 0;
    const id = String(input.id || crypto.randomUUID()); const ordinal = used + 1; db.prepare("INSERT INTO midtask_retrieval_checkpoints(id,task_id,checkpoint_ref,plan_id,trigger_type,ordinal,status,reason_code,created_at) VALUES(?,?,?,?,?,?,?, ?,?)")
      .run(id, String(input.taskId), String(input.checkpointRef), input.planId ? String(input.planId) : null, String(input.triggerType), ordinal, allowed ? "allowed" : "denied", allowed ? "BOUNDED_REENTRY" : used >= max ? "TASK_RETRIEVAL_LIMIT" : "INSUFFICIENT_REMAINING_BUDGET", clock().toISOString());
    return { id, allowed, ordinal, reasonCode: allowed ? "BOUNDED_REENTRY" : used >= max ? "TASK_RETRIEVAL_LIMIT" : "INSUFFICIENT_REMAINING_BUDGET" };
  }
  function consumeMidtask(id, planId) { const changed = db.prepare("UPDATE midtask_retrieval_checkpoints SET status='consumed',plan_id=? WHERE id=? AND status='allowed'").run(String(planId), String(id)); if (changed.changes !== 1) throw new Error("Allowed mid-task checkpoint is unavailable."); return { id: String(id), planId: String(planId), status: "consumed" }; }

  function recordOutcome(input = {}) {
    const planRow = db.prepare("SELECT id,scope_id FROM retrieval_plans WHERE id=?").get(String(input.planId)); if (!planRow) throw new Error("Retrieval plan is unavailable."); const governed = Number(db.pragma("user_version", { simple: true })) >= 22; let verification = null; if (governed && input.verified) { verification = db.prepare("SELECT id,scope_id,success FROM outcome_verifications WHERE id=?").get(String(input.verificationId)); if (!verification || verification.scope_id !== planRow.scope_id) throw Object.assign(new Error("Verified retrieval utility requires a scope-matched outcome receipt."), { code: "RETRIEVAL_OUTCOME_VERIFICATION_REQUIRED" }); } const verified = Boolean(input.verified && (!governed || verification)); const type = String(input.outcomeType || "neutral");
    let utility = type === "helpful" ? 0.25 : type === "distracting" ? -0.2 : type === "missed_beneficial" ? -0.35 : type === "correction" ? -0.6 : 0; if (!verified) utility = 0;
    const id = String(input.id || crypto.randomUUID()); const run = db.transaction(() => { const detailsId = input.details == null ? null : encrypt(planRow.scope_id, "retrieval-outcome-details", input.details); if (governed) db.prepare("INSERT INTO retrieval_outcomes(id,plan_id,outcome_type,verified,supported_claims,successful_steps,correction_count,utility_delta,details_encrypted_id,created_at,verification_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, planRow.id, type, verified ? 1 : 0, Math.max(0, Number(input.supportedClaims || 0)), Math.max(0, Number(input.successfulSteps || 0)), Math.max(0, Number(input.correctionCount || 0)), utility, detailsId, clock().toISOString(), verification?.id || null); else db.prepare("INSERT INTO retrieval_outcomes(id,plan_id,outcome_type,verified,supported_claims,successful_steps,correction_count,utility_delta,details_encrypted_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(id, planRow.id, type, verified ? 1 : 0, Math.max(0, Number(input.supportedClaims || 0)), Math.max(0, Number(input.successfulSteps || 0)), Math.max(0, Number(input.correctionCount || 0)), utility, detailsId, clock().toISOString()); faultInjector("planner.outcome.before_commit"); return { id, verified, verificationId: verification?.id || null, utilityDelta: utility, mayOverrideTruth: false }; }); return run.immediate();
  }

  function readPlan(id) { const row = db.prepare("SELECT * FROM retrieval_plans WHERE id=?").get(String(id)); if (!row) return null; return { id: row.id, intent: row.intent, decision: row.need_decision, consistencyMode: row.consistency_mode, features: JSON.parse(row.features_json), routes: JSON.parse(row.route_json), expectedValue: row.expected_value, avoidedCalls: row.avoided_calls,
    watermark: { canonicalSequence: row.canonical_sequence, workingSetSequence: row.working_set_sequence, projectionEpochs: JSON.parse(row.projection_epochs_json), policyVersion: row.policy_version }, candidates: db.prepare("SELECT * FROM retrieval_fusion_candidates WHERE plan_id=? ORDER BY ordinal IS NULL,ordinal,record_id").all(row.id).map((item) => ({ recordType: item.record_type, recordId: item.record_id, recordVersion: item.record_version, channels: JSON.parse(item.channels_json), rawRanks: JSON.parse(item.raw_ranks_json), features: JSON.parse(item.features_json), rrfScore: item.rrf_score, finalScore: item.final_score, decision: item.decision, ordinal: item.ordinal, reasonCode: item.reason_code })) }; }

  return Object.freeze({ classify, consumeMidtask, expandTimeLens, fuse, plan, readPlan, recordOutcome, registerPlanner, requestMidtask, routeFor });
}

module.exports = { DEFAULT_WEIGHTS, createRetrievalPlannerRepository, normalizeQuery };
