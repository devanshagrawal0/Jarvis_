import { useCallback, useEffect, useRef, useState } from "react";
import { api, post } from "../api";

// Batch 6 — Control (plan v1 §2.2, watch mode + tap-to-click). The PC's screen is polled as a
// downscaled JPEG (`/api/device-mesh/live/frame?w=1280`), a tap on it clicks the same spot on the
// real desktop (normalized coordinates → the backend maps to the full 4K frame), a two-finger drag
// scrolls, the strip sends hotkeys and typed text, and the stop button revokes everything. Three
// designed states: watching · controlling · unreachable. Nothing is faked: every frame is a real
// capture and every tap is a real desktop_control event with a receipt.

type Frame = { frameUrl: string; frameId: string; dimensions: string; capturedAt: string; paused?: boolean; error?: string };
type Mode = "off" | "starting" | "watching" | "controlling" | "unreachable" | "stopped";

const HOTKEYS: Array<[string, string]> = [["Esc", "escape"], ["Tab", "tab"], ["Enter", "enter"], ["⌫", "backspace"], ["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"], ["Ctrl+C", "ctrl+c"], ["Ctrl+V", "ctrl+v"], ["Ctrl+Z", "ctrl+z"], ["Win", "win"]];

export function Control({ active }: { active: boolean }) {
  const [mode, setMode] = useState<Mode>("off");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [age, setAge] = useState(0);
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");
  const [fill, setFill] = useState(false);   // rotate the frame to fill the portrait screen
  const timer = useRef(0);
  const inflight = useRef(false);
  const modeRef = useRef<Mode>("off"); modeRef.current = mode;
  const imgRef = useRef<HTMLImageElement>(null);
  const wake = useRef<any>(null);

  const pull = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    const t0 = performance.now();
    try {
      const f = await api<Frame>("/api/device-mesh/live/frame?w=1280&q=70");
      setMs(Math.round(performance.now() - t0));
      if (f.frameUrl) setFrame(f);
      setErr(f.error || "");
      if (modeRef.current === "starting") setMode("watching");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (modeRef.current !== "controlling") setMode("unreachable");
    } finally { inflight.current = false; }
  }, []);

  const start = useCallback(async () => {
    setMode("starting"); setErr("");
    try { await post("/api/device-mesh/live/start", { targetFps: 1, quality: "phone" }); await pull(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setMode("unreachable"); }
  }, [pull]);

  const stopAll = useCallback(async () => {
    window.clearInterval(timer.current);
    try { await post("/api/device-mesh/emergency-stop", {}); } catch { /* the stop is best-effort */ }
    setMode("stopped"); setFrame(null);
  }, []);

  // live only while the tab is on screen: start on enter, pause on leave / hidden, wake lock held
  useEffect(() => {
    if (!active) { window.clearInterval(timer.current); if (mode === "watching" || mode === "controlling") void post("/api/device-mesh/live/pause", {}).catch(() => {}); if (wake.current) { wake.current.release?.(); wake.current = null; } return; }
    void start();
    timer.current = window.setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 1200);
    (navigator as any).wakeLock?.request?.("screen").then((l: any) => { wake.current = l; }).catch(() => {});
    return () => { window.clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => { const t = window.setInterval(() => { if (frame?.capturedAt) setAge(Math.max(0, Math.round((Date.now() - new Date(frame.capturedAt).getTime()) / 100) / 10)); }, 500); return () => window.clearInterval(t); }, [frame]);

  const takeControl = useCallback(async () => {
    if (mode === "controlling") return true;
    try { await post("/api/device-mesh/control/request", { reason: "Phone control", durationSeconds: 300 }); setMode("controlling"); return true; }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; }
  }, [mode]);

  const send = useCallback(async (event: Record<string, unknown>, label: string) => {
    if (!(await takeControl())) return;
    setBusy(label); setErr("");
    try { const r = await post<{ ok: boolean; error?: string }>("/api/device-mesh/control/event", event); if (!r.ok) setErr(r.error || `${label} failed`); void pull(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }, [takeControl, pull]);

  // tap = click at the same spot; two-finger vertical drag = scroll
  const touch = useRef<{ x: number; y: number; t: number; fingers: number; moved: boolean }>({ x: 0, y: 0, t: 0, fingers: 0, moved: false });
  const onStart = (e: React.TouchEvent | React.MouseEvent) => {
    const te = e as React.TouchEvent; const p = "touches" in te ? te.touches[0] : (e as React.MouseEvent);
    touch.current = { x: p.clientX, y: p.clientY, t: Date.now(), fingers: "touches" in te ? te.touches.length : 1, moved: false };
  };
  const onMove = (e: React.TouchEvent) => { const p = e.touches[0]; if (Math.hypot(p.clientX - touch.current.x, p.clientY - touch.current.y) > 8) touch.current.moved = true; if (e.touches.length === 2) e.preventDefault(); };
  const onEnd = (e: React.TouchEvent | React.MouseEvent) => {
    const el = imgRef.current; if (!el) return;
    const te = e as React.TouchEvent; const p = "changedTouches" in te ? te.changedTouches[0] : (e as React.MouseEvent);
    const r = el.getBoundingClientRect();
    if (touch.current.fingers === 2) { const dy = fill ? p.clientX - touch.current.x : touch.current.y - p.clientY; if (Math.abs(dy) > 12) void send({ type: "scroll", deltaY: Math.round(dy * 3) }, "scroll"); return; }
    if (touch.current.moved) return;
    // fill mode rotates the image 90° clockwise: screen-y runs along the image's width, screen-x
    // runs up the image's height
    const nx = fill ? (p.clientY - r.top) / r.height : (p.clientX - r.left) / r.width;
    const ny = fill ? 1 - (p.clientX - r.left) / r.width : (p.clientY - r.top) / r.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    void send({ type: "click", normalizedX: nx, normalizedY: ny }, "click");
  };

  const status = mode === "watching" ? `Watching · ${(ms / 1000).toFixed(1)}s/frame` : mode === "controlling" ? `Controlling · ${(ms / 1000).toFixed(1)}s/frame` : mode === "starting" ? "Connecting to the PC…" : mode === "unreachable" ? "PC unreachable" : mode === "stopped" ? "Stopped" : "";

  return (
    <div className="ctl">
      <div className="ctl-head">
        <span className={`dot ${mode === "controlling" ? "live" : mode === "watching" ? "ok" : mode === "unreachable" ? "bad" : ""}`} />
        <span className="ctl-status">{status}</span>
        <button type="button" className={`btn small ${fill ? "on" : ""}`} onClick={() => setFill((f) => !f)} aria-label="Fill screen">{fill ? "Exit" : "Fill"}</button>
        {mode === "stopped" ? <button type="button" className="btn small" onClick={() => void start()}>Resume</button> : <button type="button" className="btn small danger" onClick={() => void stopAll()}>Stop</button>}
      </div>
      <div className={`ctl-screen ${fill ? "fill" : ""}`}>
        {frame?.frameUrl
          ? <img ref={imgRef} src={frame.frameUrl} alt="PC screen" draggable={false} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onMouseDown={onStart} onMouseUp={onEnd} />
          : <div className="ctl-empty">{mode === "unreachable" ? "No frame — the PC did not answer." : mode === "stopped" ? "Live view stopped." : "Waiting for the first frame…"}</div>}
        {frame?.dimensions ? <span className="ctl-dims">{frame.dimensions}</span> : null}
      </div>
      {err ? <div className="err">{err}</div> : null}
      <div className="ctl-keys">
        {HOTKEYS.map(([label, key]) => <button key={key} type="button" className={`key ${busy === key ? "busy" : ""}`} onClick={() => void send({ type: "hotkey", hotkey: key }, key)}>{label}</button>)}
      </div>
      <form className="ctl-type" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void send({ type: "type", text: typed }, "type"); setTyped(""); } }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type on the PC" enterKeyHint="send" autoCapitalize="off" autoCorrect="off" />
        <button type="submit" className="btn" disabled={!typed.trim()}>Type</button>
      </form>
      <div className="ctl-hint">Tap = click · two-finger drag = scroll · Stop revokes control and ends the live view.</div>
    </div>
  );
}
