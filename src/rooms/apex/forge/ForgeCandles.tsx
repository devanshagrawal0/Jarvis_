/* THE FORGE — price chart with trade markers.
   Candlesticks for the strategy's symbol with BUY/SELL markers at every backtest
   entry/exit, so you can see WHERE the strategy actually traded. Ice-themed
   lightweight-charts v5. */

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, ColorType, CrosshairMode, createSeriesMarkers, type Time, type SeriesMarker } from "lightweight-charts";
import { fetchBars } from "../apex-data";
import type { BacktestResult } from "./forge-engine";

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };

export function ForgeCandles({ result, symbol, bar, height = 200 }: { result: BacktestResult; symbol: string; bar: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let disposed = false; let chart: ReturnType<typeof createChart> | null = null;
    const intraday = bar !== "1d";
    const toTime = (ms: number): Time => (intraday ? (Math.floor(ms / 1000) as Time) : (new Date(ms).toISOString().slice(0, 10) as Time));

    (async () => {
      const raw = await fetchBars(symbol, bar, RANGE_FOR[bar] || "2y");
      if (disposed || !el || !raw.length) return;
      chart = createChart(el, {
        width: el.clientWidth || 300, height,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(195,212,230,.6)", fontSize: 10, fontFamily: "ui-monospace,monospace", attributionLogo: false },
        grid: { vertLines: { color: "rgba(150,180,210,.05)" }, horzLines: { color: "rgba(150,180,210,.07)" } },
        rightPriceScale: { borderColor: "rgba(150,180,210,.15)" },
        timeScale: { borderColor: "rgba(150,180,210,.15)", timeVisible: intraday, secondsVisible: false },
        crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(210,235,255,.4)", labelBackgroundColor: "#12141a" }, horzLine: { color: "rgba(210,235,255,.4)", labelBackgroundColor: "#12141a" } },
      });
      const candle = chart.addSeries(CandlestickSeries, {
        upColor: "#4dffb0", downColor: "#ff7285", borderUpColor: "#4dffb0", borderDownColor: "#ff7285", wickUpColor: "rgba(77,255,176,.8)", wickDownColor: "rgba(255,114,133,.8)",
      });
      const seen = new Set<string | number>();
      const clean = raw
        .filter((b) => b && b.o != null && b.c != null && b.h != null && b.l != null)
        .map((b) => ({ b, t: toTime(typeof b.t === "number" ? b.t : Date.parse(b.t)) }))
        .filter((x) => { const k = x.t as unknown as string; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, z) => (a.t < z.t ? -1 : a.t > z.t ? 1 : 0));
      candle.setData(clean.map((x) => ({ time: x.t, open: x.b.o, high: x.b.h, low: x.b.l, close: x.b.c })));

      // trade markers — one BUY at entry, one SELL at exit (colored by P&L)
      const markers: SeriesMarker<Time>[] = [];
      for (const t of result.trades || []) {
        markers.push({ time: toTime(t.entryT), position: "belowBar", color: "#8fe9c4", shape: "arrowUp", text: "BUY" });
        markers.push({ time: toTime(t.exitT), position: "aboveBar", color: t.retPct >= 0 ? "#4dffb0" : "#ff7285", shape: "arrowDown", text: `${t.retPct >= 0 ? "+" : ""}${t.retPct.toFixed(1)}%` });
      }
      // de-dup marker times (chart requires ascending, unique per series is not
      // required for markers but keep them sorted)
      markers.sort((a, z) => (a.time < z.time ? -1 : a.time > z.time ? 1 : 0));
      try { createSeriesMarkers(candle, markers); } catch { /* markers plugin optional */ }
      chart.timeScale().fitContent();
    })();

    const ro = new ResizeObserver(() => { try { chart?.applyOptions({ width: el.clientWidth || 300 }); } catch { /* removed */ } });
    ro.observe(el);
    return () => { disposed = true; ro.disconnect(); try { chart?.remove(); } catch { /* noop */ } };
  }, [result, symbol, bar, height]);
  return <div ref={ref} className="fg-candles" style={{ height }} />;
}
