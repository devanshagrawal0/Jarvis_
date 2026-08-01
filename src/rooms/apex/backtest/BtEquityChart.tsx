import { useEffect, useRef } from "react";
import {
  createChart, LineSeries, AreaSeries, createSeriesMarkers, ColorType, CrosshairMode, LineStyle, PriceScaleMode,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type Time, type SeriesMarker, type ISeriesMarkersPluginApi,
} from "lightweight-charts";
import type { BacktestRun } from "./bt-types";

/* Institutional equity view — ONE lightweight-charts v5 chart, two panes:
   pane 0 = Strategy (green, area) vs Buy&Hold (purple) vs Benchmark (blue) + trade markers;
   pane 1 = underwater drawdown (teal), computed peak-to-current from the real equity. */
const toSec = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;
function clean(pts: { t: number; v: number }[]): { time: UTCTimestamp; value: number }[] {
  const seen = new Set<number>(); const out: { time: UTCTimestamp; value: number }[] = [];
  for (const p of pts) { const t = toSec(p.t); if (seen.has(t) || !Number.isFinite(p.v)) continue; seen.add(t); out.push({ time: t, value: p.v }); }
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

export function BtEquityChart({ run, showTrades, logScale }: { run: BacktestRun; showTrades: boolean; logScale: boolean }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const S = useRef<Record<string, ISeriesApi<"Line" | "Area">>>({});
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8aa6bc", fontSize: 10, fontFamily: "var(--ax-mono, ui-monospace)", panes: { separatorColor: "rgba(90,120,150,.16)" } },
      grid: { vertLines: { color: "rgba(120,205,225,.05)" }, horzLines: { color: "rgba(120,205,225,.05)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(255,255,255,.22)", labelBackgroundColor: "#12202c" }, horzLine: { color: "rgba(255,255,255,.22)", labelBackgroundColor: "#12202c" } },
      rightPriceScale: { borderColor: "rgba(90,120,150,.2)", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "rgba(90,120,150,.2)", timeVisible: false, secondsVisible: false },
      autoSize: true,
    });
    chartRef.current = chart;
    S.current.strat = chart.addSeries(AreaSeries, { lineColor: "#34d399", topColor: "rgba(52,211,153,.22)", bottomColor: "rgba(52,211,153,.01)", lineWidth: 2, priceLineVisible: true, lastValueVisible: true }, 0);
    S.current.bh = chart.addSeries(LineSeries, { color: "#a98bff", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, 0);
    S.current.bench = chart.addSeries(LineSeries, { color: "#5ec8ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false }, 0);
    S.current.dd = chart.addSeries(AreaSeries, { lineColor: "#2dd4bf", topColor: "rgba(45,212,191,.03)", bottomColor: "rgba(45,212,191,.32)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, invertFilledArea: true }, 1);
    markersRef.current = createSeriesMarkers(S.current.strat, []);
    return () => { chart.remove(); chartRef.current = null; S.current = {}; markersRef.current = null; };
  }, []);

  // data
  useEffect(() => {
    const s = S.current; if (!s.strat || !chartRef.current) return;
    s.strat.setData(clean(run.strategyEquity));
    s.bh.setData(clean(run.buyHold));
    s.bench.setData(run.benchmark ? clean(run.benchmark) : []);
    // underwater drawdown from real equity
    let peak = -Infinity;
    const dd = clean(run.strategyEquity).map((p) => { peak = Math.max(peak, p.value); return { time: p.time, value: peak ? (p.value / peak - 1) * 100 : 0 }; });
    s.dd.setData(dd);
    try { const panes = chartRef.current.panes(); if (panes[1]) panes[1].setHeight(96); } catch { /* */ }
    chartRef.current.timeScale().fitContent();
  }, [run]);

  // trade markers
  useEffect(() => {
    if (!markersRef.current) return;
    if (!showTrades) { markersRef.current.setMarkers([]); return; }
    const mk: SeriesMarker<Time>[] = [];
    for (const t of run.trades) {
      mk.push({ time: toSec(t.entryT), position: "belowBar", color: "#34d399", shape: "arrowUp", text: "" });
      mk.push({ time: toSec(t.exitT), position: "aboveBar", color: t.pnl >= 0 ? "#5ec8ff" : "#f43f5e", shape: "arrowDown", text: "" });
    }
    mk.sort((a, b) => (a.time as number) - (b.time as number)); // markers must be time-ascending
    markersRef.current.setMarkers(mk);
  }, [run, showTrades]);

  // log/linear
  useEffect(() => { chartRef.current?.priceScale("right").applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal }); }, [logScale]);

  return <div ref={wrap} style={{ position: "absolute", inset: 0 }} />;
}
