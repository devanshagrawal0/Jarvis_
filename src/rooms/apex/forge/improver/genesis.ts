/* THE FORGE — F8 Genesis client. Sends a goal to the generator, assembles a
   VALID BotSpec from the returned template + params (never trusting the LLM to
   hand-write the whole spec), backtests it, and returns the working strategy. */

import { templateSpecs, blankSpec, type BotSpec } from "../forge-spec";
import { runBacktest } from "../forge-data";
import type { BacktestResult } from "../forge-engine";

interface Blueprint { template: string; symbol: string; assetClass: "stocks" | "crypto"; stopLossPct: number; takeProfitPct: number | null; trailingPct: number | null; name: string; rationale: string }
export interface GenesisResult { spec: BotSpec; result: BacktestResult; blueprint: Blueprint }

const TMPL_INDEX: Record<string, number> = { ema_trend: 0, rsi_meanrev: 1, breakout: 2, momentum: 5 };

export async function genesis(goal: string, seed: number): Promise<{ result?: GenesisResult; error?: string }> {
  try {
    const res = await fetch("/api/apex/forge-genesis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal }) });
    if (!res.ok) return { error: "Genesis is unreachable — is the backend running?" };
    const j = await res.json();
    if (j.error || !j.blueprint) return { error: j.error || "Generation failed." };
    const bp = j.blueprint as Blueprint;
    const templates = templateSpecs(seed);
    const base = templates[TMPL_INDEX[bp.template] ?? 0] || templates[0];
    const spec: BotSpec = {
      ...base,
      meta: { ...base.meta, id: blankSpec(seed).meta.id, name: bp.name, description: bp.rationale, source: "nodes", tags: ["genesis", "ai"] },
      universe: { ...base.universe, symbols: [bp.symbol], assetClass: bp.assetClass },
      exit: { stopLossPct: bp.stopLossPct, takeProfitPct: bp.takeProfitPct ?? undefined, trailingPct: bp.trailingPct ?? undefined },
    };
    const result = await runBacktest(spec);
    return { result: { spec, result, blueprint: bp } };
  } catch { return { error: "Genesis is unreachable — is the backend running?" }; }
}
