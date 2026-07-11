import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RedTeamSession, RedTeamCritique, HelixEntry, Strand, STRAND_META } from "./helix-types";

// ── Red Team Overlay ───────────────────────────────────────────────────────
export function RedTeamOverlay({ entry, targetText, session, loading, onClose }: {
  entry: HelixEntry | null;
  targetText?: string;
  session: RedTeamSession | null;
  loading: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  const meta = entry ? (STRAND_META[entry.strand as Strand] ?? STRAND_META.evidence) : STRAND_META.evidence;
  const displayQuery = entry?.query ?? targetText ?? "Unknown target";
  const displayText  = entry?.text ?? "";

  return (
    <aside className="helix-redteam-overlay" ref={containerRef}>
      <div className="helix-redteam-header">
        <div className="helix-redteam-title">
          <span className="helix-redteam-wordmark">RED TEAM</span>
          {entry && <span className="helix-card-strand-badge" style={{ background: `${meta.color}22`, color: meta.color, borderColor: meta.color }}>{meta.label}</span>}
        </div>
        <button className="helix-redteam-close" onClick={onClose}>✕</button>
      </div>

      <div className="helix-redteam-body">
        {/* Target entry */}
        <div className="helix-redteam-target">
          <div className="helix-redteam-target-label">TARGET</div>
          <p className="helix-redteam-target-query">{displayQuery}</p>
          {displayText && <p className="helix-redteam-target-text">{displayText}</p>}
        </div>

        {/* Critique columns */}
        <div className="helix-redteam-critiques">
          {loading ? (
            <>
              {["Skeptic", "Devil's Advocate", "Historian", "Empiricist", "Systems Thinker"].map((label, i) => (
                <div key={i} className="helix-redteam-col helix-redteam-col--loading">
                  <div className="helix-redteam-col-agent">{label}</div>
                  <div className="helix-redteam-col-vector">Loading…</div>
                  <div className="helix-redteam-loading-pulse" />
                </div>
              ))}
            </>
          ) : session ? (
            session.critiques.map(c => (
              <div key={c.key} className="helix-redteam-col" style={{ "--agent-color": c.color } as React.CSSProperties}>
                <div className="helix-redteam-col-agent" style={{ color: c.color }}>{c.label}</div>
                <div className="helix-redteam-col-vector">{c.attackVector}</div>
                <p className="helix-redteam-col-argument">{c.argument}</p>
              </div>
            ))
          ) : (
            <div className="helix-empty"><span>Launching agents…</span></div>
          )}
        </div>

        {/* Verdict */}
        {session && !loading && (
          <div className="helix-redteam-verdict">
            <div className="helix-redteam-verdict-label">SYNTHESIS VERDICT</div>
            <p className="helix-redteam-verdict-text">{session.verdict?.text ?? "No verdict"}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
