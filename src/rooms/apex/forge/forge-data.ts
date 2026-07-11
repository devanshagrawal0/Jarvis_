/* THE FORGE — client data layer. Talks to /api/apex/strategies and runs the
   evaluator client-side for instant backtest previews. */

import { useEffect, useState, useCallback } from "react";
import { api } from "../../../api";
import { fetchBars } from "../apex-data";
import type { Bar } from "./forge-blocks";
import { backtest, backtestUniverse, type BacktestResult } from "./forge-engine";
import type { BotSpec } from "./forge-spec";

export interface StrategyCard {
  id: string; name: string; description: string; tags: string[]; folder: string;
  source: string; summary: string; metrics: Record<string, number>; version: number;
  createdAt: string; updatedAt: string;
}
export interface StrategyFull extends StrategyCard { spec: BotSpec }

async function safe<T>(path: string, fb: T): Promise<T> { try { return await api<T>(path); } catch { return fb; } }

export async function fetchStrategies(): Promise<StrategyCard[]> {
  const r = await safe<{ strategies: StrategyCard[] }>("/api/apex/strategies", { strategies: [] });
  return r.strategies || [];
}
export async function fetchStrategy(id: string): Promise<StrategyFull | null> {
  const r = await safe<{ strategy: StrategyFull | null }>(`/api/apex/strategies/${encodeURIComponent(id)}`, { strategy: null });
  return r.strategy;
}
export async function saveStrategy(payload: { id: string; name: string; description?: string; tags?: string[]; folder?: string; source?: string; summary?: string; metrics?: Record<string, number>; spec: BotSpec; version?: number }): Promise<boolean> {
  try {
    const res = await fetch("/api/apex/strategies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.ok;
  } catch { return false; }
}
export async function deleteStrategy(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/apex/strategies/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
    return res.ok;
  } catch { return false; }
}

/* Convert apex Bar (t:string ISO/epoch) → engine Bar (t:number ms). */
function toEngineBars(bars: { t: string; o: number; h: number; l: number; c: number; v: number }[]): Bar[] {
  return bars.filter(b => b && b.c != null).map(b => ({ t: typeof b.t === "number" ? b.t : Date.parse(b.t), o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));
}

const RANGE_FOR: Record<string, string> = { "1d": "2y", "1h": "3mo", "15m": "1mo" };

/* Run a full backtest (client-side). One symbol → single-symbol engine; a whole
   universe → the multi-symbol portfolio engine (parallel bar fetch, capped). */
export async function runBacktest(spec: BotSpec): Promise<BacktestResult> {
  const tf = spec.universe.bar || "1d";
  const range = RANGE_FOR[tf] || "2y";
  const symbols = (spec.universe.symbols || []).filter(Boolean);
  if (symbols.length <= 1) {
    const symbol = symbols[0] || "SPY";
    const raw = await fetchBars(symbol, tf, range);
    return backtest(spec, symbol, toEngineBars(raw));
  }
  const list = symbols.slice(0, 120);   // cap so an "All" universe doesn't fire hundreds of fetches
  const fetched = await Promise.all(list.map(async sym => {
    try { return [sym, toEngineBars(await fetchBars(sym, tf, range))] as const; } catch { return [sym, [] as Bar[]] as const; }
  }));
  const barsBySymbol: Record<string, Bar[]> = {};
  for (const [sym, bars] of fetched) if (bars.length) barsBySymbol[sym] = bars;
  return backtestUniverse(spec, barsBySymbol);
}

export interface PyBrief {
  filename: string; framework: string[]; strategyType: string; indicators: string[];
  parameters: { name: string; value: number }[]; classes: string[]; functions: string[];
  imports: string[]; entry: string[]; exit: string[]; risk: string[]; linesOfCode: number; summary: string;
}
export async function analyzePython(code: string, filename: string): Promise<PyBrief | null> {
  try {
    const res = await fetch("/api/apex/analyze-python", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, filename }) });
    if (!res.ok) return null;
    const j = await res.json();
    return j.brief || null;
  } catch { return null; }
}

export function useStrategies(): { list: StrategyCard[]; loading: boolean; reload: () => void } {
  const [list, setList] = useState<StrategyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => { setLoading(true); fetchStrategies().then(s => { setList(s); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { list, loading, reload };
}

/* ── THE FORGE v3 — composable primitives (folders / variables / signals) ── */
export interface Deps { symbols?: string[]; indicators?: string[]; vars?: string[] }
export interface Variable { id: string; name: string; expr: string; kind: string; description: string; deps: Deps; usedBy: string[]; folderId: string; createdBy: string; version: number; createdAt: string; updatedAt: string }
export interface Signal { id: string; name: string; expr: string; description: string; codePath: string; deps: Deps; usedBy: string[]; folderId: string; createdBy: string; version: number; createdAt: string; updatedAt: string }
export interface Folder { id: string; name: string; description: string; kind: string; codePath: string; meta: Record<string, unknown>; createdBy: string; version: number; createdAt: string; updatedAt: string; bots?: StrategyCard[] }

async function post<T extends object>(path: string, body: T): Promise<{ ok: boolean; id?: string }> {
  try { const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) return { ok: false }; return await res.json(); }
  catch { return { ok: false }; }
}
async function del(path: string): Promise<boolean> {
  try { const res = await fetch(path, { method: "DELETE", headers: { "Content-Type": "application/json" } }); return res.ok; } catch { return false; }
}

export const fetchVariables = () => safe<{ variables: Variable[] }>("/api/apex/variables", { variables: [] }).then(r => r.variables || []);
export const saveVariable = (v: Partial<Variable> & { name: string; expr: string }) => post("/api/apex/variables", v);
export const deleteVariable = (id: string) => del(`/api/apex/variables/${encodeURIComponent(id)}`);

export const fetchSignals = () => safe<{ signals: Signal[] }>("/api/apex/signals", { signals: [] }).then(r => r.signals || []);
export const saveSignal = (s: Partial<Signal> & { name: string }) => post("/api/apex/signals", s);
export const deleteSignal = (id: string) => del(`/api/apex/signals/${encodeURIComponent(id)}`);

export const fetchFolders = () => safe<{ folders: Folder[] }>("/api/apex/folders", { folders: [] }).then(r => r.folders || []);
export const fetchFolder = (id: string) => safe<{ folder: Folder | null }>(`/api/apex/folders/${encodeURIComponent(id)}`, { folder: null }).then(r => r.folder);
export const saveFolder = (f: Partial<Folder> & { name: string }) => post("/api/apex/folders", f);
export const deleteFolder = (id: string) => del(`/api/apex/folders/${encodeURIComponent(id)}`);

export interface ForgeReport { name: string; targetId: string; metrics: Record<string, number>; report: { narrative?: string; [k: string]: unknown }; engineVersion: string; createdAt: string }
export const fetchReport = (targetId: string) => safe<{ report: ForgeReport | null }>(`/api/apex/reports/${encodeURIComponent(targetId)}`, { report: null }).then(r => r.report);
export const saveReport = (payload: { targetId: string; targetKind?: string; name?: string; metrics: Record<string, number>; report: Record<string, unknown>; engineVersion?: string }) => post("/api/apex/reports", payload);

/* AI strategy coach — concrete improvements grounded in the backtest (V9). */
export async function forgeImprove(summary: string, metrics: Record<string, number>): Promise<{ suggestions?: string; error?: string } | null> {
  try {
    const res = await fetch("/api/apex/forge-improve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, metrics }) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* The Adversary — red-team critique of why the strategy will fail. */
export async function forgeAdversary(summary: string, metrics: Record<string, number>): Promise<{ critique?: string; error?: string } | null> {
  try {
    const res = await fetch("/api/apex/forge-adversary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, metrics }) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* AI compose — natural language → validated variable/signal/bot spec (V5). */
export interface ComposeResult { kind: "variable" | "signal" | "bot"; spec: Record<string, unknown>; explanation: string; needsClarification?: string; error?: string }
export async function aiCompose(description: string, ctx: { universe?: string[]; signals?: string[]; variables?: string[] } = {}): Promise<ComposeResult | null> {
  try {
    const res = await fetch("/api/apex/ai-compose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, ...ctx }) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/* Unified library hook — folders, bots, signals, variables in one reload. */
export function useForgeLibrary() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([fetchFolders(), fetchSignals(), fetchVariables()]).then(([f, s, v]) => { setFolders(f); setSignals(s); setVariables(v); setLoading(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { folders, signals, variables, loading, reload };
}

/* ── Custom uploaded signals: labeled, retrievable storage of the runnable code
   + the retrieval method (DSL expr) + metadata. Stored client-side immediately
   (localStorage, key `forge-signal-code:<slug>`) and mirrored to the server
   best-effort (activates once the /forge-signal-code route is live). */
export interface UploadedSignal { name: string; dsl: string; reading: string; outputType: string; range: string; code: string; source: string; indicators: string[]; savedAt?: number }
export function saveForgeSignalCode(slug: string, data: UploadedSignal): void {
  try {
    // M5: LRU cap — evict the oldest so a stream of uploads can never blow the ~5MB quota.
    const keys = Object.keys(localStorage).filter(k => k.startsWith("forge-signal-code:") && k !== `forge-signal-code:${slug}`);
    if (keys.length >= 30) {
      const aged = keys.map(k => { let t = 0; try { t = (JSON.parse(localStorage.getItem(k) || "{}") as UploadedSignal).savedAt || 0; } catch { /* corrupt */ } return { k, t }; }).sort((a, b) => a.t - b.t);
      for (const { k } of aged.slice(0, keys.length - 29)) localStorage.removeItem(k);
    }
    localStorage.setItem(`forge-signal-code:${slug}`, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch { /* quota / storage disabled — server mirror below still runs */ }
  fetch("/api/apex/forge-signal-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, ...data }) }).catch(() => { /* route may not be live yet */ });
}
export function getForgeSignalCode(slug: string): UploadedSignal | null {
  try { return JSON.parse(localStorage.getItem(`forge-signal-code:${slug}`) || "null"); } catch { return null; }
}
export function listForgeSignalCodes(): string[] {
  try { return Object.keys(localStorage).filter(k => k.startsWith("forge-signal-code:")).map(k => k.slice("forge-signal-code:".length)); } catch { return []; }
}
