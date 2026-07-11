import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { OracleAnswer, HelixEntry, STRAND_META, Strand } from "./helix-types";

export function OracleOverlay({ query, answer, loading, entries, onQueryChange, onSubmit, onClose }: {
  query: string;
  answer: OracleAnswer | null;
  loading: boolean;
  entries: HelixEntry[];
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, []);

  const EXAMPLE_QUESTIONS = [
    "What is the biggest gap in our evidence?",
    "Which strategy assumption is weakest?",
    "What contradictions should we resolve first?",
    "What should we investigate next?",
  ];

  return (
    <div ref={containerRef} className="helix-oracle-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="helix-oracle-panel">
        <div className="helix-oracle-head">
          <span className="helix-oracle-wordmark">⊕ Oracle</span>
          <span className="helix-oracle-sub">Meta-intelligence — ask anything about this project</span>
          <button className="helix-oracle-close" onClick={onClose}>×</button>
        </div>
        <div className="helix-oracle-input-row">
          <input
            ref={inputRef}
            className="helix-oracle-input"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onSubmit(); if (e.key === "Escape") onClose(); }}
            placeholder="Ask a meta-question about this project…"
            disabled={loading}
          />
          <button className="helix-oracle-submit" onClick={onSubmit} disabled={loading || !query.trim()}>
            {loading ? <span className="helix-spinner" /> : "→"}
          </button>
        </div>
        {!answer && !loading && (
          <div className="helix-oracle-examples">
            {EXAMPLE_QUESTIONS.map((q, i) => (
              <button key={i} className="helix-oracle-example" onClick={() => { onQueryChange(q); setTimeout(() => inputRef.current?.focus(), 40); }}>
                {q}
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div className="helix-oracle-loading">
            <span className="helix-spinner" />
            <span>Querying {entries.length} entries…</span>
          </div>
        )}
        {answer && !loading && (
          <div className="helix-oracle-answer">
            <div className="helix-oracle-key-finding">
              <span className="helix-oracle-kf-label">Key Finding</span>
              <p>{answer.key_finding}</p>
            </div>
            <div className="helix-oracle-answer-text">{answer.answer}</div>
            {answer.sources.length > 0 && (
              <div className="helix-oracle-sources">
                <span className="helix-oracle-sources-label">Source Entries ({answer.sources.length})</span>
                {answer.sources.map((s) => (
                  <div key={s.entry_id} className="helix-oracle-source-item">
                    <span className="helix-oracle-source-strand" style={{ color: STRAND_META[s.strand as Strand]?.color ?? "#4a9eff" }}>
                      {STRAND_META[s.strand as Strand]?.label ?? s.strand}
                    </span>
                    <span className="helix-oracle-source-query">{s.query}</span>
                    <span className="helix-oracle-source-relevance">{s.relevance}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="helix-oracle-confidence">
              Confidence: {Math.round(answer.confidence * 100)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

