import React, { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Scenario, ScenarioVariant, HelixEntry, Strand, STRAND_META } from "./helix-types";

// ── Scenario Forge ──────────────────────────────────────────────────────────
export function ScenarioForge({ entry, scenario, loading, onClose }: {
  entry: HelixEntry;
  scenario: Scenario | null;
  loading: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) gsap.fromTo(containerRef.current, { opacity: 0, y: 14, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "power3.out" });
  }, []);

  const TYPE_COLOR: Record<string, string> = {
    optimistic:  "#4aff9e",
    pessimistic: "#ff6b6b",
    historical:  "#4a9eff",
    stress:      "#ff9e4a",
    black_swan:  "#9e4aff",
    competitive: "#ffe14a",
  };
  const meta = STRAND_META[entry.strand as Strand] ?? STRAND_META.evidence;
  const totalProb = scenario?.variants.reduce((s, v) => s + (v.probability || 0), 0) ?? 1;

  return (
    <aside className="helix-scenario-overlay" ref={containerRef}>
      <div className="helix-scenario-header">
        <div className="helix-scenario-title">
          <span className="helix-scenario-wordmark">SCENARIO FORGE</span>
          <span className="helix-card-strand-badge" style={{ background: `${meta.color}22`, color: meta.color, borderColor: meta.color }}>{meta.label}</span>
          {scenario && <span className="helix-scenario-name-badge">{scenario.name}</span>}
        </div>
        <button className="helix-scenario-close" onClick={onClose}>✕</button>
      </div>

      {loading ? (
        <div className="helix-scenario-loading">
          <span className="helix-spinner" />
          <span>Modeling scenarios…</span>
        </div>
      ) : scenario ? (
        <div className="helix-scenario-body">
          <div className="helix-scenario-source">{entry.query}</div>

          <div className="helix-scenario-base">
            <div className="helix-scenario-base-label">BASE STATE</div>
            {scenario.base.context && <p className="helix-scenario-base-context">{scenario.base.context}</p>}
            {scenario.base.current_state && <p className="helix-scenario-base-state">{scenario.base.current_state}</p>}
            {scenario.base.key_variables?.length > 0 && (
              <div className="helix-scenario-vars">
                {scenario.base.key_variables.map((v, i) => <span key={i} className="helix-scenario-var-chip">{v}</span>)}
              </div>
            )}
          </div>

          {scenario.divergence_point && (
            <div className="helix-scenario-divergence">
              <span className="helix-scenario-div-icon">⎇</span>
              <span className="helix-scenario-div-text">{scenario.divergence_point}</span>
            </div>
          )}

          <div className="helix-scenario-variants">
            {scenario.variants.map((v) => {
              const color = TYPE_COLOR[v.type] ?? "#4afff0";
              const pct = Math.round((v.probability / Math.max(totalProb, 0.001)) * 100);
              return (
                <div key={v.id} className={`helix-scenario-variant variant-type-${v.type}`} style={{ "--variant-color": color } as React.CSSProperties}>
                  <div className="helix-scenario-variant-head">
                    <span className="helix-scenario-variant-label" style={{ color }}>{v.label}</span>
                    <span className="helix-scenario-variant-prob">{pct}%</span>
                  </div>
                  {v.outcome?.text && <p className="helix-scenario-variant-outcome">{v.outcome.text}</p>}
                  {v.delta?.length > 0 && (
                    <div className="helix-scenario-variant-deltas">
                      {v.delta.map((d, j) => (
                        <span key={j} className="helix-scenario-variant-delta"><em>{d.variable}</em>: {d.change}</span>
                      ))}
                    </div>
                  )}
                  {v.outcome?.key_changes?.length > 0 && (
                    <div className="helix-scenario-variant-changes">
                      {v.outcome.key_changes.map((c, j) => <span key={j} className="helix-scenario-variant-change">→ {c}</span>)}
                    </div>
                  )}
                  <div className="helix-scenario-variant-bar">
                    <div className="helix-scenario-variant-bar-fill" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="helix-empty"><span>No scenario data available</span></div>
      )}
    </aside>
  );
}
