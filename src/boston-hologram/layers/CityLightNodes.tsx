import { useMemo } from "react";
import * as THREE from "three";
import { hologramColors } from "../tokens";
import { createSeededRandom } from "../utils/seededRandom";

export function CityLightNodes() {
  const { nodes, hotNodes } = useMemo(() => {
    const rand = createSeededRandom(2036);
    const nodesList: number[] = [];
    const hotList: number[] = [];

    for (let i = 0; i < 1900; i += 1) {
      const x = (rand() - 0.5) * 22;
      const z = (rand() - 0.5) * 14 + 0.8;
      const cityBias = Math.max(0.22, 1 - Math.hypot(x * 0.7, z * 0.95) / 12);
      if (rand() < cityBias) nodesList.push(x, 0.055 + rand() * 0.035, z);
    }

    for (let i = 0; i < 110; i += 1) {
      const angle = rand() * Math.PI * 2;
      const radius = 1.2 + rand() * 8.8;
      hotList.push(Math.cos(angle) * radius, 0.09, Math.sin(angle) * radius * 0.72 + 1.1);
    }

    return { nodes: new Float32Array(nodesList), hotNodes: new Float32Array(hotList) };
  }, []);

  return (
    <group>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodes, 3]} />
        </bufferGeometry>
        <pointsMaterial color={hologramColors.cyan} size={0.032} transparent opacity={0.48} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[hotNodes, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#86ecff" size={0.07} transparent opacity={0.72} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  );
}
