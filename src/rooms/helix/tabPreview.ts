// src/rooms/helix/tabPreview.ts
// Wave 1-B: Client-side tab type preview — pure keyword scan, NO API call.
// Runs on 300ms debounce from the inquiry input. Result is visual only, not binding.

import type { TabType } from "./helix-types";

// Broader keyword maps than the old STRAND_KEYWORDS — multi-word patterns included
const TAB_KEYWORDS: Record<TabType, RegExp> = {
  market:     /\b(stock|price|ticker|crypto|bitcoin|btc|eth|ethereum|solana|sol|kalshi|bet|trade|buy|sell|market|earnings|contract|position|short|long|options|yield|rate|ipo|breakout|bullish|bearish|rsi|moving average|chart pattern|nvda|aapl|tsla|spy|qqq|fed|rate cut|rate hike)\b/i,
  code:       /\b(function|class|implement|debug|script|build|deploy|error|bug|refactor|api|endpoint|schema|query|async|component|module|algorithm|typescript|javascript|python|rust|golang|sql|bash|git|docker|ci\/cd|test|unit test|integration test|code|codebase)\b/i,
  data:       /\b(dataset|backtest|model|formula|statistic|csv|regression|correlation|metric|kpi|performance|chart|graph|trend|historical|distribution|variance|standard deviation|monte carlo|simulation|quantitative|quant|time series|dataframe|pandas|numpy|signal)\b/i,
  decision:   /\bshould i\b|\bwhich is better\b|\bpros and cons\b|\btradeoff\b|\b(choose|decision|alternative|option|recommend|best way|which|weigh|consider|evaluate|go with|pick between|versus|vs\b)/i,
  comparison: /\b(\w+ vs \.?\w+|compare|difference between|better than|worse than|contrast|feature comparison|head.to.head)\b/i,
  design:     /\b(architecture|diagram|flow|system design|schema|blueprint|microservice|database design|erd|uml|component diagram|sequence diagram|infrastructure|design pattern|solid|ddd|event.driven|monolith|microservices)\b/i,
  people:     /\b(who is|ceo|founder|team|company|organization|person|contact|linkedin|employee|biography|about|profile|who runs|who founded|who created)\b/i,
  media:      /\b(article|video|podcast|book|paper|watch|read|listen|content|summary of|summarize this|explain this paper|what does this say|tldr)\b/i,
  research:   /\b(what is|how does|why does|explain|when did|who invented|history of|background on|overview of|tell me about)\b/i,
  generic:    /^$/,  // never matches — generic is the fallback
  unknown:    /^$/,  // never matches
};

// Icon per tab type for the preview chip UI
export const TAB_TYPE_META: Record<TabType, { label: string; color: string; icon: string }> = {
  market:     { label: "Market",     color: "#0094ff", icon: "📈" },
  code:       { label: "Code",       color: "#86efac", icon: "⌨" },
  data:       { label: "Data",       color: "#fde68a", icon: "📊" },
  decision:   { label: "Decision",   color: "#c4b5fd", icon: "⚖" },
  comparison: { label: "Compare",    color: "#fdba74", icon: "⇄" },
  design:     { label: "Design",     color: "#67e8f9", icon: "◈" },
  people:     { label: "People",     color: "#f9a8d4", icon: "👤" },
  media:      { label: "Media",      color: "#a5f3fc", icon: "▶" },
  research:   { label: "Research",   color: "#94a3b8", icon: "🔬" },
  generic:    { label: "General",    color: "#64748b", icon: "◆" },
  unknown:    { label: "Unknown",    color: "#334155", icon: "?" },
};

export interface TabPreviewResult {
  type: TabType;
  conf: number;  // 0–0.75 (rough, not authoritative)
}

export function previewTabType(text: string): TabPreviewResult[] {
  if (!text || text.length < 4) return [];

  const hits = (Object.entries(TAB_KEYWORDS) as [TabType, RegExp][])
    .filter(([type]) => type !== "generic" && type !== "unknown" && type !== "research")
    .map(([type, re]) => {
      const matches = text.match(new RegExp(re, "gi")) || [];
      return { type, hitCount: matches.length };
    })
    .filter(h => h.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, 2);

  return hits.map(h => ({
    type: h.type,
    conf: Math.min(0.75, 0.3 + h.hitCount * 0.15),
  }));
}
