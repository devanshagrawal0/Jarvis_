/* THE FORGE — F3 Darwin: evolutionary strategy discovery. Seeds a population of
   BotSpec mutations, breeds them over generations (mutate + crossover), fitness =
   a risk-adjusted backtest score. Fetches bars ONCE then runs backtests locally
   (synchronous, fast) so a full evolution completes in-browser. Returns the best
   strategy you never thought to write + the fitness trajectory. */

import { fetchBars } from "../../apex-data";
import type { Bar } from "../forge-blocks";
import { SIGNALS } from "../forge-blocks";
import { backtest } from "../forge-engine";
import type { BotSpec, SignalCond, EntryNode } from "../forge-spec";
import { isLogic } from "../forge-spec";

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };
const toBars = (raw: { t: string | number; o: number; h: number; l: number; c: number; v: number }[]): Bar[] =>
  raw.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const R = () => Math.random();
const jitter = (v: number, frac = 0.3, min = 1, max = 400) => Math.max(min, Math.min(max, Math.round(v * (1 + (R() - 0.5) * 2 * frac))));

export interface DarwinResult { best: BotSpec; bestFitness: number; bestMetrics: ReturnType<typeof backtest>["metrics"]; history: { gen: number; best: number; avg: number }[]; evaluated: number; improvementPct: number }

/* Fitness: reward risk-adjusted return, penalize thin trade counts + deep DD. */
function fitness(spec: BotSpec, symbol: string, bars: Bar[]): { score: number; m: ReturnType<typeof backtest>["metrics"] } {
  const r = backtest(spec, symbol, bars);
  const m = r.metrics;
  if (!m || Number.isNaN(m.sharpe)) return { score: -999, m };
  let s = m.sharpe * 10 + m.calmar * 6 + (m.profitFactor - 1) * 8 + m.maxDrawdownPct * 0.15;
  if (m.trades < 8) s -= 25;                         // not enough evidence
  if (m.trades < 3) s -= 100;
  return { score: s, m };
}

/* Mutate one gene: a signal period, an entry comparison value, or an exit param. */
function mutate(spec: BotSpec): BotSpec {
  const s = clone(spec); const dice = R();
  if (dice < 0.35 && s.signals.length) {
    const sig = s.signals[Math.floor(R() * s.signals.length)];
    const def = SIGNALS[sig.type];
    if (def && def.params.length) { const p = def.params[Math.floor(R() * def.params.length)]; sig.params[p.key] = jitter(Number(sig.params[p.key] ?? p.def), 0.4, p.min ?? 2, p.max ?? 300); }
  } else if (dice < 0.55) {
    // perturb an entry comparison value
    const walk = (n: EntryNode): boolean => { if (isLogic(n)) return n.operands.some(walk); const c = n as SignalCond; if (c.value != null) { c.value = +(c.value * (1 + (R() - 0.5) * 0.6)).toFixed(2); return true; } return false; };
    walk(s.entry);
  } else {
    // perturb an exit param (or introduce one)
    const ex = s.exit; const which = R();
    if (which < 0.4) ex.stopLossPct = +Math.max(1, (ex.stopLossPct || 5) * (1 + (R() - 0.5) * 0.6)).toFixed(1);
    else if (which < 0.7) ex.takeProfitPct = +Math.max(2, (ex.takeProfitPct || 8) * (1 + (R() - 0.5) * 0.6)).toFixed(1);
    else ex.trailingPct = +Math.max(3, (ex.trailingPct || 8) * (1 + (R() - 0.5) * 0.6)).toFixed(1);
  }
  return s;
}

/* Crossover: child takes structure from A, exit + sizing from B. */
function crossover(a: BotSpec, b: BotSpec): BotSpec { const c = clone(a); c.exit = clone(b.exit); if (R() < 0.5) c.sizing = clone(b.sizing); return c; }

export async function evolve(seed: BotSpec, onGen?: (g: number, best: number) => void, pop = 16, gens = 12): Promise<DarwinResult | null> {
  try {
    const symbol = seed.universe.symbols[0] || "SPY";
    const raw = await fetchBars(symbol, seed.universe.bar, RANGE_FOR[seed.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 60) return null;

    let population: BotSpec[] = [clone(seed)];
    while (population.length < pop) population.push(mutate(seed));
    const seedFit = fitness(seed, symbol, bars).score;
    let evaluated = 0; const history: DarwinResult["history"] = [];
    let best = clone(seed), bestScore = seedFit, bestM = fitness(seed, symbol, bars).m;

    for (let g = 0; g < gens; g++) {
      const scored = population.map(sp => { const f = fitness(sp, symbol, bars); evaluated++; return { sp, ...f }; }).sort((x, y) => y.score - x.score);
      if (scored[0].score > bestScore) { bestScore = scored[0].score; best = clone(scored[0].sp); bestM = scored[0].m; }
      history.push({ gen: g + 1, best: +scored[0].score.toFixed(2), avg: +(scored.reduce((s, x) => s + x.score, 0) / scored.length).toFixed(2) });
      onGen?.(g + 1, +scored[0].score.toFixed(2));
      await new Promise(r => setTimeout(r));   // P1: yield to the event loop so the UI repaints the generation counter instead of freezing
      // breed: keep top-4 elites, fill rest with crossover(elite×elite)+mutate + a few fresh mutations
      const elite = scored.slice(0, 4).map(x => x.sp);
      const next: BotSpec[] = elite.map(clone);
      while (next.length < pop) {
        const pa = elite[Math.floor(R() * elite.length)], pb = elite[Math.floor(R() * elite.length)];
        let child = crossover(pa, pb); if (R() < 0.8) child = mutate(child);
        next.push(child);
      }
      population = next;
    }
    best.meta = { ...best.meta, name: `${seed.meta.name} · evolved`, tags: [...(seed.meta.tags || []), "darwin"] };
    const improvementPct = seedFit !== 0 ? +(((bestScore - seedFit) / Math.abs(seedFit)) * 100).toFixed(0) : 0;
    return { best, bestFitness: +bestScore.toFixed(2), bestMetrics: bestM, history, evaluated, improvementPct };
  } catch { return null; }
}
