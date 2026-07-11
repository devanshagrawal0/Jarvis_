/* THE FORGE — F4 Terraform. Sweeps two exit parameters over a grid, backtests
   every combination (locally, cached bars), and builds a fitness landscape whose
   height = risk-adjusted return and colour = ROBUSTNESS (low local variance).
   You hunt broad plateaus, not spiky peaks — the best anti-overfitting view. */

import { fetchBars } from "../../apex-data";
import type { Bar } from "../forge-blocks";
import { backtest } from "../forge-engine";
import type { BotSpec } from "../forge-spec";

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };
const toBars = (raw: { t: string | number; o: number; h: number; l: number; c: number; v: number }[]): Bar[] =>
  raw.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => +(a + (b - a) * (i / (n - 1))).toFixed(2));

export interface TerrainCell { xi: number; yi: number; xv: number; yv: number; fitness: number; robust: number }
export interface TerrainResult { cells: TerrainCell[]; G: number; xLabel: string; yLabel: string; xVals: number[]; yVals: number[]; best: TerrainCell; fMin: number; fMax: number }

export async function runTerraform(spec: BotSpec, G = 11): Promise<TerrainResult | null> {
  try {
    const symbol = spec.universe.symbols[0] || "SPY";
    const raw = await fetchBars(symbol, spec.universe.bar, RANGE_FOR[spec.universe.bar] || "2y");
    const bars = toBars(raw); if (bars.length < 60) return null;

    const xVals = linspace(2, 14, G);   // stop-loss %
    const yVals = linspace(3, 24, G);   // take-profit %
    const cells: TerrainCell[] = [];
    const grid: number[][] = Array.from({ length: G }, () => new Array(G).fill(-1));
    for (let xi = 0; xi < G; xi++) {
      for (let yi = 0; yi < G; yi++) {
        const s = clone(spec); s.exit = { ...s.exit, stopLossPct: xVals[xi], takeProfitPct: yVals[yi] };
        const r = backtest(s, symbol, bars); const f = (r.metrics && !Number.isNaN(r.metrics.sharpe) && r.metrics.trades >= 3) ? r.metrics.sharpe : -1;
        grid[xi][yi] = f; cells.push({ xi, yi, xv: xVals[xi], yv: yVals[yi], fitness: +f.toFixed(3), robust: 0 });
      }
      await new Promise(r => setTimeout(r));   // P2: yield each row so the 121-cell sweep doesn't freeze the tab
    }
    // robustness = 1 - normalized local std over the 3×3 neighbourhood
    let maxStd = 1e-9;
    for (const c of cells) { const nb: number[] = []; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const a = c.xi + dx, b = c.yi + dy; if (a >= 0 && a < G && b >= 0 && b < G) nb.push(grid[a][b]); } const m = nb.reduce((s, x) => s + x, 0) / nb.length; c.robust = Math.sqrt(nb.reduce((s, x) => s + (x - m) ** 2, 0) / nb.length); maxStd = Math.max(maxStd, c.robust); }
    for (const c of cells) c.robust = +(1 - c.robust / maxStd).toFixed(3);   // 1 = flat plateau, 0 = cliff
    const fitness = cells.map(c => c.fitness); const fMin = Math.min(...fitness), fMax = Math.max(...fitness);
    // robust-adjusted optimum: reward height AND flatness
    const best = cells.slice().sort((a, b) => (b.fitness * (0.5 + 0.5 * b.robust)) - (a.fitness * (0.5 + 0.5 * a.robust)))[0];
    return { cells, G, xLabel: "Stop-loss %", yLabel: "Take-profit %", xVals, yVals, best, fMin, fMax };
  } catch { return null; }
}
