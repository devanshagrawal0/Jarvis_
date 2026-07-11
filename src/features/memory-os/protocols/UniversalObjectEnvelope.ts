export type JsonSchemaLike = Record<string, unknown>;

export type UniversalJarvisObjectType =
  | "agent"
  | "skill"
  | "command"
  | "workflow"
  | "module"
  | "memory_object"
  | "task_pattern"
  | "system_update"
  | "report"
  | "expectation"
  | "mistake_lesson"
  | "guardrail"
  | "query_index"
  | "source_file_memory"
  | "project_memory"
  | "routine_memory"
  | "personal_preference"
  | "web_research"
  | "device_mesh_event"
  | "coop_mesh_event"
  | "file_session"
  | "file_operation"
  | "file_patch"
  | "file_index_entry";

export type FileOperation =
  | "search"
  | "find"
  | "list"
  | "open"
  | "close"
  | "read"
  | "inspect"
  | "summarize"
  | "write"
  | "edit"
  | "patch"
  | "copy"
  | "move"
  | "delete"
  | "index"
  | "watch";

export type FileAccessPolicy = {
  allowedOperations: FileOperation[];
  allowedRoots: string[];
  blockedRoots: string[];
  allowedExtensions: string[];
  blockedExtensions: string[];
  maxReadBytes?: number;
  maxSearchResults?: number;
  requiresApprovalFor: FileOperation[];
  alwaysBlockedPatterns: string[];
  secretScanRequired: boolean;
  patchPreviewRequired: boolean;
  logEveryOperation: boolean;
  writeMemoryTrace: boolean;
};

export type FileOperationSpec = {
  operation: FileOperation;
  targetPath?: string;
  targetGlob?: string;
  query?: string;
  openMode?: "read_only" | "edit_pending_approval" | "write";
  expectedContentType?: string;
  outputPath?: string;
  patchPath?: string;
  approvalRequired: boolean;
  verification: string[];
  memoryWritePathTemplate: string;
};

export type DatabaseRef = { table: string; id?: string; query?: string };
export type PermissionSpec = { name: string; scope: string; required: boolean };
export type SafetySpec = { riskLevel: "low" | "medium" | "high"; blockedIf: string[]; requiresApproval: boolean };
export type PrivacySpec = { level: "public" | "internal" | "private" | "secret"; secretScanRequired: boolean };
export type EvidenceRef = { type: string; ref: string; summary?: string };
export type RelatedObjectRef = { uri: string; relation: string };
export type QueryIndexSpec = { keywords: string[]; fields: string[]; lastIndexedAt?: string };
export type VerificationSpec = { required: boolean; checks: string[]; lastResult?: "pass" | "fail" | "unknown" };
export type TestSpec = { name: string; command?: string; status: "missing" | "pass" | "fail" | "not_applicable" };
export type FailureHandlingSpec = { retryPolicy: string; fallback: string; userMessage: string };
export type StorageTraceSpec = { fileExists: boolean; databaseRowExists: boolean; queryable: boolean; traceRefs: string[] };

export type UniversalJarvisObject = {
  id: string;
  slug: string;
  type: UniversalJarvisObjectType;
  name: string;
  shortDescription: string;
  detailedDescription: string;
  status: "candidate" | "pending_approval" | "approved" | "active" | "disabled" | "deprecated" | "superseded" | "rejected" | "failed" | "blocked";
  version: string;
  ownerDomain: string;
  projectIds: string[];
  memoryUri: string;
  filePath: string;
  runtimePath?: string;
  databaseRefs: DatabaseRef[];
  tags: string[];
  keywords: string[];
  aliases: string[];
  inputSchema?: JsonSchemaLike;
  outputSchema?: JsonSchemaLike;
  parameterSchema?: JsonSchemaLike;
  permissions: PermissionSpec[];
  safety: SafetySpec;
  privacy: PrivacySpec;
  fileAccessPolicy?: FileAccessPolicy;
  fileOperationSpec?: FileOperationSpec;
  evidence: EvidenceRef[];
  sourceRefs: string[];
  relatedObjects: RelatedObjectRef[];
  queryIndex: QueryIndexSpec;
  verification: VerificationSpec;
  tests: TestSpec[];
  failureHandling: FailureHandlingSpec;
  storageTrace: StorageTraceSpec;
  lifecycle: {
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
    lastCheckedAt?: string;
    lastTestedAt?: string;
    reviewAfter?: string;
    supersedes?: string[];
    supersededBy?: string[];
  };
  approval: {
    required: boolean;
    status: "not_required" | "pending" | "approved" | "rejected" | "edited";
    approvalId?: string;
    approvedBy?: string;
    approvedAt?: string;
    decisionNotes?: string;
  };
  ui: {
    displayTitle: string;
    displaySubtitle: string;
    categoryLabel: string;
    iconHint?: string;
    riskBadge?: string;
    quickActions: string[];
  };
  metadata: Record<string, unknown>;
};

export const defaultJarvisFileAccessPolicy: FileAccessPolicy = {
  allowedOperations: ["search", "find", "list", "open", "close", "read", "inspect", "summarize", "index", "watch"],
  allowedRoots: ["project_root", "runtime", "uploads", "artifacts"],
  blockedRoots: ["runtime/secrets", "runtime/neural_vault/raw/private", ".git/objects", "node_modules", "dist", "build"],
  allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".py", ".sql", ".yaml", ".yml"],
  blockedExtensions: [".env", ".pem", ".key", ".p12", ".pfx"],
  maxReadBytes: 500000,
  maxSearchResults: 100,
  requiresApprovalFor: ["write", "edit", "patch", "copy", "move", "delete"],
  alwaysBlockedPatterns: [".env", ".env.*", "*secret*", "*token*", "*credential*", "*.pem", "*.key"],
  secretScanRequired: true,
  patchPreviewRequired: true,
  logEveryOperation: true,
  writeMemoryTrace: true,
};
