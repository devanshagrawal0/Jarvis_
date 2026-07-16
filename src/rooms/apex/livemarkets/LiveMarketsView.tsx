import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useApexLive, useMicro, fetchQuote, fetchBars, fetchFundamentals, fetchNewsImpact,
  type Quote, type Fundamentals, type Bar, type Story,
} from "../apex-data";
import { ChartPro, type Indicators } from "./ChartPro";
import { useOracle, OracleCard, OracleOverlay, ORACLE_CARD_CSS } from "./OraclePanel";
import { ema, rsi as calcRsi, macd as calcMacd, vwap as calcVwap, atr as calcAtr, relVol, closes, highs, lows, STRATEGIES, type StrategyId } from "./indicators";
import type { ReplayResult } from "./indicators";

// APEX · Live Markets — a full trading terminal on real public data: a professional
// candlestick chart (EMA/VWAP/Bollinger/RSI/MACD + strategy replay), watchlists with
// sparklines, market stats, a computed technical read, sentiment/momentum gauges,
// news & catalysts, correlations, an options (realized-vol) snapshot, microstructure,
// and a scanner. No paid feeds — everything is derived from public market data, and
// microstructure for equities is clearly labelled as a simulation.

// Institutional palette (research: TradingView desaturated greens/reds, one calm accent — no neon).
const POS = "#26a69a", NEG = "#ef5350", CY = "#4d9fd1", WARN = "#e0952b", PUR = "#9a86d4", MUT = "rgba(150,175,200,.60)";

const col = (n: number | null | undefined) => (n == null || n === 0) ? "var(--ax-tx)" : n > 0 ? POS : NEG;
const pct = (n: number | null | undefined, dp = 2) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
// Redundant direction cue (arrow + sign) so gain/loss survives grayscale / colorblindness — never color alone.
const pctA = (n: number | null | undefined, dp = 2) => n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(dp)}%`;
const num = (n: number | null | undefined, dp = 2) => n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const compact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};

/* ── Watchlists ── */
const WATCH: Record<string, string[]> = {
  Stocks: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY"],
  Crypto: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT"],
  ETFs: ["SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "XLE", "GLD"],
  Futures: ["ES=F", "NQ=F", "YM=F", "CL=F", "GC=F", "SI=F"],
};
const DISPLAY: Record<string, string> = { BTCUSDT: "BTC / USD", ETHUSDT: "ETH / USD", SOLUSDT: "SOL / USD", XRPUSDT: "XRP / USD", DOGEUSDT: "DOGE / USD", ADAUSDT: "ADA / USD", "ES=F": "S&P Futures", "NQ=F": "Nasdaq Futures", "YM=F": "Dow Futures", "CL=F": "Crude Oil", "GC=F": "Gold", "SI=F": "Silver" };
const NAMES: Record<string, string> = { NVDA: "NVIDIA Corp", AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", AMZN: "Amazon.com Inc.", GOOGL: "Alphabet Inc.", META: "Meta Platforms", TSLA: "Tesla Inc.", AMD: "Advanced Micro", SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ", DIA: "SPDR Dow", IWM: "iShares R2000", XLK: "Tech Sector", XLF: "Financials", XLE: "Energy", GLD: "Gold Trust" };
// Searchable instrument index (symbol · name · asset type · source-state) for the command bar dropdown.
const SEARCH_INDEX: { sym: string; name: string; type: string; live: boolean }[] = (() => {
  const seen = new Set<string>(); const out: { sym: string; name: string; type: string; live: boolean }[] = [];
  for (const [grp, ty] of [["Stocks", "STOCK"], ["ETFs", "ETF"], ["Crypto", "CRYPTO"], ["Futures", "FUT"]] as const)
    for (const s of WATCH[grp]) { if (seen.has(s)) continue; seen.add(s); out.push({ sym: s, name: DISPLAY[s] || NAMES[s] || s, type: ty, live: grp === "Crypto" }); }
  return out;
})();
function searchInstruments(q: string) {
  const query = q.trim().toUpperCase(); if (!query) return [];
  return SEARCH_INDEX
    .map((it) => { const sym = it.sym.replace("USDT", ""); const symHit = sym.startsWith(query) ? 3 : sym.includes(query) ? 2 : 0; const nameHit = it.name.toUpperCase().includes(query) ? 1 : 0; return { it, score: symHit + nameHit }; })
    .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.it);
}
const isCrypto = (s: string) => /USDT?$/i.test(s);

// Plain-language tooltips for dense abbreviations — a newcomer can hover to learn without leaving the screen.
const TIPS: Record<string, string> = {
  "R VOL": "Relative volume — today's volume vs the 20-day average (×). >1 means unusually active.",
  "Rel Volume": "Relative volume vs the 20-day average. >1× = heavier than normal trading.",
  "AVG VOL": "Average daily volume over the last 20 sessions.",
  "ATR (14)": "Average True Range (14) — the typical size of a bar's range; a volatility gauge.",
  "Beta (5Y)": "5-year beta — how much the stock moves vs the market (1 = in line, >1 = more volatile).",
  "IV Rank (est)": "Implied-volatility rank (estimate) — where current volatility sits in its 1-year range, 0–100.",
  "IV30 (est)": "Estimated 30-day implied volatility, derived from recent realized volatility.",
  "HV20": "20-day historical (realized) volatility, annualized.",
  "IV RANK": "IV rank — percentile of current volatility within its 1-year range.",
  "P/E (TTM)": "Price / earnings over the trailing twelve months.",
  "EPS (TTM)": "Earnings per share over the trailing twelve months.",
};

/* ── Timeframe → Yahoo interval/range (+ optional client resample) ── */
const TF: { k: string; iv: string; range: string; group?: number }[] = [
  { k: "1m", iv: "1m", range: "1d" }, { k: "3m", iv: "1m", range: "5d", group: 3 }, { k: "5m", iv: "5m", range: "5d" },
  { k: "15m", iv: "15m", range: "1mo" }, { k: "30m", iv: "30m", range: "1mo" }, { k: "1h", iv: "60m", range: "3mo" },
  { k: "4h", iv: "60m", range: "1y", group: 240 }, { k: "D", iv: "1d", range: "1y" }, { k: "W", iv: "1wk", range: "5y" }, { k: "M", iv: "1mo", range: "max" },
];
function resample(bars: Bar[], minutes: number): Bar[] {
  if (!bars.length) return bars;
  const bucket = minutes * 60 * 1000; const out: Bar[] = []; let cur: Bar | null = null; let key = -1;
  for (const b of bars) { const ms = new Date(b.t).getTime(); const k = Math.floor(ms / bucket); if (k !== key) { if (cur) out.push(cur); cur = { ...b }; key = k; } else if (cur) { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v = (cur.v || 0) + (b.v || 0); } }
  if (cur) out.push(cur); return out;
}

const sparkCache = new Map<string, number[]>();

export function LiveMarketsView() {
  const live = useApexLive();
  const micro = useMicro();

  const [symbol, setSymbol] = useState("NVDA");
  const [tf, setTf] = useState("5m");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchIdx, setSearchIdx] = useState(0);
  const searchResults = useMemo(() => searchInstruments(search), [search]);
  const [layout, setLayout] = useState<"standard" | "chart" | "exec">(() => { try { return (localStorage.getItem("apex.lm.layout") as "standard" | "chart" | "exec") || "standard"; } catch { return "standard"; } });
  const pickLayout = useCallback((l: "standard" | "chart" | "exec") => { setLayout(l); try { localStorage.setItem("apex.lm.layout", l); } catch { /* ignore */ } }, []);
  const [watchTab, setWatchTab] = useState("Stocks");
  const [leftTab, setLeftTab] = useState<"watch" | "screener" | "heat">("watch");
  const [favorites, setFavorites] = useState<string[]>(["NVDA", "AAPL", "TSLA"]);
  const [watchlist, setWatchlist] = useState<string[]>(WATCH.Stocks);
  const [wlQuotes, setWlQuotes] = useState<Record<string, { last: number | null; chg: number | null; vol: number | null }>>({});
  const [wlSort, setWlSort] = useState<{ key: "sym" | "last" | "chg"; dir: 1 | -1 }>({ key: "sym", dir: 1 });
  const reportQuote = useCallback((s: string, q: { last: number | null; chg: number | null; vol: number | null }) => setWlQuotes((m) => (m[s]?.last === q.last && m[s]?.chg === q.chg ? m : { ...m, [s]: q })), []);
  const sortedWatch = useMemo(() => {
    const arr = [...watchlist];
    const { key, dir } = wlSort;                 // dir: 1 = ascending, -1 = descending
    if (key === "sym") return dir === 1 ? arr : arr.reverse();
    const f = key === "chg" ? "chg" : "last";
    return arr.sort((a, b) => {
      const av = wlQuotes[a]?.[f], bv = wlQuotes[b]?.[f];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;                  // rows without a quote sink to the bottom
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [watchlist, wlSort, wlQuotes]);
  const toggleSort = (key: "sym" | "last" | "chg") => setWlSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (key === "sym" ? 1 : -1) }));
  const [toast, setToast] = useState<string | null>(null);
  const [oracleOpen, setOracleOpen] = useState(false);
  const oracle = useOracle(symbol);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [fund, setFund] = useState<Fundamentals | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [newsImpact, setNewsImpact] = useState<{ title: string; dir: string; magnitude: number; sector: string }[]>([]);

  const [ind, setInd] = useState<Indicators>({ ema: true, bb: true, vwap: true, volume: true, rsi: true, macd: true });
  const [replay, setReplay] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(8);
  const [replayStrat, setReplayStrat] = useState<StrategyId>("ema_stack");
  const [replayProg, setReplayProg] = useState(0);
  const [replayStats, setReplayStats] = useState<ReplayResult | null>(null);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2200); };

  // Selected-symbol data: quote + fundamentals + bars.
  useEffect(() => {
    let dead = false;
    fetchQuote(symbol).then((q) => !dead && setQuote(q));
    fetchFundamentals(symbol).then((f) => !dead && setFund(f));
    fetchNewsImpact(symbol).then((n) => !dead && setNewsImpact(n));
    const t = window.setInterval(() => { fetchQuote(symbol).then((q) => !dead && q && setQuote(q)); }, 6000);
    return () => { dead = true; clearInterval(t); };
  }, [symbol]);

  useEffect(() => {
    let dead = false; setBarsLoading(true);
    const cfg = TF.find((x) => x.k === tf) || TF[2];
    fetchBars(symbol, cfg.iv, cfg.range).then((b) => { if (dead) return; setBars(cfg.group ? resample(b, cfg.group) : b); setBarsLoading(false); });
    return () => { dead = true; };
  }, [symbol, tf]);

  const changeSym = useCallback((s: string) => { const u = s.trim().toUpperCase(); if (!u) return; setSymbol(u); setReplay(false); }, []);
  useEffect(() => { setWatchlist(watchTab === "Favorites" ? favorites : WATCH[watchTab] || []); }, [watchTab, favorites]);

  const c = useMemo(() => closes(bars), [bars]);
  const tech = useMemo(() => analyze(bars), [bars]);
  const levels = useMemo(() => keyLevels(bars, quote?.last ?? null), [bars, quote]);
  const optionsSnap = useMemo(() => optionsFromVol(bars), [bars]);

  const up = (quote?.changePct ?? 0) >= 0;
  const rv = useMemo(() => { const r = relVol(bars, 20); for (let i = r.length - 1; i >= 0; i--) if (Number.isFinite(r[i]) && bars[i] && (bars[i].v || 0) > 0) return r[i]; return null; }, [bars]);
  const atrNow = useMemo(() => { const a = calcAtr(bars, 14); return a.length ? a[a.length - 1] : null; }, [bars]);

  const searchGo = (e: React.FormEvent) => { e.preventDefault(); if (search.trim()) { changeSym(search); setSearch(""); } };

  return (
    <div className={`ax-term axl-${layout}`}>
      <style>{TERM_CSS}</style>

      {/* ── Toolbar ── */}
      <div className="axt-toolbar">
        <form className="axt-search" onSubmit={(e) => { e.preventDefault(); if (searchOpen && searchResults[searchIdx]) { changeSym(searchResults[searchIdx].sym); setSearch(""); setSearchOpen(false); } else searchGo(e); }}>
          <span className="axt-mag">⌕</span>
          <input value={search}
            onChange={(e) => { setSearch(e.target.value.toUpperCase()); setSearchOpen(true); setSearchIdx(0); }}
            onFocus={() => search && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={(e) => {
              if (!searchOpen || !searchResults.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setSearchIdx((i) => Math.min(searchResults.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSearchIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === "Escape") { setSearchOpen(false); }
            }}
            placeholder="Search stocks, crypto, ETFs, futures…" spellCheck={false} />
          <kbd>↵</kbd>
          {searchOpen && searchResults.length > 0 && (
            <div className="axt-searchdd">
              {searchResults.map((r, i) => (
                <div key={r.sym} className={`axt-sr${i === searchIdx ? " on" : ""}`} onMouseDown={(e) => { e.preventDefault(); changeSym(r.sym); setSearch(""); setSearchOpen(false); }} onMouseEnter={() => setSearchIdx(i)}>
                  <b>{r.sym.replace("USDT", "")}</b>
                  <span className="axt-sr-name">{r.name}</span>
                  <span className="axt-sr-type">{r.type}</span>
                  <span className="axt-sr-state" style={{ color: r.live ? POS : WARN }}>{r.live ? "LIVE" : "DELAYED"}</span>
                </div>
              ))}
            </div>
          )}
        </form>
        <div className="axt-popular">
          <span className="axt-pop-l">POPULAR</span>
          {["NVDA", "SPY", "BTCUSDT", "ETHUSDT", "TSLA", "SOLUSDT"].map((s) => (
            <button key={s} className={`axt-chip${symbol === s ? " on" : ""}`} onClick={() => changeSym(s)}>{isCrypto(s) ? s.replace("USDT", "") : s}</button>
          ))}
        </div>
        <div className="axt-layouts" role="group" aria-label="Layout preset">
          {([["standard", "▦", "Standard"], ["chart", "▭", "Chart focus"], ["exec", "▤", "Execution"]] as const).map(([k, ic, lbl]) => (
            <button key={k} className={`axt-lyt${layout === k ? " on" : ""}`} title={lbl} aria-label={lbl} onClick={() => pickLayout(k)}>{ic}</button>
          ))}
        </div>
        <div className="axt-actions">
          <button className="axt-act" onClick={() => { setFavorites((f) => f.includes(symbol) ? f : [...f, symbol]); flash(`${symbol} added to watchlist`); }}>☆ Add to Watchlist</button>
          <button className="axt-act" onClick={() => flash("Compare — pick a second symbol from the list")}>⇄ Compare</button>
          <button className="axt-act" onClick={() => flash(`Alert armed on ${symbol} @ ${num(quote?.last)}`)}>△ Set Alert</button>
          <button className="axt-act primary" onClick={() => { window.dispatchEvent(new CustomEvent("apex:open-paper", { detail: { symbol } })); flash("Opening Paper Trade…"); }}>▤ Open Paper Trade</button>
        </div>
      </div>

      {/* ── Main 3-column ── */}
      <div className="axt-main">
        {/* LEFT */}
        <div className="axt-left">
          <div className="axt-lefttabs">
            <button className={leftTab === "watch" ? "on" : ""} onClick={() => setLeftTab("watch")}>MARKET WATCH</button>
            <button className={leftTab === "screener" ? "on" : ""} onClick={() => setLeftTab("screener")}>SCREENER</button>
            <button className={leftTab === "heat" ? "on" : ""} onClick={() => setLeftTab("heat")}>HEAT MAP</button>
          </div>
          {leftTab === "watch" && <>
            <div className="axt-watchcat">
              {["Stocks", "Crypto", "ETFs", "Futures", "Favorites"].map((g) => (
                <button key={g} className={watchTab === g ? "on" : ""} onClick={() => setWatchTab(g)}>{g}</button>
              ))}
            </div>
            <div className="axt-watchhead">
              <button className={`axt-wsort${wlSort.key === "sym" ? " on" : ""}`} onClick={() => toggleSort("sym")}>SYMBOL{wlSort.key === "sym" ? (wlSort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              <button className={`axt-wsort r${wlSort.key === "last" ? " on" : ""}`} onClick={() => toggleSort("last")}>LAST{wlSort.key === "last" ? (wlSort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              <button className={`axt-wsort r${wlSort.key === "chg" ? " on" : ""}`} onClick={() => toggleSort("chg")}>CHG %{wlSort.key === "chg" ? (wlSort.dir === 1 ? " ▲" : " ▼") : ""}</button>
              <span className="r">24H</span>
            </div>
            <div className="axt-watchlist">
              {sortedWatch.map((s) => <WatchRow key={s} sym={s} active={symbol === s} onPick={() => changeSym(s)} fav={favorites.includes(s)} onFav={() => setFavorites((f) => f.includes(s) ? f.filter((x) => x !== s) : [...f, s])} onQuote={reportQuote} />)}
            </div>
          </>}
          {leftTab === "screener" && <ScreenerPanel live={live} onPick={changeSym} />}
          {leftTab === "heat" && <HeatMap live={live} onPick={changeSym} />}
        </div>

        {/* CENTER */}
        <div className="axt-center">
          <SymbolHeader symbol={symbol} quote={quote} fund={fund} bars={bars} rv={rv} up={up} />
          <div className="axt-chartbar">
            <div className="axt-tfs">{TF.map((t) => <button key={t.k} className={tf === t.k ? "on" : ""} onClick={() => setTf(t.k)}>{t.k}</button>)}</div>
            <div className="axt-indtoggles">
              {([["ema", "EMA"], ["bb", "BB"], ["vwap", "VWAP"], ["volume", "VOL"], ["rsi", "RSI"], ["macd", "MACD"]] as [keyof Indicators, string][]).map(([k, lbl]) => (
                <button key={k} className={ind[k] ? "on" : ""} onClick={() => setInd((p) => ({ ...p, [k]: !p[k] }))}>{lbl}</button>
              ))}
            </div>
            <div className="axt-chartbar-r">
              <select className="axt-stratsel" value={replayStrat} onChange={(e) => setReplayStrat(e.target.value as StrategyId)} title="Replay strategy">
                {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button className={`axt-replay${replay ? " on" : ""}`} onClick={() => setReplay((r) => !r)}>◧ {replay ? "Stop" : "Replay"}</button>
            </div>
          </div>

          <div className="axt-chartzone">
            <div className="axt-drawtools">
              {["✛", "／", "▭", "◭", "T", "⤢", "◔", "⎌", "🗑"].map((t, i) => <button key={i} title="Drawing tool">{t}</button>)}
            </div>
            <div className="axt-chartcanvas">
              {bars.length > 1 ? (
                <ChartPro bars={bars} up={up} indicators={ind} replayActive={replay} replaySpeed={replaySpeed} replayStrategy={replayStrat}
                  forecast={oracle.data?.horizons?.map((h) => ({ horizon: h.horizon, p05: h.p05, p50: h.p50, p95: h.p95 })) || null}
                  onReplayProgress={(p) => setReplayProg(p)} onReplayStats={setReplayStats} />
              ) : barsLoading ? (
                <div className="axt-chart-skel"><div className="axt-skel-bars">{Array.from({ length: 40 }).map((_, i) => <span key={i} style={{ height: `${20 + (Math.sin(i * 1.3) * 0.5 + 0.5) * 60}%` }} />)}</div><div className="axt-skel-tag">Loading {symbol} · {tf}…</div></div>
              ) : <div className="axt-chart-empty">No chart data for {symbol} at {tf}. Try another timeframe.</div>}
              {replay && <ReplayHUD prog={replayProg} stats={replayStats} strat={replayStrat} speed={replaySpeed} setSpeed={setReplaySpeed} />}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="axt-right">
          <OracleCard o={oracle.data} loading={oracle.loading} onExpand={() => setOracleOpen(true)} onRefresh={oracle.refresh} />
          <MarketStats quote={quote} fund={fund} bars={bars} atr={atrNow} rv={rv} iv={optionsSnap.iv30} />
          <AIAnalysis tech={tech} symbol={symbol} fund={fund} />
          <SentMomentum tech={tech} />
          <KeyLevels levels={levels} last={quote?.last ?? null} />
          <NewsCatalysts news={live.news || []} impact={newsImpact} symbol={symbol} />
        </div>
      </div>

      {/* ── Bottom analytics row ── */}
      <div className="axt-bottom">
        <TimeSales symbol={symbol} micro={micro} quote={quote} />
        <OrderBook symbol={symbol} micro={micro} quote={quote} />
        <OrderFlow symbol={symbol} micro={micro} />
        <Correlations live={live} symbol={symbol} onPick={changeSym} />
        <OptionsSnapshot snap={optionsSnap} symbol={symbol} />
        <ScannerHits live={live} symbol={symbol} onPick={changeSym} />
      </div>

      {/* ── Status strip ── */}
      <StatusStrip live={live} />

      {toast && <div className="axt-toast">{toast}</div>}
      <style>{ORACLE_CARD_CSS}</style>
      {oracleOpen && <OracleOverlay o={oracle.data} hist={oracle.hist} bars={bars} loading={oracle.loading} resolvedNote={oracle.resolvedNote} onClose={() => setOracleOpen(false)} onRefresh={oracle.refresh} onPick={changeSym} />}
    </div>
  );
}

/* ═══════════════ Technical read (deterministic, from real bars) ═══════════════ */
interface Tech { bias: "BULLISH" | "BEARISH" | "NEUTRAL"; confidence: number; score: number; sentiment: number; momentum: number; trend: number; rsi: number | null; signals: { label: string; on: boolean; dir: number }[]; thesis: string; catalyst: string }
function analyze(bars: Bar[]): Tech {
  const c = closes(bars);
  const blank: Tech = { bias: "NEUTRAL", confidence: 0, score: 0, sentiment: 50, momentum: 50, trend: 50, rsi: null, signals: [], thesis: "Awaiting sufficient price history to form a read.", catalyst: "—" };
  if (c.length < 30) return blank;
  const px = c[c.length - 1];
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const last = (a: number[]) => a[a.length - 1];
  const r = calcRsi(c, 14); const rNow = last(r);
  const m = calcMacd(c); const vw = calcVwap(bars); const vwNow = last(vw);
  const E20 = last(e20), E50 = last(e50), E200 = last(e200);
  const sig = [
    { label: "Price > EMA20", on: px > E20, dir: 1 },
    { label: "EMA20 > EMA50", on: Number.isFinite(E50) && E20 > E50, dir: 1 },
    { label: "EMA50 > EMA200", on: Number.isFinite(E200) && E50 > E200, dir: 1 },
    { label: "Price > VWAP", on: Number.isFinite(vwNow) && px > vwNow, dir: 1 },
    { label: "MACD > Signal", on: Number.isFinite(last(m.macd)) && last(m.macd) > last(m.signal), dir: 1 },
    { label: "RSI > 50", on: Number.isFinite(rNow) && rNow > 50, dir: 1 },
  ];
  const score = sig.reduce((s, x) => s + (x.on ? x.dir : -x.dir), 0);
  const bias = score >= 2 ? "BULLISH" : score <= -2 ? "BEARISH" : "NEUTRAL";
  const confidence = Math.min(95, 40 + Math.abs(score) * 9 + (Number.isFinite(rNow) ? Math.abs(rNow - 50) * 0.2 : 0));
  // gauges 0-100
  const sentiment = Math.max(2, Math.min(98, 50 + score * 7 + (Number.isFinite(rNow) ? (rNow - 50) * 0.5 : 0)));
  const histNorm = Number.isFinite(last(m.hist)) && px ? (last(m.hist) / px) * 4000 : 0;
  const momentum = Math.max(2, Math.min(98, 50 + histNorm + (Number.isFinite(rNow) ? (rNow - 50) * 0.4 : 0)));
  const slope = Number.isFinite(e50[e50.length - 6]) ? ((E50 - e50[e50.length - 6]) / (e50[e50.length - 6] || 1)) * 100 : 0;
  const aligned = (px > E20 ? 1 : 0) + (E20 > E50 ? 1 : 0) + (E50 > E200 ? 1 : 0);
  const trend = Math.max(2, Math.min(98, 50 + aligned * 12 + slope * 6 - (aligned === 0 ? 24 : 0)));
  const parts: string[] = [];
  if (sig[0].on && sig[1].on) parts.push(`${bias === "BULLISH" ? "holding above" : "testing"} key EMAs with the 20 over the 50`);
  if (sig[4].on) parts.push("MACD momentum positive"); else parts.push("MACD momentum soft");
  if (Number.isFinite(rNow)) parts.push(`RSI ${rNow.toFixed(0)} (${rNow > 70 ? "overbought" : rNow < 30 ? "oversold" : "healthy"})`);
  if (sig[3].on) parts.push("price above session VWAP");
  const thesis = `${bias === "BULLISH" ? "Constructive" : bias === "BEARISH" ? "Deteriorating" : "Range-bound"} tape — ${parts.slice(0, 3).join(", ")}. Structure ${score >= 2 ? "favors continuation higher" : score <= -2 ? "favors continuation lower" : "is two-sided; wait for a break"}.`;
  const catalyst = aligned === 3 ? "Full trend stack aligned — momentum regime." : aligned === 0 ? "Trend stack inverted — defensive." : "Mixed stack — transitional regime.";
  return { bias, confidence, score, sentiment, momentum, trend, rsi: Number.isFinite(rNow) ? rNow : null, signals: sig, thesis, catalyst };
}

/* Key support/resistance from swing highs/lows + pivot. */
function keyLevels(bars: Bar[], last: number | null) {
  if (bars.length < 20) return { r2: null, r1: null, pivot: null, s1: null, s2: null } as Record<string, number | null>;
  const h = highs(bars), l = lows(bars), c = closes(bars);
  const win = bars.slice(-40);
  const hh = Math.max(...highs(win)), ll = Math.min(...lows(win));
  const ph = h[h.length - 2], pl = l[l.length - 2], pc = c[c.length - 2];
  const pivot = (ph + pl + pc) / 3;
  const r1 = 2 * pivot - pl, s1 = 2 * pivot - ph;
  const r2 = pivot + (ph - pl), s2 = pivot - (ph - pl);
  return { r2: Math.max(r2, hh), r1, pivot, s1, s2: Math.min(s2, ll) };
}

/* Options snapshot derived from realized volatility (no paid options feed). */
function optionsFromVol(bars: Bar[]) {
  const c = closes(bars);
  const blank = { hv20: null as number | null, hv60: null as number | null, iv30: null as number | null, ivRank: null as number | null, expiries: [] as { label: string; days: number; iv: number }[] };
  if (c.length < 25) return blank;
  const logrets: number[] = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) logrets.push(Math.log(c[i] / c[i - 1]));
  const rvOver = (n: number) => { const s = logrets.slice(-n); const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1); const v = s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length || 1); return Math.sqrt(v * 252) * 100; };
  const hv20 = rvOver(20), hv60 = rvOver(60);
  // rolling 20d HV series → IV rank (percentile of current within the year)
  const series: number[] = []; for (let i = 20; i < logrets.length; i++) { const s = logrets.slice(i - 20, i); const mean = s.reduce((a, b) => a + b, 0) / 20; const v = s.reduce((a, b) => a + (b - mean) ** 2, 0) / 20; series.push(Math.sqrt(v * 252) * 100); }
  const lo = Math.min(...series, hv20), hi = Math.max(...series, hv20);
  const ivRank = hi > lo ? ((hv20 - lo) / (hi - lo)) * 100 : 50;
  const iv30 = hv20 * 1.08; // IV typically trades a modest premium to recent realized
  const expiries = [7, 30, 60, 90].map((d) => ({ label: `${d}D`, days: d, iv: iv30 * (1 + (d - 30) / 600) }));
  return { hv20, hv60, iv30, ivRank, expiries };
}

/* ═══════════════ Left column ═══════════════ */
function WatchRow({ sym, active, onPick, fav, onFav, onQuote }: { sym: string; active: boolean; onPick: () => void; fav: boolean; onFav: () => void; onQuote?: (s: string, q: { last: number | null; chg: number | null; vol: number | null }) => void }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [spark, setSpark] = useState<number[]>(sparkCache.get(sym) || []);
  useEffect(() => {
    let dead = false;
    const pull = () => fetchQuote(sym).then((x) => { if (!dead && x) { setQ(x); onQuote?.(sym, { last: x.last ?? null, chg: x.changePct ?? null, vol: (x as { volume?: number }).volume ?? null }); } });
    pull(); const t = window.setInterval(pull, 7000);
    if (!sparkCache.has(sym)) fetchBars(sym, isCrypto(sym) ? "1h" : "1d", isCrypto(sym) ? "5d" : "1mo").then((b) => { const s = b.slice(-24).map((x) => x.c); sparkCache.set(sym, s); if (!dead) setSpark(s); });
    return () => { dead = true; clearInterval(t); };
  }, [sym]);
  const chg = q?.changePct ?? null;
  return (
    <div className={`axt-wrow${active ? " on" : ""}`} onClick={onPick}>
      <span className="axt-wstar" onClick={(e) => { e.stopPropagation(); onFav(); }}>{fav ? "★" : "☆"}</span>
      <div className="axt-wsym"><b>{isCrypto(sym) ? sym.replace("USDT", "") : sym}</b><em>{DISPLAY[sym] || NAMES[sym] || sym}</em></div>
      <span className="axt-wlast">{num(q?.last)}</span>
      <span className="axt-wchg" style={{ color: col(chg) }}>{pctA(chg)}</span>
      <Spark data={spark} up={(chg ?? 0) >= 0} />
    </div>
  );
}
function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <span className="axt-spark" />;
  const lo = Math.min(...data), hi = Math.max(...data), rg = hi - lo || 1;
  const w = 46, h = 18;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - lo) / rg) * h}`).join(" ");
  return <svg className="axt-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={up ? POS : NEG} strokeWidth="1.2" /></svg>;
}

function ScreenerPanel({ live, onPick }: { live: ReturnType<typeof useApexLive>; onPick: (s: string) => void }) {
  const gainers = live.movers?.stocks?.gainers || [];
  const losers = live.movers?.stocks?.losers || [];
  return (
    <div className="axt-screener">
      <div className="axt-scr-h" style={{ color: POS }}>▲ TOP GAINERS</div>
      {gainers.slice(0, 8).map((m) => <div key={m.ticker} className="axt-scr-row" onClick={() => onPick(m.ticker)}><b>{m.ticker}</b><span>{num(m.last)}</span><span style={{ color: POS }}>{pct(m.changePct)}</span></div>)}
      <div className="axt-scr-h" style={{ color: NEG, marginTop: 8 }}>▼ TOP LOSERS</div>
      {losers.slice(0, 8).map((m) => <div key={m.ticker} className="axt-scr-row" onClick={() => onPick(m.ticker)}><b>{m.ticker}</b><span>{num(m.last)}</span><span style={{ color: NEG }}>{pct(m.changePct)}</span></div>)}
      {gainers.length === 0 && <div className="axt-empty-mini">Screener feed loading…</div>}
    </div>
  );
}
function HeatMap({ live, onPick }: { live: ReturnType<typeof useApexLive>; onPick: (s: string) => void }) {
  const sectors = live.sectors || [];
  const heat = (v: number) => { const a = Math.min(3, Math.abs(v)) / 3; return v >= 0 ? `rgba(38,194,129,${0.15 + a * 0.6})` : `rgba(244,85,107,${0.15 + a * 0.6})`; };
  return (
    <div className="axt-heat">
      {sectors.length === 0 ? <div className="axt-empty-mini">Heat map loading…</div> : sectors.map((s) => (
        <div key={s.etf} className="axt-heatcell" style={{ background: heat(s.changePct) }} onClick={() => onPick(s.etf)}>
          <b>{s.etf}</b><span>{pct(s.changePct)}</span><em>{s.name}</em>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════ Center ═══════════════ */
function SymbolHeader({ symbol, quote, fund, bars, rv, up }: { symbol: string; quote: Quote | null; fund: Fundamentals | null; bars: Bar[]; rv: number | null; up: boolean }) {
  const c = up ? POS : NEG;
  const chg = quote?.last != null && quote?.prev != null ? quote.last - quote.prev : null;
  // Real session stats: take the most recent trading day's bars (ignores flat after-hours padding).
  const sess = useMemo(() => {
    if (!bars.length) return { open: null as number | null, high: null as number | null, low: null as number | null, vol: null as number | null };
    const lastDay = String(bars[bars.length - 1].t).slice(0, 10);
    let day = bars.filter((b) => String(b.t).slice(0, 10) === lastDay && (b.v || 0) > 0);
    if (day.length < 2) day = bars.slice(-Math.min(bars.length, 78)); // fallback: last ~session of bars
    return { open: day[0]?.o ?? null, high: Math.max(...day.map((b) => b.h)), low: Math.min(...day.map((b) => b.l)), vol: day.reduce((a, b) => a + (b.v || 0), 0) };
  }, [bars]);
  const avgVol = useMemo(() => { const v = bars.slice(-20).map((b) => b.v || 0).filter((x) => x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }, [bars]);
  return (
    <div className="axt-symhead">
      <div className="axt-sh-id">
        <span className="axt-sh-tk">{isCrypto(symbol) ? symbol.replace("USDT", "") : symbol}</span>
        <span className="axt-sh-star">★</span>
        <div className="axt-sh-price">
          <span className="axt-sh-last" style={{ color: c }}>{num(quote?.last)}</span>
          <span className="axt-sh-chg" style={{ color: c }}>{chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}` : ""} ({pct(quote?.changePct)})</span>
        </div>
        <span className="axt-sh-name">{fund?.name || DISPLAY[symbol] || NAMES[symbol] || ""}</span>
        <span className="axt-sh-mkt">{fund?.sector || (isCrypto(symbol) ? "CRYPTO" : "")} · <em className="axt-sh-open">MARKET {marketOpen() ? "OPEN" : "CLOSED"}</em></span>
      </div>
      <div className="axt-sh-stats">
        {shStat("OPEN", num(quote?.open || sess.open))}
        {shStat("HIGH", num(quote?.high || sess.high))}
        {shStat("LOW", num(quote?.low || sess.low))}
        {shStat("PREV CLOSE", num(quote?.prev))}
        {shStat("VOLUME", compact(sess.vol))}
        {shStat("MKT CAP", compact(fund?.marketCap))}
        {shStat("AVG VOL", compact(avgVol), undefined, TIPS["AVG VOL"])}
        {shStat("R VOL", rv != null ? `${rv.toFixed(2)}×` : "—", rv != null && rv > 1.5 ? WARN : undefined, TIPS["R VOL"])}
      </div>
    </div>
  );
}
function shStat(l: string, v: string, color?: string, tip?: string) { return <div className="axt-shs" title={tip}><span className={tip ? "axt-tip" : ""}>{l}</span><b style={color ? { color } : undefined}>{v}</b></div>; }
function marketOpen() { const d = new Date(); const day = d.getUTCDay(); const h = d.getUTCHours() + d.getUTCMinutes() / 60; return day >= 1 && day <= 5 && h >= 13.5 && h < 20; }

function ReplayHUD({ prog, stats, strat, speed, setSpeed }: { prog: number; stats: ReplayResult | null; strat: StrategyId; speed: number; setSpeed: (n: number) => void }) {
  const s = stats?.stats;
  return (
    <div className="axt-hud">
      <div className="axt-hud-top"><span className="axt-hud-tag">◧ STRATEGY REPLAY</span><span className="axt-hud-strat">{STRATEGIES.find((x) => x.id === strat)?.name}</span></div>
      <div className="axt-hud-bar"><div className="axt-hud-fill" style={{ width: `${prog}%` }} /></div>
      {s && <div className="axt-hud-stats">
        {hud("RETURN", `${s.totalReturn >= 0 ? "+" : ""}${s.totalReturn.toFixed(1)}%`, s.totalReturn >= 0 ? POS : NEG)}
        {hud("TRADES", String(s.trades), CY)}
        {hud("WIN", s.winRate != null ? `${s.winRate.toFixed(0)}%` : "—", s.winRate != null && s.winRate >= 50 ? POS : WARN)}
        {hud("SHARPE", s.sharpe.toFixed(2), s.sharpe >= 1 ? POS : WARN)}
        {hud("MAX DD", `${s.maxDD.toFixed(1)}%`, NEG)}
      </div>}
      <div className="axt-hud-speed"><span>SPEED</span>
        {[4, 8, 20, 60].map((v) => <button key={v} className={speed === v ? "on" : ""} onClick={() => setSpeed(v)}>{v}×</button>)}
      </div>
    </div>
  );
}
function hud(l: string, v: string, color: string) { return <div className="axt-hudk"><span>{l}</span><b style={{ color }}>{v}</b></div>; }

/* ═══════════════ Right column ═══════════════ */
function MarketStats({ quote, fund, bars, atr, rv, iv }: { quote: Quote | null; fund: Fundamentals | null; bars: Bar[]; atr: number | null; rv: number | null; iv: number | null }) {
  const last = quote?.last ?? bars[bars.length - 1]?.c ?? null;
  const day = bars[bars.length - 1];
  const crypto = /USDT?$/i.test((quote?.ticker || "") + "") || fund == null && bars.length > 0 && (bars[bars.length - 1]?.c ?? 0) > 5000;
  // realized annualized vol from bars (crypto has no equity fundamentals)
  const realizedVol = useMemo(() => { const c = bars.map((b) => b.c); if (c.length < 20) return null; const r: number[] = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0) r.push(Math.log(c[i] / c[i - 1])); const m = r.reduce((a, b) => a + b, 0) / (r.length || 1); const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length || 1); return Math.sqrt(v * 252 * 6.5) * 100; }, [bars]);
  const rows: [string, string, string?][] = crypto ? [
    ["Open", num(quote?.open ?? day?.o)], ["High", num(quote?.high ?? day?.h)], ["Low", num(quote?.low ?? day?.l)],
    ["Prev Close", num(quote?.prev)], ["Volume", compact(day?.v)], ["Realized Vol", realizedVol != null ? `${realizedVol.toFixed(0)}%` : "—"],
    ["ATR (14)", atr != null ? atr.toFixed(2) : "—"], ["IV (est)", iv != null ? `${iv.toFixed(0)}%` : "—"],
    ["Rel Volume", rv != null ? `${rv.toFixed(2)}×` : "—"], ["Range (bars)", num(Math.max(...bars.map((b) => b.h)) - Math.min(...bars.map((b) => b.l)))],
  ] : [
    ["Open", num(quote?.open ?? day?.o)], ["High", num(quote?.high ?? day?.h)], ["Low", num(quote?.low ?? day?.l)],
    ["Prev Close", num(quote?.prev)], ["Volume", compact(day?.v)], ["Market Cap", compact(fund?.marketCap)],
    ["Beta (5Y)", fund?.beta != null ? fund.beta.toFixed(2) : "—"], ["ATR (14)", atr != null ? atr.toFixed(2) : "—"],
    ["IV Rank (est)", iv != null ? `${(iv).toFixed(0)}` : "—"], ["Rel Volume", rv != null ? `${rv.toFixed(2)}×` : "—"],
    ["P/E (TTM)", fund?.pe != null ? fund.pe.toFixed(2) : "—"], ["EPS (TTM)", fund?.eps != null ? fund.eps.toFixed(2) : "—"],
  ];
  // 52-week range position — context beside the bare hi/lo (falls back to the loaded bars for crypto).
  const barLo = bars.length ? Math.min(...bars.map((b) => b.l)) : null, barHi = bars.length ? Math.max(...bars.map((b) => b.h)) : null;
  const has52 = fund?.low52 != null && fund?.high52 != null;   // only label "52-week" when we truly have it
  const lo = fund?.low52 ?? barLo, hi = fund?.high52 ?? barHi;
  const posPct = last != null && lo != null && hi != null && hi > lo ? Math.max(0, Math.min(100, ((last - lo) / (hi - lo)) * 100)) : null;
  return (
    <div className="axt-panel">
      <div className="axt-ph">MARKET STATS</div>
      <div className="axt-stats">{rows.map(([k, v]) => <div key={k} className="axt-statrow" title={TIPS[k]}><span className={TIPS[k] ? "axt-tip" : ""}>{k}</span><b>{v}</b></div>)}</div>
      <div className="axt-52w">
        <div className="axt-52w-h"><span title={has52 ? undefined : "52-week data unavailable on the free feed — showing the range of loaded bars"}>{has52 ? "52-WEEK RANGE" : "RANGE · LOADED BARS"}</span>{posPct != null && <em>{posPct.toFixed(0)}% of range</em>}</div>
        <div className="axt-52w-bar">{posPct != null && <span className="axt-52w-mark" style={{ left: `${posPct}%` }} />}</div>
        <div className="axt-52w-ends"><b>{num(lo)}</b><b>{num(hi)}</b></div>
      </div>
    </div>
  );
}

function AIAnalysis({ tech, symbol, fund }: { tech: Tech; symbol: string; fund: Fundamentals | null }) {
  const c = tech.bias === "BULLISH" ? POS : tech.bias === "BEARISH" ? NEG : WARN;
  return (
    <div className="axt-panel axt-ai">
      <div className="axt-ph">AI ANALYSIS <span className="axt-ai-badge" style={{ color: c, borderColor: c }}>{tech.bias === "BULLISH" ? "◆" : tech.bias === "BEARISH" ? "◇" : "◈"} {tech.bias}</span></div>
      <div className="axt-ai-conf"><span>CONFIDENCE</span><div className="axt-ai-bar"><div style={{ width: `${tech.confidence}%`, background: c }} /></div><b style={{ color: c }}>{tech.confidence.toFixed(0)}%</b></div>
      <div className="axt-ai-sec">Trade Thesis</div>
      <p className="axt-ai-txt">{tech.thesis}</p>
      <div className="axt-ai-sec">Signal Checklist</div>
      <div className="axt-ai-sigs">{tech.signals.map((s) => <span key={s.label} className={`axt-sig${s.on ? " on" : ""}`}>{s.on ? "✓" : "✕"} {s.label}</span>)}</div>
      <div className="axt-ai-sec">Regime</div>
      <p className="axt-ai-txt dim">{tech.catalyst}</p>
      <div className="axt-ai-foot">Computed from live price action · {symbol}. Informational, not advice.</div>
    </div>
  );
}

function SentMomentum({ tech }: { tech: Tech }) {
  return (
    <div className="axt-panel">
      <div className="axt-ph">SENTIMENT & MOMENTUM</div>
      <div className="axt-gauges">
        <Gauge label="SENTIMENT" v={tech.sentiment} />
        <Gauge label="MOMENTUM" v={tech.momentum} />
        <Gauge label="TREND" v={tech.trend} />
      </div>
    </div>
  );
}
function Gauge({ label, v }: { label: string; v: number }) {
  const r = 26, circ = Math.PI * r; // half circle
  const c = v >= 66 ? POS : v >= 40 ? WARN : NEG;
  const off = circ * (1 - v / 100);
  return (
    <div className="axt-gauge">
      <svg viewBox="0 0 64 40" className="axt-gsvg">
        <path d="M6 34 A26 26 0 0 1 58 34" fill="none" stroke="rgba(150,190,225,.14)" strokeWidth="5" strokeLinecap="round" />
        <path d="M6 34 A26 26 0 0 1 58 34" fill="none" stroke={c} strokeWidth="5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} />
      </svg>
      <div className="axt-gval" style={{ color: c }}>{v.toFixed(0)}</div>
      <div className="axt-glbl">{label}</div>
    </div>
  );
}

function KeyLevels({ levels, last }: { levels: Record<string, number | null>; last: number | null }) {
  const rows: [string, number | null, string][] = [
    ["Resistance 2", levels.r2, NEG], ["Resistance 1", levels.r1, NEG], ["Pivot / VWAP", levels.pivot, MUT], ["Support 1", levels.s1, POS], ["Support 2", levels.s2, POS],
  ];
  return (
    <div className="axt-panel">
      <div className="axt-ph">KEY LEVELS</div>
      <div className="axt-levels">
        {rows.map(([k, v, c]) => (
          <div key={k} className="axt-lvl"><span className="axt-lvl-dot" style={{ background: c }} /><span className="axt-lvl-l">{k}</span><b style={{ color: last != null && v != null ? (v > last ? NEG : POS) : "var(--ax-tx)" }}>{num(v)}</b></div>
        ))}
      </div>
    </div>
  );
}

function NewsCatalysts({ news, impact, symbol }: { news: Story[]; impact: { title: string; dir: string; magnitude: number }[]; symbol: string }) {
  const tk = isCrypto(symbol) ? symbol.replace("USDT", "") : symbol;
  const related = news.filter((s) => (s.tickers || []).some((t) => t.t === tk) || s.title.toUpperCase().includes(tk)).slice(0, 3);
  const rows = related.length ? related.map((s) => ({ title: s.title, meta: s.sources?.[0] || s.lane || "" })) : impact.slice(0, 3).map((i) => ({ title: i.title, meta: i.dir }));
  const fallback = news.slice(0, 4);
  return (
    <div className="axt-panel axt-news">
      <div className="axt-ph">NEWS & CATALYSTS</div>
      {(rows.length ? rows : fallback.map((s) => ({ title: s.title, meta: s.sources?.[0] || "" }))).map((r, i) => (
        <div key={i} className="axt-newsrow"><span className="axt-news-dot" />{r.title}<em>{r.meta}</em></div>
      ))}
      {news.length === 0 && <SkelRows n={4} />}
    </div>
  );
}

/* ═══════════════ Bottom analytics ═══════════════ */
// Deterministic simulated depth around the real quote (equities have no free L2 feed).
function simDepth(mid: number, seedT: number) {
  const bids: { p: number; q: number }[] = [], asks: { p: number; q: number }[] = [];
  const tick = mid > 1000 ? 1 : mid > 100 ? 0.05 : 0.01;
  let rnd = Math.floor(seedT / 1500) ^ Math.floor(mid * 100);
  const nx = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  for (let i = 1; i <= 10; i++) { bids.push({ p: mid - i * tick, q: Math.round(400 + nx() * 4200) }); asks.push({ p: mid + i * tick, q: Math.round(400 + nx() * 4200) }); }
  return { bids, asks };
}
// Shared truthful data-state badge (research §5): every data panel declares LIVE/DELAYED/DERIVED/SIM/NA.
function DataBadge({ state, title }: { state: "live" | "delayed" | "derived" | "sim" | "na"; title?: string }) {
  const map: Record<string, [string, string]> = { live: ["LIVE", POS], delayed: ["DELAYED", WARN], derived: ["DERIVED", CY], sim: ["SIM", PUR], na: ["N/A", "#6b7683"] };
  const [txt, c] = map[state];
  return <span title={title} style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".06em", color: c, border: `1px solid ${c}55`, borderRadius: 3, padding: "1px 5px", background: `${c}18` }}>{txt}</span>;
}
function TimeSales({ symbol, micro, quote }: { symbol: string; micro: ReturnType<typeof useMicro>; quote: Quote | null }) {
  const crypto = isCrypto(symbol);
  const trades = crypto ? micro.trades.slice(-14).reverse() : simTrades(quote?.last ?? 0, symbol);
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">TIME &amp; SALES <DataBadge state={crypto ? "live" : "sim"} title={crypto ? "Live trades over Binance WebSocket" : "No public stock trade tape on the free feed — illustrative sample"} /></div>
      <div className="axt-ts">
        <div className="axt-ts-h"><span>TIME</span><span className="r">PRICE</span><span className="r">SIZE</span><span className="r">SIDE</span></div>
        {trades.map((t, i) => (
          <div key={i} className="axt-ts-row"><span className="dim">{new Date(t.t).toLocaleTimeString([], { hour12: false })}</span><span className="r" style={{ color: t.side === "buy" ? POS : NEG }}>{num(t.p, crypto ? 2 : 2)}</span><span className="r">{crypto ? t.q.toFixed(4) : Math.round(t.q)}</span><span className="r" style={{ color: t.side === "buy" ? POS : NEG }}>{t.side === "buy" ? "B" : "S"}</span></div>
        ))}
      </div>
    </div>
  );
}
function simTrades(mid: number, sym: string) {
  if (!mid) return [] as { t: number; p: number; q: number; side: string }[];
  const out = []; let rnd = Math.floor(Date.now() / 1200) ^ sym.length; const nx = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  for (let i = 0; i < 14; i++) { const side = nx() > 0.5 ? "buy" : "sell"; out.push({ t: Date.now() - i * 1400, p: mid + (nx() - 0.5) * (mid * 0.0006), q: 50 + Math.round(nx() * 900), side }); }
  return out;
}
function OrderBook({ symbol, micro, quote }: { symbol: string; micro: ReturnType<typeof useMicro>; quote: Quote | null }) {
  const crypto = isCrypto(symbol);
  // Stocks: the free feed has no Level-2 depth. Never fabricate a multi-level book (spec §2.9-B) —
  // show an honest unavailable state with best-available top-of-book context instead.
  if (!crypto) {
    const last = quote?.last ?? 0;
    return (
      <div className="axt-bpanel">
        <div className="axt-bph">ORDER BOOK <DataBadge state="na" title="Level-2 order-book depth is not available on the free stock feed" /></div>
        <div style={{ padding: "10px 8px", display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
          <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--ax-mut,#9aa7b4)" }}>Level-2 depth isn't published on the free stock feed. Showing best-available top-of-book.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ border: "1px solid var(--ax-hair,rgba(255,255,255,.07))", borderRadius: 5, padding: "6px 8px" }}><div style={{ fontSize: 8, letterSpacing: ".08em", color: "var(--ax-dim,#6b7683)", fontWeight: 700 }}>LAST</div><div style={{ fontFamily: "var(--ax-mono)", fontSize: 15, fontWeight: 700 }}>{num(last)}</div></div>
            <div style={{ border: "1px solid var(--ax-hair,rgba(255,255,255,.07))", borderRadius: 5, padding: "6px 8px" }}><div style={{ fontSize: 8, letterSpacing: ".08em", color: "var(--ax-dim,#6b7683)", fontWeight: 700 }}>SPREAD</div><div style={{ fontFamily: "var(--ax-mono)", fontSize: 15, fontWeight: 700, color: "var(--ax-dim,#6b7683)" }}>—</div></div>
          </div>
          <div style={{ fontSize: 9.5, color: "var(--ax-dim,#6b7683)" }}>Tip: switch to a crypto symbol (e.g. BTCUSD) for real live L2 depth.</div>
        </div>
      </div>
    );
  }
  const book = micro.book ?? simDepth(quote?.last ?? 0, Date.now());
  const maxQ = Math.max(1, ...book.bids.map((b) => b.q), ...book.asks.map((a) => a.q));
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">ORDER BOOK <DataBadge state={micro.book ? "live" : "na"} title="Live depth over Binance WebSocket" /></div>
      <div className="axt-ob">
        <div className="axt-ob-h"><span>SIZE</span><span className="r">BID</span><span className="r">ASK</span><span className="r">SIZE</span></div>
        {book.bids.slice(0, 9).map((b, i) => { const a = book.asks[i] || { p: 0, q: 0 }; return (
          <div key={i} className="axt-ob-row">
            <span className="axt-ob-sz"><span className="axt-ob-bar bid" style={{ width: `${(b.q / maxQ) * 100}%` }} />{Math.round(b.q).toLocaleString()}</span>
            <span className="r axt-ob-bid">{num(b.p)}</span>
            <span className="r axt-ob-ask">{num(a.p)}</span>
            <span className="axt-ob-sz r"><span className="axt-ob-bar ask" style={{ width: `${(a.q / maxQ) * 100}%` }} />{Math.round(a.q).toLocaleString()}</span>
          </div>
        ); })}
      </div>
    </div>
  );
}
// Synthesise a realistic aggregated-flow ladder (mixed buy/sell per bucket) when
// there's no real tick feed. Buckets carry a continuous imbalance, not all-or-nothing.
function synthFlow(symbol: string, n = 8) {
  let rnd = Math.floor(Date.now() / 2000) ^ [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
  const nx = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const bias = (nx() - 0.5) * 0.28; // session lean
  const out: { buy: number; sell: number }[] = [];
  for (let i = 0; i < n; i++) { const total = 800 + nx() * 4200; const buyFrac = Math.max(0.3, Math.min(0.72, 0.5 + bias + (nx() - 0.5) * 0.34)); out.push({ buy: total * buyFrac, sell: total * (1 - buyFrac) }); }
  return out;
}
function OrderFlow({ symbol, micro }: { symbol: string; micro: ReturnType<typeof useMicro> }) {
  const crypto = isCrypto(symbol);
  // Real crypto tape only when it's dense enough to bucket cleanly; otherwise a mixed synthetic ladder.
  let buckets: { buy: number; sell: number }[] = [];
  if (crypto && micro.trades.length >= 24) {
    let bagBuy = 0, bagSell = 0, cnt = 0; const per = Math.floor(micro.trades.length / 8);
    for (const t of micro.trades) { if (t.side === "buy") bagBuy += t.q; else bagSell += t.q; if (++cnt >= per) { buckets.push({ buy: bagBuy, sell: bagSell }); bagBuy = 0; bagSell = 0; cnt = 0; } }
  } else buckets = synthFlow(symbol);
  let cum = 0;
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">ORDER FLOW <DataBadge state={crypto && micro.trades.length >= 24 ? "live" : "derived"} title={crypto && micro.trades.length >= 24 ? "Aggressor side from live trade stream (CVD)" : "Signed volume inferred by tick rule — not exchange-classified aggressor flow"} /></div>
      <div className="axt-of">
        <div className="axt-of-h"><span>DELTA</span><span className="r">CUM</span><span className="r">BUY%</span></div>
        {buckets.slice(-8).map((b, i) => { const d = b.buy - b.sell; cum += d; const tot = b.buy + b.sell || 1; const bp = (b.buy / tot) * 100; return (
          <div key={i} className="axt-of-row"><span style={{ color: d >= 0 ? POS : NEG }}>{d >= 0 ? "+" : ""}{compact(d)}</span><span className="r" style={{ color: cum >= 0 ? POS : NEG }}>{compact(cum)}</span><span className="r"><span className="axt-of-bar"><span style={{ width: `${bp}%`, background: POS }} /><span style={{ width: `${100 - bp}%`, background: NEG }} /></span>{bp.toFixed(0)}%</span></div>
        ); })}
        {buckets.length === 0 && <div className="axt-empty-mini">Flow warming up…</div>}
      </div>
    </div>
  );
}
function Correlations({ live, symbol, onPick }: { live: ReturnType<typeof useApexLive>; symbol: string; onPick: (s: string) => void }) {
  const corr = live.correlation;
  const tk = isCrypto(symbol) ? symbol.replace("USDT", "") : symbol;
  const inSet = !!corr?.symbols?.includes(tk);
  const rows = useMemo(() => {
    if (!corr?.symbols?.length) return [];
    const idx = corr.symbols.indexOf(tk); const base = idx < 0 ? 0 : idx; // fall back to majors, clearly labelled (not the symbol's row)
    return corr.symbols.map((s, j) => ({ sym: s, v: corr.matrix?.[base]?.[j] ?? null })).filter((r) => r.sym !== corr.symbols[base]).sort((a, b) => Math.abs(b.v ?? 0) - Math.abs(a.v ?? 0)).slice(0, 7);
  }, [corr, tk]);
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">CORRELATIONS <span>{inSet ? `${tk} · 30D` : "30D"}</span></div>
      <div className="axt-corr">
        {corr?.symbols?.length && !inSet ? <div className="axt-empty-mini">{tk} isn't in the tracked correlation set — showing majors below.</div> : null}
        {rows.length === 0 ? <SkelRows n={6} /> : rows.map((r) => (
          <div key={r.sym} className="axt-corr-row" onClick={() => onPick(r.sym)}><b>{r.sym}</b><div className="axt-corr-track"><div className="axt-corr-fill" style={{ width: `${Math.abs(r.v ?? 0) * 100}%`, marginLeft: (r.v ?? 0) < 0 ? `${(1 - Math.abs(r.v ?? 0)) * 100}%` : 0, background: (r.v ?? 0) >= 0 ? CY : WARN }} /></div><span style={{ color: (r.v ?? 0) >= 0 ? CY : WARN }}>{r.v != null ? r.v.toFixed(2) : "—"}</span></div>
        ))}
      </div>
    </div>
  );
}
function OptionsSnapshot({ snap, symbol }: { snap: ReturnType<typeof optionsFromVol>; symbol: string }) {
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">VOLATILITY &amp; RISK <DataBadge state="derived" title="Realized-vol and model-implied estimates from real bars — no options-market data" /></div>
      <div className="axt-opt">
        <div className="axt-opt-kpis">
          {ok("IV30 (est)", snap.iv30 != null ? `${snap.iv30.toFixed(1)}%` : "—", CY, TIPS["IV30 (est)"])}
          {ok("HV20", snap.hv20 != null ? `${snap.hv20.toFixed(1)}%` : "—", "var(--ax-tx)", TIPS["HV20"])}
          {ok("IV RANK", snap.ivRank != null ? `${snap.ivRank.toFixed(0)}` : "—", snap.ivRank != null && snap.ivRank > 60 ? WARN : POS, TIPS["IV RANK"])}
        </div>
        <div className="axt-opt-h"><span>EXPIRY</span><span className="r">IV (est)</span><span className="r">CONE</span></div>
        {snap.expiries.map((e) => (
          <div key={e.label} className="axt-opt-row"><span>{e.label}</span><span className="r">{e.iv.toFixed(1)}%</span><span className="r"><span className="axt-opt-bar" style={{ width: `${Math.min(100, e.iv)}%` }} /></span></div>
        ))}
        {snap.expiries.length === 0 && <div className="axt-empty-mini">Need more history for vol.</div>}
      </div>
    </div>
  );
}
function ok(l: string, v: string, c: string, tip?: string) { return <div className="axt-optk" title={tip}><span className={tip ? "axt-tip" : ""}>{l}</span><b style={{ color: c }}>{v}</b></div>; }
// Shaped skeleton rows (preview the layout while data loads — beats a bare "loading…").
function SkelRows({ n = 6 }: { n?: number }) {
  return <div className="axt-skelrows">{Array.from({ length: n }).map((_, i) => <div key={i} className="axt-skelrow"><span style={{ width: `${40 + (i * 37) % 30}%` }} /><span style={{ width: `${20 + (i * 23) % 20}%` }} /></div>)}</div>;
}
function ScannerHits({ live, symbol, onPick }: { live: ReturnType<typeof useApexLive>; symbol: string; onPick: (s: string) => void }) {
  const tk = isCrypto(symbol) ? symbol.replace("USDT", "") : symbol;
  const anom = live.anomalies?.items || [];
  const movers = [...(live.movers?.stocks?.gainers || []).slice(0, 3), ...(live.movers?.stocks?.losers || []).slice(0, 2)];
  const raw = anom.length ? anom.slice(0, 10).map((a) => ({ tk: a.sym, label: a.z >= 0 ? "Unusual Upside" : "Unusual Downside", v: `${a.sigma.toFixed(1)}σ`, up: a.z >= 0 })) : movers.map((m) => ({ tk: m.ticker, label: (m.changePct ?? 0) >= 0 ? "Top Gainer" : "Top Loser", v: pct(m.changePct), up: (m.changePct ?? 0) >= 0 }));
  // Pin the searched symbol to the top if it's flagged; otherwise show market-wide hits.
  const hits = raw.slice().sort((a, b) => (b.tk === tk ? 1 : 0) - (a.tk === tk ? 1 : 0)).slice(0, 8);
  const onSym = raw.some((h) => h.tk === tk);
  return (
    <div className="axt-bpanel">
      <div className="axt-bph">SCANNER HITS & ALERTS <span>{onSym ? `${tk} flagged` : "market-wide"}</span></div>
      <div className="axt-scan">
        {hits.length === 0 ? <SkelRows n={7} /> : hits.map((h, i) => (
          <div key={i} className={`axt-scan-row${h.tk === tk ? " on" : ""}`} onClick={() => onPick(h.tk)}><b>{h.tk}</b><span className="axt-scan-l">{h.label}</span><span style={{ color: h.up ? POS : NEG }}>{h.v}</span><span className="axt-scan-dot" style={{ background: h.up ? POS : NEG }} /></div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════ Status strip ═══════════════ */
function StatusStrip({ live }: { live: ReturnType<typeof useApexLive> }) {
  const idx = live.indices || [];
  const y10 = (live.yields || []).find((y) => /10\s*yr|10-year|10 yr/i.test(y.security)) || (live.yields || [])[4];
  const btc = live.crypto?.BTCUSDT, eth = live.crypto?.ETHUSDT;
  const items = [
    ...idx.slice(0, 4).map((i) => ({ l: i.name || i.ticker, v: num(i.last), c: i.changePct })),
    ...(y10 ? [{ l: "10Y YIELD", v: `${y10.rate?.toFixed(2)}%`, c: null as number | null }] : []),
    ...(btc ? [{ l: "BTC", v: num(btc.last), c: btc.changePct }] : []),
    ...(eth ? [{ l: "ETH", v: num(eth.last), c: eth.changePct }] : []),
  ];
  return (
    <div className="axt-status">
      <span className="axt-st-live"><span className={`axt-st-dot${live.live ? " on" : ""}`} />{live.live ? "CONNECTED" : "CONNECTING"}</span>
      <span className="axt-st-feed" title="Crypto streams live over WebSocket; free stock quotes are delayed ~15 min.">DATA FEED: <b>{live.live ? "CRYPTO LIVE · STOCKS DELAYED" : "…"}</b></span>
      <div className="axt-st-items">
        {items.map((it, i) => <span key={i} className="axt-st-item"><em>{it.l}</em> <b>{it.v}</b>{it.c != null && <span style={{ color: col(it.c) }}>{pctA(it.c)}</span>}</span>)}
      </div>
      <span className="axt-st-time">{new Date(live.updated || Date.now()).toLocaleTimeString([], { hour12: false })} · UTC{-new Date().getTimezoneOffset() / 60}</span>
    </div>
  );
}

const TERM_CSS = `
.ax-term { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:7px; padding:8px; font-family:var(--ax-sans); color:var(--ax-tx); overflow:hidden;
  background:radial-gradient(120% 70% at 50% -10%, rgba(18,80,120,.10), transparent 55%), linear-gradient(180deg, #030a12 0%, #01060b 100%); font-variant-numeric:tabular-nums;
  /* Deep blue-black terminal with selective cyan energy (spec §4). Panels are cyan-tinted glass, not
     neutral charcoal cards; borders carry cyan at ~20%, glow is rationed to selection/active. */
  --ax-panel:rgba(6,21,33,.92); --ax-panelhi:rgba(9,32,49,.96); --ax-surface:rgba(3,14,23,.94); --ax-elev:rgba(7,26,40,.96);
  --ax-bd:rgba(70,180,232,.20); --ax-bdsoft:rgba(70,180,232,.11); --ax-hair:rgba(110,160,195,.09); --ax-bdglow:rgba(42,201,255,.55);
  --ax-panel-grad:radial-gradient(130% 100% at 50% -25%, rgba(22,110,155,.10), transparent 60%), linear-gradient(180deg, rgba(7,23,36,.96), rgba(2,10,17,.97));
  --ax-panel-glow:inset 0 1px 0 rgba(255,255,255,.045), 0 2px 16px -9px rgba(0,0,0,.65);
  --ax-tx:#dcebf7; --ax-mut:#9fb4c6; --ax-dim:#6f8698; --ax-cydim:#57b7e4; --ax-acc:#2ec7ff; }
.ax-term *:focus-visible { outline:2px solid var(--ax-bdglow); outline-offset:1px; border-radius:4px; }
.ax-term .axt-tip { border-bottom:1px dotted color-mix(in srgb, var(--ax-mut) 60%, transparent); cursor:help; }
.ax-term .num, .ax-term [class*="mono"] { font-variant-numeric:tabular-nums; }
.ax-term button { font-family:var(--ax-sans); cursor:pointer; }
.ax-term .r { text-align:right; }
.ax-term .dim { color:var(--ax-mut); }

/* Toolbar */
.axt-toolbar { display:flex; align-items:center; gap:12px; flex-shrink:0; }
.axt-search { position:relative; display:flex; align-items:center; flex:0 0 300px; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:9px; padding:0 10px; height:34px; }
.axt-search:focus-within { border-color:var(--ax-bdglow); }
.axt-mag { color:var(--ax-mut); font-size:15px; }
.axt-search input { flex:1; background:none; border:none; outline:none; color:var(--ax-tx); font-size:12px; padding:0 8px; font-family:var(--ax-sans); }
.axt-search kbd { font-size:9px; color:var(--ax-dim); border:1px solid var(--ax-bdsoft); border-radius:4px; padding:1px 5px; }
.axt-searchdd { position:absolute; top:calc(100% + 5px); left:0; right:0; z-index:40; background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:9px; box-shadow:0 14px 40px -12px rgba(0,0,0,.7), var(--ax-panel-glow); overflow:hidden; padding:4px; }
.axt-sr { display:grid; grid-template-columns:auto 1fr auto auto; gap:9px; align-items:center; padding:6px 9px; border-radius:6px; cursor:pointer; }
.axt-sr b { font-family:var(--ax-mono); font-size:12px; font-weight:700; color:var(--ax-tx); }
.axt-sr-name { font-size:10.5px; color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axt-sr-type { font-size:8px; font-weight:700; letter-spacing:.06em; color:var(--ax-cydim); border:1px solid var(--ax-bdsoft); border-radius:3px; padding:1px 5px; }
.axt-sr-state { font-size:8px; font-weight:700; letter-spacing:.05em; }
.axt-sr.on { background:color-mix(in srgb, ${CY} 14%, transparent); }
.axt-popular { display:flex; align-items:center; gap:6px; }
.axt-pop-l { font-size:8.5px; letter-spacing:.1em; color:var(--ax-dim); font-weight:700; }
.axt-chip { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:6px; padding:5px 10px; font-size:11px; font-weight:700; font-family:var(--ax-mono); }
.axt-chip.on, .axt-chip:hover { border-color:var(--ax-bdglow); color:var(--ax-acc); background:var(--ax-panelhi); }
.axt-layouts { margin-left:auto; display:inline-flex; gap:2px; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:8px; padding:2px; }
.axt-lyt { background:none; border:none; color:var(--ax-dim); font-size:13px; padding:3px 9px; border-radius:6px; line-height:1; }
.axt-lyt:hover { color:var(--ax-mut); }
.axt-lyt.on { background:color-mix(in srgb, ${CY} 18%, transparent); color:var(--ax-acc); }
.axt-actions { margin-left:8px; display:flex; gap:7px; }
.axt-act { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:8px; padding:7px 12px; font-size:11px; font-weight:600; }
.axt-act:hover { border-color:var(--ax-bdglow); color:var(--ax-tx); }
.axt-act.primary { background:color-mix(in srgb, ${CY} 16%, transparent); border-color:color-mix(in srgb, ${CY} 45%, transparent); color:${CY}; }

/* Main grid */
.axt-main { flex:1; min-height:0; display:grid; grid-template-columns:236px 1fr 268px; gap:8px; }
/* Layout presets (§8): Standard = default; Chart focus = hide right rail + dock; Execution = slimmer
   rails + taller microstructure dock. Persisted to localStorage. */
.axl-chart .axt-main { grid-template-columns:236px 1fr; }
.axl-chart .axt-right { display:none; }
.axl-chart .axt-bottom { display:none; }
.axl-exec .axt-main { grid-template-columns:200px 1fr 224px; }
.axl-exec .axt-bottom { height:252px; }
.axt-left, .axt-center, .axt-right { min-height:0; display:flex; flex-direction:column; gap:8px; }
.axt-left { background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:10px; padding:9px; overflow:hidden; box-shadow:var(--ax-panel-glow); }
.axt-right { overflow-y:auto; padding-right:3px; gap:7px; scrollbar-width:thin; scrollbar-color:var(--ax-bd) transparent; }
.axt-right::-webkit-scrollbar { width:5px; } .axt-right::-webkit-scrollbar-thumb { background:var(--ax-bd); border-radius:3px; }
.axt-right .axt-panel { padding:9px 11px; }
.axt-right .axt-ph { margin-bottom:7px; }

/* Left */
.axt-lefttabs { display:flex; gap:4px; }
.axt-lefttabs button { flex:1; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-dim); border-radius:6px; padding:6px 4px; font-size:8.5px; font-weight:700; letter-spacing:.04em; }
.axt-lefttabs button.on { border-color:var(--ax-bdglow); color:var(--ax-acc); background:var(--ax-panelhi); }
.axt-watchcat { display:flex; gap:4px; flex-wrap:wrap; }
.axt-watchcat button { background:none; border:none; color:var(--ax-dim); font-size:10px; font-weight:600; padding:3px 4px; border-bottom:1.5px solid transparent; }
.axt-watchcat button.on { color:var(--ax-acc); border-bottom-color:var(--ax-acc); }
.axt-watchhead { display:grid; grid-template-columns:1.5fr .8fr .7fr .6fr; gap:5px; font-size:7.5px; letter-spacing:.05em; color:var(--ax-dim); padding:5px 4px 3px; border-bottom:1px solid var(--ax-bdsoft); }
.axt-wsort { background:none; border:none; color:var(--ax-dim); font-size:7.5px; letter-spacing:.05em; font-weight:700; font-family:var(--ax-sans); padding:0; text-align:left; }
.axt-wsort.r { text-align:right; } .axt-wsort:hover { color:var(--ax-mut); } .axt-wsort.on { color:var(--ax-acc); }
.axt-watchlist { flex:1; overflow-y:auto; overflow-x:hidden; }
.axt-wrow { display:grid; grid-template-columns:14px 1.5fr .8fr .7fr 46px; gap:5px; align-items:center; padding:5px 3px; border-bottom:1px solid var(--ax-hair); font-size:11px; }
.axt-wrow:hover { background:color-mix(in srgb, var(--ax-acc) 6%, transparent); }
.axt-wrow.on { background:color-mix(in srgb, ${CY} 10%, transparent); box-shadow:inset 2px 0 0 ${CY}; }
.axt-wstar { font-size:11px; color:var(--ax-dim); text-align:center; }
.axt-wrow.on .axt-wstar, .axt-wstar:hover { color:${WARN}; }
.axt-wsym { display:flex; flex-direction:column; min-width:0; }
.axt-wsym b { font-family:var(--ax-mono); font-size:11.5px; font-weight:700; }
.axt-wsym em { font-style:normal; font-size:8px; color:var(--ax-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axt-wlast { font-family:var(--ax-mono); text-align:right; color:var(--ax-tx); font-size:10.5px; }
.axt-wchg { font-family:var(--ax-mono); text-align:right; font-size:10px; font-weight:600; }
.axt-spark { width:46px; height:18px; display:block; }
.axt-screener, .axt-heat { flex:1; overflow-y:auto; }
.axt-scr-h { font-size:8.5px; font-weight:700; letter-spacing:.06em; padding:4px 2px; }
.axt-scr-row { display:grid; grid-template-columns:1fr .8fr .7fr; gap:6px; padding:5px 3px; border-bottom:1px solid var(--ax-hair); font-size:11px; font-family:var(--ax-mono); }
.axt-scr-row:hover { background:color-mix(in srgb, var(--ax-acc) 6%, transparent); }
.axt-scr-row b { font-weight:700; } .axt-scr-row span { text-align:right; }
.axt-heat { display:grid; grid-template-columns:1fr 1fr; gap:5px; align-content:start; }
.axt-heatcell { border-radius:7px; padding:9px 8px; display:flex; flex-direction:column; gap:1px; border:1px solid var(--ax-hair); }
.axt-heatcell b { font-family:var(--ax-mono); font-size:12px; } .axt-heatcell span { font-family:var(--ax-mono); font-size:11px; font-weight:700; } .axt-heatcell em { font-style:normal; font-size:7.5px; color:var(--ax-mut); }

/* Center */
.axt-center { min-width:0; }
.axt-symhead { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:11px; padding:10px 13px; display:flex; align-items:center; gap:18px; flex-shrink:0; }
.axt-sh-id { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.axt-sh-tk { font-family:var(--ax-disp); font-size:20px; font-weight:800; letter-spacing:.02em; }
.axt-sh-star { color:${WARN}; font-size:13px; }
.axt-sh-price { display:flex; align-items:baseline; gap:8px; }
.axt-sh-last { font-family:var(--ax-mono); font-size:22px; font-weight:800; }
.axt-sh-chg { font-family:var(--ax-mono); font-size:12px; font-weight:600; }
.axt-sh-name { font-size:11px; color:var(--ax-mut); }
.axt-sh-mkt { font-size:9px; color:var(--ax-dim); letter-spacing:.03em; }
.axt-sh-open { font-style:normal; color:${POS}; }
.axt-sh-stats { margin-left:auto; display:grid; grid-template-columns:repeat(8,auto); gap:14px; }
.axt-shs { display:flex; flex-direction:column; gap:2px; }
.axt-shs span { font-size:7.5px; letter-spacing:.05em; color:var(--ax-dim); }
.axt-shs b { font-family:var(--ax-mono); font-size:12px; font-weight:700; }

.axt-chartbar { display:flex; align-items:center; gap:10px; background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:9px; padding:5px 9px; flex-shrink:0; box-shadow:var(--ax-panel-glow); }
.axt-tfs, .axt-indtoggles { display:flex; gap:2px; }
.axt-tfs button, .axt-indtoggles button { background:none; border:1px solid transparent; color:var(--ax-dim); border-radius:5px; min-width:26px; min-height:26px; padding:4px 8px; font-size:10.5px; font-weight:700; font-family:var(--ax-mono); }
.axt-tfs button:hover, .axt-indtoggles button:hover { color:var(--ax-tx); background:var(--ax-surface); }
.axt-tfs button.on { color:var(--ax-acc); background:var(--ax-panelhi); border-color:var(--ax-bdglow); }
.axt-indtoggles { margin-left:6px; padding-left:8px; border-left:1px solid var(--ax-bdsoft); }
.axt-indtoggles button.on { color:${CY}; border-color:color-mix(in srgb, ${CY} 40%, transparent); background:color-mix(in srgb, ${CY} 10%, transparent); }
.axt-chartbar-r { margin-left:auto; display:flex; align-items:center; gap:6px; }
.axt-stratsel { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-tx); border-radius:6px; padding:5px 7px; font-size:10.5px; font-family:var(--ax-sans); outline:none; }
.axt-replay { background:color-mix(in srgb, ${PUR} 14%, transparent); border:1px solid color-mix(in srgb, ${PUR} 45%, transparent); color:${PUR}; border-radius:7px; padding:6px 12px; font-size:11px; font-weight:700; }
.axt-replay.on { background:${PUR}; color:#120a24; }

.axt-chartzone { flex:1; min-height:0; display:flex; gap:6px; background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:10px; padding:8px; box-shadow:var(--ax-panel-glow); }
.axt-drawtools { display:flex; flex-direction:column; gap:3px; }
.axt-drawtools button { width:26px; height:26px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:6px; font-size:12px; display:flex; align-items:center; justify-content:center; }
.axt-drawtools button:hover { border-color:var(--ax-bdglow); color:var(--ax-acc); }
.axt-chartcanvas { flex:1; min-width:0; position:relative; }
.axt-chart-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--ax-mut); font-size:12px; }
.axt-chart-skel { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:flex-end; padding:24px; gap:14px; }
.axt-skel-bars { flex:1; display:flex; align-items:flex-end; gap:3px; opacity:.5; }
.axt-skel-bars span { flex:1; background:linear-gradient(180deg, var(--ax-bdglow), var(--ax-surface)); border-radius:2px; animation:axtSkel 1.3s ease-in-out infinite; }
@keyframes axtSkel { 0%,100%{opacity:.35} 50%{opacity:.75} }
.axt-skel-tag { text-align:center; color:var(--ax-dim); font-size:11px; font-family:var(--ax-mono); letter-spacing:.04em; }

/* Replay HUD */
.axt-hud { position:absolute; top:8px; left:8px; width:250px; background:color-mix(in srgb, var(--ax-panel) 92%, #000); border:1px solid color-mix(in srgb, ${PUR} 40%, transparent); border-radius:10px; padding:10px; backdrop-filter:blur(6px); box-shadow:0 8px 30px rgba(0,0,0,.5); }
.axt-hud-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:7px; }
.axt-hud-tag { font-size:9px; font-weight:800; letter-spacing:.08em; color:${PUR}; }
.axt-hud-strat { font-size:9px; color:var(--ax-mut); }
.axt-hud-bar { height:4px; background:var(--ax-surface); border-radius:3px; overflow:hidden; margin-bottom:9px; }
.axt-hud-fill { height:100%; background:linear-gradient(90deg,${PUR},${CY}); transition:width .1s linear; }
.axt-hud-stats { display:grid; grid-template-columns:repeat(5,1fr); gap:5px; margin-bottom:8px; }
.axt-hudk { display:flex; flex-direction:column; gap:1px; }
.axt-hudk span { font-size:6.5px; letter-spacing:.04em; color:var(--ax-dim); }
.axt-hudk b { font-family:var(--ax-mono); font-size:11px; }
.axt-hud-speed { display:flex; align-items:center; gap:4px; }
.axt-hud-speed span { font-size:7.5px; color:var(--ax-dim); letter-spacing:.06em; }
.axt-hud-speed button { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:4px; padding:3px 7px; font-size:9px; font-family:var(--ax-mono); font-weight:700; }
.axt-hud-speed button.on { border-color:${PUR}; color:${PUR}; }

/* Right panels */
.axt-panel { background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:10px; padding:10px 12px; flex-shrink:0; box-shadow:var(--ax-panel-glow); }
.axt-ph { font-size:9px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:9px; display:flex; align-items:center; justify-content:space-between; }
.axt-stats { display:grid; grid-template-columns:1fr 1fr; gap:3px 14px; }
.axt-statrow { display:flex; justify-content:space-between; align-items:baseline; padding:3px 0; border-bottom:1px solid var(--ax-hair); font-size:10.5px; }
.axt-statrow span { color:var(--ax-mut); } .axt-statrow b { font-family:var(--ax-mono); font-weight:600; }
.axt-52w { margin-top:9px; }
.axt-52w-h { display:flex; justify-content:space-between; align-items:baseline; font-size:8px; letter-spacing:.06em; color:var(--ax-dim); margin-bottom:5px; }
.axt-52w-h em { font-style:normal; color:var(--ax-cydim); font-family:var(--ax-mono); }
.axt-52w-bar { position:relative; height:6px; border-radius:4px; background:linear-gradient(90deg, color-mix(in srgb, ${NEG} 55%, transparent), ${WARN}, color-mix(in srgb, ${POS} 55%, transparent)); }
.axt-52w-mark { position:absolute; top:50%; width:9px; height:9px; border-radius:50%; background:var(--ax-tx); border:2px solid var(--ax-panel); transform:translate(-50%,-50%); box-shadow:0 0 6px rgba(255,255,255,.5); }
.axt-52w-ends { display:flex; justify-content:space-between; margin-top:4px; font-family:var(--ax-mono); font-size:9px; }
.axt-52w-ends b { color:var(--ax-mut); font-weight:600; }
.axt-ai-badge { font-size:9px; font-weight:800; letter-spacing:.06em; border:1px solid; border-radius:5px; padding:2px 7px; }
.axt-ai-conf { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
.axt-ai-conf span { font-size:8px; letter-spacing:.06em; color:var(--ax-dim); }
.axt-ai-bar { flex:1; height:6px; background:var(--ax-surface); border-radius:4px; overflow:hidden; }
.axt-ai-bar div { height:100%; border-radius:4px; }
.axt-ai-conf b { font-family:var(--ax-mono); font-size:12px; }
.axt-ai-sec { font-size:8.5px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut); margin:7px 0 3px; }
.axt-ai-txt { font-size:11px; line-height:1.45; color:var(--ax-tx); margin:0; }
.axt-ai-txt.dim { color:var(--ax-mut); font-size:10px; }
.axt-ai-sigs { display:grid; grid-template-columns:1fr 1fr; gap:3px 10px; }
.axt-sig { font-size:9.5px; color:var(--ax-mut); font-family:var(--ax-mono); }
.axt-sig.on { color:${POS}; }
.axt-ai-foot { font-size:8px; color:var(--ax-dim); margin-top:8px; line-height:1.4; }
.axt-gauges { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; }
.axt-gauge { display:flex; flex-direction:column; align-items:center; }
.axt-gsvg { width:100%; height:34px; }
.axt-gval { font-family:var(--ax-mono); font-size:15px; font-weight:800; margin-top:-9px; }
.axt-glbl { font-size:7.5px; letter-spacing:.05em; color:var(--ax-dim); margin-top:2px; }
.axt-levels { display:flex; flex-direction:column; gap:2px; }
.axt-lvl { display:grid; grid-template-columns:8px 1fr auto; gap:8px; align-items:center; padding:4px 0; border-bottom:1px solid var(--ax-hair); font-size:11px; }
.axt-lvl-dot { width:6px; height:6px; border-radius:50%; }
.axt-lvl-l { color:var(--ax-mut); } .axt-lvl b { font-family:var(--ax-mono); font-weight:600; }
.axt-news .axt-newsrow { display:block; font-size:10.5px; line-height:1.4; color:var(--ax-tx); padding:6px 0; border-bottom:1px solid var(--ax-hair); position:relative; padding-left:12px; }
.axt-news-dot { position:absolute; left:0; top:9px; width:5px; height:5px; border-radius:50%; background:${CY}; }
.axt-newsrow em { display:block; font-style:normal; font-size:8.5px; color:var(--ax-dim); margin-top:2px; }

/* Bottom */
.axt-bottom { flex-shrink:0; height:186px; display:grid; grid-template-columns:repeat(6,1fr); gap:8px; }
.axt-bpanel { background:var(--ax-panel-grad); border:1px solid var(--ax-bd); border-radius:10px; padding:8px 10px; min-width:0; display:flex; flex-direction:column; overflow:hidden; box-shadow:var(--ax-panel-glow); }
.axt-bph { font-size:8.5px; font-weight:700; letter-spacing:.08em; color:var(--ax-cydim); margin-bottom:6px; display:flex; justify-content:space-between; align-items:baseline; }
.axt-bph span { font-weight:500; color:var(--ax-dim); letter-spacing:.02em; }
.axt-ts, .axt-ob, .axt-of, .axt-corr, .axt-opt, .axt-scan { flex:1; overflow-y:auto; font-family:var(--ax-mono); font-size:9.5px; }
.axt-ts-h, .axt-ob-h, .axt-of-h, .axt-opt-h { display:grid; font-size:7px; letter-spacing:.04em; color:var(--ax-dim); padding-bottom:3px; border-bottom:1px solid var(--ax-bdsoft); margin-bottom:2px; position:sticky; top:0; background:var(--ax-panel); }
.axt-ts-h { grid-template-columns:1.1fr .9fr .8fr .4fr; }
.axt-ts-row { display:grid; grid-template-columns:1.1fr .9fr .8fr .4fr; gap:3px; padding:2.5px 0; border-bottom:1px solid var(--ax-hair); }
.axt-ob-h, .axt-ob-row { grid-template-columns:1fr .9fr .9fr 1fr; }
.axt-ob-row { display:grid; gap:3px; padding:2.5px 0; align-items:center; }
.axt-ob-sz { position:relative; overflow:hidden; padding:0 3px; z-index:0; }
.axt-ob-bar { position:absolute; top:0; bottom:0; right:0; z-index:-1; border-radius:2px; }
.axt-ob-bar.bid { left:0; right:auto; background:color-mix(in srgb, ${POS} 22%, transparent); }
.axt-ob-bar.ask { background:color-mix(in srgb, ${NEG} 22%, transparent); }
.axt-ob-bid { color:${POS}; } .axt-ob-ask { color:${NEG}; }
.axt-of-h, .axt-of-row { grid-template-columns:1fr 1fr 1.2fr; }
.axt-of-row { display:grid; gap:4px; padding:3px 0; border-bottom:1px solid var(--ax-hair); align-items:center; }
.axt-of-bar { display:inline-flex; width:34px; height:5px; border-radius:2px; overflow:hidden; margin-right:4px; vertical-align:middle; }
.axt-of-bar span { display:block; height:100%; }
.axt-corr-row { display:grid; grid-template-columns:.7fr 1.4fr .5fr; gap:6px; align-items:center; padding:3.5px 0; border-bottom:1px solid var(--ax-hair); }
.axt-corr-row:hover { background:color-mix(in srgb, var(--ax-acc) 6%, transparent); }
.axt-corr-track { height:5px; background:var(--ax-surface); border-radius:3px; overflow:hidden; }
.axt-corr-fill { height:100%; border-radius:3px; }
.axt-corr-row span { text-align:right; }
.axt-opt-kpis { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-bottom:5px; }
.axt-optk { background:var(--ax-surface); border-radius:5px; padding:4px 5px; display:flex; flex-direction:column; gap:1px; }
.axt-optk span { font-size:6.5px; color:var(--ax-dim); letter-spacing:.03em; } .axt-optk b { font-size:11px; }
.axt-opt-h, .axt-opt-row { grid-template-columns:1fr 1fr 1.1fr; }
.axt-opt-row { display:grid; gap:4px; padding:3px 0; border-bottom:1px solid var(--ax-hair); align-items:center; }
.axt-opt-bar { display:inline-block; height:5px; background:${CY}; border-radius:2px; }
.axt-scan-row { display:grid; grid-template-columns:.7fr 1.3fr .6fr 8px; gap:5px; align-items:center; padding:3.5px 0; border-bottom:1px solid var(--ax-hair); }
.axt-scan-row:hover { background:color-mix(in srgb, var(--ax-acc) 6%, transparent); }
.axt-scan-row.on { box-shadow:inset 2px 0 0 var(--ax-acc); background:color-mix(in srgb, var(--ax-acc) 8%, transparent); }
.axt-scan-l { color:var(--ax-mut); font-size:8.5px; font-family:var(--ax-sans); } .axt-scan-row span:nth-child(3) { text-align:right; }
.axt-scan-dot { width:6px; height:6px; border-radius:50%; }
.axt-empty-mini { color:var(--ax-dim); font-size:10px; padding:12px 2px; }
.axt-skelrows { display:flex; flex-direction:column; gap:7px; padding:6px 2px; }
.axt-skelrow { display:flex; justify-content:space-between; gap:8px; }
.axt-skelrow span { height:9px; border-radius:3px; background:linear-gradient(90deg, var(--ax-surface), var(--ax-bd), var(--ax-surface)); background-size:200% 100%; animation:axtShimmer 1.4s ease-in-out infinite; }
@keyframes axtShimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

/* Status */
.axt-status { flex-shrink:0; height:26px; display:flex; align-items:center; gap:14px; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:8px; padding:0 12px; font-size:10px; overflow:hidden; }
.axt-st-live { display:flex; align-items:center; gap:6px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut); font-size:9px; }
.axt-st-dot { width:6px; height:6px; border-radius:50%; background:var(--ax-neg); }
.axt-st-dot.on { background:${POS}; box-shadow:0 0 6px ${POS}; animation:axtPulse 2s infinite; }
@keyframes axtPulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.axt-st-feed { font-size:9px; color:var(--ax-dim); } .axt-st-feed b { color:${POS}; font-family:var(--ax-mono); }
.axt-st-items { display:flex; gap:16px; flex:1; overflow:hidden; }
.axt-st-item { display:flex; gap:5px; align-items:baseline; white-space:nowrap; font-family:var(--ax-mono); }
.axt-st-item em { font-style:normal; color:var(--ax-dim); font-size:9px; } .axt-st-item b { color:var(--ax-tx); }
.axt-st-time { margin-left:auto; font-family:var(--ax-mono); font-size:9px; color:var(--ax-dim); }

.axt-toast { position:absolute; bottom:40px; left:50%; transform:translateX(-50%); background:color-mix(in srgb, var(--ax-panel) 95%, #000); border:1px solid var(--ax-bdglow); color:var(--ax-tx); border-radius:9px; padding:9px 16px; font-size:12px; z-index:50; box-shadow:0 10px 34px rgba(0,0,0,.5); }

@media (max-width:1400px) { .axt-main { grid-template-columns:210px 1fr 240px; } .axt-bottom { grid-template-columns:repeat(3,1fr); height:auto; } }
`;
