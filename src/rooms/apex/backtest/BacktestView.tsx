import { useEffect, useRef, useState } from "react";

// APEX · Backtesting — the flagship agentic room. A plain-English strategy goes
// to the Vibe-Trading engine (agent plans → generates code → runs it in the
// sandbox) and returns metrics + a 501-point equity curve. Styled with the
// shared Apex theme vars so it sits seamlessly next to Home / Scanner.

const EXAMPLES = [
  "Backtest a 50/200-day SMA crossover on AAPL from 2022-01-01 to 2024-01-01: long when the 50-day SMA is above the 200-day, else flat.",
  "Backtest an RSI(14) mean-reversion on SPY, 2021–2024: buy when RSI < 30, sell when RSI > 70.",
  "Backtest a 20-day Bollinger-band breakout on TSLA, 2022–2024: long on a close above the upper band, exit on a close below the middle band.",
];
const PROGRESS = ["Planning the strategy…", "Generating the code…", "Running it in the sandbox…", "Scoring the results…"];

const pct = (v: any) => (v == null || isNaN(Number(v)) ? "—" : `${(Number(v) * 100).toFixed(1)}%`);
const num = (v: any, d = 2) => (v == null || isNaN(Number(v)) ? "—" : Number(v).toFixed(d));
const signCol = (v: any) => (Number(v) >= 0 ? "var(--ax-pos)" : "var(--ax-neg)");

function EquityChart({ curve }: { curve: any[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const pts = (curve || []).map((p) => Number(p.equity)).filter((v) => Number.isFinite(v));
    if (pts.length < 2) return;
    const lo = Math.min(...pts), hi = Math.max(...pts), rg = hi - lo || 1;
    const X = (i: number) => (i / (pts.length - 1)) * (w - 10) + 5;
    const Y = (v: number) => h - 12 - ((v - lo) / rg) * (h - 24);
    const up = pts[pts.length - 1] >= pts[0];
    const col = up ? "#34d399" : "#f43f5e";
    // baseline (starting equity)
    ctx.strokeStyle = "rgba(150,190,225,.18)"; ctx.setLineDash([3, 4]); ctx.beginPath();
    ctx.moveTo(5, Y(pts[0])); ctx.lineTo(w - 5, Y(pts[0])); ctx.stroke(); ctx.setLineDash([]);
    // area
    ctx.beginPath(); ctx.moveTo(X(0), h); pts.forEach((v, i) => ctx.lineTo(X(i), Y(v))); ctx.lineTo(X(pts.length - 1), h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, col + "3a"); g.addColorStop(1, col + "00"); ctx.fillStyle = g; ctx.fill();
    // line
    ctx.beginPath(); pts.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
    ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;
    const ex = X(pts.length - 1), ey = Y(pts[pts.length - 1]);
    ctx.beginPath(); ctx.arc(ex, ey, 3, 0, 7); ctx.fillStyle = "#fff"; ctx.fill();
  }, [curve]);
  return <canvas ref={ref} className="axb-canvas" />;
}

export function BacktestView() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const [engine, setEngine] = useState<{ connected: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/apex/engine/health").then((r) => r.json()).then(setEngine).catch(() => setEngine({ connected: false }));
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setStep((s) => (s + 1) % PROGRESS.length), 4000);
    return () => clearInterval(t);
  }, [running]);

  // pinnedCode: re-run the exact strategy the agent wrote last time. Without it
  // the same prompt regenerates the strategy from scratch, so results move for
  // reasons that have nothing to do with the market.
  const run = (pinnedCode: string | null = null) => {
    const p = prompt.trim();
    if (!p || running) return;
    setRunning(true); setError(""); setResult(null); setStep(0);
    fetch("/api/apex/engine/backtest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: p, ...(pinnedCode ? { pinnedCode } : {}) }),
    })
      .then((r) => r.json())
      .then((d) => { if (d?.run?.metrics) setResult(d); else setError(d?.error || "The engine didn't return a result."); })
      .catch((e) => setError(e.message || "Request failed."))
      .finally(() => setRunning(false));
  };

  const m = result?.run?.metrics || {};
  const curve = result?.run?.equity_curve || [];
  const code: string = result?.code?.code || "";
  const codeName: string = result?.code?.primary || "strategy.py";

  return (
    <div className="ax-bt">
      <style>{BT_CSS}</style>
      <div className="axb-head">
        <span className="axb-title">◈ BACKTESTING</span>
        <span className="axb-sub">plain-English strategy → sandboxed run</span>
        <div className="axb-engine">
          <span className={`axb-dot${engine?.connected ? " on" : ""}`} />
          {engine?.connected ? "Engine connected" : "Engine offline"}
        </div>
      </div>

      {/* Composer */}
      <div className="axb-composer">
        <textarea className="axb-input" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a strategy to backtest — instrument, rules, date range…" rows={2} />
        {/* () => run() — a bare onClick={run} would hand the MouseEvent in as pinnedCode */}
        <button className="axb-run" onClick={() => run()} disabled={running || !engine?.connected}>
          {running ? "Running…" : "▶ Run backtest"}
        </button>
      </div>
      <div className="axb-examples">
        {EXAMPLES.map((ex, i) => (
          <button key={i} className="axb-eg" onClick={() => setPrompt(ex)} title={ex}>{ex.replace(/^Backtest an? /, "").split(":")[0]}</button>
        ))}
      </div>

      {/* Body */}
      <div className="axb-body">
        {running ? (
          <div className="axb-running">
            <div className="axb-spin" />
            <div className="axb-run-t">{PROGRESS[step]}</div>
            <div className="axb-run-s">The agent is working — this usually takes 10–30 seconds.</div>
          </div>
        ) : error ? (
          <div className="axb-empty axb-err">⚠ {error}{!engine?.connected ? " — start the engine with ./scripts/vibe-up.sh" : ""}</div>
        ) : !result ? (
          <div className="axb-empty">Describe a strategy above and hit <b>Run backtest</b>. The agent generates and runs the code, then shows the metrics and equity curve.</div>
        ) : (
          <>
            <div className="axb-metrics">
              {metric("TOTAL RETURN", pct(m.total_return), signCol(m.total_return))}
              {metric("CAGR", pct(m.annual_return), signCol(m.annual_return))}
              {metric("SHARPE", num(m.sharpe), "var(--ax-tx)")}
              {metric("MAX DRAWDOWN", pct(m.max_drawdown), "var(--ax-neg)")}
              {metric("WIN RATE", pct(m.win_rate), "var(--ax-tx)")}
              {metric("SORTINO", num(m.sortino), "var(--ax-tx)")}
              {metric("CALMAR", num(m.calmar), "var(--ax-tx)")}
              {metric("VS BENCHMARK", pct(m.excess_return), signCol(m.excess_return))}
              {metric("TRADES", num(m.trade_count, 0), "var(--ax-tx)")}
            </div>
            <div className="axb-chart-wrap">
              <div className="axb-sec-h">EQUITY CURVE {curve.length ? `· ${curve[0]?.time} → ${curve[curve.length - 1]?.time}` : ""}</div>
              <EquityChart curve={curve} />
            </div>
            {/* The agent writes a fresh strategy per run, so the same prompt can
                score differently for reasons unrelated to the market. Show what
                was ACTUALLY tested, and allow re-running it verbatim. */}
            {code && (
              <div className="axb-code-wrap">
                <div className="axb-sec-h axb-code-h">
                  <span>STRATEGY THE AGENT WROTE <em>{codeName}</em>{result?.pinned && <b className="axb-pin"> · pinned</b>}</span>
                  <button className="axb-repin" onClick={() => run(code)} disabled={running}>↻ Re-run this exact code</button>
                </div>
                <pre className="axb-code">{code.trim()}</pre>
                <div className="axb-code-note">
                  {result?.pinned
                    ? "This run used the pinned code above — no regeneration, so the result is repeatable."
                    : "A plain re-run regenerates this from the prompt and may differ. Pin it to compare like for like."}
                </div>
              </div>
            )}
            <div className="axb-foot">
              Ran in {num(result?.run?.elapsed_seconds, 1)}s on the Vibe-Trading sandbox · benchmark return {pct(m.benchmark_return)} · avg hold {num(m.avg_holding_days, 0)}d.
              Simulated backtest — past performance is not indicative of future results. Informational, not financial advice.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function metric(label: string, value: string, color: string) {
  return (
    <div className="axb-m">
      <div className="axb-m-l">{label}</div>
      <div className="axb-m-v" style={{ color }}>{value}</div>
    </div>
  );
}

const BT_CSS = `
.ax-bt { height:100%; display:flex; flex-direction:column; gap:13px; padding:2px 2px 8px; font-family:var(--ax-sans); color:var(--ax-tx); min-height:0; }
.axb-head { display:flex; align-items:baseline; gap:12px; }
.axb-title { font-family:var(--ax-disp); font-size:15px; font-weight:800; letter-spacing:.12em; color:var(--ax-acc); }
.axb-sub { font-size:11px; color:var(--ax-mut); }
.axb-engine { margin-left:auto; display:flex; align-items:center; gap:7px; font-size:10.5px; font-weight:700; letter-spacing:.06em; color:var(--ax-mut); padding:4px 11px; border:1px solid var(--ax-bd); border-radius:20px; background:var(--ax-panel); }
.axb-dot { width:7px; height:7px; border-radius:50%; background:var(--ax-neg); box-shadow:0 0 6px var(--ax-neg); }
.axb-dot.on { background:var(--ax-pos); box-shadow:0 0 7px var(--ax-posglow); }
.axb-composer { display:flex; gap:10px; align-items:stretch; }
.axb-input { flex:1; background:var(--ax-surface); border:1px solid var(--ax-bd); border-radius:11px; padding:11px 13px; color:var(--ax-tx); font-size:12.5px; line-height:1.5; font-family:var(--ax-sans); outline:none; resize:none; }
.axb-input::placeholder { color:var(--ax-dim); }
.axb-run { flex:0 0 auto; padding:0 20px; border-radius:11px; cursor:pointer; background:color-mix(in srgb, var(--ax-acc) 16%, transparent); border:1px solid var(--ax-bdglow); color:var(--ax-acc); font-family:var(--ax-sans); font-size:13px; font-weight:800; letter-spacing:.03em; white-space:nowrap; }
.axb-run:disabled { opacity:.5; cursor:default; }
.axb-examples { display:flex; gap:6px; flex-wrap:wrap; }
.axb-eg { font-size:10px; padding:4px 10px; border-radius:14px; cursor:pointer; background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); font-family:var(--ax-sans); max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.axb-eg:hover { border-color:var(--ax-bd); color:var(--ax-cydim); }
.axb-body { flex:1; min-height:0; overflow-y:auto; }
.axb-empty { color:var(--ax-mut); font-size:12.5px; line-height:1.6; padding:26px 4px; max-width:640px; }
.axb-empty b { color:var(--ax-acc); }
.axb-err { color:var(--ax-neg); }
.axb-running { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; height:100%; min-height:220px; }
.axb-spin { width:34px; height:34px; border-radius:50%; border:2.5px solid var(--ax-bdsoft); border-top-color:var(--ax-acc); animation:axb-rot .9s linear infinite; }
@keyframes axb-rot { to { transform:rotate(360deg); } }
.axb-run-t { font-size:14px; font-weight:600; color:var(--ax-tx); }
.axb-run-s { font-size:11px; color:var(--ax-mut); }
.axb-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:9px; margin-bottom:14px; }
.axb-m { background:var(--ax-elev); border:1px solid var(--ax-bdsoft); border-radius:10px; padding:10px 12px; }
.axb-m-l { font-size:8px; letter-spacing:.08em; color:var(--ax-dim); margin-bottom:5px; }
.axb-m-v { font-family:var(--ax-disp); font-size:20px; font-weight:800; }
.axb-chart-wrap { background:var(--ax-panel); border:1px solid var(--ax-bd); border-radius:13px; padding:14px 16px; }
.axb-sec-h { font-size:9px; font-weight:700; letter-spacing:.1em; color:var(--ax-cydim); margin-bottom:10px; }
.axb-canvas { width:100%; height:220px; display:block; }
.axb-code-wrap { margin-top:14px; }
.axb-code-h { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.axb-code-h em { font-style:normal; font-family:var(--ax-mono); color:var(--ax-dim); font-weight:500; margin-left:6px; }
.axb-pin { color:var(--ax-pos); font-weight:700; }
.axb-repin { background:transparent; border:1px solid var(--ax-bdsoft); color:var(--ax-mut); border-radius:7px; padding:4px 11px; font-size:10px; cursor:pointer; font-family:var(--ax-sans); }
.axb-repin:hover { border-color:var(--ax-bdglow); color:var(--ax-acc); }
.axb-repin:disabled { opacity:.4; cursor:not-allowed; }
.axb-code { margin-top:7px; max-height:260px; overflow:auto; background:var(--ax-surface); border:1px solid var(--ax-bdsoft); border-radius:9px; padding:11px 13px; font-family:var(--ax-mono); font-size:10.5px; line-height:1.55; color:var(--ax-tx); white-space:pre; }
.axb-code-note { font-size:9px; color:var(--ax-dim); margin-top:6px; line-height:1.5; }
.axb-foot { font-size:9.5px; color:var(--ax-dim); line-height:1.6; margin-top:12px; }
`;
