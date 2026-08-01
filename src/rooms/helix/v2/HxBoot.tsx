// HELIX v2 boot transition — star-warp + wordmark + progress, then fade into the room.
// Restores the room-open transition from the original HelixRoom, retuned to the v2 palette.
import React, { useEffect, useRef, useState } from "react";

export function HxBoot({ onDone }: { onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // Keep onDone in a ref so the boot timer runs EXACTLY ONCE. Previously this effect
  // depended on [onDone] — an inline arrow recreated every parent render — so any
  // re-render during boot (e.g. the projects fetch resolving) cancelled and restarted
  // the timer, and a tab hidden during launch (RAF paused) hung the boot forever,
  // leaving its full-screen overlay swallowing every click in the room.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  // progress 0→100 over ~1.6s, then fade out and reveal the room
  useEffect(() => {
    const start = performance.now();
    const DUR = 1600;
    let raf = 0;
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      setPct(100); setLeaving(true);
      setTimeout(() => onDoneRef.current(), 420);
    };
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      setPct(Math.round(p * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
      else finish();
    };
    raf = requestAnimationFrame(tick);
    // Wall-clock safety net: guarantees the boot dismisses even if RAF is throttled or
    // paused (backgrounded tab), so the overlay can never trap the room permanently.
    const failsafe = window.setTimeout(finish, DUR + 600);
    return () => { cancelAnimationFrame(raf); clearTimeout(failsafe); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // star-warp
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    let animId = 0;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize(); window.addEventListener("resize", resize);
    const N = 240;
    const stars = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random(), pz: 1 }));
    let prev = performance.now();
    const draw = (now: number) => {
      const dt = Math.min((now - prev) / 16.67, 3); prev = now;
      const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.fillStyle = "rgba(5,7,14,0.30)"; ctx.fillRect(0, 0, w, h);
      for (const s of stars) {
        s.pz = s.z; s.z -= 0.0052 * dt;
        if (s.z <= 0.001) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; s.pz = 1; continue; }
        const sx = cx + (s.x / s.z) * cx, sy = cy + (s.y / s.z) * cy;
        const px = cx + (s.x / s.pz) * cx, py = cy + (s.y / s.pz) * cy;
        const size = (1 - s.z) * 2.4;
        const hue = s.z > 0.6 ? "rgba(120,180,255," : "rgba(80,220,235,";
        ctx.strokeStyle = hue + (1 - s.z) * 0.9 + ")";
        ctx.lineWidth = size;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
      }
      animId = requestAnimationFrame(draw);
    };
    animId = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <div className={"hxv-boot" + (leaving ? " leaving" : "")}>
      <canvas ref={canvasRef} className="hxv-boot-stars" />
      <div className="hxv-boot-core">
        <div className="hxv-boot-mark" />
        <div className="hxv-boot-word">HELIX</div>
        <div className="hxv-boot-tag">Intelligence Chamber</div>
        <div className="hxv-boot-bar"><span style={{ width: pct + "%" }} /></div>
        <div className="hxv-boot-pct">{pct < 100 ? pct + "%" : "Launching…"}</div>
      </div>
    </div>
  );
}
