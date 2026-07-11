// src/rooms/helix/widgets/types.ts
// Shared TypeScript types for all specialized tab renderers.
// Mirrors the server-side builders in helix-tab-classifier.js.

export interface MarketTabData {
  type: "market";
  tickers: string[];
  kalshiSlug: string | null;
  priceData: {
    symbol: string;
    price: number;
    change24h: number;
    rsi?: number;
    maPosition?: string;
    volume?: number;
    note?: string;
  } | null;
  kalshiData: {
    yes_ask: number;
    no_ask: number;
    volume: number;
    close_time: string;
  } | null;
  signal: "BUY" | "SELL" | "HOLD" | "WAIT";
  signalScore: number;
}

export interface CodeTabData {
  type: "code";
  language: string;
  problemType: string;
  code: string;
  explanation: string[];
  issues: string[];
  improvements: string[];
}

export interface DataTabData {
  type: "data";
  datasetName: string | null;
  chartType: "bar" | "line" | "scatter" | "none";
  formula: string | null;
  metrics: { label: string; value: string | number }[];
  tables: unknown[][];
  summary: string;
}

export interface DecisionOption {
  title: string;
  rationale: string;
  confidence: number;
  pros: string[];
  cons: string[];
}

export interface DecisionTabData {
  type: "decision";
  domain: string | null;
  options: DecisionOption[];
  recommendation: string | null;
  assumptions: string[];
}

export interface ComparisonRow {
  attribute: string;
  valueA: string;
  valueB: string;
  winner?: "a" | "b" | "tie" | null;
}

export interface ComparisonTabData {
  type: "comparison";
  itemA: string | null;
  itemB: string | null;
  attributes: ComparisonRow[];
  winner: string | null;
}

export interface DiagramNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DesignTabData {
  type: "design";
  diagramType: string;
  components: string[];
  dependencies: string[];
  summary: string;
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
}

export interface PeopleTabData {
  type: "people";
  name: string | null;
  org: string | null;
  facts: string[];
  summary: string;
}

export interface MediaTabData {
  type: "media";
  title: string;
  mediaType: string;
  outline: string[];
  quotes: string[];
  summary: string;
  sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}

export interface ResearchTabData {
  type: "research";
  domain: string | null;
  claims: string[];
  confidence: string | null;
  summary: string;
}

export type GenericSectionType = "text" | "table" | "chart" | "list" | "metric" | "quote";

export interface GenericSection {
  type: GenericSectionType;
  title: string;
  content: string | string[] | unknown[][];
}

export interface GenericTabData {
  type: "generic";
  label: string;
  icon: string;
  sections: GenericSection[];
}

export type AnyTabData =
  | MarketTabData
  | CodeTabData
  | DataTabData
  | DecisionTabData
  | ComparisonTabData
  | DesignTabData
  | PeopleTabData
  | MediaTabData
  | ResearchTabData
  | GenericTabData;

// Live data streaming — attached to a tab data object by the FocusOverlay (Wave 3-D)
export interface TabStreaming {
  interval: number; // ms, minimum 60000 enforced
  refreshFn: () => Promise<Partial<AnyTabData>>;
}
