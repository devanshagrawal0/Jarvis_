import { useCallback, useEffect, useMemo, useState } from "react";

// APEX · Trading Bots — build and deploy rule-based strategies. A deployed bot
// evaluates its rule against live bars every minute and trades automatically.
// PAPER TRADE ONLY: bots route every order through the virtual paper desk and
// have no broker path at all. Styled with the shared Apex theme vars (--ax-*).

const POS = "#34d399", NEG = "#f4556b", CY = "#3fd0ff", WARN = "#f5a742";

export type Bot = {
  id: string; name: string; ticker: string; kind: string; params: Record<string, number>;
  qty: number; interval: string; status: string; createdAt: string; cooldownMin: number;
  lastEval: string | null; lastSignal: string | null; describe: string;
  signals: number; fills: number; errors: number;
  position: { qty: number; avgPrice: number; last: number; unrealized: number; unrealizedPct: number } | null;
};
export type Kind = { kind: string; label: string; defaults: Record<string, number> };

const money = (n: number | null | undefined) => n == null ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const col = (n: number | null | undefined) => (n == null || n === 0) ? "var(--ax-tx)" : n > 0 ? POS : NEG;
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export function TradingBotsView() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Composer
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [kind, setKind] = useState("sma_cross");
  const [qty, setQty] = useState("10");
  const [interval, setInterval_] = useState<"5m" | "1d">("5m");
  const [cooldown, setCooldown] = useState("15");
  const [params, setParams] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const d = await fetch("/api/apex/bots").then((r) => r.json()).catch(() => null);
    if (d?.bots) { setBots(d.bots); setKinds(d.kinds || []); }
    setLoading(false);
  }, []);
  useEffect(() => { refresh(); const t = window.setInterval(refresh, 5000); return () => window.clearInterval(t); }, [refresh]);

  // Seed param inputs from the selected strategy's defaults. Keyed on the
  // defaults' CONTENT, not the kinds array: the 5s poll hands back a new array
  // each time, and depending on its identity would re-seed (wiping whatever the
  // user had typed) on every refresh.
  const defaultsKey = useMemo(
    () => JSON.stringify(kinds.find((x) => x.kind === kind)?.defaults ?? null),
    [kinds, kind],
  );
  useEffect(() => {
    const d = JSON.parse(defaultsKey) as Record<string, number> | null;
    if (d) setParams(Object.fromEntries(Object.entries(d).map(([p, v]) => [p, String(v)])));
  }, [defaultsKey]);

  const act = async (id: string, action: string) => {
    setBusy(id); setMsg(null);
    try {
      const r = await fetch(`/api/apex/bots/${id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Failed");
      if (action === "evaluate" && d.result) setMsg({ kind: "ok", text: `Checked — ${d.result.note}` });
      refresh();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
    finally { setBusy(null); }
  };

  const create = async () => {
    setMsg(null);
    try {
      const body = {
        name: name.trim() || undefined, ticker: ticker.trim().toUpperCase(), kind, qty: Number(qty), interval,
        cooldownMin: Number(cooldown),
        params: Object.fromEntries(Object.entries(params).map(([k2, v]) => [k2, Number(v)])),
      };
      const r = await fetch("/api/apex/bots", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Rejected");
      setMsg({ kind: "ok", text: `Bot created — deploy it to start trading.` });
      setOpen(false); setName(""); setTicker("");
      refresh();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  };

  const running = bots.filter((b) => b.status === "running").length;
  const canCreate = ticker.trim() && Number(qty) > 0;

  return (
    <div className="ax-bots">
      <style>{BOTS_CSS}</style>

      <div className="axb-head">
        <span className="axb-title">⬡ TRADING BOTS</span>
        <span className="axb-badge">PAPER · VIRTUAL</span>
        <span className="axb-sub">Rule strategies · evaluated every minute · trade into the paper desk</span>
        <button className="axb-new" onClick={() => setOpen((v) => !v)}>{open ? "✕ Cancel" : "+ New bot"}</button>
      </div>

      {msg && <div className={`axb-msg ${msg.kind}`}>{msg.text}</div>}

      {/* Composer */}
      {open && (
        <div className="axb-composer">
          <div className="axb-row">
            <label>NAME <input value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" /></label>
            <label>SYMBOL <input className="mono" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="AAPL" maxLength={6} /></label>
            <label>QUANTITY <input className="mono" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
            <label>BARS
              <select value={interval} onChange={(e) => { const v = e.target.value as "5m" | "1d"; setInterval_(v); setCooldown(v === "1d" ? "0" : "15"); }}>
                <option value="5m">5-minute</option>
                <option value="1d">Daily</option>
              </select>
            </label>
            <label title="Minimum minutes between trades. Every round trip pays slippage + commission, so an unthrottled rule bleeds on costs.">
              COOLDOWN (MIN) <input className="mono" value={cooldown} onChange={(e) => setCooldown(e.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          </div>
          <div className="axb-strats">
            {kinds.map((k) => (
              <button key={k.kind} className={`axb-strat${kind === k.kind ? " on" : ""}`} onClick={() => setKind(k.kind)}>{k.label}</button>
            ))}
          </div>
          <div className="axb-row">
            {Object.entries(params).map(([p, v]) => (
              <label key={p}>{p.toUpperCase()} <input className="mono" value={v} onChange={(e) => setParams((s) => ({ ...s, [p]: e.target.value.replace(/[^0-9.]/g, "") }))} /></label>
            ))}
          </div>
          <button className="axb-create" disabled={!canCreate} onClick={create}>Create bot</button>
        </div>
      )}

      {/* Fleet */}
      <div className="axb-fleet-h">
        <span>FLEET <b>{bots.length}</b></span>
        <span className="axb-run">{running} running</span>
      </div>

      <div className="axb-body">
        {loading ? <div className="axb-empty">Loading bots…</div>
          : bots.length === 0 ? <div className="axb-empty">No bots yet. Create one — it starts paused, so nothing trades until you deploy it.</div>
            : bots.map((b) => (
              <div key={b.id} className={`axb-card${b.status === "running" ? " live" : ""}`}>
                <div className="axb-c-top">
                  <span className={`axb-dot${b.status === "running" ? " on" : ""}`} />
                  <span className="axb-c-name">{b.name}</span>
                  <span className="axb-c-tk">{b.ticker}</span>
                  <span className="axb-c-int">{b.interval === "1d" ? "daily" : "5m"}</span>
                  <span className={`axb-c-status ${b.status}`}>{b.status.toUpperCase()}</span>
                </div>
                <div className="axb-c-rule">{b.describe}</div>
                <div className="axb-c-stats">
                  {cell("QTY", String(b.qty))}
                  {cell("COOLDOWN", b.cooldownMin ? `${b.cooldownMin}m` : "none")}
                  {cell("SIGNALS", String(b.signals))}
                  {cell("FILLS", String(b.fills))}
                  {cell("POSITION", b.position ? `${b.position.qty} @ ${money(b.position.avgPrice)}` : "flat", b.position ? CY : undefined)}
                  {cell("UNREALIZED", b.position ? money(b.position.unrealized) : "—", b.position ? col(b.position.unrealized) : undefined)}
                  {cell("LAST CHECK", ago(b.lastEval))}
                </div>
                <div className="axb-c-acts">
                  {b.status === "running"
                    ? <button className="axb-btn pause" disabled={busy === b.id} onClick={() => act(b.id, "pause")}>⏸ Pause</button>
                    : <button className="axb-btn start" disabled={busy === b.id} onClick={() => act(b.id, "start")}>▶ Deploy</button>}
                  <button className="axb-btn" disabled={busy === b.id} onClick={() => act(b.id, "evaluate")}>Run check</button>
                  <button className="axb-btn del" disabled={busy === b.id} onClick={() => { if (confirm(`Delete "${b.name}"? Its history is removed. Any open position stays in the paper account.`)) act(b.id, "delete"); }}>Delete</button>
                  {b.errors > 0 && <span className="axb-err">{b.errors} error{b.errors > 1 ? "s" : ""}</span>}
                </div>
              </div>
            ))}
      </div>

      <div className="axb-foot">
        Bots trade the virtual paper account only — there is no live-broker path. Watch them run in Live Testing.
        These are <b>mechanical baselines for forward-testing the machinery, not alpha</b> — fills carry slippage and
        commission, so an over-eager rule loses on costs alone. That's what the cooldown is for.
      </div>
    </div>
  );
}

function cell(label: string, value: string, color?: string) {
  return (
    <div className="axb-cell">
      <div className="axb-cl">{label}</div>
      <div className="axb-cv" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

const BOTS_CSS = `
.ax-bots { height:100%; display:flex; flex-direction:column; gap:12px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axb-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axb-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axb-badge { font-size:9px; font-weight:800; letter-spacing:.1em; color:var(--ax-warn); border:1px solid color-mix(in srgb, var(--ax-warn) 45%, transparent); background:color-mix(in srgb, var(--ax-warn) 12%, transparent); border-radius:6px; padding:3px 8px; }
.axb-sub { font-size:11px; color:var(--ax-mut); }
.axb-new { margin-left:auto; background:color-mix(in srgb, var(--ax-acc) 16%, transparent); border:1px solid var(--ax-bdglow); color:var(--ax-acc); border-radius:8px; padding:7px 14px; font-size:11.5px; font-weight:700; cursor:pointer; font-family:var(--ax-sans); }
.axb-msg { font-size:11.5px; border-radius:8px; padding:8px 11px; }
.axb-msg.ok { background:color-mix(in srgb, ${POS} 12%, transparent); color:${POS}; border:1px solid color-mix(in srgb, ${POS} 35%, transparent); }
.axb-msg.err { background:color-mix(in srgb, ${NEG} 12%, transparent); color:${NEG}; border:1px solid color-mix(in srgb, ${NEG} 35%, transparent); }
.axb-composer { background:var(--ax-panel); border:1px solid var(--ax-bdglow); border-radius:13px; padding:14px; display:flex; flex-direction:column; gap:11px; }
.axb-row { display:flex; gap:11px; flex-wrap:wrap; }
.axb-row label { display:flex; flex-direction:column; gap:4px; font-size:8.5px; letter-spacing:.08em; color:var(--ax-dim); }
.axb-row input, .axb-row select { background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:8px; padding:8px 11px; color:var(--ax-tx); font-size:12.5px; font-family:var(--ax-sans); outline:none; min-width:96px; }
.axb-row input.mono { font-family:var(--ax-mono); }
.axb-row input:focus, .axb-row select:focus { border-color:var(--ax-bdglow); }
.axb-strats { display:flex; gap:7px; flex-wrap:wrap; }
.axb-strat { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:8px; padding:7px 13px; font-size:11.5px; cursor:pointer; font-family:var(--ax-sans); }
.axb-strat.on { border-color:var(--ax-bdglow); background:var(--ax-panelhi); color:var(--ax-acc); font-weight:600; }
.axb-create { align-self:flex-start; background:${POS}; border:none; color:#04120b; border-radius:8px; padding:9px 18px; font-size:12px; font-weight:700; cursor:pointer; font-family:var(--ax-sans); }
.axb-create:disabled { opacity:.4; cursor:not-allowed; }
.axb-fleet-h { display:flex; align-items:baseline; gap:12px; font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); }
.axb-fleet-h b { color:var(--ax-tx); }
.axb-run { color:var(--ax-mut); font-weight:500; letter-spacing:.02em; }
.axb-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:9px; padding-right:4px; }
.axb-card { flex:0 0 auto; background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:12px; padding:12px 14px; }
.axb-card.live { border-color:color-mix(in srgb, ${POS} 40%, transparent); }
.axb-c-top { display:flex; align-items:center; gap:9px; }
.axb-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-dim); flex:0 0 auto; }
.axb-dot.on { background:${POS}; box-shadow:0 0 7px ${POS}aa; animation:axbPulse 2s infinite; }
@keyframes axbPulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.axb-c-name { font-size:13px; font-weight:600; color:var(--ax-tx); }
.axb-c-tk { font-family:var(--ax-mono); font-size:10px; color:var(--ax-cydim); border:1px solid var(--ax-bdsoft); border-radius:5px; padding:1px 6px; }
.axb-c-int { font-size:9px; color:var(--ax-dim); }
.axb-c-status { margin-left:auto; font-size:8.5px; font-weight:700; letter-spacing:.08em; }
.axb-c-status.running { color:${POS}; }
.axb-c-status.paused { color:var(--ax-mut); }
.axb-c-rule { font-size:11px; color:var(--ax-mut); margin:7px 0 10px; }
.axb-c-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:8px; margin-bottom:11px; }
.axb-cell { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:7px 9px; }
.axb-cl { font-size:7.5px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:3px; }
.axb-cv { font-family:var(--ax-mono); font-size:11.5px; font-weight:600; color:var(--ax-tx); }
.axb-c-acts { display:flex; gap:7px; align-items:center; }
.axb-btn { background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:7px; padding:5px 12px; font-size:10.5px; cursor:pointer; font-family:var(--ax-sans); }
.axb-btn:hover { border-color:var(--ax-bd); color:var(--ax-tx); }
.axb-btn:disabled { opacity:.4; cursor:not-allowed; }
.axb-btn.start { border-color:color-mix(in srgb, ${POS} 45%, transparent); color:${POS}; }
.axb-btn.pause { border-color:color-mix(in srgb, ${WARN} 45%, transparent); color:${WARN}; }
.axb-btn.del:hover { border-color:${NEG}; color:${NEG}; }
.axb-err { font-size:9.5px; color:${NEG}; margin-left:auto; }
.axb-empty { color:var(--ax-mut); font-size:12px; padding:24px 4px; }
.axb-foot { font-size:9px; color:var(--ax-dim); }
`;
