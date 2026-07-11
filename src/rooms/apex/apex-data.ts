import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api } from "../../api";

/* ─────────────────────────────────────────────────────────────
   APEX live data layer (Wave 5). Polls the keyless /api/apex/*
   endpoints and exposes them to the Home UI. Fast tier (quotes,
   indices, gainers, order book) ~6s; news ~45s. All calls are
   fail-soft so the UI degrades to its last snapshot, never crashes.
   ───────────────────────────────────────────────────────────── */

export interface Quote { ticker: string; last: number | null; prev?: number | null; changePct?: number | null; name?: string }
export interface Gainer { ticker: string; last: number | null; changePct: number | null; vol?: number; mktcap?: number; rating?: string }
export interface Story { title: string; rank: number; verified?: number; corroboration?: number; lane?: string; tickers?: { t?: string; s?: string; dir: number; mag: number }[]; sources?: string[]; pinned?: boolean; firstSeen?: string }
export interface Depth { bids: { p: number; q: number }[]; asks: { p: number; q: number }[] }
export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }

export interface CryptoGlobal { totalMcap: number; mcapChangePct: number; volume: number; btcDom: number; ethDom: number }
export interface MacroSeries { series: string; label: string; unit: string; value: number | null; prev: number | null; dir: number }
export interface Mover { ticker: string; last: number | null; changePct: number | null; name?: string; rating?: string }
export interface Movers { stocks: { gainers: Mover[]; losers: Mover[] }; crypto: { gainers: Mover[]; losers: Mover[] } }
export interface Regime { score: number; label: string; momentum: number | null; vix: number | null; pctUp: number | null; fearGreed: number; fearGreedLabel: string }
export interface Internals { advancers: number; decliners: number; pctUp: number | null }
export interface Sector { etf: string; name: string; changePct: number }
export interface Insider { ticker: string; name: string; shares: number; change: number; date: string; code: string; price: number; side: string; value: number }
export interface SessionQuote { ticker: string; name: string; prevClose: number; open: number; dayHi: number; dayLo: number; last: number; changePct: number | null; gap: number | null }
export interface Correlation { symbols: string[]; nodes?: { sym: string; changePct: number | null }[]; matrix: number[][]; updated?: string }
export interface RRGPoint { etf: string; name: string; rsRatio: number; rsMomentum: number }
export interface CryptoFng { value: number; label: string; history: { t: number; value: number }[]; updated: number }
export interface AttentionItem { ticker: string; article: string; views: number; avg: number; spikePct: number; spark: number[] }
export interface Attention { updated: number; items: AttentionItem[] }
export interface Form4Filing { name: string; cik: string; role: string; date: string; link: string }
export interface BtcNet { fastFee: number | null; halfHourFee: number | null; hourFee: number | null; mempoolTxs: number | null; mempoolVsize: number | null; hashRateEH: number | null; nTx24h: number | null; price: number | null; difficulty: number | null; updated: number }
export interface AnomalyItem { sym: string; changePct: number; z: number; sigma: number }
export interface Anomalies { updated: string; items: AnomalyItem[] }
export interface RiskLab { symbol: string; realizedVol: number; ewmaVol: number; var95: number; cvar95: number; var99: number; cvar99: number; maxDD: number; sharpe: number; rollSharpe: number[]; beta: number | null; days: number; bins: { x: number; count: number }[] }
export async function fetchRiskLab(sym: string): Promise<RiskLab | null> {
  const r = await safe<{ risklab: RiskLab | null }>(`/api/apex/risklab/${encodeURIComponent(sym)}`, { risklab: null });
  return r.risklab;
}
export interface VolReport { symbol: string; cone: { w: number; min: number; p25: number; median: number; p75: number; max: number; cur: number }[] }
export async function fetchVol(sym: string): Promise<VolReport | null> {
  const r = await safe<{ vol: VolReport | null }>(`/api/apex/vol/${encodeURIComponent(sym)}`, { vol: null });
  return r.vol;
}
export interface MCReport { symbol: string; S0: number; days: number; driftAnnPct: number; volAnnPct: number; bands: { t: number; p5: number; p25: number; p50: number; p75: number; p95: number }[]; paths: number[][]; target: number | null; probTouch: number | null }
export async function fetchMonteCarlo(sym: string, days = 30, target?: number): Promise<MCReport | null> {
  const q = `days=${days}` + (target != null ? `&target=${target}` : "");
  const r = await safe<{ mc: MCReport | null }>(`/api/apex/montecarlo/${encodeURIComponent(sym)}?${q}`, { mc: null });
  return r.mc;
}
export interface Brief {
  type: string; asOf: string | null; headline: string; narrative: string;
  regime: { score: number; label: string; fearGreed: string; vix: number | null; breadthPctUp: number | null } | null;
  session: SessionQuote[]; movers: { gainers: Mover[]; losers: Mover[] }; sectors: { best: Sector | null; worst: Sector | null };
  macro: { series: string; value: number | null; unit: string }[]; topNews: { title: string; lane?: string; tickers: string[] }[]; watch: string[];
}
export async function fetchBrief(type = "now"): Promise<Brief | null> {
  const r = await safe<{ brief: Brief | null }>(`/api/apex/brief?type=${encodeURIComponent(type)}`, { brief: null });
  return r.brief;
}

export interface ApexLive {
  indices: Quote[];
  gainers: Gainer[];
  yields: { date: string; security: string; rate: number }[];
  news: Story[];
  book: Depth | null;
  crypto: Record<string, Quote>;
  cryptoGlobal: CryptoGlobal | null;
  macro: MacroSeries[];
  movers: Movers;
  regime: Regime | null;
  internals: Internals | null;
  sectors: Sector[];
  insider: Insider[];
  session: SessionQuote[];
  correlation: Correlation | null;
  rrg: RRGPoint[];
  cryptoFng: CryptoFng | null;
  attention: Attention | null;
  form4: Form4Filing[];
  btcNet: BtcNet | null;
  anomalies: Anomalies | null;
  live: boolean;
  updated: number | null;
}

const EMPTY_MOVERS: Movers = { stocks: { gainers: [], losers: [] }, crypto: { gainers: [], losers: [] } };
const EMPTY: ApexLive = { indices: [], gainers: [], yields: [], news: [], book: null, crypto: {}, cryptoGlobal: null, macro: [], movers: EMPTY_MOVERS, regime: null, internals: null, sectors: [], insider: [], session: [], correlation: null, rrg: [], cryptoFng: null, attention: null, form4: [], btcNet: null, anomalies: null, live: false, updated: null };

export interface Fundamentals { ticker: string; name: string; sector: string; industry?: string; marketCap: number | null; pe: number | null; eps: number | null; beta: number | null; divYield: number | null; high52: number | null; low52: number | null }
export async function fetchFundamentals(sym: string): Promise<Fundamentals | null> {
  const r = await safe<{ fundamentals: Fundamentals | null }>(`/api/apex/fundamentals/${encodeURIComponent(sym)}`, { fundamentals: null });
  return r.fundamentals;
}
export async function fetchInsider(sym: string): Promise<Insider[]> {
  const r = await safe<{ insider: Insider[] }>(`/api/apex/insider/${encodeURIComponent(sym)}`, { insider: [] });
  return r.insider || [];
}

async function safe<T>(path: string, fb: T): Promise<T> {
  try { return await api<T>(path); } catch { return fb; }
}

/* On-demand fetchers (symbol drawer, charts). */
export async function fetchQuote(sym: string): Promise<Quote | null> {
  const r = await safe<{ quote: Quote | null }>(`/api/apex/quote/${encodeURIComponent(sym)}`, { quote: null });
  return r.quote;
}
export async function fetchBars(sym: string, tf = "1d", range = "6mo"): Promise<Bar[]> {
  const r = await safe<{ bars: Bar[] }>(`/api/apex/bars/${encodeURIComponent(sym)}?tf=${tf}&range=${range}`, { bars: [] });
  return (r.bars || []).filter((b) => b && b.c != null);
}
export async function fetchNewsImpact(sym: string): Promise<{ title: string; dir: string; magnitude: number; sector: string }[]> {
  const r = await safe<{ impact: { title: string; sentiment_dir: number; impact: number; sector: string }[] }>(`/api/apex/news/impact/${encodeURIComponent(sym)}`, { impact: [] });
  return (r.impact || []).map((i) => ({ title: i.title, dir: i.sentiment_dir > 0 ? "bullish" : "bearish", magnitude: i.impact, sector: i.sector }));
}

export function useApexData(): ApexLive {
  const [data, setData] = useState<ApexLive>(EMPTY);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let fastTimer: number | undefined;
    let newsTimer: number | undefined;

    const pullFast = async () => {
      const ov = await safe<{ overview: { indices: Quote[] }; gainers: Gainer[]; yields: { date: string; security: string; rate: number }[]; cryptoGlobal: CryptoGlobal | null; macro: MacroSeries[]; movers?: Movers; regime?: Regime | null; internals?: Internals | null; sectors?: Sector[]; insider?: Insider[]; session?: SessionQuote[]; correlation?: Correlation | null; rrg?: RRGPoint[]; cryptoFng?: CryptoFng | null; attention?: Attention | null; form4?: Form4Filing[]; btcNet?: BtcNet | null; anomalies?: Anomalies | null }>(
        "/api/apex/overview", { overview: { indices: [] }, gainers: [], yields: [], cryptoGlobal: null, macro: [] });
      const book = await safe<{ book: Depth | null }>("/api/apex/orderbook/BTCUSDT", { book: null });
      const btc = await safe<{ quote: Quote | null }>("/api/apex/quote/BTCUSDT", { quote: null });
      const eth = await safe<{ quote: Quote | null }>("/api/apex/quote/ETHUSDT", { quote: null });
      if (!mounted.current) return;
      const crypto: Record<string, Quote> = {};
      if (btc.quote) crypto.BTCUSDT = btc.quote;
      if (eth.quote) crypto.ETHUSDT = eth.quote;
      const indices = ov.overview?.indices || [];
      setData((d) => ({
        ...d,
        indices,
        gainers: ov.gainers || [],
        yields: ov.yields || [],
        cryptoGlobal: ov.cryptoGlobal || null,
        macro: ov.macro || [],
        movers: ov.movers || EMPTY_MOVERS,
        regime: ov.regime || null,
        internals: ov.internals || null,
        sectors: ov.sectors || [],
        insider: ov.insider || [],
        session: ov.session || [],
        correlation: ov.correlation || null,
        rrg: ov.rrg || [],
        cryptoFng: ov.cryptoFng || null,
        attention: ov.attention || null,
        form4: ov.form4 || [],
        btcNet: ov.btcNet || null,
        anomalies: ov.anomalies || null,
        book: book.book,
        crypto,
        live: indices.length > 0 || (ov.gainers || []).length > 0,
        updated: Date.now(),
      }));
    };

    const pullNews = async () => {
      const n = await safe<{ stories: Record<string, unknown>[] }>("/api/apex/news?limit=20", { stories: [] });
      if (!mounted.current) return;
      // API stores lane/tickers nested under `impact` — flatten to the Story shape the UI reads.
      const stories: Story[] = (n.stories || []).map((s) => {
        const impact = (s.impact || {}) as { lane?: string; tickers?: Story["tickers"] };
        return { title: String(s.title || ""), rank: Number(s.rank || 0), verified: Number(s.verify_score || 0), corroboration: Number(s.article_count || 1), lane: impact.lane, tickers: impact.tickers || [], sources: (s.sources as string[]) || [], pinned: !!s.pinned, firstSeen: (s.first_seen as string) || "" };
      });
      setData((d) => ({ ...d, news: stories }));
    };

    pullFast(); pullNews();
    fastTimer = window.setInterval(pullFast, 6000);
    newsTimer = window.setInterval(pullNews, 45000);
    return () => { mounted.current = false; if (fastTimer) clearInterval(fastTimer); if (newsTimer) clearInterval(newsTimer); };
  }, []);

  return data;
}

export const ApexDataContext = createContext<ApexLive>(EMPTY);
export const useApexLive = () => useContext(ApexDataContext);

/* ── Microstructure (BTC): order-book depth history, live trades, volume profile ── */
export interface DepthSnap { t: number; bids: { p: number; q: number }[]; asks: { p: number; q: number }[] }
export interface Trade { t: number; p: number; q: number; side: string }
export interface VolProfile { lo: number; hi: number; poc: number; last: number; rows: { price: number; buy: number; sell: number; va: boolean }[] }
export interface MicroData { book: Depth | null; depthHistory: DepthSnap[]; trades: Trade[]; volumeProfile: VolProfile | null; tradeCount: number }
const EMPTY_MICRO: MicroData = { book: null, depthHistory: [], trades: [], volumeProfile: null, tradeCount: 0 };
export function useMicro(): MicroData {
  const [d, setD] = useState<MicroData>(EMPTY_MICRO);
  useEffect(() => {
    let alive = true;
    const pull = async () => { const m = await safe<MicroData>("/api/apex/micro", EMPTY_MICRO); if (alive) setD(m); };
    pull(); const iv = window.setInterval(pull, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return d;
}
