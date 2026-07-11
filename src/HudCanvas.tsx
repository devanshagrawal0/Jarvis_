import { useEffect, useMemo, useRef } from "react";
import type { ModeId } from "./types";

const MODE_COLORS: Record<string, [number, number, number]> = {
  main: [80, 207, 255],
  focus: [96, 164, 255],
  plan: [255, 190, 104],
  command: [80, 207, 255],
  kalshi: [104, 240, 181],
  projects: [140, 184, 255],
  vision: [255, 138, 222]
};

type Star = { x: number; y: number; z: number; size: number; phase: number };
type CityColumn = { x: number; y: number; w: number; h: number; a: number; phase: number };
type GlobePoint = { lat: number; lon: number; size: number; lane: number; phase: number };

function rgba(rgb: [number, number, number], alpha: number) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

function makeStars(count: number) {
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = Math.sin(i * 928.132) * 10000;
    const seed2 = Math.sin(i * 371.41) * 10000;
    const seed3 = Math.sin(i * 41.73) * 10000;
    stars.push({
      x: seed - Math.floor(seed),
      y: seed2 - Math.floor(seed2),
      z: 0.35 + (seed3 - Math.floor(seed3)) * 0.65,
      size: i % 11 === 0 ? 1.8 : 1,
      phase: i * 0.47
    });
  }
  return stars;
}

function makeCityColumns(count: number) {
  const columns: CityColumn[] = [];
  for (let i = 0; i < count; i += 1) {
    const seed = Math.sin(i * 573.17) * 10000;
    const seed2 = Math.sin(i * 81.911) * 10000;
    const seed3 = Math.sin(i * 917.31) * 10000;
    const x = seed - Math.floor(seed);
    const y = seed2 - Math.floor(seed2);
    const h = seed3 - Math.floor(seed3);
    columns.push({
      x,
      y,
      w: 1 + (i % 5),
      h: 18 + h * 145,
      a: .025 + (i % 7) * .008,
      phase: i * .36
    });
  }
  return columns;
}

function makeGlobePoints(count: number) {
  const points: GlobePoint[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push({
      lat: Math.asin(y),
      lon: Math.atan2(Math.sin(theta) * radius, Math.cos(theta) * radius),
      size: i % 23 === 0 ? 1.9 : i % 7 === 0 ? 1.35 : 0.95,
      lane: i % 5,
      phase: i * 0.09
    });
  }
  return points;
}

export function HudCanvas({ mode, intensity = 88, frozen = false }: { mode: ModeId; intensity?: number; frozen?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const stars = useMemo(() => makeStars(340), []);
  const cityColumns = useMemo(() => makeCityColumns(90), []);
  const globePoints = useMemo(() => makeGlobePoints(1120), []);

  useEffect(() => {
    const canvasElement = ref.current;
    if (canvasElement === null) return;
    const context = canvasElement.getContext("2d", { alpha: true });
    if (context === null) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const ctx: CanvasRenderingContext2D = context;

    let raf = 0;
    let width = 0;
    let height = 0;
    const rgb = MODE_COLORS[mode] || MODE_COLORS.main;

    function resize() {
      const scale = Math.min(window.devicePixelRatio || 1, 1.7);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }

    function strokePath(alpha: number, blur = 0, lineWidth = 1) {
      ctx.strokeStyle = rgba(rgb, alpha);
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = rgba(rgb, Math.min(.8, alpha + .18));
      ctx.shadowBlur = blur;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    function drawDepthArchitecture(t: number) {
      const centerX = width * .5;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const col of cityColumns) {
        const sideBias = Math.abs(col.x - .5);
        const x = col.x * width;
        const baseY = height * (.09 + col.y * .36);
        const alpha = col.a * (0.55 + sideBias * 1.2) * (0.75 + Math.sin(t * .7 + col.phase) * .25);
        const grad = ctx.createLinearGradient(x, baseY, x, baseY + col.h);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(.2, rgba(rgb, alpha));
        grad.addColorStop(.72, rgba(rgb, alpha * .36));
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x, baseY, col.w, col.h);
      }

      for (let i = 0; i < 12; i += 1) {
        const offset = i - 5.5;
        const x = centerX + offset * width * .036;
        const top = height * (.08 + (i % 3) * .012);
        const bottom = height * (.56 + (i % 4) * .035);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(centerX + offset * width * .011, bottom);
        strokePath(i % 4 === 0 ? .07 : .028, i % 4 === 0 ? 10 : 0, i % 4 === 0 ? .75 : .35);
      }
      ctx.restore();
    }

    function drawBackground(t: number) {
      const centerX = width * .5;
      const centerY = height * .46;
      const bg = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * .62);
      bg.addColorStop(0, rgba(rgb, .105));
      bg.addColorStop(.2, "rgba(3,17,29,.6)");
      bg.addColorStop(.52, "rgba(0,5,10,.82)");
      bg.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const side = ctx.createLinearGradient(0, 0, width, 0);
      side.addColorStop(0, "rgba(0,0,0,.96)");
      side.addColorStop(.18, "rgba(0,0,0,.38)");
      side.addColorStop(.5, "rgba(0,0,0,0)");
      side.addColorStop(.82, "rgba(0,0,0,.38)");
      side.addColorStop(1, "rgba(0,0,0,.96)");
      ctx.fillStyle = side;
      ctx.fillRect(0, 0, width, height);

      drawDepthArchitecture(t);

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const star of stars) {
        const drift = frozen ? 0 : t * (.004 + star.z * .01);
        const x = ((star.x + drift) % 1) * width;
        const y = (star.y * .72 + .06) * height;
        const a = (.05 + star.z * .11) * (0.65 + Math.sin(t * 1.4 + star.phase) * .35);
        ctx.fillStyle = rgba(rgb, a);
        ctx.fillRect(x, y, star.size, star.size);
      }
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const beam = ctx.createLinearGradient(centerX, height * .05, centerX, height * .84);
      beam.addColorStop(0, "rgba(255,255,255,.02)");
      beam.addColorStop(.28, rgba(rgb, .105));
      beam.addColorStop(.56, rgba(rgb, .04));
      beam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(centerX - width * .09, 0);
      ctx.lineTo(centerX + width * .09, 0);
      ctx.lineTo(centerX + width * .034, height * .82);
      ctx.lineTo(centerX - width * .034, height * .82);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      drawPerspectiveGrid(t);
    }

    function drawPerspectiveGrid(t: number) {
      const cx = width * .5;
      const horizon = height * .61;
      const bottom = height * 1.04;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineCap = "round";
      for (let i = -18; i <= 18; i += 1) {
        const spread = i / 18;
        ctx.beginPath();
        ctx.moveTo(cx + spread * width * .035, horizon);
        ctx.lineTo(cx + spread * width * .64, bottom);
        strokePath(i % 6 === 0 ? .11 : .035, 0, i % 6 === 0 ? .8 : .45);
      }
      for (let i = 0; i < 28; i += 1) {
        const p = i / 27;
        const y = horizon + Math.pow(p, 1.85) * (bottom - horizon);
        const half = width * (.07 + p * .62);
        ctx.beginPath();
        ctx.moveTo(cx - half, y + Math.sin(t + i) * .8);
        ctx.lineTo(cx + half, y + Math.sin(t + i) * .8);
        strokePath(i % 5 === 0 ? .1 : .032, i % 5 === 0 ? 2 : 0, i % 5 === 0 ? .75 : .42);
      }
      ctx.restore();
    }

    function projectPoint(point: GlobePoint, radius: number, rotate: number) {
      const lon = point.lon + rotate + Math.sin(point.lat * 2 + rotate * .8) * .04;
      const cosLat = Math.cos(point.lat);
      const x = cosLat * Math.cos(lon);
      const y = Math.sin(point.lat);
      const z = cosLat * Math.sin(lon);
      return { x: x * radius, y: y * radius, z };
    }

    function drawGlobe(t: number) {
      const cx = width * .5;
      const cy = height * .455;
      const radius = Math.min(width, height) * .145;
      const rotate = frozen ? .7 : t * .145;
      const pulse = .92 + Math.sin(t * 2.1) * .08 + Math.min(intensity, 100) / 1800;

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const aura = ctx.createRadialGradient(cx, cy, 1, cx, cy, radius * 1.85);
      aura.addColorStop(0, rgba(rgb, .055));
      aura.addColorStop(.28, rgba(rgb, .07));
      aura.addColorStop(.68, rgba(rgb, .024));
      aura.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 1.85, 0, Math.PI * 2);
      ctx.fill();

      const shell = ctx.createRadialGradient(cx - radius * .3, cy - radius * .35, 0, cx, cy, radius * 1.18);
      shell.addColorStop(0, "rgba(255,255,255,.01)");
      shell.addColorStop(.34, rgba(rgb, .01));
      shell.addColorStop(.67, "rgba(0,9,16,.012)");
      shell.addColorStop(.9, rgba(rgb, .052));
      shell.addColorStop(1, "rgba(245,252,255,.26)");
      ctx.fillStyle = shell;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      const coreShade = ctx.createRadialGradient(cx + radius * .08, cy + radius * .05, 0, cx, cy, radius * .82);
      coreShade.addColorStop(0, "rgba(0,0,0,.64)");
      coreShade.addColorStop(.58, "rgba(0,0,0,.32)");
      coreShade.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = coreShade;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * .92, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "screen";

      for (let i = 0; i < 7; i += 1) {
        const tilt = -0.72 + i * .24;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt + Math.sin(t * .23 + i) * .035);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * (.92 + i * .013), radius * (.11 + (i % 3) * .028), 0, 0, Math.PI * 2);
        strokePath(.052 + i * .006, 3, .58);
        ctx.restore();
      }

      for (let i = 0; i < 10; i += 1) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(i * Math.PI / 10 + rotate * .18);
        ctx.beginPath();
        ctx.arc(0, 0, radius * (.28 + i * .052), Math.PI * .02, Math.PI * (.86 + (i % 3) * .12));
        strokePath(i % 3 === 0 ? .064 : .026, i % 3 === 0 ? 5 : 1, i % 3 === 0 ? .72 : .42);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * .99, 0, Math.PI * 2);
      ctx.clip();
      for (let lane = 0; lane < 13; lane += 1) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotate * (.38 + lane * .018) + lane * .47);
        ctx.scale(1, .28 + (lane % 4) * .045);
        ctx.beginPath();
        const rr = radius * (.38 + lane * .05);
        const start = -Math.PI * .72 + lane * .11 + Math.sin(t * .25 + lane) * .08;
        const end = start + Math.PI * (.44 + (lane % 5) * .075);
        ctx.arc(0, 0, rr, start, end);
        strokePath(.25 - lane * .011, lane < 6 ? 15 : 6, lane < 5 ? 1.42 : .78);
        ctx.restore();
      }
      for (let lane = 0; lane < 8; lane += 1) {
        const y = cy + Math.sin(lane * 1.7 + rotate) * radius * .43;
        const span = radius * (.9 - (lane % 3) * .08);
        ctx.beginPath();
        ctx.moveTo(cx - span * .76, y + Math.sin(t + lane) * 4);
        ctx.bezierCurveTo(
          cx - span * .28,
          y - radius * (.28 + (lane % 2) * .1),
          cx + span * .2,
          y + radius * (.2 + (lane % 3) * .05),
          cx + span * .78,
          y - Math.cos(t + lane) * 5
        );
        strokePath(lane % 2 === 0 ? .24 : .12, lane % 2 === 0 ? 16 : 8, lane % 2 === 0 ? 1.65 : .95);
      }
      ctx.restore();

      const projected = globePoints
        .map((point) => ({ point, projected: projectPoint(point, radius, rotate) }))
        .sort((a, b) => a.projected.z - b.projected.z);
      for (const item of projected) {
        const { point, projected: p } = item;
        const visible = p.z > -0.9;
        const edge = 1 - Math.abs(p.z);
        const rimBoost = Math.pow(1 - Math.abs(p.z), 2.2);
        const alpha = visible ? (.011 + Math.max(0, p.z) * .034 + rimBoost * .018) * pulse : .003;
        const x = cx + p.x;
        const y = cy + p.y * .82;
        const size = point.size * (visible ? 1 + p.z * .45 : .65);
        if ((point.lane + Math.floor(t * 3) + Math.floor(point.phase * 10)) % 17 === 0 && visible && p.z > -.2) {
          ctx.fillStyle = "rgba(232,250,255,.86)";
          ctx.shadowColor = rgba(rgb, .78);
          ctx.shadowBlur = 12;
        } else {
          ctx.fillStyle = rgba(rgb, Math.max(.005, alpha));
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.arc(x, y, Math.max(.45, size * 1.08), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      const bodyDarken = ctx.createRadialGradient(cx, cy, radius * .12, cx, cy, radius * .95);
      bodyDarken.addColorStop(0, "rgba(0,0,0,.42)");
      bodyDarken.addColorStop(.62, "rgba(0,0,0,.22)");
      bodyDarken.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = bodyDarken;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * .95, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "screen";

      const rim = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      rim.addColorStop(0, "rgba(255,255,255,.18)");
      rim.addColorStop(.45, rgba(rgb, .68));
      rim.addColorStop(1, "rgba(255,255,255,.9)");
      ctx.strokeStyle = rim;
      ctx.lineWidth = 2.7;
      ctx.shadowColor = rgba(rgb, .92);
      ctx.shadowBlur = 32;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * .53, Math.PI * 2.04);
      ctx.stroke();
      ctx.lineWidth = .8;
      ctx.strokeStyle = "rgba(245,252,255,.35)";
      ctx.beginPath();
      ctx.arc(cx, cy, radius * .965, Math.PI * 1.15, Math.PI * 1.92);
      ctx.stroke();
      ctx.shadowBlur = 0;

      drawPedestal(cx, cy + radius * 1.17, radius, t);
      ctx.restore();
    }

    function drawPedestal(cx: number, cy: number, radius: number, t: number) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const beam = ctx.createLinearGradient(cx, cy - radius * 1.55, cx, cy + radius * .64);
      beam.addColorStop(0, "rgba(255,255,255,0)");
      beam.addColorStop(.5, rgba(rgb, .34));
      beam.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = beam;
      ctx.lineWidth = 3;
      ctx.shadowColor = rgba(rgb, .55);
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 1.55);
      ctx.lineTo(cx, cy + radius * .55);
      ctx.stroke();

      for (let i = 0; i < 10; i += 1) {
        const rr = radius * (.38 + i * .094);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, .21);
        ctx.rotate((i % 2 ? -1 : 1) * t * .05);
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        strokePath(i % 2 === 0 ? .38 : .14, i % 2 === 0 ? 18 : 6, i % 2 === 0 ? 1.55 : .86);
        ctx.restore();
      }

      const pad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.1);
      pad.addColorStop(0, "rgba(255,255,255,.9)");
      pad.addColorStop(.12, rgba(rgb, .86));
      pad.addColorStop(.52, rgba(rgb, .38));
      pad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pad;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, .21);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }

    function draw(now: number) {
      const t = frozen ? 5.2 : now / 1000;
      ctx.clearRect(0, 0, width, height);
      drawBackground(t);
      drawGlobe(t);
      if (!frozen) raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    if (frozen) draw(0);
    else raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [mode, intensity, frozen, stars, globePoints]);

  return <canvas ref={ref} className="hud-canvas" aria-hidden="true" />;
}
