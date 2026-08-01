import type { BacktestRun } from "./bt-types";

/* Wave-4 bottom analytics widgets — every value derived from the REAL equity + trade list. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pct = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const ymd = (t: number) => (t ? new Date(t).toISOString().slice(0, 10) : "—");
const signCol = (v: number) => (v >= 0 ? "var(--ax-pos)" : "var(--ax-neg)");

// ── Reusable SVG donut ──
function Donut({ segments, top, sub, size = 108, thick = 13 }: { segments: { label: string; value: number; color: string }[]; top: string; sub: string; size?: number; thick?: number }) {
  const r = (size - thick) / 2, C = 2 * Math.PI * r, cx = size / 2;
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ flexShrink: 0 }}>
      <g transform={`rotate(-90 ${cx} ${cx})`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--ax-bdsoft,rgba(120,205,225,.08))" strokeWidth={thick} />
        {segments.map((seg, i) => { const len = (C * seg.value) / total; const el = <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={seg.color} strokeWidth={thick} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} strokeLinecap="butt" />; acc += len; return el; })}
      </g>
      <text x={cx} y={cx - 4} textAnchor="middle" style={{ fontFamily: "var(--ax-disp,Oxanium)", fontWeight: 800, fontSize: 18, fill: "var(--ax-tx)" }}>{top}</text>
      <text x={cx} y={cx + 12} textAnchor="middle" style={{ fontSize: 8, letterSpacing: ".06em", fill: "var(--ax-mut)" }}>{sub}</text>
    </svg>
  );
}
const Legend = ({ rows }: { rows: { label: string; val: string; color: string }[] }) => (
  <div className="bte-w-legend">{rows.map((r) => <div key={r.label} className="bte-w-lrow"><span className="bte-w-sw" style={{ background: r.color }} />{r.label}<b>{r.val}</b></div>)}</div>
);

export function TradeDistribution({ run }: { run: BacktestRun }) {
  const win = run.trades.filter((t) => t.pnl > 0).length;
  const loss = run.trades.filter((t) => t.pnl < 0).length;
  const flat = run.trades.length - win - loss;
  const wr = run.trades.length ? (win / run.trades.length) * 100 : 0;
  return (
    <div className="bte-w-row">
      <Donut segments={[{ label: "Win", value: win, color: "var(--ax-pos)" }, { label: "Loss", value: loss, color: "var(--ax-neg)" }, ...(flat ? [{ label: "Flat", value: flat, color: "var(--ax-mut)" }] : [])]} top={`${wr.toFixed(1)}%`} sub={`${run.trades.length} TRADES`} />
      <Legend rows={[{ label: "Winning", val: String(win), color: "var(--ax-pos)" }, { label: "Losing", val: String(loss), color: "var(--ax-neg)" }, { label: "Total", val: String(run.trades.length), color: "var(--ax-mut)" }]} />
    </div>
  );
}

export function TradeDuration({ run }: { run: BacktestRun }) {
  const buckets = [{ label: "1 bar", lo: 0, hi: 1 }, { label: "2–5", lo: 2, hi: 5 }, { label: "6–20", lo: 6, hi: 20 }, { label: "21–60", lo: 21, hi: 60 }, { label: ">60", lo: 61, hi: Infinity }];
  const colors = ["#22d3ee", "#5ec8ff", "#a98bff", "#f5a524", "#f43f5e"];
  const counts = buckets.map((b) => run.trades.filter((t) => t.bars >= b.lo && t.bars <= b.hi).length);
  const avg = run.trades.length ? run.trades.reduce((s, t) => s + t.bars, 0) / run.trades.length : 0;
  return (
    <div className="bte-w-row">
      <Donut segments={buckets.map((b, i) => ({ label: b.label, value: counts[i], color: colors[i] }))} top={avg.toFixed(1)} sub="AVG BARS" />
      <Legend rows={buckets.map((b, i) => ({ label: b.label, val: `${counts[i]} · ${run.trades.length ? Math.round((counts[i] / run.trades.length) * 100) : 0}%`, color: colors[i] }))} />
    </div>
  );
}

export function MonthlyHeatmap({ run }: { run: BacktestRun }) {
  const CAP = 0.10;
  const years = [...new Set(run.monthly.map((c) => c.year))].sort();
  const cellBg = (ret: number) => ret === 0 ? "transparent" : `color-mix(in srgb, ${ret > 0 ? "var(--ax-pos)" : "var(--ax-neg)"} ${Math.min(85, (Math.abs(ret) / CAP) * 85).toFixed(0)}%, transparent)`;
  const ytd = (y: number) => { const ms = run.monthly.filter((c) => c.year === y); return (ms.reduce((p, c) => p * (1 + c.ret), 1) - 1) * 100; };
  return (
    <div className="bte-heat-wrap">
      <table className="bte-heat">
        <thead><tr><th></th>{MONTHS.map((m) => <th key={m}>{m}</th>)}<th className="ytd">YTD</th></tr></thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}><td className="yr">{y}</td>
              {MONTHS.map((_, mi) => { const c = run.monthly.find((x) => x.year === y && x.month === mi); const r = c ? c.ret * 100 : 0; return <td key={mi} style={{ background: cellBg(c ? c.ret : 0) }}>{c ? r.toFixed(1) : ""}</td>; })}
              <td className="ytd" style={{ color: signCol(ytd(y)) }}>{pct(ytd(y), 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DrawdownTable({ run, onPick }: { run: BacktestRun; onPick?: (startT: number, troughT: number) => void }) {
  return (
    <table className="bte-ddtable">
      <thead><tr><th>#</th><th>Depth</th><th>Start</th><th>Trough</th><th>Days</th><th>Recovery</th></tr></thead>
      <tbody>
        {run.drawdowns.map((d, i) => (
          <tr key={i} onClick={() => onPick?.(d.startT, d.troughT)} className={onPick ? "clk" : ""}>
            <td>{i + 1}</td><td style={{ color: "var(--ax-neg)" }}>{pct(d.depthPct)}</td>
            <td>{ymd(d.startT)}</td><td>{ymd(d.troughT)}</td><td>{d.days}</td>
            <td>{d.recoveryDays == null ? "—" : `${d.recoveryDays}d`}</td>
          </tr>
        ))}
        {!run.drawdowns.length && <tr><td colSpan={6} className="bte-w-none">No drawdowns.</td></tr>}
      </tbody>
    </table>
  );
}

export function EquityStatsCard({ run }: { run: BacktestRun }) {
  const s = run.equityStats;
  const rows: [string, string, string][] = [
    ["Best Day", pct(s.bestDayPct), "var(--ax-pos)"], ["Worst Day", pct(s.worstDayPct), "var(--ax-neg)"],
    ["Best Month", `${pct(s.bestMonthPct)}`, "var(--ax-pos)"], ["Worst Month", `${pct(s.worstMonthPct)}`, "var(--ax-neg)"],
    ["% Winning Months", `${s.winningMonthsPct.toFixed(1)}%`, "var(--ax-tx)"], ["Avg Monthly", pct(s.avgMonthlyPct), signCol(s.avgMonthlyPct)],
  ];
  return <div className="bte-statlist">{rows.map(([k, v, c]) => <div key={k} className="bte-perfrow"><span>{k}</span><b style={{ color: c }}>{v}</b></div>)}</div>;
}
