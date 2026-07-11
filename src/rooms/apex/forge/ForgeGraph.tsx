/* THE FORGE — THE LIVING BLUEPRINT (command-center canvas).
   The strategy IS a node graph: Universe → Signals → Logic → Entry →
   Execution / Exit / Sizing / Risk, wired with data-flow edges. Nodes are
   colour-coded by category (mockup language) and every node maps to a REAL
   part of the spec — nothing decorative. On Run the entry path lights hot.

   Self-rendered (SVG + foreignObject) with pan/zoom, a tool rail and a
   minimap, so it mounts reliably inside the animating room and we fully
   control the look. Keyboard + screen-reader operable. */

import { useEffect, useMemo, useRef, useState } from "react";
import { isLogic, summarizeEntry, type BotSpec, type EntryNode, type SignalCond } from "./forge-spec";
import type { BacktestResult } from "./forge-engine";
import { Icon } from "./ForgeIcons";

type FgKind = "universe" | "signal" | "gate" | "entry" | "exit" | "sizing" | "risk" | "exec";
interface GNode { id: string; kind: FgKind; kicker: string; title: string; sub?: string; section: string; x: number; y: number }
interface GEdge { id: string; from: string; to: string; label?: string; hot?: boolean }

const NW = 178, NH = 66; // node card size (graph units)
const CMP_LABEL: Record<string, string> = { cross_up: "crosses ↑", cross_dn: "crosses ↓", gt: ">", lt: "<", gte: "≥", lte: "≤", true: "is true", false: "is false" };
const KIND_ICON: Record<FgKind, string> = { universe: "layers", signal: "signal", gate: "funnel", entry: "trend", exit: "alert", sizing: "fx", risk: "shield", exec: "pulse" };

function specToGraph(spec: BotSpec): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const COLX = { universe: 0, signal: 258, gate: 536, entry: 814, out: 1092 };
  const V = 100;
  const sig = spec.signals || [];
  const sigMidY = ((sig.length - 1) * V) / 2;

  nodes.push({ id: "universe", kind: "universe", kicker: "UNIVERSE", title: spec.universe.symbols.join(" · ") || "—", sub: `${spec.universe.assetClass} · ${spec.universe.bar}`, section: "universe", x: COLX.universe, y: sigMidY });

  sig.forEach((s, i) => {
    const params = Object.entries(s.params).map(([k, v]) => `${k}:${v}`).join(" ");
    nodes.push({ id: `sig_${s.id}`, kind: "signal", kicker: s.type.toUpperCase(), title: s.id, sub: params || undefined, section: "signals", x: COLX.signal, y: i * V });
    edges.push({ id: `u-${s.id}`, from: "universe", to: `sig_${s.id}` });
  });

  let gateSeq = 0;
  let gateRow = 0;
  const leaf = (c: SignalCond, parentId: string) => {
    const lbl = c.vsSignal ? `${CMP_LABEL[c.cmp]} ${c.vsSignal}` : `${CMP_LABEL[c.cmp]} ${c.value ?? ""}`;
    edges.push({ id: `c-${c.signal}-${parentId}-${gateSeq}-${edges.length}`, from: `sig_${c.signal}`, to: parentId, label: lbl.trim() });
    if (c.vsSignal) edges.push({ id: `cv-${c.vsSignal}-${parentId}-${gateSeq}-${edges.length}`, from: `sig_${c.vsSignal}`, to: parentId });
  };
  const walk = (node: EntryNode, parentId: string) => {
    if (isLogic(node)) node.operands.forEach((o) => {
      if (isLogic(o)) {
        const gid = `gate_${gateSeq++}`;
        nodes.push({ id: gid, kind: "gate", kicker: "LOGIC", title: o.op, section: "entry", x: COLX.gate, y: gateRow++ * V });
        edges.push({ id: `${gid}-${parentId}`, from: gid, to: parentId });
        walk(o, gid);
      } else leaf(o, parentId);
    });
    else leaf(node as SignalCond, parentId);
  };
  const rootOp = isLogic(spec.entry) ? spec.entry.op : "IF";
  nodes.push({ id: "entry", kind: "entry", kicker: `ENTER · ${rootOp}`, title: "Entry Logic", sub: summarizeEntry(spec.entry, spec.signals).slice(0, 46), section: "entry", x: COLX.entry, y: sigMidY });
  walk(spec.entry, "entry");

  const exitBits: string[] = [];
  if (spec.exit.stopLossPct) exitBits.push(`SL ${spec.exit.stopLossPct}%`);
  if (spec.exit.takeProfitPct) exitBits.push(`TP ${spec.exit.takeProfitPct}%`);
  if (spec.exit.trailingPct) exitBits.push(`trail ${spec.exit.trailingPct}%`);
  if (spec.exit.atrStopMult) exitBits.push(`ATR×${spec.exit.atrStopMult}`);
  if (spec.exit.timeBars) exitBits.push(`${spec.exit.timeBars} bars`);
  // Every out-node maps to a REAL spec field or a real modelled behaviour of the
  // backtest engine (Execution models next-bar-open fills, slippage & commission).
  const outs: Array<{ id: string; kind: FgKind; kicker: string; title: string; sub: string; section: string }> = [
    { id: "exit", kind: "exit", kicker: "EXIT", title: "Exit Rules", sub: exitBits.join(" · ") || "—", section: "exit" },
    { id: "exec", kind: "exec", kicker: "EXECUTION", title: "Fills", sub: "next-bar open · slippage · commission", section: "exit" },
    { id: "sizing", kind: "sizing", kicker: "SIZE", title: spec.sizing.method.replace(/_/g, " "), sub: `${spec.sizing.value}`, section: "sizing" },
    { id: "risk", kind: "risk", kicker: "RISK", title: "Guards", sub: [spec.risk.maxPositions != null ? `${spec.risk.maxPositions} pos` : "", spec.risk.maxDrawdownPct != null ? `DD ${spec.risk.maxDrawdownPct}%` : ""].filter(Boolean).join(" · ") || "—", section: "risk" },
  ];
  outs.forEach((o, i) => {
    nodes.push({ id: o.id, kind: o.kind, kicker: o.kicker, title: o.title, sub: o.sub, section: o.section, x: COLX.out, y: (i - 1.5) * V + sigMidY });
    edges.push({ id: `e-${o.id}`, from: "entry", to: o.id, hot: true });
  });

  return { nodes, edges };
}

// Orthogonal connector with rounded corners (mockup routing).
function edgePath(a: GNode, b: GNode): string {
  const sx = a.x + NW, sy = a.y + NH / 2, tx = b.x, ty = b.y + NH / 2;
  if (Math.abs(sy - ty) < 2) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const mx = sx + Math.max(26, (tx - sx) / 2);
  const r = 11, dir = ty > sy ? 1 : -1;
  return `M ${sx} ${sy} L ${mx - r} ${sy} Q ${mx} ${sy} ${mx} ${sy + dir * r} L ${mx} ${ty - dir * r} Q ${mx} ${ty} ${mx + r} ${ty} L ${tx} ${ty}`;
}

export function ForgeGraph({ spec, result, running, onFocus, onZoom }: { spec: BotSpec; result?: BacktestResult | null; running?: boolean; onFocus?: (section: string) => void; onZoom?: (pct: number) => void }) {
  const { nodes, edges } = useMemo(() => specToGraph(spec), [spec]);
  void result;
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const bounds = useMemo(() => {
    const minX = Math.min(...nodes.map((n) => n.x)) - 40;
    const maxX = Math.max(...nodes.map((n) => n.x + NW)) + 40;
    const minY = Math.min(...nodes.map((n) => n.y)) - 40;
    const maxY = Math.max(...nodes.map((n) => n.y + NH)) + 40;
    return { minX, minY, w: maxX - minX, h: maxY - minY };
  }, [nodes]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [locked, setLocked] = useState(false);
  const report = (s: number) => onZoom?.(Math.round(s * 100));

  const fit = () => {
    const el = wrapRef.current; if (!el) return;
    const cw = el.clientWidth || 600, ch = el.clientHeight || 400;
    const s = Math.min(cw / bounds.w, ch / bounds.h, 1.4) * 0.94;
    setView({ s, x: (cw - bounds.w * s) / 2 - bounds.minX * s, y: (ch - bounds.h * s) / 2 - bounds.minY * s });
    report(s);
  };
  // B6: fit only when the node COUNT changes (add/remove), not on every param edit —
  // otherwise typing a parameter refits and wipes the user's manual pan/zoom.
  useEffect(() => { fit(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [nodes.length]);

  const zoomAround = (px: number, py: number, factor: number) => setView(v => {
    const s2 = Math.max(0.3, Math.min(2.6, v.s * factor));
    report(s2);
    return { s: s2, x: px - (px - v.x) * (s2 / v.s), y: py - (py - v.y) * (s2 / v.s) };
  });
  const zoomBtn = (factor: number) => { const el = wrapRef.current; zoomAround((el?.clientWidth || 600) / 2, (el?.clientHeight || 400) / 2, factor); };

  // native wheel listener so we can preventDefault (React onWheel is passive)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAround(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "select" && (e.target as HTMLElement).closest(".fgn")) return; // let node handle the click
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => { if (!drag.current) return; setView(v => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x), y: drag.current!.vy + (e.clientY - drag.current!.y) })); };
  const onPointerUp = () => { drag.current = null; };

  const focus = (section: string) => onFocus && onFocus(section);

  return (
    <div ref={wrapRef} className={`forge-graph${running ? " forging" : ""}`} data-tool={tool}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <svg className="fgg-svg" width="100%" height="100%">
        <defs>
          <marker id="fgg-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M1,1 L8,4.5 L1,8 Z" fill="rgba(174,188,203,.9)" /></marker>
          <marker id="fgg-arrow-hot" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M1,1 L8,4.5 L1,8 Z" fill="#eaf6ff" /></marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
          {edges.map((e) => {
            const a = byId[e.from], b = byId[e.to]; if (!a || !b) return null;
            const d = edgePath(a, b);
            return (
              <g key={e.id} className={`fgg-edge${e.hot ? " hot" : ""}`}>
                <path d={d} className="fgg-edge-base" markerEnd={`url(#fgg-arrow${e.hot ? "-hot" : ""})`} />
                <path d={d} className="fgg-edge-flow" />
                {e.label && (() => { const mx = (a.x + NW + b.x) / 2, my = (a.y + b.y) / 2 + NH / 2; return <text x={mx} y={my - 5} className="fgg-edge-lbl" textAnchor="middle">{e.label}</text>; })()}
              </g>
            );
          })}
          {nodes.map((n) => (
            <foreignObject key={n.id} x={n.x} y={n.y} width={NW} height={NH} className="fgg-fo">
              <div className={`fgn fgn-${n.kind}`} role="button" tabIndex={locked ? -1 : 0} aria-label={`${n.kicker}: ${n.title}. Edit ${n.section}.`}
                onClick={() => focus(n.section)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); focus(n.section); } }} title={`Edit ${n.section}`}>
                <div className="fgn-hd"><span className="fgn-ic"><Icon n={KIND_ICON[n.kind]} size={12} /></span><span className="fgn-k">{n.kicker}</span></div>
                <div className="fgn-t">{n.title}</div>
                {n.sub && <div className="fgn-s">{n.sub}</div>}
              </div>
            </foreignObject>
          ))}
        </g>
      </svg>

      {/* left tool rail */}
      <div className="fgg-rail">
        <button className={"fgg-tl" + (tool === "select" ? " on" : "")} onClick={() => setTool("select")} title="Select (V)" aria-label="Select tool">▹</button>
        <button className={"fgg-tl" + (tool === "pan" ? " on" : "")} onClick={() => setTool("pan")} title="Pan (H)" aria-label="Pan tool">✋</button>
        <div className="fgg-rail-sep" />
        <button className="fgg-tl" onClick={() => zoomBtn(1.2)} title="Zoom in" aria-label="Zoom in">＋</button>
        <button className="fgg-tl" onClick={() => zoomBtn(1 / 1.2)} title="Zoom out" aria-label="Zoom out">－</button>
        <button className="fgg-tl" onClick={fit} title="Fit to view" aria-label="Fit to view">⊡</button>
        <div className="fgg-rail-sep" />
        <button className={"fgg-tl" + (locked ? " on" : "")} onClick={() => setLocked(l => !l)} title={locked ? "Unlock" : "Lock"} aria-label="Lock canvas">{locked ? "🔒" : "🔓"}</button>
      </div>

      {/* minimap */}
      <div className="fgg-mini" title="Minimap">
        <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} preserveAspectRatio="xMidYMid meet">
          {edges.map((e) => { const a = byId[e.from], b = byId[e.to]; if (!a || !b) return null; return <line key={e.id} x1={a.x + NW} y1={a.y + NH / 2} x2={b.x} y2={b.y + NH / 2} className="fgm-e" />; })}
          {nodes.map((n) => <rect key={n.id} x={n.x} y={n.y} width={NW} height={NH} rx={9} className={`fgm-n fgm-${n.kind}`} />)}
        </svg>
      </div>
    </div>
  );
}
