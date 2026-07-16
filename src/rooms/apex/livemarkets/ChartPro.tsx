import { useEffect, useRef } from "react";
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers,
  ColorType, CrosshairMode, LineStyle,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type Time, type ISeriesMarkersPluginApi, type SeriesMarker,
} from "lightweight-charts";
import type { Bar } from "../apex-data";
import { ema, vwap as calcVwap, bollinger, rsi as calcRsi, macd as calcMacd, closes, getStrategy, runReplay, type StrategyId, type ReplayResult } from "./indicators";

/* eslint-disable @typescript-eslint/no-explicit-any */
// ── Bollinger band-fill: a custom lightweight-charts v5 series primitive that shades the region
// between the upper and lower bands (no native band primitive exists). Draws behind the candles.
type BBPt = { time: UTCTimestamp; up: number; lo: number };
class BBFillRenderer {
  constructor(private view: BBFillPrimitive) {}
  draw() { /* nothing on the foreground layer */ }
  drawBackground(target: any) {
    try { this._draw(target); } catch { /* never let a primitive break chart rendering */ }
  }
  _draw(target: any) {
    const { points, chart, series } = this.view;
    if (!points.length || !chart || !series) return;
    const ts = chart.timeScale();
    target.useMediaCoordinateSpace((scope: any) => {
      const ctx = scope.context as CanvasRenderingContext2D;
      const top: [number, number][] = [], bot: [number, number][] = [];
      for (const p of points) { const x = ts.timeToCoordinate(p.time), yu = series.priceToCoordinate(p.up), yl = series.priceToCoordinate(p.lo); if (x == null || yu == null || yl == null) continue; top.push([x, yu]); bot.push([x, yl]); }
      if (top.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(top[0][0], top[0][1]);
      for (let i = 1; i < top.length; i++) ctx.lineTo(top[i][0], top[i][1]);
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(77,159,209,0.07)";
      ctx.fill();
    });
  }
}
class BBFillPaneView {
  private r: BBFillRenderer;
  constructor(view: BBFillPrimitive) { this.r = new BBFillRenderer(view); }
  renderer() { return this.r; }
  zOrder() { return "bottom" as const; }
}
class BBFillPrimitive {
  points: BBPt[] = [];
  chart: IChartApi | null = null;
  series: ISeriesApi<"Candlestick"> | null = null;
  private req: (() => void) | null = null;
  private pv = new BBFillPaneView(this);
  attached(p: any) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.req = null; }
  setPoints(pts: BBPt[]) { this.points = pts; this.req?.(); }
  updateAllViews() { /* points are pushed imperatively */ }
  paneViews() { return [this.pv]; }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// APEX · Live Markets — the professional chart. TradingView-grade candles on real
// OHLCV, with EMA 20/50/200, session VWAP, Bollinger Bands, a volume pane, and RSI +
// MACD study panes. Also drives STRATEGY REPLAY: step the chart forward bar-by-bar
// while a strategy trades it, dropping entry/exit markers and an equity overlay.
// Built on lightweight-charts v5 (TradingView's open-source engine).

export interface Indicators { ema: boolean; bb: boolean; vwap: boolean; volume: boolean; rsi: boolean; macd: boolean }

export interface ForecastPoint { horizon: string; p05: number; p50: number; p95: number }
interface Props {
  bars: Bar[];
  up: boolean; // day direction, for candle theming accents
  indicators: Indicators;
  replayActive: boolean;
  replaySpeed: number; // bars per second
  replayStrategy: StrategyId;
  forecast?: ForecastPoint[] | null; // Oracle cones projected into the future
  onReplayProgress?: (pct: number, barTime: number | null) => void;
  onReplayStats?: (r: ReplayResult | null) => void;
}

const FC_MS: Record<string, number> = { "1h": 3.6e6, "5h": 1.8e7, "12h": 4.32e7, "1d": 8.64e7, "5d": 4.32e8 };

// Institutional palette — TradingView-desaturated candles, muted study lines, near-invisible grid.
const COL = {
  up: "#26a69a", down: "#ef5350",
  ema20: "#4d9fd1", ema50: "#e0952b", ema200: "#9a86d4",
  vwap: "#c9d4e0", bb: "rgba(77,159,209,.35)", bbMid: "rgba(150,170,195,.28)",
  rsi: "#9a86d4", macd: "#4d9fd1", signal: "#e0952b",
  equity: "#26a69a", grid: "rgba(90,140,180,.06)", text: "#7d93a6",
};

const toSec = (t: string): UTCTimestamp => Math.floor(new Date(t).getTime() / 1000) as UTCTimestamp;

const DEFAULT_VISIBLE = 130;   // bars framed on load so candles have real amplitude (not a thin ribbon)

// Data hygiene BEFORE the chart sees it (research §2.7-A): drop malformed bars, repair OHLC
// consistency, dedupe/sort, trim after-hours padding, and neutralise single-bar provider spikes
// that would otherwise blow autoscale — without deleting legitimate gaps.
function cleanBars(bars: Bar[]): Bar[] {
  // trim trailing zero-volume flat bars (after-hours padding on intraday feeds)
  let end = bars.length;
  while (end > 1) { const b = bars[end - 1]; if ((b.v ?? 0) === 0 && b.o === b.h && b.h === b.l && b.l === b.c) end--; else break; }
  const seen = new Set<number>(); const out: Bar[] = [];
  for (const b of bars.slice(0, end)) {
    const s = toSec(b.t);
    // reject non-finite / non-positive / duplicate timestamps
    if (![b.o, b.h, b.l, b.c].every((v) => Number.isFinite(v) && (v as number) > 0) || seen.has(s)) continue;
    seen.add(s);
    // repair OHLC: high must bound all, low must bound all (guards bad wicks)
    const hi = Math.max(b.o, b.h, b.l, b.c), lo = Math.min(b.o, b.h, b.l, b.c);
    out.push({ ...b, h: hi, l: lo });
  }
  out.sort((a, z) => toSec(a.t) - toSec(z.t));
  // Spike guard: flag bars whose close-to-close move is a gross outlier (>10× MAD) AND immediately
  // reverts (classic bad tick). Winsorise that bar toward its neighbours instead of nuking the scale.
  if (out.length > 8) {
    const rets: number[] = [];
    for (let i = 1; i < out.length; i++) rets.push(Math.abs(Math.log(out[i].c / out[i - 1].c)));
    const sorted = [...rets].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 1e-4;
    const madArr = rets.map((r) => Math.abs(r - med)).sort((a, b) => a - b);
    const mad = (madArr[Math.floor(madArr.length / 2)] || med) * 1.4826 || 1e-4;
    const thresh = Math.max(med + 10 * mad, 0.18); // at least an 18% single-bar move to qualify
    for (let i = 1; i < out.length - 1; i++) {
      const r = Math.log(out[i].c / out[i - 1].c);
      const rNext = Math.log(out[i + 1].c / out[i].c);
      if (Math.abs(r) > thresh && Math.sign(r) !== Math.sign(rNext) && Math.abs(rNext) > thresh * 0.6) {
        const fix = (out[i - 1].c + out[i + 1].c) / 2;
        const b = out[i];
        out[i] = { ...b, o: fix, c: fix, h: Math.max(fix, out[i - 1].c, out[i + 1].c), l: Math.min(fix, out[i - 1].c, out[i + 1].c) };
        if (typeof console !== "undefined") console.debug("[ChartPro] winsorised spike bar", b.t, b.c, "→", fix);
      }
    }
  }
  return out;
}

export function ChartPro({ bars, up, indicators, replayActive, replaySpeed, replayStrategy, forecast, onReplayProgress, onReplayStats }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const S = useRef<Record<string, ISeriesApi<"Candlestick" | "Line" | "Histogram">>>({});
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const bbFillRef = useRef<BBFillPrimitive | null>(null);
  const dataRef = useRef<Bar[]>([]);
  const replayTimer = useRef<number | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const lastVals = useRef<Record<string, number>>({});
  // Precomputed indicator arrays (computed ONCE per data load — replay slices these, no O(n²) recompute).
  const indRef = useRef<{ e20: number[]; e50: number[]; e200: number[]; vwap: number[]; bbU: number[]; bbM: number[]; bbL: number[]; rsi: number[]; macd: number[]; signal: number[]; hist: number[]; t: UTCTimestamp[] }>({ e20: [], e50: [], e200: [], vwap: [], bbU: [], bbM: [], bbL: [], rsi: [], macd: [], signal: [], hist: [], t: [] });
  const recomputeIndicators = () => {
    const all = dataRef.current; const c = closes(all);
    const bb = bollinger(c, 20, 2); const m = calcMacd(c);
    indRef.current = { e20: ema(c, 20), e50: ema(c, 50), e200: ema(c, 200), vwap: calcVwap(all), bbU: bb.upper, bbM: bb.mid, bbL: bb.lower, rsi: calcRsi(c, 14), macd: m.macd, signal: m.signal, hist: m.hist, t: all.map((b) => toSec(b.t)) };
  };

  // ── Build the chart + all series ONCE ──
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COL.text, fontSize: 10, fontFamily: "var(--ax-mono, ui-monospace)", panes: { separatorColor: "rgba(90,120,150,.16)", separatorHoverColor: "rgba(63,208,255,.3)" } },
      grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { color: "rgba(255,255,255,.28)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b232e" }, horzLine: { color: "rgba(255,255,255,.28)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b232e" } },
      rightPriceScale: { borderColor: "rgba(90,120,150,.2)", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "rgba(90,120,150,.2)", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      autoSize: true,
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, { upColor: COL.up, downColor: COL.down, borderUpColor: COL.up, borderDownColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down, priceLineVisible: true, priceLineColor: "rgba(150,190,225,.4)" }, 0);
    S.current.candle = candle;
    S.current.ema20 = chart.addSeries(LineSeries, { color: COL.ema20, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.ema50 = chart.addSeries(LineSeries, { color: COL.ema50, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.ema200 = chart.addSeries(LineSeries, { color: COL.ema200, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.vwap = chart.addSeries(LineSeries, { color: COL.vwap, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.bbU = chart.addSeries(LineSeries, { color: COL.bb, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.bbM = chart.addSeries(LineSeries, { color: COL.bbMid, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    S.current.bbL = chart.addSeries(LineSeries, { color: COL.bb, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    // Replay equity overlay — own left scale so it doesn't distort price.
    S.current.equity = chart.addSeries(LineSeries, { color: COL.equity, lineWidth: 2, priceScaleId: "eq", priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
    chart.priceScale("eq").applyOptions({ scaleMargins: { top: 0.05, bottom: 0.55 }, visible: false });

    // Oracle forecast cones — p05 / p50 / p95 projected forward (share the price scale, but do NOT
    // drive autoscale: the 5d p95 would otherwise stretch the y-range and compress the candles).
    const noScale = { autoscaleInfoProvider: () => null };
    S.current.coneHi = chart.addSeries(LineSeries, { color: "rgba(224,149,43,.45)", lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...noScale }, 0);
    S.current.coneMid = chart.addSeries(LineSeries, { color: "rgba(224,149,43,.9)", lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, ...noScale }, 0);
    S.current.coneLo = chart.addSeries(LineSeries, { color: "rgba(224,149,43,.45)", lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...noScale }, 0);

    // Volume pane (1)
    S.current.vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", priceLineVisible: false, lastValueVisible: false }, 1);
    // RSI pane (2)
    S.current.rsi = chart.addSeries(LineSeries, { color: COL.rsi, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, 2);
    // MACD pane (3)
    S.current.macdHist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3);
    S.current.macd = chart.addSeries(LineSeries, { color: COL.macd, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 3);
    S.current.signal = chart.addSeries(LineSeries, { color: COL.signal, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, 3);

    markersRef.current = createSeriesMarkers(candle, []);
    // Bollinger band-fill primitive (behind candles)
    try { const bb = new BBFillPrimitive(); (candle as unknown as { attachPrimitive: (p: unknown) => void }).attachPrimitive(bb); bbFillRef.current = bb; } catch { bbFillRef.current = null; }

    // Guides on RSI (30 / 70)
    S.current.rsi.createPriceLine({ price: 70, color: "rgba(244,85,107,.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    S.current.rsi.createPriceLine({ price: 30, color: "rgba(38,194,129,.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    // Crosshair-driven OHLC + indicator legend (the readout every pro chart has, top-left).
    chart.subscribeCrosshairMove((param) => {
      const cd = param.time ? (param.seriesData.get(candle) as { open: number; high: number; low: number; close: number } | undefined) : undefined;
      const val = (k: string) => {
        if (param.time) { const d = param.seriesData.get(S.current[k]) as { value?: number } | undefined; if (d && d.value != null) return d.value; }
        return lastVals.current[k];
      };
      renderLegend(cd || { open: lastVals.current.o, high: lastVals.current.h, low: lastVals.current.l, close: lastVals.current.c }, val);
    });

    return () => { if (replayTimer.current) clearInterval(replayTimer.current); chart.remove(); chartRef.current = null; S.current = {}; markersRef.current = null; };
  }, []);

  // Paint the floating legend from an OHLC bar + an indicator-value accessor.
  function renderLegend(bar: { open?: number; high?: number; low?: number; close?: number }, val: (k: string) => number | undefined) {
    const el = legendRef.current; if (!el) return;
    const f = (v?: number) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const up = (bar.close ?? 0) >= (bar.open ?? 0);
    const chg = bar.open ? ((bar.close! - bar.open) / bar.open) * 100 : 0;
    const cc = up ? COL.up : COL.down;
    const ind = (label: string, k: string, color: string) => `<span class="axcp-li" style="color:${color}">${label} <b>${f(val(k))}</b></span>`;
    el.innerHTML =
      `<span class="axcp-ohlc"><span style="color:${COL.text}">O</span><b>${f(bar.open)}</b> <span style="color:${COL.text}">H</span><b>${f(bar.high)}</b> <span style="color:${COL.text}">L</span><b>${f(bar.low)}</b> <span style="color:${COL.text}">C</span><b style="color:${cc}">${f(bar.close)}</b> <b style="color:${cc}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</b></span>` +
      (indicators.ema ? ind("EMA20", "ema20", COL.ema20) + ind("EMA50", "ema50", COL.ema50) + ind("EMA200", "ema200", COL.ema200) : "") +
      (indicators.vwap ? ind("VWAP", "vwap", "#e6edf5") : "") +
      (indicators.bb ? ind("BB", "bbM", COL.bbMid) : "");
  }

  // ── Push data + indicators whenever bars change (and not mid-replay) ──
  useEffect(() => {
    if (!chartRef.current || !S.current.candle) return;
    const clean = cleanBars(bars);
    dataRef.current = clean;
    recomputeIndicators();
    if (!replayActive) {
      renderUpTo(clean.length);
      // Frame the most recent window so candles have amplitude (not a thin ribbon across 300 bars).
      const ts = chartRef.current.timeScale();
      const n = clean.length;
      if (n > DEFAULT_VISIBLE) ts.setVisibleLogicalRange({ from: n - DEFAULT_VISIBLE, to: n + 6 });
      else ts.fitContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  // ── Indicator visibility toggles ──
  useEffect(() => {
    const s = S.current; if (!s.candle) return;
    const set = (k: string, v: boolean) => s[k]?.applyOptions({ visible: v });
    set("ema20", indicators.ema); set("ema50", indicators.ema); set("ema200", indicators.ema);
    set("vwap", indicators.vwap);
    set("bbU", indicators.bb); set("bbM", indicators.bb); set("bbL", indicators.bb);
    if (bbFillRef.current) { const all = dataRef.current; const I = indRef.current; bbFillRef.current.setPoints(indicators.bb && all.length && I.t.length === all.length ? all.map((_, i) => ({ time: I.t[i], up: I.bbU[i], lo: I.bbL[i] })).filter((p) => Number.isFinite(p.up) && Number.isFinite(p.lo)) : []); }
    set("vol", indicators.volume); set("rsi", indicators.rsi);
    set("macd", indicators.macd); set("signal", indicators.macd); set("macdHist", indicators.macd);
    // Resize panes: hide RSI/MACD/vol panes by collapsing when off
    const panes = chartRef.current?.panes() || [];
    try {
      if (panes[1]) panes[1].setHeight(indicators.volume ? 70 : 1);
      if (panes[2]) panes[2].setHeight(indicators.rsi ? 90 : 1);
      if (panes[3]) panes[3].setHeight(indicators.macd ? 90 : 1);
    } catch { /* panes may not exist yet */ }
  }, [indicators]);

  // ── Oracle forecast cones: project p05/p50/p95 forward from the last bar ──
  useEffect(() => {
    const s = S.current; if (!s.coneMid) return;
    const all = dataRef.current;
    if (!forecast || !forecast.length || !all.length || replayActive) { s.coneHi.setData([]); s.coneMid.setData([]); s.coneLo.setData([]); return; }
    const last = all[all.length - 1]; const t0 = toSec(last.t); const start = new Date(last.t).getTime();
    const order = ["1h", "5h", "12h", "1d", "5d"];
    const fmap = new Map(forecast.map((f) => [f.horizon, f]));
    const mid: { time: UTCTimestamp; value: number }[] = [{ time: t0, value: last.c }];
    const hi: { time: UTCTimestamp; value: number }[] = [{ time: t0, value: last.c }];
    const lo: { time: UTCTimestamp; value: number }[] = [{ time: t0, value: last.c }];
    const seen = new Set<number>([t0]);
    for (const k of order) {
      const f = fmap.get(k); if (!f) continue;
      const tSec = Math.floor((start + (FC_MS[k] || 0)) / 1000) as UTCTimestamp;
      if (seen.has(tSec)) continue; seen.add(tSec);
      mid.push({ time: tSec, value: f.p50 }); hi.push({ time: tSec, value: f.p95 }); lo.push({ time: tSec, value: f.p05 });
    }
    s.coneHi.setData(hi); s.coneMid.setData(mid); s.coneLo.setData(lo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecast, bars, replayActive]);

  // ── Compute + render everything up to index `n` (for replay reveal) ──
  function renderUpTo(n: number, replay?: ReplayResult) {
    const s = S.current; const all = dataRef.current; if (!all.length || !s.candle) return;
    const I = indRef.current; if (I.t.length !== all.length) recomputeIndicators();
    const sub = all.slice(0, n);
    const t = I.t;
    const line = (arr: number[]) => sub.map((_, i) => (Number.isFinite(arr[i]) ? { time: t[i], value: arr[i] } : null)).filter(Boolean) as { time: UTCTimestamp; value: number }[];

    s.candle.setData(sub.map((b) => ({ time: toSec(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));

    const e20 = I.e20, e50 = I.e50, e200 = I.e200, bb = { mid: I.bbM };
    s.ema20.setData(line(e20)); s.ema50.setData(line(e50)); s.ema200.setData(line(e200));
    s.vwap.setData(line(I.vwap));
    s.bbU.setData(line(I.bbU)); s.bbM.setData(line(I.bbM)); s.bbL.setData(line(I.bbL));
    if (bbFillRef.current) bbFillRef.current.setPoints(indicators.bb ? sub.map((_, i) => ({ time: t[i], up: I.bbU[i], lo: I.bbL[i] })).filter((p) => Number.isFinite(p.up) && Number.isFinite(p.lo)) : []);

    s.vol.setData(sub.map((b) => ({ time: toSec(b.t), value: b.v || 0, color: b.c >= b.o ? "rgba(38,194,129,.5)" : "rgba(244,85,107,.5)" })));

    s.rsi.setData(line(I.rsi));
    const m = { hist: I.hist };
    s.macd.setData(line(I.macd)); s.signal.setData(line(I.signal));
    s.macdHist.setData(sub.map((_, i) => (Number.isFinite(m.hist[i]) ? { time: t[i], value: m.hist[i], color: m.hist[i] >= 0 ? "rgba(38,194,129,.55)" : "rgba(244,85,107,.55)" } : null)).filter(Boolean) as { time: UTCTimestamp; value: number; color: string }[]);

    // Replay overlays
    if (replay) {
      s.equity.setData(replay.equity.slice(0, n).map((v, i) => ({ time: t[i], value: v })));
      chartRef.current?.priceScale("eq").applyOptions({ visible: true });
      const mk: SeriesMarker<Time>[] = replay.trades.filter((tr) => tr.i < n).map((tr) => ({
        time: tr.time as UTCTimestamp, position: tr.side === "buy" ? "belowBar" : "aboveBar",
        color: tr.side === "buy" ? COL.up : COL.down, shape: tr.side === "buy" ? "arrowUp" : "arrowDown",
        text: tr.kind === "entry" ? (tr.side === "buy" ? "▲ LONG" : "▼ SHORT") : `exit ${tr.pnlPct != null ? (tr.pnlPct >= 0 ? "+" : "") + tr.pnlPct.toFixed(1) + "%" : ""}`,
      }));
      markersRef.current?.setMarkers(mk);
    } else {
      s.equity.setData([]);
      chartRef.current?.priceScale("eq").applyOptions({ visible: false });
      markersRef.current?.setMarkers([]);
    }

    // Cache the latest bar's values so the legend has something to show when not hovering.
    const li = n - 1; const lastFin = (arr: number[], from: number) => { for (let i = from; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i]; return NaN; };
    const lb = all[li];
    if (lb) {
      lastVals.current = { o: lb.o, h: lb.h, l: lb.l, c: lb.c, ema20: lastFin(e20, li), ema50: lastFin(e50, li), ema200: lastFin(e200, li), vwap: lastFin(I.vwap, li), bbM: lastFin(bb.mid, li) };
      renderLegend({ open: lb.o, high: lb.h, low: lb.l, close: lb.c }, (k) => lastVals.current[k]);
    }
  }

  // ── Replay engine ──
  useEffect(() => {
    if (replayTimer.current) { clearInterval(replayTimer.current); replayTimer.current = null; }
    const all = dataRef.current;
    if (!replayActive || all.length < 30) {
      if (!replayActive) { renderUpTo(all.length); chartRef.current?.timeScale().fitContent(); onReplayStats?.(null); onReplayProgress?.(0, null); }
      return;
    }
    const strat = getStrategy(replayStrategy);
    const signal = strat.signal(all);
    const replay = runReplay(all, signal);
    onReplayStats?.(replay);
    let cursor = Math.max(30, Math.floor(all.length * 0.15));
    const step = () => {
      cursor = Math.min(all.length, cursor + 1);
      renderUpTo(cursor, replay);
      const t = dataRef.current[cursor - 1] ? toSec(dataRef.current[cursor - 1].t) : null;
      onReplayProgress?.((cursor / all.length) * 100, t);
      if (cursor >= all.length) { if (replayTimer.current) clearInterval(replayTimer.current); replayTimer.current = null; }
    };
    renderUpTo(cursor, replay);
    replayTimer.current = window.setInterval(step, Math.max(30, 1000 / Math.max(1, replaySpeed)));
    return () => { if (replayTimer.current) clearInterval(replayTimer.current); replayTimer.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive, replaySpeed, replayStrategy]);

  return (
    <div className="axcp-wrap" style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 80% at 50% 0%, rgba(20,70,110,.10), transparent 60%), linear-gradient(180deg, #04101a 0%, #020a12 100%)" }}>
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
      <div ref={legendRef} className="axcp-legend" />
      <style>{`
        .axcp-legend { position:absolute; top:6px; left:10px; z-index:3; display:flex; flex-wrap:wrap; gap:10px; align-items:baseline; font-family:var(--ax-mono,ui-monospace); font-size:11px; pointer-events:none; text-shadow:0 1px 3px rgba(0,0,0,.9); }
        .axcp-legend .axcp-ohlc { display:inline-flex; gap:5px; align-items:baseline; color:#93a7bd; }
        .axcp-legend .axcp-ohlc b { color:#e6edf5; font-weight:600; }
        .axcp-legend .axcp-li { font-size:10.5px; opacity:.95; }
        .axcp-legend .axcp-li b { font-weight:600; }
      `}</style>
    </div>
  );
}
