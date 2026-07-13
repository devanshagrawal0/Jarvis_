// ECLIPSE evidence & claim graph — the verifiability spine. Workers capture EvidenceObjects;
// the Prosecutor forms Claims and links them to evidence (claim_evidence_edges) with an
// entailment score. A claim is PROMOTED (quarantined→validated) only when its supporting
// evidence re-verifies and entailment clears the gate. Persisted to eclipse.sqlite so the
// Evidence view + Jarvis recall read real rows, never fabricated activity.
const { validate, EvidenceObject, Claim } = require("../contracts");
const { id, nowIso, hashOf } = require("../contracts/validate");

function createEvidenceStore(db) {
  const q = {
    putEv: db.prepare(`INSERT OR REPLACE INTO evidence_objects(evidence_id,mission_id,source_type,uri,local_path,locator_json,captured_at,published_at,content_hash,excerpt,metadata_json,reliability_json)
      VALUES(@evidence_id,@mission_id,@source_type,@uri,@local_path,@locator_json,@captured_at,@published_at,@content_hash,@excerpt,@metadata_json,@reliability_json)`),
    getEv: db.prepare(`SELECT * FROM evidence_objects WHERE mission_id=?`),
    getEv1: db.prepare(`SELECT * FROM evidence_objects WHERE evidence_id=?`),
    putClaim: db.prepare(`INSERT OR REPLACE INTO claims(claim_id,mission_id,text,class,confidence,status,quarantined) VALUES(@claim_id,@mission_id,@text,@class,@confidence,@status,@quarantined)`),
    getClaims: db.prepare(`SELECT * FROM claims WHERE mission_id=?`),
    setClaimStatus: db.prepare(`UPDATE claims SET status=?, quarantined=?, confidence=? WHERE claim_id=?`),
    link: db.prepare(`INSERT OR REPLACE INTO claim_evidence_edges(claim_id,evidence_id,entailment,quote_safe) VALUES(?,?,?,?)`),
    edges: db.prepare(`SELECT * FROM claim_evidence_edges WHERE claim_id=?`),
  };

  // Capture an evidence object (validated against the schema). Content-addressed by hash.
  function putEvidence(ev) {
    const obj = validate(EvidenceObject, {
      evidenceId: ev.evidenceId || id("ev"), missionId: ev.missionId, sourceType: ev.sourceType || "web",
      uri: ev.uri, localPath: ev.localPath, locator: ev.locator, capturedAt: ev.capturedAt || nowIso(), publishedAt: ev.publishedAt,
      contentHash: ev.contentHash || hashOf(ev.excerpt || ev.uri || ""), excerpt: (ev.excerpt || "").slice(0, 4000),
      metadata: ev.metadata || {}, reliability: ev.reliability || { authority: 0.5, freshness: 0.5, directness: 0.6, notes: [] },
    }, "evidence");
    q.putEv.run({ evidence_id: obj.evidenceId, mission_id: obj.missionId, source_type: obj.sourceType, uri: obj.uri || null, local_path: obj.localPath || null,
      locator_json: JSON.stringify(obj.locator || {}), captured_at: obj.capturedAt, published_at: obj.publishedAt || null, content_hash: obj.contentHash,
      excerpt: obj.excerpt, metadata_json: JSON.stringify(obj.metadata), reliability_json: JSON.stringify(obj.reliability) });
    return obj;
  }

  // Form a claim (starts quarantined) and link it to its supporting evidence.
  function putClaim(claim, supports = []) {
    const obj = validate(Claim, {
      claimId: claim.claimId || id("clm"), text: claim.text, class: claim.class || "fact",
      support: supports.map((s) => ({ evidenceId: s.evidenceId, entailment: s.entailment ?? 0.6, quoteSafe: s.quoteSafe ?? true })),
      confidence: claim.confidence ?? 0.6, status: claim.status || "unsupported",
    }, "claim");
    q.putClaim.run({ claim_id: obj.claimId, mission_id: claim.missionId, text: obj.text, class: obj.class, confidence: obj.confidence, status: obj.status, quarantined: 1 });
    for (const s of obj.support) q.link.run(obj.claimId, s.evidenceId, s.entailment, s.quoteSafe ? 1 : 0);
    return obj;
  }

  function promoteClaim(claimId, { confidence } = {}) { q.setClaimStatus.run("supported", 0, confidence ?? 0.8, claimId); }
  function rejectClaim(claimId, status = "unsupported") { q.setClaimStatus.run(status, 1, 0.2, claimId); }

  return {
    putEvidence, putClaim, promoteClaim, rejectClaim,
    getEvidence: (missionId) => q.getEv.all(missionId).map(rowToEv),
    getEvidenceById: (evId) => { const r = q.getEv1.get(evId); return r ? rowToEv(r) : null; },
    getClaims: (missionId) => q.getClaims.all(missionId),
    getSupport: (claimId) => q.edges.all(claimId),
  };
}
function rowToEv(r) { return { evidenceId: r.evidence_id, missionId: r.mission_id, sourceType: r.source_type, uri: r.uri, excerpt: r.excerpt, contentHash: r.content_hash, reliability: JSON.parse(r.reliability_json || "{}"), capturedAt: r.captured_at }; }

module.exports = { createEvidenceStore };
