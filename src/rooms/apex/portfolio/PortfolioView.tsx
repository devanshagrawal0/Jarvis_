import { Fragment, useEffect, useRef, useState } from "react";
import type { Correlation, RRGPoint, Regime, Internals, Sector, Anomalies } from "../apex-data";

// APEX · Portfolio — the market-structure lens for portfolio construction:
// the risk regime, a cross-asset correlation heatmap, sector rotation (RRG),
// a sector-performance heatmap, and a statistical anomaly scan. All served by
// JARVIS's own /api/apex/* quant routes (no sidecar) and styled with the shared
// Apex theme vars (--ax-*) so it sits seamlessly next to Home.

const POS = "#34d399", NEG = "#f4556b", WARN = "#f5a742", CY = "#3fd0ff", PUR = "#a98bff";

async function safe<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url); if (!r.ok) return fallback; return (await r.json()) as T; } catch { return fallback; }
}

type State = {
  corr: Correlation | null; rrg: RRGPoint[]; regime: Regime | null;
  internals: Internals | null; sectors: Sector[]; anomalies: Anomalies | null;
};

export function PortfolioView() {
  const [s, setS] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [c, r, reg, sec, an] = await Promise.all([
        safe<{ correlation: Correlation | null }>("/api/apex/correlation", { correlation: null }),
        safe<{ rrg: RRGPoint[] }>("/api/apex/rrg", { rrg: [] }),
        safe<{ regime: Regime | null; internals: Internals | null }>("/api/apex/regime", { regime: null, internals: null }),
        safe<{ sectors: Sector[] }>("/api/apex/sectors", { sectors: [] }),
        safe<{ anomalies: Anomalies | null }>("/api/apex/anomalies", { anomalies: null }),
      ]);
      if (dead) return;
      setS({ corr: c.correlation, rrg: r.rrg || [], regime: reg.regime, internals: reg.internals, sectors: sec.sectors || [], anomalies: an.anomalies });
      setLoading(false);
    })();
    return () => { dead = true; };
  }, []);

  return (
    <div className="ax-port">
      <style>{PORT_CSS}</style>

      <div className="axp-head">
        <span className="axp-title">◎ PORTFOLIO</span>
        <span className="axp-sub">Market structure · regime · correlation · rotation · anomalies</span>
      </div>

      {loading ? (
        <div className="axp-empty">Loading market structure…</div>
      ) : !s ? (
        <div className="axp-empty">No data available.</div>
      ) : (
        <div className="axp-body">
          {/* Regime strip */}
          {s.regime && <RegimeStrip regime={s.regime} internals={s.internals} />}

          <div className="axp-grid">
            {/* Correlation heatmap */}
            <div className="axp-panel axp-corr">
              <div className="axp-ph">CORRELATION MATRIX <span>90-day daily-return ρ · {s.corr?.symbols.length || 0} assets</span></div>
              {s.corr && s.corr.matrix.length > 0 ? <CorrHeat corr={s.corr} /> : <div className="axp-mini-empty">No correlation data.</div>}
            </div>

            {/* Sector rotation RRG */}
            <div className="axp-panel">
              <div className="axp-ph">SECTOR ROTATION <span>RRG · strength vs momentum</span></div>
              {s.rrg.length > 0 ? <RRG points={s.rrg} /> : <div className="axp-mini-empty">No rotation data.</div>}
            </div>
          </div>

          <div className="axp-grid">
            {/* Sector heatmap */}
            <div className="axp-panel">
              <div className="axp-ph">SECTOR PERFORMANCE <span>today · %</span></div>
              {s.sectors.length > 0 ? <SectorHeat sectors={s.sectors} /> : <div className="axp-mini-empty">No sector data.</div>}
            </div>

            {/* Anomaly scanner */}
            <div className="axp-panel">
              <div className="axp-ph">ANOMALY SCAN <span>today's move vs 60-day z-score</span></div>
              {s.anomalies && s.anomalies.items.length > 0 ? <AnomalyList a={s.anomalies} /> : <div className="axp-mini-empty">No anomalies flagged.</div>}
            </div>
          </div>

          <div className="axp-foot">Derived from public daily bars. Informational only — not financial advice.</div>
        </div>
      )}
    </div>
  );
}

/* ── Regime strip ── */
function RegimeStrip({ regime, internals }: { regime: Regime; internals: Internals | null }) {
  const score = regime.score ?? 50;
  const col = score >= 60 ? POS : score <= 40 ? NEG : WARN;
  const pctUp = internals?.pctUp ?? regime.pctUp;
  return (
    <div className="axp-regime">
      <div className="axp-reg-gauge">
        <div className="axp-reg-arc"><div className="axp-reg-fill" style={{ width: `${score}%`, background: col, boxShadow: `0 0 10px ${col}88` }} /></div>
        <div className="axp-reg-score" style={{ color: col }}>{score}<span>/100</span></div>
      </div>
      <div className="axp-reg-label" style={{ color: col }}>{regime.label || "—"}</div>
      <div className="axp-reg-stats">
        {regChip("VIX", regime.vix != null ? regime.vix.toFixed(1) : "—", regime.vix != null && regime.vix > 20 ? WARN : undefined)}
        {regChip("BREADTH", pctUp != null ? `${(pctUp * 100).toFixed(0)}% up` : "—", pctUp != null ? (pctUp >= 0.5 ? POS : NEG) : undefined)}
        {internals && regChip("ADV/DEC", `${internals.advancers}/${internals.decliners}`, internals.advancers >= internals.decliners ? POS : NEG)}
        {regChip("FEAR/GREED", `${regime.fearGreed} · ${regime.fearGreedLabel}`, regime.fearGreed >= 55 ? POS : regime.fearGreed <= 45 ? NEG : WARN)}
      </div>
    </div>
  );
}
function regChip(label: string, value: string, color?: string) {
  return <div className="axp-reg-chip"><span className="axp-rc-l">{label}</span><span className="axp-rc-v" style={color ? { color } : undefined}>{value}</span></div>;
}

/* ── Correlation heatmap ── */
function CorrHeat({ corr }: { corr: Correlation }) {
  const syms = corr.symbols, m = corr.matrix;
  const color = (v: number) => {
    // +1 → cyan, 0 → neutral, −1 → red
    if (v >= 0) { const t = v; return `rgba(63,208,255,${(0.08 + t * 0.62).toFixed(3)})`; }
    const t = -v; return `rgba(244,85,107,${(0.08 + t * 0.62).toFixed(3)})`;
  };
  return (
    <div className="axp-heat-wrap">
      <div className="axp-heat" style={{ gridTemplateColumns: `40px repeat(${syms.length}, 1fr)` }}>
        <div className="axp-hc axp-corner" />
        {syms.map((s) => <div key={"top" + s} className="axp-hc axp-htop">{s}</div>)}
        {syms.map((rs, i) => (
          <Fragment key={"r" + rs}>
            <div className="axp-hc axp-hleft">{rs}</div>
            {syms.map((cs, j) => {
              const v = m[i]?.[j] ?? 0;
              return <div key={rs + cs} className="axp-cell" style={{ background: i === j ? "rgba(150,190,225,.14)" : color(v) }} title={`${rs} · ${cs}: ${v.toFixed(2)}`}>{i === j ? "" : v.toFixed(2)}</div>;
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── Sector-rotation RRG scatter ── */
function RRG({ points }: { points: RRGPoint[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const pad = 28;
      const xs = points.map((p) => p.rsRatio), ys = points.map((p) => p.rsMomentum);
      const spanX = Math.max(2, Math.max(...xs.map((v) => Math.abs(v - 100))) * 1.3);
      const spanY = Math.max(2, Math.max(...ys.map((v) => Math.abs(v - 100))) * 1.3);
      const X = (v: number) => pad + ((v - (100 - spanX)) / (2 * spanX)) * (w - pad * 2);
      const Y = (v: number) => h - pad - ((v - (100 - spanY)) / (2 * spanY)) * (h - pad * 2);
      const cx = X(100), cy = Y(100);
      // quadrant fills
      const quad = (x0: number, y0: number, x1: number, y1: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); };
      quad(cx, pad, w - pad, cy, "rgba(52,211,153,.05)");   // leading (top-right)
      quad(pad, pad, cx, cy, "rgba(63,208,255,.05)");        // improving (top-left)
      quad(pad, cy, cx, h - pad, "rgba(244,85,107,.05)");    // lagging (bottom-left)
      quad(cx, cy, w - pad, h - pad, "rgba(245,167,66,.05)"); // weakening (bottom-right)
      // axes
      ctx.strokeStyle = "rgba(150,190,225,.28)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, pad); ctx.lineTo(cx, h - pad); ctx.moveTo(pad, cy); ctx.lineTo(w - pad, cy); ctx.stroke();
      // quadrant labels
      ctx.font = "8.5px ui-sans-serif,system-ui"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(52,211,153,.6)"; ctx.textAlign = "right"; ctx.fillText("LEADING", w - pad - 4, pad + 8);
      ctx.fillStyle = "rgba(63,208,255,.6)"; ctx.textAlign = "left"; ctx.fillText("IMPROVING", pad + 4, pad + 8);
      ctx.fillStyle = "rgba(244,85,107,.6)"; ctx.fillText("LAGGING", pad + 4, h - pad - 8);
      ctx.fillStyle = "rgba(245,167,66,.6)"; ctx.textAlign = "right"; ctx.fillText("WEAKENING", w - pad - 4, h - pad - 8);
      // points
      points.forEach((p) => {
        const x = X(p.rsRatio), y = Y(p.rsMomentum);
        const lead = p.rsRatio >= 100, mom = p.rsMomentum >= 100;
        const col = lead && mom ? POS : !lead && mom ? CY : !lead && !mom ? NEG : WARN;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(230,240,255,.9)"; ctx.font = "9px ui-monospace,monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(p.etf.replace(/^XL/, ""), x + 7, y);
      });
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [points]);
  return <canvas ref={ref} className="axp-canvas" style={{ height: 240 }} />;
}

/* ── Sector-performance heatmap ── */
function SectorHeat({ sectors }: { sectors: Sector[] }) {
  const max = Math.max(1, ...sectors.map((s) => Math.abs(s.changePct)));
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct);
  return (
    <div className="axp-sectors">
      {sorted.map((s) => {
        const up = s.changePct >= 0, t = Math.abs(s.changePct) / max;
        const bg = up ? `rgba(52,211,153,${(0.08 + t * 0.5).toFixed(3)})` : `rgba(244,85,107,${(0.08 + t * 0.5).toFixed(3)})`;
        return (
          <div key={s.etf} className="axp-sec" style={{ background: bg }}>
            <div className="axp-sec-name">{s.name}</div>
            <div className="axp-sec-etf">{s.etf}</div>
            <div className="axp-sec-chg" style={{ color: up ? POS : NEG }}>{up ? "+" : ""}{s.changePct.toFixed(2)}%</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Anomaly list ── */
function AnomalyList({ a }: { a: Anomalies }) {
  const maxSig = Math.max(2, ...a.items.map((i) => i.sigma));
  return (
    <div className="axp-anom">
      {a.items.slice(0, 12).map((it) => {
        const up = it.changePct >= 0, hot = it.sigma >= 2;
        return (
          <div key={it.sym} className="axp-arow">
            <span className="axp-a-sym">{it.sym}</span>
            <span className="axp-a-chg" style={{ color: up ? POS : NEG }}>{up ? "+" : ""}{it.changePct.toFixed(2)}%</span>
            <div className="axp-a-bar"><div className="axp-a-fill" style={{ width: `${(it.sigma / maxSig) * 100}%`, background: hot ? WARN : CY }} /></div>
            <span className="axp-a-z" style={{ color: hot ? WARN : "var(--ax-mut)" }}>{it.z >= 0 ? "+" : ""}{it.z.toFixed(2)}σ</span>
          </div>
        );
      })}
    </div>
  );
}

const PORT_CSS = `
.ax-port { height:100%; display:flex; flex-direction:column; gap:14px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axp-head { display:flex; align-items:baseline; gap:12px; }
.axp-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axp-sub { font-size:11px; color:var(--ax-mut); }
.axp-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:14px; padding-right:4px; }
.axp-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.axp-panel { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; min-width:0; }
.axp-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:11px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.axp-ph span { font-weight:500; letter-spacing:.02em; color:var(--ax-dim); text-transform:none; }
.axp-canvas { width:100%; display:block; }
.axp-mini-empty { color:var(--ax-mut); font-size:11px; padding:20px 2px; }
.axp-foot { font-size:9px; color:var(--ax-dim); padding-top:2px; }
.axp-empty { color:var(--ax-mut); font-size:12px; padding:26px 4px; }

/* Regime */
.axp-regime { display:flex; align-items:center; gap:20px; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px 18px; flex-wrap:wrap; }
.axp-reg-gauge { display:flex; align-items:center; gap:12px; min-width:220px; }
.axp-reg-arc { flex:1; height:8px; border-radius:5px; background:var(--ax-surface); overflow:hidden; border:1px solid var(--ax-bdsoft); }
.axp-reg-fill { height:100%; border-radius:5px; transition:width .5s; }
.axp-reg-score { font-family:var(--ax-mono); font-size:20px; font-weight:800; }
.axp-reg-score span { font-size:11px; color:var(--ax-dim); font-weight:500; }
.axp-reg-label { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.08em; }
.axp-reg-stats { margin-left:auto; display:flex; gap:10px; flex-wrap:wrap; }
.axp-reg-chip { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:6px 11px; display:flex; flex-direction:column; gap:2px; }
.axp-rc-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); }
.axp-rc-v { font-size:12.5px; font-weight:700; font-family:var(--ax-mono); color:var(--ax-tx); }

/* Correlation heatmap */
.axp-heat-wrap { overflow-x:auto; }
.axp-heat { display:grid; gap:2px; min-width:520px; }
.axp-hc { font-family:var(--ax-mono); font-size:8.5px; color:var(--ax-mut); display:flex; align-items:center; justify-content:center; }
.axp-htop { writing-mode:vertical-rl; transform:rotate(180deg); height:34px; padding-bottom:2px; }
.axp-hleft { justify-content:flex-end; padding-right:5px; }
.axp-cell { aspect-ratio:1; min-height:20px; border-radius:3px; display:flex; align-items:center; justify-content:center; font-family:var(--ax-mono); font-size:8px; color:rgba(235,244,255,.82); }

/* Sector heatmap */
.axp-sectors { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; }
.axp-sec { border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 10px; }
.axp-sec-name { font-size:10.5px; font-weight:600; color:var(--ax-tx); line-height:1.25; }
.axp-sec-etf { font-family:var(--ax-mono); font-size:8.5px; color:var(--ax-dim); margin:2px 0 6px; }
.axp-sec-chg { font-family:var(--ax-mono); font-size:14px; font-weight:700; }

/* Anomalies */
.axp-anom { display:flex; flex-direction:column; gap:7px; }
.axp-arow { display:grid; grid-template-columns:46px 62px 1fr 52px; align-items:center; gap:9px; }
.axp-a-sym { font-family:var(--ax-mono); font-size:11.5px; font-weight:700; color:var(--ax-tx); }
.axp-a-chg { font-family:var(--ax-mono); font-size:11px; text-align:right; }
.axp-a-bar { height:7px; border-radius:4px; background:var(--ax-surface); overflow:hidden; border:1px solid var(--ax-bdsoft); }
.axp-a-fill { height:100%; border-radius:4px; }
.axp-a-z { font-family:var(--ax-mono); font-size:10.5px; text-align:right; }

@media (max-width:900px) { .axp-grid { grid-template-columns:1fr; } }
`;
