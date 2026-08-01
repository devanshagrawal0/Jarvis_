// Holographic 3D Knowledge Graph (Feature #1). A real WebGL force-directed graph of
// the project's knowledge: Sources → Claims → Analyses → Decisions → Artifacts, layered
// in depth so it reads as a 3D "knowledge tree." Binds to live /api/helix/graph when the
// project has extracted entities; otherwise renders the lineage schema (honestly labelled).
// Stack: @react-three/fiber + drei + @react-three/postprocessing Bloom + d3-force-3d.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line, Html, Billboard } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceZ } from "d3-force-3d";
import * as THREE from "three";
import { useDrawer } from "../Drawer";
import { useUI } from "../HxUI";
import { useSelection } from "../HxInspector";

const TYPE_META: Record<string, { color: string; z: number; label: string }> = {
  source:   { color: "#3f8cff", z: 260,  label: "Source" },
  claim:    { color: "#34cfe0", z: 130,  label: "Claim" },
  analysis: { color: "#33d69a", z: 0,    label: "Analysis" },
  decision: { color: "#f2b03d", z: -130, label: "Decision" },
  artifact: { color: "#9b6cff", z: -260, label: "Artifact" },
  entity:   { color: "#33c2d1", z: 0,    label: "Entity" },
};
const EDGE_COLOR: Record<string, string> = { Supports: "#33d69a", Derived: "#3f8cff", Uses: "#8aa2c8", Refutes: "#f0686d", rel: "#33c2d1" };

// Representative knowledge schema — used when the project has no extracted entities yet.
const SCHEMA_NODES: { id: string; label: string; type: string }[] = [
  { id: "s1", label: "Deribit Fees Doc", type: "source" }, { id: "s2", label: "SEC Reg NMS", type: "source" },
  { id: "s3", label: "Kaiko Market Data", type: "source" }, { id: "s4", label: "Kalshi Rulebook", type: "source" },
  { id: "s5", label: "CME Microstructure", type: "source" },
  { id: "c1", label: "Fees 0.02% maker", type: "claim" }, { id: "c2", label: "Latency < 200ms", type: "claim" },
  { id: "c3", label: "Arb profitable net", type: "claim" }, { id: "c4", label: "Liquidity sufficient", type: "claim" },
  { id: "a1", label: "Fee-edge model", type: "analysis" }, { id: "a2", label: "Latency sensitivity", type: "analysis" },
  { id: "a3", label: "Capacity model", type: "analysis" },
  { id: "d1", label: "Proceed to pilot", type: "decision" }, { id: "d2", label: "Cap position size", type: "decision" },
  { id: "ar1", label: "Arbitrage Brief", type: "artifact" }, { id: "ar2", label: "Risk Memo", type: "artifact" },
  { id: "ar3", label: "Backtest Dataset", type: "artifact" },
];
const SCHEMA_LINKS: { source: string; target: string; type: string }[] = [
  { source: "s1", target: "c1", type: "Supports" }, { source: "s2", target: "c3", type: "Supports" },
  { source: "s3", target: "c2", type: "Supports" }, { source: "s4", target: "c4", type: "Supports" },
  { source: "s5", target: "c2", type: "Supports" }, { source: "s3", target: "c4", type: "Supports" },
  { source: "c1", target: "a1", type: "Derived" }, { source: "c2", target: "a2", type: "Derived" },
  { source: "c3", target: "a1", type: "Refutes" }, { source: "c4", target: "a3", type: "Derived" },
  { source: "a1", target: "d1", type: "Derived" }, { source: "a2", target: "d1", type: "Uses" },
  { source: "a3", target: "d2", type: "Derived" }, { source: "d1", target: "ar1", type: "Derived" },
  { source: "d1", target: "ar2", type: "Uses" }, { source: "d2", target: "ar2", type: "Derived" },
  { source: "a1", target: "ar3", type: "Uses" },
];

interface SimNode { id: string; label: string; type: string; x: number; y: number; z: number; deg: number; }
interface SimLink { source: any; target: any; type: string; }

function normalizeType(t?: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("source") || s.includes("doc")) return "source";
  if (s.includes("claim") || s.includes("evidence")) return "claim";
  if (s.includes("analys")) return "analysis";
  if (s.includes("decis")) return "decision";
  if (s.includes("artifact") || s.includes("brief") || s.includes("report")) return "artifact";
  return "entity";
}

// Node sphere with hover lift + click. Emissive so Bloom makes it glow.
function Node({ n, onHover, onSelect, dim }: { n: SimNode; onHover: (id: string | null) => void; onSelect: (n: SimNode) => void; dim: boolean }) {
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[n.type] || TYPE_META.entity;
  const r = 4 + Math.min(8, n.deg * 1.5) + (hovered ? 2.5 : 0);
  return (
    <mesh position={[n.x, n.y, n.z]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); onHover(n.id); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); onHover(null); document.body.style.cursor = "auto"; }}
      onClick={(e) => { e.stopPropagation(); onSelect(n); }}>
      <sphereGeometry args={[r, 24, 24]} />
      <meshStandardMaterial color={meta.color} emissive={meta.color}
        emissiveIntensity={hovered ? 2.6 : 1.5} toneMapped={false} transparent opacity={dim && !hovered ? 0.25 : 1} />
      {hovered && (
        <Billboard>
          <Html center distanceFactor={520} style={{ pointerEvents: "none" }}>
            <div style={{ background: "rgba(6,12,20,0.9)", border: `1px solid ${meta.color}`, color: "#eaf6ff",
              padding: "4px 9px", borderRadius: 7, fontSize: 12, whiteSpace: "nowrap", fontFamily: "var(--v-font, Inter)",
              boxShadow: `0 0 18px ${meta.color}55`, transform: "translateY(-26px)" }}>
              <b style={{ color: meta.color, textTransform: "uppercase", fontSize: 9, letterSpacing: "0.08em", marginRight: 6 }}>{meta.label}</b>{n.label}
            </div>
          </Html>
        </Billboard>
      )}
    </mesh>
  );
}

function Scene({ nodes, links, autoRotate, activeType, onHover, onSelect }: {
  nodes: SimNode[]; links: SimLink[]; autoRotate: boolean; activeType: string | null;
  onHover: (id: string | null) => void; onSelect: (n: SimNode) => void;
}) {
  const byId = useMemo(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);
  return (
    <>
      <color attach="background" args={["#05070e"]} />
      <fogExp2 attach="fog" args={["#05070e", 0.0011]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[200, 200, 300]} intensity={1.2} color="#8fd8ff" />
      <pointLight position={[-260, -160, -200]} intensity={0.8} color="#9b6cff" />
      <Starfield />
      {links.map((l, i) => {
        const a = byId[typeof l.source === "object" ? l.source.id : l.source];
        const b = byId[typeof l.target === "object" ? l.target.id : l.target];
        if (!a || !b) return null;
        const on = !activeType || a.type === activeType || b.type === activeType;
        return <Line key={i} points={[[a.x, a.y, a.z], [b.x, b.y, b.z]]}
          color={EDGE_COLOR[l.type] || EDGE_COLOR.rel} lineWidth={1} transparent opacity={on ? 0.34 : 0.06} />;
      })}
      {nodes.map(n => <Node key={n.id} n={n} onHover={onHover} onSelect={onSelect}
        dim={!!activeType && n.type !== activeType} />)}
      <OrbitControls enableDamping dampingFactor={0.08} autoRotate={autoRotate} autoRotateSpeed={0.55}
        minDistance={140} maxDistance={1600} />
      <EffectComposer>
        <Bloom intensity={1.3} luminanceThreshold={0.12} luminanceSmoothing={0.9} mipmapBlur radius={0.8} />
        <Vignette eskil={false} offset={0.15} darkness={0.85} />
      </EffectComposer>
    </>
  );
}

function Starfield() {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const N = 1400, arr = new Float32Array(N * 3);
    // deterministic pseudo-random so it's stable across renders (no Math.random reliance for layout)
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) { arr[i * 3] = (rnd() - 0.5) * 2400; arr[i * 3 + 1] = (rnd() - 0.5) * 2400; arr[i * 3 + 2] = (rnd() - 0.5) * 2400; }
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  return (
    <points geometry={geo}>
      <pointsMaterial size={1.6} color="#2a6b7a" transparent opacity={0.5} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

export function KnowledgeGraph3D({ projectId }: { projectId?: string }) {
  const { open } = useDrawer();
  const { toast } = useUI();
  const { select: inspSelect } = useSelection();
  const [raw, setRaw] = useState<{ nodes: { id: string; label: string; type: string }[]; links: { source: string; target: string; type: string }[] } | null>(null);
  const [live, setLive] = useState(false);
  const [layered, setLayered] = useState(true);
  // W9 #24: reduced-motion → no autonomous rotation (vestibular safety); user can still orbit.
  const [autoRotate, setAutoRotate] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [, setHoveredId] = useState<string | null>(null);
  // W9 #24: pause the WebGL render loop when the tab/pane is hidden (don't burn GPU offscreen).
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const useSchema = () => { if (!cancelled) { setRaw({ nodes: SCHEMA_NODES, links: SCHEMA_LINKS }); setLive(false); } };
    if (!projectId) { useSchema(); return; }
    fetch(`/api/helix/graph?projectId=${projectId}`).then(r => r.json()).then(d => {
      const ents = d?.entities || [], rels = d?.relations || [];
      if (!ents.length) { useSchema(); return; }
      const nodes = ents.map((e: any) => ({ id: String(e.id), label: e.name || e.label || e.title || "Entity", type: normalizeType(e.type || e.entity_type || e.kind) }));
      const ids = new Set(nodes.map((n: any) => n.id));
      const links = rels.map((r: any) => ({
        source: String(r.source_id ?? r.source ?? r.a ?? r.from ?? r.src),
        target: String(r.target_id ?? r.target ?? r.b ?? r.to ?? r.dst),
        type: r.type || r.relation || "rel",
      })).filter((l: any) => ids.has(l.source) && ids.has(l.target));
      if (!cancelled) { setRaw({ nodes, links }); setLive(true); }
    }).catch(useSchema);
    return () => { cancelled = true; };
  }, [projectId]);

  // Run a 3D force layout to stable positions (static — OrbitControls provides the motion).
  const { nodes, links } = useMemo(() => {
    if (!raw) return { nodes: [] as SimNode[], links: [] as SimLink[] };
    const nodes: SimNode[] = raw.nodes.map(n => ({ ...n, x: 0, y: 0, z: 0, deg: 0 }));
    const links: SimLink[] = raw.links.map(l => ({ ...l }));
    const deg: Record<string, number> = {};
    links.forEach(l => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
    nodes.forEach(n => { n.deg = deg[n.id] || 0; });
    const sim = forceSimulation(nodes as any, 3)
      .force("charge", forceManyBody().strength(-160))
      .force("link", forceLink(links as any).id((d: any) => d.id).distance(70).strength(0.7))
      .force("center", forceCenter(0, 0, 0))
      .force("z", forceZ((d: any) => layered ? (TYPE_META[d.type]?.z ?? 0) : 0).strength(layered ? 0.6 : 0))
      .stop();
    for (let i = 0; i < 260; i++) sim.tick();
    return { nodes, links };
  }, [raw, layered]);

  const present = useMemo(() => [...new Set(nodes.map(n => n.type))].filter(t => TYPE_META[t]), [nodes]);

  // Self-heal the WebGL drawing-buffer size: if the canvas mounted before its
  // container had layout, r3f's ResizeObserver can latch a 0/default size. A few
  // resize pulses after mount force it to re-measure and fill the container.
  useEffect(() => {
    if (!nodes.length) return;
    const fire = () => window.dispatchEvent(new Event("resize"));
    const raf = requestAnimationFrame(fire);
    const t1 = setTimeout(fire, 150);
    const t2 = setTimeout(fire, 500);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [nodes.length]);

  const select = (n: SimNode) => {
    const meta = TYPE_META[n.type] || TYPE_META.entity;
    toast(`${meta.label}: ${n.label}`);
    const nid = (l: any, side: "source" | "target") => typeof l[side] === "object" ? l[side].id : l[side];
    const neighbors = links.filter(l => nid(l, "source") === n.id || nid(l, "target") === n.id)
      .map(l => { const oid = nid(l, "source") === n.id ? nid(l, "target") : nid(l, "source"); const on2 = nodes.find(x => x.id === oid); return on2 ? { node: on2, via: l.type } : null; })
      .filter(Boolean).slice(0, 8) as { node: SimNode; via: string }[];
    inspSelect({
      id: "kg-" + n.id, kind: n.type, title: n.label,
      subtitle: `${meta.label} · ${n.deg} connection${n.deg === 1 ? "" : "s"}`,
      confidence: Math.min(0.95, 0.5 + n.deg * 0.08),
      meta: [["Type", meta.label], ["Connections", String(n.deg)], ["Layer depth", String(meta.z)]],
      backlinks: neighbors.map(({ node, via }) => ({ kind: node.type, title: node.label, via, onClick: () => select(node) })),
    });
    const nb = links.filter(l => (typeof l.source === "object" ? l.source.id : l.source) === n.id || (typeof l.target === "object" ? l.target.id : l.target) === n.id);
    open({
      type: `Knowledge node · ${meta.label}`,
      title: n.label,
      support: { label: `${n.deg} connection${n.deg === 1 ? "" : "s"}`, tone: n.type === "decision" ? "con" : "sup" },
      confidence: { label: meta.label, inputs: [["Type", meta.label], ["Connections", String(n.deg)], ["Layer depth", String(meta.z)]] },
      lineage: ["Part of the project knowledge graph", `${n.deg} direct relationship(s)`, live ? "Extracted from live project entities" : "Lineage schema (run entity extraction for live nodes)"],
      audit: [["Node id", n.id], ["Type", meta.label], ["Degree", String(n.deg)]],
    });
  };

  return (
    <div className="hxv-kg">
      <div className="hxv-kg-canvas">
        {nodes.length > 0 && (
          <Canvas camera={{ position: [0, 40, 620], fov: 55, far: 5000 }} gl={{ antialias: true, alpha: false }} dpr={[1, 1.75]} frameloop={visible ? "always" : "never"}>
            <Scene nodes={nodes} links={links} autoRotate={autoRotate && visible} activeType={activeType} onHover={setHoveredId} onSelect={select} />
          </Canvas>
        )}
      </div>

      {/* Glass HUD overlay — controls + legend + stats */}
      <div className="hxv-kg-hud tl">
        <div className="hxv-kg-title">Knowledge Graph {live ? <span className="hxv-kg-badge live">LIVE</span> : <span className="hxv-kg-badge">SCHEMA</span>}</div>
        <div className="hxv-kg-sub">{nodes.length} nodes · {links.length} relationships · click a node to inspect</div>
      </div>

      <div className="hxv-kg-hud tr">
        <button className={"hxv-kg-btn" + (layered ? " on" : "")} onClick={() => setLayered(v => !v)} title="Toggle layered tree vs free cloud">{layered ? "◱ Layered tree" : "✳ Free cloud"}</button>
        <button className={"hxv-kg-btn" + (autoRotate ? " on" : "")} onClick={() => setAutoRotate(v => !v)} title="Auto-rotate">{autoRotate ? "⟳ Rotating" : "⤾ Paused"}</button>
      </div>

      <div className="hxv-kg-hud bl">
        <div className="hxv-kg-legend">
          {present.map(t => (
            <button key={t} className={"hxv-kg-leg" + (activeType === t ? " on" : "")} onClick={() => setActiveType(a => a === t ? null : t)}>
              <span className="hxv-kg-dot" style={{ background: TYPE_META[t].color, boxShadow: `0 0 8px ${TYPE_META[t].color}` }} />
              {TYPE_META[t].label}<span className="hxv-kg-legn">{nodes.filter(n => n.type === t).length}</span>
            </button>
          ))}
          {activeType && <button className="hxv-kg-leg clear" onClick={() => setActiveType(null)}>Clear filter</button>}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeGraph3D;
