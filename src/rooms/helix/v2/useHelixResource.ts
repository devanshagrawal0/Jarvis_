// HELIX v2 data layer (docs/ux/04 §3–4). Stale-while-revalidate cache + AbortController
// on unmount/param-change (kills the "fast tab-switch renders a stale response over a fresh
// one" race) + prefetch-on-intent. One module-level cache keyed by (surface, projectId, …).
import { useCallback, useEffect, useState } from "react";

type CacheEntry = { data: any; ts: number };
const cache = new Map<string, CacheEntry>();

async function fetchJson(url: string, signal?: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Warm a resource before it's needed (hover/focus). No-op if already cached. */
export function prefetchHelix(key: string, url: string) {
  if (cache.has(key)) return;
  fetchJson(url).then(d => cache.set(key, { data: d, ts: Date.now() })).catch(() => {});
}

/** Drop cache entries so the next mount refetches. Prefix clears a family; empty clears all. */
export function invalidateHelix(prefix?: string) {
  if (prefix == null) { cache.clear(); return; }
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/** Single-endpoint SWR resource. Shows cached data instantly, revalidates in the background,
 *  aborts the in-flight request on key/url change or unmount. */
export function useHelixResource<T = any>(key: string | null, url: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled !== false && !!key && !!url;
  const [data, setData] = useState<T | undefined>(() => (key ? (cache.get(key)?.data as T) : undefined));
  const [loading, setLoading] = useState<boolean>(enabled && !(key != null && cache.has(key)));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const k = key as string, u = url as string;
    const ctrl = new AbortController();
    const cached = cache.get(k);
    if (cached) { setData(cached.data); setLoading(false); } else { setLoading(true); }
    setError(null);
    fetchJson(u, ctrl.signal)
      .then(d => { cache.set(k, { data: d, ts: Date.now() }); setData(d); setLoading(false); setError(null); })
      .catch(e => { if (e?.name !== "AbortError") { setError(e?.message || "Failed to load"); setLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, url, enabled, nonce]);

  const refetch = useCallback(() => { if (key) cache.delete(key); setNonce(n => n + 1); }, [key]);
  return { data, loading, error, refetch };
}

/** Aggregate several endpoints into one {data[], loading, error} — for bento surfaces (Home).
 *  Individual endpoints may fail to null; error is set only when ALL fail (true outage). */
export function useHelixAll<T = any>(key: string | null, urls: (string | null)[], opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled !== false && !!key && urls.some(Boolean);
  const [data, setData] = useState<(T | null)[] | undefined>(() => (key ? (cache.get(key)?.data as any) : undefined));
  const [loading, setLoading] = useState<boolean>(enabled && !(key != null && cache.has(key)));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const urlSig = urls.join("|");

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    const k = key as string;
    const ctrl = new AbortController();
    const cached = cache.get(k);
    if (cached) { setData(cached.data); setLoading(false); } else { setLoading(true); }
    setError(null);
    Promise.all(urls.map(u => u
      ? fetchJson(u, ctrl.signal).catch(e => { if (e?.name === "AbortError") throw e; return null; })
      : Promise.resolve(null)))
      .then(arr => {
        cache.set(k, { data: arr, ts: Date.now() });
        setData(arr as any); setLoading(false);
        setError(arr.every(x => x == null) ? "Couldn't reach HELIX services" : null);
      })
      .catch(e => { if (e?.name !== "AbortError") { setError(e?.message || "Failed to load"); setLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, urlSig, enabled, nonce]);

  const refetch = useCallback(() => { if (key) cache.delete(key); setNonce(n => n + 1); }, [key]);
  return { data, loading, error, refetch };
}
