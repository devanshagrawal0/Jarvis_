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
const { clamp } = require("./mathx");

const MODEL_VER = "oracle-1.0";
const MS = { "1h": 3.6e6, "5h": 1.8e7, "12h": 4.32e7, "1d": 8.64e7, "5d": 4.32e8 };

// The LLM gives a 1-day P(up); scale conviction by horizon (shrink toward 0.5 for short, hold/expand for long).
function horizonScaleLLM(pUp1d, tau) {
  const k = Math.sqrt(tau / 6.5); // 1d = tau 6.5 → k=1
  return clamp(0.5 + (pUp1d - 0.5) * clamp(k, 0.4, 1.4), 0.02, 0.98);
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
      const out = await callModel(`You are APEX Oracle's synthesis layer. Given this numeric brief for a stock, reply with ONLY compact JSON {"pUp":<0..1 probability the stock is higher in 1 day>,"bias":"bullish|bearish|neutral","thesis":"<=2 sentence rationale citing the strongest signals"}. Brief: ${JSON.stringify(brief)}`);
      const j = JSON.parse(String(out).match(/\{[\s\S]*\}/)?.[0] || "{}");
      if (Number.isFinite(j.pUp)) return { pUp: clamp(j.pUp, 0.02, 0.98), bias: j.bias || "neutral", thesis: String(j.thesis || "").slice(0, 400) };
    } catch { /* fall through */ }
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

  function history(symbol, limit = 60) {
    const rows = store.history(symbol, limit);
    const scored = rows.filter((r) => r.hit != null);
    const hitRate = scored.length ? scored.reduce((s, r) => s + r.hit, 0) / scored.length : null;
    const mape = scored.length ? scored.reduce((s, r) => s + (r.abs_pct_err || 0), 0) / scored.length : null;
    return { rows, summary: { total: rows.length, resolved: scored.length, hitRate, mape } };
  }

  return { predict, refresh, resolveDue, history, computeForecast, store, model_ver: MODEL_VER };
}

module.exports = { createOracle };
