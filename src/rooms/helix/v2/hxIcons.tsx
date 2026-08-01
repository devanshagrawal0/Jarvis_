// Minimal inline stroke icons for HELIX v2 (no external icon dep).
import React from "react";

const S = (p: React.SVGProps<SVGSVGElement>, d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
       strokeLinecap="round" strokeLinejoin="round" width="1em" height="1em" {...p}>{d}</svg>
);

export const Ico = {
  home:    (p: any) => S(p, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  projects:(p: any) => S(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 4v16" /></>),
  ask:     (p: any) => S(p, <><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M9 10h6M9 13h4" /></>),
  evidence:(p: any) => S(p, <><path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7z" /><path d="M9 13h6M9 16h6" /></>),
  analyze: (p: any) => S(p, <><path d="M3 3v18h18" /><path d="M7 15l3-4 3 2 4-6" /></>),
  decide:  (p: any) => S(p, <><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></>),
  build:   (p: any) => S(p, <><path d="M12 2 3 7v10l9 5 9-5V7z" /><path d="M12 22V12M3 7l9 5 9-5" /></>),
  command: (p: any) => S(p, <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 9l3 3-3 3M13 15h3" /></>),
  search:  (p: any) => S(p, <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  bell:    (p: any) => S(p, <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>),
  arrow:   (p: any) => S(p, <><path d="M5 12h14M13 6l6 6-6 6" /></>),
  plus:    (p: any) => S(p, <><path d="M12 5v14M5 12h14" /></>),
  x:       (p: any) => S(p, <><path d="M6 6l12 12M18 6 6 18" /></>),
  spark:   (p: any) => S(p, <><path d="M13 2 3 14h7l-1 8 10-12h-7z" /></>),
  chevron: (p: any) => S(p, <><path d="m9 6 6 6-6 6" /></>),
  dot:     (p: any) => S(p, <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />),
  layers:  (p: any) => S(p, <><path d="M12 2 2 7l10 5 10-5z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></>),
  clock:   (p: any) => S(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  trash:   (p: any) => S(p, <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" /></>),
};

// Deterministic sparkline (seeded by string) so renders are stable.
export function Spark({ seed = "x", color = "#3f8cff", w = 190, h = 40, up = true }:
  { seed?: string; color?: string; w?: number; h?: number; up?: boolean }) {
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) % 9973;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 1000) / 1000; };
  const n = 26; const pts: number[] = [];
  let base = 0.5;
  for (let i = 0; i < n; i++) { base += (rnd() - (up ? 0.42 : 0.58)) * 0.16; base = Math.max(0.08, Math.min(0.92, base)); pts.push(base); }
  const id = "g" + seed.replace(/\W/g, "");
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (n - 1)) * w} ${h - p * h}`).join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", width: "100%" }} preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0" />
      </linearGradient></defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" />
      <circle cx={w} cy={h - pts[n - 1] * h} r="2.4" fill={color} />
    </svg>
  );
}
