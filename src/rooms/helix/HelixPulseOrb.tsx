import React, { useEffect, useRef } from "react";

interface StrandHealth {
  evidence: number;
  strategy: number;
  construction: number;
  memory: number;
  signal: number;
  synthesis: number;
}

interface Props {
  health: StrandHealth;
  processing: boolean;
}

const RINGS: Array<{ strand: keyof StrandHealth; radius: number; color: string }> = [
  { strand: "evidence",     radius: 96, color: "#4a9eff" },
  { strand: "strategy",     radius: 79, color: "#4aff9e" },
  { strand: "construction", radius: 62, color: "#ff9e4a" },
  { strand: "memory",       radius: 46, color: "#9e4aff" },
  { strand: "signal",       radius: 31, color: "#ffe14a" },
  { strand: "synthesis",    radius: 17, color: "#4afff0" },
];

const SIZE = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;

export function HelixPulseOrb({ health, processing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const healthRef = useRef(health);
  const processingRef = useRef(processing);
  const frameRef = useRef<number>(0);
  const tRef = useRef(0);

  // Update refs on every render so the rAF loop always has fresh values
  healthRef.current = health;
  processingRef.current = processing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const INTERVAL = 1000 / 30; // 30fps cap
    let lastTime = 0;

    function draw(now: number) {
      frameRef.current = requestAnimationFrame(draw);
      if (now - lastTime < INTERVAL) return;
      lastTime = now;
      tRef.current += processingRef.current ? 0.04 : 0.015;
      const t = tRef.current;
      ctx!.clearRect(0, 0, SIZE, SIZE);

      // Draw rings outer → inner
      for (const ring of RINGS) {
        const h = healthRef.current[ring.strand];
        const baseOpacity = 0.15 + h * 0.70;
        // Processing pulse: add a sin wave on top
        const pulse = processingRef.current ? Math.sin(t * 3 + ring.radius * 0.05) * 0.18 : 0;
        const opacity = Math.min(1, baseOpacity + pulse);

        // Faint filled disc
        ctx!.beginPath();
        ctx!.arc(CX, CY, ring.radius, 0, Math.PI * 2);
        ctx!.strokeStyle = ring.color;
        ctx!.globalAlpha = opacity;
        ctx!.lineWidth = h > 0.6 ? 1.5 : 1;
        ctx!.stroke();

        // Active glow ring
        if (h > 0.4) {
          ctx!.beginPath();
          ctx!.arc(CX, CY, ring.radius, 0, Math.PI * 2);
          ctx!.shadowBlur = 8 + h * 12;
          ctx!.shadowColor = ring.color;
          ctx!.globalAlpha = opacity * 0.5;
          ctx!.lineWidth = 0.5;
          ctx!.stroke();
          ctx!.shadowBlur = 0;
        }
      }

      // Core orb — pulsing dot at center
      const coreSize = 6 + (processingRef.current ? Math.sin(t * 5) * 2 : 0);
      const coreOpacity = 0.6 + Math.sin(t * 2) * 0.2;
      ctx!.beginPath();
      ctx!.arc(CX, CY, coreSize, 0, Math.PI * 2);
      ctx!.fillStyle = "#4a9eff";
      ctx!.globalAlpha = coreOpacity;
      ctx!.shadowBlur = 18;
      ctx!.shadowColor = "#4a9eff";
      ctx!.fill();
      ctx!.shadowBlur = 0;

      // Rotating arc indicator when processing
      if (processingRef.current) {
        ctx!.beginPath();
        ctx!.arc(CX, CY, 110, t, t + Math.PI * 0.6);
        ctx!.strokeStyle = "#4a9eff";
        ctx!.globalAlpha = 0.35;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      ctx!.globalAlpha = 1;
    }

    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, []); // rAF loop starts once on mount; reads refs on each frame

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="helix-pulse-orb"
      aria-hidden="true"
    />
  );
}
