// Wave 4+ advanced widgets. Starts with the Indicator Watchlist Strip (#17) — a dense,
// scannable "market watchlist" band of operational indicators: label, value, delta,
// threshold status, and a sparkline. Quant-native, glanceable, decision-relevant.
import React, { useState } from "react";
import * as d3 from "d3";
import { DeltaChip, MiniBars } from "./hxViz";

function relTime(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 2592000) return Math.floor(s / 86400) + "d ago";
  return Math.floor(s / 2592000) + "mo ago";
}

export interface WItem {
  k: string; v: string; sub?: string; delta?: number; deltaUnit?: string;
  status?: "good" | "warn" | "bad" | ""; invert?: boolean; up?: boolean;
  onClick?: () => void;
}

export function IndicatorStrip({ items, title }: { items: WItem[]; title?: string }) {
  return (
    <div className="hxv-wstrip-wrap">
      {title && <div className="hxv-u hxv-wstrip-title">{title}</div>}
      <div className="hxv-wstrip">
        {items.map(it => {
          const col = it.status === "bad" ? "#eb7f86" : it.status === "warn" ? "#e2b45c" : it.status === "good" ? "#3fd0a0" : "#33c2d1";
          return (
            <div className={"hxv-wcell" + (it.onClick ? " click" : "")} key={it.k} onClick={it.onClick}>
              <div className="hxv-wcell-top">
                <span className="hxv-wcell-k">{it.k}</span>
                {it.status && <span className={"hxv-wstat " + it.status} title={"Threshold: " + it.status} />}
              </div>
              <div className="hxv-wcell-mid">
                <span className="hxv-wcell-v">{it.v}</span>
                {it.delta != null && <DeltaChip value={it.delta} unit={it.deltaUnit || ""} invert={it.invert} size={10.5} />}
              </div>
              {it.sub && <div className="hxv-wcell-sub">{it.sub}</div>}
              <div className="hxv-wcell-spark"><MiniBars seed={"w" + it.k} up={it.up ?? it.status !== "bad"} color={col} w={132} h={20} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sankey flow (self-rendered): evidence → claims → decisions → artifacts ──
export interface SankNode { id: string; label: string; layer: number; color: string }
export interface SankLink { source: string; target: string; value: number }
export function Sankey({ nodes, links, height = 320 }: { nodes: SankNode[]; links: SankLink[]; height?: number }) {
  const W = 720, H = height, PAD = 14, NW = 13;
  const layers = [...new Set(nodes.map(n => n.layer))].sort((a, b) => a - b);
  const colX = (l: number) => PAD + (l / (layers.length - 1)) * (W - PAD * 2 - NW);
  const outSum: Record<string, number> = {}, inSum: Record<string, number> = {};
  links.forEach(l => { outSum[l.source] = (outSum[l.source] || 0) + l.value; inSum[l.target] = (inSum[l.target] || 0) + l.value; });
  const val = (id: string) => Math.max(outSum[id] || 0, inSum[id] || 0, 1);
  const pos: Record<string, { x: number; y: number; h: number }> = {};
  const scale = (() => { let max = 0; layers.forEach(l => { const s = nodes.filter(n => n.layer === l).reduce((a, n) => a + val(n.id), 0); max = Math.max(max, s); }); return (H - PAD * 2 - 40) / Math.max(1, max); })();
  layers.forEach(l => {
    const ns = nodes.filter(n => n.layer === l);
    const totalH = ns.reduce((a, n) => a + val(n.id) * scale, 0) + (ns.length - 1) * 16;
    let y = (H - totalH) / 2;
    ns.forEach(n => { const h = Math.max(8, val(n.id) * scale); pos[n.id] = { x: colX(l), y, h }; y += h + 16; });
  });
  const srcOff: Record<string, number> = {}, tgtOff: Record<string, number> = {};
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      <defs>{nodes.map(n => <linearGradient key={n.id} id={"sk" + n.id} x1="0" x2="1"><stop offset="0" stopColor={n.color} stopOpacity="0.55" /><stop offset="1" stopColor={n.color} stopOpacity="0.12" /></linearGradient>)}</defs>
      {links.map((l, i) => {
        const a = pos[l.source], b = pos[l.target]; if (!a || !b) return null;
        const th = Math.max(1.5, l.value * scale);
        const y1 = a.y + (srcOff[l.source] = (srcOff[l.source] || 0) + th) - th / 2;
        const y2 = b.y + (tgtOff[l.target] = (tgtOff[l.target] || 0) + th) - th / 2;
        const x1 = a.x + NW, x2 = b.x, mx = (x1 + x2) / 2;
        const sn = nodes.find(n => n.id === l.source)!;
        return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={sn.color} strokeOpacity="0.28" strokeWidth={th} />;
      })}
      {nodes.map(n => { const p = pos[n.id]; const right = n.layer === layers.length - 1; return (
        <g key={n.id}>
          <rect x={p.x} y={p.y} width={NW} height={p.h} rx="3" fill={n.color} />
          <rect x={p.x} y={p.y} width={NW} height={p.h} rx="3" fill={"url(#sk" + n.id + ")"} />
          <text x={right ? p.x - 6 : p.x + NW + 6} y={p.y + p.h / 2 + 3.5} fontSize="10.5" fill="var(--v-text2)" textAnchor={right ? "end" : "start"}>{n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}</text>
        </g>
      ); })}
      {layers.map(l => <text key={l} x={colX(l) + NW / 2} y={16} fontSize="9.5" fill="var(--v-text3)" textAnchor="middle" style={{ textTransform: "uppercase", letterSpacing: "1px" }}>{["Sources", "Claims", "Decisions", "Artifacts"][l] || ""}</text>)}
    </svg>
  );
}

// ── Chord diagram of contradictions (d3-chord): who conflicts with whom ──
export function ChordContra({ groups, matrix, size = 300 }: { groups: { name: string; color: string }[]; matrix: number[][]; size?: number }) {
  const outer = size / 2 - 34, inner = outer - 9;
  const ch = d3.chord().padAngle(0.06).sortSubgroups(d3.descending)(matrix);
  const arcGen = d3.arc<any>().innerRadius(inner).outerRadius(outer);
  const ribGen = (d3.ribbon() as any).radius(inner);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height={size}>
      <g transform={`translate(${size / 2},${size / 2})`}>
        {ch.map((c: any, i: number) => <path key={"r" + i} d={ribGen(c)} fill={groups[c.source.index]?.color || "#33c2d1"} fillOpacity="0.3" stroke={groups[c.source.index]?.color} strokeOpacity="0.35" strokeWidth="0.5" />)}
        {ch.groups.map((g: any, i: number) => {
          const a = (g.startAngle + g.endAngle) / 2 - Math.PI / 2; const lr = outer + 12;
          return (
            <g key={"g" + i}>
              <path d={arcGen(g) || ""} fill={groups[i]?.color || "#33c2d1"} fillOpacity="0.9" />
              <text x={Math.cos(a) * lr} y={Math.sin(a) * lr} fontSize="9.5" fill="var(--v-text2)" textAnchor={Math.cos(a) < -0.1 ? "end" : Math.cos(a) > 0.1 ? "start" : "middle"} dominantBaseline="middle">{groups[i]?.name}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ── Confidence heatmap (self-rendered): claims × dimensions, gradient by confidence ──
export function ConfHeatmap({ rows, cols, data, cell = 30 }: { rows: string[]; cols: string[]; data: number[][]; cell?: number }) {
  const heat = (v: number) => {
    const c = v < 0.5 ? lerp([235, 127, 134], [226, 180, 92], v * 2) : lerp([226, 180, 92], [63, 208, 160], (v - 0.5) * 2);
    return `rgba(${c[0]},${c[1]},${c[2]},${0.28 + v * 0.55})`;
  };
  const LW = 150, TH = 60, W = LW + cols.length * cell, H = TH + rows.length * cell;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ maxWidth: W }}>
      {cols.map((c, j) => <text key={"c" + j} x={LW + j * cell + cell / 2} y={TH - 8} fontSize="9.5" fill="var(--v-text3)" textAnchor="start" transform={`rotate(-40 ${LW + j * cell + cell / 2} ${TH - 8})`}>{c}</text>)}
      {rows.map((r, i) => (
        <g key={"r" + i}>
          <text x={LW - 8} y={TH + i * cell + cell / 2 + 3.5} fontSize="10" fill="var(--v-text2)" textAnchor="end">{r.length > 22 ? r.slice(0, 21) + "…" : r}</text>
          {cols.map((_, j) => { const v = data[i]?.[j] ?? 0; return (
            <g key={j}>
              <rect x={LW + j * cell + 1.5} y={TH + i * cell + 1.5} width={cell - 3} height={cell - 3} rx="3" fill={heat(v)} />
              <text x={LW + j * cell + cell / 2} y={TH + i * cell + cell / 2 + 3} fontSize="8.5" fill="rgba(255,255,255,0.75)" textAnchor="middle" fontFamily="var(--v-mono)">{v ? v.toFixed(2).slice(1) : ""}</text>
            </g>
          ); })}
        </g>
      ))}
    </svg>
  );
}
function lerp(a: number[], b: number[], t: number) { t = Math.max(0, Math.min(1, t)); return a.map((x, i) => Math.round(x + (b[i] - x) * t)); }

// ── Treemap (d3-hierarchy): relative weight of items, e.g. the artifact library ──
export function Treemap({ data, width = 340, height = 220, onClick }: { data: { name: string; value: number; color: string }[]; width?: number; height?: number; onClick?: (name: string) => void }) {
  const root = d3.hierarchy({ children: data } as any).sum((d: any) => d.value || 0).sort((a: any, b: any) => (b.value || 0) - (a.value || 0));
  d3.treemap().size([width, height]).paddingInner(3).round(true)(root);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
      {root.leaves().map((l: any, i: number) => { const w = l.x1 - l.x0, h = l.y1 - l.y0; return (
        <g key={i} style={{ cursor: onClick ? "pointer" : "default" }} onClick={() => onClick?.(l.data.name)}>
          <rect x={l.x0} y={l.y0} width={w} height={h} rx="5" fill={l.data.color} fillOpacity="0.2" stroke={l.data.color} strokeOpacity="0.5" />
          {w > 52 && h > 24 && <text x={l.x0 + 7} y={l.y0 + 16} fontSize="10" fill="var(--v-text)">{l.data.name.length > w / 6 ? l.data.name.slice(0, Math.max(3, Math.floor(w / 6))) + "…" : l.data.name}</text>}
          {w > 52 && h > 40 && <text x={l.x0 + 7} y={l.y0 + 30} fontSize="10.5" fontFamily="var(--v-mono)" fill={l.data.color}>{l.data.value}</text>}
        </g>
      ); })}
    </svg>
  );
}

// ── Timeline scrubber (#15): scrub research history, read the event at each point ──
export function Timeline({ events }: { events: { t: number; label: string; kind?: string }[] }) {
  const [scrub, setScrub] = useState(1);
  if (!events.length) return <div className="hxv-bento-empty">No timeline events yet — run a question to build project history.</div>;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const min = sorted[0].t, max = sorted[sorted.length - 1].t, span = Math.max(1, max - min);
  const xf = (t: number) => (t - min) / span;
  const kc = (k?: string) => k === "error" || k === "failed" ? "#eb7f86" : k === "complete" || k === "done" ? "#3fd0a0" : "#33c2d1";
  const active = sorted.reduce((best, e) => Math.abs(xf(e.t) - scrub) < Math.abs(xf(best.t) - scrub) ? e : best, sorted[0]);
  const move = (e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setScrub(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); };
  return (
    <div className="hxv-timeline">
      <div className="hxv-tl-track" onMouseDown={move} onMouseMove={e => { if (e.buttons) move(e); }}>
        <div className="hxv-tl-line" />
        {sorted.map((e, i) => <span key={i} className="hxv-tl-mark" style={{ left: xf(e.t) * 100 + "%", background: kc(e.kind) }} title={e.label} />)}
        <div className="hxv-tl-scrub" style={{ left: scrub * 100 + "%" }} />
      </div>
      <div className="hxv-tl-ends"><span>{relTime(min)}</span><span>now</span></div>
      <div className="hxv-tl-readout"><span className="hxv-tl-rdot" style={{ background: kc(active.kind) }} /><b>{active.label}</b><span className="hxv-tl-time">{relTime(active.t)}</span></div>
    </div>
  );
}

// ── Status / health strip with a live activity ticker (ambient chrome) ──
export function StatusStrip({ pills, ticker }: { pills?: [string, string, string][]; ticker?: string[] }) {
  const P: [string, string, string][] = pills || [["Pipeline", "healthy", "good"], ["Sources", "fresh", "good"], ["Queue", "2 running", ""], ["Model", "0.68s", ""], ["API budget", "82%", "warn"]];
  const T = ticker || ["Run r-8f3c complete · $0.0041", "Evidence coverage +6% this week", "2 sources flagged stale", "Pilot decision confidence → 78%", "Contradiction on A5 resolved", "Knowledge graph +12 entities"];
  const dot = (t: string) => t === "good" ? "var(--v-good)" : t === "warn" ? "var(--v-warn)" : t === "bad" ? "var(--v-bad)" : "var(--v-accent2)";
  return (
    <div className="hxv-status">
      <div className="hxv-status-pills">
        {P.map(([k, v, tone]) => (
          <span className="hxv-status-pill" key={k}><span className="hxv-status-dot" style={{ background: dot(tone) }} />{k} <b>{v}</b></span>
        ))}
      </div>
      <div className="hxv-status-ticker">
        <div className="hxv-ticker-track">
          {[...T, ...T].map((t, i) => <span className="hxv-ticker-item" key={i}><span className="hxv-ticker-dot" />{t}</span>)}
        </div>
      </div>
    </div>
  );
}
