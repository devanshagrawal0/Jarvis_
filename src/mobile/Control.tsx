import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, post } from "../api";
import { Thread } from "./Thread";
import { useThread } from "./useThread";
import { WhepPlayer, type StreamStats } from "./whep";
import type { Strength } from "./brain";

// Control (batch 6, v2) — two ways to run the PC from the phone.
//
//   Command  · tell JARVIS what to do on the PC: open apps and games, switch its rooms, type, close
//              things. The chips are what the machine reports as installed (Get-StartApps) and the
//              rooms the desktop actually has — nothing invented. UI actions go to the PC's screen
//              over /api/ui/events, so "open the apex room" changes the desktop, not the phone.
//   Takeover · the PC as live video (WebRTC, ~100 ms), full screen, landscape. Tap = click,
//              hold = right-click, hold+drag = drag, two fingers = scroll, keyboard types straight
//              onto the PC. Every input goes through a persistent SendInput agent (ms, not s).

type Mode = "command" | "takeover";
type AppEntry = { name: string; id: string };
type Room = { id: string; what: string };
type AppsPayload = { apps: AppEntry[]; rooms: Room[]; desktopListening: boolean };
type Frame = { frameUrl: string; capturedAt: string; dimensions?: string; error?: string };
type PcEvent = { t: "move"; x: number; y: number } | { t: "click"; x: number; y: number; b: "left" | "right" | "middle"; n?: number } | { t: "down" | "up"; b: "left" | "right" | "middle" } | { t: "wheel"; x: number; y: number; dy: number; dx: number } | { t: "key"; k: string; d?: "down" | "up" } | { t: "text"; s: string };

const HOTKEYS: Array<[string, string]> = [["Esc", "escape"], ["Tab", "tab"], ["⌫", "backspace"], ["Enter", "enter"], ["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"], ["Win", "win"], ["Ctrl+C", "ctrl+c"], ["Ctrl+V", "ctrl+v"], ["Ctrl+Z", "ctrl+z"], ["Alt+Tab", "alt+tab"], ["Alt+F4", "alt+f4"], ["F11", "f11"], ["Space", "space"]];
const QUALITIES = ["balanced", "best", "light"] as const;
const QUALITY_LABEL: Record<string, string> = { best: "1080p60 · 12 Mb", balanced: "1080p60 · 8 Mb", light: "720p30 · 4 Mb" };

export function Control({ active, dock, strength }: { active: boolean; dock: HTMLElement | null; strength: Strength }) {
  const [mode, setMode] = useState<Mode>("command");
  return (
    <div className="ctl">
      <div className="seg" role="tablist" aria-label="Control mode">
        <button type="button" role="tab" aria-selected={mode === "command"} className={mode === "command" ? "on" : ""} onClick={() => setMode("command")}>Command</button>
        <button type="button" role="tab" aria-selected={mode === "takeover"} className={mode === "takeover" ? "on" : ""} onClick={() => setMode("takeover")}>Takeover</button>
      </div>
      <Command active={active && mode === "command"} dock={dock} strength={strength} onTakeover={() => setMode("takeover")} />
      {active && mode === "takeover" ? <Takeover onExit={() => setMode("command")} /> : null}
    </div>
  );
}

// ── Command ───────────────────────────────────────────────────────────────────────────────────
function Command({ active, dock, strength, onTakeover }: { active: boolean; dock: HTMLElement | null; strength: Strength; onTakeover: () => void }) {
  const thread = useThread("jarvis.mobile.pc.v1", { strength, deep: false });
  const [text, setText] = useState("");
  const [inv, setInv] = useState<AppsPayload | null>(null);
  const [invErr, setInvErr] = useState("");
  const [q, setQ] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // what the PC can open + whether JARVIS is open on the PC (the desktop must be listening for
  // room switches to land there)
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => { try { const r = await api<AppsPayload>("/api/device-mesh/apps"); if (alive) { setInv(r); setInvErr(""); } } catch (e) { if (alive) setInvErr(e instanceof Error ? e.message : String(e)); } };
    void pull();
    const t = window.setInterval(pull, 20000);
    return () => { alive = false; window.clearInterval(t); };
  }, [active]);

  // a glimpse of the screen, refreshed slowly — tap it for the real thing
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pull = async () => { try { const f = await api<Frame>("/api/device-mesh/live/frame?w=720&q=60"); if (alive && f.frameUrl) setFrame(f); } catch { /* shown as no glimpse */ } };
    (async () => { try { await post("/api/device-mesh/live/start", { targetFps: 0.2, quality: "phone" }); } catch { /* no glimpse then */ } await pull(); })();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 8000);
    return () => { alive = false; window.clearInterval(t); void post("/api/device-mesh/live/pause", {}).catch(() => {}); };
  }, [active]);

  const apps = useMemo(() => {
    const list = inv?.apps || [];
    const needle = q.trim().toLowerCase();
    const hit = needle ? list.filter((a) => a.name.toLowerCase().includes(needle)) : list;
    return hit.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, needle ? 24 : 10);
  }, [inv, q]);

  const run = (t: string) => { setText(""); void thread.send(t); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim()) run(text); } };

  const composer = dock && active ? createPortal(
    <div className="composer-wrap">
      {thread.note ? <div className="note">{thread.note}</div> : null}
      <div className="composer">
        <input ref={inputRef} className="input" value={text} placeholder={thread.busy ? "Working on the PC…" : "Tell the PC what to do"} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoCapitalize="sentences" />
        <div className="slot-r">
          {thread.busy
            ? <button key="stop" type="button" className="circle stop" aria-label="Stop" onClick={thread.stop}><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></svg></button>
            : <button key="send" type="button" className={`circle ${text.trim() ? "send" : ""}`} aria-label="Send" disabled={!text.trim()} onClick={() => run(text)}><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>}
        </div>
      </div>
    </div>, dock) : null;

  const listening = inv?.desktopListening;
  return (
    <>
      <button type="button" className="glimpse" onClick={onTakeover} aria-label="Take over the PC">
        {frame?.frameUrl ? <img src={frame.frameUrl} alt="" draggable={false} /> : <span className="glimpse-empty">No picture yet</span>}
        <span className="glimpse-cta">Take over →</span>
      </button>
      <div className="pc-line">
        <i className={`dot ${inv ? (listening ? "ok" : "warn") : invErr ? "bad" : ""}`} />
        <span>{invErr ? "PC not answering" : !inv ? "Asking the PC…" : listening ? "JARVIS is open on the PC" : "JARVIS is not open on the PC — apps still work, room switches will not"}</span>
      </div>

      {inv?.rooms?.length ? (
        <div className="chips-row">
          <span className="chips-k">Rooms</span>
          {inv.rooms.map((r) => <button key={r.id} type="button" className="chip" onClick={() => run(`Open the ${r.id} room on the PC`)}>{r.what.split(" — ")[0]}</button>)}
        </div>
      ) : null}

      <div className="open-row">
        <input className="open-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={inv ? `Open… (${inv.apps.length} installed)` : "Open…"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </div>
      {apps.length ? (
        <div className="chips-wrap">
          {apps.map((a) => <button key={a.id} type="button" className="chip" onClick={() => { setQ(""); run(`Open ${a.name} on the PC`); }}>{a.name}</button>)}
        </div>
      ) : inv && q ? <div className="ctl-hint">Nothing installed matches “{q}”.</div> : null}

      {thread.turns.length
        ? <><div className="pc-thread-head"><span>PC</span><button type="button" onClick={thread.clear}>Clear</button></div><Thread turns={thread.turns} onSend={(t) => void thread.send(t)} onFollowup={(t) => thread.append("model", t)} /></>
        : <div className="ctl-hint">Say it like you would to a person at the PC: “open steam and start Elden Ring”, “close chrome”, “switch to the apex room”, “what’s on the screen?”</div>}
      {composer}
    </>
  );
}

// ── Takeover ──────────────────────────────────────────────────────────────────────────────────
function Takeover({ onExit }: { onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const kbdRef = useRef<HTMLInputElement>(null);
  const player = useRef<WhepPlayer | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "error">("starting");
  const [msg, setMsg] = useState("Starting the encoder on the PC…");
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [enc, setEnc] = useState<{ fps: number; bitrateKbps: number } | null>(null);
  const [keys, setKeys] = useState(false);
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>(() => (localStorage.getItem("jarvis.mobile.streamq") as any) || "balanced");
  const [landscapeNative, setLandscapeNative] = useState(window.innerWidth > window.innerHeight);
  const [rtt, setRtt] = useState(0);
  const [inputErr, setInputErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  // input queue: strictly ordered, one request in flight, moves coalesced
  const queue = useRef<PcEvent[]>([]);
  const flushing = useRef(false);
  const flush = useCallback(async () => {
    if (flushing.current || !queue.current.length) return;
    flushing.current = true;
    const events = queue.current.splice(0, 200);
    const t0 = performance.now();
    try { const r = await post<{ ok: boolean; error?: string }>("/api/device-mesh/stream/input", { events }); setRtt(Math.round(performance.now() - t0)); setInputErr(r.ok ? "" : r.error || "input failed"); }
    catch (e) { setInputErr(e instanceof Error ? e.message : String(e)); }
    finally { flushing.current = false; if (queue.current.length) void flush(); }
  }, []);
  const push = useCallback((ev: PcEvent) => {
    const last = queue.current[queue.current.length - 1];
    if (ev.t === "move" && last?.t === "move") queue.current[queue.current.length - 1] = ev; // only the newest position matters
    else queue.current.push(ev);
    void flush();
  }, [flush]);

  // stream lifecycle
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setPhase("starting"); setMsg("Starting the encoder on the PC…");
        const r = await post<{ ok: boolean; stream: { error?: string; fps: number; bitrateKbps: number }; whep: string }>("/api/device-mesh/stream/start", { quality });
        if (!alive) return;
        if (!r.ok) throw new Error(r.stream?.error || "The PC could not start the stream.");
        void post("/api/device-mesh/control/request", { reason: "Phone takeover", durationSeconds: 1800 }).catch(() => {});
        setMsg("Connecting video…");
        const v = videoRef.current!;
        const p = new WhepPlayer(v, r.whep, (s) => { if (alive) setStats({ ...s }); }, (state) => {
          if (!alive) return;
          if (state === "connected") { setPhase("live"); setMsg(""); }
          else if (state === "failed" || state === "disconnected") { setPhase("error"); setMsg("Video connection lost. Is the phone on the tailnet?"); }
        });
        player.current = p;
        await p.start();
      } catch (e) {
        if (alive) { setPhase("error"); setMsg(e instanceof Error ? e.message : String(e)); }
      }
    })();
    const beat = window.setInterval(async () => {
      try { const s = await api<{ stream: { running: boolean; fps: number; bitrateKbps: number; error?: string } }>("/api/device-mesh/stream/status?viewer=1"); if (alive) { setEnc({ fps: s.stream.fps, bitrateKbps: s.stream.bitrateKbps }); if (!s.stream.running && phaseRef.current === "live") { setPhase("error"); setMsg(s.stream.error || "The encoder stopped."); } } } catch { /* keep going */ }
    }, 5000);
    const onResize = () => setLandscapeNative(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    let lock: any = null; (navigator as any).wakeLock?.request?.("screen").then((l: any) => { lock = l; }).catch(() => {});
    return () => {
      alive = false; window.clearInterval(beat); window.removeEventListener("resize", onResize); lock?.release?.();
      void player.current?.stop(); player.current = null;
      void post("/api/device-mesh/stream/stop", {}).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, attempt]);

  // touch → PC coordinates. The frame is rotated 90° cw on a portrait phone: screen-y runs along
  // the video's width, screen-x runs up its height. Then the letterbox of object-fit: contain.
  const rotated = !landscapeNative;
  const toNorm = (clientX: number, clientY: number) => {
    const v = videoRef.current; if (!v) return null;
    const r = v.getBoundingClientRect();
    const W = rotated ? r.height : r.width, H = rotated ? r.width : r.height;
    const lx = rotated ? clientY - r.top : clientX - r.left;
    const ly = rotated ? r.width - (clientX - r.left) : clientY - r.top;
    const a = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    const cw = W / H > a ? H * a : W, ch = W / H > a ? H : W / a;
    const ox = (W - cw) / 2, oy = (H - ch) / 2;
    const nx = (lx - ox) / cw, ny = (ly - oy) / ch;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
    return { x: nx, y: ny };
  };

  const g = useRef<{ fingers: number; sx: number; sy: number; lx: number; ly: number; t: number; moved: boolean; held: boolean; dragging: boolean; timer: number; lastMove: number; lastWheel: number; wheelAcc: number }>({ fingers: 0, sx: 0, sy: 0, lx: 0, ly: 0, t: 0, moved: false, held: false, dragging: false, timer: 0, lastMove: 0, lastWheel: 0, wheelAcc: 0 });
  const onTouchStart = (e: React.TouchEvent) => {
    const s = g.current; window.clearTimeout(s.timer);
    const p = e.touches.length === 2 ? { clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2, clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2 } : e.touches[0];
    Object.assign(s, { fingers: e.touches.length, sx: p.clientX, sy: p.clientY, lx: p.clientX, ly: p.clientY, t: Date.now(), moved: false, held: false, dragging: false, wheelAcc: 0 });
    if (e.touches.length === 1) {
      const n = toNorm(p.clientX, p.clientY); if (n) push({ t: "move", x: n.x, y: n.y });
      s.timer = window.setTimeout(() => { if (!s.moved && s.fingers === 1) { s.held = true; } }, 380);
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = g.current;
    const p = e.touches.length === 2 ? { clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2, clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2 } : e.touches[0];
    if (!s.moved && Math.hypot(p.clientX - s.sx, p.clientY - s.sy) > 8) { s.moved = true; window.clearTimeout(s.timer); }
    if (e.touches.length === 2) {
      // scroll: distance travelled along the PC's vertical (rotated: screen-x) since the last send
      const dPc = rotated ? -(p.clientX - s.lx) : p.clientY - s.ly;
      s.wheelAcc += dPc; s.lx = p.clientX; s.ly = p.clientY;
      const now = performance.now();
      if (now - s.lastWheel > 60 && Math.abs(s.wheelAcc) >= 6) {
        const n = toNorm(p.clientX, p.clientY) || { x: 0.5, y: 0.5 };
        push({ t: "wheel", x: n.x, y: n.y, dy: Math.round(s.wheelAcc * 2), dx: 0 });
        s.wheelAcc = 0; s.lastWheel = now;
      }
      return;
    }
    if (!s.moved) return;
    const n = toNorm(p.clientX, p.clientY); if (!n) return;
    if (s.held && !s.dragging) { s.dragging = true; push({ t: "down", b: "left" }); }
    const now = performance.now();
    if (now - s.lastMove > 40) { push({ t: "move", x: n.x, y: n.y }); s.lastMove = now; }
    s.lx = p.clientX; s.ly = p.clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = g.current; window.clearTimeout(s.timer);
    if (e.touches.length) return;                       // a finger is still down
    if (s.fingers === 2) return;                         // scroll gesture ended
    const p = e.changedTouches[0];
    const n = toNorm(p.clientX, p.clientY);
    if (s.dragging) { if (n) push({ t: "move", x: n.x, y: n.y }); push({ t: "up", b: "left" }); }
    else if (s.held) { if (n) push({ t: "click", x: n.x, y: n.y, b: "right" }); }
    else if (!s.moved && n) push({ t: "click", x: n.x, y: n.y, b: "left" });
    s.dragging = false; s.held = false;
  };

  // keyboard: an invisible field that forwards every edit as it happens. `beforeinput` is the one
  // event the iOS keyboard fires reliably for characters AND backspace, so the field is kept
  // holding a few zero-width spaces for backspace to have something to delete.
  const SENTINEL = "​​​​";
  useEffect(() => {
    const el = kbdRef.current; if (!el) return;
    const onBefore = (e: Event) => {
      e.preventDefault();
      const type = (e as any).inputType as string;
      const data = (e as any).data as string | null;
      if (type === "insertText" || type === "insertCompositionText" || type === "insertFromPaste") { if (data) push({ t: "text", s: data }); }
      else if (type === "insertLineBreak" || type === "insertParagraph") push({ t: "key", k: "enter" });
      else if (type === "deleteContentBackward" || type === "deleteWordBackward") push({ t: "key", k: "backspace" });
      else if (type === "deleteContentForward") push({ t: "key", k: "delete" });
      el.value = SENTINEL; el.setSelectionRange(SENTINEL.length, SENTINEL.length);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const named: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Tab: "tab", Escape: "escape", Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown" };
      if (named[e.key]) { e.preventDefault(); push({ t: "key", k: named[e.key] }); return; }
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.length === 1) { e.preventDefault(); push({ t: "key", k: `${e.ctrlKey ? "ctrl+" : ""}${e.altKey ? "alt+" : ""}${e.metaKey ? "win+" : ""}${e.shiftKey ? "shift+" : ""}${e.key.toLowerCase()}` }); }
    };
    el.addEventListener("beforeinput", onBefore);
    el.addEventListener("keydown", onKeyDown);
    return () => { el.removeEventListener("beforeinput", onBefore); el.removeEventListener("keydown", onKeyDown); };
  }, [push]);
  useEffect(() => { const el = kbdRef.current; if (!el) return; if (keys) { el.value = SENTINEL; el.focus(); el.setSelectionRange(SENTINEL.length, SENTINEL.length); } else el.blur(); }, [keys]);

  const cycleQuality = () => { const nx = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]; try { localStorage.setItem("jarvis.mobile.streamq", nx); } catch { /* ignore */ } setQuality(nx); };
  const readout = stats && phase === "live"
    ? `${stats.height ? `${stats.height}p` : "…"} · ${stats.fps} fps · ${stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : `${stats.kbps} kb/s`} · buf ${stats.bufferMs} ms${rtt ? ` · tap ${rtt} ms` : ""}`
    : msg;

  return createPortal(
    <div className={`tk ${rotated ? "rot" : "flat"} ${keys ? "keys" : ""}`}>
      <div className="tk-rot">
        <video ref={videoRef} className="tk-video" autoPlay playsInline muted onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onContextMenu={(e) => e.preventDefault()} />
        {phase !== "live" ? <div className={`tk-msg ${phase}`}>{phase === "starting" ? <i className="spin" /> : null}<span>{msg}</span>{phase === "error" ? <button type="button" className="btn small" onClick={() => setAttempt((a) => a + 1)}>Retry</button> : null}</div> : null}
        <div className="tk-bar">
          <span className="tk-read mono">{readout}{enc && phase === "live" ? ` · enc ${enc.fps}` : ""}</span>
          {inputErr ? <span className="tk-err">{inputErr}</span> : null}
          <button type="button" className={`tk-btn ${keys ? "on" : ""}`} onClick={() => setKeys((k) => !k)} aria-label="Keyboard">⌨</button>
          <button type="button" className="tk-btn" onClick={cycleQuality} aria-label="Quality">{QUALITY_LABEL[quality]}</button>
          <button type="button" className="tk-btn danger" onClick={onExit}>Stop</button>
        </div>
        {keys ? (
          <div className="tk-keys">
            {HOTKEYS.map(([label, key]) => <button key={key} type="button" className="key" onClick={() => push({ t: "key", k: key })}>{label}</button>)}
          </div>
        ) : null}
      </div>
      <input ref={kbdRef} className="tk-kbd" aria-label="Type on the PC" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" defaultValue={SENTINEL} />
    </div>, document.body);
}
