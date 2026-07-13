// Wave 3 — data-density primitives. Small, reusable, seeded (deterministic) viz that
// turn blank cells into signal: delta chips, a confidence bar with an uncertainty band
// (the shared "how sure are we" visual language), and compact ordinal confidence pips.
import React from "react";

// Compact ▲/▼ change chip. `unit` is appended ("%", "", "pts"); `invert` flips good/bad
// (for metrics where down is good, e.g. contradictions).
export function DeltaChip({ value, unit = "", digits = 1, invert = false, size = 11 }:
  { value: number; unit?: string; digits?: number; invert?: boolean; size?: number }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  const col = value === 0 ? "var(--v-text3)" : good ? "var(--v-good)" : "var(--v-bad)";
  const arrow = value === 0 ? "→" : up ? "▲" : "▼";
  return (
    <span style={{ color: col, fontFamily: "var(--v-mono)", fontSize: size, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ fontSize: size - 3 }}>{arrow}</span>{up && value !== 0 ? "+" : ""}{value.toFixed(digits)}{unit}
    </span>
  );
}

// Confidence bar with an optional uncertainty band. value/band are 0..1. The track is a
// red→amber→green gradient (epistemic scale); band is the CI span; the marker is the point estimate.
export function ConfBar({ value, band, label, width = 120, showValue = true }:
  { value: number; band?: [number, number]; label?: string; width?: number; showValue?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const lo = band ? Math.max(0, Math.min(1, band[0])) : null;
  const hi = band ? Math.max(0, Math.min(1, band[1])) : null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ position: "relative", width, height: 6, borderRadius: 4, overflow: "hidden",
        background: "linear-gradient(90deg, rgba(235,127,134,0.5), rgba(226,180,92,0.5) 50%, rgba(63,208,160,0.65))" }}>
        {lo != null && hi != null && (
          <span style={{ position: "absolute", left: `${lo * 100}%`, width: `${(hi - lo) * 100}%`, top: 0, bottom: 0,
            background: "rgba(255,255,255,0.15)", borderLeft: "1px solid rgba(255,255,255,0.35)", borderRight: "1px solid rgba(255,255,255,0.35)" }} />
        )}
        <span style={{ position: "absolute", left: `calc(${v * 100}% - 1.5px)`, top: -1, bottom: -1, width: 3, background: "#fff", boxShadow: "0 0 6px rgba(255,255,255,0.85)" }} />
      </span>
      {showValue && <span style={{ fontFamily: "var(--v-mono)", fontSize: 10.5, color: "var(--v-text2)", whiteSpace: "nowrap" }}>
        {label ?? (band ? `${v.toFixed(2)} ±${((hi! - lo!) / 2).toFixed(2)}` : v.toFixed(2))}</span>}
    </span>
  );
}

// Ordinal 3-pip confidence for dense tables. level: high | med | low.
export function ConfPips({ level }: { level: "high" | "med" | "low" }) {
  const filled = level === "high" ? 3 : level === "med" ? 2 : 1;
  const col = level === "high" ? "var(--v-good)" : level === "med" ? "var(--v-warn)" : "var(--v-bad)";
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }} title={`Confidence: ${level}`}>
      {[0, 1, 2].map(i => <span key={i} style={{ width: 5, height: 9, borderRadius: 1.5, background: i < filled ? col : "rgba(255,255,255,0.12)" }} />)}
    </span>
  );
}

// Seeded mini bar-sparkline — tiny, inline, no deps. Good for tables/tiles.
export function MiniBars({ seed = "x", color = "var(--v-accent)", w = 64, h = 18, bars = 12, up = true }:
  { seed?: string; color?: string; w?: number; h?: number; bars?: number; up?: boolean }) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) % 9973;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
  const bw = w / bars, vals: number[] = [];
  let base = up ? 0.35 : 0.7;
  for (let i = 0; i < bars; i++) { base += (rnd() - (up ? 0.4 : 0.6)) * 0.22; base = Math.max(0.12, Math.min(0.95, base)); vals.push(base); }
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      {vals.map((v, i) => <rect key={i} x={i * bw + 0.5} y={h - v * h} width={Math.max(1, bw - 1.5)} height={v * h} rx={1} fill={color} opacity={0.35 + 0.55 * (i / bars)} />)}
    </svg>
  );
}
