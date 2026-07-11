import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { LivingBrief, BRIEF_SECTION_LABELS } from "./helix-types";

const BRIEF_SECTION_ORDER = ["current_state", "key_decisions", "open_questions", "what_changed", "whats_at_risk", "whats_next"];

export function LivingBriefOverlay({ brief, loading, changedSections, onClose }: {
  brief: LivingBrief | null;
  loading: boolean;
  changedSections: Record<string, boolean>;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  const hasSections = brief && Object.keys(brief.sections).length > 0;

  function readAloud() {
    if (!brief || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const text = BRIEF_SECTION_ORDER
        .filter(k => brief.sections[k])
        .map(k => `${BRIEF_SECTION_LABELS[k]}. ${brief.sections[k]}`)
        .join(" ... ");
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.9;
      window.speechSynthesis.speak(utt);
    } catch { /**/ }
  }

  return (
    <div ref={containerRef} className="helix-brief-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="helix-brief-panel">
        <div className="helix-brief-head">
          <span className="helix-brief-wordmark">◎ Living Brief</span>
          {brief && <span className="helix-brief-version">v{brief.version}</span>}
          <div className="helix-brief-actions">
            {hasSections && (
              <button className="helix-brief-tts-btn" onClick={readAloud} title="Read aloud">
                ▶ Read
              </button>
            )}
            <button className="helix-brief-close" onClick={onClose}>×</button>
          </div>
        </div>
        {loading && (
          <div className="helix-brief-loading">
            <span className="helix-spinner" /> Synthesizing brief…
          </div>
        )}
        {!loading && !hasSections && (
          <div className="helix-empty" style={{ padding: "40px 0" }}>
            <span>Brief will auto-generate after your next 3 inquiries</span>
          </div>
        )}
        {!loading && hasSections && (
          <div className="helix-brief-sections">
            {BRIEF_SECTION_ORDER.map(key => {
              const text = brief!.sections[key];
              if (!text) return null;
              const isNew = changedSections[key];
              return (
                <div key={key} className={`helix-brief-section${isNew ? " helix-brief-section--new" : ""}`}>
                  <div className="helix-brief-section-label">
                    {BRIEF_SECTION_LABELS[key]}
                    {isNew && <span className="helix-brief-section-new-tag">updated</span>}
                  </div>
                  <p className="helix-brief-section-text">{text}</p>
                </div>
              );
            })}
          </div>
        )}
        {brief && (
          <div className="helix-brief-footer">
            Last synthesized from project entries · Close to mark as seen
          </div>
        )}
      </div>
    </div>
  );
}

