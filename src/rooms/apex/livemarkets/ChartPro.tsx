import { useEffect, useRef } from "react";
import {
  createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, createSeriesMarkers,
  ColorType, CrosshairMode, LineStyle, PriceScaleMode,
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
  series: ISeriesApi<any> | null = null;
  private req: (() => void) | null = null;
  private pv = new BBFillPaneView(this);
  attached(p: any) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() { this.chart = null; this.series = null; this.req = null; }
  rebind(c: IChartApi, s: ISeriesApi<any>) { this.chart = c; this.series = s; }
  setPoints(pts: BBPt[]) { this.points = pts; this.req?.(); }
  updateAllViews() { /* points are pushed imperatively */ }
  paneViews() { return [this.pv]; }
}

// ══════════════════════════════════════════════════════════════════════════════
// DRAWING TOOLS — TradingView-style chart annotations built on v5 series primitives.
// v5 ships no drawing tools; the only custom-draw hook is a series primitive whose
// renderer paints on the chart canvas. Every drawing stores its anchors in DATA space
// ({time, price}) so it survives pan / zoom / scale-mode / chart-type changes.
// ══════════════════════════════════════════════════════════════════════════════
export type ChartKind = "candles" | "bars" | "line" | "area" | "heikin";
export type DrawKind = "trend" | "hline" | "vline" | "ray" | "rect" | "fib" | "measure" | "text";
export interface DrawApi { clearAll: () => void; undo: () => void; deleteSelected: () => void; count: () => number; resetView: () => void; zoomIn: () => void; zoomOut: () => void; scrollRealtime: () => void }

type Anchor = { time: UTCTimestamp; price: number };
interface DrawStyle { color: string; width: number; dash: number[] }
interface DrawData { id: string; kind: DrawKind; points: Anchor[]; style: DrawStyle; text?: string }
// how many clicks each tool needs to finalize
const NEED: Record<DrawKind, number> = { hline: 1, vline: 1, text: 1, trend: 2, ray: 2, rect: 2, fib: 2, measure: 2 };
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#8892a3", "#ef5350", "#e0952b", "#4caf50", "#26a69a", "#4d9fd1", "#9a86d4"];
const DRAW_ACCENT = "#2ec7ff";

const dist2seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy; return Math.hypot(px - cx, py - cy);
};

// A single primitive that can render ANY drawing kind (kept generic to avoid one class per tool).
class DrawPrimitive {
  chart: IChartApi | null = null;
  series: ISeriesApi<any> | null = null;
  private req: (() => void) | null = null;
  selected = false;
  private bbox: { x0: number; y0: number; x1: number; y1: number } | null = null; // last-drawn screen bbox (for text/rect hit)
  private pv: any;
  constructor(public d: DrawData) {
    const self = this;
    this.pv = {
      zOrder: () => "normal" as const,
      update: () => {},
      renderer: () => ({ draw: (t: any) => { try { self._draw(t); } catch { /* ignore bad frame */ } } }),
    };
  }
  attached(p: any) { this.chart = p.chart; this.series = p.series; this.req = p.requestUpdate; }
  detached() { this.req = null; }
  rebind(c: IChartApi, s: ISeriesApi<any>) { this.chart = c; this.series = s; }
  updateAllViews() {}
  paneViews() { return [this.pv]; }
  requestUpdate() { this.req?.(); }
  private X(t: UTCTimestamp) { return this.chart!.timeScale().timeToCoordinate(t); }
  private Y(p: number) { return this.series!.priceToCoordinate(p); }
  private pt(a: Anchor): { x: number; y: number } | null { const x = this.X(a.time), y = this.Y(a.price); return x == null || y == null ? null : { x, y }; }

  private _draw(target: any) {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace((scope: any) => {
      const ctx = scope.context as CanvasRenderingContext2D;
      const W = scope.mediaSize.width, H = scope.mediaSize.height;
      const { kind, points: P, style } = this.d;
      ctx.save();
      ctx.lineWidth = style.width; ctx.strokeStyle = style.color; ctx.setLineDash(style.dash);
      ctx.font = "10px ui-monospace, monospace";
      this.bbox = null;
      const handles: [number, number][] = [];

      if (kind === "hline" && P[0]) {
        const y = this.Y(P[0].price); if (y == null) { ctx.restore(); return; }
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = style.color; ctx.textBaseline = "bottom";
        ctx.fillText(P[0].price.toFixed(2), W - 52, y - 2);
        handles.push([W - 10, y]);
      } else if (kind === "vline" && P[0]) {
        const x = this.X(P[0].time); if (x == null) { ctx.restore(); return; }
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        handles.push([x, H - 10]);
      } else if (kind === "trend" && P[0] && P[1]) {
        const a = this.pt(P[0]), b = this.pt(P[1]); if (!a || !b) { ctx.restore(); return; }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        handles.push([a.x, a.y], [b.x, b.y]);
      } else if (kind === "ray" && P[0] && P[1]) {
        const a = this.pt(P[0]), b = this.pt(P[1]); if (!a || !b) { ctx.restore(); return; }
        const K = (W + H) * 2 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        const e = { x: a.x + (b.x - a.x) * K, y: a.y + (b.y - a.y) * K };
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        handles.push([a.x, a.y], [b.x, b.y]);
      } else if (kind === "rect" && P[0] && P[1]) {
        const a = this.pt(P[0]), b = this.pt(P[1]); if (!a || !b) { ctx.restore(); return; }
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        ctx.globalAlpha = 0.10; ctx.fillStyle = style.color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.strokeRect(x, y, w, h);
        this.bbox = { x0: x, y0: y, x1: x + w, y1: y + h };
        handles.push([a.x, a.y], [b.x, b.y]);
      } else if (kind === "fib" && P[0] && P[1]) {
        const a = this.pt(P[0]), b = this.pt(P[1]); if (!a || !b) { ctx.restore(); return; }
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        ctx.setLineDash([]); ctx.textBaseline = "middle";
        let prevY: number | null = null;
        FIB_LEVELS.forEach((L, i) => {
          const price = P[0].price + (P[1].price - P[0].price) * L; const y = this.Y(price);
          if (y == null) return;
          if (prevY != null) { ctx.globalAlpha = 0.05; ctx.fillStyle = FIB_COLORS[i]; ctx.fillRect(x0, Math.min(prevY, y), x1 - x0, Math.abs(y - prevY)); ctx.globalAlpha = 1; }
          prevY = y;
          ctx.strokeStyle = FIB_COLORS[i]; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          ctx.fillStyle = FIB_COLORS[i]; ctx.fillText(`${(L * 100).toFixed(1)}%  ${price.toFixed(2)}`, x1 + 4, y);
        });
        this.bbox = { x0, y0: Math.min(a.y, b.y), x1, y1: Math.max(a.y, b.y) };
        handles.push([a.x, a.y], [b.x, b.y]);
      } else if (kind === "measure" && P[0] && P[1]) {
        const a = this.pt(P[0]), b = this.pt(P[1]); if (!a || !b) { ctx.restore(); return; }
        const isUp = P[1].price >= P[0].price; const col = isUp ? "#26a69a" : "#ef5350";
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        ctx.globalAlpha = 0.12; ctx.fillStyle = col; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
        ctx.strokeStyle = col; ctx.setLineDash([4, 3]); ctx.strokeRect(x, y, w, h);
        const dP = P[1].price - P[0].price, dPct = P[0].price ? (dP / P[0].price) * 100 : 0;
        const ts = this.chart!.timeScale();
        const l0 = ts.coordinateToLogical(a.x), l1 = ts.coordinateToLogical(b.x);
        const nb = l0 != null && l1 != null ? Math.round(Math.abs(l1 - l0)) : 0;
        const label = `${dP >= 0 ? "+" : ""}${dP.toFixed(2)}  ${dPct >= 0 ? "+" : ""}${dPct.toFixed(2)}%   ${nb} bars`;
        ctx.setLineDash([]); ctx.font = "700 11px ui-monospace, monospace";
        const tw = ctx.measureText(label).width + 14, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        ctx.fillStyle = col; ctx.fillRect(cx - tw / 2, cy - 9, tw, 18);
        ctx.fillStyle = "#04121a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy); ctx.textAlign = "left";
        this.bbox = { x0: x, y0: y, x1: x + w, y1: y + h };
        handles.push([a.x, a.y], [b.x, b.y]);
      } else if (kind === "text" && P[0]) {
        const a = this.pt(P[0]); if (!a) { ctx.restore(); return; }
        const txt = this.d.text || "Text";
        ctx.setLineDash([]); ctx.font = "600 12px ui-monospace, monospace"; ctx.textBaseline = "top";
        const tw = ctx.measureText(txt).width;
        ctx.globalAlpha = 0.85; ctx.fillStyle = "rgba(6,16,26,.85)"; ctx.fillRect(a.x, a.y, tw + 12, 20); ctx.globalAlpha = 1;
        ctx.strokeStyle = style.color; ctx.lineWidth = 1; ctx.strokeRect(a.x, a.y, tw + 12, 20);
        ctx.fillStyle = "#e6edf5"; ctx.fillText(txt, a.x + 6, a.y + 4);
        this.bbox = { x0: a.x, y0: a.y, x1: a.x + tw + 12, y1: a.y + 20 };
        handles.push([a.x, a.y]);
      }

      // selection handles
      if (this.selected) {
        ctx.setLineDash([]);
        for (const [hx, hy] of handles) {
          ctx.fillStyle = "#fff"; ctx.strokeStyle = DRAW_ACCENT; ctx.lineWidth = 1.5;
          ctx.fillRect(hx - 3.5, hy - 3.5, 7, 7); ctx.strokeRect(hx - 3.5, hy - 3.5, 7, 7);
        }
      }
      ctx.restore();
    });
  }

  // hit test in media coords. returns {anchor} if near a specific anchor handle, or {body:true}, or null.
  pick(mx: number, my: number): { anchor?: number; body?: boolean } | null {
    if (!this.chart || !this.series) return null;
    const { kind, points: P } = this.d;
    const pts = P.map((a) => this.pt(a));
    // anchor handles first (for precise drag)
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; if (p && Math.hypot(mx - p.x, my - p.y) < 8) return { anchor: i }; }
    if (kind === "hline" && pts[0]) { if (Math.abs(my - pts[0].y) < 6) return { body: true }; }
    else if (kind === "vline" && pts[0]) { if (Math.abs(mx - pts[0].x) < 6) return { body: true }; }
    else if ((kind === "trend" || kind === "ray") && pts[0] && pts[1]) { if (dist2seg(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < 6) return { body: true }; }
    else if ((kind === "rect" || kind === "fib" || kind === "measure" || kind === "text") && this.bbox) {
      const b = this.bbox; if (mx >= b.x0 - 4 && mx <= b.x1 + 4 && my >= b.y0 - 4 && my <= b.y1 + 4) return { body: true };
    }
    return null;
  }
}

// The manager: owns the tool state machine (idle → placing → editing), the drawings list,
// selection + drag, and magnet snap. Subscribes to chart click/crosshair + native pointer drag.
class DrawingManager {
  private tool: DrawKind | null = null;
  private magnet = false;
  private pts: Anchor[] = [];
  private preview: DrawPrimitive | null = null;
  private drawings: DrawPrimitive[] = [];
  private selected: DrawPrimitive | null = null;
  private drag: { d: DrawPrimitive; anchor: number | null; lastX: number; lastY: number } | null = null;
  private idc = 0;
  constructor(private chart: IChartApi, private series: ISeriesApi<any>, private el: HTMLElement, private onDone: () => void, private onCount: () => void) {
    chart.subscribeClick(this.onClick);
    chart.subscribeCrosshairMove(this.onMove);
    el.addEventListener("pointerdown", this.onDown, true);
  }
  setSeries(s: ISeriesApi<any>) {
    for (const d of this.drawings) { try { (this.series as any).detachPrimitive(d); } catch { /* */ } }
    if (this.preview) { try { (this.series as any).detachPrimitive(this.preview); } catch { /* */ } }
    this.series = s;
    for (const d of this.drawings) { try { d.rebind(this.chart, s); (s as any).attachPrimitive(d); } catch { /* */ } }
    if (this.preview) { try { this.preview.rebind(this.chart, s); (s as any).attachPrimitive(this.preview); } catch { /* */ } }
  }
  setMagnet(m: boolean) { this.magnet = m; }
  activate(tool: DrawKind | null) {
    this.tool = tool; this.pts = []; this.clearPreview();
    if (tool) this.select(null); // entering a draw tool clears selection
  }
  private clearPreview() { if (this.preview) { try { (this.series as any).detachPrimitive(this.preview); } catch { /* */ } this.preview = null; } }
  private style(): DrawStyle { return { color: DRAW_ACCENT, width: 1.5, dash: [] }; }
  private snap(param: any, price: number): number {
    if (!this.magnet) return price;
    const bar = param.seriesData?.get(this.series) as { open?: number; high?: number; low?: number; close?: number } | undefined;
    if (!bar) return price;
    const cands = [bar.open, bar.high, bar.low, bar.close].filter((v): v is number => v != null);
    if (!cands.length) return price;
    return cands.reduce((a, b) => (Math.abs(b - price) < Math.abs(a - price) ? b : a));
  }
  private anchor(param: any): Anchor | null {
    if (!param.point) return null;
    const raw = this.series.coordinateToPrice(param.point.y);
    const time = (param.time ?? this.chart.timeScale().coordinateToTime(param.point.x)) as UTCTimestamp | null;
    if (raw == null || time == null) return null;
    return { time, price: this.snap(param, raw) };
  }
  private onClick = (param: any) => {
    if (!this.tool) return; // selection handled by pointerdown in cursor mode
    const a = this.anchor(param); if (!a) return;
    if (this.tool === "text") {
      const txt = typeof window !== "undefined" ? window.prompt("Text label:", "") : "";
      if (txt == null) { this.onDone(); return; }
      this.finalize([a], txt);
      return;
    }
    this.pts.push(a);
    const need = NEED[this.tool];
    if (this.pts.length === 1 && need === 2) {
      this.preview = new DrawPrimitive({ id: "prev", kind: this.tool, points: [a, a], style: this.style() });
      try { (this.series as any).attachPrimitive(this.preview); } catch { /* */ }
    }
    if (this.pts.length >= need) this.finalize(this.pts.slice());
  };
  private onMove = (param: any) => {
    if (this.preview && this.tool) { const a = this.anchor(param); if (a) { this.preview.d.points[1] = a; this.preview.requestUpdate(); } }
  };
  private finalize(points: Anchor[], text?: string) {
    this.clearPreview();
    const d = new DrawPrimitive({ id: `d${++this.idc}`, kind: this.tool!, points, style: this.style(), text });
    try { (this.series as any).attachPrimitive(d); } catch { /* */ }
    this.drawings.push(d);
    this.tool = null; this.pts = [];
    this.onDone();   // return the toolbar to the cursor
    this.onCount();
  }
  private select(d: DrawPrimitive | null) {
    if (this.selected === d) return;
    if (this.selected) { this.selected.selected = false; this.selected.requestUpdate(); }
    this.selected = d;
    if (d) { d.selected = true; d.requestUpdate(); }
  }
  private hit(mx: number, my: number): { d: DrawPrimitive; anchor: number | null } | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) { const h = this.drawings[i].pick(mx, my); if (h) return { d: this.drawings[i], anchor: h.anchor ?? null }; }
    return null;
  }
  // native drag — only in cursor mode; blocks the chart pan when a drawing is grabbed.
  private onDown = (e: PointerEvent) => {
    if (this.tool) return; // placing mode uses clicks, not drag
    const rect = this.el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const h = this.hit(mx, my);
    if (!h) { this.select(null); return; } // let the chart pan
    e.preventDefault(); e.stopPropagation();
    this.select(h.d);
    this.drag = { d: h.d, anchor: h.anchor, lastX: mx, lastY: my };
    window.addEventListener("pointermove", this.onDragMove, true);
    window.addEventListener("pointerup", this.onUp, true);
  };
  private onDragMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const rect = this.el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const ts = this.chart.timeScale();
    const toAnchor = (x: number, y: number): Anchor | null => {
      const price = this.series.coordinateToPrice(y), time = ts.coordinateToTime(x) as UTCTimestamp | null;
      return price == null || time == null ? null : { time, price };
    };
    const { d, anchor } = this.drag;
    if (anchor != null) {
      const a = toAnchor(mx, my); if (a) { d.d.points[anchor] = a; d.requestUpdate(); }
    } else {
      // move whole shape: translate every anchor by the pixel delta
      const dx = mx - this.drag.lastX, dy = my - this.drag.lastY;
      d.d.points = d.d.points.map((p) => {
        const px = ts.timeToCoordinate(p.time), py = this.series.priceToCoordinate(p.price);
        if (px == null || py == null) return p; return toAnchor(px + dx, py + dy) || p;
      });
      d.requestUpdate();
    }
    this.drag.lastX = mx; this.drag.lastY = my;
  };
  private onUp = () => {
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
  };
  deleteSelected() { if (!this.selected) return; this.remove(this.selected); this.selected = null; }
  undo() { const d = this.drawings[this.drawings.length - 1]; if (d) this.remove(d); }
  clearAll() { for (const d of [...this.drawings]) this.remove(d); this.selected = null; }
  private remove(d: DrawPrimitive) { try { (this.series as any).detachPrimitive(d); } catch { /* */ } this.drawings = this.drawings.filter((x) => x !== d); this.onCount(); }
  count() { return this.drawings.length; }
  destroy() {
    try { this.chart.unsubscribeClick(this.onClick); this.chart.unsubscribeCrosshairMove(this.onMove); } catch { /* */ }
    this.el.removeEventListener("pointerdown", this.onDown, true);
    window.removeEventListener("pointermove", this.onDragMove, true);
    window.removeEventListener("pointerup", this.onUp, true);
    this.clearAll(); this.clearPreview();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// APEX · Live Markets — the professional chart. TradingView-grade candles on real
// OHLCV, with EMA 20/50/200, session VWAP, Bollinger Bands, a volume pane, RSI +
// MACD study panes, a full drawing-tool suite, chart-type switching and scale controls.
// Also drives STRATEGY REPLAY. Built on lightweight-charts v5 (TradingView's OSS engine).

export interface Indicators { ema: boolean; bb: boolean; vwap: boolean; volume: boolean; rsi: boolean; macd: boolean }

export interface ForecastPoint { horizon: string; p05: number; p50: number; p95: number }
interface Props {
  bars: Bar[];
  up: boolean; // day direction, for candle theming accents
  indicators: Indicators;
  chartType: ChartKind;
  showForecast: boolean;
  activeTool: DrawKind | null;
  magnet: boolean;
  scaleMode: "normal" | "log" | "percent";
  replayActive: boolean;
  replaySpeed: number; // bars per second
  replayStrategy: StrategyId;
  forecast?: ForecastPoint[] | null; // Oracle cones projected into the future
  onReplayProgress?: (pct: number, barTime: number | null) => void;
  onReplayStats?: (r: ReplayResult | null) => void;
  onToolDone?: () => void;            // fired after a drawing finalizes → parent resets the tool
  onDrawCount?: (n: number) => void;  // number of drawings on the chart
  drawApiRef?: { current: DrawApi | null };
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

// Heikin-Ashi transform — smoothed candles derived from raw OHLC.
function heikin(sub: Bar[]): { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] {
  const out: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
  let po = NaN, pc = NaN;
  for (const b of sub) {
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = Number.isNaN(po) ? (b.o + b.c) / 2 : (po + pc) / 2;
    out.push({ time: toSec(b.t), open: o, high: Math.max(b.h, o, c), low: Math.min(b.l, o, c), close: c });
    po = o; pc = c;
  }
  return out;
}

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

export function ChartPro({ bars, up, indicators, chartType, showForecast, activeTool, magnet, scaleMode, replayActive, replaySpeed, replayStrategy, forecast, onReplayProgress, onReplayStats, onToolDone, onDrawCount, drawApiRef }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const S = useRef<Record<string, ISeriesApi<any>>>({});
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const bbFillRef = useRef<BBFillPrimitive | null>(null);
  const drawMgr = useRef<DrawingManager | null>(null);
  const mainKind = useRef<ChartKind>(chartType);
  const framedKey = useRef<number>(0);   // first-bar timestamp we last auto-framed on (new symbol/tf → reframe; live append → keep view)
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

  // Build the main price series for the active chart type at pane 0.
  const addMainSeries = (chart: IChartApi, kind: ChartKind): ISeriesApi<any> => {
    switch (kind) {
      case "bars":
        return chart.addSeries(BarSeries, { upColor: COL.up, downColor: COL.down, thinBars: false }, 0);
      case "line":
        return chart.addSeries(LineSeries, { color: "#5ec8ff", lineWidth: 2, priceLineVisible: true, priceLineColor: "rgba(150,190,225,.4)" }, 0);
      case "area":
        return chart.addSeries(AreaSeries, { lineColor: "#5ec8ff", topColor: "rgba(94,200,255,.28)", bottomColor: "rgba(94,200,255,.02)", lineWidth: 2, priceLineVisible: true, priceLineColor: "rgba(150,190,225,.4)" }, 0);
      case "candles":
      case "heikin":
      default:
        return chart.addSeries(CandlestickSeries, { upColor: COL.up, downColor: COL.down, borderUpColor: COL.up, borderDownColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down, priceLineVisible: true, priceLineColor: "rgba(150,190,225,.4)" }, 0);
    }
  };
  // Set the main series' data in the shape its type wants.
  const setMainData = (sub: Bar[]) => {
    const s = S.current.candle; const k = mainKind.current;
    if (k === "line" || k === "area") s.setData(sub.map((b) => ({ time: toSec(b.t), value: b.c })));
    else if (k === "heikin") s.setData(heikin(sub));
    else s.setData(sub.map((b) => ({ time: toSec(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
  };

  // ── Build the chart + all series ONCE ──
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COL.text, fontSize: 10, fontFamily: "var(--ax-mono, ui-monospace)", panes: { separatorColor: "rgba(90,120,150,.16)", separatorHoverColor: "rgba(63,208,255,.3)" } },
      grid: { vertLines: { color: COL.grid }, horzLines: { color: COL.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "rgba(255,255,255,.28)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b232e" }, horzLine: { color: "rgba(255,255,255,.28)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1b232e" } },
      rightPriceScale: { borderColor: "rgba(90,120,150,.2)", scaleMargins: { top: 0.12, bottom: 0.12 }, autoScale: true },
      timeScale: { borderColor: "rgba(90,120,150,.2)", timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 2 },
      // Full mouse control: wheel/drag to pan time, wheel/pinch + DRAG THE PRICE AXIS to scale price vertically.
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
      autoSize: true,
    });
    chartRef.current = chart;

    mainKind.current = chartType;
    const candle = addMainSeries(chart, chartType);
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
    try { const bb = new BBFillPrimitive(); (candle as any).attachPrimitive(bb); bbFillRef.current = bb; } catch { bbFillRef.current = null; }

    // Guides on RSI (30 / 70)
    S.current.rsi.createPriceLine({ price: 70, color: "rgba(244,85,107,.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    S.current.rsi.createPriceLine({ price: 30, color: "rgba(38,194,129,.5)", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    // Crosshair-driven OHLC + indicator legend (the readout every pro chart has, top-left).
    chart.subscribeCrosshairMove((param) => {
      const raw = param.time ? (param.seriesData.get(candle) as any) : undefined;
      const cd = raw ? (raw.open != null ? raw : { open: raw.value, high: raw.value, low: raw.value, close: raw.value }) : undefined;
      const val = (k: string) => {
        if (param.time) { const d = param.seriesData.get(S.current[k]) as { value?: number } | undefined; if (d && d.value != null) return d.value; }
        return lastVals.current[k];
      };
      renderLegend(cd || { open: lastVals.current.o, high: lastVals.current.h, low: lastVals.current.l, close: lastVals.current.c }, val);
    });

    // Reset view → reframe the recent window + re-enable price autoscale (what FIT / double-click do).
    const resetView = () => {
      const c = chartRef.current; if (!c) return;
      try {
        const ts = c.timeScale(); const n = dataRef.current.length;
        if (n > DEFAULT_VISIBLE) ts.setVisibleLogicalRange({ from: n - DEFAULT_VISIBLE, to: n + 6 });
        else ts.fitContent();
        c.priceScale("right").applyOptions({ autoScale: true });
      } catch { /* */ }
    };
    // Zoom by shrinking/expanding the visible logical range about its centre (explicit +/- buttons).
    const zoomBy = (factor: number) => {
      const c = chartRef.current; if (!c) return;
      try { const ts = c.timeScale(); const r = ts.getVisibleLogicalRange(); if (!r) return; const mid = (r.from + r.to) / 2; const half = Math.max(2, ((r.to - r.from) / 2) * factor); ts.setVisibleLogicalRange({ from: mid - half, to: mid + half }); } catch { /* */ }
    };
    const scrollRealtime = () => { try { chartRef.current?.timeScale().scrollToRealTime(); } catch { /* */ } };
    // Double-click the price axis already resets it (axisDoubleClickReset); dbl-click the body → full reset.
    el.addEventListener("dblclick", resetView);

    // Drawing manager (tool state machine + selection + drag). Bound to the price series + container.
    drawMgr.current = new DrawingManager(chart, candle, el, () => onToolDone?.(), () => onDrawCount?.(drawMgr.current?.count() ?? 0));
    if (drawApiRef) drawApiRef.current = { clearAll: () => drawMgr.current?.clearAll(), undo: () => drawMgr.current?.undo(), deleteSelected: () => drawMgr.current?.deleteSelected(), count: () => drawMgr.current?.count() ?? 0, resetView, zoomIn: () => zoomBy(0.68), zoomOut: () => zoomBy(1.45), scrollRealtime };

    // Delete removes the selected drawing; Escape cancels the active tool.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") drawMgr.current?.deleteSelected();
      else if (e.key === "Escape") { drawMgr.current?.activate(null); onToolDone?.(); }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      if (replayTimer.current) clearInterval(replayTimer.current);
      el.removeEventListener("dblclick", resetView); window.removeEventListener("keydown", onKey);
      drawMgr.current?.destroy(); drawMgr.current = null;
      if (drawApiRef) drawApiRef.current = null;
      chart.remove(); chartRef.current = null; S.current = {}; markersRef.current = null; bbFillRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paint the floating legend from an OHLC bar + an indicator-value accessor.
  function renderLegend(bar: { open?: number; high?: number; low?: number; close?: number }, val: (k: string) => number | undefined) {
    const el = legendRef.current; if (!el) return;
    const f = (v?: number) => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const isUp = (bar.close ?? 0) >= (bar.open ?? 0);
    const chg = bar.open ? ((bar.close! - bar.open) / bar.open) * 100 : 0;
    const cc = isUp ? COL.up : COL.down;
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
      // Frame the recent window ONLY on a genuinely new dataset (symbol/timeframe change → new first bar).
      // On live appends / re-polls of the same series, DON'T touch the view — otherwise every poll yanks
      // the user's pan/zoom back to the default frame (the "can't move around the chart" bug).
      const firstT = clean.length ? toSec(clean[0].t) : 0;
      if (framedKey.current !== firstT) {
        framedKey.current = firstT;
        const ts = chartRef.current.timeScale();
        const n = clean.length;
        if (n > DEFAULT_VISIBLE) ts.setVisibleLogicalRange({ from: n - DEFAULT_VISIBLE, to: n + 6 });
        else ts.fitContent();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars]);

  // ── Chart-type swap: rebuild ONLY the main series; overlays / panes / scales / drawings survive ──
  useEffect(() => {
    const chart = chartRef.current; const old = S.current.candle; if (!chart || !old || mainKind.current === chartType) return;
    if (bbFillRef.current) { try { (old as any).detachPrimitive(bbFillRef.current); } catch { /* */ } }
    try { chart.removeSeries(old); } catch { /* */ }
    mainKind.current = chartType;
    const next = addMainSeries(chart, chartType);
    S.current.candle = next;
    markersRef.current = createSeriesMarkers(next, []);
    if (bbFillRef.current) { try { bbFillRef.current.rebind(chart, next); (next as any).attachPrimitive(bbFillRef.current); } catch { /* */ } }
    drawMgr.current?.setSeries(next);
    // repaint everything (renderUpTo re-sets the main series in the new shape)
    renderUpTo(dataRef.current.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // ── Price scale mode: normal / logarithmic / percent ──
  useEffect(() => {
    const mode = scaleMode === "log" ? PriceScaleMode.Logarithmic : scaleMode === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal;
    chartRef.current?.priceScale("right").applyOptions({ mode });
  }, [scaleMode]);

  // ── Drawing tool + magnet wiring (magnet crosshair also engages while a tool is active) ──
  useEffect(() => { drawMgr.current?.activate(activeTool); chartRef.current?.applyOptions({ crosshair: { mode: activeTool || magnet ? CrosshairMode.Magnet : CrosshairMode.Normal } }); }, [activeTool, magnet]);
  useEffect(() => { drawMgr.current?.setMagnet(magnet); }, [magnet]);

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

  // ── Oracle forecast cones: project p05/p50/p95 forward from the last bar (gated by showForecast) ──
  useEffect(() => {
    const s = S.current; if (!s.coneMid) return;
    const all = dataRef.current;
    if (!showForecast || !forecast || !forecast.length || !all.length || replayActive) { s.coneHi.setData([]); s.coneMid.setData([]); s.coneLo.setData([]); return; }
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
  }, [forecast, bars, replayActive, showForecast]);

  // ── Compute + render everything up to index `n` (for replay reveal) ──
  function renderUpTo(n: number, replay?: ReplayResult) {
    const s = S.current; const all = dataRef.current; if (!all.length || !s.candle) return;
    const I = indRef.current; if (I.t.length !== all.length) recomputeIndicators();
    const sub = all.slice(0, n);
    const t = I.t;
    const line = (arr: number[]) => sub.map((_, i) => (Number.isFinite(arr[i]) ? { time: t[i], value: arr[i] } : null)).filter(Boolean) as { time: UTCTimestamp; value: number }[];

    setMainData(sub);

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
      const tt = dataRef.current[cursor - 1] ? toSec(dataRef.current[cursor - 1].t) : null;
      onReplayProgress?.((cursor / all.length) * 100, tt);
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
