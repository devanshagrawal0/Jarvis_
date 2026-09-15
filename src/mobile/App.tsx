import { useCallback, useEffect, useRef, useState } from "react";
import { Stage } from "./Stage";
import { Thread } from "./Thread";
import type { CortexState } from "./Cortex";
import { askJarvis, bootSession, fetchProfile, loadThread, prepareFiles, resolveClientContext, saveThread, STRENGTH_LABEL, type Health, type Profile, type Strength, type Turn } from "./brain";

// Batch 2 (plan v2 §2/§3): the shell around the centrepiece — thin top bar, hairline composer,
// tab strip, and the thread. The globe docks into the top bar the moment a conversation starts.

type Tab = "jarvis" | "control" | "files" | "rooms" | "you";
const TABS: Array<{ id: Tab; label: string; batch: number }> = [
  { id: "jarvis", label: "Jarvis", batch: 2 }, { id: "control", label: "Control", batch: 6 }, { id: "files", label: "Files", batch: 7 }, { id: "rooms", label: "Rooms", batch: 8 }, { id: "you", label: "You", batch: 9 },
];
const STRENGTHS: Strength[] = ["cost-guarded", "balanced", "full"];
const I = {
  jarvis: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="9" strokeDasharray="3 3.5" /></svg>,
  control: <svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.5" /><path d="M8.5 20h7M12 16.5V20" /></svg>,
  files: <svg viewBox="0 0 24 24"><path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>,
  rooms: <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></svg>,
  you: <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>,
  attach: <svg viewBox="0 0 24 24"><path d="M21 12.5 12.6 21a5 5 0 0 1-7-7l8.8-8.8a3.2 3.2 0 0 1 4.5 4.5L10 18.6a1.4 1.4 0 0 1-2-2l8-8" /></svg>,
  mic: <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>,
  send: <svg viewBox="0 0 24 24"><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5" /></svg>,
  stop: <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></svg>,
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function MobileApp() {
  const [tab, setTab] = useState<Tab>("jarvis");
  const [turns, setTurns] = useState<Turn[]>(() => loadThread());
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [strength, setStrength] = useState<Strength>(() => (localStorage.getItem("jarvis.mobile.strength") as Strength) || "balanced");
  const [deep, setDeep] = useState(false);
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dockSlot = useRef<HTMLDivElement>(null);
  const abortRef = useRef<{ cancelled: boolean } | null>(null);

  const name = profile?.identity?.preferred_name || profile?.identity?.legal_name || "";
  const hasThread = turns.length > 0;
  const online = health === undefined ? "checking" : health?.ok ? "online" : "offline";
  const docked = hasThread || tab !== "jarvis";
  const last = turns[turns.length - 1];
  const coreState: CortexState = busy ? (last?.text ? "speaking" : "thinking") : "idle";

  useEffect(() => {
    let alive = true;
    (async () => { const h = await bootSession(); if (!alive) return; setHealth(h); const p = await fetchProfile(); if (alive) setProfile(p); void resolveClientContext(); })();
    const t = window.setInterval(async () => { const h = await bootSession(); if (alive) setHealth(h); }, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => { saveThread(turns); }, [turns]);
  useEffect(() => { try { localStorage.setItem("jarvis.mobile.strength", strength); } catch { /* ignore */ } }, [strength]);

  const grow = useCallback(() => { const el = inputRef.current; if (!el) return; el.style.height = "0px"; el.style.height = `${Math.min(el.scrollHeight, 88)}px`; }, []);
  useEffect(grow, [text, grow]);

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
    setTurns((t) => [...t, userTurn, modelTurn]); setText(""); setFiles([]);
    const token = { cancelled: false }; abortRef.current = token;
    const patch = (fn: (m: Turn) => Turn) => setTurns((t) => t.map((x) => (x.id === modelTurn.id ? fn(x) : x)));
    try {
      const result = await askJarvis(prompt || "(see attachment)", history, { strength, deepResearch: deep, files: prepared }, {
        onDelta: (d) => { if (!token.cancelled) patch((m) => ({ ...m, text: m.text + d, phase: undefined })); },
        onPhase: (phase, message) => { if (!token.cancelled) patch((m) => ({ ...m, phase: message || phase })); },
        onEvent: (ev) => { if (!token.cancelled) patch((m) => ({ ...m, activity: [...(m.activity || []), ev].slice(-24) })); },
        onUi: (actions) => { if (!token.cancelled) patch((m) => ({ ...m, uiActions: [...(m.uiActions || []), ...actions] })); },
      });
      if (token.cancelled) return;
      patch((m) => ({ ...m, streaming: false, phase: undefined, text: typeof result.response === "string" && result.response.trim() ? result.response : m.text, result, uiActions: result.uiActions?.length ? result.uiActions : m.uiActions }));
      const p = await fetchProfile(); setProfile(p);
    } catch (e) {
      if (!token.cancelled) patch((m) => ({ ...m, streaming: false, phase: undefined, error: e instanceof Error ? e.message : String(e) }));
    } finally { if (abortRef.current === token) { abortRef.current = null; setBusy(false); } }
  }, [busy, turns, strength, deep]);

  const stop = () => { if (abortRef.current) { abortRef.current.cancelled = true; abortRef.current = null; } setBusy(false); setTurns((t) => t.map((x) => (x.streaming ? { ...x, streaming: false, phase: undefined, error: x.text ? undefined : "Stopped." } : x))); };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); void send(text, files); } };

  const spend = profile?.cost?.today?.cost;
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className={`app ${docked ? "docked" : "hero"}`}>
      <Stage docked={docked} slot={dockSlot} state={coreState} />
      <div ref={scrollRef} className="scroll">
        <header className="top">
          <div className="top-in">
            <div ref={dockSlot} className="slot" />
            <span className="wordmark">JARVIS</span>
            <span className="status"><i className={`dot ${online === "online" ? "ok" : online === "offline" ? "bad" : "warn"}`} />{online === "online" ? (name || "Online") : online === "offline" ? "PC unreachable" : "Connecting"}</span>
            {typeof spend === "number" ? <span className="spend mono">${spend.toFixed(2)}</span> : null}
          </div>
        </header>

        <main className="content">
          {tab === "jarvis"
            ? (hasThread ? <Thread turns={turns} onSend={(t) => void send(t)} onFollowup={(t) => setTurns((x) => [...x, { id: uid(), role: "model", text: t, at: new Date().toISOString() }])} /> : <div className="hero-space" />)
            : <div className="not-built"><div className="kicker">{current.label}</div><div className="nb-title">Not built yet</div><div className="nb-body">Arrives in batch {current.batch}. Nothing here is faked.</div></div>}
        </main>

        <footer className="dock">
          {tab === "jarvis" ? (
            <div className="composer-wrap">
              {files.length ? <div className="chips">{files.map((f) => <button key={f.name} type="button" className="chip" onClick={() => setFiles((x) => x.filter((y) => y !== f))}>{f.name} ×</button>)}</div> : null}
              {note ? <div className="note">{note}</div> : null}
              <div className="composer">
                <button type="button" className="ic" aria-label="Voice" onClick={() => setNote("Voice arrives in batch 5 — not wired yet.")}>{I.mic}</button>
                <textarea ref={inputRef} className="input" rows={1} value={text} placeholder={busy ? "Working…" : "Ask Jarvis"} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoCapitalize="sentences" />
                <button type="button" className={`ic ${files.length ? "on" : ""}`} onClick={() => fileRef.current?.click()} aria-label="Attach">{I.attach}</button>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const list = Array.from(e.target.files || []); if (list.length) setFiles((x) => [...x, ...list].slice(0, 5)); e.target.value = ""; }} />
                {busy ? <button type="button" className="ic send stop" onClick={stop} aria-label="Stop">{I.stop}</button>
                  : <button type="button" className={`ic send ${text.trim() || files.length ? "ready" : ""}`} onClick={() => void send(text, files)} aria-label="Send" disabled={!text.trim() && !files.length}>{I.send}</button>}
              </div>
              <div className="meta">
                <button type="button" onClick={() => setStrength(STRENGTHS[(STRENGTHS.indexOf(strength) + 1) % STRENGTHS.length])}>Cortex <b>{STRENGTH_LABEL[strength]}</b></button>
                <i />
                <button type="button" onClick={() => setDeep((d) => !d)}>Research <b className={deep ? "on" : ""}>{deep ? "Deep" : "Fast"}</b></button>
              </div>
            </div>
          ) : null}
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => <button key={t.id} type="button" className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}><span className="tab-ico">{I[t.id]}</span><span className="tab-lbl">{t.label}</span></button>)}
          </nav>
        </footer>
      </div>
    </div>
  );
}
