import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hologramColors, sceneQuality } from "../tokens";
import { createSeededRandom } from "../utils/seededRandom";

export function AtmosphericParticles() {
  const particles = useMemo(() => {
    const rand = createSeededRandom(448);
    const positions: number[] = [];
    for (let i = 0; i < sceneQuality.particleCount; i += 1) {
      positions.push((rand() - 0.5) * 27, rand() * 5.2 + 0.2, (rand() - 0.5) * 18);
    }
    return new Float32Array(positions);
  }, []);
  const ref = useRef<THREE.Points>(null);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.05) * 0.04;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[particles, 3]} />
      </bufferGeometry>
      <pointsMaterial color={hologramColors.cyan} size={0.018} transparent opacity={0.14} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}
