import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { FilmicLUTEffect, loadFilmicLut } from "./FilmicLUTEffect";
import { HoloGlobe } from "./HoloGlobe";
import { JarvisCommandBar } from "./JarvisCommandBar";
import { Pedestal } from "./Pedestal";
import {
  FloorGlowOverlay,
  FloorLines,
  FrontTickArc,
  HorizonGlow,
  NebulaSky,
  RoomFloorPool,
  RoomStarfield,
  SidePanels,
  SpaceWall
} from "./GlobeRoomExtras";

export type GlobeRoomProps = {
  /** radians/second of globe rotation; 0.628 = one revolution per 10s */
  spinSpeed?: number;
  paused?: boolean;
};

/**
 * Standalone JARVIS globe-room background — full scene ported from the
 * Blender design (jarvis_ref_v70). Everything is emission-style materials +
 * bloom; no scene lights needed.
 */
export function GlobeRoomScene({ spinSpeed = 0.16, paused = false }: GlobeRoomProps) {
  const [lut, setLut] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadFilmicLut().then((t) => {
      if (!cancelled) setLut(t);
      else t.dispose();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const filmicEffect = useMemo(() => (lut ? new FilmicLUTEffect(lut) : null), [lut]);

  return (
    <>
      <NebulaSky />
      <SpaceWall />
      <RoomStarfield />
      <HorizonGlow />
      <RoomFloorPool />
      <FloorLines />
      <FloorGlowOverlay />
      <FrontTickArc />
      <SidePanels />
      <Pedestal />
      <HoloGlobe spinSpeed={spinSpeed} paused={paused} />
      {filmicEffect && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={0.7}
            luminanceThreshold={0.22}
            luminanceSmoothing={0.3}
            kernelSize={3}
          />
          {/* Blender's EXACT Filmic High Contrast transform, baked to a LUT */}
          <primitive object={filmicEffect} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

/** Live globe + rings only, over a transparent canvas (plate mode). */
function GlobeOnlyScene({ spinSpeed = 0.16, paused = false }: GlobeRoomProps) {
  const [lut, setLut] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadFilmicLut().then((t) => {
      if (!cancelled) setLut(t);
      else t.dispose();
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const filmicEffect = useMemo(() => (lut ? new FilmicLUTEffect(lut) : null), [lut]);

  return (
    <>
      <HoloGlobe spinSpeed={spinSpeed} paused={paused} />
      {filmicEffect && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={0.7}
            luminanceThreshold={0.22}
            luminanceSmoothing={0.3}
            kernelSize={3}
          />
          <primitive object={filmicEffect} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

export function GlobeRoomApp() {
  const params = new URLSearchParams(window.location.search);
  const paused = params.has("paused");
  const speed = Number(params.get("speed"));
  const spinSpeed = Number.isFinite(speed) && speed > 0 ? speed : 0.16;
  // default = "plate": the room is Blender's own render (pixel-perfect),
  // only the globe + rings are live. ?room=procedural renders everything.
  const procedural = params.get("room") === "procedural";
  // ?camera=blender reproduces the EXACT Blender reference camera
  const blenderCam = params.get("camera") === "blender";
  const camPos: [number, number, number] = blenderCam ? [0, 1.72, 8.15] : [0, 1.95, 10.6];
  // same pitch (-3.11°) as the Blender camera at either distance
  const lookY = blenderCam ? 1.277 : 1.374;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: procedural
          ? "#010409"
          : "#010409 url(/globe-room/room_plate.png) center / cover no-repeat"
      }}
    >
      <Canvas
        style={{ position: "absolute", inset: 0 }}
        camera={{ position: camPos, fov: 41.11, near: 0.1, far: 140 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl, camera }) => {
          console.info("[GlobeRoom] renderer created");
          gl.setClearColor(0x000000, procedural ? 1 : 0);
          // tone transform happens once, on the composed frame (Filmic LUT)
          gl.toneMapping = THREE.NoToneMapping;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          camera.lookAt(0, lookY, 0);
        }}
      >
        {procedural
          ? <GlobeRoomScene spinSpeed={spinSpeed} paused={paused} />
          : <GlobeOnlyScene spinSpeed={spinSpeed} paused={paused} />}
      </Canvas>
      <JarvisCommandBar />
    </div>
  );
}
