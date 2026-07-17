import { useEffect, useRef, useState } from "react";
import { startApexBoot } from "./apex/apexBoot";
import { ApexHome } from "./apex/ApexHome";
import "./apex.css";

interface Props {
  onExit: () => void;
}

/**
 * APEX — Intelligent Trading Room.
 *
 * Boots with the cinematic canvas sequence (see apexBoot.ts). When the
 * sequence reaches 100%, the room fades in on top of the frozen final
 * lockup — the same boot→room handoff HELIX uses. For now the room is a
 * single backdrop image (public/apex/room-bg.png); real panels come next.
 */
const BOOT_STATUS = [
  [0.0, "INITIALIZING CORE"],
  [0.2, "SYNCING LIVE MARKET DATA"],
  [0.42, "CALIBRATING REGIME ENGINE"],
  [0.62, "BOOTING ORACLE PREDICTION CORE"],
  [0.82, "RENDERING TERMINAL"],
  [0.99, "READY"],
] as const;
const bootStatus = (p: number): string => { let s: string = BOOT_STATUS[0][1]; for (const [thr, label] of BOOT_STATUS) if (p >= thr) s = label; return s; };

export function ApexRoom({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [roomVisible, setRoomVisible] = useState(false);
  // HUD is updated imperatively (via refs) so boot progress never re-renders React every frame.
  const barRef = useRef<HTMLSpanElement | null>(null);
  const pctRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<HTMLSpanElement | null>(null);
  const lastStatus = useRef<string>("");

  // Boot sequence — runs once on mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let entered = false;

    const enterRoom = () => {
      if (entered) return;
      entered = true;
      setBooted(true);
      // Begin fading the room in over the settled frame. setTimeout (not rAF) so this still fires
      // in hidden/background tabs where requestAnimationFrame is paused.
      setTimeout(() => setRoomVisible(true), 30);
    };

    const stop = startApexBoot(canvas, () => {
      enterRoom();
      // Once the fade completes, freeze the boot canvas to save the GPU.
      fadeTimer = setTimeout(() => stop(), 1500);
    }, (t) => {
      const pct = Math.round(t * 100);
      if (barRef.current) barRef.current.style.width = pct + "%";
      if (pctRef.current) pctRef.current.textContent = pct + "%";
      const s = bootStatus(t);
      if (statusRef.current && s !== lastStatus.current) { statusRef.current.textContent = s; lastStatus.current = s; }
    });

    // Safety net: if requestAnimationFrame is paused (hidden/background tab)
    // or the user prefers reduced motion, the boot's onDone may never fire.
    // Enter the room anyway so it never gets stuck on the boot canvas.
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const safety = setTimeout(enterRoom, reduced ? 300 : 15000);

    return () => {
      clearTimeout(safety);
      if (fadeTimer) clearTimeout(fadeTimer);
      stop();
    };
  }, []);

  // Note: Escape handling lives in ApexHome — it closes any open overlay
  // first and only exits the room (onExit) when nothing is open.

  return (
    <div className="apex-shell">
      <canvas ref={canvasRef} className="apex-boot-canvas" />

      {!roomVisible && (
        <div className={`apex-boot-hud${booted ? " apex-boot-hud--out" : ""}`} aria-hidden>
          <span className="abh-corner abh-tl" /><span className="abh-corner abh-tr" />
          <span className="abh-corner abh-bl" /><span className="abh-corner abh-br" />
          <div className="abh-center">
            <div className="abh-logo">APEX</div>
            <div className="abh-sub">INTELLIGENT&nbsp;&nbsp;TRADING&nbsp;&nbsp;TERMINAL</div>
            <div className="abh-bar"><span ref={barRef} style={{ width: "0%" }} /></div>
            <div className="abh-status"><span ref={statusRef}>INITIALIZING CORE</span><em ref={pctRef}>0%</em></div>
          </div>
          <div className="abh-ver">APEX ENGINE · v2.0</div>
        </div>
      )}

      {booted && (
        <div className={`apex-room${roomVisible ? " apex-room--visible" : ""}`}>
          <div className="apex-room-bg" />
          <ApexHome onExit={onExit} />
        </div>
      )}
    </div>
  );
}
