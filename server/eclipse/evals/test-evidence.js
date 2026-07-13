// P1·W5 evidence store + promotion gate test. Run: node server/eclipse/evals/test-evidence.js
// In-memory sqlite; pure decision logic. Zero Gemini.
const assert = require("assert");
const Database = require("better-sqlite3");
const { migrate } = require("../db/migrations");
const { createEvidenceStore } = require("../evidence/store");
const promotion = require("../evidence/promotion");

let pass = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { console.error("  ✗", name, "\n     ", e.stack || e.message); process.exitCode = 1; } };

console.log("ECLIPSE P1·W5 — evidence graph & promotion gate");

ok("evidence + claim + edge persist and round-trip", () => {
  const db = new Database(":memory:"); migrate(db);
  const es = createEvidenceStore(db);
  const ev = es.putEvidence({ missionId: "m1", uri: "https://s/1", excerpt: "supporting text", sourceType: "web" });
  assert.ok(ev.evidenceId && ev.contentHash);
  const claim = es.putClaim({ missionId: "m1", text: "X is true", class: "fact", confidence: 0.7, status: "unsupported" }, [{ evidenceId: ev.evidenceId, entailment: 0.8, quoteSafe: true }]);
  assert.equal(es.getEvidence("m1").length, 1);
  assert.equal(es.getClaims("m1").length, 1);
  assert.equal(es.getSupport(claim.claimId).length, 1);
  es.promoteClaim(claim.claimId, { confidence: 0.85 });
  const c = es.getClaims("m1")[0];
  assert.equal(c.status, "supported"); assert.equal(c.quarantined, 0);
});

ok("promotion gate: all sources re-verify → validated", () => {
  const d = promotion.evaluate({ evidence: [{ sourceUri: "a" }, { sourceUri: "b" }] }, [
    { supported: true, live: true, entailment: 0.9 },
    { supported: true, live: true, entailment: 0.8 },
  ]);
  assert.equal(d.status, "validated");
  assert.ok(d.confidence > 0.7 && d.entailment > 0.8);
});

ok("promotion gate: no live+supported source → refuted", () => {
  const d = promotion.evaluate({ evidence: [{ sourceUri: "a" }] }, [{ supported: false, live: true, entailment: 0.1 }]);
  assert.equal(d.status, "refuted");
});

ok("promotion gate: dead source → refuted with reason", () => {
  const d = promotion.evaluate({ evidence: [{ sourceUri: "a" }] }, [{ supported: false, live: false, entailment: 0 }]);
  assert.equal(d.status, "refuted");
  assert.ok(d.reasons.join(" ").match(/dead|unreachable/));
});

ok("promotion gate: weak entailment → partial (not asserted as fact)", () => {
  const d = promotion.evaluate({ evidence: [{ sourceUri: "a" }] }, [{ supported: true, live: true, entailment: 0.3 }]);
  assert.equal(d.status, "partial");
});

ok("promotion gate: no evidence → partial, never validated", () => {
  const d = promotion.evaluate({ evidence: [] }, []);
  assert.equal(d.status, "partial");
  assert.equal(d.verified.length, 0);
});

console.log(`\n${pass} passed${process.exitCode ? " · FAILURES ABOVE" : ", 0 failed"}`);
