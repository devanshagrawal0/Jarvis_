import * as THREE from "three";

export function FenwayRing() {
  return (
    <group position={[-7.6, 0.09, 1.75]} rotation={[-Math.PI / 2, 0, 0.12]}>
      <mesh>
        <torusGeometry args={[0.95, 0.025, 10, 160]} />
        <meshBasicMaterial color="#20c9ff" transparent opacity={0.62} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.62, 0.012, 8, 120]} />
        <meshBasicMaterial color="#105f93" transparent opacity={0.52} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}
