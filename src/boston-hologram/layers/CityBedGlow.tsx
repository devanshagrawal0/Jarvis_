import * as THREE from "three";
import { hologramColors } from "../tokens";

export function CityBedGlow() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0.2]}>
        <circleGeometry args={[11.6, 128]} />
        <meshBasicMaterial
          color="#063b6f"
          transparent
          opacity={0.006}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.25, 0.015, -0.1]}>
        <ringGeometry args={[4.6, 11.8, 160]} />
        <meshBasicMaterial
          color={hologramColors.cyan}
          transparent
          opacity={0.01}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
