import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { Strand, HelixEntry, Contradiction } from "./helix-types";

interface Props {
  entries: HelixEntry[];
  contradictions: Contradiction[];
  onNodeClick: (entry: HelixEntry) => void;
  heatMap?: boolean;
}

const STRAND_COLOR: Record<Strand, string> = {
  evidence:     "#4a9eff",
  strategy:     "#4aff9e",
  construction: "#ff9e4a",
  memory:       "#9e4aff",
  signal:       "#ffe14a",
  synthesis:    "#4afff0",
};

const SEVERITY_COLOR: Record<"low" | "medium" | "high", string> = {
  high:   "#ff4a4a",
  medium: "#ff9e4a",
  low:    "#ffe14a",
};

// GraphNode includes d3's runtime x/y so TypeScript sees them in nodeCanvasObject
interface GraphNode {
  id: string;
  name: string;
  strand: Strand;
  confidence: number;
  contradicted: boolean;
  __entry: HelixEntry;
  // d3-force populates these at runtime
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  severity?: "low" | "medium" | "high";
  linkType: "contradiction" | "proximity";
}

export function EvidenceLatticeGraph({ entries, contradictions, onNodeClick, heatMap = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const [height, setHeight] = useState(500);
  const [localHeatMap, setLocalHeatMap] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeHeatMap = heatMap || localHeatMap;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(obs => {
      const rect = obs[0].contentRect;
      setWidth(Math.floor(rect.width));
      setHeight(Math.floor(rect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = entries.map(e => ({
      id: e.id,
      name: e.query.slice(0, 60),
      strand: e.strand,
      confidence: e.confidence,
      contradicted: e.contradicted > 0,
      __entry: e,
    }));

    const entryIds = new Set(entries.map(e => e.id));
    const links: GraphLink[] = contradictions
      .filter(c => entryIds.has(c.entry_a_id) && entryIds.has(c.entry_b_id))
      .map(c => ({
        source: c.entry_a_id,
        target: c.entry_b_id,
        severity: c.severity,
        linkType: "contradiction" as const,
      }));

    // Proximity links between adjacent same-strand nodes (avoid clutter)
    const taken = new Set(links.map(l => `${l.source}:${l.target}`));
    const byStrand: Partial<Record<Strand, string[]>> = {};
    for (const e of entries) {
      if (!byStrand[e.strand]) byStrand[e.strand] = [];
      byStrand[e.strand]!.push(e.id);
    }
    for (const ids of Object.values(byStrand)) {
      if (!ids || ids.length < 2) continue;
      for (let i = 0; i < Math.min(ids.length - 1, 6); i++) {
        const key = `${ids[i]}:${ids[i + 1]}`;
        const rev = `${ids[i + 1]}:${ids[i]}`;
        if (!taken.has(key) && !taken.has(rev)) {
          links.push({ source: ids[i], target: ids[i + 1], linkType: "proximity" });
          taken.add(key);
        }
      }
    }

    return { nodes, links };
  }, [entries, contradictions]);

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const nx = node.x ?? 0;
      const ny = node.y ?? 0;
      const r = 4 + node.confidence * 8;
      const color = STRAND_COLOR[node.strand];
      const isHovered = hoveredId === node.id;
      const opacity = activeHeatMap ? 0.3 + node.confidence * 0.7 : isHovered ? 1 : 0.85;

      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity;
      ctx.fill();

      if (node.contradicted) {
        ctx.beginPath();
        ctx.arc(nx, ny, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = "#ff4a4a";
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(nx, ny, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 12;
        ctx.shadowColor = color;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.globalAlpha = 1;

      if (globalScale > 1.4 || isHovered) {
        const label = node.name.length > 28 ? node.name.slice(0, 28) + "…" : node.name;
        const fontSize = Math.max(9, 11 / globalScale);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.globalAlpha = isHovered ? 1 : 0.6;
        ctx.fillText(label, nx + r + 3, ny + 3);
        ctx.globalAlpha = 1;
      }
    },
    [hoveredId, activeHeatMap]
  );

  const linkColor = useCallback(
    (link: GraphLink) =>
      link.linkType === "contradiction"
        ? SEVERITY_COLOR[link.severity ?? "low"]
        : "rgba(255,255,255,0.06)",
    []
  );

  const linkWidth = useCallback(
    (link: GraphLink) =>
      link.linkType === "contradiction" ? (link.severity === "high" ? 2 : 1.5) : 0.5,
    []
  );

  const contradictionCount = graphData.links.filter(l => l.linkType === "contradiction").length;

  if (entries.length === 0) {
    return (
      <div className="helix-lattice-empty">
        <span className="helix-lattice-empty-icon" aria-hidden>⬡</span>
        <span>No entries yet — run an inquiry to populate the graph</span>
      </div>
    );
  }

  return (
    <div className="helix-lattice-root" ref={containerRef}>
      <div className="helix-lattice-controls">
        <button
          className={`helix-lattice-btn${activeHeatMap ? " active" : ""}`}
          onClick={() => setLocalHeatMap(x => !x)}
          title="Toggle confidence heat map"
        >
          ◉ Heat
        </button>
        <span className="helix-lattice-stat">
          {graphData.nodes.length}N · {contradictionCount}⚡
        </span>
      </div>
      <ForceGraph2D<GraphNode, GraphLink>
        graphData={graphData}
        width={width}
        height={height - 32}
        backgroundColor="transparent"
        nodeId="id"
        nodeLabel="name"
        nodeCanvasObject={nodeCanvasObject}
        nodeCanvasObjectMode={() => "replace"}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalArrowLength={0}
        cooldownTime={3000}
        onNodeClick={(node, _e) => onNodeClick(node.__entry)}
        onNodeHover={(node) => setHoveredId(node ? node.id : null)}
        enableNodeDrag
        enableZoomInteraction
      />
    </div>
  );
}
