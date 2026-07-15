import { useEffect, useRef, useState } from "react";
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation } from "d3-force";
import { hierarchy, treemap as d3treemap } from "d3-hierarchy";
import { streamPost } from "../../api";
import { useApexData, ApexDataContext, useApexLive, useMicro, fetchQuote, fetchBars, fetchNewsImpact, fetchFundamentals, fetchInsider, fetchBrief, fetchVol, fetchMonteCarlo, fetchRiskLab, type Bar, type Fundamentals, type Insider, type Brief, type Story, type VolReport, type MCReport, type RiskLab } from "./apex-data";
import { DossierChart } from "./DossierChart";
import { THEMES, DENSITIES, LS_THEME, LS_DENSITY, loadPref, savePref, type ThemeId, type Density } from "./apex-theme";
import { useFlash, stagger, reduceMotion } from "./apex-motion";
import { Info } from "./apex-tooltip";
import { useHotkeys, HOTKEY_HELP } from "./useHotkeys";
import { usePersonal, alertText, type AlertKind } from "./apex-personal";
import { sfx, toggleMute, isMuted } from "./apex-sound";
import { ForgeView } from "./forge/ForgeView";
// The 9 tabs (ported from a collaborator's build), backed by our native APEX routes + engine.
import { LiveMarketsView } from "./livemarkets/LiveMarketsView";
import { PortfolioView } from "./portfolio/PortfolioView";
import { PaperTradingView } from "./paper/PaperTradingView";
import { BacktestView } from "./backtest/BacktestView";
import { TradingBotsView } from "./bots/TradingBotsView";
import { LiveTestingView } from "./livetest/LiveTestingView";
import { NewsView } from "./news/NewsView";
import { ScannerView } from "./scanner/ScannerView";
import { RiskView } from "./risk/RiskView";
import "./apex-home.css";

/* small live-number component: monospaced value that flashes green/red on change */
function FlashNum({ v, fmt, cls }: { v: number | null | undefined; fmt: (n: number) => string; cls?: string }) {
  const flash = useFlash(v);
  return <span className={`num ${cls || ""} ${flash}`}>{v != null ? fmt(v) : "—"}</span>;
}

/* number formatting helpers for live data */
const fmtNum = (n: number | null | undefined, d = 2) => (n == null || Number.isNaN(n)) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n: number | null | undefined) => (n == null || Number.isNaN(n)) ? "—" : (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const INDEX_NAME: Record<string, string> = { "^GSPC": "S&P 500", "^IXIC": "NASDAQ", "^DJI": "Dow Jones", "^VIX": "VIX" };
const timeAgo = (iso?: string) => { if (!iso) return ""; const t = Date.parse(iso); if (Number.isNaN(t)) return ""; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 60 ? m + "m" : Math.round(m / 60) + "h"; };

/* ─────────────────────────────────────────────────────────────
   APEX — Home screen (working UI). Data is placeholder until Wave 1.
   Jarvis bar is wired to the real /api/chat/stream brain.
   Panels are a registry → reorder / collapse / hide / saved Views.
   ───────────────────────────────────────────────────────────── */

const CY = "#3fd0ff", POS = "#34d399", NEG = "#f4556b", WARN = "#f5a742", PUR = "#a98bff", MUT = "rgba(150,190,225,.45)";
const TICKS = ["NVDA","AAPL","TSLA","SPY","QQQ","MSFT","AMZN","META","AMD","PLTR","COIN","GOOGL","NFLX","AVGO","BTC","ETH"];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
function walk(n: number, s: number, v: number) { const o: number[] = []; let p = s; for (let i = 0; i < n; i++) { p += (Math.random() - .48) * v; o.push(p); } return o; }

type Ctx = CanvasRenderingContext2D;
function drawSpark(ctx: Ctx, w: number, h: number, data: number[], col: string) {
  const mn = Math.min(...data), mx = Math.max(...data), rg = mx - mn || 1;
  const X = (i: number) => i / (data.length - 1) * w, Y = (v: number) => h - 4 - (v - mn) / rg * (h - 8);
  // 3-stop gradient area fill (top→mid→transparent) = depth, not a flat wash
  ctx.beginPath(); ctx.moveTo(0, h); data.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(w, h); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + "55"); g.addColorStop(0.55, col + "16"); g.addColorStop(1, col + "00"); ctx.fillStyle = g; ctx.fill();
  // glowing stroke
  ctx.beginPath(); data.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.shadowColor = col; ctx.shadowBlur = 5; ctx.stroke(); ctx.shadowBlur = 0;
  // two-circle endpoint: colored halo + white-hot core
  const ex = X(data.length - 1), ey = Y(data[data.length - 1]);
  ctx.beginPath(); ctx.arc(ex, ey, 4, 0, 7); ctx.fillStyle = col + "40"; ctx.fill();
  ctx.beginPath(); ctx.arc(ex, ey, 2, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
}

function StaticCanvas({ height, draw, className, style }: { height: number; draw: (ctx: Ctx, w: number, h: number) => void; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    const paint = () => { const w = c.clientWidth || c.parentElement!.clientWidth; c.width = w * DPR; c.height = height * DPR; const ctx = c.getContext("2d")!; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); draw(ctx, w, height); };
    paint(); const ro = new ResizeObserver(paint); ro.observe(c); return () => ro.disconnect();
  }, [height, draw]);
  return <canvas ref={ref} className={className} style={{ height, ...style }} />;
}
function AnimCanvas({ height, drawFrame, className }: { height: number; drawFrame: (ctx: Ctx, w: number, h: number, t: number) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2); let raf = 0, start = 0;
    const size = () => { const w = c.clientWidth || c.parentElement!.clientWidth; c.width = w * DPR; c.height = height * DPR; };
    size(); const ctx = c.getContext("2d")!;
    const loop = (now: number) => { if (!start) start = now; const t = (now - start) / 1000; const w = c.clientWidth || c.parentElement!.clientWidth; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); drawFrame(ctx, w, height, t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); const ro = new ResizeObserver(size); ro.observe(c);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [height, drawFrame]);
  return <canvas ref={ref} className={className} style={{ height }} />;
}

const MAP_NODES = [[.22,.4],[.48,.32],[.55,.5],[.78,.42],[.3,.6],[.7,.65]];
const MAP_PAIRS = [[0,1],[1,3],[4,2],[2,3],[0,4]];
function drawMap(ctx: Ctx, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h);
  const gx = Math.floor(w / 9), gy = Math.floor(h / 9);
  for (let i = 0; i < gx; i++) for (let j = 0; j < gy; j++) { const px = i / gx, py = j / gy; if (!(Math.sin(px * 9 + py * 3) * Math.cos(py * 7 - px * 2) > .1)) continue; ctx.beginPath(); ctx.arc(i * 9 + 5, j * 9 + 5, .8, 0, 7); ctx.fillStyle = "rgba(70,140,200,.24)"; ctx.fill(); }
  MAP_PAIRS.forEach((pr, k) => { const a = MAP_NODES[pr[0]], b = MAP_NODES[pr[1]]; const ax = a[0]*w, ay = a[1]*h, bx = b[0]*w, by = b[1]*h, mx = (ax+bx)/2, my = Math.min(ay,by)-30;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by); ctx.strokeStyle = "rgba(60,200,255,.12)"; ctx.lineWidth = 1; ctx.stroke();
    const tp = (t + k*.2) % 1; const qx = (1-tp)*(1-tp)*ax+2*(1-tp)*tp*mx+tp*tp*bx, qy = (1-tp)*(1-tp)*ay+2*(1-tp)*tp*my+tp*tp*by;
    ctx.beginPath(); ctx.arc(qx, qy, 1.6, 0, 7); ctx.fillStyle = "#7fe0ff"; ctx.fill(); });
  MAP_NODES.forEach(n => { const nx = n[0]*w, ny = n[1]*h, g = ctx.createRadialGradient(nx, ny, 0, nx, ny, 9); g.addColorStop(0, "rgba(60,200,255,.9)"); g.addColorStop(1, "rgba(60,200,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, 9, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(nx, ny, 2, 0, 7); ctx.fillStyle = "#eafaff"; ctx.fill(); });
}
/* Real 30-day index performance — normalized % lines from live Yahoo bars.
   Drawn once (StaticCanvas, no animation loop) → useful + cheap. */
type PerfSeries = { name: string; col: string; pts: number[] };
function drawIndexPerf(ctx: Ctx, w: number, h: number, series: PerfSeries[]) {
  ctx.clearRect(0, 0, w, h);
  if (!series.length) return;
  const padL = 6, padR = 46, padT = 16, padB = 16;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  let lo = Infinity, hi = -Infinity, maxN = 0;
  series.forEach(s => { s.pts.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); }); maxN = Math.max(maxN, s.pts.length); });
  if (!(hi > lo)) { hi = 1; lo = -1; }
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const X = (i: number, n: number) => padL + (i / Math.max(1, n - 1)) * plotW;
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  // gridlines + % labels
  ctx.font = "9px 'JetBrains Mono',ui-monospace"; ctx.textBaseline = "middle";
  for (let g = 0; g <= 4; g++) {
    const v = lo + (g / 4) * (hi - lo), y = Y(v);
    ctx.strokeStyle = "rgba(120,180,210,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    ctx.fillStyle = "rgba(150,190,215,0.5)"; ctx.textAlign = "left";
    ctx.fillText((v >= 0 ? "+" : "") + v.toFixed(1) + "%", w - padR + 4, y);
  }
  // zero line emphasized
  if (lo < 0 && hi > 0) { const zy = Y(0); ctx.strokeStyle = "rgba(150,190,215,0.22)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(w - padR, zy); ctx.stroke(); ctx.setLineDash([]); }
  series.forEach(s => {
    const n = s.pts.length; if (n < 2) return;
    // gradient area fill
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, s.col + "38"); grad.addColorStop(1, s.col + "00");
    ctx.beginPath(); ctx.moveTo(X(0, n), Y(s.pts[0]));
    s.pts.forEach((v, i) => ctx.lineTo(X(i, n), Y(v)));
    ctx.lineTo(X(n - 1, n), padT + plotH); ctx.lineTo(X(0, n), padT + plotH); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    // line
    ctx.beginPath(); s.pts.forEach((v, i) => i ? ctx.lineTo(X(i, n), Y(v)) : ctx.moveTo(X(i, n), Y(v)));
    ctx.strokeStyle = s.col; ctx.lineWidth = 1.6; ctx.shadowColor = s.col; ctx.shadowBlur = 6; ctx.stroke(); ctx.shadowBlur = 0;
    // endpoint dot
    const ex = X(n - 1, n), ey = Y(s.pts[n - 1]);
    ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 4.2, 0, 7); ctx.strokeStyle = s.col; ctx.lineWidth = 1; ctx.stroke();
  });
  // legend
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = "9px 'JetBrains Mono',ui-monospace";
  series.forEach((s, i) => {
    const lx = padL + 4 + i * 82, ly = h - 7;
    ctx.fillStyle = s.col; ctx.fillRect(lx, ly - 3, 9, 2.5);
    const last = s.pts[s.pts.length - 1];
    ctx.fillStyle = "rgba(220,238,250,0.85)"; ctx.fillText(`${s.name} ${last >= 0 ? "+" : ""}${last.toFixed(1)}%`, lx + 13, ly);
  });
}
function IndexPerfChart({ height = 174 }: { height?: number }) {
  const [series, setSeries] = useState<PerfSeries[] | null>(null);
  useEffect(() => {
    let alive = true;
    const defs: [string, string, string][] = [["^GSPC", "S&P", "#22d3ee"], ["^IXIC", "NDAQ", "#8fd14f"], ["^DJI", "DOW", "#f5a524"]];
    Promise.all(defs.map(async ([s, n, c]) => {
      const bars = await fetchBars(s, "1d", "1mo");
      const closes = bars.map(b => b.c).filter(x => x != null) as number[];
      const base = closes[0] || 1;
      return { name: n, col: c, pts: closes.map(x => (x / base - 1) * 100) };
    })).then(r => { if (alive) setSeries(r.filter(x => x.pts.length > 1)); }).catch(() => { if (alive) setSeries([]); });
    return () => { alive = false; };
  }, []);
  if (!series) return <div className="lbl" style={{ padding: "12px 4px" }}>Loading index performance…</div>;
  if (!series.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Index data unavailable.</div>;
  return <StaticCanvas height={height} draw={(c, w, h) => drawIndexPerf(c, w, h, series)} />;
}
function drawHeartbeat(ctx: Ctx, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h); ctx.beginPath(); ctx.strokeStyle = "rgba(60,200,255,.7)"; ctx.lineWidth = 1.5;
  for (let i = 0; i < w; i++) { const p = i / w; let y = h/2 + Math.sin((p*6 + t) * Math.PI) * 2; const b = (p*4 + t*.5) % 1; if (b > .45 && b < .55) y = h/2 - Math.sin((b-.45)/.1 * Math.PI) * h*.38; i ? ctx.lineTo(i, y) : ctx.moveTo(i, y); }
  ctx.stroke();
}
const RRG_SECS: [string, number, number, string][] = [["TECH",148,44,POS],["ENGY",60,150,WARN],["FIN",150,120,CY],["HLTH",70,60,NEG],["CONS",120,90,CY]];
function drawRRG(ctx: Ctx, w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h); const sx = w/200, sy = h/168, cx = w/2, cy = h/2;
  ctx.fillStyle = "rgba(244,85,107,.05)"; ctx.fillRect(0, 0, cx, cy);
  ctx.fillStyle = "rgba(52,211,153,.06)"; ctx.fillRect(cx, 0, cx, cy);
  ctx.fillStyle = "rgba(245,167,66,.05)"; ctx.fillRect(0, cy, cx, cy);
  ctx.fillStyle = "rgba(63,208,255,.05)"; ctx.fillRect(cx, cy, cx, cy);
  ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 4); ctx.lineTo(cx, h-4); ctx.moveTo(4, cy); ctx.lineTo(w-4, cy); ctx.stroke();
  ctx.font = "7px ui-monospace"; ctx.fillStyle = POS; ctx.textAlign = "right"; ctx.fillText("LEADING", w-6, 12);
  ctx.textAlign = "left"; ctx.fillStyle = NEG; ctx.fillText("WEAKENING", 6, 12); ctx.fillStyle = WARN; ctx.fillText("LAGGING", 6, h-5);
  ctx.textAlign = "right"; ctx.fillStyle = CY; ctx.fillText("IMPROVING", w-6, h-5); ctx.textAlign = "left";
  RRG_SECS.forEach((p, i) => { const ox = Math.sin(t + i)*5, oy = Math.cos(t + i*1.3)*5; const px = (p[1]+ox)*sx, py = (p[2]+oy)*sy;
    ctx.beginPath(); ctx.moveTo(px - 14*sx, py + 10*sy); ctx.lineTo(px, py); ctx.strokeStyle = p[3]; ctx.globalAlpha = .4; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fillStyle = p[3]; ctx.fill(); ctx.fillStyle = "#cfe8fa"; ctx.font = "7px ui-monospace"; ctx.fillText(p[0], px + 6, py + 3); });
}
function drawTreemap(ctx: Ctx, w: number, h: number, sectors?: { name: string; changePct: number }[]) {
  ctx.clearRect(0, 0, w, h);
  const secs = (sectors && sectors.length ? sectors : []).map(s => ({ name: s.name, chg: s.changePct }));
  if (!secs.length) { ctx.fillStyle = MUT; ctx.font = "11px ui-monospace"; ctx.fillText("loading sectors…", 8, h / 2); return; }
  // equal-area grid (no live market-cap weights) colored by day change
  const cols = Math.ceil(Math.sqrt(secs.length * w / h)) || 4, rows = Math.ceil(secs.length / cols);
  const cw = w / cols, rh = h / rows;
  secs.forEach((s, i) => {
    const cx = (i % cols) * cw, cy = Math.floor(i / cols) * rh, up = s.chg >= 0, mag = Math.min(1, Math.abs(s.chg) / 4);
    ctx.fillStyle = up ? `rgba(34,130,95,${.18 + mag * .6})` : `rgba(180,55,68,${.18 + mag * .6})`; ctx.fillRect(cx + 1, cy + 1, cw - 2, rh - 2);
    ctx.fillStyle = "rgba(235,245,255,.95)"; ctx.font = "600 10px system-ui"; ctx.fillText(s.name.slice(0, 12), cx + 6, cy + 16);
    ctx.fillStyle = up ? "#7ff0c0" : "#ffb0b8"; ctx.font = "10px ui-monospace"; ctx.fillText((up ? "+" : "") + s.chg.toFixed(1) + "%", cx + 6, cy + 30);
  });
}
function drawCorr(ctx: Ctx, w: number, h: number) {
  const N: [string, number, number, string][] = [["NVDA",.5,.3,POS],["AMD",.62,.42,POS],["MSFT",.4,.55,CY],["SPY",.5,.5,CY],["TSLA",.72,.62,PUR],["BTC",.28,.68,WARN],["GLD",.2,.35,WARN]];
  const E: [number, number, number][] = [[0,1,.9],[0,3,.7],[1,3,.6],[2,3,.8],[3,4,.5],[4,5,.55],[5,6,-.3]];
  E.forEach(e => { const a = N[e[0]], b = N[e[1]]; ctx.beginPath(); ctx.moveTo(a[1]*w, a[2]*h); ctx.lineTo(b[1]*w, b[2]*h); ctx.strokeStyle = (e[2]>0?"rgba(60,200,255,":"rgba(244,85,107,")+Math.abs(e[2])*.5+")"; ctx.lineWidth = Math.abs(e[2])*2.5; ctx.stroke(); });
  N.forEach(n => { const nx = n[1]*w, ny = n[2]*h; ctx.beginPath(); ctx.arc(nx, ny, 10, 0, 7); ctx.fillStyle = n[3]+"33"; ctx.fill(); ctx.strokeStyle = n[3]; ctx.lineWidth = 1.3; ctx.stroke(); ctx.fillStyle = "#dbeeff"; ctx.font = "600 8px ui-monospace"; ctx.textAlign = "center"; ctx.fillText(n[0], nx, ny+2.5); }); ctx.textAlign = "left";
}
type Book = { bids: { p: number; q: number }[]; asks: { p: number; q: number }[] } | null | undefined;
function drawBook(ctx: Ctx, w: number, h: number, book?: Book) {
  ctx.clearRect(0, 0, w, h);
  const mid = w / 2;
  const bids = (book && book.bids) || [], asks = (book && book.asks) || [];
  if (!bids.length && !asks.length) { // fallback demo depth until live data lands
    const cols = 40;
    for (let i = 0; i < cols; i++) { const bd = Math.pow(i/cols, 1.3)+rnd(0,.15), ad = Math.pow(i/cols, 1.3)+rnd(0,.15); const bh = bd*h*.85, ah = ad*h*.85, cw = (w*.48)/cols;
      ctx.fillStyle = `rgba(52,211,153,${.2+bd*.6})`; ctx.fillRect(mid-(i+1)*cw, h-bh, cw-1, bh); ctx.fillStyle = `rgba(244,85,107,${.2+ad*.6})`; ctx.fillRect(mid+i*cw, h-ah, cw-1, ah); }
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(mid, 4); ctx.lineTo(mid, h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = MUT; ctx.font = "9px ui-monospace"; ctx.textAlign = "center"; ctx.fillText("connecting…", mid, 14); ctx.textAlign = "left";
  } else {
    const cols = Math.min(40, Math.max(bids.length, asks.length)); const cw = (w * .48) / cols;
    let cb = 0, ca = 0; const bc: number[] = [], ac: number[] = [];
    for (let i = 0; i < cols; i++) { cb += bids[i] ? bids[i].q : 0; bc.push(cb); ca += asks[i] ? asks[i].q : 0; ac.push(ca); }
    const maxc = Math.max(cb, ca) || 1;
    for (let i = 0; i < cols; i++) { const bh = (bc[i]/maxc)*h*.85, ah = (ac[i]/maxc)*h*.85;
      ctx.fillStyle = `rgba(52,211,153,${.2+(bc[i]/maxc)*.6})`; ctx.fillRect(mid-(i+1)*cw, h-bh, cw-1, bh);
      ctx.fillStyle = `rgba(244,85,107,${.2+(ac[i]/maxc)*.6})`; ctx.fillRect(mid+i*cw, h-ah, cw-1, ah); }
    const bestBid = bids[0] ? bids[0].p : 0, bestAsk = asks[0] ? asks[0].p : 0, midpx = (bestBid && bestAsk) ? (bestBid+bestAsk)/2 : (bestBid || bestAsk);
    ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(mid, 4); ctx.lineTo(mid, h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#eafaff"; ctx.font = "600 11px ui-monospace"; ctx.textAlign = "center"; ctx.fillText(midpx ? "$" + midpx.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—", mid, 14); ctx.textAlign = "left";
  }
  ctx.fillStyle = POS; ctx.font = "8px ui-monospace"; ctx.fillText("BIDS", 6, h-4); ctx.fillStyle = NEG; ctx.textAlign = "right"; ctx.fillText("ASKS", w-6, h-4); ctx.textAlign = "left";
}

/* ── module-level bridges so children can open the drawer / toast ── */
let _openSym: ((s: string) => void) | null = null;
const openSym = (s: string) => _openSym?.(s);
let _toast: ((icon: string, msg: string, col: string) => void) | null = null;
const emitToast = (i: string, m: string, c: string) => _toast?.(i, m, c);
let _askJarvis: ((prompt: string) => void) | null = null;
const askJarvis = (p: string) => _askJarvis?.(p);

/* The brain sometimes replies in markdown (###, **, * bullets) which the room
   shows literally — unreadable. Convert it to clean prose: restore implied line
   breaks, then strip the syntax. Safety net regardless of what the model emits. */
function cleanJarvis(s: string): string {
  if (!s) return s;
  let t = s;
  t = t.replace(/\s+(#{1,6}\s)/g, "\n\n$1");          // break before run-on headers
  t = t.replace(/\s+([*-]\s+\*\*)/g, "\n$1");          // break before inline "* **…" bullets
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");            // strip header hashes (keep text)
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");             // **bold** → bold
  t = t.replace(/__([^_]+)__/g, "$1");                 // __bold__ → bold
  t = t.replace(/^\s*[-*+]\s+/gm, "• ");               // list markers → •
  t = t.replace(/\*([^*\n]+)\*/g, "$1");               // *italic* → italic
  t = t.replace(/`([^`]+)`/g, "$1");                   // `code` → code
  t = t.replace(/^\s*>\s?/gm, "");                     // blockquote markers
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}
let _watchToggle: ((t: string) => void) | null = null;
const watchToggle = (t: string) => _watchToggle?.(t);
let _newAlert: ((t: string, last: number | null) => void) | null = null;
const newAlert = (t: string, last: number | null) => _newAlert?.(t, last);

function LivePV() {
  const [val, setVal] = useState(148632.18); const [flash, setFlash] = useState("");
  useEffect(() => { const iv = setInterval(() => { const d = (Math.random()-.45)*180; setVal(v => v + d); setFlash(d >= 0 ? "flash-g" : "flash-r"); }, 2400); return () => clearInterval(iv); }, []);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(""), 500); return () => clearTimeout(t); }, [flash]);
  return <div className={`big num ${flash}`}>${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
}
function Clock() {
  const [s, setS] = useState(43 * 60 + 7);
  useEffect(() => { const iv = setInterval(() => setS(x => x + 1), 1000); return () => clearInterval(iv); }, []);
  const mm = String(43 + Math.floor(s / 60) % 60).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return <span>12:{mm}:{ss}</span>;
}
function ToastLayer() {
  // Toasts fire ONLY on real user actions (clicks) via emitToast — no auto-generated/fake notifications.
  const [items, setItems] = useState<{ id: number; i: string; m: string; c: string }[]>([]);
  useEffect(() => {
    _toast = (i, m, c) => { const id = Math.random(); setItems(x => [...x, { id, i, m, c }]); setTimeout(() => setItems(x => x.filter(t => t.id !== id)), 5200); };
    return () => { _toast = null; };
  }, []);
  return <div className="toasts">{items.map(t => <div key={t.id} className="toast"><span className="tci" style={{ background: t.c + "22", color: t.c }}>{t.i}</span><span>{t.m}</span></div>)}</div>;
}
// Real alerts derived from live data (regime, VIX, movers, insider) — no fabricated events.
function AlertsFeed() {
  const live = useApexLive();
  const alerts: { icon: string; msg: string; sub: string; col: string; time: string }[] = [];
  const r = live.regime;
  if (r) alerts.push({ icon: "◈", msg: `Regime ${r.label} · score ${r.score}/100`, sub: "live regime engine", col: r.score >= 54 ? POS : r.score < 46 ? NEG : WARN, time: "now" });
  if (r && r.vix != null) alerts.push({ icon: "◮", msg: `VIX ${r.vix.toFixed(1)}${r.momentum != null ? ` · market ${r.momentum >= 0 ? "+" : ""}${r.momentum.toFixed(2)}%` : ""}`, sub: "volatility", col: r.vix > 20 ? NEG : WARN, time: "now" });
  const tg = live.movers.stocks.gainers[0], tl = live.movers.stocks.losers[0];
  if (tg && tg.changePct != null) alerts.push({ icon: "🔺", msg: `${tg.ticker} +${tg.changePct.toFixed(1)}% — top stock gainer`, sub: "movers", col: POS, time: "today" });
  if (tl && tl.changePct != null) alerts.push({ icon: "🔻", msg: `${tl.ticker} ${tl.changePct.toFixed(1)}% — top stock loser`, sub: "movers", col: NEG, time: "today" });
  const bigIns = live.insider.find(t => Math.abs(t.change) >= 5000 && t.side !== "other");
  if (bigIns) alerts.push({ icon: "≣", msg: `${bigIns.ticker} insider ${bigIns.side} ${(Math.abs(bigIns.change) / 1000).toFixed(0)}k sh`, sub: bigIns.name ? bigIns.name.slice(0, 22) : "SEC filing", col: bigIns.side === "buy" ? POS : NEG, time: bigIns.date || "" });
  const cg = live.movers.crypto.gainers[0];
  if (cg && cg.changePct != null) alerts.push({ icon: "⚡", msg: `${cg.ticker} +${cg.changePct.toFixed(1)}% — crypto leader (24h)`, sub: "crypto movers", col: WARN, time: "24h" });
  if (!alerts.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Watching live signals — regime, VIX, movers, insider…</div>;
  return <div className="alerts">{alerts.slice(0, 5).map((a, i) => <div key={i} className="al"><span className="ai2" style={{ background: a.col + "22", color: a.col }}>{a.icon}</span><div className="at"><div className="atx">{a.msg}</div><div className="am">{a.sub}</div></div><span className="cd">{a.time}</span></div>)}</div>;
}

function Ring({ v, size, txt, sub }: { v: number; size: number; txt: string; sub: string }) {
  const R = size / 2 - 6, C = size / 2, cir = 2 * Math.PI * R;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
    <circle cx={C} cy={C} r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="6" />
    <circle cx={C} cy={C} r={R} fill="none" stroke="url(#axpg)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${cir * v} ${cir}`} transform={`rotate(-90 ${C} ${C})`} />
    <defs><linearGradient id="axpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#34d399" /><stop offset="1" stopColor="#3fd0ff" /></linearGradient></defs>
    <text x={C} y={C - 1} textAnchor="middle" fill="#eafaff" fontSize={size * .25} fontFamily="ui-monospace" fontWeight="300">{txt}</text>
    <text x={C} y={C + size * .14} textAnchor="middle" fill={MUT} fontSize="8">{sub}</text>
  </svg>;
}
const ALLOC: [string, number, string][] = [["Stocks",58.1,"#3fd0ff"],["Crypto",28.7,"#a98bff"],["Cash",7.4,"#f5a742"],["ETFs",3.4,"#34d399"],["Options",2.2,"rgba(150,190,225,.5)"]];
function Donut() {
  const C = 40, R = 29, sw = 9; let a = -Math.PI / 2;
  const arcs = ALLOC.map((d, i) => { const ang = d[1] / 100 * 2 * Math.PI; const x1 = C + R * Math.cos(a), y1 = C + R * Math.sin(a), x2 = C + R * Math.cos(a + ang), y2 = C + R * Math.sin(a + ang), la = ang > Math.PI ? 1 : 0; const p = `M ${x1} ${y1} A ${R} ${R} 0 ${la} 1 ${x2} ${y2}`; a += ang; return <path key={i} d={p} fill="none" stroke={d[2]} strokeWidth={sw} />; });
  return <svg width="80" height="80" viewBox="0 0 80 80">{arcs}<text x={C} y={C + 3} textAnchor="middle" fill="#eafaff" fontSize="9" fontFamily="ui-monospace">100%</text></svg>;
}
function FGGauge({ score = 50, label = "—" }: { score?: number; label?: string }) {
  const cx = 39, cy = 40, R = 31, v = Math.max(0, Math.min(1, score / 100)), va = Math.PI + (0 - Math.PI) * v;
  const col = score >= 58 ? POS : score >= 43 ? WARN : NEG;
  const arc = (f: number, t: number) => { const x1 = cx + R * Math.cos(f), y1 = cy + R * Math.sin(f), x2 = cx + R * Math.cos(t), y2 = cy + R * Math.sin(t); return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`; };
  return <svg width="78" height="44" viewBox="0 0 78 44">
    <path d={arc(Math.PI, Math.PI * .72)} fill="none" stroke={NEG} strokeWidth="5" strokeLinecap="round" />
    <path d={arc(Math.PI * .72, Math.PI * .4)} fill="none" stroke={WARN} strokeWidth="5" strokeLinecap="round" />
    <path d={arc(Math.PI * .4, 0)} fill="none" stroke={POS} strokeWidth="5" strokeLinecap="round" />
    <line x1={cx} y1={cy} x2={cx + (R - 6) * Math.cos(va)} y2={cy + (R - 6) * Math.sin(va)} stroke="#eafaff" strokeWidth="2" strokeLinecap="round" />
    <circle cx={cx} cy={cy} r="3" fill="#eafaff" /><text x={cx} y={cy - 8} textAnchor="middle" fill={col} fontSize="12" fontFamily="ui-monospace">{score}</text>
    <text x={cx} y={cy + 2} textAnchor="middle" fill={MUT} fontSize="6.5">{label.toUpperCase()}</text>
  </svg>;
}

const TABS = ["Home","Forge","Live Markets","Portfolio","Paper Trading","Backtesting","Trading Bots","Live Testing","News","Scanner","Risk"];
const BOTS: [string, number, string, string][] = [["Momentum Rider",1,"+8.4%",POS],["Volatility",2,"+5.1%",POS],["Breakout Hunter",3,"+3.7%",POS],["Mean Reverter",4,"−1.2%",NEG]];
const MODE_CFG: Record<string, { acc: string; chips: string[]; ph: string; trace: string }> = {
  analyst: { acc: CY, chips: ["◧ Market Brief","◈ Top Opportunities","◮ Risk Scan","◎ Portfolio Review","◱ Strategy Plan"], ph: "Ask anything — “brief me on tech”, “why is NVDA up?”", trace: "◈ quotes · regime · news · portfolio" },
  trader: { acc: POS, chips: ["▨ Buy 10 NVDA (paper)","◧ Set stop −3%","◮ Close TSLA","⚡ Scan breakouts","◱ Bracket order"], ph: "Trade — “buy 10 NVDA at market (paper)”, “set a 3% trailing stop”", trace: "◈ account · order-sim · risk-check" },
  quant: { acc: PUR, chips: ["◫ Backtest RSI<30","∑ Portfolio VaR","❖ Correlation matrix","◱ Regime detect","∿ Kelly sizing"], ph: "Quant — “backtest mean-reversion on QQQ”, “run Monte Carlo on my book”", trace: "◈ bars · backtest-engine · stats" },
  research: { acc: WARN, chips: ["▤ Deep dive NVDA","≣ Latest 13F changes","◈ Insider cluster buys","🌐 CPI outlook","▦ Sector thesis"], ph: "Research — “deep-dive NVDA fundamentals”, “what changed in 13F filings?”", trace: "◈ filings · fundamentals · news" },
};

/* ── Panel registry: static meta + column layout ── */
type PanelId = "pulse"|"portfolio"|"bots"|"overview"|"movers"|"constellation"|"depthmap"|"volprofile"|"tape"|"rotation"|"internals"|"unusual"|"heatmap"|"corr"|"orderbook"|"quick"|"news"|"insights"|"alerts"|"fng"|"attention"|"form4"|"btcnet"|"risklab"|"anomaly"|"ekg"|"mandala";
interface Meta { icon: string; title: string; w?: "third"; badge?: { t: string; cls: string }; pr?: string; headerRight?: React.ReactNode }
const PANEL_META: Record<PanelId, Meta> = {
  pulse: { icon: "◈", title: "Market Pulse", badge: { t: "Regime Engine", cls: "b-new" } },
  portfolio: { icon: "◎", title: "Portfolio", badge: { t: "Demo", cls: "b-new" } },
  bots: { icon: "⬡", title: "Bot Status", badge: { t: "Demo", cls: "b-new" } },
  overview: { icon: "🌐", title: "Market Overview" },
  movers: { icon: "⇅", title: "Top Movers · Stocks & Crypto", badge: { t: "Live", cls: "b-live" } },
  constellation: { icon: "❋", title: "Market Constellation · Correlation Network", badge: { t: "Live Physics", cls: "b-live" } },
  depthmap: { icon: "▤", title: "BTC Order-Book Heatmap · Live Liquidity", badge: { t: "Bookmap", cls: "b-live" } },
  volprofile: { icon: "▥", title: "BTC Volume Profile", w: "third", badge: { t: "POC · VA", cls: "b-live" } },
  tape: { icon: "≡", title: "BTC Time & Sales", w: "third", badge: { t: "Live Tape", cls: "b-live" } },
  rotation: { icon: "◱", title: "Sector Rotation", w: "third", badge: { t: "RRG · Live", cls: "b-live" } },
  internals: { icon: "≣", title: "Market Internals", w: "third", badge: { t: "Breadth", cls: "b-live" } },
  unusual: { icon: "◈", title: "Insider Activity", w: "third", badge: { t: "SEC · Finnhub", cls: "b-live" } },
  heatmap: { icon: "▦", title: "Sector Heatmap", badge: { t: "Live", cls: "b-live" } },
  corr: { icon: "❖", title: "Correlation Matrix", w: "third", badge: { t: "Live", cls: "b-live" } },
  fng: { icon: "◐", title: "Crypto Fear & Greed", w: "third", badge: { t: "Sentiment", cls: "b-live" } },
  attention: { icon: "◎", title: "Retail Attention · Wikipedia", w: "third", badge: { t: "Alt-Data", cls: "b-live" } },
  form4: { icon: "▤", title: "SEC Form-4 Live Tape", w: "third", badge: { t: "EDGAR", cls: "b-live" } },
  btcnet: { icon: "⛓", title: "BTC Network Heat", w: "third", badge: { t: "On-Chain", cls: "b-live" } },
  risklab: { icon: "Σ", title: "Quant Risk Lab", badge: { t: "VaR · CVaR · β", cls: "b-new" } },
  anomaly: { icon: "⚡", title: "Anomaly Scanner", w: "third", badge: { t: "Z-Score", cls: "b-live" } },
  ekg: { icon: "♥", title: "Breadth Heartbeat", w: "third", badge: { t: "Market Pulse", cls: "b-live" } },
  mandala: { icon: "❂", title: "Market Mandala", w: "third", badge: { t: "Live Art", cls: "b-live" } },
  orderbook: { icon: "▥", title: "Order Book · BTC", w: "third", badge: { t: "Depth", cls: "b-live" } },
  quick: { icon: "▸", title: "Quick Actions" },
  news: { icon: "▤", title: "Market News", badge: { t: "Sentiment", cls: "b-new" } },
  insights: { icon: "✦", title: "AI Insights", badge: { t: "Live read", cls: "b-live" } },
  alerts: { icon: "◮", title: "Alerts & Actions", badge: { t: "Engine", cls: "b-live" } },
};
type Layout = { left: PanelId[]; center: PanelId[]; right: PanelId[] };
/* Command-palette entry: [icon, label, kind, arg, group?, shortcut?] */
type Cmd = [string, string, string, string, string?, string?];
const DEFAULT_LAYOUT: Layout = { left: ["pulse","portfolio","bots"], center: ["overview","constellation","depthmap","movers","volprofile","tape","internals","unusual","heatmap","rotation","corr","risklab","ekg","mandala","anomaly","fng","attention","form4","btcnet","orderbook","quick"], right: ["news","insights","alerts"] };
const PRESETS: Record<string, { collapsed: PanelId[]; hidden: PanelId[] }> = {
  Default: { collapsed: [], hidden: [] },
  Compact: { collapsed: ["bots","internals","unusual","corr","orderbook","insights"], hidden: [] },
  Trading: { collapsed: ["rotation","internals","heatmap","corr","insights"], hidden: ["news"] },
  Quant: { collapsed: ["bots","unusual"], hidden: ["news"] },
};
const LS_LAYOUT = "apex.home.layout.v1", LS_VIEWS = "apex.home.views.v1", LS_CUR = "apex.home.view.v1", LS_SNAP = "apex.home.snap.v1";
function loadJSON<T>(k: string, fb: T): T { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : fb; } catch { return fb; } }
const asSet = (arr: PanelId[]) => Object.fromEntries(arr.map(x => [x, true])) as Record<string, boolean>;

/* ── News Flow 2.0 river ── */
const LANE_META: Record<string, { label: string; col: string }> = {
  macro: { label: "Macro", col: CY }, finance: { label: "Finance", col: POS }, equity: { label: "Equity", col: POS },
  commodities: { label: "Commodities", col: WARN }, crypto: { label: "Crypto", col: PUR },
  geopolitics: { label: "Geo", col: NEG }, commercial: { label: "Commercial", col: MUT }, weather: { label: "Weather", col: "#5ab0e0" },
};
const credTier = (v: number) => v >= 0.7 ? { t: "High", c: POS } : v >= 0.52 ? { t: "Med", c: WARN } : { t: "Low", c: MUT };
function NewsRiver() {
  const live = useApexLive();
  const [lane, setLane] = useState("all");
  const [sort, setSort] = useState<"impact" | "latest">("impact");
  const [hover, setHover] = useState<{ s: Story & { net: number }; x: number; y: number } | null>(null);
  const news = live.news;
  const withSent = news.map(s => { const net = (s.tickers || []).reduce((a, t) => a + (t.dir > 0 ? t.mag : -t.mag), 0); return { ...s, net }; });
  const bull = withSent.filter(s => s.net > 0.05).length, bear = withSent.filter(s => s.net < -0.05).length;
  const lanes = Array.from(new Set(news.map(n => n.lane).filter(Boolean))) as string[];
  let rows = withSent.filter(s => lane === "all" ? true : s.lane === lane);
  rows = sort === "impact"
    ? [...rows].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.rank || 0) - (a.rank || 0))
    : [...rows].sort((a, b) => (Date.parse(b.firstSeen || "") || 0) - (Date.parse(a.firstSeen || "") || 0));
  return <>
    <div className="nr-top">
      <div className="nr-sent" title={`${bull} bullish · ${bear} bearish stories`}><span className="nr-bar"><i className="pos" style={{ flex: bull || 0.4 }} /><i className="neg" style={{ flex: bear || 0.4 }} /></span><span className="lbl">{bull}▲ {bear}▼</span></div>
      <div className="nr-sort"><span className={sort === "impact" ? "on" : ""} onClick={() => setSort("impact")}>Impact</span><span className={sort === "latest" ? "on" : ""} onClick={() => setSort("latest")}>Latest</span></div>
    </div>
    <div className="nr-lanes"><span className={`nr-lane${lane === "all" ? " on" : ""}`} onClick={() => setLane("all")}>All</span>{lanes.map(l => <span key={l} className={`nr-lane${lane === l ? " on" : ""}`} onClick={() => setLane(l)} style={lane === l ? { color: LANE_META[l]?.col || CY, borderColor: (LANE_META[l]?.col || CY) + "66" } : undefined}>{LANE_META[l]?.label || l}</span>)}</div>
    <div className="news nr-list">{!news.length ? <div className="lbl" style={{ padding: "12px 4px" }}>{live.updated ? "News engine running — stories arrive on the next cycle." : "Connecting to news engine…"}</div>
      : rows.slice(0, 16).map((s, i) => {
        const sent = s.net > 0.05 ? POS : s.net < -0.05 ? NEG : MUT;
        const cred = credTier(s.verified || 0);
        const tks = (s.tickers || []).map(t => t.t || t.s).filter(Boolean) as string[];
        const known = tks.filter(t => TICKS.includes(t));
        return <div key={i} className={`ni${s.pinned ? " nr-pinned" : ""}`}
          onMouseEnter={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setHover({ s, x: r.left, y: r.top }); }}
          onMouseLeave={() => setHover(null)}
          onClick={() => known[0] && openSym(known[0])}>
          <span className="sent" style={{ background: sent }} />
          <div className="body">
            <div className="hl">{s.pinned && <span className="nr-pin">◆</span>}{s.title}</div>
            <div className="meta">
              <span className="src">{s.sources?.[0] || s.lane || "wire"}</span>
              <span className="nr-cred" style={{ color: cred.c, borderColor: cred.c + "55" }}>{cred.t}</span>
              {s.lane && <span className="tag" style={{ color: LANE_META[s.lane]?.col || PUR }}>{LANE_META[s.lane]?.label || s.lane}</span>}
              {known.slice(0, 2).map(t => <span key={t} className="tag" style={{ color: CY }} onClick={e => { e.stopPropagation(); openSym(t); }}>{t}</span>)}
            </div>
          </div>
        </div>;
      })}</div>
    {hover && <div className="nr-preview" style={{ left: hover.x, top: hover.y }}>
      <div className="nrp-t">{hover.s.title}</div>
      <div className="nrp-m">{(LANE_META[hover.s.lane || ""]?.label || hover.s.lane || "news")} · verify {Math.round((hover.s.verified || 0) * 100)}% · {hover.s.corroboration} source(s)</div>
      {(hover.s.tickers || []).length > 0 && <div className="nrp-tk">{(hover.s.tickers || []).map((t, i) => <span key={i} style={{ color: t.dir > 0 ? POS : NEG }}>{(t.t || t.s)}{t.dir > 0 ? "↑" : "↓"}</span>)}</div>}
      {(hover.s.sources || []).length > 0 && <div className="nrp-s">{(hover.s.sources || []).join(" · ")}</div>}
    </div>}
  </>;
}

/* ── Real correlation matrix (from public price history) ── */
function CorrelationMatrix() {
  const live = useApexLive();
  const c = live.correlation;
  if (!c || !c.symbols.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Computing correlations from price history…</div>;
  const color = (v: number) => v >= 0 ? `rgba(60,200,255,${0.08 + v * 0.55})` : `rgba(244,85,107,${0.08 + Math.abs(v) * 0.55})`;
  // Compact: cap to the first N symbols so the matrix stays a tidy square, not a wall.
  const N = Math.min(8, c.symbols.length);
  const syms = c.symbols.slice(0, N);
  const matrix = c.matrix.slice(0, N).map(row => row.slice(0, N));
  const fmt = (v: number) => v.toFixed(2).replace(/^0\./, ".").replace(/^-0\./, "-.");
  return <div className="corr-grid" style={{ gridTemplateColumns: `30px repeat(${N},1fr)` }}>
    <div className="corr-cell corr-hdr" />
    {syms.map(s => <div key={"col" + s} className="corr-cell corr-hdr">{s}</div>)}
    {matrix.map((row, i) => [
      <div key={"row" + i} className="corr-cell corr-hdr">{syms[i]}</div>,
      ...row.map((v, j) => <div key={i + "-" + j} className="corr-cell" style={{ background: i === j ? "rgba(255,255,255,.07)" : color(v) }} title={`${syms[i]} / ${syms[j]}: ${v}`}>{i === j ? "" : fmt(v)}</div>),
    ])}
  </div>;
}

/* ── Real sector RRG (relative strength vs momentum, from public bars) ── */
function SectorRRG() {
  const live = useApexLive();
  const pts = live.rrg;
  if (!pts.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Computing sector rotation…</div>;
  const W = 280, H = 150;
  const xs = pts.map(p => p.rsRatio), ys = pts.map(p => p.rsMomentum);
  const xmin = Math.min(99, ...xs) - 0.5, xmax = Math.max(101, ...xs) + 0.5;
  const ymin = Math.min(99, ...ys) - 0.5, ymax = Math.max(101, ...ys) + 0.5;
  const X = (v: number) => ((v - xmin) / (xmax - xmin)) * W, Y = (v: number) => H - ((v - ymin) / (ymax - ymin)) * H;
  const cx = X(100), cy = Y(100);
  const quad = (p: { rsRatio: number; rsMomentum: number }) => p.rsRatio >= 100 ? (p.rsMomentum >= 100 ? POS : NEG) : (p.rsMomentum >= 100 ? CY : WARN);
  return <svg viewBox={`0 0 ${W} ${H}`} className="rrg-svg">
    <rect x={cx} y={0} width={W - cx} height={cy} fill="rgba(52,211,153,.05)" /><rect x={0} y={0} width={cx} height={cy} fill="rgba(244,85,107,.05)" />
    <rect x={0} y={cy} width={cx} height={H - cy} fill="rgba(245,167,66,.05)" /><rect x={cx} y={cy} width={W - cx} height={H - cy} fill="rgba(63,208,255,.05)" />
    <line x1={cx} y1={0} x2={cx} y2={H} stroke="rgba(255,255,255,.12)" /><line x1={0} y1={cy} x2={W} y2={cy} stroke="rgba(255,255,255,.12)" />
    <text x={W - 4} y={10} fill={POS} fontSize="7" textAnchor="end">LEADING</text><text x={4} y={10} fill={NEG} fontSize="7">WEAKENING</text>
    <text x={4} y={H - 4} fill={WARN} fontSize="7">LAGGING</text><text x={W - 4} y={H - 4} fill={CY} fontSize="7" textAnchor="end">IMPROVING</text>
    {pts.map((p, i) => { const x = X(p.rsRatio), y = Y(p.rsMomentum), col = quad(p); return <g key={i}><circle cx={x} cy={y} r={4} fill={col} /><text x={x + 6} y={y + 3} fill="#cfe8fa" fontSize="7" fontFamily="ui-monospace">{p.etf.replace(/^XL/, "")}</text></g>; })}
  </svg>;
}

/* ── Crypto Fear & Greed — real gauge (alternative.me) + 30-day sparkline ── */
function FearGreedGauge() {
  const live = useApexLive();
  const f = live.cryptoFng;
  if (!f) return <div className="lbl" style={{ padding: "12px 4px" }}>Loading Crypto Fear &amp; Greed…</div>;
  const W = 260, H = 132, cx = W / 2, cy = 118, R = 96;
  const v = Math.max(0, Math.min(100, f.value));
  // semicircle: value 0 → 180° (left), value 100 → 0° (right)
  const ang = (val: number) => Math.PI * (1 - val / 100);
  const pt = (val: number, r: number) => ({ x: cx + r * Math.cos(ang(val)), y: cy - r * Math.sin(ang(val)) });
  const arc = (a: number, b: number, r: number) => { const p0 = pt(a, r), p1 = pt(b, r); return `M ${p0.x} ${p0.y} A ${r} ${r} 0 0 1 ${p1.x} ${p1.y}`; };
  const ZONES: [number, number, string][] = [[0, 25, "#f4556b"], [25, 45, "#f5934a"], [45, 55, "#e8c84a"], [55, 75, "#8fd14f"], [75, 100, "#34d399"]];
  const col = v < 25 ? "#f4556b" : v < 45 ? "#f5934a" : v < 55 ? "#e8c84a" : v < 75 ? "#8fd14f" : "#34d399";
  const needle = pt(v, R - 10);
  const hist = f.history || []; const hv = hist.map(h => h.value);
  const smin = Math.min(...hv, 0), smax = Math.max(...hv, 100);
  const spW = 236, spH = 30;
  const sx = (i: number) => (i / Math.max(1, hist.length - 1)) * spW;
  const sy = (val: number) => spH - ((val - smin) / (smax - smin || 1)) * spH;
  const spd = hist.map((h, i) => `${i ? "L" : "M"} ${sx(i).toFixed(1)} ${sy(h.value).toFixed(1)}`).join(" ");
  const prev = hist.length > 1 ? hist[0].value : v;
  return <div className="fng">
    <svg viewBox={`0 0 ${W} ${H}`} className="fng-gauge">
      {ZONES.map((z, i) => <path key={i} d={arc(z[0], z[1], R)} stroke={z[2]} strokeWidth={13} fill="none" strokeLinecap="butt" opacity={0.85} />)}
      <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#eaf6ff" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill="#eaf6ff" />
      <text x={cx} y={cy - 34} textAnchor="middle" fill={col} fontSize="30" fontWeight="700" fontFamily="ui-monospace">{v}</text>
      <text x={cx} y={cy - 16} textAnchor="middle" fill="#9fb6c8" fontSize="10" style={{ letterSpacing: ".5px" }}>{f.label.toUpperCase()}</text>
      <text x={pt(0, R + 10).x - 2} y={cy + 4} fill="#6f8698" fontSize="7">0</text>
      <text x={pt(100, R + 10).x - 4} y={cy + 4} fill="#6f8698" fontSize="7">100</text>
    </svg>
    <div className="fng-spark">
      <svg viewBox={`0 0 ${spW} ${spH}`} preserveAspectRatio="none" style={{ width: "100%", height: spH }}>
        <path d={spd} fill="none" stroke={col} strokeWidth={1.4} opacity={0.9} />
      </svg>
      <div className="lbl">30-day trend · {prev < v ? "rising" : prev > v ? "cooling" : "flat"} (was {prev}) · alternative.me</div>
    </div>
  </div>;
}

/* ── Wikipedia retail-attention — pageview spikes flag what retail is reading ── */
function WikiAttention({ openSym }: { openSym: (s: string) => void }) {
  const live = useApexLive();
  const a = live.attention;
  if (!a || !a.items.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Loading retail attention (Wikipedia pageviews)…</div>;
  const rows = a.items.slice(0, 10);
  const maxSpk = Math.max(20, ...rows.map(r => Math.abs(r.spikePct)));
  return <div className="watn">
    {rows.map((r, i) => {
      const up = r.spikePct >= 0; const col = r.spikePct >= 60 ? "#34d399" : r.spikePct >= 15 ? "#8fd14f" : r.spikePct <= -25 ? "#f4556b" : "#9fb6c8";
      const bw = Math.min(100, (Math.abs(r.spikePct) / maxSpk) * 100);
      const sh = r.spark || []; const smax = Math.max(...sh, 1); const smin = Math.min(...sh, 0);
      const spd = sh.map((val, j) => `${j ? "L" : "M"} ${(j / Math.max(1, sh.length - 1) * 52).toFixed(1)} ${(18 - (val - smin) / (smax - smin || 1) * 18).toFixed(1)}`).join(" ");
      return <div key={i} className="watn-row">
        <span className="watn-tk tk" onClick={() => openSym(r.ticker)}>{r.ticker}</span>
        <span className="watn-bar"><i style={{ width: `${bw}%`, background: col, boxShadow: `0 0 6px ${col}66` }} /></span>
        <svg className="watn-spark" viewBox="0 0 52 18" preserveAspectRatio="none"><path d={spd} fill="none" stroke={col} strokeWidth={1.2} /></svg>
        <span className="watn-spk" style={{ color: col }}>{up ? "+" : ""}{r.spikePct.toFixed(0)}%</span>
      </div>;
    })}
    <div className="lbl" style={{ marginTop: 6 }}>Δ vs 7-day avg daily pageviews · en.wikipedia (retail attention proxy)</div>
  </div>;
}

/* ── G5 showpiece: Breadth Heartbeat EKG — the market's live pulse.
   Rate + spike amplitude driven by real breadth (advancers/decliners) and VIX.
   CSS-animated (preview-safe: no rAF), so it beats even in a background tab. ── */
function ekgPath(cycles: number, amp: number, w: number): string {
  // one PQRST-ish beat across `seg` units, repeated `cycles` times
  const seg = w / cycles, mid = 30;
  let d = `M 0 ${mid}`;
  for (let i = 0; i < cycles; i++) {
    const x = i * seg;
    d += ` L ${(x + seg * 0.15).toFixed(1)} ${mid}`;
    d += ` L ${(x + seg * 0.22).toFixed(1)} ${(mid - amp * 0.18).toFixed(1)}`;   // P
    d += ` L ${(x + seg * 0.30).toFixed(1)} ${mid}`;
    d += ` L ${(x + seg * 0.36).toFixed(1)} ${(mid + amp * 0.22).toFixed(1)}`;   // Q
    d += ` L ${(x + seg * 0.42).toFixed(1)} ${(mid - amp).toFixed(1)}`;          // R spike
    d += ` L ${(x + seg * 0.48).toFixed(1)} ${(mid + amp * 0.45).toFixed(1)}`;   // S
    d += ` L ${(x + seg * 0.56).toFixed(1)} ${mid}`;
    d += ` L ${(x + seg * 0.70).toFixed(1)} ${(mid - amp * 0.30).toFixed(1)}`;   // T
    d += ` L ${(x + seg * 0.82).toFixed(1)} ${mid}`;
    d += ` L ${(x + seg).toFixed(1)} ${mid}`;
  }
  return d;
}
function BreadthEKG() {
  const live = useApexLive();
  const it = live.internals, r = live.regime;
  const pctUp = it?.pctUp ?? null;
  const vix = r?.vix ?? null;
  const bull = pctUp != null ? pctUp >= 0.5 : true;
  const col = pctUp == null ? "#8fd14f" : pctUp >= 0.55 ? "#34d399" : pctUp >= 0.45 ? "#e8c84a" : "#f4556b";
  // amplitude grows with VIX (fear = violent beats); rate grows with |breadth skew| + VIX
  const amp = Math.max(8, Math.min(26, (vix != null ? vix : 16) * 0.9));
  const stress = (vix != null ? Math.min(1, vix / 40) : 0.4) + (pctUp != null ? Math.abs(pctUp - 0.5) : 0.2);
  const bpm = Math.round(58 + stress * 70); // 58–~150
  const dur = (60 / bpm) * 4; // seconds for the 4-beat strip to scroll one full width
  const W = 400, cycles = 4;
  const d = ekgPath(cycles, amp, W);
  return <div className="ekg">
    <div className="ekg-top">
      <div className="ekg-bpm" style={{ color: col }}><span className="ekg-bpmv">{bpm}</span><span className="ekg-bpml">BPM</span></div>
      <div className="ekg-read">
        <div className="lbl">{bull ? "Market pulse — healthy breadth" : "Market pulse — distress"}</div>
        <div className="ekg-stats"><span>▲ {pctUp != null ? Math.round(pctUp * 100) : "—"}%</span><span style={{ color: "var(--ax-mut)" }}>VIX {vix != null ? vix.toFixed(1) : "—"}</span><span style={{ color: col }}>{bpm < 75 ? "Calm" : bpm < 105 ? "Elevated" : "Racing"}</span></div>
      </div>
    </div>
    <div className="ekg-screen">
      <svg className="ekg-track" viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" style={{ ["--ekg-dur" as string]: `${dur}s`, ["--ekg-col" as string]: col }}>
        <path className="ekg-line" d={d} />
        <path className="ekg-line ekg-line2" d={d} transform={`translate(${W},0)`} />
      </svg>
    </div>
  </div>;
}

/* ── G5 showpiece: Market Mandala — generative radial bloom of the whole tape.
   Each sector is a petal (length ∝ |move|, hue by sign); inner regime ring.
   Pure SVG + slow CSS rotation — a live, data-true piece of market art. ── */
function MarketMandala() {
  const live = useApexLive();
  const secs = live.sectors || [];
  const r = live.regime;
  if (!secs.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Blooming the market mandala…</div>;
  const C = 130, cx = C, cy = C, inner = 34;
  const maxAbs = Math.max(1.2, ...secs.map(s => Math.abs(s.changePct)));
  const petal = (i: number, s: { etf: string; name: string; changePct: number }) => {
    const a0 = (i / secs.length) * Math.PI * 2 - Math.PI / 2;
    const aw = (Math.PI * 2 / secs.length) * 0.42;
    const len = inner + 8 + (Math.abs(s.changePct) / maxAbs) * (C - inner - 22);
    const up = s.changePct >= 0;
    const col = up ? "52,211,153" : "244,85,107";
    const tip = { x: cx + Math.cos(a0) * len, y: cy + Math.sin(a0) * len };
    const b1 = { x: cx + Math.cos(a0 - aw) * inner, y: cy + Math.sin(a0 - aw) * inner };
    const b2 = { x: cx + Math.cos(a0 + aw) * inner, y: cy + Math.sin(a0 + aw) * inner };
    const c1 = { x: cx + Math.cos(a0 - aw * 0.5) * len * 0.7, y: cy + Math.sin(a0 - aw * 0.5) * len * 0.7 };
    const c2 = { x: cx + Math.cos(a0 + aw * 0.5) * len * 0.7, y: cy + Math.sin(a0 + aw * 0.5) * len * 0.7 };
    const lx = cx + Math.cos(a0) * (len + 9), ly = cy + Math.sin(a0) * (len + 9);
    return <g key={s.etf}>
      <path d={`M ${b1.x} ${b1.y} Q ${c1.x} ${c1.y} ${tip.x} ${tip.y} Q ${c2.x} ${c2.y} ${b2.x} ${b2.y} Z`}
        fill={`rgba(${col},${0.18 + Math.abs(s.changePct) / maxAbs * 0.5})`} stroke={`rgba(${col},.8)`} strokeWidth={0.8} />
      <text x={lx} y={ly} fill={`rgba(${col},.95)`} fontSize={7.5} textAnchor="middle" fontFamily="ui-monospace">{s.etf.replace(/^XL/, "")}</text>
    </g>;
  };
  const regCol = !r ? "#8fd14f" : r.score >= 54 ? "#34d399" : r.score < 46 ? "#f4556b" : "#e8c84a";
  return <div className="mandala">
    <svg viewBox={`0 0 ${C * 2} ${C * 2}`} className="mandala-svg">
      <g className="mandala-spin" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        {secs.map((s, i) => petal(i, s))}
      </g>
      <circle cx={cx} cy={cy} r={inner} fill="rgba(6,12,22,.85)" stroke={regCol} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={inner - 5} fill="none" stroke={`${regCol}55`} strokeWidth={0.8} />
      <text x={cx} y={cy - 4} textAnchor="middle" fill={regCol} fontSize={20} fontWeight={700} fontFamily="ui-monospace">{r ? r.score : "—"}</text>
      <text x={cx} y={cy + 9} textAnchor="middle" fill="#9fb6c8" fontSize={6.5} style={{ letterSpacing: ".08em" }}>{r ? r.label : "REGIME"}</text>
    </svg>
    <div className="lbl" style={{ textAlign: "center" }}>11 sectors · petal length ∝ move · green up / red down · center = regime score</div>
  </div>;
}

/* ── Quant Risk Lab — full risk decomposition for a symbol (public bars) ── */
function RiskLabPanel() {
  const [sym, setSym] = useState("SPY");
  const [q, setQ] = useState("SPY");
  const [d, setD] = useState<RiskLab | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setLoading(true);
    fetchRiskLab(sym).then(r => { if (alive) { setD(r); setLoading(false); } });
    return () => { alive = false; };
  }, [sym]);
  const submit = () => { const s = q.trim().toUpperCase(); if (s) setSym(s); };
  const maxC = d ? Math.max(...d.bins.map(b => b.count), 1) : 1;
  const rs = d?.rollSharpe || []; const rsMin = Math.min(...rs, 0), rsMax = Math.max(...rs, 0.1);
  const rsPath = rs.map((v, i) => `${i ? "L" : "M"} ${(i / Math.max(1, rs.length - 1) * 100).toFixed(1)} ${(24 - (v - rsMin) / (rsMax - rsMin || 1) * 24).toFixed(1)}`).join(" ");
  const tile = (label: string, val: string, col?: string, hint?: string) => <div className="rl-tile" title={hint}><span className="rl-v" style={col ? { color: col } : undefined}>{val}</span><span className="rl-l">{label}</span></div>;
  return <div className="rl">
    <div className="rl-head">
      <input className="rl-in" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} placeholder="SYM" spellCheck={false} />
      <button className="rl-go" onClick={submit}>Analyze</button>
      {d && <span className="rl-days">{d.days}d · vs SPY</span>}
    </div>
    {loading ? <div className="lbl" style={{ padding: "12px 4px" }}>Computing risk model for {sym}…</div> : !d ? <div className="lbl" style={{ padding: "12px 4px" }}>No data for {sym}.</div> : <>
      <div className="rl-grid">
        {tile("Realized vol", d.realizedVol + "%", "#7fc0ff", "Annualized stdev of daily log returns")}
        {tile("EWMA vol", d.ewmaVol + "%", "#7fc0ff", "RiskMetrics λ=0.94 — recent-weighted")}
        {tile("Beta (SPY)", d.beta != null ? d.beta.toFixed(2) : "—", (d.beta || 1) > 1.1 ? "#f5934a" : "#8fd14f")}
        {tile("VaR 95%", "−" + d.var95 + "%", "#f5934a", "1-day historical Value-at-Risk")}
        {tile("CVaR 95%", "−" + d.cvar95 + "%", "#f4556b", "Expected shortfall beyond VaR")}
        {tile("Max drawdown", d.maxDD + "%", "#f4556b", "Worst peak-to-trough over 2y")}
        {tile("Sharpe (ann)", d.sharpe.toFixed(2), d.sharpe >= 1 ? "#34d399" : d.sharpe >= 0 ? "#e8c84a" : "#f4556b")}
        {tile("VaR 99%", "−" + d.var99 + "%", "#f4556b")}
        {tile("CVaR 99%", "−" + d.cvar99 + "%", "#f4556b")}
      </div>
      <div className="rl-sub">
        <div className="rl-hist">
          <div className="lbl">Daily return distribution</div>
          <div className="rl-bars">{d.bins.map((b, i) => <span key={i} className="rl-bar" title={`${b.x}% · ${b.count}d`} style={{ height: `${(b.count / maxC) * 100}%`, background: b.x < 0 ? "rgba(244,85,107,.6)" : "rgba(52,211,153,.6)" }} />)}</div>
        </div>
        {rs.length > 1 && <div className="rl-rs">
          <div className="lbl">Rolling Sharpe (60d)</div>
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="rl-rs-svg"><line x1="0" y1={(24 - (0 - rsMin) / (rsMax - rsMin || 1) * 24).toFixed(1)} x2="100" y2={(24 - (0 - rsMin) / (rsMax - rsMin || 1) * 24).toFixed(1)} stroke="rgba(255,255,255,.15)" strokeDasharray="2 2" /><path d={rsPath} fill="none" stroke="#7fc0ff" strokeWidth="1.4" /></svg>
        </div>}
      </div>
    </>}
  </div>;
}

/* ── Anomaly Scanner — today's return z-score vs each name's 60-day history ── */
function AnomalyScanner({ openSym }: { openSym: (s: string) => void }) {
  const live = useApexLive();
  const a = live.anomalies;
  if (!a || !a.items.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Scanning for statistical outliers…</div>;
  const flagged = a.items.filter(x => Math.abs(x.z) >= 1.5).slice(0, 10);
  const rows = flagged.length ? flagged : a.items.slice(0, 6);
  return <div className="anom">
    {rows.map((r, i) => {
      const hot = Math.abs(r.z) >= 2, up = r.z >= 0; const col = up ? "#34d399" : "#f4556b";
      return <div key={i} className="anom-row">
        <span className="anom-tk tk" onClick={() => openSym(r.sym)}>{r.sym}</span>
        <span className={`anom-sig${hot ? " hot" : ""}`} style={{ color: col }}>{Math.abs(r.z).toFixed(1)}σ</span>
        <span className="anom-ch" style={{ color: col }}>{r.changePct >= 0 ? "+" : ""}{r.changePct}%</span>
        <span className="anom-bar"><i style={{ width: `${Math.min(100, Math.abs(r.z) / 3 * 100)}%`, background: col, boxShadow: `0 0 6px ${col}66` }} /></span>
      </div>;
    })}
    <div className="lbl" style={{ marginTop: 6 }}>|z| ≥ 1.5σ moves vs trailing 60-day distribution{flagged.length ? "" : " · none today, showing largest"}</div>
  </div>;
}

/* ── SEC Form-4 live tape — market-wide insider filings straight from EDGAR ── */
function SecForm4Tape() {
  const live = useApexLive();
  const rows = live.form4 || [];
  if (!rows.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Streaming SEC Form-4 filings…</div>;
  const rel = (iso: string) => { const t = Date.parse(iso); if (!t) return ""; const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };
  return <div className="s4">
    {rows.slice(0, 12).map((f, i) => {
      const isr = f.role === "issuer";
      return <a key={i} className="s4-row" href={f.link} target="_blank" rel="noreferrer" title={`${f.name} — open SEC filing`}>
        <span className={`s4-role ${isr ? "isr" : "rep"}`}>{isr ? "ISS" : "INS"}</span>
        <span className="s4-name">{f.name.length > 30 ? f.name.slice(0, 29) + "…" : f.name}</span>
        <span className="s4-time">{rel(f.date)}</span>
      </a>;
    })}
    <div className="lbl" style={{ marginTop: 6 }}>Live Form-4 (insider) filings · SEC EDGAR · ISS = issuer, INS = insider</div>
  </div>;
}

/* ── BTC network heat — real on-chain settlement demand (mempool + hashrate) ── */
function BtcNetworkHeat() {
  const live = useApexLive();
  const n = live.btcNet;
  if (!n) return <div className="lbl" style={{ padding: "12px 4px" }}>Reading BTC network state…</div>;
  const BLOCK_VB = 1_000_000; // ~1 vMB per block
  const blocksBacklog = n.mempoolVsize != null ? n.mempoolVsize / BLOCK_VB : null;
  const congPct = blocksBacklog != null ? Math.min(100, (blocksBacklog / 12) * 100) : 0; // ~12 blocks (2h) = "hot"
  const congCol = congPct >= 66 ? "#f4556b" : congPct >= 33 ? "#f5934a" : "#34d399";
  const feeCol = (n.fastFee || 0) >= 50 ? "#f4556b" : (n.fastFee || 0) >= 15 ? "#f5934a" : "#34d399";
  const tile = (label: string, val: string, col?: string) => <div className="btcn-tile"><span className="btcn-v" style={col ? { color: col } : undefined}>{val}</span><span className="btcn-l">{label}</span></div>;
  return <div className="btcn">
    <div className="btcn-cong">
      <div className="btcn-cong-top"><span className="lbl">Mempool congestion</span><span style={{ color: congCol, fontWeight: 700, fontFamily: "var(--ax-mono)" }}>{blocksBacklog != null ? blocksBacklog.toFixed(1) + " blocks" : "—"}</span></div>
      <div className="btcn-bar"><i style={{ width: `${congPct}%`, background: `linear-gradient(90deg,#34d399,${congCol})`, boxShadow: `0 0 8px ${congCol}88` }} /></div>
    </div>
    <div className="btcn-grid">
      {tile("Fast fee (sat/vB)", n.fastFee != null ? String(n.fastFee) : "—", feeCol)}
      {tile("1-hr fee", n.hourFee != null ? String(n.hourFee) : "—")}
      {tile("Mempool txs", n.mempoolTxs != null ? (n.mempoolTxs / 1000).toFixed(0) + "k" : "—")}
      {tile("Hashrate (EH/s)", n.hashRateEH != null ? String(n.hashRateEH) : "—", "#8fd14f")}
      {tile("24h txns", n.nTx24h != null ? (n.nTx24h / 1000).toFixed(0) + "k" : "—")}
      {tile("BTC price", n.price != null ? "$" + Math.round(n.price).toLocaleString() : "—")}
    </div>
    <div className="lbl" style={{ marginTop: 2 }}>On-chain settlement demand · mempool.space + blockchain.info</div>
  </div>;
}

function AlertForm({ onAdd }: { onAdd: (a: { ticker: string; kind: AlertKind; value: number }) => void }) {
  const [t, setT] = useState(""); const [k, setK] = useState<AlertKind>("above"); const [v, setV] = useState("");
  const submit = () => { const val = parseFloat(v); if (!t.trim() || !Number.isFinite(val) || val <= 0) return; onAdd({ ticker: t.trim().toUpperCase(), kind: k, value: val }); setT(""); setV(""); };
  return <div className="am-form">
    <input className="am-in am-tk" placeholder="Ticker" value={t} onChange={e => setT(e.target.value)} />
    <select className="am-in" value={k} onChange={e => setK(e.target.value as AlertKind)}><option value="above">crosses above</option><option value="below">falls below</option><option value="pctUp">gains ≥ %</option><option value="pctDown">drops ≥ %</option></select>
    <input className="am-in am-val" placeholder={k.startsWith("pct") ? "%" : "$"} value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} />
    <button className="am-add" onClick={submit}>Add</button>
  </div>;
}

/* ── Market Constellation: physics correlation network (d3-force + canvas) ── */
interface CNode { id: string; chg: number | null; x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }
interface CLink { source: CNode; target: CNode; r: number }
function MarketConstellation({ height = 340 }: { height?: number }) {
  const live = useApexLive();
  const ref = useRef<HTMLCanvasElement>(null);
  const corr = live.correlation;
  useEffect(() => {
    const c = corr; const canvas = ref.current;
    if (!c || !c.nodes || !c.nodes.length || !canvas) return;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    let W = canvas.clientWidth || 400;
    const H = height;
    const ctx = canvas.getContext("2d")!;
    const size = () => { W = canvas.clientWidth || 400; canvas.width = W * DPR; canvas.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); };
    size();
    const nodes: CNode[] = c.nodes.map((n, i) => ({ id: n.sym, chg: n.changePct, x: W / 2 + Math.cos(i) * 60, y: H / 2 + Math.sin(i) * 60 }));
    const links: CLink[] = [];
    for (let i = 0; i < c.symbols.length; i++) for (let j = i + 1; j < c.symbols.length; j++) { const r = c.matrix[i]?.[j]; if (r != null && Math.abs(r) >= 0.35) links.push({ source: nodes[i], target: nodes[j], r }); }
    const sim: Simulation<CNode, CLink> = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-170))
      .force("link", forceLink<CNode, CLink>(links).distance(l => 42 + (1 - Math.abs(l.r)) * 120).strength(l => Math.abs(l.r) * 0.55))
      .force("center", forceCenter(W / 2, H / 2))
      .force("collide", forceCollide(24))
      .alphaDecay(0.018)
      .stop();
    // pre-settle synchronously so the graph is visible immediately (rAF may be paused in bg tabs)
    for (let i = 0; i < 300; i++) sim.tick();
    let raf = 0, hover: CNode | null = null;
    const rad = (n: CNode) => 9 + Math.min(9, Math.abs(n.chg ?? 0) * 1.3);
    const paint = () => {
      ctx.clearRect(0, 0, W, H);
      links.forEach(l => { const on = hover && (l.source === hover || l.target === hover); ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.strokeStyle = (l.r >= 0 ? "rgba(60,200,255," : "rgba(244,85,107,") + ((on ? 0.5 : 0.08) + Math.abs(l.r) * 0.35) + ")"; ctx.lineWidth = Math.abs(l.r) * (on ? 3.5 : 2.2); ctx.stroke(); });
      nodes.forEach(n => { const up = (n.chg ?? 0) >= 0; const col = up ? "#34d399" : "#f4556b"; const rr = rad(n); const dim = hover && hover !== n && !links.some(l => (l.source === hover && l.target === n) || (l.target === hover && l.source === n));
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, rr * 1.9); g.addColorStop(0, col + (dim ? "55" : "cc")); g.addColorStop(1, col + "00"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, rr * 1.9, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(n.x, n.y, rr, 0, 7); ctx.fillStyle = dim ? col + "88" : col; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#eafaff"; ctx.font = "600 8px ui-monospace"; ctx.textAlign = "center"; ctx.fillText(n.id.replace(/USDT$/, ""), n.x, n.y + 2.5);
        if (n.chg != null && (hover === n)) { ctx.fillStyle = up ? "#7ff0c0" : "#ffb0b8"; ctx.font = "7px ui-monospace"; ctx.fillText((up ? "+" : "") + n.chg.toFixed(1) + "%", n.x, n.y + rr + 9); } });
    };
    paint(); // synchronous first frame
    const loop = () => { sim.tick(); paint(); raf = sim.alpha() > 0.006 ? requestAnimationFrame(loop) : 0; };
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    sim.alpha(0.25); kick(); // gentle ease-in when rAF is available
    const at = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { mx: e.clientX - r.left, my: e.clientY - r.top }; };
    const pick = (mx: number, my: number) => nodes.find(n => Math.hypot(n.x - mx, n.y - my) < rad(n) + 4) || null;
    let drag: CNode | null = null, moved = false;
    const onDown = (e: MouseEvent) => { const { mx, my } = at(e); drag = pick(mx, my); moved = false; if (drag) { drag.fx = mx; drag.fy = my; sim.alpha(0.3); kick(); } };
    const onMove = (e: MouseEvent) => { const { mx, my } = at(e); if (drag) { moved = true; drag.fx = mx; drag.fy = my; sim.alpha(0.3); if (!raf) { sim.tick(); paint(); } } else { const h = pick(mx, my); if (h !== hover) { hover = h; canvas.style.cursor = hover ? "pointer" : "grab"; if (!raf) paint(); } } };
    const onUp = () => { if (drag) { drag.fx = null; drag.fy = null; drag = null; } };
    const onClick = (e: MouseEvent) => { if (moved) return; const { mx, my } = at(e); const n = pick(mx, my); if (n) openSym(n.id); };
    const onLeave = () => { if (hover) { hover = null; if (!raf) paint(); } };
    canvas.addEventListener("mousedown", onDown); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); canvas.addEventListener("click", onClick); canvas.addEventListener("mouseleave", onLeave);
    const ro = new ResizeObserver(() => { size(); sim.force("center", forceCenter(W / 2, H / 2)); sim.alpha(0.2); for (let i = 0; i < 60; i++) sim.tick(); paint(); kick(); }); ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); sim.stop(); canvas.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); canvas.removeEventListener("click", onClick); canvas.removeEventListener("mouseleave", onLeave); ro.disconnect(); };
  }, [corr, height]);
  if (!corr || !corr.nodes || !corr.nodes.length) return <div className="lbl" style={{ padding: "14px 4px" }}>Building the market network from correlations…</div>;
  return <div className="constellation-wrap"><canvas ref={ref} className="constellation" style={{ height, width: "100%", display: "block", cursor: "grab" }} /><div className="const-legend"><span><i style={{ background: POS }} />up</span><span><i style={{ background: NEG }} />down</span><span><i style={{ background: CY, height: 2, width: 10, borderRadius: 0 }} />+corr</span><span><i style={{ background: NEG, height: 2, width: 10, borderRadius: 0 }} />−corr</span><span style={{ marginLeft: "auto", color: "var(--ax-dim)" }}>drag · click→open</span></div></div>;
}

/* ── Animated sector treemap (d3 squarified, tiles sized by ~SPX sector weight) ── */
const SECTOR_WEIGHT: Record<string, number> = { XLK: 31, XLF: 13, XLV: 11, XLY: 10, XLC: 9, XLI: 8, XLP: 6, XLE: 4, XLU: 2.5, XLRE: 2.5, XLB: 2 };
interface TmDatum { name: string; etf?: string; chg?: number | null; value?: number; children?: TmDatum[] }
interface Tile { x: number; y: number; w: number; h: number; name: string; etf: string; chg: number | null }
function SectorTreemap({ height = 184 }: { height?: number }) {
  const live = useApexLive();
  const ref = useRef<HTMLDivElement>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const secs = live.sectors;
  useEffect(() => {
    const el = ref.current; if (!el || !secs.length) return;
    const compute = () => {
      const W = el.clientWidth || 320, H = height;
      const data: TmDatum = { name: "root", children: secs.map(s => ({ name: s.name, etf: s.etf, chg: s.changePct, value: SECTOR_WEIGHT[s.etf] || 3 })) };
      const root = hierarchy<TmDatum>(data).sum(d => d.value || 0).sort((a, b) => (b.value || 0) - (a.value || 0));
      const laid = d3treemap<TmDatum>().size([W, H]).paddingInner(2).round(true)(root);
      setTiles(laid.leaves().map(l => ({ x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0, name: l.data.name, etf: l.data.etf || "", chg: l.data.chg ?? null })));
    };
    compute();
    const ro = new ResizeObserver(compute); ro.observe(el);
    return () => ro.disconnect();
  }, [secs, height]);
  // Neutral-at-zero diverging ramp: flat sectors recede into the surface, big movers glow.
  const color = (chg: number | null) => {
    const t = Math.max(-1, Math.min(1, (chg ?? 0) / 2.5)); const k = Math.abs(t);
    const neu = [38, 44, 56], up = [46, 212, 122], dn = [225, 74, 92];
    const tg = t >= 0 ? up : dn; const c = neu.map((n, i) => Math.round(n + (tg[i] - n) * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  return <div ref={ref} className="treemap" style={{ height, position: "relative" }}>
    {tiles.map((t, i) => <div key={t.etf || i} className="tm-tile" style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: color(t.chg) }} onClick={() => t.etf && openSym(t.etf)} title={`${t.name} (${t.etf}) ${t.chg != null ? (t.chg >= 0 ? "+" : "") + t.chg.toFixed(2) + "%" : ""}`}>
      {t.w > 42 && t.h > 24 && <><span className="tm-n">{t.name}</span><span className="tm-c">{t.chg != null ? (t.chg >= 0 ? "+" : "") + t.chg.toFixed(1) + "%" : "—"}</span></>}
    </div>)}
  </div>;
}

/* ── G2 microstructure: order-book heatmap, volume profile, time & sales (BTC) ── */
function DepthHeatmap({ height = 260 }: { height?: number }) {
  const micro = useMicro();
  const ref = useRef<HTMLCanvasElement>(null);
  const hist = micro.depthHistory;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2), W = c.clientWidth || 500, H = height;
    c.width = W * DPR; c.height = H * DPR; const ctx = c.getContext("2d")!; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!hist.length) { ctx.fillStyle = MUT; ctx.font = "11px ui-monospace"; ctx.fillText("streaming BTC order book…", 12, H / 2); return; }
    let lo = Infinity, hi = -Infinity, maxQ = 0;
    hist.forEach(s => { s.bids.forEach(b => { lo = Math.min(lo, b.p); hi = Math.max(hi, b.p); maxQ = Math.max(maxQ, b.q); }); s.asks.forEach(a => { lo = Math.min(lo, a.p); hi = Math.max(hi, a.p); maxQ = Math.max(maxQ, a.q); }); });
    if (!(hi > lo)) return;
    const padL = 46, padR = 6, padB = 13, padT = 6, N = hist.length, colW = (W - padL - padR) / N;
    const Y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * (H - padT - padB);
    hist.forEach((s, i) => { const x = padL + i * colW;
      const cell = (lv: { p: number; q: number }[], base: string) => lv.forEach(l => { const y = Y(l.p), it = Math.min(1, Math.log(1 + l.q) / Math.log(1 + maxQ)); ctx.fillStyle = base + (0.08 + it * 0.6) + ")"; ctx.fillRect(x, y - 1.6, Math.max(1, colW + 0.5), 3.2); });
      cell(s.bids, "rgba(52,211,153,"); cell(s.asks, "rgba(244,85,107,");
    });
    const last = hist[hist.length - 1], bb = last.bids[0]?.p, ba = last.asks[0]?.p;
    if (bb && ba) { const mid = (bb + ba) / 2; ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, Y(mid)); ctx.lineTo(W - padR, Y(mid)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#eafaff"; ctx.font = "8px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("$" + Math.round(mid), padL - 3, Y(mid) + 3); ctx.textAlign = "left"; }
    ctx.fillStyle = MUT; ctx.font = "7px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("$" + Math.round(hi), padL - 3, Y(hi) + 7); ctx.fillText("$" + Math.round(lo), padL - 3, Y(lo)); ctx.textAlign = "left"; ctx.fillText("← " + Math.round(N * 2) + "s", padL, H - 3);
  }, [hist, height]);
  return <div className="depthmap-wrap"><canvas ref={ref} className="depthmap" style={{ height, width: "100%", display: "block" }} /><div className="const-legend"><span><i style={{ background: POS }} />bid liquidity</span><span><i style={{ background: NEG }} />ask liquidity</span><span style={{ marginLeft: "auto", color: "var(--ax-dim)" }}>brightness = resting size · dashed = mid</span></div></div>;
}
function VolumeProfile({ height = 210 }: { height?: number }) {
  const micro = useMicro();
  const ref = useRef<HTMLCanvasElement>(null);
  const vp = micro.volumeProfile;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const DPR = Math.min(devicePixelRatio || 1, 2), W = c.clientWidth || 300, H = height;
    c.width = W * DPR; c.height = H * DPR; const ctx = c.getContext("2d")!; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!vp || !vp.rows.length) { ctx.fillStyle = MUT; ctx.font = "10px ui-monospace"; ctx.fillText("building profile…", 10, H / 2); return; }
    const padL = 44, padR = 8, padT = 4, padB = 4, rows = vp.rows, n = rows.length;
    const maxV = Math.max(...rows.map(r => r.buy + r.sell), 0.0001), rh = (H - padT - padB) / n;
    rows.forEach((r, i) => { const y = H - padB - (i + 1) * rh, w = (W - padL - padR); const bw = (r.buy / maxV) * w, sw = (r.sell / maxV) * w;
      ctx.globalAlpha = r.va ? 1 : 0.5;
      ctx.fillStyle = "rgba(52,211,153,.8)"; ctx.fillRect(padL, y + 0.5, bw, rh - 1);
      ctx.fillStyle = "rgba(244,85,107,.8)"; ctx.fillRect(padL + bw, y + 0.5, sw, rh - 1);
      ctx.globalAlpha = 1;
      if (r.price === vp.poc) { ctx.strokeStyle = "#f5a742"; ctx.lineWidth = 1; ctx.strokeRect(padL, y + 0.5, bw + sw, rh - 1); ctx.fillStyle = WARN; ctx.font = "7px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("POC", padL - 3, y + rh); ctx.textAlign = "left"; }
    });
    ctx.fillStyle = MUT; ctx.font = "7px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("$" + vp.hi, padL - 3, padT + 7); ctx.fillText("$" + vp.lo, padL - 3, H - padB); ctx.textAlign = "left";
    // last price line
    const li = rows.findIndex(r => Math.abs(r.price - vp.last) <= (vp.hi - vp.lo) / n); if (li >= 0) { const y = H - padB - (li + 0.5) * rh; ctx.strokeStyle = "rgba(120,200,255,.7)"; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]); }
  }, [vp, height]);
  return <div><canvas ref={ref} className="volprofile" style={{ height, width: "100%", display: "block" }} />{vp && <div className="lbl" style={{ marginTop: 5 }}>POC ${vp.poc} · value area ${vp.lo}–${vp.hi} · {micro.tradeCount} trades</div>}</div>;
}
function TradeTape() {
  const micro = useMicro();
  const trades = micro.trades.slice(-18).reverse();
  const maxQ = Math.max(...micro.trades.map(t => t.q), 0.001);
  if (!trades.length) return <div className="lbl" style={{ padding: "12px 4px" }}>Waiting for BTC prints…</div>;
  return <div className="tape-list">{trades.map((t, i) => { const buy = t.side === "buy"; const big = t.q > maxQ * 0.5; return <div key={t.t + "-" + i} className={`tp-row${big ? " tp-big" : ""}${i === 0 ? " fresh-in" : ""}`}><span className="tp-side" style={{ color: buy ? POS : NEG }}>{buy ? "▲" : "▼"}</span><span className="num tp-p" style={{ color: buy ? POS : NEG }}>{fmtNum(t.p)}</span><span className="num tp-q">{t.q.toFixed(4)}</span><span className="tp-t">{new Date(t.t).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })}</span></div>; })}</div>;
}

interface Props { onExit: () => void }

export function ApexHome({ onExit }: Props) {
  const [focus, setFocus] = useState<PanelId | null>(null);
  const [mode, setMode] = useState<keyof typeof MODE_CFG>("analyst");
  const [jresp, setJresp] = useState<{ trace: string; text: string } | null>(null);
  const chatRef = useRef<{ role: string; text: string; trace?: string }[]>([]); // room-scoped memory + transcript
  const [chatVer, setChatVer] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [jrespBig, setJrespBig] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [cmdk, setCmdk] = useState(false);
  const [cmdq, setCmdq] = useState("");
  const [cmdSel, setCmdSel] = useState(0);
  const [scrub, setScrub] = useState(false);
  const [activeTab, setActiveTab] = useState("Home");
  const [customize, setCustomize] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<PanelId | null>(null);           // per-widget ⋯ menu
  const [ctxMenu, setCtxMenu] = useState<{ id: PanelId; x: number; y: number } | null>(null); // right-click menu
  const [tray, setTray] = useState(false);                                 // add-widget tray
  const [muted, setMuted] = useState(isMuted());                           // Jarvis UI sound
  const saved = loadJSON<{ layout: Layout; collapsed: Record<string, boolean>; hidden: Record<string, boolean>; widthOv?: Record<string, "third" | "full"> }>(LS_LAYOUT, { layout: DEFAULT_LAYOUT, collapsed: {}, hidden: {} });
  const [widthOv, setWidthOv] = useState<Record<string, "third" | "full">>(saved.widthOv || {});
  const [layout, setLayout] = useState<Layout>(() => {
    const base = saved.layout || DEFAULT_LAYOUT;
    const present = new Set([...base.left, ...base.center, ...base.right]);
    const missing = (Object.keys(PANEL_META) as PanelId[]).filter(id => !present.has(id));
    return missing.length ? { ...base, center: [...base.center, ...missing] } : base;
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(saved.collapsed || {});
  const [hidden, setHidden] = useState<Record<string, boolean>>(saved.hidden || {});
  const [userViews, setUserViews] = useState<Record<string, { layout: Layout; collapsed: Record<string, boolean>; hidden: Record<string, boolean> }>>(loadJSON(LS_VIEWS, {}));
  const [curView, setCurView] = useState<string>(loadJSON(LS_CUR, "Default") as string);

  const cfg = MODE_CFG[mode];
  const live = useApexData();
  const [theme, setTheme] = useState<ThemeId>(() => loadPref(LS_THEME, "cold" as ThemeId));
  const [density, setDensity] = useState<Density>(() => loadPref(LS_DENSITY, "comfortable" as Density));
  const [cheats, setCheats] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [awayDelta, setAwayDelta] = useState<string | null>(null);
  const [alertsMgr, setAlertsMgr] = useState(false);
  const personal = usePersonal({ live, onFire: (_a, msg) => { sfx("alert"); emitToast("🔔", msg, WARN); } });
  useEffect(() => { savePref(LS_THEME, theme); }, [theme]);
  useEffect(() => { savePref(LS_DENSITY, density); }, [density]);
  // create a price alert (from the dossier 🔔 or the manager): prompt for a level
  const promptAlert = (ticker: string, last: number | null) => {
    const raw = window.prompt(`Alert when ${ticker} crosses which price?${last != null ? ` (now $${last.toFixed(2)})` : ""}`, last != null ? last.toFixed(2) : "");
    const v = raw == null ? NaN : parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return;
    personal.addAlert({ ticker, kind: last != null && v < last ? "below" : "above", value: v });
    emitToast("🔔", `Alert set: ${ticker} ${last != null && v < last ? "falls below" : "crosses above"} $${v}`, CY);
  };
  useEffect(() => { _watchToggle = personal.toggleWatch; _newAlert = promptAlert; return () => { _watchToggle = null; _newAlert = null; }; });
  // Jarvis mode reshapes which panels are expanded (mode-aware deck)
  useEffect(() => {
    const MODE_COLLAPSE: Record<string, PanelId[]> = {
      analyst: [], trader: ["rotation", "corr", "internals", "heatmap"], quant: ["orderbook", "unusual", "overview"], research: ["orderbook", "rotation", "corr"],
    };
    setCollapsed(asSet(MODE_COLLAPSE[mode] || []));
  }, [mode]);
  const openBrief = (type = "now") => { setBriefOpen(true); setBrief(null); fetchBrief(type).then(setBrief); };

  // "Since you were away" — compare to the snapshot from the last visit (once, on first live data).
  const liveRef = useRef(live); liveRef.current = live;
  const snapDone = useRef(false);
  useEffect(() => {
    if (snapDone.current || !live.updated || !live.regime) return;
    snapDone.current = true;
    const prev = loadPref<{ score: number; news: string; spx: number | null; at: number } | null>(LS_SNAP, null);
    if (!prev) return;
    const spx = live.session.find(s => s.ticker === "^GSPC")?.changePct ?? null;
    const mins = prev.at ? Math.round((Date.now() - prev.at) / 60000) : 0;
    if (mins < 3) return;
    const parts: string[] = [];
    if (Math.abs(live.regime.score - prev.score) >= 4) parts.push(`regime ${prev.score}→${live.regime.score}`);
    if (spx != null) parts.push(`S&P ${spx >= 0 ? "+" : ""}${spx.toFixed(2)}%`);
    const curNews = live.news[0]?.title || "";
    if (curNews && curNews !== prev.news) parts.push("new top story");
    if (parts.length) setAwayDelta(`Since you were away (${mins < 60 ? mins + "m" : Math.round(mins / 60) + "h"}): ${parts.join(" · ")}`);
  }, [live.updated, live.regime]);
  useEffect(() => {
    const save = () => { const l = liveRef.current; if (l.regime) savePref(LS_SNAP, { score: l.regime.score, news: l.news[0]?.title || "", spx: l.session.find(s => s.ticker === "^GSPC")?.changePct ?? null, at: Date.now() }); };
    const iv = window.setInterval(save, 60000);
    return () => { save(); clearInterval(iv); };
  }, []);
  const jinputRef = useRef<HTMLInputElement>(null);
  const reqId = useRef(0);
  const dragId = useRef<PanelId | null>(null);
  const openRef = useRef(false); openRef.current = cmdk || !!drawer || !!focus || scrub || viewsOpen || cheats || briefOpen || alertsMgr || !!menuFor || !!ctxMenu || tray;
  const cycleRef = useRef<(d: number) => void>(() => {});
  const exitRef = useRef(onExit); exitRef.current = onExit;

  useEffect(() => { _openSym = (s) => setDrawer(s); return () => { _openSym = null; }; }, []);
  useEffect(() => { _askJarvis = (p) => { setDrawer(null); jStream(p); }; return () => { _askJarvis = null; }; }, []);
  useEffect(() => { localStorage.setItem(LS_LAYOUT, JSON.stringify({ layout, collapsed, hidden, widthOv })); }, [layout, collapsed, hidden, widthOv]);
  useEffect(() => {
    if (!menuFor) return;
    const h = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!t.closest(".pmenu") && !t.closest(".pmenu-btn")) setMenuFor(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuFor]);
  // Magnetic hover — top-bar controls gently pull toward the cursor.
  useEffect(() => {
    if (reduceMotion()) return;
    const sel = ".apex-home .top .ic, .apex-home .kbd, .apex-home .exit, .apex-home .views";
    const move = (e: Event) => { const el = e.currentTarget as HTMLElement; const pe = e as PointerEvent; const r = el.getBoundingClientRect(); el.style.transform = `translate(${(pe.clientX - (r.left + r.width / 2)) * 0.28}px, ${(pe.clientY - (r.top + r.height / 2)) * 0.34}px)`; };
    const leave = (e: Event) => { (e.currentTarget as HTMLElement).style.transform = ""; };
    let els: HTMLElement[] = [];
    const wire = () => { els = Array.from(document.querySelectorAll<HTMLElement>(sel)); els.forEach(el => { el.addEventListener("pointermove", move); el.addEventListener("pointerleave", leave); }); };
    const t = window.setTimeout(wire, 400); // after the board mounts
    return () => { window.clearTimeout(t); els.forEach(el => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerleave", leave); el.style.transform = ""; }); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdk(v => !v); setCmdq(""); setCmdSel(0); }
      else if (e.key === "Escape") { if (openRef.current) { setCmdk(false); setDrawer(null); setFocus(null); setScrub(false); setViewsOpen(false); setCheats(false); setBriefOpen(false); setAlertsMgr(false); setMenuFor(null); setCtxMenu(null); setTray(false); } else exitRef.current(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { cycleRef.current(e.key === "ArrowRight" ? 1 : -1); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function jStream(promptRaw?: string) {
    const prompt = (promptRaw ?? "").trim(); if (!prompt) return;
    const id = ++reqId.current; const c = MODE_CFG[mode];
    setJresp({ trace: c.trace, text: "" });
    const ctx = `[APEX Trading Room — ${mode} mode] You are JARVIS inside the APEX stock & crypto trading command center. Be precise and data-driven; separate market facts from thesis and opinion. (Room UI data is currently simulated.)\nCONTINUITY: this is an ongoing conversation — keep the SAME ticker/subject as the previous turn for short or pronoun follow-ups like "price", "next", "and now?", "what about it". Only switch assets when the user explicitly names a new one; never default to Bitcoin or a whole-market snapshot unless the user asks for the market.\nFORMAT: reply in plain prose. Do NOT use markdown headers (#), bold (**), or bullet lists unless the user asks for a list.`;
    const history = chatRef.current.slice(-12).map(t => ({ role: t.role, text: t.text }));
    let acc = "";
    try {
      await streamPost<unknown>("/api/chat/stream", { prompt, context: ctx, history, mode: "chat" }, (d: string) => { if (id !== reqId.current) return; acc += d; setJresp({ trace: c.trace, text: acc }); });
      if (id === reqId.current && acc) {
        chatRef.current.push({ role: "user", text: prompt }, { role: "model", text: acc, trace: c.trace });
        if (chatRef.current.length > 80) chatRef.current.splice(0, chatRef.current.length - 80);
        setChatVer(v => v + 1);
      }
    } catch (e) {
      if (id === reqId.current) setJresp({ trace: c.trace, text: acc || ("⚠ Couldn't reach the Jarvis brain — " + (e instanceof Error ? e.message : String(e)) + ". Make sure the backend is running.") });
    }
  }

  function downloadTranscript() {
    const body = chatRef.current.map(t => `${t.role === "user" ? "You" : (t.trace || "Jarvis")}:\n${t.role === "model" ? cleanJarvis(t.text) : t.text}\n`).join("\n");
    const blob = new Blob([`APEX — Jarvis Transcript\n${new Date().toLocaleString()}\n\n${body}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "apex-jarvis-transcript.txt"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /* layout ops */
  const colOf = (id: PanelId): keyof Layout => (["left","center","right"] as (keyof Layout)[]).find(c => layout[c].includes(id))!;
  function movePanel(from: PanelId, toCol: keyof Layout, before?: PanelId) {
    setLayout(L => {
      const next: Layout = { left: L.left.filter(x => x !== from), center: L.center.filter(x => x !== from), right: L.right.filter(x => x !== from) };
      const arr = next[toCol]; const idx = before ? arr.indexOf(before) : arr.length;
      arr.splice(idx < 0 ? arr.length : idx, 0, from); return next;
    });
  }
  function nudge(id: PanelId, dir: number) {
    const col = colOf(id); setLayout(L => { const arr = [...L[col]]; const i = arr.indexOf(id); const j = i + dir; if (j < 0 || j >= arr.length) return L; [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...L, [col]: arr }; });
  }
  const toggleCollapse = (id: PanelId) => setCollapsed(c => ({ ...c, [id]: !c[id] }));
  const hidePanel = (id: PanelId) => setHidden(h => ({ ...h, [id]: true }));
  const showPanel = (id: PanelId) => setHidden(h => { const n = { ...h }; delete n[id]; return n; });
  const effWidth = (id: PanelId): "third" | "full" => widthOv[id] || (PANEL_META[id].w === "third" ? "third" : "full");
  const toggleWidth = (id: PanelId) => setWidthOv(w => ({ ...w, [id]: effWidth(id) === "full" ? "third" : "full" }));

  function applyView(name: string) {
    setCurView(name); localStorage.setItem(LS_CUR, JSON.stringify(name)); setViewsOpen(false);
    if (PRESETS[name]) { setLayout(DEFAULT_LAYOUT); setCollapsed(asSet(PRESETS[name].collapsed)); setHidden(asSet(PRESETS[name].hidden)); }
    else if (userViews[name]) { const v = userViews[name]; setLayout(v.layout); setCollapsed(v.collapsed); setHidden(v.hidden); }
  }
  function saveCurrentView() {
    const name = window.prompt("Save this layout as…", "My View"); if (!name) return;
    const next = { ...userViews, [name]: { layout, collapsed, hidden } };
    setUserViews(next); localStorage.setItem(LS_VIEWS, JSON.stringify(next)); setCurView(name); localStorage.setItem(LS_CUR, JSON.stringify(name)); setViewsOpen(false);
  }
  function deleteView(name: string) { const next = { ...userViews }; delete next[name]; setUserViews(next); localStorage.setItem(LS_VIEWS, JSON.stringify(next)); if (curView === name) applyView("Default"); }

  function highlightPanel(id: PanelId) {
    if (hidden[id]) setHidden(h => ({ ...h, [id]: false }));
    if (collapsed[id]) setCollapsed(c => ({ ...c, [id]: false }));
    setActiveTab("Home");
    setTimeout(() => { const el = document.getElementById("apx-panel-" + id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("src-hl"); setTimeout(() => el.classList.remove("src-hl"), 1200); } }, 60);
  }

  /* command palette actions */
  const liveTicks = Array.from(new Set([
    ...live.movers.stocks.gainers.map(x => x.ticker), ...live.movers.stocks.losers.map(x => x.ticker),
    ...live.movers.crypto.gainers.map(x => x.ticker), ...TICKS,
  ]));
  // Every panel in the registry becomes a jump target — the palette reaches all of them.
  const panelCmds = (Object.keys(PANEL_META) as PanelId[]).map((id) => [PANEL_META[id].icon, "Jump to " + PANEL_META[id].title, "panel", id, "Panels"] as Cmd);
  const CMDS: Cmd[] = [
    ["✦","Open Market Brief","brief","now","Actions","B"],
    ["✦","Ask Jarvis · top opportunities","jarvis","What are the top opportunities right now?","Actions"],
    ["◎","Ask Jarvis · portfolio review","jarvis","review my portfolio","Actions"],
    ["✎","Customize layout","action","customize","Actions"],
    ["◔","Keyboard shortcuts","action","cheats","Actions","?"],
    ["↺","Reset layout to default","action","reset","Actions"],
    ["＋","New price alert","action","alerts","Actions","A"],
    ["◈","Go to Live Markets","nav","Live Markets","Navigate"],["◱","Go to Scanner","nav","Scanner","Navigate"],["◮","Go to Risk","nav","Risk","Navigate"],["◫","Go to Backtesting","nav","Backtesting","Navigate"],["◎","Go to Portfolio","nav","Portfolio","Navigate"],["▤","Go to News","nav","News","Navigate"],
    ...panelCmds,
    ["◧","Mode · Analyst","mode","analyst","Modes","1"],["▨","Mode · Trader","mode","trader","Modes","2"],["◫","Mode · Quant","mode","quant","Modes","3"],["▤","Mode · Research","mode","research","Modes","4"],
    ["◐","Theme · Cold Steel","theme","cold","Display"],["◑","Theme · Midnight","theme","midnight","Display"],["◒","Theme · High Contrast","theme","contrast","Display"],
    ["▦","Density · Comfortable","density","comfortable","Display"],["▦","Density · Compact","density","compact","Display"],["▦","Density · Dense","density","dense","Display"],
    ...liveTicks.map((t) => ["$", "Open " + t, "ticker", t, "Tickers"] as Cmd),
  ];
  const cmdQ = cmdq.toLowerCase().trim();
  const cmdFiltered = cmdQ ? CMDS.filter(c => c[1].toLowerCase().includes(cmdQ) || String(c[3]).toLowerCase().includes(cmdQ) || (c[4] || "").toLowerCase().includes(cmdQ)) : CMDS;
  const cmdShown = cmdFiltered.slice(0, 60);
  cycleRef.current = (dir: number) => { if (!drawer || !liveTicks.length) return; const i = liveTicks.indexOf(drawer); const n = liveTicks.length; setDrawer(liveTicks[(((i < 0 ? 0 : i) + dir) % n + n) % n]); };
  function runCmd(c: Cmd) {
    sfx("select");
    setCmdk(false);
    if (c[2] === "ticker") setDrawer(c[3]);
    else if (c[2] === "panel") highlightPanel(c[3] as PanelId);
    else if (c[2] === "nav") setActiveTab(c[3]);
    else if (c[2] === "jarvis") jStream(c[3]);
    else if (c[2] === "brief") openBrief(c[3]);
    else if (c[2] === "mode") setMode(c[3] as keyof typeof MODE_CFG);
    else if (c[2] === "theme") setTheme(c[3] as ThemeId);
    else if (c[2] === "density") setDensity(c[3] as Density);
    else if (c[2] === "action") {
      if (c[3] === "customize") setCustomize(v => !v);
      else if (c[3] === "cheats") setCheats(true);
      else if (c[3] === "reset") applyView("Default");
      else if (c[3] === "alerts") setAlertsMgr(true);
    }
    else emitToast("◈", "→ " + c[1], CY);
  }

  // Tab switch with a View-Transition cross-fade where supported (feature-detected).
  const goTab = (t: string) => { sfx("tick"); const d = document as Document & { startViewTransition?: (cb: () => void) => void }; if (d.startViewTransition && !reduceMotion()) d.startViewTransition(() => setActiveTab(t)); else setActiveTab(t); };
  const openPalette = () => { sfx("open"); setCmdk(true); setCmdq(""); setCmdSel(0); };
  useHotkeys({
    "mod+k": openPalette,
    "/": openPalette,
    "?": () => setCheats(c => !c),
    b: () => openBrief("now"),
    a: () => setAlertsMgr(true),
    "1": () => { sfx("mode"); setMode("analyst"); }, "2": () => { sfx("mode"); setMode("trader"); }, "3": () => { sfx("mode"); setMode("quant"); }, "4": () => { sfx("mode"); setMode("research"); },
  });

  /* panel body */
  function body(id: PanelId): React.ReactNode {
    switch (id) {
      case "pulse": {
        const r = live.regime; const it = live.internals;
        const tag = r ? (r.score >= 54 ? "pos" : r.score < 46 ? "neg" : "") : "";
        const fgCol = r ? (r.fearGreed >= 58 ? POS : r.fearGreed >= 43 ? WARN : NEG) : MUT;
        return <>
          <div className="pulse-top"><Ring v={r ? r.score / 100 : 0} size={84} txt={r ? String(r.score) : "—"} sub="/100" />
            <div><div className="lbl">Regime</div><div className={`regime-tag ${tag}`}>{r ? r.label : "computing…"}</div>
              <div className="lbl" style={{ marginTop: 7 }}>Fear &amp; Greed</div><div className="num" style={{ fontSize: 11, color: fgCol, marginTop: 1 }}>{r ? `${r.fearGreed} · ${r.fearGreedLabel}` : "—"}</div></div></div>
          <div className="submetrics">
            <div className="sm"><div className="lbl">Breadth <Info k="breadth" /></div><div className={`v ${r && r.pctUp != null ? (r.pctUp >= .5 ? "pos" : "neg") : ""}`}>{r && r.pctUp != null ? Math.round(r.pctUp * 100) + "%" : "—"}</div></div>
            <div className="sm"><div className="lbl">VIX <Info k="vix" /></div><div className="v warn">{r && r.vix != null ? r.vix.toFixed(1) : "—"}</div></div>
            <div className="sm"><div className="lbl">Momentum <Info k="momentum" /></div><div className={`v ${r && r.momentum != null ? (r.momentum >= 0 ? "pos" : "neg") : ""}`}>{r && r.momentum != null ? (r.momentum >= 0 ? "+" : "") + r.momentum.toFixed(2) + "%" : "—"}</div></div></div>
          {it && <div style={{ marginTop: 11 }}>
            <div className="lbl" style={{ marginBottom: 5 }}>Market Breadth · {it.advancers.toLocaleString()} adv / {it.decliners.toLocaleString()} dec</div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,.06)" }}><div style={{ width: `${(r && r.pctUp != null ? r.pctUp : 0) * 100}%`, background: POS }} /><div style={{ flex: 1, background: NEG }} /></div>
          </div>}</>;
      }
      case "portfolio": return <>
        <div className="row"><div><div className="lbl">Total Value</div><LivePV /></div><div style={{ textAlign: "right" }}><div className="lbl">Today</div><div className="num pos" style={{ fontSize: 14 }}>+2.79%</div><div className="num pos" style={{ fontSize: 10.5 }}>+$4,182.11</div></div></div>
        <StaticCanvas height={38} className="spark" style={{ marginTop: 7 }} draw={(c, w, h) => drawSpark(c, w, h, walk(60, 100, 1.4).map((v, i) => v + i * .15), POS)} />
        <div className="donut-wrap"><Donut /><div className="alloc">{ALLOC.map((d, i) => <div key={i} className="a"><span className="sw" style={{ background: d[2] }} />{d[0]}<span className="ap">{d[1]}%</span></div>)}</div></div>
        <div className="riskchips">
          <div className="rc" onClick={() => emitToast("◮", "VaR 95%: −$3,240 (1-day historical). Monte Carlo P5: −$4,110.", WARN)}><div className="lbl">VaR 95</div><div className="v neg">−$3,240</div></div>
          <div className="rc" onClick={() => emitToast("◮", "Portfolio β 0.92 vs SPX · downside β 1.08 (asymmetric crash risk).", WARN)}><div className="lbl">Beta</div><div className="v">0.92</div></div>
          <div className="rc" onClick={() => emitToast("◮", "Concentration 31% in top holding (NVDA) — above the 25% guardrail.", WARN)}><div className="lbl">Concen.</div><div className="v warn">31%</div></div>
        </div></>;
      case "bots": return <>
        <div className="botstats"><div><div className="lbl">Active</div><div className="v">12</div></div><div><div className="lbl">Win Rate</div><div className="v pos">78%</div></div><div><div className="lbl">Day P&amp;L</div><div className="v pos">+$612</div></div></div>
        <div className="lbl" style={{ marginBottom: 6 }}>Battle Leaderboard</div>
        <div className="lead">{BOTS.map((b, i) => { const up = b[3] === POS; return <div key={i} className="lr"><span className="rk">{b[1]}</span><span className="nm">{b[0]}</span><StaticCanvas height={15} draw={(c, w, h) => { const d = walk(20, 10, up ? 1 : 1.2).map((v, j) => up ? v + j * .2 : v - j * .1); const mn = Math.min(...d), mx = Math.max(...d), rg = mx - mn || 1; c.beginPath(); d.forEach((v, j) => { const X = j / (d.length - 1) * w, Y = h - 2 - (v - mn) / rg * (h - 4); j ? c.lineTo(X, Y) : c.moveTo(X, Y); }); c.strokeStyle = up ? POS : NEG; c.lineWidth = 1.2; c.stroke(); }} /><span className={`pl ${up ? "pos" : "neg"}`}>{b[3]}</span></div>; })}</div></>;
      case "overview": return <>
        {live.session.length > 0 && <div className="sess-strip">
          {live.session.map(s => <div key={s.ticker} className="sess" onClick={() => setDrawer(s.ticker)}>
            <span className="sess-n" title={s.name}>{s.name}</span>
            <span className={`dchip ${(s.changePct ?? 0) >= 0 ? "pos" : "neg"}`}>{fmtPct(s.changePct)}</span>
            <span className="sess-last num">{fmtNum(s.last)}</span>
            <span className={`sess-gap num ${(s.gap ?? 0) >= 0 ? "pos" : "neg"}`}>gap {s.gap != null ? (s.gap >= 0 ? "+" : "") + s.gap.toFixed(2) + "%" : "—"}</span>
          </div>)}
        </div>}
        <div className="mkt-grid">
          <div className="mapwrap"><span className="map-tag">Indices · 30-Day Performance</span><IndexPerfChart height={174} /></div>
          <div className="idx-col">
            {(live.indices.length ? live.indices.slice(0, 3).map(q => {
              const up = (q.changePct ?? 0) >= 0; return { name: INDEX_NAME[q.ticker] || q.name || q.ticker, last: q.last, pct: fmtPct(q.changePct), col: up ? POS : NEG, raw: q.ticker };
            }) : [{ name: "S&P 500", last: null as number | null, pct: "—", col: POS, raw: "^GSPC" }, { name: "NASDAQ", last: null as number | null, pct: "—", col: POS, raw: "^IXIC" }, { name: "VIX", last: null as number | null, pct: "—", col: NEG, raw: "^VIX" }]).map((x, i) => (
              <div key={i} className="idx" onClick={() => setDrawer(x.raw)}><div className="row"><span className="in">{x.name}</span><span className={`dchip ${x.col === POS ? "pos" : "neg"}`}>{x.pct}</span></div><div className="iv"><FlashNum v={x.last} fmt={n => fmtNum(n)} /></div></div>
            ))}
          </div>
        </div>
        <div className="statrow">
          {(() => { const cg = live.cryptoGlobal; const up = (cg?.mcapChangePct ?? 0) >= 0; return <>
            <div className="st"><div className="lbl">Crypto Mkt Cap</div><div className="sv">{cg ? "$" + (cg.totalMcap / 1e12).toFixed(2) + "T" : "—"}</div><div className={`sc ${up ? "pos" : "neg"}`}>{cg ? fmtPct(cg.mcapChangePct) : ""}</div></div>
            <div className="st"><div className="lbl">24h Volume</div><div className="sv">{cg ? "$" + (cg.volume / 1e9).toFixed(1) + "B" : "—"}</div><div className="sc" style={{ color: "var(--ax-mut)" }}>crypto</div></div>
            <div className="st"><div className="lbl">BTC Dom. <Info k="btcDom" /></div><div className="sv">{cg ? cg.btcDom.toFixed(1) + "%" : "—"}</div><div className="sc" style={{ color: "var(--ax-mut)" }}>ETH {cg ? cg.ethDom.toFixed(1) + "%" : "—"}</div></div>
          </>; })()}
          <div className="st fg-gauge" onClick={() => { const r = live.regime; emitToast("◈", r ? `Fear & Greed ${r.fearGreed} (${r.fearGreedLabel}) — composite of VIX ${r.vix?.toFixed(1)}, breadth ${r.pctUp != null ? Math.round(r.pctUp * 100) + "%" : "—"}, index momentum ${r.momentum != null ? r.momentum.toFixed(2) + "%" : "—"}.` : "Fear & Greed computing from live VIX, breadth, and momentum.", CY); }}><div className="lbl">Fear &amp; Greed <Info k="fearGreed" /></div><FGGauge score={live.regime ? live.regime.fearGreed : 50} label={live.regime ? live.regime.fearGreedLabel : "—"} /></div>
          <div className="st"><div className="lbl">Regime <Info k="regime" /></div><div className="sv" style={{ fontSize: 13, color: live.regime ? (live.regime.score >= 54 ? POS : live.regime.score < 46 ? NEG : MUT) : MUT }}>{live.regime ? live.regime.score : "—"}</div><div className="sc" style={{ color: "var(--ax-mut)" }}>{live.regime ? live.regime.label : "…"}</div></div>
        </div></>;
      case "movers": {
        const m = live.movers;
        const col = (title: string, arr: typeof m.stocks.gainers, up: boolean) => {
          const peak = Math.max(1, ...arr.map(x => Math.abs(x.changePct || 0)));
          return (
          <div className="mv-col">
            <div className="mv-h" style={{ color: up ? POS : NEG }}>{up ? "▲" : "▼"} {title}</div>
            {arr.length ? arr.map((x, i) => { const p = x.changePct || 0; return <div key={i} className="mv-r" onClick={() => openSym(x.ticker)}>
              <span className="tk">{x.ticker}</span>
              <span className="num mv-px">{fmtNum(x.last, x.last != null && x.last < 10 ? 4 : 2)}</span>
              <span className={`dchip ${p >= 0 ? "pos" : "neg"}`}>{fmtPct(x.changePct)}</span>
              <span className="mv-bar"><i style={{ width: `${Math.min(100, Math.abs(p) / peak * 100)}%`, background: p >= 0 ? POS : NEG }} /></span>
            </div>; }) : <div className="lbl" style={{ padding: "6px 2px" }}>—</div>}
          </div>
        ); };
        return <div className="movers-grid">
          {col("Stocks", m.stocks.gainers, true)}
          {col("Stocks", m.stocks.losers, false)}
          {col("Crypto", m.crypto.gainers, true)}
          {col("Crypto", m.crypto.losers, false)}
        </div>;
      }
      case "constellation": return <MarketConstellation />;
      case "depthmap": return <DepthHeatmap />;
      case "volprofile": return <VolumeProfile />;
      case "tape": return <TradeTape />;
      case "rotation": return <div className="quad"><SectorRRG /></div>;
      case "internals": {
        const it = live.internals;
        if (!it || it.pctUp == null) return <div className="lbl" style={{ padding: "12px 4px" }}>Computing market breadth…</div>;
        const pu = it.pctUp, adr = it.decliners ? (it.advancers / it.decliners) : 0;
        const rows: [string, number, string][] = [["Advancing", Math.round(pu * 100), pu >= .5 ? POS : NEG], ["Declining", Math.round((1 - pu) * 100), (1 - pu) > .5 ? NEG : WARN], ["A/D Ratio", Math.min(100, Math.round(adr * 50)), adr >= 1 ? POS : NEG]];
        return <>
          <div className="breadth">{rows.map((b, i) => <div key={i} className="bg-item"><span className="bn">{b[0]}</span><span className="bar"><i style={{ width: `${b[1]}%`, background: b[2], boxShadow: `0 0 6px ${b[2]}88` }} /></span><span className="bv" style={{ color: b[2] }}>{b[0] === "A/D Ratio" ? adr.toFixed(2) : b[1] + "%"}</span></div>)}</div>
          <div className="lbl" style={{ marginTop: 8 }}>{it.advancers.toLocaleString()} advancers · {it.decliners.toLocaleString()} decliners · US stocks (live)</div></>;
      }
      case "unusual": {
        const rows = live.insider.filter(t => t.change).slice(0, 8);
        if (!rows.length) return <div className="lbl" style={{ padding: "12px 4px" }}>{live.updated ? "No recent insider filings for watchlist names." : "Loading insider filings…"}</div>;
        return <div className="unusual">{rows.map((t, i) => { const buy = t.side === "buy"; const sh = Math.abs(t.change); return <div key={i} className="ua"><span className="ut tk" onClick={() => openSym(t.ticker)}>{t.ticker}</span><span className="ud" title={t.name}>{(t.name || "").slice(0, 16)} · {buy ? "buy" : t.side === "sell" ? "sell" : "filing"}</span><span className="uz" style={{ color: buy ? POS : NEG }}>{buy ? "+" : "−"}{sh >= 1000 ? (sh / 1000).toFixed(0) + "k" : sh}</span></div>; })}</div>;
      }
      case "heatmap": return <SectorTreemap />;
      case "corr": return <CorrelationMatrix />;
      case "fng": return <FearGreedGauge />;
      case "attention": return <WikiAttention openSym={openSym} />;
      case "form4": return <SecForm4Tape />;
      case "btcnet": return <BtcNetworkHeat />;
      case "risklab": return <RiskLabPanel />;
      case "anomaly": return <AnomalyScanner openSym={openSym} />;
      case "ekg": return <BreadthEKG />;
      case "mandala": return <MarketMandala />;
      case "orderbook": return <StaticCanvas height={150} className="vizc" draw={(c, w, h) => drawBook(c, w, h, live.book)} />;
      case "quick": return <div className="qa">{([["▨","Paper Trade","Simulate"],["◫","Backtest","Test rules"],["◪","Portfolio","Holdings"],["⬡","Deploy Bot","Automate"],["◉","Live Test","Real-time"]] as const).map((q, i) => <div key={i} className="qab" onClick={() => emitToast(q[0], `Opening ${q[1]} — arrives with its tab.`, CY)}><span className="qi">{q[0]}</span><span className="qn">{q[1]}</span><span className="qs">{q[2]}</span></div>)}</div>;
      case "news": return <NewsRiver />;
      case "insights": {
        const r = live.regime; const m = live.movers; const secs = live.sectors;
        const topGain = m.stocks.gainers[0], topLose = m.stocks.losers[0];
        const best = secs.length ? [...secs].sort((a, b) => b.changePct - a.changePct)[0] : null;
        const worst = secs.length ? [...secs].sort((a, b) => a.changePct - b.changePct)[0] : null;
        const tenY = (live.macro || []).find(x => x.series === "DGS10");
        return <>
          <div className="ai-brief">{r ? <>Regime is <b style={{ color: r.score >= 54 ? POS : r.score < 46 ? NEG : WARN }}>{r.label}</b> ({r.score}/100){r.momentum != null ? <> — indices {r.momentum >= 0 ? "up" : "down"} {Math.abs(r.momentum).toFixed(2)}% today</> : ""}. Breadth {r.pctUp != null ? Math.round(r.pctUp * 100) + "% advancing" : "—"}, VIX {r.vix != null ? r.vix.toFixed(1) : "—"}<span className="cite" onClick={() => highlightPanel("internals")}>[1]</span>.{best && worst ? <> {best.name} {best.changePct >= 0 ? "+" : ""}{best.changePct.toFixed(1)}% leads, {worst.name} {worst.changePct.toFixed(1)}% lags<span className="cite" onClick={() => highlightPanel("heatmap")}>[2]</span>.</> : null}</> : "Computing live market read…"}</div>
          {topGain && <div className="ins-block"><div className="it">Top Mover</div><div className="ix">{topGain.ticker} +{topGain.changePct != null ? topGain.changePct.toFixed(1) : "—"}% leads gainers{topLose ? <>; {topLose.ticker} {topLose.changePct != null ? topLose.changePct.toFixed(1) : "—"}% worst</> : ""}<span className="cite" onClick={() => highlightPanel("movers")}>[3]</span>.</div></div>}
          <div className="ins-block"><div className="it">Risk Watch</div><div className="ix">{r && r.vix != null ? (r.vix > 20 ? `Elevated VIX ${r.vix.toFixed(1)} — hedged posture warranted` : `VIX ${r.vix.toFixed(1)} contained`) : "VIX —"}{tenY && tenY.value != null ? `; 10Y Treasury at ${tenY.value}%` : ""}<span className="cite" onClick={() => highlightPanel("pulse")}>[4]</span>.</div></div>
          <div className="pr" style={{ marginTop: 10, display: "inline-block" }} onClick={() => openBrief("now")}>View full brief →</div></>;
      }
      case "alerts": return <>
        <div className="ua-head"><span className="lbl">My Alerts · {personal.alerts.filter(a => !a.firedAt).length} active</span><span className="ua-new" onClick={() => setAlertsMgr(true)}>+ New</span></div>
        {personal.alerts.length ? <div className="ua-alerts">{personal.alerts.slice(0, 4).map(a => <div key={a.id} className={`ua-al${a.firedAt ? " fired" : ""}`}><span className={`ua-dot ${a.firedAt ? "fired" : "live"}`} /><span className="tk" onClick={() => openSym(a.ticker)}>{a.ticker}</span><span className="ua-cond">{alertText(a)}</span><span className="ua-x" onClick={() => personal.removeAlert(a.id)}>✕</span></div>)}</div> : <div className="lbl" style={{ padding: "4px 2px 8px" }}>No alerts set — press A, click + New, or 🔔 on any stock.</div>}
        <div className="lbl" style={{ margin: "12px 0 6px" }}>Live Signals</div>
        <AlertsFeed />
      </>;
    }
  }

  function renderPanel(id: PanelId, col: keyof Layout, idx = 0) {
    if (hidden[id]) return null;
    const m = PANEL_META[id]; const isCol = collapsed[id]; const isFull = effWidth(id) === "full";
    return <div key={id} id={"apx-panel-" + id} className={`pnl${isFull ? " span3" : ""}${focus === id ? " focused" : ""}${customize ? " cz" : ""}`} style={stagger(idx)}
      draggable={customize} onDragStart={e => { if (customize) { dragId.current = id; e.dataTransfer.effectAllowed = "move"; } }}
      onDragOver={e => { if (customize) e.preventDefault(); }} onDrop={e => { if (!customize) return; e.preventDefault(); const from = dragId.current; dragId.current = null; if (from && from !== id) movePanel(from, col, id); }}
      onDoubleClick={() => { if (!customize) { sfx("focus"); setFocus(f => f === id ? null : id); } }}
      onContextMenu={e => { if (customize) return; e.preventDefault(); sfx("tick"); setCtxMenu({ id, x: e.clientX, y: e.clientY }); }}>
      <div className="ph"><span className="pi">{m.icon}</span><span className="pt">{m.title}</span>
        {!customize && m.badge && <span className={`badge ${m.badge.cls}`} style={{ marginLeft: "auto" }}>{m.badge.t}</span>}
        {!customize && !m.badge && m.pr && <span className="pr" style={{ marginLeft: "auto" }}>{m.pr}</span>}
        {!customize && !m.badge && m.headerRight && <div style={{ marginLeft: "auto" }}>{m.headerRight}</div>}
        {!customize && <button className={`pmenu-btn${menuFor === id ? " on" : ""}`} title="Panel options"
          style={m.badge || m.pr || m.headerRight ? undefined : { marginLeft: "auto" }}
          onClick={e => { e.stopPropagation(); sfx("tick"); setMenuFor(v => v === id ? null : id); }}>⋯</button>}
        {customize && <span className="cz-ctl" style={{ marginLeft: "auto" }}>
          <i onClick={() => toggleCollapse(id)} title={isCol ? "Expand" : "Collapse"}>{isCol ? "▸" : "▾"}</i>
          <i onClick={() => nudge(id, -1)} title="Move up">↑</i>
          <i onClick={() => nudge(id, 1)} title="Move down">↓</i>
          <i onClick={() => hidePanel(id)} title="Hide">✕</i>
        </span>}
      </div>
      {!customize && menuFor === id && panelMenu(id, col, "pmenu")}
      {!isCol && body(id)}
    </div>;
  }

  /* Shared per-widget action menu (used by ⋯ dropdown and right-click context menu). */
  function panelMenu(id: PanelId, col: keyof Layout, cls: string) {
    const isCol = collapsed[id]; const isFull = effWidth(id) === "full";
    const close = () => { setMenuFor(null); setCtxMenu(null); };
    const act = (fn: () => void) => () => { fn(); close(); };
    const idx = layout[col].indexOf(id);
    return <div className={cls} onClick={e => e.stopPropagation()}>
      <div className="pmenu-i" onClick={act(() => setFocus(f => f === id ? null : id))}><span>◳</span>{focus === id ? "Exit focus" : "Focus panel"}</div>
      <div className="pmenu-i" onClick={act(() => toggleCollapse(id))}><span>{isCol ? "▸" : "▾"}</span>{isCol ? "Expand" : "Collapse"}</div>
      <div className="pmenu-i" onClick={act(() => toggleWidth(id))}><span>⇔</span>{isFull ? "Half width" : "Full width"}</div>
      <div className="pmenu-sep" />
      <div className={`pmenu-i${idx <= 0 ? " off" : ""}`} onClick={act(() => nudge(id, -1))}><span>↑</span>Move up</div>
      <div className={`pmenu-i${idx >= layout[col].length - 1 ? " off" : ""}`} onClick={act(() => nudge(id, 1))}><span>↓</span>Move down</div>
      <div className="pmenu-sep" />
      <div className="pmenu-i danger" onClick={act(() => hidePanel(id))}><span>✕</span>Hide panel</div>
    </div>;
  }

  const hiddenIds = (Object.keys(hidden) as PanelId[]).filter(id => hidden[id] && PANEL_META[id]);

  return (
    <ApexDataContext.Provider value={live}>
    <div className={`apex-home${focus ? " focusmode" : ""}`} data-theme={theme} data-density={density} style={{ ["--ax-acc" as string]: cfg.acc }}>
      <div className="top">
        <div className="brand"><div><div className="mk">APEX</div><div className="sub">Trading Command Center</div></div></div>
        <div className="tabs">{TABS.map(t => <div key={t} className={`tab${t === activeTab ? " on" : ""}`} onClick={() => goTab(t)}>{t}</div>)}</div>
        <div className="topr">
          <span className="kbd" onClick={() => { setCmdk(true); setCmdq(""); setCmdSel(0); }}>⌘K</span>
          <AnimCanvas height={20} drawFrame={drawHeartbeat} className="hb" />
          <div className={`fresh${(!live.updated || Date.now() - live.updated > 30000) ? " stale" : ""}`}><span className="dot" />{(!live.updated || Date.now() - live.updated > 30000) ? "DELAYED" : "LIVE"} · <Clock /></div>
          <div className="views-wrap">
            <div className={`views${viewsOpen ? " on" : ""}`} onClick={() => setViewsOpen(v => !v)}>⊞ {curView} ▾</div>
            {viewsOpen && <div className="views-menu">
              <div className="vm-lbl">Presets</div>
              {Object.keys(PRESETS).map(n => <div key={n} className={`vm-i${curView === n ? " on" : ""}`} onClick={() => applyView(n)}>{n}</div>)}
              {Object.keys(userViews).length > 0 && <><div className="vm-sep" /><div className="vm-lbl">Saved</div>{Object.keys(userViews).map(n => <div key={n} className={`vm-i${curView === n ? " on" : ""}`} onClick={() => applyView(n)}>{n}<span className="vm-x" onClick={e => { e.stopPropagation(); deleteView(n); }}>✕</span></div>)}</>}
              <div className="vm-sep" /><div className="vm-lbl">Theme</div>
              <div className="vm-swatches">{THEMES.map(t => <div key={t.id} className={`vm-sw${theme === t.id ? " on" : ""}`} title={t.name} onClick={() => setTheme(t.id)}><span style={{ background: t.swatch }} />{t.name}</div>)}</div>
              <div className="vm-lbl">Density</div>
              <div className="vm-seg">{DENSITIES.map(d => <div key={d.id} className={`vm-segi${density === d.id ? " on" : ""}`} onClick={() => setDensity(d.id)}>{d.name}</div>)}</div>
              <div className="vm-sep" />
              <div className="vm-i" onClick={() => { setCustomize(c => !c); }}>{customize ? "✓ Done customizing" : "✎ Customize layout"}</div>
              <div className="vm-i" onClick={saveCurrentView}>＋ Save current as…</div>
              <div className="vm-i" onClick={() => setCheats(true)}>⌨ Keyboard shortcuts <span className="cg">?</span></div>
            </div>}
          </div>
          <div className="ic" title="Add widgets" onClick={() => { sfx("tray"); setTray(true); }}>⊞</div>
          <div className="ic" title={muted ? "Sound off" : "Sound on"} onClick={() => setMuted(toggleMute())} style={!muted ? { color: "var(--ax-cy)" } : undefined}>{muted ? "🔇" : "🔊"}</div>
          <div className="ic" title="Time replay" onClick={() => setScrub(s => !s)}>⟲</div>
          <div className="ic">🔔<span className="nd" /></div>
          <div className="ic" title="Customize" onClick={() => setCustomize(c => !c)} style={customize ? { color: "var(--ax-cy)", borderColor: "var(--ax-bd)" } : undefined}>✎</div>
          <div className="exit" onClick={onExit}>Exit</div>
        </div>
      </div>

      <div className="tape"><div className="track">{(() => {
        const items: { sym: string; raw: string; last: number | null; pct: number | null; star?: boolean }[] = [];
        personal.watchlist.forEach(t => { const q = personal.quotes[t]; items.push({ sym: t.replace(/USDT$/, ""), raw: t, last: q?.last ?? null, pct: q?.changePct ?? null, star: true }); });
        live.indices.forEach(i => items.push({ sym: INDEX_NAME[i.ticker] || i.ticker, raw: i.ticker, last: i.last, pct: i.changePct ?? null }));
        Object.values(live.crypto).forEach(c => items.push({ sym: c.ticker.replace(/USDT$/, ""), raw: c.ticker, last: c.last, pct: c.changePct ?? null }));
        live.gainers.filter(g => g.changePct == null || Math.abs(g.changePct) < 100).slice(0, 14).forEach(g => items.push({ sym: g.ticker, raw: g.ticker, last: g.last, pct: g.changePct ?? null }));
        const list = items.length ? items : TICKS.map(t => ({ sym: t, raw: t, last: null as number | null, pct: null as number | null, star: false }));
        return list.concat(list).map((t, i) => { const up = (t.pct ?? 0) >= 0; return <span key={i} className="ti"><b className="tk" onClick={() => openSym(t.raw)}>{t.star ? "★" : ""}{t.sym}</b> <span className="num">{fmtNum(t.last)}</span> <span className={`num ${up ? "pos" : "neg"}`}>{t.pct == null ? "" : (up ? "▲" : "▼") + Math.abs(t.pct).toFixed(2) + "%"}</span></span>; });
      })()}</div></div>

      {activeTab === "Home" ? (
        <>
          {customize && hiddenIds.length > 0 && <div style={{ padding: "6px 12px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="lbl">Hidden:</span>{hiddenIds.map(id => <span key={id} className="chip" style={{ cursor: "pointer" }} onClick={() => setHidden(h => ({ ...h, [id]: false }))}>+ {PANEL_META[id].title}</span>)}
          </div>}
          {awayDelta && <div className="away-banner"><span className="ab-i">◔</span><span>{awayDelta}</span><span className="ab-b" onClick={() => openBrief("now")}>Full brief →</span><span className="ab-x" onClick={() => setAwayDelta(null)}>✕</span></div>}
          <div className="grid">
            <div className="col">{layout.left.map((id, i) => renderPanel(id, "left", i))}</div>
            <div className="col col--grid">{layout.center.map((id, i) => renderPanel(id, "center", i + 2))}</div>
            <div className="col">{layout.right.map((id, i) => renderPanel(id, "right", i + 1))}</div>
          </div>
        </>
      ) : (
        activeTab === "Forge" ? <ForgeView onSound={sfx as (n: string) => void} /> :
        activeTab === "Live Markets" ? <LiveMarketsView /> :
        activeTab === "Portfolio" ? <PortfolioView /> :
        activeTab === "Paper Trading" ? <PaperTradingView /> :
        activeTab === "Backtesting" ? <BacktestView /> :
        activeTab === "Trading Bots" ? <TradingBotsView /> :
        activeTab === "Live Testing" ? <LiveTestingView /> :
        activeTab === "News" ? <NewsView /> :
        activeTab === "Scanner" ? <ScannerView /> :
        activeTab === "Risk" ? <RiskView /> :
        <div className="grid" style={{ display: "block" }}><div className="tab-ph">
          <div className="tph-i">◲</div><div className="tph-t">{activeTab}</div>
          <div className="tph-s">This tab is on the roadmap.</div>
          <div className="tph-b" onClick={() => setActiveTab("Home")}>← Back to Home</div>
        </div></div>
      )}

      {/* Jarvis bar */}
      <div className="aibar">
        <div className="aibar-h"><span className="pi" style={{ color: "var(--ax-acc)" }}>✦</span><span className="t">Jarvis Assistant</span><span className="jv-on">● Online</span>
          <div className="modes">{(Object.keys(MODE_CFG) as (keyof typeof MODE_CFG)[]).map(m => <div key={m} className={`mode${mode === m ? " on" : ""}`} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</div>)}</div>
          <button className="jbtn-log" title="Full chat transcript" onClick={() => { setChatVer(v => v); setTranscriptOpen(true); }}>⧉ Transcript{chatRef.current.length ? ` (${Math.ceil(chatRef.current.length / 2)})` : ""}</button>
          <span className="trace"><b>{cfg.trace}</b></span></div>
        <div className="aibar-in"><input ref={jinputRef} placeholder={cfg.ph} onKeyDown={e => { if (e.key === "Enter") { jStream((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ""; } }} /><span className="mic">🎙</span><span className="send" onClick={() => { jStream(jinputRef.current?.value); if (jinputRef.current) jinputRef.current.value = ""; }}>➤</span></div>
        <div className="chips">{cfg.chips.map((ch, i) => <div key={i} className="ac" onClick={() => jStream(ch.replace(/^\S+\s/, ""))}>{ch}</div>)}</div>
        {jresp && <div className="jresp"><div className="rt"><b>{jresp.trace}</b> · {jresp.text ? "streaming…" : "thinking…"}{jresp.text && <span className="jresp-exp" onClick={() => setJrespBig(true)}>⤢ expand</span>}</div><div className="jresp-body">{cleanJarvis(jresp.text)}</div></div>}
      </div>

      {transcriptOpen && <div className="tray-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("tray-back")) setTranscriptOpen(false); }}>
        <div className="jtrans" data-ver={chatVer}>
          <div className="jtrans-h"><span className="jtrans-t">✦ Jarvis Transcript · APEX <span className="lbl">{Math.ceil(chatRef.current.length / 2)} exchanges</span></span>
            <div className="jtrans-act"><button className="jbtn-log" onClick={downloadTranscript} disabled={!chatRef.current.length}>⭳ Export .txt</button><span className="x" onClick={() => setTranscriptOpen(false)}>✕</span></div></div>
          <div className="jtrans-body">
            {chatRef.current.length === 0 ? <div className="lbl" style={{ padding: 20 }}>No conversation yet — ask Jarvis something and it will appear here in full.</div> :
              chatRef.current.map((t, i) => <div key={i} className={`jturn ${t.role}`}>
                <div className="jturn-role">{t.role === "user" ? "You" : (t.trace || "Jarvis")}</div>
                <div className="jturn-text">{t.role === "model" ? cleanJarvis(t.text) : t.text}</div>
              </div>)}
          </div>
        </div></div>}

      {jrespBig && jresp && <div className="tray-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("tray-back")) setJrespBig(false); }}>
        <div className="jtrans">
          <div className="jtrans-h"><span className="jtrans-t">{jresp.trace}</span><span className="x" onClick={() => setJrespBig(false)}>✕</span></div>
          <div className="jtrans-body"><div className="jturn-text" style={{ fontSize: 13 }}>{cleanJarvis(jresp.text)}</div></div>
        </div></div>}

      {scrub && <TimeScrub />}

      {tray && <div className="tray-back" onClick={e => { if ((e.target as HTMLElement).classList.contains("tray-back")) setTray(false); }}>
        <div className="tray">
          <div className="tray-h"><span className="tray-t">Widget Library</span><span className="x" onClick={() => setTray(false)}>✕</span></div>
          <div className="tray-sub lbl">Click to add or remove widgets from your board</div>
          <div className="tray-grid">
            {(Object.keys(PANEL_META) as PanelId[]).map(id => {
              const on = !hidden[id];
              return <div key={id} className={`tray-card${on ? " on" : ""}`} onClick={() => on ? hidePanel(id) : (showPanel(id), setTimeout(() => highlightPanel(id), 80))}>
                <span className="tray-ic">{PANEL_META[id].icon}</span>
                <span className="tray-nm">{PANEL_META[id].title}</span>
                <span className="tray-act">{on ? "On board" : "＋ Add"}</span>
              </div>;
            })}
          </div>
        </div>
      </div>}

      {ctxMenu && <div className="ctx-back" onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}>
        <div className="ctxmenu" style={{ left: Math.min(ctxMenu.x, window.innerWidth - 180), top: Math.min(ctxMenu.y, window.innerHeight - 260) }}>
          <div className="ctxmenu-h">{PANEL_META[ctxMenu.id].title}</div>
          {panelMenu(ctxMenu.id, colOf(ctxMenu.id), "pmenu")}
        </div>
      </div>}

      {cmdk && <div className="cmdk" onClick={e => { if ((e.target as HTMLElement).classList.contains("cmdk")) setCmdk(false); }}>
        <div className="cmdk-box">
          <div className="cmdk-top"><span className="cmdk-ic">⌘</span>
            <input className="cmdk-in" autoFocus placeholder="Jump to anything — ticker, panel, action, mode…" value={cmdq}
              onChange={e => { setCmdq(e.target.value); setCmdSel(0); }}
              onKeyDown={e => { const items = cmdShown; if (e.key === "ArrowDown") { e.preventDefault(); sfx("tick"); setCmdSel(s => Math.min(s + 1, items.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); sfx("tick"); setCmdSel(s => Math.max(0, s - 1)); } else if (e.key === "Enter") { const c = items[cmdSel]; if (c) runCmd(c); } }} />
            <span className="cmdk-esc">esc</span>
          </div>
          <div className="cmdk-list">{cmdShown.map((c, i) => {
            const showHead = i === 0 || c[4] !== cmdShown[i - 1][4];
            return <div key={i}>
              {showHead && c[4] && <div className="cmdk-head">{c[4]}</div>}
              <div className={`cmdk-i${i === cmdSel ? " sel" : ""}`} onMouseMove={() => setCmdSel(i)} onClick={() => runCmd(c)}>
                <span className="ci">{c[0]}</span><span className="cl">{c[1]}</span>
                {c[5] && <span className="csk">{c[5]}</span>}
              </div>
            </div>;
          })}
          {!cmdShown.length && <div className="cmdk-empty">No matches for “{cmdq}”.</div>}</div>
          <div className="cmdk-foot"><span><b>↑↓</b> navigate</span><span><b>⏎</b> run</span><span><b>esc</b> close</span></div>
        </div>
      </div>}

      <div className={`drawer${drawer ? " show" : ""}`}>{drawer && <DrawerBody sym={drawer} onClose={() => setDrawer(null)} onCycle={d => cycleRef.current(d)} watched={personal.isWatched(drawer.replace(/^\^/, "").replace(/USDT$/i, ""))} />}</div>

      {briefOpen && <div className="bc-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("bc-overlay")) setBriefOpen(false); }}>
        <div className="briefcard">
          <div className="bc-h"><span className="bc-title">✦ Market Brief</span>{brief?.regime && <span className={`bc-tag ${brief.regime.score >= 54 ? "pos" : brief.regime.score < 46 ? "neg" : ""}`}>{brief.regime.label} {brief.regime.score}</span>}<span className="x" onClick={() => setBriefOpen(false)}>✕</span></div>
          {!brief ? <div className="lbl" style={{ padding: 24 }}>Assembling brief from live data…</div> : <div className="bc-body">
            <div className="bc-headline">{brief.headline}</div>
            <div className="bc-narr">{brief.narrative}</div>
            {brief.regime && <div className="bc-chips">
              <div className="bc-chip"><span className="lbl">Regime</span><b className={brief.regime.score >= 54 ? "pos" : brief.regime.score < 46 ? "neg" : ""}>{brief.regime.score}</b></div>
              <div className="bc-chip"><span className="lbl">Fear/Greed</span><b>{brief.regime.fearGreed}</b></div>
              <div className="bc-chip"><span className="lbl">VIX</span><b>{brief.regime.vix != null ? brief.regime.vix.toFixed(1) : "—"}</b></div>
              <div className="bc-chip"><span className="lbl">Breadth</span><b>{brief.regime.breadthPctUp != null ? Math.round(brief.regime.breadthPctUp * 100) + "%" : "—"}</b></div>
            </div>}
            {brief.watch.length > 0 && <div className="bc-sec"><div className="bc-st">Things to Watch</div><ul className="bc-watch">{brief.watch.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
            <div className="bc-2col">
              <div className="bc-sec"><div className="bc-st">Movers <span className="cite" onClick={() => { setBriefOpen(false); highlightPanel("movers"); }}>↗</span></div>
                {brief.movers.gainers.map((x, i) => <div key={"g" + i} className="bc-mv" onClick={() => setDrawer(x.ticker)}><span className="tk">{x.ticker}</span><span className="num pos">{fmtPct(x.changePct)}</span></div>)}
                {brief.movers.losers.map((x, i) => <div key={"l" + i} className="bc-mv" onClick={() => setDrawer(x.ticker)}><span className="tk">{x.ticker}</span><span className="num neg">{fmtPct(x.changePct)}</span></div>)}
              </div>
              <div className="bc-sec"><div className="bc-st">Macro</div>{brief.macro.map((x, i) => <div key={i} className="bc-mv"><span className="tk" style={{ fontWeight: 400, color: "var(--ax-mut)" }}>{x.series}</span><span className="num">{x.value}{x.unit === "%" ? "%" : ""}</span></div>)}</div>
            </div>
            <div className="bc-sec"><div className="bc-st">Top News <span className="cite" onClick={() => { setBriefOpen(false); highlightPanel("news"); }}>↗</span></div>{brief.topNews.slice(0, 4).map((n, i) => <div key={i} className="bc-news"><span className="sent" style={{ background: CY }} /><span className="bc-nt">{n.title}</span>{n.tickers[0] && <span className="tag" onClick={() => setDrawer(n.tickers[0])}>{n.tickers[0]}</span>}</div>)}</div>
            <div className="bc-actions"><div className="dr-act primary" onClick={() => { setBriefOpen(false); askJarvis("Expand on the current market brief and tell me what to watch, using apex_market_snapshot."); }}>✦ Discuss with Jarvis</div></div>
          </div>}
        </div>
      </div>}

      {alertsMgr && <div className="bc-overlay" onClick={e => { if ((e.target as HTMLElement).classList.contains("bc-overlay")) setAlertsMgr(false); }}>
        <div className="briefcard" style={{ width: 440 }}>
          <div className="bc-h"><span className="bc-title">🔔 Price Alerts</span><span className="x" onClick={() => setAlertsMgr(false)}>✕</span></div>
          <div className="bc-body">
            <AlertForm onAdd={a => personal.addAlert(a)} />
            <div className="bc-sec" style={{ marginTop: 14 }}><div className="bc-st">Alerts · evaluated live every 15s</div>
              {personal.alerts.length ? personal.alerts.map(a => <div key={a.id} className="am-row"><span className={`ua-dot ${a.firedAt ? "fired" : "live"}`} /><span className="tk" onClick={() => { setAlertsMgr(false); openSym(a.ticker); }}>{a.ticker}</span><span className="am-cond">{alertText(a)}</span>{a.firedAt ? <span className="am-fired">✓ triggered</span> : <span className="am-watching">watching</span>}<span className="am-x" onClick={() => personal.removeAlert(a.id)}>✕</span></div>) : <div className="lbl" style={{ padding: "8px 2px" }}>No alerts yet. Add one above — it fires a toast when the price crosses your level.</div>}
            </div>
          </div>
        </div>
      </div>}

      {cheats && <div className="cheats" onClick={e => { if ((e.target as HTMLElement).classList.contains("cheats")) setCheats(false); }}>
        <div className="cheats-box">
          <div className="cheats-h"><span>⌨ Keyboard Shortcuts</span><span className="x" onClick={() => setCheats(false)}>✕</span></div>
          <div className="cheats-list">{HOTKEY_HELP.map(([k, d], i) => <div key={i} className="cheats-row"><kbd>{k}</kbd><span>{d}</span></div>)}</div>
        </div>
      </div>}

      <ToastLayer />
    </div>
    </ApexDataContext.Provider>
  );
}

function TimeScrub() {
  const [p, setP] = useState(1);
  const secsAgo = Math.round((1 - p) * 180);
  return <div className="scrub">
    <span className="lv" style={{ color: p >= .99 ? POS : MUT }} onClick={() => setP(1)}>● LIVE</span>
    <div className="rail" onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setP(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}>
      <div className="fill" style={{ width: `${p * 100}%` }} /><div className="hd" style={{ left: `${p * 100}%` }} />
    </div>
    <span className="tt">{secsAgo === 0 ? "Now · 12:43:07" : `−${secsAgo}s · replaying`}</span>
  </div>;
}

const TF_STOCK = [{ k: "1D", r: "1d", tf: "5m", intra: true }, { k: "5D", r: "5d", tf: "30m", intra: true }, { k: "1M", r: "1mo", tf: "1d", intra: false }, { k: "6M", r: "6mo", tf: "1d", intra: false }, { k: "1Y", r: "1y", tf: "1d", intra: false }, { k: "5Y", r: "5y", tf: "1wk", intra: false }];
const TF_CRYPTO = [{ k: "1D", r: "1d", tf: "15m", intra: true }, { k: "5D", r: "5d", tf: "1h", intra: true }, { k: "1M", r: "1mo", tf: "1d", intra: false }, { k: "6M", r: "6mo", tf: "1d", intra: false }, { k: "1Y", r: "1y", tf: "1d", intra: false }, { k: "5Y", r: "5y", tf: "1w", intra: false }];

function drawVolCone(ctx: Ctx, w: number, h: number, cone: { w: number; min: number; p25: number; median: number; p75: number; max: number; cur: number }[]) {
  ctx.clearRect(0, 0, w, h);
  if (!cone || !cone.length) { ctx.fillStyle = MUT; ctx.font = "10px ui-monospace"; ctx.fillText("no vol data", 8, h / 2); return; }
  const pad = { l: 28, r: 8, t: 8, b: 15 };
  const yMax = Math.max(...cone.map(c => c.max), ...cone.map(c => c.cur)) * 1.05, yMin = Math.max(0, Math.min(...cone.map(c => c.min)) * 0.9);
  const X = (i: number) => pad.l + (i / (cone.length - 1)) * (w - pad.l - pad.r);
  const Y = (v: number) => h - pad.b - ((v - yMin) / (yMax - yMin || 1)) * (h - pad.t - pad.b);
  const band = (hi: (c: typeof cone[number]) => number, lo: (c: typeof cone[number]) => number, fill: string) => { ctx.beginPath(); cone.forEach((c, i) => { const x = X(i), y = Y(hi(c)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); for (let i = cone.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(lo(cone[i]))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  band(c => c.max, c => c.min, "rgba(60,140,220,.10)");
  band(c => c.p75, c => c.p25, "rgba(60,140,220,.22)");
  ctx.beginPath(); cone.forEach((c, i) => { const x = X(i), y = Y(c.median); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = "rgba(150,190,225,.6)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); cone.forEach((c, i) => { const x = X(i), y = Y(c.cur); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = CY; ctx.lineWidth = 2; ctx.stroke();
  cone.forEach((c, i) => { ctx.beginPath(); ctx.arc(X(i), Y(c.cur), 2.5, 0, 7); ctx.fillStyle = "#eafaff"; ctx.fill(); });
  ctx.fillStyle = MUT; ctx.font = "7px ui-monospace"; ctx.textAlign = "center"; cone.forEach((c, i) => ctx.fillText(c.w + "d", X(i), h - 4)); ctx.textAlign = "right"; ctx.fillText(Math.round(yMax) + "%", pad.l - 3, Y(yMax) + 7); ctx.fillText(Math.round(yMin) + "%", pad.l - 3, Y(yMin)); ctx.textAlign = "left";
}
function drawMCFan(ctx: Ctx, w: number, h: number, mc: { S0: number; days: number; bands: { t: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]; paths: number[][]; target: number | null }) {
  ctx.clearRect(0, 0, w, h);
  if (!mc || !mc.bands.length) { ctx.fillStyle = MUT; ctx.font = "10px ui-monospace"; ctx.fillText("simulating…", 8, h / 2); return; }
  const pad = { l: 40, r: 8, t: 8, b: 15 }, b = mc.bands, N = b.length;
  let lo = mc.S0, hi = mc.S0; b.forEach(x => { lo = Math.min(lo, x.p5); hi = Math.max(hi, x.p95); }); mc.paths.forEach(p => p.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); })); if (mc.target != null) { lo = Math.min(lo, mc.target); hi = Math.max(hi, mc.target); }
  const m = (hi - lo) * 0.05; lo -= m; hi += m;
  const X = (t: number) => pad.l + (t / N) * (w - pad.l - pad.r);
  const Y = (v: number) => h - pad.b - ((v - lo) / (hi - lo || 1)) * (h - pad.t - pad.b);
  const band = (loK: "p5" | "p25", hiK: "p95" | "p75", fill: string) => { ctx.beginPath(); ctx.moveTo(X(0), Y(mc.S0)); b.forEach(x => ctx.lineTo(X(x.t), Y(x[hiK]))); for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(X(b[i].t), Y(b[i][loK])); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  band("p5", "p95", "rgba(60,140,220,.10)"); band("p25", "p75", "rgba(60,140,220,.22)");
  ctx.lineWidth = 0.6; ctx.strokeStyle = "rgba(150,200,255,.16)"; mc.paths.forEach(p => { ctx.beginPath(); p.forEach((v, t) => { const x = X(t), y = Y(v); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(X(0), Y(mc.S0)); b.forEach(x => ctx.lineTo(X(x.t), Y(x.p50))); ctx.strokeStyle = CY; ctx.lineWidth = 1.8; ctx.stroke();
  ctx.beginPath(); ctx.arc(X(0), Y(mc.S0), 3, 0, 7); ctx.fillStyle = "#eafaff"; ctx.fill();
  if (mc.target != null) { ctx.strokeStyle = "rgba(245,167,66,.7)"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(pad.l, Y(mc.target)); ctx.lineTo(w - pad.r, Y(mc.target)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = WARN; ctx.font = "7px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("$" + mc.target, w - pad.r, Y(mc.target) - 3); ctx.textAlign = "left"; }
  ctx.fillStyle = MUT; ctx.font = "7px ui-monospace"; ctx.textAlign = "right"; ctx.fillText("$" + Math.round(hi), pad.l - 3, Y(hi) + 7); ctx.fillText("$" + Math.round(lo), pad.l - 3, Y(lo)); ctx.textAlign = "left"; ctx.fillText(mc.days + "d →", w - pad.r - 20, h - 4);
}

function RangeBar({ lo, hi, val, marks }: { lo: number | null; hi: number | null; val: number | null; marks?: { v: number | null; c: string; label: string }[] }) {
  if (lo == null || hi == null || val == null || hi <= lo) return null;
  const pos = (x: number) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));
  return <div className="rangebar">
    <div className="rb-track"><div className="rb-fill" style={{ width: pos(val) + "%" }} /><div className="rb-dot" style={{ left: pos(val) + "%" }} />
      {(marks || []).map((m, i) => m.v != null ? <div key={i} className="rb-mark" style={{ left: pos(m.v) + "%", background: m.c }} title={`${m.label} ${fmtNum(m.v)}`} /> : null)}
    </div>
    <div className="rb-ends"><span className="num">{fmtNum(lo)}</span><span className="num">{fmtNum(hi)}</span></div>
  </div>;
}

function DrawerBody({ sym, onClose, onCycle, watched }: { sym: string; onClose: () => void; onCycle?: (dir: number) => void; watched?: boolean }) {
  const isCrypto = /USDT?$/i.test(sym) || sym === "BTC" || sym === "ETH";
  const isIndex = sym.startsWith("^");
  const cash = sym.replace(/^\^/, "").replace(/USDT$/i, "");
  const TFS = isCrypto ? TF_CRYPTO : TF_STOCK;
  const [tfIdx, setTfIdx] = useState(3); // default 6M
  const [chartBars, setChartBars] = useState<Bar[] | null>(null);
  const [dailyBars, setDailyBars] = useState<Bar[] | null>(null); // 1y daily for header stats
  const [quote, setQuote] = useState<{ last: number | null; changePct?: number | null } | null>(null);
  const [impact, setImpact] = useState<{ title: string; dir: string; magnitude: number; sector: string }[]>([]);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [fundDone, setFundDone] = useState(false);
  const [insider, setInsider] = useState<Insider[]>([]);
  const [vol, setVol] = useState<VolReport | null>(null);
  const [mc, setMc] = useState<MCReport | null>(null);

  // per-symbol loads (stats bars, quote, news, fundamentals, insider, realized vol, monte carlo)
  useEffect(() => {
    let alive = true;
    setDailyBars(null); setQuote(null); setImpact([]); setFund(null); setFundDone(false); setInsider([]); setVol(null); setMc(null); setTfIdx(3);
    fetchBars(sym, "1d", "1y").then(b => alive && setDailyBars(b));
    fetchQuote(sym).then(q => alive && setQuote(q));
    fetchNewsImpact(cash).then(im => alive && setImpact(im));
    if (!isIndex) { fetchVol(sym).then(v => alive && setVol(v)); fetchMonteCarlo(sym, 30).then(x => alive && setMc(x)); } // realized vol + MC projection from public prices
    if (!isCrypto && !isIndex) { fetchFundamentals(cash).then(f => { if (alive) { setFund(f); setFundDone(true); } }); fetchInsider(cash).then(x => alive && setInsider(x)); }
    return () => { alive = false; };
  }, [sym]);

  // chart bars per timeframe
  useEffect(() => {
    let alive = true; setChartBars(null);
    const t = TFS[tfIdx];
    fetchBars(sym, t.tf, t.r).then(b => alive && setChartBars(b));
    return () => { alive = false; };
  }, [sym, tfIdx]);

  const dc = (dailyBars || []).filter(b => b.c != null);
  const lastBar = dc.length ? dc[dc.length - 1] : null;
  const prevBar = dc.length > 1 ? dc[dc.length - 2] : null;
  const last = quote?.last ?? (lastBar ? lastBar.c : null);
  const prevClose = prevBar ? prevBar.c : null;
  const pct = quote?.changePct ?? (last != null && prevClose ? ((last - prevClose) / prevClose) * 100 : null);
  const up = (pct ?? 0) >= 0;
  const gap = lastBar && prevClose ? ((lastBar.o - prevClose) / prevClose) * 100 : null;
  const hi52 = fund?.high52 ?? (dc.length ? Math.max(...dc.map(b => b.h)) : null);
  const lo52 = fund?.low52 ?? (dc.length ? Math.min(...dc.map(b => b.l)) : null);
  const cur = TFS[tfIdx];

  return <>
    <div className="dr-h">
      <span className="sym">{sym}</span>
      <span className="tag" style={{ color: isCrypto ? PUR : isIndex ? WARN : CY, border: `1px solid ${(isCrypto ? PUR : isIndex ? WARN : CY)}55` }}>{isCrypto ? "CRYPTO" : isIndex ? "INDEX" : "EQUITY"}</span>
      {onCycle && <span className="dr-cyc"><i onClick={() => onCycle(-1)} title="Previous (←)">‹</i><i onClick={() => onCycle(1)} title="Next (→)">›</i></span>}
      <span className="x" onClick={onClose}>✕</span>
    </div>
    <div className={`dr-px ${up ? "pos" : "neg"}`}>{last != null ? "$" : ""}<FlashNum v={last} fmt={n => fmtNum(n)} /> <span style={{ fontSize: 14 }}>{pct != null ? (up ? "▲" : "▼") + " " + Math.abs(pct).toFixed(2) + "%" : ""}</span>{gap != null && Math.abs(gap) >= 0.05 ? <span className="dr-gap" style={{ color: gap >= 0 ? POS : NEG }}>gap {gap >= 0 ? "+" : ""}{gap.toFixed(2)}%</span> : null}</div>

    <div className="dr-ranges">
      <div className="dr-rng"><div className="rb-lab">Day range</div><RangeBar lo={lastBar ? lastBar.l : null} hi={lastBar ? lastBar.h : null} val={last} marks={[{ v: prevClose, c: MUT, label: "prev close" }, { v: lastBar ? lastBar.o : null, c: CY, label: "open" }]} /></div>
      <div className="dr-rng"><div className="rb-lab">52-week <Info k="range52" /></div><RangeBar lo={lo52} hi={hi52} val={last} /></div>
    </div>

    <div className="dr-tfs">{TFS.map((t, i) => <span key={t.k} className={`dr-tf${i === tfIdx ? " on" : ""}`} onClick={() => setTfIdx(i)}>{t.k}</span>)}</div>
    {chartBars && chartBars.length ? <DossierChart bars={chartBars} intraday={cur.intra} height={230} /> : <div className="dossier-chart placeholder" style={{ height: 230 }}>{chartBars ? "no chart data" : "loading chart…"}</div>}

    <div className="dr-sec"><div className="st2">Key Stats</div><div className="dr-stats">
      {([["Last", last != null ? "$" + fmtNum(last) : "—", undefined], ["Change", pct != null ? fmtPct(pct) : "—", up ? POS : NEG], ["Gap", gap != null ? (gap >= 0 ? "+" : "") + gap.toFixed(2) + "%" : "—", gap != null ? (gap >= 0 ? POS : NEG) : undefined], ["Day H", lastBar ? "$" + fmtNum(lastBar.h) : "—", undefined], ["Day L", lastBar ? "$" + fmtNum(lastBar.l) : "—", undefined], ["Volume", lastBar && lastBar.v ? (lastBar.v / 1e6).toFixed(1) + "M" : "—", undefined]] as [string, string, string | undefined][]).map((s, i) => <div key={i} className="dr-stat"><div className="lbl">{s[0]}</div><div className="v" style={s[2] ? { color: s[2] } : undefined}>{s[1]}</div></div>)}
    </div></div>

    {vol && vol.cone.length > 0 && (() => { const c30 = vol.cone.find(c => c.w === 30) || vol.cone[0]; const rich = c30.cur >= c30.p75, cheap = c30.cur <= c30.p25; return <div className="dr-sec"><div className="st2">Realized-Vol Cone <span className="lbl" style={{ fontWeight: 400 }}>· annualized, 2-yr history</span></div>
      <StaticCanvas height={118} className="vizc" draw={(ctx, w, h) => drawVolCone(ctx, w, h, vol.cone)} />
      <div className="dr-cone"><span className="lbl">30d RV</span> <b className="num" style={{ color: rich ? NEG : cheap ? POS : CY }}>{c30.cur}%</b> <span className="num" style={{ color: "var(--ax-mut)" }}>{rich ? "rich (upper quartile)" : cheap ? "cheap (lower quartile)" : "mid-range"} · band {c30.min}–{c30.max}</span></div>
    </div>; })()}
    {mc && mc.bands.length > 0 && <div className="dr-sec"><div className="st2">Monte-Carlo Projection <span className="lbl" style={{ fontWeight: 400 }}>· 2,000 GBM paths · {mc.days}d</span></div>
      <StaticCanvas height={132} className="vizc" draw={(ctx, w, h) => drawMCFan(ctx, w, h, mc)} />
      <div className="dr-stats" style={{ marginTop: 8 }}>
        {([["Drift (ann)", (mc.driftAnnPct >= 0 ? "+" : "") + mc.driftAnnPct + "%", mc.driftAnnPct >= 0 ? POS : NEG], ["Vol (ann)", mc.volAnnPct + "%", WARN], ["Median 30d", "$" + fmtNum(mc.bands[mc.bands.length - 1].p50), undefined], ["90% band", "$" + Math.round(mc.bands[mc.bands.length - 1].p5) + "–" + Math.round(mc.bands[mc.bands.length - 1].p95), undefined]] as [string, string, string | undefined][]).map((s, i) => <div key={i} className="dr-stat"><div className="lbl">{s[0]}</div><div className="v" style={s[2] ? { color: s[2] } : undefined}>{s[1]}</div></div>)}
      </div>
      <div className="lbl" style={{ marginTop: 6 }}>Fan = 5/25/50/75/95th-percentile outcomes from historical drift &amp; vol (illustrative, not advice).</div>
    </div>}
    {!isCrypto && !isIndex && <div className="dr-sec"><div className="st2">Fundamentals <span className="lbl" style={{ fontWeight: 400 }}>· Alpha Vantage</span></div>{fund ? <div className="dr-stats">{([["Mkt Cap", fund.marketCap != null ? "$" + (fund.marketCap / 1e9).toFixed(1) + "B" : "—"], ["P/E", fund.pe != null ? fund.pe.toFixed(1) : "—"], ["EPS", fund.eps != null ? "$" + fund.eps.toFixed(2) : "—"], ["Beta", fund.beta != null ? fund.beta.toFixed(2) : "—"], ["Div Yield", fund.divYield != null ? (fund.divYield * 100).toFixed(2) + "%" : "—"], ["Sector", fund.sector || "—"]] as [string, string][]).map((s, i) => <div key={i} className="dr-stat"><div className="lbl">{s[0]}</div><div className="v">{s[1]}</div></div>)}</div> : <div className="lbl" style={{ padding: "6px 2px" }}>{fundDone ? "Fundamentals unavailable (Alpha Vantage rate limit — 5/min · 25/day — or symbol not covered)." : "Loading fundamentals…"}</div>}</div>}

    <div className="dr-sec"><div className="st2">News Impact</div>{impact.length ? <div className="news" style={{ marginTop: 4 }}>{impact.slice(0, 4).map((n, i) => <div key={i} className="ni"><span className="sent" style={{ background: n.dir === "bullish" ? POS : NEG }} /><div className="body"><div className="hl" style={{ fontSize: 11 }}>{n.title}</div><div className="meta"><span className="src">{n.dir} · {n.sector || "broad"}</span></div></div></div>)}</div> : <div className="lbl" style={{ padding: "6px 2px" }}>No mapped news impact for {sym} yet.</div>}</div>

    {!isCrypto && !isIndex && <div className="dr-sec"><div className="st2">Insider Activity <Info k="insider" /></div>{insider.filter(t => t.change).length ? <div className="dr-ins">{insider.filter(t => t.change).slice(0, 6).map((t, i) => { const buy = t.side === "buy"; const sh = Math.abs(t.change); return <div key={i} className="dr-ins-r"><span className="di-nm" title={t.name}>{(t.name || "").slice(0, 20)}</span><span className={`di-side ${buy ? "pos" : "neg"}`}>{buy ? "BUY" : t.side === "sell" ? "SELL" : "FILE"}</span><span className="num di-sh">{buy ? "+" : "−"}{sh >= 1000 ? (sh / 1000).toFixed(0) + "k" : sh}</span><span className="num di-pr">{t.price ? "$" + fmtNum(t.price) : "—"}</span><span className="di-dt">{(t.date || "").slice(5)}</span></div>; })}</div> : <div className="lbl" style={{ padding: "6px 2px" }}>No recent insider filings.</div>}</div>}

    <div className="dr-actions">
      <div className={`dr-act${watched ? " on" : ""}`} onClick={() => { watchToggle(cash); emitToast("★", `${cash} ${watched ? "removed from" : "added to"} watchlist`, watched ? MUT : CY); }}>{watched ? "★ Watching" : "☆ Watchlist"}</div>
      <div className="dr-act" onClick={() => newAlert(cash, last)}>🔔 Alert</div>
      <div className="dr-act primary" onClick={() => askJarvis(`Give me a full briefing on ${cash} using apex_ticker_report.`)}>✦ Ask Jarvis</div>
    </div>
  </>;
}
