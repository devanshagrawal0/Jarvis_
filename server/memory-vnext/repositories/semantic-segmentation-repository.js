"use strict";

const crypto = require("node:crypto");
const { insertEncrypted } = require("./ledger-repository");

const STOP = new Set("a an and are as at be by for from has have i in is it of on or that the this to was were will with you your we our".split(" "));

function tokens(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)))];
}

function jaccard(left, right) {
  const a = new Set(left); const b = new Set(right); const union = new Set([...a, ...b]);
  if (!union.size) return 1;
  return [...a].filter((value) => b.has(value)).length / union.size;
}

function createSemanticSegmentationRepository({ db, keyring, clock, faultInjector }, options = {}) {
  if (Number(db.pragma("user_version", { simple: true })) < 8) throw new Error("Semantic segmentation requires schema version 8.");
  const profile = {
    id: String(options.profileId || "segmenter:deterministic-v1"), version: String(options.profileVersion || "1.0.0"),
    continueBelow: Number(options.continueBelow ?? 0.42), splitAbove: Number(options.splitAbove ?? 0.68),
    classifier: typeof options.ambiguousClassifier === "function" ? options.ambiguousClassifier : null,
    classifierName: options.classifierName ? String(options.classifierName) : null,
    classifierVersion: options.classifierVersion ? String(options.classifierVersion) : null,
  };
  db.prepare(`INSERT OR IGNORE INTO segmentation_profiles(id,version,thresholds_json,classifier_name,classifier_version,benchmark_status,created_at)
    VALUES(?,?,?,?,?,'unverified',?)`).run(profile.id, profile.version, JSON.stringify({ continueBelow: profile.continueBelow, splitAbove: profile.splitAbove }), profile.classifierName, profile.classifierVersion, clock().toISOString());

  function decrypt(id) {
    const row = db.prepare("SELECT * FROM encrypted_objects WHERE id=?").get(id);
    if (!row) throw new Error("Encrypted semantic object is unavailable.");
    return JSON.parse(keyring.decrypt({ keyId: row.key_id, keyVersion: row.key_version, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag, aadJson: row.aad_json, contentMac: row.content_mac }, JSON.parse(row.aad_json)).toString("utf8"));
  }

  function turnContext(turnId) {
    const row = db.prepare(`SELECT t.*,c.scope_id FROM turns t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=?`).get(String(turnId));
    if (!row || row.status !== "finalized") throw new Error("A finalized turn is required for segmentation.");
    return { ...row, text: decrypt(row.content_encrypted_id).text };
  }

  function featureScore(previous, current, input) {
    const previousTokens = previous ? tokens(previous.text) : [];
    const currentTokens = tokens(current.text);
    const similarity = previous ? jaccard(previousTokens, currentTokens) : 0;
    const transition = /\b(new topic|switch(?:ing)? to|separately|moving on|different question|instead)\b/i.test(current.text);
    const closure = /\b(done with|close this|that is all|finished|wrap(?:ped)? up)\b/i.test(previous?.text || "") || Boolean(input.explicitClosure);
    const timeGapMs = previous ? Math.max(0, Date.parse(current.occurred_at) - Date.parse(previous.occurred_at)) : 0;
    let score = previous ? (1 - similarity) * 0.58 : 1;
    if (transition) score += 0.34;
    if (closure) score += 0.3;
    if (timeGapMs >= Number(input.idleThresholdMs || 30 * 60_000)) score += 0.18;
    if (input.taskCompleted) score += 0.28;
    if (input.branchResumed) score += 0.12;
    return { score: Math.max(0, Math.min(1, score)), features: { similarity, transition, closure, timeGapMs, taskCompleted: Boolean(input.taskCompleted), branchResumed: Boolean(input.branchResumed), previousTokens, currentTokens } };
  }

  function deriveTopicKey(text) {
    const values = tokens(text).slice(0, 4);
    return values.length ? values.join(":") : "general";
  }

  function createEpisode(segment, trigger, scopeId) {
    const members = db.prepare("SELECT turn_id FROM semantic_segment_members WHERE segment_id=? ORDER BY ordinal").all(segment.id).map((row) => row.turn_id);
    const payload = { segmentId: segment.id, topicKey: segment.topic_key, coveredTurnIds: members };
    const coverage = keyring.sign(JSON.stringify(members), "episode-coverage-v1");
    const encrypted = insertEncrypted(db, keyring, clock, { objectType: "episode-candidate", scopeId, sensitivity: "private", payload });
    const id = crypto.randomUUID(); const now = clock().toISOString();
    db.prepare(`INSERT INTO episode_candidates(id,conversation_id,scope_id,branch_id,status,closure_trigger,payload_encrypted_id,coverage_checksum,created_at,closed_at)
      VALUES(?,?,?,?,'ready',?,?,?,?,?)`).run(id, segment.conversation_id, scopeId, segment.branch_id, trigger, encrypted.id, coverage, now, now);
    members.forEach((member, ordinal) => db.prepare("INSERT INTO episode_members(episode_id,member_type,member_ref,ordinal) VALUES(?,'turn',?,?)").run(id, member, ordinal));
    db.prepare("INSERT INTO episode_members(episode_id,member_type,member_ref,ordinal) VALUES(?,'segment',?,?)").run(id, segment.id, members.length);
    return id;
  }

  function processTurn(input = {}) {
    const current = turnContext(input.turnId);
    const existing = db.prepare("SELECT * FROM topic_boundary_observations WHERE conversation_id=? AND branch_id=? AND current_turn_id=?").get(current.conversation_id, current.branch_id, current.id);
    if (existing) return describeObservation(existing, true);
    const previousRow = db.prepare(`SELECT id FROM turns WHERE conversation_id=? AND branch_id=? AND status='finalized' AND
      (COALESCE(client_sequence,-1)<COALESCE(?, -1) OR (client_sequence IS NULL AND recorded_at<?)) ORDER BY COALESCE(client_sequence,-1) DESC,recorded_at DESC,id DESC LIMIT 1`)
      .get(current.conversation_id, current.branch_id, current.client_sequence, current.recorded_at);
    const previous = previousRow ? turnContext(previousRow.id) : null;
    const calculated = featureScore(previous, current, input);
    const closeAfterCurrent = Boolean(input.explicitClosure || input.taskCompleted || /\b(done with|close this|that is all|finished|wrap(?:ped)? up)\b/i.test(current.text));
    let classifierScore = null; let decision; let reason;
    if (closeAfterCurrent && previous) { decision = "continue"; reason = "current_semantic_closure"; }
    else if (!previous) { decision = "split"; reason = "conversation_start"; }
    else if (calculated.score < profile.continueBelow) { decision = "continue"; reason = "deterministic_continuity"; }
    else if (calculated.score >= profile.splitAbove) { decision = "split"; reason = "deterministic_boundary"; }
    else if (profile.classifier) {
      classifierScore = Math.max(0, Math.min(1, Number(profile.classifier({ previous: previous.text, current: current.text, features: calculated.features }))));
      decision = classifierScore >= 0.5 ? "split" : "continue"; reason = "local_ambiguous_classifier";
    } else { decision = calculated.features.similarity >= 0.25 ? "continue" : "split"; reason = "deterministic_ambiguous_tiebreak"; }
    const requestedTopic = String(input.topicKey || deriveTopicKey(current.text));
    const run = db.transaction(() => {
      const now = clock().toISOString(); let segment; let episodeId = null;
      const open = db.prepare("SELECT * FROM semantic_segments WHERE conversation_id=? AND branch_id=? AND state='open' ORDER BY created_at DESC LIMIT 1").get(current.conversation_id, current.branch_id);
      if (decision === "continue" && open) {
        segment = open;
        const ordinal = Number(db.prepare("SELECT COALESCE(MAX(ordinal),-1)+1 AS next FROM semantic_segment_members WHERE segment_id=?").get(segment.id).next);
        db.prepare("INSERT INTO semantic_segment_members(segment_id,turn_id,ordinal,link_type,created_at) VALUES(?,?,?,'contiguous',?)").run(segment.id, current.id, ordinal, now);
        db.prepare("UPDATE semantic_segments SET end_turn_id=?,updated_at=? WHERE id=?").run(current.id, now, segment.id);
      } else {
        if (open) {
          db.prepare("UPDATE semantic_segments SET state='closed',end_turn_id=?,boundary_reason=?,updated_at=? WHERE id=?")
            .run(previous?.id || open.end_turn_id, reason, now, open.id);
          episodeId = createEpisode({ ...open, end_turn_id: previous?.id || open.end_turn_id }, input.taskCompleted ? "task_complete" : input.explicitClosure ? "explicit_close" : "topic_switch", current.scope_id);
        }
        const linked = db.prepare(`SELECT * FROM semantic_segments WHERE conversation_id=? AND topic_key=? AND state IN ('closed','linked') ORDER BY updated_at DESC LIMIT 1`).get(current.conversation_id, requestedTopic);
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO semantic_segments(id,conversation_id,branch_id,topic_key,state,start_turn_id,end_turn_id,linked_segment_id,boundary_reason,capsule_encrypted_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?)`).run(id, current.conversation_id, current.branch_id, requestedTopic, linked ? "linked" : "open", current.id, current.id, linked?.id || null, reason, now, now);
        db.prepare("INSERT INTO semantic_segment_members(segment_id,turn_id,ordinal,link_type,created_at) VALUES(?,?,0,?,?)")
          .run(id, current.id, linked ? (input.branchResumed ? "branch_resume" : "return") : "contiguous", now);
        if (linked) db.prepare("UPDATE semantic_segments SET state='open',updated_at=? WHERE id=?").run(now, id);
        segment = db.prepare("SELECT * FROM semantic_segments WHERE id=?").get(id);
      }
      const observationId = crypto.randomUUID();
      db.prepare(`INSERT INTO topic_boundary_observations(id,conversation_id,branch_id,previous_turn_id,current_turn_id,profile_id,deterministic_score,features_json,classifier_score,decision,reason,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(observationId, current.conversation_id, current.branch_id, previous?.id || null, current.id, profile.id,
        calculated.score, JSON.stringify({ ...calculated.features, previousTokens: undefined, currentTokens: undefined }), classifierScore, decision, reason, now);
      if (closeAfterCurrent) {
        db.prepare("UPDATE semantic_segments SET state='closed',end_turn_id=?,boundary_reason=?,updated_at=? WHERE id=?")
          .run(current.id, reason, now, segment.id);
        episodeId = createEpisode(segment, input.taskCompleted ? "task_complete" : "explicit_close", current.scope_id);
      }
      faultInjector("semantic.segment.before_commit");
      return { observationId, segmentId: segment.id, decision, reason, deterministicScore: calculated.score, classifierScore, episodeId, replayed: false };
    });
    return run.immediate();
  }

  function describeObservation(row, replayed) {
    const segment = db.prepare("SELECT segment_id FROM semantic_segment_members WHERE turn_id=?").get(row.current_turn_id);
    return { observationId: row.id, segmentId: segment?.segment_id || null, decision: row.decision, reason: row.reason, deterministicScore: row.deterministic_score, classifierScore: row.classifier_score, replayed };
  }

  function closeSegment(input = {}) {
    const segment = db.prepare("SELECT s.*,c.scope_id FROM semantic_segments s JOIN conversations c ON c.id=s.conversation_id WHERE s.id=?").get(String(input.segmentId));
    if (!segment || segment.state !== "open") throw new Error("Open semantic segment is unavailable.");
    const trigger = String(input.trigger || "explicit_close");
    const run = db.transaction(() => {
      const now = clock().toISOString();
      db.prepare("UPDATE semantic_segments SET state='closed',boundary_reason=?,updated_at=? WHERE id=?").run(trigger, now, segment.id);
      return { segmentId: segment.id, episodeId: createEpisode(segment, trigger, segment.scope_id), state: "closed" };
    });
    return run.immediate();
  }

  function createBranchCapsule(input = {}) {
    const rows = db.prepare("SELECT id FROM turns WHERE conversation_id=? AND branch_id=? AND status='finalized' ORDER BY COALESCE(client_sequence,-1),recorded_at,id")
      .all(String(input.conversationId), String(input.branchId));
    const ids = rows.map((row) => row.id); const conversation = db.prepare("SELECT scope_id FROM conversations WHERE id=?").get(String(input.conversationId));
    if (!conversation) throw new Error("Conversation is unavailable.");
    const payload = { summary: String(input.summary || ""), coveredTurnIds: ids, openThreads: input.openThreads || [] };
    const encrypted = insertEncrypted(db, keyring, clock, { objectType: "branch-capsule", scopeId: conversation.scope_id, sensitivity: "private", payload });
    const checksum = keyring.sign(JSON.stringify(payload), "branch-capsule-v1"); const id = crypto.randomUUID();
    db.prepare("INSERT INTO branch_capsules(id,conversation_id,branch_id,covered_turn_ids_json,capsule_encrypted_id,checksum,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, String(input.conversationId), String(input.branchId), JSON.stringify(ids), encrypted.id, checksum, clock().toISOString());
    return { id, checksum, coveredTurnIds: ids };
  }

  function markBenchmark(status) {
    if (!['passed','failed'].includes(String(status))) throw new Error("Benchmark status must be passed or failed.");
    db.prepare("UPDATE segmentation_profiles SET benchmark_status=? WHERE id=?").run(String(status), profile.id);
    return { profileId: profile.id, status: String(status) };
  }

  function listSegments(conversationId) {
    return db.prepare("SELECT * FROM semantic_segments WHERE conversation_id=? ORDER BY created_at,id").all(String(conversationId)).map((row) => ({
      id: row.id, branchId: row.branch_id, topicKey: row.topic_key, state: row.state, startTurnId: row.start_turn_id, endTurnId: row.end_turn_id, linkedSegmentId: row.linked_segment_id,
      turnIds: db.prepare("SELECT turn_id FROM semantic_segment_members WHERE segment_id=? ORDER BY ordinal").all(row.id).map((item) => item.turn_id),
    }));
  }

  return Object.freeze({ closeSegment, createBranchCapsule, listSegments, markBenchmark, processTurn, profile: Object.freeze({ ...profile, classifier: undefined }) });
}

module.exports = { createSemanticSegmentationRepository, jaccard, tokens };
