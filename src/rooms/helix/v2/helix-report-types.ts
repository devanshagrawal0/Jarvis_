// HELIX structured report contract (Research Engine W3).
//
// WHY THIS EXISTS: synthesis used to return `{ answer: string }` — a single flat string.
// That was the architectural ceiling on the whole product: headings, tables and charts were
// literally inexpressible, so every question (research, comparison, recipe, decision) got
// the same one-paragraph shape. This schema is the replacement.
//
// The server builds this shape in helix-pipeline.js (CommonJS, untyped); these types are the
// client-side mirror. Keep them in sync — the section `type` strings are the contract.

/** Confidence in a section's claims. Ordinal, never a fabricated percentage. */
export type ReportConfidence = "strong" | "moderate" | "weak";

/** Every section carries the evidence it was built from, so any claim can be traced. */
export interface ReportSectionBase {
  /** Section kind — drives which renderer is used. */
  type: string;
  /** Display heading. The architect writes this to fit the subject (e.g. "Ingredients"). */
  heading?: string;
  /** Evidence card ids (E-numbers resolve against `HelixReport.evidenceIndex`). */
  citations?: number[];
  confidence?: ReportConfidence;
  /** True when the content is the model's INFERENCE rather than sourced fact. Rendered
   *  visually distinct so analysis is never mistaken for evidence. */
  inference?: boolean;
}

export interface ProseSection extends ReportSectionBase { type: "summary" | "prose"; text: string }
export interface TableSection extends ReportSectionBase { type: "table"; columns: string[]; rows: (string | number)[][] }
export interface ChartSection extends ReportSectionBase { type: "chart"; chart: "bar" | "donut" | "radar"; series: { label: string; value: number }[] }
export interface RankedSection extends ReportSectionBase { type: "ranked" | "risks" | "nextSteps" | "futureScope" | "openQuestions"; items: { text: string; detail?: string }[] }
export interface StepsSection extends ReportSectionBase { type: "steps"; items: { text: string; detail?: string }[] }
export interface ComparisonSection extends ReportSectionBase { type: "comparison"; options: string[]; criteria: string[]; matrix: string[][] }

export type ReportSection =
  | ProseSection | TableSection | ChartSection | RankedSection | StepsSection | ComparisonSection;

export interface ReportSource {
  n: number;              // the [E#] used in the text
  title: string;
  url?: string;
  corroborations?: number;
}

/** W6 verification result. ISSUP (Self-RAG) scores every checkable claim against the evidence;
 *  CoVe re-checks the failures against a fresh grounded search. `flags` carries only what the
 *  reader must act on — claims the pipeline could not stand behind. */
export interface ReportVerification {
  claimsChecked: number;
  /** Total checkable claims in the report. If > claimsChecked the budget truncated, and the
   *  ratio must not be presented as full coverage. */
  claimsAvailable?: number;
  supported: number;
  unsupported: number;
  contradicted: number;
  /** How many flagged claims got an independent second-pass grounded search. */
  coveChecked: number;
  /** Flagged by ISSUP, then CONFIRMED by fresh search — the system working, not a non-event. */
  coveConfirmed?: number;
  coveRefuted: number;
  coveUnverifiable?: number;
  flags: {
    claim: string;
    heading?: string;
    verdict: "unsupported" | "contradicted";
    /** CoVe verdict ("confirmed"/"refuted"/"unverifiable"), or "evidence-only" if not re-checked. */
    checked: string;
    note?: string;
  }[];
}

/** Two sources giving different figures for the same metric. Detected deterministically. */
export interface SourceContradiction {
  topic: string;
  values: string[];
  sources: string[];
  sample?: string;
}

export interface HelixReport {
  title: string;
  /** One-paragraph bottom line. Always present so a report is scannable in 5 seconds. */
  tldr: string;
  sections: ReportSection[];
  sources: ReportSource[];
  /** What the finished report does not establish. Derived from the written sections — NOT
   *  from pre-write coverage gaps, which described things the report went on to cover. */
  limitations?: string[];
  verification?: ReportVerification;
  contradictions?: SourceContradiction[];
  meta?: {
    rounds?: number;
    subquestions?: number;
    evidenceCount?: number;
    generatedAt?: string;
    /** Set when the architect or a section failed and we degraded — never hidden. */
    degraded?: string;
  };
}

/** Legacy runs returned only a flat string. Render them as a one-section report rather than
 *  breaking history — old projects must keep opening. */
export function legacyAnswerToReport(answer: string, title = "Answer"): HelixReport {
  return {
    title,
    tldr: answer,
    sections: [{ type: "prose", text: answer } as ProseSection],
    sources: [],
    meta: { degraded: "legacy run — pre-structured-report format" },
  };
}

/** Type guard used by the renderer to decide between report and legacy string. */
export function isHelixReport(x: unknown): x is HelixReport {
  return !!x && typeof x === "object" && Array.isArray((x as HelixReport).sections);
}
