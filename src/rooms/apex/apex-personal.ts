/* APEX Home v3 — personalization: watchlist + real user-set alerts.
   Alerts are evaluated client-side against live quotes (polled every 15s for
   watchlist ∪ alerted tickers) and fire a real toast when a threshold is
   crossed. All persisted to localStorage. No proprietary data. */

import { useEffect, useRef, useState } from "react";
import { fetchQuote, type ApexLive } from "./apex-data";

export type AlertKind = "above" | "below" | "pctUp" | "pctDown";
export interface Alert { id: string; ticker: string; kind: AlertKind; value: number; created: number; firedAt?: number }

const LS_WATCH = "apex.home.watch.v1", LS_ALERTS = "apex.home.alerts.v1";
function load<T>(k: string, fb: T): T { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : fb; } catch { return fb; } }
function save(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

export const KIND_LABEL: Record<AlertKind, string> = { above: "crosses above", below: "falls below", pctUp: "gains ≥", pctDown: "drops ≥" };
export function alertText(a: Alert): string {
  return a.kind === "above" || a.kind === "below"
    ? `${a.ticker} ${KIND_LABEL[a.kind]} $${a.value}`
    : `${a.ticker} ${KIND_LABEL[a.kind]} ${a.value}% today`;
}

export function usePersonal({ live, onFire }: { live: ApexLive; onFire: (a: Alert, msg: string) => void }) {
  const [watchlist, setWatchlist] = useState<string[]>(() => load(LS_WATCH, ["NVDA", "AAPL", "TSLA", "BTCUSDT"]));
  const [alerts, setAlerts] = useState<Alert[]>(() => load(LS_ALERTS, []));
  const [quotes, setQuotes] = useState<Record<string, { last: number | null; changePct: number | null }>>({});
  useEffect(() => save(LS_WATCH, watchlist), [watchlist]);
  useEffect(() => save(LS_ALERTS, alerts), [alerts]);

  const toggleWatch = (t: string) => setWatchlist(w => w.includes(t) ? w.filter(x => x !== t) : [...w, t]);
  const addAlert = (a: Omit<Alert, "id" | "created">) => setAlerts(al => [...al, { ...a, id: Math.random().toString(36).slice(2), created: Date.now() }]);
  const removeAlert = (id: string) => setAlerts(al => al.filter(a => a.id !== id));

  // poll quotes for watchlist ∪ alert tickers (real prices, 15s)
  const tickersRef = useRef<string[]>([]);
  tickersRef.current = Array.from(new Set([...watchlist, ...alerts.map(a => a.ticker)]));
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const ts = tickersRef.current.slice(0, 24);
      const out: Record<string, { last: number | null; changePct: number | null }> = {};
      await Promise.all(ts.map(async t => { const q = await fetchQuote(t); if (q) out[t] = { last: q.last, changePct: q.changePct ?? null }; }));
      if (alive && Object.keys(out).length) setQuotes(q => ({ ...q, ...out }));
    };
    pull(); const iv = window.setInterval(pull, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // evaluate alerts whenever quotes update; fire once each
  useEffect(() => {
    alerts.forEach(a => {
      if (a.firedAt) return;
      const q = quotes[a.ticker]; if (!q || q.last == null) return;
      const hit =
        (a.kind === "above" && q.last >= a.value) ||
        (a.kind === "below" && q.last <= a.value) ||
        (a.kind === "pctUp" && (q.changePct ?? 0) >= a.value) ||
        (a.kind === "pctDown" && (q.changePct ?? 0) <= -a.value);
      if (hit) { setAlerts(al => al.map(x => x.id === a.id ? { ...x, firedAt: Date.now() } : x)); onFire(a, `${alertText(a)} — now $${q.last?.toFixed(2)}`); }
    });
  }, [quotes]); // eslint-disable-line react-hooks/exhaustive-deps

  return { watchlist, toggleWatch, isWatched: (t: string) => watchlist.includes(t), alerts, addAlert, removeAlert, quotes };
}
