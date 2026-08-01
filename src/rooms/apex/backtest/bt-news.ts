/* 📰 NEWS INPUT ENGINE — turn real symbol news into an attachable signal that can gate
   any algo's entries. Honesty: free feeds carry only a RECENT window of headlines, so the
   news signal is a live / paper-forward input (and a recent-window backtest overlay), NOT a
   fabricated multi-year history. Sentiment + impact come straight from the provider. */
export interface NewsItem { title: string; dir: "bullish" | "bearish"; magnitude: number; sector: string; time: string; sentiment: number }
export interface NewsSignal { netSentiment: number; volume: number; bull: number; bear: number; bullBearRatio: number; avgImpact: number; items: NewsItem[] }

interface RawImpact { title: string; sentiment_dir: number; impact: number; sector: string | null; updated_at?: string }
export async function fetchSymbolNews(symbol: string): Promise<NewsItem[]> {
  try {
    const r = await fetch(`/api/apex/news/impact/${encodeURIComponent(symbol)}`);
    if (!r.ok) return [];
    const j = await r.json();
    return ((j.impact || []) as RawImpact[]).map((i) => {
      const mag = Math.max(0.05, Math.min(1, i.impact ?? 0.3));
      const bull = (i.sentiment_dir ?? 0) >= 0;
      return { title: i.title, dir: (bull ? "bullish" : "bearish") as "bullish" | "bearish", magnitude: mag, sector: i.sector || "—", time: i.updated_at || "", sentiment: (bull ? 1 : -1) * mag };
    });
  } catch { return []; }
}

export function newsSignal(items: NewsItem[]): NewsSignal {
  const n = items.length;
  const bull = items.filter((i) => i.dir === "bullish").length, bear = n - bull;
  const net = n ? items.reduce((s, i) => s + i.sentiment, 0) / n : 0;
  return { netSentiment: net, volume: n, bull, bear, bullBearRatio: bear ? bull / bear : bull, avgImpact: n ? items.reduce((s, i) => s + i.magnitude, 0) / n : 0, items };
}

export type NewsFeature = "netSentiment" | "volume" | "bullBearRatio";
export interface NewsFilterCfg { enabled: boolean; feature: NewsFeature; dir: "above" | "below"; threshold: number }
export const DEFAULT_NEWS_FILTER: NewsFilterCfg = { enabled: false, feature: "netSentiment", dir: "above", threshold: 0 };

const KEY = (strat: string) => `apex.bt.newsfilter:${strat}`;
export function loadNewsFilter(strat: string): NewsFilterCfg {
  try { const v = localStorage.getItem(KEY(strat)); return v ? { ...DEFAULT_NEWS_FILTER, ...JSON.parse(v) } : { ...DEFAULT_NEWS_FILTER }; } catch { return { ...DEFAULT_NEWS_FILTER }; }
}
export function saveNewsFilter(strat: string, cfg: NewsFilterCfg): void {
  try { localStorage.setItem(KEY(strat), JSON.stringify(cfg)); } catch { /* */ }
}

/** Evaluate whether the CURRENT news signal passes the attached filter (for live/forward gating). */
export function newsFilterPasses(sig: NewsSignal, cfg: NewsFilterCfg): boolean {
  if (!cfg.enabled) return true;
  const v = cfg.feature === "netSentiment" ? sig.netSentiment : cfg.feature === "volume" ? sig.volume : sig.bullBearRatio;
  return cfg.dir === "above" ? v >= cfg.threshold : v <= cfg.threshold;
}
export const FEATURE_LABEL: Record<NewsFeature, string> = { netSentiment: "Net Sentiment", volume: "News Volume", bullBearRatio: "Bull/Bear Ratio" };
