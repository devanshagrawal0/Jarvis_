import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "../apex-data";
import { MonteCarloFan, ContagionGraph, RegimeRibbon, ReliabilityCurve, EdgeDecay, WhatIf, TimeMachine, NewsIntel, NewsStudy, VIZ_CSS } from "./OracleViz";

// APEX Oracle Panel — the prediction cockpit. Fetches /api/apex/predict/:symbol (regime,
// multi-horizon forecast, options, signal packages, Jarvis synthesis), renders a compact
// summary in the right rail and a full expandable overlay, and refreshes-to-resolve.

const POS = "#26a69a", NEG = "#ef5350", CY = "#4d9fd1", WARN = "#e0952b", PUR = "#9a86d4";

export interface OracleOption { type: string; strike: number; expiryDays: number; premium: number; impliedVol: number; delta: number; gamma: number; vega: number; theta: number; rho: number; ev: number; roi: number; pITM: number; breakeven: number }
export interface OracleHorizon { horizon: string; tau: number; spot: number; p05: number; p25: number; p50: number; p75: number; p95: number; predRet: number; dir: string; pUp: number; pUpModel: number; edge: number; size: number; disagreement: number; confidence: number; sigmaH: number; var95: number; cvar95: number; option: OracleOption | null }
export interface OraclePayload {
  ok: boolean; reason?: string; symbol: string; spot: number; degraded?: boolean; muBar?: number; sigBar?: number;
  regime: { label: string; confidence: number; hurst: number; adx: number | null; volPct: number };
  crossScore: number; packages: Record<string, number>;
  signalDetail: { peers?: { sym: string; rho: number; mom: number; kind: string }[]; sector?: { etf: string; rho: number; etfMom: number } | null; news?: { count: number; score: number } | null };
  jarvis: { pUp: number; bias: string; thesis: string } | null;
  quant?: Record<string, Record<string, unknown>> | null;
  report?: OracleReport | null;
  horizons: OracleHorizon[]; asOf: number; selfCheck?: { ok: boolean; issues: string[] };
}
export interface OracleHistory { rows: { horizon: string; hit: number | null; abs_pct_err: number | null; made_at: number }[]; summary: { total: number; resolved: number; hitRate: number | null; mape: number | null } }
export interface OracleReport {
  signal: { label: string; tone: string };
  verdict: { direction: string; magnitudePct: number; horizon: string; pUp: number; confidence: number };
  crossScore: number; summary: string; flags: string[];
  sections: { title: string; score: number; bullets: { t: string; dir: number }[] }[];
}
const toneColor = (t: string) => t === "pos" ? POS : t === "neg" ? NEG : t === "warn" ? WARN : "#9aa7b4";

// ── Holographic visual primitives ─────────────────────────────────────────
// Radial gauge: a 240° arc filled to `value` (0..1), glowing, big number in the centre.
function RadialGauge({ value, label, color, sub, size = 92 }: { value: number; label: string; color: string; sub?: string; size?: number }) {
  const v = Math.max(0, Math.min(1, value));
  const R = 38, cx = 50, cy = 50, start = 150, sweep = 240; // degrees
  const pol = (deg: number) => { const a = (deg * Math.PI) / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; };
  const arc = (frac: number) => { const a0 = start, a1 = start + sweep * frac; const [x0, y0] = pol(a0), [x1, y1] = pol(a1); const large = sweep * frac > 180 ? 1 : 0; return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };
  const uid = `g${label}${Math.round(v * 100)}`;
  return (
    <div className="axo-gauge" style={{ width: size }}>
      <svg viewBox="0 0 100 100" style={{ width: size, height: size, display: "block" }}>
        <defs><linearGradient id={uid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.5" /><stop offset="1" stopColor={color} /></linearGradient>
          <filter id={`${uid}f`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path d={arc(1)} fill="none" stroke="#1b2430" strokeWidth="8" strokeLinecap="round" />
        <path d={arc(v)} fill="none" stroke={`url(#${uid})`} strokeWidth="8" strokeLinecap="round" filter={`url(#${uid}f)`} />
        <text x="50" y="47" textAnchor="middle" fontSize="23" fontWeight="800" fill={color} fontFamily="var(--ax-mono,monospace)">{Math.round(v * 100)}</text>
        <text x="50" y="60" textAnchor="middle" fontSize="8" fill="var(--ax-dim,#6b7683)">%</text>
      </svg>
      <div className="axo-gauge-l">{label}</div>
      {sub ? <div className="axo-gauge-s" style={{ color }}>{sub}</div> : null}
    </div>
  );
}

// Forward forecast cone from the 5 horizons: p50 line + p05/p95 shaded band, starting at spot.
function MiniForecast({ horizons, spot, color }: { horizons: OracleHorizon[]; spot: number; color: string }) {
  const hs = horizons;
  if (!hs.length || !Number.isFinite(spot)) return null;
  const pts = [{ p05: spot, p50: spot, p95: spot }, ...hs.map((h) => ({ p05: h.p05, p50: h.p50, p95: h.p95 }))];
  const lo = Math.min(...pts.map((p) => p.p05)), hi = Math.max(...pts.map((p) => p.p95));
  const W = 210, H = 78, pad = 3;
  const X = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const Y = (v: number) => hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2);
  const top = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.p95).toFixed(1)}`).join(" ");
  const bot = pts.map((p, i) => `${X(i).toFixed(1)},${Y(p.p05).toFixed(1)}`).reverse().join(" ");
  const mid = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(p.p50).toFixed(1)}`).join(" ");
  const uid = `cone${Math.round(spot)}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axo-cone" preserveAspectRatio="none">
      <defs><linearGradient id={uid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0.03" /></linearGradient></defs>
      <line x1={pad} y1={Y(spot)} x2={W - pad} y2={Y(spot)} stroke="#2a3542" strokeWidth="0.7" strokeDasharray="2 3" />
      <polygon points={`${top} ${bot}`} fill={`url(#${uid})`} />
      <path d={mid} fill="none" stroke={color} strokeWidth="1.6" />
      {pts.map((p, i) => i > 0 && i === pts.length - 1 ? <circle key={i} cx={X(i)} cy={Y(p.p50)} r="2.4" fill={color} /> : null)}
      {hs.map((h, i) => <text key={h.horizon} x={X(i + 1)} y={H - 1} textAnchor="middle" fontSize="6.5" fill="var(--ax-dim,#6b7683)" fontFamily="var(--ax-mono,monospace)">{h.horizon}</text>)}
    </svg>
  );
}

// Diverging score meter: −1…+1 centred bar for a signal-package score.
function ScoreMeter({ score }: { score: number }) {
  const v = Math.max(-1, Math.min(1, score));
  const c = v > 0.08 ? POS : v < -0.08 ? NEG : "#8794a3";
  return (
    <span className="axo-meter" title={`${v >= 0 ? "+" : ""}${v.toFixed(2)}`}>
      <span className="axo-meter-mid" />
      <span className="axo-meter-fill" style={{ background: c, width: `${Math.abs(v) * 50}%`, left: v >= 0 ? "50%" : `${50 - Math.abs(v) * 50}%` }} />
    </span>
  );
}

// The algo verdict card — labelled signal + up/down/stable + bullet-point proof per source.
function AlgoReport({ r }: { r: OracleReport }) {
  const sc = toneColor(r.signal.tone);
  const dirColor = r.verdict.direction === "UP" ? POS : r.verdict.direction === "DOWN" ? NEG : WARN;
  return (
    <div className="axo-report">
      <div className="axo-rp-hero" style={{ ["--tc" as string]: sc }}>
        <div className="axo-rp-badge">
          <div className="axo-rp-badge-k">ALGO VERDICT</div>
          <div className="axo-rp-signal" style={{ color: sc }}>{r.signal.label}</div>
          <div className="axo-rp-dir" style={{ color: dirColor }}>{r.verdict.direction === "UP" ? "▲" : r.verdict.direction === "DOWN" ? "▼" : "▬"} {r.verdict.direction} ~{r.verdict.magnitudePct}% <span>/ {r.verdict.horizon}</span></div>
        </div>
        <div className="axo-rp-stats">
          <div className="axo-rp-stat"><span>P(UP)</span><b style={{ color: r.verdict.pUp >= 50 ? POS : NEG }}>{r.verdict.pUp}%</b></div>
          <div className="axo-rp-stat"><span>CONFIDENCE</span><b>{r.verdict.confidence}%</b></div>
          <div className="axo-rp-stat"><span>SIGNAL</span><b style={{ color: r.crossScore >= 0 ? POS : NEG }}>{r.crossScore >= 0 ? "+" : ""}{r.crossScore.toFixed(2)}</b></div>
        </div>
      </div>
      <p className="axo-rp-summary">{r.summary}</p>
      <div className="axo-rp-sections">
        {r.sections.map((s) => (
          <div key={s.title} className="axo-rp-sec">
            <div className="axo-rp-sec-h"><span>{s.title}</span><span className="axo-rp-sec-sc"><ScoreMeter score={s.score} /><b style={{ color: s.score > 0.08 ? POS : s.score < -0.08 ? NEG : "#9aa7b4" }}>{s.score >= 0 ? "+" : ""}{s.score.toFixed(2)}</b></span></div>
            {s.bullets.map((b, i) => <div key={i} className="axo-rp-bullet"><span className="axo-rp-mk" style={{ color: b.dir > 0 ? POS : b.dir < 0 ? NEG : "#6b7683" }}>{b.dir > 0 ? "▲" : b.dir < 0 ? "▼" : "•"}</span>{b.t}</div>)}
          </div>
        ))}
      </div>
      {r.flags.length ? <div className="axo-rp-flags"><span className="axo-rp-flags-h">⚠ WATCH</span>{r.flags.map((f, i) => <div key={i} className="axo-rp-flag">{f}</div>)}</div> : null}
    </div>
  );
}

const money = (n: number | null | undefined, d = 2) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const pctS = (n: number | null | undefined, d = 1) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
const regimeColor = (l: string) => l.includes("UP") ? POS : l.includes("DOWN") ? NEG : l === "HIGH_VOL" ? WARN : PUR;

export function useOracle(symbol: string) {
  const [data, setData] = useState<OraclePayload | null>(null);
  const [hist, setHist] = useState<OracleHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvedNote, setResolvedNote] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async (mode: "get" | "refresh") => {
    if (busy.current) return; busy.current = true; setLoading(true);
    try {
      const url = mode === "refresh" ? `/api/apex/predict/${encodeURIComponent(symbol)}/refresh` : `/api/apex/predict/${encodeURIComponent(symbol)}`;
      const r = await fetch(url, mode === "refresh" ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : undefined);
      const d = await r.json();
      if (d && d.ok) setData(d);
      if (d && Array.isArray(d.resolvedNow) && d.resolvedNow.length) {
        const hits = d.resolvedNow.filter((x: { hit: number }) => x.hit).length;
        setResolvedNote(`Resolved ${d.resolvedNow.length} past calls — ${hits} hit, ${d.resolvedNow.length - hits} missed. Calibration updated.`);
      }
      const h = await fetch(`/api/apex/predict/${encodeURIComponent(symbol)}/history?limit=80`).then((x) => x.json()).catch(() => null);
      if (h) setHist(h);
    } catch { /* ignore */ } finally { setLoading(false); busy.current = false; }
  }, [symbol]);

  useEffect(() => { setData(null); setHist(null); setResolvedNote(null); load("get"); }, [symbol, load]);
  return { data, hist, loading, resolvedNote, refresh: () => load("refresh") };
}

/* Compact card for the right rail. */
export function OracleCard({ o, loading, onExpand, onRefresh }: { o: OraclePayload | null; loading: boolean; onExpand: () => void; onRefresh: () => void }) {
  const oneDay = o?.horizons.find((h) => h.horizon === "1d");
  const rc = o ? regimeColor(o.regime.label) : PUR;
  return (
    <div className="axt-panel axo-card">
      <div className="axt-ph">◎ ORACLE PREDICTION
        <span className="axo-hd-r">
          <button className="axo-mini" title="Recompute + resolve past calls" onClick={onRefresh}>{loading ? "…" : "↻"}</button>
          <button className="axo-mini" title="Expand full analysis" onClick={onExpand}>⤢</button>
        </span>
      </div>
      {!o ? <div className="axo-empty">{loading ? "Computing forecast…" : "No forecast."}</div> : (
        <>
          {(() => {
            const rep = o.report; const tone = rep ? rep.signal.tone : "neutral"; const tc = toneColor(tone);
            const conf = rep ? rep.verdict.confidence : (oneDay ? Math.round(oneDay.confidence * 100) : 50);
            const pUp = rep ? rep.verdict.pUp : (oneDay ? Math.round(oneDay.pUp * 100) : 50);
            const dc = rep ? (rep.verdict.direction === "UP" ? POS : rep.verdict.direction === "DOWN" ? NEG : WARN) : PUR;
            return (
              <div className="axo-sum" style={{ ["--tc" as string]: tc }}>
                <div className="axo-sum-top">
                  <span className="axo-sum-sig" style={{ color: tc }}>{rep ? rep.signal.label : (oneDay ? oneDay.dir : "—")}</span>
                  {rep && <span className="axo-sum-dir" style={{ color: dc }}>{rep.verdict.direction === "UP" ? "▲" : rep.verdict.direction === "DOWN" ? "▼" : "▬"} {rep.verdict.direction} ~{rep.verdict.magnitudePct}%<em> / 5d</em></span>}
                </div>
                <div className="axo-sum-chips">
                  <span className="axo-chip">P(up) <b style={{ color: pUp >= 50 ? POS : NEG }}>{pUp}%</b></span>
                  <span className="axo-chip">Conf <b>{conf}%</b></span>
                  <span className="axo-chip">Regime <b style={{ color: rc }}>{o.regime.label.replace("_", " ")}</b></span>
                  {o.degraded && <span className="axo-chip axo-chip-warn">degraded</span>}
                </div>
              </div>
            );
          })()}
          <div className="axo-cone-wrap"><div className="axo-cone-h">5-HORIZON FORECAST <em>{money(o.spot)} → {money(o.horizons[o.horizons.length - 1]?.p50)}</em></div><MiniForecast horizons={o.horizons} spot={o.spot} color={rc} /></div>
          <div className="axo-horizons">
            {o.horizons.map((h) => (
              <div key={h.horizon} className="axo-hz" title={`${h.dir} · P(up) ${(h.pUp * 100).toFixed(0)}% · conf ${(h.confidence * 100).toFixed(0)}%`}>
                <span className="axo-hz-k">{h.horizon}</span>
                <span className="axo-hz-dir" style={{ color: h.dir === "LONG" ? POS : NEG }}>{h.dir === "LONG" ? "▲" : "▼"}</span>
                <span className="axo-hz-bar"><span className="axo-hz-mid" /><span style={{ width: `${Math.abs(h.pUp - 0.5) * 200}%`, left: h.pUp >= 0.5 ? "50%" : `${h.pUp * 100}%`, background: h.dir === "LONG" ? POS : NEG }} /></span>
                <span className="axo-hz-p" style={{ color: h.dir === "LONG" ? POS : NEG }}>{(h.pUp * 100).toFixed(0)}%</span>
                <span className="axo-hz-t">{money(h.p50)}</span>
              </div>
            ))}
          </div>
          {o.jarvis?.thesis ? <div className="axo-thesis">{o.jarvis.thesis}</div> : null}
          <button className="axo-expand" onClick={onExpand}>Full analysis · options · scorecard →</button>
        </>
      )}
    </div>
  );
}

/* Full-screen expandable overlay. */
export function OracleOverlay({ o, hist, bars, loading, resolvedNote, onClose, onRefresh, onPick }: { o: OraclePayload | null; hist: OracleHistory | null; bars?: Bar[]; loading: boolean; resolvedNote: string | null; onClose: () => void; onRefresh: () => void; onPick: (s: string) => void }) {
  const [sel, setSel] = useState("1d");
  const [tab, setTab] = useState<"home" | "analysis" | "tools">("home");
  const h = o?.horizons.find((x) => x.horizon === sel) || o?.horizons[0];
  const rc = o ? regimeColor(o.regime.label) : PUR;
  const pkgOrder = ["technical", "sector", "peer", "news", "macro"];
  const rep = o?.report || null;
  const tc = rep ? toneColor(rep.signal.tone) : PUR;
  return (
    <div className="axo-back" onClick={onClose}>
      <div className="axo-full" onClick={(e) => e.stopPropagation()}>
        <div className="axo-full-h">
          <span className="axo-full-t">◎ ORACLE · {o?.symbol}</span>
          {o && <span className="axo-full-reg" style={{ color: rc }}>{o.regime.label.replace("_", " ")} · conf {(o.regime.confidence * 100).toFixed(0)}%</span>}
          <span className="axo-tabs">
            {(["home", "analysis", "tools"] as const).map((t) => <button key={t} className={`axo-tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t === "home" ? "Home" : t === "analysis" ? "Analysis" : "Tools"}</button>)}
          </span>
          <span className="axo-full-actions"><button className="axo-mini" onClick={onRefresh}>{loading ? "…" : "↻ Refresh"}</button><span className="axo-x" onClick={onClose}>✕</span></span>
        </div>
        {resolvedNote && <div className="axo-resolved">✓ {resolvedNote}</div>}
        {!o ? <div className="axo-empty" style={{ padding: 40 }}>{loading ? "Computing…" : "No forecast."}</div> : (
          <div className="axo-full-scroll">

          {/* ───────────── HOME — clean summary: signal · graph · signals · news ───────────── */}
          {tab === "home" && (
            <div className="axo-pane">
              {rep && (
                <div className="axo-hsum" style={{ ["--tc" as string]: tc }}>
                  <div className="axo-hsum-l">
                    <div className="axo-hsum-k">ALGO VERDICT · {rep.verdict.horizon}</div>
                    <div className="axo-hsum-sig" style={{ color: tc }}>{rep.signal.label}</div>
                    <div className="axo-hsum-dir" style={{ color: rep.verdict.direction === "UP" ? POS : rep.verdict.direction === "DOWN" ? NEG : WARN }}>{rep.verdict.direction === "UP" ? "▲" : rep.verdict.direction === "DOWN" ? "▼" : "▬"} {rep.verdict.direction} ~{rep.verdict.magnitudePct}%</div>
                  </div>
                  <div className="axo-hsum-stats">
                    <div className="axo-hstat"><span>P(UP)</span><b style={{ color: rep.verdict.pUp >= 50 ? POS : NEG }}>{rep.verdict.pUp}%</b></div>
                    <div className="axo-hstat"><span>CONFIDENCE</span><b>{rep.verdict.confidence}%</b></div>
                    <div className="axo-hstat"><span>SIGNAL FORCE</span><b style={{ color: o.crossScore >= 0 ? POS : NEG }}>{o.crossScore >= 0 ? "+" : ""}{o.crossScore.toFixed(2)}</b></div>
                    <div className="axo-hstat"><span>REGIME</span><b style={{ color: rc }}>{o.regime.label.replace("_", " ")}</b></div>
                  </div>
                </div>
              )}
              {rep && <p className="axo-hsummary">{rep.summary}</p>}
              <div className="axo-hgrid">
                <div className="axo-hcard">
                  <div className="axo-sec">5-HORIZON FORECAST <em>{money(o.spot)} → {money(o.horizons[o.horizons.length - 1]?.p50)}</em></div>
                  <MiniForecast horizons={o.horizons} spot={o.spot} color={rc} />
                  <div className="axo-horizons" style={{ marginTop: 8 }}>
                    {o.horizons.map((x) => (
                      <div key={x.horizon} className="axo-hz">
                        <span className="axo-hz-k">{x.horizon}</span>
                        <span className="axo-hz-dir" style={{ color: x.dir === "LONG" ? POS : NEG }}>{x.dir === "LONG" ? "▲" : "▼"}</span>
                        <span className="axo-hz-bar"><span className="axo-hz-mid" /><span style={{ width: `${Math.abs(x.pUp - 0.5) * 200}%`, left: x.pUp >= 0.5 ? "50%" : `${x.pUp * 100}%`, background: x.dir === "LONG" ? POS : NEG }} /></span>
                        <span className="axo-hz-p" style={{ color: x.dir === "LONG" ? POS : NEG }}>{(x.pUp * 100).toFixed(0)}%</span>
                        <span className="axo-hz-t">{money(x.p50)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="axo-hcard">
                  <div className="axo-sec">ALL SIGNALS <em>crossScore {o.crossScore >= 0 ? "+" : ""}{o.crossScore.toFixed(2)}</em></div>
                  <div className="axo-pkgs">
                    {pkgOrder.map((k) => { const v = o.packages[k] ?? 0; return (
                      <div key={k} className="axo-pkg"><span className="axo-pkg-l">{k}</span><span className="axo-pkg-track"><span className="axo-pkg-fill" style={{ width: `${Math.abs(v) * 50}%`, marginLeft: v < 0 ? `${50 - Math.abs(v) * 50}%` : "50%", background: v >= 0 ? POS : NEG }} /></span><span className="axo-pkg-v" style={{ color: v >= 0 ? POS : NEG }}>{v >= 0 ? "+" : ""}{v.toFixed(2)}</span></div>
                    ); })}
                  </div>
                  {rep?.flags.length ? <div className="axo-rp-flags" style={{ marginTop: 12 }}><span className="axo-rp-flags-h">⚠ WATCH</span>{rep.flags.slice(0, 3).map((f, i) => <div key={i} className="axo-rp-flag">{f}</div>)}</div> : null}
                </div>
              </div>
              <div className="axo-sec">NEWS INTELLIGENCE <em>surprise · reaction-gap · propagation</em></div>
              <NewsIntel symbol={o.symbol} onPick={onPick} />
            </div>
          )}

          {/* ───────────── ANALYSIS — the readable deep report ───────────── */}
          {tab === "analysis" && (
            <div className="axo-pane">
              {rep ? <AlgoReport r={rep} /> : null}
              <div className="axo-report" style={{ paddingTop: 4 }}>
                <div className="axo-sec">MULTI-HORIZON FORECAST</div>
                <div className="axo-tbl">
                  <div className="axo-tr axo-th"><span>H</span><span>DIR</span><span className="r">P(UP)</span><span className="r">TARGET</span><span className="r">RANGE (P05–P95)</span><span className="r">CONF</span></div>
                  {o.horizons.map((x) => (
                    <div key={x.horizon} className={`axo-tr${sel === x.horizon ? " on" : ""}`} onClick={() => setSel(x.horizon)}>
                      <span className="axo-k">{x.horizon}</span>
                      <span style={{ color: x.dir === "LONG" ? POS : NEG }}>{x.dir === "LONG" ? "▲" : "▼"} {x.dir}</span>
                      <span className="r" style={{ color: x.pUp >= 0.5 ? POS : NEG }}>{(x.pUp * 100).toFixed(0)}%</span>
                      <span className="r">{money(x.p50)} <em style={{ color: x.predRet >= 0 ? POS : NEG }}>{pctS(x.predRet)}</em></span>
                      <span className="r dim">{money(x.p05)}–{money(x.p95)}</span>
                      <span className="r">{(x.confidence * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
                {o.jarvis?.thesis && (<><div className="axo-sec">JARVIS SYNTHESIS <em style={{ color: regimeColor(o.jarvis.bias === "bullish" ? "TREND_UP" : o.jarvis.bias === "bearish" ? "TREND_DOWN" : "X") }}>{o.jarvis.bias}</em></div><p className="axo-jarvis">{o.jarvis.thesis}</p></>)}
                <div className="axo-sec">TRACK RECORD <em>predictions vs actual</em></div>
                <div className="axo-score">
                  {sc("HIT RATE", hist?.summary.hitRate != null ? `${(hist.summary.hitRate * 100).toFixed(0)}%` : "—", hist?.summary.hitRate != null && hist.summary.hitRate >= 0.5 ? POS : WARN)}
                  {sc("RESOLVED", `${hist?.summary.resolved ?? 0}`, CY)}
                  {sc("TRACKED", `${hist?.summary.total ?? 0}`, PUR)}
                  {sc("MAPE", hist?.summary.mape != null ? `${(hist.summary.mape * 100).toFixed(1)}%` : "—", WARN)}
                </div>
              </div>
            </div>
          )}

          {/* ───────────── TOOLS — in-depth instruments ───────────── */}
          {tab === "tools" && (
          <div className="axo-full-body">
            <div className="axo-col">
              <div className="axo-sec">HORIZON DETAIL <em>select a row</em></div>
              <div className="axo-tbl">
                <div className="axo-tr axo-th"><span>H</span><span>DIR</span><span className="r">P(UP)</span><span className="r">TARGET</span><span className="r">RANGE</span><span className="r">CONF</span></div>
                {o.horizons.map((x) => (
                  <div key={x.horizon} className={`axo-tr${sel === x.horizon ? " on" : ""}`} onClick={() => setSel(x.horizon)}>
                    <span className="axo-k">{x.horizon}</span>
                    <span style={{ color: x.dir === "LONG" ? POS : NEG }}>{x.dir === "LONG" ? "▲" : "▼"} {x.dir}</span>
                    <span className="r" style={{ color: x.pUp >= 0.5 ? POS : NEG }}>{(x.pUp * 100).toFixed(0)}%</span>
                    <span className="r">{money(x.p50)} <em style={{ color: x.predRet >= 0 ? POS : NEG }}>{pctS(x.predRet)}</em></span>
                    <span className="r dim">{money(x.p05)}–{money(x.p95)}</span>
                    <span className="r">{(x.confidence * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              {h && (
                <div className="axo-detail">
                  <div className="axo-kpis">
                    {kpi("DIRECTION", h.dir, h.dir === "LONG" ? POS : NEG)}
                    {kpi("EDGE", `${(h.edge * 100).toFixed(0)}%`, CY)}
                    {kpi("KELLY SIZE", `${(Math.abs(h.size) * 100).toFixed(1)}%`, WARN)}
                    {kpi("VaR 95%", pctS(-Math.abs(h.var95)), NEG)}
                    {kpi("DISAGREE", `${(h.disagreement * 100).toFixed(0)}%`, PUR)}
                  </div>
                  {h.option && (
                    <div className="axo-opt">
                      <div className="axo-opt-h">RECOMMENDED CONTRACT <span className="axo-opt-tag" style={{ color: h.option.type === "call" ? POS : NEG }}>{h.option.type.toUpperCase()}</span></div>
                      <div className="axo-opt-grid">
                        {ov("STRIKE", money(h.option.strike))}{ov("EXPIRY", `${h.option.expiryDays}d`)}{ov("PREMIUM", money(h.option.premium))}{ov("IV", `${h.option.impliedVol}%`)}
                        {ov("Δ DELTA", money(h.option.delta, 3))}{ov("Γ GAMMA", money(h.option.gamma, 4))}{ov("ν VEGA", money(h.option.vega, 3))}{ov("Θ THETA", money(h.option.theta, 3))}
                        {ov("EV", money(h.option.ev), h.option.ev >= 0 ? POS : NEG)}{ov("ROI", `${h.option.roi}%`, h.option.roi >= 0 ? POS : NEG)}{ov("P(ITM)", `${h.option.pITM}%`)}{ov("BREAKEVEN", money(h.option.breakeven))}
                      </div>
                      <div className="axo-opt-sub">PAYOFF AT EXPIRY</div>
                      <PayoffDiagram opt={h.option} spot={o.spot} p05={h.p05} p50={h.p50} p95={h.p95} />
                      <button className="axo-ticket" onClick={() => window.dispatchEvent(new CustomEvent("apex:open-paper", { detail: { symbol: o.symbol, option: h.option } }))}>▤ Send to Paper Trade →</button>
                      <div className="axo-opt-note">Paper-proof: premium priced at model IV; EV computed under the forecast distribution. Paper trading only — not advice.</div>
                    </div>
                  )}
                  <div className="axo-sec">MONTE-CARLO PATHS <em>{h.horizon} · GBM</em></div>
                  {o.muBar != null && o.sigBar != null ? <MonteCarloFan spot={o.spot} muBar={o.muBar * h.tau / 32} sigBar={o.sigBar * Math.sqrt(h.tau / 32)} /> : null}
                  <div className="axo-sec">WHAT-IF SCENARIO <em>drag vol / drift</em></div>
                  <WhatIf h={h} />
                </div>
              )}
            </div>
            <div className="axo-col">
              {o.quant && o.quant.ok && (<><div className="axo-sec">QUANT LAB <em>14 PhD-level models</em></div><QuantLab q={o.quant} /></>)}
              {o.signalDetail?.peers?.length ? (
                <><div className="axo-sec">PEERS · SUBSTITUTES <em>ρ / 20d mom</em></div>
                <div className="axo-peers">{o.signalDetail.peers.slice(0, 6).map((p) => (
                  <div key={p.sym} className="axo-peer" onClick={() => onPick(p.sym)}><b>{p.sym}</b><span className="axo-peer-kind">{p.kind}</span><span className="r">ρ {p.rho.toFixed(2)}</span><span className="r" style={{ color: p.mom >= 0 ? POS : NEG }}>{pctS(p.mom)}</span></div>
                ))}{o.signalDetail.sector && <div className="axo-peer axo-etf" onClick={() => onPick(o.signalDetail!.sector!.etf)}><b>{o.signalDetail.sector.etf}</b><span className="axo-peer-kind">sector ETF</span><span className="r">ρ {o.signalDetail.sector.rho.toFixed(2)}</span><span className="r" style={{ color: o.signalDetail.sector.etfMom >= 0 ? POS : NEG }}>{pctS(o.signalDetail.sector.etfMom)}</span></div>}</div></>
              ) : null}
              {o.signalDetail?.peers?.length ? (<><div className="axo-sec">CROSS-ASSET CONTAGION <em>ρ network</em></div><ContagionGraph symbol={o.symbol} peers={[...o.signalDetail.peers, ...(o.signalDetail.sector ? [{ sym: o.signalDetail.sector.etf, rho: o.signalDetail.sector.rho, mom: o.signalDetail.sector.etfMom, kind: "sector" }] : [])]} /></>) : null}
              {bars && bars.length > 40 ? (<><div className="axo-sec">REGIME TIMELINE <em>trend history</em></div><RegimeRibbon bars={bars} /></>) : null}
              <div className="axo-curves">
                <div className="axo-curve"><div className="axo-curve-t">RELIABILITY (calibration)</div><ReliabilityCurve hist={hist} /></div>
                <div className="axo-curve"><div className="axo-curve-t">EDGE DECAY</div><EdgeDecay hist={hist} /></div>
              </div>
              <div className="axo-sec">TIME MACHINE <em>hindcast: predicted vs actual</em></div>
              <TimeMachine symbol={o.symbol} />
              <div className="axo-sec">EVENT PAYOFF STUDY <em>news → realized move</em></div>
              <NewsStudy symbol={o.symbol} />
              <div className="axo-sec">MODEL VALIDATION <em>out-of-sample</em></div>
              <BacktestPanel symbol={o.symbol} />
              <div className="axo-hint">Click ↻ Refresh on the next session to resolve these calls against realized prices and self-correct.</div>
            </div>
          </div>
          )}
          </div>
        )}
        <style>{OVERLAY_CSS}{VIZ_CSS}</style>
      </div>
    </div>
  );
}

// Options payoff-at-expiry diagram (P&L vs underlying), with breakeven + forecast guides.
function PayoffDiagram({ opt, spot, p05, p50, p95 }: { opt: OracleOption; spot: number; p05: number; p50: number; p95: number }) {
  const W = 300, H = 120, padL = 4, padR = 4, padT = 8, padB = 16;
  const lo = Math.min(spot, opt.strike, p05) * 0.97, hi = Math.max(spot, opt.strike, p95) * 1.03;
  const payoff = (S: number) => ((opt.type === "call" ? Math.max(0, S - opt.strike) : Math.max(0, opt.strike - S)) - opt.premium) * 100;
  const N = 60; const pts = Array.from({ length: N + 1 }, (_, i) => { const S = lo + (i / N) * (hi - lo); return { S, pl: payoff(S) }; });
  const pls = pts.map((p) => p.pl); const pmin = Math.min(...pls), pmax = Math.max(...pls); const rg = pmax - pmin || 1;
  const X = (S: number) => padL + ((S - lo) / (hi - lo)) * (W - padL - padR);
  const Y = (pl: number) => padT + (1 - (pl - pmin) / rg) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p.S).toFixed(1)},${Y(p.pl).toFixed(1)}`).join(" ");
  const zeroY = Y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="axo-payoff" preserveAspectRatio="none">
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="rgba(255,255,255,.15)" strokeDasharray="3 3" />
      <path d={`${line} L${X(hi)},${zeroY} L${X(lo)},${zeroY} Z`} fill="rgba(38,166,154,.08)" stroke="none" />
      <path d={line} fill="none" stroke={POS} strokeWidth="1.6" />
      {[[opt.breakeven, "BE", "#e6edf3"], [opt.strike, "K", "rgba(255,255,255,.4)"], [spot, "now", CY], [p50, "p50", WARN], [p05, "p05", NEG], [p95, "p95", POS]].map(([v, lbl, c], i) => (
        <g key={i}><line x1={X(v as number)} y1={padT} x2={X(v as number)} y2={H - padB} stroke={c as string} strokeWidth="1" strokeDasharray={lbl === "now" ? "0" : "2 2"} opacity="0.7" /><text x={X(v as number)} y={H - 4} fill={c as string} fontSize="7" textAnchor="middle" fontFamily="var(--ax-mono,monospace)">{lbl as string}</text></g>
      ))}
    </svg>
  );
}

// Quant Lab — the 14 PhD-level computations, compact.
function QuantLab({ q }: { q: Record<string, Record<string, unknown>> }) {
  const n = (v: unknown, d = 2) => (typeof v === "number" ? v.toFixed(d) : String(v ?? "—"));
  const items: [string, string, string?][] = [
    ["½-Kelly", n(q.kelly?.half, 3), (q.kelly?.half as number) >= 0 ? POS : NEG],
    ["Kalman slope", `${n(q.kalman?.slopePct, 2)}%`, (q.kalman?.slopePct as number) >= 0 ? POS : NEG],
    ["GARCH σ→LR", `${n((q.garch?.sigmaNow as number) * 100, 1)}→${n((q.garch?.longRun as number) * 100, 1)}%`],
    ["OU half-life", `${n(q.ou?.halfLifeBars, 0)} bars`],
    ["Hurst regime", n(q.hmm?.pStormy, 2), (q.hmm?.pStormy as number) > 0.5 ? WARN : POS],
    ["CUSUM", n(q.changePoint?.cusum, 1), q.changePoint?.alarm ? NEG : POS],
    ["Entropy", n(q.changePoint?.entropy, 2)],
    ["Jumps (λ)", `${n(q.jumps?.count, 0)} (${n(q.jumps?.lambdaPerBar, 3)})`],
    ["VaR 95%", `-${n(q.varCvar?.var95, 2)}%`, NEG],
    ["CVaR 95%", `-${n(q.varCvar?.cvar95, 2)}%`, NEG],
    ["Frac-diff acf", `${n(q.fracDiff?.acf1Price, 2)}→${n(q.fracDiff?.acf1FracDiff, 2)}`],
    ["Kyle λ", String(q.kyle?.lambda ?? "—")],
    ["Hawkes", n(q.hawkes?.intensity, 3)],
    ...(q.cointegration ? [["Coint z", n(q.cointegration?.z, 2), Math.abs(q.cointegration?.z as number) > 2 ? WARN : undefined] as [string, string, string?]] : []),
    ...(q.copula ? [["Co-crash", n(q.copula?.coCrashProb, 3), (q.copula?.coCrashProb as number) > 0.1 ? NEG : undefined] as [string, string, string?]] : []),
  ];
  return <div className="axo-quant">{items.map(([l, v, c]) => <div key={l} className="axo-ql"><span>{l}</span><b style={c ? { color: c } : undefined}>{v}</b></div>)}</div>;
}

// Walk-forward backtest panel — validates the forecaster out-of-sample on demand.
function BacktestPanel({ symbol }: { symbol: string }) {
  const [bt, setBt] = useState<{ ok: boolean; gate?: boolean; horizons?: Record<string, { n: number; hitRate: number | null; coverage90: number | null; brier: number | null; pass: boolean }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const r = await fetch(`/api/apex/predict/${encodeURIComponent(symbol)}/backtest`).then((x) => x.json()); setBt(r); } catch { /* ignore */ } setBusy(false); };
  return (
    <div className="axo-bt">
      {!bt ? <button className="axo-bt-run" onClick={run} disabled={busy}>{busy ? "Running walk-forward…" : "▶ Run walk-forward backtest"}</button> : (
        <>
          <div className="axo-bt-h">WALK-FORWARD (no look-ahead) <span style={{ color: bt.gate ? POS : WARN }}>{bt.gate ? "✓ gate pass" : "gate fail"}</span></div>
          <div className="axo-bt-tbl"><div className="axo-bt-tr axo-bt-th"><span>H</span><span className="r">N</span><span className="r">HIT</span><span className="r">COV90</span><span className="r">BRIER</span><span className="r">GATE</span></div>
            {Object.entries(bt.horizons || {}).map(([k, v]) => (
              <div key={k} className="axo-bt-tr"><span>{k}</span><span className="r">{v.n}</span><span className="r" style={{ color: (v.hitRate ?? 0) >= 0.52 ? POS : WARN }}>{v.hitRate != null ? `${(v.hitRate * 100).toFixed(0)}%` : "—"}</span><span className="r">{v.coverage90 != null ? `${(v.coverage90 * 100).toFixed(0)}%` : "—"}</span><span className="r">{v.brier?.toFixed(3)}</span><span className="r" style={{ color: v.pass ? POS : NEG }}>{v.pass ? "✓" : "✕"}</span></div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function kpi(l: string, v: string, c: string) { return <div className="axo-kpi"><span>{l}</span><b style={{ color: c }}>{v}</b></div>; }
function ov(l: string, v: string, c?: string) { return <div className="axo-ov"><span>{l}</span><b style={c ? { color: c } : undefined}>{v}</b></div>; }
function sc(l: string, v: string, c: string) { return <div className="axo-sc"><span>{l}</span><b style={{ color: c }}>{v}</b></div>; }

export const ORACLE_CARD_CSS = `
.axo-card { position:relative; }
.axo-hd-r { margin-left:auto; display:inline-flex; gap:5px; }
.axo-mini { background:var(--ax-surface); border:1px solid var(--ax-bd); color:var(--ax-mut); border-radius:4px; padding:2px 7px; font-size:11px; cursor:pointer; font-family:var(--ax-sans); }
.axo-mini:hover { border-color:var(--ax-acc); color:var(--ax-acc); }
.axo-empty { color:var(--ax-mut); font-size:11px; padding:10px 2px; }
.axo-reg-dot { width:7px; height:7px; border-radius:2px; }
.axo-degraded { font-size:8px; color:${WARN}; border:1px solid ${WARN}; border-radius:3px; padding:1px 4px; }
/* refined verdict summary — no glow, institutional */
.axo-sum { padding:2px 0 10px; margin-bottom:9px; border-bottom:1px solid var(--ax-hair); }
.axo-sum-top { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.axo-sum-sig { font-family:var(--ax-sans); font-size:16px; font-weight:800; letter-spacing:.01em; line-height:1.15; }
.axo-sum-dir { font-family:var(--ax-mono); font-size:12px; font-weight:700; margin-left:auto; } .axo-sum-dir em { font-style:normal; color:var(--ax-dim); font-weight:400; }
.axo-sum-chips { display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; }
.axo-chip { font-size:10px; color:var(--ax-mut); background:rgba(255,255,255,.03); border:1px solid var(--ax-hair); border-radius:5px; padding:2px 7px; }
.axo-chip b { font-family:var(--ax-mono); color:var(--ax-tx); font-weight:700; margin-left:2px; }
.axo-chip-warn { color:${WARN}; border-color:color-mix(in srgb, ${WARN} 40%, transparent); }
.axo-gauge { flex:0 0 auto; text-align:center; }
.axo-gauge-l { font-size:7.5px; letter-spacing:.09em; color:var(--ax-dim); font-weight:700; margin-top:-6px; }
.axo-gauge-s { font-size:9px; font-family:var(--ax-mono); font-weight:700; margin-top:1px; }
/* forecast cone */
.axo-cone-wrap { margin-bottom:9px; padding:8px 9px; border-radius:8px; background:linear-gradient(180deg, rgba(255,255,255,.02), transparent); border:1px solid var(--ax-hair); }
.axo-cone-h { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); font-weight:700; margin-bottom:5px; display:flex; justify-content:space-between; } .axo-cone-h em { font-style:normal; color:var(--ax-mut); font-family:var(--ax-mono); }
.axo-cone { width:100%; height:78px; display:block; }
/* horizon ladder */
.axo-horizons { display:flex; flex-direction:column; gap:4px; margin-bottom:9px; }
.axo-hz { display:grid; grid-template-columns:26px 12px 1fr 34px 58px; gap:7px; align-items:center; font-family:var(--ax-mono); font-size:10px; }
.axo-hz-k { color:var(--ax-dim); font-weight:600; }
.axo-hz-dir { text-align:center; font-size:8px; }
.axo-hz-bar { position:relative; height:7px; background:var(--ax-surface,#0e141b); border-radius:4px; overflow:hidden; }
.axo-hz-mid { position:absolute; left:50%; top:0; bottom:0; width:1px; background:rgba(255,255,255,.14); }
.axo-hz-bar > span:not(.axo-hz-mid) { position:absolute; top:0; height:100%; border-radius:4px; box-shadow:0 0 8px -1px currentColor; }
.axo-hz-p { text-align:right; font-weight:700; }
.axo-hz-t { text-align:right; color:var(--ax-mut); }
.axo-thesis { font-size:10.5px; line-height:1.45; color:var(--ax-mut); padding:8px 10px; border-radius:7px; background:rgba(255,255,255,.02); border:1px solid var(--ax-hair); border-left:2px solid ${CY}; }
.axo-expand { width:100%; margin-top:8px; background:linear-gradient(180deg, color-mix(in srgb, ${CY} 20%, transparent), color-mix(in srgb, ${CY} 8%, transparent)); border:1px solid color-mix(in srgb, ${CY} 45%, transparent); color:#dcecf7; border-radius:7px; padding:8px; font-size:11px; font-weight:700; letter-spacing:.02em; cursor:pointer; font-family:var(--ax-sans); transition:box-shadow .15s, transform .1s; }
.axo-expand:hover { box-shadow:0 0 18px -4px ${CY}; transform:translateY(-1px); }
/* diverging score meter */
.axo-meter { position:relative; display:inline-block; width:52px; height:6px; background:var(--ax-surface,#0e141b); border-radius:3px; overflow:hidden; vertical-align:middle; }
.axo-meter-mid { position:absolute; left:50%; top:0; bottom:0; width:1px; background:rgba(255,255,255,.16); }
.axo-meter-fill { position:absolute; top:0; height:100%; border-radius:3px; box-shadow:0 0 6px -1px currentColor; }
`;

const OVERLAY_CSS = `
.axo-back { position:fixed; inset:0; background:rgba(6,10,16,.72); backdrop-filter:blur(4px); z-index:200; display:flex; align-items:center; justify-content:center; padding:24px; }
.axo-full { width:min(1160px,96vw); max-height:92vh; overflow:hidden; background:#0d1117; border:1px solid var(--ax-bd,#20303f); border-radius:10px; box-shadow:0 30px 80px rgba(0,0,0,.6); display:flex; flex-direction:column; color:var(--ax-tx,#e6edf3); font-family:var(--ax-sans); }
.axo-full-h { display:flex; align-items:center; gap:14px; padding:12px 16px; border-bottom:1px solid var(--ax-bd,#20303f); }
.axo-full-t { font-family:var(--ax-disp,inherit); font-size:15px; font-weight:800; letter-spacing:.08em; color:${CY}; }
.axo-full-reg { font-size:12px; font-weight:700; }
.axo-tabs { display:inline-flex; gap:2px; margin-left:8px; background:rgba(255,255,255,.03); border:1px solid var(--ax-hair); border-radius:8px; padding:2px; }
.axo-tab { background:none; border:none; color:var(--ax-mut,#9aa7b4); font-family:var(--ax-sans); font-size:12px; font-weight:600; padding:4px 14px; border-radius:6px; cursor:pointer; transition:background .12s,color .12s; }
.axo-tab:hover { color:var(--ax-tx,#e6edf3); }
.axo-tab.on { background:color-mix(in srgb, ${CY} 20%, transparent); color:#dcecf7; }
.axo-full-actions { margin-left:auto; display:flex; align-items:center; gap:10px; }
.axo-x { cursor:pointer; color:var(--ax-mut,#9aa7b4); font-size:15px; } .axo-x:hover { color:${NEG}; }
.axo-resolved { padding:8px 16px; background:color-mix(in srgb, ${POS} 12%, transparent); color:${POS}; font-size:11.5px; border-bottom:1px solid var(--ax-bd,#20303f); }
.axo-full-scroll { overflow-y:auto; }
/* Home tab */
.axo-pane { padding:16px; }
.axo-hsum { display:flex; align-items:center; gap:18px; padding:14px 16px; border-radius:10px; background:linear-gradient(180deg, rgba(255,255,255,.025), rgba(0,0,0,.12)); border:1px solid var(--ax-hair); position:relative; overflow:hidden; margin-bottom:12px; }
.axo-hsum::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--tc); }
.axo-hsum-l { flex:1; min-width:0; }
.axo-hsum-k { font-size:8.5px; letter-spacing:.13em; color:var(--ax-dim); font-weight:700; }
.axo-hsum-sig { font-size:24px; font-weight:800; line-height:1.08; margin:2px 0 3px; }
.axo-hsum-dir { font-family:var(--ax-mono); font-size:13px; font-weight:800; }
.axo-hsum-stats { flex:0 0 auto; display:flex; gap:20px; }
.axo-hstat { text-align:right; } .axo-hstat span { display:block; font-size:8px; letter-spacing:.09em; color:var(--ax-dim); font-weight:700; } .axo-hstat b { font-family:var(--ax-mono); font-size:17px; font-weight:800; }
.axo-hsummary { font-size:12.5px; line-height:1.55; color:var(--ax-tx,#e6edf3); margin:0 0 12px; background:linear-gradient(180deg, rgba(255,255,255,.025), transparent); border-left:2px solid ${CY}; padding:10px 13px; border-radius:0 6px 6px 0; }
.axo-hgrid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
.axo-hcard { padding:11px 13px; border-radius:9px; background:linear-gradient(180deg, rgba(255,255,255,.02), transparent); border:1px solid var(--ax-hair); }
@media (max-width:820px){ .axo-hgrid{ grid-template-columns:1fr; } .axo-hsum-stats{ display:none; } }
.axo-newsband { padding:6px 16px 12px; border-bottom:1px solid var(--ax-bd,#20303f); margin-bottom:4px; }
.axo-full-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px; }
/* Algo verdict report */
.axo-report { padding:16px 16px 4px; }
.axo-rp-hero { display:flex; align-items:center; gap:18px; margin-bottom:14px; padding:14px 16px; border-radius:10px;
  background:linear-gradient(180deg, rgba(255,255,255,.025), rgba(0,0,0,.12)); border:1px solid var(--ax-hair,rgba(255,255,255,.07)); position:relative; overflow:hidden; }
.axo-rp-hero::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--tc); }
.axo-rp-badge { flex:1; min-width:0; }
.axo-rp-badge-k { font-size:8.5px; letter-spacing:.14em; color:var(--ax-dim,#6b7683); font-weight:700; }
.axo-rp-signal { font-family:var(--ax-sans); font-size:23px; font-weight:800; letter-spacing:.01em; line-height:1.08; margin:2px 0 3px; }
.axo-rp-dir { font-family:var(--ax-mono); font-size:14px; font-weight:800; } .axo-rp-dir span { color:var(--ax-dim,#6b7683); font-size:11px; font-weight:400; }
.axo-rp-stats { flex:0 0 auto; display:flex; gap:22px; }
.axo-rp-stat { text-align:right; } .axo-rp-stat span { display:block; font-size:8px; letter-spacing:.1em; color:var(--ax-dim,#6b7683); font-weight:700; } .axo-rp-stat b { font-family:var(--ax-mono); font-size:19px; font-weight:800; }
.axo-rp-summary { font-size:12.5px; line-height:1.55; color:var(--ax-tx,#e6edf3); margin:0 0 14px; background:linear-gradient(180deg, rgba(255,255,255,.025), transparent); border-left:2px solid ${CY}; padding:11px 14px; border-radius:0 6px 6px 0; }
.axo-rp-sections { display:grid; grid-template-columns:1fr 1fr; gap:12px 18px; }
.axo-rp-sec { padding:10px 12px; border-radius:9px; background:linear-gradient(180deg, rgba(255,255,255,.02), transparent); border:1px solid var(--ax-hair,rgba(255,255,255,.06)); }
.axo-rp-sec-h { display:flex; justify-content:space-between; align-items:center; font-size:9.5px; font-weight:700; letter-spacing:.09em; color:var(--ax-cydim,#4d9fd1); margin-bottom:7px; padding-bottom:6px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.06)); }
.axo-rp-sec-sc { display:flex; align-items:center; gap:7px; } .axo-rp-sec-sc b { font-family:var(--ax-mono); font-size:11px; }
.axo-rp-bullet { display:flex; gap:7px; font-size:11px; line-height:1.5; color:var(--ax-mut,#9aa7b4); padding:2.5px 0; }
.axo-rp-mk { flex:0 0 auto; font-size:9px; margin-top:2px; }
.axo-rp-flags { margin-top:11px; background:color-mix(in srgb, ${WARN} 8%, transparent); border:1px solid color-mix(in srgb, ${WARN} 30%, transparent); border-radius:6px; padding:8px 11px; }
.axo-rp-flags-h { font-size:9px; font-weight:700; letter-spacing:.06em; color:${WARN}; }
.axo-rp-flag { font-size:10.5px; color:var(--ax-mut,#9aa7b4); margin-top:3px; }
.axo-col { min-width:0; display:flex; flex-direction:column; gap:6px; }
.axo-sec { font-size:9px; font-weight:700; letter-spacing:.09em; color:var(--ax-cydim,#4d9fd1); margin:8px 0 4px; display:flex; justify-content:space-between; align-items:baseline; }
.axo-sec:first-child { margin-top:0; }
.axo-sec em { font-style:normal; color:var(--ax-dim,#6b7683); font-family:var(--ax-mono); font-weight:500; }
.axo-tbl { font-family:var(--ax-mono); font-size:11px; }
.axo-tr { display:grid; grid-template-columns:34px 1fr .7fr 1.2fr 1.6fr .5fr; gap:6px; align-items:center; padding:5px 6px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); border-radius:4px; cursor:pointer; }
.axo-tr.axo-th { color:var(--ax-dim,#6b7683); font-size:8px; letter-spacing:.05em; cursor:default; }
.axo-tr.on { background:color-mix(in srgb, ${CY} 10%, transparent); box-shadow:inset 2px 0 0 ${CY}; }
.axo-tr:not(.axo-th):hover { background:rgba(255,255,255,.03); }
.axo-tr .r { text-align:right; } .axo-tr .dim { color:var(--ax-mut,#9aa7b4); font-size:9.5px; } .axo-tr em { font-style:normal; font-size:9px; }
.axo-k { font-weight:700; color:var(--ax-tx); }
.axo-detail { margin-top:6px; }
.axo-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-bottom:8px; }
.axo-kpi { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:4px; padding:6px 7px; display:flex; flex-direction:column; gap:2px; }
.axo-kpi span { font-size:7.5px; color:var(--ax-dim,#6b7683); letter-spacing:.04em; } .axo-kpi b { font-family:var(--ax-mono); font-size:12px; }
.axo-opt { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:6px; padding:10px; }
.axo-opt-h { font-size:9px; font-weight:700; letter-spacing:.07em; color:var(--ax-mut,#9aa7b4); margin-bottom:8px; display:flex; justify-content:space-between; }
.axo-opt-tag { font-size:10px; }
.axo-opt-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px 10px; }
.axo-ov { display:flex; flex-direction:column; gap:1px; } .axo-ov span { font-size:7.5px; color:var(--ax-dim,#6b7683); letter-spacing:.03em; } .axo-ov b { font-family:var(--ax-mono); font-size:11.5px; }
.axo-opt-sub { font-size:8px; font-weight:700; letter-spacing:.06em; color:var(--ax-dim,#6b7683); margin:10px 0 4px; }
.axo-payoff { width:100%; height:120px; display:block; }
.axo-opt-note { font-size:8.5px; color:var(--ax-dim,#6b7683); margin-top:9px; line-height:1.4; }
.axo-ticket { width:100%; margin-top:9px; background:color-mix(in srgb, ${POS} 14%, transparent); border:1px solid color-mix(in srgb, ${POS} 40%, transparent); color:${POS}; border-radius:5px; padding:7px; font-size:11px; font-weight:600; cursor:pointer; font-family:var(--ax-sans,inherit); }
.axo-ticket:hover { background:color-mix(in srgb, ${POS} 22%, transparent); }
.axo-curves { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:6px; }
.axo-curve { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:6px; padding:6px; }
.axo-curve-t { font-size:7.5px; color:var(--ax-dim,#6b7683); letter-spacing:.04em; margin-bottom:2px; text-align:center; }
.axo-bt-run { width:100%; background:color-mix(in srgb, ${WARN} 12%, transparent); border:1px solid color-mix(in srgb, ${WARN} 38%, transparent); color:${WARN}; border-radius:5px; padding:8px; font-size:11px; font-weight:600; cursor:pointer; font-family:var(--ax-sans,inherit); }
.axo-bt-run:disabled { opacity:.6; cursor:wait; }
.axo-bt-h { font-size:8.5px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut,#9aa7b4); display:flex; justify-content:space-between; margin-bottom:5px; }
.axo-bt-tbl { font-family:var(--ax-mono); font-size:10.5px; }
.axo-bt-tr { display:grid; grid-template-columns:34px 1fr 1fr 1fr 1fr .6fr; gap:6px; padding:3px 4px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); }
.axo-bt-tr .r { text-align:right; } .axo-bt-th { color:var(--ax-dim,#6b7683); font-size:8px; }
.axo-quant { display:grid; grid-template-columns:1fr 1fr; gap:3px 10px; }
.axo-ql { display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); font-size:10px; }
.axo-ql span { color:var(--ax-mut,#9aa7b4); } .axo-ql b { font-family:var(--ax-mono); font-size:10.5px; font-weight:600; }
.axo-pkgs { display:flex; flex-direction:column; gap:4px; }
.axo-pkg { display:grid; grid-template-columns:70px 1fr 44px; gap:8px; align-items:center; font-size:10.5px; }
.axo-pkg-l { color:var(--ax-mut,#9aa7b4); text-transform:capitalize; }
.axo-pkg-track { position:relative; height:7px; background:var(--ax-surface,#0b0f16); border-radius:3px; overflow:hidden; }
.axo-pkg-track::before { content:""; position:absolute; left:50%; top:0; bottom:0; width:1px; background:rgba(255,255,255,.12); }
.axo-pkg-fill { position:absolute; top:0; bottom:0; border-radius:2px; }
.axo-pkg-v { text-align:right; font-family:var(--ax-mono); }
.axo-peers { display:flex; flex-direction:column; }
.axo-peer { display:grid; grid-template-columns:.7fr .9fr .6fr .6fr; gap:6px; align-items:center; padding:4px 5px; border-bottom:1px solid var(--ax-hair,rgba(255,255,255,.05)); font-family:var(--ax-mono); font-size:11px; cursor:pointer; }
.axo-peer:hover { background:rgba(255,255,255,.03); }
.axo-peer b { font-weight:700; } .axo-peer .r { text-align:right; }
.axo-peer-kind { font-size:8px; color:var(--ax-dim,#6b7683); font-family:var(--ax-sans); }
.axo-etf { border-top:1px solid var(--ax-bd,#20303f); }
.axo-jarvis { font-size:11px; line-height:1.5; color:var(--ax-tx,#e6edf3); margin:0; background:#0b0f16; border-left:2px solid ${CY}; padding:8px 10px; border-radius:0 4px 4px 0; }
.axo-score { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
.axo-sc { background:#0b0f16; border:1px solid var(--ax-bd,#20303f); border-radius:4px; padding:6px 7px; display:flex; flex-direction:column; gap:2px; }
.axo-sc span { font-size:7.5px; color:var(--ax-dim,#6b7683); } .axo-sc b { font-family:var(--ax-mono); font-size:13px; }
.axo-hint { font-size:9px; color:var(--ax-dim,#6b7683); margin-top:8px; line-height:1.4; }
@media (max-width:900px) { .axo-full-body { grid-template-columns:1fr; } }
`;
