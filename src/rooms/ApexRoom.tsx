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
export function ApexRoom({ onExit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [roomVisible, setRoomVisible] = useState(false);

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
      // Next frame: begin fading the room in over the settled lockup.
      requestAnimationFrame(() => setRoomVisible(true));
    };

    const stop = startApexBoot(canvas, () => {
      enterRoom();
      // Once the fade completes, freeze the boot canvas to save the GPU.
      fadeTimer = setTimeout(() => stop(), 1500);
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

      {booted && (
        <div className={`apex-room${roomVisible ? " apex-room--visible" : ""}`}>
          <div className="apex-room-bg" />
          <ApexHome onExit={onExit} />
        </div>
      )}
    </div>
  );
}
