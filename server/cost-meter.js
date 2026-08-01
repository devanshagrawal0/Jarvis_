// ─────────────────────────────────────────────────────────────────────────
//  Cost meter — Cortex v4 (P0.6). Tracks Gemini token spend from usageMetadata
//  so the UI can show a live running $ figure (today / month / all-time).
//  No hard cap — the owner chose "track, don't limit." Text-token costs only;
//  audio/image/grounding surcharges are noted separately where wired.
//
//  Prices = USD per 1M tokens (Gemini paid API, verified 2026-07-11).
// ─────────────────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");

const PRICING = {
  "gemini-3.5-flash": { in: 1.50, out: 9.00 },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.50 },
  "gemini-3.1-pro-preview": { in: 2.00, out: 12.00 },
  "gemini-3.1-flash-live-preview": { in: 0.75, out: 4.50 },
  "gemini-embedding-2": { in: 0.20, out: 0 },
  "gemini-3-flash-preview": { in: 0.50, out: 3.00 },
  // legacy fallbacks (in case a subsystem still points here)
  "gemini-2.5-pro": { in: 1.25, out: 10.00 },
  "gemini-2.5-flash": { in: 0.30, out: 2.50 },
  "gemini-flash-lite-latest": { in: 0.10, out: 0.40 },
};
function priceFor(model) {
  if (PRICING[model]) return PRICING[model];
  const key = Object.keys(PRICING).find((k) => String(model || "").startsWith(k));
  return key ? PRICING[key] : null;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStr() { return new Date().toISOString().slice(0, 7); }

function createCostMeter({ runtimeDir }) {
  const file = path.join(runtimeDir, "cost-meter.json");
  let state = { today: { date: todayStr(), calls: 0, tokIn: 0, tokOut: 0, cost: 0 },
                month: { ym: monthStr(), calls: 0, tokIn: 0, tokOut: 0, cost: 0 },
                allTime: { calls: 0, tokIn: 0, tokOut: 0, cost: 0 },
                byModel: {}, recent: [] };
  try { if (fs.existsSync(file)) state = { ...state, ...JSON.parse(fs.readFileSync(file, "utf8")) }; } catch {}

  let saveTimer = null;
  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { fs.writeFileSync(file, JSON.stringify(state), "utf8"); } catch {}
    }, 1500);
  }

  function rollWindows() {
    const d = todayStr(), m = monthStr();
    if (state.today.date !== d) state.today = { date: d, calls: 0, tokIn: 0, tokOut: 0, cost: 0 };
    if (state.month.ym !== m) state.month = { ym: m, calls: 0, tokIn: 0, tokOut: 0, cost: 0 };
  }

  // Record one model call. usage = { promptTokenCount, candidatesTokenCount }.
  function record(model, usage = {}, meta = {}) {
    const tokIn = Number(usage.promptTokenCount || usage.tokIn || 0);
    const tokOut = Number(usage.candidatesTokenCount || usage.tokOut || 0);
    if (!tokIn && !tokOut) return;
    const p = priceFor(model);
    const cost = p ? (tokIn / 1e6) * p.in + (tokOut / 1e6) * p.out : null;
    rollWindows();
    for (const w of [state.today, state.month, state.allTime]) {
      w.calls += 1; w.tokIn += tokIn; w.tokOut += tokOut;
      if (cost == null) w.unknownPriceCalls = Number(w.unknownPriceCalls || 0) + 1;
      else w.cost += cost;
    }
    const bm = state.byModel[model] || { calls: 0, tokIn: 0, tokOut: 0, cost: 0 };
    bm.calls += 1; bm.tokIn += tokIn; bm.tokOut += tokOut;
    if (cost == null) bm.unknownPriceCalls = Number(bm.unknownPriceCalls || 0) + 1;
    else bm.cost += cost;
    state.byModel[model] = bm;
    state.recent.unshift({ at: new Date().toISOString(), model, tokIn, tokOut, cost: cost == null ? null : Math.round(cost * 1e6) / 1e6, pricing: cost == null ? "unknown" : "known", source: meta.source || "" });
    state.recent = state.recent.slice(0, 50);
    persist();
    return cost;
  }

  function summary() {
    rollWindows();
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      today: { ...state.today, cost: r2(state.today.cost) },
      month: { ...state.month, cost: r2(state.month.cost) },
      allTime: { ...state.allTime, cost: r2(state.allTime.cost) },
      byModel: Object.fromEntries(Object.entries(state.byModel).map(([m, v]) => [m, { ...v, cost: r2(v.cost) }])),
      recent: state.recent.slice(0, 12),
    };
  }

  return { record, summary, priceFor };
}

module.exports = { createCostMeter, PRICING };
