import { useState } from "react";
import { useApexLive, type SessionQuote, type Mover } from "../apex-data";

// APEX · Live Markets — the live session board: major indices with their
// day range, crypto, top movers, and the macro/rates strip. Reads the shared
// ApexDataContext (already polled by the room, ~6s) so it adds no extra load.
// Styled with the shared Apex theme vars (--ax-*) to sit next to Home.

const POS = "#34d399", NEG = "#f4556b", CY = "#3fd0ff", WARN = "#f5a742", PUR = "#a98bff";

const col = (n: number | null | undefined) => (n == null || n === 0) ? "var(--ax-tx)" : n > 0 ? POS : NEG;
const pct = (n: number | null | undefined, dp = 2) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
const num = (n: number | null | undefined, dp = 2) => n == null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const compact = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

export function LiveMarketsView() {
  const live = useApexLive();
  const [moverTab, setMoverTab] = useState<"stocks" | "crypto">("stocks");

  const session = live.session || [];
  const btc = live.crypto?.BTCUSDT, eth = live.crypto?.ETHUSDT;
  const cg = live.cryptoGlobal;
  const movers = moverTab === "stocks" ? live.movers?.stocks : live.movers?.crypto;

  return (
    <div className="ax-lm">
      <style>{LM_CSS}</style>

      <div className="axlm-head">
        <span className="axlm-title">◈ LIVE MARKETS</span>
        <span className="axlm-sub">Session board · crypto · movers · rates</span>
        <div className="axlm-live">
          <span className={`axlm-dot${live.live ? " on" : ""}`} />
          {live.live ? "Live" : "Connecting…"}
          {live.updated ? <em>{new Date(live.updated).toLocaleTimeString([], { hour12: false })}</em> : null}
        </div>
      </div>

      <div className="axlm-body">
        {/* Session board */}
        <div className="axlm-session">
          {session.length === 0
            ? <div className="axlm-empty">Waiting for the session feed…</div>
            : session.map((s) => <SessionCard key={s.ticker} s={s} />)}
        </div>

        <div className="axlm-grid">
          {/* Movers */}
          <div className="axlm-panel">
            <div className="axlm-ph">
              <span className="axlm-tabs">
                <button className={moverTab === "stocks" ? "on" : ""} onClick={() => setMoverTab("stocks")}>STOCKS</button>
                <button className={moverTab === "crypto" ? "on" : ""} onClick={() => setMoverTab("crypto")}>CRYPTO</button>
              </span>
              <span>top movers today</span>
            </div>
            <div className="axlm-movers">
              <MoverCol title="GAINERS" rows={movers?.gainers || []} up />
              <MoverCol title="LOSERS" rows={movers?.losers || []} />
            </div>
          </div>

          {/* Crypto */}
          <div className="axlm-panel">
            <div className="axlm-ph"><span>CRYPTO</span><span>{cg ? "global market" : "—"}</span></div>
            <div className="axlm-crypto">
              {[["BTC", btc], ["ETH", eth]].map(([label, q]) => {
                const quote = q as typeof btc;
                return (
                  <div key={label as string} className="axlm-cq">
                    <span className="axlm-cq-l">{label as string}</span>
                    <span className="axlm-cq-p">{quote?.last != null ? `$${num(quote.last)}` : "—"}</span>
                    <span className="axlm-cq-c" style={{ color: col(quote?.changePct) }}>{pct(quote?.changePct)}</span>
                  </div>
                );
              })}
            </div>
            {cg && (
              <div className="axlm-cstats">
                {stat("TOTAL MCAP", compact(cg.totalMcap), col(cg.mcapChangePct), pct(cg.mcapChangePct))}
                {stat("24H VOLUME", compact(cg.volume), "var(--ax-tx)")}
                {stat("BTC DOM", `${cg.btcDom.toFixed(1)}%`, WARN)}
                {stat("ETH DOM", `${cg.ethDom.toFixed(1)}%`, PUR)}
              </div>
            )}
          </div>
        </div>

        {/* Macro + rates */}
        <div className="axlm-grid">
          <div className="axlm-panel">
            <div className="axlm-ph"><span>MACRO</span><span>latest prints</span></div>
            {(live.macro || []).length === 0 ? <div className="axlm-empty-mini">No macro data.</div> : (
              <div className="axlm-macro">
                {(live.macro || []).map((m) => (
                  <div key={m.series} className="axlm-mrow">
                    <span className="axlm-m-l">{m.label}</span>
                    <span className="axlm-m-v">{m.value == null ? "—" : `${m.value}${m.unit === "%" ? "%" : ""}`}</span>
                    <span className="axlm-m-d" style={{ color: m.dir > 0 ? POS : m.dir < 0 ? NEG : "var(--ax-mut)" }}>
                      {m.dir > 0 ? "▲" : m.dir < 0 ? "▼" : "—"}{m.prev != null ? ` prev ${m.prev}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="axlm-panel">
            <div className="axlm-ph"><span>TREASURY RATES</span><span>{live.yields?.[0]?.date || "avg by security"}</span></div>
            {(live.yields || []).length === 0 ? <div className="axlm-empty-mini">No rates data.</div> : (
              <div className="axlm-yields">
                {(live.yields || []).slice(0, 6).map((y) => {
                  const maxR = Math.max(...(live.yields || []).slice(0, 6).map((v) => v.rate || 0), 1);
                  return (
                    <div key={y.security} className="axlm-yrow">
                      <span className="axlm-y-l">{y.security.replace(/^Treasury\s*/, "").replace(/\s*\(.*\)$/, "")}</span>
                      <div className="axlm-y-bar"><div className="axlm-y-fill" style={{ width: `${((y.rate || 0) / maxR) * 100}%` }} /></div>
                      <span className="axlm-y-v">{y.rate?.toFixed(2)}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="axlm-foot">Public market data. Informational only — not financial advice.</div>
      </div>
    </div>
  );
}

/* ── Index card with a day-range bar ── */
function SessionCard({ s }: { s: SessionQuote }) {
  const lo = s.dayLo, hi = s.dayHi, span = (hi - lo) || 1;
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const up = (s.changePct ?? 0) >= 0;
  const c = up ? POS : NEG;
  return (
    <div className="axlm-card">
      <div className="axlm-c-top">
        <span className="axlm-c-name">{s.name}</span>
        <span className="axlm-c-chg" style={{ color: c }}>{pct(s.changePct)}</span>
      </div>
      <div className="axlm-c-last" style={{ color: c }}>{num(s.last)}</div>
      <div className="axlm-c-range">
        <div className="axlm-c-track">
          <div className="axlm-c-fill" style={{ width: `${at(s.last)}%`, background: c, boxShadow: `0 0 8px ${c}77` }} />
          <div className="axlm-c-prev" style={{ left: `${at(s.prevClose)}%` }} title={`Prev close ${num(s.prevClose)}`} />
          <div className="axlm-c-mark" style={{ left: `${at(s.last)}%`, background: c }} />
        </div>
        <div className="axlm-c-ends"><span>{num(s.dayLo)}</span><span>{num(s.dayHi)}</span></div>
      </div>
      <div className="axlm-c-meta">
        <span>open <b>{num(s.open)}</b></span>
        <span>gap <b style={{ color: col(s.gap) }}>{pct(s.gap)}</b></span>
      </div>
    </div>
  );
}

function MoverCol({ title, rows, up }: { title: string; rows: Mover[]; up?: boolean }) {
  return (
    <div className="axlm-mcol">
      <div className="axlm-mc-h" style={{ color: up ? POS : NEG }}>{up ? "▲" : "▼"} {title}</div>
      {rows.length === 0 ? <div className="axlm-empty-mini">—</div> : rows.slice(0, 6).map((m) => {
        const extra = m as Mover & { vol?: number; mktcap?: number; rating?: string };
        return (
          <div key={m.ticker} className="axlm-mrow2">
            <span className="axlm-mt">{m.ticker}</span>
            <span className="axlm-mp">{m.last == null ? "—" : num(m.last)}</span>
            <span className="axlm-mc" style={{ color: col(m.changePct) }}>{pct(m.changePct)}</span>
            {extra.rating ? <span className={`axlm-mr ${extra.rating.toLowerCase()}`}>{extra.rating}</span> : <span />}
          </div>
        );
      })}
    </div>
  );
}

function stat(label: string, value: string, color: string, sub?: string) {
  return (
    <div className="axlm-stat">
      <div className="axlm-s-l">{label}</div>
      <div className="axlm-s-v" style={{ color }}>{value}</div>
      {sub ? <div className="axlm-s-s" style={{ color }}>{sub}</div> : null}
    </div>
  );
}

const LM_CSS = `
.ax-lm { height:100%; display:flex; flex-direction:column; gap:13px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axlm-head { display:flex; align-items:baseline; gap:12px; }
.axlm-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axlm-sub { font-size:11px; color:var(--ax-mut); }
.axlm-live { margin-left:auto; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:.06em; color:var(--ax-mut); padding:4px 11px; border:1px solid var(--ax-bd); border-radius:20px; background:var(--ax-panel); }
.axlm-live em { font-style:normal; font-family:var(--ax-mono); font-weight:500; color:var(--ax-dim); }
.axlm-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-neg); }
.axlm-dot.on { background:var(--ax-pos); box-shadow:0 0 7px var(--ax-posglow); animation:axlmPulse 2s infinite; }
@keyframes axlmPulse { 0%,100% { opacity:1 } 50% { opacity:.45 } }
.axlm-body { flex:1; min-height:0; overflow-y:auto; display:flex; flex-direction:column; gap:13px; padding-right:4px; }
.axlm-session { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:11px; }
.axlm-card { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; }
.axlm-c-top { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.axlm-c-name { font-size:10.5px; font-weight:600; letter-spacing:.05em; color:var(--ax-mut); }
.axlm-c-chg { font-family:var(--ax-mono); font-size:12px; font-weight:700; }
.axlm-c-last { font-family:var(--ax-mono); font-size:22px; font-weight:800; margin:4px 0 10px; letter-spacing:.01em; }
.axlm-c-track { position:relative; height:6px; border-radius:4px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); }
.axlm-c-fill { position:absolute; left:0; top:0; bottom:0; border-radius:4px; }
.axlm-c-prev { position:absolute; top:-3px; bottom:-3px; width:1px; background:rgba(150,190,225,.55); }
.axlm-c-mark { position:absolute; top:50%; width:7px; height:7px; border-radius:50%; transform:translate(-50%,-50%); border:1.5px solid var(--ax-panel); }
.axlm-c-ends { display:flex; justify-content:space-between; margin-top:5px; font-family:var(--ax-mono); font-size:8.5px; color:var(--ax-dim); }
.axlm-c-meta { display:flex; gap:14px; margin-top:8px; font-size:9.5px; color:var(--ax-mut); }
.axlm-c-meta b { font-family:var(--ax-mono); font-weight:600; color:var(--ax-tx); }
.axlm-grid { display:grid; grid-template-columns:1.35fr 1fr; gap:13px; }
.axlm-panel { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:13px 15px; min-width:0; }
.axlm-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:11px; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.axlm-ph > span:last-child { font-weight:500; letter-spacing:.02em; color:var(--ax-dim); text-transform:none; }
.axlm-tabs { display:flex; gap:12px; }
.axlm-tabs button { background:none; border:none; padding:0; font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-dim); cursor:pointer; font-family:var(--ax-sans); }
.axlm-tabs button.on { color:var(--ax-cydim); }
.axlm-movers { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.axlm-mc-h { font-size:9px; font-weight:700; letter-spacing:.08em; margin-bottom:6px; }
.axlm-mrow2 { display:grid; grid-template-columns:1fr .9fr .8fr auto; gap:6px; align-items:center; padding:5px 0; border-bottom:1px solid var(--ax-hair); font-size:11.5px; }
.axlm-mt { font-family:var(--ax-mono); font-weight:700; color:var(--ax-tx); overflow:hidden; text-overflow:ellipsis; }
.axlm-mp, .axlm-mc { font-family:var(--ax-mono); text-align:right; color:var(--ax-mut); }
.axlm-mc { font-weight:600; }
.axlm-mr { font-size:8px; font-weight:700; padding:1px 5px; border-radius:4px; letter-spacing:.04em; }
.axlm-mr.buy { color:${POS}; border:1px solid color-mix(in srgb, ${POS} 40%, transparent); }
.axlm-mr.sell { color:${NEG}; border:1px solid color-mix(in srgb, ${NEG} 40%, transparent); }
.axlm-mr.hold, .axlm-mr.neutral { color:${WARN}; border:1px solid color-mix(in srgb, ${WARN} 40%, transparent); }
.axlm-crypto { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-bottom:10px; }
.axlm-cq { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:9px 11px; display:flex; flex-direction:column; gap:2px; }
.axlm-cq-l { font-size:8.5px; letter-spacing:.08em; color:var(--ax-dim); }
.axlm-cq-p { font-family:var(--ax-mono); font-size:14px; font-weight:700; color:var(--ax-tx); }
.axlm-cq-c { font-family:var(--ax-mono); font-size:10px; }
.axlm-cstats { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.axlm-stat { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:8px 10px; }
.axlm-s-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:3px; }
.axlm-s-v { font-family:var(--ax-mono); font-size:12.5px; font-weight:700; }
.axlm-s-s { font-family:var(--ax-mono); font-size:9px; margin-top:1px; }
.axlm-macro, .axlm-yields { display:flex; flex-direction:column; }
.axlm-mrow { display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:baseline; padding:7px 0; border-bottom:1px solid var(--ax-hair); font-size:12px; }
.axlm-m-l { color:var(--ax-mut); }
.axlm-m-v { font-family:var(--ax-mono); font-weight:700; color:var(--ax-tx); }
.axlm-m-d { font-family:var(--ax-mono); font-size:9px; }
.axlm-yrow { display:grid; grid-template-columns:1fr 1.1fr auto; gap:10px; align-items:center; padding:6px 0; border-bottom:1px solid var(--ax-hair); font-size:11.5px; }
.axlm-y-l { color:var(--ax-mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axlm-y-bar { height:5px; border-radius:3px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); overflow:hidden; }
.axlm-y-fill { height:100%; background:${CY}; border-radius:3px; }
.axlm-y-v { font-family:var(--ax-mono); font-weight:600; color:var(--ax-tx); }
.axlm-empty { color:var(--ax-mut); font-size:12px; padding:22px 4px; grid-column:1/-1; }
.axlm-empty-mini { color:var(--ax-dim); font-size:11px; padding:10px 2px; }
.axlm-foot { font-size:9px; color:var(--ax-dim); }
@media (max-width:900px) { .axlm-grid { grid-template-columns:1fr; } }
`;
