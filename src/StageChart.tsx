import { useEffect, useRef } from "react";
import { createChart, AreaSeries, HistogramSeries, ColorType, CrosshairMode, LineStyle, type Time } from "lightweight-charts";

/* The Stage's chart block (W3c), styled to the owner's reference: a near-black instrument panel with
   a glowing cyan bezel, a bright spring-green series with a gradient falling away beneath it, faint
   dashed graticule, and a dashed marker at the last price carrying its value on the scale.

   Two things about this that are not obvious:

   - The glow on the trace is a CSS drop-shadow on the SERIES canvas only. lightweight-charts paints
     the plot and the axes onto separate canvases, so filtering the container would bloom the axis
     numbers into mush; filtering the first canvas alone leaves the type crisp.
   - Axis type is deliberately large and near-white. This chart is read at a glance from across a
     desk, and the library's defaults are sized for a dense trading terminal where the numbers are
     reference material rather than the point.

   Data arrives already checked against real fetched values — see the fabrication gate in
   stage_render. Nothing here invents or smooths a point. */

export type ChartPoint = { t: string; v: number };
export type ChartKind = "line" | "area" | "bar";

const MINT = "#3FE8A8";
const MINT_DIM = "rgba(63,232,168,.30)";

export function StageChart({ points, kind = "line", label, height = 260 }: {
  points: ChartPoint[];
  kind?: ChartKind;
  label?: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !points.length) return;
    const chart = createChart(el, {
      width: el.clientWidth || 320,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#dbe7ee",
        fontSize: 13,
        fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(122,180,205,.085)", style: LineStyle.Dashed },
        horzLines: { color: "rgba(122,180,205,.085)", style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: "rgba(96,190,230,.28)", scaleMargins: { top: 0.14, bottom: 0.1 } },
      timeScale: { borderColor: "rgba(96,190,230,.28)", timeVisible: false, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(120,220,255,.45)", labelBackgroundColor: "#0e2137" },
        horzLine: { color: "rgba(120,220,255,.45)", labelBackgroundColor: "#0e2137" },
      },
      handleScale: false,
      handleScroll: false,
    });

    const toTime = (t: string): Time => String(t).slice(0, 10) as Time;
    const seen = new Set<string>();
    const clean = points
      .filter((p) => p && Number.isFinite(p.v) && p.t)
      .map((p) => ({ time: toTime(p.t), value: p.v }))
      .filter((p) => { const k = p.time as unknown as string; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, z) => (a.time < z.time ? -1 : a.time > z.time ? 1 : 0));
    if (!clean.length) { chart.remove(); return; }

    const last = clean[clean.length - 1].value;
    let series;
    if (kind === "bar") {
      series = chart.addSeries(HistogramSeries, { color: MINT_DIM, priceFormat: { type: "price" } });
      series.setData(clean.map((p) => ({ time: p.time, value: p.value, color: MINT_DIM })));
    } else {
      // Both "line" and "area" draw as an area. A bare stroke leaves the plot bottom-heavy with dead
      // space, and the falling-away gradient is what makes the trace read as a level above a floor
      // rather than a squiggle in a box. "line" simply takes the lighter fill.
      series = chart.addSeries(AreaSeries, {
        lineColor: MINT,
        lineWidth: 3,
        topColor: kind === "area" ? "rgba(63,232,168,.42)" : "rgba(63,232,168,.34)",
        bottomColor: "rgba(63,232,168,0)",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(clean);
    }

    // The dashed marker at the last value, with the number on the scale — the one figure a glance is
    // actually looking for, so it is drawn rather than left to a hover.
    series.createPriceLine({
      price: last,
      color: MINT,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      axisLabelColor: MINT,
      axisLabelTextColor: "#04231a",
      title: "",
    });
    chart.timeScale().fitContent();

    // Bloom the trace, not the type: the plot lives on the first canvas, the axes on later ones.
    const paneCanvas = el.querySelector("canvas");
    if (paneCanvas) paneCanvas.style.filter = "drop-shadow(0 0 3px rgba(63,232,168,.42))";

    const ro = new ResizeObserver(() => {
      try { chart.applyOptions({ width: el.clientWidth || 320 }); } catch { /* chart already removed */ }
    });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [points, kind, height]);

  return (
    <div className="jr-blk-chart">
      {label ? <div className="jr-blk-chart-label">{label}</div> : null}
      <div ref={ref} style={{ height }} />
    </div>
  );
}
