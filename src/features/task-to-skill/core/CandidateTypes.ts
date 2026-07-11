export type TaskDomain =
  | "browser"
  | "file"
  | "coding"
  | "research"
  | "device_mesh"
  | "coop_mesh"
  | "memory"
  | "artifact"
  | "system"
  | "ui"
  | "testing"
  | "school"
  | "quant"
  | "other";

export type GeneratedCandidateType =
  | "memory_object"
  | "command"
  | "skill"
  | "workflow"
  | "module"
  | "agent"
  | "guardrail"
  | "test";

export type TaskParameterCandidate = {
  name: string;
  value: string;
  inferredType: "string" | "url" | "selector" | "file_path" | "directory_path" | "boolean" | "number" | "project_id" | "device_id" | "query" | "date" | "choice";
  sourceStepIndex?: number;
  generalizable: boolean;
  exampleValues: string[];
  privacy: "safe" | "private" | "secret_blocked";
};

export type TaskStep = {
  index: number;
  actionType: "open_url" | "click" | "type" | "press_key" | "wait" | "read_text" | "extract" | "download" | "upload" | "create_file" | "edit_file" | "run_command" | "call_tool" | "query_memory" | "write_memory" | "start_server" | "pair_device" | "send_file" | "verify" | "other";
  target?: string;
  selector?: string;
  text?: string;
  url?: string;
  input?: unknown;
  output?: unknown;
  screenshotBefore?: string;
  screenshotAfter?: string;
  success: boolean;
  error?: string;
  durationMs?: number;
};

export type TempTaskLog = {
  id: string;
  title: string;
  originalUserRequest: string;
  normalizedIntent: string;
  projectId?: string;
  domains: TaskDomain[];
  startedAt: string;
  endedAt?: string;
  status: "success" | "partial" | "failed" | "blocked";
  steps: TaskStep[];
  toolsUsed: string[];
  filesAccessed: string[];
  websitesUsed: string[];
  modulesTouched: string[];
  screenshots: string[];
  outputRefs: string[];
  errorRefs: string[];
  userCorrections: string[];
  reusablePotential: "none" | "note" | "command" | "skill" | "workflow" | "module" | "agent" | "guardrail" | "test";
  parameterCandidates: TaskParameterCandidate[];
  evidenceSummary: string;
  privacy: "private" | "project_private" | "shareable" | "secret_blocked";
};

export type GeneratedTaskCandidate = {
  id: string;
  candidateType: GeneratedCandidateType;
  slug: string;
  name: string;
  sourceTaskId: string;
  projectId: string;
  domain: TaskDomain;
  parameters: TaskParameterCandidate[];
  triggers: string[];
  status: "candidate" | "duplicate_candidate" | "merge_candidate" | "update_existing" | "needs_review" | "rejected" | "approved" | "active";
  memoryUri: string;
};
