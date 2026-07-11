import { useMemo } from "react";
import * as THREE from "three";
import { hologramColors, sceneQuality } from "../tokens";
import { createSeededRandom } from "../utils/seededRandom";

export function GroundField() {
  const grid = useMemo(() => {
    const points: number[] = [];
    const extent = 20;
    for (let i = -extent; i <= extent; i += 0.58) {
      points.push(-extent, 0, i, extent, 0, i);
      points.push(i, 0, -extent, i, 0, extent);
    }
    return new Float32Array(points);
  }, []);

  const dots = useMemo(() => {
    const rand = createSeededRandom(991);
    const positions: number[] = [];
    for (let i = 0; i < sceneQuality.groundDotCount; i += 1) {
      const x = (rand() - 0.5) * 38;
      const z = (rand() - 0.5) * 26;
      const skip = Math.hypot(x, z) < 1.8 && rand() > 0.45;
      if (!skip) positions.push(x, 0.026, z);
    }
    return new Float32Array(positions);
  }, []);

  return (
    <group>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[grid, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#087ab8" transparent opacity={0.115} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dots, 3]} />
        </bufferGeometry>
        <pointsMaterial color={hologramColors.cyan} size={0.017} transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  );
}
