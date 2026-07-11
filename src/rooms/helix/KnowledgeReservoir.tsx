import React, { useState, useRef } from "react";
import { KnowledgeFile, FileClaim } from "./helix-types";

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "#ff6b6b", csv: "#4aff9e", txt: "#4a9eff", md: "#9e4aff",
  js: "#ffe14a", ts: "#4afff0", py: "#ff9e4a", json: "#4aff9e",
};
function fileTypeColor(ext: string) { return FILE_TYPE_COLORS[ext.toLowerCase()] ?? "#888"; }

export function KnowledgeReservoir({
  files, fileClaims, expandedFileId, ingesting, onExpand, onDelete, onDropFile,
}: {
  files: KnowledgeFile[];
  fileClaims: Record<string, FileClaim[]>;
  expandedFileId: string | null;
  ingesting: boolean;
  onExpand: (fileId: string) => void;
  onDelete: (fileId: string) => void;
  onDropFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="helix-knowledge">
      <div
        className="helix-knowledge-dropzone"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(f); }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.csv,.txt,.md,.js,.ts,.py,.json"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) { onDropFile(f); e.target.value = ""; } }}
        />
        <span className="helix-knowledge-dropzone-icon">{ingesting ? "⟳" : "+"}</span>
        <span className="helix-knowledge-dropzone-label">
          {ingesting ? "Ingesting…" : "Drop file or click — PDF, CSV, TXT, code"}
        </span>
      </div>

      {files.length === 0 && !ingesting && (
        <div className="helix-empty"><span>No files yet — drop a PDF, CSV, or text file to extract intelligence</span></div>
      )}

      {files.map(file => {
        const color = fileTypeColor(file.filetype);
        const isExpanded = expandedFileId === file.id;
        const claims = fileClaims[file.id] ?? [];
        return (
          <div key={file.id} className={`helix-file-card${isExpanded ? " expanded" : ""}`}>
            <div className="helix-file-card-head" onClick={() => onExpand(file.id)}>
              <span className="helix-file-type-badge" style={{ color, borderColor: color }}>{file.filetype.toUpperCase()}</span>
              <span className="helix-file-name">{file.filename}</span>
              <span className={`helix-file-status helix-file-status--${file.status}`}>
                {file.status === "processing" ? "⟳" : file.status === "ready" ? `${file.claim_count} claims` : "✗"}
              </span>
              {file.contradiction_count > 0 && (
                <span className="helix-file-contradictions">⚡ {file.contradiction_count}</span>
              )}
              <button className="helix-file-delete" onClick={e => { e.stopPropagation(); onDelete(file.id); }} title="Delete">×</button>
            </div>
            {isExpanded && file.status === "ready" && (
              <div className="helix-file-claims">
                {claims.length === 0 && <div className="helix-file-claims-empty">Loading claims…</div>}
                {claims.map(claim => (
                  <div key={claim.id} className="helix-file-claim">
                    <div className="helix-file-claim-bar" style={{ width: `${Math.round(claim.confidence * 100)}%`, background: color }} />
                    <span className="helix-file-claim-text">{claim.text}</span>
                    <span className="helix-file-claim-conf">{Math.round(claim.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
