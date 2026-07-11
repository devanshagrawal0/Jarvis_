import * as THREE from "three";
import { hologramColors } from "../tokens";

export function EmissiveLine({
  curve,
  color = hologramColors.road,
  opacity = 0.34,
  radius = 0.008,
}: {
  curve: THREE.CatmullRomCurve3;
  color?: string;
  opacity?: number;
  radius?: number;
}) {
  return (
    <mesh>
      <tubeGeometry args={[curve, 96, radius, 8, false]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}
