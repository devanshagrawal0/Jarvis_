import { useCallback, useEffect, useRef, useState } from "react";
import { fetchQuote, type Quote } from "../apex-data";

// APEX · Paper Trading — a fully virtual trading desk. Orders fill in simulation
// against live public quotes with slippage + commission; positions, journal, and
// equity curve persist in the local paper account. PAPER TRADE ONLY — this room
// never touches a live broker. Styled with the shared Apex theme vars (--ax-*).

const POS = "#34d399", NEG = "#f4556b", CY = "#3fd0ff", WARN = "#f5a742", MUT = "rgba(150,190,225,.5)";

type Account = {
  equity: number; cash: number; buyingPower: number; marketValue: number;
  unrealized: number; realized: number; totalPnl: number; totalPnlPct: number;
  dayPnl: number; dayPnlPct: number; startCash: number; openPositions: number;
  tradeCount: number; winRate: number | null; avgWin: number | null; avgLoss: number | null;
};
type Position = { ticker: string; qty: number; side: string; avgPrice: number; last: number; marketValue: number; unrealized: number; unrealizedPct: number };
type Order = { id: string; ticker: string; side: string; type: string; qty: number; price: number | null; status: string; createdAt: string; filledAt: string | null };
type Fill = { id: string; ticker: string; qty: number; side: string; price: number; ts: string };

const money = (n: number | null | undefined, dp = 2) => n == null ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (n: number | null | undefined) => n == null ? "—" : (n >= 0 ? "+" : "−") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctS = (n: number | null | undefined) => n == null ? "" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const col = (n: number | null | undefined) => (n == null || n === 0) ? "var(--ax-tx)" : n > 0 ? POS : NEG;

export function PaperTradingView() {
  const [acct, setAcct] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<{ open: Order[]; recent: Order[] }>({ open: [], recent: [] });
  const [journal, setJournal] = useState<{ fills: Fill[] }>({ fills: [] });
  const [curve, setCurve] = useState<{ ts: string; equity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "fills">("open");

  // Order ticket
  const [sym, setSym] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("10");
  const [otype, setOtype] = useState<"market" | "limit">("market");
  const [limit, setLimit] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [a, o, j, e] = await Promise.all([
      fetch("/api/apex/paper/account").then((r) => r.json()).catch(() => null),
      fetch("/api/apex/paper/orders").then((r) => r.json()).catch(() => null),
      fetch("/api/apex/paper/journal").then((r) => r.json()).catch(() => null),
      fetch("/api/apex/paper/equity").then((r) => r.json()).catch(() => null),
    ]);
    if (a?.account) { setAcct(a.account); setPositions(a.positions || []); }
    if (o) setOrders({ open: o.open || [], recent: o.recent || [] });
    if (j) setJournal({ fills: j.fills || [] });
    if (e?.curve) setCurve(e.curve);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 4500); return () => clearInterval(t); }, [refresh]);

  // Live quote preview for the ticket
  useEffect(() => {
    const s = sym.trim().toUpperCase();
    if (!s) { setQuote(null); return; }
    let dead = false; setQuoteBusy(true);
    const t = setTimeout(() => {
      fetchQuote(s).then((q) => { if (!dead) setQuote(q); }).finally(() => { if (!dead) setQuoteBusy(false); });
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [sym]);

  const estPrice = otype === "limit" ? Number(limit) || quote?.last || 0 : quote?.last || 0;
  const estValue = estPrice * (Number(qty) || 0);

  const place = async () => {
    setMsg(null); setPlacing(true);
    try {
      const body: any = { ticker: sym.trim().toUpperCase(), side, qty: Number(qty), type: otype };
      if (otype === "limit") body.limitPrice = Number(limit);
      const r = await fetch("/api/apex/paper/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Order rejected");
      if (d.status === "filled") setMsg({ kind: "ok", text: `${side.toUpperCase()} ${qty} ${body.ticker} filled @ ${money(d.fillPrice)}` });
      else setMsg({ kind: "ok", text: `Limit ${side.toUpperCase()} ${qty} ${body.ticker} @ ${money(d.limitPrice)} — resting (last ${money(d.last)})` });
      refresh();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    finally { setPlacing(false); }
  };

  const cancel = async (id: string) => {
    await fetch("/api/apex/paper/order/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: id }) }).catch(() => {});
    refresh();
  };
  const reset = async () => {
    if (!confirm("Reset the paper account to its starting balance? This clears all positions, orders, and history.")) return;
    await fetch("/api/apex/paper/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    setMsg(null); refresh();
  };

  const canPlace = sym.trim() && Number(qty) > 0 && (otype === "market" || Number(limit) > 0) && !placing;

  return (
    <div className="ax-paper">
      <style>{PAPER_CSS}</style>

      <div className="axpt-head">
        <span className="axpt-title">▨ PAPER TRADING</span>
        <span className="axpt-badge">PAPER · VIRTUAL</span>
        <span className="axpt-sub">Simulated fills vs live quotes · slippage + commission · no live broker</span>
        <button className="axpt-reset" onClick={reset} title="Reset paper account">↺ Reset</button>
      </div>

      {/* Account KPIs */}
      <div className="axpt-kpis">
        {kpi("EQUITY", money(acct?.equity), "var(--ax-tx)")}
        {kpi("DAY P&L", signed(acct?.dayPnl), col(acct?.dayPnl), pctS(acct?.dayPnlPct))}
        {kpi("TOTAL P&L", signed(acct?.totalPnl), col(acct?.totalPnl), pctS(acct?.totalPnlPct))}
        {kpi("BUYING POWER", money(acct?.buyingPower), CY)}
        {kpi("UNREALIZED", signed(acct?.unrealized), col(acct?.unrealized))}
        {kpi("REALIZED", signed(acct?.realized), col(acct?.realized))}
        {kpi("WIN RATE", acct?.winRate == null ? "—" : `${acct.winRate}%`, acct?.winRate == null ? "var(--ax-mut)" : acct.winRate >= 50 ? POS : WARN, acct ? `${acct.tradeCount} trades` : "")}
      </div>

      <div className="axpt-body">
        {/* Order ticket */}
        <div className="axpt-ticket">
          <div className="axpt-sec-h">ORDER TICKET</div>
          <input className="axpt-sym" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SYMBOL" spellCheck={false} maxLength={6} />
          <div className="axpt-quote">
            {quoteBusy && !quote ? <span className="axpt-q-mut">Fetching quote…</span> :
              quote && quote.last != null ? (
                <>
                  <span className="axpt-q-last">{money(quote.last)}</span>
                  <span className="axpt-q-chg" style={{ color: col(quote.changePct) }}>{pctS(quote.changePct)}</span>
                  {quote.name && <span className="axpt-q-name">{quote.name}</span>}
                </>
              ) : sym.trim() ? <span className="axpt-q-mut">No quote — check the symbol</span> : <span className="axpt-q-mut">Enter a symbol</span>}
          </div>

          <div className="axpt-seg">
            <button className={`axpt-seg-b buy${side === "buy" ? " on" : ""}`} onClick={() => setSide("buy")}>BUY</button>
            <button className={`axpt-seg-b sell${side === "sell" ? " on" : ""}`} onClick={() => setSide("sell")}>SELL</button>
          </div>

          <label className="axpt-lbl">QUANTITY</label>
          <input className="axpt-in" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" />

          <div className="axpt-seg small">
            <button className={`axpt-seg-b${otype === "market" ? " on" : ""}`} onClick={() => setOtype("market")}>MARKET</button>
            <button className={`axpt-seg-b${otype === "limit" ? " on" : ""}`} onClick={() => setOtype("limit")}>LIMIT</button>
          </div>
          {otype === "limit" && (
            <>
              <label className="axpt-lbl">LIMIT PRICE</label>
              <input className="axpt-in" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.00" />
            </>
          )}

          <div className="axpt-est">
            <span>Est. {side === "buy" ? "cost" : "proceeds"}</span>
            <span className="axpt-est-v">{estValue ? money(estValue) : "—"}</span>
          </div>

          <button className={`axpt-place ${side}`} disabled={!canPlace} onClick={place}>
            {placing ? "Placing…" : `${side === "buy" ? "Buy" : "Sell"} ${qty || 0} ${sym.trim() || "—"}`}
          </button>
          {msg && <div className={`axpt-msg ${msg.kind}`}>{msg.text}</div>}
          <div className="axpt-note">Paper account · $100k start · fills carry ~0.03% slippage + 0.01% commission.</div>
        </div>

        {/* Main: equity curve + positions + blotter */}
        <div className="axpt-main">
          <div className="axpt-panel axpt-equity">
            <div className="axpt-sec-h">EQUITY CURVE <span>paper account</span></div>
            {curve.length > 1 ? <EquityChart curve={curve} start={acct?.startCash} /> : <div className="axpt-empty-mini">Equity curve builds as you trade.</div>}
          </div>

          <div className="axpt-panel">
            <div className="axpt-sec-h">POSITIONS <span>{positions.length} open</span></div>
            {positions.length === 0 ? <div className="axpt-empty-mini">No open positions.</div> : (
              <div className="axpt-table">
                <div className="axpt-tr axpt-th"><span>SYMBOL</span><span>SIDE</span><span className="r">QTY</span><span className="r">AVG</span><span className="r">LAST</span><span className="r">MKT VALUE</span><span className="r">UNREAL P&L</span></div>
                {positions.map((p) => (
                  <div key={p.ticker} className="axpt-tr" onClick={() => { setSym(p.ticker); setSide(p.qty > 0 ? "sell" : "buy"); setQty(String(Math.abs(p.qty))); }} title="Click to load a closing order">
                    <span className="axpt-sym-c">{p.ticker}</span>
                    <span className={`axpt-side ${p.side}`}>{p.side.toUpperCase()}</span>
                    <span className="r mono">{Math.abs(p.qty)}</span>
                    <span className="r mono">{money(p.avgPrice)}</span>
                    <span className="r mono">{money(p.last)}</span>
                    <span className="r mono">{money(Math.abs(p.marketValue))}</span>
                    <span className="r mono" style={{ color: col(p.unrealized) }}>{signed(p.unrealized)} <em>{pctS(p.unrealizedPct)}</em></span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="axpt-panel">
            <div className="axpt-sec-h axpt-tabs">
              <button className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>OPEN ORDERS <b>{orders.open.length}</b></button>
              <button className={tab === "fills" ? "on" : ""} onClick={() => setTab("fills")}>JOURNAL <b>{journal.fills.length}</b></button>
            </div>
            {tab === "open" ? (
              orders.open.length === 0 ? <div className="axpt-empty-mini">No resting orders.</div> : (
                <div className="axpt-table">
                  <div className="axpt-tr axpt-to axpt-th"><span>SYMBOL</span><span>SIDE</span><span>TYPE</span><span className="r">QTY</span><span className="r">LIMIT</span><span className="r"></span></div>
                  {orders.open.map((o) => (
                    <div key={o.id} className="axpt-tr axpt-to">
                      <span className="axpt-sym-c">{o.ticker}</span>
                      <span className={`axpt-side ${o.side}`}>{o.side.toUpperCase()}</span>
                      <span className="mono dim">{o.type}</span>
                      <span className="r mono">{o.qty}</span>
                      <span className="r mono">{money(o.price)}</span>
                      <span className="r"><button className="axpt-cancel" onClick={() => cancel(o.id)}>Cancel</button></span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              journal.fills.length === 0 ? <div className="axpt-empty-mini">No fills yet.</div> : (
                <div className="axpt-table">
                  <div className="axpt-tr axpt-tf axpt-th"><span>TIME</span><span>SYMBOL</span><span>SIDE</span><span className="r">QTY</span><span className="r">PRICE</span></div>
                  {journal.fills.map((f) => (
                    <div key={f.id} className="axpt-tr axpt-tf">
                      <span className="dim mono">{new Date(f.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      <span className="axpt-sym-c">{f.ticker}</span>
                      <span className={`axpt-side ${f.side}`}>{f.side.toUpperCase()}</span>
                      <span className="r mono">{Math.abs(f.qty)}</span>
                      <span className="r mono">{money(f.price)}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {loading && !acct && <div className="axpt-loading">Loading paper desk…</div>}
    </div>
  );
}

function kpi(label: string, value: string, color: string, sub?: string) {
  return (
    <div className="axpt-kpi">
      <div className="axpt-kpi-l">{label}</div>
      <div className="axpt-kpi-v" style={{ color }}>{value}</div>
      {sub ? <div className="axpt-kpi-s">{sub}</div> : null}
    </div>
  );
}

function EquityChart({ curve, start }: { curve: { ts: string; equity: number }[]; start?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const pts = curve.map((p) => p.equity).filter((v) => Number.isFinite(v));
      if (pts.length < 2) return;
      const base = start ?? pts[0];
      const lo = Math.min(base, ...pts), hi = Math.max(base, ...pts), rg = hi - lo || 1;
      const X = (i: number) => (i / (pts.length - 1)) * (w - 10) + 5;
      const Y = (v: number) => h - 10 - ((v - lo) / rg) * (h - 20);
      // start baseline
      ctx.strokeStyle = "rgba(150,190,225,.2)"; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(5, Y(base)); ctx.lineTo(w - 5, Y(base)); ctx.stroke(); ctx.setLineDash([]);
      const up = pts[pts.length - 1] >= base;
      const c = up ? POS : NEG;
      ctx.beginPath(); ctx.moveTo(X(0), h); pts.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(pts.length - 1), h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c + "33"); g.addColorStop(1, c + "00"); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.strokeStyle = c; ctx.lineWidth = 1.8; ctx.shadowColor = c; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 3, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [curve, start]);
  return <canvas ref={ref} className="axpt-canvas" style={{ height: 130 }} />;
}

const PAPER_CSS = `
.ax-paper { height:100%; display:flex; flex-direction:column; gap:13px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axpt-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axpt-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axpt-badge { font-size:9px; font-weight:800; letter-spacing:.1em; color:var(--ax-warn); border:1px solid color-mix(in srgb, var(--ax-warn) 45%, transparent); background:color-mix(in srgb, var(--ax-warn) 12%, transparent); border-radius:6px; padding:3px 8px; }
.axpt-sub { font-size:11px; color:var(--ax-mut); }
.axpt-reset { margin-left:auto; background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:8px; padding:6px 12px; font-size:11px; cursor:pointer; font-family:var(--ax-sans); }
.axpt-reset:hover { border-color:var(--ax-neg); color:var(--ax-neg); }
.axpt-kpis { display:grid; grid-template-columns:repeat(7,1fr); gap:9px; }
.axpt-kpi { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:9px 12px; }
.axpt-kpi-l { font-size:8px; letter-spacing:.09em; color:var(--ax-dim); margin-bottom:4px; }
.axpt-kpi-v { font-size:16px; font-weight:700; font-family:var(--ax-mono); }
.axpt-kpi-s { font-size:8.5px; color:var(--ax-mut); margin-top:2px; }
.axpt-body { flex:1; min-height:0; display:grid; grid-template-columns:262px 1fr; gap:13px; }

/* Ticket */
.axpt-ticket { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px; display:flex; flex-direction:column; gap:9px; align-self:start; }
.axpt-sec-h { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); display:flex; justify-content:space-between; align-items:baseline; }
.axpt-sec-h span { font-weight:500; color:var(--ax-dim); text-transform:none; letter-spacing:.02em; }
.axpt-sym { background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:9px; padding:11px 13px; color:var(--ax-tx); font-size:17px; font-weight:700; font-family:var(--ax-mono); letter-spacing:.08em; outline:none; text-transform:uppercase; }
.axpt-sym:focus { border-color:var(--ax-bdglow); }
.axpt-quote { display:flex; align-items:baseline; gap:8px; min-height:20px; font-size:12px; flex-wrap:wrap; }
.axpt-q-last { font-family:var(--ax-mono); font-size:15px; font-weight:700; color:var(--ax-tx); }
.axpt-q-chg { font-family:var(--ax-mono); font-size:11px; }
.axpt-q-name { font-size:10px; color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axpt-q-mut { font-size:11px; color:var(--ax-dim); }
.axpt-seg { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.axpt-seg.small .axpt-seg-b { padding:7px; font-size:10px; }
.axpt-seg-b { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:8px; padding:9px; font-size:11.5px; font-weight:700; letter-spacing:.06em; cursor:pointer; font-family:var(--ax-sans); }
.axpt-seg-b.on { border-color:var(--ax-bdglow); background:var(--ax-panelhi); color:var(--ax-tx); }
.axpt-seg-b.buy.on { border-color:${POS}; color:${POS}; background:color-mix(in srgb, ${POS} 12%, transparent); }
.axpt-seg-b.sell.on { border-color:${NEG}; color:${NEG}; background:color-mix(in srgb, ${NEG} 12%, transparent); }
.axpt-lbl { font-size:8.5px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:-4px; }
.axpt-in { background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:8px; padding:9px 12px; color:var(--ax-tx); font-size:14px; font-family:var(--ax-mono); outline:none; }
.axpt-in:focus { border-color:var(--ax-bdglow); }
.axpt-est { display:flex; justify-content:space-between; align-items:baseline; font-size:11px; color:var(--ax-mut); padding:3px 1px; }
.axpt-est-v { font-family:var(--ax-mono); font-size:13px; font-weight:600; color:var(--ax-tx); }
.axpt-place { border:none; border-radius:9px; padding:12px; font-size:13px; font-weight:700; cursor:pointer; font-family:var(--ax-sans); letter-spacing:.03em; color:#04120b; }
.axpt-place.buy { background:${POS}; }
.axpt-place.sell { background:${NEG}; color:#1a0508; }
.axpt-place:disabled { opacity:.4; cursor:not-allowed; }
.axpt-msg { font-size:11px; border-radius:8px; padding:8px 10px; line-height:1.4; }
.axpt-msg.ok { background:color-mix(in srgb, ${POS} 12%, transparent); color:${POS}; border:1px solid color-mix(in srgb, ${POS} 35%, transparent); }
.axpt-msg.err { background:color-mix(in srgb, ${NEG} 12%, transparent); color:${NEG}; border:1px solid color-mix(in srgb, ${NEG} 35%, transparent); }
.axpt-note { font-size:9px; color:var(--ax-dim); line-height:1.4; }

/* Main */
.axpt-main { min-width:0; display:flex; flex-direction:column; gap:13px; overflow-y:auto; padding-right:4px; }
.axpt-panel { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; }
.axpt-canvas { width:100%; display:block; margin-top:6px; }
.axpt-empty-mini { color:var(--ax-mut); font-size:11px; padding:16px 2px; }
.axpt-table { margin-top:8px; display:flex; flex-direction:column; }
.axpt-tr { display:grid; grid-template-columns:1.1fr .8fr .7fr .8fr .8fr 1fr 1.3fr; gap:8px; padding:8px 6px; align-items:center; border-bottom:1px solid var(--ax-hair); font-size:12px; }
.axpt-tr.axpt-to { grid-template-columns:1.1fr .8fr .8fr .7fr .9fr .8fr; }
.axpt-tr.axpt-tf { grid-template-columns:1fr 1fr .9fr .7fr .9fr; }
.axpt-th { font-size:8.5px; letter-spacing:.07em; color:var(--ax-dim); border-bottom:1px solid var(--ax-bdsoft); }
.axpt-tr:not(.axpt-th):hover { background:color-mix(in srgb, var(--ax-acc) 5%, transparent); cursor:pointer; }
.axpt-tr .r { text-align:right; }
.axpt-tr .mono { font-family:var(--ax-mono); }
.axpt-tr .dim { color:var(--ax-mut); }
.axpt-tr em { font-style:normal; font-size:9.5px; opacity:.75; }
.axpt-sym-c { font-family:var(--ax-mono); font-weight:700; color:var(--ax-tx); }
.axpt-side { font-size:9px; font-weight:700; letter-spacing:.05em; }
.axpt-side.buy, .axpt-side.long { color:${POS}; }
.axpt-side.sell, .axpt-side.short { color:${NEG}; }
.axpt-cancel { background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:6px; padding:3px 9px; font-size:10px; cursor:pointer; font-family:var(--ax-sans); }
.axpt-cancel:hover { border-color:var(--ax-neg); color:var(--ax-neg); }
.axpt-tabs { gap:14px; }
.axpt-tabs button { background:none; border:none; color:var(--ax-dim); font-size:9.5px; font-weight:700; letter-spacing:.1em; cursor:pointer; font-family:var(--ax-sans); padding:0; }
.axpt-tabs button.on { color:var(--ax-cydim); }
.axpt-tabs button b { color:var(--ax-mut); margin-left:3px; }
.axpt-loading { position:absolute; color:var(--ax-mut); font-size:12px; }
@media (max-width:900px) { .axpt-kpis { grid-template-columns:repeat(3,1fr); } .axpt-body { grid-template-columns:1fr; } }
`;
