/* THE IMPROVER — K2/K3 core: the recursive diagnosis tree + synthesis.
   Decomposes a run into chunks, runs the testers as node-expanders, promotes
   confirmed weaknesses into rootcause nodes with justification children, prices
   every node by dollar-impact × confidence, clusters the findings by theme +
   degraded metric, mines strengths, and synthesizes a report with action cards
   stamped by target metric. Deterministic core (the Gemini-hypothesis expander
   + web-search knowledge layer + Worker pool are K4/K5 add-ons). Spec §3/§4/§11/§14. */

import type { RunArtifact, RegimeId, SpecPatch } from "./artifact";
import { REGIME_LABEL } from "./artifact";
import { computeAll, type MetricResult } from "./metrics";
import { runLedgerTesters, type TesterResult } from "./testers";

export type Verdict = "confirmed" | "refuted" | "partial";
export interface DiagNode {
  id: string; parentId: string | null; kind: "root" | "chunk" | "weakness" | "rootcause" | "justification" | "strength";
  claim: string; verdict: Verdict; confidence: number; dollarImpact: number;
  metricsHurt: string[]; evidence: string[]; fixHint?: string; severity: "info" | "low" | "med" | "high"; childIds: string[]; patch?: SpecPatch;
}
export interface ActionCard {
  id: string; sourceNodeId: string; title: string; targetedMetrics: string[];
  expectedDelta: string; risk: "low" | "med" | "high"; rationale: string; stage: number; patch?: SpecPatch;
}
export interface Cluster { theme: string; metric: string; nodeIds: string[]; dollarImpact: number; rep: string }
export interface ImproverReport {
  grade: string; summary: string; nodes: DiagNode[]; rootId: string;
  clusters: Cluster[]; strengths: DiagNode[]; cards: ActionCard[]; metrics: MetricResult[];
  stats: { nodes: number; weaknesses: number; confirmed: number };
}

const SEV_W: Record<string, number> = { info: 0, low: 1, med: 2, high: 4 };
let _seq = 0; const nid = () => `n${(_seq++).toString(36)}`;

/* Approx dollar impact of a weakness from its degraded metrics + severity, scaled
   by the run's total P&L magnitude (so it's comparable across nodes). */
function dollarOf(t: TesterResult, run: RunArtifact): number {
  const grossPnl = Math.abs(run.ledger.reduce((s, l) => s + l.pnl, 0)) || 1000;
  return SEV_W[t.severity] * 0.12 * grossPnl * (t.weakness ? 1 : 0);
}

/* Theme from a tester id. */
const THEME: Record<string, string> = { T4: "regime-blindness", T8: "exit-timing", T11: "exit-timing", T9: "edge-decay", T6: "sequence-risk", T2: "overfit", T7: "capacity", T8b: "exit-timing", Ttail: "tail-risk", Tserial: "sequence-risk", Texp: "exposure" };

export function runImprover(run: RunArtifact, opts: { nTrials?: number } = {}): ImproverReport {
  _seq = 0;
  const nodes: DiagNode[] = [];
  const add = (n: Omit<DiagNode, "childIds">, parent?: DiagNode): DiagNode => { const full = { ...n, childIds: [] }; nodes.push(full); if (parent) parent.childIds.push(full.id); return full; };

  const root = add({ id: nid(), parentId: null, kind: "root", claim: `Diagnosis of ${run.spec.meta.name} on ${run.meta.symbol}`, verdict: "confirmed", confidence: 1, dollarImpact: 0, metricsHurt: [], evidence: [`${run.ledger.length} trades · ${run.meta.barCount} bars`], severity: "info" });

  // ── Decompose into chunks: one global chunk + one per regime that has trades ──
  const regimesPresent = [...new Set(run.ledger.map(l => l.regimeAtEntry))] as RegimeId[];
  const globalChunk = add({ id: nid(), parentId: root.id, kind: "chunk", claim: "Whole-run diagnostics", verdict: "confirmed", confidence: 1, dollarImpact: 0, metricsHurt: [], evidence: [], severity: "info" }, root);

  // ── Run testers on the whole run → weakness/rootcause/justification nodes ──
  const testers = runLedgerTesters(run, opts.nTrials ?? 1);
  for (const t of testers) {
    const w = add({ id: nid(), parentId: globalChunk.id, kind: "weakness", claim: `${t.title}`, verdict: t.weakness ? "confirmed" : "refuted", confidence: t.weakness ? 0.8 : 0.7, dollarImpact: dollarOf(t, run), metricsHurt: t.metricsHurt, evidence: [t.finding], fixHint: t.fixHint, severity: t.severity, patch: t.patch }, globalChunk);
    if (t.weakness) {
      const rc = add({ id: nid(), parentId: w.id, kind: "rootcause", claim: t.finding, verdict: "confirmed", confidence: 0.8, dollarImpact: w.dollarImpact, metricsHurt: t.metricsHurt, evidence: [], fixHint: t.fixHint, severity: t.severity }, w);
      for (const e of t.evidence) add({ id: nid(), parentId: rc.id, kind: "justification", claim: `${e.stat} = ${e.value}${e.n != null ? ` (n=${e.n})` : ""}`, verdict: "confirmed", confidence: 0.9, dollarImpact: 0, metricsHurt: [], evidence: [], severity: "info" }, rc);
    }
  }

  // ── Metrics + strengths ──
  const metrics = computeAll(run);
  const strengths: DiagNode[] = [];
  for (const m of metrics.filter(x => x.verdict === "good").slice(0, 5)) strengths.push(add({ id: nid(), parentId: root.id, kind: "strength", claim: `${m.label} = ${m.value}${m.unit} — ${m.diagnosis}`, verdict: "confirmed", confidence: 0.85, dollarImpact: 0, metricsHurt: [], evidence: [m.formula], severity: "info" }, root));
  const bestRegime = regimesPresent.map(r => ({ r, exp: mean(run.ledger.filter(l => l.regimeAtEntry === r).map(l => l.netRet)) })).sort((a, b) => b.exp - a.exp)[0];
  if (bestRegime && bestRegime.exp > 0) strengths.push(add({ id: nid(), parentId: root.id, kind: "strength", claim: `Genuine edge in ${REGIME_LABEL[bestRegime.r]} (expectancy ${(bestRegime.exp * 100).toFixed(1)}%) — the sweet-spot regime to lean into.`, verdict: "confirmed", confidence: 0.8, dollarImpact: 0, metricsHurt: [], evidence: [], severity: "info" }, root));

  // ── Cluster confirmed weaknesses by (theme × primary degraded metric) ──
  const confirmed = nodes.filter(n => n.kind === "weakness" && n.verdict === "confirmed");
  const cmap = new Map<string, Cluster>();
  for (const w of confirmed) {
    const tid = testers.find(t => t.title === w.claim)?.id || "T?";
    const theme = THEME[tid] || "other"; const metric = w.metricsHurt[0] || "expectancy";
    const key = `${theme}|${metric}`;
    const c = cmap.get(key) || { theme, metric, nodeIds: [], dollarImpact: 0, rep: w.id };
    c.nodeIds.push(w.id); c.dollarImpact += w.dollarImpact; if (w.dollarImpact > (nodes.find(n => n.id === c.rep)?.dollarImpact || 0)) c.rep = w.id;
    cmap.set(key, c);
  }
  const clusters = [...cmap.values()].sort((a, b) => b.dollarImpact - a.dollarImpact);

  // ── Action cards from confirmed weaknesses with a fix hint, staged by $impact ──
  const cards: ActionCard[] = confirmed.filter(w => w.fixHint).sort((a, b) => b.dollarImpact - a.dollarImpact).map((w, i) => ({
    id: nid(), sourceNodeId: w.id, title: w.fixHint!, targetedMetrics: w.metricsHurt.length ? w.metricsHurt : ["expectancy"],
    expectedDelta: `≈$${Math.round(w.dollarImpact)} of the leak`, risk: w.confidence >= 0.8 ? "low" : w.confidence >= 0.6 ? "med" : "high",
    rationale: w.evidence[0] || w.claim, stage: i + 1, patch: w.patch,
  }));

  // ── Grade: penalize confirmed high-severity weaknesses ──
  const penalty = confirmed.reduce((s, w) => s + SEV_W[w.severity], 0);
  const score = Math.max(0, Math.min(100, 80 - penalty * 4 + Math.min(15, strengths.length * 2.5)));
  const grade = score >= 85 ? "A" : score >= 72 ? "B" : score >= 58 ? "C" : score >= 45 ? "D" : "F";
  const topWeak = confirmed.sort((a, b) => b.dollarImpact - a.dollarImpact)[0];
  const summary = `${confirmed.length} confirmed weakness${confirmed.length === 1 ? "" : "es"} across ${clusters.length} theme${clusters.length === 1 ? "" : "s"}, ${strengths.length} strength${strengths.length === 1 ? "" : "s"}. ` +
    (topWeak ? `Biggest leak: ${topWeak.claim.toLowerCase()}. ` : `No major structural weakness found. `) +
    `${cards.length} fix${cards.length === 1 ? "" : "es"} proposed. Overall grade: ${grade}.`;

  return { grade, summary, nodes, rootId: root.id, clusters, strengths, cards, metrics, stats: { nodes: nodes.length, weaknesses: confirmed.length, confirmed: confirmed.length } };
}

function mean(a: number[]) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
