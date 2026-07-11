import * as THREE from "three";
import { bostonPins } from "../data/pins";
import { HologramLabel } from "../primitives/HologramLabel";
import { hologramColors } from "../tokens";

function toneColor(tone?: string) {
  if (tone === "amber") return hologramColors.amber;
  if (tone === "green") return hologramColors.green;
  return hologramColors.cyan;
}

export function MapPins() {
  return (
    <group>
      {bostonPins.map((pin) => {
        const color = toneColor(pin.tone);
        return (
          <group key={pin.label} position={[pin.x, 0.08, pin.z]}>
            <mesh position={[0, 0.58, 0]}>
              <cylinderGeometry args={[0.01, 0.01, 1.16, 8]} />
              <meshBasicMaterial color={color} transparent opacity={0.46} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh position={[0, 1.22, 0]}>
              <octahedronGeometry args={[0.12, 0]} />
              <meshBasicMaterial color={color} transparent opacity={0.86} blending={THREE.AdditiveBlending} />
            </mesh>
            <HologramLabel title={pin.label} subtitle={pin.sublabel} position={[0.2, 1.28, 0]} color="#6fe3ff" />
          </group>
        );
      })}
    </group>
  );
}
