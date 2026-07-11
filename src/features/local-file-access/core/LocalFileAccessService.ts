import type { FileAccessPolicy } from "./FileAccessPolicy";
import type { FileSearchResult, FileSession } from "./FileAccessTypes";

export type LocalFileAccessClient = {
  policy: FileAccessPolicy;
  search(query: string): Promise<FileSearchResult[]>;
  open(path: string): Promise<FileSession>;
  close(pathOrSessionId: string): Promise<FileSession>;
  read(path: string): Promise<{ filePath: string; content: string; memoryUri?: string }>;
};

export function createLocalFileAccessClient(baseUrl = ""): LocalFileAccessClient {
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  }
  return {
    policy: {
      allowedOperations: ["search", "find", "list", "open", "close", "read", "inspect", "summarize", "index", "watch"],
      allowedRoots: ["project_root", "runtime", "uploads", "artifacts"],
      blockedRoots: ["runtime/secrets", "runtime/neural_vault/raw/private", ".git/objects", "node_modules", "dist", "build"],
      allowedExtensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".css", ".html", ".py", ".sql", ".yaml", ".yml"],
      blockedExtensions: [".env", ".pem", ".key", ".p12", ".pfx"],
      requiresApprovalFor: ["write", "edit", "patch", "copy", "move", "delete"],
      alwaysBlockedPatterns: [".env", ".env.*", "*secret*", "*token*", "*credential*", "*.pem", "*.key"],
      secretScanRequired: true,
      patchPreviewRequired: true,
      logEveryOperation: true,
      writeMemoryTrace: true,
    },
    async search(query) {
      const result = await api<{ results: FileSearchResult[] }>(`/api/local-file-access/search?q=${encodeURIComponent(query)}`);
      return result.results;
    },
    async open(path) {
      const result = await api<{ session: FileSession }>("/api/local-file-access/open", { method: "POST", body: JSON.stringify({ path }) });
      return result.session;
    },
    async close(pathOrSessionId) {
      const result = await api<{ session: FileSession }>("/api/local-file-access/close", { method: "POST", body: JSON.stringify({ path: pathOrSessionId, sessionId: pathOrSessionId }) });
      return result.session;
    },
    async read(path) {
      return api("/api/local-file-access/read", { method: "POST", body: JSON.stringify({ path }) });
    },
  };
}
