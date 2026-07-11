import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { HoloGlobe } from "./globe-room/HoloGlobe";
import { JarvisCommandBar } from "./globe-room/JarvisCommandBar";
import { WidgetLauncher } from "./globe-room/WidgetLauncher";
import { WidgetStrip } from "./globe-room/WidgetStrip";
import { HelixRoom } from "./rooms/HelixRoom";
import { ApexRoom } from "./rooms/ApexRoom";
import { ArbiterRoom } from "./rooms/ArbiterRoom";
import { streamPost } from "./api";
import type { BrainResponse } from "./types";
import "./JarvisUI.css";

const PANEL_CSS = `
/* Accent is themable per room: a room sets --jr-a (RGB triplet) + --jr-bg1/2 +
   --jr-tx on :root (inline) while mounted, which overrides these defaults.
   Defaults MUST live on :root (not .jr-panel) so the inline override wins. */
:root {
  --jr-a: 0,180,255; --jr-bg1: 6,16,35; --jr-bg2: 3,8,20; --jr-tx: 185,240,255;
}
.jr-panel {
  position: fixed; left: 50%; bottom: calc(4.5vh + 107px);
  transform: translateX(-50%) translateY(12px);
  width: min(890px, 59vw); z-index: 29;
  opacity: 0; pointer-events: none;
  transition: opacity .22s ease, transform .22s ease;
}
.jr-panel.visible {
  opacity: 1; pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.jr-panel-inner {
  position: relative;
  background: linear-gradient(160deg, rgba(var(--jr-bg1),.92), rgba(var(--jr-bg2),.96));
  border: 1px solid rgba(var(--jr-a),.45);
  border-radius: 18px;
  padding: 18px 22px 16px 22px;
  box-shadow: 0 0 40px rgba(var(--jr-a),.18), 0 8px 40px rgba(0,0,0,.7),
    inset 0 1px 0 rgba(var(--jr-a),.14);
  font-family: Inter, "Segoe UI", sans-serif;
  min-height: 52px; max-height: 42vh; overflow-y: auto;
}
.jr-panel-inner::-webkit-scrollbar { width: 4px; }
.jr-panel-inner::-webkit-scrollbar-track { background: transparent; }
.jr-panel-inner::-webkit-scrollbar-thumb { background: rgba(var(--jr-a),.25); border-radius: 2px; }
.jr-label {
  font-size: 9.5px; font-weight: 600; letter-spacing: .13em; text-transform: uppercase;
  color: rgba(var(--jr-a),.5); margin-bottom: 10px; display: flex; align-items: center; gap: 7px;
}
.jr-label::after {
  content: ''; flex: 1; height: 1px;
  background: linear-gradient(90deg, rgba(var(--jr-a),.2), transparent);
}
.jr-text {
  font-size: 15px; font-weight: 300; line-height: 1.65; letter-spacing: .01em;
  color: rgba(var(--jr-tx),.88); white-space: pre-wrap; word-break: break-word;
}
.jr-cursor {
  display: inline-block; width: 2px; height: 14px;
  background: rgba(var(--jr-a),.9); vertical-align: text-bottom; margin-left: 2px;
  animation: jr-blink .8s step-end infinite;
}
@keyframes jr-blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
.jr-thinking {
  display: flex; align-items: center; gap: 5px;
}
.jr-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: rgba(var(--jr-a),.6);
  animation: jr-dot-pulse 1.2s ease-in-out infinite;
}
.jr-dot:nth-child(2) { animation-delay: .2s; }
.jr-dot:nth-child(3) { animation-delay: .4s; }
@keyframes jr-dot-pulse { 0%,100% { opacity:.3; transform:scale(.8); } 50% { opacity:1; transform:scale(1.2); } }
.jr-dismiss {
  position: absolute; top: 12px; right: 14px;
  background: none; border: none; cursor: pointer;
  color: rgba(var(--jr-a),.4); font-size: 14px; line-height: 1; padding: 3px 5px;
  border-radius: 4px; transition: color .15s;
}
.jr-dismiss:hover { color: rgba(var(--jr-a),.9); background: rgba(var(--jr-a),.15); }
.jr-error { color: rgba(255,100,100,.85); }
`;

export function JarvisUI() {
  const [response, setResponse] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [visible, setVisible] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [helixOpen, setHelixOpen] = useState(false);
  const [apexOpen, setApexOpen] = useState(false);
  const [arbiterOpen, setArbiterOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = "jr-panel-styles";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = PANEL_CSS;
  }, []);

  // Intercept helix widget open event
  useEffect(() => {
    function handle(e: Event) {
      if ((e as CustomEvent).detail?.id === "helix") {
        setHelixOpen(true);
        setLauncherOpen(false);
      }
    }
    document.addEventListener("jarvis:open-widget", handle);
    return () => document.removeEventListener("jarvis:open-widget", handle);
  }, []);

  const handleSubmit = useCallback(async (text: string) => {
    // Forgiving room-entry matcher — tolerates casing, trailing punctuation
    // (voice input adds "."), and prefixes like "open/enter/go to … room".
    const norm = text.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ").trim();
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?helix(?:\s+room)?$/.test(norm)) {
      setHelixOpen(true);
      return;
    }
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?apex(?:\s+room)?$/.test(norm)) {
      setApexOpen(true);
      return;
    }
    // Arbiter — accept "arbiter"/"arbitrer" (common spelling) with the same prefixes.
    if (/^(?:(?:go to|open|launch|enter|show|take me to)\s+)?arbit(?:er|re)?r?(?:\s+room)?$/.test(norm)) {
      setArbiterOpen(true);
      return;
    }
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setResponse("");
    setHasError(false);
    setStreaming(true);
    setVisible(true);

    try {
      await streamPost<BrainResponse>(
        "/api/chat/stream",
        { prompt: text, mode: "command" },
        (delta) => setResponse((r) => r + delta)
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "AbortError") {
        setResponse(msg);
        setHasError(true);
      }
    } finally {
      setStreaming(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    setVisible(false);
    setStreaming(false);
  }, []);

  return (
    <div className="jarvis-ui">
      {helixOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <HelixRoom onExit={() => setHelixOpen(false)} />
        </div>
      )}

      {apexOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <ApexRoom onExit={() => setApexOpen(false)} />
        </div>
      )}

      {arbiterOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
          <ArbiterRoom onExit={() => setArbiterOpen(false)} />
        </div>
      )}

      <img className="jarvis-bg" src="/jarvis_room_bg.png" alt="" />
      <Canvas
        camera={{ fov: 50, position: [0, 1.5, 8.0], near: 0.1, far: 1000 }}
        gl={{ alpha: true, antialias: true }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <group position={[0, 0.2, 0]} scale={1.32}>
          <HoloGlobe centerY={0} />
        </group>
      </Canvas>

      <div className={`jr-panel${visible ? " visible" : ""}`}>
        <div className="jr-panel-inner">
          <button className="jr-dismiss" onClick={dismiss} title="Dismiss">✕</button>
          <div className="jr-label">Jarvis</div>
          {streaming && !response ? (
            <div className="jr-thinking">
              <span className="jr-dot" />
              <span className="jr-dot" />
              <span className="jr-dot" />
            </div>
          ) : (
            <div className={`jr-text${hasError ? " jr-error" : ""}`}>
              {response}
              {streaming && <span className="jr-cursor" />}
            </div>
          )}
        </div>
      </div>

      <WidgetStrip mode="main" showChips={false} />
      <WidgetLauncher open={launcherOpen} onClose={() => setLauncherOpen(false)} />

      <JarvisCommandBar
        onSubmit={handleSubmit}
        onMicToggle={(active) => { if (!active && !response) setVisible(false); }}
        onModules={() => setLauncherOpen(o => !o)}
      />
    </div>
  );
}
