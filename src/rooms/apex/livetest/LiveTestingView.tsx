import { useCallback, useEffect, useMemo, useState } from "react";
import type { Bot } from "../bots/TradingBotsView";

// APEX · Live Testing — forward-test monitor. Watch deployed bots evaluate
// their rule against live bars in real time: every check, every signal, every
// simulated fill, with the indicator values behind each decision.
// PAPER TRADE ONLY — fills land in the virtual paper account.

const POS = "#34d399", NEG = "#f4556b", CY = "#3fd0ff", WARN = "#f5a742";

type Event = { id: string; botId: string; ts: string; kind: string; note: string; detail: Record<string, number> | null };

const money = (n: number | null | undefined) => n == null ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const col = (n: number | null | undefined) => (n == null || n === 0) ? "var(--ax-tx)" : n > 0 ? POS : NEG;
const KIND_META: Record<string, { col: string; label: string }> = {
  eval: { col: "var(--ax-mut)", label: "CHECK" },
  signal: { col: CY, label: "SIGNAL" },
  fill: { col: POS, label: "FILL" },
  error: { col: NEG, label: "ERROR" },
};
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export function LiveTestingView() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [sel, setSel] = useState<string | "all">("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (botId: string | "all") => {
    const qs = botId === "all" ? "?limit=90" : `?botId=${encodeURIComponent(botId)}&limit=90`;
    const [b, e] = await Promise.all([
      fetch("/api/apex/bots").then((r) => r.json()).catch(() => null),
      fetch(`/api/apex/bots/events${qs}`).then((r) => r.json()).catch(() => null),
    ]);
    if (b?.bots) setBots(b.bots);
    if (e?.events) setEvents(e.events);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh(sel);
    const t = window.setInterval(() => refresh(sel), 5000);
    return () => window.clearInterval(t);
  }, [refresh, sel]);

  const botName = useMemo(() => Object.fromEntries(bots.map((b) => [b.id, b])), [bots]);
  const shown = useMemo(() => events.filter((e) => kindFilter === "all" || e.kind === kindFilter), [events, kindFilter]);

  const running = bots.filter((b) => b.status === "running");
  const totals = bots.reduce((a, b) => ({
    signals: a.signals + b.signals, fills: a.fills + b.fills,
    unreal: a.unreal + (b.position?.unrealized || 0), open: a.open + (b.position ? 1 : 0),
  }), { signals: 0, fills: 0, unreal: 0, open: 0 });

  return (
    <div className="ax-lt">
      <style>{LT_CSS}</style>

      <div className="axlt-head">
        <span className="axlt-title">◉ LIVE TESTING</span>
        <span className="axlt-badge">PAPER · VIRTUAL</span>
        <span className="axlt-sub">Forward-test monitor · live bar evaluation</span>
        <div className="axlt-live">
          <span className={`axlt-dot${running.length ? " on" : ""}`} />
          {running.length ? `${running.length} bot${running.length > 1 ? "s" : ""} running` : "No bots running"}
        </div>
      </div>

      {/* Totals */}
      <div className="axlt-kpis">
        {kpi("DEPLOYED", String(running.length), running.length ? POS : "var(--ax-mut)")}
        {kpi("SIGNALS", String(totals.signals), CY)}
        {kpi("FILLS", String(totals.fills), CY)}
        {kpi("OPEN POSITIONS", String(totals.open), totals.open ? WARN : "var(--ax-mut)")}
        {kpi("UNREALIZED", money(totals.unreal), col(totals.unreal))}
      </div>

      {bots.length === 0 && !loading ? (
        <div className="axlt-empty">No bots exist yet. Build one in <b>Trading Bots</b>, deploy it, and its live evaluations stream here.</div>
      ) : (
        <div className="axlt-body">
          {/* Bot rail */}
          <div className="axlt-rail">
            <div className="axlt-ph">BOTS</div>
            <button className={`axlt-brow${sel === "all" ? " on" : ""}`} onClick={() => setSel("all")}>
              <span className="axlt-b-name">All bots</span>
              <span className="axlt-b-sub">{bots.length} total</span>
            </button>
            {bots.map((b) => (
              <button key={b.id} className={`axlt-brow${sel === b.id ? " on" : ""}`} onClick={() => setSel(b.id)}>
                <span className={`axlt-dot sm${b.status === "running" ? " on" : ""}`} />
                <span className="axlt-b-name">{b.name}</span>
                <span className="axlt-b-sub">{b.ticker} · {b.signals} sig · {b.fills} fill</span>
                {b.position && <span className="axlt-b-pnl" style={{ color: col(b.position.unrealized) }}>{money(b.position.unrealized)}</span>}
              </button>
            ))}
          </div>

          {/* Stream */}
          <div className="axlt-main">
            {sel !== "all" && botName[sel] && <BotDetail b={botName[sel]} />}

            <div className="axlt-panel axlt-stream">
              <div className="axlt-ph">
                <span>ACTIVITY STREAM <em>{sel === "all" ? "all bots" : botName[sel]?.name}</em></span>
                <span className="axlt-kfilter">
                  {["all", "signal", "fill", "error"].map((k) => (
                    <button key={k} className={kindFilter === k ? "on" : ""} onClick={() => setKindFilter(k)}>{k === "all" ? "All" : KIND_META[k].label}</button>
                  ))}
                </span>
              </div>
              {loading ? <div className="axlt-empty-mini">Loading…</div>
                : shown.length === 0 ? <div className="axlt-empty-mini">{kindFilter === "all" ? "No activity yet — deploy a bot and its checks appear here each minute." : `No ${kindFilter} events.`}</div>
                  : (
                    <div className="axlt-events">
                      {shown.map((e) => {
                        const km = KIND_META[e.kind] || KIND_META.eval;
                        return (
                          <div key={e.id} className="axlt-ev">
                            <span className="axlt-ev-t">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
                            <span className="axlt-ev-k" style={{ color: km.col, borderColor: km.col + "55" }}>{km.label}</span>
                            {sel === "all" && <span className="axlt-ev-bot">{botName[e.botId]?.name || "—"}</span>}
                            <span className="axlt-ev-n">{e.note}</span>
                            {e.detail && (
                              <span className="axlt-ev-d">
                                {Object.entries(e.detail).filter(([k]) => k !== "side").map(([k, v]) => (
                                  <em key={k}>{k} <b>{typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v)}</b></em>
                                ))}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BotDetail({ b }: { b: Bot }) {
  return (
    <div className="axlt-panel">
      <div className="axlt-ph"><span>FORWARD TEST <em>{b.ticker}</em></span><span className="axlt-since">deployed {ago(b.createdAt)}</span></div>
      <div className="axlt-rule">{b.describe}</div>
      <div className="axlt-stats">
        {cell("STATUS", b.status.toUpperCase(), b.status === "running" ? POS : "var(--ax-mut)")}
        {cell("BARS", b.interval === "1d" ? "daily" : "5-minute")}
        {cell("SIZE", String(b.qty))}
        {cell("SIGNALS", String(b.signals), CY)}
        {cell("FILLS", String(b.fills), CY)}
        {cell("POSITION", b.position ? `${b.position.qty} @ ${money(b.position.avgPrice)}` : "flat", b.position ? WARN : undefined)}
        {/* only a positive pct gets a "+" — a tiny loss rounds to 0.00 and "+0%" beside a negative dollar reads wrong */}
        {cell("UNREALIZED", b.position ? `${money(b.position.unrealized)} (${b.position.unrealizedPct > 0 ? "+" : ""}${b.position.unrealizedPct}%)` : "—", b.position ? col(b.position.unrealized) : undefined)}
        {cell("LAST CHECK", ago(b.lastEval))}
      </div>
    </div>
  );
}

function kpi(label: string, value: string, color: string) {
  return <div className="axlt-kpi"><div className="axlt-k-l">{label}</div><div className="axlt-k-v" style={{ color }}>{value}</div></div>;
}
function cell(label: string, value: string, color?: string) {
  return <div className="axlt-cell"><div className="axlt-c-l">{label}</div><div className="axlt-c-v" style={color ? { color } : undefined}>{value}</div></div>;
}

const LT_CSS = `
.ax-lt { height:100%; display:flex; flex-direction:column; gap:12px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axlt-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axlt-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axlt-badge { font-size:9px; font-weight:800; letter-spacing:.1em; color:var(--ax-warn); border:1px solid color-mix(in srgb, var(--ax-warn) 45%, transparent); background:color-mix(in srgb, var(--ax-warn) 12%, transparent); border-radius:6px; padding:3px 8px; }
.axlt-sub { font-size:11px; color:var(--ax-mut); }
.axlt-live { margin-left:auto; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut); padding:4px 11px; border:1px solid var(--ax-bd); border-radius:20px; background:var(--ax-panel); }
.axlt-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-dim); flex:0 0 auto; }
.axlt-dot.on { background:${POS}; box-shadow:0 0 7px ${POS}aa; animation:axltPulse 2s infinite; }
.axlt-dot.sm { width:6px; height:6px; }
@keyframes axltPulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.axlt-kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:9px; }
.axlt-kpi { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:9px 12px; }
.axlt-k-l { font-size:8px; letter-spacing:.09em; color:var(--ax-dim); margin-bottom:4px; }
.axlt-k-v { font-size:17px; font-weight:700; font-family:var(--ax-mono); }
.axlt-body { flex:1; min-height:0; display:grid; grid-template-columns:212px 1fr; gap:12px; }
.axlt-rail { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:11px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; }
.axlt-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:6px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.axlt-ph em { font-style:normal; font-weight:500; color:var(--ax-dim); letter-spacing:.02em; margin-left:6px; }
.axlt-brow { flex:0 0 auto; display:grid; grid-template-columns:auto 1fr auto; gap:6px 8px; align-items:center; text-align:left; background:transparent; border:1px solid transparent; border-radius:9px; padding:8px 9px; cursor:pointer; font-family:var(--ax-sans); }
.axlt-brow:hover { background:var(--ax-elev); }
.axlt-brow.on { background:var(--ax-panelhi); border-color:var(--ax-bdglow); }
.axlt-b-name { grid-column:2; font-size:11.5px; font-weight:600; color:var(--ax-tx); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axlt-b-sub { grid-column:2; font-size:9px; color:var(--ax-dim); font-family:var(--ax-mono); }
.axlt-b-pnl { grid-column:3; grid-row:1/3; font-family:var(--ax-mono); font-size:10px; }
.axlt-main { min-width:0; display:flex; flex-direction:column; gap:12px; overflow-y:auto; padding-right:4px; }
.axlt-panel { flex:0 0 auto; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; }
.axlt-stream { flex:1 1 auto; min-height:200px; display:flex; flex-direction:column; }
.axlt-since { font-size:9px; color:var(--ax-dim); font-family:var(--ax-mono); }
.axlt-rule { font-size:11px; color:var(--ax-mut); margin-bottom:10px; }
.axlt-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(96px,1fr)); gap:8px; }
.axlt-cell { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:7px 9px; }
.axlt-c-l { font-size:7.5px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:3px; }
.axlt-c-v { font-family:var(--ax-mono); font-size:11.5px; font-weight:600; color:var(--ax-tx); }
.axlt-kfilter { display:flex; gap:2px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:7px; padding:2px; }
.axlt-kfilter button { background:none; border:none; padding:3px 9px; border-radius:5px; font-size:9px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut); cursor:pointer; font-family:var(--ax-sans); }
.axlt-kfilter button.on { background:var(--ax-panelhi); color:var(--ax-acc); }
.axlt-events { flex:1; overflow-y:auto; display:flex; flex-direction:column; }
.axlt-ev { flex:0 0 auto; display:flex; align-items:baseline; gap:9px; padding:6px 2px; border-bottom:1px solid var(--ax-hair); font-size:11px; flex-wrap:wrap; }
.axlt-ev-t { font-family:var(--ax-mono); font-size:9px; color:var(--ax-dim); flex:0 0 54px; }
.axlt-ev-k { font-size:8px; font-weight:700; letter-spacing:.06em; border:1px solid; border-radius:4px; padding:1px 5px; flex:0 0 auto; }
.axlt-ev-bot { font-size:9.5px; color:var(--ax-cydim); flex:0 0 auto; }
.axlt-ev-n { color:var(--ax-tx); flex:1 1 auto; min-width:0; }
.axlt-ev-d { display:flex; gap:9px; flex-wrap:wrap; flex:0 0 auto; }
.axlt-ev-d em { font-style:normal; font-size:9px; color:var(--ax-dim); font-family:var(--ax-mono); }
.axlt-ev-d b { color:var(--ax-mut); font-weight:600; }
.axlt-empty { color:var(--ax-mut); font-size:12px; padding:24px 4px; }
.axlt-empty b { color:var(--ax-acc); font-weight:600; }
.axlt-empty-mini { color:var(--ax-dim); font-size:11px; padding:14px 2px; }
@media (max-width:900px) { .axlt-kpis { grid-template-columns:repeat(3,1fr); } .axlt-body { grid-template-columns:1fr; } }
`;
