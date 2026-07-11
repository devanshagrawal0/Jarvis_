// src/rooms/helix/widgets/DecisionTabRenderer.tsx
// Wave 2-A-3: Decision tab — option cards, weight matrix, recommendation callout.
// R6: No data fetching. Pure display component.

import React from "react";
import type { DecisionTabData, DecisionOption } from "./types";

function OptionCard({ opt, index }: { opt: DecisionOption; index: number }) {
  const letter = String.fromCharCode(65 + index);
  const conf   = opt.confidence ?? 0.7;
  const color  = conf >= 0.8 ? "#4aff9e" : conf >= 0.6 ? "#ffe14a" : "#ff9e4a";
  return (
    <div className="hxw-option-card">
      <div className="hxw-oc-hdr">
        <span className="hxw-oc-letter" style={{ color }}>{letter}</span>
        <span className="hxw-oc-title">{opt.title}</span>
        <span className="hxw-oc-conf" style={{ color }}>{Math.round(conf * 100)}%</span>
      </div>
      {opt.rationale && <p className="hxw-oc-rationale">{opt.rationale}</p>}
      <div className="hxw-oc-bar-wrap">
        <div className="hxw-oc-bar" style={{ width: `${conf * 100}%`, background: color }} />
      </div>
      <div className="hxw-oc-chips">
        {(opt.pros ?? []).map((p, i) => (
          <span key={i} className="hxw-chip hxw-chip--pro">+ {p}</span>
        ))}
        {(opt.cons ?? []).map((c, i) => (
          <span key={i} className="hxw-chip hxw-chip--con">− {c}</span>
        ))}
      </div>
    </div>
  );
}

function RecoCallout({ text }: { text: string }) {
  return (
    <div className="hxw-reco-callout">
      <span className="hxw-reco-icon">⊞</span>
      <div className="hxw-reco-body">
        <div className="hxw-reco-label">Recommendation</div>
        <p className="hxw-reco-text">{text}</p>
      </div>
    </div>
  );
}

interface Props { data: DecisionTabData | null }

export function DecisionTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No decision data available.</div>;

  const options = data.options ?? [];

  if (options.length === 0) {
    return (
      <div className="hxw-decision-tab">
        <div className="hxw-empty">No options extracted from response.</div>
        {data.recommendation && <RecoCallout text={data.recommendation} />}
      </div>
    );
  }

  return (
    <div className="hxw-decision-tab">
      {data.domain && <div className="hxw-domain-badge">Domain: {data.domain}</div>}
      <div className="hxw-option-grid">
        {options.map((opt, i) => <OptionCard key={i} opt={opt} index={i} />)}
      </div>
      {data.assumptions.length > 0 && (
        <div className="hxw-assumptions">
          <div className="hxw-asm-hdr">Assumptions</div>
          <div className="hxw-asm-chips">
            {data.assumptions.map((a, i) => (
              <span key={i} className="hxw-chip hxw-chip--asm">⬡ {a}</span>
            ))}
          </div>
        </div>
      )}
      {data.recommendation && <RecoCallout text={data.recommendation} />}
    </div>
  );
}
