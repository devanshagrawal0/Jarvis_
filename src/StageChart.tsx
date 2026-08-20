import { useEffect, useRef } from "react";
import { createChart, LineSeries, AreaSeries, HistogramSeries, ColorType, CrosshairMode, type Time } from "lightweight-charts";

/* The Stage's chart block (W3c). Line / area / bar over a single series, styled to the HUD.
   Follows the same lightweight-charts v5 shape as the APEX DossierChart: transparent background so
   the panel's glass shows through, no attribution logo, and a ResizeObserver so the chart tracks the
   panel instead of being drawn once at whatever width it happened to mount at.

   Data comes in already validated by the registry. Times are ISO strings or plain YYYY-MM-DD; the
   library requires ascending, unique, so we sort and de-dup rather than trusting the caller. */

export type ChartPoint = { t: string; v: number };
export type ChartKind = "line" | "area" | "bar";

export function StageChart({ points, kind = "line", label, height = 220 }: {
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
        textColor: "rgba(150,190,225,.6)",
        fontSize: 10,
        fontFamily: "ui-monospace,monospace",
        attributionLogo: false,
      },
      grid: { vertLines: { color: "rgba(60,140,220,.05)" }, horzLines: { color: "rgba(60,140,220,.08)" } },
      rightPriceScale: { borderColor: "rgba(60,140,220,.15)" },
      timeScale: { borderColor: "rgba(60,140,220,.15)", timeVisible: false, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(120,200,255,.4)", labelBackgroundColor: "#0e2137" },
        horzLine: { color: "rgba(120,200,255,.4)", labelBackgroundColor: "#0e2137" },
      },
    });

    // An ISO timestamp becomes a UTC day string; lightweight-charts rejects mixed time formats in
    // one series, so everything is normalised to the same shape.
    const toTime = (t: string): Time => String(t).slice(0, 10) as Time;
    const seen = new Set<string>();
    const clean = points
      .filter((p) => p && Number.isFinite(p.v) && p.t)
      .map((p) => ({ time: toTime(p.t), value: p.v }))
      .filter((p) => { const k = p.time as unknown as string; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, z) => (a.time < z.time ? -1 : a.time > z.time ? 1 : 0));
    if (!clean.length) { chart.remove(); return; }

    // Colour follows direction over the whole window, so a falling series never reads as a win.
    const rising = clean[clean.length - 1].value >= clean[0].value;
    const stroke = rising ? "#34d399" : "#f4556b";

    if (kind === "bar") {
      const bars = chart.addSeries(HistogramSeries, { color: stroke, priceFormat: { type: "price" } });
      bars.setData(clean.map((p) => ({ time: p.time, value: p.value, color: rising ? "rgba(52,211,153,.55)" : "rgba(244,85,107,.55)" })));
    } else if (kind === "area") {
      const area = chart.addSeries(AreaSeries, {
        lineColor: stroke, lineWidth: 2,
        topColor: rising ? "rgba(52,211,153,.28)" : "rgba(244,85,107,.28)",
        bottomColor: "rgba(10,20,34,0)",
      });
      area.setData(clean);
    } else {
      const line = chart.addSeries(LineSeries, { color: stroke, lineWidth: 2 });
      line.setData(clean);
    }
    chart.timeScale().fitContent();

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
