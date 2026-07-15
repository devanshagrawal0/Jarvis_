import { useEffect, useMemo, useState } from "react";

// APEX · News — the full news desk. The ingest engine clusters wire stories,
// scores corroboration/credibility, and tags ticker impact (direction +
// magnitude). This room is the reading surface: filter by lane, search, sort by
// impact or recency, and see which names the tape is actually talking about.
// Styled with the shared Apex theme vars (--ax-*) to sit next to Home.

const POS = "#34d399", NEG = "#f4556b", CY = "#3fd0ff", WARN = "#f5a742", PUR = "#a98bff", MUT = "rgba(150,190,225,.5)";

const LANE_META: Record<string, { label: string; col: string }> = {
  macro: { label: "Macro", col: CY }, finance: { label: "Finance", col: POS }, equity: { label: "Equity", col: POS },
  commodities: { label: "Commodities", col: WARN }, crypto: { label: "Crypto", col: PUR },
  geopolitics: { label: "Geo", col: NEG }, commercial: { label: "Commercial", col: MUT }, weather: { label: "Weather", col: "#5ab0e0" },
};
const credTier = (v: number) => v >= 0.7 ? { t: "High", c: POS } : v >= 0.52 ? { t: "Med", c: WARN } : { t: "Low", c: MUT };

type Tick = { t?: string; s?: string; dir: number; mag: number };
type Story = { id: string; title: string; rank: number; verified: number; corroboration: number; lane?: string; tickers: Tick[]; sources: string[]; pinned: boolean; firstSeen: string; net: number };
type Status = { active?: number; clusters?: number; lastRun?: string; ok?: boolean };

function timeAgo(iso: string) {
  const t = Date.parse(iso); if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NewsView() {
  const [stories, setStories] = useState<Story[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [lane, setLane] = useState("all");
  const [sort, setSort] = useState<"impact" | "latest">("impact");
  const [q, setQ] = useState("");

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      const [n, s] = await Promise.all([
        fetch("/api/apex/news?limit=60").then((r) => r.json()).catch(() => ({ stories: [] })),
        fetch("/api/apex/news/status").then((r) => r.json()).catch(() => null),
      ]);
      if (dead) return;
      const rows: Story[] = (n.stories || []).map((r: any) => {
        const impact = r.impact || {};
        const tickers: Tick[] = impact.tickers || [];
        const net = tickers.reduce((a, t) => a + (t.dir > 0 ? t.mag : -t.mag), 0);
        return {
          id: r.id || r.cluster_key, title: String(r.title || ""), rank: Number(r.rank || 0),
          verified: Number(r.verify_score || 0), corroboration: Number(r.article_count || 1),
          lane: impact.lane, tickers, sources: r.sources || [], pinned: !!r.pinned,
          firstSeen: r.first_seen || "", net,
        };
      });
      setStories(rows); setStatus(s); setLoading(false);
    };
    pull(); const iv = setInterval(pull, 45000);
    return () => { dead = true; clearInterval(iv); };
  }, []);

  const lanes = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stories) if (s.lane) m.set(s.lane, (m.get(s.lane) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [stories]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let r = stories.filter((s) => {
      if (lane !== "all" && s.lane !== lane) return false;
      if (needle) {
        const hay = `${s.title} ${(s.tickers || []).map((t) => t.t || t.s).join(" ")} ${s.sources.join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    r = sort === "impact"
      ? [...r].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.rank - a.rank)
      : [...r].sort((a, b) => (Date.parse(b.firstSeen) || 0) - (Date.parse(a.firstSeen) || 0));
    return r;
  }, [stories, lane, sort, q]);

  const bull = stories.filter((s) => s.net > 0.05).length;
  const bear = stories.filter((s) => s.net < -0.05).length;

  // Aggregate ticker impact across the current (filtered) story set
  const tickerImpact = useMemo(() => {
    const m = new Map<string, { net: number; n: number }>();
    for (const s of rows) {
      for (const t of s.tickers || []) {
        const sym = t.t || t.s; if (!sym) continue;
        const cur = m.get(sym) || { net: 0, n: 0 };
        cur.net += (t.dir > 0 ? t.mag : -t.mag); cur.n += 1;
        m.set(sym, cur);
      }
    }
    return [...m.entries()].map(([sym, v]) => ({ sym, ...v })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 14);
  }, [rows]);

  return (
    <div className="ax-news">
      <style>{NEWS_CSS}</style>

      <div className="axn-head">
        <span className="axn-title">▤ NEWS</span>
        <span className="axn-sub">Clustered wire feed · corroboration · ticker impact</span>
        <div className="axn-status" title={status?.lastRun ? `Last run ${new Date(status.lastRun).toLocaleTimeString()}` : "News engine"}>
          <span className={`axn-dot${status?.ok ? " on" : ""}`} />
          {status?.ok ? `Engine live · ${status.active ?? 0} active` : "Engine idle"}
          {status?.lastRun ? <em>{timeAgo(status.lastRun)} ago</em> : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="axn-tools">
        <input className="axn-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search headlines, tickers, sources…" />
        <div className="axn-chips">
          <button className={`axn-chip${lane === "all" ? " on" : ""}`} onClick={() => setLane("all")}>All <b>{stories.length}</b></button>
          {lanes.map(([l, n]) => (
            <button key={l} className={`axn-chip${lane === l ? " on" : ""}`} onClick={() => setLane(l)}
              style={lane === l ? { color: LANE_META[l]?.col || CY, borderColor: (LANE_META[l]?.col || CY) + "77", background: (LANE_META[l]?.col || CY) + "1f" } : undefined}>
              {LANE_META[l]?.label || l} <b>{n}</b>
            </button>
          ))}
        </div>
        <div className="axn-right">
          <div className="axn-sent" title={`${bull} bullish · ${bear} bearish`}>
            <span className="axn-sbar"><i style={{ flex: bull || 0.3, background: POS }} /><i style={{ flex: bear || 0.3, background: NEG }} /></span>
            <span className="axn-slbl">{bull}▲ {bear}▼</span>
          </div>
          <div className="axn-sort">
            <button className={sort === "impact" ? "on" : ""} onClick={() => setSort("impact")}>Impact</button>
            <button className={sort === "latest" ? "on" : ""} onClick={() => setSort("latest")}>Latest</button>
          </div>
        </div>
      </div>

      <div className="axn-body">
        {/* Story river */}
        <div className="axn-list">
          {loading ? <div className="axn-empty">Loading the wire…</div>
            : rows.length === 0 ? <div className="axn-empty">No stories match.</div>
              : rows.map((s) => <StoryCard key={s.id} s={s} />)}
        </div>

        {/* Ticker impact */}
        <div className="axn-side">
          <div className="axn-ph">TICKER IMPACT <span>net sentiment</span></div>
          {tickerImpact.length === 0 ? <div className="axn-empty-mini">No tagged tickers.</div> : (
            <div className="axn-timp">
              {tickerImpact.map((t) => {
                const maxAbs = Math.max(...tickerImpact.map((x) => Math.abs(x.net)), 0.5);
                const w = (Math.abs(t.net) / maxAbs) * 50;
                const up = t.net >= 0;
                return (
                  <div key={t.sym} className="axn-trow" title={`${t.sym} · ${t.n} ${t.n === 1 ? "story" : "stories"} · net ${t.net.toFixed(2)}`}>
                    <span className="axn-t-sym">{t.sym}</span>
                    <div className="axn-t-bar">
                      <span className="axn-t-mid" />
                      <div className="axn-t-fill" style={{ width: `${w}%`, [up ? "left" : "right"]: "50%", background: up ? POS : NEG } as any} />
                    </div>
                    <span className="axn-t-n">{t.n}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="axn-note">Net = Σ(direction × magnitude) across the filtered stories. Engine-tagged, not a recommendation.</div>
        </div>
      </div>
    </div>
  );
}

function StoryCard({ s }: { s: Story }) {
  const sent = s.net > 0.05 ? POS : s.net < -0.05 ? NEG : MUT;
  const cred = credTier(s.verified);
  const lm = s.lane ? LANE_META[s.lane] : null;
  return (
    <div className={`axn-story${s.pinned ? " pinned" : ""}`}>
      <span className="axn-sent-stripe" style={{ background: sent }} />
      <div className="axn-s-body">
        <div className="axn-s-title">{s.pinned && <span className="axn-pin">◆</span>}{s.title}</div>
        <div className="axn-s-meta">
          {lm && <span className="axn-lane" style={{ color: lm.col, borderColor: lm.col + "55" }}>{lm.label}</span>}
          <span className="axn-src">{s.sources[0] || "wire"}</span>
          {s.corroboration > 1 && <span className="axn-corr" title={`${s.corroboration} articles clustered`}>×{s.corroboration}</span>}
          <span className="axn-cred" style={{ color: cred.c }} title={`Credibility ${(s.verified * 100).toFixed(0)}%`}>{cred.t}</span>
          <span className="axn-time">{timeAgo(s.firstSeen)}</span>
        </div>
        {s.tickers.length > 0 && (
          <div className="axn-s-ticks">
            {s.tickers.slice(0, 8).map((t, i) => {
              const sym = t.t || t.s; if (!sym) return null;
              const up = t.dir > 0;
              return (
                <span key={sym + i} className="axn-tick" style={{ color: up ? POS : NEG, borderColor: (up ? POS : NEG) + "44", background: (up ? POS : NEG) + "14" }}
                  title={`${sym} · ${up ? "bullish" : "bearish"} · magnitude ${t.mag.toFixed(2)}`}>
                  {up ? "▲" : "▼"} {sym}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const NEWS_CSS = `
.ax-news { height:100%; display:flex; flex-direction:column; gap:12px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axn-head { display:flex; align-items:baseline; gap:12px; }
.axn-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axn-sub { font-size:11px; color:var(--ax-mut); }
.axn-status { margin-left:auto; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:.05em; color:var(--ax-mut); padding:4px 11px; border:1px solid var(--ax-bd); border-radius:20px; background:var(--ax-panel); }
.axn-status em { font-style:normal; font-weight:500; color:var(--ax-dim); font-family:var(--ax-mono); }
.axn-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-neg); }
.axn-dot.on { background:var(--ax-pos); box-shadow:0 0 7px var(--ax-posglow); }
.axn-tools { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.axn-search { flex:0 0 250px; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:9px; padding:8px 12px; color:var(--ax-tx); font-size:12px; font-family:var(--ax-sans); outline:none; }
.axn-search:focus { border-color:var(--ax-bdglow); }
.axn-search::placeholder { color:var(--ax-dim); }
.axn-chips { display:flex; gap:6px; flex-wrap:wrap; }
.axn-chip { font-size:10.5px; padding:5px 11px; border-radius:16px; cursor:pointer; background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); font-family:var(--ax-sans); }
.axn-chip b { color:var(--ax-cydim); font-weight:700; margin-left:3px; }
.axn-chip.on { color:var(--ax-acc); border-color:var(--ax-bdglow); background:color-mix(in srgb, var(--ax-acc) 14%, transparent); }
.axn-right { margin-left:auto; display:flex; align-items:center; gap:14px; }
.axn-sent { display:flex; align-items:center; gap:7px; }
.axn-sbar { display:flex; width:74px; height:5px; border-radius:3px; overflow:hidden; gap:1px; }
.axn-sbar i { display:block; }
.axn-slbl { font-family:var(--ax-mono); font-size:9.5px; color:var(--ax-mut); }
.axn-sort { display:flex; gap:2px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:8px; padding:2px; }
.axn-sort button { background:none; border:none; padding:4px 10px; border-radius:6px; font-size:10px; color:var(--ax-mut); cursor:pointer; font-family:var(--ax-sans); }
.axn-sort button.on { background:var(--ax-panelhi); color:var(--ax-acc); }
.axn-body { flex:1; min-height:0; display:grid; grid-template-columns:1fr 268px; gap:13px; }
.axn-list { overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding-right:4px; }
/* flex:0 0 auto — overflow:hidden zeroes a flex item's automatic min-height, so
   without this every card gets shrunk to 0 height inside the scrolling column. */
.axn-story { flex:0 0 auto; display:flex; gap:0; background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:11px; overflow:hidden; transition:border-color .14s; }
.axn-story:hover { border-color:var(--ax-bd); }
.axn-story.pinned { border-color:color-mix(in srgb, var(--ax-acc) 40%, transparent); }
.axn-sent-stripe { flex:0 0 3px; }
.axn-s-body { flex:1; min-width:0; padding:11px 13px; }
.axn-s-title { font-size:12.5px; font-weight:600; line-height:1.4; color:var(--ax-tx); }
.axn-pin { color:var(--ax-acc); margin-right:6px; font-size:9px; }
.axn-s-meta { display:flex; align-items:center; gap:9px; margin-top:6px; flex-wrap:wrap; font-size:9.5px; color:var(--ax-dim); }
.axn-lane { font-size:8.5px; font-weight:700; letter-spacing:.05em; padding:1px 6px; border:1px solid; border-radius:4px; }
.axn-src { color:var(--ax-mut); }
.axn-corr { font-family:var(--ax-mono); color:var(--ax-cydim); }
.axn-cred { font-weight:700; }
.axn-time { font-family:var(--ax-mono); margin-left:auto; }
.axn-s-ticks { display:flex; gap:5px; flex-wrap:wrap; margin-top:8px; }
.axn-tick { font-family:var(--ax-mono); font-size:9px; font-weight:700; padding:2px 7px; border:1px solid; border-radius:5px; }
.axn-side { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px; overflow-y:auto; }
.axn-ph { font-size:9.5px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:11px; display:flex; justify-content:space-between; align-items:baseline; }
.axn-ph span { font-weight:500; color:var(--ax-dim); text-transform:none; letter-spacing:.02em; }
.axn-timp { display:flex; flex-direction:column; gap:7px; }
.axn-trow { display:grid; grid-template-columns:46px 1fr 16px; gap:8px; align-items:center; }
.axn-t-sym { font-family:var(--ax-mono); font-size:10.5px; font-weight:700; color:var(--ax-tx); overflow:hidden; text-overflow:ellipsis; }
.axn-t-bar { position:relative; height:7px; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:4px; }
.axn-t-mid { position:absolute; left:50%; top:-2px; bottom:-2px; width:1px; background:rgba(150,190,225,.3); }
.axn-t-fill { position:absolute; top:0; bottom:0; border-radius:3px; }
.axn-t-n { font-family:var(--ax-mono); font-size:9px; color:var(--ax-dim); text-align:right; }
.axn-note { font-size:8.5px; color:var(--ax-dim); line-height:1.45; margin-top:12px; }
.axn-empty { color:var(--ax-mut); font-size:12px; padding:24px 4px; }
.axn-empty-mini { color:var(--ax-dim); font-size:11px; padding:12px 2px; }
@media (max-width:900px) { .axn-body { grid-template-columns:1fr; } }
`;
