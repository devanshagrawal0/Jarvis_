// ECLIPSE promotion gate — the rule that decides whether a quarantined worker packet becomes a
// VALIDATED claim. This is the load-bearing verifiability control: a claim is promoted only if
// (a) it carries evidence, (b) each cited source RE-VERIFIES via the Citation Verifier (the
// quote is actually supported and the source is live), and (c) mean entailment ≥ threshold.
// Anything short of that is refuted/partial and never presented as fact. No model call here —
// pure decision logic over verifier results (the Prosecutor supplies them).

const ENTAILMENT_MIN = 0.5;

// evaluate(packet, verifications) → { status, confidence, entailment, verified, reasons }
//   verifications: [{ evidenceRef, supported:boolean, entailment:0..1, live:boolean }]
function evaluate(packet, verifications = []) {
  const reasons = [];
  if (!packet.evidence || packet.evidence.length === 0) {
    return { status: "partial", confidence: 0.3, entailment: 0, verified: [], reasons: ["no evidence attached → cannot validate"] };
  }
  const verified = verifications.filter((v) => v.supported && v.live);
  const dead = verifications.filter((v) => !v.live);
  const unsupported = verifications.filter((v) => v.live && !v.supported);
  if (dead.length) reasons.push(`${dead.length} dead/unreachable source(s)`);
  if (unsupported.length) reasons.push(`${unsupported.length} source(s) do not support the claim`);

  if (!verified.length) {
    return { status: "refuted", confidence: 0.2, entailment: 0, verified, reasons: reasons.length ? reasons : ["no source re-verified"] };
  }
  const meanEntail = verified.reduce((a, v) => a + (v.entailment || 0), 0) / verified.length;
  if (meanEntail < ENTAILMENT_MIN) {
    return { status: "partial", confidence: 0.4, entailment: meanEntail, verified, reasons: [...reasons, `mean entailment ${meanEntail.toFixed(2)} < ${ENTAILMENT_MIN}`] };
  }
  // Promote. Confidence blends entailment with source reliability breadth.
  const confidence = Math.min(0.95, 0.5 + 0.4 * meanEntail + Math.min(0.1, 0.03 * verified.length));
  return { status: "validated", confidence: Number(confidence.toFixed(3)), entailment: Number(meanEntail.toFixed(3)), verified, reasons: reasons.length ? reasons : ["all cited sources re-verified"] };
}

module.exports = { evaluate, ENTAILMENT_MIN };
