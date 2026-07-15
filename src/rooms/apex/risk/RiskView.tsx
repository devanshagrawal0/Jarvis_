import { useEffect, useMemo, useRef, useState } from "react";
import { fetchRiskLab, fetchVol, fetchMonteCarlo, type RiskLab, type VolReport, type MCReport } from "../apex-data";

// APEX · Risk — the Quant Risk Lab. Full single-name risk decomposition from
// public daily bars: realized/EWMA vol, historical VaR & CVaR, max drawdown,
// Sharpe, beta vs SPY, a return-distribution histogram, a realized-vol CONE,
// and a Monte-Carlo price fan. All served by JARVIS's own /api/apex/* quant
// routes (no sidecar) and styled with the shared Apex theme vars (--ax-*) so it
// sits seamlessly next to Home. Informational — not financial advice.

const POS = "#34d399", NEG = "#f4556b", WARN = "#f5a742", CY = "#3fd0ff", MUT = "rgba(150,190,225,.4)";

export function RiskView() {
  const [sym, setSym] = useState("NVDA");
  const [q, setQ] = useState("NVDA");
  const [risk, setRisk] = useState<RiskLab | null>(null);
  const [vol, setVol] = useState<VolReport | null>(null);
  const [mc, setMc] = useState<MCReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setLoading(true); setErr(null);
    Promise.all([fetchRiskLab(sym), fetchVol(sym), fetchMonteCarlo(sym, 30)])
      .then(([r, v, m]) => {
        if (dead) return;
        if (!r) { setErr(`No risk data for ${sym} — check the symbol.`); setRisk(null); setVol(null); setMc(null); }
        else { setRisk(r); setVol(v); setMc(m); }
      })
      .catch(() => { if (!dead) setErr("Failed to load risk data."); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [sym]);

  const submit = () => { const s = q.trim().toUpperCase(); if (s) setSym(s); };

  return (
    <div className="ax-risk">
      <style>{RISK_CSS}</style>

      <div className="axr-head">
        <span className="axr-title">Σ RISK</span>
        <span className="axr-sub">Quant Risk Lab · VaR · CVaR · β · vol cone · Monte-Carlo</span>
        <div className="axr-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="SYM" spellCheck={false} maxLength={6} />
          <button onClick={submit}>Analyze</button>
        </div>
      </div>

      {loading ? (
        <div className="axr-empty">Computing risk decomposition for {sym}…</div>
      ) : err ? (
        <div className="axr-empty">{err}</div>
      ) : risk ? (
        <div className="axr-body">
          <div className="axr-symline">{risk.symbol}<span className="axr-days">{risk.days} trading days</span></div>

          {/* Metric grid */}
          <div className="axr-metrics">
            {metric("REALIZED VOL", pct(risk.realizedVol), CY, "Annualized σ of daily log returns")}
            {metric("EWMA VOL", pct(risk.ewmaVol), CY, "RiskMetrics λ=0.94 — recent-weighted")}
            {metric("BETA vs SPY", risk.beta == null ? "—" : risk.beta.toFixed(2), risk.beta != null && risk.beta > 1 ? WARN : POS, "Sensitivity to the market")}
            {metric("SHARPE", risk.sharpe.toFixed(2), risk.sharpe >= 0 ? POS : NEG, "Annualized, rf=0")}
            {metric("VaR 95%", "−" + pct(risk.var95), WARN, "1-day historical Value-at-Risk")}
            {metric("CVaR 95%", "−" + pct(risk.cvar95), WARN, "Expected shortfall beyond VaR95")}
            {metric("VaR 99%", "−" + pct(risk.var99), NEG, "1-day historical Value-at-Risk")}
            {metric("CVaR 99%", "−" + pct(risk.cvar99), NEG, "Expected shortfall beyond VaR99")}
            {metric("MAX DRAWDOWN", pct(risk.maxDD), NEG, "Worst peak-to-trough over the window")}
          </div>

          {/* Distribution + rolling Sharpe */}
          <div className="axr-row2">
            <div className="axr-panel">
              <div className="axr-ph">RETURN DISTRIBUTION <span>daily %, {risk.days}d</span></div>
              <HistChart bins={risk.bins} />
            </div>
            <div className="axr-panel">
              <div className="axr-ph">ROLLING SHARPE <span>60-day window</span></div>
              <SparkChart series={risk.rollSharpe} />
              <div className="axr-spark-cap">
                <span>min {Math.min(...risk.rollSharpe).toFixed(2)}</span>
                <span>now {risk.rollSharpe[risk.rollSharpe.length - 1]?.toFixed(2)}</span>
                <span>max {Math.max(...risk.rollSharpe).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Vol cone */}
          {vol && vol.cone.length > 0 && (
            <div className="axr-panel">
              <div className="axr-ph">REALIZED-VOL CONE <span>annualized σ by horizon · dot = current</span></div>
              <VolCone cone={vol.cone} />
              <div className="axr-legend">
                <span><i style={{ background: MUT }} /> min–max</span>
                <span><i style={{ background: "rgba(63,208,255,.35)" }} /> p25–p75</span>
                <span><i style={{ background: CY }} /> median</span>
                <span><i style={{ background: POS }} /> current (below median)</span>
                <span><i style={{ background: NEG }} /> current (above median)</span>
              </div>
            </div>
          )}

          {/* Monte-Carlo fan */}
          {mc && mc.bands.length > 0 && (
            <div className="axr-panel">
              <div className="axr-ph">MONTE-CARLO PROJECTION <span>{mc.days}-day GBM · {mc.bands.length} steps</span></div>
              <McFan mc={mc} />
              <div className="axr-mc-cap">
                <span>spot <b>${mc.S0}</b></span>
                <span>drift <b>{mc.driftAnnPct >= 0 ? "+" : ""}{mc.driftAnnPct}%</b>/yr</span>
                <span>vol <b>{mc.volAnnPct}%</b>/yr</span>
                <span>median (30d) <b>${mc.bands[mc.bands.length - 1].p50}</b></span>
                <span className="axr-mc-band">90% band <b>${mc.bands[mc.bands.length - 1].p5} – ${mc.bands[mc.bands.length - 1].p95}</b></span>
              </div>
            </div>
          )}

          <div className="axr-foot">All metrics derived from public daily bars. Informational only — not financial advice.</div>
        </div>
      ) : null}
    </div>
  );
}

function metric(label: string, value: string, color: string, tip: string) {
  return (
    <div className="axr-metric" title={tip}>
      <div className="axr-m-l">{label}</div>
      <div className="axr-m-v" style={{ color }}>{value}</div>
    </div>
  );
}

const pct = (n: number) => `${n}%`;

/* ── Return-distribution histogram ── */
function HistChart({ bins }: { bins: RiskLab["bins"] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (!bins.length) return;
      const maxC = Math.max(...bins.map((b) => b.count)) || 1;
      const pad = 6, bw = (w - pad * 2) / bins.length;
      // zero line
      const xs = bins.map((b) => b.x); const lo = Math.min(...xs), hi = Math.max(...xs), span = hi - lo || 1;
      const zeroX = pad + ((0 - lo) / span) * (w - pad * 2);
      ctx.strokeStyle = "rgba(150,190,225,.22)"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(zeroX, 4); ctx.lineTo(zeroX, h - 14); ctx.stroke(); ctx.setLineDash([]);
      bins.forEach((b, i) => {
        const bh = (b.count / maxC) * (h - 22);
        const x = pad + i * bw, y = h - 14 - bh;
        const col = b.x >= 0 ? POS : NEG;
        ctx.fillStyle = col + "cc"; ctx.fillRect(x + 0.5, y, Math.max(1, bw - 1.5), bh);
      });
      // x labels (min / 0 / max)
      ctx.fillStyle = "rgba(150,190,225,.6)"; ctx.font = "9px ui-monospace,monospace"; ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left"; ctx.fillText(lo.toFixed(1) + "%", pad, h - 2);
      ctx.textAlign = "right"; ctx.fillText("+" + hi.toFixed(1) + "%", w - pad, h - 2);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [bins]);
  return <canvas ref={ref} className="axr-canvas" style={{ height: 150 }} />;
}

/* ── Rolling-Sharpe sparkline ── */
function SparkChart({ series }: { series: number[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (series.length < 2) return;
      const lo = Math.min(0, ...series), hi = Math.max(0, ...series), rg = hi - lo || 1;
      const X = (i: number) => (i / (series.length - 1)) * (w - 10) + 5;
      const Y = (v: number) => h - 8 - ((v - lo) / rg) * (h - 16);
      // zero line
      ctx.strokeStyle = "rgba(150,190,225,.22)"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(5, Y(0)); ctx.lineTo(w - 5, Y(0)); ctx.stroke(); ctx.setLineDash([]);
      const up = series[series.length - 1] >= 0;
      const col = up ? POS : NEG;
      ctx.beginPath(); ctx.moveTo(X(0), h); series.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(series.length - 1), h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + "33"); g.addColorStop(1, col + "00"); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); series.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.shadowColor = col; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [series]);
  return <canvas ref={ref} className="axr-canvas" style={{ height: 92 }} />;
}

/* ── Realized-vol cone ── */
function VolCone({ cone }: { cone: VolReport["cone"] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      if (!cone.length) return;
      const padL = 34, padR = 12, padT = 10, padB = 22;
      const allV = cone.flatMap((c) => [c.min, c.max, c.cur]);
      const lo = Math.min(...allV) * 0.95, hi = Math.max(...allV) * 1.05, rg = hi - lo || 1;
      const Y = (v: number) => padT + (1 - (v - lo) / rg) * (h - padT - padB);
      const n = cone.length;
      const X = (i: number) => padL + (n === 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
      // y gridlines
      ctx.font = "9px ui-monospace,monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const v = lo + (rg * g) / 4, y = Y(v);
        ctx.strokeStyle = "rgba(150,190,225,.1)"; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillStyle = "rgba(150,190,225,.55)"; ctx.fillText(v.toFixed(0), padL - 5, y);
      }
      // min-max whisker band (area)
      ctx.beginPath();
      cone.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.max)) : ctx.moveTo(X(i), Y(c.max))));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(cone[i].min));
      ctx.closePath(); ctx.fillStyle = "rgba(150,190,225,.09)"; ctx.fill();
      // p25-p75 band
      ctx.beginPath();
      cone.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.p75)) : ctx.moveTo(X(i), Y(c.p75))));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(cone[i].p25));
      ctx.closePath(); ctx.fillStyle = "rgba(63,208,255,.16)"; ctx.fill();
      // median line
      ctx.beginPath(); cone.forEach((c, i) => (i ? ctx.lineTo(X(i), Y(c.median)) : ctx.moveTo(X(i), Y(c.median))));
      ctx.strokeStyle = CY; ctx.lineWidth = 1.6; ctx.stroke();
      // current dots
      cone.forEach((c, i) => {
        const col = c.cur <= c.median ? POS : NEG;
        ctx.beginPath(); ctx.arc(X(i), Y(c.cur), 3.5, 0, 7); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0;
      });
      // x labels
      ctx.fillStyle = "rgba(150,190,225,.6)"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      cone.forEach((c, i) => ctx.fillText(c.w + "d", X(i), h - 6));
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [cone]);
  return <canvas ref={ref} className="axr-canvas" style={{ height: 190 }} />;
}

/* ── Monte-Carlo price fan ── */
function McFan({ mc }: { mc: MCReport }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const b = mc.bands; if (!b.length) return;
      const padL = 44, padR = 10, padT = 8, padB = 18;
      const allV = b.flatMap((p) => [p.p5, p.p95]).concat(mc.S0);
      const lo = Math.min(...allV), hi = Math.max(...allV), rg = hi - lo || 1;
      const Y = (v: number) => padT + (1 - (v - lo) / rg) * (h - padT - padB);
      const X = (t: number) => padL + ((t) / mc.days) * (w - padL - padR);
      // y grid
      ctx.font = "9px ui-monospace,monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const v = lo + (rg * g) / 4, y = Y(v);
        ctx.strokeStyle = "rgba(150,190,225,.1)"; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillStyle = "rgba(150,190,225,.55)"; ctx.fillText(v.toFixed(0), padL - 5, y);
      }
      // spot baseline
      ctx.strokeStyle = "rgba(150,190,225,.3)"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(padL, Y(mc.S0)); ctx.lineTo(w - padR, Y(mc.S0)); ctx.stroke(); ctx.setLineDash([]);
      const band = (a: "p5" | "p25", z: "p95" | "p75", fill: string) => {
        ctx.beginPath(); ctx.moveTo(X(0), Y(mc.S0));
        b.forEach((p) => ctx.lineTo(X(p.t), Y(p[z])));
        for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(X(b[i].t), Y(b[i][a]));
        ctx.lineTo(X(0), Y(mc.S0)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
      };
      band("p5", "p95", "rgba(63,208,255,.1)");
      band("p25", "p75", "rgba(63,208,255,.2)");
      // sample paths (faint)
      (mc.paths || []).slice(0, 12).forEach((path) => {
        ctx.beginPath(); path.forEach((v, t) => (t ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
        ctx.strokeStyle = "rgba(169,139,255,.14)"; ctx.lineWidth = 1; ctx.stroke();
      });
      // median line
      ctx.beginPath(); ctx.moveTo(X(0), Y(mc.S0)); b.forEach((p) => ctx.lineTo(X(p.t), Y(p.p50)));
      ctx.strokeStyle = CY; ctx.lineWidth = 1.7; ctx.shadowColor = CY; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
      // x labels
      ctx.fillStyle = "rgba(150,190,225,.55)"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText("now", padL, h - 5); ctx.textAlign = "right"; ctx.fillText("+" + mc.days + "d", w - padR, h - 5);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [mc]);
  return <canvas ref={ref} className="axr-canvas" style={{ height: 210 }} />;
}

const RISK_CSS = `
.ax-risk { height:100%; display:flex; flex-direction:column; gap:14px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axr-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axr-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axr-sub { font-size:11px; color:var(--ax-mut); }
.axr-search { margin-left:auto; display:flex; gap:6px; }
.axr-search input { width:92px; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:9px; padding:8px 12px; color:var(--ax-tx); font-size:12px; font-family:var(--ax-mono); letter-spacing:.06em; text-transform:uppercase; outline:none; }
.axr-search input:focus { border-color:var(--ax-bdglow); }
.axr-search button { background:color-mix(in srgb, var(--ax-acc) 16%, transparent); border:1px solid var(--ax-bdglow); border-radius:9px; padding:8px 15px; color:var(--ax-acc); font-size:11.5px; font-weight:700; cursor:pointer; font-family:var(--ax-sans); }
.axr-search button:hover { background:color-mix(in srgb, var(--ax-acc) 24%, transparent); }
.axr-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:14px; padding-right:4px; }
.axr-symline { font-family:var(--ax-disp); font-size:20px; font-weight:800; letter-spacing:.04em; color:var(--ax-tx); display:flex; align-items:baseline; gap:12px; }
.axr-days { font-family:var(--ax-mono); font-size:10.5px; font-weight:500; color:var(--ax-mut); letter-spacing:.02em; }
.axr-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:9px; }
.axr-metric { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:10px 12px; }
.axr-m-l { font-size:8.5px; letter-spacing:.09em; color:var(--ax-dim); margin-bottom:5px; }
.axr-m-v { font-size:18px; font-weight:700; font-family:var(--ax-mono); }
.axr-row2 { display:grid; grid-template-columns:1.4fr 1fr; gap:14px; }
.axr-panel { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; }
.axr-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:10px; display:flex; justify-content:space-between; align-items:baseline; }
.axr-ph span { font-weight:500; letter-spacing:.02em; color:var(--ax-dim); text-transform:none; }
.axr-canvas { width:100%; display:block; }
.axr-spark-cap, .axr-mc-cap { display:flex; gap:14px; flex-wrap:wrap; margin-top:8px; font-family:var(--ax-mono); font-size:10px; color:var(--ax-mut); }
.axr-mc-cap b { color:var(--ax-tx); font-weight:600; }
.axr-mc-band { color:var(--ax-cydim); }
.axr-legend { display:flex; gap:14px; flex-wrap:wrap; margin-top:9px; font-size:9.5px; color:var(--ax-mut); }
.axr-legend span { display:flex; align-items:center; gap:5px; }
.axr-legend i { width:10px; height:10px; border-radius:3px; display:inline-block; }
.axr-foot { font-size:9px; color:var(--ax-dim); padding-top:2px; }
.axr-empty { color:var(--ax-mut); font-size:12px; padding:26px 4px; }
@media (max-width:820px) { .axr-row2 { grid-template-columns:1fr; } }
`;
