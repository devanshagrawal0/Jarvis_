// ── HELIX Shared Types & Constants ────────────────────────────────────────
// Single source of truth — imported by HelixRoom and all sub-components.

export type Strand = "evidence" | "strategy" | "construction" | "memory" | "signal" | "synthesis";

export type TabType = "market" | "code" | "data" | "decision" | "comparison" | "design" | "people" | "media" | "research" | "generic" | "unknown";

export interface TabSignal { text: string; role: string; }

export interface TabClassification {
  primary: TabType;
  secondary: TabType | null;
  confidence: number;
  signals: TabSignal[];
  metadata: Record<string, unknown>;
  setup: Record<string, unknown>;
}

export interface DeepBriefAction {
  priority: number;
  action: string;
  why: string;
  how: string;
  helixTool: string | null;
}

export interface FindingSource {
  idx: number;
  source: string;
  tool: string | null;
}

export interface DeepBrief {
  id: string;
  entry_id: string;
  project_id: string;
  summary: string;
  deep_analysis: string;
  key_findings: string[];
  what_this_means: string;
  pros: string[];
  cons: string[];
  confidence_reasoning: string;
  recommended_actions: DeepBriefAction[];
  how_to_proceed: string;
  finding_sources: FindingSource[];
  previous_summary: string;
  previous_analysis: string;
  regeneration_count: number;
  last_regenerated_at: string;
  drift_score: number;
  created_at: string;
  updated_at: string;
}

export interface PatternItem {
  title: string;
  description: string;
  entry_count: number;
  significance: string;
}

export interface ConvergenceItem {
  claim: string;
  strength: "high" | "medium" | "low";
  implication: string;
}

export interface PatternContradiction {
  tension: string;
  entries: string[];
  resolution: string;
}

export interface BlindSpot {
  area: string;
  why_it_matters: string;
  suggested_action: string;
}

export interface PatternScan {
  id?: string;
  project_id?: string;
  summary: string;
  patterns: PatternItem[];
  convergences: ConvergenceItem[];
  contradictions: PatternContradiction[];
  blind_spots: BlindSpot[];
  entry_count: number;
  created_at?: string;
}

export interface HelixFolder {
  id: string;
  project_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface HelixEntry {
  id: string;
  strand: Strand;
  query: string;
  text: string;
  confidence: number;
  original_confidence: number;
  freshness: number;
  contradicted: number;
  locked: number;
  voided: number;
  created_at: string;
  // Wave 1-A: specialized tab fields (null for pre-existing entries)
  tab_primary: TabType | null;
  tab_secondary: TabType | null;
  tab_meta: TabClassification | null;
  structured_resp: { tabs: unknown[]; workflowStage: string; nextActions: string[] } | null;
  workflow_stage: string | null;
  // Folder system
  folder_id: string | null;
}

export interface Contradiction {
  id: string;
  project_id: string;
  entry_a_id: string;
  entry_b_id: string;
  contradiction_type: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved";
  resolution_type: string;
  resolution_text: string;
  resolved_at: string | null;
  created_at: string;
}

export interface RedTeamCritique {
  key: string;
  label: string;
  color: string;
  attackVector: string;
  argument: string;
}

export interface RedTeamSession {
  id: string;
  project_id: string;
  entry_id: string;
  status: "pending" | "complete";
  critiques: RedTeamCritique[];
  verdict: { text: string };
  created_at: string;
  completed_at: string | null;
}

export interface Triangulation {
  id: string;
  project_id: string;
  entry_id: string;
  angle_a: { stance: string; summary: string; confidence: number };
  angle_b: { stance: string; summary: string; confidence: number };
  angle_c: { stance: string; summary: string; confidence: number };
  agree: number;
  contested: number;
  oppose: number;
  confidence: number;
  created_at: string;
}

export interface StrategyOptionItem {
  title: string;
  rationale: string;
  effort: "low" | "medium" | "high";
  confidence: number;
  risks: string[];
}

export interface StrategyOptionsData {
  id: string;
  entry_id: string;
  options: StrategyOptionItem[];
  created_at: string;
}

export interface Assumption {
  id: string;
  project_id: string;
  entry_id: string;
  text: string;
  confidence: number;
  assumption_type: "explicit" | "implicit";
  status: "active" | "challenged" | "resolved";
  challenge_session_id: string | null;
  created_at: string;
}

export interface Risk {
  id: string;
  project_id: string;
  entry_id: string;
  text: string;
  severity: "low" | "medium" | "high";
  likelihood: "low" | "medium" | "high";
  category: string;
  created_at: string;
}

export interface CausalChainStep {
  from: string;
  to: string;
  relationship: "mechanism" | "correlation" | "assumption" | "confounding";
  confidence: number;
}

export interface CausalChain {
  id: string;
  entry_id: string;
  chain: CausalChainStep[];
  created_at: string;
}

export interface ScenarioVariant {
  id: string;
  scenario_id: string;
  label: string;
  type: "optimistic" | "pessimistic" | "historical" | "stress" | "black_swan" | "competitive";
  delta: { variable: string; change: string }[];
  outcome: { text: string; confidence: number; key_changes: string[] };
  probability: number;
  created_at: string;
}

export interface Scenario {
  id: string;
  project_id: string;
  entry_id: string;
  name: string;
  base: { context: string; current_state: string; key_variables: string[] };
  scenario_type: string;
  variables: string[];
  divergence_point: string;
  variants: ScenarioVariant[];
  created_at: string;
}

export interface PriorArtItem {
  name?: string;
  description?: string;
  relevance?: number;
  what?: string;
  why?: string;
  lesson?: string;
  gap?: string;
  opportunity?: string;
  severity?: "low" | "medium" | "high";
}

export interface PriorArt {
  id: string;
  project_id: string;
  entry_id: string;
  exists: { items: PriorArtItem[] };
  failures: { items: PriorArtItem[] };
  gaps: { items: PriorArtItem[] };
  created_at: string;
  updated_at: string;
}

export interface LivingBrief {
  id: string;
  project_id: string;
  sections: Record<string, string>;
  sectionTimestamps: Record<string, string>;
  last_visited_at: string | null;
  version: number;
  created_at: string;
}

export interface OracleAnswer {
  question: string;
  answer: string;
  confidence: number;
  key_finding: string;
  sources: { entry_id: string; strand: string; query: string; relevance: string }[];
}

export interface Insight {
  id: string;
  project_id: string;
  type: "pattern" | "gap" | "implication" | "anomaly";
  title: string;
  content: string;
  confidence: number;
  status: string;
  created_at: string;
}

// ── Wave 8: Forge ──────────────────────────────────────────────────────────
export type ForgeMode = "document" | "notes" | "research" | "spatial" | "model";
export type BlockType = "heading" | "paragraph" | "list" | "quote" | "code" | "claim" | "insight" | "scenario" | "spatial-note";
export type BlockSource = "manual" | "ai" | "pulled" | "synthesized";

export interface ForgeDocument {
  id: string;
  project_id: string;
  title: string;
  mode: ForgeMode;
  created_at: string;
  updated_at: string;
}

export interface ForgeBlock {
  id: string;
  document_id: string;
  type: BlockType;
  content: string;
  source_type: BlockSource;
  source_id: string | null;
  confidence: number;
  strand: Strand | null;
  order_index: number;
  locked: number;
  created_at: string;
}

export interface ArtificerMessage {
  role: "user" | "assistant";
  content: string;
}

export interface KnowledgeFile {
  id: string;
  project_id: string;
  filename: string;
  filetype: string;
  file_hash: string;
  claim_count: number;
  contradiction_count: number;
  status: "processing" | "ready" | "failed";
  processed_at: string | null;
  created_at: string;
}

export interface FileClaim {
  id: string;
  file_id: string;
  project_id: string;
  text: string;
  confidence: number;
  chunk_index: number;
  linked_entry_id: string | null;
  created_at: string;
}

export interface VaultEntry {
  id: string;
  entry_id: string;
  strand: Strand;
  query: string;
  summary: string;
  rationale: string;
  created_at: string;
}

// ── Wave 9: Workflow Studio ────────────────────────────────────────────────
export type WFNodeType = "query" | "filter" | "verify" | "analyze" | "summarize" | "store";

export interface WFNode {
  id: string;
  type: WFNodeType;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
}

export interface WFEdge {
  id: string;
  from: string;
  to: string;
}

export interface WFGraph {
  nodes: WFNode[];
  edges: WFEdge[];
}

export interface WFWorkflow {
  id: string;
  project_id: string | null;
  name: string;
  description: string;
  graph_json: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export interface WFRun {
  id: string;
  workflow_id: string;
  project_id: string;
  status: "running" | "complete" | "failed";
  started_at: string;
  completed_at: string | null;
  result_summary: string;
}

export interface WFNodeRun {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  node_label: string;
  status: "pending" | "running" | "complete" | "failed";
  output_json: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// ── Wave 10: Entity Graph ──────────────────────────────────────────────────
export interface HelixEntity {
  id: string;
  project_id: string;
  canonical_name: string;
  aliases: string[];
  entity_type: "person" | "org" | "concept" | "event" | "tech";
  mention_count: number;
  created_at: string;
  x?: number; y?: number; vx?: number; vy?: number;
}

export interface EntityRelation {
  id: string;
  project_id: string;
  entity_a_id: string;
  entity_b_id: string;
  relationship_type: string;
  weight: number;
  created_at: string;
}

// ── Wave 10: Agent Constellation ──────────────────────────────────────────
export interface AgentState {
  id: string;
  name: string;
  role: string;
  strand: string;
  status: "active" | "idle" | "running" | "error";
  category: string;
  run_count?: number;
  last_result?: string;
  last_run_at?: string;
  trigger_type?: string;
  output_format?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  estimatedCostUsd: number;
}

// ── Wave 11: Widget System ─────────────────────────────────────────────────
export type WidgetType = "score-meter" | "contradiction-counter" | "agent-hud" | "strand-radar" | "wire-feed" | "quick-notes" | "vault-preview" | "focus-timer";

export interface FloatingWidget {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  pinned: boolean;
  opacity: number;
  title: string;
}

export interface HelixLayout {
  id: string;
  name: string;
  config: { panelSplit: number; leftCollapsed: boolean; rightCollapsed: boolean };
}

// ── Wave 12: Signal Strand ─────────────────────────────────────────────────
export interface HelixSignal {
  id: string;
  project_id: string;
  source: string;
  signal_type: string;
  title: string;
  value: unknown;
  ttl_seconds: number;
  expires_at: string;
  linked_evidence_id: string | null;
  alert_rule_id: string | null;
  strand: string;
  created_at: string;
  expired: boolean;
}

export interface AlertRule {
  id: string;
  project_id: string;
  name: string;
  signal_type: string;
  source: string;
  condition: "above" | "below" | "equals";
  threshold: number;
  message: string;
  active: number;
  last_triggered_at: string | null;
  created_at: string;
}

// ── Wave 13: Sessions & Capsules ───────────────────────────────────────────
export interface HelixSession {
  id: string;
  project_id: string;
  summary: string;
  inquiry_count: number;
  discoveries: number;
  decisions_locked: number;
  wire_snapshot: string[];
  panel_layout: Record<string, unknown>;
  insights: string[];
  started_at: string;
  ended_at: string | null;
}

export interface HelixCapsule {
  id: string;
  project_id: string;
  label: string;
  entry_count: number;
  vault_count: number;
  created_at: string;
}

export interface HelixProject {
  id: string;
  name: string;
  objective: string;
  mode: string;
  helix_score: number;
}

export interface StrandHealth {
  evidence: number;
  strategy: number;
  construction: number;
  memory: number;
  signal: number;
  synthesis: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
export const STRAND_META: Record<Strand, { label: string; color: string; shortColor: string }> = {
  evidence:     { label: "Evidence",     color: "#4a9eff", shortColor: "blue"   },
  strategy:     { label: "Strategy",     color: "#7eb8ff", shortColor: "blue"   },
  construction: { label: "Construction", color: "#a8ccff", shortColor: "blue"   },
  memory:       { label: "Memory",       color: "#5580cc", shortColor: "blue"   },
  signal:       { label: "Signal",       color: "#b8d4ff", shortColor: "blue"   },
  synthesis:    { label: "Synthesis",    color: "#c5d8f0", shortColor: "blue"   },
};

export const BRIEF_SECTION_LABELS: Record<string, string> = {
  current_state:  "Current State",
  key_decisions:  "Key Decisions",
  open_questions: "Open Questions",
  what_changed:   "What Changed",
  whats_at_risk:  "What's at Risk",
  whats_next:     "What's Next",
};

export const ALL_STRANDS = Object.keys(STRAND_META) as Strand[];

export const STRAND_DECAY_RATES: Record<Strand, number> = {
  evidence: 0.005, strategy: 0.001, construction: 0.02,
  memory: 0.0002,  signal: 0.1,     synthesis: 0,
};

// ── Helpers ────────────────────────────────────────────────────────────────
export function getFreshness(createdAt: string, strand: Strand): number {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  return Math.max(0, 1 - STRAND_DECAY_RATES[strand] * ageHours);
}

export function freshnessColor(f: number): string {
  if (f > 0.8) return "#4aff9e";
  if (f > 0.6) return "#ffe14a";
  if (f > 0.4) return "#ffe14a";
  return "#ff6b6b";
}
