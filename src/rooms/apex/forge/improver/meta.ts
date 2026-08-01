/* THE FORGE — F5 Meta-Labeler (López de Prado). The primary strategy decides
   DIRECTION; a lightweight in-browser classifier decides WHETHER to take each
   trade. Features = the strategy's own signal values at entry (+ regime, drawup);
   target = did the trade win. Then it shows the lift from skipping predicted
   losers. Reuses the Improver ledger + the block signal engine. */

import { fetchBars } from "../../apex-data";
import type { Bar } from "../forge-blocks";
import { computeSignals } from "../forge-blocks";
import type { BotSpec } from "../forge-spec";
import type { BacktestResult } from "../forge-engine";
import { buildRun } from "./artifact";

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };
const toBars = (raw: { t: string | number; o: number; h: number; l: number; c: number; v: number }[]): Bar[] =>
  raw.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));

export interface MetaResult {
  auc: number; nTrades: number; features: { name: string; weight: number }[];
  baseReturnPct: number; filteredReturnPct: number; baseWinRate: number; filteredWinRate: number; kept: number; skipped: number;
  verdict: string;
}

function sigmoid(z: number) { return 1 / (1 + Math.exp(-z)); }
function standardize(cols: number[][]): { Z: number[][]; mu: number[]; sd: number[] } {
  const n = cols.length, p = cols[0]?.length || 0;
  const mu = new Array(p).fill(0), sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += cols[i][j]; mu[j] = s / n; let v = 0; for (let i = 0; i < n; i++) v += (cols[i][j] - mu[j]) ** 2; sd[j] = Math.sqrt(v / n) || 1; }
  const Z = cols.map(row => row.map((x, j) => (x - mu[j]) / sd[j]));
  return { Z, mu, sd };
}
/* Logistic regression via gradient descent (with L2). */
function trainLogit(X: number[][], y: number[], iters = 400, lr = 0.3, l2 = 0.01): number[] {
  const n = X.length, p = X[0].length; const w = new Array(p + 1).fill(0); // last = bias
  for (let it = 0; it < iters; it++) {
    const g = new Array(p + 1).fill(0);
    for (let i = 0; i < n; i++) { let z = w[p]; for (let j = 0; j < p; j++) z += w[j] * X[i][j]; const e = sigmoid(z) - y[i]; for (let j = 0; j < p; j++) g[j] += e * X[i][j]; g[p] += e; }
    for (let j = 0; j < p; j++) w[j] -= lr * (g[j] / n + l2 * w[j]); w[p] -= lr * (g[p] / n);
  }
  return w;
}
function predict(x: number[], w: number[]): number { let z = w[w.length - 1]; for (let j = 0; j < x.length; j++) z += w[j] * x[j]; return sigmoid(z); }
function auc(scores: number[], y: number[]): number {
  const pos = scores.filter((_, i) => y[i] === 1), neg = scores.filter((_, i) => y[i] === 0);
  if (!pos.length || !neg.length) return 0.5;
  let c = 0; for (const a of pos) for (const b of neg) c += a > b ? 1 : a === b ? 0.5 : 0;
  return c / (pos.length * neg.length);
}

/* Per-trade OUT-OF-SAMPLE win probabilities + labels — the raw material for
   probabilistic-forecast scores (Brier / ROC-AUC / PR-AUC / log-loss). Same K-fold
   scoring as the labeler, exposed so the multi-measure analyzer can grade calibration. */
export interface MetaScores { scores: number[]; y: number[]; auc: number; features: { name: string; weight: number }[]; nTrades: number }
export async function runMetaScores(spec: BotSpec, result: BacktestResult): Promise<MetaScores | null> {
  try {
    const sym = spec.universe.symbols[0] || result.symbol || "SPY";
    const raw = await fetchBars(sym, spec.universe.bar, RANGE_FOR[spec.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 40) return null;
    const run = buildRun(spec, result, bars);
    if (run.ledger.length < 12) return null;
    const series = computeSignals(spec.signals, bars);
    const sigIds = Object.keys(series);
    const featNames = [...sigIds, "regime"];
    const REG: Record<string, number> = { "calm-bull": 0, "volatile-bull": 1, "grind-bear": 2, "crisis": 3 };
    const rawX: number[][] = [], y: number[] = [];
    for (const t of run.ledger) {
      const i = t.entryBarIdx;
      const row = sigIds.map(id => { const v = series[id]?.[i]; return Number.isFinite(v) ? v : 0; });
      row.push(REG[t.regimeAtEntry] ?? 0);
      rawX.push(row); y.push(t.outcome === "win" ? 1 : 0);
    }
    const { Z } = standardize(rawX); const nn = Z.length;
    const K = Math.min(5, Math.max(2, Math.floor(nn / 6)));
    const scores = new Array(nn).fill(0.5);
    for (let k = 0; k < K; k++) {
      const trX: number[][] = [], trY: number[] = [];
      for (let idx = 0; idx < nn; idx++) if (idx % K !== k) { trX.push(Z[idx]); trY.push(y[idx]); }
      if (trX.length < 4 || trY.every(v => v === trY[0])) continue;
      const wk = trainLogit(trX, trY);
      for (let idx = 0; idx < nn; idx++) if (idx % K === k) scores[idx] = predict(Z[idx], wk);
    }
    const w = trainLogit(Z, y);
    const features = featNames.map((name, j) => ({ name, weight: +w[j].toFixed(3) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 6);
    return { scores, y, auc: +auc(scores, y).toFixed(3), features, nTrades: nn };
  } catch { return null; }
}

export async function runMetaLabeler(spec: BotSpec, result: BacktestResult): Promise<MetaResult | null> {
  try {
    const sym = spec.universe.symbols[0] || result.symbol || "SPY";
    const raw = await fetchBars(sym, spec.universe.bar, RANGE_FOR[sym === result.symbol ? spec.universe.bar : spec.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 40) return null;
    const run = buildRun(spec, result, bars);
    if (run.ledger.length < 12) return null;                 // need a minimum for a classifier

    const series = computeSignals(spec.signals, bars);       // { signalId: number[] }
    const sigIds = Object.keys(series);
    const featNames = [...sigIds, "regime"];   // C10: removed maeAtr — MAE is measured over the trade's whole life, i.e. entry-time target leakage
    const REG: Record<string, number> = { "calm-bull": 0, "volatile-bull": 1, "grind-bear": 2, "crisis": 3 };

    const rawX: number[][] = [], y: number[] = [], rets: number[] = [];
    for (const t of run.ledger) {
      const i = t.entryBarIdx;
      const row = sigIds.map(id => { const v = series[id]?.[i]; return Number.isFinite(v) ? v : 0; });
      row.push(REG[t.regimeAtEntry] ?? 0);
      rawX.push(row); y.push(t.outcome === "win" ? 1 : 0); rets.push(t.netRet);
    }
    const { Z } = standardize(rawX);
    const nn = Z.length;
    // C10: OUT-OF-SAMPLE scores via K-fold CV — a trade is never scored by a model that trained on it,
    // so both the AUC and the filtered "lift" are honest rather than mechanically optimistic.
    const K = Math.min(5, Math.max(2, Math.floor(nn / 6)));
    const scores = new Array(nn).fill(0.5);
    for (let k = 0; k < K; k++) {
      const trX: number[][] = [], trY: number[] = [];
      for (let idx = 0; idx < nn; idx++) if (idx % K !== k) { trX.push(Z[idx]); trY.push(y[idx]); }
      if (trX.length < 4 || trY.every(v => v === trY[0])) continue;   // skip degenerate fold
      const wk = trainLogit(trX, trY);
      for (let idx = 0; idx < nn; idx++) if (idx % K === k) scores[idx] = predict(Z[idx], wk);
    }
    const w = trainLogit(Z, y);                 // full-fit weights, for feature-importance display only
    const aucVal = +auc(scores, y).toFixed(3);

    // filter on OUT-OF-SAMPLE scores: keep trades with P(win) ≥ median (skip the bottom half of confidence)
    const sorted = [...scores].sort((a, b) => a - b); const thr = sorted[Math.floor(sorted.length / 2)];
    let baseEq = 1, filtEq = 1; let keptWins = 0, kept = 0, baseWins = 0;
    run.ledger.forEach((t, i) => { baseEq *= 1 + rets[i]; if (t.outcome === "win") baseWins++; if (scores[i] >= thr) { filtEq *= 1 + rets[i]; kept++; if (t.outcome === "win") keptWins++; } });

    const features = featNames.map((name, j) => ({ name, weight: +w[j].toFixed(3) })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const baseReturnPct = +((baseEq - 1) * 100).toFixed(2), filteredReturnPct = +((filtEq - 1) * 100).toFixed(2);
    const lift = filteredReturnPct - baseReturnPct;
    const verdict = aucVal < 0.55 ? `The entry signals barely separate winners from losers (out-of-sample AUC ${aucVal}) — no learnable filter here; the edge is in the rules themselves.`
      : lift > 0 ? `An out-of-sample confidence filter lifts return from ${baseReturnPct}% to ${filteredReturnPct}% by skipping the ${nn - kept} lowest-confidence trades (AUC ${aucVal}). "${features[0].name}" is the most predictive feature.`
        : `The classifier ranks trades out-of-sample (AUC ${aucVal}) but filtering doesn't help — keep all trades.`;

    return { auc: aucVal, nTrades: nn, features: features.slice(0, 6), baseReturnPct, filteredReturnPct, baseWinRate: +(baseWins / nn * 100).toFixed(0), filteredWinRate: kept ? +(keptWins / kept * 100).toFixed(0) : 0, kept, skipped: nn - kept, verdict };
  } catch { return null; }
}
