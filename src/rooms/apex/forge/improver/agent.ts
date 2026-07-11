/* THE IMPROVER — K5 scoped analysis agent (client side).
   Answers any question about ONE strategy's report, grounded in the artifacts.
   Compute-on-demand: it resolves any metric the question references through the
   registry BEFORE asking the brain, so it never dead-ends on "what's my X?".
   Server does the reasoning (source apex-forge → bypasses the evidence gate). */

import { REGISTRY, resolveMetric } from "./metrics";
import type { RunArtifact } from "./artifact";
import type { ImproverReport } from "./engine";

export async function askImproverAgent(question: string, report: ImproverReport, run: RunArtifact): Promise<string> {
  const q = question.toLowerCase();
  // resolve any metric named in the question (never-no path)
  const asked = REGISTRY.filter(d => [d.id, ...d.aliases].some(a => q.includes(a.toLowerCase().split("(")[0].trim()))).slice(0, 5);
  const computed = asked.map(d => { const m = resolveMetric(run, d.id); return `${m.label} = ${m.value}${m.unit} — ${m.diagnosis} [formula: ${m.formula}]`; });

  const context = {
    strategy: run.spec.meta.name, symbol: run.meta.symbol, grade: report.grade, summary: report.summary,
    weaknesses: report.nodes.filter(n => n.kind === "weakness" && n.verdict === "confirmed").map(n => `${n.claim} — ${n.evidence[0] || ""}`),
    strengths: report.strengths.map(s => s.claim),
    fixes: report.cards.map(c => `${c.title} (targets ${c.targetedMetrics.join("/")})`),
    metrics: report.metrics.filter(m => m.verdict !== "na").map(m => `${m.label}=${m.value}${m.unit}`),
    computedForQuestion: computed,
    trades: run.ledger.length,
  };
  try {
    const res = await fetch("/api/apex/forge-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }) });
    if (!res.ok) return "The analysis agent is unreachable — is the backend running?";
    const j = await res.json();
    return j.answer || j.error || "No answer returned.";
  } catch { return "The analysis agent is unreachable — is the backend running?"; }
}
