import { useEffect, useMemo, useRef, useState } from "react";
import type { BacktestRun, BtConfig } from "./bt-types";
import type { BotSpec } from "../forge/forge-spec";
import { templateSpecs } from "../forge/forge-spec";
import { forgeAdversary } from "../forge/forge-data";
import { buildArtifact, runStressReplays, runEnsembleHRP, type StressResult, type EnsembleResult } from "./bt-engine";
import { perRegimeStats, type RegimeReport } from "./bt-regime";
import { fetchSymbolNews, newsSignal, loadNewsFilter, saveNewsFilter, FEATURE_LABEL, type NewsItem, type NewsSignal, type NewsFeature, type NewsFilterCfg } from "./bt-news";

const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pct = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : "—");
const money = (v: number) => `$${(Number.isFinite(v) ? v : 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const sc = (v: number) => (v >= 0 ? "var(--ax-pos)" : "var(--ax-neg)");
async function askAgent(question: string, context: Record<string, unknown>): Promise<string> {
  try { const r = await fetch("/api/apex/forge-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }) }); if (!r.ok) return ""; const j = await r.json(); return String(j.answer || j.response || j.suggestions || j.text || "").trim(); } catch { return ""; }
}

/* ── 📰 NEWS INPUT ENGINE ── */
export function NewsTab({ config }: { run: BacktestRun; config: BtConfig }) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [sig, setSig] = useState<NewsSignal | null>(null);
  const [cfg, setCfg] = useState<NewsFilterCfg>(() => loadNewsFilter(config.strategyName));
  useEffect(() => { let dead = false; setItems(null); fetchSymbolNews(config.symbol).then((it) => { if (dead) return; setItems(it); setSig(newsSignal(it)); }); return () => { dead = true; }; }, [config.symbol]);
  useEffect(() => { setCfg(loadNewsFilter(config.strategyName)); }, [config.strategyName]);
  const update = (patch: Partial<NewsFilterCfg>) => setCfg((c) => { const n = { ...c, ...patch }; saveNewsFilter(config.strategyName, n); return n; });

  return (
    <div className="bta-grid">
      <div className="bta-left">
        <div className="bte-pnl">
          <div className="bte-ph"><span className="bte-pt">NEWS SIGNAL · {config.symbol}</span></div>
          {sig ? (
            <>
              <div className="bti-cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="bte-elev"><div className="bte-kpi-l">NET SENTIMENT</div><div className="bti-cval" style={{ color: sc(sig.netSentiment) }}>{(sig.netSentiment * 100).toFixed(0)}</div></div>
                <div className="bte-elev"><div className="bte-kpi-l">HEADLINES</div><div className="bti-cval">{sig.volume}</div></div>
                <div className="bte-elev"><div className="bte-kpi-l">BULL / BEAR</div><div className="bti-cval">{sig.bull}/{sig.bear}</div></div>
                <div className="bte-elev"><div className="bte-kpi-l">AVG IMPACT</div><div className="bti-cval">{(sig.avgImpact * 100).toFixed(0)}</div></div>
              </div>
            </>
          ) : <div className="bte-empty"><div className="bte-spin" />Fetching news…</div>}
        </div>
        <div className="bte-pnl">
          <div className="bte-ph"><span className="bte-pt">ATTACH TO ALGO</span></div>
          <div className="bti-group">
            <label className="bti-opt on"><input type="checkbox" checked={cfg.enabled} onChange={(e) => update({ enabled: e.target.checked })} />Gate entries on news signal</label>
          </div>
          <div className="bte-field" style={{ marginBottom: 7 }}><label>FEATURE</label><select value={cfg.feature} onChange={(e) => update({ feature: e.target.value as NewsFeature })}>{(Object.keys(FEATURE_LABEL) as NewsFeature[]).map((f) => <option key={f} value={f}>{FEATURE_LABEL[f]}</option>)}</select></div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="bte-field"><label>DIR</label><select value={cfg.dir} onChange={(e) => update({ dir: e.target.value as "above" | "below" })}><option value="above">above</option><option value="below">below</option></select></div>
            <div className="bte-field"><label>THRESHOLD</label><input type="number" step="0.05" value={cfg.threshold} onChange={(e) => update({ threshold: +e.target.value || 0 })} /></div>
          </div>
          {sig && cfg.enabled && <div className="bta-ai" style={{ marginTop: 9 }}><b>Now:</b> signal {(cfg.feature === "netSentiment" ? sig.netSentiment : cfg.feature === "volume" ? sig.volume : sig.bullBearRatio).toFixed(2)} → entries would be {(cfg.dir === "above" ? (cfg.feature === "netSentiment" ? sig.netSentiment : cfg.feature === "volume" ? sig.volume : sig.bullBearRatio) >= cfg.threshold : (cfg.feature === "netSentiment" ? sig.netSentiment : cfg.feature === "volume" ? sig.volume : sig.bullBearRatio) <= cfg.threshold) ? "ALLOWED" : "BLOCKED"}.</div>}
          <div className="bte-mc-note">Free feeds carry a recent headline window only, so this news filter runs live / paper-forward (and as a recent-window overlay) — it is not applied to the multi-year backtest history.</div>
        </div>
      </div>
      <div className="bte-pnl bta-detail">
        <div className="bte-ph"><span className="bte-pt">NEWS FEED · sentiment-scored</span></div>
        {!items ? <div className="bte-empty"><div className="bte-spin" /></div> : items.length ? (
          <div className="btn-feed">{items.map((it, i) => (
            <div key={i} className="btn-item">
              <span className={`btn-dot ${it.dir}`} />
              <div className="btn-body"><div className="btn-title">{it.title}</div><div className="btn-meta">{it.time ? new Date(it.time).toLocaleDateString() + " · " : ""}{it.sector} · {it.dir} · impact {(it.magnitude * 100).toFixed(0)}</div></div>
              <div className="btn-impact"><span style={{ width: `${Math.min(100, it.magnitude * 100)}%`, background: it.dir === "bullish" ? "var(--ax-pos)" : "var(--ax-neg)" }} /></div>
            </div>
          ))}</div>
        ) : <div className="bte-stage-body">No recent news for {config.symbol} on the free feed.</div>}
      </div>
    </div>
  );
}

/* ── 🌀 REGIME INTELLIGENCE LAB ── */
export function RegimeTab({ run, spec, config }: { run: BacktestRun; spec: BotSpec | null; config: BtConfig }) {
  const [rep, setRep] = useState<RegimeReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [ai, setAi] = useState(""); const [aiLoad, setAiLoad] = useState(false);
  useEffect(() => { if (!spec) return; let dead = false; setLoading(true); setRep(null); setAi(""); buildArtifact(spec, config).then((art) => { if (dead) return; if (art) setRep(perRegimeStats(art)); setLoading(false); }).catch(() => !dead && setLoading(false)); return () => { dead = true; }; /* eslint-disable-next-line */ }, [run, spec]);
  const ribRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ribRef.current; if (!cv || !rep) return; const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = 26;
    cv.width = w * dpr; cv.height = h * dpr; const ctx = cv.getContext("2d"); if (!ctx) return; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const rib = rep.ribbon; if (!rib.length) return; const colOf: Record<string, string> = {}; rep.regimes.forEach((r) => (colOf[r.id] = r.color));
    for (let x = 0; x < w; x++) { const idx = Math.min(rib.length - 1, Math.floor((x / w) * rib.length)); ctx.fillStyle = colOf[rib[idx].id] || "#333"; ctx.globalAlpha = 0.85; ctx.fillRect(x, 0, 1, h); }
  }, [rep]);
  async function suggest() { if (!rep) return; setAiLoad(true); const txt = await askAgent("Given a strategy's performance split by market regime, name the regime(s) to FILTER OUT and one rule to do it. 2 sentences, specific.", { strategy: config.strategyName, symbol: config.symbol, byRegime: rep.regimes.map((r) => ({ regime: r.label, trades: r.trades, winRatePct: +r.winRatePct.toFixed(0), totalPnl: +r.totalPnl.toFixed(0) })) }); setAi(txt || "(AI unavailable.)"); setAiLoad(false); }

  if (loading) return <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">REGIME INTELLIGENCE</span></div><div className="bte-empty"><div className="bte-spin" />Classifying regimes (no look-ahead) &amp; splitting the ledger…</div></div>;
  if (!rep) return <div className="bte-pnl bte-tabstage"><div className="bte-ph"><span className="bte-pt">REGIME INTELLIGENCE</span></div><div className="bte-stage-body">Need a run with trades.</div></div>;
  return (
    <div className="bte-tabhost">
      <div className="bte-pnl bte-tab-wide">
        <div className="bte-ph"><span className="bte-pt">REGIME TIMELINE</span></div>
        <canvas ref={ribRef} style={{ width: "100%", height: 26, display: "block", borderRadius: 4 }} />
        <div className="btr-legend">{rep.regimes.map((r) => <span key={r.id}><i style={{ background: r.color }} />{r.label} <b>{r.barPct.toFixed(0)}%</b></span>)}</div>
      </div>
      <div className="bta-grid">
        <div className="bte-pnl bte-tab-wide">
          <div className="bte-ph"><span className="bte-pt">PERFORMANCE BY REGIME</span>{rep.worst && rep.worst.totalPnl < 0 && <span className="bte-count" style={{ color: "var(--ax-neg)" }}>loses in {rep.worst.label}</span>}</div>
          <table className="bte-ledger">
            <thead><tr><th>Regime</th><th>Bars</th><th>Trades</th><th>Win %</th><th>Total P/L</th><th>Avg Ret</th></tr></thead>
            <tbody>{rep.regimes.map((r) => (
              <tr key={r.id}><td><span className="btr-sw" style={{ background: r.color }} />{r.label}</td><td>{r.barPct.toFixed(0)}%</td><td>{r.trades}</td><td>{r.trades ? `${r.winRatePct.toFixed(0)}%` : "—"}</td><td style={{ color: sc(r.totalPnl) }}>{r.trades ? money(r.totalPnl) : "—"}</td><td style={{ color: sc(r.avgRetPct) }}>{r.trades ? pct(r.avgRetPct, 2) : "—"}</td></tr>
            ))}</tbody>
          </table>
          <button className="bte-b live" style={{ width: "100%", marginTop: 10 }} onClick={suggest} disabled={aiLoad}>{aiLoad ? "…" : "🧠 Suggest a regime filter"}</button>
          {ai && <div className="bta-ai">{ai}</div>}
        </div>
      </div>
    </div>
  );
}

/* ── 🛡️ ADVERSARIAL STRESS LAB (+ Ensemble) ── */
export function StressTab({ run, spec, config }: { run: BacktestRun; spec: BotSpec | null; config: BtConfig }) {
  const [stress, setStress] = useState<StressResult[] | null>(null);
  const [sLoad, setSLoad] = useState(false);
  const [ens, setEns] = useState<EnsembleResult | null>(null);
  const [eLoad, setELoad] = useState(false);
  const [rt, setRt] = useState(""); const [rtLoad, setRtLoad] = useState(false);
  const templates = useMemo(() => templateSpecs(1), []);

  async function runStress() { if (!spec) return; setSLoad(true); setStress(await runStressReplays(spec, config)); setSLoad(false); }
  async function runEns() { setELoad(true); setEns(await runEnsembleHRP(templates, config)); setELoad(false); }
  async function redTeam() {
    setRtLoad(true);
    const summary = `${config.strategyName} on ${config.symbol}: return ${run.metrics.totalReturnPct.toFixed(1)}%, Sharpe ${run.metrics.sharpe.toFixed(2)}, maxDD ${run.metrics.maxDrawdownPct.toFixed(1)}%, ${run.metrics.trades} trades, profit factor ${run.metrics.profitFactor.toFixed(2)}.`;
    const r = await forgeAdversary(summary, run.metrics as unknown as Record<string, number>);
    setRt((r && r.critique) || "(AI unavailable.)"); setRtLoad(false);
  }
  const avail = stress?.filter((s) => s.available && s.trades > 0) || [];
  const fragility = avail.length ? Math.min(100, Math.round(avail.reduce((s, w) => s + Math.max(0, -w.stratRetPct) * 0.6 + Math.abs(w.ddPct) * 0.8, 0) / avail.length)) : null;

  return (
    <div className="bte-tabhost">
      <div className="bta-grid">
        <div className="bte-pnl bte-tab-wide">
          <div className="bte-ph"><span className="bte-pt">🛡️ HISTORICAL CRASH REPLAYS</span><button className="bte-b sm" style={{ flex: "none" }} onClick={runStress} disabled={sLoad || !spec}>{sLoad ? "Running…" : "Run stress"}</button></div>
          {stress ? (
            <>
              <div className="bts-cards">{stress.map((w) => (
                <div key={w.id} className={`bts-card${w.available ? "" : " na"}`}>
                  <div className="bts-label">{w.label}</div>
                  {w.available ? <>
                    <div className="bts-ret" style={{ color: w.trades ? sc(w.stratRetPct) : "var(--ax-mut)" }}>{w.trades ? pct(w.stratRetPct) : "flat"}</div>
                    <div className="bts-mkt">market <b style={{ color: sc(w.marketRetPct) }}>{pct(w.marketRetPct)}</b></div>
                    <div className="bts-sub">{w.trades ? `DD ${pct(w.ddPct)} · ${w.trades} trades · ${w.exposurePct}% in-mkt` : "strategy sat out"}</div>
                  </> : <div className="bts-na">no data in range</div>}
                </div>
              ))}</div>
              <div className="bts-frag"><span>FRAGILITY SCORE (heuristic)</span><b style={{ color: fragility != null && fragility > 40 ? "var(--ax-neg)" : "var(--ax-warn)" }}>{fragility ?? "—"}{fragility != null ? "/100" : ""}</b><span className="bte-mc-note" style={{ marginLeft: "auto" }}>MC worst-case (P5): {run.mc ? money(run.mc.p5) : "—"}</span></div>
            </>
          ) : <div className="bte-stage-body">Replay the strategy through 2008 / 2015 / 2018 / 2020 / 2022 — real bars where the free feed reaches. Click <b>Run stress</b>.</div>}
          <button className="bte-b live" style={{ width: "100%", marginTop: 10 }} onClick={redTeam} disabled={rtLoad}>{rtLoad ? "…" : "🧠 AI red-team: how does this break?"}</button>
          {rt && <div className="bta-ai">{rt}</div>}
        </div>
      </div>
      <div className="bte-pnl">
        <div className="bte-ph"><span className="bte-pt">🌀 ENSEMBLE — HRP portfolio of strategies</span><button className="bte-b sm" style={{ flex: "none" }} onClick={runEns} disabled={eLoad}>{eLoad ? "…" : "Build"}</button></div>
        {ens ? (
          <>
            <div className="bte-perfrow"><span>Blended Sharpe</span><b style={{ color: sc(ens.blendedSharpe) }}>{num(ens.blendedSharpe)}</b></div>
            <div className="bte-perfrow"><span>Avg individual Sharpe</span><b>{num(ens.avgIndivSharpe)}</b></div>
            <div className="bte-perfrow"><span>Diversification benefit</span><b style={{ color: sc(ens.diversification) }}>{ens.diversification >= 0 ? "+" : ""}{num(ens.diversification)}</b></div>
            <div className="bte-perfrow"><span>Blended return / maxDD</span><b>{pct(ens.blendedRetPct)} / {pct(ens.blendedMaxDDPct)}</b></div>
            <div className="btr-legend" style={{ marginTop: 8 }}>{ens.legs.map((l) => <span key={l.name}>{l.name} <b>{l.weight}%</b></span>)}</div>
            <div className="bte-mc-note">HRP (López de Prado) weights across the {ens.legs.length} template strategies on {config.symbol}.</div>
          </>
        ) : <div className="bte-stage-body">Blend the template strategies into one HRP-weighted portfolio and measure the diversification benefit.</div>}
      </div>
    </div>
  );
}
