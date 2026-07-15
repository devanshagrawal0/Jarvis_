// APEX native quant engine — the NO-SIDECAR replacement for server/providers/apex/vibe-client.js.
// Exposes the SAME interface the sidecar bridge did (health / get / runBacktest / runCode) but runs
// natively in Jarvis Node: NL prompt → strategy (via our model gateway or keyword match) → native
// backtest (metrics + equity_curve + trade_log) → generated signal source. No Python, no port 8899.
//
// Inject { dataFetcher, callModel } from server.js:
//   dataFetcher(symbol, { interval, lookback }) → Promise<bars[]>  (optional; synthesises if absent)
//   callModel(prompt) → Promise<string>                            (optional; keyword match if absent)

const crypto = require("crypto");
const { runBacktest: engineRun } = require("./backtest");
const { listAlphas, getAlpha, ALPHAS } = require("./alphas");

const SKILLS = [
  { category: "strategy", items: ["momentum", "mean-reversion", "breakout", "ma-cross", "macd", "rsi", "bollinger", "dual-momentum"] },
  { category: "analysis", items: ["metrics", "equity-curve", "drawdown", "trade-stats", "benchmark"] },
  { category: "factors", items: ["alpha101", "ts-operators", "vol-scaling"] },
];

// Deterministic keyword → alpha mapping (fallback when no model is wired).
function keywordAlpha(prompt) {
  const p = String(prompt || "").toLowerCase();
  if (/mean.?revert|revert|oversold|bollinger/.test(p)) return /bollinger/.test(p) ? "bollinger_revert" : "meanrev_5";
  if (/rsi/.test(p)) return "rsi_revert_14";
  if (/macd/.test(p)) return "macd_trend";
  if (/breakout|donchian|channel/.test(p)) return "breakout_20";
  if (/cross|golden|moving average|\bma\b/.test(p)) return "ma_cross_10_30";
  if (/vol|risk.?adjust/.test(p)) return "vol_scaled_mom";
  if (/dual|absolute momentum/.test(p)) return "dual_momentum";
  if (/alpha.?1\b|alpha101|kakushadze/.test(p)) return "alpha101_001";
  return "mom_20"; // default: momentum
}
function keywordSymbol(prompt) {
  const m = String(prompt || "").toUpperCase().match(/\b(BTC|ETH|SOL|SPY|QQQ|AAPL|TSLA|NVDA|MSFT|AMZN|GOOG|META)\b/);
  return m ? m[1] : "SPY";
}

// Synthesise a realistic OHLCV series (geometric Brownian motion) so a backtest ALWAYS runs when no
// live data is available. Seeded by symbol so it's stable per symbol. Clearly flagged synthetic.
function synthBars(symbol, n = 500) {
  let seed = [...String(symbol || "SYN")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const bars = []; let px = 100; const start = Date.UTC(2023, 0, 2);
  for (let i = 0; i < n; i++) {
    const drift = 0.0003, vol = 0.015;
    const r = drift + vol * gauss();
    const open = px; px = Math.max(1, px * (1 + r));
    const high = Math.max(open, px) * (1 + Math.abs(gauss()) * 0.004);
    const low = Math.min(open, px) * (1 - Math.abs(gauss()) * 0.004);
    bars.push({ date: new Date(start + i * 86400000).toISOString().slice(0, 10), open: round(open, 2), high: round(high, 2), low: round(low, 2), close: round(px, 2), volume: Math.round(1e6 * (0.5 + rnd())) });
  }
  return bars;
}
function round(x, d) { const p = 10 ** d; return Math.round(x * p) / p; }

function alphaSource(alpha) {
  return `// APEX native SignalEngine — ${alpha.nickname} (${alpha.id})\n// Formula: ${alpha.formula}\n// Source: ${alpha.source}\n// compute(bars) -> target weight per bar (-1..1)\nexport function signal(bars) {\n  return APEX.alphas.${alpha.id}.compute(bars);\n}\n`;
}

function createVibeNativeEngine({ dataFetcher = null, callModel = null } = {}) {
  const runs = new Map(); // runId → run

  async function planStrategy(prompt, pinnedCode) {
    if (pinnedCode) { const m = String(pinnedCode).match(/alpha[^\s"']*|[a-z0-9_]+/i); const id = (getAlpha(pinnedCode) ? pinnedCode : (m && getAlpha(m[0]) ? m[0] : null)); if (id) return { alphaId: id, symbol: keywordSymbol(prompt), rationale: "pinned strategy", pinned: true }; }
    if (callModel) {
      try {
        const ids = ALPHAS.map((a) => a.id).join(", ");
        const out = await callModel(`You map a trading request to ONE strategy id and a symbol. Available strategy ids: ${ids}. Symbols like SPY, QQQ, BTC, AAPL, etc. Request: "${prompt}". Reply with ONLY compact JSON: {"alphaId":"<id>","symbol":"<SYMBOL>","rationale":"<one line>"}.`);
        const j = JSON.parse(String(out).match(/\{[\s\S]*\}/)?.[0] || "{}");
        if (j.alphaId && getAlpha(j.alphaId)) return { alphaId: j.alphaId, symbol: String(j.symbol || keywordSymbol(prompt)).toUpperCase(), rationale: j.rationale || "model-selected" };
      } catch { /* fall through to keyword match */ }
    }
    return { alphaId: keywordAlpha(prompt), symbol: keywordSymbol(prompt), rationale: "keyword match (no model)" };
  }

  async function getBars(symbol) {
    if (dataFetcher) { try { const b = await dataFetcher(symbol, { interval: "1D", lookback: 500 }); if (Array.isArray(b) && b.length > 30) return { bars: b, synthetic: false }; } catch { /* fall back */ } }
    return { bars: synthBars(symbol), synthetic: true };
  }

  async function runBacktest(prompt, opts = {}) {
    const plan = await planStrategy(prompt, opts.pinnedCode);
    const alpha = getAlpha(plan.alphaId) || getAlpha("mom_20");
    const { bars, synthetic } = await getBars(plan.symbol);
    const weights = alpha.compute(bars);
    const result = engineRun(bars, weights, { symbol: plan.symbol, initialCash: opts.initialCash || 100000 });
    const runId = `apex_${crypto.randomBytes(5).toString("hex")}`;
    const code = { primary: "signal_engine.js", code: alphaSource(alpha), files: { "signal_engine.js": alphaSource(alpha) } };
    const run = {
      run_id: runId, status: "success", symbol: plan.symbol, alpha: { id: alpha.id, nickname: alpha.nickname, formula: alpha.formula },
      rationale: plan.rationale, synthetic, dataSource: synthetic ? "synthetic (GBM — no live data wired)" : "live",
      metrics: result.metrics, equity_curve: result.equity_curve, trade_log: result.trade_log, bars: result.bars,
      generated_code: code.code,
    };
    runs.set(runId, run);
    return { ok: true, runId, status: "success", run, code, pinned: !!opts.pinnedCode, native: true };
  }

  async function runCode(runId) { const r = runs.get(runId); return r ? { primary: "signal_engine.js", code: r.generated_code, files: { "signal_engine.js": r.generated_code } } : null; }

  async function get(path) {
    if (path === "/alpha/list" || path === "/alpha") return { alphas: listAlphas(), count: ALPHAS.length, native: true };
    const mAlpha = path.match(/^\/alpha\/(.+)$/);
    if (mAlpha) {
      const id = decodeURIComponent(mAlpha[1]); const a = getAlpha(id);
      if (!a) return { error: "alpha not found", id };
      const { bars, synthetic } = await getBars("SPY");
      const result = engineRun(bars, a.compute(bars), { symbol: "SPY", initialCash: 100000 });
      return { id: a.id, nickname: a.nickname, theme: a.theme, formula: a.formula, source: a.source, synthetic, metrics: result.metrics, equity_curve: result.equity_curve.slice(-250) };
    }
    if (path === "/skills") return { skills: SKILLS, count: SKILLS.reduce((n, s) => n + s.items.length, 0), native: true };
    if (path === "/runs") return { runs: [...runs.values()].map((r) => ({ run_id: r.run_id, status: r.status, symbol: r.symbol })) };
    const mRun = path.match(/^\/runs\/(.+?)(\/code)?$/);
    if (mRun) { const r = runs.get(decodeURIComponent(mRun[1])); if (!r) return { error: "run not found" }; return mRun[2] ? { "signal_engine.js": r.generated_code } : r; }
    return { error: `unknown native route ${path}` };
  }

  async function health() {
    return { connected: true, status: "healthy", service: "APEX Native Quant", native: true, baseUrl: "in-process", skills: SKILLS.reduce((n, s) => n + s.items.length, 0), alphas: ALPHAS.length, llmConfigured: !!callModel };
  }

  return { base: "in-process", health, get, post: async () => ({ ok: true }), raw: get, runBacktest, runCode, native: true };
}

module.exports = { createVibeNativeEngine };
