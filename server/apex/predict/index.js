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

const MODEL_VER = "oracle-1.0";
const MS = { "1h": 3.6e6, "5h": 1.8e7, "12h": 4.32e7, "1d": 8.64e7, "5d": 4.32e8 };

function createOracle({ runtimeDir, getBars, priceAt, callModel = null }) {
  const store = createOracleStore(runtimeDir);

  async function computeForecast(symbol) {
    const bars = await getBars(symbol, { interval: "60m", range: "60d" });
    if (!Array.isArray(bars) || bars.length < 40) return { ok: false, reason: "insufficient bars", symbol };
    const regime = detectRegime(bars);
    const cals = {}; for (const h of HORIZONS) cals[h.key] = store.getCalibration(symbol, h.key) || undefined;
    const fc = forecast(bars, regime, cals);
    if (!fc.ok) return { ok: false, reason: fc.reason, symbol };
    // attach options + confidence to each horizon
    for (const h of fc.horizons) {
      h.option = recommendContract(h, { r: 0.045, q: 0 });
      const cal = cals[h.key];
      const coverageHealth = cal ? 1 - Math.abs((cal.cov90 ?? 0.9) - 0.9) : 0.85;
      h.confidence = Math.max(0.05, Math.min(0.95, regime.confidence * 0.5 + coverageHealth * 0.3 + h.edge * 0.2));
      h.calibrated = !!cal;
    }
    const payload = { ok: true, symbol, asOf: null, spot: fc.spot, regime, muBar: fc.muBar, sigBar: fc.sigBar, ou: fc.ou, g: fc.g, horizons: fc.horizons, crossScore: regime.trendScore, model_ver: MODEL_VER };
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
