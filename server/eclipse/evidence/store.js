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
    getByHash: db.prepare(`SELECT * FROM evidence_objects WHERE mission_id=? AND content_hash=? LIMIT 1`),
    putClaim: db.prepare(`INSERT OR REPLACE INTO claims(claim_id,mission_id,text,class,confidence,status,quarantined) VALUES(@claim_id,@mission_id,@text,@class,@confidence,@status,@quarantined)`),
    getClaims: db.prepare(`SELECT * FROM claims WHERE mission_id=?`),
    setClaimStatus: db.prepare(`UPDATE claims SET status=?, quarantined=?, confidence=? WHERE claim_id=?`),
    link: db.prepare(`INSERT OR REPLACE INTO claim_evidence_edges(claim_id,evidence_id,entailment,quote_safe) VALUES(?,?,?,?)`),
    edges: db.prepare(`SELECT * FROM claim_evidence_edges WHERE claim_id=?`),
  };

  // Capture an evidence object (validated against the schema). Content-addressed by hash.
  function putEvidence(ev) {
    // K: content-addressed. The same content (same mission, same hash) is ONE evidence row -
    // observed failure was the same URI stored 4x, each judged separately downstream.
    const preHash = ev.contentHash || hashOf((ev.excerpt || "").slice(0, 12000) || ev.uri || "");
    const dup = q.getByHash.get(ev.missionId, preHash);
    // Tell the caller it was a duplicate: announcing 'evidence.captured' for content the
    // mission already holds inflates every source count downstream.
    if (dup) return { ...rowToEv(dup), deduped: true };
    const obj = validate(EvidenceObject, {
      evidenceId: ev.evidenceId || id("ev"), missionId: ev.missionId, sourceType: ev.sourceType || "web",
      uri: ev.uri, localPath: ev.localPath, locator: ev.locator, capturedAt: ev.capturedAt || nowIso(), publishedAt: ev.publishedAt,
      contentHash: ev.contentHash || hashOf(ev.excerpt || ev.uri || ""), // 4000 discarded half of every fetched page. Measured failure: a NASA page's mirror
      // specification sat past the cut, so the verifier was asked about text it had never been
      // shown and refuted a true claim. Storage is cheap; losing the evidence is not.
      excerpt: (ev.excerpt || "").slice(0, 12000),
      metadata: ev.metadata || {}, reliability: ev.reliability || { authority: 0.5, freshness: 0.5, directness: 0.6, notes: [] },
    }, "evidence");
    q.putEv.run({ evidence_id: obj.evidenceId, mission_id: obj.missionId, source_type: obj.sourceType, uri: obj.uri || null, local_path: obj.localPath || null,
      locator_json: JSON.stringify(obj.locator || {}), captured_at: obj.capturedAt, published_at: obj.publishedAt || null, content_hash: obj.contentHash,
      excerpt: obj.excerpt, metadata_json: JSON.stringify(obj.metadata), reliability_json: JSON.stringify(obj.reliability) });
    return obj;
  }

  // 3.4: the critic's per-source credibility lands on the evidence row's reliability.authority,
  // where promotion weighting reads it. Model-assessed + query-relative; never a domain list.
  function setSourceCredibility(missionId, credByUri) {
    const rows = q.getEv.all(missionId) || [];
    for (const r of rows) {
      if (!credByUri.has(r.uri)) continue;
      const rel = JSON.parse(r.reliability_json || "{}");
      rel.authority = Number(credByUri.get(r.uri));
      db.prepare(`UPDATE evidence_objects SET reliability_json=? WHERE evidence_id=?`).run(JSON.stringify(rel), r.evidence_id);
    }
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
    setSourceCredibility,
    putEvidence, putClaim, promoteClaim, rejectClaim,
    getEvidence: (missionId) => q.getEv.all(missionId).map(rowToEv),
    getEvidenceById: (evId) => { const r = q.getEv1.get(evId); return r ? rowToEv(r) : null; },
    getClaims: (missionId) => q.getClaims.all(missionId),
    getSupport: (claimId) => q.edges.all(claimId),
  };
}
function rowToEv(r) { return { evidenceId: r.evidence_id, missionId: r.mission_id, sourceType: r.source_type, uri: r.uri, excerpt: r.excerpt, contentHash: r.content_hash, reliability: JSON.parse(r.reliability_json || "{}"), capturedAt: r.captured_at }; }

module.exports = { createEvidenceStore };
