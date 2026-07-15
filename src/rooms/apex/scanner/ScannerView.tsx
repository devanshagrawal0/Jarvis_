import { useEffect, useMemo, useState } from "react";

// APEX · Scanner — the Alpha Zoo factor catalog, powered by the Vibe-Trading
// engine (sidecar on the SSD) via JARVIS's /api/apex/engine/* bridge. Styled
// with the shared Apex theme vars (--ax-*) so it drops in seamlessly next to Home.

type Alpha = {
  id: string; zoo?: string; nickname?: string;
  theme?: string[]; universe?: string[];
  decay_horizon?: number; min_warmup_bars?: number; requires_sector?: boolean;
};
type Engine = { connected: boolean; skills?: number; llmConfigured?: boolean; error?: string };

const UNI_LABEL: Record<string, string> = { equity_us: "US", equity_cn: "CN", equity_hk: "HK", crypto: "CRYPTO", fx: "FX", futures: "FUT" };
const uni = (u?: string[]) => (u || []).map((x) => UNI_LABEL[x] || x.replace(/^equity_/, "").toUpperCase());

export function ScannerView() {
  const [alphas, setAlphas] = useState<Alpha[]>([]);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [h, a] = await Promise.all([
          fetch("/api/apex/engine/health").then((r) => r.json()).catch(() => ({ connected: false })),
          fetch("/api/apex/engine/alphas").then((r) => r.json()).catch(() => ({ alphas: [] })),
        ]);
        if (dead) return;
        setEngine(h);
        const list: Alpha[] = Array.isArray(a) ? a : (a.alphas || a.items || a.data || []);
        setAlphas(list);
        if (list[0]) setSelId(list[0].id);
      } finally { if (!dead) setLoading(false); }
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    if (!selId) { setDetail(null); return; }
    let dead = false;
    setDetailBusy(true);
    fetch(`/api/apex/engine/alpha/${encodeURIComponent(selId)}`)
      .then((r) => r.json())
      .then((d) => { if (!dead) setDetail(d?.alpha || d); })
      .catch(() => { if (!dead) setDetail(null); })
      .finally(() => { if (!dead) setDetailBusy(false); });
    return () => { dead = true; };
  }, [selId]);

  const themes = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alphas) for (const t of a.theme || []) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [alphas]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return alphas.filter((a) => {
      if (theme !== "all" && !(a.theme || []).includes(theme)) return false;
      if (needle && !(`${a.nickname || ""} ${a.id}`.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [alphas, theme, q]);

  const meta = detail?.meta || detail;

  return (
    <div className="ax-scan">
      <style>{SCAN_CSS}</style>

      {/* Header */}
      <div className="axs-head">
        <span className="axs-title">◇ SCANNER</span>
        <span className="axs-sub">Alpha Zoo · quant factor catalog</span>
        <div className="axs-engine" title={engine?.connected ? `Vibe engine connected · ${engine.skills ?? "?"} skills` : "Vibe engine offline — start it with scripts/vibe-up.sh"}>
          <span className={`axs-dot${engine?.connected ? " on" : ""}`} />
          {engine?.connected ? "Engine connected" : "Engine offline"}
        </div>
      </div>

      {loading ? (
        <div className="axs-empty">Loading factor catalog from the engine…</div>
      ) : !engine?.connected ? (
        <div className="axs-empty">
          The quant engine isn't running. Start it on the SSD: <code>./scripts/vibe-up.sh</code>
        </div>
      ) : (
        <>
          {/* Toolbar */}
          <div className="axs-tools">
            <input className="axs-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search factors…" />
            <div className="axs-chips">
              <button className={`axs-chip${theme === "all" ? " on" : ""}`} onClick={() => setTheme("all")}>All <b>{alphas.length}</b></button>
              {themes.map(([t, n]) => (
                <button key={t} className={`axs-chip${theme === t ? " on" : ""}`} onClick={() => setTheme(t)}>{t} <b>{n}</b></button>
              ))}
            </div>
          </div>

          <div className="axs-body">
            {/* Factor grid */}
            <div className="axs-grid">
              {filtered.length === 0 && <div className="axs-empty" style={{ gridColumn: "1/-1" }}>No factors match.</div>}
              {filtered.map((a) => (
                <div key={a.id} className={`axs-card${a.id === selId ? " on" : ""}`} onClick={() => setSelId(a.id)}>
                  <div className="axs-card-top">
                    <span className="axs-nick">{a.nickname || a.id}</span>
                    {a.zoo && <span className="axs-zoo">{a.zoo}</span>}
                  </div>
                  <div className="axs-id">{a.id}</div>
                  <div className="axs-tags">
                    {(a.theme || []).map((t) => <span key={t} className="axs-tag">{t}</span>)}
                    {uni(a.universe).map((u) => <span key={u} className="axs-tag axs-uni">{u}</span>)}
                  </div>
                </div>
              ))}
            </div>

            {/* Detail */}
            <div className="axs-detail">
              {!meta ? (
                <div className="axs-empty">{detailBusy ? "Loading…" : "Select a factor."}</div>
              ) : (
                <>
                  <div className="axs-d-nick">{meta.nickname || meta.id}</div>
                  <div className="axs-d-id">{meta.id}{meta.zoo ? ` · ${meta.zoo}` : ""}</div>
                  <div className="axs-d-tags">
                    {(meta.theme || []).map((t: string) => <span key={t} className="axs-tag">{t}</span>)}
                    {uni(meta.universe).map((u: string) => <span key={u} className="axs-tag axs-uni">{u}</span>)}
                  </div>

                  {meta.formula_latex && (
                    <div className="axs-sec">
                      <div className="axs-sec-h">FORMULA</div>
                      <div className="axs-formula">{meta.formula_latex}</div>
                    </div>
                  )}
                  {meta.notes && (
                    <div className="axs-sec">
                      <div className="axs-sec-h">NOTES</div>
                      <div className="axs-notes">{meta.notes}</div>
                    </div>
                  )}
                  <div className="axs-sec">
                    <div className="axs-sec-h">SPEC</div>
                    <div className="axs-stats">
                      {statCell("DECAY HORIZON", meta.decay_horizon != null ? `${meta.decay_horizon}d` : "—")}
                      {statCell("WARMUP", meta.min_warmup_bars != null ? `${meta.min_warmup_bars} bars` : "—")}
                      {statCell("FREQUENCY", (meta.frequency || []).join(", ") || "—")}
                      {statCell("NEEDS SECTOR", meta.requires_sector ? "Yes" : "No")}
                      {statCell("COLUMNS", (meta.columns_required || []).join(", ") || "—")}
                    </div>
                  </div>
                  <div className="axs-foot">Definitions from the Vibe-Trading Alpha Zoo. Informational, not financial advice.</div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function statCell(label: string, value: string) {
  return (
    <div className="axs-stat">
      <div className="axs-stat-l">{label}</div>
      <div className="axs-stat-v">{value}</div>
    </div>
  );
}

const SCAN_CSS = `
.ax-scan { height:100%; display:flex; flex-direction:column; gap:14px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axs-head { display:flex; align-items:baseline; gap:12px; }
.axs-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axs-sub { font-size:11px; color:var(--ax-mut); }
.axs-engine { margin-left:auto; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:.06em; color:var(--ax-mut); padding:4px 11px; border:1px solid var(--ax-bd); border-radius:20px; background:var(--ax-panel); }
.axs-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-neg); box-shadow:0 0 6px var(--ax-neg); }
.axs-dot.on { background:var(--ax-pos); box-shadow:0 0 7px var(--ax-posglow); }
.axs-tools { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axs-search { flex:0 0 220px; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:9px; padding:8px 12px; color:var(--ax-tx); font-size:12px; font-family:var(--ax-sans); outline:none; }
.axs-search::placeholder { color:var(--ax-dim); }
.axs-chips { display:flex; gap:6px; flex-wrap:wrap; }
.axs-chip { font-size:10.5px; text-transform:capitalize; padding:5px 11px; border-radius:16px; cursor:pointer; background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); font-family:var(--ax-sans); }
.axs-chip b { color:var(--ax-cydim); font-weight:700; margin-left:3px; }
.axs-chip.on { background:color-mix(in srgb, var(--ax-acc) 14%, transparent); border-color:var(--ax-bdglow); color:var(--ax-acc); }
.axs-chip.on b { color:var(--ax-acc); }
.axs-body { flex:1; min-height:0; display:grid; grid-template-columns:1fr 360px; gap:14px; }
.axs-grid { overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(232px,1fr)); grid-auto-rows:min-content; gap:10px; padding-right:4px; align-content:start; }
.axs-card { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:11px; padding:11px 12px; cursor:pointer; transition:border-color .14s, background .14s; }
.axs-card:hover { border-color:var(--ax-bd); }
.axs-card.on { border-color:var(--ax-bdglow); background:var(--ax-panelhi); box-shadow:0 0 0 1px var(--ax-bdglow) inset; }
.axs-card-top { display:flex; align-items:flex-start; gap:8px; }
.axs-nick { flex:1; font-size:12px; font-weight:600; line-height:1.32; color:var(--ax-tx); }
.axs-zoo { flex:0 0 auto; font-size:8px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--ax-sig); border:1px solid var(--ax-sigdim); border-radius:5px; padding:2px 6px; }
.axs-id { font-family:var(--ax-mono); font-size:9.5px; color:var(--ax-dim); margin:5px 0 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axs-tags { display:flex; flex-wrap:wrap; gap:4px; }
.axs-tag { font-size:9px; padding:2px 7px; border-radius:5px; background:color-mix(in srgb, var(--ax-acc) 8%, transparent); border:1px solid var(--ax-bdsoft); color:var(--ax-cydim); text-transform:capitalize; }
.axs-tag.axs-uni { color:var(--ax-mut); background:transparent; }
.axs-detail { overflow-y:auto; background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:16px; }
.axs-d-nick { font-size:15px; font-weight:700; line-height:1.3; color:var(--ax-tx); }
.axs-d-id { font-family:var(--ax-mono); font-size:10px; color:var(--ax-mut); margin:4px 0 10px; }
.axs-d-tags { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:14px; }
.axs-sec { margin-bottom:14px; }
.axs-sec-h { font-size:9px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:6px; }
.axs-formula { font-family:var(--ax-mono); font-size:11px; line-height:1.6; color:var(--ax-tx); background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:10px 12px; overflow-x:auto; white-space:pre-wrap; word-break:break-word; }
.axs-notes { font-size:12px; line-height:1.6; color:var(--ax-mut); }
.axs-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.axs-stat { background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:8px 10px; }
.axs-stat-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:3px; }
.axs-stat-v { font-size:12px; font-weight:600; color:var(--ax-tx); font-family:var(--ax-mono); }
.axs-foot { font-size:9px; color:var(--ax-dim); margin-top:6px; }
.axs-empty { color:var(--ax-mut); font-size:12px; padding:24px 4px; }
.axs-empty code { font-family:var(--ax-mono); color:var(--ax-acc); }
`;
