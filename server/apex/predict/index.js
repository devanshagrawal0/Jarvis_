// APEX Oracle — the native multi-horizon prediction engine. Orchestrates regime → forecast →
// options → self-check → store, and runs the refresh/resolve/self-correct loop. No sidecar.
//
// Inject { getBars, priceAt, callModel } from server.js:
//   getBars(symbol, {interval,range}) -> Promise<bars[]>  ({t,o,h,l,c,v})
//   priceAt(symbol, targetMs)         -> Promise<number|null>  (realized close at/after target)
//   callModel(prompt)                 -> Promise<string>       (Jarvis; optional)

const { detectRegime } = require("./regime");
const { forecast, HORIZONS } = require("./forecast");
const { recommendContract } = require("./options");
const { selfCheck } = require("./selfcheck");
const { scorePrediction, updateCalibration } = require("./calibration");
const { createOracleStore } = require("./store");
const { buildPackages } = require("./signals");
const { fuse } = require("./ensemble");
const { computeQuant } = require("./phd");
const { bs } = require("./options");
const { clamp } = require("./mathx");

const MODEL_VER = "oracle-1.0";
const MS = { "1h": 3.6e6, "5h": 1.8e7, "12h": 4.32e7, "1d": 8.64e7, "5d": 4.32e8 };

// The LLM gives a 1-day P(up); scale conviction by horizon (shrink toward 0.5 for short, hold/expand for long).
function horizonScaleLLM(pUp1d, tau) {
  const k = Math.sqrt(tau / 6.5); // 1d = tau 6.5 → k=1
  return clamp(0.5 + (pUp1d - 0.5) * clamp(k, 0.4, 1.4), 0.02, 0.98);
}

// ── The Verdict Compiler — aggregates every engine output into a labelled buy/sell signal
// with bullet-point proof (numbers). This is the "algo" that decides. ──
function compileReport(p) {
  const h1 = p.horizons.find((h) => h.horizon === "1d") || p.horizons[0];
  const h5 = p.horizons.find((h) => h.horizon === "5d") || p.horizons[p.horizons.length - 1];
  const q = p.quant || {}; const sd = p.signalDetail || {}; const pk = p.packages || {};
  const pUp = h1.pUp * 0.4 + h5.pUp * 0.6;               // blended probability up
  const conf = (h1.confidence + h5.confidence) / 2;
  const bull = (v) => (v > 0.08 ? 1 : v < -0.08 ? -1 : 0);
  const pctTxt = (v) => `${v >= 0 ? "+" : ""}${(v).toFixed(1)}%`;

  // Caution flags
  const flags = [];
  if (p.regime.label === "HIGH_VOL") flags.push("High-volatility regime — expect wider swings");
  if (q.changePoint && q.changePoint.alarm) flags.push("Regime-change alarm (CUSUM) — market structure is shifting");
  if (h5.disagreement > 0.14) flags.push("Models disagree — lower conviction");
  if (q.varCvar && Math.abs(q.varCvar.var95) > 4) flags.push(`Elevated tail risk (VaR ${q.varCvar.var95}%/day)`);
  if (Math.abs(pUp - 0.5) < 0.03) flags.push("Edge is thin — close to a coin-flip");

  // Signal label (the algo verdict)
  let label, tone;
  if (pUp >= 0.60 && conf > 0.45 && flags.length === 0) { label = "STRONG BUY"; tone = "pos"; }
  else if (pUp >= 0.55) { label = "BUY"; tone = "pos"; }
  else if (pUp >= 0.515) { label = "ACCUMULATE"; tone = "pos"; }
  else if (pUp > 0.485) { label = "HOLD / NEUTRAL"; tone = "neutral"; }
  else if (pUp > 0.45) { label = "CAUTION"; tone = "warn"; }
  else if (pUp > 0.40) { label = "REDUCE"; tone = "neg"; }
  else { label = "STRONG SELL"; tone = "neg"; }
  // downgrade a bullish call when multiple red flags fire
  if (flags.length >= 2 && tone === "pos") { label = "CAUTION — mixed signals"; tone = "warn"; }

  const dirMag = h5.predRet;
  const direction = dirMag > 1 ? "UP" : dirMag < -1 ? "DOWN" : "STABLE";

  const sections = [
    { title: "TECHNICALS", score: pk.technical ?? 0, bullets: [
      { t: `Regime: ${p.regime.label.replace("_", " ")}${p.regime.adx != null ? ` (ADX ${p.regime.adx.toFixed(0)} — ${p.regime.adx > 25 ? "trending" : "choppy"})` : ""}`, dir: bull(p.regime.trendScore) },
      { t: `Trend persistence: Hurst ${p.regime.hurst.toFixed(2)} — ${p.regime.hurst > 0.55 ? "trend-following favored" : p.regime.hurst < 0.45 ? "mean-reversion favored" : "random walk"}`, dir: p.regime.hurst > 0.55 ? bull(p.regime.trendScore) : 0 },
      { t: `Technical composite: ${(pk.technical ?? 0).toFixed(2)} on a −1…+1 scale`, dir: bull(pk.technical ?? 0) },
      { t: `Volatility: ${q.garch ? (q.garch.sigmaNow * 100 * Math.sqrt(6.5 * 252)).toFixed(0) + "% annualized (GARCH)" : "—"}${q.varCvar ? `, 1-day VaR ${q.varCvar.var95}%` : ""}`, dir: 0 },
    ] },
    { title: "NEWS & SENTIMENT", score: pk.news ?? 0, bullets: [
      { t: sd.news ? `${sd.news.count} recent headlines · net tone ${(pk.news ?? 0) >= 0.05 ? "positive" : (pk.news ?? 0) <= -0.05 ? "negative" : "neutral"} (${(pk.news ?? 0).toFixed(2)})` : "No symbol-tagged headlines in the current feed", dir: bull(pk.news ?? 0) },
    ] },
    { title: "PEERS & SECTOR", score: (pk.peer ?? 0) * 0.5 + (pk.sector ?? 0) * 0.5, bullets: [
      { t: sd.sector ? `Sector ETF ${sd.sector.etf}: momentum ${pctTxt(sd.sector.etfMom)}, correlation ${sd.sector.rho.toFixed(2)} — ${sd.sector.etfMom >= 0 ? "tailwind" : "headwind"}` : "Sector data unavailable", dir: bull(pk.sector ?? 0) },
      { t: (sd.peers || []).length ? `Peers: ${(sd.peers || []).slice(0, 3).map((x) => `${x.sym} ${pctTxt(x.mom)}`).join(", ")}` : "No peers mapped", dir: bull(pk.peer ?? 0) },
      { t: `Cross-asset signal: ${(pk.peer ?? 0).toFixed(2)} (convergence pressure vs peers)`, dir: bull(pk.peer ?? 0) },
    ] },
    { title: "MACRO & RISK", score: pk.macro ?? 0, bullets: [
      { t: sd.macro ? `VIX ${sd.macro.vix ?? "—"}, 10y-yield trend ${sd.macro.tnxTrend}, USD trend ${sd.macro.usdTrend} → macro ${(pk.macro ?? 0).toFixed(2)}` : `Macro score ${(pk.macro ?? 0).toFixed(2)}`, dir: bull(pk.macro ?? 0) },
      { t: q.varCvar ? `Downside: 5% of days lose more than ${q.varCvar.var95}%; worst-case (CVaR) ${q.varCvar.cvar95}%` : "Risk metrics unavailable", dir: -1 },
    ] },
  ];

  return {
    signal: { label, tone },
    verdict: { direction, magnitudePct: +Math.abs(dirMag).toFixed(1), horizon: "5-day", pUp: +(pUp * 100).toFixed(0), confidence: +(conf * 100).toFixed(0) },
    forecast: { d1: { dir: h1.dir, pUp: +(h1.pUp * 100).toFixed(0), ret: +h1.predRet.toFixed(1) }, d5: { dir: h5.dir, pUp: +(h5.pUp * 100).toFixed(0), ret: +h5.predRet.toFixed(1) } },
    crossScore: +(p.crossScore ?? 0).toFixed(2),
    sections, flags,
    summary: `${p.symbol}: ${label}. The model sees ${direction === "STABLE" ? "roughly flat" : direction.toLowerCase()} price action ~${pctTxt(dirMag)} over 5 days (${(pUp * 100).toFixed(0)}% chance up, ${(conf * 100).toFixed(0)}% confidence). ${flags.length ? "Watch: " + flags[0] + "." : "Signals are aligned."}`,
  };
}

// Deterministic synthesis when the LLM is unavailable — a real read from the numeric signals.
function deterministicThesis(symbol, regime, fc, sig) {
  const oneDay = fc.horizons.find((h) => h.horizon === "1d") || fc.horizons[0];
  const bias = sig.crossScore > 0.12 ? "bullish" : sig.crossScore < -0.12 ? "bearish" : "neutral";
  const parts = [];
  parts.push(`${regime.label.replace("_", " ").toLowerCase()} regime (conf ${(regime.confidence * 100).toFixed(0)}%)`);
  const strong = Object.entries(sig.packages || {}).filter(([, v]) => Math.abs(v) > 0.2).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2);
  if (strong.length) parts.push(strong.map(([k, v]) => `${v >= 0 ? "positive" : "negative"} ${k}`).join(" and "));
  parts.push(`1-day P(up) ${(oneDay.pUp * 100).toFixed(0)}%`);
  const thesis = `${bias === "bullish" ? "Constructive" : bias === "bearish" ? "Cautious" : "Two-sided"} read — ${parts.join(", ")}. ${regime.hurst > 0.55 ? "Persistent tape favors trend-following." : regime.hurst < 0.45 ? "Anti-persistent tape favors fading extremes." : "Random-walk tape; edge is thin."}`;
  return { pUp: oneDay.pUp, bias, thesis, source: "deterministic" };
}

function createOracle({ runtimeDir, getBars, priceAt, getNews = null, callModel = null }) {
  const store = createOracleStore(runtimeDir);

  // One Jarvis synthesis call → { pUp, bias, thesis }. Deterministic fallback if unavailable.
  async function synthesize(symbol, regime, fc, sig) {
    if (!callModel) return null;
    const brief = {
      symbol, spot: +fc.spot.toFixed(2), regime: regime.label, regimeConf: +regime.confidence.toFixed(2),
      hurst: +regime.hurst.toFixed(2), adx: regime.adx ? +regime.adx.toFixed(1) : null,
      crossScore: +sig.crossScore.toFixed(2), packages: Object.fromEntries(Object.entries(sig.packages).map(([k, v]) => [k, +v.toFixed(2)])),
      forecast1d: { dir: fc.horizons.find((h) => h.horizon === "1d")?.dir, pUp: +(fc.horizons.find((h) => h.horizon === "1d")?.pUp || 0.5).toFixed(2), ret5d: +(fc.horizons.find((h) => h.horizon === "5d")?.predRet || 0).toFixed(2) },
    };
    try {
      const raw = await callModel(`You are APEX Oracle's quant synthesis layer. Given this numeric brief, reply with ONLY raw compact JSON (no prose, no code fences): {"pUp":<0..1 prob the stock is higher in 1 day>,"bias":"bullish|bearish|neutral","thesis":"<=2 sentence rationale citing the strongest signals"}. Brief: ${JSON.stringify(brief)}`);
      const cleaned = String(raw || "").replace(/```(?:json)?/gi, "").trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { const j = JSON.parse(m[0]); if (Number.isFinite(j.pUp)) return { pUp: clamp(j.pUp, 0.02, 0.98), bias: j.bias || "neutral", thesis: String(j.thesis || "").slice(0, 400), source: "jarvis" }; }
    } catch { /* fall through to deterministic */ }
    return null;
  }

  async function computeForecast(symbol) {
    const bars = await getBars(symbol, { interval: "60m", range: "60d" });
    if (!Array.isArray(bars) || bars.length < 40) return { ok: false, reason: "insufficient bars", symbol };
    const regime = detectRegime(bars);
    const cals = {}; for (const h of HORIZONS) cals[h.key] = store.getCalibration(symbol, h.key) || undefined;
    const fc = forecast(bars, regime, cals);
    if (!fc.ok) return { ok: false, reason: fc.reason, symbol };
    // signal packages → crossScore (best-effort; tolerant of fetch failures)
    let sig = { crossScore: regime.trendScore, packages: { technical: regime.trendScore, news: 0, peer: 0, sector: 0, macro: 0 }, detail: {}, weights: {} };
    try { sig = await buildPackages(symbol, bars, { getBars, getNews }); } catch { /* keep technical fallback */ }
    // Jarvis synthesis (one call); deterministic fallback so the panel is never empty.
    let llm = await synthesize(symbol, regime, fc, sig);
    if (!llm) llm = deterministicThesis(symbol, regime, fc, sig);
    const pCross = clamp(0.5 + 0.5 * sig.crossScore, 0.02, 0.98);
    // ensemble per horizon (technical GBM view + cross-asset view + LLM view)
    for (const h of fc.horizons) {
      const cal = cals[h.key];
      const brierTech = cal ? cal.mean_brier : 0.25;
      const views = [ { p: h.pUp, brier: brierTech }, { p: pCross, brier: 0.24 } ];
      if (llm) views.push({ p: horizonScaleLLM(llm.pUp, h.tau), brier: 0.23 });
      const ens = fuse(views);
      h.pUpModel = h.pUp; h.pUp = ens.p; h.dir = ens.p >= 0.5 ? "LONG" : "SHORT"; h.edge = Math.abs(ens.p - 0.5) * 2;
      h.disagreement = +ens.spread.toFixed(3);
      // widen intervals by ensemble disagreement
      const infl = 1 + Math.min(0.6, ens.spread * 1.2);
      const mid = h.p50; ["p05", "p25", "p75", "p95"].forEach((q) => { h[q] = mid * Math.pow(h[q] / mid, infl); });
      h.option = recommendContract(h, { r: 0.045, q: 0 });
      const coverageHealth = cal ? 1 - Math.abs((cal.cov90 ?? 0.9) - 0.9) : 0.85;
      h.confidence = Math.max(0.05, Math.min(0.95, regime.confidence * 0.35 + coverageHealth * 0.25 + h.edge * 0.2 + (1 - ens.spread) * 0.2));
      h.calibrated = !!cal;
    }
    let quant = null; try { quant = computeQuant(bars); } catch { /* optional */ }
    const payload = { ok: true, symbol, asOf: null, spot: fc.spot, regime, muBar: fc.muBar, sigBar: fc.sigBar, ou: fc.ou, g: fc.g, horizons: fc.horizons, crossScore: sig.crossScore, packages: sig.packages, signalDetail: sig.detail, weights: sig.weights, jarvis: llm, quant, model_ver: MODEL_VER };
    try { payload.report = compileReport(payload); } catch { payload.report = null; }
    const sc = selfCheck(payload);
    payload.selfCheck = sc; payload.degraded = !sc.ok;
    return payload;
  }

  // Store all 5 horizon predictions for a computed payload.
  function persist(symbol, payload, madeAt) {
    const ids = {};
    for (const h of payload.horizons) {
      const id = store.insertPrediction({
        symbol, horizon: h.horizon, made_at: madeAt, target_time: madeAt + (MS[h.horizon] || 8.64e7),
        spot_at_make: payload.spot, regime: payload.regime.label, regime_conf: payload.regime.confidence,
        direction: h.dir, edge: h.edge, p_up: h.pUp, size_frac: h.size,
        pred_price: h.p50, p05: h.p05, p25: h.p25, p50: h.p50, p75: h.p75, p95: h.p95,
        mu_bar: payload.muBar, sigma_bar: payload.sigBar, tau: h.tau, sigma_h: h.s,
        confidence: h.confidence, cross_score: payload.crossScore,
        inputs_json: JSON.stringify({ hurst: payload.regime.hurst, adx: payload.regime.adx, volPct: payload.regime.volPct }),
        option_json: h.option ? JSON.stringify(h.option) : null, model_ver: MODEL_VER,
      });
      ids[h.horizon] = id;
    }
    return ids;
  }

  // Resolve due predictions against realized prices; update calibration.
  async function resolveDue(symbol, now) {
    const due = store.duePredictions(now || Date.now()).filter((p) => !symbol || p.symbol === symbol);
    const resolved = [];
    for (const pred of due) {
      let price = null; try { price = await priceAt(pred.symbol, pred.target_time); } catch { /* keep open */ }
      if (price == null || !Number.isFinite(price)) continue;
      const out = scorePrediction(pred, price);
      store.insertOutcome({ pred_id: pred.id, resolved_at: Date.now(), ...out, option_pnl: null });
      store.resolve(pred.id);
      const cal = store.getCalibration(pred.symbol, pred.horizon);
      const nc = updateCalibration(cal, out);
      store.saveCalibration({ symbol: pred.symbol, horizon: pred.horizon, updated_at: Date.now(), ...nc });
      resolved.push({ id: pred.id, symbol: pred.symbol, horizon: pred.horizon, hit: out.hit, err: out.abs_pct_err });
    }
    return resolved;
  }

  // Public: compute + store a fresh prediction (does NOT resolve).
  async function predict(symbol) {
    const payload = await computeForecast(symbol);
    if (!payload.ok) return payload;
    const madeAt = Date.now();
    payload.ids = persist(symbol, payload, madeAt);
    payload.asOf = madeAt;
    return payload;
  }

  // Public: the refresh loop — resolve past, then re-forecast + store.
  async function refresh(symbol) {
    const resolved = await resolveDue(symbol, Date.now());
    const payload = await predict(symbol);
    payload.resolvedNow = resolved;
    return payload;
  }

  // Walk-forward backtest: at each sample point, forecast using ONLY past bars, then score
  // against the realized future bar. Validates the forecaster (no look-ahead). Gates model_ver.
  async function backtest(symbol) {
    const bars = await getBars(symbol, { interval: "60m", range: "730d" });
    if (!Array.isArray(bars) || bars.length < 120) { const b2 = await getBars(symbol, { interval: "1d", range: "5y" }); if (Array.isArray(b2) && b2.length > 120) return backtestOn(b2, [{ key: "1d", tau: 1 }, { key: "5d", tau: 5 }]); return { ok: false, reason: "insufficient history", symbol }; }
    return backtestOn(bars, [{ key: "1d", tau: 6.5 }, { key: "5d", tau: 32.5 }]);
  }
  function backtestOn(bars, horizons) {
    const out = {};
    for (const h of horizons) {
      const tau = Math.round(h.tau); let n = 0, hits = 0, cov = 0, brier = 0, mape = 0, pin = 0;
      const warm = 60; const step = Math.max(1, Math.floor((bars.length - warm - tau) / 120));
      for (let i = warm; i + tau < bars.length; i += step) {
        const past = bars.slice(0, i + 1); const regime = detectRegime(past); const fc = forecast(past, regime, {});
        if (!fc.ok) continue; const hf = fc.horizons.find((x) => Math.abs(x.tau - h.tau) < 0.01) || fc.horizons[0];
        const realized = bars[i + tau].c; const S0 = past[past.length - 1].c;
        n++; if (Math.sign(hf.p50 - S0) === Math.sign(realized - S0)) hits++;
        if (realized >= hf.p05 && realized <= hf.p95) cov++;
        const up = realized > S0 ? 1 : 0; brier += (hf.pUp - up) ** 2; mape += Math.abs(realized - hf.p50) / realized;
        pin += (realized >= hf.p50 ? 0.5 * (realized - hf.p50) : 0.5 * (hf.p50 - realized)) / S0;
      }
      const hitRate = n ? hits / n : null;
      out[h.key] = { n, hitRate, coverage90: n ? cov / n : null, brier: n ? brier / n : null, mape: n ? mape / n : null, pinball: n ? pin / n : null,
        pass: n > 20 && hitRate > 0.50 && (cov / n) >= 0.80 && (brier / n) < 0.26 };
    }
    const gate = Object.values(out).every((r) => r.pass);
    return { ok: true, horizons: out, gate, model_ver: MODEL_VER };
  }

  // Time machine (hindcast): forecast as-of N trading days ago using ONLY past bars, then
  // return the realized path since — so the UI can animate prediction-vs-actual immediately.
  async function hindcast(symbol, daysAgo = 20) {
    let bars = await getBars(symbol, { interval: "60m", range: "730d" }); let barsPerDay = 6.5;
    if (!Array.isArray(bars) || bars.length < 120) { bars = await getBars(symbol, { interval: "1d", range: "5y" }); barsPerDay = 1; }
    if (!Array.isArray(bars) || bars.length < 80) return { ok: false, reason: "insufficient history", symbol };
    const ahead = Math.round(32.5 * (barsPerDay / 6.5)); // ~5 trading days of realized path
    const cut = Math.max(60, bars.length - Math.round(daysAgo * barsPerDay) - ahead);
    const past = bars.slice(0, cut + 1);
    const regime = detectRegime(past); const fc = forecast(past, regime, {});
    if (!fc.ok) return { ok: false, reason: fc.reason, symbol };
    const cone = fc.horizons.map((h) => ({ horizon: h.horizon, p05: h.p05, p50: h.p50, p95: h.p95, barsAhead: Math.round(h.tau * (barsPerDay / 6.5)) }));
    const actual = bars.slice(cut, cut + ahead + 1).map((b, i) => ({ i, t: b.t, c: b.c }));
    const finalPx = actual.length ? actual[actual.length - 1].c : null; const spot = past[past.length - 1].c;
    const h5 = fc.horizons.find((h) => h.horizon === "5d") || fc.horizons[fc.horizons.length - 1];
    const realizedDir = finalPx != null ? Math.sign(finalPx - spot) : 0;
    const dir = h5.dir;
    // recommended option as-of the past date, then its realized worth 5 trading days later
    let option = null;
    const rec = recommendContract(h5, { r: 0.045, q: 0 });
    if (rec && finalPx != null) {
      const o = rec; const sigAnn = (o.impliedVol || 40) / 100; const Trem = Math.max(1, o.expiryDays - 5) / 365;
      const val = bs(finalPx, o.strike, 0.045, 0, sigAnn, Trem, o.type).price;
      const pnl = (val - o.premium) * 100; const pnlPct = o.premium > 0 ? (val / o.premium - 1) * 100 : 0;
      option = { action: o.type === "call" ? "BUY CALL" : "BUY PUT", type: o.type, moneyness: o.moneyness, strike: o.strike, premium: o.premium, expiryDays: o.expiryDays,
        exitValue: +val.toFixed(2), pnlPerContract: +pnl.toFixed(0), pnlPct: +pnlPct.toFixed(0), win: pnl > 0 };
    }
    return { ok: true, symbol, asOf: past[past.length - 1].t, spot: +spot.toFixed(2), finalPx: finalPx != null ? +finalPx.toFixed(2) : null,
      regime: regime.label, dir, action: dir === "LONG" ? "BUY / LONG" : "SELL / SHORT",
      predRet5d: +(h5.predRet || 0).toFixed(2), realizedRet5d: finalPx != null ? +((finalPx / spot - 1) * 100).toFixed(2) : null,
      directionRight: h5 ? ((dir === "LONG" ? 1 : -1) === realizedDir ? 1 : 0) : null, hit: h5 ? ((dir === "LONG" ? 1 : -1) === realizedDir ? 1 : 0) : null,
      option, cone, actual, barsPerDay };
  }

  function history(symbol, limit = 60) {
    const rows = store.history(symbol, limit);
    const scored = rows.filter((r) => r.hit != null);
    const hitRate = scored.length ? scored.reduce((s, r) => s + r.hit, 0) / scored.length : null;
    const mape = scored.length ? scored.reduce((s, r) => s + (r.abs_pct_err || 0), 0) / scored.length : null;
    return { rows, summary: { total: rows.length, resolved: scored.length, hitRate, mape } };
  }

  // Leaderboard — per-symbol resolved hit-rate + avg edge, ranked. Which calls are winning.
  function leaderboard() {
    try {
      const rows = store.db.prepare(`SELECT p.symbol, COUNT(o.pred_id) n, AVG(o.hit) hit_rate, AVG(o.abs_pct_err) mape, AVG(p.edge) edge
        FROM predictions p JOIN outcomes o ON o.pred_id=p.id GROUP BY p.symbol HAVING n>=3 ORDER BY hit_rate DESC, n DESC LIMIT 20`).all();
      return { rows };
    } catch { return { rows: [] }; }
  }
  return { predict, refresh, resolveDue, history, backtest, leaderboard, hindcast, computeForecast, store, model_ver: MODEL_VER };
}

module.exports = { createOracle };
