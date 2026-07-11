import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import ForceGraph2D from "react-force-graph-2d";
import {
  HelixEntry, HelixFolder, Triangulation, PriorArt, StrategyOptionsData,
  Assumption, Risk, Strand, STRAND_META, freshnessColor,
} from "./helix-types";
import { TAB_TYPE_META } from "./tabPreview";
import { SpecializedTabFactory } from "./widgets/SpecializedTabFactory";
import type { AnyTabData } from "./widgets/types";
import {
  computeProgressionStage, isTerminalStage, getNextAction,
  getStageIndex, getStageCount, PROGRESSIONS,
} from "./progressionEngine";

export type CardState = "compact" | "expanded" | "focus";
export type InfoMode  = "analysis" | "graph" | "timeline";

export interface EntryCardProps {
  entry: HelixEntry;
  allEntries?: HelixEntry[];
  assumptions?: Assumption[];
  risks?: Risk[];
  strategyOptions?: StrategyOptionsData | null;
  priorArt?: PriorArt | null;
  triangulation?: Triangulation;
  hasBrief?: boolean;
  onLock: () => void; onVoid: () => void; onRedTeam: () => void;
  onTriangulate: () => void; onDevelop?: () => void; onTrace?: () => void;
  onFork?: () => void; onScan?: () => void; onProbe?: () => void;
  onDeepBrief?: () => void;
  onChallenge?: (a: Assumption) => void; onFocus?: () => void;
  triangulating?: boolean; developing?: boolean; tracing?: boolean;
  forking?: boolean; scanning?: boolean;
  formatTime: (s: string) => string;
  isContradicted?: boolean; isProbeSource?: boolean; isProbeLinked?: boolean;
  onTabTypeChanged?: (entryId: string, newPrimary: string) => void;
  projectId?: string;
  folders?: HelixFolder[];
  onMoveToFolder?: (entryId: string, folderId: string | null) => void;
}

// ── helpers ────────────────────────────────────────────────────────────────────
function cColor(c: number) {
  if (c >= 0.85) return "#4aff9e";
  if (c >= 0.70) return "#ffe14a";
  if (c >= 0.50) return "#ff9e4a";
  return "#ff6b6b";
}
function cLabel(c: number) {
  if (c >= 0.85) return "HIGH";
  if (c >= 0.70) return "MED+";
  if (c >= 0.50) return "MED";
  return "LOW";
}
function related(entry: HelixEntry, all: HelixEntry[]) {
  const ws = new Set(entry.query.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  return all.filter(e => e.id !== entry.id && !e.voided)
    .map(e => ({ e, n: e.query.toLowerCase().split(/\W+/).filter(w => w.length > 3 && ws.has(w)).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 14).map(x => x.e);
}

// quality grade: A+/A/B+/B/C/F derived from conf + freshness + tri + assumptions
function qualityGrade(
  conf: number, fresh: number,
  assumptions: Assumption[], tri?: Triangulation
): { grade: string; score: number; factors: { label: string; value: number; color: string }[] } {
  const triConf = tri ? tri.confidence : 0.5;
  const asmConf = assumptions.length
    ? assumptions.reduce((s, a) => s + a.confidence, 0) / assumptions.length
    : 0.6;
  const factors = [
    { label: "Confidence",  value: conf,    color: "#3bf0a0",              weight: 0.40 },
    { label: "Freshness",   value: fresh,   color: "#4a9eff",              weight: 0.25 },
    { label: "Validation",  value: triConf, color: "rgba(160,74,255,0.9)", weight: 0.25 },
    { label: "Stability",   value: asmConf, color: "rgba(255,215,74,0.9)", weight: 0.10 },
  ];
  const score = factors.reduce((s, f) => s + f.value * (f as typeof factors[0] & { weight: number }).weight * 100, 0);
  const grade = score >= 90 ? "A+" : score >= 84 ? "A" : score >= 77 ? "B+" : score >= 70 ? "B" : score >= 60 ? "C" : "F";
  return { grade, score, factors: factors.map(f => ({ label: f.label, value: f.value, color: f.color })) };
}

// confidence forecast: project decay forward from now
function confForecast(conf: number, strand: string) {
  const dm: Record<string, number> = {
    evidence: 0.005, strategy: 0.001, construction: 0.02,
    memory: 0.0002, signal: 0.1, synthesis: 0,
  };
  const d = dm[strand] ?? 0.005;
  return {
    h24: Math.max(0, Math.min(1, conf - d * 24)),
    d7:  Math.max(0, Math.min(1, conf - d * 168)),
    d30: Math.max(0, Math.min(1, conf - d * 720)),
  };
}

// ── Intelligence Score — 0-100 composite from completed analysis ──────────────
function computeIntelScore(
  entry: HelixEntry,
  triangulation?: Triangulation,
  priorArt?: PriorArt | null,
  strategyOptions?: StrategyOptionsData | null,
  assumptions?: Assumption[],
  risks?: Risk[],
  hasBrief?: boolean
): { score: number; label: string; color: string; gaps: string[] } {
  let score = 0;
  const gaps: string[] = [];

  // Base: confidence score contributes up to 20 points
  const conf = typeof entry.confidence === "number" && !isNaN(entry.confidence) ? entry.confidence : 0;
  score += Math.round(conf * 20);

  // Triangulation: +25
  if (triangulation) score += 25;
  else gaps.push("Triangulate (+25)");

  // Prior Art: +15
  if (priorArt) score += 15;
  else gaps.push("Prior Art (+15)");

  // Strategy: +15
  if (strategyOptions) score += 15;
  else gaps.push("Develop Strategy (+15)");

  // Deep Brief: +15
  if (hasBrief) score += 15;
  else gaps.push("Generate Brief (+15)");

  // Assumptions mapped: +5
  if (assumptions && assumptions.length > 0) score += 5;

  // Risks mapped: +5
  if (risks && risks.length > 0) score += 5;

  score = Math.min(100, score);
  const color = score >= 80 ? "#4aff9e" : score >= 60 ? "#ffe14a" : score >= 40 ? "#ff9e4a" : "#ff6b6b";
  const label = score >= 80 ? "HIGH" : score >= 60 ? "MED+" : score >= 40 ? "MED" : "LOW";
  return { score, label, color, gaps };
}

function IntelScoreBadge({
  entry, triangulation, priorArt, strategyOptions, assumptions, risks, hasBrief,
}: {
  entry: HelixEntry;
  triangulation?: Triangulation;
  priorArt?: PriorArt | null;
  strategyOptions?: StrategyOptionsData | null;
  assumptions?: Assumption[];
  risks?: Risk[];
  hasBrief?: boolean;
}) {
  const [hover, setHover] = React.useState(false);
  const { score, color, gaps } = computeIntelScore(entry, triangulation, priorArt, strategyOptions, assumptions, risks, hasBrief);

  return (
    <div className="is-badge-wrap" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="is-badge" style={{ "--isc": color } as React.CSSProperties}>
        <svg width="28" height="28" className="is-arc">
          <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
          <circle
            cx="14" cy="14" r="11"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(score / 100) * 69.115} 69.115`}
            transform="rotate(-90 14 14)"
            style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
          />
        </svg>
        <span className="is-score" style={{ color }}>{score}</span>
      </div>
      {hover && gaps.length > 0 && (
        <div className="is-tooltip">
          <div className="is-tooltip-title">Coverage gaps</div>
          {gaps.map((g, i) => (
            <div key={i} className="is-tooltip-gap">+ {g}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ConfArc ────────────────────────────────────────────────────────────────────
function ConfArc({ v, size = 64 }: { v: number; size?: number }) {
  const r = (size - 8) / 2, cx = size / 2, cy = size / 2;
  const gap = 1.0, startA = Math.PI / 2 + gap / 2, totalA = Math.PI * 2 - gap;
  const pt = (a: number) => ({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  const arc = (s: number, e: number) => {
    const sp = pt(s), ep = pt(e), big = (e - s) > Math.PI ? 1 : 0;
    return `M ${sp.x.toFixed(1)} ${sp.y.toFixed(1)} A ${r} ${r} 0 ${big} 1 ${ep.x.toFixed(1)} ${ep.y.toFixed(1)}`;
  };
  const sw = size > 80 ? 5 : 4;
  const color = cColor(v);
  return (
    <svg width={size} height={size} className="hx-arc" style={{ flexShrink: 0 }}>
      <path d={arc(startA, startA + totalA)} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={sw} strokeLinecap="round" />
      {v > 0 && <path d={arc(startA, startA + totalA * v)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 ${size > 80 ? 10 : 6}px ${color})` }} />}
      <text x={cx} y={cy + 4} textAnchor="middle" fill={color}
        style={{ fontSize: size > 80 ? 18 : 13, fontWeight: 900, fontFamily: "var(--hx-font-mono,'JetBrains Mono',monospace)", letterSpacing: "-0.02em" }}>
        {Math.round(v * 100)}
      </text>
    </svg>
  );
}

// ── Pips ───────────────────────────────────────────────────────────────────────
function Pips({ v, n = 5 }: { v: number; n?: number }) {
  const filled = Math.round(v * n), color = cColor(v);
  return (
    <span className="hx-pips">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`hx-pip${i < filled ? " on" : ""}`}
          style={i < filled ? { background: color, boxShadow: `0 0 3px ${color}` } : undefined} />
      ))}
    </span>
  );
}

// ── FreshBar ───────────────────────────────────────────────────────────────────
function FreshBar({ f, compact = false }: { f: number; compact?: boolean }) {
  const color = freshnessColor(f);
  const label = f > 0.8 ? "FRESH" : f > 0.5 ? "AGING" : f > 0.25 ? "STALE" : "DECAY";
  if (compact) return (
    <span className="hx-fresh-inline">
      <span className="hx-fresh-track-sm"><span style={{ width: `${f * 100}%`, background: color }} /></span>
      <span style={{ color, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 7.5, fontWeight: 700, letterSpacing: "0.06em" }}>{label}</span>
    </span>
  );
  return (
    <span className="hx-fresh-full">
      <span className="hx-fresh-track-full"><span style={{ width: `${f * 100}%`, background: color, boxShadow: `0 0 4px ${color}66` }} /></span>
      <span style={{ color, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 8.5, fontWeight: 700 }}>{Math.round(f * 100)}%</span>
      <span style={{ color, fontSize: 7.5, fontWeight: 700, letterSpacing: "0.08em" }}>{label}</span>
    </span>
  );
}

// ── TriBar ─────────────────────────────────────────────────────────────────────
function TriBar({ t }: { t: Triangulation }) {
  return (
    <div className="hx-tri-bar">
      {t.agree > 0 && <div style={{ flex: t.agree, background: "rgba(74,255,158,0.8)", boxShadow: "0 0 4px rgba(74,255,158,0.5)" }} />}
      {t.contested > 0 && <div style={{ flex: t.contested, background: "rgba(255,225,74,0.8)", boxShadow: "0 0 4px rgba(255,225,74,0.5)" }} />}
      {t.oppose > 0 && <div style={{ flex: t.oppose, background: "rgba(255,107,107,0.8)", boxShadow: "0 0 4px rgba(255,107,107,0.5)" }} />}
    </div>
  );
}

// ── Sparklet — tiny inline 30×12 sparkline ────────────────────────────────────
function Sparklet({ entry, tri }: { entry: HelixEntry; tri?: Triangulation }) {
  const W = 30, H = 12;
  const start = entry.original_confidence ?? entry.confidence;
  const pts: number[] = [start];
  if (tri) pts.push(tri.confidence);
  pts.push(entry.confidence);

  const trend = pts[pts.length - 1] >= pts[0];
  const color = trend ? "#3bf0a0" : "#ff6b6b";

  if (pts.length < 2 || Math.abs(pts[0] - pts[pts.length - 1]) < 0.005) {
    const ym = H / 2;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0, opacity: 0.8 }}>
        <line x1="1" y1={ym} x2={W - 1} y2={ym} stroke="rgba(100,140,200,0.4)" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 0.01;
  const xs = pts.map((_, i) => 1 + (i / (pts.length - 1)) * (W - 2));
  const ys = pts.map(v => (H - 3) - ((v - mn) / rng) * (H - 6));
  const polyPts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const lastX = xs[xs.length - 1], lastY = ys[ys.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ flexShrink: 0, opacity: 0.85 }}>
      <polyline points={polyPts} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

// ── Spark (full timeline chart) ────────────────────────────────────────────────
function Spark({ entry, tri }: { entry: HelixEntry; tri?: Triangulation }) {
  const W = 260, H = 60, color = cColor(entry.confidence);
  const pts = [
    { x: 0, y: entry.original_confidence ?? entry.confidence, lbl: "Start" },
    ...(tri ? [{ x: 0.55, y: tri.confidence, lbl: "Tri" }] : []),
    { x: 1, y: entry.confidence, lbl: "Now" },
  ];
  const ys = pts.map(p => p.y), minY = Math.min(...ys), maxY = Math.max(...ys), rY = (maxY - minY) || 0.1;
  const sx = (x: number) => x * (W - 20) + 10;
  const sy = (y: number) => H - 10 - ((y - minY) / rY) * (H - 22);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const fill = `${d} L ${sx(pts.at(-1)!.x)} ${H} L ${sx(0)} ${H} Z`;
  return (
    <div className="hx-spark-wrap">
      <svg width={W} height={H}>
        <defs>
          <linearGradient id={`spg-${entry.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fill} fill={`url(#spg-${entry.id})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${color}88)` }} />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={3} fill={color} />
            <text x={sx(p.x)} y={H - 1} textAnchor="middle" fill="rgba(200,230,255,0.3)"
              style={{ fontSize: 7, fontFamily: "var(--hx-font-mono,monospace)" }}>{p.lbl}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── ForceGraph ─────────────────────────────────────────────────────────────────
function Graph({ entry, allEntries, w = 300, h = 240 }: { entry: HelixEntry; allEntries: HelixEntry[]; w?: number; h?: number }) {
  const rels = related(entry, allEntries);
  const nodes = [
    { id: entry.id, strand: entry.strand, root: true },
    ...rels.map(e => ({ id: e.id, strand: e.strand, root: false })),
  ];
  const links = rels.map(e => ({ source: entry.id, target: e.id }));
  return (
    <div className="hx-graph">
      <ForceGraph2D width={w} height={h} graphData={{ nodes, links }} backgroundColor="transparent"
        nodeCanvasObject={(node, ctx) => {
          const n = node as typeof nodes[0];
          const color = STRAND_META[n.strand as Strand]?.color ?? "#4a9eff";
          const r = n.root ? 8 : 4;
          ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.shadowBlur = n.root ? 14 : 5; ctx.shadowColor = color;
          ctx.fill(); ctx.shadowBlur = 0;
          if (n.root) {
            ctx.beginPath(); ctx.arc(node.x ?? 0, node.y ?? 0, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = color + "44"; ctx.lineWidth = 1; ctx.stroke();
          }
        }}
        linkColor={() => "rgba(100,160,255,0.1)"} linkWidth={1}
        enableZoomInteraction={false} enablePanInteraction={false}
        cooldownTicks={60} d3VelocityDecay={0.45}
      />
      <div className="hx-graph-label">{rels.length} related entries by query overlap</div>
    </div>
  );
}

// ── TriAngles detail ───────────────────────────────────────────────────────────
function TriAngles({ t }: { t: Triangulation }) {
  const stC = (s: string) => s === "agree" ? "#4aff9e" : s === "oppose" ? "#ff6b6b" : "#ffe14a";
  return (
    <div className="hx-tri-angles">
      {([t.angle_a, t.angle_b, t.angle_c] as { stance: string; summary: string; confidence: number }[]).map((a, i) => (
        <div key={i} className="hx-tri-angle" style={{ borderLeftColor: stC(a.stance) }}>
          <div className="hx-tri-angle-row">
            <span className="hx-tri-angle-key" style={{ fontFamily: "var(--hx-font-display,'Orbitron'),system-ui" }}>{String.fromCharCode(65 + i)}</span>
            <span className="hx-tri-angle-stance" style={{ color: stC(a.stance) }}>{a.stance}</span>
            <div className="hx-tri-angle-bar"><div style={{ width: `${a.confidence * 100}%`, background: stC(a.stance), boxShadow: `0 0 5px ${stC(a.stance)}` }} /></div>
            <span style={{ color: stC(a.stance), fontFamily: "var(--hx-font-mono,monospace)", fontSize: 9, fontWeight: 800 }}>{Math.round(a.confidence * 100)}%</span>
          </div>
          <p className="hx-tri-angle-summary">{a.summary}</p>
        </div>
      ))}
    </div>
  );
}

// ── RiskMini 3×3 ──────────────────────────────────────────────────────────────
function RiskMini({ risks }: { risks: Risk[] }) {
  const L = ["high", "medium", "low"] as const;
  const heatCls = (s: string, l: string) => s === "high" && l === "high" ? "crit" : s === "low" && l === "low" ? "safe" : "mid";
  const sC: Record<string, string> = { high: "#ff6b6b", medium: "#ff9e4a", low: "#ffe14a" };
  return (
    <div className="hx-risk-grid">
      {L.map(sev => (
        <div key={sev} className="hx-risk-row">
          {L.map(like => {
            const cnt = risks.filter(r => r.severity === sev && r.likelihood === like).length;
            return (
              <div key={like} className={`hx-risk-cell hx-risk-cell--${heatCls(sev, like)}`}
                title={`${sev}/${like}: ${cnt}`}>
                {cnt > 0 && <span style={{ color: sC[sev], fontFamily: "var(--hx-font-mono,monospace)", fontSize: 10, fontWeight: 900 }}>{cnt}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── ActBtn (used by FocusOverlay) ──────────────────────────────────────────────
function ActBtn({ icon, label, cls, onClick, disabled, active, small }: {
  icon: string; label: string; cls: string; onClick: () => void;
  disabled?: boolean; active?: boolean; small?: boolean;
}) {
  return (
    <button
      className={`hx-act hx-act--${cls}${active ? " hx-act--on" : ""}${small ? " hx-act--sm" : ""}`}
      onClick={onClick} disabled={disabled} title={label}
    >
      <span className="hx-act-icon">{icon}</span>
      {!small && <span className="hx-act-label">{label}</span>}
    </button>
  );
}

// ── NEW FEATURE 1: Insight Digest — auto-computed structured bullets ──────────
interface DigestBullet { type: "claim" | "confidence" | "risk" | "gap" | "action"; text: string; }

function buildInsightDigest(
  entry: HelixEntry, assumptions: Assumption[], risks: Risk[], tri?: Triangulation
): DigestBullet[] {
  const bullets: DigestBullet[] = [];
  const first = entry.text.split(/[.!?]/)[0]?.trim();
  if (first && first.length > 20) bullets.push({ type: "claim", text: first });
  const conf = entry.confidence;
  const cw = conf >= 0.85 ? "High" : conf >= 0.70 ? "Moderate" : conf >= 0.50 ? "Low" : "Very low";
  const cDesc = conf >= 0.85 ? "well-established finding" : conf >= 0.70 ? "reasonably supported — validate further" : "requires additional validation";
  bullets.push({ type: "confidence", text: `${cw} confidence (${Math.round(conf * 100)}%) — ${cDesc}` });
  if (tri) {
    const stance = tri.agree > tri.oppose ? "generally supported" : tri.oppose > tri.agree ? "contested across perspectives" : "mixed evidence from multiple angles";
    bullets.push({ type: "claim", text: `Triangulation: ${stance} (${tri.agree} agree · ${tri.contested} contested · ${tri.oppose} oppose)` });
  }
  const shaky = assumptions.filter(a => a.confidence < 0.6 && a.status === "active");
  if (shaky.length > 0) bullets.push({ type: "gap", text: `${shaky.length} unverified assumption${shaky.length > 1 ? "s" : ""} may undermine this finding` });
  const critRisks = risks.filter(r => r.severity === "high");
  if (critRisks.length > 0) bullets.push({ type: "risk", text: `${critRisks.length} high-severity risk${critRisks.length > 1 ? "s" : ""} identified — review before acting` });
  if (!tri) bullets.push({ type: "action", text: "Run Triangulate to validate this finding from multiple angles" });
  else if (shaky.length > 0) bullets.push({ type: "action", text: "Challenge weak assumptions to strengthen the confidence score" });
  else if (critRisks.length > 0) bullets.push({ type: "action", text: "Run Red Team to stress-test against identified risks" });
  else if (conf >= 0.85 && !entry.locked) bullets.push({ type: "action", text: "Lock to Vault — this is a high-quality, validated finding" });
  else bullets.push({ type: "action", text: "Fork a scenario to explore alternative interpretations" });
  return bullets;
}

// ── JarvisAvatar — orbital holographic face ────────────────────────────────────
function JarvisAvatar({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 80 80" className="hxf5-jarvis-svg" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="36" fill="none" stroke={color} strokeWidth="0.8"
        strokeDasharray="5 3" opacity="0.22" className="hxf5-rot-slow" />
      <circle cx="40" cy="40" r="27" fill="none" stroke={color} strokeWidth="0.8"
        strokeDasharray="3 6" opacity="0.18" className="hxf5-rot-rev" />
      <circle cx="40" cy="40" r="18" fill={`${color}0e`} stroke={color} strokeWidth="1.4" opacity="0.7" />
      <line x1="28" y1="38" x2="52" y2="38" stroke={color} strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
      <circle cx="33" cy="38" r="2.5" fill={color} className="hxf5-eye-pulse" />
      <circle cx="47" cy="38" r="2.5" fill={color} className="hxf5-eye-pulse" style={{ animationDelay: "0.35s" }} />
      <rect x="36" y="42.5" width="8" height="1.1" rx="0.55" fill={color} opacity="0.4" />
      <circle cx="40" cy="13" r="1.8" fill={color} opacity="0.38" />
      <circle cx="67" cy="40" r="1.8" fill={color} opacity="0.38" />
      <circle cx="40" cy="67" r="1.8" fill={color} opacity="0.38" />
      <circle cx="13" cy="40" r="1.8" fill={color} opacity="0.38" />
    </svg>
  );
}

// ── NEW FEATURE 2: Action Context Registry — desc + preview per action ─────────
const ACT_CTX: Record<string, { title: string; icon: string; desc: string; preview: string; color: string }> = {
  lock:        { title: "Lock to Vault",    icon: "⊕", color: "#4aff9e",
    desc: "Permanently preserve this entry. Protected from voiding and pinned to your vault.",
    preview: "This finding will be marked LOCKED. It cannot be voided until unlocked." },
  fork:        { title: "Fork Scenario",    icon: "⎇", color: "#4a9eff",
    desc: "Branch this entry as a new hypothesis to explore in parallel.",
    preview: "A new entry is created inheriting this context, ready for divergent analysis." },
  redteam:     { title: "Red Team",         icon: "⚔", color: "#ff6b6b",
    desc: "Adversarial AI attacks the claims and assumptions in this entry.",
    preview: "Jarvis will find weaknesses, contradictions, and failure modes. Expect a structured critique." },
  triangulate: { title: "Triangulate",      icon: "△", color: "#4a9eff",
    desc: "Run 3-angle peer validation — agree, contested, oppose — on this claim.",
    preview: "Three independent perspectives evaluate the claim. Results update confidence score." },
  priorart:    { title: "Prior Art",        icon: "◉", color: "#a04aff",
    desc: "Find existing evidence, known research gaps, and past failures related to this.",
    preview: "Surfaces what already exists so you don't duplicate or contradict known work." },
  develop:     { title: "Develop Strategy", icon: "⊞", color: "#ffe14a",
    desc: "Generate A/B/C strategic options derived from this intelligence.",
    preview: "Jarvis produces ranked strategy paths with confidence, effort, and risk estimates." },
  trace:       { title: "Trace Lineage",    icon: "⊳", color: "#4ac8ff",
    desc: "Show the source chain and dependency graph for this entry.",
    preview: "See how this entry was derived, what it depends on, and what depends on it." },
  probe:       { title: "Probe",            icon: "◈", color: "#ff9e4a",
    desc: "Live-monitor this entry for contradictions in all new findings.",
    preview: "Any new entry that conflicts with this one will trigger an alert in real time." },
  void:        { title: "Void Entry",       icon: "↓", color: "#ff6b6b",
    desc: "Mark this entry as invalidated and archive it from view.",
    preview: "The entry is archived with voided status. It can be recovered from the archive." },
};

// ── Jarvis narrative generators (no API call — derived from data) ─────────────
function narrativeTri(tri: Triangulation): string {
  const total = tri.agree + tri.contested + tri.oppose || 1;
  const cw = tri.confidence >= 0.85 ? "high" : tri.confidence >= 0.70 ? "moderate" : "low";
  const verdict = tri.agree > tri.oppose
    ? `the balance of angles supports this claim (${Math.round(tri.agree / total * 100)}% agreement)`
    : tri.oppose > tri.agree
    ? `opposition outweighs support (${Math.round(tri.oppose / total * 100)}% against)`
    : "the angles are evenly divided";
  const sa = [tri.angle_a, tri.angle_b, tri.angle_c];
  const agrees   = sa.filter(a => a.stance === "agree");
  const opposes  = sa.filter(a => a.stance === "oppose");
  const cont     = sa.filter(a => a.stance === "contested");
  let t = `I evaluated this claim from three independent angles. At ${Math.round(tri.confidence * 100)}% confidence — ${cw} reliability — ${verdict}. `;
  if (agrees.length)  t += `The agreeing angle notes: "${agrees[0].summary.slice(0, 90)}${agrees[0].summary.length > 90 ? "…" : ""}". `;
  if (opposes.length) t += `The opposing angle challenges: "${opposes[0].summary.slice(0, 90)}${opposes[0].summary.length > 90 ? "…" : ""}". `;
  if (cont.length)    t += `A contested angle adds uncertainty: "${cont[0].summary.slice(0, 80)}${cont[0].summary.length > 80 ? "…" : ""}".`;
  return t;
}

function narrativeAsm(assumptions: Assumption[]): string {
  const total = assumptions.length;
  const strong = assumptions.filter(a => a.confidence >= 0.8);
  const weak   = assumptions.filter(a => a.confidence < 0.6 && a.status === "active");
  const avg    = Math.round(assumptions.reduce((s, a) => s + a.confidence, 0) / total * 100);
  let t = `I identified ${total} assumption${total > 1 ? "s" : ""} underlying this entry. Average confidence across all assumptions is ${avg}%. `;
  if (strong.length) t += `${strong.length} assumption${strong.length > 1 ? "s are" : " is"} well-supported (≥80%). `;
  if (weak.length) {
    t += `${weak.length} assumption${weak.length > 1 ? "s are" : " is"} critically weak (<60%) and may undermine the finding. `;
    t += `Most concerning: "${weak[0].text.slice(0, 80)}${weak[0].text.length > 80 ? "…" : ""}" — only ${Math.round(weak[0].confidence * 100)}% confidence.`;
  } else {
    t += "No critically weak assumptions were found.";
  }
  return t;
}

function narrativeRisks(risks: Risk[]): string {
  const high = risks.filter(r => r.severity === "high");
  const med  = risks.filter(r => r.severity === "medium");
  const low  = risks.filter(r => r.severity === "low");
  let t = `Risk analysis identified ${risks.length} threat${risks.length > 1 ? "s" : ""}: ${high.length} high, ${med.length} medium, ${low.length} low severity. `;
  if (high.length) {
    t += `Highest priority: "${high[0].text.slice(0, 90)}${high[0].text.length > 90 ? "…" : ""}". `;
    if (high.length > 1) t += `${high.length - 1} further high-severity risk${high.length > 2 ? "s" : ""} require immediate attention. `;
  }
  const cats = [...new Set(risks.map(r => r.category).filter(Boolean))];
  if (cats.length > 1) t += `Risk categories span: ${cats.slice(0, 3).join(", ")}.`;
  return t;
}

function narrativeStrategy(opts: StrategyOptionsData): string {
  const best = [...opts.options].sort((a, b) => b.confidence - a.confidence)[0];
  let t = `I developed ${opts.options.length} strategic option${opts.options.length > 1 ? "s" : ""}. `;
  if (best) {
    t += `The strongest path is "${best.title}" — ${Math.round(best.confidence * 100)}% confidence, ${best.effort} effort. `;
    t += `${best.rationale.slice(0, 100)}${best.rationale.length > 100 ? "…" : ""} `;
    if (best.risks.length) t += `Key risks: ${best.risks.slice(0, 2).join("; ")}.`;
  }
  return t;
}

function narrativePriorArt(pa: PriorArt): string {
  const ec = pa.exists.items?.length ?? 0;
  const gc = pa.gaps.items?.length ?? 0;
  const fc = pa.failures.items?.length ?? 0;
  let t = `Prior art scan found ${ec} existing work item${ec !== 1 ? "s" : ""}, ${gc} research gap${gc !== 1 ? "s" : ""}, and ${fc} documented failure${fc !== 1 ? "s" : ""}. `;
  if (gc > 0 && pa.gaps.items?.[0]) t += `Primary gap: "${pa.gaps.items[0].gap?.slice(0, 80)}${(pa.gaps.items[0].gap?.length ?? 0) > 80 ? "…" : ""}". `;
  if (ec > 0 && pa.exists.items?.[0]) t += `Notable existing work: "${pa.exists.items[0].name}". `;
  if (fc > 0 && pa.failures.items?.[0]) t += `Past failure to note: "${pa.failures.items[0].what?.slice(0, 60)}…".`;
  return t;
}

// ── Summary visualization components ──────────────────────────────────────────
function TriSummaryViz({ tri }: { tri: Triangulation }) {
  const total = tri.agree + tri.contested + tri.oppose || 1;
  const stC = (s: string) => s === "agree" ? "#4aff9e" : s === "oppose" ? "#ff6b6b" : "#ffe14a";
  const angles = [
    { a: tri.angle_a, k: "A" }, { a: tri.angle_b, k: "B" }, { a: tri.angle_c, k: "C" },
  ];
  return (
    <div className="hxf5-sum-viz">
      <div className="hxf5-sum-stance-bar">
        {tri.agree     > 0 && <div style={{ flex: tri.agree,     background: "#4aff9e", boxShadow: "0 0 8px #4aff9e55" }} />}
        {tri.contested > 0 && <div style={{ flex: tri.contested, background: "#ffe14a", boxShadow: "0 0 8px #ffe14a55" }} />}
        {tri.oppose    > 0 && <div style={{ flex: tri.oppose,    background: "#ff6b6b", boxShadow: "0 0 8px #ff6b6b55" }} />}
      </div>
      <div className="hxf5-sum-stance-legend">
        {tri.agree     > 0 && <span style={{ color: "#4aff9e" }}>✓ {Math.round(tri.agree/total*100)}% agree</span>}
        {tri.contested > 0 && <span style={{ color: "#ffe14a" }}>~ {Math.round(tri.contested/total*100)}% contested</span>}
        {tri.oppose    > 0 && <span style={{ color: "#ff6b6b" }}>✗ {Math.round(tri.oppose/total*100)}% oppose</span>}
      </div>
      <div className="hxf5-sum-tri-cards">
        {angles.map(({ a, k }) => (
          <div key={k} className="hxf5-sum-tri-card" style={{ borderTopColor: stC(a.stance) }}>
            <div className="hxf5-sum-tri-card-hdr">
              <span className="hxf5-sum-tri-k">{k}</span>
              <span style={{ color: stC(a.stance), fontFamily: "var(--hx-font-mono,monospace)", fontSize: 8.5, fontWeight: 700, textTransform: "uppercase" as const }}>{a.stance}</span>
              <div style={{ flex: 1 }} />
              <ConfArc v={a.confidence} size={44} />
            </div>
            <p className="hxf5-sum-tri-summary">{a.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function AsmSummaryViz({ assumptions }: { assumptions: Assumption[] }) {
  const sorted = [...assumptions].sort((a, b) => a.confidence - b.confidence);
  return (
    <div className="hxf5-sum-viz">
      <div className="hxf5-sum-asm-bars">
        {sorted.map(a => (
          <div key={a.id} className="hxf5-sum-asm-row">
            <div className="hxf5-sum-asm-meta">
              <span className="hxf5-sum-asm-type">{a.assumption_type.slice(0, 4).toUpperCase()}</span>
              <span className="hxf5-sum-asm-text">{a.text}</span>
              <span className={`hxf5-sum-asm-status hxf5-sum-asm-status--${a.status}`}>{a.status}</span>
            </div>
            <div className="hxf5-sum-asm-bar-row">
              <div className="hxf5-sum-asm-track">
                <div style={{ width: `${a.confidence * 100}%`, background: cColor(a.confidence), boxShadow: `0 0 5px ${cColor(a.confidence)}55` }} />
              </div>
              <span className="hxf5-sum-asm-conf" style={{ color: cColor(a.confidence) }}>{Math.round(a.confidence * 100)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RiskSummaryViz({ risks }: { risks: Risk[] }) {
  const sevC: Record<string, string> = { high: "#ff6b6b", medium: "#ff9e4a", low: "#ffe14a" };
  const sorted = [...risks].sort((a, b) => {
    const w: Record<string, number> = { high: 3, medium: 2, low: 1 };
    return (w[b.severity] ?? 0) - (w[a.severity] ?? 0);
  });
  return (
    <div className="hxf5-sum-viz">
      <div className="hxf5-sum-risk-top">
        <div>
          <div className="hxf5-sum-sub-hdr">Heat Matrix</div>
          <RiskMini risks={risks} />
        </div>
        <div className="hxf5-sum-risk-dist">
          <div className="hxf5-sum-sub-hdr">By Severity</div>
          {(["high", "medium", "low"] as const).map(sev => {
            const cnt = risks.filter(r => r.severity === sev).length;
            return (
              <div key={sev} className="hxf5-sum-dist-row">
                <span style={{ color: sevC[sev], fontFamily: "var(--hx-font-mono,monospace)", fontSize: 7.5, fontWeight: 700, textTransform: "uppercase" as const, width: 50, flexShrink: 0 }}>{sev}</span>
                <div className="hxf5-sum-dist-track">
                  <div style={{ width: risks.length ? `${(cnt / risks.length) * 100}%` : "0%", background: sevC[sev] }} />
                </div>
                <span style={{ color: sevC[sev], fontFamily: "var(--hx-font-mono,monospace)", fontSize: 10, fontWeight: 800, width: 18 }}>{cnt}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="hxf5-sum-risk-cards">
        {sorted.map(r => (
          <div key={r.id} className="hxf5-sum-risk-card" style={{ borderLeftColor: sevC[r.severity] }}>
            <div className="hxf5-sum-risk-card-hdr">
              <span className="hxf5-sum-risk-sev" style={{ color: sevC[r.severity], borderColor: sevC[r.severity] + "44" }}>{r.severity}</span>
              <span className="hxf5-sum-risk-like">{r.likelihood} likelihood</span>
              {r.category && <span className="hxf5-sum-risk-cat">{r.category}</span>}
            </div>
            <p className="hxf5-sum-risk-text">{r.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StrategySummaryViz({ opts }: { opts: StrategyOptionsData }) {
  const efC: Record<string, string> = { low: "#4aff9e", medium: "#ffe14a", high: "#ff6b6b" };
  const best = [...opts.options].sort((a, b) => b.confidence - a.confidence)[0];
  return (
    <div className="hxf5-sum-viz">
      {/* Comparison bar chart */}
      <div className="hxf5-sum-strat-compare">
        {opts.options.map((opt, i) => (
          <div key={i} className={`hxf5-sum-strat-bar-wrap${opt === best ? " hxf5-sum-strat-bar-wrap--best" : ""}`}>
            <span className="hxf5-sum-strat-lbl">{String.fromCharCode(65 + i)}</span>
            <div className="hxf5-sum-strat-track">
              <div style={{ width: `${opt.confidence * 100}%`, background: cColor(opt.confidence), boxShadow: `0 0 6px ${cColor(opt.confidence)}44` }} />
            </div>
            <span className="hxf5-sum-strat-pct" style={{ color: cColor(opt.confidence) }}>{Math.round(opt.confidence * 100)}%</span>
            <span className="hxf5-sum-strat-effort" style={{ color: efC[opt.effort] ?? "#ffe14a" }}>{opt.effort}</span>
          </div>
        ))}
      </div>
      {/* Full option cards */}
      {opts.options.map((opt, i) => (
        <div key={i} className={`hxf5-sum-strat-card${opt === best ? " hxf5-sum-strat-card--best" : ""}`}>
          <div className="hxf5-sum-strat-card-hdr">
            <span className="hxf5-sum-strat-k">{String.fromCharCode(65 + i)}</span>
            <span className="hxf5-sum-strat-title">{opt.title}</span>
            {opt === best && <span className="hxf5-sum-strat-badge">RECOMMENDED</span>}
            <span className="hxf5-sum-strat-conf" style={{ color: cColor(opt.confidence) }}>{Math.round(opt.confidence * 100)}%</span>
            <span className="hxf5-sum-strat-ef" style={{ color: efC[opt.effort] ?? "#ffe14a" }}>{opt.effort} effort</span>
          </div>
          <p className="hxf5-sum-strat-rationale">{opt.rationale}</p>
          {opt.risks.length > 0 && (
            <div className="hxf5-sum-strat-risks">
              {opt.risks.map((r, j) => <span key={j} className="hxf5-sum-strat-risk">⚠ {r}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PriorArtSummaryViz({ pa }: { pa: PriorArt }) {
  return (
    <div className="hxf5-sum-viz">
      {(pa.exists.items ?? []).length > 0 && (
        <div className="hxf5-sum-pa-section">
          <div className="hxf5-sum-pa-hdr" style={{ color: "#4aff9e" }}>✓ Existing Work ({pa.exists.items!.length})</div>
          {pa.exists.items!.map((item, i) => (
            <div key={i} className="hxf5-sum-pa-item hxf5-sum-pa-item--exists">
              <span className="hxf5-sum-pa-name">{item.name}</span>
              {"description" in item && item.description && <span className="hxf5-sum-pa-desc">{(item as typeof item & { description: string }).description}</span>}
            </div>
          ))}
        </div>
      )}
      {(pa.gaps.items ?? []).length > 0 && (
        <div className="hxf5-sum-pa-section">
          <div className="hxf5-sum-pa-hdr" style={{ color: "#ffe14a" }}>○ Research Gaps ({pa.gaps.items!.length})</div>
          {pa.gaps.items!.map((item, i) => (
            <div key={i} className="hxf5-sum-pa-item hxf5-sum-pa-item--gap">
              <span className="hxf5-sum-pa-name">{item.gap}</span>
            </div>
          ))}
        </div>
      )}
      {(pa.failures.items ?? []).length > 0 && (
        <div className="hxf5-sum-pa-section">
          <div className="hxf5-sum-pa-hdr" style={{ color: "#ff6b6b" }}>✗ Documented Failures ({pa.failures.items!.length})</div>
          {pa.failures.items!.map((item, i) => (
            <div key={i} className="hxf5-sum-pa-item hxf5-sum-pa-item--failed">
              <span className="hxf5-sum-pa-name">{item.what}</span>
              {"why" in item && item.why && <span className="hxf5-sum-pa-desc">Why: {(item as typeof item & { why: string }).why}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SummaryPanel — index + detail for each completed action ────────────────────
interface SumEntry {
  key: string; icon: string; title: string; color: string;
  statLine: string; narrative: string;
}

function SummaryPanel({
  entry, assumptions, risks, strategyOptions, priorArt, triangulation,
}: {
  entry: HelixEntry; assumptions: Assumption[]; risks: Risk[];
  strategyOptions: StrategyOptionsData | null; priorArt: PriorArt | null;
  triangulation?: Triangulation;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const summaries: SumEntry[] = [];

  if (triangulation) summaries.push({
    key: "triangulate", icon: "△", title: "Triangulation", color: "#4a9eff",
    statLine: `${Math.round(triangulation.confidence * 100)}% conf · ${triangulation.agree} agree · ${triangulation.contested} contested · ${triangulation.oppose} oppose`,
    narrative: narrativeTri(triangulation),
  });

  if (assumptions.length > 0) {
    const avg = Math.round(assumptions.reduce((s, a) => s + a.confidence, 0) / assumptions.length * 100);
    summaries.push({
      key: "assumptions", icon: "⬡", title: "Assumptions", color: "#4aff9e",
      statLine: `${assumptions.length} identified · avg ${avg}% confidence`,
      narrative: narrativeAsm(assumptions),
    });
  }

  if (risks.length > 0) {
    const high = risks.filter(r => r.severity === "high").length;
    summaries.push({
      key: "risks", icon: "⚠", title: "Risk Assessment", color: "#ff9e4a",
      statLine: `${risks.length} risks · ${high} high severity`,
      narrative: narrativeRisks(risks),
    });
  }

  if (strategyOptions) summaries.push({
    key: "strategy", icon: "⊞", title: "Strategy Options", color: "#ffe14a",
    statLine: `${strategyOptions.options.length} options developed`,
    narrative: narrativeStrategy(strategyOptions),
  });

  if (priorArt) {
    const total = (priorArt.exists.items?.length ?? 0) + (priorArt.gaps.items?.length ?? 0) + (priorArt.failures.items?.length ?? 0);
    summaries.push({
      key: "priorart", icon: "◉", title: "Prior Art", color: "#a04aff",
      statLine: `${total} items found`,
      narrative: narrativePriorArt(priorArt),
    });
  }

  if (summaries.length === 0) {
    return (
      <div className="hxf5-sum-empty">
        <div className="hxf5-sum-empty-icon">◈</div>
        <div className="hxf5-sum-empty-title">No intelligence gathered yet</div>
        <div className="hxf5-sum-empty-hint">
          Run Triangulate, Prior Art, Develop Strategy, or Red Team from the action rail to populate this view.
        </div>
      </div>
    );
  }

  const active = selected ? summaries.find(s => s.key === selected) : null;

  if (active) {
    return (
      <div className="hxf5-sum-detail">
        <button className="hxf5-sum-back" onClick={() => setSelected(null)}>← All summaries</button>
        <div className="hxf5-sum-det-hdr" style={{ borderLeftColor: active.color }}>
          <span className="hxf5-sum-det-icon" style={{ color: active.color }}>{active.icon}</span>
          <div>
            <div className="hxf5-sum-det-title" style={{ color: active.color }}>{active.title}</div>
            <div className="hxf5-sum-det-stat">{active.statLine}</div>
          </div>
        </div>
        <div className="hxf5-sum-narrative">
          <div className="hxf5-sum-narrative-lbl"><span style={{ color: active.color }}>◈</span> Jarvis Analysis</div>
          <p className="hxf5-sum-narrative-text">"{active.narrative}"</p>
        </div>
        {active.key === "triangulate"  && triangulation   && <TriSummaryViz tri={triangulation} />}
        {active.key === "assumptions"  && <AsmSummaryViz assumptions={assumptions} />}
        {active.key === "risks"        && <RiskSummaryViz risks={risks} />}
        {active.key === "strategy"     && strategyOptions && <StrategySummaryViz opts={strategyOptions} />}
        {active.key === "priorart"     && priorArt        && <PriorArtSummaryViz pa={priorArt} />}
      </div>
    );
  }

  return (
    <div className="hxf5-sum-index">
      <div className="hxf5-sum-index-hdr">
        <span className="hxf5-sum-index-title">Intelligence Summaries</span>
        <span className="hxf5-sum-index-cnt">{summaries.length} completed</span>
      </div>
      <div className="hxf5-sum-index-grid">
        {summaries.map(s => (
          <button
            key={s.key}
            className="hxf5-sum-card"
            style={{ "--sum-c": s.color } as React.CSSProperties}
            onClick={() => setSelected(s.key)}
          >
            <div className="hxf5-sum-card-top">
              <span className="hxf5-sum-card-icon" style={{ color: s.color }}>{s.icon}</span>
              <span className="hxf5-sum-card-title">{s.title}</span>
              <span className="hxf5-sum-card-arr">›</span>
            </div>
            <div className="hxf5-sum-card-stat">{s.statLine}</div>
            <p className="hxf5-sum-card-preview">{s.narrative.slice(0, 110)}…</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIDEBAR JARVIS CHAT — streaming ask-anything panel for FocusOverlay
// ═══════════════════════════════════════════════════════════════════════════════
interface SJCProps {
  entry: HelixEntry;
  triangulation?: Triangulation;
  assumptions: Assumption[];
  risks: Risk[];
  meta: { color: string; label: string };
  qg: { grade: string; score: number };
  fresh: number; decay: number; ageH: number; staleH: number;
  onTriangulate: () => void; onRedTeam: () => void;
  onDevelop?: () => void; onScan?: () => void;
  onFork?: () => void; onTrace?: () => void; onProbe?: () => void;
  onLock: () => void;
  triangulating: boolean; developing: boolean; scanning: boolean;
  forking: boolean; tracing: boolean;
  activeTabType?: string | null;
  tabContext?: string | null;
  deepBrief?: import("./helix-types").DeepBrief | null;
}

type JMsg = { id: string; role: "user" | "jarvis"; text: string; streaming?: boolean };

const SJC_CHIPS_DEFAULT = [
  { label: "Summarize",       prompt: "Give me a sharp 3-sentence summary of this intelligence." },
  { label: "Key risks",       prompt: "What are the key risks and weaknesses in this evidence?" },
  { label: "What's missing?", prompt: "What information is missing that would strengthen this entry?" },
  { label: "Next action?",    prompt: "What action should I take next — triangulate, red team, develop strategy, or something else? Be direct." },
  { label: "Confidence?",     prompt: "Is the confidence score justified? What would increase it?" },
  { label: "Blind spots?",    prompt: "What cognitive biases or blind spots might be affecting this analysis?" },
];

const TAB_CHIPS: Record<string, { label: string; prompt: string }[]> = {
  market: [
    { label: "Signal rationale",   prompt: "What's driving the current signal? Explain the key factors in 3 sentences." },
    { label: "What flips it?",     prompt: "What specific conditions or events would change this signal to SELL or HOLD?" },
    { label: "Size this position", prompt: "How should I size this position? Factor in the signal score and risk." },
    { label: "Biggest risk",       prompt: "What's the single biggest risk to this trade right now?" },
    { label: "Entry timing",       prompt: "Is the current moment a good entry or should I wait? What are the timing signals?" },
  ],
  code: [
    { label: "Find bugs",          prompt: "Scan this code carefully. List every bug, edge case, or potential failure." },
    { label: "Optimize it",        prompt: "How can I optimize this code for performance and readability?" },
    { label: "Explain it",         prompt: "Explain what this code does in plain English, line by line." },
    { label: "Write a test",       prompt: "Write a test suite for this code. Include edge cases." },
    { label: "Security issues",    prompt: "Are there any security vulnerabilities in this code? Be specific." },
  ],
  data: [
    { label: "Key insight",        prompt: "What's the single most important insight in this data?" },
    { label: "Anomalies",          prompt: "Are there any anomalies, outliers, or suspicious values in this dataset?" },
    { label: "Validate formula",   prompt: "Is the formula correct? Are there edge cases where it breaks?" },
    { label: "Visualize how?",     prompt: "What's the best way to visualize this data to highlight the key pattern?" },
  ],
  decision: [
    { label: "Strongest option",   prompt: "Which option has the highest expected value? Explain your reasoning." },
    { label: "Hidden risks",       prompt: "What risks are NOT listed in the cons that I should be aware of?" },
    { label: "What's missing?",    prompt: "What key option or perspective is missing from this decision?" },
    { label: "Decide for me",      prompt: "Make the decision. Pick one option and defend it in 3 sentences." },
  ],
  comparison: [
    { label: "Who wins?",          prompt: "Based on this comparison, which option wins overall and why?" },
    { label: "Missing attributes", prompt: "What key attributes are missing from this comparison?" },
    { label: "Bias check",         prompt: "Is there any bias in how the attributes are scored or framed?" },
    { label: "Context matters",    prompt: "Under what specific conditions does each option win?" },
  ],
  design: [
    { label: "Weakest link",       prompt: "What's the weakest component or dependency in this architecture?" },
    { label: "Scalability",        prompt: "How does this design scale? What breaks first under load?" },
    { label: "Simplify it",        prompt: "What could be removed or simplified without losing essential functionality?" },
    { label: "Security surface",   prompt: "Where are the security vulnerabilities in this design?" },
  ],
  people: [
    { label: "Key connections",    prompt: "Who are the most important people this person is connected to?" },
    { label: "Credibility check",  prompt: "How credible and reliable is this person based on the available facts?" },
    { label: "Motivation",         prompt: "What's their primary motivation in this context?" },
    { label: "Red flags",          prompt: "Are there any red flags or inconsistencies in the profile?" },
  ],
  media: [
    { label: "Core argument",      prompt: "What's the central argument or thesis of this media piece?" },
    { label: "Credibility",        prompt: "How credible is this source? What biases might affect it?" },
    { label: "Key quote",          prompt: "What's the single most important quote and why?" },
    { label: "Counter-narrative",  prompt: "What's the strongest counterargument to the position taken here?" },
  ],
  research: [
    { label: "Strength of evidence", prompt: "How strong is the evidence presented? Rate each source 1-10." },
    { label: "Gaps",               prompt: "What questions does this research leave unanswered?" },
    { label: "Contradictions",     prompt: "Are there any internal contradictions or inconsistencies in the research?" },
    { label: "Apply to project",   prompt: "How does this research apply directly to our current project?" },
  ],
};

function getTabChips(tabType: string | null): { label: string; prompt: string }[] {
  if (!tabType || tabType === "generic" || tabType === "unknown") return SJC_CHIPS_DEFAULT;
  return TAB_CHIPS[tabType] ?? SJC_CHIPS_DEFAULT;
}

function SidebarJarvisChat(p: SJCProps) {
  const [msgs, setMsgs] = useState<JMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const prevTabRef = useRef<string | null | undefined>(p.activeTabType);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // Reset chat when tab switches (R12)
  useEffect(() => {
    if (prevTabRef.current !== p.activeTabType) {
      prevTabRef.current = p.activeTabType;
      abortRef.current?.abort();
      setMsgs([]);
      setBusy(false);
    }
  }, [p.activeTabType]);

  function buildContext(): string {
    const { entry, triangulation, assumptions, risks, qg, fresh, decay, ageH, tabContext, activeTabType, deepBrief } = p;
    const lines = [
      `[HELIX Entry — Live Context]`,
      `Query: "${entry.query}"`,
      `Strand: ${entry.strand} | Confidence: ${Math.round(entry.confidence * 100)}% | Freshness: ${Math.round(fresh * 100)}%`,
      `Quality: ${qg.grade} (${Math.round(qg.score)}pts) | Age: ${ageH.toFixed(1)}h | Decay: −${decay}/hr`,
    ];
    if (activeTabType && activeTabType !== null) {
      lines.push(`Active Tab: ${activeTabType.toUpperCase()}`);
    }
    if (tabContext) {
      lines.push(``, `[Tab Intelligence — ${(activeTabType ?? "").toUpperCase()}]`, tabContext);
    }
    lines.push(``, `Intelligence:`, entry.text.slice(0, 1000));
    if (deepBrief) {
      lines.push(``, `[Jarvis Deep Brief — Full Analysis]`,
        `Summary: ${deepBrief.summary}`,
        ``,
        `Key Findings:`,
        ...deepBrief.key_findings.slice(0, 6).map((f, i) => `  ${i + 1}. ${f}`),
        ``,
        `What This Means: ${deepBrief.what_this_means.slice(0, 400)}`,
        ``,
        `Confidence Assessment: ${deepBrief.confidence_reasoning.slice(0, 300)}`,
        ``,
        `Recommended Actions:`,
        ...deepBrief.recommended_actions.slice(0, 3).map(a => `  #${a.priority} ${a.action} — ${a.why.slice(0, 100)}`),
      );
    }
    if (triangulation) {
      const a = triangulation;
      lines.push(``, `Triangulation (${Math.round(a.confidence * 100)}%):`,
        `  A [${a.angle_a.stance}]: ${a.angle_a.summary.slice(0, 120)}`,
        `  B [${a.angle_b.stance}]: ${a.angle_b.summary.slice(0, 120)}`,
        `  C [${a.angle_c.stance}]: ${a.angle_c.summary.slice(0, 120)}`
      );
    }
    if (assumptions.length) {
      lines.push(``, `Assumptions (${assumptions.length}):`,
        ...assumptions.slice(0, 4).map(a => `  • [${a.assumption_type} ${Math.round(a.confidence * 100)}%] ${a.text.slice(0, 90)}`)
      );
    }
    if (risks.length) {
      lines.push(``, `Risks:`,
        ...risks.slice(0, 4).map(r => `  • [${r.severity}] ${r.text.slice(0, 80)}`)
      );
    }
    lines.push(``, `---`,
      `You are Jarvis, the intelligence analysis AI embedded in HELIX. You have access to the full Deep Brief above (if present) and all analysis for this entry. Answer questions with precision, referencing specific findings and analysis. Be concise, direct, and analytical. If asked about the Brief, summarize or expand on its sections. If asked about an action (triangulate, red team, etc.), explain what it will do and what to expect.`,
      ``
    );
    return lines.join("\n");
  }

  async function send(override?: string) {
    const text = (override ?? input).trim();
    if (!text || busy) return;
    if (!override) setInput("");

    const uid = crypto.randomUUID(), jid = crypto.randomUUID();
    setMsgs(prev => [
      ...prev,
      { id: uid, role: "user",   text },
      { id: jid, role: "jarvis", text: "", streaming: true },
    ]);
    setBusy(true);

    const isFirst = msgs.length === 0;
    const prompt  = isFirst ? `${buildContext()}\n${text}` : text;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: "chat" }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) throw new Error("no body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try {
            const ev = JSON.parse(ln);
            if (ev.type === "delta" && ev.text) {
              acc += ev.text;
              setMsgs(prev => prev.map(m => m.id === jid ? { ...m, text: acc } : m));
            }
          } catch { /* partial line */ }
        }
      }
      setMsgs(prev => prev.map(m => m.id === jid ? { ...m, streaming: false } : m));
    } catch (err: unknown) {
      if ((err as { name?: string }).name !== "AbortError") {
        setMsgs(prev => prev.map(m => m.id === jid
          ? { ...m, text: "Jarvis is unreachable — check the backend is running.", streaming: false }
          : m
        ));
      }
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  const fireAndAsk = (actionFn: () => void, followUp: string) => {
    actionFn();
    void send(followUp);
  };

  return (
    <div className="hxjc-wrap">
      {/* Header */}
      <div className="hxjc-hdr">
        <span className="hxjc-dot" style={{ background: p.meta.color, boxShadow: `0 0 5px ${p.meta.color}` }} />
        <span className="hxjc-title">ASK JARVIS</span>
        {busy && <span className="hxjc-spin hx-spin" />}
        {msgs.length > 0 && (
          <button className="hxjc-clear" onClick={() => { abortRef.current?.abort(); setMsgs([]); setBusy(false); }} title="Clear chat">↺</button>
        )}
      </div>

      {/* Message list */}
      <div className="hxjc-msgs" ref={scrollRef}>
        {msgs.length === 0 && (
          <div className="hxjc-empty">
            <span className="hxjc-empty-icon" style={{ color: p.meta.color }}>◈</span>
            <span className="hxjc-empty-text">I know everything about this entry.<br/>Ask me anything.</span>
          </div>
        )}
        {msgs.map(m => (
          <div key={m.id} className={`hxjc-msg hxjc-msg--${m.role}`}>
            {m.role === "jarvis" && (
              <span className="hxjc-lbl" style={{ color: p.meta.color }}>J</span>
            )}
            <span className={`hxjc-text${m.streaming ? " hxjc-blink" : ""}`}>
              {m.text || (m.streaming ? "thinking…" : "")}
            </span>
          </div>
        ))}
      </div>

      {/* Quick chips — tab-aware (Wave 3-B) */}
      <div className="hxjc-chips">
        {getTabChips(p.activeTabType ?? null).map(c => (
          <button key={c.label} className="hxjc-chip" onClick={() => { void send(c.prompt); }} disabled={busy}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="hxjc-acts">
        <span className="hxjc-acts-lbl">TRIGGER</span>
        <button className="hxjc-act hxjc-act--tri"   disabled={p.triangulating || busy} title="Triangulate"
          onClick={() => fireAndAsk(p.onTriangulate, "Triangulation was just triggered. What three angles should we expect?")}>△</button>
        <button className="hxjc-act hxjc-act--red"   disabled={busy} title="Red Team"
          onClick={() => fireAndAsk(p.onRedTeam, "Red team analysis triggered. What are the strongest counterarguments?")}>⚔</button>
        {p.onDevelop && <button className="hxjc-act hxjc-act--strat" disabled={p.developing || busy} title="Develop Strategy"
          onClick={() => fireAndAsk(p.onDevelop!, "Strategy development triggered. What strategic options should this produce?")}>⊞</button>}
        {p.onScan && <button className="hxjc-act hxjc-act--art"   disabled={p.scanning || busy} title="Prior Art"
          onClick={() => fireAndAsk(p.onScan!, "Prior art scan started. What historical precedents are relevant?")}>◉</button>}
        {p.onFork && <button className="hxjc-act hxjc-act--fork"  disabled={p.forking || busy} title="Fork"
          onClick={() => fireAndAsk(p.onFork!, "Entry forked. What direction should the new hypothesis explore?")}>⎇</button>}
        {p.onTrace && <button className="hxjc-act hxjc-act--trace" disabled={p.tracing || busy} title="Trace Chain"
          onClick={() => fireAndAsk(p.onTrace!, "Evidence chain trace started. What causal links should we verify?")}>⊛</button>}
        {p.onProbe && <button className="hxjc-act hxjc-act--probe" disabled={busy} title="Probe"
          onClick={() => fireAndAsk(p.onProbe!, "Probe launched. What should it investigate first?")}>◈</button>}
        {!p.entry.locked && <button className="hxjc-act hxjc-act--lock" disabled={busy} title="Lock to Vault"
          onClick={() => p.onLock()}>⊕</button>}
      </div>

      {/* Input */}
      <form className="hxjc-form" onSubmit={e => { e.preventDefault(); void send(); }}>
        <input
          ref={inputRef}
          className="hxjc-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={busy}
        />
        <button className="hxjc-send" type="submit" disabled={!input.trim() || busy}>
          {busy ? <span className="hx-spin" style={{ fontSize: 9 }} /> : "↑"}
        </button>
      </form>
    </div>
  );
}

// ── TabTypePicker — inline type selector used by confidence gate and why-popover ─
const ALL_TAB_TYPES = ["market","code","data","decision","comparison","design","people","media","research","generic"] as const;

function TabTypePicker({ onSelect, onCancel }: { onSelect: (t: string) => void; onCancel: () => void }) {
  return (
    <div className="hxv5-tab-picker">
      <span className="hxv5-tab-picker-label">Pick type:</span>
      {ALL_TAB_TYPES.map(t => {
        const tm = TAB_TYPE_META[t as keyof typeof TAB_TYPE_META];
        if (!tm) return null;
        return (
          <button
            key={t}
            className="hxv5-tab-picker-btn"
            style={{ "--tp-color": tm.color } as React.CSSProperties}
            onClick={() => onSelect(t)}
          >{tm.icon} {tm.label}</button>
        );
      })}
      <button className="hxv5-tab-picker-cancel" onClick={onCancel}>✕</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// FOCUS OVERLAY v5 — Mission Briefing (sidebar + center + action rail)
// ═══════════════════════════════════════════════════════════════════════════════
function FocusOverlay(props: EntryCardProps & {
  onClose: () => void; mode: InfoMode; setMode: (m: InfoMode) => void;
}) {
  const {
    entry, allEntries = [], assumptions = [], risks = [],
    strategyOptions = null, priorArt = null, triangulation,
    onLock, onVoid, onRedTeam, onTriangulate,
    onDevelop, onTrace, onFork, onScan, onProbe, onChallenge,
    triangulating = false, developing = false, tracing = false,
    forking = false, scanning = false,
    formatTime, isContradicted = false, isProbeSource = false,
    onTabTypeChanged, projectId,
    folders = [], onMoveToFolder,
    onClose,
  } = props;

  const meta  = STRAND_META[entry.strand as Strand] ?? STRAND_META.evidence;
  const fresh = entry.freshness;
  const qg    = qualityGrade(entry.confidence, fresh, assumptions, triangulation);
  const fc    = confForecast(entry.confidence, entry.strand);

  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [showGraph, setShowGraph]       = useState(false);
  const [summaryView, setSummaryView]   = useState(false);
  const [showWhyPopover, setShowWhyPopover]   = useState(false);
  const [showFocusTabPicker, setShowFocusTabPicker] = useState(false);
  const [activeSpecTab, setActiveSpecTab]   = useState<string | null>(null);
  const [showFolderMove, setShowFolderMove] = useState(false);
  const whyRef    = useRef<HTMLDivElement>(null);
  const folderRef = useRef<HTMLDivElement>(null);

  // Wave 3-A: Progression Engine
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [handoffEntries, setHandoffEntries]      = useState<HelixEntry[]>([]);

  // Wave 3-B: Tab-Native Jarvis context (150-word digest per tab)
  const [tabContext, setTabContext]         = useState<string | null>(null);
  const [tabCtxLoading, setTabCtxLoading]  = useState(false);
  const tabCtxAbort = useRef<AbortController | null>(null);

  // Deep Brief — fetched once on mount for SidebarJarvisChat context injection
  const [cachedBrief, setCachedBrief] = useState<import("./helix-types").DeepBrief | null>(null);
  useEffect(() => {
    fetch(`/api/helix/entry/${entry.id}/deep-brief`)
      .then(r => r.json())
      .then(d => { if (d.brief) setCachedBrief(d.brief); })
      .catch(() => {});
  }, [entry.id]);

  // Wave 3-D: Live streaming state
  const [liveTabData, setLiveTabData] = useState<Partial<AnyTabData> | null>(null);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derive specialized tabs from structured_resp — max 2 per R9
  const specTabs = (() => {
    const raw = entry.structured_resp?.tabs as { type?: string }[] | undefined;
    if (!raw || !raw.length) return [];
    return raw
      .filter(t => t && t.type && t.type !== "research")
      .slice(0, 2);
  })();
  const baseTabData: AnyTabData | null = activeSpecTab
    ? ((specTabs.find(t => t.type === activeSpecTab) as AnyTabData | undefined) ?? null)
    : null;
  // Wave 3-D: Merge live streaming partial update over base tab data
  const activeTabData: AnyTabData | null = (baseTabData && liveTabData)
    ? { ...baseTabData, ...liveTabData } as AnyTabData
    : baseTabData;

  const applyFocusTabTypeOverride = async (newType: string) => {
    try {
      await fetch(`/api/helix/entry/${entry.id}/tab-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab_primary: newType }),
      });
      setShowFocusTabPicker(false);
      setShowWhyPopover(false);
      onTabTypeChanged?.(entry.id, newType);
    } catch { /* ignore */ }
  };

  // Close "Why?" popover on outside click
  useEffect(() => {
    if (!showWhyPopover) return;
    const handler = (e: MouseEvent) => {
      if (whyRef.current && !whyRef.current.contains(e.target as Node)) setShowWhyPopover(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWhyPopover]);

  // Close folder move popover on outside click
  useEffect(() => {
    if (!showFolderMove) return;
    const handler = (e: MouseEvent) => {
      if (folderRef.current && !folderRef.current.contains(e.target as Node)) setShowFolderMove(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFolderMove]);

  const decay  = ({ evidence: 0.005, strategy: 0.001, construction: 0.02, memory: 0.0002, signal: 0.1, synthesis: 0 } as Record<string, number>)[entry.strand] ?? 0.005;
  const ageH   = (Date.now() - new Date(entry.created_at).getTime()) / 3_600_000;
  const staleH = decay > 0 ? Math.max(0, 0.8 / decay - ageH) : Infinity;
  const digest = buildInsightDigest(entry, assumptions, risks, triangulation);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(() => setShowGraph(true), 380);
    return () => clearTimeout(t);
  }, []);

  // Wave 3-A: Fetch action log on focus open (R11 — pure derivation from log)
  useEffect(() => {
    if (!entry.tab_primary) return;
    fetch(`/api/helix/action-log?entryId=${encodeURIComponent(entry.id)}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.actions)) {
          setCompletedActions(d.actions.map((a: { action: string }) => a.action));
        }
      })
      .catch(() => { /* ignore */ });
  }, [entry.id, entry.tab_primary]);

  // Wave 3-A: Fetch handoff entries when terminal stage (Wave 3-C)
  const tabType = entry.tab_primary ?? null;
  const progStage = tabType
    ? computeProgressionStage(tabType, completedActions)
    : "captured";
  const isTerminal = tabType ? isTerminalStage(tabType, progStage) : false;

  useEffect(() => {
    if (!isTerminal || !tabType || !projectId) return;
    fetch(`/api/helix/related-by-type?projectId=${encodeURIComponent(projectId)}&tabType=${encodeURIComponent(tabType)}&entryId=${encodeURIComponent(entry.id)}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.entries)) setHandoffEntries(d.entries.slice(0, 4)); })
      .catch(() => { /* ignore */ });
  }, [isTerminal, tabType, entry.id, projectId]);

  // Wave 3-B: Generate tab-specific Jarvis context when activeSpecTab changes (R12 — fetched once at focus-open per tab)
  useEffect(() => {
    tabCtxAbort.current?.abort();
    if (!activeSpecTab || !activeTabData) {
      setTabContext(null);
      setTabCtxLoading(false);
      return;
    }
    setTabCtxLoading(true);
    setTabContext(null);
    const abort = new AbortController();
    tabCtxAbort.current = abort;
    const prompt = `You are a specialized intelligence digest generator. Given the following ${activeSpecTab.toUpperCase()} tab data for the entry "${entry.query}", generate a precise 150-word context summary that a financial/strategy AI assistant (Jarvis) will use to answer questions about this specific tab.\n\nTab data:\n${JSON.stringify(activeTabData, null, 2).slice(0, 1500)}\n\nReturn ONLY the 150-word digest. No headers, no meta-commentary.`;
    fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode: "chat" }),
      signal: abort.signal,
    }).then(async res => {
      if (!res.ok || !res.body) { setTabCtxLoading(false); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "", acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const ln of lines) {
          if (!ln.trim()) continue;
          try { const ev = JSON.parse(ln); if (ev.type === "delta" && ev.text) acc += ev.text; } catch { /* partial */ }
        }
      }
      setTabContext(acc.trim().slice(0, 800));
      setTabCtxLoading(false);
    }).catch(err => {
      if ((err as { name?: string }).name !== "AbortError") setTabCtxLoading(false);
    });
    return () => abort.abort();
  }, [activeSpecTab]);

  // Wave 3-D: Live data streaming — setInterval with cleanup (R14 — 60s minimum)
  useEffect(() => {
    if (streamTimerRef.current) { clearInterval(streamTimerRef.current); streamTimerRef.current = null; }
    const streamCfg = (activeTabData as (AnyTabData & { streaming?: { interval: number; refreshFn: () => Promise<Partial<AnyTabData>> } }) | null)?.streaming;
    if (!streamCfg) { setLiveTabData(null); return; }
    const interval = Math.max(60000, streamCfg.interval);
    const timer = setInterval(() => {
      streamCfg.refreshFn().then(partial => setLiveTabData(prev => ({ ...(prev ?? {}), ...partial }))).catch(() => { /* ignore */ });
    }, interval);
    streamTimerRef.current = timer;
    return () => { clearInterval(timer); streamTimerRef.current = null; };
  }, [activeSpecTab, activeTabData]);

  const fireAction = (key: string) => {
    if (key === "lock")        { onLock(); }
    else if (key === "fork")        { onFork?.(); }
    else if (key === "redteam")     { onRedTeam(); }
    else if (key === "triangulate") { onTriangulate(); }
    else if (key === "priorart")    { onScan?.(); }
    else if (key === "develop")     { onDevelop?.(); }
    else if (key === "trace")       { onTrace?.(); }
    else if (key === "probe")       { onProbe?.(); }
    else if (key === "void")        { onVoid(); }
    setActiveAction(null);
  };

  const actionList = [
    { key: "lock",        show: !entry.locked },
    { key: "fork",        show: !!onFork },
    { key: "redteam",     show: true },
    { key: "triangulate", show: true },
    { key: "priorart",    show: !!onScan },
    { key: "develop",     show: !!onDevelop },
    { key: "trace",       show: !!onTrace },
    { key: "probe",       show: !!onProbe },
    { key: "void",        show: !entry.locked },
  ].filter(a => a.show);

  const isLoading = (key: string) =>
    (key === "triangulate" && triangulating) || (key === "develop" && developing) ||
    (key === "trace" && tracing) || (key === "fork" && forking) || (key === "priorart" && scanning);

  return createPortal(
    <div className="hxf5-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hxf5-panel" style={{ "--sc": meta.color } as React.CSSProperties}>

        {/* HEADER */}
        <div className="hxf5-hdr">
          <button className="hxf5-back" onClick={onClose}>← Back</button>
          <span className="hxf5-sdot" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
          <span className="hxf5-slbl" style={{ color: meta.color }}>{meta.label}</span>
          {isContradicted  && <span className="hxf5-chip hxf5-chip--conflict">⚡ Conflict</span>}
          {isProbeSource   && <span className="hxf5-chip hxf5-chip--probe">◈ Probing</span>}
          {!!entry.locked  && <span className="hxf5-chip hxf5-chip--lock">⊕ Locked</span>}
          {/* Folder chip */}
          {folders.length > 0 && (() => {
            const folder = entry.folder_id ? folders.find(f => f.id === entry.folder_id) : null;
            return (
              <div className="hxf5-folder-group" ref={folderRef}>
                <button
                  className="hxf5-folder-chip"
                  style={{ "--fc": folder?.color ?? "#4a9eff" } as React.CSSProperties}
                  onClick={() => setShowFolderMove(v => !v)}
                  title="Move to folder"
                >
                  {folder ? <>{folder.icon} {folder.name}</> : <>◈ No folder</>}
                </button>
                {showFolderMove && (
                  <div className="hxf5-folder-popover">
                    <div className="hxf5-folder-pop-title">Move to folder</div>
                    <button
                      className={`hxf5-folder-pop-opt${!entry.folder_id ? " sel" : ""}`}
                      onClick={() => { onMoveToFolder?.(entry.id, null); setShowFolderMove(false); }}
                    >◈ No folder</button>
                    {folders.map(f => (
                      <button
                        key={f.id}
                        className={`hxf5-folder-pop-opt${entry.folder_id === f.id ? " sel" : ""}`}
                        style={{ "--fc": f.color } as React.CSSProperties}
                        onClick={() => { onMoveToFolder?.(entry.id, f.id); setShowFolderMove(false); }}
                      >{f.icon} {f.name}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Tab type chip — shown when entry has been classified */}
          {entry.tab_primary && entry.tab_primary !== "research" && (() => {
            const tm = TAB_TYPE_META[entry.tab_primary];
            return (
              <div className="hxf5-tab-type-group" ref={whyRef}>
                <span
                  className="hxf5-tab-chip"
                  style={{ "--tab-color": tm.color } as React.CSSProperties}
                >
                  {tm.icon} {tm.label}
                  {entry.tab_meta && (
                    <span className="hxf5-conf-pct">{Math.round((entry.tab_meta.confidence ?? 0) * 100)}%</span>
                  )}
                </span>
                {entry.tab_meta?.signals && entry.tab_meta.signals.length > 0 && (
                  <button
                    className="hxf5-why-btn"
                    onClick={() => setShowWhyPopover(v => !v)}
                    title="Why this tab type?"
                  >why?</button>
                )}
                {showWhyPopover && entry.tab_meta && (
                  <div className="hxf5-why-popover">
                    <div className="hxf5-why-title">Detected signals</div>
                    <div className="hxf5-why-signals">
                      {entry.tab_meta.signals.slice(0, 8).map((s, i) => (
                        <span key={i} className="hxf5-signal-chip">
                          <span className="hxf5-signal-text">{s.text}</span>
                          <span className="hxf5-signal-role">{s.role}</span>
                        </span>
                      ))}
                    </div>
                    <div className="hxf5-why-conf">
                      Confidence: {Math.round((entry.tab_meta.confidence ?? 0) * 100)}%
                      {entry.tab_meta.metadata && Object.keys(entry.tab_meta.metadata).length > 0 && (
                        <span style={{ marginLeft: 8, color: "rgba(140,175,220,0.5)" }}>
                          {entry.tab_meta.primary ?? ""}
                        </span>
                      )}
                    </div>
                    {!showFocusTabPicker ? (
                      <button
                        className="hxf5-why-override"
                        onClick={() => setShowFocusTabPicker(true)}
                      >Override type</button>
                    ) : (
                      <TabTypePicker
                        onSelect={applyFocusTabTypeOverride}
                        onCancel={() => setShowFocusTabPicker(false)}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          <h2 className="hxf5-title">{entry.query}</h2>
          <div className="hxf5-mode-tabs">
            {/* INTELLIGENCE tab — always index 0, never hidden (R10) */}
            <button
              className={`hxf5-mode-tab${activeSpecTab === null ? " on" : ""}`}
              onClick={() => setActiveSpecTab(null)}
            >⬡ Intelligence</button>
            {/* Specialized tabs — max 2 (R9) */}
            {specTabs.map((tab, i) => {
              const tm = TAB_TYPE_META[(tab.type as keyof typeof TAB_TYPE_META)] ?? { icon: "◆", label: tab.type };
              return (
                <button
                  key={i}
                  className={`hxf5-mode-tab${activeSpecTab === tab.type ? " on" : ""}`}
                  onClick={() => setActiveSpecTab(tab.type ?? null)}
                  style={{ "--tab-color": tm.color } as React.CSSProperties}
                >{tm.icon} {tm.label}</button>
              );
            })}
            {/* Briefing/Summary sub-tabs only when INTELLIGENCE is active */}
            {activeSpecTab === null && <>
              <span className="hxf5-mode-sep">|</span>
              <button
                className={`hxf5-mode-tab hxf5-mode-tab--sub${!summaryView ? " on" : ""}`}
                onClick={() => setSummaryView(false)}
              >Briefing</button>
              <button
                className={`hxf5-mode-tab hxf5-mode-tab--sub${summaryView ? " on" : ""}`}
                onClick={() => setSummaryView(true)}
              >Summary</button>
            </>}
          </div>
          {/* Progression strip — shown when entry has a classified tab type (Wave 3-A + 3-C) */}
          {tabType && tabType !== "research" && (() => {
            const stages = PROGRESSIONS[tabType] ?? PROGRESSIONS.generic;
            const stageIdx = getStageIndex(tabType, progStage);
            const stageCount = getStageCount(tabType);
            const nextAct = !isTerminal ? getNextAction(tabType, progStage) : null;
            return (
              <div className="hxf5-prog-strip">
                <div className="hxf5-prog-stages">
                  {stages.map((s, i) => (
                    <span key={s} className={`hxf5-prog-stage${i <= stageIdx ? " done" : ""}${i === stageIdx ? " current" : ""}`}>
                      {s}
                    </span>
                  ))}
                  <span className="hxf5-prog-count">{stageIdx + 1}/{stageCount}</span>
                </div>
                {isTerminal ? (
                  <div className="hxf5-handoff-strip">
                    <span className="hxf5-handoff-lbl">✓ Complete — related entries:</span>
                    {handoffEntries.length === 0 && <span className="hxf5-handoff-empty">none found</span>}
                    {handoffEntries.map(e => (
                      <span key={e.id} className="hxf5-handoff-chip" title={e.query}>
                        {(TAB_TYPE_META[e.tab_primary as keyof typeof TAB_TYPE_META]?.icon ?? "◆")} {e.query.slice(0, 28)}…
                      </span>
                    ))}
                  </div>
                ) : nextAct ? (
                  <div className="hxf5-next-strip">
                    <span className="hxf5-next-lbl">Next:</span>
                    <button
                      className="hxf5-next-chip"
                      onClick={() => fireAction(nextAct.action === "prior-art" ? "priorart" : nextAct.action)}
                      title={nextAct.description}
                    >{nextAct.label}</button>
                    <span className="hxf5-next-desc">{nextAct.description}</span>
                  </div>
                ) : null}
              </div>
            );
          })()}
          <time className="hxf5-hdr-time">{formatTime(entry.created_at)}</time>
          <button className="hxf5-close" onClick={onClose}>✕</button>
        </div>

        {/* BODY: sidebar + center + rail */}
        <div className="hxf5-body">

          {/* LEFT SIDEBAR — vitals top, Jarvis chat bottom */}
          <aside className="hxf5-sidebar">
            <div className="hxf5-sb-arc"><ConfArc v={entry.confidence} size={88} /></div>
            <div className="hxf5-sb-grade" style={{ color: cColor(entry.confidence) }}>{qg.grade}</div>
            <div className="hxf5-sb-qlbl">Quality · {Math.round(qg.score)}pts</div>
            <div className="hxf5-sb-divider" />
            <div className="hxf5-sb-kv">
              <div className="hxf5-sb-row">
                <span className="hxf5-sb-k">Freshness</span>
                <span className="hxf5-sb-v" style={{ color: freshnessColor(fresh) }}>{Math.round(fresh * 100)}%</span>
              </div>
              <div className="hxf5-sb-row">
                <span className="hxf5-sb-k">Decay</span>
                <span className="hxf5-sb-v" style={{ color: "#ffe14a" }}>−{decay}/hr</span>
              </div>
              <div className="hxf5-sb-row">
                <span className="hxf5-sb-k">Age</span>
                <span className="hxf5-sb-v">{ageH.toFixed(1)}h</span>
              </div>
              {isFinite(staleH) && (
                <div className="hxf5-sb-row">
                  <span className="hxf5-sb-k">Stale in</span>
                  <span className="hxf5-sb-v" style={{ color: "#ff9e4a" }}>{staleH.toFixed(0)}h</span>
                </div>
              )}
            </div>
            <div className="hxf5-sb-divider" />
            <div className="hxf5-sb-fcast-hdr">Forecast</div>
            {[{ h: "24h", v: fc.h24 }, { h: "7d", v: fc.d7 }, { h: "30d", v: fc.d30 }].map(({ h, v }) => (
              <div key={h} className="hxf5-sb-fc">
                <span className="hxf5-sb-fc-h">{h}</span>
                <div className="hxf5-sb-fc-bar">
                  <div style={{ width: `${v * 100}%`, background: cColor(v), boxShadow: `0 0 3px ${cColor(v)}55` }} />
                </div>
                <span className="hxf5-sb-fc-v" style={{ color: cColor(v) }}>{Math.round(v * 100)}</span>
              </div>
            ))}
            <SidebarJarvisChat
              entry={entry} triangulation={triangulation}
              assumptions={assumptions} risks={risks}
              meta={meta} qg={qg} fresh={fresh} decay={decay} ageH={ageH} staleH={staleH}
              onTriangulate={props.onTriangulate} onRedTeam={props.onRedTeam}
              onDevelop={props.onDevelop} onScan={props.onScan}
              onFork={props.onFork} onTrace={props.onTrace} onProbe={props.onProbe}
              onLock={props.onLock}
              triangulating={triangulating} developing={developing} scanning={scanning}
              forking={forking} tracing={tracing}
              activeTabType={activeSpecTab}
              tabContext={tabCtxLoading ? "[Jarvis is loading tab context…]" : tabContext}
              deepBrief={cachedBrief}
            />
          </aside>

          {/* CENTER — scrollable briefing, summary, or specialized tab */}
          <main className="hxf5-center">
          {activeSpecTab !== null ? (
            <SpecializedTabFactory tabType={activeSpecTab} tabData={activeTabData} />
          ) : summaryView ? (
            <SummaryPanel
              entry={entry} assumptions={assumptions} risks={risks}
              strategyOptions={strategyOptions} priorArt={priorArt}
              triangulation={triangulation}
            />
          ) : (<>

            {/* Insight Digest — NEW FEATURE 1 */}
            <section className="hxf5-section hxf5-digest">
              <div className="hxf5-sec-hdr">
                <span className="hxf5-sec-icon" style={{ color: meta.color }}>◈</span>
                <span className="hxf5-sec-title">Insight Digest</span>
                <span className="hxf5-sec-badge">{digest.length} key points</span>
              </div>
              <div className="hxf5-digest-list">
                {digest.map((b, i) => (
                  <div key={i} className={`hxf5-bullet hxf5-bullet--${b.type}`}>
                    <span className="hxf5-bullet-icon">
                      {b.type === "claim" ? "●" : b.type === "confidence" ? "◎" : b.type === "risk" ? "⚠" : b.type === "gap" ? "○" : "→"}
                    </span>
                    <span className="hxf5-bullet-text">{b.text}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Folder Context — other entries in same folder + project contribution */}
            {entry.folder_id && folders.length > 0 && (() => {
              const folder = folders.find(f => f.id === entry.folder_id);
              const siblings = allEntries.filter(e => e.id !== entry.id && e.folder_id === entry.folder_id && !e.voided).slice(0, 5);
              if (!folder) return null;
              return (
                <section className="hxf5-section hxf5-folder-ctx">
                  <div className="hxf5-sec-hdr">
                    <span className="hxf5-sec-icon" style={{ color: folder.color }}>{folder.icon}</span>
                    <span className="hxf5-sec-title">{folder.name}</span>
                    <span className="hxf5-sec-badge">{siblings.length + 1} entries in folder</span>
                  </div>
                  {siblings.length > 0 ? (
                    <ul className="hxf5-folder-ctx-list">
                      {siblings.map(s => (
                        <li key={s.id} className="hxf5-folder-ctx-item">
                          <span className="hxf5-folder-ctx-dot" style={{ background: folder.color }} />
                          <span className="hxf5-folder-ctx-q">{s.query}</span>
                          <span className="hxf5-folder-ctx-conf" style={{ color: cColor(s.confidence) }}>{Math.round(s.confidence * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hxf5-folder-ctx-empty">This is the only entry in this folder so far.</p>
                  )}
                </section>
              );
            })()}

            {/* Action Context Panel — NEW FEATURE 2 */}
            {activeAction && ACT_CTX[activeAction] && (
              <section className="hxf5-section hxf5-actctx">
                <div className="hxf5-actctx-hdr">
                  <span className="hxf5-actctx-icon" style={{ color: ACT_CTX[activeAction].color }}>{ACT_CTX[activeAction].icon}</span>
                  <div className="hxf5-actctx-text">
                    <div className="hxf5-actctx-title" style={{ color: ACT_CTX[activeAction].color }}>{ACT_CTX[activeAction].title}</div>
                    <div className="hxf5-actctx-desc">{ACT_CTX[activeAction].desc}</div>
                  </div>
                  <button className="hxf5-actctx-x" onClick={() => setActiveAction(null)}>✕</button>
                </div>
                <div className="hxf5-actctx-preview">
                  <span className="hxf5-actctx-preview-lbl">Expected output</span>
                  <span className="hxf5-actctx-preview-txt">{ACT_CTX[activeAction].preview}</span>
                </div>
                <button
                  className="hxf5-actctx-confirm"
                  style={{ borderColor: ACT_CTX[activeAction].color + "55", color: ACT_CTX[activeAction].color }}
                  onClick={() => fireAction(activeAction)}
                >
                  {isLoading(activeAction) ? <span className="hx-spin" /> : `Run ${ACT_CTX[activeAction].title} →`}
                </button>
              </section>
            )}

            {/* Intelligence — full text, readable */}
            <section className="hxf5-section hxf5-intel">
              <div className="hxf5-sec-hdr">
                <span className="hxf5-sec-icon">⬡</span>
                <span className="hxf5-sec-title">Intelligence</span>
              </div>
              <p className="hxf5-text">{entry.text}</p>
            </section>

            {/* Triangulation */}
            <section className="hxf5-section hxf5-tri">
              <div className="hxf5-sec-hdr">
                <span className="hxf5-sec-icon">△</span>
                <span className="hxf5-sec-title">Triangulation</span>
                {triangulation && (
                  <span className="hxf5-sec-badge" style={{ color: cColor(triangulation.confidence) }}>
                    {Math.round(triangulation.confidence * 100)}%
                  </span>
                )}
              </div>
              {triangulation ? (
                <>
                  <div className="hxf5-tri-bar-row">
                    <TriBar t={triangulation} />
                    <span className="hxf5-tri-counts">
                      <span style={{ color: "#4aff9e" }}>{triangulation.agree} agree</span>
                      <span style={{ color: "rgba(150,180,230,0.3)" }}> · </span>
                      <span style={{ color: "#ffe14a" }}>{triangulation.contested} contested</span>
                      <span style={{ color: "rgba(150,180,230,0.3)" }}> · </span>
                      <span style={{ color: "#ff6b6b" }}>{triangulation.oppose} oppose</span>
                    </span>
                  </div>
                  <div className="hxf5-tri-cards">
                    {([triangulation.angle_a, triangulation.angle_b, triangulation.angle_c] as { stance: string; summary: string; confidence: number }[]).map((a, i) => {
                      const sc = a.stance === "agree" ? "#4aff9e" : a.stance === "oppose" ? "#ff6b6b" : "#ffe14a";
                      return (
                        <div key={i} className="hxf5-tri-card" style={{ borderTopColor: sc }}>
                          <div className="hxf5-tri-card-top">
                            <span className="hxf5-tri-k">{String.fromCharCode(65 + i)}</span>
                            <span className="hxf5-tri-stance" style={{ color: sc }}>{a.stance}</span>
                            <div className="hxf5-tri-bar-sm"><div style={{ width: `${a.confidence * 100}%`, background: sc }} /></div>
                            <span className="hxf5-tri-pct" style={{ color: sc }}>{Math.round(a.confidence * 100)}%</span>
                          </div>
                          <p className="hxf5-tri-summary">{a.summary}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="hxf5-empty-cta">
                  <span>Not yet triangulated</span>
                  <button className="hxf5-cta-btn" onClick={onTriangulate} disabled={triangulating}>
                    {triangulating ? <span className="hx-spin" /> : "Run triangulation →"}
                  </button>
                </div>
              )}
            </section>

            {/* Assumptions */}
            {assumptions.length > 0 && (
              <section className="hxf5-section hxf5-asm">
                <div className="hxf5-sec-hdr">
                  <span className="hxf5-sec-icon">⬡</span>
                  <span className="hxf5-sec-title">Assumptions</span>
                  <span className="hxf5-sec-cnt">{assumptions.length}</span>
                </div>
                <div className="hxf5-asm-grid">
                  {assumptions.map(a => (
                    <div key={a.id} className={`hxf5-asm-card hxf5-asm-card--${a.status}`}>
                      <div className="hxf5-asm-top">
                        <span className="hxf5-asm-type">{a.assumption_type}</span>
                        <span className="hxf5-asm-sbadge">{a.status}</span>
                        <span className="hxf5-asm-conf" style={{ color: cColor(a.confidence) }}>{Math.round(a.confidence * 100)}%</span>
                      </div>
                      <p className="hxf5-asm-text">{a.text}</p>
                      <div className="hxf5-asm-bar"><div style={{ width: `${a.confidence * 100}%`, background: cColor(a.confidence) }} /></div>
                      {a.status === "active" && onChallenge && (
                        <button className="hxf5-asm-challenge" onClick={() => onChallenge(a)}>Challenge</button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Risks */}
            {risks.length > 0 && (
              <section className="hxf5-section hxf5-risks">
                <div className="hxf5-sec-hdr">
                  <span className="hxf5-sec-icon">⚠</span>
                  <span className="hxf5-sec-title">Risk Matrix</span>
                  <span className="hxf5-sec-cnt">{risks.length}</span>
                </div>
                <div className="hxf5-risk-layout">
                  <RiskMini risks={risks} />
                  <div className="hxf5-risk-list">
                    {risks.slice(0, 8).map(r => {
                      const rc = r.severity === "high" ? "#ff6b6b" : r.severity === "medium" ? "#ff9e4a" : "#ffe14a";
                      return (
                        <div key={r.id} className="hxf5-risk-item">
                          <span className="hxf5-risk-sev" style={{ color: rc, borderColor: rc + "44" }}>{r.severity}</span>
                          <span className="hxf5-risk-text">{r.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            {/* Confidence Timeline */}
            <section className="hxf5-section hxf5-timeline">
              <div className="hxf5-sec-hdr">
                <span className="hxf5-sec-icon">◷</span>
                <span className="hxf5-sec-title">Confidence Timeline</span>
              </div>
              <Spark entry={entry} tri={triangulation} />
              <div className="hxf5-decay-strip">
                <span>decay −{decay}/hr</span>
                <span className="hxf5-decay-dot">·</span>
                <span>age {ageH.toFixed(1)}h</span>
                {isFinite(staleH) && <>
                  <span className="hxf5-decay-dot">·</span>
                  <span style={{ color: "#ff9e4a" }}>stale in ~{staleH.toFixed(0)}h</span>
                </>}
              </div>
            </section>

            {/* Connection Graph — lazy mounted after 380ms */}
            {allEntries.length > 1 && (
              <section className="hxf5-section hxf5-graph">
                <div className="hxf5-sec-hdr">
                  <span className="hxf5-sec-icon">◎</span>
                  <span className="hxf5-sec-title">Connection Graph</span>
                  <span className="hxf5-sec-badge">{related(entry, allEntries).length} links</span>
                </div>
                {showGraph
                  ? <Graph entry={entry} allEntries={allEntries} w={580} h={280} />
                  : <div className="hxf5-graph-loading"><span className="hx-spin" /><span>Building graph…</span></div>
                }
              </section>
            )}

            {/* Prior Art */}
            {priorArt && (
              <section className="hxf5-section hxf5-prior">
                <div className="hxf5-sec-hdr">
                  <span className="hxf5-sec-icon">◉</span>
                  <span className="hxf5-sec-title">Prior Art</span>
                  <span className="hxf5-sec-cnt">{(priorArt.gaps.items?.length ?? 0) + (priorArt.exists.items?.length ?? 0) + (priorArt.failures.items?.length ?? 0)}</span>
                </div>
                <div className="hxf5-prior-grid">
                  {(priorArt.gaps.items ?? []).map((item, i) => (
                    <div key={i} className="hxf5-prior-item hxf5-prior-item--gap"><span className="hxf5-prior-tag">GAP</span><span>{item.gap}</span></div>
                  ))}
                  {(priorArt.exists.items ?? []).map((item, i) => (
                    <div key={i} className="hxf5-prior-item hxf5-prior-item--exists"><span className="hxf5-prior-tag">EXISTS</span><span>{item.name}</span></div>
                  ))}
                  {(priorArt.failures.items ?? []).map((item, i) => (
                    <div key={i} className="hxf5-prior-item hxf5-prior-item--failed"><span className="hxf5-prior-tag">FAILED</span><span>{item.what}</span></div>
                  ))}
                </div>
              </section>
            )}

            {/* Strategy Options */}
            {strategyOptions && (
              <section className="hxf5-section hxf5-strategy">
                <div className="hxf5-sec-hdr">
                  <span className="hxf5-sec-icon">⊞</span>
                  <span className="hxf5-sec-title">Strategy Options</span>
                  <span className="hxf5-sec-cnt">{strategyOptions.options.length}</span>
                </div>
                <div className="hxf5-strategy-cards">
                  {strategyOptions.options.map((opt, i) => (
                    <div key={i} className="hxf5-strategy-card">
                      <div className="hxf5-sc-hdr">
                        <span className="hxf5-sc-letter">{String.fromCharCode(65 + i)}</span>
                        <span className="hxf5-sc-title">{opt.title}</span>
                        <span className="hxf5-sc-conf" style={{ color: cColor(opt.confidence) }}>{Math.round(opt.confidence * 100)}%</span>
                      </div>
                      <p className="hxf5-sc-rationale">{opt.rationale}</p>
                      {opt.risks.length > 0 && (
                        <div className="hxf5-sc-risks">{opt.risks.map((r, j) => <span key={j} className="hxf5-sc-risk">⚠ {r}</span>)}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

          </>)}
          </main>

          {/* RIGHT ACTION RAIL */}
          <nav className="hxf5-rail">
            <div className="hxf5-rail-hdr">Actions</div>
            {actionList.map(({ key }) => {
              const ctx  = ACT_CTX[key];
              const isAct = activeAction === key;
              const isLd  = isLoading(key);
              return (
                <button
                  key={key}
                  className={`hxf5-act-card${isAct ? " hxf5-act-card--on" : ""}${key === "void" ? " hxf5-act-card--danger" : ""}`}
                  style={{ "--act-c": ctx.color } as React.CSSProperties}
                  onClick={() => setActiveAction(isAct ? null : key)}
                  title={ctx.desc}
                >
                  <span className="hxf5-act-icon">{isLd ? <span className="hx-spin" /> : ctx.icon}</span>
                  <div className="hxf5-act-body">
                    <div className="hxf5-act-name">{ctx.title}</div>
                    <div className="hxf5-act-hint">{ctx.desc}</div>
                  </div>
                  <span className="hxf5-act-arr">›</span>
                </button>
              );
            })}
          </nav>

        </div>
      </div>
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION PANEL — floating portal triggered by single ··· button
// ═══════════════════════════════════════════════════════════════════════════════
interface APProps {
  props: EntryCardProps;
  anchorRect: DOMRect;
  onClose: () => void;
}

function ActionPanel({ props, anchorRect, onClose }: APProps) {
  const {
    entry, onLock, onVoid, onRedTeam, onTriangulate,
    onDevelop, onTrace, onFork, onScan, onProbe,
    triangulating = false, developing = false, tracing = false,
    forking = false, scanning = false, isProbeSource = false,
  } = props;

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onMD  = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("mousedown", onMD), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMD);
    };
  }, [onClose]);

  const act = (fn?: () => void) => { fn?.(); onClose(); };

  const top  = anchorRect.bottom + window.scrollY + 6;
  const right = window.innerWidth - anchorRect.right;

  return createPortal(
    <div
      ref={panelRef}
      className="hxv4-ap"
      style={{ position: "fixed", top: anchorRect.bottom + 6, right, zIndex: 9999 }}
    >
      <div className="hxv4-ap-hdr">
        <span className="hxv4-ap-title">Entry actions</span>
        <button className="hxv4-ap-close" onClick={onClose}>✕</button>
      </div>

      <div className="hxv4-ap-cat">Preserve</div>
      {!entry.locked && (
        <div className="hxv4-ap-row" onClick={() => act(onLock)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(74,255,158,0.6)" }} />
          <span className="hxv4-ap-icon">⊕</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Lock to Vault</div>
            <div className="hxv4-ap-desc">Preserve this entry permanently</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}
      {onFork && (
        <div className="hxv4-ap-row" onClick={() => act(onFork)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(74,158,255,0.6)" }} />
          <span className="hxv4-ap-icon">{forking ? <span className="hx-spin" /> : "⎇"}</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Fork entry</div>
            <div className="hxv4-ap-desc">Branch as a new hypothesis</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}

      <div className="hxv4-ap-cat">Intelligence</div>
      {props.onDeepBrief && (
        <div className="hxv4-ap-row hxv4-ap-row--brief" onClick={() => { props.onDeepBrief!(); onClose(); }}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(196,181,253,0.7)" }} />
          <span className="hxv4-ap-icon">✦</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Jarvis Brief</div>
            <div className="hxv4-ap-desc">Full intelligence report — analysis, findings, next steps</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}
      <div className="hxv4-ap-row" onClick={() => act(onRedTeam)}>
        <div className="hxv4-ap-stripe" style={{ background: "rgba(255,90,90,0.6)" }} />
        <span className="hxv4-ap-icon">⚔</span>
        <div className="hxv4-ap-info">
          <div className="hxv4-ap-name">Red team</div>
          <div className="hxv4-ap-desc">Attack and stress-test assumptions</div>
        </div>
        <span className="hxv4-ap-arr">›</span>
      </div>
      <div className="hxv4-ap-row" onClick={() => act(onTriangulate)}>
        <div className="hxv4-ap-stripe" style={{ background: "rgba(74,158,255,0.6)" }} />
        <span className="hxv4-ap-icon">{triangulating ? <span className="hx-spin" /> : "△"}</span>
        <div className="hxv4-ap-info">
          <div className="hxv4-ap-name">Triangulate</div>
          <div className="hxv4-ap-desc">Run 3-angle peer validation</div>
        </div>
        <span className="hxv4-ap-arr">›</span>
      </div>
      {onScan && (
        <div className="hxv4-ap-row" onClick={() => act(onScan)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(160,74,255,0.6)" }} />
          <span className="hxv4-ap-icon">{scanning ? <span className="hx-spin" /> : "◉"}</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Prior art</div>
            <div className="hxv4-ap-desc">Find existing evidence and gaps</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}

      <div className="hxv4-ap-cat">Development</div>
      {onDevelop && (
        <div className="hxv4-ap-row" onClick={() => act(onDevelop)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(255,215,74,0.6)" }} />
          <span className="hxv4-ap-icon">{developing ? <span className="hx-spin" /> : "⊞"}</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Develop strategy</div>
            <div className="hxv4-ap-desc">Generate strategic options</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}
      {onTrace && (
        <div className="hxv4-ap-row" onClick={() => act(onTrace)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(74,200,255,0.6)" }} />
          <span className="hxv4-ap-icon">{tracing ? <span className="hx-spin" /> : "⊳"}</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Trace lineage</div>
            <div className="hxv4-ap-desc">Show entry source chain</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}

      <div className="hxv4-ap-cat">Risk</div>
      {onProbe && (
        <div className="hxv4-ap-row" onClick={() => act(onProbe)}>
          <div className="hxv4-ap-stripe" style={{ background: isProbeSource ? "rgba(74,255,240,0.7)" : "rgba(255,140,60,0.6)" }} />
          <span className="hxv4-ap-icon">◈</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Probe</div>
            <div className="hxv4-ap-desc">{isProbeSource ? "Live monitoring active" : "Live-monitor for contradictions"}</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}
      {!entry.locked && (
        <div className="hxv4-ap-row" onClick={() => act(onVoid)}>
          <div className="hxv4-ap-stripe" style={{ background: "rgba(180,60,60,0.55)" }} />
          <span className="hxv4-ap-icon">↓</span>
          <div className="hxv4-ap-info">
            <div className="hxv4-ap-name">Void entry</div>
            <div className="hxv4-ap-desc">Mark invalidated, hide from view</div>
          </div>
          <span className="hxv4-ap-arr">›</span>
        </div>
      )}
    </div>,
    document.body
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// v5 HELPER COMPONENTS — Helix UI System v2 reference design
// ═══════════════════════════════════════════════════════════════════════════════

// Square confidence pips (filled squares matching reference)
function ConfidencePips({ v, max = 10 }: { v: number; max?: number }) {
  const filled = Math.round(v * max);
  const color  = cColor(v);
  return (
    <span className="hxv5-pips">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`hxv5-pip${i < filled ? " on" : ""}`}
          style={i < filled ? { background: color, boxShadow: `0 0 2px ${color}` } : undefined} />
      ))}
    </span>
  );
}

// Fresh badge — fresh / aging / stale / decay
function FreshBadge({ v }: { v: number }) {
  const label = v > 0.8 ? "fresh" : v > 0.5 ? "aging" : v > 0.25 ? "stale" : "decay";
  const color = freshnessColor(v);
  return (
    <span className="hxv5-fresh-badge" style={{ color, borderColor: color + "40" }}>{label}</span>
  );
}

// Quality metrics grid — X.X/10 scores
function QualityMetrics({ conf, fresh, tri, assumptions }: {
  conf: number; fresh: number; tri?: Triangulation; assumptions: Assumption[];
}) {
  const srcQ = Math.min(10, tri ? tri.confidence * 10 : conf * 9.2);
  const rec  = Math.min(10, fresh * 10);
  const rel  = Math.min(10, conf * 10);
  const con  = assumptions.length
    ? Math.min(10, assumptions.reduce((s, a) => s + a.confidence, 0) / assumptions.length * 10)
    : Math.min(10, conf * 9.0);
  return (
    <div className="hxv5-quality-grid">
      {([["Source Quality", srcQ], ["Recency", rec], ["Relevance", rel], ["Consistency", con]] as [string, number][]).map(([label, value]) => (
        <div key={label} className="hxv5-quality-row">
          <span className="hxv5-quality-lbl">{label}</span>
          <span className="hxv5-quality-val" style={{ color: cColor(value / 10) }}>{value.toFixed(1)}/10</span>
        </div>
      ))}
    </div>
  );
}

// Trend preview — sparkline with % change label
function TrendPreview({ entry, tri }: { entry: HelixEntry; tri?: Triangulation }) {
  const start = entry.original_confidence ?? entry.confidence;
  const end   = entry.confidence;
  const pct   = ((end - start) / (start || 0.01)) * 100;
  const color = pct >= 0 ? "#4aff9e" : "#ff6b6b";
  const W = 180, H = 44;
  const pts = [start, ...(tri ? [tri.confidence] : []), end];
  const mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 0.02;
  const xs = pts.map((_, i) => 4 + (i / (pts.length - 1)) * (W - 8));
  const ys = pts.map(v => H - 6 - ((v - mn) / rng) * (H - 14));
  const path     = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  const fillPath = `${path} L ${xs[xs.length - 1].toFixed(1)} ${H} L ${xs[0].toFixed(1)} ${H} Z`;
  return (
    <div className="hxv5-trend">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={`tg5-${entry.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill={`url(#tg5-${entry.id})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round"
          strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${color}88)` }} />
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </svg>
      <div className="hxv5-trend-footer">
        <span style={{ color, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 15, fontWeight: 900 }}>
          {pct >= 0 ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
        </span>
        <span className="hxv5-trend-period">30D</span>
      </div>
    </div>
  );
}

// Timeline snapshot — horizontal event dots with labels
function TimelineSnap({ entry, tri }: { entry: HelixEntry; tri?: Triangulation }) {
  const fmtShort = (d: string) => {
    try { return new Date(d).toLocaleDateString("en-US", { month: "short", year: "2-digit" }); } catch { return "—"; }
  };
  const events: { date: string; label: string; note: string }[] = [
    { date: entry.created_at, label: "Created",
      note: `${Math.round((entry.original_confidence ?? entry.confidence) * 100)}% conf` },
  ];
  if (tri) events.push({ date: new Date().toISOString(), label: "Triangulated",
    note: `${tri.agree}A / ${tri.contested}C / ${tri.oppose}O` });
  events.push({ date: new Date().toISOString(), label: "Now",
    note: `${Math.round(entry.confidence * 100)}% conf` });
  return (
    <div className="hxv5-tlsnap">
      <div className="hxv5-tlsnap-track" />
      {events.map((ev, i) => {
        const pct = events.length === 1 ? 50 : (i / (events.length - 1)) * 92 + 4;
        return (
          <div key={i} className="hxv5-tlsnap-node" style={{ left: `${pct}%` }}>
            <div className="hxv5-tlsnap-evname">{ev.label}</div>
            <div className="hxv5-tlsnap-date">{fmtShort(ev.date)}</div>
            <div className="hxv5-tlsnap-dot" />
            <div className="hxv5-tlsnap-note">{ev.note}</div>
          </div>
        );
      })}
    </div>
  );
}

// Sentiment widget — derived from tri or confidence
function SentimentWidget({ entry, tri }: { entry: HelixEntry; tri?: Triangulation }) {
  const s = (() => {
    if (tri) {
      const total = tri.agree + tri.contested + tri.oppose || 1;
      const score = (tri.agree - tri.oppose) / total;
      if (score > 0.25)  return { label: "POSITIVE", pct: 0.65 + score * 0.3, color: "#4aff9e" };
      if (score < -0.25) return { label: "NEGATIVE", pct: Math.max(0.05, 0.35 + score * 0.3), color: "#ff6b6b" };
      return { label: "NEUTRAL", pct: 0.5, color: "#ffe14a" };
    }
    const c = entry.confidence;
    if (c >= 0.8) return { label: "POSITIVE", pct: 0.72, color: "#4aff9e" };
    if (c >= 0.6) return { label: "NEUTRAL",  pct: 0.5,  color: "#ffe14a" };
    return { label: "NEGATIVE", pct: 0.32, color: "#ff6b6b" };
  })();
  return (
    <div className="hxv5-sentiment">
      <div className="hxv5-sentiment-bar">
        <div className="hxv5-sentiment-fill"
          style={{ width: `${s.pct * 100}%`, background: s.color, boxShadow: `0 0 8px ${s.color}44` }} />
        <div className="hxv5-sentiment-zero" />
      </div>
      <span className="hxv5-sentiment-lbl" style={{ color: s.color }}>• {s.label}</span>
    </div>
  );
}

// Derive tags from strand + query keywords
function deriveTags(entry: HelixEntry): string[] {
  const stop = new Set(["about", "what", "which", "their", "there", "would", "could", "should", "have", "that", "this", "with", "from", "when", "will", "been", "does", "market", "current", "state"]);
  const words = entry.query.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 4 && !stop.has(w));
  return [entry.strand, ...new Set(words)].slice(0, 7);
}

// Evidence chain — numbered steps from tri angles or assumptions
function EvidenceChain({ entry, tri, assumptions }: { entry: HelixEntry; tri?: Triangulation; assumptions: Assumption[] }) {
  const fmt = (d: string) => { try { return new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric" }); } catch { return "—"; } };
  const stC = (s: string) => s === "agree" ? "#4aff9e" : s === "oppose" ? "#ff6b6b" : "#ffe14a";
  const steps: { num: string; event: string; note: string; date: string; color?: string }[] = [];
  if (tri) {
    ([tri.angle_a, tri.angle_b, tri.angle_c] as { stance: string; summary: string; confidence: number }[]).forEach((a, i) => {
      steps.push({ num: String(i + 1).padStart(2, "0"), date: fmt(new Date().toISOString()),
        event: `Angle ${String.fromCharCode(65 + i)} — ${a.stance.charAt(0).toUpperCase() + a.stance.slice(1)}`,
        note: a.summary.slice(0, 72) + (a.summary.length > 72 ? "…" : ""), color: stC(a.stance) });
    });
  } else {
    steps.push({ num: "01", event: "Entry created", date: fmt(entry.created_at),
      note: `Initial confidence: ${Math.round((entry.original_confidence ?? entry.confidence) * 100)}%` });
    assumptions.slice(0, 4).forEach((a, i) => steps.push({
      num: String(i + 2).padStart(2, "0"), event: `${a.assumption_type} assumption`,
      note: a.text.slice(0, 60) + (a.text.length > 60 ? "…" : ""),
      date: fmt(new Date().toISOString()), color: cColor(a.confidence) }));
    steps.push({ num: String(steps.length + 1).padStart(2, "0"), event: "Current state",
      note: `Confidence: ${Math.round(entry.confidence * 100)}%`, date: fmt(new Date().toISOString()) });
  }
  return (
    <div className="hxv5-evchain">
      {steps.map((s, i) => (
        <div key={i} className="hxv5-evchain-row">
          <div className="hxv5-evchain-left">
            <div className="hxv5-evchain-num" style={s.color ? { color: s.color, borderColor: s.color + "44" } : undefined}>{s.num}</div>
            {i < steps.length - 1 && <div className="hxv5-evchain-connector" />}
          </div>
          <div className="hxv5-evchain-body">
            <div className="hxv5-evchain-event">{s.event}</div>
            <div className="hxv5-evchain-note">{s.note}</div>
          </div>
          <div className="hxv5-evchain-date">{s.date}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRY CARD — Phase 4 (v5 visual refresh)
// ═══════════════════════════════════════════════════════════════════════════════
export function EntryCard(props: EntryCardProps) {
  const {
    entry, allEntries = [], assumptions = [], risks = [],
    strategyOptions = null, priorArt = null, triangulation,
    onLock, onVoid, onRedTeam, onTriangulate,
    onDevelop, onTrace, onFork, onScan, onProbe, onChallenge, onFocus,
    triangulating = false, developing = false, tracing = false, forking = false, scanning = false,
    formatTime, isContradicted = false, isProbeSource = false, isProbeLinked = false,
    onTabTypeChanged, hasBrief = false, projectId, folders = [], onMoveToFolder,
  } = props;

  const [state, setState]             = useState<CardState>("compact");
  const [mode, setMode]               = useState<InfoMode>("analysis");
  const [apOpen, setApOpen]           = useState(false);
  const [apRect, setApRect]           = useState<DOMRect | null>(null);
  const [tabConfirmDismissed, setTabConfirmDismissed] = useState(false);
  const [showTabPicker, setShowTabPicker]             = useState(false);

  const applyTabTypeOverride = async (newType: string) => {
    try {
      await fetch(`/api/helix/entry/${entry.id}/tab-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab_primary: newType }),
      });
      setTabConfirmDismissed(true);
      setShowTabPicker(false);
      onTabTypeChanged?.(entry.id, newType);
    } catch { /* ignore */ }
  };

  // Confidence gate: show when classification confidence is 0.60–0.80
  // Below 0.60 → show inline type picker. Above 0.80 → silent.
  const tabConf = entry.tab_meta?.confidence ?? null;
  const showConfGate = !tabConfirmDismissed && entry.tab_primary && entry.tab_primary !== "research"
    && tabConf !== null && tabConf < 0.80;

  const meta    = STRAND_META[entry.strand as Strand] ?? STRAND_META.evidence;
  const fresh   = entry.freshness;
  const triN    = triangulation ? triangulation.agree + triangulation.contested + triangulation.oppose : 0;
  const qg      = qualityGrade(entry.confidence, fresh, assumptions, triangulation);
  const fc      = confForecast(entry.confidence, entry.strand);
  const confColor = cColor(entry.confidence);
  const decay     = ({ evidence: 0.005, strategy: 0.001, construction: 0.02, memory: 0.0002, signal: 0.1, synthesis: 0 } as Record<string, number>)[entry.strand] ?? 0.005;
  const ageH      = (Date.now() - new Date(entry.created_at).getTime()) / 3_600_000;
  const hoursLeft = decay > 0 ? Math.max(0, 0.8 / decay - ageH) : Infinity;

  const openAP = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setApRect(rect);
    setApOpen(p => !p);
  }, []);

  const cls = [
    "hxcard",
    `hxcard--${state}`,
    !!entry.locked      ? "hxcard--locked"   : "",
    isContradicted      ? "hxcard--conflict"  : "",
    isProbeSource       ? "hxcard--probe"     : "",
    isProbeLinked       ? "hxcard--linked"    : "",
  ].filter(Boolean).join(" ");

  const freshLabel = fresh > 0.8 ? "FRESH" : fresh > 0.5 ? "AGING" : fresh > 0.25 ? "STALE" : "DECAY";

  return (
    <>
      <article className={cls} style={{ "--sc": meta.color } as React.CSSProperties} onMouseEnter={onFocus}>
        <div className="hxcard-stripe" />
        <div className="hxcard-body">

          {/* ═══════════ COMPACT ═══════════ */}
          {state === "compact" && (
            <div className="hxv5-compact" onClick={() => setState("expanded")}>
              <div className="hxv5-c-hdr">
                <span className="hxv5-sdot" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
                <span className="hxv5-strand" style={{ color: meta.color }}>{meta.label.toUpperCase()}</span>
                <ConfidencePips v={entry.confidence} />
                <span className="hxv5-cpct" style={{ color: confColor }}>{Math.round(entry.confidence * 100)}%</span>
                <FreshBadge v={fresh} />
                {!!entry.locked  && <span className="hxv5-status-tag hxv5-status-tag--lock">⊕</span>}
                {isContradicted  && <span className="hxv5-status-tag hxv5-status-tag--conf">⚡ CONFLICT</span>}
                {isProbeSource   && <span className="hxv5-status-tag hxv5-status-tag--probe">◈</span>}
                {(entry.tab_primary as string)?.startsWith("synthesis-") && (
                  <span className="hxv5-status-tag hxv5-status-tag--synth">⊞ SYNTHESIS</span>
                )}
                {entry.folder_id && folders.length > 0 && (() => {
                  const f = folders.find(x => x.id === entry.folder_id);
                  return f ? <span className="hxv5-folder-badge" style={{ "--fc": f.color } as React.CSSProperties}>{f.icon} {f.name}</span> : null;
                })()}
                <time className="hxv5-time">{formatTime(entry.created_at)}</time>
              </div>
              <div className="hxv5-c-query">{entry.query}</div>
              <div className="hxv5-c-preview">{entry.text.slice(0, 120)}{entry.text.length > 120 ? "…" : ""}</div>
              {props.onDeepBrief && (
                <button
                  className="hxv5-brief-btn"
                  onClick={e => { e.stopPropagation(); props.onDeepBrief!(); }}
                  title="Open Jarvis Intelligence Brief"
                >✦ Brief</button>
              )}
              {showConfGate && (
                <div className="hxv5-conf-gate" onClick={e => e.stopPropagation()}>
                  {tabConf! >= 0.60 && !showTabPicker ? (
                    <>
                      <span className="hxv5-conf-gate-label">
                        {TAB_TYPE_META[entry.tab_primary!]?.icon} Looks like {TAB_TYPE_META[entry.tab_primary!]?.label} — right?
                      </span>
                      <button className="hxv5-conf-gate-yes" onClick={() => setTabConfirmDismissed(true)}>Yes</button>
                      <button className="hxv5-conf-gate-override" onClick={() => setShowTabPicker(true)}>Override</button>
                    </>
                  ) : (
                    <TabTypePicker onSelect={applyTabTypeOverride} onCancel={() => { setShowTabPicker(false); setTabConfirmDismissed(true); }} />
                  )}
                </div>
              )}
              <div className="hxv5-c-footer">
                <div className="hxv5-c-chips" onClick={e => e.stopPropagation()}>
                  <button className="hxv5-chip-btn" onClick={() => { setMode("graph"); setState("expanded"); }}>◎ Graph</button>
                  <button className="hxv5-chip-btn" onClick={() => { setMode("timeline"); setState("expanded"); }}>◷ Timeline</button>
                  {triN > 0               && <span className="hxv5-chip-info">△ {triN}</span>}
                  {assumptions.length > 0 && <span className="hxv5-chip-info">⬡ {assumptions.length}</span>}
                  {risks.length > 0       && <span className="hxv5-chip-info hxv5-chip-info--warn">⚠ {risks.length}</span>}
                </div>
                <div className="hxv5-c-right" onClick={e => e.stopPropagation()}>
                  <IntelScoreBadge entry={entry} triangulation={triangulation} priorArt={priorArt} strategyOptions={strategyOptions} assumptions={assumptions} risks={risks} hasBrief={hasBrief} />
                  <Sparklet entry={entry} tri={triangulation} />
                  <button className="hxv5-more-btn" onClick={openAP}>···</button>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ EXPANDED ═══════════ */}
          {state === "expanded" && (
            <div className="hxv5-expanded">

              {/* Card header */}
              <div className="hxv5-exp-hdr">
                <div className="hxv5-exp-hdr-l">
                  <span className="hxv5-sdot" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
                  <span className="hxv5-strand hxv5-strand--exp" style={{ color: meta.color }}>{meta.label.toUpperCase()}</span>
                  <ConfidencePips v={entry.confidence} />
                  <span className="hxv5-cpct hxv5-cpct--exp" style={{ color: confColor }}>{Math.round(entry.confidence * 100)}%</span>
                  <FreshBadge v={fresh} />
                  {!!entry.locked  && <span className="hxv5-status-tag hxv5-status-tag--lock">⊕ LOCKED</span>}
                  {isContradicted  && <span className="hxv5-status-tag hxv5-status-tag--conf">⚡ CONFLICT</span>}
                </div>
                <div className="hxv5-exp-hdr-r">
                  <time className="hxv5-time">{formatTime(entry.created_at)}</time>
                  <button className="hxv5-icon-btn" onClick={() => setState("compact")} title="Collapse">−</button>
                  <button className="hxv5-icon-btn hxv5-icon-btn--more" onClick={openAP} title="Actions">···</button>
                </div>
              </div>

              {/* Large query title */}
              <div className="hxv5-exp-title">{entry.query}</div>

              {/* Confidence gate — only shown in 0.60–0.80 range */}
              {showConfGate && (
                <div className="hxv5-conf-gate hxv5-conf-gate--exp">
                  {tabConf! >= 0.60 && !showTabPicker ? (
                    <>
                      <span className="hxv5-conf-gate-label">
                        {TAB_TYPE_META[entry.tab_primary!]?.icon} Looks like {TAB_TYPE_META[entry.tab_primary!]?.label} — right?
                      </span>
                      <button className="hxv5-conf-gate-yes" onClick={() => setTabConfirmDismissed(true)}>Yes</button>
                      <button className="hxv5-conf-gate-override" onClick={() => setShowTabPicker(true)}>Override</button>
                    </>
                  ) : (
                    <TabTypePicker onSelect={applyTabTypeOverride} onCancel={() => { setShowTabPicker(false); setTabConfirmDismissed(true); }} />
                  )}
                </div>
              )}

              {/* Tab bar */}
              <div className="hxv5-exp-tabs">
                {([["analysis", "OVERVIEW"], ["graph", "GRAPH"], ["timeline", "TIMELINE"]] as [InfoMode, string][]).map(([m, lbl]) => (
                  <button key={m}
                    className={`hxv5-tab${mode === m ? " on" : ""}`}
                    style={mode === m ? { color: meta.color, borderBottomColor: meta.color } : undefined}
                    onClick={() => setMode(m)}
                  >{lbl}</button>
                ))}
                <button className="hxv5-tab hxv5-tab--indepth" onClick={() => setState("focus")}>IN-DEPTH →</button>
              </div>

              {/* ── OVERVIEW tab ── */}
              {mode === "analysis" && (
                <div className="hxv5-overview">

                  {/* Row 1: Summary | Key Points | Confidence */}
                  <div className="hxv5-ov-row1">
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">SUMMARY</div>
                      <p className="hxv5-ov-summary-text">{entry.text}</p>
                    </div>
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">KEY POINTS</div>
                      <ul className="hxv5-kp-list">
                        {entry.text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20).slice(0, 5).map((pt, i) => (
                          <li key={i} className="hxv5-kp-item">
                            <span className="hxv5-kp-dot" style={{ color: meta.color }}>▸</span>
                            <span>{pt}.</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="hxv5-ov-panel hxv5-ov-panel--conf">
                      <div className="hxv5-ov-panel-hdr">CONFIDENCE</div>
                      <div className="hxv5-ov-conf-wrap">
                        <ConfArc v={entry.confidence} size={88} />
                        <div className="hxv5-ov-conf-label" style={{ color: confColor }}>{cLabel(entry.confidence)} CONFIDENCE</div>
                      </div>
                      <div className="hxv5-ov-panel-hdr" style={{ marginTop: 12 }}>QUALITY METRICS</div>
                      <QualityMetrics conf={entry.confidence} fresh={fresh} tri={triangulation} assumptions={assumptions} />
                    </div>
                  </div>

                  {/* Row 2: Trend Preview | Sentiment */}
                  <div className="hxv5-ov-row2">
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">TREND PREVIEW (30D)</div>
                      <TrendPreview entry={entry} tri={triangulation} />
                    </div>
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">SENTIMENT</div>
                      <SentimentWidget entry={entry} tri={triangulation} />
                    </div>
                  </div>

                  {/* Row 3: Timeline snapshot (full width) */}
                  <div className="hxv5-ov-panel hxv5-ov-panel--full">
                    <div className="hxv5-ov-panel-hdr">TIMELINE SNAPSHOT</div>
                    <TimelineSnap entry={entry} tri={triangulation} />
                  </div>

                  {/* Row 4: Related nodes + Sources (if available) */}
                  {(allEntries.length > 1 || !!priorArt) && (
                    <div className="hxv5-ov-row2">
                      {allEntries.length > 1 && (
                        <div className="hxv5-ov-panel">
                          <div className="hxv5-ov-panel-hdr">RELATED NODES</div>
                          <Graph entry={entry} allEntries={allEntries} w={260} h={140} />
                        </div>
                      )}
                      {priorArt && (
                        <div className="hxv5-ov-panel">
                          <div className="hxv5-ov-panel-hdr">SOURCES & PROVENANCE</div>
                          <div className="hxv5-src-list">
                            {(priorArt.exists.items ?? []).slice(0, 4).map((item, i) => (
                              <div key={i} className="hxv5-src-row">
                                <span className="hxv5-src-name">{item.name}</span>
                                <span className="hxv5-src-tag hxv5-src-tag--primary">Primary</span>
                              </div>
                            ))}
                            {(priorArt.gaps.items ?? []).slice(0, 2).map((item, i) => (
                              <div key={i} className="hxv5-src-row">
                                <span className="hxv5-src-name">{(item.gap ?? "").slice(0, 44)}{(item.gap ?? "").length > 44 ? "…" : ""}</span>
                                <span className="hxv5-src-tag hxv5-src-tag--gap">Gap</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row 5: Tags | Metadata */}
                  <div className="hxv5-ov-row2">
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">TAGS</div>
                      <div className="hxv5-tags">
                        {deriveTags(entry).map((tag, i) => (
                          <span key={i} className="hxv5-tag"
                            style={i === 0 ? { color: meta.color, borderColor: meta.color + "44" } : undefined}>{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div className="hxv5-ov-panel">
                      <div className="hxv5-ov-panel-hdr">METADATA</div>
                      <div className="hxv5-meta-grid">
                        <span className="hxv5-meta-k">ID</span>
                        <span className="hxv5-meta-v">{entry.id.slice(0, 8).toUpperCase()}</span>
                        <span className="hxv5-meta-k">Strand</span>
                        <span className="hxv5-meta-v" style={{ color: meta.color }}>{entry.strand}</span>
                        <span className="hxv5-meta-k">Created</span>
                        <span className="hxv5-meta-v">{formatTime(entry.created_at)}</span>
                        <span className="hxv5-meta-k">Version</span>
                        <span className="hxv5-meta-v">2.1</span>
                      </div>
                    </div>
                  </div>

                  {/* Triangulation section (when available) */}
                  {triangulation && (
                    <div className="hxv5-ov-panel hxv5-ov-panel--full">
                      <div className="hxv5-ov-panel-hdr">
                        TRIANGULATION
                        <span style={{ color: cColor(triangulation.confidence), marginLeft: 8, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 10, fontWeight: 800 }}>{Math.round(triangulation.confidence * 100)}%</span>
                      </div>
                      <div className="hxv5-tri-bar-row"><TriBar t={triangulation} /></div>
                      <div className="hxv5-tri-angles-grid">
                        {([triangulation.angle_a, triangulation.angle_b, triangulation.angle_c] as { stance: string; summary: string; confidence: number }[]).map((a, i) => {
                          const sc = a.stance === "agree" ? "#4aff9e" : a.stance === "oppose" ? "#ff6b6b" : "#ffe14a";
                          return (
                            <div key={i} className="hxv5-tri-ang" style={{ borderTopColor: sc }}>
                              <div className="hxv5-tri-ang-hdr">
                                <span className="hxv5-tri-k">{String.fromCharCode(65 + i)}</span>
                                <span style={{ color: sc, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 8, fontWeight: 700, textTransform: "uppercase" as const }}>{a.stance}</span>
                                <span style={{ color: sc, fontFamily: "var(--hx-font-mono,monospace)", fontSize: 9, fontWeight: 800, marginLeft: "auto" }}>{Math.round(a.confidence * 100)}%</span>
                              </div>
                              <p className="hxv5-tri-ang-summary">{a.summary}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Assumptions (when available) */}
                  {assumptions.length > 0 && (
                    <div className="hxv5-ov-panel hxv5-ov-panel--full">
                      <div className="hxv5-ov-panel-hdr">ASSUMPTIONS ({assumptions.length})</div>
                      <div className="hxv5-asm-rows">
                        {assumptions.slice(0, 6).map(a => (
                          <div key={a.id} className="hxv5-asm-row">
                            <span className="hxv5-asm-type">{a.assumption_type.slice(0, 4).toUpperCase()}</span>
                            <span className="hxv5-asm-text">{a.text.slice(0, 60)}{a.text.length > 60 ? "…" : ""}</span>
                            <div className="hxv5-asm-bar"><div style={{ width: `${a.confidence * 100}%`, background: cColor(a.confidence), boxShadow: `0 0 4px ${cColor(a.confidence)}44` }} /></div>
                            <span className="hxv5-asm-pct" style={{ color: cColor(a.confidence) }}>{Math.round(a.confidence * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── GRAPH tab ── */}
              {mode === "graph" && (
                <div style={{ padding: 14 }}>
                  {allEntries.length > 1
                    ? <div className="hxv5-ov-panel hxv5-ov-panel--full" style={{ padding: 0, overflow: "hidden" }}>
                        <Graph entry={entry} allEntries={allEntries} w={600} h={280} />
                      </div>
                    : <div className="hxv5-empty-state">Add more entries to see connection graph</div>
                  }
                </div>
              )}

              {/* ── TIMELINE tab ── */}
              {mode === "timeline" && (
                <div style={{ padding: 14 }}>
                  <div className="hxv5-ov-panel hxv5-ov-panel--full">
                    <div className="hxv5-ov-panel-hdr">CONFIDENCE TIMELINE</div>
                    <Spark entry={entry} tri={triangulation} />
                    <div className="hxv5-tl-meta-grid">
                      {[
                        { l: "Decay rate", v: `−${decay}/hr`,           c: "#ffe14a" },
                        { l: "Age",        v: `${ageH.toFixed(1)}h`,     c: "rgba(140,185,240,0.5)" },
                        ...(isFinite(hoursLeft) ? [{ l: "Stale in", v: `~${hoursLeft.toFixed(0)}h`, c: "#ff9e4a" }] : []),
                        { l: "Freshness",  v: `${Math.round(fresh * 100)}%`, c: freshnessColor(fresh) },
                      ].map((item, idx) => (
                        <div key={idx} className="hxv5-tl-meta-row">
                          <span className="hxv5-tl-meta-k">{item.l}</span>
                          <span className="hxv5-tl-meta-v" style={{ color: item.c }}>{item.v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Actions bar — direct access to all intelligence actions */}
              <div className="hxv5-qa-bar">
                <div className="hxv5-qa-label">ACTIONS</div>
                <div className="hxv5-qa-btns">
                  <button className="hxv5-qa-btn hxv5-qa-btn--tri" onClick={onTriangulate} disabled={triangulating} title="Triangulate — 3-angle peer validation">
                    {triangulating ? <span className="hx-spin" /> : <span className="hxv5-qa-icon">△</span>}
                    <span>Triangulate</span>
                  </button>
                  <button className="hxv5-qa-btn hxv5-qa-btn--red" onClick={onRedTeam} title="Red Team — adversarial stress-test">
                    <span className="hxv5-qa-icon">⚔</span><span>Red Team</span>
                  </button>
                  {onDevelop && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--strat" onClick={onDevelop} disabled={developing} title="Develop Strategy">
                      {developing ? <span className="hx-spin" /> : <span className="hxv5-qa-icon">⊞</span>}
                      <span>Strategy</span>
                    </button>
                  )}
                  {onScan && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--art" onClick={onScan} disabled={scanning} title="Prior Art scan">
                      {scanning ? <span className="hx-spin" /> : <span className="hxv5-qa-icon">◉</span>}
                      <span>Prior Art</span>
                    </button>
                  )}
                  {onFork && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--fork" onClick={onFork} disabled={forking} title="Fork scenario">
                      {forking ? <span className="hx-spin" /> : <span className="hxv5-qa-icon">⎇</span>}
                      <span>Fork</span>
                    </button>
                  )}
                  {!entry.locked && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--lock" onClick={onLock} title="Lock to Vault">
                      <span className="hxv5-qa-icon">⊕</span><span>Lock</span>
                    </button>
                  )}
                  {onProbe && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--probe" onClick={onProbe} title="Probe — live monitor">
                      <span className="hxv5-qa-icon">◈</span><span>Probe</span>
                    </button>
                  )}
                  {props.onDeepBrief && (
                    <button className="hxv5-qa-btn hxv5-qa-btn--brief" onClick={props.onDeepBrief} title="Open Jarvis Intelligence Brief">
                      <span className="hxv5-qa-icon">✦</span><span>Brief</span>
                    </button>
                  )}
                </div>
              </div>

              {/* In-depth workspace button */}
              <button className="hxv5-indepth-btn" onClick={() => setState("focus")}>
                <span>⊡</span>
                <span>Open In-Depth Workspace</span>
                <span className="hxv5-indepth-arr">→</span>
              </button>
            </div>
          )}
        </div>
      </article>

      {/* Action panel portal */}
      {apOpen && apRect && (
        <ActionPanel props={props} anchorRect={apRect} onClose={() => setApOpen(false)} />
      )}

      {/* Focus overlay portal */}
      {state === "focus" && (
        <FocusOverlay {...props} mode={mode} setMode={setMode} onClose={() => setState("expanded")} />
      )}
    </>
  );
}

// ── Standalone sub-component exports ──────────────────────────────────────────
export function StrategyOptionsTree({ options, compact = false }: { options: StrategyOptionsData; compact?: boolean }) {
  const EC: Record<string, string> = { low: "#4aff9e", medium: "#ffe14a", high: "#ff6b6b" };
  return (
    <div className={`hx-opt-tree${compact ? " compact" : ""}`}>
      {options.options.map((opt, i) => (
        <div key={i} className="hx-opt-branch">
          <div className="hx-opt-head">
            <span className="hx-opt-letter">{String.fromCharCode(65 + i)}</span>
            <span className="hx-opt-title">{opt.title}</span>
            <span className="hx-opt-effort" style={{ color: EC[opt.effort] }}>{opt.effort}</span>
            <span style={{ color: cColor(opt.confidence), fontFamily: "var(--hx-font-mono,monospace)", fontSize: 9, fontWeight: 800 }}>{Math.round(opt.confidence * 100)}%</span>
          </div>
          <p className="hx-opt-rationale">{compact ? opt.rationale.slice(0, 80) + "…" : opt.rationale}</p>
          {opt.risks.length > 0 && (
            <div className="hx-opt-risks">{opt.risks.map((r, j) => <span key={j} className="hx-opt-risk">⚠ {r}</span>)}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function AssumptionBoard({ assumptions, onChallenge }: { assumptions: Assumption[]; onChallenge: (a: Assumption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hx-asm-board">
      <button className="hx-asm-toggle" onClick={() => setOpen(x => !x)}>
        {open ? "▾" : "▸"} Assumptions <span className="hx-cnt">{assumptions.length}</span>
      </button>
      {open && assumptions.map(a => (
        <div key={a.id} className={`hx-asm-row status-${a.status}`}>
          <span className="hx-asm-type">{a.assumption_type}</span>
          <span className="hx-asm-text">{a.text}</span>
          {a.status === "active"
            ? <button className="hx-asm-challenge" onClick={() => onChallenge(a)}>Challenge</button>
            : <span className="hx-asm-badge">{a.status}</span>}
        </div>
      ))}
    </div>
  );
}

export function RiskGallery({ risks, compact = false }: { risks: Risk[]; compact?: boolean }) {
  if (!risks.length) return <div className="hx-empty">No risks extracted</div>;
  const SC: Record<string, string> = { high: "#ff6b6b", medium: "#ff9e4a", low: "#ffe14a" };
  if (compact) return (
    <div className="hx-risk-compact">
      {risks.slice(0, 6).map(r => (
        <div key={r.id} className="hx-risk-compact-row">
          <span style={{ color: SC[r.severity] }}>●</span>
          <span>{r.text.slice(0, 55)}{r.text.length > 55 ? "…" : ""}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="hx-risk-gallery">
      <RiskMini risks={risks} />
      {risks.map(r => (
        <div key={r.id} className="hx-risk-list-row">
          <span style={{ color: SC[r.severity], fontSize: 8, fontWeight: 700 }}>{r.severity.toUpperCase()}</span>
          <span style={{ fontSize: 8, color: "rgba(200,220,255,0.3)" }}>{r.category}</span>
          <span style={{ fontSize: 9.5, color: "rgba(200,220,255,0.55)" }}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

export function PriorArtCard({ priorArt }: { priorArt: PriorArt }) {
  const [open, setOpen] = useState(false);
  const ec = priorArt.exists.items?.length ?? 0, fc = priorArt.failures.items?.length ?? 0, gc = priorArt.gaps.items?.length ?? 0;
  return (
    <div className="hx-prior-art">
      <button className="hx-prior-toggle" onClick={() => setOpen(x => !x)}>
        {open ? "▾" : "▸"} Prior Art <span className="hx-cnt">{ec} exist · {fc} fail · {gc} gaps</span>
      </button>
      {open && (
        <div className="hx-prior-body">
          {(priorArt.exists.items ?? []).map((item, i) => <div key={i} className="hx-prior-row"><span className="hx-prior-tag exists">EXISTS</span><span>{item.name}</span></div>)}
          {(priorArt.failures.items ?? []).map((item, i) => <div key={i} className="hx-prior-row"><span className="hx-prior-tag failed">FAILED</span><span>{item.what}</span></div>)}
          {(priorArt.gaps.items ?? []).map((item, i) => <div key={i} className="hx-prior-row"><span className="hx-prior-tag gap">GAP</span><span>{item.gap}</span></div>)}
        </div>
      )}
    </div>
  );
}
