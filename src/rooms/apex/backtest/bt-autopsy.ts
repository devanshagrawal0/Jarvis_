/* 🧠 AI TRADE AUTOPSY — every trade decomposed into a recursive branching root-cause
   tree, grounded in the REAL improver ledger (MAE/MFE excursions, entry/exit efficiency,
   wasted profit, regime, failure-taxonomy flags). The tree is rule-derived from measured
   facts; an agentic AI pass (Jarvis brain via /api/apex/forge-agent) drills the worst
   trades for a plain-English root cause + a concrete fix. Nothing invented. */
import type { RunArtifact, TradeRecord } from "../forge/improver/artifact";

export type Verdict = "good" | "warn" | "bad" | "info";
export interface AutopsyNode { id: string; label: string; verdict: Verdict; detail?: string; children?: AutopsyNode[] }
export interface AutopsyTrade { idx: number; rec: TradeRecord; tree: AutopsyNode[]; severity: number }
export interface AutopsyResult {
  trades: AutopsyTrade[];
  flagCounts: { flag: string; count: number }[];
  summary: { nWin: number; nLoss: number; nScratch: number; worstIdx: number; avgEntryEff: number; avgExitEff: number; avgWasted: number };
}

const p1 = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
const eff = (v: number): Verdict => (v >= 0.6 ? "good" : v >= 0.35 ? "warn" : "bad");
const REG_LBL: Record<string, string> = { "calm-bull": "Calm Bull", "volatile-bull": "Volatile Bull", "grind-bear": "Grind / Bear", "crisis": "Crisis" };

export const FLAG_MEANING: Record<string, string> = {
  "big-mae": "Took heavy heat before working — entry timing was early.",
  "round-trip": "Round-tripped a large open profit back to ~breakeven.",
  "premature-exit": "Exited while the move was still running (left profit on the table).",
  "late-exit": "Held well past the favorable peak — gave back gains.",
  "chased-entry": "Entered far from the ideal price — chased the move.",
  "regime-mismatch": "Taken in a regime this strategy historically loses in.",
  "oversized": "Position risk was large relative to the stop distance.",
  "cost-drag": "Costs ate a meaningful share of the gross P/L.",
  "quick-stop": "Stopped out almost immediately — likely noise, not signal.",
};
const flagText = (f: string) => FLAG_MEANING[f] || f.replace(/-/g, " ");

function tradeTree(t: TradeRecord): { tree: AutopsyNode[]; severity: number } {
  let sev = 0; const bad = (w: number) => { sev += w; };
  const entry: AutopsyNode = {
    id: "entry", label: "ENTRY", verdict: eff(t.entryEff), detail: `${REG_LBL[t.regimeAtEntry] || t.regimeAtEntry} regime · efficiency ${(t.entryEff * 100).toFixed(0)}%`,
    children: [
      { id: "entry-eff", label: `Entry efficiency ${(t.entryEff * 100).toFixed(0)}%`, verdict: eff(t.entryEff), detail: t.entryEff < 0.35 ? "Entered far from the ideal price — chased." : t.entryEff > 0.6 ? "Entered near the ideal price." : "Acceptable entry." },
      { id: "entry-reg", label: `Regime: ${REG_LBL[t.regimeAtEntry] || t.regimeAtEntry}`, verdict: "info" },
    ],
  };
  if (t.entryEff < 0.35) bad(2);
  const path: AutopsyNode = {
    id: "path", label: "PATH (the trade's life)", verdict: t.maeAtr < -1.5 ? "bad" : t.maeAtr < -0.7 ? "warn" : "good",
    detail: `MAE ${p1(t.mae)} (${t.maeAtr.toFixed(1)} ATR) · MFE ${p1(t.mfe)} (${t.mfeAtr.toFixed(1)} ATR)`,
    children: [
      { id: "mae", label: `Max adverse excursion ${p1(t.mae)}`, verdict: t.maeAtr < -1.5 ? "bad" : t.maeAtr < -0.7 ? "warn" : "good", detail: `Took ${Math.abs(t.maeAtr).toFixed(1)} ATR of heat before working.` },
      { id: "mfe", label: `Max favorable excursion ${p1(t.mfe)}`, verdict: "info", detail: `Peaked at ${t.mfeAtr.toFixed(1)} ATR in your favor.` },
      { id: "waste", label: `Wasted profit ${t.wastedProfit > 1 ? ">100" : Math.max(0, t.wastedProfit * 100).toFixed(0)}% of peak`, verdict: t.wastedProfit > 0.5 ? "bad" : t.wastedProfit > 0.3 ? "warn" : "good", detail: t.wastedProfit > 1 ? "Gave back all open profit and reversed into a loss." : t.wastedProfit > 0.5 ? "Gave back most of the open profit before exiting." : "Captured most of the move." },
    ],
  };
  if (t.maeAtr < -1.5) bad(2); if (t.wastedProfit > 0.5) bad(2);
  const exit: AutopsyNode = {
    id: "exit", label: "EXIT", verdict: eff(t.exitEff), detail: `${t.exitReason} · efficiency ${(t.exitEff * 100).toFixed(0)}%`,
    children: [
      { id: "exit-reason", label: `Exit reason: ${t.exitReason}`, verdict: "info" },
      { id: "exit-eff", label: `Exit efficiency ${(t.exitEff * 100).toFixed(0)}%`, verdict: eff(t.exitEff), detail: t.exitEff < 0.35 ? "Exited at a poor point relative to the trade's range." : "Reasonable exit." },
    ],
  };
  if (t.exitEff < 0.35) bad(1.5);
  const outcome: AutopsyNode = {
    id: "outcome", label: `OUTCOME · ${t.outcome.toUpperCase()}`, verdict: t.outcome === "win" ? "good" : t.outcome === "loss" ? "bad" : "info",
    detail: `Net ${p1(t.netRet)} · P/L $${t.pnl.toFixed(2)} · held ${t.barsHeld} bars`,
  };
  if (t.outcome === "loss") bad(1);
  const nodes = [entry, path, exit, outcome];
  if (t.flags.length) {
    nodes.push({ id: "flags", label: `FAILURE FLAGS · ${t.flags.length}`, verdict: "bad", children: t.flags.map((f, i) => ({ id: `flag-${i}`, label: f.replace(/-/g, " "), verdict: "bad" as Verdict, detail: flagText(f) })) });
    bad(t.flags.length);
  }
  return { tree: nodes, severity: sev };
}

export function buildAutopsy(artifact: RunArtifact): AutopsyResult {
  const trades: AutopsyTrade[] = artifact.ledger.map((rec, idx) => { const { tree, severity } = tradeTree(rec); return { idx, rec, tree, severity }; });
  const fc = new Map<string, number>();
  for (const t of artifact.ledger) for (const f of t.flags) fc.set(f, (fc.get(f) || 0) + 1);
  const flagCounts = [...fc.entries()].map(([flag, count]) => ({ flag, count })).sort((a, b) => b.count - a.count);
  const led = artifact.ledger;
  const worst = trades.slice().sort((a, b) => b.severity - a.severity)[0];
  return {
    trades,
    flagCounts,
    summary: {
      nWin: led.filter((t) => t.outcome === "win").length, nLoss: led.filter((t) => t.outcome === "loss").length, nScratch: led.filter((t) => t.outcome === "scratch").length,
      worstIdx: worst?.idx ?? -1,
      avgEntryEff: led.length ? led.reduce((s, t) => s + t.entryEff, 0) / led.length : 0,
      avgExitEff: led.length ? led.reduce((s, t) => s + t.exitEff, 0) / led.length : 0,
      avgWasted: led.length ? led.reduce((s, t) => s + t.wastedProfit, 0) / led.length : 0,
    },
  };
}

/* ── Agentic AI drill (real Gemini via /api/apex/forge-agent) ── */
async function askAgent(question: string, context: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch("/api/apex/forge-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }) });
    if (!res.ok) return "";
    const j = await res.json();
    return String(j.answer || j.response || j.suggestions || j.critique || j.text || "").trim();
  } catch { return ""; }
}

export function autopsyTradeAI(t: AutopsyTrade, strategyName: string, symbol: string): Promise<string> {
  const r = t.rec;
  return askAgent(
    `You are a trading-desk trade reviewer. Given ONE backtest trade's measured facts, name the single biggest mistake (or "clean trade" if none) in 1 sentence, then give ONE concrete, specific fix to the strategy rules. Be terse and technical. Do not restate the numbers.`,
    { strategy: strategyName, symbol, outcome: r.outcome, netReturnPct: +(r.netRet * 100).toFixed(2), barsHeld: r.barsHeld, regime: r.regimeAtEntry, entryEfficiency: +r.entryEff.toFixed(2), exitEfficiency: +r.exitEff.toFixed(2), maeAtr: +r.maeAtr.toFixed(2), mfeAtr: +r.mfeAtr.toFixed(2), wastedProfitPct: +(r.wastedProfit * 100).toFixed(0), exitReason: r.exitReason, flags: r.flags },
  );
}

export function autopsyStrategyAI(res: AutopsyResult, strategyName: string, symbol: string): Promise<string> {
  return askAgent(
    `You are a quant strategy doctor. Given the aggregate failure pattern across a backtest's trades, identify the TOP 3 systemic mistakes and, for each, a specific rule change to fix it. Return 3 short bullet points. Ground every point in the provided stats.`,
    { strategy: strategyName, symbol, wins: res.summary.nWin, losses: res.summary.nLoss, avgEntryEfficiency: +res.summary.avgEntryEff.toFixed(2), avgExitEfficiency: +res.summary.avgExitEff.toFixed(2), avgWastedProfitPct: +(res.summary.avgWasted * 100).toFixed(0), topFailureFlags: res.flagCounts.slice(0, 5) },
  );
}
