import * as THREE from "three";
import { hologramColors } from "../tokens";

export function HorizonRoom() {
  return (
    <group>
      <mesh position={[0, 3.8, -9.2]} rotation={[0, 0, 0]}>
        <planeGeometry args={[24, 7, 12, 4]} />
        <meshBasicMaterial color="#053058" transparent opacity={0.018} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} wireframe />
      </mesh>
      {[-7.2, -3.1, 1.2, 5.6].map((x, index) => (
        <mesh key={x} position={[x, 1.85, -4.8 - index * 0.85]} rotation={[0.08, 0, 0]}>
          <planeGeometry args={[0.018, 5.8]} />
          <meshBasicMaterial color={hologramColors.cyan} transparent opacity={0.07 - index * 0.012} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.1, 0.052, -0.45]}>
        <ringGeometry args={[7.2, 14.5, 192]} />
        <meshBasicMaterial color="#0878ff" transparent opacity={0.04} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
