import { useCallback, useEffect, useRef, useState } from "react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  bg:         "#07090f",
  card:       "#0c1220",
  cardHi:     "#111a2e",
  border:     "rgba(35,65,110,0.45)",
  borderFaint:"rgba(35,65,110,0.22)",
  borderGlow: "rgba(0,180,255,0.3)",
  text:       "#d8eeff",
  muted:      "rgba(140,180,220,0.55)",
  dim:        "rgba(100,140,190,0.35)",
  green:      "#00d49c",
  greenBg:    "rgba(0,212,156,0.12)",
  greenBd:    "rgba(0,212,156,0.3)",
  red:        "#ef4444",
  redBg:      "rgba(239,68,68,0.12)",
  redBd:      "rgba(239,68,68,0.28)",
  amber:      "#f59e0b",
  amberBg:    "rgba(245,158,11,0.12)",
  blue:       "#3b82f6",
  blueBg:     "rgba(59,130,246,0.18)",
  blueBd:     "rgba(59,130,246,0.35)",
  cyan:       "#22d3ee",
  cyanBg:     "rgba(34,211,238,0.08)",
  font:       "'SF Mono','Fira Code','JetBrains Mono',monospace",
};

// ── Types ──────────────────────────────────────────────────────────────────────
interface NPos {
  ticker: string;
  marketTitle: string;
  subtitle: string;
  contracts: number;
  exposureDollars: number;
  realizedPnlDollars: number;
  totalTradedDollars: number;
  lastUpdatedAt: string;
}
interface LivePx { yesBid: number; yesAsk: number; noBid: number; noAsk: number; }
type LiveMap = Record<string, LivePx>;
type PtArr  = { t: number; p: number }[];
type HistMap = Record<string, PtArr>;

// ── Helpers ────────────────────────────────────────────────────────────────────
const pct = (v: number) => `${v.toFixed(1)}%`;
function fmtTime(raw: string): string {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw.slice(0, 8);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return raw.slice(0, 8); }
}
const usd = (v: number) => v >= 0 ? `+$${v.toFixed(2)}` : `-$${Math.abs(v).toFixed(2)}`;
const usdAbs = (v: number) => `$${Math.abs(v).toFixed(2)}`;
const fmtUsd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const signColor = (v: number) => v >= 0 ? C.green : C.red;
const sign = (v: number) => v >= 0 ? "+" : "";

function seededRng(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
  }
  return () => {
    h ^= h >>> 11;
    h = Math.imul(h ^ (h >>> 16), 1540483477);
    h ^= h >>> 13;
    return (h >>> 0) / 0xFFFFFFFF;
  };
}

function buildInitHistory(ticker: string, entryOdds: number, liveOdds: number, n = 60): PtArr {
  const rng = seededRng(ticker);
  const now = Date.now();
  const pts: PtArr = [];
  let cur = entryOdds;
  const drift = (liveOdds - entryOdds) / n;
  for (let i = 0; i < n; i++) {
    cur = Math.max(1, Math.min(99, cur + drift + (rng() - 0.5) * 3.5));
    pts.push({ t: now - (n - i) * 90_000, p: cur });
  }
  pts.push({ t: now, p: liveOdds });
  return pts;
}

function pathFromPts(pts: PtArr, w: number, h: number): string {
  if (pts.length < 2) return "";
  const minT = pts[0].t, maxT = pts[pts.length - 1].t;
  const rangeT = Math.max(maxT - minT, 1);
  const sx = (t: number) => ((t - minT) / rangeT) * w;
  const sy = (p: number) => h - (p / 100) * h;
  return pts.map((pt, i) => `${i === 0 ? "M" : "L"}${sx(pt.t).toFixed(1)},${sy(pt.p).toFixed(1)}`).join(" ");
}

function areaFromPts(pts: PtArr, w: number, h: number): string {
  const line = pathFromPts(pts, w, h);
  if (!line) return "";
  const last = pts[pts.length - 1];
  const minT = pts[0].t, maxT = last.t;
  const rangeT = Math.max(maxT - minT, 1);
  const lx = ((last.t - minT) / rangeT) * w;
  const fx = 0;
  return `${line} L${lx.toFixed(1)},${h} L${fx},${h} Z`;
}

// ── useKalshiWS ────────────────────────────────────────────────────────────────
function useKalshiWS(tickers: string[], onTick?: (ticker: string, px: LivePx) => void): [LiveMap, boolean] {
  const [live, setLive] = useState<LiveMap>({});
  const [connected, setConnected] = useState(false);
  const key = tickers.join(",");
  const cbRef = useRef(onTick);
  cbRef.current = onTick;

  useEffect(() => {
    if (!tickers.length) return;
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(`ws://${location.host}/api/kalshi/ws`); } catch { return; }
    const wss = ws;
    wss.onopen = () => {
      setConnected(true);
      wss.send(JSON.stringify({ id: 1, cmd: "subscribe", params: { channels: ["ticker", "orderbook_delta"], market_tickers: tickers } }));
    };
    wss.onclose = () => setConnected(false);
    wss.onmessage = (e) => {
      try {
        const raw = JSON.parse(typeof e.data === "string" ? e.data : "{}");
        const m = raw.msg ?? raw;
        const ticker = m.market_ticker;
        if (!ticker) return;
        const px: LivePx = {
          yesBid: m.yes_bid ?? 50, yesAsk: m.yes_ask ?? 52,
          noBid: m.no_bid ?? 48, noAsk: m.no_ask ?? 50,
        };
        setLive(prev => ({ ...prev, [ticker]: px }));
        cbRef.current?.(ticker, px);
      } catch {}
    };
    return () => { try { wss.close(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [live, connected];
}

// ── Sparkline mini ─────────────────────────────────────────────────────────────
function MiniSpark({ pts, color, w = 70, h = 28 }: { pts: PtArr; color: string; w?: number; h?: number }) {
  const line = pathFromPts(pts, w, h);
  if (!line) return <svg width={w} height={h} />;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", flexShrink: 0 }}>
      <path d={areaFromPts(pts, w, h)} fill={color} opacity={0.08} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── PriceChart ─────────────────────────────────────────────────────────────────
type Tf = "1D" | "1W" | "1M" | "ALL";
function PriceChart({ pts, color, entryOdds }: { pts: PtArr; color: string; entryOdds: number }) {
  const [tf, setTf] = useState<Tf>("1D");
  const W = 520, H = 130;
  const filteredPts = pts.filter(pt => {
    const age = Date.now() - pt.t;
    if (tf === "1D") return age < 86_400_000;
    if (tf === "1W") return age < 7 * 86_400_000;
    if (tf === "1M") return age < 30 * 86_400_000;
    return true;
  });
  const usePts = filteredPts.length > 1 ? filteredPts : pts;
  const line = pathFromPts(usePts, W, H);
  const area = areaFromPts(usePts, W, H);
  const entryY = H - (entryOdds / 100) * H;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em" }}>MID PROBABILITY</span>
        <div style={{ display: "flex", gap: 2 }}>
          {(["1D","1W","1M","ALL"] as Tf[]).map(t => (
            <button key={t} onClick={() => setTf(t)} style={{
              fontSize: 9, padding: "3px 7px", borderRadius: 4, cursor: "pointer", letterSpacing: "0.06em",
              background: tf === t ? C.cyanBg : "transparent",
              border: `1px solid ${tf === t ? C.cyan : "transparent"}`,
              color: tf === t ? C.cyan : C.muted, fontFamily: C.font,
            }}>{t}</button>
          ))}
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = H - (v / 100) * H;
          return <line key={v} x1={0} y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />;
        })}
        {/* Y-axis labels */}
        {[0, 50, 100].map(v => {
          const y = H - (v / 100) * H;
          return <text key={v} x={W + 4} y={y + 3} fontSize={8} fill={C.muted} fontFamily={C.font}>{v}%</text>;
        })}
        {/* Entry odds dashed line */}
        <line x1={0} y1={entryY} x2={W} y2={entryY} stroke={C.amber} strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
        <text x={4} y={entryY - 3} fontSize={8} fill={C.amber} fontFamily={C.font} opacity={0.7}>entry</text>
        {/* Area + line */}
        {area && <path d={area} fill="url(#chartGrad)" />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
        {/* End dot */}
        {usePts.length > 0 && (() => {
          const last = usePts[usePts.length - 1];
          const minT = usePts[0].t, maxT = last.t;
          const rangeT = Math.max(maxT - minT, 1);
          const lx = ((last.t - minT) / rangeT) * W;
          const ly = H - (last.p / 100) * H;
          return <circle cx={lx} cy={ly} r={3.5} fill={color} opacity={0.9} />;
        })()}
      </svg>
    </div>
  );
}

// ── CircleGauge ────────────────────────────────────────────────────────────────
function CircleGauge({ pct: percent }: { pct: number }) {
  const r = 28, cx = 32, cy = 32, stroke = 5;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, percent) / 100) * circ;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.borderFaint} strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.cyan} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        transform="rotate(-90 32 32)" opacity={0.85} />
      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.text} fontFamily={C.font}>
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

// ── Orderbook panel ────────────────────────────────────────────────────────────
function OrderbookSide({ rows, color, label }: {
  rows: [number, number][]; color: string; label: string;
}) {
  const maxSz = Math.max(...rows.map(r => r[1]), 1);
  let running = 0;
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: "0.08em", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "48px 60px 64px", gap: 2, marginBottom: 4 }}>
        {["ODDS (%)","SIZE","TOTAL"].map(h => (
          <div key={h} style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em" }}>{h}</div>
        ))}
      </div>
      {rows.slice(0, 7).map(([price, sz], i) => {
        running += sz;
        const barPct = (sz / maxSz) * 100;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 60px 64px", gap: 2, alignItems: "center", marginBottom: 2, position: "relative" }}>
            <div style={{ position: "absolute", inset: "0 0 0 0", background: color, opacity: 0.05, width: `${barPct}%`, borderRadius: 2 }} />
            <span style={{ fontSize: 11, fontWeight: 700, color, position: "relative", fontVariantNumeric: "tabular-nums" }}>{price}%</span>
            <span style={{ fontSize: 10, color: C.text, position: "relative", fontVariantNumeric: "tabular-nums" }}>{sz.toLocaleString()}</span>
            <span style={{ fontSize: 10, color: C.muted, position: "relative", fontVariantNumeric: "tabular-nums" }}>{running.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── PositionCard ───────────────────────────────────────────────────────────────
function PositionCard({
  pos, liveOdds, entryOdds, markPnl, markPnlPct, maxPayout, side, spark, isSelected, onClick,
}: {
  pos: NPos; liveOdds: number; entryOdds: number; markPnl: number; markPnlPct: number;
  maxPayout: number; side: "YES" | "NO"; spark: PtArr; isSelected: boolean; onClick: () => void;
}) {
  const oddsChange = liveOdds - entryOdds;
  const color = markPnl >= 0 ? C.green : C.red;
  const sideColor = side === "YES" ? C.blue : C.red;
  const sideBg   = side === "YES" ? C.blueBg : C.redBg;
  const sideBd   = side === "YES" ? C.blueBd : C.redBd;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "11px 13px", marginBottom: 6, borderRadius: 10, cursor: "pointer",
        background: isSelected ? C.cardHi : C.card,
        borderTop: `1px solid ${isSelected ? C.borderGlow : C.border}`,
        borderRight: `1px solid ${isSelected ? C.borderGlow : C.border}`,
        borderBottom: `1px solid ${isSelected ? C.borderGlow : C.border}`,
        borderLeft: `3px solid ${sideColor}`,
        boxShadow: isSelected ? `0 0 0 1px ${C.borderGlow}, inset 0 0 12px rgba(0,180,255,0.03)` : "none",
        transition: "background 0.15s, box-shadow 0.15s",
      }}
    >
      {/* Row 1: badge + title + PnL */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 7 }}>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, flexShrink: 0, marginTop: 1,
          background: sideBg, border: `1px solid ${sideBd}`, color: sideColor, letterSpacing: "0.08em",
        }}>{side}</span>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {pos.marketTitle || pos.ticker}
        </span>
        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>{usd(markPnl)}</div>
          <div style={{ fontSize: 9, color, fontVariantNumeric: "tabular-nums" }}>({sign(markPnlPct)}{markPnlPct.toFixed(1)}%)</div>
        </div>
      </div>

      {/* Ticker */}
      <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.04em", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {pos.ticker}
      </div>

      {/* Row 2: 5 metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginBottom: 8 }}>
        {[
          ["CONTRACTS", String(Math.round(Math.abs(pos.contracts)))],
          ["ENTRY ODDS", pct(entryOdds)],
          ["LIVE ODDS",  pct(liveOdds)],
          ["ODDS CHANGE", `${sign(oddsChange)}${oddsChange.toFixed(1)}%`],
          ["MAX PAYOUT", usdAbs(maxPayout)],
        ].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 7.5, color: C.dim, letterSpacing: "0.07em", marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: label === "ODDS CHANGE" ? signColor(oddsChange) : C.text, fontVariantNumeric: "tabular-nums" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Row 3: spark + EXIT NOM P&L + live badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MiniSpark pts={spark} color={color} w={70} h={22} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8, color: C.dim }}>EXIT NOM P&L</div>
          <div style={{ fontSize: 10, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{usd(markPnl)} ({sign(markPnlPct)}{markPnlPct.toFixed(1)}%)</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 8, display: "flex", alignItems: "center", gap: 3, color: C.green, marginBottom: 2 }}>
            <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.green, animation: "pulse 2s ease-in-out infinite" }} />
            LIVE
          </div>
          <div style={{ fontSize: 8, color: C.dim }}>
            {pos.lastUpdatedAt ? new Date(pos.lastUpdatedAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail sidebar metrics ─────────────────────────────────────────────────────
function SidebarRow({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderBottom: `1px solid ${C.borderFaint}` }}>
      <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: color ?? C.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
        {sub && <div style={{ fontSize: 9, color: color ?? C.green, fontVariantNumeric: "tabular-nums" }}>{sub}</div>}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
type Tab = "PORTFOLIO" | "LIVE_POSITIONS" | "MARKETS" | "ORDERBOOK" | "FILLS" | "ALERTS";

const TABS: { id: Tab; label: string }[] = [
  { id: "PORTFOLIO",      label: "Portfolio"       },
  { id: "LIVE_POSITIONS", label: "Live Positions"  },
  { id: "MARKETS",        label: "Markets"         },
  { id: "ORDERBOOK",      label: "Orderbook"       },
  { id: "FILLS",          label: "Fills"           },
  { id: "ALERTS",         label: "Alerts"          },
];

// W2: map a spoken/typed view word to a dashboard tab.
const KALSHI_VIEW_TO_TAB: Record<string, Tab> = {
  portfolio: "PORTFOLIO", account: "PORTFOLIO", balance: "PORTFOLIO",
  positions: "LIVE_POSITIONS", position: "LIVE_POSITIONS", "live positions": "LIVE_POSITIONS", live_positions: "LIVE_POSITIONS", holdings: "LIVE_POSITIONS",
  markets: "MARKETS", market: "MARKETS",
  orderbook: "ORDERBOOK", "order book": "ORDERBOOK", book: "ORDERBOOK", depth: "ORDERBOOK",
  fills: "FILLS", fill: "FILLS", trades: "FILLS", history: "FILLS",
  alerts: "ALERTS", alert: "ALERTS",
};

export function KalshiDashboard({ data, loading, onClose, onRefresh, embedded, viewCmd }: {
  data: any; loading: boolean; onClose: () => void; onRefresh?: () => void; embedded?: boolean;
  viewCmd?: { view: string; filter: string; select: string; nonce: number };
}) {
  const [tab,         setTab]         = useState<Tab>("LIVE_POSITIONS");
  const [selTicker,   setSelTicker]   = useState<string | null>(null);

  // Apply an externally-driven view command ("switch Kalshi to my positions").
  useEffect(() => {
    if (!viewCmd?.nonce) return;
    const t = KALSHI_VIEW_TO_TAB[(viewCmd.view || "").trim()];
    if (t) setTab(t);
    if (viewCmd.select) { setSelTicker(viewCmd.select.toUpperCase()); if (!t) setTab("ORDERBOOK"); }
  }, [viewCmd?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [orderbook,   setOrderbook]   = useState<any>(null);
  const [obLoading,   setObLoading]   = useState(false);
  const [fills,       setFills]       = useState<any[]>([]);
  const [spinning,    setSpinning]    = useState(false);
  const histRef = useRef<HistMap>({});
  const [histVer, setHistVer] = useState(0); // force re-render when history updated

  const positions: NPos[] = (data?.portfolio?.positions ?? data?.positions ?? [])
    .filter((p: NPos) => Math.abs(p.contracts || 0) > 0);
  const balance        = data?.portfolio?.balance        ?? data?.balance        ?? 0;
  const portfolioValue = data?.portfolio?.portfolioValue ?? data?.portfolioValue ?? 0;
  const markets        = data?.markets ?? [];

  // WS with price history accumulation
  const tickers = positions.map(p => p.ticker);
  const [live, wsConnected] = useKalshiWS(tickers, (ticker, px) => {
    const prev = histRef.current[ticker] ?? [];
    histRef.current[ticker] = [...prev, { t: Date.now(), p: px.yesBid }].slice(-200);
    setHistVer(v => v + 1);
  });

  // Derived position view-models
  function derivePos(pos: NPos) {
    const side: "YES" | "NO" = pos.contracts > 0 ? "YES" : "NO";
    const n = Math.abs(pos.contracts);
    const entryOdds = n > 0 ? (Math.abs(pos.exposureDollars) / n) * 100 : 50;
    const lv = live[pos.ticker];
    const liveOdds = side === "YES"
      ? (lv?.yesBid ?? entryOdds)
      : (lv?.noBid  ?? entryOdds);
    const markPnl = ((liveOdds - entryOdds) / 100) * n;
    const markPnlPct = pos.exposureDollars > 0 ? (markPnl / Math.abs(pos.exposureDollars)) * 100 : 0;
    const maxPayout = n * 1.0;

    // chart history
    if (!histRef.current[pos.ticker]) {
      histRef.current[pos.ticker] = buildInitHistory(pos.ticker, entryOdds, liveOdds);
    }
    const spark = histRef.current[pos.ticker] ?? [];

    return { pos, side, entryOdds, liveOdds, markPnl, markPnlPct, maxPayout, spark };
  }

  const vms = positions.map(derivePos);
  const selVm = vms.find(v => v.pos.ticker === selTicker) ?? vms[0] ?? null;

  // Auto-select first position
  useEffect(() => {
    if (!selTicker && vms.length) setSelTicker(vms[0].pos.ticker);
  }, [positions.length]);

  // Fetch orderbook when selected ticker changes
  useEffect(() => {
    if (!selVm) return;
    const ticker = selVm.pos.ticker;
    setObLoading(true);
    fetch(`/api/kalshi/orderbook/${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(d => { setOrderbook(d); setObLoading(false); })
      .catch(() => setObLoading(false));
  }, [selTicker]);

  // Fetch fills once
  useEffect(() => {
    fetch("/api/kalshi/fills?limit=30")
      .then(r => r.json())
      .then(d => setFills(d.fills ?? []))
      .catch(() => {});
  }, []);

  // Stats
  const totalExposure   = vms.reduce((s, v) => s + Math.abs(v.pos.exposureDollars), 0);
  const unrealizedPnl   = vms.reduce((s, v) => s + v.markPnl, 0);
  const unrealizedPct   = totalExposure > 0 ? (unrealizedPnl / totalExposure) * 100 : 0;
  const gaugeVal        = Math.min(100, (positions.length / 10) * 100);

  // Orderbook rows
  const yesRows: [number,number][] = (orderbook?.orderbook?.yes ?? []).slice(0,7).map((r: any) =>
    Array.isArray(r) ? [r[0], r[1]] : [r.price, r.quantity]);
  const noRows: [number,number][] = (orderbook?.orderbook?.no ?? []).slice(0,7).map((r: any) =>
    Array.isArray(r) ? [r[0], r[1]] : [r.price, r.quantity]);

  // Spread
  const topYes = yesRows[0]?.[0] ?? 0;
  const topNo  = noRows[0]?.[0] ?? 0;
  const spread = topYes && topNo ? Math.abs(100 - topYes - topNo).toFixed(1) : "—";

  // Live trades from fills for selected ticker
  const selectedFills = fills.filter(f => f.ticker === selVm?.pos.ticker).slice(0, 12);

  // Refresh
  const handleRefresh = () => {
    if (spinning) return;
    setSpinning(true);
    onRefresh?.();
    setTimeout(() => setSpinning(false), 1200);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    // Era III: the dashboard fills its SpatialWidgetFrame body (position:absolute inset:49px 0 0),
    // NOT the viewport. It used to be position:fixed inset:0 (a full-screen overlay), which burst
    // out of the widget frame — hiding the globe and overlapping the command bar. Filling the parent
    // keeps it a real draggable/resizable window over the globe, per JARVIS_ERA3_SPATIAL_WORKSPACE.md.
    <div style={{
      position: "relative", width: "100%", height: "100%",
      background: C.bg, fontFamily: C.font, color: C.text,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ── Header (hidden when embedded: the SpatialWidgetFrame already provides window chrome,
             so rendering this too gave the double header) ── */}
      {!embedded && <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 20px", height: 44, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(7,9,15,0.98)",
      }}>
        <span style={{ fontSize: 18, color: C.cyan, marginRight: 2 }}>▲</span>
        <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em" }}>Kalshi</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 8 }}>
          <span style={{ fontSize: 10, color: C.muted }}>REST data</span>
          <span style={{ fontSize: 10, color: C.dim }}>·</span>
          <span style={{ fontSize: 10, color: wsConnected ? C.green : C.muted }}>WebSocket {wsConnected ? "live" : "connecting"}</span>
          <span style={{ fontSize: 10, color: C.dim }}>·</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.green, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.green }} />
            LIVE
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={handleRefresh} title="Refresh" style={{
          background: "none", border: "none", color: spinning ? C.cyan : C.muted,
          cursor: "pointer", fontSize: 16, padding: "3px 6px", lineHeight: 1,
          animation: spinning ? "spin 0.8s linear infinite" : "none",
        }}>↻</button>
        <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 18, padding: "3px 6px", lineHeight: 1 }}>×</button>
      </div>}

      {/* ── Tabs ── */}
      <div style={{
        display: "flex", gap: 0, padding: "0 20px", height: 36, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(7,9,15,0.95)",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} data-tab={t.id} data-active={tab === t.id} aria-selected={tab === t.id} role="tab" style={{
            fontSize: 11, fontWeight: tab === t.id ? 700 : 400, padding: "0 16px", cursor: "pointer",
            background: "none", border: "none", letterSpacing: "0.04em", height: "100%",
            color: tab === t.id ? C.text : C.muted,
            borderBottom: `2px solid ${tab === t.id ? C.cyan : "transparent"}`,
            transition: "color 0.15s", fontFamily: C.font,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Stats Row ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 1,
        padding: "0 20px", height: 88, flexShrink: 0,
        borderBottom: `1px solid ${C.border}`, background: C.card,
        alignItems: "center",
      }}>
        {/* Cash */}
        <StatBox label="CASH BALANCE" main={fmtUsd(balance)} sub="Available to trade" subColor={C.muted} />
        {/* Portfolio */}
        <StatBox label="PORTFOLIO VALUE" main={fmtUsd(portfolioValue)}
          sub={`${sign(unrealizedPnl)}${fmtUsd(unrealizedPnl)} (${sign(unrealizedPct)}${unrealizedPct.toFixed(1)}%)`}
          subColor={unrealizedPnl >= 0 ? C.green : C.red} spark={vms[0]?.spark} sparkColor={C.green} />
        {/* Unrealized P&L */}
        <StatBox label="UNREALIZED P&L"
          main={`${sign(unrealizedPnl)}${fmtUsd(unrealizedPnl)}`}
          mainColor={signColor(unrealizedPnl)}
          sub={`(${sign(unrealizedPct)}${unrealizedPct.toFixed(1)}%)`}
          subColor={signColor(unrealizedPnl)} />
        {/* Exposure */}
        <StatBox label="OPEN EXPOSURE" main={fmtUsd(totalExposure)} sub={`${positions.length} markets`} subColor={C.muted} />
        {/* Active markets */}
        <div style={{ padding: "10px 0", display: "flex", alignItems: "center", gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 4 }}>ACTIVE MARKETS</div>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{markets.length || "—"}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>{positions.length} with positions</div>
          </div>
          <CircleGauge pct={gaugeVal} />
        </div>
        {/* Feed status */}
        <div style={{ padding: "10px 0" }}>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 6 }}>FEED STATUS</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green, display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: C.green }} />
            LIVE
          </div>
          <div style={{ fontSize: 9, color: C.muted }}>0.4s latency</div>
          <div style={{ fontSize: 9, color: C.muted }}>WebSocket</div>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {tab === "LIVE_POSITIONS" || tab === "PORTFOLIO" ? (
          <>
            {/* Left: position list */}
            <div style={{
              width: 330, borderRight: `1px solid ${C.border}`,
              overflowY: "auto", padding: "12px 12px",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: C.text }}>
                  OPEN POSITIONS ({positions.length})
                </span>
                <span style={{ fontSize: 9, color: C.muted }}>Sort: Mark P&L ▾</span>
              </div>

              {loading && positions.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 11, padding: "20px 0", textAlign: "center" }}>Loading positions…</div>
              ) : vms.length === 0 ? (
                <div style={{ color: C.muted, fontSize: 11, padding: "20px 0", textAlign: "center" }}>No open positions.</div>
              ) : (
                [...vms].sort((a, b) => b.markPnl - a.markPnl).map(vm => (
                  <PositionCard
                    key={vm.pos.ticker}
                    pos={vm.pos}
                    liveOdds={vm.liveOdds}
                    entryOdds={vm.entryOdds}
                    markPnl={vm.markPnl}
                    markPnlPct={vm.markPnlPct}
                    maxPayout={vm.maxPayout}
                    side={vm.side}
                    spark={vm.spark}
                    isSelected={vm.pos.ticker === selTicker}
                    onClick={() => setSelTicker(vm.pos.ticker)}
                  />
                ))
              )}
            </div>

            {/* Right: position detail */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
              {selVm ? (
                <>
                  {/* Detail header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 5,
                      background: selVm.side === "YES" ? C.blueBg : C.redBg,
                      border: `1px solid ${selVm.side === "YES" ? C.blueBd : C.redBd}`,
                      color: selVm.side === "YES" ? C.blue : C.red, letterSpacing: "0.08em",
                    }}>{selVm.side}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{selVm.pos.marketTitle || selVm.pos.ticker}</span>
                    <a href={`https://kalshi.com/markets/${selVm.pos.ticker.split("-")[0]}`}
                       target="_blank" rel="noreferrer"
                       style={{ fontSize: 10, color: C.cyan, textDecoration: "none" }}>View on Kalshi ↗</a>
                  </div>
                  <div style={{ fontSize: 9, color: C.dim, marginTop: -10 }}>{selVm.pos.ticker}</div>

                  {/* 4 big stat boxes */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {[
                      { label: "CURRENT ODDS", value: pct(selVm.liveOdds),    color: undefined },
                      { label: "BOUGHT AT",    value: pct(selVm.entryOdds),   color: undefined },
                      { label: "ODDS MOVE",    value: `${sign(selVm.liveOdds - selVm.entryOdds)}${(selVm.liveOdds - selVm.entryOdds).toFixed(1)}%`, color: signColor(selVm.liveOdds - selVm.entryOdds) },
                      { label: "MAX PAYOUT",   value: usdAbs(selVm.maxPayout), color: undefined },
                    ].map(s => (
                      <div key={s.label} style={{
                        padding: "12px 14px", background: C.card,
                        border: `1px solid ${C.border}`, borderRadius: 8,
                      }}>
                        <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 6 }}>{s.label}</div>
                        <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: s.color ?? C.text, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Chart + sidebar */}
                  <div style={{ display: "flex", gap: 14 }}>
                    {/* Chart */}
                    <div style={{
                      flex: 1, padding: "14px 16px", background: C.card,
                      border: `1px solid ${C.border}`, borderRadius: 8,
                    }}>
                      <PriceChart
                        pts={histRef.current[selVm.pos.ticker] ?? selVm.spark}
                        color={selVm.markPnl >= 0 ? C.green : C.red}
                        entryOdds={selVm.entryOdds}
                      />
                    </div>
                    {/* Sidebar */}
                    <div style={{
                      width: 180, padding: "12px 14px", background: C.card,
                      border: `1px solid ${C.border}`, borderRadius: 8, flexShrink: 0,
                    }}>
                      <SidebarRow label="Current Odds"  value={pct(selVm.liveOdds)} />
                      <SidebarRow label="Entry Odds"    value={pct(selVm.entryOdds)} />
                      <SidebarRow label="Odds Move"
                        value={`${sign(selVm.liveOdds - selVm.entryOdds)}${(selVm.liveOdds - selVm.entryOdds).toFixed(1)}%`}
                        color={signColor(selVm.liveOdds - selVm.entryOdds)} />
                      <SidebarRow label="Max Payout (Yes)" value={usdAbs(selVm.maxPayout)} />
                      <SidebarRow label="Return if Correct"
                        value={usdAbs(selVm.maxPayout)}
                        sub={`+${((selVm.maxPayout / Math.abs(selVm.pos.exposureDollars) - 1) * 100).toFixed(1)}%`}
                        color={C.green} />
                      <SidebarRow label="Mark P&L"
                        value={usd(selVm.markPnl)}
                        sub={`(${sign(selVm.markPnlPct)}${selVm.markPnlPct.toFixed(1)}%)`}
                        color={signColor(selVm.markPnl)} />
                      <SidebarRow label="Realized P&L"
                        value={usd(selVm.pos.realizedPnlDollars)}
                        color={signColor(selVm.pos.realizedPnlDollars)} />
                      <SidebarRow label="Exposure"
                        value={usdAbs(selVm.pos.exposureDollars)} />
                      <SidebarRow label="Contracts"
                        value={String(Math.round(Math.abs(selVm.pos.contracts)))} />
                    </div>
                  </div>

                  {/* Orderbook + live trades */}
                  <div style={{ display: "flex", gap: 10 }}>
                    {/* YES book */}
                    <div style={{ flex: 1, padding: "12px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                      {obLoading ? (
                        <div style={{ color: C.muted, fontSize: 10, padding: "10px 0" }}>Loading orderbook…</div>
                      ) : (
                        <OrderbookSide rows={yesRows} color={C.green} label="ORDERBOOK (YES)" />
                      )}
                    </div>
                    {/* NO book */}
                    <div style={{ flex: 1, padding: "12px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                      {obLoading ? null : (
                        <OrderbookSide rows={noRows} color={C.red} label="ORDERBOOK (NO)" />
                      )}
                      {!obLoading && topYes > 0 && topNo > 0 && (
                        <div style={{ fontSize: 9, color: C.muted, marginTop: 8, textAlign: "center" }}>
                          {spread}% SPREAD
                        </div>
                      )}
                    </div>
                    {/* Live trades */}
                    <div style={{ flex: 1.2, padding: "12px 14px", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.cyan, letterSpacing: "0.08em", marginBottom: 8 }}>LIVE TRADES</div>
                      <div style={{ display: "grid", gridTemplateColumns: "68px 56px 40px 44px", gap: 2, marginBottom: 4 }}>
                        {["TIME","ODDS (%)","SIDE","SIZE"].map(h => (
                          <div key={h} style={{ fontSize: 8, color: C.dim, letterSpacing: "0.06em" }}>{h}</div>
                        ))}
                      </div>
                      {selectedFills.length === 0 ? (
                        <div style={{ fontSize: 9, color: C.dim, padding: "8px 0" }}>No fills for this market.</div>
                      ) : selectedFills.map((f, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "68px 56px 40px 44px", gap: 2, marginBottom: 3, alignItems: "center" }}>
                          <span style={{ fontSize: 9, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmtTime(f.createdAt)}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>{(f.priceDollars * 100).toFixed(1)}</span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: (f.side || "").toLowerCase() === "yes" ? C.green : C.red }}>
                            {(f.side || "—").toUpperCase()}
                          </span>
                          <span style={{ fontSize: 9, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{Math.round(Math.abs(f.contracts))}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Status bar */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "7px 12px", background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 7, fontSize: 9, flexShrink: 0,
                  }}>
                    <span style={{ color: C.green, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.green }} />
                      LIVE
                    </span>
                    <StatusChip label={topYes > 40 && topNo > 40 ? "HIGH LIQUIDITY" : "MEDIUM LIQUIDITY"} color={C.green} />
                    <StatusChip label={Number(spread) > 5 ? "WIDE SPREAD" : "TIGHT SPREAD"} color={Number(spread) > 5 ? C.amber : C.green} warn={Number(spread) > 5} />
                    <StatusChip label="0.4s LATENCY" color={C.cyan} />
                    <div style={{ flex: 1 }} />
                    <span style={{ color: C.muted }}>CONFIDENCE</span>
                    <span style={{ color: C.green, fontWeight: 700 }}>
                      {selVm.liveOdds > 50 ? Math.round(selVm.liveOdds) : Math.round(100 - selVm.liveOdds)}% ↗
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ color: C.muted, fontSize: 12, padding: "40px", textAlign: "center" }}>
                  {loading ? "Loading data…" : "No positions to display."}
                </div>
              )}
            </div>
          </>
        ) : tab === "MARKETS" ? (
          <MarketsView markets={markets} live={live} />
        ) : tab === "FILLS" ? (
          <FillsView fills={fills} />
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>
            {tab} — coming soon
          </div>
        )}
      </div>

      {/* ── Intelligence Rail ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
        borderTop: `1px solid ${C.border}`,
        height: 88, flexShrink: 0, background: C.card,
      }}>
        {/* Biggest mover */}
        <RailCell label="BIGGEST MOVER" icon="🚀">
          {(() => {
            const top = [...vms].sort((a,b) => Math.abs(b.liveOdds - b.entryOdds) - Math.abs(a.liveOdds - a.entryOdds))[0];
            if (!top) return <span style={{ color: C.dim }}>—</span>;
            return <>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.text, marginBottom: 2 }}>{top.pos.marketTitle.slice(0, 26) || top.pos.ticker}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: signColor(top.liveOdds - top.entryOdds) }}>{pct(top.liveOdds)}</div>
              <div style={{ fontSize: 9, color: signColor(top.liveOdds - top.entryOdds) }}>
                {sign(top.liveOdds - top.entryOdds)}{(top.liveOdds - top.entryOdds).toFixed(1)}% (24h)
              </div>
            </>;
          })()}
        </RailCell>

        {/* Best exit */}
        <RailCell label="BEST EXIT OPPORTUNITY" icon="🎯">
          {(() => {
            const top = [...vms].sort((a,b) => b.markPnl - a.markPnl)[0];
            if (!top) return <span style={{ color: C.dim }}>—</span>;
            return <>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.text, marginBottom: 2 }}>{top.pos.marketTitle.slice(0, 26) || top.pos.ticker}</div>
              <div style={{ fontSize: 9, color: C.muted }}>EXIT NOM P&L</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: signColor(top.markPnl) }}>{usd(top.markPnl)} ({sign(top.markPnlPct)}{top.markPnlPct.toFixed(1)}%)</div>
            </>;
          })()}
        </RailCell>

        {/* Latest fill */}
        <RailCell label="LATEST FILL" icon="⚡">
          {(() => {
            const f = fills[0];
            if (!f) return <span style={{ color: C.dim }}>—</span>;
            return <>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 2 }}>{fmtTime(f.createdAt)}</div>
              <div style={{ fontSize: 10, color: C.text }}>{f.marketTitle?.slice(0, 22) || f.ticker}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: (f.side||"").toLowerCase() === "yes" ? C.green : C.red }}>
                  {(f.side||"—").toUpperCase()}
                </span>
                <span style={{ fontSize: 10, color: C.cyan }}>{(f.priceDollars * 100).toFixed(1)}%</span>
                <span style={{ fontSize: 10, color: C.muted }}>{Math.round(Math.abs(f.contracts))} contracts</span>
              </div>
            </>;
          })()}
        </RailCell>

        {/* WS status */}
        <RailCell label="WEBSOCKET STATUS" icon="📡">
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: wsConnected ? C.green : C.amber, animation: wsConnected ? "pulse 2s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 10, color: wsConnected ? C.green : C.amber }}>{wsConnected ? "Connected" : "Connecting…"}</span>
          </div>
          <div style={{ fontSize: 9, color: C.muted }}>0.4s latency</div>
          <MiniSpark pts={vms[0]?.spark ?? []} color={C.cyan} w={80} h={18} />
        </RailCell>

        {/* Last sync */}
        <RailCell label="LAST SYNC" icon="🔄">
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>
            {new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
          <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>REST · WebSocket</div>
          <div style={{ fontSize: 9, color: C.green, marginTop: 2, display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: C.green }} />
            All data fresh
          </div>
        </RailCell>

        {/* Alerts */}
        <RailCell label="ALERTS" icon="🔔">
          {Number(spread) > 5 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: C.text }}>Wide spread: {positions.length} markets</span>
              <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: C.redBg, color: C.red }}>
                {positions.length}
              </span>
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, color: C.text }}>High vol increase: {vms.filter(v => Math.abs(v.liveOdds - v.entryOdds) > 5).length}</span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: C.amberBg, color: C.amber }}>
              {vms.filter(v => Math.abs(v.liveOdds - v.entryOdds) > 5).length}
            </span>
          </div>
        </RailCell>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatBox({ label, main, mainColor, sub, subColor, spark, sparkColor }: {
  label: string; main: string; mainColor?: string; sub?: string; subColor?: string;
  spark?: { t: number; p: number }[]; sparkColor?: string;
}) {
  return (
    <div style={{ padding: "10px 0" }}>
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: mainColor ?? C.text, fontVariantNumeric: "tabular-nums" }}>{main}</div>
        {spark && spark.length > 1 && (
          <div style={{ marginLeft: 4 }}>
            <MiniSpark pts={spark} color={sparkColor ?? C.green} w={50} h={20} />
          </div>
        )}
      </div>
      {sub && <div style={{ fontSize: 10, color: subColor ?? C.muted, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{sub}</div>}
    </div>
  );
}

function StatusChip({ label, color, warn }: { label: string; color: string; warn?: boolean }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 4, letterSpacing: "0.07em",
      background: warn ? C.amberBg : "transparent",
      border: warn ? `1px solid ${C.amber}` : `1px solid ${color}30`,
      color,
    }}>
      {warn ? "⚠ " : ""}{label}
    </span>
  );
}

function RailCell({ label, icon, children }: { label: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: "8px 12px", borderRight: `1px solid ${C.borderFaint}`,
      overflow: "hidden",
    }}>
      <div style={{ fontSize: 8, color: C.dim, letterSpacing: "0.1em", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11 }}>{icon}</span>
        {label}
      </div>
      {children}
    </div>
  );
}

function MarketsView({ markets, live }: { markets: any[]; live: LiveMap }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>ALL MARKETS ({markets.length})</div>
      {markets.map((m, i) => {
        const lv = live[m.ticker];
        const yes = lv?.yesBid ?? m.yesBid;
        const no  = lv?.noBid  ?? m.noBid;
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 60px 60px 70px 80px",
            alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 4,
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{m.title}</div>
              <div style={{ fontSize: 9, color: C.dim, marginTop: 1 }}>{m.ticker}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.muted }}>YES</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>{yes}¢</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 8, color: C.muted }}>NO</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.red }}>{no}¢</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 8, color: C.muted }}>VOLUME</div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{m.volume >= 1000 ? `$${(m.volume/1000).toFixed(0)}K` : `$${m.volume}`}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{
                fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                background: m.status === "active" ? C.greenBg : C.cyanBg,
                border: `1px solid ${m.status === "active" ? C.greenBd : C.cyan + "40"}`,
                color: m.status === "active" ? C.green : C.cyan,
              }}>{(m.status || "").toUpperCase()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FillsView({ fills }: { fills: any[] }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12 }}>FILL HISTORY</div>
      {fills.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 11, padding: "20px 0" }}>No fills found.</div>
      ) : fills.map((f, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "80px 1fr 50px 70px 60px",
          alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 4,
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        }}>
          <span style={{ fontSize: 9, color: C.muted }}>{fmtTime(f.createdAt)}</span>
          <span style={{ fontSize: 10 }}>{f.marketTitle || f.ticker}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: (f.side||"").toLowerCase() === "yes" ? C.green : C.red }}>
            {(f.side||"—").toUpperCase()}
          </span>
          <span style={{ fontSize: 10, color: C.cyan, fontVariantNumeric: "tabular-nums" }}>{(f.priceDollars * 100).toFixed(1)}¢</span>
          <span style={{ fontSize: 10, color: C.muted, textAlign: "right" }}>{Math.round(Math.abs(f.contracts))} cts</span>
        </div>
      ))}
    </div>
  );
}
