// src/rooms/helix/widgets/DesignTabRenderer.tsx
// Wave 2-B-1: Design tab — DiagramCanvas (Canvas 2D, no external lib), ComponentList.
// R6: No data fetching. Pure display component.

import React, { useRef, useEffect, useCallback } from "react";
import type { DesignTabData, DiagramNode, DiagramEdge } from "./types";
import { setupHiDPICanvas } from "./canvasUtils";

const CANVAS_W = 480;
const CANVAS_H = 300;
const NODE_R   = 28;
const NODE_GAP = 12;

function autoLayout(nodes: DiagramNode[]): DiagramNode[] {
  if (!nodes.length) return [];
  // If nodes have x/y coords use them; otherwise do a grid layout
  const hasCoords = nodes.some(n => n.x !== undefined && n.y !== undefined);
  if (hasCoords) return nodes;
  const cols = Math.ceil(Math.sqrt(nodes.length));
  const cellW = (CANVAS_W - NODE_GAP * 2) / cols;
  const cellH = (CANVAS_H - NODE_GAP * 2) / Math.ceil(nodes.length / cols);
  return nodes.map((n, i) => ({
    ...n,
    x: NODE_GAP + (i % cols) * cellW + cellW / 2,
    y: NODE_GAP + Math.floor(i / cols) * cellH + cellH / 2,
  }));
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function DiagramCanvas({ nodes: rawNodes, edges }: { nodes: DiagramNode[]; edges: DiagramEdge[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setupHiDPICanvas(canvas, CANVAS_W, CANVAS_H);
    const nodes = autoLayout(rawNodes);
    const nodeMap: Record<string, DiagramNode> = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    // Background
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Edges
    ctx.strokeStyle = "rgba(74,158,255,0.35)";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([4, 3]);
    (edges || []).forEach(e => {
      const a = nodeMap[e.from], b = nodeMap[e.to];
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x!, a.y!);
      ctx.lineTo(b.x!, b.y!);
      ctx.stroke();
      // Arrow tip
      const angle = Math.atan2(b.y! - a.y!, b.x! - a.x!);
      const tipX = b.x! - Math.cos(angle) * NODE_R;
      const tipY = b.y! - Math.sin(angle) * NODE_R;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - 8 * Math.cos(angle - 0.4), tipY - 8 * Math.sin(angle - 0.4));
      ctx.lineTo(tipX - 8 * Math.cos(angle + 0.4), tipY - 8 * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = "rgba(74,158,255,0.5)";
      ctx.fill();
      ctx.setLineDash([4, 3]);

      // Edge label
      if (e.label) {
        ctx.fillStyle = "rgba(140,175,220,0.7)";
        ctx.font      = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(truncate(e.label, 12), (a.x! + b.x!) / 2, (a.y! + b.y!) / 2 - 4);
      }
    });
    ctx.setLineDash([]);

    // Nodes
    nodes.forEach(n => {
      const x = n.x!, y = n.y!;
      // Node circle
      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20,35,55,0.9)";
      ctx.fill();
      ctx.strokeStyle = "rgba(74,158,255,0.6)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Label (truncated, wrapped to 2 lines max)
      const label = truncate(n.label || n.id, 20);
      ctx.fillStyle = "rgba(200,225,255,0.9)";
      ctx.font      = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (label.length > 10) {
        const mid = Math.ceil(label.length / 2);
        ctx.fillText(label.slice(0, mid), x, y - 5);
        ctx.fillText(label.slice(mid),    x, y + 7);
      } else {
        ctx.fillText(label, x, y);
      }
    });
  }, [rawNodes, edges]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={ref} className="hxw-diagram-canvas" />;
}

interface Props { data: DesignTabData | null }

export function DesignTabRenderer({ data }: Props) {
  if (!data) return <div className="hxw-empty">No design data available.</div>;

  const hasNodes = data.nodes && data.nodes.length > 0;

  return (
    <div className="hxw-design-tab">
      {data.diagramType && (
        <span className="hxw-diagram-type-badge">{data.diagramType}</span>
      )}
      {hasNodes && (
        <DiagramCanvas nodes={data.nodes!} edges={data.edges || []} />
      )}
      {data.summary && <p className="hxw-design-summary">{data.summary}</p>}
      {data.components.length > 0 && (
        <div className="hxw-component-list">
          <div className="hxw-cl-hdr">Components</div>
          {data.components.map((c, i) => (
            <div key={i} className="hxw-cl-item">
              <span className="hxw-cl-dot" />
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}
      {data.dependencies.length > 0 && (
        <div className="hxw-dep-notes">
          <div className="hxw-dn-hdr">Dependencies</div>
          {data.dependencies.map((d, i) => (
            <div key={i} className="hxw-dn-item">→ {d}</div>
          ))}
        </div>
      )}
    </div>
  );
}
