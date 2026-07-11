import React, { useEffect, useRef, useState } from "react";
import { HelixEntity, EntityRelation } from "./helix-types";

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "#ff6bb5", org: "#ff9e4a", concept: "#4a9eff", event: "#ff6b6b", tech: "#4aff9e",
};

export function RelationGraphPanel({ entities, relations, extracting, onExtract, entryCount }: {
  entities: HelixEntity[];
  relations: EntityRelation[];
  extracting: boolean;
  onExtract: () => void;
  entryCount: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<HelixEntity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const animRef = useRef<number | null>(null);

  // Seed positions + run force simulation; re-runs whenever entity/relation data changes
  useEffect(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    if (entities.length === 0) { setNodes([]); return; }
    const W = 420, H = 320, cx = W / 2, cy = H / 2;
    let localNodes: HelixEntity[] = entities.map((e, i) => {
      const angle = (i / entities.length) * Math.PI * 2;
      const r = 80 + Math.min(e.mention_count * 8, 80);
      return { ...e, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0 };
    });
    let frame = 0;
    let cancelled = false;

    function tick() {
      if (cancelled || frame++ >= 200) { animRef.current = null; return; }
      localNodes = localNodes.map(n => ({ ...n, vx: n.vx ?? 0, vy: n.vy ?? 0 }));
      // Repulsion
      for (let i = 0; i < localNodes.length; i++) {
        for (let j = i + 1; j < localNodes.length; j++) {
          const dx = (localNodes[j].x ?? cx) - (localNodes[i].x ?? cx);
          const dy = (localNodes[j].y ?? cy) - (localNodes[i].y ?? cy);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = 1200 / (dist * dist);
          localNodes[i] = { ...localNodes[i], vx: (localNodes[i].vx ?? 0) - f * dx / dist, vy: (localNodes[i].vy ?? 0) - f * dy / dist };
          localNodes[j] = { ...localNodes[j], vx: (localNodes[j].vx ?? 0) + f * dx / dist, vy: (localNodes[j].vy ?? 0) + f * dy / dist };
        }
      }
      // Attraction for relations
      for (const rel of relations) {
        const ai = localNodes.findIndex(n => n.id === rel.entity_a_id);
        const bi = localNodes.findIndex(n => n.id === rel.entity_b_id);
        if (ai < 0 || bi < 0) continue;
        const dx = (localNodes[bi].x ?? cx) - (localNodes[ai].x ?? cx);
        const dy = (localNodes[bi].y ?? cy) - (localNodes[ai].y ?? cy);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const strength = 0.05 * rel.weight;
        localNodes[ai] = { ...localNodes[ai], vx: (localNodes[ai].vx ?? 0) + strength * dx, vy: (localNodes[ai].vy ?? 0) + strength * dy };
        localNodes[bi] = { ...localNodes[bi], vx: (localNodes[bi].vx ?? 0) - strength * dx, vy: (localNodes[bi].vy ?? 0) - strength * dy };
      }
      // Center gravity + integrate + damp
      localNodes = localNodes.map(n => {
        const vx = ((n.vx ?? 0) + 0.01 * (cx - (n.x ?? cx))) * 0.8;
        const vy = ((n.vy ?? 0) + 0.01 * (cy - (n.y ?? cy))) * 0.8;
        const x = Math.max(18, Math.min(W - 18, (n.x ?? cx) + vx));
        const y = Math.max(18, Math.min(H - 18, (n.y ?? cy) + vy));
        return { ...n, x, y, vx, vy };
      });
      if (!cancelled) setNodes([...localNodes]);
      if (!cancelled) animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => { cancelled = true; if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; } };
  }, [entities, relations]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = selectedId ? nodes.find(n => n.id === selectedId) : null;
  const selectedRelations = selectedId ? relations.filter(r => r.entity_a_id === selectedId || r.entity_b_id === selectedId) : [];

  if (entities.length === 0) {
    return (
      <div className="rg-empty">
        <div className="rg-empty-icon">◉</div>
        <div className="rg-empty-text">No entity graph yet</div>
        <div className="rg-empty-sub">{entryCount > 0 ? `${entryCount} entries ready to analyze` : "Add entries first"}</div>
        {entryCount > 0 && (
          <button className="rg-extract-btn" onClick={onExtract} disabled={extracting}>
            {extracting ? <><span className="helix-spinner-xs" /> Extracting…</> : "Extract Entity Graph"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rg-panel">
      <div className="rg-header">
        <span className="rg-title">◉ Relation Graph</span>
        <div className="rg-header-right">
          <span className="rg-stats">{entities.length} entities · {relations.length} edges</span>
          <button className="rg-refresh-btn" onClick={onExtract} disabled={extracting} title="Re-extract">
            {extracting ? <span className="helix-spinner-xs" /> : "↺"}
          </button>
        </div>
      </div>

      <svg ref={svgRef} className="rg-svg" viewBox="0 0 420 320" width="100%" height="320">
        {/* Edges */}
        {relations.map(rel => {
          const a = nodes.find(n => n.id === rel.entity_a_id);
          const b = nodes.find(n => n.id === rel.entity_b_id);
          if (!a || !b) return null;
          const isHighlighted = selectedId && (rel.entity_a_id === selectedId || rel.entity_b_id === selectedId);
          return (
            <line key={rel.id}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={isHighlighted ? "#ffe14a" : "#ffffff18"}
              strokeWidth={isHighlighted ? 1.5 : 0.8}
              strokeDasharray={rel.relationship_type === "contradicts" ? "4 3" : undefined}
            />
          );
        })}
        {/* Nodes */}
        {nodes.map(node => {
          const color = ENTITY_TYPE_COLORS[node.entity_type] ?? "#4a9eff";
          const r = 6 + Math.min(node.mention_count * 1.5, 10);
          const isSelected = selectedId === node.id;
          return (
            <g key={node.id} transform={`translate(${node.x ?? 0},${node.y ?? 0})`} style={{ cursor: "pointer" }}
              onClick={() => setSelectedId(isSelected ? null : node.id)}>
              <circle r={r} fill={color} fillOpacity={isSelected ? 1 : 0.7} stroke={isSelected ? "#fff" : color} strokeWidth={isSelected ? 2 : 0.5} />
              <text x={0} y={r + 9} textAnchor="middle" fontSize="8" fill="#ffffffaa" style={{ pointerEvents: "none" }}>
                {node.canonical_name.slice(0, 14)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="rg-legend">
        {Object.entries(ENTITY_TYPE_COLORS).map(([type, color]) => (
          <span key={type} className="rg-legend-item">
            <span className="rg-legend-dot" style={{ background: color }} />
            {type}
          </span>
        ))}
      </div>

      {/* Selected node detail */}
      {selectedNode && (
        <div className="rg-detail">
          <div className="rg-detail-name" style={{ color: ENTITY_TYPE_COLORS[selectedNode.entity_type] ?? "#4a9eff" }}>
            {selectedNode.canonical_name}
          </div>
          <div className="rg-detail-type">{selectedNode.entity_type} · mentioned {selectedNode.mention_count}×</div>
          {selectedNode.aliases?.length > 0 && (
            <div className="rg-detail-aliases">Also: {selectedNode.aliases.slice(0, 3).join(", ")}</div>
          )}
          <div className="rg-detail-relations">
            {selectedRelations.slice(0, 4).map(r => {
              const other = nodes.find(n => n.id === (r.entity_a_id === selectedId ? r.entity_b_id : r.entity_a_id));
              return other ? (
                <div key={r.id} className="rg-detail-rel">
                  <span className="rg-detail-rel-type">{r.relationship_type}</span>
                  <span className="rg-detail-rel-name">{other.canonical_name}</span>
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
