import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, post } from "../api";
import { Thread } from "./Thread";
import { useThread } from "./useThread";
import { WhepPlayer, type StreamStats } from "./whep";
import { UnlockPc } from "./UnlockPc";
import type { Strength } from "./brain";

// Control — the PC from the phone. Two modes:
//
//   Command  · the PC card (a real frame, real load numbers, the window that is in front), quick
//              keys, the desktop's rooms, every installed app with the icon Windows draws for it,
//              and a thread to JARVIS that is the same request the laptop bar sends. Taps on apps
//              and rooms do not go through the brain — they hit the same executors directly.
//   Takeover · the PC as live video, full screen. Tap = click · double-tap = double-click ·
//              hold = right-click · hold+drag = drag · two fingers = scroll · pinch = zoom ·
//              three-finger tap = keyboard. Trackpad mode moves a cursor instead of tapping spots.
//              Every input goes through the persistent SendInput agent on the PC.

type Mode = "command" | "takeover";
type AppEntry = { name: string; id: string; kind: "game" | "store" | "desktop" | "link"; icon: string };
type Room = { id: string; what: string };
type AppsPayload = { apps: AppEntry[]; recent?: string[]; rooms: Room[]; desktopListening: boolean };
type Pc = { hostname: string; uptimeSeconds: number; cpuPercent: number; cores: number; memUsedPercent: number; memTotalGb: number; foreground: { title: string; process: string } | null; audio: { volume: number; muted: boolean } | null; displays: Array<{ width: number; height: number; primary: boolean; scale: number }>; power: { active: string; plans: Array<{ id: string; name: string }> } | null; widgets: Array<{ id: string; what: string }>; desktopListening: boolean; stream: boolean };
type Frame = { frameUrl: string; capturedAt: string; dimensions?: string; error?: string };
type PcEvent = { t: "move"; x: number; y: number } | { t: "click"; x: number; y: number; b: "left" | "right" | "middle"; n?: number } | { t: "down" | "up"; b: "left" | "right" | "middle" } | { t: "wheel"; x: number; y: number; dy: number; dx: number } | { t: "key"; k: string; d?: "down" | "up" } | { t: "text"; s: string };

const HOTKEYS: Array<[string, string]> = [["Esc", "escape"], ["Tab", "tab"], ["⌫", "backspace"], ["Enter", "enter"], ["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"], ["Win", "win"], ["Ctrl+C", "ctrl+c"], ["Ctrl+V", "ctrl+v"], ["Ctrl+Z", "ctrl+z"], ["Alt+Tab", "alt+tab"], ["Alt+F4", "alt+f4"], ["F11", "f11"], ["Space", "space"]];
const QUALITIES = ["balanced", "best", "light"] as const;
const QUALITY_LABEL: Record<string, string> = { best: "1080p60 · 10 Mb", balanced: "1080p30 · 6 Mb", light: "720p60 · 5 Mb" };
const KIND_LABEL: Record<AppEntry["kind"], string> = { game: "Game", store: "Windows app", desktop: "Desktop app", link: "Link" };

// line icons, 1.6 stroke, currentColor
const I = {
  expand: <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>,
  monitor: <svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="12" rx="1.5" /><path d="M8.5 20h7M12 16.5V20" /></svg>,
  camera: <svg viewBox="0 0 24 24"><path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.2" /></svg>,
  lock: <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>,
  play: <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z" /></svg>,
  volDown: <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M16 10.5a2.5 2.5 0 0 1 0 3" /></svg>,
  volUp: <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>,
  mute: <svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></svg>,
  desktop: <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></svg>,
  switch: <svg viewBox="0 0 24 24"><rect x="3" y="5" width="12" height="9" rx="1.5" /><path d="M9 10h12v9H9z" /></svg>,
  search: <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>,
  chevron: <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>,
  keyboard: <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>,
  trackpad: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M4 15h16M12 15v5" /></svg>,
  apex: <svg viewBox="0 0 24 24"><path d="M12 4l8 16H4z" /></svg>,
  arbiter: <svg viewBox="0 0 24 24"><path d="M5 9v6M9 5v14M15 8v8M19 10v4" /></svg>,
  helix: <svg viewBox="0 0 24 24"><path d="M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9M8.5 7.5h7M8.5 16.5h7" /></svg>,
  synapse: <svg viewBox="0 0 24 24"><path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" /></svg>,
  cpu: <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></svg>,
  ram: <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 10v4M11 10v4M15 10v4M6 17v3M12 17v3M18 17v3" /></svg>,
  clock: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  power: <svg viewBox="0 0 24 24"><path d="M12 4v8M7 7.5a7 7 0 1 0 10 0" /></svg>,
  ping: <svg viewBox="0 0 24 24"><path d="M3 10a13 13 0 0 1 18 0M6.5 13.5a8 8 0 0 1 11 0M10 17a3 3 0 0 1 4 0" /><circle cx="12" cy="19.5" r=".8" /></svg>,
  grid: <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
  check: <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>,
};
const ROOM_ICON: Record<string, React.ReactNode> = { apex: I.apex, arbiter: I.arbiter, helix: I.helix, synapse: I.synapse };

const uptime = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`; };

export function Control({ active, dock, strength }: { active: boolean; dock: HTMLElement | null; strength: Strength }) {
  const [mode, setMode] = useState<Mode>("command");
  return (
    <div className="ctl">
      <Command active={active && mode === "command"} dock={dock} strength={strength} onTakeover={() => setMode("takeover")} />
      {active && mode === "takeover" ? <Takeover onExit={() => setMode("command")} /> : null}
    </div>
  );
}

// ── Command ───────────────────────────────────────────────────────────────────────────────────
// The home is short: the live PC, one pinned control (volume), and a grid of section buttons.
// Everything else lives in a large cover sheet that slides up over a dimmed home — so nothing is
// crammed into one scroll. Every number and list here is read from the PC; nothing is invented.
type Panel = "apps" | "rooms" | "audio" | "power" | "keys" | "widgets" | null;

const KEY_GROUPS: Array<[string, Array<[string, string]>]> = [
  ["System", [["Esc", "escape"], ["Tab", "tab"], ["Enter", "enter"], ["⌫", "backspace"], ["Del", "delete"], ["Win", "win"], ["Alt+Tab", "alt+tab"], ["Win+D", "win+d"], ["Alt+F4", "alt+f4"], ["F11", "f11"], ["PrtSc", "printscreen"], ["Space", "space"]]],
  ["Arrows", [["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"], ["Home", "home"], ["End", "end"], ["PgUp", "pageup"], ["PgDn", "pagedown"]]],
  ["Shortcuts", [["Ctrl+C", "ctrl+c"], ["Ctrl+V", "ctrl+v"], ["Ctrl+X", "ctrl+x"], ["Ctrl+Z", "ctrl+z"], ["Ctrl+A", "ctrl+a"], ["Ctrl+S", "ctrl+s"], ["Task Mgr", "ctrl+shift+escape"], ["Win+L", "win+l"]]],
];

function Command({ active, dock, strength, onTakeover }: { active: boolean; dock: HTMLElement | null; strength: Strength; onTakeover: () => void }) {
  const thread = useThread("jarvis.mobile.pc.v1", { strength, deep: false });
  const [text, setText] = useState("");
  const [inv, setInv] = useState<AppsPayload | null>(null);
  const [pc, setPc] = useState<Pc | null>(null);
  const [ping, setPing] = useState(0);
  const [reach, setReach] = useState<"checking" | "ok" | "down">("checking");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);
  const say = (m: string) => { setToast(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(""), 2600); };

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const pullPc = async () => { const t0 = performance.now(); try { const r = await api<Pc>("/api/device-mesh/pc"); if (alive) { setPc(r); setPing(Math.round(performance.now() - t0)); setReach("ok"); } } catch { if (alive) setReach("down"); } };
    const pullInv = async () => { try { const r = await api<AppsPayload>("/api/device-mesh/apps"); if (alive) setInv(r); } catch { /* card says down */ } };
    const pullFrame = async () => { try { const f = await api<Frame>("/api/device-mesh/live/frame?w=1024&q=64"); if (alive && f.frameUrl) setFrame(f); } catch { /* no frame */ } };
    void pullPc(); void pullInv();
    (async () => { try { await post("/api/device-mesh/live/start", { targetFps: 0.2, quality: "phone" }); } catch { /* no glimpse */ } await pullFrame(); })();
    const a = window.setInterval(() => { if (document.visibilityState === "visible") void pullPc(); }, 5000);
    const b = window.setInterval(() => { if (document.visibilityState === "visible") void pullFrame(); }, 8000);
    const c = window.setInterval(pullInv, 30000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); window.clearInterval(c); void post("/api/device-mesh/live/pause", {}).catch(() => {}); };
  }, [active]);

  const key = useCallback(async (k: string, label: string) => {
    try { const r = await post<{ ok: boolean; error?: string }>("/api/device-mesh/stream/input", { events: [{ t: "key", k }] }); say(r.ok ? label : r.error || "Failed"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const openApp = useCallback(async (a: AppEntry) => {
    say(`Opening ${a.name}…`);
    try { const r = await post<{ ok: boolean; opened?: string; error?: string }>("/api/device-mesh/apps/open", { name: a.name }); say(r.ok ? `Opened ${r.opened || a.name}` : r.error || "Could not open it"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const openRoom = useCallback(async (r: Room) => {
    say(`${r.what.split(" — ")[0]} → PC…`);
    try { const x = await post<{ delivered: number; launched: boolean; error?: string }>("/api/device-mesh/pc/room", { id: r.id }); say(x.delivered ? (x.launched ? `Opened JARVIS on the PC · ${r.id}` : `PC is in ${r.id}`) : x.error || "The PC screen did not answer"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const openWidget = useCallback(async (id: string) => {
    say(`${id} → PC…`);
    try { const x = await post<{ delivered: number; error?: string }>("/api/device-mesh/pc/widget", { id }); say(x.delivered ? `${id} is on the PC screen` : x.error || "The PC screen did not answer"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const setVolume = useCallback(async (volume: number) => {
    try { const r = await post<{ audio: Pc["audio"] }>("/api/device-mesh/pc/volume", { volume }); setPc((p) => (p ? { ...p, audio: r.audio } : p)); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const setMute = useCallback(async (mute: boolean) => {
    try { const r = await post<{ audio: Pc["audio"] }>("/api/device-mesh/pc/volume", { mute }); setPc((p) => (p ? { ...p, audio: r.audio } : p)); say(mute ? "Muted" : "Unmuted"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const setPower = useCallback(async (id: string) => {
    try { const r = await post<{ power: Pc["power"] }>("/api/device-mesh/pc/power", { id }); setPc((p) => (p ? { ...p, power: r.power } : p)); say("Power plan changed"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);
  const screenshot = useCallback(async () => {
    say("Capturing…");
    try { const f = await api<Frame>("/api/device-mesh/live/frame?w=2560&q=88"); if (f.frameUrl) { window.open(f.frameUrl, "_blank"); say("Screenshot ready"); } else say(f.error || "No frame"); }
    catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }, []);

  const run = (t: string) => { setText(""); void thread.send(t); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim()) run(text); } };

  const composer = dock && active ? createPortal(
    <div className="composer-wrap">
      {thread.note ? <div className="note">{thread.note}</div> : null}
      <div className="composer">
        <input className="input" value={text} placeholder={thread.busy ? "Working on the PC…" : "Tell the PC what to do"} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" autoCapitalize="sentences" />
        <div className="slot-r">
          {thread.busy
            ? <button key="stop" type="button" className="circle stop" aria-label="Stop" onClick={thread.stop}><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></svg></button>
            : <button key="send" type="button" className={`circle ${text.trim() ? "send" : ""}`} aria-label="Send" disabled={!text.trim()} onClick={() => run(text)}><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg></button>}
        </div>
      </div>
    </div>, dock) : null;

  const online = reach === "ok";
  const jarvisOpen = Boolean(pc?.desktopListening ?? inv?.desktopListening);
  const host = (pc?.hostname || "PC").replace(/_/g, " ");
  const plan = pc?.power?.plans.find((p) => p.id === pc.power?.active)?.name || "";
  const display = pc?.displays?.[0];
  const fg = pc?.foreground?.title ? (pc.foreground.title.toLowerCase() === pc.foreground.process.toLowerCase() ? pc.foreground.process : `${pc.foreground.process} — ${pc.foreground.title}`) : "";
  const vol = pc?.audio?.muted ? 0 : (pc?.audio?.volume ?? 0);

  const SECTIONS: Array<{ id: Panel; icon: React.ReactNode; label: string; sub: string }> = [
    { id: "apps", icon: I.desktop, label: "Apps", sub: inv ? `${inv.apps.length} installed` : "…" },
    { id: "rooms", icon: I.helix, label: "Rooms", sub: `${inv?.rooms?.length || 0} on the PC` },
    { id: "audio", icon: vol && !pc?.audio?.muted ? I.volUp : I.mute, label: "Audio", sub: pc?.audio ? (pc.audio.muted ? "Muted" : `${pc.audio.volume}%`) : "—" },
    { id: "power", icon: I.power, label: "Power", sub: plan || "—" },
    { id: "keys", icon: I.keyboard, label: "Keys", sub: "Shortcuts" },
    { id: "widgets", icon: I.grid, label: "Widgets", sub: `${pc?.widgets?.length || 0} panels` },
  ];

  return (
    <>
      {/* ── the PC ── */}
      <button type="button" className="pchero" onClick={onTakeover} aria-label="Take over the PC">
        <span className="pchero-frame">
          {frame?.frameUrl ? <img src={frame.frameUrl} alt="" draggable={false} /> : <span className="pchero-empty">{reach === "down" ? "PC not reachable" : "Waiting for a frame…"}</span>}
          <span className="pchero-shade" />
        </span>
        <span className={`pchero-pill ${online ? "ok" : reach === "down" ? "bad" : ""}`}><i className="dot" />{reach === "checking" ? "Connecting" : online ? "Online" : "Offline"}</span>
        <span className="pchero-cta">{I.expand} Take over</span>
        <span className="pchero-foot">
          <b>{host}</b>
          <small>{online ? (fg || (jarvisOpen ? "JARVIS on screen" : "Ready")) : "Not reachable"}</small>
        </span>
      </button>

      {/* ── pinned: quick volume + at-a-glance ── */}
      <div className="pins">
        <div className="pin vol">
          <button type="button" className="pin-mute" onClick={() => void setMute(!pc?.audio?.muted)} aria-label="Mute">{pc?.audio?.muted ? I.mute : I.volUp}</button>
          <input type="range" min={0} max={100} value={vol} onChange={(e) => { const v = Number(e.target.value); setPc((p) => (p && p.audio ? { ...p, audio: { ...p.audio, volume: v, muted: false } } : p)); }} onPointerUp={(e) => void setVolume(Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => void setVolume(Number((e.target as HTMLInputElement).value))} aria-label="Volume" />
          <b className="mono">{vol}%</b>
        </div>
        <div className="pin metrics">
          <span><i className="pin-dot" style={{ background: `hsl(${Math.max(0, 140 - (pc?.cpuPercent ?? 0) * 1.4)} 70% 50%)` }} /><small>CPU</small><b className="mono">{pc ? `${pc.cpuPercent}%` : "—"}</b></span>
          <span><small>RAM</small><b className="mono">{pc ? `${pc.memUsedPercent}%` : "—"}</b></span>
          <span><small>{display ? "DISP" : "PING"}</small><b className="mono">{display ? `${display.width}×${display.height}` : ping ? `${ping}ms` : "—"}</b></span>
        </div>
      </div>

      {/* ── unlock the PC with Face ID ── */}
      <UnlockPc />

      {/* ── sections ── */}
      <div className="secgrid">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className="secbtn" onClick={() => setPanel(s.id)}>
            <span className="secbtn-ico">{s.icon}</span>
            <span className="secbtn-t"><b>{s.label}</b><small>{s.sub}</small></span>
          </button>
        ))}
      </div>

      {/* ── command thread (composer is docked) ── */}
      {thread.turns.length ? (
        <section className="cmd-sec">
          <header className="sec"><h3>Recent</h3><button type="button" onClick={thread.clear}>Clear</button></header>
          <Thread turns={thread.turns} onSend={(t) => void thread.send(t)} onFollowup={(t) => thread.append("model", t)} />
        </section>
      ) : (
        <div className="cmd-hint">Ask below: “open steam and start siege”, “close chrome”, “switch to the apex room”, “what’s on the screen?”</div>
      )}

      {/* ── panels ── */}
      {panel === "apps" ? <AppsPanel inv={inv} reach={reach} onOpen={openApp} onClose={() => setPanel(null)} /> : null}
      {panel === "rooms" ? (
        <Sheet title="Rooms on the PC" sub={jarvisOpen ? "Switch what's on the PC screen" : "Opens JARVIS on the PC first"} onClose={() => setPanel(null)}>
          <div className="list">{(inv?.rooms || []).map((r) => { const [name, s] = r.what.split(" — "); return <button key={r.id} type="button" className="tile" onClick={() => void openRoom(r)}><span className="tile-ico">{ROOM_ICON[r.id] || I.desktop}</span><span className="tile-t"><b>{name}</b><small>{s || r.id}</small></span><span className="tile-go">{I.chevron}</span></button>; })}</div>
        </Sheet>
      ) : null}
      {panel === "audio" ? (
        <Sheet title="Audio" sub={display ? host : ""} onClose={() => setPanel(null)}>
          <div className="vol-row big">
            <button type="button" className="pin-mute" onClick={() => void setMute(!pc?.audio?.muted)} aria-label="Mute">{pc?.audio?.muted ? I.mute : I.volUp}</button>
            <input type="range" min={0} max={100} value={vol} onChange={(e) => { const v = Number(e.target.value); setPc((p) => (p && p.audio ? { ...p, audio: { ...p.audio, volume: v, muted: false } } : p)); }} onPointerUp={(e) => void setVolume(Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => void setVolume(Number((e.target as HTMLInputElement).value))} aria-label="Volume" />
            <b className="mono">{vol}%</b>
          </div>
          <div className="sub">Media</div>
          <div className="kgrid media">
            <button type="button" className="key" onClick={() => void key("prevtrack", "Previous")}>⏮</button>
            <button type="button" className="key" onClick={() => void key("playpause", "Play / pause")}>⏯</button>
            <button type="button" className="key" onClick={() => void key("nexttrack", "Next")}>⏭</button>
            <button type="button" className="key" onClick={() => void key("volumedown", "Volume −")}>Vol −</button>
            <button type="button" className="key" onClick={() => void key("volumeup", "Volume +")}>Vol +</button>
          </div>
        </Sheet>
      ) : null}
      {panel === "power" ? (
        <Sheet title="Power" sub={host} onClose={() => setPanel(null)}>
          <div className="sub">Windows power plan</div>
          <div className="list">{(pc?.power?.plans || []).map((p) => <button key={p.id} type="button" className={`tile ${p.id === pc?.power?.active ? "on" : ""}`} onClick={() => void setPower(p.id)}><span className="tile-ico">{I.power}</span><span className="tile-t"><b>{p.name}</b><small>{p.id === pc?.power?.active ? "Active" : "Tap to switch"}</small></span>{p.id === pc?.power?.active ? <span className="tile-go">{I.check}</span> : null}</button>)}</div>
          <div className="sub">Session</div>
          <div className="kgrid"><button type="button" className="key" onClick={() => void key("win+l", "Locked")}>Lock</button><button type="button" className="key" onClick={() => void key("win+d", "Desktop")}>Desktop</button><button type="button" className="key" onClick={() => void screenshot()}>Screenshot</button></div>
        </Sheet>
      ) : null}
      {panel === "keys" ? (
        <Sheet title="Keys" sub="Sent straight to the PC" onClose={() => setPanel(null)}>
          {KEY_GROUPS.map(([g, keys]) => <div key={g} className="kgroup"><div className="sub">{g}</div><div className="kgrid">{keys.map(([label, k]) => <button key={k} type="button" className="key" onClick={() => void key(k, label)}>{label}</button>)}</div></div>)}
        </Sheet>
      ) : null}
      {panel === "widgets" ? (
        <Sheet title="Widgets on the PC" sub={jarvisOpen ? "Opens on the PC screen" : "Opens JARVIS on the PC first"} onClose={() => setPanel(null)}>
          <div className="list">{(pc?.widgets || []).map((w) => <button key={w.id} type="button" className="tile" onClick={() => void openWidget(w.id)}><span className="tile-ico">{I.grid}</span><span className="tile-t"><b>{w.id[0].toUpperCase() + w.id.slice(1)}</b><small>{w.what}</small></span><span className="tile-go">{I.chevron}</span></button>)}</div>
        </Sheet>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
      {composer}
    </>
  );
}

function AppsPanel({ inv, reach, onOpen, onClose }: { inv: AppsPayload | null; reach: string; onOpen: (a: AppEntry) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const list = inv?.apps || [];
    const needle = q.trim().toLowerCase();
    const hit = (needle ? list.filter((a) => a.name.toLowerCase().includes(needle)) : list).slice().sort((a, b) => a.name.localeCompare(b.name));
    const byName = new Map(list.map((a) => [a.name, a]));
    const recent = needle ? [] : (inv?.recent || []).map((n) => byName.get(n)).filter((a): a is AppEntry => Boolean(a));
    return { recent, games: hit.filter((a) => a.kind === "game"), rest: hit.filter((a) => a.kind !== "game" && a.kind !== "link") };
  }, [inv, q]);
  return (
    <Sheet title="Apps" sub={inv ? `${inv.apps.length} installed` : reach === "down" ? "PC not reachable" : "Asking the PC…"} onClose={onClose}>
      <label className="find">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps and games" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" autoFocus /></label>
      {groups.recent.length ? <><div className="sub">Recent</div><div className="applist">{groups.recent.map((a) => <AppTile key={a.id} a={a} onOpen={onOpen} />)}</div></> : null}
      {groups.games.length ? <><div className="sub">Games</div><div className="applist">{groups.games.map((a) => <AppTile key={a.id} a={a} onOpen={onOpen} />)}</div></> : null}
      {groups.rest.length ? <><div className="sub">{q ? "Matches" : "All apps"}</div><div className="applist">{groups.rest.map((a) => <AppTile key={a.id} a={a} onOpen={onOpen} />)}</div></> : inv && q ? <div className="ctl-hint">Nothing installed matches “{q}”.</div> : null}
    </Sheet>
  );
}

export function Sheet({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return createPortal(
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <header className="sheet-h"><div className="sheet-title"><b>{title}</b>{sub ? <small>{sub}</small> : null}</div><button type="button" className="sheet-x" onClick={onClose} aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>, document.body);
}

function AppTile({ a, onOpen }: { a: AppEntry; onOpen: (a: AppEntry) => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" className="apptile" onClick={() => onOpen(a)}>
      {broken ? <span className="apptile-ico letter">{a.name.slice(0, 1)}</span> : <img className="apptile-img" src={a.icon} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />}
      <b>{a.name}</b>
    </button>
  );
}

// ── Takeover ──────────────────────────────────────────────────────────────────────────────────
function Takeover({ onExit }: { onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const kbdRef = useRef<HTMLInputElement>(null);
  const player = useRef<WhepPlayer | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "error">("starting");
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const [msg, setMsg] = useState("Starting the encoder on the PC…");
  const [stats, setStats] = useState<StreamStats | null>(null);
  const [enc, setEnc] = useState<{ fps: number; bitrateKbps: number } | null>(null);
  const [keys, setKeys] = useState(false);
  const [trackpad, setTrackpad] = useState(false);
  const [bar, setBar] = useState(true);
  // the controls bar auto-hides ~5 s after it appears so the top of the PC screen is reachable;
  // showing it (the grip) re-arms the timer. It stays up while the keyboard is open.
  useEffect(() => {
    if (!bar || keys) return;
    const t = window.setTimeout(() => setBar(false), 5000);
    return () => window.clearTimeout(t);
  }, [bar, keys]);
  // show the controls the moment the video appears (then they auto-hide), not during the black wait
  useEffect(() => { if (phase === "live") setBar(true); }, [phase]);
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>(() => (localStorage.getItem("jarvis.mobile.streamq") as any) || "balanced");
  const [landscapeNative, setLandscapeNative] = useState(window.innerWidth > window.innerHeight);
  const [rtt, setRtt] = useState(0);
  const [inputErr, setInputErr] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState({ s: 1, x: 0, y: 0 });   // CSS transform on the video: scale + pan (px, logical frame)
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const cursor = useRef({ x: 0.5, y: 0.5 });               // trackpad mode: where the PC cursor is (normalized)

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
    if (ev.t === "move" && last?.t === "move") queue.current[queue.current.length - 1] = ev;
    else queue.current.push(ev);
    void flush();
  }, [flush]);

  // stream lifecycle
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setPhase("starting"); setMsg("Starting the encoder on the PC…");
        const r = await post<{ ok: boolean; stream: { error?: string }; whep: string }>("/api/device-mesh/stream/start", { quality });
        if (!alive) return;
        if (!r.ok) throw new Error(r.stream?.error || "The PC could not start the stream.");
        void post("/api/device-mesh/control/request", { reason: "Phone takeover", durationSeconds: 1800 }).catch(() => {});
        setMsg("Connecting video…");
        const p = new WhepPlayer(videoRef.current!, r.whep, (s) => { if (alive) setStats({ ...s }); }, (state) => {
          if (!alive) return;
          if (state === "connected") { setPhase("live"); setMsg(""); }
          else if (state === "failed" || state === "disconnected") { setPhase("error"); setMsg("Video connection lost. Is the phone on the tailnet?"); }
        });
        player.current = p;
        await p.start();
      } catch (e) { if (alive) { setPhase("error"); setMsg(e instanceof Error ? e.message : String(e)); } }
    })();
    const beat = window.setInterval(async () => {
      try { const s = await api<{ stream: { running: boolean; fps: number; bitrateKbps: number; error?: string } }>("/api/device-mesh/stream/status?viewer=1"); if (alive) { setEnc({ fps: s.stream.fps, bitrateKbps: s.stream.bitrateKbps }); if (!s.stream.running && phaseRef.current === "live") { setPhase("error"); setMsg(s.stream.error || "The encoder stopped."); } } } catch { /* keep going */ }
    }, 5000);
    const onResize = () => setLandscapeNative(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", onResize);
    let lock: any = null; (navigator as any).wakeLock?.request?.("screen").then((l: any) => { lock = l; }).catch(() => {});
    return () => {
      alive = false; window.clearInterval(beat); window.removeEventListener("resize", onResize); lock?.release?.();
      // Only close THIS viewer's connection. Leave the PC's encoder running: reopening Takeover
      // reuses the same live stream instantly, and the server idle-stops the encoder ~90 s after the
      // last viewer leaves. Tearing ffmpeg down on every exit caused a Desktop Duplication (ddagrab)
      // stall — the handle isn't freed the instant ffmpeg dies, so an immediate reopen got black video.
      void player.current?.stop(); player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, attempt]);

  // touch → PC coordinates. On a portrait phone the frame is rotated 90° cw: screen-y runs along
  // the frame's width, screen-x runs up its height. Then undo the zoom/pan, then the letterbox.
  const rotated = !landscapeNative;
  const frameSize = () => { const v = videoRef.current!; const r = v.parentElement!.getBoundingClientRect(); return rotated ? { W: r.height, H: r.width, r } : { W: r.width, H: r.height, r }; };
  const toLocal = (clientX: number, clientY: number) => {
    const { W, H, r } = frameSize();
    const lx = rotated ? clientY - r.top : clientX - r.left;
    const ly = rotated ? r.width - (clientX - r.left) : clientY - r.top;
    return { lx, ly, W, H };
  };
  const toNorm = (clientX: number, clientY: number) => {
    const v = videoRef.current; if (!v) return null;
    const { lx, ly, W, H } = toLocal(clientX, clientY);
    const z = zoomRef.current;
    // the video is transformed about the frame centre: translate(x,y) scale(s)
    const ux = (lx - W / 2 - z.x) / z.s + W / 2, uy = (ly - H / 2 - z.y) / z.s + H / 2;
    const a = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    const cw = W / H > a ? H * a : W, ch = W / H > a ? H : W / a;
    const ox = (W - cw) / 2, oy = (H - ch) / 2;
    const nx = (ux - ox) / cw, ny = (uy - oy) / ch;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
    return { x: nx, y: ny };
  };
  const clampZoom = (z: { s: number; x: number; y: number }) => {
    const { W, H } = frameSize();
    const s = Math.min(5, Math.max(1, z.s));
    const mx = (W * (s - 1)) / 2, my = (H * (s - 1)) / 2;
    return { s, x: Math.max(-mx, Math.min(mx, s === 1 ? 0 : z.x)), y: Math.max(-my, Math.min(my, s === 1 ? 0 : z.y)) };
  };

  const g = useRef({ fingers: 0, sx: 0, sy: 0, lx: 0, ly: 0, t: 0, moved: false, held: false, dragging: false, timer: 0, lastMove: 0, lastWheel: 0, wheelAcc: 0, pinch0: 0, zoom0: { s: 1, x: 0, y: 0 }, mid0: { x: 0, y: 0 }, pinching: false, lastTap: 0 });
  const mid = (e: React.TouchEvent) => e.touches.length >= 2 ? { clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2, clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2 } : e.touches[0];
  const dist = (e: React.TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const onTouchStart = (e: React.TouchEvent) => {
    const s = g.current; window.clearTimeout(s.timer);
    if (e.touches.length === 3) { setKeys((k) => !k); s.fingers = 3; return; }
    const p = mid(e);
    Object.assign(s, { fingers: e.touches.length, sx: p.clientX, sy: p.clientY, lx: p.clientX, ly: p.clientY, t: Date.now(), moved: false, held: false, dragging: false, wheelAcc: 0, pinching: false });
    if (e.touches.length === 2) { s.pinch0 = dist(e); s.zoom0 = { ...zoomRef.current }; s.mid0 = { x: p.clientX, y: p.clientY }; return; }
    if (!trackpad) { const n = toNorm(p.clientX, p.clientY); if (n) push({ t: "move", x: n.x, y: n.y }); }
    s.timer = window.setTimeout(() => { if (!s.moved && s.fingers === 1) s.held = true; }, 380);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = g.current;
    if (s.fingers === 3) return;
    const p = mid(e);
    if (!s.moved && Math.hypot(p.clientX - s.sx, p.clientY - s.sy) > 8) { s.moved = true; window.clearTimeout(s.timer); }
    if (e.touches.length === 2) {
      const ratio = dist(e) / (s.pinch0 || 1);
      if (s.pinching || Math.abs(ratio - 1) > 0.08 || zoomRef.current.s > 1) {
        // pinch = zoom about the pinch point, pan with the fingers (in the frame's own axes)
        s.pinching = true;
        const dm = rotated ? { x: p.clientY - s.mid0.y, y: -(p.clientX - s.mid0.x) } : { x: p.clientX - s.mid0.x, y: p.clientY - s.mid0.y };
        setZoom(clampZoom({ s: s.zoom0.s * ratio, x: s.zoom0.x * ratio + dm.x, y: s.zoom0.y * ratio + dm.y }));
        return;
      }
      const dPc = rotated ? -(p.clientX - s.lx) : p.clientY - s.ly;
      s.wheelAcc += dPc; s.lx = p.clientX; s.ly = p.clientY;
      const now = performance.now();
      if (now - s.lastWheel > 60 && Math.abs(s.wheelAcc) >= 6) {
        const n = toNorm(p.clientX, p.clientY) || cursor.current;
        push({ t: "wheel", x: n.x, y: n.y, dy: Math.round(s.wheelAcc * 2), dx: 0 });
        s.wheelAcc = 0; s.lastWheel = now;
      }
      return;
    }
    if (!s.moved) return;
    const now = performance.now();
    if (trackpad) {
      // relative: finger travel moves the PC cursor, scaled by the frame (1 frame-width = full screen)
      const { W, H } = frameSize();
      const d = rotated ? { x: (p.clientY - s.ly) / W, y: -(p.clientX - s.lx) / H } : { x: (p.clientX - s.lx) / W, y: (p.clientY - s.ly) / H };
      cursor.current = { x: Math.max(0, Math.min(1, cursor.current.x + d.x * 1.6)), y: Math.max(0, Math.min(1, cursor.current.y + d.y * 1.6)) };
      s.lx = p.clientX; s.ly = p.clientY;
      if (s.held && !s.dragging) { s.dragging = true; push({ t: "down", b: "left" }); }
      if (now - s.lastMove > 30) { push({ t: "move", x: cursor.current.x, y: cursor.current.y }); s.lastMove = now; }
      return;
    }
    const n = toNorm(p.clientX, p.clientY); if (!n) return;
    if (s.held && !s.dragging) { s.dragging = true; push({ t: "down", b: "left" }); }
    if (now - s.lastMove > 40) { push({ t: "move", x: n.x, y: n.y }); s.lastMove = now; }
    s.lx = p.clientX; s.ly = p.clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = g.current; window.clearTimeout(s.timer);
    if (e.touches.length) return;
    if (s.fingers >= 2) { s.pinching = false; return; }
    const p = e.changedTouches[0];
    const n = trackpad ? cursor.current : toNorm(p.clientX, p.clientY);
    if (s.dragging) { if (n) push({ t: "move", x: n.x, y: n.y }); push({ t: "up", b: "left" }); }
    else if (s.held) { if (n) push({ t: "click", x: n.x, y: n.y, b: "right" }); }
    else if (!s.moved && n) {
      const dbl = Date.now() - s.lastTap < 300; s.lastTap = dbl ? 0 : Date.now();
      push({ t: "click", x: n.x, y: n.y, b: "left", n: dbl ? 2 : 1 });
    }
    s.dragging = false; s.held = false;
  };

  // keyboard: an invisible field that forwards every edit as it happens (beforeinput is the one
  // event the iOS keyboard fires reliably for characters AND backspace; the field holds a few
  // zero-width spaces so backspace always has something to delete)
  const SENTINEL = "​​​​";
  useEffect(() => {
    const el = kbdRef.current; if (!el) return;
    const onBefore = (e: Event) => {
      e.preventDefault();
      const type = (e as any).inputType as string, data = (e as any).data as string | null;
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
    el.addEventListener("beforeinput", onBefore); el.addEventListener("keydown", onKeyDown);
    return () => { el.removeEventListener("beforeinput", onBefore); el.removeEventListener("keydown", onKeyDown); };
  }, [push]);
  useEffect(() => { const el = kbdRef.current; if (!el) return; if (keys) { el.value = SENTINEL; el.focus(); el.setSelectionRange(SENTINEL.length, SENTINEL.length); } else el.blur(); }, [keys]);

  const cycleQuality = () => { const nx = QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length]; try { localStorage.setItem("jarvis.mobile.streamq", nx); } catch { /* ignore */ } setQuality(nx); };
  const readout = stats && phase === "live"
    ? `${stats.height ? `${stats.height}p` : "…"} · ${stats.fps} fps · ${stats.kbps >= 1000 ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : `${stats.kbps} kb/s`} · buf ${stats.bufferMs} ms${rtt ? ` · tap ${rtt} ms` : ""}${zoom.s > 1 ? ` · ${zoom.s.toFixed(1)}×` : ""}`
    : msg;

  return createPortal(
    <div className={`tk ${rotated ? "rot" : "flat"} ${keys ? "keys" : ""} ${bar ? "bar-on" : "bar-off"}`}>
      <div className="tk-rot" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onContextMenu={(e) => e.preventDefault()}>
        <video ref={videoRef} className="tk-video" autoPlay playsInline muted style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` }} />
        {phase !== "live" ? <div className={`tk-msg ${phase}`}>{phase === "starting" ? <i className="spin" /> : null}<span>{msg}</span>{phase === "error" ? <button type="button" className="btn small" onClick={() => setAttempt((a) => a + 1)}>Retry</button> : null}</div> : null}
        {/* the bar auto-hides so the top of the PC screen is tappable; a tiny grip brings it back */}
        <button type="button" className="tk-grip" onClick={() => setBar((b) => !b)} aria-label={bar ? "Hide controls" : "Show controls"}><i /></button>
        <div className="tk-bar" hidden={!bar}>
          <span className="tk-read mono">{readout}{enc && phase === "live" ? ` · enc ${enc.fps}` : ""}</span>
          {inputErr ? <span className="tk-err">{inputErr}</span> : null}
          {zoom.s > 1 ? <button type="button" className="tk-btn" onClick={() => setZoom({ s: 1, x: 0, y: 0 })}>1×</button> : null}
          <button type="button" className={`tk-btn ico ${trackpad ? "on" : ""}`} onClick={() => setTrackpad((t) => !t)} aria-label="Trackpad mode">{I.trackpad}</button>
          <button type="button" className={`tk-btn ico ${keys ? "on" : ""}`} onClick={() => { setKeys((k) => !k); setBar(true); }} aria-label="Keyboard">{I.keyboard}</button>
          <button type="button" className="tk-btn" onClick={cycleQuality} aria-label="Quality">{QUALITY_LABEL[quality]}</button>
          <button type="button" className="tk-btn danger" onClick={onExit}>Stop</button>
        </div>
        {keys ? <div className="tk-keys">{HOTKEYS.map(([label, k]) => <button key={k} type="button" className="key" onClick={() => push({ t: "key", k })}>{label}</button>)}</div> : null}
      </div>
      <input ref={kbdRef} className="tk-kbd" aria-label="Type on the PC" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" defaultValue={SENTINEL} />
    </div>, document.body);
}
