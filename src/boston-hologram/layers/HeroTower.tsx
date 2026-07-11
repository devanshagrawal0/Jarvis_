import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { HologramLabel } from "../primitives/HologramLabel";
import { hologramColors } from "../tokens";

export function HeroTower() {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.025;
  });

  return (
    <group ref={groupRef} position={[0.52, 0, 2.36]}>
      <mesh position={[0, 0.88, 0]}>
        <boxGeometry args={[0.34, 1.76, 0.34]} />
        <meshStandardMaterial color="#0a437f" emissive={hologramColors.cyan} emissiveIntensity={1.55} transparent opacity={0.48} roughness={0.22} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.88, 0]}>
        <boxGeometry args={[0.44, 1.9, 0.44]} />
        <meshBasicMaterial color={hologramColors.cyanHot} wireframe transparent opacity={0.72} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      {[0.48, 0.78, 1.12].map((radius, index) => (
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045 + index * 0.012, 0]}>
          <torusGeometry args={[radius, 0.009, 8, 128]} />
          <meshBasicMaterial color={hologramColors.cyan} transparent opacity={0.56 - index * 0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <mesh position={[0, 2.44, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 3.6, 12]} />
        <meshBasicMaterial color="#5bdcff" transparent opacity={0.42} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <HologramLabel title="744 Columbus Ave" subtitle="Boston, MA 02120" position={[0.62, 0.86, 0.12]} fontSize={0.13} color={hologramColors.label} />
    </group>
  );
}
