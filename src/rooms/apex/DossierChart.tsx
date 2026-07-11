import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, ColorType, CrosshairMode, type Time } from "lightweight-charts";
import type { Bar } from "./apex-data";

/* Pro candlestick + volume chart (lightweight-charts v5). One instance per
   render of `bars`; recreated when timeframe (intraday) changes. */
export function DossierChart({ bars, intraday, height = 230 }: { bars: Bar[]; intraday: boolean; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !bars.length) return;
    const chart = createChart(el, {
      width: el.clientWidth || 300, height,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(150,190,225,.6)", fontSize: 10, fontFamily: "ui-monospace,monospace", attributionLogo: false },
      grid: { vertLines: { color: "rgba(60,140,220,.05)" }, horzLines: { color: "rgba(60,140,220,.08)" } },
      rightPriceScale: { borderColor: "rgba(60,140,220,.15)" },
      timeScale: { borderColor: "rgba(60,140,220,.15)", timeVisible: intraday, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(120,200,255,.4)", labelBackgroundColor: "#0e2137" }, horzLine: { color: "rgba(120,200,255,.4)", labelBackgroundColor: "#0e2137" } },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399", downColor: "#f4556b", borderUpColor: "#34d399", borderDownColor: "#f4556b", wickUpColor: "rgba(52,211,153,.8)", wickDownColor: "rgba(244,85,107,.8)",
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(120,160,200,.3)" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });

    const toTime = (t: string): Time => (intraday ? (Math.floor(new Date(t).getTime() / 1000) as Time) : (t.slice(0, 10) as Time));
    // sort + de-dup by time (lightweight-charts requires ascending, unique)
    const seen = new Set<string | number>();
    const clean = bars
      .filter((b) => b && b.o != null && b.c != null && b.h != null && b.l != null)
      .map((b) => ({ b, t: toTime(b.t) }))
      .filter((x) => { const k = x.t as unknown as string; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, z) => (a.t < z.t ? -1 : a.t > z.t ? 1 : 0));
    candle.setData(clean.map((x) => ({ time: x.t, open: x.b.o, high: x.b.h, low: x.b.l, close: x.b.c })));
    vol.setData(clean.map((x) => ({ time: x.t, value: x.b.v || 0, color: x.b.c >= x.b.o ? "rgba(52,211,153,.22)" : "rgba(244,85,107,.22)" })));
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => { try { chart.applyOptions({ width: el.clientWidth || 300 }); } catch { /* removed */ } });
    ro.observe(el);
    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, intraday, height]);
  return <div ref={ref} className="dossier-chart" style={{ height }} />;
}
