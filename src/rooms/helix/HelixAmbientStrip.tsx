import React, { useEffect, useRef } from "react";
import { HelixEntry, Triangulation, PriorArt, StrategyOptionsData, Risk } from "./helix-types";

interface Props {
  entries: HelixEntry[];
  triangulations: Record<string, Triangulation>;
  priorArt: Record<string, PriorArt>;
  strategyOptions: Record<string, StrategyOptionsData>;
  risks: Risk[];
  briefedEntryIds: Set<string>;
  lastActionTs: number | null;
  processing: boolean;
  onOpenPatterns?: () => void;
}

function formatRelativeTime(ts: number | null): string {
  if (!ts) return "—";
  const delta = (Date.now() - ts) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function Sparkline({ entries }: { entries: HelixEntry[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const logicalW = 80, logicalH = 24;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = `${logicalW}px`;
    canvas.style.height = `${logicalH}px`;
    ctx.scale(dpr, dpr);

    const W = logicalW, H = logicalH;
    ctx.clearRect(0, 0, W, H);

    if (entries.length < 2) {
      ctx.strokeStyle = "rgba(74,158,255,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      return;
    }

    // Bucket entries into 20 time slots over the last 7 days
    const now = Date.now();
    const windowMs = 7 * 24 * 3_600_000;
    const BUCKETS = 20;
    const counts = new Array<number>(BUCKETS).fill(0);
    for (const e of entries) {
      const age = now - new Date(e.created_at).getTime();
      if (age > windowMs) continue;
      const bucket = Math.min(BUCKETS - 1, Math.floor((1 - age / windowMs) * BUCKETS));
      counts[bucket]++;
    }

    const maxCount = Math.max(...counts, 1);
    const pts = counts.map((c, i) => ({
      x: (i / (BUCKETS - 1)) * (W - 4) + 2,
      y: H - 2 - ((c / maxCount) * (H - 4)),
    }));

    // Area fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(74,158,255,0.35)");
    grad.addColorStop(1, "rgba(74,158,255,0)");
    ctx.beginPath();
    ctx.moveTo(pts[0].x, H);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "rgba(74,158,255,0.8)";
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Endpoint dot
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = "#4a9eff";
    ctx.fill();
  }, [entries]);

  return <canvas ref={canvasRef} className="has-strip-sparkline" style={{ width: 80, height: 24 }} />;
}

export function HelixAmbientStrip({ entries, triangulations, priorArt, strategyOptions, risks, briefedEntryIds, lastActionTs, processing, onOpenPatterns }: Props) {
  const active = entries.filter(e => !e.voided);
  const total = active.length;

  // Count how many entries have at least one analysis run
  const analyzed = active.filter(e =>
    triangulations[e.id] || priorArt[e.id] || strategyOptions[e.id] || briefedEntryIds.has(e.id)
  ).length;

  const coverage = total > 0 ? Math.round((analyzed / total) * 100) : 0;
  const highRisks = risks.filter(r => r.severity === "high").length;
  const avgConf = total > 0
    ? Math.round(active.reduce((s, e) => s + e.confidence, 0) / total * 100)
    : 0;

  const coverageColor = coverage >= 70 ? "#4aff9e" : coverage >= 40 ? "#ffe14a" : "#ff9e4a";

  return (
    <div className={`has-strip${processing ? " has-strip--active" : ""}`}>
      <div className="has-strip-section">
        <span className="has-strip-label">ENTRIES</span>
        <span className="has-strip-value">{total}</span>
      </div>
      <div className="has-strip-divider" />
      <div className="has-strip-section">
        <span className="has-strip-label">ANALYZED</span>
        <span className="has-strip-value" style={{ color: coverageColor }}>{analyzed}</span>
        <div className="has-strip-mini-bar">
          <div style={{ width: `${coverage}%`, background: coverageColor }} />
        </div>
        <span className="has-strip-pct" style={{ color: coverageColor }}>{coverage}%</span>
      </div>
      <div className="has-strip-divider" />
      <div className="has-strip-section">
        <span className="has-strip-label">AVG CONF</span>
        <span className="has-strip-value">{avgConf}%</span>
      </div>
      {highRisks > 0 && <>
        <div className="has-strip-divider" />
        <div className="has-strip-section">
          <span className="has-strip-label">HIGH RISK</span>
          <span className="has-strip-value has-strip-value--warn">{highRisks}</span>
        </div>
      </>}
      <div className="has-strip-divider" />
      <div className="has-strip-section">
        <span className="has-strip-label">LAST ACTION</span>
        <span className="has-strip-value has-strip-value--dim">{formatRelativeTime(lastActionTs)}</span>
      </div>
      <div className="has-strip-divider" />
      <div className="has-strip-section has-strip-section--spark">
        <span className="has-strip-label">7D ACTIVITY</span>
        <Sparkline entries={active} />
      </div>
      {onOpenPatterns && (
        <>
          <div className="has-strip-divider" />
          <div className="has-strip-section">
            <button className="has-strip-patterns-btn" onClick={onOpenPatterns} title="Open Signal Patterns panel">◈ Patterns</button>
          </div>
        </>
      )}
      {processing && (
        <div className="has-strip-processing">
          <span className="has-strip-proc-dot" />
          <span className="has-strip-proc-label">ANALYZING</span>
        </div>
      )}
    </div>
  );
}
