import type { FileOperation, UniversalJarvisObject } from "./UniversalObjectEnvelope";

export type ProtocolValidationIssue = {
  field: string;
  severity: "error" | "warning";
  message: string;
};

export type ProtocolValidationResult = {
  ok: boolean;
  issues: ProtocolValidationIssue[];
};

const FILE_TYPES = new Set(["source_file_memory", "file_session", "file_operation", "file_patch", "file_index_entry", "skill", "agent", "command", "module"]);
const WRITE_OPS = new Set<FileOperation>(["write", "edit", "patch", "copy", "move", "delete"]);

export function validateUniversalJarvisObject(object: Partial<UniversalJarvisObject>): ProtocolValidationResult {
  const issues: ProtocolValidationIssue[] = [];
  const requireField = (field: keyof UniversalJarvisObject) => {
    if (!object[field]) issues.push({ field: String(field), severity: "error", message: `${String(field)} is required.` });
  };

  for (const field of ["id", "slug", "type", "name", "status", "version", "ownerDomain", "memoryUri", "filePath"] as const) {
    requireField(field);
  }

  if (object.memoryUri && !String(object.memoryUri).startsWith("memory://")) {
    issues.push({ field: "memoryUri", severity: "error", message: "memoryUri must start with memory://." });
  }

  if (object.type && FILE_TYPES.has(object.type) && touchesFiles(object) && !object.fileAccessPolicy) {
    issues.push({ field: "fileAccessPolicy", severity: "error", message: "Objects that touch files must declare fileAccessPolicy." });
  }

  if (object.fileAccessPolicy) {
    const policy = object.fileAccessPolicy;
    if (!policy.allowedOperations?.length) issues.push({ field: "fileAccessPolicy.allowedOperations", severity: "error", message: "At least one allowed file operation is required." });
    if (!policy.allowedRoots?.length) issues.push({ field: "fileAccessPolicy.allowedRoots", severity: "error", message: "At least one allowed root is required." });
    for (const op of WRITE_OPS) {
      if (policy.allowedOperations.includes(op) && !policy.requiresApprovalFor.includes(op)) {
        issues.push({ field: "fileAccessPolicy.requiresApprovalFor", severity: "error", message: `${op} requires explicit approval.` });
      }
    }
    if (!policy.secretScanRequired) {
      issues.push({ field: "fileAccessPolicy.secretScanRequired", severity: "warning", message: "Secret scanning should stay enabled for file access." });
    }
  }

  if (object.fileOperationSpec?.approvalRequired === false && WRITE_OPS.has(object.fileOperationSpec.operation)) {
    issues.push({ field: "fileOperationSpec.approvalRequired", severity: "error", message: "Destructive or mutating file operations must require approval." });
  }

  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}

export function touchesFiles(object: Partial<UniversalJarvisObject>): boolean {
  return Boolean(
    object.fileOperationSpec ||
    object.fileAccessPolicy ||
    object.filePath ||
    object.sourceRefs?.some((ref) => /^[A-Z]:\\|^\.{0,2}\//.test(ref))
  );
}

export function validateFilePathAgainstPolicy(filePath: string, object: Pick<UniversalJarvisObject, "fileAccessPolicy">): ProtocolValidationResult {
  const issues: ProtocolValidationIssue[] = [];
  const policy = object.fileAccessPolicy;
  if (!policy) return { ok: false, issues: [{ field: "fileAccessPolicy", severity: "error", message: "Missing file access policy." }] };
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  for (const blocked of policy.blockedRoots) {
    if (normalized.includes(blocked.replace(/\\/g, "/").toLowerCase())) {
      issues.push({ field: "filePath", severity: "error", message: `Path is under blocked root ${blocked}.` });
    }
  }
  for (const pattern of policy.alwaysBlockedPatterns) {
    const simple = pattern.replace(/\*/g, "").toLowerCase();
    if (simple && normalized.includes(simple)) {
      issues.push({ field: "filePath", severity: "error", message: `Path matches blocked pattern ${pattern}.` });
    }
  }
  return { ok: issues.length === 0, issues };
}
