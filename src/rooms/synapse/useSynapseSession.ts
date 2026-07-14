import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";

// W1: single source of truth for the Synapse room + widget. Talks to the real single-machine
// /api/coop-symbiote/* engine (backed by the W0 SQLite store). Polls while `active`.

export type SynSession = any;

export function useSynapseSession(active: boolean, pollMs = 4000) {
  const [session, setSession] = useState<SynSession | null>(null);
  const [sessions, setSessions] = useState<SynSession[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [memory, setMemory] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  // Set true on setup (not just false on cleanup) so React StrictMode's mount→unmount→mount
  // in dev doesn't leave mounted.current stuck false, which would make refresh() bail forever.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const [status, mem, manifest] = await Promise.all([
        api<any>("/api/coop-symbiote/status").catch(() => null),
        api<any>("/api/coop-symbiote/memory").catch(() => null),
        api<any>("/api/coop-symbiote/manifest?limit=200").catch(() => ({ files: [] })),
      ]);
      if (!mounted.current) return;
      setSession(status?.activeSession || null);
      setSessions(status?.sessions || []);
      setMemory(mem || status?.activeSession?.memory || null);
      setFiles(manifest?.files || []);
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    void refresh().finally(() => { if (mounted.current) setLoading(false); });
    const timer = window.setInterval(() => { void refresh(); }, pollMs);
    return () => window.clearInterval(timer);
  }, [active, pollMs, refresh]);

  // Run a mutating action, then refresh. Mirrors DeviceMeshCommandCenter's action() pattern.
  const run = useCallback(async (name: string, work: () => Promise<any>, message: string) => {
    setBusy(name); setError(""); setNotice("");
    try {
      const result = await work();
      if (mounted.current) setNotice(message);
      await refresh();
      return result;
    } catch (e: any) {
      if (mounted.current) setError(e?.message || String(e));
      return null;
    } finally {
      if (mounted.current) setBusy("");
    }
  }, [refresh]);

  return { session, sessions, files, memory, loading, busy, notice, error, setNotice, setError, refresh, run };
}
