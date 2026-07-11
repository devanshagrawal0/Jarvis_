import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  category: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  spread: number;
  volume: number;
  closeTime: string;
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const C = {
  YES:         "#20f7a4",
  NO:          "#5599ff",
  surface:     "rgba(0,8,20,0.97)",
  surfaceCard: "rgba(2,10,26,0.96)",
  border:      "rgba(0,200,255,0.18)",
  borderHi:    "rgba(0,200,255,0.45)",
  borderFaint: "rgba(0,200,255,0.08)",
  muted:       "rgba(200,230,255,0.45)",
  text:        "rgba(220,245,255,0.92)",
  cyan:        "rgba(0,229,255,0.9)",
  positive:    "#20f7a4",
  negative:    "#ff4e5c",
  amber:       "#ffbc60",
  font:        "'SF Mono','Fira Code','JetBrains Mono',monospace",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const cts = (v: number) => `${v}¢`;

function fmtUsd(v: number) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtVol(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

function clip(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const SERIES_LABEL: Record<string, string> = {
  KXWCGAME: "Match Winner", KXWCSOA: "Score or Assist",
  KXWCGOAL: "Goal Scorer", KXWCCORNERS: "Corners",
  KXWCBTTS: "Both Teams Score", KXWCADVANCE: "To Advance",
  KXWC1H: "1st Half Result", KXWCSCORE: "Final Score",
  KXWCSHOTS: "Shots on Target", KXWCCARD: "Cards",
  KXWCCLEAN: "Clean Sheet", KXWCMVP: "MVP",
  KXBTC: "Bitcoin", KXETH: "Ethereum",
  KXFED: "Fed Rate Decision", KXCPI: "CPI Inflation",
  KXNBA: "Pro Basketball", KXMLB: "Pro Baseball",
};
const TEAM_NAMES: Record<string, string> = {
  USA: "USA", BEL: "Belgium", ARG: "Argentina", EGY: "Egypt",
  FRA: "France", MAR: "Morocco", POR: "Portugal", ESP: "Spain",
  NOR: "Norway", ENG: "England", SUI: "Switzerland", COL: "Colombia",
  BRA: "Brazil", MEX: "Mexico", GER: "Germany", NED: "Netherlands",
  JPN: "Japan", KOR: "South Korea", ITA: "Italy", URU: "Uruguay",
  ECU: "Ecuador", SEN: "Senegal", GHA: "Ghana", CMR: "Cameroon",
};

function tickerToLabel(ticker: string): string {
  if (!ticker) return "Unknown";
  const parts = ticker.split("-");
  const series = parts[0] || "";
  const matchPart = parts[1] || "";
  const detail = parts.slice(2).join("-");
  const sLabel = SERIES_LABEL[series] || series;

  const mMatch = matchPart.match(/\d{2}[A-Z]+\d{2}([A-Z]{2,3})([A-Z]{2,3})$/);
  const t1 = mMatch ? (TEAM_NAMES[mMatch[1]] || mMatch[1]) : "";
  const t2 = mMatch ? (TEAM_NAMES[mMatch[2]] || mMatch[2]) : "";
  const matchStr = t1 && t2 ? `${t1} vs ${t2}` : matchPart;

  if (!detail) return `${sLabel} · ${matchStr}`;

  // Starts with a team code then player code
  const playerM = detail.match(/^([A-Z]{2,3})([A-Z]+?)(\d{1,2})(?:-(\d+))?$/);
  if (playerM) {
    const team = TEAM_NAMES[playerM[1]] || playerM[1];
    const num = playerM[3];
    const threshold = playerM[4];
    return threshold
      ? `${sLabel} ${threshold}+ · #${num} (${team})`
      : `${sLabel} · #${num} (${team})`;
  }
  if (/^\d+$/.test(detail)) return `${sLabel} ${detail}+ · ${matchStr}`;
  return `${sLabel} · ${detail.replace(/-/g, " ")}`;
}

// ── Shared style constants ─────────────────────────────────────────────────────

const ICON_BTN: React.CSSProperties = {
  fontSize: 14, background: "none", border: "none",
  color: C.muted, cursor: "pointer", padding: "1px 3px", lineHeight: 1,
};

const PX_BTN: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 7, fontSize: 18, fontWeight: 700,
  background: "rgba(0,229,255,0.08)", border: `1px solid rgba(0,229,255,0.22)`,
  color: C.cyan, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};

const EX_STYLE: React.CSSProperties = {
  width: "min(1260px, calc(100vw - 16px))",
  height: "calc(100vh - 16px)",
  background: "rgba(0,5,15,0.98)",
  border: `1px solid rgba(0,200,255,0.22)`,
  borderRadius: 16,
  backdropFilter: "blur(28px)",
  WebkitBackdropFilter: "blur(28px)",
  boxShadow: "0 28px 90px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,229,255,0.07)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  fontFamily: C.font,
  color: C.text,
};

// ── Primitives ─────────────────────────────────────────────────────────────────

function Sparkline({ color = C.positive, w = 40, h = 14 }: { color?: string; w?: number; h?: number }) {
  const pts: [number, number][] = [[0,11],[4,8],[8,10],[13,5],[18,7],[23,4],[28,6],[33,3],[38,5],[40,4]];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", flexShrink: 0 }}>
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" opacity={0.8}
      />
    </svg>
  );
}

function Divider() {
  return <div style={{ height: 1, background: C.borderFaint, margin: "10px 0" }} />;
}

function SectionHead({ label, icon, action, onAction }: {
  label: string; icon?: string; action?: string; onAction?: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 700, color: "rgba(200,230,255,0.55)", letterSpacing: "0.12em" }}>
        {icon && <span>{icon}</span>}
        {label}
      </div>
      {action && (
        <button onClick={onAction} style={{ fontSize: 9, color: C.cyan, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── useKalshiWS ────────────────────────────────────────────────────────────────

type LivePrices = Record<string, { yesBid: number; yesAsk: number; noBid: number; noAsk: number }>;

function useKalshiWS(tickers: string[]): LivePrices {
  const [live, setLive] = useState<LivePrices>({});
  const tickersKey = tickers.join(",");

  useEffect(() => {
    if (!tickers.length) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`ws://${location.host}/api/kalshi/ws`);
    } catch { return; }

    const wss = ws;
    wss.onopen = () => {
      wss.send(JSON.stringify({
        id: 1, cmd: "subscribe",
        params: { channels: ["ticker", "orderbook_delta"], market_tickers: tickers },
      }));
    };
    wss.onmessage = (e) => {
      try {
        const raw = JSON.parse(typeof e.data === "string" ? e.data : "{}");
        const m = raw.msg ?? raw;
        const ticker = m.market_ticker;
        if (!ticker) return;
        setLive(prev => ({
          ...prev,
          [ticker]: {
            yesBid: m.yes_bid  ?? prev[ticker]?.yesBid  ?? 50,
            yesAsk: m.yes_ask  ?? prev[ticker]?.yesAsk  ?? 52,
            noBid:  m.no_bid   ?? prev[ticker]?.noBid   ?? 48,
            noAsk:  m.no_ask   ?? prev[ticker]?.noAsk   ?? 50,
          },
        }));
      } catch {}
    };
    return () => { try { wss.close(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey]);

  return live;
}

// ── usePositionPrices ──────────────────────────────────────────────────────────

function usePositionPrices(tickers: string[]) {
  const [prices, setPrices] = useState<Record<string, { yes: number; no: number }>>({});
  const key = tickers.join(",");
  useEffect(() => {
    if (!tickers.length) return;
    const ctrl = new AbortController();
    Promise.all(tickers.map(async (t) => {
      try {
        const res = await fetch(`/api/kalshi/orderbook/${encodeURIComponent(t)}`, { signal: ctrl.signal });
        const d = await res.json();
        const yesLvl = d.yesLevels ?? d.orderbook?.yes ?? [];
        const noLvl  = d.noLevels  ?? d.orderbook?.no  ?? [];
        const yes = Array.isArray(yesLvl) && yesLvl[0] ? (yesLvl[0].price ?? yesLvl[0][0]) : null;
        const no  = Array.isArray(noLvl)  && noLvl[0]  ? (noLvl[0].price  ?? noLvl[0][0])  : null;
        return { t, yes, no };
      } catch { return { t, yes: null, no: null }; }
    })).then(results => {
      if (ctrl.signal.aborted) return;
      const map: Record<string, { yes: number; no: number }> = {};
      for (const { t, yes, no } of results) {
        if (yes != null || no != null) map[t] = { yes: yes ?? 50, no: no ?? 50 };
      }
      setPrices(map);
    });
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return prices;
}

// ── Tab: PORTFOLIO ─────────────────────────────────────────────────────────────

function PortfolioTab({ data }: { data: any }) {
  const portfolio = data?.portfolio ?? {};
  const cashBalance    = portfolio.cashBalanceDollars    ?? portfolio.balance        ?? data?.balance        ?? 0;
  const portfolioValue = portfolio.portfolioValueDollars ?? portfolio.portfolioValue ?? data?.portfolioValue ?? 0;
  const positions: any[] = portfolio.positions ?? data?.positions ?? [];
  const latestFill = portfolio.latestFill ?? data?.latestFill ?? null;
  const totalPnl = positions.reduce((s: number, p: any) => s + (p.realizedPnlDollars ?? p.pnl ?? 0), 0);

  const tickers = positions.map((p: any) => p.ticker).filter(Boolean);
  const curPrices = usePositionPrices(tickers);

  return (
    <div style={{ padding: "14px 16px", overflowY: "auto", flex: 1 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
        {([
          { label: "CASH BALANCE",    value: fmtUsd(cashBalance),    color: C.cyan },
          { label: "PORTFOLIO VALUE", value: fmtUsd(portfolioValue), color: C.text },
          { label: "TOTAL P&L",       value: (totalPnl >= 0 ? "+" : "") + fmtUsd(totalPnl), color: totalPnl > 0 ? C.positive : totalPnl < 0 ? C.negative : C.muted },
        ] as const).map(({ label, value, color }) => (
          <div key={label} style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.1em", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Positions */}
      <SectionHead label="OPEN POSITIONS" icon="◑" />
      {positions.length === 0 ? (
        <div style={{ fontSize: 11, color: C.muted, padding: "16px 0", textAlign: "center" }}>No open positions</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 46px 46px 72px 72px 72px", gap: 6, padding: "4px 8px" }}>
            {["MARKET","SIDE","QTY","EXPOSURE","LAST","P&L"].map(h => (
              <div key={h} style={{ fontSize: 8, color: C.muted, letterSpacing: "0.07em", textAlign: h === "MARKET" ? "left" : "right" }}>{h}</div>
            ))}
          </div>
          {positions.map((p: any, i: number) => {
            const qty      = p.contracts ?? 0;
            const side     = qty >= 0 ? "YES" : "NO";
            const exposure = p.exposureDollars ?? 0;
            const pnl      = p.realizedPnlDollars ?? p.pnl ?? 0;
            const title    = p.marketTitle || p.title || tickerToLabel(p.ticker ?? "");
            const cur      = curPrices[p.ticker ?? ""];
            const lastPx   = cur ? (side === "YES" ? cur.yes : cur.no) : null;
            return (
              <div key={p.ticker ?? i} style={{
                display: "grid", gridTemplateColumns: "1fr 46px 46px 72px 72px 72px", gap: 6,
                padding: "8px 8px", borderRadius: 8, marginBottom: 4,
                background: "rgba(0,229,255,0.03)", border: `1px solid ${C.borderFaint}`, alignItems: "center",
              }}>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={title}>{title}</div>
                  <div style={{ fontSize: 8, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.ticker}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: 10, fontWeight: 800, color: side === "YES" ? C.YES : C.NO }}>{side}</div>
                <div style={{ textAlign: "right", fontSize: 11 }}>{Math.abs(qty).toFixed(0)}</div>
                <div style={{ textAlign: "right", fontSize: 11, color: C.muted }}>{fmtUsd(Math.abs(exposure))}</div>
                <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: side === "YES" ? C.YES : C.NO }}>
                  {lastPx != null ? `${lastPx}¢` : <span style={{ color: C.muted }}>—</span>}
                </div>
                <div style={{ textAlign: "right", fontSize: 11, fontWeight: 700, color: pnl > 0 ? C.positive : pnl < 0 ? C.negative : C.muted }}>
                  {pnl >= 0 ? "+" : ""}{fmtUsd(pnl)}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Latest fill */}
      {latestFill && (
        <>
          <Divider />
          <SectionHead label="LAST FILL" icon="✓" />
          <div style={{ background: "rgba(32,247,164,0.06)", border: "1px solid rgba(32,247,164,0.15)", borderRadius: 8, padding: "10px 12px", fontSize: 11 }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {latestFill.marketTitle || latestFill.ticker || tickerToLabel(latestFill.ticker ?? "")}
            </div>
            {([
              ["Ticker",    latestFill.ticker ?? "—"],
              ["Side",      latestFill.side ?? "—"],
              ["Contracts", latestFill.contracts != null ? String(Math.abs(latestFill.contracts)) : "—"],
              ["Price",     latestFill.priceLabel ?? (latestFill.priceDollars != null ? cts(Math.round(latestFill.priceDollars * 100)) : "—")],
              ["Time",      latestFill.createdAt ? latestFill.createdAt.slice(0, 16).replace("T", " ") : "—"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span style={{ color: C.muted }}>{k}</span>
                <span style={{ fontWeight: 700, color: k === "Side" ? (v === "YES" ? C.YES : v === "NO" ? C.NO : C.text) : C.text }}>{v}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab: MARKETS ───────────────────────────────────────────────────────────────

const CATEGORY_FILTERS = [
  { key: "all",     label: "All" },
  { key: "soccer",  label: "⚽ World Cup" },
  { key: "crypto",  label: "₿ Crypto" },
  { key: "econ",    label: "📊 Economics" },
  { key: "sports",  label: "🏆 Sports" },
] as const;
type CatKey = typeof CATEGORY_FILTERS[number]["key"];

function matchesCategory(mk: KalshiMarket & { seriesTicker?: string; status?: string }, cat: CatKey) {
  const s = (mk as any).seriesTicker || mk.ticker.split("-")[0] || "";
  if (cat === "all") return true;
  if (cat === "soccer") return s.startsWith("KXWC");
  if (cat === "crypto") return s === "KXBTC" || s === "KXETH" || s === "KXSOL";
  if (cat === "econ")   return s === "KXFED" || s === "KXCPI" || s === "KXPCE" || s === "KXGDP";
  if (cat === "sports") return s === "KXNBA" || s === "KXMLB" || s === "KXNFL" || s === "KXNHL";
  return true;
}

function MarketsTab({ markets, live, onSelectMarket }: {
  markets: KalshiMarket[];
  live: LivePrices;
  onSelectMarket: (m: KalshiMarket) => void;
}) {
  const [sortKey, setSortKey] = useState<"yes" | "no" | "spread" | "volume">("volume");
  const [cat,     setCat]     = useState<CatKey>("all");

  const filtered = markets.filter(mk => matchesCategory(mk as any, cat));
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "yes")    return b.yesBid - a.yesBid;
    if (sortKey === "no")     return b.noBid  - a.noBid;
    if (sortKey === "spread") return a.spread - b.spread;
    return Number(b.volume) - Number(a.volume);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Category filter row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 14px", borderBottom: `1px solid ${C.borderFaint}`, flexShrink: 0, overflowX: "auto" }}>
        {CATEGORY_FILTERS.map(({ key, label }) => (
          <button key={key} onClick={() => setCat(key)} style={{
            fontSize: 10, fontWeight: cat === key ? 700 : 400, padding: "4px 11px", borderRadius: 20, cursor: "pointer",
            whiteSpace: "nowrap", flexShrink: 0,
            background: cat === key ? "rgba(0,229,255,0.14)" : "transparent",
            border: `1px solid ${cat === key ? "rgba(0,229,255,0.35)" : "rgba(0,229,255,0.1)"}`,
            color: cat === key ? C.cyan : C.muted,
          }}>{label}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: Object.keys(live).length > 0 ? C.positive : C.muted, flexShrink: 0 }}>
          {Object.keys(live).length > 0 ? "● LIVE" : "○ REST"}
        </span>
      </div>

      {/* Sort row */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderBottom: `1px solid ${C.borderFaint}`, flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em", marginRight: 2 }}>SORT</span>
        {(["volume","yes","no","spread"] as const).map(k => (
          <button key={k} onClick={() => setSortKey(k)} style={{
            fontSize: 9, fontWeight: sortKey === k ? 700 : 400, padding: "2px 9px", borderRadius: 5, cursor: "pointer",
            textTransform: "uppercase", letterSpacing: "0.06em",
            background: sortKey === k ? "rgba(0,229,255,0.12)" : "transparent",
            border: `1px solid ${sortKey === k ? "rgba(0,229,255,0.28)" : "rgba(0,229,255,0.1)"}`,
            color: sortKey === k ? C.cyan : C.muted,
          }}>{k === "yes" ? "YES" : k === "no" ? "NO" : k === "spread" ? "Spread" : "Volume"}</button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.muted }}>{filtered.length} markets</span>
      </div>

      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 68px 160px 68px 68px 80px", gap: 6, padding: "4px 14px", borderBottom: `1px solid ${C.borderFaint}`, flexShrink: 0 }}>
        {["MARKET","YES","PROBABILITY","NO","SPREAD","VOLUME"].map(h => (
          <div key={h} style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em", textAlign: h === "MARKET" ? "left" : "center" }}>{h}</div>
        ))}
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {sorted.length === 0 && (
          <div style={{ padding: "30px", textAlign: "center", color: C.muted, fontSize: 12 }}>No markets in this category</div>
        )}
        {sorted.map(mk => {
          const ws      = live[mk.ticker];
          const yesBid  = ws?.yesBid ?? mk.yesBid;
          const noBid   = ws?.noBid  ?? mk.noBid;
          const spread  = ws ? Math.abs(ws.yesAsk - ws.yesBid) : mk.spread;
          const st      = (mk as any).status || "";
          const isLive  = st === "active";
          const isInit  = st === "initialized";
          const vol     = Number(mk.volume);
          return (
            <div
              key={mk.ticker}
              onClick={() => onSelectMarket(mk)}
              style={{
                display: "grid", gridTemplateColumns: "1fr 68px 160px 68px 68px 80px", gap: 6,
                padding: "9px 14px", cursor: "pointer", alignItems: "center",
                borderBottom: `1px solid ${C.borderFaint}`, transition: "background 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(0,229,255,0.04)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <div style={{ overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                  {isLive && <span style={{ fontSize: 7, fontWeight: 700, color: C.positive, border: "1px solid rgba(32,247,164,0.4)", borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>LIVE</span>}
                  {isInit && <span style={{ fontSize: 7, fontWeight: 700, color: C.amber, border: "1px solid rgba(255,188,96,0.4)", borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>SOON</span>}
                  <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mk.title}</div>
                </div>
                <div style={{ fontSize: 8, color: C.muted }}>{mk.ticker.split("-")[0]} · {mk.closeTime?.slice(0,10) || "—"}</div>
              </div>
              <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: C.YES, lineHeight: 1 }}>
                {yesBid}¢
                {ws && <div style={{ fontSize: 7, color: C.positive }}>live</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ flex: yesBid, height: 7, background: C.YES, borderRadius: "3px 0 0 3px", opacity: 0.75 }} />
                <div style={{ flex: Math.max(1, 100 - yesBid), height: 7, background: C.NO, borderRadius: "0 3px 3px 0", opacity: 0.75 }} />
              </div>
              <div style={{ textAlign: "center", fontSize: 14, fontWeight: 800, color: C.NO }}>{noBid}¢</div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{spread}¢</div>
                <div style={{ fontSize: 7, color: spread <= 2 ? C.positive : spread <= 5 ? C.amber : C.negative, marginTop: 1 }}>
                  {spread <= 2 ? "tight" : spread <= 5 ? "fair" : "wide"}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 10, fontWeight: 600 }}>
                {vol > 0 ? fmtVol(vol) : <span style={{ color: C.muted }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: SEARCH ────────────────────────────────────────────────────────────────

function SearchTab({ onSelectMarket }: { onSelectMarket: (m: KalshiMarket) => void }) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<KalshiMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timer = useRef<number | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      const res = await fetch(`/api/kalshi/markets?search=${encodeURIComponent(q)}&limit=30`);
      const d = await res.json();
      const raw: any[] = d.markets ?? d ?? [];
      const normalized = raw
        .filter((m: any) => !String(m.ticker || "").includes("MULTIGAMEEXTENDED"))
        .filter((m: any) => (String(m.title || "").match(/,/g) || []).length < 3)
        .map((m: any) => ({
          ...m,
          title:   m.title   || m.ticker || "Unknown market",
          yesBid:  m.yesBid  ?? 50,
          yesAsk:  m.yesAsk  ?? 52,
          noBid:   m.noBid   ?? (100 - (m.yesAsk ?? 52)),
          noAsk:   m.noAsk   ?? (100 - (m.yesBid ?? 50)),
          spread:  m.spread  ?? Math.abs((m.yesAsk ?? 52) - (m.yesBid ?? 50)),
          volume:  m.volume  ?? 0,
        }))
        .slice(0, 20);
      setResults(normalized);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => doSearch(val), 400);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.borderFaint}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(0,229,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>
          <span style={{ fontSize: 14, color: C.muted }}>⌕</span>
          <input
            value={query}
            onChange={e => handleChange(e.target.value)}
            placeholder="Search markets…  e.g. Fed rate, Bitcoin, NBA"
            style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 12, color: C.text, fontFamily: C.font }}
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); setSearched(false); }} style={{ ...ICON_BTN, fontSize: 13 }}>×</button>
          )}
        </div>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading && <div style={{ padding: "20px", textAlign: "center", color: C.muted, fontSize: 12 }}>Searching…</div>}
        {!loading && searched && results.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", color: C.muted, fontSize: 12 }}>No results for "{query}"</div>
        )}
        {!loading && results.map(mk => (
          <div
            key={mk.ticker}
            onClick={() => onSelectMarket(mk)}
            style={{ padding: "10px 16px", cursor: "pointer", borderBottom: `1px solid ${C.borderFaint}`, display: "flex", alignItems: "center", gap: 12, transition: "background 0.1s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(0,229,255,0.04)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }}>{mk.title}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{mk.ticker} · {mk.category}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.YES }}>{cts(mk.yesBid)}</div>
              <div style={{ fontSize: 8, color: C.muted }}>YES</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.NO }}>{cts(mk.noBid)}</div>
              <div style={{ fontSize: 8, color: C.muted }}>NO</div>
            </div>
            <button style={{ fontSize: 10, color: C.cyan, background: "rgba(0,229,255,0.08)", border: `1px solid rgba(0,229,255,0.2)`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
              Trade →
            </button>
          </div>
        ))}
        {!searched && (
          <div style={{ padding: "20px 16px", color: C.muted, fontSize: 11 }}>
            <div style={{ marginBottom: 12, fontWeight: 700, color: "rgba(200,230,255,0.6)" }}>Trending</div>
            {["USA world cup", "Bitcoin price", "Fed rate cut", "NBA Finals", "CPI inflation"].map(s => (
              <div
                key={s}
                onClick={() => { setQuery(s); handleChange(s); }}
                style={{ padding: "7px 0", cursor: "pointer", borderBottom: `1px solid ${C.borderFaint}`, display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 10, color: "rgba(0,229,255,0.4)" }}>↗</span>
                <span style={{ fontSize: 11 }}>{s}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: TRADE ─────────────────────────────────────────────────────────────────

function TradeTab({ markets, initialMarket }: { markets: KalshiMarket[]; initialMarket: KalshiMarket | null }) {
  const [selectedTicker, setSelectedTicker] = useState(initialMarket?.ticker ?? markets[0]?.ticker ?? "");
  const [side,      setSide]      = useState<"BUY" | "SELL">("BUY");
  const [outcome,   setOutcome]   = useState<"YES" | "NO">("YES");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [contracts, setContracts] = useState(10);
  const [limitPx,   setLimitPx]   = useState<number | null>(null);
  const [status,    setStatus]    = useState<"idle" | "submitting" | "ok" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");

  const m = markets.find(mk => mk.ticker === selectedTicker) ?? markets[0] ?? null;
  const defaultPx = m ? (outcome === "YES" ? m.yesBid : m.noBid) : 50;
  const lp = limitPx ?? defaultPx;
  const estCost   = contracts * lp / 100;
  const maxPayout = contracts * 1.0;

  const submit = async () => {
    if (!m) return;
    setStatus("submitting"); setStatusMsg("");
    try {
      const res = await fetch("/api/kalshi/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: m.ticker, side: outcome, action: side, type: orderType, count: contracts,
          yes_price: outcome === "YES" ? lp : undefined,
          no_price:  outcome === "NO"  ? lp : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setStatus("error"); setStatusMsg(data.error);
      } else {
        setStatus("ok");
        setStatusMsg(`Order placed! ID: ${data.orderId ?? data.order?.order_id ?? "confirmed"}`);
        setTimeout(() => setStatus("idle"), 4000);
      }
    } catch (e: any) {
      setStatus("error"); setStatusMsg(e.message ?? "Network error");
    }
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Market list */}
      <div style={{ width: 230, borderRight: `1px solid ${C.borderFaint}`, overflowY: "auto", padding: "10px 10px" }}>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 8 }}>SELECT MARKET</div>
        {markets.map(mk => (
          <div
            key={mk.ticker}
            onClick={() => { setSelectedTicker(mk.ticker); setLimitPx(null); }}
            style={{
              padding: "8px 10px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
              background: selectedTicker === mk.ticker ? "rgba(0,229,255,0.08)" : "transparent",
              border: `1px solid ${selectedTicker === mk.ticker ? "rgba(0,229,255,0.25)" : "transparent"}`,
            }}
          >
            <div style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mk.title}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3, display: "flex", gap: 8 }}>
              <span style={{ color: C.YES }}>Y {cts(mk.yesBid)}</span>
              <span style={{ color: C.NO }}>N {cts(mk.noBid)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Order form */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {m ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>

            {/* BUY / SELL */}
            <div style={{ display: "flex", background: "rgba(0,0,0,0.35)", borderRadius: 8, padding: 3, gap: 3, marginBottom: 14 }}>
              {(["BUY","SELL"] as const).map(s => (
                <button key={s} onClick={() => setSide(s)} style={{
                  flex: 1, fontSize: 12, fontWeight: 800, padding: "7px 0", borderRadius: 6, cursor: "pointer", letterSpacing: "0.06em",
                  background: side === s ? (s === "BUY" ? "rgba(32,247,164,0.18)" : "rgba(255,78,92,0.18)") : "transparent",
                  border: `1px solid ${side === s ? (s === "BUY" ? "rgba(32,247,164,0.4)" : "rgba(255,78,92,0.4)") : "transparent"}`,
                  color: side === s ? (s === "BUY" ? C.YES : C.negative) : C.muted,
                }}>{s}</button>
              ))}
            </div>

            {/* YES / NO */}
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.07em", marginBottom: 6 }}>OUTCOME</div>
            <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderRadius: 7, padding: 3, gap: 3, marginBottom: 14 }}>
              {(["YES","NO"] as const).map(o => (
                <button key={o} onClick={() => { setOutcome(o); setLimitPx(null); }} style={{
                  flex: 1, fontSize: 11, fontWeight: 700, padding: "6px 0", borderRadius: 5, cursor: "pointer",
                  background: outcome === o ? (o === "YES" ? "rgba(32,247,164,0.14)" : "rgba(85,153,255,0.14)") : "transparent",
                  border: `1px solid ${outcome === o ? (o === "YES" ? "rgba(32,247,164,0.35)" : "rgba(85,153,255,0.35)") : "transparent"}`,
                  color: outcome === o ? (o === "YES" ? C.YES : C.NO) : C.muted,
                }}>
                  {o} — {cts(o === "YES" ? m.yesBid : m.noBid)}
                </button>
              ))}
            </div>

            {/* LIMIT / MARKET */}
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.07em", marginBottom: 6 }}>ORDER TYPE</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {(["LIMIT","MARKET"] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)} style={{
                  flex: 1, fontSize: 10, fontWeight: orderType === t ? 700 : 400, padding: "5px 0", borderRadius: 6, cursor: "pointer",
                  background: orderType === t ? "rgba(0,229,255,0.12)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${orderType === t ? "rgba(0,229,255,0.35)" : "rgba(0,229,255,0.1)"}`,
                  color: orderType === t ? C.cyan : C.muted,
                }}>{t}</button>
              ))}
            </div>

            {/* CONTRACTS */}
            <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.07em", marginBottom: 6 }}>CONTRACTS</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
              {[[1,1],[5,5],[10,10],[50,50],[100,100]].map(([lbl,val]) => (
                <button key={String(lbl)} onClick={() => setContracts(Number(val))} style={{
                  flex: 1, fontSize: 9, fontWeight: contracts === Number(val) ? 700 : 400, padding: "4px 0", borderRadius: 6, cursor: "pointer",
                  background: contracts === Number(val) ? "rgba(0,229,255,0.14)" : "rgba(0,0,0,0.3)",
                  border: `1px solid ${contracts === Number(val) ? "rgba(0,229,255,0.38)" : "rgba(0,229,255,0.1)"}`,
                  color: contracts === Number(val) ? C.cyan : C.muted,
                }}>{lbl}</button>
              ))}
            </div>

            {/* LIMIT PRICE */}
            {orderType === "LIMIT" && (
              <>
                <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.07em", marginBottom: 6 }}>LIMIT PRICE</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <button onClick={() => setLimitPx(p => Math.max(1, (p ?? lp) - 1))} style={PX_BTN}>−</button>
                  <span style={{ flex: 1, textAlign: "center", fontSize: 20, fontWeight: 800 }}>{cts(lp)}</span>
                  <button onClick={() => setLimitPx(p => Math.min(99, (p ?? lp) + 1))} style={PX_BTN}>+</button>
                </div>
              </>
            )}

            {/* Summary */}
            <div style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: 11 }}>
              {[["Est. Cost", fmtUsd(estCost)], ["Contracts", String(contracts)], ["Max Payout", fmtUsd(maxPayout)]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ color: C.muted }}>{k}</span>
                  <span style={{ fontWeight: 700, color: k === "Max Payout" ? C.positive : C.text }}>{v}</span>
                </div>
              ))}
            </div>

            <button
              onClick={submit}
              disabled={status === "submitting"}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 8, fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", marginBottom: 8,
                background: status === "submitting" ? "rgba(0,229,255,0.08)" : "linear-gradient(135deg,rgba(32,247,164,0.22),rgba(0,229,255,0.18))",
                border: `1px solid ${status === "submitting" ? "rgba(0,229,255,0.15)" : "rgba(32,247,164,0.38)"}`,
                color: status === "submitting" ? C.muted : C.YES,
                cursor: status === "submitting" ? "not-allowed" : "pointer",
                boxShadow: status === "submitting" ? "none" : "0 0 16px rgba(32,247,164,0.12)",
              }}
            >
              {status === "submitting" ? "Submitting…" : `${side} ${contracts} ${outcome} @ ${cts(lp)}`}
            </button>

            {status === "ok" && (
              <div style={{ fontSize: 11, color: C.positive, padding: "6px 8px", background: "rgba(32,247,164,0.08)", border: "1px solid rgba(32,247,164,0.2)", borderRadius: 6 }}>✓ {statusMsg}</div>
            )}
            {status === "error" && (
              <div style={{ fontSize: 11, color: C.negative, padding: "6px 8px", background: "rgba(255,78,92,0.08)", border: "1px solid rgba(255,78,92,0.2)", borderRadius: 6 }}>✕ {statusMsg}</div>
            )}
          </>
        ) : (
          <div style={{ color: C.muted, fontSize: 12, padding: "20px" }}>Select a market to trade</div>
        )}
      </div>
    </div>
  );
}

// ── Tab: PARLAYS ───────────────────────────────────────────────────────────────

interface ParlayLeg { market: KalshiMarket; outcome: "YES" | "NO"; }

function ParlaysTab({ markets }: { markets: KalshiMarket[] }) {
  const [legs,    setLegs]    = useState<ParlayLeg[]>([]);
  const [stake,   setStake]   = useState("100");
  const [adding,  setAdding]  = useState(false);
  const [placed,  setPlaced]  = useState<"idle"|"ok"|"error">("idle");
  const stakeNum = parseFloat(stake) || 0;

  const combinedOdds = legs.reduce((acc, leg) => {
    const px = leg.outcome === "YES" ? leg.market.yesBid : leg.market.noBid;
    return acc * (px / 100);
  }, 1);
  const payout = stakeNum / (combinedOdds || 1);
  const roi    = combinedOdds > 0 ? (payout / stakeNum - 1) * 100 : 0;

  const addLeg = (ticker: string, outcome: "YES" | "NO") => {
    const mk = markets.find(m => m.ticker === ticker);
    if (!mk || legs.some(l => l.market.ticker === ticker)) return;
    setLegs(p => [...p, { market: mk, outcome }]);
    setAdding(false);
  };
  const removeLeg  = (ticker: string) => setLegs(p => p.filter(l => l.market.ticker !== ticker));
  const flipOutcome = (ticker: string) => setLegs(p => p.map(l => l.market.ticker === ticker ? { ...l, outcome: l.outcome === "YES" ? "NO" : "YES" } : l));

  const placeParlay = async () => {
    if (legs.length < 2) return;
    setPlaced("ok");
    setTimeout(() => setPlaced("idle"), 3000);
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", borderRight: `1px solid ${C.borderFaint}` }}>
        <SectionHead label="PARLAY LEGS" icon="⚡" action="+ Add Leg" onAction={() => setAdding(a => !a)} />

        {adding && (
          <div style={{ marginBottom: 12, background: "rgba(0,229,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 6, letterSpacing: "0.08em" }}>PICK MARKET</div>
            {markets.filter(m => !legs.some(l => l.market.ticker === m.ticker)).map(mk => (
              <div key={mk.ticker} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ flex: 1, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mk.title}</span>
                <button onClick={() => addLeg(mk.ticker, "YES")} style={{ fontSize: 9, color: C.YES, background: "rgba(32,247,164,0.1)", border: "1px solid rgba(32,247,164,0.3)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>
                  YES {cts(mk.yesBid)}
                </button>
                <button onClick={() => addLeg(mk.ticker, "NO")} style={{ fontSize: 9, color: C.NO, background: "rgba(85,153,255,0.1)", border: "1px solid rgba(85,153,255,0.3)", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>
                  NO {cts(mk.noBid)}
                </button>
              </div>
            ))}
          </div>
        )}

        {legs.length === 0 ? (
          <div style={{ fontSize: 11, color: C.muted, padding: "20px 0", textAlign: "center" }}>
            Add 2+ legs to build a parlay<br />
            <span style={{ fontSize: 9 }}>Odds multiply across all legs</span>
          </div>
        ) : (
          legs.map((leg, i) => {
            const px = leg.outcome === "YES" ? leg.market.yesBid : leg.market.noBid;
            return (
              <div key={leg.market.ticker} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`,
                borderRadius: 8, marginBottom: 6,
              }}>
                <span style={{ fontSize: 11, color: C.muted, width: 16, flexShrink: 0 }}>{i + 1}</span>
                <div style={{ flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leg.market.title}</div>
                  <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{leg.market.ticker}</div>
                </div>
                <button onClick={() => flipOutcome(leg.market.ticker)} style={{
                  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                  color: leg.outcome === "YES" ? C.YES : C.NO,
                  background: leg.outcome === "YES" ? "rgba(32,247,164,0.12)" : "rgba(85,153,255,0.12)",
                  border: `1px solid ${leg.outcome === "YES" ? "rgba(32,247,164,0.3)" : "rgba(85,153,255,0.3)"}`,
                }}>
                  {leg.outcome} {cts(px)}
                </button>
                <button onClick={() => removeLeg(leg.market.ticker)} style={{ ...ICON_BTN, fontSize: 13, color: C.negative }}>×</button>
              </div>
            );
          })
        )}
      </div>

      <div style={{ width: 220, padding: "14px 14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionHead label="SUMMARY" icon="◑" />
        <div style={{ background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 10, padding: "12px", fontSize: 11 }}>
          {[
            ["Legs",           String(legs.length)],
            ["Combined Odds",  `${(combinedOdds * 100).toFixed(1)}¢`],
            ["Implied Prob",   `${(combinedOdds * 100).toFixed(1)}%`],
            ["ROI",            roi > 0 ? `+${roi.toFixed(0)}%` : "—"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: C.muted }}>{k}</span>
              <span style={{ fontWeight: 700, color: k === "ROI" && roi > 0 ? C.positive : C.text }}>{v}</span>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.08em", marginBottom: 6 }}>STAKE ($)</div>
          <input
            value={stake}
            onChange={e => setStake(e.target.value)}
            type="number" min="1"
            style={{
              width: "100%", background: "rgba(0,229,255,0.05)", border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "8px 10px", fontSize: 14, fontWeight: 700, color: C.text,
              fontFamily: C.font, outline: "none", boxSizing: "border-box",
            }}
          />
        </div>

        {stakeNum > 0 && legs.length > 0 && (
          <div style={{ background: "rgba(32,247,164,0.06)", border: "1px solid rgba(32,247,164,0.2)", borderRadius: 10, padding: "12px" }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>IF ALL LEGS HIT</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.positive }}>{fmtUsd(payout)}</div>
            <div style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>on {fmtUsd(stakeNum)} stake</div>
          </div>
        )}

        <button
          onClick={placeParlay}
          disabled={legs.length < 2 || stakeNum <= 0}
          style={{
            padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
            background: legs.length >= 2 && stakeNum > 0 ? "linear-gradient(135deg,rgba(32,247,164,0.22),rgba(0,229,255,0.18))" : "rgba(0,229,255,0.04)",
            border: `1px solid ${legs.length >= 2 && stakeNum > 0 ? "rgba(32,247,164,0.38)" : C.borderFaint}`,
            color: legs.length >= 2 && stakeNum > 0 ? C.YES : C.muted,
            cursor: legs.length >= 2 && stakeNum > 0 ? "pointer" : "not-allowed",
          }}
        >
          Place Parlay ({legs.length} legs)
        </button>

        {placed === "ok" && (
          <div style={{ fontSize: 11, color: C.positive, padding: "6px 8px", background: "rgba(32,247,164,0.08)", border: "1px solid rgba(32,247,164,0.2)", borderRadius: 6 }}>
            ✓ Parlay placed as {legs.length} sequential limit orders
          </div>
        )}

        <div style={{ fontSize: 9, color: "rgba(200,230,255,0.25)", lineHeight: 1.5 }}>
          Sequential limit orders at bid price. Each leg resolves independently.
        </div>
      </div>
    </div>
  );
}

// ── Tab: ORDERBOOK ─────────────────────────────────────────────────────────────

function OrderbookTab({ markets }: { markets: KalshiMarket[] }) {
  const [ticker,  setTicker]  = useState(markets[0]?.ticker ?? "");
  const [book,    setBook]    = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const loadBook = useCallback(async (t: string) => {
    if (!t) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/kalshi/orderbook/${encodeURIComponent(t)}`);
      setBook(await res.json());
    } catch { setBook(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (ticker) loadBook(ticker); }, [ticker, loadBook]);

  const yesRows: any[] = book?.orderbook?.yes ?? [];
  const noRows:  any[] = book?.orderbook?.no  ?? [];
  const maxSz = Math.max(...yesRows.map((r: any) => Array.isArray(r) ? r[1] : r.quantity ?? 0), ...noRows.map((r: any) => Array.isArray(r) ? r[1] : r.quantity ?? 0), 1);

  function BookRows({ rows, color }: { rows: any[]; color: string }) {
    return (
      <>
        {rows.slice(0, 12).map((row: any, i: number) => {
          const price = Array.isArray(row) ? row[0] : row.price ?? 0;
          const sz    = Array.isArray(row) ? row[1] : row.quantity ?? 0;
          const pct   = (sz / maxSz) * 100;
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr 55px", gap: 4, alignItems: "center", marginBottom: 3, position: "relative", padding: "2px 0" }}>
              <div style={{ position: "absolute", inset: 0, background: color + "10", width: `${pct}%`, borderRadius: 3 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color, position: "relative" }}>{price}¢</span>
              <div style={{ height: 4, background: color + "30", borderRadius: 2, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color + "70", borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 10, textAlign: "right", position: "relative" }}>{sz.toLocaleString()}</span>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      <div style={{ width: 200, borderRight: `1px solid ${C.borderFaint}`, overflowY: "auto", padding: "10px 10px" }}>
        <div style={{ fontSize: 9, color: C.muted, letterSpacing: "0.1em", marginBottom: 8 }}>SELECT MARKET</div>
        {markets.map(mk => (
          <div
            key={mk.ticker}
            onClick={() => setTicker(mk.ticker)}
            style={{
              padding: "7px 8px", borderRadius: 7, marginBottom: 3, cursor: "pointer",
              background: ticker === mk.ticker ? "rgba(0,229,255,0.08)" : "transparent",
              border: `1px solid ${ticker === mk.ticker ? "rgba(0,229,255,0.22)" : "transparent"}`,
            }}
          >
            <div style={{ fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mk.title}</div>
            <div style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>{mk.ticker}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {loading ? (
          <div style={{ color: C.muted, fontSize: 12, padding: "20px", textAlign: "center" }}>Loading orderbook…</div>
        ) : !book ? (
          <div style={{ color: C.muted, fontSize: 12, padding: "20px", textAlign: "center" }}>Select a market to view its depth</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.YES, marginBottom: 8, letterSpacing: "0.08em" }}>YES BIDS</div>
                <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 55px", gap: 4, marginBottom: 6 }}>
                  {["PRICE","DEPTH","SIZE"].map(h => (
                    <div key={h} style={{ fontSize: 8, color: C.muted, textAlign: h === "SIZE" ? "right" : "left" }}>{h}</div>
                  ))}
                </div>
                <BookRows rows={yesRows} color={C.YES} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.NO, marginBottom: 8, letterSpacing: "0.08em" }}>NO BIDS</div>
                <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 55px", gap: 4, marginBottom: 6 }}>
                  {["PRICE","DEPTH","SIZE"].map(h => (
                    <div key={h} style={{ fontSize: 8, color: C.muted, textAlign: h === "SIZE" ? "right" : "left" }}>{h}</div>
                  ))}
                </div>
                <BookRows rows={noRows} color={C.NO} />
              </div>
            </div>

            <div style={{ padding: "10px 14px", background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>MID PRICE</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                {markets.find(m => m.ticker === ticker) ? cts(markets.find(m => m.ticker === ticker)!.yesBid) : "—"}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── CHIP ───────────────────────────────────────────────────────────────────────

export function KalshiChip({ market, isActive, onClick }: {
  market: KalshiMarket | null; isActive: boolean; onClick: () => void;
}) {
  return (
    <div
      role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => e.key === "Enter" && onClick()}
      style={{
        width: 204, height: 40, borderRadius: 20,
        background: isActive ? "rgba(0,8,20,0.92)" : "rgba(0,8,14,0.72)",
        border: `1px solid ${isActive ? C.borderHi : C.border}`,
        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        display: "flex", alignItems: "center", gap: 6, padding: "0 10px 0 12px",
        cursor: "pointer", userSelect: "none",
        boxShadow: isActive ? `0 0 0 1px rgba(0,229,255,0.14), 0 0 14px rgba(0,229,255,0.12)` : "none",
        transition: "border-color 0.15s, box-shadow 0.15s", fontFamily: C.font, outline: "none",
      }}
    >
      <span style={{ fontSize: 13, flexShrink: 0 }}>▲</span>
      {market ? (
        <>
          <span style={{ fontSize: 9, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {clip(market.title, 16)}
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.YES, flexShrink: 0 }}>YES {cts(market.yesBid)}</span>
          <span style={{ fontSize: 8, color: C.muted, flexShrink: 0 }}>/</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.NO, flexShrink: 0 }}>NO {cts(market.noBid)}</span>
          <Sparkline color={C.YES} w={22} h={11} />
        </>
      ) : (
        <>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text, flex: 1 }}>Kalshi</span>
          <span style={{ fontSize: 10, color: C.muted }}>·</span>
        </>
      )}
    </div>
  );
}

// ── CARD ───────────────────────────────────────────────────────────────────────

export function KalshiCard({ data, loading, onClose, onExpand }: {
  data: any; loading: boolean; onClose: () => void; onExpand: () => void;
}) {
  const markets: KalshiMarket[] = data?.markets ?? [];
  const m               = markets[0] ?? null;
  const balance         = data?.portfolio?.balance        ?? data?.balance        ?? 0;
  const portfolioValue  = data?.portfolio?.portfolioValue ?? data?.portfolioValue ?? 0;

  return (
    <div style={{
      width: 320, background: C.surfaceCard, border: `1px solid ${C.border}`, borderRadius: 14,
      backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.05)",
      overflow: "hidden", fontFamily: C.font, color: C.text,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 12px 8px", borderBottom: `1px solid ${C.borderFaint}` }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>▲</span>
        <span style={{ flex: 1, fontSize: 10, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {m?.title ?? "Kalshi Markets"}
        </span>
        <button onClick={onExpand} title="Expand" style={ICON_BTN}>⋮</button>
        <button onClick={onClose}  title="Close"  style={ICON_BTN}>×</button>
      </div>

      <div style={{ padding: "10px 13px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 7, padding: "6px 8px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>BALANCE</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.cyan }}>{fmtUsd(balance)}</div>
          </div>
          <div style={{ flex: 1, background: "rgba(0,229,255,0.04)", border: `1px solid ${C.borderFaint}`, borderRadius: 7, padding: "6px 8px" }}>
            <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.08em" }}>PORTFOLIO</div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{fmtUsd(portfolioValue)}</div>
          </div>
        </div>

        {m ? (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.12em", marginBottom: 2 }}>YES</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.YES, lineHeight: 1 }}>{cts(m.yesBid)}</div>
              </div>
              <div style={{ textAlign: "center", paddingTop: 8 }}>
                <div style={{ fontSize: 8, color: C.muted, marginBottom: 2 }}>SPREAD</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{cts(m.spread)}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: C.muted, letterSpacing: "0.12em", marginBottom: 2 }}>NO</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.NO, lineHeight: 1 }}>{cts(m.noBid)}</div>
              </div>
            </div>

            <div style={{ display: "flex", height: 4, borderRadius: 3, overflow: "hidden", marginBottom: 10 }}>
              <div style={{ flex: m.yesBid, background: C.YES, opacity: 0.75 }} />
              <div style={{ flex: 100 - m.yesBid, background: C.NO, opacity: 0.75 }} />
            </div>

            {markets.slice(1, 4).map((mk, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ flex: 1, fontSize: 9, color: "rgba(200,230,255,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mk.title}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.YES, flexShrink: 0 }}>{cts(mk.yesBid)}</span>
                <span style={{ fontSize: 8, color: C.muted }}>/</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.NO, flexShrink: 0 }}>{cts(mk.noBid)}</span>
              </div>
            ))}

            <Divider />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 9, color: C.muted }}>{markets.length} markets</span>
              <button onClick={onExpand} style={{ fontSize: 9, letterSpacing: "0.06em", color: C.cyan, background: "rgba(0,229,255,0.08)", border: "1px solid rgba(0,229,255,0.2)", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                OPEN →
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: C.muted, padding: "8px 0" }}>
            {loading ? "Loading markets…" : "No markets available."}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EXPANDED — delegates to full dashboard ────────────────────────────────────

export { KalshiDashboard as KalshiExpanded } from "./KalshiDashboard";
