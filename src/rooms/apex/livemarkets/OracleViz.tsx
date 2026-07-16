import { useEffect, useMemo, useState } from "react";
import type { Bar } from "../apex-data";
import type { OracleHorizon, OracleHistory } from "./OraclePanel";

// APEX Oracle — advanced visualizations (the "mind-blowing" set): Monte-Carlo path fan,
// cross-asset contagion graph, regime-timeline ribbon, reliability curve, edge-decay meter,
// and an interactive what-if scenario panel. All self-contained SVG, no deps.

const POS = "#26a69a", NEG = "#ef5350", CY = "#4d9fd1", WARN = "#e0952b", PUR = "#9a86d4";
const normInv = (p: number) => { // Acklam
  if (p <= 0) return -3.5; if (p >= 1) return 3.5;
  const a = [-39.69683, 220.9461, -275.9285, 138.357, -30.66479, 2.506628], b = [-54.47609, 161.5858, -155.6989, 66.80131, -13.28068], c = [-0.007784894, -0.3223964, -2.400758, -2.549732, 4.374664, 2.938164], d = [0.007784695, 0.3224671, 2.445134, 3.754408];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
};

/* 1. MONTE-CARLO PATH FAN — GBM sample paths + percentile band, projected forward. */
export function MonteCarloFan({ spot, muBar, sigBar }: { spot: number; muBar: number; sigBar: number }) {
  const W = 320, H = 130, steps = 32, paths = 48;
  const sim = useMemo(() => {
    let seed = Math.floor(spot * 100) ^ 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const all: number[][] = [];
    for (let p = 0; p < paths; p++) { const path = [spot]; let s = spot; for (let t = 0; t < steps; t++) { s = s * Math.exp((muBar - 0.5 * sigBar * sigBar) + sigBar * gauss()); path.push(s); } all.push(path); }
    return all;
  }, [spot, muBar, sigBar]);
  const flat = sim.flat(); const lo = Math.min(...flat), hi = Math.max(...flat), rg = hi - lo || 1;
  const X = (t: number) => (t / steps) * W, Y = (v: number) => H - ((v - lo) / rg) * (H - 4) - 2;
  // percentile band per step
  const band = useMemo(() => Array.from({ length: steps + 1 }, (_, t) => { const col = sim.map((p) => p[t]).sort((a, b) => a - b); return { p05: col[Math.floor(col.length * 0.05)], p50: col[Math.floor(col.length * 0.5)], p95: col[Math.floor(col.length * 0.95)] }; }), [sim]);
  const bandPath = band.map((b, t) => `${t ? "L" : "M"}${X(t).toFixed(1)},${Y(b.p95).toFixed(1)}`).join(" ") + " " + band.slice().reverse().map((b, i) => `L${X(steps - i).toFixed(1)},${Y(b.p05).toFixed(1)}`).join(" ") + " Z";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axv" preserveAspectRatio="none">
      <path d={bandPath} fill="rgba(77,159,209,.10)" stroke="none" />
      {sim.slice(0, 24).map((p, i) => <polyline key={i} points={p.map((v, t) => `${X(t)},${Y(v)}`).join(" ")} fill="none" stroke="rgba(150,170,195,.13)" strokeWidth="0.6" />)}
      <polyline points={band.map((b, t) => `${X(t)},${Y(b.p50)}`).join(" ")} fill="none" stroke={WARN} strokeWidth="1.6" />
      <line x1={0} y1={Y(spot)} x2={W} y2={Y(spot)} stroke="rgba(255,255,255,.15)" strokeDasharray="3 3" />
    </svg>
  );
}

/* 2. CROSS-ASSET CONTAGION GRAPH — radial: center=symbol, peers around, edge=|ρ|, color by momentum. */
export function ContagionGraph({ symbol, peers }: { symbol: string; peers: { sym: string; rho: number; mom: number; kind: string }[] }) {
  const W = 320, H = 200, cx = W / 2, cy = H / 2, R = 74;
  const list = peers.slice(0, 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axv">
      {list.map((p, i) => { const a = (i / list.length) * 2 * Math.PI - Math.PI / 2; const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); const w = 0.5 + Math.abs(p.rho) * 3; const col = p.rho >= 0 ? "rgba(77,159,209," : "rgba(224,149,43,"; return (
        <line key={"e" + i} x1={cx} y1={cy} x2={x} y2={y} stroke={`${col}${(0.15 + Math.abs(p.rho) * 0.5).toFixed(2)})`} strokeWidth={w} />
      ); })}
      {list.map((p, i) => { const a = (i / list.length) * 2 * Math.PI - Math.PI / 2; const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); const c = p.mom >= 0 ? POS : NEG; return (
        <g key={"n" + i}><circle cx={x} cy={y} r={9} fill={`${c}22`} stroke={c} strokeWidth="1.2" /><text x={x} y={y - 12} fill="#c9d4e0" fontSize="8" textAnchor="middle" fontFamily="var(--ax-mono,monospace)">{p.sym}</text><text x={x} y={y + 3} fill={c} fontSize="7" textAnchor="middle" fontFamily="var(--ax-mono,monospace)">{p.rho.toFixed(2)}</text></g>
      ); })}
      <circle cx={cx} cy={cy} r={16} fill="#141a22" stroke={CY} strokeWidth="1.6" /><text x={cx} y={cy + 3} fill="#e6edf3" fontSize="9" textAnchor="middle" fontWeight="700" fontFamily="var(--ax-mono,monospace)">{symbol}</text>
    </svg>
  );
}

/* 3. REGIME-TIMELINE RIBBON — rolling regime color under the price (EMA-slope + vol). */
export function RegimeRibbon({ bars }: { bars: Bar[] }) {
  const seg = useMemo(() => {
    const c = bars.map((b) => b.c); if (c.length < 40) return [];
    const ema = (n: number) => { const k = 2 / (n + 1); let p = c[0]; return c.map((x) => (p = x * k + p * (1 - k))); };
    const e12 = ema(12), e26 = ema(26); const out: { up: number; regime: string }[] = [];
    for (let i = 30; i < c.length; i++) { const slope = e12[i] - e12[i - 5]; const above = e12[i] > e26[i]; const r = above && slope > 0 ? "up" : !above && slope < 0 ? "down" : "chop"; out.push({ up: i / c.length, regime: r }); }
    return out;
  }, [bars]);
  const W = 320, H = 22;
  const col = (r: string) => r === "up" ? POS : r === "down" ? NEG : PUR;
  return <svg viewBox={`0 0 ${W} ${H}`} className="axv" preserveAspectRatio="none" style={{ height: 22 }}>{seg.map((s, i) => <rect key={i} x={(i / seg.length) * W} y={0} width={W / seg.length + 0.6} height={H} fill={col(s.regime)} opacity="0.5" />)}</svg>;
}

/* 4. RELIABILITY CURVE — predicted P(up) deciles vs observed frequency (calibration). */
export function ReliabilityCurve({ hist }: { hist: OracleHistory | null }) {
  const W = 150, H = 130, pad = 14;
  const resolved = (hist?.rows || []).filter((r) => r.hit != null);
  const pts = useMemo(() => {
    if (resolved.length < 4) return null;
    const buckets = Array.from({ length: 5 }, () => ({ n: 0, hit: 0, pSum: 0 }));
    for (const r of resolved as unknown as { p_up?: number; hit: number }[]) { const p = r.p_up ?? 0.5; const b = Math.min(4, Math.floor(p * 5)); buckets[b].n++; buckets[b].hit += r.hit; buckets[b].pSum += p; }
    return buckets.filter((b) => b.n > 0).map((b) => ({ pred: b.pSum / b.n, obs: b.hit / b.n }));
  }, [resolved]);
  const X = (v: number) => pad + v * (W - 2 * pad), Y = (v: number) => H - pad - v * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axv">
      <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="none" stroke="rgba(255,255,255,.08)" />
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="rgba(255,255,255,.2)" strokeDasharray="3 3" />
      {pts ? <polyline points={pts.map((p) => `${X(p.pred)},${Y(p.obs)}`).join(" ")} fill="none" stroke={CY} strokeWidth="1.6" /> : null}
      {pts ? pts.map((p, i) => <circle key={i} cx={X(p.pred)} cy={Y(p.obs)} r="2.5" fill={CY} />) : <text x={W / 2} y={H / 2} fill="#6b7683" fontSize="8" textAnchor="middle">needs resolved calls</text>}
      <text x={W / 2} y={H - 2} fill="#6b7683" fontSize="7" textAnchor="middle">predicted →</text>
    </svg>
  );
}

/* 5. EDGE-DECAY METER — rolling hit-rate over the last N resolved calls. */
export function EdgeDecay({ hist }: { hist: OracleHistory | null }) {
  const resolved = (hist?.rows || []).filter((r) => r.hit != null).slice().reverse();
  const W = 150, H = 130, pad = 14;
  const roll = useMemo(() => { const win = 8; const out: number[] = []; for (let i = 0; i < resolved.length; i++) { const s = resolved.slice(Math.max(0, i - win + 1), i + 1); out.push(s.reduce((a, r) => a + (r.hit || 0), 0) / s.length); } return out; }, [resolved]);
  const X = (i: number) => pad + (roll.length > 1 ? i / (roll.length - 1) : 0) * (W - 2 * pad), Y = (v: number) => H - pad - v * (H - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axv">
      <line x1={pad} y1={Y(0.5)} x2={W - pad} y2={Y(0.5)} stroke="rgba(255,255,255,.15)" strokeDasharray="3 3" /><text x={W - pad} y={Y(0.5) - 2} fill="#6b7683" fontSize="6" textAnchor="end">50%</text>
      {roll.length > 1 ? <polyline points={roll.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} fill="none" stroke={roll[roll.length - 1] >= 0.5 ? POS : NEG} strokeWidth="1.6" /> : <text x={W / 2} y={H / 2} fill="#6b7683" fontSize="8" textAnchor="middle">needs history</text>}
      <text x={W / 2} y={H - 2} fill="#6b7683" fontSize="7" textAnchor="middle">rolling hit-rate →</text>
    </svg>
  );
}

/* 6. WHAT-IF SCENARIO — drag vol× and drift shift; recompute the horizon's band + P(up) live. */
export function WhatIf({ h }: { h: OracleHorizon }) {
  const [volMul, setVolMul] = useState(1); const [driftBp, setDriftBp] = useState(0);
  const s0 = Math.log(h.p95 / h.p05) / (2 * 1.6449) || 0.02; // reconstruct sigma from the band
  const m0 = Math.log(h.p50);
  const s = s0 * volMul; const m = m0 + driftBp / 10000;
  const q = (p: number) => Math.exp(m + s * normInv(p));
  const pUp = 1 - (0.5 * (1 + erf((Math.log(h.spot) - m) / (s * Math.SQRT2))));
  return (
    <div className="axv-whatif">
      <div className="axv-wi-row"><span>Vol ×{volMul.toFixed(2)}</span><input type="range" min={0.5} max={2} step={0.05} value={volMul} onChange={(e) => setVolMul(+e.target.value)} /></div>
      <div className="axv-wi-row"><span>Drift {driftBp >= 0 ? "+" : ""}{driftBp}bp</span><input type="range" min={-500} max={500} step={10} value={driftBp} onChange={(e) => setDriftBp(+e.target.value)} /></div>
      <div className="axv-wi-out">
        <span>p05 <b>{q(0.05).toFixed(2)}</b></span><span>p50 <b>{Math.exp(m).toFixed(2)}</b></span><span>p95 <b>{q(0.95).toFixed(2)}</b></span>
        <span>P(up) <b style={{ color: pUp >= 0.5 ? POS : NEG }}>{(pUp * 100).toFixed(0)}%</b></span>
      </div>
    </div>
  );
}
function erf(x: number) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

/* 7. TIME MACHINE — hindcast: forecast as-of N days ago, then animate the actual path vs the cone. */
interface Hindcast { ok: boolean; asOf: string; spot: number; dir: string; predRet5d: number; realizedRet5d: number | null; hit: number | null; cone: { barsAhead: number; p05: number; p50: number; p95: number }[]; actual: { i: number; c: number }[] }
export function TimeMachine({ symbol }: { symbol: string }) {
  const [hc, setHc] = useState<Hindcast | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(0);
  const [days, setDays] = useState(20);
  const run = async (d = days) => { setBusy(true); setHc(null); setReveal(0); try { const r = await fetch(`/api/apex/predict/${encodeURIComponent(symbol)}/hindcast?daysAgo=${d}`).then((x) => x.json()); if (r.ok) { setHc(r); } } catch { /* ignore */ } setBusy(false); };
  useEffect(() => { if (!hc) return; setReveal(0); const iv = setInterval(() => setReveal((n) => { if (n >= hc.actual.length) { clearInterval(iv); return n; } return n + 1; }), 90); return () => clearInterval(iv); }, [hc]);
  const W = 320, H = 150, pad = 6, maxBar = 34;
  const all = hc ? [hc.spot, ...hc.actual.map((a) => a.c), ...hc.cone.flatMap((c) => [c.p05, c.p95])] : [1];
  const lo = Math.min(...all), hi = Math.max(...all), rg = hi - lo || 1;
  const X = (i: number) => pad + (i / maxBar) * (W - 2 * pad), Y = (v: number) => H - pad - ((v - lo) / rg) * (H - 2 * pad);
  return (
    <div className="axv-tm">
      {!hc ? <button className="axv-tm-run" onClick={() => run()} disabled={busy}>{busy ? "Loading hindcast…" : `⏪ Time-machine: forecast from ${days}d ago`}</button> : (
        <>
          <div className="axv-tm-h"><span>AS OF {hc.asOf?.slice(0, 10)}</span><span className="axv-tm-hit" style={{ color: hc.hit ? POS : NEG }}>{hc.hit ? "✓ HIT" : "✗ MISS"}</span></div>
          <svg viewBox={`0 0 ${W} ${H}`} className="axv" preserveAspectRatio="none">
            {(() => { const c5 = hc.cone.find((c) => c.barsAhead >= 30) || hc.cone[hc.cone.length - 1]; const bx = X(c5.barsAhead); return (<>
              <path d={`M${X(0)},${Y(hc.spot)} L${bx},${Y(c5.p95)} L${bx},${Y(c5.p05)} Z`} fill="rgba(224,149,43,.10)" />
              <line x1={X(0)} y1={Y(hc.spot)} x2={bx} y2={Y(c5.p50)} stroke={WARN} strokeWidth="1.4" strokeDasharray="4 3" />
            </>); })()}
            <polyline points={hc.actual.slice(0, reveal).map((a) => `${X(a.i)},${Y(a.c)}`).join(" ")} fill="none" stroke={hc.hit ? POS : NEG} strokeWidth="1.8" />
            {reveal > 0 && reveal <= hc.actual.length ? <circle cx={X(hc.actual[Math.min(reveal, hc.actual.length) - 1].i)} cy={Y(hc.actual[Math.min(reveal, hc.actual.length) - 1].c)} r="3" fill="#fff" /> : null}
            <line x1={X(0)} y1={Y(hc.spot)} x2={W - pad} y2={Y(hc.spot)} stroke="rgba(255,255,255,.12)" strokeDasharray="2 2" />
          </svg>
          <div className="axv-tm-foot"><span>pred 5d <b style={{ color: hc.predRet5d >= 0 ? POS : NEG }}>{hc.predRet5d >= 0 ? "+" : ""}{hc.predRet5d}%</b></span><span>actual <b style={{ color: (hc.realizedRet5d ?? 0) >= 0 ? POS : NEG }}>{hc.realizedRet5d != null ? (hc.realizedRet5d >= 0 ? "+" : "") + hc.realizedRet5d + "%" : "—"}</b></span><button className="axv-tm-re" onClick={() => run(days)}>↻</button><button className="axv-tm-re" onClick={() => { const d = days === 20 ? 60 : days === 60 ? 120 : 20; setDays(d); run(d); }}>{days}d</button></div>
        </>
      )}
    </div>
  );
}

/* 8. NEWS INTELLIGENCE — multi-source event feed + propagation tree (how a story ripples out). */
interface NIItem { title: string; source: string; corroboration: number; ageH: number; eventLabel: string; event: string; sentiment: number; impact: number }
interface NIProp { sym: string; kind: string; rho: number | null; effect: number; dir: string }
interface NewsIntelData { symbol: string; count: number; sources: string[]; newsScore: number; bull: number; bear: number; items: NIItem[]; propagation: NIProp[]; topEvents: { label: string; n: number }[] }
export function NewsIntel({ symbol, onPick }: { symbol: string; onPick: (s: string) => void }) {
  const [d, setD] = useState<NewsIntelData | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let dead = false; setD(null); setBusy(true); fetch(`/api/apex/predict/${encodeURIComponent(symbol)}/news`).then((r) => r.json()).then((j) => { if (!dead && j && j.items) setD(j); }).catch(() => {}).finally(() => !dead && setBusy(false)); return () => { dead = true; }; }, [symbol]);
  if (busy && !d) return <div className="axv-ni-empty">Scanning news wires…</div>;
  if (!d) return <div className="axv-ni-empty">No news data.</div>;
  const sc = d.newsScore >= 0.1 ? POS : d.newsScore <= -0.1 ? NEG : "#9aa7b4";
  const evColor = (s: number) => s > 0.1 ? POS : s < -0.1 ? NEG : "#6b7683";
  return (
    <div className="axv-ni">
      <div className="axv-ni-hero">
        <div className="axv-ni-score" style={{ color: sc }}>{d.newsScore >= 0 ? "+" : ""}{d.newsScore.toFixed(2)}</div>
        <div className="axv-ni-meta"><span><b>{d.count}</b> stories · <b>{d.sources.length}</b> sources</span><span className="axv-ni-bb"><i style={{ color: POS }}>{d.bull}▲</i> <i style={{ color: NEG }}>{d.bear}▼</i></span></div>
        <div className="axv-ni-events">{d.topEvents.map((e) => <span key={e.label} className="axv-ni-ev">{e.label}{e.n > 1 ? ` ×${e.n}` : ""}</span>)}</div>
      </div>
      <div className="axv-ni-cols">
        <div className="axv-ni-feed">
          {d.items.slice(0, 10).map((it, i) => (
            <div key={i} className="axv-ni-row">
              <span className="axv-ni-badge" style={{ borderColor: evColor(it.sentiment), color: evColor(it.sentiment) }}>{it.event === "general" ? "•" : it.eventLabel}</span>
              <span className="axv-ni-title">{it.title}</span>
              <span className="axv-ni-src">{it.source}{it.corroboration > 1 ? ` ·×${it.corroboration}` : ""} · {it.ageH < 24 ? `${it.ageH.toFixed(0)}h` : `${(it.ageH / 24).toFixed(0)}d`}</span>
            </div>
          ))}
        </div>
        <div className="axv-ni-tree">
          <div className="axv-ni-tree-h">PROPAGATION — how this ripples out</div>
          <svg viewBox="0 0 240 168" className="axv" preserveAspectRatio="xMidYMid meet">
            {d.propagation.map((p, i) => { const n = d.propagation.length; const y = 14 + (i / Math.max(1, n - 1)) * 140; const c = p.effect > 0.05 ? POS : p.effect < -0.05 ? NEG : "#6b7683"; const w = 0.6 + Math.abs(p.effect) * 4; return (
              <g key={p.sym}>
                <path d={`M40,84 C90,84 100,${y} 150,${y}`} fill="none" stroke={c} strokeWidth={w} opacity="0.55" />
                <circle cx={150} cy={y} r={7} fill={`${c}22`} stroke={c} strokeWidth="1.2" onClick={() => onPick(p.sym)} style={{ cursor: "pointer" }} />
                <text x={162} y={y - 2} fill="#c9d4e0" fontSize="8" fontFamily="var(--ax-mono,monospace)">{p.sym}</text>
                <text x={162} y={y + 7} fill="#6b7683" fontSize="6">{p.kind}{p.rho != null ? ` ρ${p.rho}` : ""}</text>
              </g>
            ); })}
            <circle cx={40} cy={84} r={13} fill="#141a22" stroke={sc} strokeWidth="1.6" />
            <text x={40} y={87} fill="#e6edf3" fontSize="8" fontWeight="700" textAnchor="middle" fontFamily="var(--ax-mono,monospace)">{d.symbol}</text>
          </svg>
        </div>
      </div>
    </div>
  );
}

/* 9. NEWS STUDY — empirical payoff of each event type (fills in as the archive ages). */
interface StudyRow { event: string; n: number; avgFwd5d: number; sentimentHit: number }
interface StudyData { logged: number; aged: number; note?: string; byEvent: StudyRow[] }
export function NewsStudy({ symbol }: { symbol: string }) {
  const [d, setD] = useState<StudyData | null>(null);
  useEffect(() => { let dead = false; setD(null); fetch(`/api/apex/predict/${encodeURIComponent(symbol)}/newsstudy`).then((r) => r.json()).then((j) => { if (!dead && j && j.ok) setD(j); }).catch(() => {}); return () => { dead = true; }; }, [symbol]);
  if (!d) return null;
  return (
    <div className="axv-ns">
      <div className="axv-ns-h">EVENT PAYOFF STUDY <em>{d.logged} logged · {d.aged} aged</em></div>
      {d.byEvent.length === 0 ? (
        <div className="axv-ns-acc">
          <div className="axv-ns-bar"><span style={{ width: `${Math.min(100, (d.aged / 10) * 100)}%` }} /></div>
          <div className="axv-ns-note">{d.note || "Accumulating…"}</div>
        </div>
      ) : (
        <div className="axv-ns-tbl">
          <div className="axv-ns-tr axv-ns-th"><span>EVENT</span><span className="r">N</span><span className="r">AVG 5D</span><span className="r">HIT</span></div>
          {d.byEvent.slice(0, 8).map((e) => (
            <div key={e.event} className="axv-ns-tr"><span>{e.event.replace(/_/g, " ")}</span><span className="r">{e.n}</span><span className="r" style={{ color: e.avgFwd5d >= 0 ? POS : NEG }}>{e.avgFwd5d >= 0 ? "+" : ""}{e.avgFwd5d}%</span><span className="r" style={{ color: e.sentimentHit >= 55 ? POS : e.sentimentHit <= 45 ? NEG : "#9aa7b4" }}>{e.sentimentHit}%</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export const VIZ_CSS = `
.axv-ns { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:6px; padding:9px 11px; }
.axv-ns-h { font-size:8.5px; font-weight:700; letter-spacing:.06em; color:var(--ax-cydim,#4d9fd1); display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
.axv-ns-h em { font-style:normal; color:var(--ax-dim,#6b7683); font-family:var(--ax-mono); font-weight:500; }
.axv-ns-acc { }
.axv-ns-bar { height:5px; background:var(--ax-surface,#0b0f16); border:1px solid var(--ax-bd,#20303f); border-radius:3px; overflow:hidden; margin-bottom:6px; }
.axv-ns-bar span { display:block; height:100%; background:${CY}; transition:width .3s; }
.axv-ns-note { font-size:10px; color:var(--ax-dim,#6b7683); line-height:1.4; }
.axv-ns-tbl { font-family:var(--ax-mono); font-size:10.5px; }
.axv-ns-tr { display:grid; grid-template-columns:1.6fr .5fr .8fr .6fr; gap:6px; padding:3px 2px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); }
.axv-ns-tr .r { text-align:right; } .axv-ns-th { color:var(--ax-dim,#6b7683); font-size:8px; }
.axv-ns-tr span:first-child { text-transform:capitalize; color:var(--ax-mut,#9aa7b4); }
.axv-ni-empty { padding:14px; color:var(--ax-dim,#6b7683); font-size:11px; }
.axv-ni-hero { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:9px; }
.axv-ni-score { font-family:var(--ax-mono); font-size:22px; font-weight:800; }
.axv-ni-meta { display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:var(--ax-mut,#9aa7b4); }
.axv-ni-meta b { color:var(--ax-tx,#e6edf3); font-family:var(--ax-mono); } .axv-ni-bb i { font-style:normal; font-family:var(--ax-mono); margin-right:6px; }
.axv-ni-events { display:flex; gap:5px; flex-wrap:wrap; margin-left:auto; }
.axv-ni-ev { font-size:9px; color:var(--ax-cydim,#4d9fd1); border:1px solid color-mix(in srgb, ${CY} 30%, transparent); border-radius:4px; padding:2px 7px; }
.axv-ni-cols { display:grid; grid-template-columns:1.3fr 1fr; gap:14px; }
.axv-ni-feed { display:flex; flex-direction:column; max-height:230px; overflow-y:auto; }
.axv-ni-row { display:grid; grid-template-columns:auto 1fr; gap:5px 8px; padding:5px 2px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); align-items:baseline; }
.axv-ni-badge { grid-row:1; font-size:7.5px; font-weight:700; letter-spacing:.03em; border:1px solid; border-radius:3px; padding:1px 5px; white-space:nowrap; align-self:start; }
.axv-ni-title { grid-row:1; font-size:11px; line-height:1.35; color:var(--ax-tx,#e6edf3); }
.axv-ni-src { grid-column:2; grid-row:2; font-size:8.5px; color:var(--ax-dim,#6b7683); font-family:var(--ax-mono); }
.axv-ni-tree-h { font-size:8px; letter-spacing:.05em; color:var(--ax-dim,#6b7683); margin-bottom:4px; }
.axv-tm-run, .axv-tm-re { background:color-mix(in srgb, ${PUR} 14%, transparent); border:1px solid color-mix(in srgb, ${PUR} 40%, transparent); color:${PUR}; border-radius:5px; padding:7px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; }
.axv-tm-run { width:100%; } .axv-tm-run:disabled { opacity:.6; }
.axv-tm-re { padding:3px 8px; font-size:10px; }
.axv-tm-h { display:flex; justify-content:space-between; font-size:8.5px; letter-spacing:.05em; color:var(--ax-dim,#6b7683); font-family:var(--ax-mono); margin-bottom:3px; }
.axv-tm-hit { font-weight:700; }
.axv-tm-foot { display:flex; align-items:center; gap:12px; font-size:10px; color:var(--ax-mut,#9aa7b4); font-family:var(--ax-mono); margin-top:3px; }
.axv-tm-foot b { } .axv-tm-foot .axv-tm-re { margin-left:auto; }
.axv { width:100%; display:block; }
.axv-whatif { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:6px; padding:9px 11px; }
.axv-wi-row { display:flex; align-items:center; gap:10px; margin-bottom:7px; font-size:10px; color:var(--ax-mut,#9aa7b4); font-family:var(--ax-mono); }
.axv-wi-row span { width:96px; } .axv-wi-row input { flex:1; accent-color:${CY}; }
.axv-wi-out { display:flex; gap:14px; flex-wrap:wrap; font-size:10px; color:var(--ax-dim,#6b7683); font-family:var(--ax-mono); padding-top:6px; border-top:1px solid var(--ax-hair,rgba(255,255,255,.05)); }
.axv-wi-out b { color:var(--ax-tx,#e6edf3); }
`;
