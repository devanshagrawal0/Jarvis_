import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fetchQuote, type Bar, type Quote, type Correlation, type RRGPoint, type Regime, type Internals, type Sector, type Anomalies, type MacroAlt } from "../apex-data";

// APEX · Portfolio — the market-structure lens for portfolio construction:
// the risk regime, a cross-asset correlation heatmap, sector rotation (RRG),
// a sector-performance heatmap, and a statistical anomaly scan. All served by
// JARVIS's own /api/apex/* quant routes (no sidecar) and styled with the shared
// Apex theme vars (--ax-*) so it sits seamlessly next to Home.

const POS = "#34d399", NEG = "#f4556b", WARN = "#f5a742", CY = "#3fd0ff", PUR = "#a98bff";
const PAPER_FEE_BPS = 1;

async function safe<T>(url: string, fallback: T): Promise<T> {
  try { const r = await fetch(url); if (!r.ok) return fallback; return (await r.json()) as T; } catch { return fallback; }
}

type State = {
  corr: Correlation | null; rrg: RRGPoint[]; regime: Regime | null;
  internals: Internals | null; sectors: Sector[]; anomalies: Anomalies | null;
  macroAlt: MacroAlt | null;
  portfolios: PortfolioSummary[]; account: PortfolioAccount | null; reconciliation: PortfolioReconciliation | null;
  orders: PortfolioOrder[]; fills: PortfolioFill[]; performance: PortfolioPerformance | null;
  allocation: PortfolioAllocation | null; risk: PortfolioRisk | null;
};

type PortfolioSummary = {
  id: string; name: string; kind: string; baseCurrency: string; mandate: string; demo: boolean; status: string;
};
type PortfolioPosition = {
  ticker: string; side: string; qty: number; avgPrice: number; markPrice: number; marketValue: number; unrealized: number;
  unrealizedPct: number; ownerType: string; markSource: string; quoteAgeSec: number | null;
};
type PortfolioAccount = {
  portfolio: PortfolioSummary | null;
  summary: {
    nav: number; cash: number; availableCash: number; restrictedCash: number; buyingPower: number; marketValue: number;
    longExposure: number; shortExposure: number; grossExposure: number; netExposure: number; unrealized: number;
    realized: number; totalPnl: number; totalPnlPct: number; openPositions: number; openOrders: number;
  };
  cash: { currency: string; available: number; settled: number; restricted: number; receivables: number; payables: number };
  positions: PortfolioPosition[];
  dataStatus: { ok: boolean; staleMarks: number; warnings: string[] };
  asOf: string; mode: string; demo: boolean;
};
type PortfolioReconciliation = {
  ok: boolean; formula: string; expectedNav: number; difference: number;
  components: { cash: number; markedPositions: number; receivables: number; payables: number; nav: number };
  ledgerUnbalancedGroups: unknown[]; dataStatus: { ok: boolean; warnings: string[] }; asOf: string;
};
type PortfolioOrder = {
  id: string; ticker: string; side: string; type: string; qty: number; price: number | null; status: string;
  reservedCash: number; reservedExposure: number; ownerType: string; createdAt: string; filledAt: string | null;
};
type PortfolioFill = {
  id: string; orderId: string; ticker: string; qty: number; side: string; price: number; ownerType: string; ts: string;
};
type PortfolioPerformance = {
  summary: { nav: number; startCash: number; totalPnl: number; totalPnlPct: number; realized: number; unrealized: number; maxDrawdownPct: number; sampleSize: number; sampleWarning: string };
  curve: { ts: string; equity: number }[];
  contributionByInstrument: { ticker: string; ownerType: string; marketValue: number; unrealized: number; weightPct: number }[];
  contributionByOwner: { ownerType: string; unrealized: number; marketValue: number }[];
  asOf: string;
};
type PortfolioBucket = { key: string; marketValue: number; absMarketValue: number; long: number; short: number; count: number; weightPct: number };
type PortfolioAllocation = {
  summary: { nav: number; grossExposure: number; netExposure: number; longExposure: number; shortExposure: number; betaExposure: number; betaToNav: number; volatilityExposure: number; staleMarks: number; breachCount: number };
  groups: Record<string, PortfolioBucket[]>;
  positions: { ticker: string; side: string; ownerType: string; sector: string; assetClass: string; marketValue: number; absMarketValue: number; weightPct: number; betaProxy: number; betaExposure: number; liquidityBucket: string; quoteAgeSec: number | null }[];
  guardrails: { dynamicLimits: { singleNamePct: number; sectorPct: number }; breaches: { type: string; severity: string; key: string; actualPct: number; limitPct: number; message: string }[] };
  warnings: string[]; asOf: string;
};
type PortfolioRisk = {
  summary: { nav: number; var95: number; cvar95: number; method: string; sampleSize: number; concentrationHhi: number; avgPairwiseCorrelationProxy: number; diversificationState: string; staleMarks: number };
  factorExposure: { spyBetaProxy: number; sectorBetaDollars: number; volatilityExposure: number; downsideBetaProxy: number };
  liquidity: { bucket: string; marketValue: number; weightPct: number; count: number }[];
  contribution: { ticker: string; ownerType: string; sector: string; componentCvar: number; marginalRiskPct: number; liquidityBucket: string; quoteAgeSec: number | null }[];
  guardrails: PortfolioAllocation["guardrails"];
  scenarios: { name: string; estimatedPnl: number; topContributors: { ticker: string; shockPct: number; pnl: number }[] }[];
  warnings: string[]; asOf: string;
};
type PortfolioProposal = {
  ok?: boolean; pure?: boolean; proposalId?: string; objective?: string; instrument?: string; ledgerMutation?: boolean; warnings?: string[];
  current?: Record<string, unknown>; proposed?: Record<string, unknown>; delta?: Record<string, unknown>; proposal?: Record<string, unknown>;
  lines?: unknown[]; constraints?: Record<string, unknown>; expectedProtection?: Record<string, unknown>; basisRisk?: string; estimatedCost?: number; liquidity?: string;
};

type PortfolioTab = "account" | "trade" | "positions" | "orders" | "performance" | "allocation" | "risk" | "whatif" | "structure" | "reports";

const WATCHLIST = ["AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "GOOGL", "SPY", "QQQ"];
const CHART_RANGES: Record<string, { tf: string; range: string }> = {
  "1D": { tf: "5m", range: "1d" },
  "5D": { tf: "15m", range: "5d" },
  "1M": { tf: "1d", range: "1mo" },
  "3M": { tf: "1d", range: "3mo" },
  "YTD": { tf: "1d", range: "ytd" },
  "1Y": { tf: "1d", range: "1y" },
  "5Y": { tf: "1wk", range: "5y" },
};

type WorkstationBars = { bars: Bar[]; source: string; actualTf: string; warning: string | null };
const EMPTY_BARS: WorkstationBars = { bars: [], source: "none", actualTf: "-", warning: null };

async function fetchWorkstationBars(sym: string, tf: string, range: string): Promise<WorkstationBars> {
  const ctl = new AbortController();
  const timeout = window.setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(`/api/apex/bars/${encodeURIComponent(sym)}?tf=${encodeURIComponent(tf)}&range=${encodeURIComponent(range)}`, {
      headers: { "content-type": "application/json" },
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ...EMPTY_BARS, warning: data.error || "bars request failed" };
    return {
      bars: ((data.bars || []) as Bar[]).filter((b) => b && Number.isFinite(b.c)),
      source: data.source || "apex",
      actualTf: data.actualTf || tf,
      warning: data.warning || null,
    };
  } catch {
    return { ...EMPTY_BARS, warning: "bars request timed out" };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function PortfolioView() {
  const [s, setS] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PortfolioTab>("account");
  const [activeId, setActiveId] = useState("paper-default");
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [proposal, setProposal] = useState<PortfolioProposal | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [c, r, reg, sec, an, ma, ports] = await Promise.all([
        safe<{ correlation: Correlation | null }>("/api/apex/correlation", { correlation: null }),
        safe<{ rrg: RRGPoint[] }>("/api/apex/rrg", { rrg: [] }),
        safe<{ regime: Regime | null; internals: Internals | null }>("/api/apex/regime", { regime: null, internals: null }),
        safe<{ sectors: Sector[] }>("/api/apex/sectors", { sectors: [] }),
        safe<{ anomalies: Anomalies | null }>("/api/apex/anomalies", { anomalies: null }),
        safe<{ macroAlt: MacroAlt | null }>("/api/apex/macro-alt", { macroAlt: null }),
        safe<{ portfolios: PortfolioSummary[] }>("/api/apex/portfolios", { portfolios: [] }),
      ]);
      const activePortfolio = ports.portfolios?.some((p) => p.id === activeId) ? activeId : (ports.portfolios?.[0]?.id || "paper-default");
      const [acct, recon, ord, jou, perf, alloc, risk] = await Promise.all([
        safe<PortfolioAccount | null>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/account`, null),
        safe<PortfolioReconciliation | null>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/reconciliation`, null),
        safe<{ orders: PortfolioOrder[] }>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/orders`, { orders: [] }),
        safe<{ fills: PortfolioFill[] }>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/journal`, { fills: [] }),
        safe<PortfolioPerformance | null>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/performance`, null),
        safe<PortfolioAllocation | null>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/allocation`, null),
        safe<PortfolioRisk | null>(`/api/apex/portfolios/${encodeURIComponent(activePortfolio)}/risk`, null),
      ]);
      if (dead) return;
      if (activePortfolio !== activeId) setActiveId(activePortfolio);
      setS({ corr: c.correlation, rrg: r.rrg || [], regime: reg.regime, internals: reg.internals, sectors: sec.sectors || [], anomalies: an.anomalies, macroAlt: ma.macroAlt, portfolios: ports.portfolios || [], account: acct, reconciliation: recon, orders: ord.orders || [], fills: jou.fills || [], performance: perf, allocation: alloc, risk });
      setLoading(false);
    })();
    return () => { dead = true; };
  }, [activeId, refreshSeq]);

  const refresh = () => setRefreshSeq((x) => x + 1);
  const postPortfolio = async (path: string, body: unknown) => {
    await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    refresh();
  };
  const createPortfolio = async (body: unknown) => {
    const r = await fetch("/api/apex/portfolios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => null);
    if (d?.portfolio?.id) setActiveId(d.portfolio.id);
    refresh();
  };
  const runProposal = async (section: string, body: unknown) => {
    const r = await fetch(`/api/apex/portfolios/${encodeURIComponent(activeId)}/${section}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    setProposal(await r.json().catch(() => ({ ok: false, warnings: ["Proposal endpoint failed."] })));
  };

  return (
    <div className="ax-port">
      <style>{PORT_CSS}</style>

      <div className="axp-head">
        <span className="axp-title">◎ PORTFOLIO</span>
        <span className="axp-sub">Market structure · regime · correlation · rotation · anomalies</span>
      </div>

      <TickerTape />
      <div className="axp-tabs" role="tablist" aria-label="Portfolio sections">
        {[
          ["account", "Account"],
          ["trade", "Trade"],
          ["positions", "Positions"],
          ["orders", "Orders"],
          ["performance", "Performance"],
          ["allocation", "Allocation"],
          ["risk", "Risk"],
          ["whatif", "What If"],
          ["structure", "Market Structure"],
          ["reports", "Reports"],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id as PortfolioTab)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="axp-empty">Loading market structure…</div>
      ) : !s ? (
        <div className="axp-empty">No data available.</div>
      ) : tab === "account" ? (
        <AccountView account={s.account} reconciliation={s.reconciliation} orders={s.orders} fills={s.fills} risk={s.risk} portfolios={s.portfolios} activeId={activeId} onSelect={setActiveId} onCreate={createPortfolio} onCash={(body) => postPortfolio(`/api/apex/portfolios/${encodeURIComponent(activeId)}/cash`, body)} onPaperOrder={refresh} />
      ) : tab === "trade" ? (
        <TradeWorkstation account={s.account} orders={s.orders} fills={s.fills} risk={s.risk} mode="trade" onPaperOrder={refresh} />
      ) : tab === "positions" ? (
        <PositionsView account={s.account} onAddHolding={(body) => postPortfolio(`/api/apex/portfolios/${encodeURIComponent(activeId)}/holdings`, body)} />
      ) : tab === "orders" ? (
        <OrdersJournalView orders={s.orders} fills={s.fills} />
      ) : tab === "performance" ? (
        <PerformanceView performance={s.performance} />
      ) : tab === "allocation" ? (
        <AllocationView allocation={s.allocation} />
      ) : tab === "risk" ? (
        <PortfolioRiskView risk={s.risk} />
      ) : tab === "whatif" ? (
        <WhatIfView account={s.account} proposal={proposal} onRun={runProposal} />
      ) : tab !== "structure" ? (
        <PortfolioPlaceholder tab={tab} account={s.account} />
      ) : (
        <div className="axp-body">
          {/* Regime strip */}
          {s.regime && <RegimeStrip regime={s.regime} internals={s.internals} />}

          <div className="axp-grid">
            {/* Correlation heatmap */}
            <div className="axp-panel axp-corr">
              <div className="axp-ph">CORRELATION MATRIX <span>90-day daily-return ρ · {s.corr?.symbols.length || 0} assets</span></div>
              {s.corr && s.corr.matrix.length > 0 ? <CorrHeat corr={s.corr} /> : <div className="axp-mini-empty">No correlation data.</div>}
            </div>

            {/* Sector rotation RRG */}
            <div className="axp-panel">
              <div className="axp-ph">SECTOR ROTATION <span>RRG · strength vs momentum</span></div>
              {s.rrg.length > 0 ? <RRG points={s.rrg} /> : <div className="axp-mini-empty">No rotation data.</div>}
            </div>
          </div>

          <div className="axp-grid">
            {/* Sector heatmap */}
            <div className="axp-panel">
              <div className="axp-ph">SECTOR PERFORMANCE <span>today · %</span></div>
              {s.sectors.length > 0 ? <SectorHeat sectors={s.sectors} /> : <div className="axp-mini-empty">No sector data.</div>}
            </div>

            {/* Anomaly scanner */}
            <div className="axp-panel">
              <div className="axp-ph">ANOMALY SCAN <span>today's move vs 60-day z-score</span></div>
              {s.anomalies && s.anomalies.items.length > 0 ? <AnomalyList a={s.anomalies} /> : <div className="axp-mini-empty">No anomalies flagged.</div>}
            </div>
          </div>

          <MacroAltPanels data={s.macroAlt} />

          <div className="axp-foot">Derived from public daily bars. Informational only — not financial advice.</div>
        </div>
      )}
    </div>
  );
}

/* ── Regime strip ── */
function AccountView({ account, reconciliation, orders, fills, risk, portfolios, activeId, onSelect, onCreate, onCash, onPaperOrder }: { account: PortfolioAccount | null; reconciliation: PortfolioReconciliation | null; orders: PortfolioOrder[]; fills: PortfolioFill[]; risk: PortfolioRisk | null; portfolios: PortfolioSummary[]; activeId: string; onSelect: (id: string) => void; onCreate: (body: unknown) => void; onCash: (body: unknown) => void; onPaperOrder: () => void }) {
  const [name, setName] = useState("Recovery Portfolio");
  const [startCash, setStartCash] = useState("100000");
  const [cashAmount, setCashAmount] = useState("1000");
  return (
    <TradeWorkstation
      account={account}
      orders={orders}
      fills={fills}
      risk={risk}
      mode="account"
      reconciliation={reconciliation}
      onPaperOrder={onPaperOrder}
      leftExtra={
        <div className="axw-card axw-mandate">
          <div className="axw-card-title">ACCOUNT / MANDATE</div>
          <label>Portfolio</label>
          <select value={activeId} onChange={(e) => onSelect(e.target.value)}>
            {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label>New portfolio</label>
          <div className="axw-inline">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            <input value={startCash} onChange={(e) => setStartCash(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Cash" />
          </div>
          <button onClick={() => onCreate({ name, startCash: Number(startCash), kind: "demo", mandate: "Sample portfolio for APEX analysis" })}>Create Portfolio</button>
          <label>Cash adjustment</label>
          <div className="axw-inline">
            <input value={cashAmount} onChange={(e) => setCashAmount(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="Amount" />
            <button onClick={() => onCash({ amount: Number(cashAmount), memo: "manual cash adjustment" })}>Apply</button>
          </div>
          <div className={`axw-sync ${reconciliation?.ok ? "ok" : "warn"}`}>{reconciliation?.ok ? "In Sync" : "Needs Check"}</div>
        </div>
      }
    />
  );
}

function TradeWorkstation({ account, orders, fills, risk, mode, reconciliation, leftExtra, onPaperOrder }: { account: PortfolioAccount | null; orders: PortfolioOrder[]; fills: PortfolioFill[]; risk: PortfolioRisk | null; mode: "account" | "trade"; reconciliation?: PortfolioReconciliation | null; leftExtra?: ReactNode; onPaperOrder: () => void }) {
  const first = account?.positions?.[0]?.ticker || "AAPL";
  const [symbol, setSymbol] = useState(first);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [barMeta, setBarMeta] = useState<WorkstationBars>(EMPTY_BARS);
  const [range, setRange] = useState("1D");
  const [busy, setBusy] = useState(false);
  const currentPosition = account?.positions?.find((p) => p.ticker === symbol);

  useEffect(() => {
    const s = symbol.trim().toUpperCase() || "AAPL";
    const cfg = CHART_RANGES[range] || CHART_RANGES["1D"];
    let dead = false;
    setBusy(true);
    fetchQuote(s).then((q) => {
      if (!dead) setQuote(q);
    }).catch(() => {
      if (!dead) setQuote(null);
    });
    (async () => {
      let next = await fetchWorkstationBars(s, cfg.tf, cfg.range);
      if (!next.bars.length && cfg.tf !== "1d") {
        next = await fetchWorkstationBars(s, "1d", "1mo");
      }
      if (!dead) {
        setBars(next.bars || []);
        setBarMeta(next);
        setBusy(false);
      }
    })();
    return () => { dead = true; };
  }, [symbol, range]);

  return (
    <div className="axp-body axw-body">
      {mode === "account" && <WorkstationTop account={account} risk={risk} reconciliation={reconciliation} />}
      <div className={`axw-shell ${mode === "trade" ? "trade" : "account"}`}>
        <div className="axw-left">
          <Watchlist selected={symbol} onSelect={setSymbol} />
          <AccountSnapshot account={account} risk={risk} />
          {leftExtra}
        </div>
        <div className="axw-main">
          <ChartPanel symbol={symbol} quote={quote} bars={bars} barMeta={barMeta} busy={busy} range={range} onRange={setRange} />
          <div className="axw-lower">
            <HoldingsBlotter account={account} selected={symbol} onSelect={setSymbol} />
            <RecentTrades fills={fills} orders={orders} account={account} />
          </div>
        </div>
        <div className="axw-right">
          <OrderTicket symbol={symbol} quote={quote} position={currentPosition} account={account} onSymbol={setSymbol} onPlaced={onPaperOrder} />
          <DepthPanel quote={quote} symbol={symbol} barMeta={barMeta} />
          <OpenOrdersMini orders={orders} />
        </div>
      </div>
    </div>
  );
}

function TickerTape() {
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  useEffect(() => {
    let dead = false;
    Promise.all(WATCHLIST.slice(0, 6).map((s) => fetchQuote(s))).then((rows) => {
      if (dead) return;
      const next: Record<string, Quote | null> = {};
      WATCHLIST.slice(0, 6).forEach((s, i) => { next[s] = rows[i]; });
      setQuotes(next);
    });
    return () => { dead = true; };
  }, []);
  return (
    <div className="axw-tape">
      {WATCHLIST.slice(0, 6).map((s) => {
        const q = quotes[s];
        const chg = q?.changePct;
        const live = q?.last != null;
        const hasChg = typeof chg === "number" && Number.isFinite(chg);
        return <button key={s} className={live ? "" : "stale"}><b>{s}</b><span>{live ? q.last?.toFixed(2) : "DATA"}</span><em style={{ color: !live || !hasChg ? WARN : chg >= 0 ? POS : NEG }}>{live && hasChg ? pct(chg) : "WAIT"}</em></button>;
      })}
    </div>
  );
}

function WorkstationTop({ account, risk, reconciliation }: { account: PortfolioAccount | null; risk: PortfolioRisk | null; reconciliation?: PortfolioReconciliation | null }) {
  const s = account?.summary;
  return (
    <div className="axw-top">
      <div className="axw-top-title"><span>Portfolio</span><b>{account?.portfolio?.name || "APEX Paper Portfolio"}</b><em>{account?.demo ? "PAPER / DEMO" : "LIVE"}</em></div>
      <Metric label="NAV" value={cash(s?.nav)} />
      <Metric label="Today P&L" value={signedCash(s?.totalPnl)} tone={(s?.totalPnl || 0) >= 0 ? "pos" : "neg"} sub={pct(s?.totalPnlPct)} />
      <Metric label="Buying Power" value={cash(s?.buyingPower)} />
      <Metric label="Risk State" value={risk?.summary.diversificationState?.toUpperCase() || "CHECK"} tone={risk?.summary.diversificationState === "fragile" ? "neg" : risk?.summary.diversificationState === "watch" ? "warn" : "pos"} />
      <Metric label="Sync Status" value={reconciliation?.ok === false ? "NEEDS CHECK" : "LIVE"} tone={reconciliation?.ok === false ? "warn" : "pos"} sub={account?.dataStatus?.ok ? "All systems operational" : "Review marks"} />
    </div>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" | "warn" }) {
  return <div className={`axw-metric ${tone || ""}`}><span>{label}</span><b>{value}</b>{sub ? <em>{sub}</em> : null}</div>;
}

function Watchlist({ selected, onSelect }: { selected: string; onSelect: (s: string) => void }) {
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  useEffect(() => {
    let dead = false;
    Promise.all(WATCHLIST.map((s) => fetchQuote(s))).then((rows) => {
      if (dead) return;
      const next: Record<string, Quote | null> = {};
      WATCHLIST.forEach((s, i) => { next[s] = rows[i]; });
      setQuotes(next);
    });
    return () => { dead = true; };
  }, []);
  return (
    <div className="axw-card axw-watch">
      <div className="axw-card-title">WATCHLIST <button>+</button></div>
      <div className="axw-watch-head"><span>Symbol</span><span>Last</span><span>Chg</span></div>
      {WATCHLIST.map((s) => {
        const q = quotes[s];
        const chg = q?.changePct;
        const live = q?.last != null;
        const hasChg = typeof chg === "number" && Number.isFinite(chg);
        return (
          <button key={s} className={`${selected === s ? "on" : ""} ${live ? "" : "stale"}`} onClick={() => onSelect(s)}>
            <b>{s}<em>{displayName(s, q?.name)}</em></b>
            <span>{live ? q.last?.toFixed(2) : "DATA"}</span>
            <i style={{ color: !live || !hasChg ? WARN : chg >= 0 ? POS : NEG }}>{live && hasChg ? pct(chg) : "WAIT"}</i>
          </button>
        );
      })}
    </div>
  );
}

function AccountSnapshot({ account, risk }: { account: PortfolioAccount | null; risk: PortfolioRisk | null }) {
  const s = account?.summary;
  return (
    <div className="axw-card axw-snapshot">
      <div className="axw-card-title">ACCOUNT SUMMARY</div>
      <Row label="Buying Power" value={cash(s?.buyingPower)} />
      <Row label="Available Cash" value={cash(s?.availableCash)} />
      <Row label="Market Value" value={cash(s?.marketValue)} />
      <Row label="Unrealized P&L" value={signedCash(s?.unrealized)} tone={(s?.unrealized || 0) >= 0 ? "pos" : "neg"} />
      <div className="axw-card-title gap">RISK SNAPSHOT</div>
      <Row label="VaR 95%" value={cash(risk?.summary.var95)} />
      <Row label="Expected Shortfall" value={cash(risk?.summary.cvar95)} />
      <Row label="Portfolio Beta" value={risk ? risk.factorExposure.spyBetaProxy.toFixed(2) : "-"} />
      <Row label="Net Exposure" value={pct(account?.summary.netExposure && account.summary.nav ? (account.summary.netExposure / account.summary.nav) * 100 : 0)} />
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "warn" }) {
  return <div className={`axw-row ${tone || ""}`}><span>{label}</span><b>{value}</b></div>;
}

function ChartPanel({ symbol, quote, bars, barMeta, busy, range, onRange }: { symbol: string; quote: Quote | null; bars: Bar[]; barMeta: WorkstationBars; busy: boolean; range: string; onRange: (range: string) => void }) {
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showVwap, setShowVwap] = useState(true);
  const [showMa20, setShowMa20] = useState(true);
  const [benchmark, setBenchmark] = useState("None");
  const [benchmarkBars, setBenchmarkBars] = useState<Bar[]>([]);
  const lastBar = bars[bars.length - 1];
  const open = quote?.open ?? lastBar?.o ?? null;
  const high = quote?.high ?? lastBar?.h ?? null;
  const low = quote?.low ?? lastBar?.l ?? null;
  const chg = quote?.changePct;
  const hasChg = typeof chg === "number" && Number.isFinite(chg);

  useEffect(() => {
    if (benchmark === "None") {
      setBenchmarkBars([]);
      return;
    }
    let dead = false;
    const cfg = CHART_RANGES[range] || CHART_RANGES["1D"];
    fetchWorkstationBars(benchmark, cfg.tf, cfg.range).then((payload) => {
      if (!dead) setBenchmarkBars(payload.bars || []);
    });
    return () => { dead = true; };
  }, [benchmark, range]);

  return (
    <div className="axw-card axw-chart-card" data-bars={bars.length}>
      <div className="axw-instrument">
        <div><b>{symbol}</b><span>{displayName(symbol, quote?.name)} · NASDAQ</span></div>
        <strong>{quote?.last?.toFixed(2) || "-"}</strong>
        <em style={{ color: !hasChg ? WARN : chg >= 0 ? POS : NEG }}>{hasChg ? pct(chg) : "WAIT"}</em>
        <span>O {open?.toFixed(2) || "-"} H {high?.toFixed(2) || "-"} L {low?.toFixed(2) || "-"}</span>
        <span className={barMeta.warning ? "axw-data-source warn" : "axw-data-source"}>{barMeta.source.toUpperCase()} {barMeta.actualTf.toUpperCase()}</span>
        <i>{busy ? "Updating" : "Live"}</i>
      </div>
      {barMeta.warning && <div className="axw-chart-warning">{barMeta.warning}</div>}
      <div className="axw-chart-tools">
        {Object.keys(CHART_RANGES).map((x) => <button key={x} className={range === x ? "on" : ""} onClick={() => onRange(x)}>{x}</button>)}
        <button className={showVolume ? "on" : ""} onClick={() => setShowVolume((v) => !v)}>Volume</button>
        <button className={showRsi ? "on" : ""} onClick={() => setShowRsi((v) => !v)}>RSI</button>
        <button className={showVwap ? "on" : ""} onClick={() => setShowVwap((v) => !v)}>VWAP</button>
        <button className={showMa20 ? "on" : ""} onClick={() => setShowMa20((v) => !v)}>MA20</button>
        <label className="axw-benchmark">Benchmark
          <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
            <option>None</option>
            <option>SPY</option>
            <option>QQQ</option>
          </select>
        </label>
      </div>
      <div className="axw-chart-stage">
        <PriceCanvas bars={bars} quote={quote} showVolume={showVolume} showRsi={showRsi} showVwap={showVwap} showMa20={showMa20} benchmark={benchmark} benchmarkBars={benchmarkBars} />
      </div>
    </div>
  );
}

function PriceCanvas({ bars, quote, showVolume, showRsi, showVwap, showMa20, benchmark, benchmarkBars }: { bars: Bar[]; quote: Quote | null; showVolume: boolean; showRsi: boolean; showVwap: boolean; showMa20: boolean; benchmark: string; benchmarkBars: Bar[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(2,12,20,.22)"; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(90,150,190,.13)"; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 72) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 54) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      const data = bars.length > 8 ? bars : [];
      if (!data.length) {
        ctx.fillStyle = "rgba(160,190,210,.7)";
        ctx.font = "12px ui-monospace,monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Waiting for real chart data", w / 2, h / 2);
        return;
      }
      const vals = data.flatMap((b) => [b.h, b.l]).filter(Number.isFinite);
      const lo = Math.min(...vals), hi = Math.max(...vals), range = hi - lo || 1;
      const indicatorBand = showVolume || showRsi;
      const pad = 22, chartH = Math.floor(indicatorBand ? h * 0.72 : h - 16), volTop = chartH + 6, rsiTop = Math.floor(h * 0.86);
      const bodyW = Math.max(4, (w - pad * 2) / data.length * 0.58);
      const X = (i: number) => pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
      const Y = (v: number) => chartH - pad - ((v - lo) / range) * (chartH - pad * 2);
      const maxVol = Math.max(1, ...data.map((b) => b.v || 0));
      data.forEach((b, i) => {
        const x = X(i), up = b.c >= b.o, col = up ? "#00d19a" : "#ff465d";
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
        const y = Math.min(Y(b.o), Y(b.c)); const bh = Math.max(2, Math.abs(Y(b.o) - Y(b.c)));
        ctx.fillRect(x - bodyW / 2, y, bodyW, bh);
        if (showVolume) {
          const vh = Math.max(2, ((b.v || 0) / maxVol) * (rsiTop - volTop - 8));
          ctx.globalAlpha = 0.42; ctx.fillRect(x - bodyW / 2, rsiTop - vh - 3, bodyW, vh); ctx.globalAlpha = 1;
        }
      });
      if (showVwap) {
        let pv = 0, vv = 0;
        ctx.strokeStyle = "rgba(245,167,66,.95)";
        ctx.lineWidth = 1.35;
        ctx.beginPath();
        data.forEach((b, i) => {
          const v = Math.max(0, b.v || 0);
          const typical = (b.h + b.l + b.c) / 3;
          if (v > 0) { pv += typical * v; vv += v; }
          const val = vv > 0 ? pv / vv : typical;
          if (i === 0) ctx.moveTo(X(i), Y(val)); else ctx.lineTo(X(i), Y(val));
        });
        ctx.stroke();
        ctx.fillStyle = "rgba(245,167,66,.95)";
        ctx.font = "9px ui-monospace,monospace";
        ctx.textAlign = "left";
        ctx.fillText("VWAP", 8, 14);
      }
      if (showMa20) {
        ctx.strokeStyle = "rgba(83,190,255,.92)";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        data.forEach((b, i) => {
          const from = Math.max(0, i - 19);
          const windowRows = data.slice(from, i + 1);
          const avg = windowRows.reduce((sum, x) => sum + x.c, 0) / windowRows.length;
          if (i === 0) ctx.moveTo(X(i), Y(avg)); else ctx.lineTo(X(i), Y(avg));
        });
        ctx.stroke();
        ctx.fillStyle = "rgba(83,190,255,.92)";
        ctx.font = "9px ui-monospace,monospace";
        ctx.textAlign = "left";
        ctx.fillText("MA20", 8, 26);
      }
      ctx.fillStyle = "rgba(167,197,218,.72)";
      ctx.font = "10px ui-monospace,monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= 4; i++) {
        const v = hi - (range * i) / 4;
        ctx.fillText(v.toFixed(2), w - 6, Y(v));
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
        const idx = Math.min(data.length - 1, Math.max(0, Math.round((data.length - 1) * p)));
        const t = new Date(data[idx]?.t || "");
        const label = Number.isFinite(t.getTime())
          ? (data.length > 80 ? t.toLocaleDateString([], { month: "short", day: "numeric" }) : t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
          : "";
        if (label) ctx.fillText(label, X(idx), h - 5);
      });
      if (benchmark !== "None" && benchmarkBars.length > 8) {
        const base = benchmarkBars[0]?.c || 1;
        const ownBase = data[0]?.c || 1;
        ctx.strokeStyle = "rgba(90,160,255,.9)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        benchmarkBars.slice(0, data.length).forEach((b, i) => {
          const normalized = ownBase * ((b.c || base) / base);
          const x = X(i);
          const y = Y(normalized);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.fillStyle = "rgba(90,160,255,.9)";
        ctx.font = "10px ui-monospace,monospace";
        ctx.textAlign = "left";
        ctx.fillText(benchmark, 8, 16);
      }
      if (indicatorBand) {
        ctx.strokeStyle = "rgba(90,150,190,.22)"; ctx.beginPath(); ctx.moveTo(0, volTop); ctx.lineTo(w, volTop); ctx.moveTo(0, rsiTop); ctx.lineTo(w, rsiTop); ctx.stroke();
      }
      if (showRsi) {
        ctx.strokeStyle = "#8b5cf6"; ctx.lineWidth = 1.2; ctx.beginPath();
        data.forEach((b, i) => {
          const prev = data[Math.max(0, i - 6)]?.c || b.c;
          const rsi = Math.max(18, Math.min(82, 50 + ((b.c - prev) / Math.max(0.01, prev)) * 520));
          const y = rsiTop + 6 + ((82 - rsi) / 64) * (h - rsiTop - 14);
          if (i === 0) ctx.moveTo(X(i), y); else ctx.lineTo(X(i), y);
        });
        ctx.stroke();
        ctx.fillStyle = "rgba(170,126,255,.9)"; ctx.font = "9px ui-monospace,monospace"; ctx.textAlign = "left"; ctx.fillText("RSI (14)", 8, rsiTop + 13);
      }
      const last = data[data.length - 1]?.c || quote?.last;
      if (last) {
        const y = Y(last);
        ctx.setLineDash([2, 4]); ctx.strokeStyle = "rgba(63,208,255,.55)"; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#16a7ff"; ctx.fillRect(w - 58, y - 10, 54, 20);
        ctx.fillStyle = "#e9f8ff"; ctx.font = "10px ui-monospace,monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(last.toFixed(2), w - 31, y);
      }
    };
    draw(); window.addEventListener("resize", draw); return () => window.removeEventListener("resize", draw);
  }, [bars, quote, showVolume, showRsi, showVwap, showMa20, benchmark, benchmarkBars]);
  return <canvas ref={ref} className="axw-price-canvas" />;
}

function OrderTicket({ symbol, quote, position, account, onSymbol, onPlaced }: { symbol: string; quote: Quote | null; position?: PortfolioPosition; account: PortfolioAccount | null; onSymbol: (s: string) => void; onPlaced: () => void }) {
  const [side, setSide] = useState<"buy" | "sell" | "short" | "cover">("buy");
  const [type, setType] = useState<"market" | "limit">("market");
  const [sizeMode, setSizeMode] = useState<"shares" | "dollars">("shares");
  const [qty, setQty] = useState("100");
  const [limit, setLimit] = useState("");
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState("");
  const livePrice = quote?.last ?? position?.markPrice ?? null;
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const spread = bid != null && ask != null ? Math.max(0, ask - bid) : null;
  const chg = quote?.changePct;
  const hasChg = typeof chg === "number" && Number.isFinite(chg);
  const price = type === "limit" ? Number(limit) || livePrice || 0 : livePrice || 0;
  const rawSize = Number(qty) || 0;
  const shares = sizeMode === "dollars" && price > 0 ? Math.floor((rawSize / price) * 1000000) / 1000000 : rawSize;
  const notional = price * shares;
  const estFee = Math.abs(notional) * (PAPER_FEE_BPS / 10000);
  const apiSide = side === "buy" || side === "cover" ? "buy" : "sell";
  const cashImpact = apiSide === "buy" ? -(notional + estFee) : (notional - estFee);
  const cashAfter = (account?.summary.availableCash || 0) + cashImpact;
  const exposureDelta = apiSide === "buy" ? notional : -notional;
  const heldNotional = price * Math.abs(position?.qty || 0);
  const maxSizingNotional = apiSide === "sell" && heldNotional > 0 ? heldNotional : (account?.summary.buyingPower || 0);
  const hasTradablePrice = price > 0;
  const canPlace = symbol.trim() && shares > 0 && hasTradablePrice && (type === "market" || Number(limit) > 0) && !placing;
  const afterQty = (position?.qty || 0) + (apiSide === "buy" ? shares : -shares);
  const shareText = shares ? shares.toFixed(shares % 1 ? 4 : 0) : "-";
  const afterQtyText = afterQty ? afterQty.toFixed(afterQty % 1 ? 4 : 0) : "0";
  const review = () => {
    if (!canPlace) {
      setMessage(!hasTradablePrice ? "Waiting for a valid price before review." : "Enter a positive tradable size first.");
      return;
    }
    setMessage(`Review: ${apiSide.toUpperCase()} ${shareText} ${symbol.trim().toUpperCase()} ${type.toUpperCase()} for ${cash(notional)} est fee ${cash(estFee)}.`);
  };
  const applyPreset = (pctValue: number) => {
    if (!(price > 0) || !(maxSizingNotional > 0)) {
      setMessage("Preset sizing needs a live price and available buying power or position value.");
      return;
    }
    setSizeMode("dollars");
    setQty(Math.max(0, maxSizingNotional * pctValue).toFixed(2));
  };
  const place = async () => {
    setPlacing(true); setMessage("");
    try {
      const body: Record<string, unknown> = { ticker: symbol.trim().toUpperCase(), side: apiSide, qty: shares, type };
      if (type === "limit") body.limitPrice = Number(limit);
      const res = await fetch("/api/apex/paper/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(String(data.error || "Order rejected"));
      setMessage(data.status === "filled" ? `Filled ${apiSide.toUpperCase()} ${shares} ${symbol}` : `Working ${apiSide.toUpperCase()} ${shares} ${symbol}`);
      onPlaced();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Order failed");
    } finally {
      setPlacing(false);
    }
  };
  return (
    <div className="axw-card axw-ticket">
      <div className="axw-ticket-head">
        <div><span>Instrument</span><b>{symbol}</b><em>{displayName(symbol, quote?.name)} · NASDAQ</em></div>
        <i>PAPER</i>
      </div>
      <div className="axw-quote-line">
        <strong>{livePrice?.toFixed(2) || "-"}</strong>
        <em style={{ color: !hasChg ? WARN : chg >= 0 ? POS : NEG }}>{hasChg ? pct(chg) : "WAIT"}</em>
        <i>{quote?.last ? "LIVE" : "WAITING"}</i>
      </div>
      <div className="axw-bidask"><div><span>Bid</span><b>{bid != null ? bid.toFixed(2) : "WAIT"}</b></div><div><span>Ask</span><b>{ask != null ? ask.toFixed(2) : "WAIT"}</b></div><div><span>Spread</span><b>{spread != null ? spread.toFixed(2) : "WAIT"}</b></div></div>
      <div className="axw-side-tabs">
        {(["buy", "sell", "short", "cover"] as const).map((x) => <button key={x} className={side === x ? `on ${x}` : ""} onClick={() => setSide(x)}>{x.toUpperCase()}</button>)}
      </div>
      <input className="axw-symbol-input" value={symbol} onChange={(e) => onSymbol(e.target.value.toUpperCase())} placeholder="Symbol" />
      <div className="axw-order-tabs">{(["market", "limit"] as const).map((x) => <button key={x} className={type === x ? "on" : ""} onClick={() => setType(x)}>{x.toUpperCase()}</button>)}</div>
      <div className="axw-size-tabs">{(["shares", "dollars"] as const).map((x) => <button key={x} className={sizeMode === x ? "on" : ""} onClick={() => setSizeMode(x)}>{x.toUpperCase()}</button>)}</div>
      <label>{sizeMode === "shares" ? "Shares" : "Dollars"}</label><input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} />
      <div className="axw-size-presets">{[0.1, 0.25, 0.5, 1].map((x) => <button key={x} onClick={() => applyPreset(x)}>{x === 1 ? "MAX" : `${Math.round(x * 100)}%`}</button>)}</div>
      {type === "limit" && <><label>Limit Price</label><input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={(quote?.last || 0).toFixed(2)} /></>}
      <div className="axw-ticket-rows">
        <Row label="Route" value="Paper sim" />
        <Row label="Est. Shares" value={shareText} />
        <Row label="Est. Notional" value={cash(notional)} />
        <Row label="Est. Fee" value={cash(estFee)} />
        <Row label="Cash Impact" value={signedCash(cashImpact)} tone={cashImpact >= 0 ? "pos" : "neg"} />
        <Row label="Exposure Δ" value={signedCash(exposureDelta)} tone={exposureDelta >= 0 ? "pos" : "neg"} />
        <Row label="Buying Power" value={cash(account?.summary.buyingPower)} />
        <Row label="Cash After" value={cash(cashAfter)} tone={cashAfter < 0 ? "neg" : undefined} />
      </div>
      <div className="axw-position-note"><span>{symbol}: {position ? `${Math.abs(position.qty)} sh` : "0 sh"}</span><b>After {afterQtyText} sh</b></div>
      <div className="axw-ticket-actions"><button onClick={review}>Review Order</button><button className={apiSide} disabled={!canPlace} onClick={place}>{placing ? "Placing..." : `Place ${apiSide === "buy" ? "Buy" : "Sell"} Order`}</button></div>
      {message && <div className="axw-order-msg">{message}</div>}
      {!hasTradablePrice && <div className="axw-order-msg">Waiting for a valid price before order placement.</div>}
    </div>
  );
}

function HoldingsBlotter({ account, selected, onSelect }: { account: PortfolioAccount | null; selected: string; onSelect: (s: string) => void }) {
  const rows = account?.positions || [];
  const stateRows = [
    ["Cash", cash(account?.summary.cash), "Ledger", "Ready", "100.00%", "Deployable"],
    ["Booked positions", String(account?.summary.openPositions || 0), "Portfolio", "Flat", cash(account?.summary.marketValue), "Actual"],
    ["Open orders", String(account?.summary.openOrders || 0), "Order book", "Clear", cash((account?.summary.openOrders || 0) * 0), "Actual"],
    ["Buying power", cash(account?.summary.buyingPower), "Risk engine", "Available", cash(account?.summary.availableCash), "Actual"],
  ];
  return (
    <div className="axw-card axw-blotter">
      <div className="axw-card-title">POSITIONS <span>{rows.length} open</span></div>
      {!rows.length ? (
        <div className="axw-table">
          <div className="axw-tr head"><span>Book State</span><span>Value</span><span>Source</span><span>Status</span><span>Exposure</span><span></span><span>Truth</span></div>
          {stateRows.map((p) => (
            <div key={p[0]} className="axw-tr">
              <b>{p[0]}</b><span>{p[1]}</span><span>{p[2]}</span><span>{p[3]}</span><span>{p[4]}</span><em></em><span>{p[5]}</span>
            </div>
          ))}
          <div className="axw-empty-note">Account is cash-only until a paper order fills. Watchlist data is separate from booked portfolio truth.</div>
        </div>
      ) : (
        <div className="axw-table">
          <div className="axw-tr head"><span>Symbol</span><span>Qty</span><span>Avg</span><span>Mark</span><span>Mkt Value</span><span>Unreal P&L</span><span>% Port</span></div>
          {rows.slice(0, 8).map((p) => (
            <button key={`${p.ticker}-${p.ownerType}`} className={selected === p.ticker ? "axw-tr on" : "axw-tr"} onClick={() => onSelect(p.ticker)}>
              <b>{p.ticker}</b><span>{Math.abs(p.qty)}</span><span>{cash(p.avgPrice)}</span><span>{cash(p.markPrice)}</span><span>{cash(Math.abs(p.marketValue))}</span><em style={{ color: p.unrealized >= 0 ? POS : NEG }}>{signedCash(p.unrealized)}</em><span>{pct(account?.summary.nav ? Math.abs(p.marketValue) / account.summary.nav * 100 : 0)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentTrades({ fills, orders, account }: { fills: PortfolioFill[]; orders: PortfolioOrder[]; account: PortfolioAccount | null }) {
  const openOrders = orders.filter((o) => o.status === "open");
  const warnings = account?.dataStatus.warnings.length || 0;
  const readiness = [
    ["Fills", String(fills.length), "Journal", fills.length ? "Active" : "Clear"],
    ["Working", String(openOrders.length), "Orders", openOrders.length ? "Queued" : "Clear"],
    ["Cash", cash(account?.summary.availableCash), "Ledger", "Available"],
    ["Mode", account?.mode?.toUpperCase() || "PAPER", "Engine", account?.dataStatus.ok === false ? "Check" : "Ready"],
    ["Warnings", String(warnings), "Marks", warnings ? "Review" : "Clean"],
  ];
  return (
    <div className="axw-card axw-recent">
      <div className="axw-card-title">FILL / ROUTE STATE</div>
      {!fills.length ? (
        <>
          {readiness.map((f) => <div className="axw-fill" key={f.join("-")}><span>{f[0]}</span><b>{f[1]}</b><em className={f[3] === "Check" || f[3] === "Review" ? "sell" : "buy"}>{f[3][0]}</em><span>{f[2]}</span><span>{f[3]}</span></div>)}
          <div className="axw-empty-note">No simulated fills are recorded for this portfolio yet.</div>
        </>
      ) : fills.slice(0, 8).map((f) => <div className="axw-fill" key={f.id}><span>{new Date(f.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><b>{f.ticker}</b><em className={f.side}>{f.side[0].toUpperCase()}</em><span>{Math.abs(f.qty)}</span><span>{cash(f.price)}</span></div>)}
    </div>
  );
}

function DepthPanel({ quote, symbol, barMeta }: { quote: Quote | null; symbol: string; barMeta: WorkstationBars }) {
  const bid = quote?.bid ?? null;
  const ask = quote?.ask ?? null;
  const bidSize = quote?.bid_sz ?? null;
  const askSize = quote?.ask_sz ?? null;
  const chg = quote?.changePct;
  const hasChg = typeof chg === "number" && Number.isFinite(chg);
  if (quote?.last == null || bid == null || ask == null) {
    return (
      <div className="axw-card axw-depth">
        <div className="axw-card-title">ORDER BOOK <span>{symbol}</span></div>
        <div className="axw-depth-summary"><span>Depth unavailable</span><span>{barMeta.source.toUpperCase()}</span><span>{barMeta.actualTf.toUpperCase()}</span></div>
        <div className="axw-depth-status">
          <Row label="Last" value={quote?.last != null ? quote.last.toFixed(2) : "WAIT"} />
          <Row label="Prev Close" value={quote?.prev != null ? quote.prev.toFixed(2) : "WAIT"} />
          <Row label="Move" value={hasChg ? pct(chg) : "WAIT"} tone={!hasChg ? "warn" : chg >= 0 ? "pos" : "neg"} />
          <Row label="Bid / Ask" value="WAIT" tone="warn" />
        </div>
      </div>
    );
  }
  const spread = ask - bid;
  return (
    <div className="axw-card axw-depth">
      <div className="axw-card-title">ORDER BOOK <span>{symbol}</span></div>
      <div className="axw-depth-summary"><span>Level I</span><span>Spread {spread.toFixed(2)}</span><span>Rows 1</span></div>
      <div className="axw-depth-head"><span>MPID</span><span>Size</span><span>Bid</span><span>Ask</span><span>Size</span><span>MPID</span></div>
      <div className="axw-depth-row">
        <i>L1</i><span>{bidSize != null ? bidSize.toLocaleString() : "-"}</span><b>{bid.toFixed(2)}</b><em>{ask.toFixed(2)}</em><span>{askSize != null ? askSize.toLocaleString() : "-"}</span><i>L1</i>
      </div>
      <div className="axw-spread">Spread {spread.toFixed(2)} ({pct((spread / Math.max(0.01, quote.last || bid)) * 100)})</div>
    </div>
  );
}

function OpenOrdersMini({ orders }: { orders: PortfolioOrder[] }) {
  const open = orders.filter((o) => o.status === "open").slice(0, 4);
  const reserved = open.reduce((sum, o) => sum + (o.reservedCash || 0) + (o.reservedExposure || 0), 0);
  return (
    <div className="axw-card axw-open">
      <div className="axw-card-title">OPEN ORDERS <span>{open.length}</span></div>
      {!open.length ? (
        <>
          <div className="axw-open-row"><b>Queue</b><span className="buy">CLEAR</span><em>0 active</em></div>
          <div className="axw-open-row"><b>Reserved</b><span>{cash(reserved)}</span><em>released</em></div>
          <div className="axw-open-row"><b>Engine</b><span className="buy">READY</span><em>paper only</em></div>
        </>
      ) : open.map((o) => <div className="axw-open-row" key={o.id}><b>{o.ticker}</b><span className={o.side}>{o.side.toUpperCase()}</span><em>{o.qty} @ {o.price == null ? "MKT" : cash(o.price)}</em></div>)}
    </div>
  );
}

function displayName(symbol: string, name?: string | null) {
  const clean = String(name || "").trim();
  return clean && clean.toUpperCase() !== symbol.toUpperCase() ? clean : companyName(symbol);
}

function companyName(symbol: string) {
  return ({ AAPL: "Apple Inc.", NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.", MSFT: "Microsoft Corp.", AMZN: "Amazon.com", GOOGL: "Alphabet Inc.", SPY: "SPDR S&P 500 ETF", QQQ: "Invesco QQQ Trust" } as Record<string, string>)[symbol] || symbol;
}

function PositionsView({ account, compact = false, onAddHolding }: { account: PortfolioAccount | null; compact?: boolean; onAddHolding?: (body: unknown) => void }) {
  const rows = account?.positions || [];
  const [ticker, setTicker] = useState("AAPL");
  const [qty, setQty] = useState("10");
  const [avg, setAvg] = useState("100");
  const [ownerType, setOwnerType] = useState("manual");
  return (
    <div className="axp-panel">
      <div className="axp-ph">POSITIONS <span>{rows.length} open · source-linked marks</span></div>
      {onAddHolding && (
        <div className="axp-action-row inline">
          <div className="axp-action-box grow">
            <span>ADD HOLDING</span>
            <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker" />
            <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="Qty" />
            <input value={avg} onChange={(e) => setAvg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Avg price" />
            <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)}>
              <option value="manual">manual</option>
              <option value="bot">bot</option>
              <option value="strategy">strategy</option>
            </select>
            <button onClick={() => onAddHolding({ ticker, qty: Number(qty), avgPrice: Number(avg), ownerType, memo: "manual holding import" })}>Add</button>
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="axp-mini-empty">No holdings yet. Wave 3 will add create/add-holding flows; Paper trades will appear here automatically.</div>
      ) : (
        <div className={`axp-pos-table ${compact ? "compact" : ""}`}>
          <div className="axp-pos-row head"><span>Symbol</span><span>Side</span><span>Qty</span><span>Avg</span><span>Mark</span><span>Value</span><span>P&L</span><span>Owner</span><span>Data</span></div>
          {rows.map((p) => (
            <div className="axp-pos-row" key={`${p.ticker}-${p.ownerType}`}>
              <span className="mono strong">{p.ticker}</span>
              <span className={p.side === "short" ? "neg" : "pos"}>{p.side.toUpperCase()}</span>
              <span className="mono">{Math.abs(p.qty)}</span>
              <span className="mono">{cash(p.avgPrice)}</span>
              <span className="mono">{cash(p.markPrice)}</span>
              <span className="mono">{cash(Math.abs(p.marketValue))}</span>
              <span className="mono" style={{ color: p.unrealized >= 0 ? POS : NEG }}>{signedCash(p.unrealized)} <em>{pct(p.unrealizedPct)}</em></span>
              <span>{p.ownerType}</span>
              <span className={p.quoteAgeSec == null || p.quoteAgeSec > 900 ? "warn" : "ok"}>{p.markSource}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OrdersJournalView({ orders, fills }: { orders: PortfolioOrder[]; fills: PortfolioFill[] }) {
  return (
    <div className="axp-body">
      <div className="axp-grid">
        <div className="axp-panel">
          <div className="axp-ph">OPEN / RECENT ORDERS <span>{orders.length} order receipts</span></div>
          {orders.length === 0 ? <div className="axp-mini-empty">No orders for this portfolio yet.</div> : (
            <div className="axp-order-list">
              {orders.map((o) => (
                <div className="axp-order" key={o.id}>
                  <b>{o.ticker}</b><span className={o.side === "sell" ? "neg" : "pos"}>{o.side.toUpperCase()}</span><span>{o.type}</span>
                  <span className="mono">{o.qty}</span><span className="mono">{o.price == null ? "market" : cash(o.price)}</span><span>{o.status}</span>
                  <em>reserved {cash(o.reservedCash + o.reservedExposure)}</em>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="axp-panel">
          <div className="axp-ph">FILL JOURNAL <span>{fills.length} fills</span></div>
          {fills.length === 0 ? <div className="axp-mini-empty">No fills for this portfolio yet.</div> : (
            <div className="axp-order-list">
              {fills.map((f) => (
                <div className="axp-order" key={f.id}>
                  <b>{f.ticker}</b><span className={f.side === "sell" ? "neg" : "pos"}>{f.side.toUpperCase()}</span><span className="mono">{Math.abs(f.qty)}</span>
                  <span className="mono">{cash(f.price)}</span><span>{f.ownerType}</span><em>{new Date(f.ts).toLocaleString()}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PerformanceView({ performance }: { performance: PortfolioPerformance | null }) {
  const p = performance;
  return (
    <div className="axp-body">
      <div className="axp-kpi-grid axp-account-kpis">
        {portfolioKpi("NAV", cash(p?.summary.nav), CY)}
        {portfolioKpi("TOTAL P&L", signedCash(p?.summary.totalPnl), (p?.summary.totalPnl || 0) >= 0 ? POS : NEG, pct(p?.summary.totalPnlPct))}
        {portfolioKpi("MAX DD", pct(p?.summary.maxDrawdownPct), (p?.summary.maxDrawdownPct || 0) < -10 ? NEG : WARN)}
        {portfolioKpi("SAMPLE", String(p?.summary.sampleSize || 0), p?.summary.sampleWarning ? WARN : POS)}
      </div>
      {p?.summary.sampleWarning && <div className="axp-warnline">{p.summary.sampleWarning}</div>}
      <div className="axp-grid">
        <div className="axp-panel">
          <div className="axp-ph">EQUITY CURVE <span>{p?.curve.length || 0} observations</span></div>
          {p?.curve.length ? <MiniEquity curve={p.curve} /> : <div className="axp-mini-empty">Equity history starts when paper fills or snapshots exist.</div>}
        </div>
        <div className="axp-panel">
          <div className="axp-ph">ATTRIBUTION <span>unrealized contribution by instrument</span></div>
          {!p?.contributionByInstrument.length ? <div className="axp-mini-empty">No position attribution yet.</div> : (
            <div className="axp-attr-list">
              {p.contributionByInstrument.map((x) => (
                <div className="axp-attr" key={x.ticker}>
                  <b>{x.ticker}</b><span>{x.ownerType}</span><span>{x.weightPct.toFixed(2)}%</span>
                  <em style={{ color: x.unrealized >= 0 ? POS : NEG }}>{signedCash(x.unrealized)}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="axp-panel">
        <div className="axp-ph">OWNER ATTRIBUTION <span>manual vs bot vs strategy</span></div>
        {!p?.contributionByOwner.length ? <div className="axp-mini-empty">No owner attribution yet.</div> : (
          <div className="axp-attr-list owners">
            {p.contributionByOwner.map((x) => (
              <div className="axp-attr" key={x.ownerType}><b>{x.ownerType}</b><span>{cash(x.marketValue)}</span><em style={{ color: x.unrealized >= 0 ? POS : NEG }}>{signedCash(x.unrealized)}</em></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AllocationView({ allocation }: { allocation: PortfolioAllocation | null }) {
  const a = allocation;
  return (
    <div className="axp-body">
      <div className="axp-kpi-grid axp-account-kpis">
        {portfolioKpi("GROSS", cash(a?.summary.grossExposure), WARN)}
        {portfolioKpi("NET", cash(a?.summary.netExposure), CY)}
        {portfolioKpi("BETA / NAV", a ? a.summary.betaToNav.toFixed(3) : "-", a && Math.abs(a.summary.betaToNav) > 1.2 ? WARN : POS)}
        {portfolioKpi("BREACHES", String(a?.summary.breachCount || 0), a?.summary.breachCount ? NEG : POS)}
      </div>
      {a?.warnings.map((w) => <div className="axp-warnline" key={w}>{w}</div>)}
      <div className="axp-grid">
        <AllocationBucket title="SECTOR ALLOCATION" rows={a?.groups.sector || []} />
        <AllocationBucket title="ASSET CLASS" rows={a?.groups.assetClass || []} />
        <AllocationBucket title="LIQUIDITY BUCKETS" rows={a?.groups.liquidity || []} />
        <AllocationBucket title="OWNER / BOT" rows={a?.groups.bot || []} />
      </div>
      <div className="axp-panel">
        <div className="axp-ph">EXPOSURE BY POSITION <span>weights reconcile to marked portfolio values</span></div>
        {!a?.positions.length ? <div className="axp-mini-empty">No exposure yet.</div> : (
          <div className="axp-risk-table">
            <div className="axp-risk-row head"><span>Symbol</span><span>Sector</span><span>Weight</span><span>Beta</span><span>Beta $</span><span>Liquidity</span></div>
            {a.positions.map((p) => (
              <div className="axp-risk-row" key={`${p.ticker}-${p.ownerType}`}>
                <b>{p.ticker}</b><span>{p.sector}</span><span>{p.weightPct.toFixed(2)}%</span><span>{p.betaProxy.toFixed(2)}</span><span>{cash(p.betaExposure)}</span><span>{p.liquidityBucket}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="axp-panel">
        <div className="axp-ph">CONCENTRATION GUARDRAILS <span>adaptive limits from current book size</span></div>
        {!a?.guardrails.breaches.length ? <div className="axp-mini-empty">No concentration breach from the current adaptive policy.</div> : (
          <div className="axp-breach-list">
            {a.guardrails.breaches.map((b) => <div className={`axp-breach ${b.severity}`} key={`${b.type}-${b.key}`}><b>{b.key}</b><span>{b.message}</span><em>{b.actualPct.toFixed(2)}% / limit {b.limitPct.toFixed(2)}%</em></div>)}
          </div>
        )}
      </div>
    </div>
  );
}

function AllocationBucket({ title, rows }: { title: string; rows: PortfolioBucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.weightPct));
  return (
    <div className="axp-panel">
      <div className="axp-ph">{title} <span>{rows.length} bucket(s)</span></div>
      {!rows.length ? <div className="axp-mini-empty">No allocation data yet.</div> : (
        <div className="axp-bars">
          {rows.slice(0, 8).map((r) => (
            <div className="axp-bar-row" key={r.key}>
              <div><b>{r.key}</b><span>{r.count} pos · {cash(r.absMarketValue)}</span></div>
              <div className="axp-bar"><i style={{ width: `${Math.max(2, (r.weightPct / max) * 100)}%` }} /></div>
              <em>{r.weightPct.toFixed(2)}%</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PortfolioRiskView({ risk }: { risk: PortfolioRisk | null }) {
  const r = risk;
  return (
    <div className="axp-body">
      <div className="axp-kpi-grid axp-account-kpis">
        {portfolioKpi("VAR 95", cash(r?.summary.var95), WARN)}
        {portfolioKpi("CVAR 95", cash(r?.summary.cvar95), NEG)}
        {portfolioKpi("DIVERSIFICATION", r?.summary.diversificationState?.toUpperCase() || "-", r?.summary.diversificationState === "fragile" ? NEG : r?.summary.diversificationState === "watch" ? WARN : POS)}
        {portfolioKpi("CORR PROXY", r ? r.summary.avgPairwiseCorrelationProxy.toFixed(3) : "-", r && r.summary.avgPairwiseCorrelationProxy > 0.6 ? WARN : CY)}
      </div>
      <div className="axp-warnline">{r?.summary.method || "Risk engine waiting for portfolio state."}</div>
      {r?.warnings.map((w) => <div className="axp-warnline" key={w}>{w}</div>)}
      <div className="axp-grid">
        <div className="axp-panel">
          <div className="axp-ph">FACTOR EXPOSURE <span>portfolio-level proxies</span></div>
          <div className="axp-kpi-grid">
            {portfolioKpi("SPY beta", r ? r.factorExposure.spyBetaProxy.toFixed(3) : "-", CY)}
            {portfolioKpi("Downside beta", r ? r.factorExposure.downsideBetaProxy.toFixed(3) : "-", WARN)}
            {portfolioKpi("Sector beta $", cash(r?.factorExposure.sectorBetaDollars), WARN)}
            {portfolioKpi("Vol exposure", cash(r?.factorExposure.volatilityExposure), PUR)}
          </div>
        </div>
        <div className="axp-panel">
          <div className="axp-ph">LIQUIDITY RISK <span>bucketed by mark/liquidity quality</span></div>
          {!r?.liquidity.length ? <div className="axp-mini-empty">No liquidity exposure yet.</div> : (
            <div className="axp-attr-list">
              {r.liquidity.map((x) => <div className="axp-attr" key={x.bucket}><b>{x.bucket}</b><span>{x.count} pos</span><span>{x.weightPct.toFixed(2)}%</span><em>{cash(x.marketValue)}</em></div>)}
            </div>
          )}
        </div>
      </div>
      <div className="axp-grid">
        <div className="axp-panel">
          <div className="axp-ph">RISK CONTRIBUTION <span>component CVaR sum is traceable to positions</span></div>
          {!r?.contribution.length ? <div className="axp-mini-empty">No component risk yet.</div> : (
            <div className="axp-risk-table">
              <div className="axp-risk-row head"><span>Symbol</span><span>Sector</span><span>Owner</span><span>CVaR</span><span>Share</span><span>Data</span></div>
              {r.contribution.map((c) => <div className="axp-risk-row" key={`${c.ticker}-${c.ownerType}`}><b>{c.ticker}</b><span>{c.sector}</span><span>{c.ownerType}</span><span>{cash(c.componentCvar)}</span><span>{c.marginalRiskPct.toFixed(2)}%</span><span>{c.liquidityBucket}</span></div>)}
            </div>
          )}
        </div>
        <div className="axp-panel">
          <div className="axp-ph">STRESS SCENARIOS <span>estimated P&L impact</span></div>
          {!r?.scenarios.length ? <div className="axp-mini-empty">No scenarios yet.</div> : (
            <div className="axp-scenarios">
              {r.scenarios.map((s) => <div className="axp-scenario" key={s.name}><b>{s.name}</b><em style={{ color: s.estimatedPnl >= 0 ? POS : NEG }}>{signedCash(s.estimatedPnl)}</em><span>{s.topContributors.map((x) => `${x.ticker} ${signedCash(x.pnl)}`).join(" · ")}</span></div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WhatIfView({ account, proposal, onRun }: { account: PortfolioAccount | null; proposal: PortfolioProposal | null; onRun: (section: string, body: unknown) => void }) {
  const first = account?.positions?.[0];
  const [ticker, setTicker] = useState(first?.ticker || "AAPL");
  const [qty, setQty] = useState("10");
  const [price, setPrice] = useState(String(first?.markPrice || 100));
  const [type, setType] = useState("add");
  const action = { actions: [{ type, ticker, qty: Number(qty), price: Number(price) }], objective: "manual what-if basket" };
  return (
    <div className="axp-body">
      <div className="axp-panel">
        <div className="axp-ph">WHAT-IF BASKET <span>pure/read-only portfolio simulation</span></div>
        <div className="axp-action-row inline">
          <div className="axp-action-box grow">
            <span>ACTION</span>
            <select value={type} onChange={(e) => setType(e.target.value)}><option value="add">add</option><option value="trim">trim/sell</option></select>
            <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Ticker" />
            <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.-]/g, ""))} placeholder="Qty" />
            <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Price" />
            <button onClick={() => onRun("what-if", action)}>Run</button>
          </div>
        </div>
        <div className="axp-action-row inline">
          <button className="axp-command" onClick={() => onRun("rebalance-proposal", { objective: "reduce concentration and stale-mark risk" })}>Rebalance Proposal</button>
          <button className="axp-command" onClick={() => onRun("hedge-proposal", { hedgePct: 0.15 })}>Hedge Proposal</button>
        </div>
      </div>
      <ProposalView proposal={proposal} />
    </div>
  );
}

function ProposalView({ proposal }: { proposal: PortfolioProposal | null }) {
  if (!proposal) return <div className="axp-panel"><div className="axp-ph">PROPOSAL RESULT <span>nothing run yet</span></div><div className="axp-mini-empty">Run a what-if, rebalance, or hedge proposal. It will not mutate the ledger.</div></div>;
  return (
    <div className="axp-panel">
      <div className="axp-ph">PROPOSAL RESULT <span>{proposal.proposalId || "draft"} · ledger mutation {proposal.ledgerMutation ? "YES" : "NO"}</span></div>
      <div className="axp-proposal-grid">
        <ObjectCard title="CURRENT" data={proposal.current} />
        <ObjectCard title="PROPOSED / PROTECTION" data={proposal.proposed || proposal.expectedProtection || proposal.proposal} />
        <ObjectCard title="DELTA / CONSTRAINTS" data={proposal.delta || proposal.constraints} />
      </div>
      {proposal.instrument && <div className="axp-warnline">Instrument: {proposal.instrument} · Basis risk: {proposal.basisRisk || "unknown"} · Cost: {cash(proposal.estimatedCost)}</div>}
      {proposal.warnings?.map((w) => <div className="axp-warnline" key={w}>{w}</div>)}
    </div>
  );
}

function ObjectCard({ title, data }: { title: string; data?: Record<string, unknown> }) {
  const entries = Object.entries(data || {}).slice(0, 8);
  return (
    <div className="axp-object-card">
      <b>{title}</b>
      {!entries.length ? <span>No data</span> : entries.map(([k, v]) => <div key={k}><span>{k}</span><em>{formatUnknown(v)}</em></div>)}
    </div>
  );
}

function formatUnknown(v: unknown) {
  if (typeof v === "number") return Math.abs(v) > 100 ? cash(v) : Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v == null) return "-";
  if (Array.isArray(v)) return `${v.length} item(s)`;
  if (typeof v === "object") return "object";
  return String(v);
}

function MiniEquity({ curve }: { curve: { ts: string; equity: number }[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const vals = curve.map((x) => x.equity).filter((v) => Number.isFinite(v));
      if (vals.length < 2) return;
      const lo = Math.min(...vals), hi = Math.max(...vals), rg = hi - lo || 1;
      const X = (i: number) => 8 + (i / (vals.length - 1)) * (w - 16);
      const Y = (v: number) => h - 10 - ((v - lo) / rg) * (h - 20);
      ctx.beginPath(); vals.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
      ctx.strokeStyle = vals[vals.length - 1] >= vals[0] ? POS : NEG; ctx.lineWidth = 2; ctx.stroke();
    };
    draw(); window.addEventListener("resize", draw); return () => window.removeEventListener("resize", draw);
  }, [curve]);
  return <canvas ref={ref} className="axp-canvas" style={{ height: 150 }} />;
}

function PortfolioPlaceholder({ tab, account }: { tab: PortfolioTab; account: PortfolioAccount | null }) {
  const labels: Record<PortfolioTab, string> = {
    account: "Account",
    positions: "Positions",
    orders: "Orders",
    performance: "Performance",
    trade: "Trade",
    allocation: "Allocation",
    risk: "Risk",
    whatif: "What If",
    structure: "Market Structure",
    reports: "Reports",
  };
  return (
    <div className="axp-body">
      <div className="axp-panel axp-placeholder">
        <div className="axp-ph">{labels[tab].toUpperCase()} <span>reserved for the next strict wave</span></div>
        <p>This section is intentionally not faked. It will connect to the reconciled portfolio ledger after Account, Positions and Paper reservations pass checks.</p>
        <div className="axp-placeholder-grid">
          {portfolioKpi("Current NAV", cash(account?.summary?.nav), CY)}
          {portfolioKpi("Positions", String(account?.summary?.openPositions || 0), "var(--ax-tx)")}
          {portfolioKpi("Open Orders", String(account?.summary?.openOrders || 0), WARN)}
          {portfolioKpi("Data State", account?.dataStatus?.ok ? "OK" : "CHECK", account?.dataStatus?.ok ? POS : WARN)}
        </div>
      </div>
    </div>
  );
}

function portfolioKpi(label: string, value: string, color: string, sub?: string) {
  return <div className="axp-kpi"><span>{label}</span><b style={{ color }}>{value}</b>{sub ? <i>{sub}</i> : null}</div>;
}

function cash(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function signedCash(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "-";
  return (v >= 0 ? "+" : "-") + "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function pct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function MacroAltPanels({ data }: { data: MacroAlt | null }) {
  const d = data;
  const pct = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "-" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  const num = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? "-" : new Intl.NumberFormat("en-US").format(Math.round(v));
  const money = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return "-";
    const abs = Math.abs(v);
    if (abs >= 1e12) return "$" + (v / 1e12).toFixed(2) + "T";
    if (abs >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    return "$" + num(v);
  };
  return (
    <div className="axp-grid axp-macro-grid">
      <div className="axp-panel">
        <div className="axp-ph">VOL / OPTIONS STRESS <span>Cboe VIX, VVIX, term, put/call</span></div>
        {d?.cboe ? (
          <div className="axp-kpi-grid">
            {kpi("VIX", d.cboe.vix?.toFixed(2), d.cboe.vix != null && d.cboe.vix > 22 ? WARN : CY)}
            {kpi("VVIX", d.cboe.vvix?.toFixed(2), d.cboe.vvix != null && d.cboe.vvix > 105 ? WARN : CY)}
            {kpi("VIX3M-VIX", d.cboe.termSpread?.toFixed(2), d.cboe.termSpread != null && d.cboe.termSpread < 0 ? NEG : POS)}
            {kpi("PUT/CALL", d.cboe.putCallRatio?.toFixed(2), d.cboe.putCallRatio != null && d.cboe.putCallRatio > 1 ? WARN : POS)}
          </div>
        ) : <div className="axp-mini-empty">No Cboe snapshot yet.</div>}
      </div>

      <div className="axp-panel">
        <div className="axp-ph">FACTOR TAPE <span>Ken French daily factors</span></div>
        {d?.kenFrench ? (
          <div className="axp-kpi-grid">
            {kpi("MKT-RF", pct(d.kenFrench.mktRf), d.kenFrench.mktRf != null && d.kenFrench.mktRf < 0 ? NEG : POS)}
            {kpi("SMB", pct(d.kenFrench.smb), d.kenFrench.smb != null && d.kenFrench.smb < 0 ? WARN : CY)}
            {kpi("HML", pct(d.kenFrench.hml), d.kenFrench.hml != null && d.kenFrench.hml < 0 ? WARN : CY)}
            {kpi("MOM", pct(d.kenFrench.momentum), d.kenFrench.momentum != null && d.kenFrench.momentum < 0 ? NEG : POS)}
          </div>
        ) : <div className="axp-mini-empty">No factor snapshot yet.</div>}
      </div>

      <div className="axp-panel">
        <div className="axp-ph">MACRO TAPE <span>BLS + Federal Reserve H.15</span></div>
        {(d?.bls?.series?.length || d?.fed) ? (
          <div className="axp-macro-list">
            {(d?.bls?.series || []).slice(0, 4).map((x) => <div className="axp-mrow" key={x.id}><span>{x.label}</span><b>{x.value ?? "-"}<i>{x.change == null ? "" : ` (${x.change >= 0 ? "+" : ""}${x.change})`}</i></b></div>)}
            {d?.fed && <div className="axp-mrow"><span>Fed Funds</span><b>{d.fed.fedFunds ?? "-"}%</b></div>}
            {d?.fed && <div className="axp-mrow"><span>10Y Treasury</span><b>{d.fed.treasury10y ?? "-"}%</b></div>}
          </div>
        ) : <div className="axp-mini-empty">No macro snapshot yet.</div>}
      </div>

      <div className="axp-panel">
        <div className="axp-ph">FUTURES POSITIONING <span>CFTC non-commercial net</span></div>
        {d?.cftc?.items?.length ? (
          <div className="axp-cot-list">
            {d.cftc.items.slice(0, 6).map((x) => <div className="axp-cot" key={x.market}><span>{x.market.replace(/ - .*$/, "")}</span><b style={{ color: x.nonCommercialNet >= 0 ? POS : NEG }}>{num(x.nonCommercialNet)}</b></div>)}
          </div>
        ) : <div className="axp-mini-empty">No CFTC snapshot yet.</div>}
      </div>

      <div className="axp-panel">
        <div className="axp-ph">US UNIVERSE MAP <span>Nasdaq Trader directory</span></div>
        {d?.nasdaq ? (
          <div className="axp-kpi-grid">
            {kpi("TOTAL", num(d.nasdaq.total), CY)}
            {kpi("STOCKS", num(d.nasdaq.stocks), POS)}
            {kpi("ETFS", num(d.nasdaq.etfs), WARN)}
            {kpi("NASDAQ", num(d.nasdaq.nasdaq), PUR)}
          </div>
        ) : <div className="axp-mini-empty">No symbol-directory snapshot yet.</div>}
      </div>

      <div className="axp-panel">
        <div className="axp-ph">CRYPTO LIQUIDITY <span>DefiLlama TVL + stablecoins</span></div>
        {d?.defi ? (
          <div className="axp-macro-list">
            <div className="axp-mrow"><span>Total TVL</span><b>{money(d.defi.tvl)}</b></div>
            <div className="axp-mrow"><span>Stablecoin cap</span><b>{money(d.defi.stableMcap)}</b></div>
            {d.defi.topProtocols.slice(0, 3).map((x) => <div className="axp-mrow" key={x.name}><span>{x.name}</span><b>{money(x.tvl)} <i>{pct(x.change7d)} 7d</i></b></div>)}
          </div>
        ) : <div className="axp-mini-empty">No DeFi liquidity snapshot yet.</div>}
      </div>
    </div>
  );
}

function kpi(label: string, value: string | undefined, color: string) {
  return <div className="axp-kpi"><span>{label}</span><b style={{ color }}>{value || "-"}</b></div>;
}

function RegimeStrip({ regime, internals }: { regime: Regime; internals: Internals | null }) {
  const score = regime.score ?? 50;
  const col = score >= 60 ? POS : score <= 40 ? NEG : WARN;
  const pctUp = internals?.pctUp ?? regime.pctUp;
  return (
    <div className="axp-regime">
      <div className="axp-reg-gauge">
        <div className="axp-reg-arc"><div className="axp-reg-fill" style={{ width: `${score}%`, background: col, boxShadow: `0 0 10px ${col}88` }} /></div>
        <div className="axp-reg-score" style={{ color: col }}>{score}<span>/100</span></div>
      </div>
      <div className="axp-reg-label" style={{ color: col }}>{regime.label || "—"}</div>
      <div className="axp-reg-stats">
        {regChip("VIX", regime.vix != null ? regime.vix.toFixed(1) : "—", regime.vix != null && regime.vix > 20 ? WARN : undefined)}
        {regChip("BREADTH", pctUp != null ? `${(pctUp * 100).toFixed(0)}% up` : "—", pctUp != null ? (pctUp >= 0.5 ? POS : NEG) : undefined)}
        {internals && regChip("ADV/DEC", `${internals.advancers}/${internals.decliners}`, internals.advancers >= internals.decliners ? POS : NEG)}
        {regChip("FEAR/GREED", `${regime.fearGreed} · ${regime.fearGreedLabel}`, regime.fearGreed >= 55 ? POS : regime.fearGreed <= 45 ? NEG : WARN)}
      </div>
    </div>
  );
}
function regChip(label: string, value: string, color?: string) {
  return <div className="axp-reg-chip"><span className="axp-rc-l">{label}</span><span className="axp-rc-v" style={color ? { color } : undefined}>{value}</span></div>;
}

/* ── Correlation heatmap ── */
function CorrHeat({ corr }: { corr: Correlation }) {
  const syms = corr.symbols, m = corr.matrix;
  const color = (v: number) => {
    // +1 → cyan, 0 → neutral, −1 → red
    if (v >= 0) { const t = v; return `rgba(63,208,255,${(0.08 + t * 0.62).toFixed(3)})`; }
    const t = -v; return `rgba(244,85,107,${(0.08 + t * 0.62).toFixed(3)})`;
  };
  return (
    <div className="axp-heat-wrap">
      <div className="axp-heat" style={{ gridTemplateColumns: `40px repeat(${syms.length}, 1fr)` }}>
        <div className="axp-hc axp-corner" />
        {syms.map((s) => <div key={"top" + s} className="axp-hc axp-htop">{s}</div>)}
        {syms.map((rs, i) => (
          <Fragment key={"r" + rs}>
            <div className="axp-hc axp-hleft">{rs}</div>
            {syms.map((cs, j) => {
              const v = m[i]?.[j] ?? 0;
              return <div key={rs + cs} className="axp-cell" style={{ background: i === j ? "rgba(150,190,225,.14)" : color(v) }} title={`${rs} · ${cs}: ${v.toFixed(2)}`}>{i === j ? "" : v.toFixed(2)}</div>;
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── Sector-rotation RRG scatter ── */
function RRG({ points }: { points: RRGPoint[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const pad = 28;
      const xs = points.map((p) => p.rsRatio), ys = points.map((p) => p.rsMomentum);
      const spanX = Math.max(2, Math.max(...xs.map((v) => Math.abs(v - 100))) * 1.3);
      const spanY = Math.max(2, Math.max(...ys.map((v) => Math.abs(v - 100))) * 1.3);
      const X = (v: number) => pad + ((v - (100 - spanX)) / (2 * spanX)) * (w - pad * 2);
      const Y = (v: number) => h - pad - ((v - (100 - spanY)) / (2 * spanY)) * (h - pad * 2);
      const cx = X(100), cy = Y(100);
      // quadrant fills
      const quad = (x0: number, y0: number, x1: number, y1: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); };
      quad(cx, pad, w - pad, cy, "rgba(52,211,153,.05)");   // leading (top-right)
      quad(pad, pad, cx, cy, "rgba(63,208,255,.05)");        // improving (top-left)
      quad(pad, cy, cx, h - pad, "rgba(244,85,107,.05)");    // lagging (bottom-left)
      quad(cx, cy, w - pad, h - pad, "rgba(245,167,66,.05)"); // weakening (bottom-right)
      // axes
      ctx.strokeStyle = "rgba(150,190,225,.28)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, pad); ctx.lineTo(cx, h - pad); ctx.moveTo(pad, cy); ctx.lineTo(w - pad, cy); ctx.stroke();
      // quadrant labels
      ctx.font = "8.5px ui-sans-serif,system-ui"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(52,211,153,.6)"; ctx.textAlign = "right"; ctx.fillText("LEADING", w - pad - 4, pad + 8);
      ctx.fillStyle = "rgba(63,208,255,.6)"; ctx.textAlign = "left"; ctx.fillText("IMPROVING", pad + 4, pad + 8);
      ctx.fillStyle = "rgba(244,85,107,.6)"; ctx.fillText("LAGGING", pad + 4, h - pad - 8);
      ctx.fillStyle = "rgba(245,167,66,.6)"; ctx.textAlign = "right"; ctx.fillText("WEAKENING", w - pad - 4, h - pad - 8);
      // points
      points.forEach((p) => {
        const x = X(p.rsRatio), y = Y(p.rsMomentum);
        const lead = p.rsRatio >= 100, mom = p.rsMomentum >= 100;
        const col = lead && mom ? POS : !lead && mom ? CY : !lead && !mom ? NEG : WARN;
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.fill(); ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(230,240,255,.9)"; ctx.font = "9px ui-monospace,monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(p.etf.replace(/^XL/, ""), x + 7, y);
      });
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [points]);
  return <canvas ref={ref} className="axp-canvas" style={{ height: 240 }} />;
}

/* ── Sector-performance heatmap ── */
function SectorHeat({ sectors }: { sectors: Sector[] }) {
  const max = Math.max(1, ...sectors.map((s) => Math.abs(s.changePct)));
  const sorted = [...sectors].sort((a, b) => b.changePct - a.changePct);
  return (
    <div className="axp-sectors">
      {sorted.map((s) => {
        const up = s.changePct >= 0, t = Math.abs(s.changePct) / max;
        const bg = up ? `rgba(52,211,153,${(0.08 + t * 0.5).toFixed(3)})` : `rgba(244,85,107,${(0.08 + t * 0.5).toFixed(3)})`;
        return (
          <div key={s.etf} className="axp-sec" style={{ background: bg }}>
            <div className="axp-sec-name">{s.name}</div>
            <div className="axp-sec-etf">{s.etf}</div>
            <div className="axp-sec-chg" style={{ color: up ? POS : NEG }}>{up ? "+" : ""}{s.changePct.toFixed(2)}%</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Anomaly list ── */
function AnomalyList({ a }: { a: Anomalies }) {
  const maxSig = Math.max(2, ...a.items.map((i) => i.sigma));
  return (
    <div className="axp-anom">
      {a.items.slice(0, 12).map((it) => {
        const up = it.changePct >= 0, hot = it.sigma >= 2;
        return (
          <div key={it.sym} className="axp-arow">
            <span className="axp-a-sym">{it.sym}</span>
            <span className="axp-a-chg" style={{ color: up ? POS : NEG }}>{up ? "+" : ""}{it.changePct.toFixed(2)}%</span>
            <div className="axp-a-bar"><div className="axp-a-fill" style={{ width: `${(it.sigma / maxSig) * 100}%`, background: hot ? WARN : CY }} /></div>
            <span className="axp-a-z" style={{ color: hot ? WARN : "var(--ax-mut)" }}>{it.z >= 0 ? "+" : ""}{it.z.toFixed(2)}σ</span>
          </div>
        );
      })}
    </div>
  );
}

const PORT_CSS = `
.ax-port {
  position:fixed; inset:0; z-index:60;
  height:100%; display:flex; flex-direction:column; gap:10px;
  padding:12px 12px 52px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0;
  background:
    linear-gradient(rgba(32,112,160,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(32,112,160,.045) 1px, transparent 1px),
    radial-gradient(circle at 55% -10%, rgba(16,110,170,.22), transparent 34%),
    #020914;
  background-size:54px 54px,54px 54px,auto,auto;
}
.ax-port::after {
  content:"JARVIS     Ask Jarvis anything...                                                    CHAT     SEARCH     CODE";
  position:fixed; left:10px; right:10px; bottom:8px; height:32px;
  display:flex; align-items:center; padding:0 18px;
  color:#a9c5d8; font-size:11px; letter-spacing:.02em;
  border:1px solid rgba(52,147,196,.18); border-radius:7px;
  background:linear-gradient(180deg,rgba(5,18,31,.94),rgba(2,10,18,.98));
  box-shadow:0 -8px 28px rgba(0,0,0,.34);
  white-space:pre;
}
.axp-head { display:flex; align-items:baseline; gap:12px; }
.axp-head .axp-title, .axp-head .axp-sub { display:none; }
.axp-head::before { content:"PORTFOLIO"; font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axp-head::after { content:"Account truth · holdings · orders · performance · attribution"; font-size:11px; color:var(--ax-mut); }
.axp-tabs { display:flex; gap:6px; overflow-x:auto; padding-bottom:0; }
.axp-tabs button { background:rgba(4,16,27,.88); border:1px solid rgba(54,116,152,.24); color:var(--ax-mut); border-radius:6px; padding:6px 10px; font-family:var(--ax-sans); font-size:10px; font-weight:800; letter-spacing:.035em; white-space:nowrap; cursor:pointer; }
.axp-tabs button.on { color:var(--ax-tx); border-color:var(--ax-bdglow); background:var(--ax-panelhi); box-shadow:0 0 16px rgba(63,208,255,.12); }
.axp-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:14px; padding-right:4px; }
.axp-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.axp-panel { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; min-width:0; }
.axp-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:11px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.axp-ph span { font-weight:500; letter-spacing:.02em; color:var(--ax-dim); text-transform:none; }
.axp-canvas { width:100%; display:block; }
.axp-mini-empty { color:var(--ax-mut); font-size:11px; padding:20px 2px; }
.axp-foot { font-size:9px; color:var(--ax-dim); padding-top:2px; }
.axp-empty { color:var(--ax-mut); font-size:12px; padding:26px 4px; }
.axw-body { gap:8px; overflow:hidden; padding-bottom:0; }
.axw-tape { height:24px; display:flex; gap:18px; align-items:center; overflow:hidden; border-bottom:1px solid rgba(45,125,170,.12); padding:0 2px 7px; flex-shrink:0; }
.axw-tape button { border:0; background:transparent; color:var(--ax-tx); display:flex; gap:6px; align-items:center; font-family:var(--ax-mono); font-size:10px; padding:0; white-space:nowrap; }
.axw-tape b { color:#e8f7ff; font-weight:900; }
.axw-tape span { color:var(--ax-mut); }
.axw-tape em { font-style:normal; font-weight:800; }
.axw-tape button.stale { opacity:.62; }
.axw-top { flex-shrink:0; min-height:76px; display:grid; grid-template-columns:minmax(210px,1.4fr) repeat(5,minmax(120px,1fr)); border:1px solid rgba(52,147,196,.26); background:linear-gradient(180deg,rgba(8,23,36,.78),rgba(2,12,20,.7)); border-radius:8px; overflow:hidden; }
.axw-top-title, .axw-metric { padding:14px 18px; border-right:1px solid rgba(84,138,174,.18); min-width:0; }
.axw-top-title span, .axw-metric span { display:block; color:#7e93a8; font-size:9px; letter-spacing:.11em; text-transform:uppercase; margin-bottom:6px; }
.axw-top-title b { display:block; color:#f3fbff; font-size:14px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axw-top-title em { display:inline-block; color:#ffb33f; font-style:normal; font-size:9px; font-weight:900; letter-spacing:.08em; margin-top:5px; }
.axw-metric b { display:block; color:#eaf7ff; font-family:var(--ax-mono); font-size:16px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axw-metric em { display:block; margin-top:4px; color:#7e93a8; font-style:normal; font-size:10px; }
.axw-metric.pos b, .axw-row.pos b { color:${POS}; }
.axw-metric.neg b, .axw-row.neg b { color:${NEG}; }
.axw-metric.warn b, .axw-row.warn b { color:${WARN}; }
.axw-shell { flex:1 1 auto; min-height:0; max-height:none; display:grid; grid-template-columns:270px minmax(620px,1fr) 390px; gap:8px; }
.axw-shell.trade { grid-template-columns:280px minmax(760px,1fr) 405px; }
.axw-left, .axw-main, .axw-right { min-height:0; display:flex; flex-direction:column; gap:8px; }
.axw-left { overflow-y:auto; padding-right:3px; scrollbar-width:thin; scrollbar-color:rgba(63,208,255,.28) transparent; }
.axw-right { display:grid; grid-template-rows:auto minmax(260px,1fr) minmax(86px,auto); overflow:hidden; }
.axw-left::-webkit-scrollbar { width:4px; }
.axw-left::-webkit-scrollbar-thumb { background:rgba(63,208,255,.25); border-radius:999px; }
.axw-card { border:1px solid rgba(52,147,196,.16); background:rgba(3,16,27,.86); border-radius:6px; min-width:0; box-shadow:none; }
.axw-card-title { color:#31caff; font-size:9px; font-weight:900; letter-spacing:.085em; text-transform:uppercase; padding:10px 12px 7px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
.axw-card-title span { color:#7f94aa; letter-spacing:.02em; text-transform:none; font-weight:700; }
.axw-card-title button { background:transparent; border:0; color:#8da9bd; font-size:17px; cursor:pointer; }
.axw-watch { flex:1 1 auto; min-height:260px; padding-bottom:6px; }
.axw-shell.account .axw-watch > button:nth-of-type(n+7) { display:none; }
.axw-watch-head { display:grid; grid-template-columns:1fr 70px 54px; color:#71869c; font-size:8px; letter-spacing:.08em; text-transform:uppercase; padding:0 14px 8px; }
.axw-watch > button { width:100%; display:grid; grid-template-columns:1fr 70px 54px; align-items:center; gap:6px; border:0; border-left:2px solid transparent; background:transparent; color:#d8e8f2; padding:7px 12px; text-align:left; cursor:pointer; font-size:11px; }
.axw-watch > button.on { background:rgba(26,145,230,.16); border-left-color:#18aaff; }
.axw-watch > button.stale { opacity:.72; }
.axw-watch b { display:block; font-size:12px; }
.axw-watch b em { display:block; color:#70869b; font-style:normal; font-weight:500; font-size:9px; margin-top:1px; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axw-watch span, .axw-watch i { font-family:var(--ax-mono); font-style:normal; text-align:right; }
.axw-mandate { padding:0 12px 12px; }
.axw-mandate label, .axw-ticket label { display:block; color:#71869c; font-size:9px; letter-spacing:.08em; text-transform:uppercase; margin:7px 0 4px; }
.axw-mandate select, .axw-mandate input, .axw-symbol-input, .axw-ticket input, .axw-ticket select { width:100%; background:rgba(5,19,31,.86); border:1px solid rgba(66,126,164,.28); color:#eaf7ff; border-radius:6px; min-height:31px; padding:7px 9px; font-family:var(--ax-sans); font-size:11px; outline:none; }
.axw-inline { display:grid; grid-template-columns:1fr 86px; gap:6px; }
.axw-mandate button, .axw-ticket-actions button, .axw-command { border:1px solid rgba(55,149,207,.32); background:rgba(15,38,58,.75); color:#d7eefc; border-radius:6px; min-height:32px; font-weight:800; font-size:11px; cursor:pointer; }
.axw-mandate > button { width:100%; margin-top:8px; }
.axw-sync { margin-top:11px; border-radius:6px; padding:8px 9px; font-size:10px; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
.axw-sync.ok { color:${POS}; background:rgba(52,211,153,.08); border:1px solid rgba(52,211,153,.25); }
.axw-sync.warn { color:${WARN}; background:rgba(245,167,66,.08); border:1px solid rgba(245,167,66,.25); }
.axw-snapshot { padding-bottom:10px; }
.axw-card-title.gap { margin-top:8px; }
.axw-row { display:flex; justify-content:space-between; gap:12px; padding:4px 12px; color:#91a8ba; font-size:10.5px; }
.axw-row b { color:#f1fbff; font-family:var(--ax-mono); font-weight:700; }
.axw-main { overflow:hidden; display:flex; flex-direction:column; gap:8px; }
.axw-chart-card { flex:1 1 0; min-height:420px; display:flex; flex-direction:column; overflow:hidden; }
.axw-instrument { min-height:58px; display:grid; grid-template-columns:minmax(180px,1fr) auto auto minmax(230px,auto) auto auto; gap:14px; align-items:center; padding:11px 16px; border-bottom:1px solid rgba(84,138,174,.16); }
.axw-instrument b { color:#effbff; font-size:16px; font-family:var(--ax-mono); }
.axw-instrument div span { display:block; color:#8ca5b9; font-size:11px; margin-top:2px; }
.axw-instrument strong { color:#6fd3ff; font-family:var(--ax-mono); font-size:25px; font-weight:600; }
.axw-instrument em { font-style:normal; font-family:var(--ax-mono); font-size:12px; font-weight:800; }
.axw-instrument > span { color:#d8eaf5; font-size:11px; font-family:var(--ax-mono); }
.axw-data-source { color:#79cfff !important; border:1px solid rgba(63,208,255,.22); background:rgba(13,41,63,.48); border-radius:5px; padding:4px 7px; text-transform:uppercase; white-space:nowrap; }
.axw-data-source.warn { color:${WARN} !important; border-color:color-mix(in srgb, ${WARN} 35%, transparent); background:color-mix(in srgb, ${WARN} 9%, transparent); }
.axw-chart-warning { border-bottom:1px solid rgba(245,167,66,.2); background:rgba(245,167,66,.08); color:${WARN}; font-size:10px; font-family:var(--ax-mono); padding:5px 14px; }
.axw-instrument i { color:${POS}; font-style:normal; font-size:10px; font-weight:900; text-transform:uppercase; }
.axw-chart-tools { display:flex; align-items:center; gap:5px; padding:8px 14px; border-bottom:1px solid rgba(84,138,174,.13); }
.axw-chart-tools button { background:rgba(8,24,38,.78); border:1px solid rgba(66,126,164,.25); color:#a8bfd2; border-radius:5px; min-width:34px; min-height:25px; padding:4px 9px; font-size:10px; font-weight:700; cursor:pointer; }
.axw-chart-tools button.on { color:#fff; background:linear-gradient(180deg,#1878d8,#0b4c91); border-color:#189eff; }
.axw-chart-stage { flex:1; min-height:0; display:grid; grid-template-columns:1fr; }
.axw-benchmark { margin-left:auto; display:flex; align-items:center; gap:7px; color:#7e93a8; font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
.axw-benchmark select { min-height:25px; border:1px solid rgba(66,126,164,.25); background:rgba(8,24,38,.78); color:#d7ecfa; border-radius:5px; padding:3px 7px; font-family:var(--ax-mono); font-size:10px; }
.axw-price-canvas { flex:1; width:100%; min-height:300px; display:block; }
.axw-lower { flex:0 0 clamp(220px,30%,285px); min-height:220px; display:grid; grid-template-columns:minmax(620px,1fr) 285px; gap:8px; }
.axw-blotter, .axw-recent { overflow:hidden; }
.axw-table { overflow:auto; padding:0 8px 8px; }
.axw-tr { width:100%; display:grid; grid-template-columns:90px 64px 78px 78px 104px 118px 68px; gap:8px; align-items:center; min-height:28px; border:0; border-bottom:1px solid rgba(74,124,154,.13); background:transparent; color:#dcecf5; font-size:10.5px; text-align:left; }
button.axw-tr { cursor:pointer; }
.axw-tr.on, button.axw-tr:hover { background:rgba(19,102,163,.18); }
.axw-tr.head { min-height:25px; color:#71869c; text-transform:uppercase; letter-spacing:.07em; font-size:8px; font-weight:800; }
.axw-tr b { color:#eaf8ff; font-family:var(--ax-mono); }
.axw-tr span, .axw-tr em { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axw-tr em { font-style:normal; font-family:var(--ax-mono); text-align:right; }
.axw-empty-note { color:#71869c; font-size:10px; padding:8px 12px 4px; border-top:1px solid rgba(74,124,154,.13); }
.axw-fill { display:grid; grid-template-columns:52px 54px 24px 54px 70px; gap:8px; align-items:center; min-height:27px; padding:0 12px; border-bottom:1px solid rgba(74,124,154,.13); color:#b9cfdd; font-size:10.5px; }
.axw-fill b { font-family:var(--ax-mono); color:#e8f7ff; }
.axw-fill em { font-style:normal; font-family:var(--ax-mono); font-weight:900; text-align:center; }
.axw-fill em.buy { color:${POS}; } .axw-fill em.sell { color:${NEG}; }
.axw-ticket { padding:10px 14px; flex:0 0 auto; }
.axw-ticket-head { display:flex; justify-content:space-between; align-items:flex-start; }
.axw-ticket-head span { display:block; color:#71869c; font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
.axw-ticket-head b { display:block; color:#28bfff; font-family:var(--ax-mono); font-size:16px; margin-top:2px; }
.axw-ticket-head em { color:#89a3b7; font-style:normal; font-size:10px; }
.axw-ticket-head i { border:1px solid rgba(245,167,66,.32); background:rgba(245,167,66,.08); color:${WARN}; border-radius:6px; min-width:44px; min-height:24px; display:grid; place-items:center; font-style:normal; font-size:9px; font-weight:900; letter-spacing:.08em; }
.axw-quote-line { display:grid; grid-template-columns:auto 1fr auto; gap:9px; align-items:baseline; margin:8px 0 6px; }
.axw-quote-line strong { color:#3ecaff; font-family:var(--ax-mono); font-size:24px; font-weight:600; }
.axw-quote-line em { font-style:normal; font-family:var(--ax-mono); font-weight:800; }
.axw-quote-line i { justify-self:end; color:${POS}; font-style:normal; font-size:10px; font-weight:900; }
.axw-bidask { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding-bottom:8px; border-bottom:1px solid rgba(84,138,174,.15); }
.axw-bidask span { color:#71869c; font-size:9px; }
.axw-bidask b { display:block; font-family:var(--ax-mono); font-size:15px; margin-top:2px; }
.axw-bidask div:first-child b { color:#36c2ff; } .axw-bidask div:nth-child(2) b { color:#ff5368; }
.axw-side-tabs, .axw-order-tabs, .axw-size-tabs { display:grid; grid-template-columns:repeat(4,1fr); gap:0; border:1px solid rgba(66,126,164,.28); border-radius:6px; overflow:hidden; margin:7px 0; }
.axw-order-tabs { grid-template-columns:repeat(2,1fr); }
.axw-size-tabs { grid-template-columns:repeat(2,1fr); margin-top:0; }
.axw-side-tabs button, .axw-order-tabs button, .axw-size-tabs button { background:rgba(5,19,31,.82); color:#bcd1df; border:0; border-right:1px solid rgba(66,126,164,.22); min-height:28px; font-size:10px; font-weight:900; cursor:pointer; }
.axw-side-tabs button:last-child, .axw-order-tabs button:last-child, .axw-size-tabs button:last-child { border-right:0; }
.axw-size-presets { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin:6px 0 2px; }
.axw-size-presets button { min-height:24px; border:1px solid rgba(66,126,164,.22); background:rgba(7,24,38,.72); color:#9bb7ca; border-radius:5px; font-family:var(--ax-mono); font-size:9px; font-weight:800; cursor:pointer; }
.axw-size-presets button:hover { color:#e8f7ff; border-color:rgba(63,208,255,.36); }
.axw-side-tabs button.on.buy, .axw-side-tabs button.on.cover, .axw-ticket-actions button.buy { background:linear-gradient(90deg,#098e64,#17e78e); color:white; }
.axw-side-tabs button.on.sell, .axw-side-tabs button.on.short, .axw-ticket-actions button.sell { background:linear-gradient(90deg,#8e1830,#ff465d); color:white; }
.axw-order-tabs button.on, .axw-size-tabs button.on { color:#4ccaff; box-shadow:inset 0 -2px 0 #159fff; }
.axw-ticket-rows { margin:7px 0; border-top:1px solid rgba(84,138,174,.15); border-bottom:1px solid rgba(84,138,174,.15); padding:3px 0; }
.axw-ticket-rows .axw-row { padding:2px 0; font-size:10px; }
.axw-position-note { display:flex; justify-content:space-between; gap:10px; color:#8fa8ba; font-size:10px; margin:0 0 7px; }
.axw-position-note b { color:#effbff; font-family:var(--ax-mono); }
.axw-ticket-actions { display:grid; grid-template-columns:1fr 1.35fr; gap:8px; }
.axw-ticket-actions button:disabled { opacity:.45; cursor:not-allowed; }
.axw-order-msg { margin-top:9px; color:#cfefff; background:rgba(28,115,170,.15); border:1px solid rgba(63,208,255,.2); border-radius:6px; padding:8px; font-size:11px; }
.axw-depth, .axw-open { min-height:0; overflow:hidden; }
.axw-depth-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:0 14px 7px; color:#8ea9ba; font-family:var(--ax-mono); font-size:9.5px; border-bottom:1px solid rgba(84,138,174,.12); }
.axw-depth-summary span:nth-child(2) { text-align:center; color:#e8f7ff; }
.axw-depth-summary span:last-child { text-align:right; }
.axw-depth-status { display:flex; flex-direction:column; gap:4px; padding:8px 14px 7px; }
.axw-depth-status .axw-row { min-height:23px; }
.axw-depth-head, .axw-depth-row { display:grid; grid-template-columns:48px 1fr 1fr 1fr 1fr 48px; gap:8px; padding:6px 14px; font-family:var(--ax-mono); font-size:10.5px; align-items:center; }
.axw-depth-head { color:#71869c; font-size:8px; text-transform:uppercase; letter-spacing:.08em; }
.axw-depth-row span { color:#79cfff; text-align:right; }
.axw-depth-row b { color:${POS}; text-align:right; }
.axw-depth-row em { color:${NEG}; font-style:normal; text-align:right; }
.axw-depth-row i { color:#8da4b6; font-style:normal; font-size:9px; }
.axw-spread { margin:8px 14px 12px; border-top:1px solid rgba(84,138,174,.15); padding-top:8px; color:#91a8ba; font-size:11px; }
.axw-open { padding-bottom:10px; }
.axw-open-row { display:grid; grid-template-columns:64px 62px 1fr; gap:8px; padding:6px 14px; border-bottom:1px solid rgba(74,124,154,.13); font-size:11px; align-items:center; }
.axw-open-row b { color:#e8f7ff; font-family:var(--ax-mono); }
.axw-open-row span.buy { color:${POS}; } .axw-open-row span.sell { color:${NEG}; }
.axw-open-row em { color:#8ea5b7; font-style:normal; text-align:right; }
.axp-account-head { display:flex; justify-content:space-between; align-items:center; gap:16px; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px 16px; }
.axp-account-name { font-family:var(--ax-disp); font-weight:900; font-size:16px; letter-spacing:.06em; color:var(--ax-tx); }
.axp-account-sub { margin-top:4px; color:var(--ax-mut); font-size:11px; }
.axp-select, .axp-action-box input, .axp-action-box select { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-tx); border-radius:8px; padding:7px 9px; font-family:var(--ax-sans); font-size:11px; min-width:0; outline:none; }
.axp-select { min-width:180px; }
.axp-truth { border:1px solid var(--ax-bdsoft); border-radius:8px; padding:7px 10px; font-size:9px; font-weight:900; letter-spacing:.08em; white-space:nowrap; }
.axp-truth.ok { color:${POS}; border-color:color-mix(in srgb, ${POS} 45%, transparent); background:color-mix(in srgb, ${POS} 9%, transparent); }
.axp-truth.warn { color:${WARN}; border-color:color-mix(in srgb, ${WARN} 45%, transparent); background:color-mix(in srgb, ${WARN} 9%, transparent); }
.axp-action-row { display:flex; gap:10px; flex-wrap:wrap; }
.axp-action-row.inline { margin-bottom:10px; }
.axp-action-box { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:12px; padding:10px; display:grid; grid-template-columns:auto minmax(120px,1fr) minmax(100px,.7fr) auto; gap:8px; align-items:center; min-width:min(100%,500px); }
.axp-action-box.grow { flex:1; grid-template-columns:auto 90px 70px 90px 100px auto; }
.axp-action-box span { color:var(--ax-cydim); font-size:8.5px; font-weight:900; letter-spacing:.09em; white-space:nowrap; }
.axp-action-box button { background:var(--ax-acc); border:0; color:#041217; border-radius:8px; padding:8px 11px; font-size:11px; font-weight:900; cursor:pointer; }
.axp-account-kpis { grid-template-columns:repeat(4,minmax(0,1fr)); }
.axp-kpi i { display:block; color:var(--ax-dim); font-style:normal; font-size:9px; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axp-rec { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.axp-rec div { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:8px 10px; display:flex; justify-content:space-between; gap:10px; }
.axp-rec span { color:var(--ax-mut); font-size:10.5px; }
.axp-rec b { font-family:var(--ax-mono); font-size:11.5px; color:var(--ax-tx); }
.axp-status-list { display:flex; flex-direction:column; gap:8px; }
.axp-status { border:1px solid var(--ax-bdsoft); border-radius:9px; background:var(--ax-elev); padding:9px 10px; display:flex; justify-content:space-between; gap:12px; align-items:center; }
.axp-status b { font-size:11px; color:var(--ax-tx); }
.axp-status span { color:var(--ax-mut); font-size:10px; text-align:right; }
.axp-status.ok b { color:${POS}; }
.axp-status.warn b { color:${WARN}; }
.axp-pos-table { display:flex; flex-direction:column; gap:0; overflow-x:auto; }
.axp-pos-row { display:grid; grid-template-columns:72px 64px 70px 86px 86px 96px 130px 86px 132px; gap:10px; align-items:center; border-bottom:1px solid var(--ax-hair); padding:8px 4px; min-width:850px; font-size:11px; }
.axp-pos-row.head { color:var(--ax-dim); font-size:8.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; border-bottom:1px solid var(--ax-bdsoft); }
.axp-pos-row .mono { font-family:var(--ax-mono); }
.axp-pos-row .strong { color:var(--ax-tx); font-weight:900; }
.axp-pos-row .pos, .axp-pos-row .ok { color:${POS}; font-weight:800; }
.axp-pos-row .neg { color:${NEG}; font-weight:800; }
.axp-pos-row .warn { color:${WARN}; font-weight:800; }
.axp-pos-row em { font-style:normal; color:var(--ax-dim); font-size:9px; }
.axp-placeholder p { max-width:780px; color:var(--ax-mut); font-size:12px; line-height:1.55; margin:0 0 14px; }
.axp-placeholder-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
.axp-order-list, .axp-attr-list { display:flex; flex-direction:column; gap:7px; }
.axp-order { display:grid; grid-template-columns:70px 70px 80px 70px 90px 80px 1fr; gap:9px; align-items:center; border-bottom:1px solid var(--ax-hair); padding:8px 2px; font-size:11px; }
.axp-order b, .axp-attr b { color:var(--ax-tx); font-family:var(--ax-mono); }
.axp-order span, .axp-attr span { color:var(--ax-mut); }
.axp-order em, .axp-attr em { color:var(--ax-dim); font-style:normal; text-align:right; }
.axp-order .pos, .axp-attr .pos { color:${POS}; font-weight:800; }
.axp-order .neg, .axp-attr .neg { color:${NEG}; font-weight:800; }
.axp-warnline { background:color-mix(in srgb, ${WARN} 10%, transparent); border:1px solid color-mix(in srgb, ${WARN} 34%, transparent); color:${WARN}; border-radius:9px; padding:8px 10px; font-size:11px; }
.axp-attr { display:grid; grid-template-columns:80px 1fr 70px 100px; gap:10px; align-items:center; border-bottom:1px solid var(--ax-hair); padding:8px 2px; font-size:11px; }
.axp-attr-list.owners .axp-attr { grid-template-columns:1fr 120px 120px; }
.axp-bars { display:flex; flex-direction:column; gap:9px; }
.axp-bar-row { display:grid; grid-template-columns:minmax(120px,1fr) minmax(90px,1.2fr) 54px; gap:10px; align-items:center; font-size:11px; }
.axp-bar-row b { display:block; color:var(--ax-tx); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-bar-row span { display:block; color:var(--ax-dim); font-size:9px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-bar-row em { color:var(--ax-mut); font-style:normal; font-family:var(--ax-mono); text-align:right; }
.axp-bar { height:7px; border:1px solid var(--ax-bdsoft); border-radius:8px; background:var(--ax-surface); overflow:hidden; }
.axp-bar i { display:block; height:100%; border-radius:8px; background:linear-gradient(90deg, ${CY}, ${PUR}); box-shadow:0 0 12px rgba(63,208,255,.22); }
.axp-breach-list, .axp-scenarios { display:flex; flex-direction:column; gap:8px; }
.axp-breach, .axp-scenario { border:1px solid var(--ax-bdsoft); border-radius:9px; background:var(--ax-elev); padding:9px 10px; display:grid; grid-template-columns:100px 1fr auto; gap:10px; align-items:center; font-size:11px; }
.axp-breach.high { border-color:color-mix(in srgb, ${NEG} 42%, transparent); }
.axp-breach b, .axp-scenario b { color:var(--ax-tx); font-family:var(--ax-mono); }
.axp-breach span, .axp-scenario span { color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-breach em, .axp-scenario em { color:var(--ax-dim); font-style:normal; font-family:var(--ax-mono); text-align:right; white-space:nowrap; }
.axp-risk-table { display:flex; flex-direction:column; overflow-x:auto; }
.axp-risk-row { display:grid; grid-template-columns:80px 1fr 90px 90px 80px 120px; gap:10px; align-items:center; border-bottom:1px solid var(--ax-hair); padding:8px 2px; min-width:720px; font-size:11px; }
.axp-risk-row.head { color:var(--ax-dim); font-size:8.5px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; border-bottom:1px solid var(--ax-bdsoft); }
.axp-risk-row b { color:var(--ax-tx); font-family:var(--ax-mono); }
.axp-risk-row span { color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-command { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-tx); border-radius:8px; padding:8px 11px; font-size:11px; font-weight:900; cursor:pointer; }
.axp-command:hover { border-color:var(--ax-bdglow); color:var(--ax-acc); }
.axp-proposal-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-bottom:10px; }
.axp-object-card { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:10px; min-width:0; }
.axp-object-card > b { display:block; color:var(--ax-cydim); font-size:8.5px; letter-spacing:.09em; margin-bottom:8px; }
.axp-object-card div { display:flex; justify-content:space-between; gap:10px; border-bottom:1px solid var(--ax-hair); padding:5px 0; font-size:10.5px; }
.axp-object-card div:last-child { border-bottom:0; }
.axp-object-card span { color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-object-card em { color:var(--ax-tx); font-style:normal; font-family:var(--ax-mono); text-align:right; white-space:nowrap; }

/* Regime */
.axp-regime { display:flex; align-items:center; gap:20px; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px 18px; flex-wrap:wrap; }
.axp-reg-gauge { display:flex; align-items:center; gap:12px; min-width:220px; }
.axp-reg-arc { flex:1; height:8px; border-radius:5px; background:var(--ax-surface); overflow:hidden; border:1px solid var(--ax-bdsoft); }
.axp-reg-fill { height:100%; border-radius:5px; transition:width .5s; }
.axp-reg-score { font-family:var(--ax-mono); font-size:20px; font-weight:800; }
.axp-reg-score span { font-size:11px; color:var(--ax-dim); font-weight:500; }
.axp-reg-label { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.08em; }
.axp-reg-stats { margin-left:auto; display:flex; gap:10px; flex-wrap:wrap; }
.axp-reg-chip { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:6px 11px; display:flex; flex-direction:column; gap:2px; }
.axp-rc-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); }
.axp-rc-v { font-size:12.5px; font-weight:700; font-family:var(--ax-mono); color:var(--ax-tx); }

/* Correlation heatmap */
.axp-heat-wrap { overflow-x:auto; }
.axp-heat { display:grid; gap:2px; min-width:520px; }
.axp-hc { font-family:var(--ax-mono); font-size:8.5px; color:var(--ax-mut); display:flex; align-items:center; justify-content:center; }
.axp-htop { writing-mode:vertical-rl; transform:rotate(180deg); height:34px; padding-bottom:2px; }
.axp-hleft { justify-content:flex-end; padding-right:5px; }
.axp-cell { aspect-ratio:1; min-height:20px; border-radius:3px; display:flex; align-items:center; justify-content:center; font-family:var(--ax-mono); font-size:8px; color:rgba(235,244,255,.82); }

/* Sector heatmap */
.axp-sectors { display:grid; grid-template-columns:repeat(auto-fill,minmax(96px,1fr)); gap:8px; }
.axp-sec { border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 10px; }
.axp-sec-name { font-size:10.5px; font-weight:600; color:var(--ax-tx); line-height:1.25; }
.axp-sec-etf { font-family:var(--ax-mono); font-size:8.5px; color:var(--ax-dim); margin:2px 0 6px; }
.axp-sec-chg { font-family:var(--ax-mono); font-size:14px; font-weight:700; }

/* Anomalies */
.axp-anom { display:flex; flex-direction:column; gap:7px; }
.axp-arow { display:grid; grid-template-columns:46px 62px 1fr 52px; align-items:center; gap:9px; }
.axp-a-sym { font-family:var(--ax-mono); font-size:11.5px; font-weight:700; color:var(--ax-tx); }
.axp-a-chg { font-family:var(--ax-mono); font-size:11px; text-align:right; }
.axp-a-bar { height:7px; border-radius:4px; background:var(--ax-surface); overflow:hidden; border:1px solid var(--ax-bdsoft); }
.axp-a-fill { height:100%; border-radius:4px; }
.axp-a-z { font-family:var(--ax-mono); font-size:10.5px; text-align:right; }
.axp-macro-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }
.axp-kpi-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.axp-kpi { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 10px; min-width:0; }
.axp-kpi span { display:block; font-size:8px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axp-kpi b { display:block; font-family:var(--ax-mono); font-size:15px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.axp-macro-list, .axp-cot-list { display:flex; flex-direction:column; gap:7px; }
.axp-mrow, .axp-cot { display:flex; justify-content:space-between; align-items:center; gap:12px; border-bottom:1px solid var(--ax-bdsoft); padding-bottom:7px; min-width:0; }
.axp-mrow:last-child, .axp-cot:last-child { border-bottom:0; padding-bottom:0; }
.axp-mrow span, .axp-cot span { color:var(--ax-mut); font-size:10.5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axp-mrow b, .axp-cot b { font-family:var(--ax-mono); font-size:11.5px; color:var(--ax-tx); white-space:nowrap; }
.axp-mrow i { color:var(--ax-dim); font-style:normal; font-weight:500; }

@media (max-width:1100px) { .axp-macro-grid { grid-template-columns:1fr 1fr; } }
@media (max-width:900px) { .axp-grid, .axp-macro-grid { grid-template-columns:1fr; } }
`;
