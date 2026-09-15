import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { Cortex, type CortexAnchor, type CortexState } from "./Cortex";

// The centrepiece's stage: one fixed full-screen canvas behind the chrome. Hero = centred a little
// above the middle; docked = the top-bar slot. The slot's screen rect is cast onto the z=0 plane
// each frame (cheap) so the dock follows the real layout, rotation or keyboard included.

function slotToWorld(rect: DOMRect, camera: THREE.Camera, size: { width: number; height: number }, out: THREE.Vector3) {
  const ndc = new THREE.Vector3(((rect.left + rect.width / 2) / size.width) * 2 - 1, -(((rect.top + rect.height / 2) / size.height) * 2 - 1), 0.5).unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  const t = -camera.position.z / dir.z;
  out.copy(camera.position).add(dir.multiplyScalar(t));
}

// The hero globe is centred in the free area between the top bar and the dock (the `.content`
// element) and scaled to fit it — so when the keyboard takes half the screen, the globe moves up
// and shrinks instead of sitting under the composer. Docked: the top-bar slot. Both are DOM rects
// cast to the z=0 plane each frame; the canvas itself is sized to the visual viewport (CSS).
function Rig({ docked, slot, area, state, audioRef, geo, count }: { docked: boolean; slot: React.RefObject<HTMLElement | null>; area: React.RefObject<HTMLElement | null>; state: CortexState; audioRef: { current: number }; geo: any; count: number }) {
  const { camera, size } = useThree();
  const [anchor, setAnchor] = useState<CortexAnchor>({ x: 0, y: 0.35, scale: 1 });
  const tmp = useRef(new THREE.Vector3());
  useFrame(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const worldPerPx = (2 * cam.position.z * Math.tan((cam.fov / 2) * Math.PI / 180)) / size.height;
    const canvasTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vv-top")) || 0;
    let next: CortexAnchor | null = null;
    if (docked && slot.current) {
      const r = slot.current.getBoundingClientRect();
      if (r.width > 0) {
        slotToWorld(new DOMRect(r.left, r.top - canvasTop, r.width, r.height), camera, size, tmp.current);
        next = { x: tmp.current.x, y: tmp.current.y, scale: (r.width * worldPerPx) / 2.6 };
      }
    } else if (area.current) {
      const r = area.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        slotToWorld(new DOMRect(r.left, r.top - canvasTop, r.width, r.height), camera, size, tmp.current);
        // the globe with its halo spans ~3.4 world units; the arcs may kiss the edges, the body never
        // does. Sit it a little below the area's centre so it reads as one group with the greeting.
        const fit = Math.min(r.width, r.height) * worldPerPx;
        next = { x: tmp.current.x, y: tmp.current.y, scale: Math.min(1, fit / 3.45) };
      }
    }
    if (next && (Math.abs(anchor.x - next.x) > 1e-3 || Math.abs(anchor.y - next.y) > 1e-3 || Math.abs(anchor.scale - next.scale) > 1e-4)) setAnchor(next);
  });
  return <Cortex count={count} state={state} audioRef={audioRef} geo={geo} anchor={anchor} />;
}

// Quality ladder (plan v2 §5): measured, not assumed. Frame time is sampled for two seconds at a
// time; below 48 fps the stage steps down — bloom off → 15k points → 8k — and the choice is
// remembered per device so the next open starts where the last one settled.
type Quality = { bloom: boolean; count: number };
const LADDER: Quality[] = [{ bloom: true, count: 30000 }, { bloom: false, count: 30000 }, { bloom: false, count: 15000 }, { bloom: false, count: 8000 }];
function FpsGovernor({ onStepDown }: { onStepDown: () => void }) {
  // Warm-up first: the opening seconds carry shader compiles and the geometry build, and a step
  // taken on those would be permanent (it is remembered per device). Then two bad 2 s windows in
  // a row before stepping down; one good window clears the count.
  const acc = useRef({ t: 0, n: 0, warm: 0, bad: 0, steps: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    if (a.warm < 3.5) { a.warm += dt; return; }
    a.t += dt; a.n++;
    if (a.t >= 2) {
      const fps = a.n / a.t; a.t = 0; a.n = 0;
      if (fps < 48) { a.bad++; if (a.bad >= 2 && a.steps < 3) { a.bad = 0; a.steps++; onStepDown(); } }
      else a.bad = 0;
    }
  });
  return null;
}

export function Stage({ docked, slot, area, state, audioRef }: { docked: boolean; slot: React.RefObject<HTMLElement | null>; area: React.RefObject<HTMLElement | null>; state: CortexState; audioRef: { current: number } }) {
  const [geo, setGeo] = useState<any>(null);
  const [level, setLevel] = useState(() => { try { return Math.min(LADDER.length - 1, Number(localStorage.getItem("jarvis.mobile.quality") || 0)); } catch { return 0; } });
  const q = LADDER[level];
  // phones: DPR 1.5 is plenty for points and halves the fill cost versus 2–3
  const touch = "ontouchstart" in window;
  const dpr = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
  useEffect(() => { fetch("/globe-room/countries.geojson").then((r) => (r.ok ? r.json() : null)).then(setGeo).catch(() => setGeo(null)); }, []);
  useEffect(() => { try { localStorage.setItem("jarvis.mobile.quality", String(level)); } catch { /* ignore */ } }, [level]);
  return (
    <Canvas className="stage" camera={{ fov: 40, position: [0, 0, 8.6], near: 0.1, far: 50 }} gl={{ alpha: true, antialias: false, powerPreference: "high-performance", stencil: false }} dpr={dpr}
      style={{ position: "fixed", left: 0, top: "var(--vv-top, 0px)", width: "100%", height: "var(--app-h, 100dvh)", zIndex: 20, pointerEvents: "none" }}>
      <Suspense fallback={null}>
        <Rig docked={docked} slot={slot} area={area} state={state} audioRef={audioRef} geo={geo} count={q.count} />
      </Suspense>
      <FpsGovernor onStepDown={() => setLevel((l) => Math.min(LADDER.length - 1, l + 1))} />
      {q.bloom ? (
        <EffectComposer multisampling={0} resolutionScale={0.5}>
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.42} luminanceSmoothing={0.3} radius={0.45} />
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}
