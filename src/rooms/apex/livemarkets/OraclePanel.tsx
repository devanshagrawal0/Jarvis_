import { useCallback, useEffect, useRef, useState } from "react";

// APEX Oracle Panel — the prediction cockpit. Fetches /api/apex/predict/:symbol (regime,
// multi-horizon forecast, options, signal packages, Jarvis synthesis), renders a compact
// summary in the right rail and a full expandable overlay, and refreshes-to-resolve.

const POS = "#26a69a", NEG = "#ef5350", CY = "#4d9fd1", WARN = "#e0952b", PUR = "#9a86d4";

export interface OracleOption { type: string; strike: number; expiryDays: number; premium: number; impliedVol: number; delta: number; gamma: number; vega: number; theta: number; rho: number; ev: number; roi: number; pITM: number; breakeven: number }
export interface OracleHorizon { horizon: string; tau: number; spot: number; p05: number; p25: number; p50: number; p75: number; p95: number; predRet: number; dir: string; pUp: number; pUpModel: number; edge: number; size: number; disagreement: number; confidence: number; sigmaH: number; var95: number; cvar95: number; option: OracleOption | null }
export interface OraclePayload {
  ok: boolean; reason?: string; symbol: string; spot: number; degraded?: boolean;
  regime: { label: string; confidence: number; hurst: number; adx: number | null; volPct: number };
  crossScore: number; packages: Record<string, number>;
  signalDetail: { peers?: { sym: string; rho: number; mom: number; kind: string }[]; sector?: { etf: string; rho: number; etfMom: number } | null; news?: { count: number; score: number } | null };
  jarvis: { pUp: number; bias: string; thesis: string } | null;
  quant?: Record<string, Record<string, unknown>> | null;
  horizons: OracleHorizon[]; asOf: number; selfCheck?: { ok: boolean; issues: string[] };
}
export interface OracleHistory { rows: { horizon: string; hit: number | null; abs_pct_err: number | null; made_at: number }[]; summary: { total: number; resolved: number; hitRate: number | null; mape: number | null } }

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
          <div className="axo-regime"><span className="axo-reg-dot" style={{ background: rc }} /><b style={{ color: rc }}>{o.regime.label.replace("_", " ")}</b><em>conf {(o.regime.confidence * 100).toFixed(0)}%</em>{o.degraded && <span className="axo-degraded">degraded</span>}</div>
          {oneDay && (
            <div className="axo-call">
              <div className="axo-call-dir" style={{ color: oneDay.dir === "LONG" ? POS : NEG }}>{oneDay.dir === "LONG" ? "▲ LONG" : "▼ SHORT"}</div>
              <div className="axo-call-meta"><span>1-day P(up) <b style={{ color: oneDay.pUp >= 0.5 ? POS : NEG }}>{(oneDay.pUp * 100).toFixed(0)}%</b></span><span>target <b>{money(oneDay.p50)}</b> <em style={{ color: oneDay.predRet >= 0 ? POS : NEG }}>{pctS(oneDay.predRet)}</em></span></div>
            </div>
          )}
          <div className="axo-horizons">
            {o.horizons.map((h) => (
              <div key={h.horizon} className="axo-hz" title={`${h.dir} · P(up) ${(h.pUp * 100).toFixed(0)}% · conf ${(h.confidence * 100).toFixed(0)}%`}>
                <span className="axo-hz-k">{h.horizon}</span>
                <span className="axo-hz-bar"><span style={{ width: `${h.pUp * 100}%`, background: h.dir === "LONG" ? POS : NEG }} /></span>
                <span className="axo-hz-p" style={{ color: h.dir === "LONG" ? POS : NEG }}>{(h.pUp * 100).toFixed(0)}</span>
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
export function OracleOverlay({ o, hist, loading, resolvedNote, onClose, onRefresh, onPick }: { o: OraclePayload | null; hist: OracleHistory | null; loading: boolean; resolvedNote: string | null; onClose: () => void; onRefresh: () => void; onPick: (s: string) => void }) {
  const [sel, setSel] = useState("1d");
  const h = o?.horizons.find((x) => x.horizon === sel) || o?.horizons[0];
  const rc = o ? regimeColor(o.regime.label) : PUR;
  const pkgOrder = ["technical", "sector", "peer", "news", "macro"];
  return (
    <div className="axo-back" onClick={onClose}>
      <div className="axo-full" onClick={(e) => e.stopPropagation()}>
        <div className="axo-full-h">
          <span className="axo-full-t">◎ ORACLE · {o?.symbol}</span>
          {o && <span className="axo-full-reg" style={{ color: rc }}>{o.regime.label.replace("_", " ")} · conf {(o.regime.confidence * 100).toFixed(0)}%</span>}
          <span className="axo-full-actions"><button className="axo-mini" onClick={onRefresh}>{loading ? "…" : "↻ Refresh"}</button><span className="axo-x" onClick={onClose}>✕</span></span>
        </div>
        {resolvedNote && <div className="axo-resolved">✓ {resolvedNote}</div>}
        {!o ? <div className="axo-empty" style={{ padding: 40 }}>{loading ? "Computing…" : "No forecast."}</div> : (
          <div className="axo-full-body">
            {/* left: horizon table + detail */}
            <div className="axo-col">
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
              {h && (
                <div className="axo-detail">
                  <div className="axo-sec">{h.horizon} DETAIL</div>
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
                      <div className="axo-opt-note">Paper-proof: premium priced at model IV; EV computed under the forecast distribution. Paper trading only — not advice.</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* right: packages + peers + jarvis + scorecard */}
            <div className="axo-col">
              <div className="axo-sec">SIGNAL PACKAGES <em>crossScore {o.crossScore >= 0 ? "+" : ""}{o.crossScore.toFixed(2)}</em></div>
              <div className="axo-pkgs">
                {pkgOrder.map((k) => { const v = o.packages[k] ?? 0; return (
                  <div key={k} className="axo-pkg"><span className="axo-pkg-l">{k}</span><span className="axo-pkg-track"><span className="axo-pkg-fill" style={{ width: `${Math.abs(v) * 50}%`, marginLeft: v < 0 ? `${50 - Math.abs(v) * 50}%` : "50%", background: v >= 0 ? POS : NEG }} /></span><span className="axo-pkg-v" style={{ color: v >= 0 ? POS : NEG }}>{v >= 0 ? "+" : ""}{v.toFixed(2)}</span></div>
                ); })}
              </div>
              {o.signalDetail?.peers?.length ? (
                <><div className="axo-sec">PEERS · SUBSTITUTES <em>ρ / 20d mom</em></div>
                <div className="axo-peers">{o.signalDetail.peers.slice(0, 6).map((p) => (
                  <div key={p.sym} className="axo-peer" onClick={() => onPick(p.sym)}><b>{p.sym}</b><span className="axo-peer-kind">{p.kind}</span><span className="r">ρ {p.rho.toFixed(2)}</span><span className="r" style={{ color: p.mom >= 0 ? POS : NEG }}>{pctS(p.mom)}</span></div>
                ))}{o.signalDetail.sector && <div className="axo-peer axo-etf" onClick={() => onPick(o.signalDetail!.sector!.etf)}><b>{o.signalDetail.sector.etf}</b><span className="axo-peer-kind">sector ETF</span><span className="r">ρ {o.signalDetail.sector.rho.toFixed(2)}</span><span className="r" style={{ color: o.signalDetail.sector.etfMom >= 0 ? POS : NEG }}>{pctS(o.signalDetail.sector.etfMom)}</span></div>}</div></>
              ) : null}
              {o.jarvis?.thesis && (<><div className="axo-sec">JARVIS SYNTHESIS <em style={{ color: regimeColor(o.jarvis.bias === "bullish" ? "TREND_UP" : o.jarvis.bias === "bearish" ? "TREND_DOWN" : "X") }}>{o.jarvis.bias}</em></div><p className="axo-jarvis">{o.jarvis.thesis}</p></>)}
              {o.quant && o.quant.ok && (<><div className="axo-sec">QUANT LAB <em>14 PhD-level models</em></div><QuantLab q={o.quant} /></>)}
              <div className="axo-sec">TRACK RECORD <em>predictions vs actual</em></div>
              <div className="axo-score">
                {sc("HIT RATE", hist?.summary.hitRate != null ? `${(hist.summary.hitRate * 100).toFixed(0)}%` : "—", hist?.summary.hitRate != null && hist.summary.hitRate >= 0.5 ? POS : WARN)}
                {sc("RESOLVED", `${hist?.summary.resolved ?? 0}`, CY)}
                {sc("TRACKED", `${hist?.summary.total ?? 0}`, PUR)}
                {sc("MAPE", hist?.summary.mape != null ? `${(hist.summary.mape * 100).toFixed(1)}%` : "—", WARN)}
              </div>
              <div className="axo-hint">Click ↻ Refresh on the next session to resolve these calls against realized prices and self-correct.</div>
            </div>
          </div>
        )}
        <style>{OVERLAY_CSS}</style>
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

function kpi(l: string, v: string, c: string) { return <div className="axo-kpi"><span>{l}</span><b style={{ color: c }}>{v}</b></div>; }
function ov(l: string, v: string, c?: string) { return <div className="axo-ov"><span>{l}</span><b style={c ? { color: c } : undefined}>{v}</b></div>; }
function sc(l: string, v: string, c: string) { return <div className="axo-sc"><span>{l}</span><b style={{ color: c }}>{v}</b></div>; }

export const ORACLE_CARD_CSS = `
.axo-card { position:relative; }
.axo-hd-r { margin-left:auto; display:inline-flex; gap:5px; }
.axo-mini { background:var(--ax-surface); border:1px solid var(--ax-bd); color:var(--ax-mut); border-radius:4px; padding:2px 7px; font-size:11px; cursor:pointer; font-family:var(--ax-sans); }
.axo-mini:hover { border-color:var(--ax-acc); color:var(--ax-acc); }
.axo-empty { color:var(--ax-mut); font-size:11px; padding:10px 2px; }
.axo-regime { display:flex; align-items:center; gap:7px; margin-bottom:8px; font-size:12px; }
.axo-reg-dot { width:8px; height:8px; border-radius:2px; }
.axo-regime b { font-weight:700; letter-spacing:.02em; } .axo-regime em { font-style:normal; color:var(--ax-dim); font-size:10px; }
.axo-degraded { margin-left:auto; font-size:8px; color:${WARN}; border:1px solid ${WARN}; border-radius:3px; padding:1px 4px; }
.axo-call { display:flex; align-items:center; gap:12px; padding:8px 0; border-top:1px solid var(--ax-hair); border-bottom:1px solid var(--ax-hair); margin-bottom:8px; }
.axo-call-dir { font-size:15px; font-weight:800; font-family:var(--ax-mono); }
.axo-call-meta { display:flex; flex-direction:column; gap:2px; font-size:10.5px; color:var(--ax-mut); }
.axo-call-meta b { font-family:var(--ax-mono); color:var(--ax-tx); } .axo-call-meta em { font-style:normal; }
.axo-horizons { display:flex; flex-direction:column; gap:3px; margin-bottom:8px; }
.axo-hz { display:grid; grid-template-columns:26px 1fr 22px; gap:6px; align-items:center; font-family:var(--ax-mono); font-size:10px; }
.axo-hz-k { color:var(--ax-dim); }
.axo-hz-bar { height:6px; background:var(--ax-surface); border-radius:3px; overflow:hidden; }
.axo-hz-bar span { display:block; height:100%; }
.axo-hz-p { text-align:right; font-weight:600; }
.axo-thesis { font-size:10.5px; line-height:1.4; color:var(--ax-mut); padding:7px 0; border-top:1px solid var(--ax-hair); }
.axo-expand { width:100%; margin-top:6px; background:color-mix(in srgb, ${CY} 12%, transparent); border:1px solid color-mix(in srgb, ${CY} 35%, transparent); color:${CY}; border-radius:6px; padding:7px; font-size:11px; font-weight:600; cursor:pointer; font-family:var(--ax-sans); }
`;

const OVERLAY_CSS = `
.axo-back { position:fixed; inset:0; background:rgba(6,10,16,.72); backdrop-filter:blur(4px); z-index:200; display:flex; align-items:center; justify-content:center; padding:24px; }
.axo-full { width:min(1160px,96vw); max-height:92vh; overflow:hidden; background:#0d1117; border:1px solid var(--ax-bd,#20303f); border-radius:10px; box-shadow:0 30px 80px rgba(0,0,0,.6); display:flex; flex-direction:column; color:var(--ax-tx,#e6edf3); font-family:var(--ax-sans); }
.axo-full-h { display:flex; align-items:center; gap:14px; padding:12px 16px; border-bottom:1px solid var(--ax-bd,#20303f); }
.axo-full-t { font-family:var(--ax-disp,inherit); font-size:15px; font-weight:800; letter-spacing:.08em; color:${CY}; }
.axo-full-reg { font-size:12px; font-weight:700; }
.axo-full-actions { margin-left:auto; display:flex; align-items:center; gap:10px; }
.axo-x { cursor:pointer; color:var(--ax-mut,#9aa7b4); font-size:15px; } .axo-x:hover { color:${NEG}; }
.axo-resolved { padding:8px 16px; background:color-mix(in srgb, ${POS} 12%, transparent); color:${POS}; font-size:11.5px; border-bottom:1px solid var(--ax-bd,#20303f); }
.axo-full-body { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding:16px; overflow-y:auto; }
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
