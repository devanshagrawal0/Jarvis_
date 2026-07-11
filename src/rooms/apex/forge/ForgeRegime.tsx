/* THE FORGE — F1 Regime Radar. Shows the equity curve over a timeline shaded by
   market regime (calm-bull / volatile-bull / grind-bear / crisis), plus a
   per-regime scorecard, so you can see WHERE the edge lives — and whether it's
   dangerously concentrated in one regime. Powered by the Improver kernel. */

import { useEffect, useRef } from "react";
import { REGIME_COLOR, type RegimeId } from "./improver/artifact";
import type { RegimeAnalysis } from "./improver/analyze";

function RegimeStrip({ a, height = 150 }: { a: RegimeAnalysis; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = c.clientWidth || 640, h = height;
    c.width = w * dpr; c.height = h * dpr; const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = a.regimes.length; if (!n) return;
    // regime bands (background)
    for (let i = 0; i < n; i++) { ctx.fillStyle = REGIME_COLOR[a.regimes[i] as RegimeId] + "26"; ctx.fillRect((i / n) * w, 0, w / n + 1, h); }
    // equity line
    const eq = a.equity; const lo = Math.min(...eq), hi = Math.max(...eq), rg = hi - lo || 1;
    ctx.beginPath();
    eq.forEach((v, i) => { const x = (i / (eq.length - 1)) * w, y = h - 6 - ((v - lo) / rg) * (h - 12); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = "#eaf6ff"; ctx.lineWidth = 1.6; ctx.shadowColor = "rgba(220,240,255,.6)"; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
  }, [a, height]);
  return <canvas ref={ref} className="fg-regime-strip" style={{ height, width: "100%", display: "block" }} />;
}

export function ForgeRegime({ analysis, onClose }: { analysis: RegimeAnalysis; onClose: () => void }) {
  return (
    <div className="fg-brief-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("fg-brief-back")) onClose(); }}>
      <div className="fg-brief fg-regime">
        <div className="fg-brief-h"><span className="fg-brief-t">◫ Regime Radar</span><span className="fg-x" onClick={onClose}>✕</span></div>
        <div className={`fg-brief-sum${analysis.concentrated ? " warn" : ""}`}>{analysis.verdict}</div>
        <RegimeStrip a={analysis} />
        <div className="fg-regime-legend">{analysis.cells.map(c => <span key={c.regime} className="fg-regime-key"><i style={{ background: c.color }} />{c.label} · {(c.barShare * 100).toFixed(0)}% of time</span>)}</div>
        <div className="fg-sec-h" style={{ marginTop: 12 }}>Per-regime scorecard</div>
        <div className="fg-regime-grid">
          <div className="fg-regime-row head"><span>Regime</span><span>Trades</span><span>Win rate</span><span>Expectancy</span></div>
          {analysis.cells.map(c => <div key={c.regime} className="fg-regime-row">
            <span><i style={{ background: c.color }} />{c.label}</span>
            <span>{c.trades}</span>
            <span>{(c.winRate * 100).toFixed(0)}%</span>
            <span className={c.expectancy >= 0 ? "pos" : "neg"}>{c.expectancy >= 0 ? "+" : ""}{(c.expectancy * 100).toFixed(2)}%</span>
          </div>)}
        </div>
        <div className="fg-note" style={{ marginTop: 10 }}>Regimes classified from volatility × trend. {analysis.concentrated ? "⚠ Edge is regime-dependent — consider a regime filter so the bot only trades its favorable regime." : "Edge is reasonably spread across regimes."}</div>
      </div>
    </div>
  );
}
