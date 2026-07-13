export type ModeId =
  | "main"
  | "focus"
  | "plan"
  | "command"
  | "workpad"
  | "browser"
  | "markets"
  | "projects"
  | "vision"
  | "canvas"
  | "agents"
  | "phone"
  | "study"
  | "prepare"
  | "media"
  | "settings";

export type ApiSettings = {
  hasGeminiKey: boolean;
  geminiModel?: string;
  remotePin?: string;
  webhookBaseUrl?: string;
  wakePhrase?: string;
  keySource?: "env" | "local" | "missing";
  providers?: Record<string, ProviderStatus>;
};

export type ProviderStatus = {
  connected: boolean;
  source?: "env" | "local" | "missing" | string;
  label?: string;
};

export type SystemMetrics = {
  cpu?: number;
  memory?: number;
  network?: number;
  reactor?: number;
  shield?: number;
  threat?: number;
  latency?: number;
};

export type SystemState = {
  agent: string;
  state: string;
  clock: string;
  uptimeSeconds: number;
  commandCount: number;
  lastIntent: string;
  settings: ApiSettings;
  metrics: SystemMetrics;
};

export type BrainResponse = {
  intent: string;
  response: string;
  tone?: string;
  actions?: string[];
  source?: "local" | "gemini";
  needsKey?: boolean;
  model?: string;
  error?: string;
  strength?: "cost-guarded" | "balanced" | "full";
  sources?: Array<{ title?: string; url: string }>;
  artifacts?: JarvisArtifact[];
  cards?: JarvisResponseCard[];
  uiActions?: JarvisUiAction[];
  receipt?: { id?: string; status?: string; action?: string; verification?: string[] };
  usage?: { calls?: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number };
  timing?: { totalMs?: number; modelMs?: number; totalModelCalls?: number; fallbackAttempts?: number };
  pendingConfirmations?: Array<{
    id: string;
    tool: string;
    risk?: string;
    summary?: Record<string, unknown>;
    expiresAt?: string;
    ownerChallenge?: string;
  }>;
};

export type JarvisActivityEvent = {
  id: string;
  kind: "run" | "plan" | "model" | "tool" | "source" | "artifact" | "approval" | "receipt" | "ui" | "research" | "error" | string;
  status: "running" | "ready" | "complete" | "approval" | "error" | string;
  label: string;
  detail?: string;
  timestamp?: string;
  sequence?: number;
  tool?: string;
};

export type JarvisArtifact = {
  id?: string;
  artifactId?: string;
  kind?: string;
  title?: string;
  name?: string;
  filename?: string;
  bytes?: number;
  mediaType?: string;
  downloadUrl?: string;
  status?: string;
};

export type JarvisResponseCard = {
  kind?: string;
  title: string;
  body?: string;
  value?: string;
  status?: string;
  items?: string[];
};

export type JarvisUiAction = {
  type: "open-widget" | "close-widget" | "populate-widget" | string;
  id?: string;
  focus?: boolean;
  state?: string;
  data?: Record<string, unknown>;
};

export type JarvisModuleManifest = {
  id: string;
  title: string;
  category: string;
  status: "installed" | "available" | "disabled";
  view: string;
  summary: string;
  keywords: string[];
  permissions: string[];
  requires: string[];
  ready?: boolean;
  missingProviders?: string[];
  blockedReason?: string;
};

export type PersonalBrainProfile = {
  owner: string;
  product: string;
  source: string;
  sourceChars?: number;
  sourceUpdatedAt?: string;
  modes: string[];
  constitution: string[];
  preferences: string[];
  modules: Array<{
    id: string;
    title: string;
    category: string;
    status: string;
    ready?: boolean;
    view?: string;
  }>;
  updatedAt?: string;
};

export type JarvisMemory = {
  facts?: Array<{
    id: string;
    label: string;
    value: string;
    source?: string;
    updatedAt?: string;
  }>;
};

export type ModuleRunResponse = {
  module: JarvisModuleManifest;
  blocked?: boolean;
  targetView?: string;
  message: string;
  actions?: string[];
  data?: unknown;
};

export type Market = {
  ticker: string;
  title: string;
  subtitle?: string;
  category?: string;
  eventTicker?: string;
  yesBid?: number | null;
  yesAsk?: number | null;
  volume?: number;
  closeTime?: string;
  status?: string;
};

export type Project = {
  name: string;
  folder: string;
  path: string;
  updatedAt: string;
  hasGit: boolean;
  hasReadme: boolean;
  fileCount: number;
  package?: {
    name: string;
    scripts: Record<string, string>;
    dependencies: number;
  } | null;
};

export type AgentTask = {
  id: string;
  title: string;
  mode: string;
  status: string;
  progress: number;
  durationMs?: number;
  createdAt: string;
  updatedAt?: string;
  steps?: string[];
};

export type VerificationRecord = {
  id: string;
  title: string;
  status: "verified" | "failed";
  confidence: number;
  checks: string[];
  createdAt: string;
};

export type CanvasNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  type?: string;
};

export type CanvasState = {
  id: string;
  updatedAt?: string;
  nodes: CanvasNode[];
  edges: [string, string][];
};

export type RunEvent = {
  id: string;
  kind: string;
  message: string;
  time: string;
  status?: "info" | "ok" | "warn" | "fail";
};
