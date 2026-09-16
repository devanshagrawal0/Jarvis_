import { useCallback, useEffect, useRef, useState } from "react";
import { Stage } from "./Stage";
import { Thread } from "./Thread";
import { Control } from "./Control";
import { useVoice } from "./voice";
import type { CortexState } from "./Cortex";
import { useThread } from "./useThread";
import { bootSession, fetchProfile, resolveClientContext, STRENGTH_LABEL, type Health, type Profile, type Strength, type Turn } from "./brain";

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
  send: <svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg>,
  stop: <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></svg>,
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function MobileApp() {
  const [tab, setTab] = useState<Tab>("jarvis");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Same default as the desktop bar (Eco = minimal thinking). "Balanced" was costing 2–4 s of
  // thinking on every call, twice per tool turn.
  const [strength, setStrength] = useState<Strength>(() => (localStorage.getItem("jarvis.mobile.strength") as Strength) || "cost-guarded");
  const [deep, setDeep] = useState(false);
  const [health, setHealth] = useState<Health | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const thread = useThread("jarvis.mobile.thread.v2", { strength, deep, onDone: () => { void fetchProfile().then(setProfile); } });
  const { turns, setTurns, busy, note, setNote } = thread;
  const [ctlDock, setCtlDock] = useState<HTMLElement | null>(null);
  // Install coach (plan v1 §2.5): only when the page is NOT already running as an installed app,
  // and only until dismissed once. iOS has no install prompt API — the Share sheet is the way.
  const [coach, setCoach] = useState(() => {
    try {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
      return !standalone && localStorage.getItem("jarvis.mobile.coach") !== "off";
    } catch { return false; }
  });
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dockSlot = useRef<HTMLDivElement>(null);
  const heroArea = useRef<HTMLDivElement>(null);

  // Voice: the transcripts land in the thread as they are heard, one user turn and one model turn
  // per spoken exchange, so the conversation stays the single record.
  const voiceIds = useRef<{ user: string; model: string }>({ user: "", model: "" });
  const upsertTurn = (id: string, role: "user" | "model", text: string, streaming: boolean) => setTurns((t) => {
    const i = t.findIndex((x) => x.id === id);
    const turn: Turn = i >= 0 ? { ...t[i], text, streaming } : { id, role, text, at: new Date().toISOString(), streaming };
    return i >= 0 ? t.map((x, k) => (k === i ? turn : x)) : [...t, turn];
  });
  const voice = useVoice({
    onUserText: (text, final) => {
      if (!voiceIds.current.user) voiceIds.current.user = `v-u-${uid()}`;
      if (text) upsertTurn(voiceIds.current.user, "user", text, !final);
      if (final) voiceIds.current.user = "";
    },
    onModelText: (text, final) => {
      if (!voiceIds.current.model) voiceIds.current.model = `v-m-${uid()}`;
      if (text) upsertTurn(voiceIds.current.model, "model", text, !final);
      if (final) voiceIds.current.model = "";
    },
    onTool: (tool) => setNote(`Voice used ${tool.replace(/_/g, " ")}`),
  });

  const name = profile?.identity?.preferred_name || profile?.identity?.legal_name || "";
  const hasThread = turns.length > 0;
  const online = health === undefined ? "checking" : health?.ok ? "online" : "offline";
  const docked = hasThread || tab !== "jarvis";
  const last = turns[turns.length - 1];
  const coreState: CortexState = voice.active ? (voice.state === "connecting" ? "thinking" : "speaking") : busy ? (last?.text ? "speaking" : "thinking") : "idle";
  const clock = `${Math.floor(voice.seconds / 60)}:${String(voice.seconds % 60).padStart(2, "0")}`;

  useEffect(() => {
    let alive = true;
    (async () => { const h = await bootSession(); if (!alive) return; setHealth(h); const p = await fetchProfile(); if (alive) setProfile(p); void resolveClientContext(); })();
    const t = window.setInterval(async () => { const h = await bootSession(); if (alive) setHealth(h); }, 30000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => { try { localStorage.setItem("jarvis.mobile.strength", strength); } catch { /* ignore */ } }, [strength]);

  const [multi, setMulti] = useState(false);
  const grow = useCallback(() => { const el = inputRef.current; if (!el) return; el.style.height = "0px"; const h = Math.min(el.scrollHeight, 156); el.style.height = `${h}px`; setMulti(h > 44); }, []);
  useEffect(grow, [text, grow]);

  const send = useCallback(async (raw: string, attached: File[] = []) => { setText(""); setFiles([]); await thread.send(raw, attached); }, [thread]);
  const stop = thread.stop;
  // Enter (the keyboard's "send"/"done" key included) sends; Shift+Enter inserts a newline.
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text, files); } };

  const spend = profile?.cost?.today?.cost;
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className={`app ${docked ? "docked" : "hero"}`} data-build={typeof __JARVIS_BUILD__ === "string" ? __JARVIS_BUILD__ : "dev"}>
      <Stage docked={docked} hidden={tab !== "jarvis"} slot={dockSlot} area={heroArea} state={coreState} audioRef={voice.level} />
      {voice.state === "listening" || voice.state === "speaking" ? <div className={`edge-glow ${voice.state}`} aria-hidden="true" /> : null}
      <div ref={scrollRef} className="scroll">
        <header className="top">
          <div className="top-in">
            <div ref={dockSlot} className="slot" />
            <span className="wordmark">JARVIS</span>
            <span className="status">
              <i className={`dot ${online === "online" ? "ok" : online === "offline" ? "bad" : "warn"}`} />
              {voice.active ? <span className="live">Live · {clock}{voice.state === "connecting" ? " · connecting" : voice.state === "speaking" ? " · speaking" : ""}</span> : online === "online" ? (name || "Online") : online === "offline" ? "PC unreachable" : "Connecting"}
            </span>
            {typeof spend === "number" ? <span className="spend mono">${spend.toFixed(2)}</span> : null}
          </div>
        </header>

        {coach ? (
          <div className="coach">
            <span>{isIOS ? "Install: Share → Add to Home Screen" : "Install: browser menu → Add to Home screen"}</span>
            <button type="button" aria-label="Dismiss" onClick={() => { setCoach(false); try { localStorage.setItem("jarvis.mobile.coach", "off"); } catch { /* ignore */ } }}>×</button>
          </div>
        ) : null}
        <main className="content">
          {tab === "jarvis"
            ? (hasThread ? <Thread turns={turns} onSend={(t) => void send(t)} onFollowup={(t) => setTurns((x) => [...x, { id: uid(), role: "model", text: t, at: new Date().toISOString() }])} /> : (
              <div className="home">
                <div ref={heroArea} className="globe-box" />
                <div className="home-title">{name ? `Hello, ${name}.` : "Hello."}</div>
                <div className="home-sub">{online === "online" ? "Ask anything, or tap the mic." : online === "offline" ? "The PC is not reachable." : "Connecting…"}</div>
              </div>
            ))
            : tab === "control" ? <Control active={tab === "control"} dock={ctlDock} strength={strength} />
            : <div className="not-built"><div className="kicker">{current.label}</div><div className="nb-title">Not built yet</div><div className="nb-body">Arrives in batch {current.batch}. Nothing here is faked.</div><div className="build mono">build {typeof __JARVIS_BUILD__ === "string" ? __JARVIS_BUILD__ : "dev"}</div></div>}
        </main>

        <footer className="dock">
          {tab === "jarvis" ? (
            <div className="composer-wrap">
              {files.length ? <div className="chips">{files.map((f) => <button key={f.name} type="button" className="chip" onClick={() => setFiles((x) => x.filter((y) => y !== f))}>{f.name} ×</button>)}</div> : null}
              {voice.state === "error" && voice.detail ? <div className="note">{voice.detail}</div> : note ? <div className="note">{note}</div> : null}
              <div className={`composer ${multi ? "multi" : ""}`}>
                <button type="button" className={`ic ${files.length ? "on" : ""}`} onClick={() => fileRef.current?.click()} aria-label="Attach">{I.attach}</button>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const list = Array.from(e.target.files || []); if (list.length) setFiles((x) => [...x, ...list].slice(0, 5)); e.target.value = ""; }} />
                <textarea ref={inputRef} className="input" rows={1} value={text} placeholder={busy ? "Working…" : "Ask anything"} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoCapitalize="sentences" />
                <div className="slot-r">
                  {voice.active
                    ? <button key="live" type="button" className="circle live" aria-label="Stop voice" onClick={() => void voice.stop()}>{I.stop}</button>
                    : busy
                      ? <button key="stop" type="button" className="circle stop" aria-label="Stop" onClick={stop}>{I.stop}</button>
                      : (text.trim() || files.length)
                        ? <button key="send" type="button" className="circle send" aria-label="Send" onClick={() => void send(text, files)}>{I.send}</button>
                        : <button key="mic" type="button" className="circle" aria-label="Talk" onClick={() => { setNote(""); void voice.start(); }}>{I.mic}</button>}
                </div>
              </div>
              <div className="meta">
                <button type="button" onClick={() => setStrength(STRENGTHS[(STRENGTHS.indexOf(strength) + 1) % STRENGTHS.length])}>Cortex <b>{STRENGTH_LABEL[strength]}</b></button>
                <i />
                <button type="button" onClick={() => setDeep((d) => !d)}>Research <b className={deep ? "on" : ""}>{deep ? "Deep" : "Fast"}</b></button>
              </div>
            </div>
          ) : tab === "control" ? <div ref={setCtlDock} /> : null}
          <nav className="tabs" aria-label="Sections">
            {TABS.map((t) => <button key={t.id} type="button" className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}><span className="tab-ico">{I[t.id]}</span><span className="tab-lbl">{t.label}</span></button>)}
          </nav>
        </footer>
      </div>
    </div>
  );
}
