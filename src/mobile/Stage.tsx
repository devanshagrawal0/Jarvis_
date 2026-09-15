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

function Rig({ docked, slot, state, audio, geo, count }: { docked: boolean; slot: React.RefObject<HTMLElement | null>; state: CortexState; audio: number; geo: any; count: number }) {
  const { camera, size } = useThree();
  const [anchor, setAnchor] = useState<CortexAnchor>({ x: 0, y: 0.35, scale: 1 });
  const tmp = useRef(new THREE.Vector3());
  useFrame(() => {
    if (docked && slot.current) {
      const r = slot.current.getBoundingClientRect();
      if (r.width > 0) {
        slotToWorld(r, camera, size, tmp.current);
        // the slot is ~30 px; the globe with its halo spans ~3.4 world units → scale to fit the slot
        const worldPerPx = (2 * camera.position.z * Math.tan(((camera as THREE.PerspectiveCamera).fov / 2) * Math.PI / 180)) / size.height;
        const sc = (r.width * worldPerPx) / 2.6;
        if (Math.abs(anchor.x - tmp.current.x) > 1e-3 || Math.abs(anchor.y - tmp.current.y) > 1e-3 || Math.abs(anchor.scale - sc) > 1e-4) setAnchor({ x: tmp.current.x, y: tmp.current.y, scale: sc });
      }
    } else if (anchor.scale !== 1 || anchor.y !== 0.35 || anchor.x !== 0) {
      setAnchor({ x: 0, y: 0.35, scale: 1 });
    }
  });
  return <Cortex count={count} state={state} audio={audio} geo={geo} anchor={anchor} />;
}

export function Stage({ docked, slot, state, audio = 0 }: { docked: boolean; slot: React.RefObject<HTMLElement | null>; state: CortexState; audio?: number }) {
  const [geo, setGeo] = useState<any>(null);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const low = (navigator.hardwareConcurrency || 4) <= 4;
  useEffect(() => { fetch("/globe-room/countries.geojson").then((r) => (r.ok ? r.json() : null)).then(setGeo).catch(() => setGeo(null)); }, []);
  return (
    <Canvas className="stage" camera={{ fov: 40, position: [0, 0, 8.6], near: 0.1, far: 50 }} gl={{ alpha: true, antialias: false, powerPreference: "high-performance", stencil: false }} dpr={dpr}
      style={{ position: "fixed", inset: 0, zIndex: 20, pointerEvents: "none" }}>
      <Suspense fallback={null}>
        <Rig docked={docked} slot={slot} state={state} audio={audio} geo={geo} count={low ? 15000 : 30000} />
      </Suspense>
      {!low ? (
        <EffectComposer multisampling={0} resolutionScale={0.5}>
          <Bloom mipmapBlur intensity={0.5} luminanceThreshold={0.42} luminanceSmoothing={0.3} radius={0.45} />
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}
