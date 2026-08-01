/* SVG arc gauge (270° sweep) — profit factor / any bounded metric, on --ax tokens. */

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg), [x2, y2] = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function BtGauge({ value, max = 4, label = "PROFIT FACTOR", digits = 2, bands }: {
  value: number; max?: number; label?: string; digits?: number;
  bands?: { lo: number; color: string }[]; // ascending thresholds
}) {
  const SWEEP = 270, START = 135;
  const frac = Math.max(0, Math.min(1, (Number.isFinite(value) ? value : 0) / max));
  const end = START + SWEEP * frac;
  const defBands = bands || [{ lo: 0, color: "var(--ax-neg,#f43f5e)" }, { lo: 1, color: "var(--ax-warn,#f5a524)" }, { lo: 1.5, color: "var(--ax-pos,#34d399)" }];
  let color = defBands[0].color; for (const b of defBands) if (value >= b.lo) color = b.color;
  return (
    <div className="bte-gauge">
      <svg viewBox="0 0 120 120" width="118" height="118">
        <path d={arcPath(60, 60, 48, START, START + SWEEP)} fill="none" stroke="var(--ax-bdsoft,rgba(120,205,225,.1))" strokeWidth={9} strokeLinecap="round" />
        <path d={arcPath(60, 60, 48, START, end)} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "all .7s cubic-bezier(.22,1,.36,1)" }} />
        <text x="60" y="60" textAnchor="middle" dominantBaseline="central" style={{ fontFamily: "var(--ax-disp,Oxanium)", fontWeight: 800, fontSize: 26, fill: color }}>{Number.isFinite(value) ? value.toFixed(digits) : "—"}</text>
      </svg>
      <div className="bte-gauge-l">{label}</div>
    </div>
  );
}
