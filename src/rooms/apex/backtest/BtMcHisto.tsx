import { useEffect, useRef } from "react";
import type { McResult } from "./bt-types";

/* Monte-Carlo final-equity distribution — a real histogram of the seeded trade
   bootstrap, with the starting-capital line and 5th/95th percentile markers. */
export function BtMcHisto({ mc, height = 96 }: { mc: McResult; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !mc.finals.length) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = height;
    cv.width = w * dpr; cv.height = h * dpr; const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const lo = Math.min(...mc.finals), hi = Math.max(...mc.finals), rg = hi - lo || 1;
    const BINS = 28; const bins = new Array(BINS).fill(0);
    for (const f of mc.finals) bins[Math.min(BINS - 1, Math.floor(((f - lo) / rg) * BINS))]++;
    const peak = Math.max(...bins) || 1;
    const X = (v: number) => ((v - lo) / rg) * w;
    const bw = w / BINS;
    for (let i = 0; i < BINS; i++) {
      const bh = (bins[i] / peak) * (h - 12);
      const cx = lo + (i / BINS) * rg;
      const g = ctx.createLinearGradient(0, h - bh, 0, h);
      const up = cx >= mc.startCash;
      g.addColorStop(0, up ? "rgba(52,211,153,.85)" : "rgba(244,63,94,.8)");
      g.addColorStop(1, up ? "rgba(52,211,153,.15)" : "rgba(244,63,94,.12)");
      ctx.fillStyle = g; ctx.fillRect(i * bw + 0.5, h - bh, bw - 1, bh);
    }
    // start-capital line
    const line = (x: number, col: string, dash: number[]) => { ctx.strokeStyle = col; ctx.setLineDash(dash); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]); };
    line(X(mc.startCash), "rgba(220,235,247,.55)", [3, 3]);
    line(X(mc.p5), "rgba(244,63,94,.6)", [2, 2]);
    line(X(mc.p95), "rgba(52,211,153,.6)", [2, 2]);
  }, [mc, height]);
  return <canvas ref={ref} style={{ width: "100%", height, display: "block" }} />;
}
