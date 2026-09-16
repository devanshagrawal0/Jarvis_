import { useCallback, useEffect, useRef, useState } from "react";
import { askJarvis, prepareFiles, type Strength, type Turn } from "./brain";

// One conversation with JARVIS, persisted under `key`. The home tab and the Control tab's Command
// mode are both this hook with different keys — same brain, same streaming, same cards.

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function load(key: string): Turn[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map((t: Turn) => ({ ...t, streaming: false, phase: undefined })).slice(-60) : [];
  } catch { return []; }
}
function save(key: string, turns: Turn[]) {
  try { localStorage.setItem(key, JSON.stringify(turns.slice(-60).map((t) => ({ ...t, image: t.image && t.image.length > 200_000 ? undefined : t.image, activity: undefined })))); } catch { /* full or private */ }
}

export function useThread(key: string, opts: { strength: Strength; deep: boolean; onDone?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => load(key));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const abortRef = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => { save(key, turns); }, [key, turns]);

  const send = useCallback(async (raw: string, attached: File[] = []) => {
    const prompt = raw.trim();
    if ((!prompt && !attached.length) || busy) return;
    setNote(""); setBusy(true);
    let prepared: Awaited<ReturnType<typeof prepareFiles>> = [];
    try { prepared = await prepareFiles(attached); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); setBusy(false); return; }
    const image = prepared.find((f) => f.dataUrl && f.mimeType.startsWith("image/"))?.dataUrl;
    const userTurn: Turn = { id: uid(), role: "user", text: prompt, at: new Date().toISOString(), image, files: prepared.filter((f) => !(f.dataUrl && f.mimeType.startsWith("image/"))).map((f) => f.name) };
    const modelTurn: Turn = { id: uid(), role: "model", text: "", at: new Date().toISOString(), streaming: true, activity: [] };
    const history = turns;
    setTurns((t) => [...t, userTurn, modelTurn]);
    const token = { cancelled: false }; abortRef.current = token;
    const patch = (fn: (m: Turn) => Turn) => setTurns((t) => t.map((x) => (x.id === modelTurn.id ? fn(x) : x)));
    try {
      const result = await askJarvis(prompt || "(see attachment)", history, { strength: opts.strength, deepResearch: opts.deep, files: prepared }, {
        onDelta: (d) => { if (!token.cancelled) patch((m) => ({ ...m, text: m.text + d, phase: undefined })); },
        onPhase: (phase, message) => { if (!token.cancelled) patch((m) => ({ ...m, phase: message || phase })); },
        onEvent: (ev) => { if (!token.cancelled) patch((m) => ({ ...m, activity: [...(m.activity || []), ev].slice(-24) })); },
        onUi: (actions) => { if (!token.cancelled) patch((m) => ({ ...m, uiActions: [...(m.uiActions || []), ...actions] })); },
      });
      if (token.cancelled) return;
      patch((m) => ({ ...m, streaming: false, phase: undefined, text: typeof result.response === "string" && result.response.trim() ? result.response : m.text, result, uiActions: result.uiActions?.length ? result.uiActions : m.uiActions }));
      opts.onDone?.();
    } catch (e) {
      if (!token.cancelled) patch((m) => ({ ...m, streaming: false, phase: undefined, error: e instanceof Error ? e.message : String(e) }));
    } finally { if (abortRef.current === token) { abortRef.current = null; setBusy(false); } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, turns, opts.strength, opts.deep]);

  const stop = useCallback(() => {
    if (abortRef.current) { abortRef.current.cancelled = true; abortRef.current = null; }
    setBusy(false);
    setTurns((t) => t.map((x) => (x.streaming ? { ...x, streaming: false, phase: undefined, error: x.text ? undefined : "Stopped." } : x)));
  }, []);

  const append = useCallback((role: "user" | "model", text: string) => setTurns((x) => [...x, { id: uid(), role, text, at: new Date().toISOString() }]), []);
  const clear = useCallback(() => setTurns([]), []);

  return { turns, setTurns, busy, note, setNote, send, stop, append, clear };
}
