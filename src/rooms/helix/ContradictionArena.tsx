import React, { useState } from "react";
import { Contradiction, HelixEntry, Insight, STRAND_META, Strand } from "./helix-types";

// ── Contradiction Arena ─────────────────────────────────────────────────────
function ContradictionArena({ contradictions, entries, onResolve, formatTime }: {
  contradictions: Contradiction[];
  entries: HelixEntry[];
  onResolve: (id: string) => void;
  formatTime: (s: string) => string;
}) {
  const open = contradictions.filter(c => c.status === "open");
  const resolved = contradictions.filter(c => c.status === "resolved");

  if (contradictions.length === 0) {
    return <div className="helix-empty"><span>No contradictions detected — HELIX will flag conflicts automatically as you add entries</span></div>;
  }

  const SEVERITY_COLOR: Record<string, string> = { low: "#ffe14a", medium: "#ff9e4a", high: "#ff6b6b" };

  return (
    <div className="helix-arena">
      {open.length === 0 && resolved.length > 0 && (
        <div className="helix-empty" style={{ flex: "none", paddingBottom: 8 }}>
          <span>All conflicts resolved</span>
        </div>
      )}
      {open.map(c => {
        const entryA = entries.find(e => e.id === c.entry_a_id);
        const entryB = entries.find(e => e.id === c.entry_b_id);
        return (
          <article key={c.id} className="helix-arena-card">
            <div className="helix-arena-head">
              <span className="helix-arena-type">{c.contradiction_type}</span>
              <span className="helix-arena-severity" style={{ color: SEVERITY_COLOR[c.severity] ?? "#ffe14a" }}>{c.severity}</span>
              <time className="helix-arena-time">{formatTime(c.created_at)}</time>
              <button className="helix-arena-resolve-btn" onClick={() => onResolve(c.id)}>Resolve</button>
            </div>
            <div className="helix-arena-entries">
              <div className="helix-arena-entry">
                <span className="helix-arena-entry-strand" style={{ color: STRAND_META[entryA?.strand as Strand]?.color ?? "#4a9eff" }}>
                  {STRAND_META[entryA?.strand as Strand]?.label ?? "?"}
                </span>
                <p className="helix-arena-entry-query">{entryA?.query ?? c.entry_a_id}</p>
              </div>
              <span className="helix-arena-vs">⚡</span>
              <div className="helix-arena-entry">
                <span className="helix-arena-entry-strand" style={{ color: STRAND_META[entryB?.strand as Strand]?.color ?? "#4a9eff" }}>
                  {STRAND_META[entryB?.strand as Strand]?.label ?? "?"}
                </span>
                <p className="helix-arena-entry-query">{entryB?.query ?? c.entry_b_id}</p>
              </div>
            </div>
          </article>
        );
      })}
      {resolved.length > 0 && (
        <details className="helix-arena-resolved-group">
          <summary>{resolved.length} resolved</summary>
          {resolved.map(c => (
            <div key={c.id} className="helix-arena-resolved-item">
              <span>{c.contradiction_type}</span>
              <span>{formatTime(c.created_at)}</span>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// ── InsightCard ────────────────────────────────────────────────────────────
const INSIGHT_TYPE_META: Record<string, { icon: string; color: string }> = {
  pattern:     { icon: "◈", color: "#4afff0" },
  gap:         { icon: "⊘", color: "#ff6b6b" },
  implication: { icon: "⟶", color: "#ffe14a" },
  anomaly:     { icon: "⚡", color: "#9e4aff" },
};
function InsightCard({ insight, onDismiss }: { insight: Insight; onDismiss: () => void }) {
  const meta = INSIGHT_TYPE_META[insight.type] ?? INSIGHT_TYPE_META.pattern;
  return (
    <div className="helix-insight-card" style={{ "--insight-color": meta.color } as React.CSSProperties}>
      <div className="helix-insight-card-head">
        <span className="helix-insight-type-icon">{meta.icon}</span>
        <span className="helix-insight-type-label">{insight.type}</span>
        <div className="helix-insight-confidence-bar">
          <div className="helix-insight-confidence-fill" style={{ width: `${Math.round(insight.confidence * 100)}%` }} />
        </div>
        <span className="helix-insight-confidence-pct">{Math.round(insight.confidence * 100)}%</span>
        <button className="helix-insight-dismiss" onClick={onDismiss} title="Dismiss">×</button>
      </div>
      <div className="helix-insight-title">{insight.title}</div>
      <p className="helix-insight-content">{insight.content}</p>
    </div>
  );
}

export { ContradictionArena, InsightCard };
