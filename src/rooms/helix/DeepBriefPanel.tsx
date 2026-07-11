import React, { useEffect, useRef, useState } from "react";
import { DeepBrief, DeepBriefAction, FindingSource, HelixEntry, STRAND_META } from "./helix-types";

const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  triangulate: { icon: "△", color: "#4a9eff", label: "Triangulate" },
  redteam:     { icon: "⚔", color: "#ff6b6b", label: "Red Team" },
  priorart:    { icon: "◉", color: "#a04aff", label: "Prior Art" },
  develop:     { icon: "⊞", color: "#ffe14a", label: "Develop Strategy" },
  trace:       { icon: "⊳", color: "#4ac8ff", label: "Trace Lineage" },
  fork:        { icon: "⎇", color: "#4a9eff", label: "Fork Scenario" },
  lock:        { icon: "⊕", color: "#4aff9e", label: "Lock to Vault" },
};

const SECTIONS = [
  { id: "summary",     label: "Summary" },
  { id: "analysis",   label: "Deep Analysis" },
  { id: "findings",   label: "Key Findings" },
  { id: "means",      label: "What This Means" },
  { id: "proscons",   label: "Pros & Cons" },
  { id: "confidence", label: "Confidence" },
  { id: "actions",    label: "Recommended Actions" },
  { id: "proceed",    label: "How to Proceed" },
  { id: "drift",      label: "Drift History" },
];

interface Props {
  entry: HelixEntry;
  projectId: string;
  onClose: () => void;
  onBriefReady?: (entryId: string) => void;
  onFireAction?: (key: string) => void;
}

export function DeepBriefPanel({ entry, projectId, onClose, onBriefReady, onFireAction }: Props) {
  const [brief, setBrief] = useState<DeepBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("summary");
  const [generating, setGenerating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    fetchBrief(false);
  }, [entry.id]);

  async function fetchBrief(regenerate: boolean) {
    if (regenerate) {
      setGenerating(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      // Try GET first
      if (!regenerate) {
        const res = await fetch(`/api/helix/entry/${entry.id}/deep-brief`);
        const d = await res.json();
        if (d.brief) { setBrief(d.brief); onBriefReady?.(entry.id); setLoading(false); return; }
      }
      // Generate
      const res = await fetch(`/api/helix/entry/${entry.id}/deep-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, regenerate }),
      });
      const d = await res.json();
      if (d.brief) { setBrief(d.brief); onBriefReady?.(entry.id); }
      else setError(d.error || "Failed to generate brief");
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }

  function scrollTo(id: string) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = () => {
      for (const s of SECTIONS) {
        const ref = sectionRefs.current[s.id];
        if (!ref) continue;
        const rect = ref.getBoundingClientRect();
        if (rect.top >= 0 && rect.top < 300) { setActiveSection(s.id); break; }
      }
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, []);

  const meta = STRAND_META[entry.strand] || { color: "#4a9eff", label: entry.strand };

  return (
    <div className="dbp-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dbp-panel">
        {/* Header */}
        <div className="dbp-header">
          <div className="dbp-header-left">
            <span className="dbp-strand-dot" style={{ background: meta.color }} />
            <div className="dbp-header-text">
              <div className="dbp-eyebrow">✦ JARVIS INTELLIGENCE BRIEF</div>
              <div className="dbp-entry-q">{entry.query}</div>
            </div>
          </div>
          <div className="dbp-header-actions">
            {brief && (brief.regeneration_count ?? 0) > 0 && (
              <span className="dbp-gen-badge" title={`Regenerated ${brief.regeneration_count} time${brief.regeneration_count > 1 ? "s" : ""} — ${Math.round((brief.drift_score ?? 0) * 100)}% drift`}>
                Gen {(brief.regeneration_count ?? 0) + 1}
                {(brief.drift_score ?? 0) > 0.2 && <span className="dbp-drift-pip" style={{ background: (brief.drift_score ?? 0) > 0.4 ? "#ff9e4a" : "#ffe14a" }} />}
              </span>
            )}
            {brief && (
              <button
                className="dbp-regen-btn"
                onClick={() => fetchBrief(true)}
                disabled={generating}
                title="Regenerate brief"
              >
                {generating ? <span className="hx-spin" /> : "↺"} Regenerate
              </button>
            )}
            <button className="dbp-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="dbp-body">
          {/* Left nav */}
          <nav className="dbp-nav">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`dbp-nav-item${activeSection === s.id ? " active" : ""}${!brief ? " dbp-nav-item--dim" : ""}`}
                onClick={() => scrollTo(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="dbp-content" ref={contentRef}>
            {(loading || generating) && (
              <div className="dbp-loading">
                <div className="dbp-loading-ring" />
                <div className="dbp-loading-label">
                  {generating ? "Regenerating brief…" : "Generating intelligence brief…"}
                </div>
                <div className="dbp-loading-sub">
                  HELIX JARVIS is analyzing the entry, context, and all existing intelligence
                </div>
              </div>
            )}

            {error && !loading && (
              <div className="dbp-error">
                <div className="dbp-error-icon">⚠</div>
                <div className="dbp-error-text">{error}</div>
                <button className="dbp-error-retry" onClick={() => fetchBrief(false)}>Retry</button>
              </div>
            )}

            {brief && !loading && !generating && (
              <>
                {/* Summary */}
                <section className="dbp-section" ref={el => { sectionRefs.current["summary"] = el; }}>
                  <div className="dbp-section-eyebrow">Executive Summary</div>
                  <div className="dbp-summary-text">{brief.summary}</div>
                  <div className="dbp-conf-bar">
                    <span className="dbp-conf-label">Confidence</span>
                    <div className="dbp-conf-track">
                      <div className="dbp-conf-fill" style={{ width: `${Math.round(entry.confidence * 100)}%` }} />
                    </div>
                    <span className="dbp-conf-pct">{Math.round(entry.confidence * 100)}%</span>
                  </div>
                </section>

                {/* Deep Analysis */}
                <section className="dbp-section" ref={el => { sectionRefs.current["analysis"] = el; }}>
                  <div className="dbp-section-eyebrow">Deep Analysis</div>
                  <div className="dbp-body-text">{brief.deep_analysis}</div>
                </section>

                {/* Key Findings */}
                <section className="dbp-section" ref={el => { sectionRefs.current["findings"] = el; }}>
                  <div className="dbp-section-eyebrow">Key Findings</div>
                  <ol className="dbp-findings-list">
                    {brief.key_findings.map((f, i) => {
                      const src = brief.finding_sources?.find((s: FindingSource) => s.idx === i);
                      const toolMeta = src?.tool ? TOOL_META[src.tool] : null;
                      return (
                        <li key={i} className="dbp-finding-item">
                          <span className="dbp-finding-num">{String(i + 1).padStart(2, "0")}</span>
                          <div className="dbp-finding-body">
                            <span className="dbp-finding-text">{f}</span>
                            {src && (
                              <span
                                className="dbp-finding-source"
                                style={{ color: toolMeta?.color ?? "rgba(160,200,255,0.6)", borderColor: (toolMeta?.color ?? "#4a9eff") + "40" }}
                                title={src.source}
                              >
                                {toolMeta ? `${toolMeta.icon} ${toolMeta.label}` : "◈ Analysis"}
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                {/* What This Means */}
                <section className="dbp-section" ref={el => { sectionRefs.current["means"] = el; }}>
                  <div className="dbp-section-eyebrow">What This Means for the Project</div>
                  <div className="dbp-body-text dbp-body-text--highlight">{brief.what_this_means}</div>
                </section>

                {/* Pros & Cons */}
                <section className="dbp-section" ref={el => { sectionRefs.current["proscons"] = el; }}>
                  <div className="dbp-section-eyebrow">Pros & Cons</div>
                  <div className="dbp-proscons">
                    <div className="dbp-pros-col">
                      <div className="dbp-col-hdr dbp-col-hdr--pro">▲ Supporting</div>
                      {brief.pros.map((p, i) => (
                        <div key={i} className="dbp-pro-item">
                          <span className="dbp-pc-dot dbp-pc-dot--pro" />
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                    <div className="dbp-cons-col">
                      <div className="dbp-col-hdr dbp-col-hdr--con">▼ Counterarguments</div>
                      {brief.cons.map((c, i) => (
                        <div key={i} className="dbp-con-item">
                          <span className="dbp-pc-dot dbp-pc-dot--con" />
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* Confidence Reasoning */}
                <section className="dbp-section" ref={el => { sectionRefs.current["confidence"] = el; }}>
                  <div className="dbp-section-eyebrow">Confidence Assessment</div>
                  <div className="dbp-conf-score-big">
                    <div className="dbp-conf-ring" style={{ "--pct": entry.confidence } as React.CSSProperties}>
                      <span className="dbp-conf-ring-num">{Math.round(entry.confidence * 100)}</span>
                      <span className="dbp-conf-ring-label">%</span>
                    </div>
                    <div className="dbp-conf-reason">{brief.confidence_reasoning}</div>
                  </div>
                </section>

                {/* Recommended Actions */}
                <section className="dbp-section" ref={el => { sectionRefs.current["actions"] = el; }}>
                  <div className="dbp-section-eyebrow">Recommended Actions</div>
                  <div className="dbp-actions-list">
                    {brief.recommended_actions.map((a) => (
                      <ActionCard key={a.priority} action={a} onFire={onFireAction} />
                    ))}
                  </div>
                </section>

                {/* How to Proceed */}
                <section className="dbp-section" ref={el => { sectionRefs.current["proceed"] = el; }}>
                  <div className="dbp-section-eyebrow">How to Proceed</div>
                  <div className="dbp-proceed-text">{brief.how_to_proceed}</div>
                </section>

                {/* Drift History */}
                <section className="dbp-section dbp-section--last" ref={el => { sectionRefs.current["drift"] = el; }}>
                  <div className="dbp-section-eyebrow">Drift History</div>
                  {(brief.regeneration_count ?? 0) === 0 ? (
                    <div className="dbp-drift-empty">
                      <div className="dbp-drift-empty-icon">◎</div>
                      <div className="dbp-drift-empty-text">This is the first generation of this brief. Regenerate it after adding more entries to see how the analysis shifts.</div>
                    </div>
                  ) : (
                    <div className="dbp-drift-wrap">
                      <div className="dbp-drift-meta">
                        <span className="dbp-drift-gen">Generation #{(brief.regeneration_count ?? 0) + 1}</span>
                        <span className="dbp-drift-score" style={{ color: (brief.drift_score ?? 0) > 0.4 ? "#ff9e4a" : (brief.drift_score ?? 0) > 0.2 ? "#ffe14a" : "#4aff9e" }}>
                          {Math.round((brief.drift_score ?? 0) * 100)}% drift
                        </span>
                        {brief.last_regenerated_at && (
                          <span className="dbp-drift-ts">last regenerated {new Date(brief.last_regenerated_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                        )}
                      </div>
                      <div className="dbp-drift-label">Previous Summary</div>
                      <div className="dbp-drift-prev">{brief.previous_summary || "—"}</div>
                      <div className="dbp-drift-arrow">↓ evolved to ↓</div>
                      <div className="dbp-drift-label">Current Summary</div>
                      <div className="dbp-drift-curr">{brief.summary}</div>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionCard({ action, onFire }: { action: DeepBriefAction; onFire?: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const tool = action.helixTool ? TOOL_META[action.helixTool] : null;

  return (
    <div className={`dbp-action-card${open ? " dbp-action-card--open" : ""}`}>
      <div className="dbp-action-hdr" onClick={() => setOpen(x => !x)}>
        <span className="dbp-action-num">#{action.priority}</span>
        <span className="dbp-action-title">{action.action}</span>
        <div className="dbp-action-right">
          {tool && (
            <span className="dbp-action-tool" style={{ color: tool.color, borderColor: tool.color + "40" }}>
              {tool.icon} {tool.label}
            </span>
          )}
          <span className="dbp-action-chevron">{open ? "▾" : "▸"}</span>
        </div>
      </div>
      {open && (
        <div className="dbp-action-body">
          <div className="dbp-action-why"><span className="dbp-action-lbl">WHY</span>{action.why}</div>
          <div className="dbp-action-how"><span className="dbp-action-lbl">HOW</span>{action.how}</div>
          {tool && onFire && (
            <button
              className="dbp-action-fire"
              style={{ "--tc": tool.color } as React.CSSProperties}
              onClick={() => { onFire(action.helixTool!); }}
            >
              {tool.icon} Run {tool.label} now
            </button>
          )}
        </div>
      )}
    </div>
  );
}
