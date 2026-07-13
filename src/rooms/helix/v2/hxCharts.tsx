// Self-contained SVG chart primitives for HELIX v2 — donut, gauge, radar, trend,
// mini-bars. No chart lib; theme-aware via CSS vars. Pixel target: ref_04/05/06/10.
import React from "react";

// ── Donut / ring gauge (citation completeness, coverage) ──────────────
export function Donut({ value, size = 92, stroke = 9, color = "var(--v-accent)", label, sub }:
  { value: number; size?: number; stroke?: number; color?: string; label?: string; sub?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(140,170,220,0.12)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s cubic-bezier(0.16,1,0.3,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: size * 0.24, fontWeight: 700, fontFamily: "var(--v-mono)", lineHeight: 1 }}>{label ?? Math.round(value * 100) + "%"}</div>
          {sub && <div style={{ fontSize: 9, color: "var(--v-text3)", marginTop: 3, textTransform: "uppercase", letterSpacing: ".08em" }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Radar / spider (source coverage, evidence support across dimensions) ─
export function Radar({ axes, series, size = 220 }:
  { axes: string[]; series: { name: string; color: string; values: number[] }[]; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 30;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg width={size} height={size} style={{ display: "block", margin: "0 auto" }}>
      {rings.map(rr => (
        <polygon key={rr} points={axes.map((_, i) => pt(i, rr).join(",")).join(" ")}
          fill="none" stroke="rgba(140,170,220,0.10)" strokeWidth="1" />
      ))}
      {axes.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(140,170,220,0.10)" />; })}
      {series.map(s => (
        <polygon key={s.name} points={s.values.map((v, i) => pt(i, Math.max(0.02, Math.min(1, v))).join(",")).join(" ")}
          fill={s.color} fillOpacity="0.14" stroke={s.color} strokeWidth="1.6" />
      ))}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.16);
        return <text key={ax} x={x} y={y} fontSize="9.5" fill="var(--v-text3)" textAnchor="middle" dominantBaseline="middle">{ax}</text>;
      })}
    </svg>
  );
}

// ── Trend arrow with color (watchlist deltas) ─────────────────────────
export function Trend({ value }: { value: number }) {
  const up = value >= 0;
  const col = up ? "var(--v-good)" : "var(--v-bad)";
  return (
    <span style={{ color: col, fontFamily: "var(--v-mono)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
      <svg width="9" height="9" viewBox="0 0 10 10" style={{ transform: up ? "none" : "scaleY(-1)" }}>
        <path d="M5 1 L9 8 L1 8 Z" fill={col} />
      </svg>
      {up ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

// ── Mini horizontal bar (coverage-by-theme, indicator bars) ───────────
export function BarMini({ value, color = "var(--v-accent)", w = 70 }: { value: number; color?: string; w?: number }) {
  return (
    <span style={{ display: "inline-block", width: w, height: 5, borderRadius: 3, background: "rgba(140,170,220,0.14)", overflow: "hidden", verticalAlign: "middle" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, borderRadius: 3 }} />
    </span>
  );
}
