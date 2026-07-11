/* THE FORGE — docked analysis dock (command-center).
   Sits under the node canvas. Six tabs, every one wired to a REAL engine output:
   Backtest Results · Monte Carlo · Parameter Heatmap · Walk-Forward Matrix ·
   Trade Distribution · Path Analysis. Heavy sweeps (heatmap / walk-forward) run
   lazily on first open and are cached. Pure SVG charts — no external libs. */

import { useEffect, useMemo, useRef, useState } from "react";
import type { BotSpec } from "./forge-spec";
import type { BacktestResult, MonteCarlo } from "./forge-engine";
import { runTerraform, type TerrainResult } from "./improver/terraform";
import { runSentinel, type SentinelResult } from "./improver/sentinel";
import { Icon } from "./ForgeIcons";
import { getVersions, diffSpecs, METRIC_KEYS } from "./forge-versions";

const TABS = ["Backtest Results", "Monte Carlo", "Parameter Heatmap", "Walk-Forward Matrix", "Trade Distribution", "Path Analysis", "History"] as const;
type Tab = typeof TABS[number];

// red → amber → green heat scale for t in [0,1]
const heat = (t: number) => `hsl(${Math.max(0, Math.min(1, t)) * 138} 68% ${28 + Math.max(0, Math.min(1, t)) * 20}%)`;

/* generic filled line chart in a 0..W × 0..H viewBox */
function Line({ data, w = 320, h = 128, color = "#7fd0ff", fillTop = 0.32, baseline0 }: { data: number[]; w?: number; h?: number; color?: string; fillTop?: number; baseline0?: boolean }) {
  if (data.length < 2) return <div className="dk-empty">no data</div>;
  const lo = baseline0 ? Math.min(0, ...data) : Math.min(...data), hi = baseline0 ? Math.max(0, ...data) : Math.max(...data);
  const rg = hi - lo || 1;
  const X = (i: number) => (i / (data.length - 1)) * (w - 4) + 2, Y = (v: number) => h - 4 - ((v - lo) / rg) * (h - 8);
  const line = data.map((v, i) => `${i ? "L" : "M"} ${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L ${X(data.length - 1).toFixed(1)} ${h} L ${X(0).toFixed(1)} ${h} Z`;
  const up = data[data.length - 1] >= data[0]; const c = color === "auto" ? (up ? "#4ade80" : "#f87171") : color;
  return (
    <svg className="dk-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs><linearGradient id={`dkg-${c.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c} stopOpacity={fillTop} /><stop offset="1" stopColor={c} stopOpacity="0" /></linearGradient></defs>
      <path d={area} fill={`url(#dkg-${c.replace(/[^a-z0-9]/gi, "")})`} />
      <path d={line} fill="none" stroke={c} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | "" }) {
  return <div className="dk-m"><span className="dk-m-l">{label}</span><span className={`dk-m-v ${tone || ""}`}>{value}</span></div>;
}

export function ForgeDock({ spec, result, mc }: { spec: BotSpec; result: BacktestResult; mc: MonteCarlo | null }) {
  const [tab, setTab] = useState<Tab>("Backtest Results");
  const m = result.metrics;
  const bySym = (result as unknown as { bySymbol?: { symbol: string; trades: number; pnl: number; retPct: number }[] }).bySymbol;

  // lazy heavy computations, cached per mount
  const [terra, setTerra] = useState<{ loading: boolean; res?: TerrainResult | null }>({ loading: false });
  const [wf, setWf] = useState<{ loading: boolean; res?: SentinelResult | null }>({ loading: false });
  const [va, setVa] = useState<number | null>(null);   // version-diff A/B selection
  const [vb, setVb] = useState<number | null>(null);
  const started = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (tab === "Parameter Heatmap" && !started.current.terra) { started.current.terra = true; setTerra({ loading: true }); runTerraform(spec).then(res => setTerra({ loading: false, res })); }
    if (tab === "Walk-Forward Matrix" && !started.current.wf) { started.current.wf = true; setWf({ loading: true }); runSentinel(spec, result).then(res => setWf({ loading: false, res })); }
  }, [tab, spec, result]);

  const tradeRets = useMemo(() => result.trades.map(t => t.retPct), [result]);
  const hist = useMemo(() => {
    if (tradeRets.length < 2) return null;
    const lo = Math.min(...tradeRets), hi = Math.max(...tradeRets), span = hi - lo || 1;
    const B = Math.min(17, Math.max(7, Math.round(Math.sqrt(tradeRets.length))));
    const bins = new Array(B).fill(0);
    tradeRets.forEach(r => { const k = Math.min(B - 1, Math.floor(((r - lo) / span) * B)); bins[k]++; });
    return { bins, lo, hi, B, max: Math.max(...bins) };
  }, [tradeRets]);
  const reasons = useMemo(() => { const r: Record<string, number> = {}; result.trades.forEach(t => { r[t.reason] = (r[t.reason] || 0) + 1; }); return Object.entries(r).sort((a, b) => b[1] - a[1]); }, [result]);

  return (
    <div className="forge-dock">
      <div className="cc-tabs dk-tabs">{TABS.map(t => <button key={t} className={"cc-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="dk-body">

        {tab === "Backtest Results" && <div className="dk-grid2">
          <div className="dk-metrics">
            <div className="dk-sec">Key Metrics <span>OOS</span></div>
            <Metric label="CAGR" value={(m.cagrPct >= 0 ? "+" : "") + m.cagrPct + "%"} tone={m.cagrPct >= 0 ? "pos" : "neg"} />
            <Metric label="Sharpe Ratio" value={String(m.sharpe)} tone={m.sharpe >= 1 ? "pos" : m.sharpe < 0 ? "neg" : ""} />
            <Metric label="Sortino Ratio" value={String(m.sortino)} tone={m.sortino >= 1.5 ? "pos" : ""} />
            <Metric label="Max Drawdown" value={m.maxDrawdownPct + "%"} tone="neg" />
            <Metric label="Calmar Ratio" value={String(m.calmar)} tone={m.calmar >= 1 ? "pos" : ""} />
            <Metric label="Win Rate" value={m.winRatePct + "%"} />
            <Metric label="Profit Factor" value={String(m.profitFactor)} tone={m.profitFactor >= 1.5 ? "pos" : ""} />
            <Metric label="Exposure" value={m.exposurePct + "%"} />
            <Metric label="Trades" value={String(m.trades)} />
          </div>
          <div className="dk-chart">
            <div className="dk-sec">Equity Curve <span>OOS</span></div>
            <Line data={result.equity.map(e => e.equity)} color="auto" h={150} />
            <div className="dk-note">{result.symbol} · {result.barsUsed} bars · next-bar-open fills, modeled slippage &amp; commission</div>
          </div>
          {bySym && bySym.length > 0 && <div style={{ gridColumn: "1 / -1" }}>
            <div className="dk-sec" style={{ marginTop: 4 }}>Contribution by Symbol <span>{bySym.length} traded</span></div>
            <div className="dk-bysym">{(() => { const mx = Math.max(...bySym.map(x => Math.abs(x.retPct)), 0.01); return bySym.map(x => { const pos = x.retPct >= 0; return <div key={x.symbol} className="dk-bysym-row"><span className="dk-bysym-s">{x.symbol}</span><div className="dk-bysym-bar"><i style={{ background: pos ? "var(--fg-pos)" : "var(--fg-neg)", width: (Math.abs(x.retPct) / mx * 50) + "%", left: pos ? "50%" : undefined, right: pos ? undefined : "50%" }} /></div><span className="dk-bysym-p" style={{ color: pos ? "var(--fg-pos)" : "var(--fg-neg)" }}>{pos ? "+" : ""}{x.retPct}% · {x.trades}t</span></div>; }); })()}</div>
          </div>}
        </div>}

        {tab === "Monte Carlo" && (mc ? (() => {
          const mean = mc.retP50, sd = Math.max(0.1, (mc.retP95 - mc.retP5) / 3.29);
          const x0 = mean - 3.2 * sd, x1 = mean + 3.2 * sd, W = 340, H = 150;
          const pts: string[] = [];
          for (let i = 0; i <= 60; i++) { const x = x0 + (i / 60) * (x1 - x0); const y = Math.exp(-((x - mean) ** 2) / (2 * sd * sd)); pts.push(`${(2 + (i / 60) * (W - 4)).toFixed(1)} ${(H - 4 - y * (H - 12)).toFixed(1)}`); }
          const px = (v: number) => 2 + ((v - x0) / (x1 - x0)) * (W - 4);
          return <div className="dk-grid2">
            <div className="dk-chart">
              <div className="dk-sec">Return Distribution <span>{mc.runs} runs</span></div>
              <svg className="dk-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <rect x={px(mc.retP5)} y="2" width={Math.max(0, px(mc.retP95) - px(mc.retP5))} height={H - 4} fill="rgba(56,189,208,.1)" />
                <polyline points={pts.join(" ")} fill="none" stroke="#38d6ee" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
                <line x1={px(mean)} y1="2" x2={px(mean)} y2={H - 2} stroke="#eaf3fb" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <line x1={px(0)} y1="2" x2={px(0)} y2={H - 2} stroke="rgba(248,113,113,.6)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="dk-note">Reshuffled trade sequence · median {mc.retP50 >= 0 ? "+" : ""}{mc.retP50}% · 95% range {mc.retP5}% → {mc.retP95}% (red line = breakeven)</div>
            </div>
            <div className="dk-metrics">
              <div className="dk-sec">Percentiles</div>
              <Metric label="Median Return" value={(mc.retP50 >= 0 ? "+" : "") + mc.retP50 + "%"} tone={mc.retP50 >= 0 ? "pos" : "neg"} />
              <Metric label="P5 (worst 5%)" value={(mc.retP5 >= 0 ? "+" : "") + mc.retP5 + "%"} tone={mc.retP5 >= 0 ? "pos" : "neg"} />
              <Metric label="P95 (best 5%)" value={"+" + mc.retP95 + "%"} tone="pos" />
              <Metric label="Drawdown P50" value={mc.ddP50 + "%"} tone="neg" />
              <Metric label="Drawdown P95" value={mc.ddP95 + "%"} tone="neg" />
              <Metric label="Prob. of Profit" value={mc.winProb + "%"} tone={mc.winProb >= 60 ? "pos" : mc.winProb < 40 ? "neg" : ""} />
            </div>
          </div>;
        })() : <div className="dk-empty">Need ≥3 trades for a Monte-Carlo distribution.</div>)}

        {tab === "Parameter Heatmap" && (terra.loading ? <div className="dk-loading"><span className="dk-spin"><Icon n="terra" size={22} /></span> Sweeping the parameter grid… 121 backtests</div>
          : terra.res ? (() => { const t = terra.res!; const rg = (t.fMax - t.fMin) || 1;
            return <div className="dk-heat">
              <div className="dk-sec">Parameter Heatmap <span>Sharpe · stop-loss × take-profit</span></div>
              <div className="dk-heat-wrap">
                <div className="dk-heat-y">take-profit %</div>
                <div className="dk-heat-grid" style={{ gridTemplateColumns: `repeat(${t.G},1fr)` }}>
                  {Array.from({ length: t.G }, (_, yi) => Array.from({ length: t.G }, (_, xi) => { const c = t.cells.find(c => c.xi === xi && c.yi === t.G - 1 - yi)!; const isBest = c === t.best;
                    return <div key={`${xi}-${yi}`} className={"dk-cell" + (isBest ? " best" : "")} style={{ background: heat((c.fitness - t.fMin) / rg) }} title={`SL ${c.xv}% · TP ${c.yv}% → Sharpe ${c.fitness}`} />; })).flat()}
                </div>
              </div>
              <div className="dk-heat-x">stop-loss %  →</div>
              <div className="dk-note">Best plateau: SL {t.best.xv}% · TP {t.best.yv}% → Sharpe {t.best.fitness} (robustness {(t.best.robust * 100).toFixed(0)}%). Green = higher risk-adjusted return; hunt broad plateaus, not spikes.</div>
            </div>; })()
          : <div className="dk-empty">Need ≥60 bars to sweep the landscape.</div>)}

        {tab === "Walk-Forward Matrix" && (wf.loading ? <div className="dk-loading"><span className="dk-spin"><Icon n="shield" size={22} /></span> Re-optimizing on rolling windows…</div>
          : wf.res ? (() => { const w = wf.res!.wf; const cells = w.oosWindows; const amax = Math.max(1, ...cells.map(Math.abs));
            return <div className="dk-wf">
              <div className="dk-grid2">
                <div className="dk-metrics">
                  <div className="dk-sec">Walk-Forward</div>
                  <Metric label="WF Efficiency" value={(w.wfe * 100).toFixed(0) + "%"} tone={w.wfe >= 0.5 ? "pos" : "neg"} />
                  <Metric label="In-Sample Sharpe" value={String(w.isSharpe)} />
                  <Metric label="Out-of-Sample Sharpe" value={String(w.oosSharpe)} tone={w.oosSharpe >= 0.5 ? "pos" : w.oosSharpe < 0 ? "neg" : ""} />
                  <Metric label="Windows" value={String(w.windows)} />
                </div>
                <div className="dk-chart">
                  <div className="dk-sec">OOS Sharpe · per window</div>
                  <div className="dk-wf-cells">{cells.length ? cells.map((v, i) => <div key={i} className="dk-wf-cell" style={{ background: v >= 0 ? `rgba(74,222,128,${0.18 + 0.55 * (v / amax)})` : `rgba(248,113,113,${0.18 + 0.55 * (Math.abs(v) / amax)})` }} title={`Window ${i + 1}: OOS Sharpe ${v}`}>{v}</div>) : <div className="dk-empty">not enough history for windows</div>}</div>
                  <div className="dk-note">{w.wfe >= 0.5 ? "Holds up out-of-sample — the edge survives re-optimization." : "Degrades out-of-sample — likely overfit to the training window."}</div>
                </div>
              </div>
            </div>; })()
          : <div className="dk-empty">Need ≥60 bars to run walk-forward.</div>)}

        {tab === "Trade Distribution" && (hist ? <div className="dk-grid2">
          <div className="dk-chart">
            <div className="dk-sec">Trade Returns <span>{tradeRets.length} trades</span></div>
            <div className="dk-hist">{hist.bins.map((c, i) => { const center = hist.lo + ((i + 0.5) / hist.B) * (hist.hi - hist.lo); return <div key={i} className="dk-bar-wrap" title={`${c} trades · ~${center.toFixed(1)}%`}><div className={"dk-bar " + (center >= 0 ? "pos" : "neg")} style={{ height: `${(c / hist.max) * 100}%` }} /></div>; })}</div>
            <div className="dk-axis"><span>{hist.lo.toFixed(1)}%</span><span>0</span><span>+{hist.hi.toFixed(1)}%</span></div>
          </div>
          <div className="dk-metrics">
            <div className="dk-sec">Trade Stats</div>
            <Metric label="Avg Win" value={"+" + m.avgWinPct + "%"} tone="pos" />
            <Metric label="Avg Loss" value={m.avgLossPct + "%"} tone="neg" />
            <Metric label="Best Trade" value={"+" + m.bestPct + "R"} tone="pos" />
            <Metric label="Worst Trade" value={m.worstPct + "R"} tone="neg" />
            <Metric label="Expectancy" value={m.expectancy + "R"} tone={m.expectancy >= 0 ? "pos" : "neg"} />
            <div className="dk-sec" style={{ marginTop: 8 }}>Exit Reasons</div>
            {reasons.map(([r, n]) => <div key={r} className="dk-reason"><span>{r}</span><div className="dk-reason-bar"><i style={{ width: `${(n / result.trades.length) * 100}%` }} /></div><span>{n}</span></div>)}
          </div>
        </div> : <div className="dk-empty">Need ≥2 trades for a distribution.</div>)}

        {tab === "Path Analysis" && <div className="dk-path">
          <div className="dk-sec">Equity Path</div>
          <Line data={result.equity.map(e => e.equity)} color="auto" h={112} />
          <div className="dk-sec" style={{ marginTop: 8 }}>Underwater · drawdown</div>
          <Line data={result.equity.map(e => -Math.abs(e.drawdown))} color="#f87171" h={78} baseline0 />
          <div className="dk-path-stats">
            <Metric label="Max Drawdown" value={m.maxDrawdownPct + "%"} tone="neg" />
            <Metric label="Longest DD" value={m.maxDDbars + " bars"} />
            <Metric label="Time in Market" value={m.exposurePct + "%"} />
            <Metric label="Volatility" value={m.volPct + "%"} />
          </div>
        </div>}

        {tab === "History" && (() => {
          const versions = getVersions(spec.meta.id);
          if (!versions.length) return <div className="dk-empty">No versions yet. Every Save or adopted change snapshots the strategy here, so you can diff any two and see if it helped.</div>;
          const A = (va != null && versions.find(v => v.v === va)) || versions[Math.max(0, versions.length - 2)];
          const B = (vb != null && versions.find(v => v.v === vb)) || versions[versions.length - 1];
          const diffs = A && B ? diffSpecs(A.spec, B.spec) : [];
          return <div className="dk-hist">
            <div className="dk-sec">Version History <span>{versions.length} snapshots · pick A &amp; B to compare</span></div>
            <div className="dk-hist-list">
              {versions.slice().reverse().map(v => <div key={v.v} className={"dk-hist-row" + (A && A.v === v.v ? " sa" : "") + (B && B.v === v.v ? " sb" : "")}>
                <span className="dk-hist-v">v{v.v}</span>
                <span className="dk-hist-note">{v.note}</span>
                <span className="dk-hist-mm">{v.metrics?.sharpe != null ? `Sh ${v.metrics.sharpe}` : "—"}{v.metrics?.cagrPct != null ? ` · ${v.metrics.cagrPct >= 0 ? "+" : ""}${v.metrics.cagrPct}%` : ""}</span>
                <button className={"dk-hist-pick" + (A && A.v === v.v ? " on" : "")} onClick={() => setVa(v.v)} title="Set as A">A</button>
                <button className={"dk-hist-pick" + (B && B.v === v.v ? " on" : "")} onClick={() => setVb(v.v)} title="Set as B">B</button>
              </div>)}
            </div>
            {A && B && A.v !== B.v && <div className="dk-diff">
              <div className="dk-sec" style={{ marginTop: 11 }}>Diff · v{A.v} → v{B.v}</div>
              <div className="dk-diff-metrics">{METRIC_KEYS.map(([lbl, key, hi]) => { const av = A.metrics?.[key], bv = B.metrics?.[key]; if (av == null || bv == null) return null; const dlt = +(bv - av).toFixed(2); const better = hi ? dlt >= 0 : dlt <= 0; return <div key={key} className="dk-diff-m"><span className="dk-diff-ml">{lbl}</span><span className={dlt === 0 ? "" : better ? "pos" : "neg"}>{av} → {bv} ({dlt >= 0 ? "+" : ""}{dlt})</span></div>; })}</div>
              {diffs.length ? diffs.map((d, i) => <div key={i} className="dk-diff-row"><span className="dk-diff-p">{d.path}</span><span className="dk-diff-f">{d.from}</span><span className="dk-diff-ar">→</span><span className="dk-diff-t">{d.to}</span></div>) : <div className="dk-note">The specs are identical — only the backtest differs.</div>}
            </div>}
          </div>;
        })()}

      </div>
    </div>
  );
}
