import React, { useEffect, useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PARTICLE_COUNT = 80;
const SPREAD = 28;

function Particles() {
  const pointsRef = useRef<THREE.Points>(null);
  const frameSkip = useRef(0);

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      positions[i3]     = (Math.random() - 0.5) * SPREAD;
      positions[i3 + 1] = (Math.random() - 0.5) * SPREAD;
      positions[i3 + 2] = (Math.random() - 0.5) * SPREAD * 0.4;
      velocities[i3]     = (Math.random() - 0.5) * 0.0006;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.0006;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.0002;
    }
    return { positions, velocities };
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: 0x4a9eff,
        size: 0.08,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => { geometry.dispose(); material.dispose(); };
  }, [geometry, material]);

  useFrame(() => {
    frameSkip.current = (frameSkip.current + 1) % 2;
    if (frameSkip.current !== 0 || !pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const half = SPREAD / 2;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      arr[i3]     += velocities[i3] * 2;
      arr[i3 + 1] += velocities[i3 + 1] * 2;
      arr[i3 + 2] += velocities[i3 + 2] * 2;
      if (arr[i3]     >  half) arr[i3]     = -half;
      if (arr[i3]     < -half) arr[i3]     =  half;
      if (arr[i3 + 1] >  half) arr[i3 + 1] = -half;
      if (arr[i3 + 1] < -half) arr[i3 + 1] =  half;
    }
    pos.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

function AccentParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  const frameSkip = useRef(0);
  const COUNT = 12;

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const velocities = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      positions[i3]     = (Math.random() - 0.5) * SPREAD * 0.6;
      positions[i3 + 1] = (Math.random() - 0.5) * SPREAD * 0.6;
      positions[i3 + 2] = (Math.random() - 0.5) * 4;
      velocities[i3]     = (Math.random() - 0.5) * 0.001;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.001;
      velocities[i3 + 2] = 0;
    }
    return { positions, velocities };
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        color: 0x4afff0,
        size: 0.14,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => { geometry.dispose(); material.dispose(); };
  }, [geometry, material]);

  useFrame(() => {
    frameSkip.current = (frameSkip.current + 1) % 2;
    if (frameSkip.current !== 0 || !pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const half = SPREAD * 0.3;
    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      arr[i3]     += velocities[i3] * 2;
      arr[i3 + 1] += velocities[i3 + 1] * 2;
      if (arr[i3]     >  half) arr[i3]     = -half;
      if (arr[i3]     < -half) arr[i3]     =  half;
      if (arr[i3 + 1] >  half) arr[i3 + 1] = -half;
      if (arr[i3 + 1] < -half) arr[i3 + 1] =  half;
    }
    pos.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

export function HelixScene() {
  return (
    <div className="helix-scene-root" aria-hidden>
      <Canvas
        camera={{ position: [0, 0, 14], fov: 60, near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
        dpr={[1, 1.5]}
        performance={{ min: 0.5 }}
        style={{ background: "transparent" }}
        frameloop="always"
      >
        <Particles />
        <AccentParticles />
      </Canvas>
    </div>
  );
}
