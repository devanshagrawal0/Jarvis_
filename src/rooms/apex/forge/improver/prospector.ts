/* THE FORGE — F6 Prospector. Mines FREE alternative data into candidate trading
   signals for a symbol: SEC EDGAR insider-buy clusters, news sentiment, and the
   macro regime — each with a current reading + a strength score you can drop into
   the library. Institutional alt-data, keyless. (Full DSL evaluation of alt-data
   signals is a documented next step; these are discoverable, saveable signals.) */

import { fetchInsider, fetchNewsImpact } from "../../apex-data";

export interface MinedSignal {
  id: string; name: string; category: "insider" | "news" | "macro"; icon: string;
  reading: string; strength: number; /* -1..1 */ description: string; dslHint: string;
}

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

export async function mineSignals(symbol: string): Promise<MinedSignal[]> {
  const sym = (symbol || "SPY").toUpperCase();
  const out: MinedSignal[] = [];

  // 1) Insider-buy clusters (SEC EDGAR Form 4)
  try {
    const ins = await fetchInsider(sym);
    const buys = ins.filter(i => /buy|purchase|acqui|\+|^p$/i.test(String((i as { side?: string }).side || ""))).length;
    const sells = ins.length - buys;
    const strength = clamp((buys - sells) / Math.max(4, ins.length));
    out.push({ id: "insider", name: `${sym}_insider_cluster`, category: "insider", icon: "◱", reading: `${buys} buys / ${sells} sells (last filings)`, strength, description: `Cluster of insider transactions on ${sym}. Multiple insider buys in a short window is a classic bullish tell; a cluster of sells the opposite.`, dslHint: `INSIDER_CLUSTER(${sym}) > 2` });
  } catch { /* skip */ }

  // 2) News sentiment
  try {
    const news = await fetchNewsImpact(sym);
    if (news.length) {
      const net = news.reduce((s, n) => s + (n.dir === "bullish" ? 1 : n.dir === "bearish" ? -1 : 0) * (n.magnitude || 1), 0) / news.length;
      out.push({ id: "news", name: `${sym}_news_tone`, category: "news", icon: "◈", reading: `${news.length} recent items · net ${net >= 0 ? "+" : ""}${net.toFixed(2)}`, strength: clamp(net), description: `Aggregate tone of recent ${sym} news (GDELT + Finnhub). Sentiment shifts often lead short-term moves; fade extremes or ride confirmation.`, dslHint: `NEWS_TONE(${sym}) > 0.3` });
    }
  } catch { /* skip */ }

  // 3) Macro regime (global, from the APEX overview)
  try {
    const ovRes = await fetch("/api/apex/overview"); const ov = ovRes.ok ? await ovRes.json() as { regime?: { score?: number; label?: string } } : null;
    if (ov && ov.regime) { const sc = (ov.regime.score ?? 50); const strength = clamp((sc - 50) / 50); out.push({ id: "macro", name: "macro_regime", category: "macro", icon: "◎", reading: `${ov.regime.label || "?"} (${sc}/100)`, strength, description: `Market-wide risk regime from FRED macro + breadth + VIX. Gate entries to risk-on regimes to cut drawdown in crises.`, dslHint: `MACRO_REGIME() > 55` }); }
  } catch { /* skip */ }

  return out;
}
