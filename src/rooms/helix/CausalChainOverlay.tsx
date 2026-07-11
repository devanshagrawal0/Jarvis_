import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { CausalChain, CausalChainStep, HelixEntry, Strand, STRAND_META } from "./helix-types";

// ── Causal Chain Overlay ────────────────────────────────────────────────────
export function CausalChainOverlay({ chain, entries, onClose }: {
  chain: CausalChain;
  entries: HelixEntry[];
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  const entry = entries.find(e => e.id === chain.entry_id);
  const meta = entry ? (STRAND_META[entry.strand as Strand] ?? STRAND_META.evidence) : STRAND_META.evidence;
  const REL_COLOR: Record<string, string> = {
    mechanism:    "#4aff9e",
    correlation:  "#4a9eff",
    assumption:   "#ffe14a",
    confounding:  "#ff9e4a",
  };
  return (
    <aside className="helix-causal-overlay" ref={containerRef}>
      <div className="helix-causal-header">
        <div className="helix-causal-title">
          <span className="helix-causal-wordmark">CAUSAL CHAIN</span>
          {entry && <span className="helix-card-strand-badge" style={{ background: `${meta.color}22`, color: meta.color, borderColor: meta.color }}>{meta.label}</span>}
        </div>
        <button className="helix-causal-close" onClick={onClose}>✕</button>
      </div>
      {entry && <p className="helix-causal-source">{entry.query}</p>}
      <div className="helix-causal-body">
        {chain.chain.length === 0 ? (
          <div className="helix-empty"><span>No chain data</span></div>
        ) : (
          <div className="helix-causal-chain">
            {chain.chain.map((step, i) => (
              <div key={i} className="helix-causal-step">
                {i === 0 && <div className="helix-causal-node helix-causal-node--root">{step.from}</div>}
                <div className="helix-causal-connector">
                  <div className="helix-causal-connector-line" style={{ borderColor: REL_COLOR[step.relationship] ?? "#4afff0" }} />
                  <div className="helix-causal-rel-label" style={{ color: REL_COLOR[step.relationship] ?? "#4afff0" }}>
                    {step.relationship} <span className="helix-causal-rel-conf">{Math.round(step.confidence * 100)}%</span>
                  </div>
                </div>
                <div className={`helix-causal-node${i === chain.chain.length - 1 ? " helix-causal-node--final" : ""}`}>{step.to}</div>
              </div>
            ))}
          </div>
        )}
        <div className="helix-causal-legend">
          {Object.entries(REL_COLOR).map(([rel, col]) => (
            <span key={rel} className="helix-causal-legend-item" style={{ color: col }}>— {rel}</span>
          ))}
        </div>
      </div>
    </aside>
  );
}
