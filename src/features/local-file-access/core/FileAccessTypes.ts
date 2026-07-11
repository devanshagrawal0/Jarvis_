import type { FileOperation } from "../../memory-os/protocols/UniversalObjectEnvelope";

export type FileSession = {
  id: string;
  filePath: string;
  memoryUri?: string;
  openedBy: string;
  openedAt: string;
  closedAt?: string;
  mode: "read_only" | "edit_review" | "write";
  status: "open" | "closed" | "stale" | "error";
  checksumAtOpen: string;
  checksumCurrent?: string;
  relatedTaskId?: string;
  relatedSkillId?: string;
  relatedAgentId?: string;
  notes?: string;
};

export type FileOperationLog = {
  id: string;
  operation: FileOperation;
  filePath: string;
  actor: string;
  startedAt: string;
  endedAt?: string;
  status: "success" | "failed" | "blocked" | "pending_approval";
  approvalId?: string;
  checksumBefore?: string;
  checksumAfter?: string;
  bytesRead?: number;
  bytesWritten?: number;
  searchQuery?: string;
  resultCount?: number;
  error?: string;
  memoryUri?: string;
  storageTraceId?: string;
};

export type FileSearchResult = {
  filePath: string;
  line?: number;
  snippet: string;
  ownerModule?: string;
  memoryUri?: string;
};
