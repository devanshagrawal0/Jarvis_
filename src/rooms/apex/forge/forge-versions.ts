/* THE FORGE — strategy version history + diff (Tier 1).
   Every Save / adopt-a-fix snapshots the BotSpec + its metrics into a per-strategy
   timeline so nothing is a one-way door: you can see what changed between any two
   versions and whether it actually helped. Client-side (localStorage), LRU-capped. */

import { summarizeEntry, type BotSpec } from "./forge-spec";

export interface StrategyVersion { v: number; ts: number; note: string; spec: BotSpec; metrics: Record<string, number> }
export interface SpecDiff { path: string; from: string; to: string }

const KEY = (id: string) => `forge-versions:${id}`;
const MAX = 40;

export function getVersions(id: string): StrategyVersion[] {
  try { return JSON.parse(localStorage.getItem(KEY(id)) || "[]") as StrategyVersion[]; } catch { return []; }
}

export function saveVersion(id: string, spec: BotSpec, metrics: Record<string, number> | undefined, note: string): StrategyVersion[] {
  const list = getVersions(id);
  const last = list[list.length - 1];
  // de-dupe: don't snapshot an identical spec back-to-back
  if (last && JSON.stringify(last.spec) === JSON.stringify(spec)) return list;
  const v = (last ? last.v : 0) + 1;
  list.push({ v, ts: Date.now(), note, spec: JSON.parse(JSON.stringify(spec)), metrics: metrics || {} });
  const trimmed = list.slice(-MAX);
  try { localStorage.setItem(KEY(id), JSON.stringify(trimmed)); } catch { /* quota */ }
  return trimmed;
}

const S = (x: unknown): string => x === undefined || x === null || x === "" ? "—" : typeof x === "object" ? JSON.stringify(x) : String(x);
const sig = (s: BotSpec) => s.signals.map(x => `${x.id}:${x.type}(${Object.values(x.params).join(",")})`).join(" · ");

/* Field-level diff between two specs — only the things that changed. */
export function diffSpecs(a: BotSpec, b: BotSpec): SpecDiff[] {
  const d: SpecDiff[] = [];
  const cmp = (path: string, x: unknown, y: unknown) => { if (S(x) !== S(y)) d.push({ path, from: S(x), to: S(y) }); };
  cmp("Symbol", a.universe.symbols.join(","), b.universe.symbols.join(","));
  cmp("Timeframe", a.universe.bar, b.universe.bar);
  cmp("Signals", sig(a), sig(b));
  cmp("Entry", summarizeEntry(a.entry, a.signals), summarizeEntry(b.entry, b.signals));
  (["stopLossPct", "takeProfitPct", "trailingPct", "timeBars"] as const).forEach(k => cmp("Exit · " + k.replace("Pct", " %").replace("timeBars", "time"), a.exit[k], b.exit[k]));
  cmp("Sizing", `${a.sizing.method} ${a.sizing.value}`, `${b.sizing.method} ${b.sizing.value}`);
  cmp("Max drawdown %", a.risk.maxDrawdownPct, b.risk.maxDrawdownPct);
  return d;
}

/* Metric delta between two version snapshots (higher-is-better except drawdown). */
export const METRIC_KEYS: [string, string, boolean][] = [["CAGR", "cagrPct", true], ["Sharpe", "sharpe", true], ["Max DD", "maxDrawdownPct", false], ["Win %", "winRatePct", true], ["Profit F.", "profitFactor", true], ["Trades", "trades", true]];
